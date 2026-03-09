const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const {
  resolveStartTimeMs,
  calculateElapsedMs,
  computeGameClockState,
} = require('../../../utils/gameClock');

function resolveTimeoutResult(game, { now = Date.now(), setupActionType } = {}) {
  const baseTime = Number(game?.timeControlStart);
  if (!Number.isFinite(baseTime) || baseTime <= 0) {
    return { expired: false, winner: null, draw: false, clock: null };
  }

  const increment = Number(game?.increment);
  const computed = computeGameClockState({
    baseTime,
    increment: Number.isFinite(increment) && increment >= 0 ? increment : 0,
    startTime: resolveStartTimeMs(game),
    endTime: game?.endTime,
    actions: game?.actions,
    setupComplete: game?.setupComplete,
    playerTurn: game?.playerTurn,
    isActive: Boolean(game?.isActive),
    now,
    setupActionType,
  });

  const whiteExpired = computed.whiteMs <= 0;
  const blackExpired = computed.blackMs <= 0;

  if (!whiteExpired && !blackExpired) {
    return {
      expired: false,
      winner: null,
      draw: false,
      clock: computed,
    };
  }

  if (whiteExpired && blackExpired) {
    return {
      expired: true,
      winner: null,
      draw: true,
      clock: computed,
    };
  }

  return {
    expired: true,
    winner: whiteExpired ? 1 : 0,
    draw: false,
    clock: computed,
  };
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
    const winReason = config.winReasons.get('TIME_CONTROL');
    const now = Date.now();
    const timeout = resolveTimeoutResult(game, {
      now,
      setupActionType: config.actions.get('SETUP'),
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
