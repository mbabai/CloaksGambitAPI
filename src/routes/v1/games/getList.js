const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Game = require('../../../models/Game');

router.post('/', async (req, res) => {
  try {
    const { userId, status } = req.body;

    const normalizedStatus = typeof status === 'string'
      ? status.trim().toLowerCase()
      : 'completed';

    const query = {};
    if (normalizedStatus === 'active') {
      query.isActive = true;
    } else if (normalizedStatus === 'all') {
      // include both active and completed games
    } else {
      query.isActive = false;
    }

    if (userId) {
      const values = [userId];
      if (mongoose.Types.ObjectId.isValid(userId)) {
        values.push(new mongoose.Types.ObjectId(userId));
      }
      query.players = { $in: values };
    }

    const sort = query.isActive === false
      ? { endTime: -1, startTime: -1, createdAt: -1 }
      : { createdAt: -1 };

    const games = await Game.find(query)
      .sort(sort)
      .limit(50)
      .lean();

    res.json(games);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 