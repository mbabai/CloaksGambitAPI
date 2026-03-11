const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const DEBUG_GAME_ACTIONS = process.env.DEBUG_GAME_ACTIONS === 'true';
const debugLog = (...args) => { if (DEBUG_GAME_ACTIONS) console.log(...args); };
const { requireGamePlayerContext } = require('../../../utils/gameAccess');
const { emitGameChanged } = require('../../../utils/gameRouteEvents');
const {
  ensureStoredClockState,
  transitionStoredClockState,
  summarizeClockState,
} = require('../../../utils/gameClock');
const { appendLocalDebugLog } = require('../../../utils/localDebugLogger');

router.post('/', async (req, res) => {
  try {
    const { gameId, color, piece } = req.body;
    const context = await requireGamePlayerContext(req, res, { gameId, color });
    if (!context) return;
    const { game, color: normalizedColor, requesterDetails } = context;
    debugLog('[gameAction:onDeck] incoming request', {
      gameId,
      color: normalizedColor,
      identity: piece?.identity,
      ...requesterDetails,
    });

    const config = await getServerConfig();
    const now = Date.now();

    ensureStoredClockState(game, {
      now,
      setupActionType: config.actions.get('SETUP'),
    });
    appendLocalDebugLog('clock-route-entry', {
      route: 'onDeck',
      gameId,
      color: normalizedColor,
      playerTurn: game.playerTurn,
      onDeckingPlayer: game.onDeckingPlayer,
      clockState: summarizeClockState(game.clockState),
    });

    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is not active' });
    }

    // Add debugging information
    debugLog('On-deck request debug:', {
      requestedColor: normalizedColor,
      gamePlayerTurn: game.playerTurn,
      gameOnDeckingPlayer: game.onDeckingPlayer,
      isPlayerTurn: game.playerTurn === normalizedColor,
      isOnDeckingPlayer: game.onDeckingPlayer === normalizedColor
    });

    if (game.playerTurn !== normalizedColor && game.onDeckingPlayer !== normalizedColor) {
      return res.status(400).json({ 
        message: "Not this player's turn",
        debug: {
          requestedColor: normalizedColor,
          gamePlayerTurn: game.playerTurn,
          gameOnDeckingPlayer: game.onDeckingPlayer
        }
      });
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

    transitionStoredClockState(game, {
      actingColor: normalizedColor,
      now,
      setupActionType: config.actions.get('SETUP'),
      reason: 'onDeck',
    });

    game.actions.push({
      type: config.actions.get('ON_DECK'),
      player: normalizedColor,
      details: { identity },
      timestamp: new Date(),
    });
    // On deck placement does not affect the inactivity counter

    await game.save();

    emitGameChanged(game);

    res.json({ message: 'Piece placed on deck' });
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    res.status(statusCode).json({ message: err.message });
  }
});

module.exports = router; 
