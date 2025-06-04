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
      // Check for matches first
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
        }).sort({ createdAt: -1 }).populate('games').lean();

        if (match) {
          // Refetch the match to ensure games array is up-to-date
          const freshMatch = await Match.findById(match._id).populate('games').lean();
          const lastGameId = freshMatch.games && freshMatch.games.length > 0
            ? (freshMatch.games[freshMatch.games.length - 1]._id || freshMatch.games[freshMatch.games.length - 1])
            : null;
          if (lastGameId) {
            return res.json({
              status: 'matched',
              matchId: freshMatch._id,
              gameId: lastGameId,
              type: freshMatch.type
            });
          } else {
            // No game yet, tell client to keep polling
            return res.json({
              status: 'waiting_for_game',
              matchId: freshMatch._id,
              type: freshMatch.type
            });
          }
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

      // If user is not in any queue or game, they need to re-enter queue
      return res.status(400).json({ message: 'User not in queue' });
    }

    // If we timeout, return 204 to indicate no change
    return res.status(204).end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 