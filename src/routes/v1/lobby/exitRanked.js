const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const eventBus = require('../../../eventBus');
const mongoose = require('mongoose');
const ensureUser = require('../../../utils/ensureUser');
const { resolveUserFromRequest } = require('../../../utils/authTokens');

router.post('/', async (req, res) => {
  try {
    let { userId } = req.body || {};
    let userInfo = await resolveUserFromRequest(req);

    if (userInfo && userInfo.userId) {
      userId = userInfo.userId;
    } else {
      if (!userId || !mongoose.isValidObjectId(userId)) {
        userInfo = await ensureUser();
      } else {
        userInfo = await ensureUser(userId);
      }

      userId = userInfo.userId;
    }

    let lobby = await Lobby.findOne();
    if (!lobby) {
      lobby = await Lobby.create({ quickplayQueue: [], rankedQueue: [], inGame: [] });
    }

    lobby.rankedQueue = lobby.rankedQueue.filter(
      (id) => id.toString() !== userId
    );
    await lobby.save();

    eventBus.emit('queueChanged', {
      quickplayQueue: lobby.quickplayQueue.map(id => id.toString()),
      rankedQueue: lobby.rankedQueue.map(id => id.toString()),
      affectedUsers: [userId.toString()],
    });

    res.json({ message: 'Exited ranked queue', userId, username: userInfo.username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
