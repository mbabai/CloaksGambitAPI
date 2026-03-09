const {
  ACTIONS,
  IDENTITIES,
  IDENTITY_COUNTS,
  MOVE_STATES,
  RANKS,
  FILES,
  WHITE,
  otherColor,
  createRng,
  getLegalActions,
  getLastMove,
  getPieceAt,
} = require('./engine');

const BUILTIN_MEDIUM_ID = 'builtin:medium-bot';

const BUILTIN_PARTICIPANTS = Object.freeze([
  {
    id: BUILTIN_MEDIUM_ID,
    type: 'builtin',
    label: 'Medium Bot',
    notes: 'Rule-based baseline opponent',
  },
]);

function normalizeParticipantId(input) {
  if (typeof input !== 'string') return '';
  const value = input.trim();
  if (!value) return '';
  return value.toLowerCase();
}

function isBuiltinParticipantId(participantId) {
  const normalized = normalizeParticipantId(participantId);
  return normalized === BUILTIN_MEDIUM_ID;
}

function getBuiltinParticipant(participantId) {
  const normalized = normalizeParticipantId(participantId);
  return BUILTIN_PARTICIPANTS.find((item) => item.id === normalized) || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function coordKey(coord) {
  if (!coord) return '';
  return `${coord.row},${coord.col}`;
}

function countBoardPieces(state, color) {
  if (!state || !Array.isArray(state.board)) return 0;
  let total = 0;
  for (let row = 0; row < state.board.length; row += 1) {
    for (let col = 0; col < state.board[row].length; col += 1) {
      const piece = getPieceAt(state, row, col);
      if (piece && piece.color === color) {
        total += 1;
      }
    }
  }
  return total;
}

function getAvailableIdentityCounts(state, color) {
  const counts = {};
  if (!state || !state.pieces) return counts;
  Object.values(state.pieces).forEach((piece) => {
    if (!piece || piece.color !== color || !piece.alive) return;
    if (piece.zone === 'captured') return;
    counts[piece.identity] = (counts[piece.identity] || 0) + 1;
  });
  return counts;
}

function canDeclareIdentity(availableIdentityCounts, identity) {
  if (identity === IDENTITIES.KING) return true;
  return (availableIdentityCounts?.[identity] || 0) > 0;
}

function computeCapturedCounts(state, color) {
  const counts = {};
  const capturedIds = Array.isArray(state?.captured?.[color]) ? state.captured[color] : [];
  capturedIds.forEach((pieceId) => {
    const piece = state?.pieces?.[pieceId];
    if (!piece) return;
    counts[piece.identity] = (counts[piece.identity] || 0) + 1;
  });
  return counts;
}

function hasBombAvailable(availableIdentityCounts) {
  return (availableIdentityCounts?.[IDENTITIES.BOMB] || 0) > 0;
}

function hasOpponentLostBomb(state, color) {
  const capturedIds = Array.isArray(state?.captured?.[color]) ? state.captured[color] : [];
  return capturedIds.some((pieceId) => {
    const piece = state?.pieces?.[pieceId];
    return Boolean(piece && piece.identity === IDENTITIES.BOMB);
  });
}

function buildOpponentHistoryBySquare(state, color) {
  const map = new Map();
  const opponent = otherColor(color);
  if (!state || !state.pieces) return map;
  Object.values(state.pieces).forEach((piece) => {
    if (!piece || !piece.alive || piece.color !== opponent || piece.zone !== 'board') {
      return;
    }
    const history = Array.isArray(state.moveHistoryByPiece?.[piece.id])
      ? state.moveHistoryByPiece[piece.id]
      : [];
    if (!history.length) return;
    history.forEach((entry) => {
      if (
        !entry
        || !entry.from
        || !Number.isFinite(entry.from.row)
        || !Number.isFinite(entry.from.col)
        || !Number.isFinite(entry.declaration)
      ) {
        return;
      }
      const key = coordKey(entry.from);
      if (!map.has(key)) {
        map.set(key, new Set());
      }
      map.get(key).add(entry.declaration);
    });
  });
  return map;
}

function isInside(row, col) {
  return row >= 0 && row < RANKS && col >= 0 && col < FILES;
}

function isLineClear(board, from, to) {
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  let row = from.row + dr;
  let col = from.col + dc;
  while (row !== to.row || col !== to.col) {
    if (!isInside(row, col)) return false;
    if (board[row][col]) return false;
    row += dr;
    col += dc;
  }
  return true;
}

function declarationLegalByGeometry(board, from, to, declaration) {
  if (!from || !to) return false;
  if (!isInside(from.row, from.col) || !isInside(to.row, to.col)) return false;
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);
  if (dr === 0 && dc === 0) return false;

  if (declaration === IDENTITIES.KNIGHT) {
    return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
  }
  if (declaration === IDENTITIES.KING) {
    return absDr <= 1 && absDc <= 1;
  }
  if (declaration === IDENTITIES.BISHOP) {
    if (!(absDr === absDc && absDr > 0 && absDr <= 3)) return false;
    return isLineClear(board, from, to);
  }
  if (declaration === IDENTITIES.ROOK) {
    if (!((dr === 0 || dc === 0) && absDr <= 3 && absDc <= 3)) return false;
    return isLineClear(board, from, to);
  }
  return false;
}

function countProtectorsAfterMove(state, action, color) {
  if (!state || !action || !action.from || !action.to || !action.pieceId) return 0;
  const movingPiece = state.pieces?.[action.pieceId];
  if (!movingPiece || movingPiece.color !== color) return 0;

  const opponent = otherColor(color);
  const board = state.board.map((row) => row.slice());
  board[action.from.row][action.from.col] = null;
  // Use a synthetic token at the destination to measure defender pressure.
  board[action.to.row][action.to.col] = '__target__';

  let total = 0;
  Object.values(state.pieces || {}).forEach((piece) => {
    if (!piece || !piece.alive || piece.color !== color || piece.zone !== 'board') return;
    if (piece.id === movingPiece.id) return;
    if (!isInside(piece.row, piece.col)) return;
    if (!declarationLegalByGeometry(
      board,
      { row: piece.row, col: piece.col },
      action.to,
      piece.identity,
    )) {
      return;
    }
    const targetToken = board[action.to.row][action.to.col];
    if (targetToken === '__target__') {
      total += 1;
      return;
    }
    const targetPiece = state.pieces?.[targetToken];
    if (targetPiece && targetPiece.color === opponent) {
      total += 1;
    }
  });

  return total;
}

function scoreChallengeAction(state, challengerColor, context) {
  const lastMove = getLastMove(state);
  if (!lastMove) return 0;
  const declaration = lastMove.declaration;
  const maxAvailable = IDENTITY_COUNTS[declaration] || 0;
  const capturedCount = context.capturedCounts?.[declaration] || 0;
  if (maxAvailable > 0 && capturedCount >= maxAvailable) {
    return Number.POSITIVE_INFINITY;
  }

  const to = lastMove.to;
  const targetPiece = to ? getPieceAt(state, to.row, to.col) : null;
  const isCapture = Boolean(targetPiece && targetPiece.color === challengerColor);
  const myDaggers = state.daggers?.[challengerColor] || 0;
  let score = isCapture ? 10 : 1;

  if (isCapture && targetPiece.identity === IDENTITIES.KING) {
    if (!context.hasBombAvailable) {
      return Number.POSITIVE_INFINITY;
    }
    score = 10000;
  }

  const history = context.opponentHistoryBySquare.get(coordKey(lastMove.from));
  if (history && history.size > 1) {
    score += (history.size - 1) * 4;
  }

  score -= myDaggers * 12;
  if (score < 0) score = 0;
  return score;
}

function scoreBombAction(state, color, context) {
  const lastMove = getLastMove(state);
  if (!lastMove || !lastMove.to) return 0;
  const targetPiece = getPieceAt(state, lastMove.to.row, lastMove.to.col);
  if (!targetPiece || targetPiece.color !== color) return 0;
  if (targetPiece.identity === IDENTITIES.BOMB) return Number.POSITIVE_INFINITY;
  if (targetPiece.identity === IDENTITIES.KING) {
    return context.hasBombAvailable ? 7000 : 0;
  }
  if (!context.hasBombAvailable) return 0;

  const onBoard = countBoardPieces(state, color);
  const deficit = Math.max(0, 6 - onBoard);
  if (deficit <= 0) return 0;
  return deficit * 3;
}

function scorePassAction(state, color) {
  const lastMove = getLastMove(state);
  if (!lastMove) return 0;
  const opponentLostBomb = hasOpponentLostBomb(state, color);
  let kingAtStake = false;
  if (lastMove.to) {
    const threatenedPiece = getPieceAt(state, lastMove.to.row, lastMove.to.col);
    kingAtStake = Boolean(
      threatenedPiece
      && threatenedPiece.color === color
      && threatenedPiece.identity === IDENTITIES.KING,
    );
  }

  if (opponentLostBomb || kingAtStake) return 0;
  const myDaggers = state.daggers?.[color] || 0;
  return myDaggers >= 2 ? 10 : 1;
}

function scoreOnDeckAction(state, action) {
  const piece = state.pieces?.[action.pieceId] || null;
  if (!piece) return 0;
  if (piece.identity === IDENTITIES.BOMB) return 1;
  return 4;
}

function scoreMoveAction(state, action, color, context) {
  const piece = state.pieces?.[action.pieceId]
    || (action.from ? getPieceAt(state, action.from.row, action.from.col) : null);
  if (!piece || !action.from || !action.to) return 0;

  if (!canDeclareIdentity(context.availableIdentityCounts, action.declaration)) {
    return -1000;
  }

  const myCount = context.myCount;
  if (myCount <= 1 && action.declaration !== IDENTITIES.KING) {
    return 0;
  }

  let score = 0;
  const protectors = countProtectorsAfterMove(state, action, color);
  score += protectors * 10;

  const forwardDelta = color === WHITE
    ? (action.to.row - action.from.row)
    : (action.from.row - action.to.row);
  if (forwardDelta > 0) {
    score += forwardDelta;
  }

  const target = action.capturePieceId
    ? (state.pieces?.[action.capturePieceId] || null)
    : getPieceAt(state, action.to.row, action.to.col);
  if (target && target.color !== color) {
    const pieceDeficit = Math.max(0, context.oppCount - myCount);
    score += 10 + (pieceDeficit * 5);
  }

  if (action.declaration === piece.identity) {
    score += 10;
  }

  const myDaggers = state.daggers?.[color] || 0;
  if (
    action.declaration === IDENTITIES.BOMB
    && piece.identity !== IDENTITIES.BOMB
  ) {
    score -= myDaggers * 10;
  }

  if (piece.identity === IDENTITIES.KING && action.declaration === IDENTITIES.KING) {
    const throneRow = color === WHITE ? (RANKS - 1) : 0;
    if (action.to.row === throneRow) {
      return Number.POSITIVE_INFINITY;
    }
    const forwardPosition = color === WHITE
      ? action.to.row
      : (RANKS - 1 - action.to.row);
    const opponentPieces = Math.max(1, context.oppCount);
    score += (forwardPosition * forwardPosition) / opponentPieces;
  }

  if (piece.identity === IDENTITIES.KING) {
    score -= 5;
  }

  if (score < 0) score = 0;
  return score;
}

function scoreAction(state, action, color, context) {
  const type = String(action?.type || '').toUpperCase();
  if (type === 'MOVE') return scoreMoveAction(state, action, color, context);
  if (type === 'CHALLENGE') return scoreChallengeAction(state, color, context);
  if (type === 'BOMB') return scoreBombAction(state, color, context);
  if (type === 'PASS') return scorePassAction(state, color);
  if (type === 'ON_DECK') return scoreOnDeckAction(state, action);
  return -1000;
}

function sortableScore(value) {
  if (value === Number.POSITIVE_INFINITY) return Number.MAX_SAFE_INTEGER;
  if (value === Number.NEGATIVE_INFINITY) return Number.MIN_SAFE_INTEGER;
  if (!Number.isFinite(value)) return -1000;
  return value;
}

function chooseWeightedAction(scoredActions, rng) {
  if (!Array.isArray(scoredActions) || !scoredActions.length) return null;
  const sorted = [...scoredActions].sort((a, b) => sortableScore(b.score) - sortableScore(a.score));
  const top = sorted.slice(0, 5);
  const infinite = top.filter((entry) => entry.score === Number.POSITIVE_INFINITY);
  if (infinite.length) {
    const index = Math.floor(rng() * infinite.length);
    return infinite[index];
  }
  const positive = top.filter((entry) => Number.isFinite(entry.score) && entry.score > 0);
  if (!positive.length) {
    return top[0] || null;
  }
  const weights = positive.map((entry) => entry.score * entry.score);
  const total = weights.reduce((acc, value) => acc + value, 0);
  if (total <= 0) return positive[0];
  const target = rng() * total;
  let cumulative = 0;
  for (let idx = 0; idx < positive.length; idx += 1) {
    cumulative += weights[idx];
    if (target <= cumulative) {
      return positive[idx];
    }
  }
  return positive[positive.length - 1];
}

function chooseMediumAction(state, options = {}) {
  if (!state || !state.isActive) {
    return {
      action: null,
      valueEstimate: 0,
      trace: { mode: 'builtin-medium', reason: 'inactive' },
      trainingRecord: null,
    };
  }

  const color = state.playerTurn;
  const legalActions = getLegalActions(state, color);
  if (!legalActions.length) {
    return {
      action: null,
      valueEstimate: -1,
      trace: { mode: 'builtin-medium', reason: 'no_legal_actions' },
      trainingRecord: null,
    };
  }

  const baseSeed = Number.isFinite(options.seed) ? options.seed : Date.now();
  const rng = createRng(baseSeed + (state.ply * 7919) + (color * 397));
  const opponent = otherColor(color);
  const lastAction = Array.isArray(state.actions) && state.actions.length
    ? state.actions[state.actions.length - 1]
    : null;
  const lastMove = Array.isArray(state.moves) && state.moves.length
    ? state.moves[state.moves.length - 1]
    : null;
  const pendingOpponentMove = Boolean(
    lastAction
      && lastAction.type === ACTIONS.MOVE
      && lastAction.player === opponent
      && lastMove
      && lastMove.player === opponent
      && lastMove.state === MOVE_STATES.PENDING,
  );
  const pendingBombResponse = Boolean(
    lastAction
      && lastAction.type === ACTIONS.BOMB
      && lastAction.player === opponent,
  );
  const responsePhase = pendingOpponentMove || pendingBombResponse;
  const actionsToScore = responsePhase
    ? legalActions.filter((action) => (
      action?.type === 'CHALLENGE'
      || action?.type === 'BOMB'
      || action?.type === 'PASS'
    ))
    : legalActions;
  const availableIdentityCounts = getAvailableIdentityCounts(state, color);
  const context = {
    availableIdentityCounts,
    capturedCounts: computeCapturedCounts(state, color),
    hasBombAvailable: hasBombAvailable(availableIdentityCounts),
    opponentHistoryBySquare: buildOpponentHistoryBySquare(state, color),
    myCount: countBoardPieces(state, color),
    oppCount: countBoardPieces(state, opponent),
  };
  const scored = actionsToScore.map((action) => {
    const score = scoreAction(state, action, color, context);
    return {
      action,
      score,
      type: action.type,
      declaration: action.declaration,
      pieceId: action.pieceId || null,
      from: action.from ? { ...action.from } : null,
      to: action.to ? { ...action.to } : null,
    };
  });

  const selected = chooseWeightedAction(scored, rng) || scored[0];
  if (!selected || !selected.action) {
    return {
      action: actionsToScore[0] || legalActions[0],
      valueEstimate: 0,
      trace: {
        mode: 'builtin-medium',
        reason: 'fallback_first_legal_action',
      },
      trainingRecord: null,
    };
  }

  const selectedScore = sortableScore(selected.score);
  const valueEstimate = selected.score === Number.POSITIVE_INFINITY
    ? 1
    : clamp(selectedScore / 40, -1, 1);

  return {
    action: selected.action,
    valueEstimate,
    trace: {
      mode: 'builtin-medium',
      rootVisits: 1,
      scoredActions: scored
        .sort((a, b) => sortableScore(b.score) - sortableScore(a.score))
        .slice(0, 8),
    },
    trainingRecord: null,
  };
}

function chooseBuiltinAction(participantId, state, options = {}) {
  const normalized = normalizeParticipantId(participantId);
  if (normalized === BUILTIN_MEDIUM_ID) {
    return chooseMediumAction(state, options);
  }
  return {
    action: null,
    valueEstimate: 0,
    trace: {
      mode: 'builtin',
      reason: 'unsupported_builtin',
      participantId: normalized,
    },
    trainingRecord: null,
  };
}

module.exports = {
  BUILTIN_MEDIUM_ID,
  BUILTIN_PARTICIPANTS,
  normalizeParticipantId,
  isBuiltinParticipantId,
  getBuiltinParticipant,
  chooseBuiltinAction,
};
