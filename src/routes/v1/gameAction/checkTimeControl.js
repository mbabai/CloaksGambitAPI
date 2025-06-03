const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');

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

    // Helper to save game without validation when needed
    const saveGame = async (validate) => {
      await game.save({ validateBeforeSave: validate });
    };

    if (!setup0 || !setup1) {
      if (elapsed > timeControl) {
        const winReason = config.winReasons.get('TIME_CONTROL');
        const endTime = new Date(game.startTime.getTime() + timeControl);
        game.winReason = winReason;
        game.endTime = endTime;
        game.isActive = false;

        if (!setup0 && !setup1) {
          // Draw scenario - no winner field stored
          await saveGame(false);
          return res.json({ gameOver: true, draw: true });
        }

        game.winner = setup0 ? 0 : 1;
        await saveGame(true);
        return res.json({ gameOver: true, winner: game.winner });
      }

      return res.json({ gameOver: false });
    }

    // Setup complete - check current player's clock
    const turnPlayer = game.playerTurn;
    const actionsCount = game.actions.filter(a => a.player === turnPlayer).length;
    if (elapsed + actionsCount * increment > timeControl) {
      const winReason = config.winReasons.get('TIME_CONTROL');
      const endTimeMs = game.startTime.getTime() + timeControl - actionsCount * increment;
      game.winReason = winReason;
      game.winner = turnPlayer === 0 ? 1 : 0;
      game.endTime = new Date(endTimeMs);
      game.isActive = false;
      await saveGame(true);

      return res.json({ gameOver: true, winner: game.winner });
    }

    return res.json({ gameOver: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 