const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const Match = require('../../../models/Match');
const { checkAndCreateMatches } = require('./matchmaking');

const POLL_INTERVAL = 1000; // 1 second
const TIMEOUT = 30000; // 30 seconds

router.post('/', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }

  const start = Date.now();
  while (Date.now() - start < TIMEOUT) {
      await checkAndCreateMatches();
      const lobby = await Lobby.findOne().lean();
      if (!lobby) {
        return res.status(404).json({ message: 'Lobby not found' });
      }

      // Check if user is in a game
      if (lobby.inGame.some(id => id.toString() === userId)) {
        // Find the match and game for this user
        const match = await Match.findOne({
          $or: [
            { player1: userId },
            { player2: userId }
          ]
        }).sort({ createdAt: -1 }).lean();

        if (match) {
          return res.json({
            status: 'matched',
            matchId: match._id,
            gameId: match.games[match.games.length - 1],
            type: match.type
          });
        }
      }

      // If user is not in a game, check queue status
      const inRankedQueue = lobby.rankedQueue.some(id => id.toString() === userId);
      const inQuickplayQueue = lobby.quickplayQueue.some(id => id.toString() === userId);
      
      if (inRankedQueue || inQuickplayQueue) {
        const queueType = inRankedQueue ? 'ranked' : 'quickplay';
        const queueLength = inRankedQueue ? lobby.rankedQueue.length : lobby.quickplayQueue.length;
        
        return res.json({
          status: 'queued',
          queueType,
          queueLength
        });
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    return res.status(204).end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 