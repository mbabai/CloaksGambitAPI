const express = require('express');
const router = express.Router();
const User = require('../../../models/User');

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

router.post('/', async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string'
      ? req.body.username.trim()
      : '';

    if (!username) {
      return res.status(400).json({ message: 'Missing username' });
    }

    const user = await User.findOne({
      username: new RegExp(`^${escapeRegex(username)}$`, 'i')
    })
      .select('_id username elo isBot')
      .lean();

    if (!user || user.isBot) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      userId: user._id.toString(),
      username: user.username || username,
      elo: Number.isFinite(user.elo) ? user.elo : null,
      isBot: Boolean(user.isBot),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
