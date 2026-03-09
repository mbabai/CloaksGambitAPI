function createPendingMoveError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function getLastMove(game) {
  return Array.isArray(game?.moves) && game.moves.length
    ? game.moves[game.moves.length - 1]
    : null;
}

function getLastAction(game) {
  return Array.isArray(game?.actions) && game.actions.length
    ? game.actions[game.actions.length - 1]
    : null;
}

function isPendingMove(move, config) {
  if (!move || !config?.moveStates?.get) return false;
  return move.state === config.moveStates.get('PENDING');
}

function isDeclaredMoveLegal(board, from, to, declaration, config) {
  if (!Array.isArray(board) || !from || !to || !config?.identities?.get) {
    return false;
  }

  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (dr === 0 && dc === 0) {
    return false;
  }

  switch (declaration) {
    case config.identities.get('KNIGHT'):
      return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
    case config.identities.get('KING'):
      return absDr <= 1 && absDc <= 1;
    case config.identities.get('BISHOP'): {
      if (absDr !== absDc || absDr === 0 || absDr > 3) {
        return false;
      }
      const stepR = dr > 0 ? 1 : -1;
      const stepC = dc > 0 ? 1 : -1;
      for (let index = 1; index < absDr; index += 1) {
        if (board[from.row + (index * stepR)][from.col + (index * stepC)]) {
          return false;
        }
      }
      return true;
    }
    case config.identities.get('ROOK'): {
      if ((dr !== 0 && dc !== 0) || absDr > 3 || absDc > 3) {
        return false;
      }
      const distance = Math.max(absDr, absDc);
      const stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
      const stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
      for (let index = 1; index < distance; index += 1) {
        if (board[from.row + (index * stepR)][from.col + (index * stepC)]) {
          return false;
        }
      }
      return true;
    }
    default:
      return false;
  }
}

async function resolvePendingMove(game, move, config) {
  const { from, to } = move || {};
  if (!from || !to) {
    throw createPendingMoveError('Invalid pending move state: missing coordinates');
  }

  const movingPiece = game?.board?.[from.row]?.[from.col];
  const targetPiece = game?.board?.[to.row]?.[to.col];

  if (!movingPiece) {
    throw createPendingMoveError('Invalid pending move state: no piece at source');
  }
  if (movingPiece.color !== move.player) {
    throw createPendingMoveError('Invalid pending move state: source piece color mismatch');
  }
  if (targetPiece && targetPiece.color === move.player) {
    throw createPendingMoveError('Invalid pending move state: destination occupied by own piece');
  }

  if (targetPiece) {
    game.captured[move.player].push(targetPiece);
  }

  game.board[to.row][to.col] = movingPiece;
  game.board[from.row][from.col] = null;
  move.state = config.moveStates.get('RESOLVED');

  const kingId = config.identities.get('KING');
  if (targetPiece && targetPiece.identity === kingId) {
    await game.endGame(move.player, config.winReasons.get('CAPTURED_KING'));
    return true;
  }

  if (move.declaration === kingId) {
    const throneRow = move.player === 0 ? config.boardDimensions.RANKS - 1 : 0;
    if (to.row === throneRow) {
      await game.endGame(move.player, config.winReasons.get('THRONE'));
      return true;
    }
  }

  if (targetPiece) {
    game.movesSinceAction = 0;
  } else {
    game.movesSinceAction += 1;
    if (game.movesSinceAction >= 20 && game.isActive) {
      await game.endGame(null, config.winReasons.get('DRAW'));
      return true;
    }
  }

  return false;
}

module.exports = {
  getLastMove,
  getLastAction,
  isPendingMove,
  isDeclaredMoveLegal,
  resolvePendingMove,
};
