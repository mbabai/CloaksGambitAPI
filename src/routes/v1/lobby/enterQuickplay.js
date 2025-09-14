const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const Match = require('../../../models/Match');
const { checkAndCreateMatches } = require('./matchmaking');
const eventBus = require('../../../eventBus');
const mongoose = require('mongoose');
const ensureUser = require('../../../utils/ensureUser');

router.post('/', async (req, res) => {
  try {
      let { userId } = req.body;
      let userInfo;
      if (!userId) {
        userInfo = await ensureUser();
      } else {
        userInfo = await ensureUser(userId);
      }
      userId = userInfo.userId;

    let lobby = await Lobby.findOne();
    if (!lobby) {
      lobby = await Lobby.create({ quickplayQueue: [], rankedQueue: [], inGame: [] });
    }

    // Check if user is already in a game
    if (lobby.inGame.some(id => id.toString() === userId)) {
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
        lobby.inGame = lobby.inGame.filter(id => id.toString() !== userId);
        await lobby.save();
        console.warn(`Removed stale inGame entry for user ${userId}`);
      } else {
        return res.status(400).json({ message: 'User is already in a game' });
      }
    }

    if (lobby.quickplayQueue.some(id => id.toString() === userId)) {
      return res
        .status(400)
        .json({ message: 'User already in quickplay queue' });
    }
    if (lobby.rankedQueue.some(id => id.toString() === userId)) {
      return res.status(400).json({ message: 'User already in ranked queue' });
    }

    lobby.quickplayQueue.push(new mongoose.Types.ObjectId(userId));
    await lobby.save();
    
    console.log(`User ${userId} added to quickplay queue. Queue length: ${lobby.quickplayQueue.length}`);

    eventBus.emit('queueChanged', {
      quickplayQueue: lobby.quickplayQueue.map(id => id.toString()),
      rankedQueue: lobby.rankedQueue.map(id => id.toString()),
      affectedUsers: [userId.toString()],
    });

    await checkAndCreateMatches();
    const updated = await Lobby.findOne().lean();
    
    console.log(`After matchmaking check - Queue length: ${updated.quickplayQueue.length}, In game: ${updated.inGame.length}`);

    if (updated.inGame.some(id => id.toString() === userId)) {
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
