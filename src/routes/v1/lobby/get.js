const express = require('express');
const router = express.Router();
const lobbyStore = require('../../../state/lobby');
const { ensureAdminRequest } = require('../../../utils/adminAccess');

router.post('/', async (req, res) => {
  try {
    const adminSession = await ensureAdminRequest(req, res);
    if (!adminSession) return;
    res.json(lobbyStore.getState());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
