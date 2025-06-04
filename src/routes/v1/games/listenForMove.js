const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const maskGameForColor = require('../../../utils/gameView');

const POLL_INTERVAL = 1000; // 1 second
const TIMEOUT = 30000; // 30 seconds

router.post('/', async (req, res) => {
  try {
    const { gameId, color, lastAction } = req.body;
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

    const start = Date.now();
    while (Date.now() - start < TIMEOUT) {
      const game = await Game.findById(gameId).lean();
      if (!game) {
        return res.status(404).json({ message: 'Game not found' });
      }

      const actions = Array.isArray(game.actions) ? game.actions : [];
      let found = false;

      if (lastAction !== undefined && lastAction !== null) {
        const idx = parseInt(lastAction, 10);
        if (!isNaN(idx)) {
          for (let i = idx + 1; i < actions.length; i++) {
            const a = actions[i];
            if (isAdmin || isSpectator ? true : a.player !== viewColor) {
              found = true;
              break;
            }
          }
        } else {
          const ts = new Date(lastAction);
          if (!isNaN(ts.getTime())) {
            found = actions.some(a =>
              new Date(a.timestamp) > ts && (isAdmin || isSpectator ? true : a.player !== viewColor)
            );
          }
        }
      }

      if (found) {
        const masked = maskGameForColor(game, normalized);
        return res.json(masked);
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    return res.status(204).end();
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
