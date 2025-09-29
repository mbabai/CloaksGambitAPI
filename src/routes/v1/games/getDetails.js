const express = require('express');
const router = express.Router();
const maskGameForColor = require('../../../utils/gameView');
const Game = require('../../../models/Game');
const { games } = require('../../../state');

function cloneGame(game) {
  if (!game) return null;
  if (typeof game.toObject === 'function') {
    return game.toObject({ depopulate: false });
  }
  try {
    return JSON.parse(JSON.stringify(game));
  } catch (err) {
    return { ...game };
  }
}

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

    const memoryGame = games.get(String(gameId));
    const isActive = Boolean(memoryGame?.isActive);
    const sourceGame = isActive ? cloneGame(memoryGame) : await Game.findById(gameId).lean();

    if (!sourceGame) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // Do not mask anything for admin view
    if (isAdmin) {
      return res.json(sourceGame);
    }

    const masked = maskGameForColor(cloneGame(sourceGame), normalized);
    res.json(masked);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 