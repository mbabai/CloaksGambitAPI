const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');

router.post('/', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }

    let lobby = await Lobby.findOne();
    if (!lobby) {
      lobby = await Lobby.create({ quickplayQueue: [], rankedQueue: [] });
    }

    lobby.rankedQueue = lobby.rankedQueue.filter(
      (id) => id.toString() !== userId
    );
    await lobby.save();

    res.json({ message: 'Exited ranked queue' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
