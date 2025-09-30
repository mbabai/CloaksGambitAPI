const express = require('express');
const router = express.Router();
const eventBus = require('../../../eventBus');
const ensureUser = require('../../../utils/ensureUser');
const { resolveUserFromRequest } = require('../../../utils/authTokens');
const lobbyStore = require('../../../state/lobby');

router.post('/', async (req, res) => {
  try {
    let { userId } = req.body || {};
    let userInfo = await resolveUserFromRequest(req);

    if (userInfo && userInfo.userId) {
      userId = userInfo.userId;
    } else {
      userInfo = await ensureUser(userId);
      userId = userInfo.userId;
    }

    const { removed, state } = lobbyStore.removeFromQueue('quickplay', userId);
    if (removed) {
      eventBus.emit('queueChanged', {
        quickplayQueue: state.quickplayQueue,
        rankedQueue: state.rankedQueue,
        affectedUsers: [userId.toString()],
      });
    }

    res.json({ message: 'Exited quickplay queue', userId, username: userInfo.username });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
