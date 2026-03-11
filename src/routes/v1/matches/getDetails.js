const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const { resolveMatchViewerContext } = require('../../../utils/gameAccess');

router.post('/', async (req, res) => {
  try {
    const { matchId } = req.body;

    if (!matchId) {
      return res.status(400).json({ message: 'matchId is required' });
    }

    const match = await Match.findById(matchId)
      .populate({ path: 'games', select: '_id isActive winner winReason createdAt startTime endTime players' })
      .populate({ path: 'player1', select: '_id username elo isBot' })
      .populate({ path: 'player2', select: '_id username elo isBot' })
      .populate({ path: 'winner', select: '_id username elo isBot' })
      .lean();

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    const viewer = await resolveMatchViewerContext(req, match);
    if (viewer.role === 'spectator') {
      return res.status(403).json({ message: 'Forbidden' });
    }

    res.json(match);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 
