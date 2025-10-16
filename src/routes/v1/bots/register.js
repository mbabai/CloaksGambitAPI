const express = require('express');
const router = express.Router();
const { ensureBotUser, normalizeDifficulty } = require('../../../services/bots/registry');

function verifySecret(req) {
  const requiredSecret = process.env.BOT_SERVICE_SECRET;
  if (!requiredSecret) return true;
  const provided = req.headers['x-bot-secret'] || req.headers['x-bot-service'];
  if (!provided) return false;
  return provided === requiredSecret;
}

router.post('/', async (req, res) => {
  try {
    console.log('[bot-service] registration request', {
      difficulty: req.body?.difficulty,
      hasSecret: Boolean(req.headers['x-bot-secret'] || req.headers['x-bot-service']),
    });
    if (!verifySecret(req)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const difficulty = normalizeDifficulty(req.body?.difficulty || 'easy');
    const { user, token } = await ensureBotUser(difficulty);
    console.log('[bot-service] registration success', {
      userId: user._id?.toString?.() || user.id?.toString?.(),
      username: user.username,
      difficulty,
    });
    return res.json({
      userId: user._id?.toString() || user.id?.toString(),
      username: user.username,
      difficulty,
      token,
    });
  } catch (err) {
    console.error('Failed to register bot client:', err);
    return res.status(500).json({ message: err.message || 'Failed to register bot client' });
  }
});

module.exports = router;
