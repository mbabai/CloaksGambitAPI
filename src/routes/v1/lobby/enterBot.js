const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const eventBus = require('../../../eventBus');
const { resolveLobbySession } = require('../../../utils/lobbyAccess');
const lobbyStore = require('../../../state/lobby');
const getServerConfig = require('../../../utils/getServerConfig');
const {
  ensureGuestForBotGame,
  ensureBotUser,
  normalizeDifficulty,
  normalizeBuiltinBotId,
  getBuiltinBotDefinition,
} = require('../../../services/bots/registry');
const {
  getClockSettingsForMatchType,
  getGameModeType,
} = require('../../../utils/gameModeClock');

async function resolveQuickplaySettings() {
  const config = await getServerConfig();
  const { timeControl, increment } = getClockSettingsForMatchType(config, 'AI');
  return {
    timeControl,
    increment,
    type: getGameModeType(config, 'AI', 'AI'),
  };
}

router.post('/', async (req, res) => {
  try {
    const requestedBotId = typeof req.body?.botId === 'string' && req.body.botId.trim()
      ? req.body.botId.trim()
      : '';
    const selectionId = requestedBotId || normalizeDifficulty(req.body?.difficulty);
    const builtinBotId = normalizeBuiltinBotId(selectionId);
    const builtinBot = getBuiltinBotDefinition(selectionId);

    const userInfo = await resolveLobbySession(req, res);
    if (!userInfo) return;
    let userId = userInfo.userId;

    const ensured = await ensureGuestForBotGame(userId);
    userId = ensured.userId;
    const username = ensured.username;

    console.log('[bot-match] matchmaking request', {
      requestedBy: userInfo?.userId || userId,
      botId: selectionId,
      username,
    });

    if (!builtinBot) {
      return res.status(400).json({ message: 'Selected bot is not available.' });
    }

    if (builtinBot.playable === false) {
      return res.status(400).json({ message: builtinBot.unavailableMessage || 'Selected bot is not available.' });
    }

    if (lobbyStore.isInGame(userId)) {
      return res.status(400).json({ message: 'User is already in a game' });
    }

    if (lobbyStore.isInAnyQueue(userId)) {
      lobbyStore.removeFromAllQueues(userId);
      lobbyStore.emitQueueChanged([userId]);
    }

    const { user: botUser } = await ensureBotUser(builtinBotId);

    console.log('[bot-match] using bot opponent', {
      botId: botUser?._id?.toString?.() || null,
      botUsername: botUser?.username,
      difficulty: builtinBotId,
    });

    const { timeControl, increment, type } = await resolveQuickplaySettings();

    const players = [userId, botUser._id.toString()];
    const gamePlayers = Math.random() < 0.5
      ? [players[0], players[1]]
      : [players[1], players[0]];

    const match = await Match.create({
      player1: players[0],
      player2: players[1],
      type,
      player1Score: 0,
      player2Score: 0,
      games: [],
    });

    const game = await Game.create({
      players: gamePlayers,
      match: match._id,
      timeControlStart: timeControl,
      increment,
    });

    match.games.push(game._id);
    await match.save();

    lobbyStore.addInGame([userId]);
    lobbyStore.emitQueueChanged([userId]);

    const affectedUsers = gamePlayers.map((id) => id.toString());
    const gamePayload = typeof game.toObject === 'function' ? game.toObject() : game;

    console.log('[bot-match] created', {
      userId,
      username,
      botId: botUser._id.toString(),
      matchId: match._id.toString(),
      gameId: game._id.toString(),
      timeControl,
      increment,
      type,
    });

    eventBus.emit('gameChanged', {
      game: gamePayload,
      affectedUsers,
      initiator: {
        action: 'bot-match-created',
        userId,
        username,
      },
      botPlayers: [botUser._id.toString()],
    });

    eventBus.emit('players:bothNext', {
      game: gamePayload,
      affectedUsers,
      currentGameNumber: 1,
      botPlayers: [botUser._id.toString()],
    });

    eventBus.emit('match:created', {
      matchId: match._id.toString(),
      players: affectedUsers,
      type,
      botPlayers: [botUser._id.toString()],
    });

    await Game.updateOne(
      { _id: game._id, playersReady: { $exists: false } },
      { $set: { playersReady: [false, false] } }
    );

    return res.json({
      status: 'matched',
      userId,
      username,
      matchId: match._id.toString(),
      gameId: game._id.toString(),
      botId: botUser._id.toString(),
      difficulty: builtinBotId,
    });
  } catch (err) {
    console.error('[bot-match] failed to create bot match:', err);
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    return res.status(statusCode).json({ message: err.message || 'Failed to create bot match' });
  }
});

module.exports = router;
