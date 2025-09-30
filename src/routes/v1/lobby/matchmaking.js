const express = require('express');
const { randomUUID } = require('crypto');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const User = require('../../../models/User');
const ensureUser = require('../../../utils/ensureUser');
const {
  ensureLobby,
  removeUserFromQueue,
  ensureUserInGame,
  snapshotQueues,
} = require('../../../utils/lobbyState');
const { matches, games, quickplayQueue, rankedQueue } = require('../../../state');

const DEFAULT_ELO = 800;

function resolveConfigValue(collection, key, fallback) {
  if (!collection) return fallback;
  if (typeof collection.get === 'function') {
    return collection.get(key) ?? fallback;
  }
  if (typeof collection === 'object' && collection !== null) {
    return collection[key] ?? fallback;
  }
  return fallback;
}

function createInMemoryMatch({
  players,
  type,
  timeControl,
  increment,
  rankedMeta = {},
}) {
  const normalizedPlayers = players.map((id) => id.toString());
  const matchId = randomUUID();
  const createdAt = new Date();
  const match = {
    _id: matchId,
    id: matchId,
    player1: normalizedPlayers[0],
    player2: normalizedPlayers[1],
    players: normalizedPlayers,
    type,
    player1Score: 0,
    player2Score: 0,
    games: [],
    isActive: true,
    createdAt,
    ...rankedMeta,
  };

  const gameId = randomUUID();
  const game = {
    _id: gameId,
    id: gameId,
    match: matchId,
    players: normalizedPlayers,
    playersReady: [false, false],
    playersNext: [false, false],
    playerTurn: null,
    winner: null,
    winReason: null,
    createdAt,
    startTime: null,
    endTime: null,
    isActive: true,
    timeControlStart: timeControl,
    increment,
  };

  match.games.push(gameId);
  matches.set(matchId, match);
  games.set(gameId, game);

  return { matchId, match, gameId, game };
}

async function pairPlayers(queue, config, typeKey) {
  const paired = [];

  while (queue.length >= 2) {
    const player1 = queue.shift();
    const player2 = queue.shift();

    if (!player1 || !player2) {
      console.error('Invalid players in queue:', { player1, player2 });
      break;
    }

    await Promise.all([
      ensureUser(player1),
      ensureUser(player2),
    ]);

    removeUserFromQueue(quickplayQueue, player1);
    removeUserFromQueue(quickplayQueue, player2);
    removeUserFromQueue(rankedQueue, player1);
    removeUserFromQueue(rankedQueue, player2);

    const typeValue = resolveConfigValue(config.gameModes, typeKey, typeKey);
    const settings = resolveConfigValue(config.gameModeSettings, typeKey, {});
    const incrementSetting = resolveConfigValue(config.gameModeSettings, 'INCREMENT', 0);
    const timeControl = Number(settings?.TIME_CONTROL) || 0;
    const increment = Number(settings?.INCREMENT ?? incrementSetting) || 0;

    let rankedMeta = {};
    if (typeKey === 'RANKED') {
      const [p1User, p2User] = await Promise.all([
        User.findById(player1).lean().catch(() => null),
        User.findById(player2).lean().catch(() => null),
      ]);
      rankedMeta = {
        player1StartElo: p1User?.elo ?? DEFAULT_ELO,
        player2StartElo: p2User?.elo ?? DEFAULT_ELO,
        player1EndElo: p1User?.elo ?? DEFAULT_ELO,
        player2EndElo: p2User?.elo ?? DEFAULT_ELO,
      };
    }

    const { matchId, match, game } = createInMemoryMatch({
      players: [player1, player2],
      type: typeValue,
      timeControl,
      increment,
      rankedMeta,
    });

    ensureUserInGame(player1);
    ensureUserInGame(player2);

    const affectedUsers = [player1.toString(), player2.toString()];

    eventBus.emit('gameChanged', {
      game,
      affectedUsers,
    });

    eventBus.emit('players:bothNext', {
      game,
      affectedUsers,
    });

    eventBus.emit('match:created', {
      matchId,
      players: affectedUsers,
      type: match.type,
    });

    paired.push({ matchId, match, game, affectedUsers });
  }

  if (paired.length) {
    const snapshot = snapshotQueues();
    const affectedUsers = Array.from(new Set(paired.flatMap(item => item.affectedUsers)));
    eventBus.emit('queueChanged', {
      ...snapshot,
      affectedUsers,
    });
  }

  return paired;
}

async function checkAndCreateMatches() {
  try {
    console.log('Starting matchmaking check...');
    const lobby = ensureLobby();

    console.log('Checking queues:', {
      rankedQueue: lobby.rankedQueue.length,
      quickplayQueue: lobby.quickplayQueue.length,
      inGame: lobby.inGame.length,
    });

    if (lobby.quickplayQueue.length < 2 && lobby.rankedQueue.length < 2) {
      return [];
    }

    const config = await getServerConfig();
    const results = [];

    const quickplayPairs = await pairPlayers(lobby.quickplayQueue, config, 'QUICKPLAY');
    results.push(...quickplayPairs);

    const rankedPairs = await pairPlayers(lobby.rankedQueue, config, 'RANKED');
    results.push(...rankedPairs);

    console.log('Matchmaking created matches:', results.length);

    return results;
  } catch (err) {
    console.error('Error in matchmaking:', err);
    throw err;
  }
}

router.post('/check', async (req, res) => {
  try {
    console.log('Matchmaking check endpoint called');
    const results = await checkAndCreateMatches();
    res.json({ message: 'Matchmaking check completed', matchesCreated: results.length });
  } catch (err) {
    console.error('Error in matchmaking endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = {
  router,
  checkAndCreateMatches,
};
