const User = require('../models/User');
const Game = require('../models/Game');
const Match = require('../models/Match');

const ONE_HOUR_MS = 60 * 60 * 1000;
const DISCONNECT_RETENTION_MS = 24 * ONE_HOUR_MS;

let cleanupInterval = null;

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
    (async () => {
      try {
        return await runLeanQuery(
          Game.find({ players: { $in: candidateIds } }),
          'players'
        );
      } catch (_) {
        return [];
      }
    })(),
    (async () => {
      try {
        return await runLeanQuery(
          Match.find({
            $or: [
              { player1: { $in: candidateIds } },
              { player2: { $in: candidateIds } },
              { winner: { $in: candidateIds } },
            ],
          }),
          'player1 player2 winner'
        );
      } catch (_) {
        return [];
      }
    })(),
  ]);

  const protectedIds = new Set();

  games.forEach((game) => {
    (game?.players || []).forEach((playerId) => {
      const normalized = normalizeId(playerId);
      if (normalized) {
        protectedIds.add(normalized);
      }
    });
  });

  matches.forEach((match) => {
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
  } catch (err) {
    console.error('[guestCleanup] Failed to remove stale anonymous accounts:', err);
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
  startGuestCleanupTask,
  stopGuestCleanupTask,
};

