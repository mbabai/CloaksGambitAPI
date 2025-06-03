const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');

router.post('/', async (req, res) => {
  try {
    const { userId, status } = req.body;

    const query = {};
    if (userId) {
      query.$or = [
        { player1: userId },
        { player2: userId }
      ];
    }

    if (status) {
      query.isActive = status === 'active';
    }

    const matches = await Match.find(query)
      .sort({ startTime: -1 })
      .limit(50)
      .lean();

    res.json(matches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 
