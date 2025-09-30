const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Match = require('../../../models/Match');

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
      // No status filter so we include both active and completed matches
    } else {
      // Default to completed/history matches which are stored in MongoDB
      query.isActive = false;
    }

    if (userId) {
      const values = [userId];
      if (mongoose.Types.ObjectId.isValid(userId)) {
        values.push(new mongoose.Types.ObjectId(userId));
      }
      query.$or = [
        { player1: { $in: values } },
        { player2: { $in: values } },
      ];
    }

    const sort = query.isActive === false
      ? { endTime: -1, startTime: -1 }
      : { startTime: -1 };

    const matches = await Match.find(query)
      .sort(sort)
      .limit(50)
      .lean();

    res.json(matches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 
