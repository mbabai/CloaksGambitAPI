const express = require('express');
const router = express.Router();
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');
const { isAdminSession } = require('../../../utils/adminAccess');
const {
  applyAuthenticatedCookies,
  resolveSessionFromRequest,
} = require('../../../utils/requestSession');
const {
  normalizeAudioVolumeInput,
  normalizeAnimationSpeedInput,
  normalizeToastNotificationsEnabledInput,
  normalizeTooltipsEnabledInput,
  resolveAudioVolume,
  resolveAnimationSpeed,
  resolveGameStartAlertVolume,
  resolveToastNotificationsEnabled,
  resolveTooltipsEnabled,
} = require('../../../utils/userPreferences');

// PATCH /v1/users/update
router.patch('/', async (req, res) => {
  try {
    const {
      userId,
      username,
      email,
      tooltipsEnabled,
      toastNotificationsEnabled,
      animationSpeed,
      audioVolume,
      gameStartAlertVolume,
    } = req.body;
    const session = await resolveSessionFromRequest(req, { createGuest: false });
    if (!session?.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }
    const adminSession = isAdminSession(session);
    const targetUserId = adminSession && userId ? userId : session.userId;
    if (!targetUserId) {
      return res.status(400).json({ message: 'userId is required' });
    }
    if (!adminSession && userId && String(userId) !== String(session.userId)) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const update = {};

    if (username !== undefined) {
      const trimmed = String(username).trim();
      if (trimmed.length < 3 || trimmed.length > 18) {
        return res.status(400).json({ message: 'Username must be between 3 and 18 characters' });
      }
      const existing = await User.findOne({ username: trimmed });
      if (existing && existing._id.toString() !== targetUserId) {
        return res.status(409).json({ message: 'Username already taken' });
      }
      update.username = trimmed;
    }

    if (email !== undefined) {
      if (!adminSession && String(targetUserId) !== String(session.userId)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      update.email = email;
    }

    if (tooltipsEnabled !== undefined) {
      const normalizedTooltipsEnabled = normalizeTooltipsEnabledInput(tooltipsEnabled);
      if (normalizedTooltipsEnabled === null) {
        return res.status(400).json({ message: 'tooltipsEnabled must be a boolean' });
      }
      update.tooltipsEnabled = normalizedTooltipsEnabled;
    }

    if (toastNotificationsEnabled !== undefined) {
      const normalizedToastNotificationsEnabled = normalizeToastNotificationsEnabledInput(toastNotificationsEnabled);
      if (normalizedToastNotificationsEnabled === null) {
        return res.status(400).json({ message: 'toastNotificationsEnabled must be a boolean' });
      }
      update.toastNotificationsEnabled = normalizedToastNotificationsEnabled;
    }

    if (animationSpeed !== undefined) {
      const normalizedAnimationSpeed = normalizeAnimationSpeedInput(animationSpeed);
      if (normalizedAnimationSpeed === null) {
        return res.status(400).json({ message: 'animationSpeed must be one of off, fast, slow' });
      }
      update.animationSpeed = normalizedAnimationSpeed;
    }

    if (audioVolume !== undefined) {
      const normalizedAudioVolume = normalizeAudioVolumeInput(audioVolume);
      if (normalizedAudioVolume === null) {
        return res.status(400).json({ message: 'audioVolume must be a number between 0 and 1' });
      }
      update.audioVolume = normalizedAudioVolume;
    }

    if (gameStartAlertVolume !== undefined) {
      const normalizedGameStartAlertVolume = normalizeAudioVolumeInput(gameStartAlertVolume);
      if (normalizedGameStartAlertVolume === null) {
        return res.status(400).json({ message: 'gameStartAlertVolume must be a number between 0 and 1' });
      }
      update.gameStartAlertVolume = normalizedGameStartAlertVolume;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ message: 'No fields to update' });
    }

    const user = await User.findByIdAndUpdate(targetUserId, update, { new: true });
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (update.username !== undefined) {
      const payload = { userId: user._id.toString(), username: user.username };
      eventBus.emit('user:updated', payload);

      if (String(user._id) === String(session.userId) && !session.isGuest) {
        try {
          applyAuthenticatedCookies(req, res, user);
        } catch (cookieErr) {
          console.warn('Failed to refresh auth cookies after username update:', cookieErr);
        }
      }
    }

    res.json({
      _id: user._id,
      username: user.username,
      elo: user.elo,
      isBot: Boolean(user.isBot),
      isGuest: Boolean(user.isGuest),
      tooltipsEnabled: resolveTooltipsEnabled(user),
      toastNotificationsEnabled: resolveToastNotificationsEnabled(user),
      animationSpeed: resolveAnimationSpeed(user),
      audioVolume: resolveAudioVolume(user),
      gameStartAlertVolume: resolveGameStartAlertVolume(user),
      email: adminSession || String(user._id) === String(session.userId) ? user.email || '' : undefined,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 
