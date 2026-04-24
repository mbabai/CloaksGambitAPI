const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');
const { resolveLobbySession } = require('../../../utils/lobbyAccess');
const lobbyStore = require('../../../state/lobby');
const getServerConfig = require('../../../utils/getServerConfig');
const { ensureGuestForBotGame } = require('../../../services/bots/registry');
const {
  getClockSettingsForMatchType,
  getGameModeType,
} = require('../../../utils/gameModeClock');
const {
  INTRO_TUTORIAL_ID,
  prepareIntroTutorialGame,
} = require('../../../services/tutorials/runtime');

async function ensureTutorialBotUser() {
  const email = 'tutorial.bot@cg-bots.local';
  let bot = await User.findOne({ email }).lean();
  if (bot) {
    return bot;
  }

  bot = await User.findOne({ username: 'Tutorial Bot' }).lean();
  if (bot) {
    if (!bot.email || bot.isGuest || !bot.isBot) {
      await User.updateOne({ _id: bot._id }, {
        $set: {
          email,
          isBot: true,
          isGuest: false,
          botDifficulty: 'tutorial',
        },
      });
      bot.email = email;
      bot.isBot = true;
      bot.isGuest = false;
      bot.botDifficulty = 'tutorial';
    }
    return bot;
  }

  const created = await User.create({
    username: 'Tutorial Bot',
    email,
    elo: 0,
    isBot: true,
    isGuest: false,
    botDifficulty: 'tutorial',
  });
  return created.toObject();
}

async function resolveTutorialSettings() {
  const config = await getServerConfig();
  const type = getGameModeType(config, 'AI', 'AI');
  const { timeControl, increment } = getClockSettingsForMatchType(config, 'AI');
  return { config, type, timeControl, increment };
}

router.post('/', async (req, res) => {
  try {
    const userInfo = await resolveLobbySession(req, res);
    if (!userInfo) return;
    let userId = userInfo.userId;

    const ensured = await ensureGuestForBotGame(userId);
    userId = ensured.userId;
    const username = ensured.username;

    if (lobbyStore.isInGame(userId)) {
      return res.status(400).json({ message: 'User is already in a game' });
    }

    if (lobbyStore.isInAnyQueue(userId)) {
      lobbyStore.removeFromAllQueues(userId);
      lobbyStore.emitQueueChanged([userId]);
    }

    const botUser = await ensureTutorialBotUser();
    const { config, type, timeControl, increment } = await resolveTutorialSettings();

    const match = await Match.create({
      player1: userId,
      player2: botUser._id.toString(),
      type,
      player1Score: 0,
      player2Score: 0,
      games: [],
      isTutorial: true,
    });

    const game = await Game.create({
      players: [userId, botUser._id.toString()],
      match: match._id,
      timeControlStart: timeControl,
      increment,
      isTutorial: true,
      tutorialState: {
        id: INTRO_TUTORIAL_ID,
        step: 1,
      },
    });

    prepareIntroTutorialGame(game, config);
    await game.save();

    match.games.push(game._id);
    await match.save();

    lobbyStore.addInGame([userId]);
    lobbyStore.emitQueueChanged([userId]);

    const affectedUsers = [userId, botUser._id.toString()];
    const gamePayload = typeof game.toObject === 'function' ? game.toObject() : game;

    eventBus.emit('gameChanged', {
      game: gamePayload,
      affectedUsers,
      initiator: {
        action: 'tutorial-created',
        userId,
        username,
      },
      botPlayers: [botUser._id.toString()],
    });

    eventBus.emit('match:created', {
      matchId: match._id.toString(),
      players: affectedUsers,
      type,
      botPlayers: [botUser._id.toString()],
    });

    return res.json({
      status: 'tutorial-started',
      userId,
      username,
      matchId: match._id.toString(),
      gameId: game._id.toString(),
      botId: botUser._id.toString(),
    });
  } catch (err) {
    console.error('[tutorial] failed to create tutorial match:', err);
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    return res.status(statusCode).json({ message: err.message || 'Failed to start tutorial' });
  }
});

module.exports = router;
