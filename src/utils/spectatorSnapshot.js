const maskGameForColor = require('./gameView');
const Match = require('../models/Match');
const Game = require('../models/Game');
const User = require('../models/User');
const { buildClockPayload } = require('./gameClock');
const constants = require('../../shared/constants/game.json');

async function buildSpectateSnapshot(matchId) {
  if (!matchId) return null;
  const normalizedId = matchId.toString();
  const match = await Match.findById(normalizedId).lean();
  if (!match) return null;

  const [activeGame, finishedGame] = await Promise.all([
    Game.findOne({ match: normalizedId, isActive: true })
      .sort({ startTime: -1, createdAt: -1, _id: -1 })
      .lean(),
    Game.findOne({ match: normalizedId, isActive: false })
      .sort({ endTime: -1, createdAt: -1, _id: -1 })
      .lean(),
  ]);

  const normalizeTime = (value) => {
    if (!value) return 0;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : 0;
  };

  let latestGame = null;
  if (activeGame && finishedGame) {
    const activeStart = normalizeTime(activeGame.startTime);
    const finishedEnd = normalizeTime(finishedGame.endTime);
    latestGame = activeStart >= finishedEnd ? activeGame : finishedGame;
  } else {
    latestGame = activeGame || finishedGame;
  }

  if (!latestGame) {
    latestGame = await Game.findOne({ match: normalizedId })
      .sort({ createdAt: -1, _id: -1 })
      .lean();
  }

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

    clocks = buildClockPayload(latestGame, {
      now: Date.now(),
      setupActionType: constants?.actions?.SETUP,
    });
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
