const maskGameForColor = require('./gameView');
const Match = require('../models/Match');
const Game = require('../models/Game');
const User = require('../models/User');
const constants = require('../../shared/constants/game.json');

const ACTIONS = constants?.actions || {};

function describeTimeControl(baseMs, incMs) {
  const parts = [];
  if (Number.isFinite(baseMs) && baseMs > 0) {
    const minutes = Math.floor(baseMs / 60000);
    const seconds = Math.round((baseMs % 60000) / 1000);
    if (minutes > 0 && seconds > 0) {
      parts.push(`${minutes}m ${seconds}s`);
    } else if (minutes > 0) {
      parts.push(`${minutes}m`);
    } else if (seconds > 0) {
      parts.push(`${seconds}s`);
    }
  }
  if (Number.isFinite(incMs) && incMs > 0) {
    const incSeconds = incMs / 1000;
    const formatted = Number.isInteger(incSeconds) ? String(incSeconds) : incSeconds.toFixed(1);
    parts.push(`+ ${formatted}s`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function computeSpectatorClocks(game) {
  const baseTime = Number(game?.timeControlStart);
  if (!Number.isFinite(baseTime) || baseTime <= 0) {
    return { whiteMs: 0, blackMs: 0, activeColor: null, label: describeTimeControl(null, null) };
  }

  const increment = Number(game?.increment) || 0;
  const startTime = game?.startTime ? new Date(game.startTime).getTime() : null;
  const label = describeTimeControl(baseTime, increment);
  if (!startTime) {
    return { whiteMs: baseTime, blackMs: baseTime, activeColor: null, label };
  }

  const actions = Array.isArray(game?.actions)
    ? game.actions
        .map((action) => ({ ...action, timestamp: new Date(action.timestamp).getTime() }))
        .filter((action) => Number.isFinite(action.timestamp))
        .sort((a, b) => a.timestamp - b.timestamp)
    : [];

  let white = baseTime;
  let black = baseTime;
  const initialSetup = Array.isArray(game?.setupComplete)
    ? game.setupComplete.map((value) => Boolean(value))
    : [false, false];
  const setupFlags = [...initialSetup];
  let lastTs = startTime;
  let derivedTurn = null;

  actions.forEach((action) => {
    const ts = action.timestamp;
    if (!Number.isFinite(ts)) {
      return;
    }
    const delta = Math.max(0, ts - lastTs);
    if (delta > 0) {
      if (!setupFlags[0] || !setupFlags[1]) {
        if (!setupFlags[0]) white -= delta;
        if (!setupFlags[1]) black -= delta;
      } else if (derivedTurn === 0) {
        white -= delta;
      } else if (derivedTurn === 1) {
        black -= delta;
      }
    }
    lastTs = ts;

    if (action.type === ACTIONS.SETUP) {
      if (action.player === 0 || action.player === 1) {
        setupFlags[action.player] = true;
        if (setupFlags[0] && setupFlags[1] && derivedTurn === null) {
          derivedTurn = 0;
        }
      }
      return;
    }

    if (derivedTurn === null) {
      derivedTurn = 0;
    }

    if (action.player === 0) {
      white += increment;
      derivedTurn = 1;
    } else if (action.player === 1) {
      black += increment;
      derivedTurn = 0;
    }
  });

  const activeColorFromGame = (game?.playerTurn === 0 || game?.playerTurn === 1)
    ? game.playerTurn
    : null;
  const activeColor = activeColorFromGame !== null
    ? activeColorFromGame
    : ((setupFlags[0] && setupFlags[1]) ? derivedTurn : null);

  const referenceTs = game?.isActive
    ? Date.now()
    : (game?.endTime ? new Date(game.endTime).getTime() : lastTs);
  const tailDelta = Math.max(0, referenceTs - lastTs);
  if (tailDelta > 0) {
    if (!setupFlags[0] || !setupFlags[1]) {
      if (!setupFlags[0]) white -= tailDelta;
      if (!setupFlags[1]) black -= tailDelta;
    } else if (activeColor === 0) {
      white -= tailDelta;
    } else if (activeColor === 1) {
      black -= tailDelta;
    }
  }

  return {
    whiteMs: Math.max(0, Math.round(white)),
    blackMs: Math.max(0, Math.round(black)),
    activeColor,
    label,
  };
}

async function buildSpectateSnapshot(matchId) {
  if (!matchId) return null;
  const normalizedId = matchId.toString();
  const match = await Match.findById(normalizedId).lean();
  if (!match) return null;

  const latestGame = await Game.findOne({ match: normalizedId })
    .sort({ createdAt: -1, startTime: -1, _id: -1 })
    .lean();

  let gamePayload = null;
  let clocks = { whiteMs: 0, blackMs: 0, activeColor: null, label: null };
  const playerIds = new Set();

  if (match.player1) playerIds.add(match.player1.toString());
  if (match.player2) playerIds.add(match.player2.toString());
  if (match.winner) playerIds.add(match.winner.toString());

  if (latestGame) {
    const masked = maskGameForColor(JSON.parse(JSON.stringify(latestGame)), 'spectator');
    if (masked) {
      masked.stashes = null;
      masked.onDecks = null;
      masked.onDeckingPlayer = null;
    }
    const captured = Array.isArray(latestGame.captured) ? latestGame.captured : [[], []];
    const daggers = Array.isArray(latestGame.daggers) ? latestGame.daggers : [0, 0];
    const actions = Array.isArray(masked?.actions) ? masked.actions : [];
    const moves = Array.isArray(masked?.moves) ? masked.moves : [];
    const players = Array.isArray(latestGame.players)
      ? latestGame.players.map((id) => id && id.toString())
      : [];

    players.forEach((id) => { if (id) playerIds.add(id); });

    gamePayload = {
      id: latestGame._id.toString(),
      board: masked?.board || [],
      captured,
      daggers,
      actions,
      moves,
      players,
      isActive: Boolean(latestGame.isActive),
      winner: latestGame.winner,
      winReason: latestGame.winReason,
      timeControlStart: latestGame.timeControlStart,
      increment: latestGame.increment,
      startTime: latestGame.startTime,
      endTime: latestGame.endTime,
      setupComplete: Array.isArray(latestGame.setupComplete) ? latestGame.setupComplete : [],
    };

    clocks = computeSpectatorClocks(latestGame);
  }

  const users = await User.find({ _id: { $in: Array.from(playerIds) } })
    .select('_id username elo')
    .lean();
  const playersMap = {};
  users.forEach((user) => {
    if (!user || !user._id) return;
    playersMap[user._id.toString()] = {
      username: user.username || null,
      elo: Number.isFinite(user.elo) ? user.elo : null,
    };
  });

  const now = Date.now();

  const snapshot = {
    matchId: normalizedId,
    match: {
      id: normalizedId,
      type: match.type || null,
      isActive: Boolean(match.isActive),
      player1Id: match.player1 ? match.player1.toString() : null,
      player2Id: match.player2 ? match.player2.toString() : null,
      player1Score: Number(match.player1Score || 0),
      player2Score: Number(match.player2Score || 0),
      drawCount: Number(match.drawCount || 0),
      winnerId: match.winner ? match.winner.toString() : null,
    },
    game: gamePayload,
    clocks,
    timestamp: now,
    players: playersMap,
  };

  return snapshot;
}

module.exports = {
  buildSpectateSnapshot,
};
