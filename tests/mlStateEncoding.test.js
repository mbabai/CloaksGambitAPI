const {
  IDENTITIES,
  DECLARABLE_IDENTITIES,
  createInitialState,
  cloneState,
  getLegalActions,
  countMoveOptionsForColor,
  applyAction,
  actionKey,
  computeStateHash,
  WHITE,
  BLACK,
} = require('../src/services/ml/engine');
const { createDefaultModelBundle } = require('../src/services/ml/modeling');
const { runHiddenInfoMcts } = require('../src/services/ml/mcts');

function isInside(row, col) {
  return row >= 0 && row < 6 && col >= 0 && col < 5;
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
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);

  if (dr === 0 && dc === 0) return false;
  if (!isInside(to.row, to.col)) return false;

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

function referenceDeclaredMoveKeys(state, color) {
  const actions = [];
  for (let row = 0; row < state.board.length; row += 1) {
    for (let col = 0; col < state.board[row].length; col += 1) {
      const pieceId = state.board[row][col];
      if (!pieceId) continue;
      const piece = state.pieces[pieceId];
      if (!piece || !piece.alive || piece.color !== color) continue;

      DECLARABLE_IDENTITIES.forEach((declaration) => {
        for (let toRow = 0; toRow < state.board.length; toRow += 1) {
          for (let toCol = 0; toCol < state.board[toRow].length; toCol += 1) {
            if (toRow === row && toCol === col) continue;
            const targetId = state.board[toRow][toCol];
            const targetPiece = targetId ? state.pieces[targetId] : null;
            if (targetPiece && targetPiece.color === color) continue;
            if (!declarationLegalByGeometry(
              state.board,
              { row, col },
              { row: toRow, col: toCol },
              declaration,
            )) {
              continue;
            }
            actions.push(actionKey({
              type: 'MOVE',
              player: color,
              pieceId,
              from: { row, col },
              to: { row: toRow, col: toCol },
              declaration,
              capturePieceId: targetPiece ? targetPiece.id : null,
            }));
          }
        }
      });
    }
  }
  return actions.sort();
}

function remapPieceIds(state) {
  const clone = cloneState(state);
  const sourceIds = Object.keys(clone.pieces);
  const nextPieces = {};
  const idMap = new Map();
  sourceIds.forEach((oldId, index) => {
    const newId = `piece-${index}`;
    idMap.set(oldId, newId);
    nextPieces[newId] = {
      ...clone.pieces[oldId],
      id: newId,
    };
  });

  clone.board = clone.board.map((row) => row.map((pieceId) => (pieceId ? idMap.get(pieceId) : null)));
  clone.stashes = clone.stashes.map((stash) => stash.map((pieceId) => idMap.get(pieceId)));
  clone.onDecks = clone.onDecks.map((pieceId) => (pieceId ? idMap.get(pieceId) : null));
  clone.captured = clone.captured.map((pieces) => pieces.map((pieceId) => idMap.get(pieceId)));
  clone.moves = clone.moves.map((move) => ({
    ...move,
    pieceId: move.pieceId ? idMap.get(move.pieceId) : null,
    capturePieceId: move.capturePieceId ? idMap.get(move.capturePieceId) : null,
  }));
  clone.revealedIdentities = Object.fromEntries(
    Object.entries(clone.revealedIdentities || {}).map(([pieceId, identity]) => [idMap.get(pieceId), identity]),
  );
  clone.moveHistoryByPiece = Object.fromEntries(
    Object.entries(clone.moveHistoryByPiece || {}).map(([pieceId, entries]) => [idMap.get(pieceId), entries]),
  );
  clone.pieces = nextPieces;
  return clone;
}

describe('ml state encoding', () => {
  test('compact move generation matches the reference enumerator on opening states', () => {
    [101, 202, 303, 404, 505].forEach((seed) => {
      const state = createInitialState({ seed, maxPlies: 80 });
      const blackTurnState = cloneState(state);
      blackTurnState.playerTurn = BLACK;
      blackTurnState.toMove = BLACK;
      const whiteMoves = getLegalActions(state, WHITE)
        .filter((action) => action.type === 'MOVE')
        .map((action) => actionKey(action))
        .sort();
      const blackMoves = getLegalActions(blackTurnState, BLACK)
        .filter((action) => action.type === 'MOVE')
        .map((action) => actionKey(action))
        .sort();

      expect(whiteMoves).toEqual(referenceDeclaredMoveKeys(state, WHITE));
      expect(blackMoves).toEqual(referenceDeclaredMoveKeys(blackTurnState, BLACK));
      expect(countMoveOptionsForColor(state, WHITE)).toBe(whiteMoves.length);
      expect(countMoveOptionsForColor(blackTurnState, BLACK)).toBe(blackMoves.length);
    });
  });

  test('compact move generation still matches the reference during pending-response phases', () => {
    const state = createInitialState({ seed: 606, maxPlies: 80 });
    const openingMove = getLegalActions(state, WHITE).find((action) => action.type === 'MOVE');
    const pendingState = applyAction(state, openingMove);

    const blackMoves = getLegalActions(pendingState, BLACK)
      .filter((action) => action.type === 'MOVE')
      .map((action) => actionKey(action))
      .sort();

    expect(blackMoves).toEqual(referenceDeclaredMoveKeys(pendingState, BLACK));
  });

  test('hashes stay stable across cloning and support non-canonical piece ids', () => {
    const state = remapPieceIds(createInitialState({ seed: 707, maxPlies: 80 }));
    const cloned = cloneState(state);
    const firstHash = computeStateHash(state);
    const clonedHash = computeStateHash(cloned);

    expect(firstHash).toBe(clonedHash);

    const move = getLegalActions(state, WHITE).find((action) => action.type === 'MOVE');
    const nextState = applyAction(state, move);
    expect(computeStateHash(nextState)).not.toBe(firstHash);
  });

  test('mcts exposes encoded search cache statistics', () => {
    const state = createInitialState({ seed: 808, maxPlies: 80 });
    const modelBundle = createDefaultModelBundle({ seed: 909 });
    const search = runHiddenInfoMcts(modelBundle, state, {
      rootPlayer: WHITE,
      iterations: 12,
      maxDepth: 6,
      hypothesisCount: 3,
    });

    expect(search.action).toBeTruthy();
    expect(search.trace.nodeCount).toBeGreaterThan(0);
    expect(search.trace.evaluationCount).toBeGreaterThan(0);
    expect(search.trace.evaluationCacheHits).toBeGreaterThanOrEqual(0);
    expect(search.trace.transpositionHits).toBeGreaterThanOrEqual(0);
  });
});
