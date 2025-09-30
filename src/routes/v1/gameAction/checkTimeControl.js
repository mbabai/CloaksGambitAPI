const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');

function resolveStartTimeMs(game) {
  if (!game) return null;

  const candidates = [game.startTime, game.createdAt];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = new Date(candidate).getTime();
    if (Number.isFinite(ms)) {
      return ms;
    }
  }

  return null;
}

function calculateElapsedMs(game, now = Date.now()) {
  const startTimeMs = resolveStartTimeMs(game);
  if (!Number.isFinite(startTimeMs)) {
    return 0;
  }
  return Math.max(0, now - startTimeMs);
}

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
    const timeControl = game.timeControlStart;
    const increment = game.increment;
    const winReason = config.winReasons.get('TIME_CONTROL');
    const now = Date.now();
    const elapsed = calculateElapsedMs(game, now);

    const setup0 = game.setupComplete[0];
    const setup1 = game.setupComplete[1];

    if (!setup0 || !setup1) {
      if (elapsed > timeControl) {
        if (!setup0 && !setup1) {
          await game.endGame(null, winReason);
          eventBus.emit('gameChanged', {
            game: typeof game.toObject === 'function' ? game.toObject() : game,
            affectedUsers: (game.players || []).map(p => p.toString()),
          });
          return res.json({ gameOver: true, draw: true, winReason });
        }

        const winnerColor = setup0 ? 0 : 1;
        await game.endGame(winnerColor, winReason);
        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: (game.players || []).map(p => p.toString()),
        });
        return res.json({ gameOver: true, winner: winnerColor, winReason });
      }

      return res.json({ gameOver: false });
    }

    // Setup complete - check current player's clock
    const turnPlayer = game.playerTurn;
    const actionsCount = game.actions.filter(a => a.player === turnPlayer).length;
    if (elapsed + actionsCount * increment > timeControl) {
      const winnerColor = turnPlayer === 0 ? 1 : 0;
      await game.endGame(winnerColor, winReason);
      eventBus.emit('gameChanged', {
        game: typeof game.toObject === 'function' ? game.toObject() : game,
        affectedUsers: (game.players || []).map(p => p.toString()),
      });
      return res.json({ gameOver: true, winner: winnerColor, winReason });
    }

    return res.json({ gameOver: false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
module.exports._private = {
  resolveStartTimeMs,
  calculateElapsedMs,
};
