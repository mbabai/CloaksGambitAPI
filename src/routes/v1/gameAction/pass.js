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

    const lastAction = game.actions[game.actions.length - 1];
    if (!lastAction || lastAction.type !== config.actions.get('BOMB')) {
      return res.status(400).json({ message: 'Last action was not a bomb' });
    }

    const lastMove = game.moves[game.moves.length - 1];
    if (!lastMove) {
      return res.status(400).json({ message: 'No move to resolve' });
    }

    const { from } = lastMove;
    const piece = game.board[from.row][from.col];
    if (!piece) {
      return res.status(400).json({ message: 'No piece to capture' });
    }

    game.captured[normalizedColor].push(piece);
    game.board[from.row][from.col] = null;

    game.playerTurn = normalizedColor === 0 ? 1 : 0;

    lastMove.state = config.moveStates.get('RESOLVED');

    await game.addAction(config.actions.get('PASS'), normalizedColor, {});
    game.movesSinceAction = 0;

    if (piece.identity === config.identities.get('KING') && game.isActive) {
      await game.endGame(normalizedColor, config.winReasons.get('CAPTURED_KING'));
      // Check if game ended and return early
      if (!game.isActive) {
        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: (game.players || []).map(p => p.toString()),
        });
        return res.json({ message: 'Game ended: King captured' });
      }
    }

    await game.save();

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
    });

    res.json({ message: 'Pass recorded' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
