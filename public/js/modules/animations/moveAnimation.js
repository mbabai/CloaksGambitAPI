import { ACTIONS, MOVE_STATES } from '../constants.js';
import { Declaration } from '../interactions/moveRules.js';
import { getLatestMoveContext } from '../../shared/latestMoveContext.js';

export const ANIMATION_SPEEDS = Object.freeze({
  off: 'off',
  fast: 'fast',
  slow: 'slow',
});

export const DEFAULT_ANIMATION_SPEED = ANIMATION_SPEEDS.slow;

export const MOVE_ANIMATION_DURATIONS = Object.freeze({
  fast: Object.freeze({
    moveMs: 280,
    captureMs: 180,
  }),
  slow: Object.freeze({
    moveMs: 760,
    captureMs: 320,
  }),
});

const VALID_ANIMATION_SPEEDS = new Set(Object.values(ANIMATION_SPEEDS));

function normalizePlayer(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeSquare(square) {
  if (!square || typeof square !== 'object') return null;
  const row = Number(square.row);
  const col = Number(square.col);
  if (!Number.isFinite(row) || !Number.isFinite(col)) return null;
  return { row, col };
}

function coordsEqual(left, right) {
  return Boolean(left && right && left.row === right.row && left.col === right.col);
}

export function normalizeAnimationSpeed(value, fallback = DEFAULT_ANIMATION_SPEED) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return VALID_ANIMATION_SPEEDS.has(normalized) ? normalized : fallback;
}

export function getMoveAnimationDurations(speed) {
  const normalized = normalizeAnimationSpeed(speed);
  return MOVE_ANIMATION_DURATIONS[normalized] || null;
}

export function serverToAnimationUiCoords(square, rows, cols, isWhite) {
  const normalized = normalizeSquare(square);
  if (!normalized) return null;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 0;
  const safeCols = Number.isFinite(cols) && cols > 0 ? cols : 0;
  return {
    uiR: isWhite && safeRows ? safeRows - 1 - normalized.row : normalized.row,
    uiC: isWhite ? normalized.col : (safeCols ? safeCols - 1 - normalized.col : normalized.col),
  };
}

export function buildMoveRoute({ fromUI, toUI, declaration } = {}) {
  if (!fromUI || !toUI) return [];
  const start = { uiR: fromUI.uiR, uiC: fromUI.uiC };
  const end = { uiR: toUI.uiR, uiC: toUI.uiC };
  if (declaration !== Declaration.KNIGHT) {
    return [start, end];
  }

  const dR = end.uiR - start.uiR;
  const dC = end.uiC - start.uiC;
  const absR = Math.abs(dR);
  const absC = Math.abs(dC);
  if (!((absR === 2 && absC === 1) || (absR === 1 && absC === 2))) {
    return [start, end];
  }

  const middle = absR === 2
    ? { uiR: end.uiR, uiC: start.uiC }
    : { uiR: start.uiR, uiC: end.uiC };
  return [start, middle, end];
}

export function cloneBoardWithHiddenSource(board, from) {
  if (!Array.isArray(board) || !from || !Array.isArray(board[from.row])) return null;
  const next = board.map((row) => (Array.isArray(row) ? row.slice() : []));
  next[from.row][from.col] = null;
  return next;
}

export function cloneBoardWithArrivedMove(board, from, to, movingPiece) {
  if (
    !Array.isArray(board)
    || !from
    || !to
    || !Array.isArray(board[from.row])
    || !Array.isArray(board[to.row])
  ) {
    return null;
  }
  const next = board.map((row) => (Array.isArray(row) ? row.slice() : []));
  next[from.row][from.col] = null;
  next[to.row][to.col] = movingPiece || null;
  return next;
}

export function buildMoveAnimationKey(moveLike) {
  if (!moveLike) return null;
  const from = normalizeSquare(moveLike.from);
  const to = normalizeSquare(moveLike.to);
  const player = normalizePlayer(moveLike.player);
  const declaration = Number(moveLike.declaration);
  if (!from || !to || player === null || !Number.isFinite(declaration)) return null;
  return [
    player,
    from.row,
    from.col,
    to.row,
    to.col,
    declaration,
  ].join(':');
}

export function deriveOpponentMoveAnimationPlan({
  game,
  currentBoard,
  viewerColor,
  rows,
  cols,
  currentIsWhite,
  lastAnimatedMoveKey = null,
} = {}) {
  const speed = normalizeAnimationSpeed(game?.animationSpeed || DEFAULT_ANIMATION_SPEED);
  if (speed === ANIMATION_SPEEDS.off) return null;
  if (!game || !Array.isArray(game.actions) || !Array.isArray(currentBoard)) return null;

  const actions = game.actions;
  const lastAction = actions.length ? actions[actions.length - 1] : null;
  if (!lastAction || lastAction.type !== ACTIONS.MOVE) return null;

  const context = getLatestMoveContext(game);
  if (!context) return null;

  const from = normalizeSquare(context.from || context.move?.from);
  const to = normalizeSquare(context.to || context.move?.to);
  if (!from || !to || coordsEqual(from, to)) return null;

  const movePlayer = normalizePlayer(context.actor)
    ?? normalizePlayer(context.move?.player)
    ?? normalizePlayer(lastAction.player);
  const normalizedViewerColor = normalizePlayer(viewerColor);
  if (movePlayer === null || normalizedViewerColor === null || movePlayer === normalizedViewerColor) {
    return null;
  }

  const declaration = Number(
    context.declaration !== null && context.declaration !== undefined
      ? context.declaration
      : context.move?.declaration
  );
  if (!Number.isFinite(declaration)) return null;

  const isPending = Boolean(
    context.isPending
    || context.move?.state === MOVE_STATES.PENDING
  );
  if (!isPending) return null;

  const movingPiece = currentBoard?.[from.row]?.[from.col] || null;
  if (!movingPiece || movingPiece.color !== movePlayer) return null;

  const targetPiece = currentBoard?.[to.row]?.[to.col] || null;
  if (targetPiece && targetPiece.color === movePlayer) return null;

  const fromUI = serverToAnimationUiCoords(from, rows, cols, currentIsWhite);
  const toUI = serverToAnimationUiCoords(to, rows, cols, currentIsWhite);
  const route = buildMoveRoute({ fromUI, toUI, declaration });
  if (route.length < 2) return null;

  const moveKey = buildMoveAnimationKey({
    player: movePlayer,
    from,
    to,
    declaration,
  });
  if (!moveKey || moveKey === lastAnimatedMoveKey) return null;

  return {
    speed,
    moveKey,
    move: {
      player: movePlayer,
      from,
      to,
      declaration,
    },
    movingPiece,
    targetPiece,
    fromUI,
    toUI,
    route,
    startBoard: cloneBoardWithHiddenSource(currentBoard, from),
    arrivedBoard: cloneBoardWithArrivedMove(currentBoard, from, to, movingPiece),
  };
}
