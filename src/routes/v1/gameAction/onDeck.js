const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');

router.post('/', async (req, res) => {
  try {
    const { gameId, color, piece } = req.body;

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const config = new ServerConfig();
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is not active' });
    }

    if (game.playerTurn !== normalizedColor) {
      return res.status(400).json({ message: "Not this player's turn" });
    }

    if (game.onDeckingPlayer !== normalizedColor) {
      return res.status(400).json({ message: 'Not the on-decking player' });
    }

    if (!piece || piece.identity === undefined) {
      return res.status(400).json({ message: 'Invalid piece data' });
    }

    const identity = parseInt(piece.identity, 10);
    const stash = game.stashes[normalizedColor];
    const index = stash.findIndex(
      (p) => p.identity === identity && p.color === normalizedColor
    );
    if (index === -1) {
      return res
        .status(400)
        .json({ message: 'Selected piece not available in stash' });
    }

    const selectedPiece = stash.splice(index, 1)[0];
    game.onDecks[normalizedColor] = selectedPiece;
    game.onDeckingPlayer = null;

    if (game.moves.length > 0) {
      const lastMove = game.moves[game.moves.length - 1];
      lastMove.state = config.moveStates.get('RESOLVED');
      game.playerTurn = lastMove.player === 0 ? 1 : 0;
    }

    game.actions.push({
      type: config.actions.get('ON_DECK'),
      player: normalizedColor,
      details: { identity },
      timestamp: new Date(),
    });

    await game.save();

    res.json({ message: 'Piece placed on deck' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 