const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
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

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

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

    const config = await getServerConfig();
    const now = Date.now();
    ensureStoredClockState(game, {
      now,
      setupActionType: config.actions.get('SETUP'),
    });
    appendLocalDebugLog('clock-route-entry', {
      route: 'bomb',
      gameId,
      color: normalizedColor,
      playerTurn: game.playerTurn,
      clockState: summarizeClockState(game.clockState),
    });
    const lastAction = getLastAction(game);
    if (!lastAction || lastAction.type !== config.actions.get('MOVE')) {
      return res.status(400).json({ message: 'Last action was not a move' });
    }

    const lastMove = getLastMove(game);
    if (!lastMove) {
      return res.status(400).json({ message: 'No move to bomb' });
    }
    if (!isPendingMove(lastMove, config)) {
      return res.status(400).json({ message: 'No pending move to bomb' });
    }

    const { to } = lastMove;
    const pieceAtTarget = game.board[to.row][to.col];
    if (!pieceAtTarget || pieceAtTarget.color !== normalizedColor) {
      return res.status(400).json({ message: 'No controllable piece at target' });
    }

    if (lastMove.declaration === config.identities.get('KING')) {
      return res.status(400).json({ message: 'Cannot bomb a declared king move' });
    }

    await game.addAction(config.actions.get('BOMB'), normalizedColor, {});
    // Bomb does not alter the inactivity counter

    // Flip the turn to the other player
    game.playerTurn = normalizedColor === 0 ? 1 : 0;

    transitionStoredClockState(game, {
      actingColor: normalizedColor,
      now,
      setupActionType: config.actions.get('SETUP'),
      reason: 'bomb',
    });

    await game.save();

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
    });

    res.json({ message: 'Bomb action recorded' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
