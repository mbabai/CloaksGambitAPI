import { ACTIONS, MOVE_STATES } from './gameConstants.js';

function normalizeDeclaration(value) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'string' ? parseInt(value, 10) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeSquare(square) {
  if (!square || typeof square.row !== 'number' || typeof square.col !== 'number') {
    return null;
  }
  return { row: square.row, col: square.col };
}

function coordsEqual(a, b) {
  return Boolean(a && b && a.row === b.row && a.col === b.col);
}

export function getLatestMoveContext(game) {
  if (!game || !Array.isArray(game.actions)) {
    return null;
  }

  const actionIndex = game.actions
    .map((action) => (action ? action.type : undefined))
    .lastIndexOf(ACTIONS.MOVE);

  if (actionIndex < 0) {
    return null;
  }

  const action = game.actions[actionIndex] || {};
  const details = action.details || {};

  const from = normalizeSquare(details.from);
  const to = normalizeSquare(details.to);
  const declaration = Object.prototype.hasOwnProperty.call(details, 'declaration')
    ? normalizeDeclaration(details.declaration)
    : null;
  const actor = action?.actor ?? action?.userId ?? action?.player ?? null;

  let moveIndex = null;
  let move = null;
  if (Array.isArray(game.moves) && game.moves.length > 0) {
    for (let idx = game.moves.length - 1; idx >= 0; idx -= 1) {
      const candidate = game.moves[idx];
      if (!candidate) continue;
      const candidateDecl = normalizeDeclaration(candidate.declaration);
      if (
        (declaration !== null && candidateDecl === declaration) ||
        coordsEqual(candidate.to, to)
      ) {
        moveIndex = idx;
        move = candidate;
        break;
      }
    }
    if (moveIndex === null) {
      moveIndex = game.moves.length - 1;
      move = game.moves[moveIndex];
    }
  }

  const isPending = Boolean(
    (move && move.state === MOVE_STATES.PENDING) ||
    !move ||
    !coordsEqual(move && move.to, to)
  );

  return {
    from,
    to,
    declaration,
    actor,
    isPending,
    actionIndex,
    moveIndex,
    action,
    move,
  };
}
