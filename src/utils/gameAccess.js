const Game = require('../models/Game');
const User = require('../models/User');
const { isAdminSession } = require('./adminAccess');
const { resolveSessionFromRequest } = require('./requestSession');

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return null;
}

function parsePlayerColor(value) {
  const normalized = parseInt(value, 10);
  if (normalized === 0 || normalized === 1) {
    return normalized;
  }
  return null;
}

function getPlayerColorForUser(game, userId) {
  const targetId = toId(userId);
  if (!targetId || !Array.isArray(game?.players)) {
    return null;
  }
  const index = game.players.findIndex((playerId) => toId(playerId) === targetId);
  return index === 0 || index === 1 ? index : null;
}

async function buildRequesterDetails(session) {
  if (!session?.userId) {
    return {
      userId: null,
      username: null,
      isBot: false,
      botDifficulty: null,
      isGuest: true,
    };
  }

  let userRecord = session.user || null;
  if (!userRecord) {
    try {
      const lookup = User.findById(session.userId);
      if (lookup && typeof lookup.lean === 'function') {
        userRecord = await lookup.lean();
      } else {
        userRecord = await lookup;
      }
    } catch (_) {
      userRecord = null;
    }
  }
  return {
    userId: session.userId,
    username: session.username || userRecord?.username || null,
    isBot: Boolean(userRecord?.isBot),
    botDifficulty: userRecord?.botDifficulty || null,
    isGuest: Boolean(session.isGuest ?? userRecord?.isGuest),
    user: userRecord || null,
  };
}

async function requireSession(req, res, options = {}) {
  const session = await resolveSessionFromRequest(req, options);
  if (session?.userId) {
    return session;
  }
  if (res && typeof res.status === 'function') {
    res.status(401).json({ message: 'Authentication required' });
  }
  return null;
}

async function requireGamePlayerContext(req, res, { gameId, color, allowAdmin = false } = {}) {
  const session = await requireSession(req, res, { createGuest: false });
  if (!session) return null;

  const game = await Game.findById(gameId);
  if (!game) {
    res.status(404).json({ message: 'Game not found' });
    return null;
  }

  if (allowAdmin && isAdminSession(session)) {
    const requestedColor = parsePlayerColor(color);
    if (color !== undefined && requestedColor === null) {
      res.status(400).json({ message: 'Invalid color' });
      return null;
    }
    return {
      game,
      session,
      requesterDetails: await buildRequesterDetails(session),
      color: requestedColor,
      isAdmin: true,
    };
  }

  const playerColor = getPlayerColorForUser(game, session.userId);
  if (playerColor === null) {
    res.status(403).json({ message: 'Forbidden' });
    return null;
  }

  const requestedColor = parsePlayerColor(color);
  if (color !== undefined && requestedColor === null) {
    res.status(400).json({ message: 'Invalid color' });
    return null;
  }
  if (requestedColor !== null && requestedColor !== playerColor) {
    res.status(403).json({ message: 'Player color does not match session' });
    return null;
  }

  return {
    game,
    session,
    requesterDetails: await buildRequesterDetails(session),
    color: playerColor,
    isAdmin: false,
  };
}

async function resolveGameViewerContext(req, game) {
  const session = await resolveSessionFromRequest(req, { createGuest: false });
  if (session && isAdminSession(session)) {
    return { role: 'admin', session, color: null };
  }

  const playerColor = getPlayerColorForUser(game, session?.userId);
  if (playerColor !== null) {
    return { role: 'player', session, color: playerColor };
  }

  return { role: 'spectator', session: session || null, color: null };
}

async function resolveMatchViewerContext(req, match) {
  const session = await resolveSessionFromRequest(req, { createGuest: false });
  if (session && isAdminSession(session)) {
    return { role: 'admin', session };
  }

  const sessionUserId = toId(session?.userId);
  const player1Id = toId(match?.player1?._id || match?.player1);
  const player2Id = toId(match?.player2?._id || match?.player2);
  if (sessionUserId && (sessionUserId === player1Id || sessionUserId === player2Id)) {
    return { role: 'player', session };
  }

  return { role: 'spectator', session: session || null };
}

module.exports = {
  buildRequesterDetails,
  getPlayerColorForUser,
  parsePlayerColor,
  requireGamePlayerContext,
  requireSession,
  resolveGameViewerContext,
  resolveMatchViewerContext,
  toId,
};
