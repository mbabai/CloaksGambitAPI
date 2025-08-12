const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const Match = require('../../../models/Match');
const { checkAndCreateMatches } = require('./matchmaking');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }

    let lobby = await Lobby.findOne();
    if (!lobby) {
      lobby = await Lobby.create({ quickplayQueue: [], rankedQueue: [], inGame: [] });
    }

    // Check if user is already in a game
    if (lobby.inGame.some(id => id.toString() === userId)) {
      return res.status(400).json({ message: 'User is already in a game' });
    }

    if (lobby.quickplayQueue.some(id => id.toString() === userId)) {
      return res
        .status(400)
        .json({ message: 'User already in quickplay queue' });
    }
    if (lobby.rankedQueue.some(id => id.toString() === userId)) {
      return res.status(400).json({ message: 'User already in ranked queue' });
    }

    lobby.quickplayQueue.push(userId);
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
        type: match.type
      });
    }

    res.json({ status: 'queued' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
