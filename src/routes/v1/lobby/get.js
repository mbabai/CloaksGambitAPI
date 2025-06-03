const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');

router.post('/', async (req, res) => {
  try {
    let lobby = await Lobby.findOne().lean();
    if (!lobby) {
      lobby = await Lobby.create({ quickplayQueue: [], rankedQueue: [] });
      lobby = lobby.toObject();
    }
    res.json(lobby);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
