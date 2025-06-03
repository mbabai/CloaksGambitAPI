const express = require('express');
const router = express.Router();
const Game = require('../models/Game');
const ServerConfig = require('../models/ServerConfig');

// Get a game from the perspective of a color
router.get('/:id/color/:color', async (req, res) => {
  try {
    const { id, color } = req.params;
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

    const game = await Game.findById(id).lean();
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // Do not mask anything for admin view
    if (isAdmin) {
      return res.json(game);
    }

    const config = new ServerConfig();
    const unknown = config.identities.get('UNKNOWN');

    const maskPiece = (piece) => {
      if (!piece) return piece;
      if (isSpectator) {
        return { ...piece, identity: unknown };
      }
      if (piece.color !== viewColor) {
        return { ...piece, identity: unknown };
      }
      return piece;
    };

    if (Array.isArray(game.board)) {
      game.board = game.board.map((row) => row.map(maskPiece));
    }
    if (Array.isArray(game.stashes)) {
      game.stashes = game.stashes.map((stash) => stash.map(maskPiece));
    }
    if (Array.isArray(game.onDecks)) {
      game.onDecks = game.onDecks.map(maskPiece);
    }
    // Captured pieces remain unchanged

    res.json(game);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
