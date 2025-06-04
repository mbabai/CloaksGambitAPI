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
    if (username) update.username = username;
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