import { ACTIONS, MOVE_STATES } from '../constants.js';
import { Declaration } from '../interactions/moveRules.js';

function cloneBoard(board) {
  if (!Array.isArray(board)) return [];
  return board.map((row) => (Array.isArray(row) ? row.slice() : []));
}

function serverToUICoords(row, col, rows, cols) {
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 0;
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 0;
  const uiR = safeRows ? (safeRows - 1 - row) : row;
  const uiC = safeCols ? col : 0;
  return { uiR, uiC };
}

function bubbleTypesForDeclaration(declaration) {
  switch (declaration) {
    case Declaration.KNIGHT:
      return ['knightSpeechLeft'];
    case Declaration.ROOK:
      return ['rookSpeechLeft'];
    case Declaration.BISHOP:
      return ['bishopSpeechLeft'];
    case Declaration.KING:
      return ['kingSpeechLeft'];
    default:
      return [];
  }
}

function getLastAction(actions, predicate) {
  if (!Array.isArray(actions) || actions.length === 0) return null;
  if (typeof predicate !== 'function') {
    return actions[actions.length - 1];
  }
  for (let i = actions.length - 1; i >= 0; i -= 1) {
    const action = actions[i];
    try {
      if (predicate(action)) {
        return action;
      }
    } catch (_) {
      // ignore predicate errors
    }
  }
  return null;
}

function normalizeSquare(square) {
  if (!square || typeof square.row !== 'number' || typeof square.col !== 'number') {
    return null;
  }
  return { row: square.row, col: square.col };
}

function resolveChallengeRemoved(lastAction, previousAction, lastMove) {
  if (!lastAction || lastAction.type !== ACTIONS.CHALLENGE) return null;
  if (!lastAction.details || lastAction.details.outcome !== 'SUCCESS') return null;
  if (!previousAction || (previousAction.type !== ACTIONS.MOVE && previousAction.type !== ACTIONS.BOMB)) return null;
  return normalizeSquare(lastMove?.to);
}

function clonePiece(piece) {
  if (!piece || typeof piece !== 'object') return null;
  return { ...piece };
}

export function deriveSpectateView(game) {
  if (!game) {
    return {
      board: [],
      rows: 0,
      cols: 0,
      pendingMoveFrom: null,
      pendingCapture: null,
      overlay: null,
      challengeRemoved: null,
    };
  }

  const board = cloneBoard(game.board);
  const rows = Array.isArray(board) ? board.length : 0;
  const cols = rows && Array.isArray(board[0]) ? board[0].length : 0;
  const moves = Array.isArray(game.moves) ? game.moves : [];
  const actions = Array.isArray(game.actions) ? game.actions : [];
  const lastMove = moves.length ? moves[moves.length - 1] : null;
  const lastAction = actions.length ? actions[actions.length - 1] : null;
  const previousAction = actions.length > 1 ? actions[actions.length - 2] : null;
  const lastMoveAction = getLastAction(actions, (action) => action && (action.type === ACTIONS.MOVE || action.type === ACTIONS.BOMB));

  let pendingMoveFrom = null;
  let pendingCapture = null;
  let overlay = null;

  const from = normalizeSquare(lastMove?.from);
  const to = normalizeSquare(lastMove?.to);
  const moveDeclaration = lastMove?.declaration ?? lastMoveAction?.details?.declaration;
  const moveState = lastMove?.state;
  const isPendingMove = moveState === MOVE_STATES.PENDING;

  if (isPendingMove && from && to && rows && cols) {
    pendingMoveFrom = { ...from };
    const hasFromRow = Array.isArray(board[from.row]);
    const hasToRow = Array.isArray(board[to.row]);
    if (hasFromRow && hasToRow) {
      const movingPiece = board[from.row][from.col] || null;
      const targetPiece = board[to.row][to.col] || null;
      board[from.row] = board[from.row].slice();
      board[to.row] = board[to.row].slice();
      if (lastMoveAction && lastMoveAction.type === ACTIONS.BOMB) {
        const fallbackPiece = movingPiece || targetPiece || (lastMove ? { color: lastMove.player, identity: moveDeclaration } : null);
        board[to.row][to.col] = targetPiece || movingPiece || fallbackPiece;
        pendingCapture = fallbackPiece ? { row: to.row, col: to.col, piece: clonePiece(fallbackPiece) } : null;
      } else {
        board[to.row][to.col] = movingPiece || targetPiece;
        pendingCapture = targetPiece ? { row: to.row, col: to.col, piece: clonePiece(targetPiece) } : null;
      }
      board[from.row][from.col] = null;
    }
  }

  if (to && rows && cols && lastMoveAction) {
    const { uiR, uiC } = serverToUICoords(to.row, to.col, rows, cols);
    let types = [];
    if (lastMoveAction.type === ACTIONS.BOMB) {
      types = ['bombSpeechLeft'];
    } else {
      types = bubbleTypesForDeclaration(moveDeclaration);
    }
    if (types.length > 0) {
      overlay = {
        uiR,
        uiC,
        types,
        from: from ? { ...from } : null,
        to: { ...to },
        isPending: isPendingMove,
        actionType: lastMoveAction.type,
      };
    }
  }

  const challengeRemoved = resolveChallengeRemoved(lastAction, previousAction, lastMove);

  if (lastAction?.type === ACTIONS.CHALLENGE) {
    const outcome = lastAction?.details?.outcome;
    if (typeof outcome === 'string' && outcome.toUpperCase() === 'SUCCESS') {
      overlay = null;
    }
  }

  return {
    board,
    rows,
    cols,
    pendingMoveFrom,
    pendingCapture,
    overlay,
    challengeRemoved,
  };
}

export { serverToUICoords as spectateServerToUICoords };
