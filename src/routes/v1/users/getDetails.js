const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../../../models/User');
const { isAdminSession } = require('../../../utils/adminAccess');
const { resolveSessionFromRequest } = require('../../../utils/requestSession');

function buildUnavailableUserProfile(userId) {
  return {
    _id: userId,
    userId,
    username: 'Unavailable Player',
    elo: null,
    isBot: false,
    isGuest: true,
    photoUrl: '',
    missing: true,
  };
}

router.post('/', async (req, res) => {
  try {
    const rawUserId = typeof req.body?.userId === 'string'
      ? req.body.userId.trim()
      : String(req.body?.userId || '').trim();

    if (!rawUserId) {
      return res.status(400).json({ message: 'Missing userId' });
    }
    if (!mongoose.Types.ObjectId.isValid(rawUserId)) {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    const user = await User.findById(rawUserId).lean();
    if (!user) {
      return res.json(buildUnavailableUserProfile(rawUserId));
    }

    const session = await resolveSessionFromRequest(req, { createGuest: false });
    const adminSession = isAdminSession(session);
    const isSelf = session?.userId && String(session.userId) === String(user._id);

    res.json({
      _id: user._id,
      userId: user._id.toString(),
      username: user.username,
      elo: user.elo,
      isBot: Boolean(user.isBot),
      isGuest: Boolean(user.isGuest),
      photoUrl: user.photoUrl || '',
      email: adminSession || isSelf ? (user.email || '') : undefined,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 
