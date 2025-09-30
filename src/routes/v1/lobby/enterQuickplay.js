const express = require('express');
const router = express.Router();
const { checkAndCreateMatches } = require('./matchmaking');
const eventBus = require('../../../eventBus');
const ensureUser = require('../../../utils/ensureUser');
const { resolveUserFromRequest } = require('../../../utils/authTokens');
const {
  ensureLobby,
  addUserToQueue,
  isUserInQueue,
  removeUserFromInGame,
  isUserInActiveMatch,
  findActiveMatchForPlayer,
  snapshotQueues,
} = require('../../../utils/lobbyState');

router.post('/', async (req, res) => {
  try {
    let { userId } = req.body;
    let userInfo = await resolveUserFromRequest(req);

    if (userInfo && userInfo.userId) {
      userId = userInfo.userId;
    } else {
      if (!userId) {
        userInfo = await ensureUser();
      } else {
        userInfo = await ensureUser(userId);
      }
      userId = userInfo.userId;
    }

    const lobby = ensureLobby();

    // Check if user is already in a game
    if (lobby.inGame.some(id => id.toString() === userId)) {
      if (!isUserInActiveMatch(userId)) {
        removeUserFromInGame(userId);
        console.warn(`Removed stale inGame entry for user ${userId}`);
      } else {
        return res.status(400).json({ message: 'User is already in a game' });
      }
    }

    if (isUserInQueue(lobby.quickplayQueue, userId)) {
      return res
        .status(400)
        .json({ message: 'User already in quickplay queue' });
    }
    if (isUserInQueue(lobby.rankedQueue, userId)) {
      return res.status(400).json({ message: 'User already in ranked queue' });
    }

    addUserToQueue(lobby.quickplayQueue, userId);

    console.log(`User ${userId} added to quickplay queue. Queue length: ${lobby.quickplayQueue.length}`);

    const snapshot = snapshotQueues();
    eventBus.emit('queueChanged', {
      ...snapshot,
      affectedUsers: [userId.toString()],
    });

    await checkAndCreateMatches();
    console.log(`After matchmaking check - Queue length: ${lobby.quickplayQueue.length}, In game: ${lobby.inGame.length}`);

    if (lobby.inGame.some(id => id.toString() === userId)) {
      const active = findActiveMatchForPlayer(userId);
      if (active?.match && active.games?.length) {
        const latestGame = active.games[active.games.length - 1];
        return res.json({
          status: 'matched',
          matchId: active.matchId,
          gameId: latestGame?._id || latestGame?.id,
          type: active.match.type,
          userId,
          username: userInfo.username,
        });
      }
    }

    res.json({ status: 'queued', userId, username: userInfo.username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
