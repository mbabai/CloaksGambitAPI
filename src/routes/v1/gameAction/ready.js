const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    if (game.playersReady[normalizedColor]) {
      return res.status(400).json({ message: 'Player already ready' });
    }

    const config = new ServerConfig();

    game.playersReady[normalizedColor] = true;
    await game.addAction(config.actions.get('READY'), normalizedColor, {});

    if (game.playersReady[0] && game.playersReady[1] && !game.startTime) {
      game.startTime = new Date();
    }

    await game.save();

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
    });

    res.json({ message: 'Player marked ready' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
