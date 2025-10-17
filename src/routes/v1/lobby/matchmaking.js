const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const User = require('../../../models/User');
const ensureUser = require('../../../utils/ensureUser');
const lobbyStore = require('../../../state/lobby');
const { GAME_CONSTANTS } = require('../../../../shared/constants');

const DEFAULT_ELO = 800;

let matchmakingQueue = Promise.resolve();

async function runMatchmaking() {
  console.log('Starting matchmaking check...');

  const config = await getServerConfig();

  const quickplayType = config?.gameModes?.get
    ? (config.gameModes.get('QUICKPLAY') || 'QUICKPLAY')
    : (config?.gameModes?.QUICKPLAY || 'QUICKPLAY');
  const rankedType = config?.gameModes?.get
    ? (config.gameModes.get('RANKED') || 'RANKED')
    : (config?.gameModes?.RANKED || 'RANKED');

  const quickplaySettings = config?.gameModeSettings?.get
    ? (config.gameModeSettings.get('QUICKPLAY') || {})
    : (config?.gameModeSettings?.QUICKPLAY || {});
  const rankedSettings = config?.gameModeSettings?.get
    ? (config.gameModeSettings.get('RANKED') || {})
    : (config?.gameModeSettings?.RANKED || {});
  const incrementSetting = config?.gameModeSettings?.get
    ? config.gameModeSettings.get('INCREMENT')
    : config?.gameModeSettings?.INCREMENT;

  const increment = Number(incrementSetting) || 0;
  const quickplayTimeControl = Number(quickplaySettings?.TIME_CONTROL)
    || GAME_CONSTANTS.gameModeSettings.QUICKPLAY.TIME_CONTROL;
  const rankedTimeControl = Number(rankedSettings?.TIME_CONTROL)
    || GAME_CONSTANTS.gameModeSettings.RANKED.TIME_CONTROL;

  let snapshot = lobbyStore.getState();
  console.log('Checking queues:', {
    rankedQueue: snapshot.rankedQueue.length,
    quickplayQueue: snapshot.quickplayQueue.length,
    inGame: snapshot.inGame.length,
  });

  while (snapshot.quickplayQueue.length >= 2) {
    const [player1, player2] = snapshot.quickplayQueue.slice(0, 2);
    const players = [player1, player2].filter(Boolean);

    await Promise.all(players.map(id => ensureUser(id)));

    if (players.length < 2) {
      console.error('Invalid players in quickplay queue:', { player1, player2 });
      break;
    }

    const gamePlayers = Math.random() < 0.5
      ? [player1, player2]
      : [player2, player1];

    console.log('Creating quickplay match for players:', {
      player1: player1.toString(),
      player2: player2.toString(),
    });

    lobbyStore.removeFromQueue('quickplay', player1);
    lobbyStore.removeFromQueue('quickplay', player2);

    try {
      const match = await Match.create({
        player1,
        player2,
        type: quickplayType,
        player1Score: 0,
        player2Score: 0,
        games: [],
      });

      const game = await Game.create({
        players: gamePlayers,
        match: match._id,
        timeControlStart: quickplayTimeControl,
        increment,
      });

      eventBus.emit('gameChanged', {
        game: typeof game.toObject === 'function' ? game.toObject() : game,
        affectedUsers: gamePlayers.map(id => id.toString()),
      });

      eventBus.emit('players:bothNext', {
        game: typeof game.toObject === 'function' ? game.toObject() : game,
        affectedUsers: gamePlayers.map(id => id.toString()),
      });

      match.games.push(game._id);
      await match.save();

      eventBus.emit('match:created', {
        matchId: match._id.toString(),
        players: gamePlayers.map(id => id.toString()),
        type: match.type,
      });

      lobbyStore.addInGame(players);
      const snapshotAfter = lobbyStore.emitQueueChanged(players);

      await Game.updateOne(
        { _id: game._id, playersReady: { $exists: false } },
        { $set: { playersReady: [false, false] } }
      );

      console.log('Quickplay match created successfully. Remaining quickplay queue:', snapshotAfter.quickplayQueue.length);
    } catch (matchErr) {
      lobbyStore.removeInGame(players);
      lobbyStore.addToQueue('quickplay', player2, { toFront: true });
      lobbyStore.addToQueue('quickplay', player1, { toFront: true });
      lobbyStore.emitQueueChanged(players);
      throw matchErr;
    }

    snapshot = lobbyStore.getState();
  }

  snapshot = lobbyStore.getState();

  while (snapshot.rankedQueue.length >= 2) {
    const [player1, player2] = snapshot.rankedQueue.slice(0, 2);
    const players = [player1, player2].filter(Boolean);

    await Promise.all(players.map(id => ensureUser(id)));

    if (players.length < 2) {
      console.error('Invalid players in ranked queue:', { player1, player2 });
      break;
    }

    const [p1User, p2User] = await Promise.all([
      User.findById(player1).lean().catch(() => null),
      User.findById(player2).lean().catch(() => null),
    ]);

    const gamePlayers = Math.random() < 0.5
      ? [player1, player2]
      : [player2, player1];

    const eloLookup = new Map([
      [player1.toString(), Number.isFinite(p1User?.elo) ? p1User.elo : DEFAULT_ELO],
      [player2.toString(), Number.isFinite(p2User?.elo) ? p2User.elo : DEFAULT_ELO],
    ]);

    const resolveElo = (id) => {
      const key = id?.toString?.() ? id.toString() : id;
      return eloLookup.get(key) ?? DEFAULT_ELO;
    };

    console.log('Creating ranked match for players:', {
      player1: player1.toString(),
      player2: player2.toString(),
    });

    lobbyStore.removeFromQueue('ranked', player1);
    lobbyStore.removeFromQueue('ranked', player2);

    try {
      const match = await Match.create({
        player1,
        player2,
        type: rankedType,
        player1Score: 0,
        player2Score: 0,
        games: [],
        player1StartElo: resolveElo(player1),
        player2StartElo: resolveElo(player2),
        player1EndElo: resolveElo(player1),
        player2EndElo: resolveElo(player2),
      });

      const game = await Game.create({
        players: gamePlayers,
        match: match._id,
        timeControlStart: rankedTimeControl,
        increment,
      });

      eventBus.emit('gameChanged', {
        game: typeof game.toObject === 'function' ? game.toObject() : game,
        affectedUsers: gamePlayers.map(id => id.toString()),
      });

      eventBus.emit('players:bothNext', {
        game: typeof game.toObject === 'function' ? game.toObject() : game,
        affectedUsers: gamePlayers.map(id => id.toString()),
      });

      match.games.push(game._id);
      await match.save();

      eventBus.emit('match:created', {
        matchId: match._id.toString(),
        players: gamePlayers.map(id => id.toString()),
        type: match.type,
      });

      lobbyStore.addInGame(players);
      lobbyStore.emitQueueChanged(players);

      await Game.updateOne(
        { _id: game._id, playersReady: { $exists: false } },
        { $set: { playersReady: [false, false] } }
      );

      console.log('Ranked match created successfully. Remaining ranked queue:', lobbyStore.getState().rankedQueue.length);
    } catch (matchErr) {
      lobbyStore.removeInGame(players);
      lobbyStore.addToQueue('ranked', player2, { toFront: true });
      lobbyStore.addToQueue('ranked', player1, { toFront: true });
      lobbyStore.emitQueueChanged(players);
      throw matchErr;
    }

    snapshot = lobbyStore.getState();
  }
}

function checkAndCreateMatches() {
  const run = matchmakingQueue.then(async () => {
    try {
      await runMatchmaking();
    } catch (err) {
      console.error('Error in matchmaking:', err);
      throw err;
    }
  });

  matchmakingQueue = run.catch(() => {});
  return run;
}

// Endpoint to trigger matchmaking check
router.post('/check', async (req, res) => {
  try {
    console.log('Matchmaking check endpoint called');
    await checkAndCreateMatches();
    res.json({ message: 'Matchmaking check completed' });
  } catch (err) {
    console.error('Error in matchmaking endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = {
  router,
  checkAndCreateMatches,
};
