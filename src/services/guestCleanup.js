const mongoose = require('mongoose');

const User = require('../models/User');
const Game = require('../models/Game');
const Match = require('../models/Match');
const { reportServerError } = require('./adminErrorFeed');

const ONE_HOUR_MS = 60 * 60 * 1000;
const DISCONNECT_RETENTION_MS = 24 * ONE_HOUR_MS;

let cleanupInterval = null;
let mongoUnavailableNoticeOpen = false;

function hasMongoConnection() {
  return Boolean(mongoose.connection && mongoose.connection.readyState === 1);
}

function getMongoReadyState() {
  return Number.isFinite(Number(mongoose?.connection?.readyState))
    ? Number(mongoose.connection.readyState)
    : null;
}

function reportMongoUnavailable(skipMessage = 'Guest cleanup skipped because MongoDB is not connected.') {
  if (!mongoUnavailableNoticeOpen) {
    console.warn('[guestCleanup] %s', skipMessage, {
      readyState: getMongoReadyState(),
    });
  }
  mongoUnavailableNoticeOpen = true;
  reportServerError({
    source: 'guestCleanup',
    level: 'warn',
    code: 'mongo_unavailable',
    message: skipMessage,
    details: {
      readyState: getMongoReadyState(),
    },
  });
}

function clearMongoUnavailableNoticeIfNeeded() {
  if (!mongoUnavailableNoticeOpen || !hasMongoConnection()) {
    return;
  }
  mongoUnavailableNoticeOpen = false;
  console.log('[guestCleanup] MongoDB connection restored; stale guest cleanup resumed.');
}

function isMongoConnectivityError(err) {
  const name = String(err?.name || '');
  const code = String(err?.code || '');
  const message = String(err?.message || '').toLowerCase();
  return name === 'MongoServerSelectionError'
    || name === 'MongoNetworkTimeoutError'
    || name === 'MongoNetworkError'
    || code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || /server selection/i.test(name)
    || /socket 'connect' timed out/.test(message)
    || /failed to connect to server/.test(message);
}

function normalizeId(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return '';
}

async function runLeanQuery(query, select) {
  let current = query;
  if (current && typeof current.select === 'function' && select) {
    current = current.select(select);
  }
  if (current && typeof current.lean === 'function') {
    current = current.lean();
  }
  return await current;
}

async function findProtectedGuestIds(candidateIds = []) {
  if (!Array.isArray(candidateIds) || candidateIds.length === 0) {
    return new Set();
  }

  const [games, matches] = await Promise.all([
    runLeanQuery(
      Game.find({ players: { $in: candidateIds } }),
      'players'
    ),
    runLeanQuery(
      Match.find({
        $or: [
          { player1: { $in: candidateIds } },
          { player2: { $in: candidateIds } },
          { winner: { $in: candidateIds } },
        ],
      }),
      'player1 player2 winner'
    ),
  ]);

  const protectedIds = new Set();
  const gameRows = Array.isArray(games) ? games : [];
  const matchRows = Array.isArray(matches) ? matches : [];

  gameRows.forEach((game) => {
    (game?.players || []).forEach((playerId) => {
      const normalized = normalizeId(playerId);
      if (normalized) {
        protectedIds.add(normalized);
      }
    });
  });

  matchRows.forEach((match) => {
    [match?.player1, match?.player2, match?.winner].forEach((playerId) => {
      const normalized = normalizeId(playerId);
      if (normalized) {
        protectedIds.add(normalized);
      }
    });
  });

  return protectedIds;
}

async function removeStaleGuests() {
  const cutoff = new Date(Date.now() - DISCONNECT_RETENTION_MS);
  if (!hasMongoConnection()) {
    reportMongoUnavailable();
    return {
      skipped: true,
      reason: 'mongo_unavailable',
    };
  }

  clearMongoUnavailableNoticeIfNeeded();

  try {
    const staleGuests = await User.find({
      isGuest: true,
      lastDisconnectedAt: { $lte: cutoff }
    })
      .select('_id')
      .lean();

    if (!Array.isArray(staleGuests) || staleGuests.length === 0) {
      return;
    }

    const candidateIds = staleGuests
      .map((guest) => normalizeId(guest?._id))
      .filter(Boolean);
    const protectedIds = await findProtectedGuestIds(candidateIds);
    const removableIds = candidateIds.filter((id) => !protectedIds.has(id));

    if (removableIds.length === 0) {
      return;
    }

    const result = await User.deleteMany({
      _id: { $in: removableIds }
    });

    if (result?.deletedCount) {
      console.log('[guestCleanup] Removed stale anonymous accounts', {
        deletedCount: result.deletedCount,
        cutoff
      });
    }

    return {
      deletedCount: Number(result?.deletedCount || 0),
      cutoff,
    };
  } catch (err) {
    if (isMongoConnectivityError(err)) {
      reportMongoUnavailable('Guest cleanup could not reach MongoDB; cleanup will retry after the connection recovers.');
      return {
        skipped: true,
        reason: 'mongo_unavailable',
      };
    }

    console.error('[guestCleanup] Failed to remove stale anonymous accounts:', err);
    reportServerError({
      source: 'guestCleanup',
      level: 'error',
      code: err?.code || 'guest_cleanup_failed',
      message: err?.message || 'Failed to remove stale anonymous accounts.',
      error: err,
      details: {
        cutoff: cutoff.toISOString(),
        readyState: getMongoReadyState(),
      },
    });
    return {
      skipped: true,
      reason: 'error',
    };
  }
}

function startGuestCleanupTask() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  removeStaleGuests().catch((err) => {
    console.error('[guestCleanup] Initial cleanup run failed:', err);
  });

  cleanupInterval = setInterval(() => {
    removeStaleGuests().catch((err) => {
      console.error('[guestCleanup] Scheduled cleanup run failed:', err);
    });
  }, ONE_HOUR_MS);

  return cleanupInterval;
}

function stopGuestCleanupTask() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

module.exports = {
  removeStaleGuests,
  startGuestCleanupTask,
  stopGuestCleanupTask,
};

