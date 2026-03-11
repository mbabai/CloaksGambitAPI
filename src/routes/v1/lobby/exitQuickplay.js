const express = require('express');
const router = express.Router();
const eventBus = require('../../../eventBus');
const { resolveLobbySession } = require('../../../utils/lobbyAccess');
const lobbyStore = require('../../../state/lobby');

router.post('/', async (req, res) => {
  try {
    const userInfo = await resolveLobbySession(req, res);
    if (!userInfo) return;
    const userId = userInfo.userId;

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
