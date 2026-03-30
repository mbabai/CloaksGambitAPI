const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const { appendLocalDebugLog } = require('../../../utils/localDebugLogger');
const {
  resolveStartTimeMs,
  calculateElapsedMs,
  resolveTimeoutResult,
} = require('../../../utils/gameClock');

router.post('/', async (req, res) => {
  try {
    const { gameId } = req.body;
    const game = await Game.findById(gameId);

    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // If game already ended just report true
    if (!game.isActive) {
      return res.json({
        gameOver: true,
        winner: game.winner,
        draw: game.winner == null,
        winReason: game.winReason,
      });
    }

    const config = await getServerConfig();
    const winReason = config.winReasons.get('TIME_CONTROL');
    const now = Date.now();
    const timeout = resolveTimeoutResult(game, {
      now,
      setupActionType: config.actions.get('SETUP'),
    });
    appendLocalDebugLog('timeout-check', {
      gameId,
      now,
      playerTurn: game.playerTurn,
      setupComplete: game.setupComplete,
      result: timeout,
    });

    if (!timeout.expired) {
      return res.json({ gameOver: false });
    }

    await game.endGame(timeout.winner, winReason);
    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map((p) => p.toString()),
    });

    if (timeout.draw) {
      return res.json({ gameOver: true, draw: true, winReason });
    }

    return res.json({ gameOver: true, winner: timeout.winner, winReason });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
module.exports._private = {
  resolveStartTimeMs,
  calculateElapsedMs,
  resolveTimeoutResult,
};
