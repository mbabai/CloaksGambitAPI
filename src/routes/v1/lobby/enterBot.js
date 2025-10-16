const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const eventBus = require('../../../eventBus');
const { resolveUserFromRequest } = require('../../../utils/authTokens');
const lobbyStore = require('../../../state/lobby');
const getServerConfig = require('../../../utils/getServerConfig');
const { ensureGuestForBotGame, ensureBotUser, normalizeDifficulty } = require('../../../services/bots/registry');

async function resolveQuickplaySettings() {
  const config = await getServerConfig();
  const quickplaySettings = config?.gameModeSettings?.get
    ? (config.gameModeSettings.get('QUICKPLAY') || {})
    : (config?.gameModeSettings?.QUICKPLAY || {});
  const incrementSetting = config?.gameModeSettings?.get
    ? config.gameModeSettings.get('INCREMENT')
    : config?.gameModeSettings?.INCREMENT;
  const timeControl = Number(quickplaySettings?.TIME_CONTROL) || 300000;
  const increment = Number(incrementSetting) || 0;
  const aiType = config?.gameModes?.get
    ? (config.gameModes.get('AI') || 'AI')
    : (config?.gameModes?.AI || 'AI');
  return { timeControl, increment, type: aiType };
}

router.post('/', async (req, res) => {
  try {
    let { userId, difficulty } = req.body || {};
    const diffKey = normalizeDifficulty(difficulty);
    if (diffKey !== 'easy') {
      return res.status(400).json({ message: 'Only easy bots are currently available.' });
    }

    let userInfo = await resolveUserFromRequest(req);
    if (userInfo && userInfo.userId) {
      userId = userInfo.userId;
    }

    const ensured = await ensureGuestForBotGame(userId);
    userId = ensured.userId;
    const username = ensured.username;

    console.log('[bot-match] matchmaking request', {
      requestedBy: userInfo?.userId || userId,
      difficulty: diffKey,
      username,
    });

    if (lobbyStore.isInGame(userId)) {
      return res.status(400).json({ message: 'User is already in a game' });
    }

    if (lobbyStore.isInAnyQueue(userId)) {
      lobbyStore.removeFromAllQueues(userId);
      lobbyStore.emitQueueChanged([userId]);
    }

    const { user: botUser } = await ensureBotUser(diffKey);

    console.log('[bot-match] using bot opponent', {
      botId: botUser?._id?.toString?.() || null,
      botUsername: botUser?.username,
      difficulty: diffKey,
    });

    const { timeControl, increment, type } = await resolveQuickplaySettings();

    const players = [userId, botUser._id.toString()];

    const match = await Match.create({
      player1: players[0],
      player2: players[1],
      type,
      player1Score: 0,
      player2Score: 0,
      games: [],
    });

    const game = await Game.create({
      players,
      match: match._id,
      timeControlStart: timeControl,
      increment,
    });

    match.games.push(game._id);
    await match.save();

    lobbyStore.addInGame([userId]);
    lobbyStore.emitQueueChanged([userId]);

    const affectedUsers = players.map((id) => id.toString());
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
      difficulty: diffKey,
    });
  } catch (err) {
    console.error('[bot-match] failed to create bot match:', err);
    return res.status(500).json({ message: err.message || 'Failed to create bot match' });
  }
});

module.exports = router;
