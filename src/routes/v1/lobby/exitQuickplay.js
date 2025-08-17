const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const eventBus = require('../../../eventBus');
const mongoose = require('mongoose');

router.post('/', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) {
      return res.status(400).json({ message: 'User ID required' });
    }
    if (!mongoose.isValidObjectId(userId)) {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    let lobby = await Lobby.findOne();
    if (!lobby) {
      lobby = await Lobby.create({ quickplayQueue: [], rankedQueue: [] });
    }

    lobby.quickplayQueue = lobby.quickplayQueue.filter(id => id.toString() !== userId);
    await lobby.save();

    eventBus.emit('queueChanged', {
      quickplayQueue: lobby.quickplayQueue.map(id => id.toString()),
      rankedQueue: lobby.rankedQueue.map(id => id.toString()),
      affectedUsers: [userId.toString()],
    });

    res.json({ message: 'Exited quickplay queue' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
