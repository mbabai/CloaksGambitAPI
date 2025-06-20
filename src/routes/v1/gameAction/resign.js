const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    
    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // Validate color
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    // Check if game is still active
    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is already ended' });
    }

    const config = new ServerConfig();
    
    // Set winner as the other color
    const winner = normalizedColor === 0 ? 1 : 0;
    
    // End the game with resign reason
    await game.endGame(winner, config.winReasons.get('RESIGN'));
    
    // Add resign action to game history
    await game.addAction(
      config.actions.get('RESIGN'),
      normalizedColor,
      {}
    );

    res.json({ message: 'Game resigned successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 