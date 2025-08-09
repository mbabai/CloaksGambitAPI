const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const eventBus = require('../../../eventBus');

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

    eventBus.emit('queueChanged', {
      quickplayQueue: lobby.quickplayQueue.map(id => id.toString()),
      rankedQueue: lobby.rankedQueue.map(id => id.toString()),
      affectedUsers: [userId.toString()],
    });

    res.json({ message: 'Exited ranked queue' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
