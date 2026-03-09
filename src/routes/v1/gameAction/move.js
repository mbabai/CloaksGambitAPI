const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const DEBUG_GAME_ACTIONS = process.env.DEBUG_GAME_ACTIONS === 'true';
const debugLog = (...args) => { if (DEBUG_GAME_ACTIONS) console.log(...args); };
const { resolveUserFromRequest } = require('../../../utils/authTokens');
const User = require('../../../models/User');
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
  isDeclaredMoveLegal,
  resolvePendingMove,
} = require('../../../services/game/liveGameRules');

router.post('/', async (req, res) => {
  try {
    const { gameId, color, from, to, declaration } = req.body;

    const requester = await resolveUserFromRequest(req).catch(() => null);
    let requesterRecord = null;
    if (requester?.userId) {
      requesterRecord = await User.findById(requester.userId).lean().catch(() => null);
    }
    const requesterDetails = {
      userId: requester?.userId || null,
      username: requester?.username || requesterRecord?.username || null,
      isBot: requesterRecord?.isBot || false,
      botDifficulty: requesterRecord?.botDifficulty || null,
    };
    debugLog('[gameAction:move] incoming request', {
      gameId,
      color,
      from,
      to,
      declaration,
      ...requesterDetails,
    });

    const initiator = {
      action: 'move',
      userId: requesterDetails.userId,
      username: requesterDetails.username,
      isBot: requesterDetails.isBot,
      botDifficulty: requesterDetails.botDifficulty,
    };

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is not active' });
    }

    const config = await getServerConfig();
    const now = Date.now();
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    ensureStoredClockState(game, {
      now,
      setupActionType: config.actions.get('SETUP'),
    });
    appendLocalDebugLog('clock-route-entry', {
      route: 'move',
      gameId,
      color: normalizedColor,
      playerTurn: game.playerTurn,
      setupComplete: game.setupComplete,
      clockState: summarizeClockState(game.clockState),
    });

    if (!game.setupComplete[0] || !game.setupComplete[1]) {
      return res.status(400).json({ message: 'Illegal move: Setup not complete for both players' });
    }

    const fromRow = parseInt(from?.row, 10);
    const fromCol = parseInt(from?.col, 10);
    const toRow = parseInt(to?.row, 10);
    const toCol = parseInt(to?.col, 10);

    const ranks = config.boardDimensions.RANKS;
    const files = config.boardDimensions.FILES;
    const isOnBoard = (r, c) => r >= 0 && r < ranks && c >= 0 && c < files;
    if (!isOnBoard(fromRow, fromCol) || !isOnBoard(toRow, toCol)) {
      return res.status(400).json({ message: 'Coordinates out of bounds' });
    }

    const lastAction = getLastAction(game);
    if (lastAction && lastAction.type === config.actions.get('BOMB')) {
      return res.status(400).json({ message: 'Cannot move after a bomb action' });
    }

    if (game.onDeckingPlayer === normalizedColor) {
      return res.status(400).json({ message: 'Player must place on-deck piece before moving' });
    }

    // Always resolve the previous pending move before validating this move.
    // Otherwise source/destination validation can be performed against a stale board.
    {
      const prevMove = getLastMove(game);
      if (isPendingMove(prevMove, config)) {
        const gameEnded = await resolvePendingMove(game, prevMove, config);
        if (gameEnded) {
          eventBus.emit('gameChanged', {
            game: typeof game.toObject === 'function' ? game.toObject() : game,
            affectedUsers: (game.players || []).map(p => p.toString()),
            initiator,
          });
          return res.json({ message: 'Game ended during move resolution' });
        }
      }
    }

    const piece = game.board[fromRow][fromCol];
    if (!piece) {
      return res.status(400).json({ message: 'No piece at from coordinates' });
    }

    if (piece.color !== normalizedColor || game.playerTurn !== normalizedColor) {
      return res.status(400).json({ message: "Not this player's turn" });
    }

    const target = game.board[toRow][toCol];
    if (target && target.color === normalizedColor) {
      return res.status(400).json({ message: 'Destination occupied by own piece' });
    }

    const idents = config.identities;
    const parsedDeclaration = parseInt(declaration, 10);

    if (parsedDeclaration === idents.get('BOMB')) {
      return res.status(400).json({ message: 'Invalid declaration' });
    }
    if (
      parsedDeclaration !== idents.get('KNIGHT')
      && parsedDeclaration !== idents.get('KING')
      && parsedDeclaration !== idents.get('BISHOP')
      && parsedDeclaration !== idents.get('ROOK')
    ) {
      return res.status(400).json({ message: 'Invalid declaration' });
    }

    if (!isDeclaredMoveLegal(
      game.board,
      { row: fromRow, col: fromCol },
      { row: toRow, col: toCol },
      parsedDeclaration,
      config,
    )) {
      return res.status(400).json({ message: 'Illegal move' });
    }

    const move = {
      player: normalizedColor,
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      declaration: parsedDeclaration,
      state: config.moveStates.get('PENDING'),
      timestamp: new Date()
    };

    // Final check to ensure game is still active before proceeding
    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is not active' });
    }

    game.moves.push(move);

    // Flip turn to the other player after recording the move
    game.playerTurn = normalizedColor === 0 ? 1 : 0;

    transitionStoredClockState(game, {
      actingColor: normalizedColor,
      now,
      setupActionType: config.actions.get('SETUP'),
      reason: 'move',
    });

    await game.addAction(config.actions.get('MOVE'), normalizedColor, {
      from: { row: fromRow, col: fromCol },
      to: { row: toRow, col: toCol },
      declaration: parseInt(declaration, 10)
    });

    await game.save();

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
      initiator,
    });

    res.json({ message: 'Move recorded' });
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    res.status(statusCode).json({ message: err.message });
  }
});

module.exports = router;
