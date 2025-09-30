const express = require('express');
const router = express.Router();
const eventBus = require('../../../eventBus');
const ensureUser = require('../../../utils/ensureUser');
const { resolveUserFromRequest } = require('../../../utils/authTokens');
const {
  ensureLobby,
  removeUserFromQueue,
  snapshotQueues,
} = require('../../../utils/lobbyState');

router.post('/', async (req, res) => {
  try {
    let { userId } = req.body || {};
    let userInfo = await resolveUserFromRequest(req);

    if (userInfo && userInfo.userId) {
      userId = userInfo.userId;
    } else {
      if (!userId) {
        userInfo = await ensureUser();
      } else {
        userInfo = await ensureUser(userId);
      }

      userId = userInfo.userId;
    }

    const lobby = ensureLobby();

    removeUserFromQueue(lobby.quickplayQueue, userId);

    const snapshot = snapshotQueues();
    eventBus.emit('queueChanged', {
      ...snapshot,
      affectedUsers: [userId.toString()],
    });

    res.json({ message: 'Exited quickplay queue', userId, username: userInfo.username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
