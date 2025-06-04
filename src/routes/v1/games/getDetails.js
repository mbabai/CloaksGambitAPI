const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const maskGameForColor = require('../../../utils/gameView');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const normalized = String(color).toLowerCase();

    let viewColor;
    const isAdmin = normalized === 'admin';
    const isSpectator = normalized === 'spectator';

    if (!isAdmin && !isSpectator) {
      viewColor = parseInt(normalized, 10);
      if (viewColor !== 0 && viewColor !== 1) {
        return res.status(400).json({ message: 'Invalid color' });
      }
    }

    const game = await Game.findById(gameId).lean();
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // Do not mask anything for admin view
    if (isAdmin) {
      return res.json(game);
    }

    const masked = maskGameForColor(game, normalized);
    res.json(masked);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 