const express = require('express');
const router = express.Router();
const lobbyStore = require('../../../state/lobby');

router.post('/', async (req, res) => {
  try {
    res.json(lobbyStore.getState());
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
