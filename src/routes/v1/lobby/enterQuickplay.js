const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const { checkAndCreateMatches } = require('./matchmaking');
const eventBus = require('../../../eventBus');
const ensureUser = require('../../../utils/ensureUser');
const { resolveUserFromRequest } = require('../../../utils/authTokens');
const lobbyStore = require('../../../state/lobby');

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

    // Check if user is already in a game
    if (lobbyStore.isInGame(userId)) {
      // Defensive cleanup: verify there is actually an active game or match
      // If there isn't, remove stale inGame entry and allow queuing
      const Game = require('../../../models/Game');
      const Match = require('../../../models/Match');
      const hasActiveGame = await Game.exists({ players: userId, isActive: true });
      const hasActiveMatch = await Match.exists({
        $or: [{ player1: userId }, { player2: userId }],
        isActive: true,
      });
      if (!hasActiveGame && !hasActiveMatch) {
        lobbyStore.removeInGame(userId);
        lobbyStore.emitQueueChanged([userId]);
        console.warn(`Removed stale inGame entry for user ${userId}`);
      } else {
        return res.status(400).json({ message: 'User is already in a game' });
      }
    }

    if (lobbyStore.isInQueue('quickplay', userId)) {
      return res
        .status(400)
        .json({ message: 'User already in quickplay queue' });
    }
    if (lobbyStore.isInQueue('ranked', userId)) {
      return res.status(400).json({ message: 'User already in ranked queue' });
    }

    const { added, state: updatedState } = lobbyStore.addToQueue('quickplay', userId);
    if (added) {
      console.log(`User ${userId} added to quickplay queue. Queue length: ${updatedState.quickplayQueue.length}`);

      eventBus.emit('queueChanged', {
        quickplayQueue: updatedState.quickplayQueue,
        rankedQueue: updatedState.rankedQueue,
        affectedUsers: [userId.toString()],
      });
    }

    await checkAndCreateMatches();
    const updated = lobbyStore.getState();

    console.log(`After matchmaking check - Queue length: ${updated.quickplayQueue.length}, In game: ${updated.inGame.length}`);

    if (updated.inGame.some(id => id === userId)) {
      const match = await Match.findOne({
        $or: [
          { player1: userId },
          { player2: userId }
        ]
      }).sort({ createdAt: -1 }).lean();

        return res.json({
          status: 'matched',
          matchId: match._id,
          gameId: match.games[match.games.length - 1],
          type: match.type,
          userId,
          username: userInfo.username,
        });
      }

      res.json({ status: 'queued', userId, username: userInfo.username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
