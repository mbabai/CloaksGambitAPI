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
      lobby = await Lobby.create({ quickplayQueue: [], rankedQueue: [], inGame: [] });
    }

    // Check if user is already in a game
    if (lobby.inGame.some(id => id.toString() === userId)) {
      return res.status(400).json({ message: 'User is already in a game' });
    }

    if (lobby.rankedQueue.some(id => id.toString() === userId)) {
      return res.status(400).json({ message: 'User already in ranked queue' });
    }
    if (lobby.quickplayQueue.some(id => id.toString() === userId)) {
      return res
        .status(400)
        .json({ message: 'User already in quickplay queue' });
    }

    lobby.rankedQueue.push(userId);
    await lobby.save();

    res.json({ message: 'Entered ranked queue' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
