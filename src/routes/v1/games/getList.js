const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');

router.post('/', async (req, res) => {
  try {
    const { userId, status } = req.body;
    
    const query = {};
    if (userId) {
      query.$or = [
        { 'players.0': userId },
        { 'players.1': userId }
      ];
    }
    if (status) {
      query.isActive = status === 'active';
    }

    const games = await Game.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(games);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 