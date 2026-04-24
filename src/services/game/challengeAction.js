const {
  ensureStoredClockState,
  transitionStoredClockState,
  summarizeClockState,
} = require('../../utils/gameClock');
const { appendLocalDebugLog } = require('../../utils/localDebugLogger');

function createChallengeError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

async function applyChallengeAction(game, normalizedColor, config, { gameId = null, now = Date.now() } = {}) {
  ensureStoredClockState(game, {
    now,
    setupActionType: config.actions.get('SETUP'),
  });
  appendLocalDebugLog('clock-route-entry', {
    route: 'challenge',
    gameId: gameId || game?._id?.toString?.() || game?._id || null,
    color: normalizedColor,
    playerTurn: game.playerTurn,
    onDeckingPlayer: game.onDeckingPlayer,
    clockState: summarizeClockState(game.clockState),
  });

  if (!game.isActive) {
    throw createChallengeError('Game is already ended');
  }

  if (game.playerTurn !== normalizedColor) {
    throw createChallengeError('Not this player\'s turn');
  }

  const lastAction = game.actions[game.actions.length - 1];
  if (!lastAction) {
    throw createChallengeError('No previous action to challenge');
  }

  const moveType = config.actions.get('MOVE');
  const bombType = config.actions.get('BOMB');
  const lastMove = game.moves && game.moves.length > 0 ? game.moves[game.moves.length - 1] : null;

  if (lastAction.type === moveType) {
    if (!lastMove) {
      throw createChallengeError('No move found to challenge');
    }
    if (lastMove.state !== config.moveStates.get('PENDING')) {
      throw createChallengeError('No pending move to challenge');
    }
  } else if (lastAction.type === bombType) {
    if (!lastMove) {
      throw createChallengeError('No move found to challenge bomb');
    }
  } else {
    throw createChallengeError('Last action cannot be challenged');
  }

  if (!game.captured || !Array.isArray(game.captured) || game.captured.length !== 2) {
    throw createChallengeError('Invalid game state: captured array missing');
  }
  if (!game.daggers || !Array.isArray(game.daggers) || game.daggers.length !== 2) {
    throw createChallengeError('Invalid game state: daggers array missing');
  }
  if (!game.stashes || !Array.isArray(game.stashes) || game.stashes.length !== 2) {
    throw createChallengeError('Invalid game state: stashes array missing');
  }
  if (!game.onDecks || !Array.isArray(game.onDecks) || game.onDecks.length !== 2) {
    throw createChallengeError('Invalid game state: onDecks array missing');
  }
  if (!game.board || !Array.isArray(game.board) || game.board.length === 0) {
    throw createChallengeError('Invalid game state: board missing or empty');
  }
  if (!game.board[0] || !Array.isArray(game.board[0]) || game.board[0].length === 0) {
    throw createChallengeError('Invalid game state: board dimensions invalid');
  }

  if (game.onDeckingPlayer === normalizedColor) {
    throw createChallengeError('On-decking player cannot challenge');
  }

  let capturedPiece = null;
  let captureBy = null;
  let trueKing = false;
  let wasSuccessful = false;

  if (lastAction.type === moveType) {
    if (typeof lastMove.player !== 'number' || (lastMove.player !== 0 && lastMove.player !== 1)) {
      throw createChallengeError('Invalid move player information');
    }

    const from = lastMove.from;
    const to = lastMove.to;
    if (
      !from || !to
      || typeof from.row !== 'number' || typeof from.col !== 'number'
      || typeof to.row !== 'number' || typeof to.col !== 'number'
      || from.row < 0 || from.row >= game.board.length
      || from.col < 0 || from.col >= game.board[0].length
      || to.row < 0 || to.row >= game.board.length
      || to.col < 0 || to.col >= game.board[0].length
    ) {
      throw createChallengeError('Invalid move coordinates');
    }

    const pieceFrom = game.board[from.row][from.col];
    const pieceTo = game.board[to.row][to.col];
    if (!pieceFrom) {
      throw createChallengeError('Invalid move state');
    }

    if (pieceFrom.identity !== lastMove.declaration) {
      capturedPiece = pieceFrom;
      captureBy = normalizedColor;
      game.captured[normalizedColor].push(pieceFrom);
      game.board[from.row][from.col] = null;
      lastMove.state = config.moveStates.get('RESOLVED');
      wasSuccessful = true;
      game.onDeckingPlayer = null;
    } else {
      lastMove.state = config.moveStates.get('COMPLETED');
      game.daggers[normalizedColor] += 1;
      wasSuccessful = false;

      if (
        lastMove.declaration === config.identities.get('KING')
        && pieceFrom.identity === config.identities.get('KING')
      ) {
        trueKing = true;
      }

      if (pieceTo && pieceTo.color !== pieceFrom.color) {
        capturedPiece = pieceTo;
        captureBy = lastMove.player;
        game.captured[lastMove.player].push(pieceTo);
      }

      game.stashes[lastMove.player].push(pieceFrom);
      game.board[from.row][from.col] = null;

      const deckPiece = game.onDecks[lastMove.player];
      game.board[to.row][to.col] = deckPiece;
      game.onDecks[lastMove.player] = null;
      game.onDeckingPlayer = 1 - normalizedColor;
      game.playerTurn = 1 - normalizedColor;
    }
  } else if (lastAction.type === bombType) {
    if (!lastMove) {
      throw createChallengeError('No move found to challenge bomb');
    }
    if (typeof lastMove.player !== 'number' || (lastMove.player !== 0 && lastMove.player !== 1)) {
      throw createChallengeError('Invalid move player information');
    }

    const from = lastMove.from;
    const to = lastMove.to;
    if (
      !from || !to
      || typeof from.row !== 'number' || typeof from.col !== 'number'
      || typeof to.row !== 'number' || typeof to.col !== 'number'
      || from.row < 0 || from.row >= game.board.length
      || from.col < 0 || from.col >= game.board[0].length
      || to.row < 0 || to.row >= game.board.length
      || to.col < 0 || to.col >= game.board[0].length
    ) {
      throw createChallengeError('Invalid bomb coordinates');
    }

    const pieceFrom = game.board[from.row][from.col];
    const pieceTo = game.board[to.row][to.col];
    if (!pieceFrom) {
      throw createChallengeError('Invalid bomb state');
    }

    const bombId = config.identities.get('BOMB');
    if (!pieceTo || pieceTo.identity !== bombId) {
      if (pieceTo) {
        capturedPiece = pieceTo;
        captureBy = lastMove.player;
        game.captured[lastMove.player].push(pieceTo);
        game.daggers[pieceTo.color] += 1;
      }

      game.board[to.row][to.col] = pieceFrom;
      game.board[from.row][from.col] = null;
      lastMove.state = config.moveStates.get('RESOLVED');
      wasSuccessful = true;
      game.onDeckingPlayer = null;
    } else {
      game.stashes[pieceTo.color].push(pieceTo);
      const deckPiece = game.onDecks[pieceTo.color];
      game.board[to.row][to.col] = deckPiece;
      game.onDecks[pieceTo.color] = null;
      game.onDeckingPlayer = 1 - normalizedColor;
      game.playerTurn = 1 - normalizedColor;

      if (pieceFrom) {
        capturedPiece = pieceFrom;
        captureBy = pieceTo.color;
        game.captured[1 - normalizedColor].push(pieceFrom);
        game.board[from.row][from.col] = null;
      }

      game.daggers[normalizedColor] += 1;
      lastMove.state = config.moveStates.get('COMPLETED');
      wasSuccessful = false;
    }
  } else {
    throw createChallengeError('Last action type cannot be challenged');
  }

  if (game.onDeckingPlayer !== null) {
    game.playerTurn = game.onDeckingPlayer;
  } else if (lastMove) {
    game.playerTurn = lastMove.player === 0 ? 1 : 0;
  }

  transitionStoredClockState(game, {
    actingColor: normalizedColor,
    now,
    setupActionType: config.actions.get('SETUP'),
    reason: 'challenge',
  });

  await game.addAction(
    config.actions.get('CHALLENGE'),
    normalizedColor,
    {
      outcome: wasSuccessful ? 'SUCCESS' : 'FAIL',
    }
  );
  game.movesSinceAction = 0;
  await game.save();

  if (trueKing && game.isActive) {
    await game.endGame(lastMove.player, config.winReasons.get('TRUE_KING'));
  }

  if (
    game.isActive
    && capturedPiece
    && capturedPiece.identity === config.identities.get('KING')
  ) {
    await game.endGame(captureBy, config.winReasons.get('CAPTURED_KING'));
  }

  if (game.isActive && (game.daggers[0] >= 3 || game.daggers[1] >= 3)) {
    const loser = game.daggers[0] >= 3 ? 0 : 1;
    const winner = 1 - loser;
    await game.endGame(winner, config.winReasons.get('DAGGERS'));
  }

  return {
    success: wasSuccessful,
    message: 'Challenge processed successfully',
    capturedPiece,
    captureBy,
    trueKing,
  };
}

module.exports = {
  applyChallengeAction,
};
