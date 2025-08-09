const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const { gameId } = req.body;
    const game = await Game.findById(gameId);

    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // If game already ended just report true
    if (!game.isActive) {
      return res.json({ gameOver: true });
    }

    const config = new ServerConfig();
    const timeControl = game.timeControlStart;
    const increment = game.increment;
    const now = Date.now();
    const elapsed = now - new Date(game.startTime).getTime();

    const setup0 = game.setupComplete[0];
    const setup1 = game.setupComplete[1];

    if (!setup0 || !setup1) {
      if (elapsed > timeControl) {
        if (!setup0 && !setup1) {
          await game.endGame(null, config.winReasons.get('TIME_CONTROL'));
          eventBus.emit('gameChanged', {
            game: typeof game.toObject === 'function' ? game.toObject() : game,
            affectedUsers: (game.players || []).map(p => p.toString()),
          });
          return res.json({ gameOver: true, draw: true });
        }

        const winnerColor = setup0 ? 0 : 1;
        await game.endGame(winnerColor, config.winReasons.get('TIME_CONTROL'));
        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: (game.players || []).map(p => p.toString()),
        });
        return res.json({ gameOver: true, winner: winnerColor });
      }

      return res.json({ gameOver: false });
    }

    // Setup complete - check current player's clock
    const turnPlayer = game.playerTurn;
    const actionsCount = game.actions.filter(a => a.player === turnPlayer).length;
    if (elapsed + actionsCount * increment > timeControl) {
      const winnerColor = turnPlayer === 0 ? 1 : 0;
      await game.endGame(winnerColor, config.winReasons.get('TIME_CONTROL'));
      eventBus.emit('gameChanged', {
        game: typeof game.toObject === 'function' ? game.toObject() : game,
        affectedUsers: (game.players || []).map(p => p.toString()),
      });
      return res.json({ gameOver: true, winner: winnerColor });
    }

    return res.json({ gameOver: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 