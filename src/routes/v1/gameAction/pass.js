const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const { requireGamePlayerContext } = require('../../../utils/gameAccess');
const {
  ensureStoredClockState,
  transitionStoredClockState,
  summarizeClockState,
} = require('../../../utils/gameClock');
const { appendLocalDebugLog } = require('../../../utils/localDebugLogger');
const {
  getLastAction,
  getLastMove,
  isPendingMove,
} = require('../../../services/game/liveGameRules');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const context = await requireGamePlayerContext(req, res, { gameId, color });
    if (!context) return;
    const { game, color: normalizedColor } = context;

    const config = await getServerConfig();
    const now = Date.now();
    ensureStoredClockState(game, {
      now,
      setupActionType: config.actions.get('SETUP'),
    });
    appendLocalDebugLog('clock-route-entry', {
      route: 'pass',
      gameId,
      color: normalizedColor,
      playerTurn: game.playerTurn,
      clockState: summarizeClockState(game.clockState),
    });

    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is not active' });
    }

    if (game.playerTurn !== normalizedColor) {
      return res.status(400).json({ message: "Not this player's turn" });
    }

    const lastAction = getLastAction(game);
    if (!lastAction || lastAction.type !== config.actions.get('BOMB')) {
      return res.status(400).json({ message: 'Last action was not a bomb' });
    }

    const lastMove = getLastMove(game);
    if (!lastMove) {
      return res.status(400).json({ message: 'No move to resolve' });
    }
    if (!isPendingMove(lastMove, config)) {
      return res.status(400).json({ message: 'No pending move to resolve' });
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

    transitionStoredClockState(game, {
      actingColor: normalizedColor,
      now,
      setupActionType: config.actions.get('SETUP'),
      reason: 'pass',
    });

    await game.addAction(config.actions.get('PASS'), normalizedColor, {});
    game.movesSinceAction = 0;

    if (piece.identity === config.identities.get('KING') && game.isActive) {
      await game.endGame(normalizedColor === 0 ? 1 : 0, config.winReasons.get('CAPTURED_KING'));
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
