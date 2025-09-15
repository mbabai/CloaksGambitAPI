const express = require('express');
const router = express.Router();
const User = require('../../../models/User');

// PATCH /v1/users/update
router.patch('/', async (req, res) => {
  try {
    const { userId, username, email } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const update = {};

    if (username !== undefined) {
      const trimmed = String(username).trim();
      if (trimmed.length < 3 || trimmed.length > 18) {
        return res.status(400).json({ message: 'Username must be between 3 and 18 characters' });
      }
      const existing = await User.findOne({ username: trimmed });
      if (existing && existing._id.toString() !== userId) {
        return res.status(409).json({ message: 'Username already taken' });
      }
      update.username = trimmed;
    }

    if (email) update.email = email;

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const user = await User.findByIdAndUpdate(userId, update, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 