const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');

router.post('/', async (req, res) => {
  try {
    const { matchId } = req.body;

    if (!matchId) {
      return res.status(400).json({ message: 'matchId is required' });
    }

    const match = await Match.findById(matchId)
      .populate('games')
      .populate('player1')
      .populate('player2')
      .populate('winner')
      .lean();

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    res.json(match);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 