const {
  ACTIONS,
  MOVE_STATES,
  WHITE,
  BLACK,
  IDENTITIES,
  createInitialState,
  getLegalActions,
  applyAction,
} = require('../src/services/ml/engine');

function placePiece(state, piece, row, col) {
  piece.alive = true;
  piece.zone = 'board';
  piece.row = row;
  piece.col = col;
  piece.capturedBy = null;
  state.board[row][col] = piece.id;
}

function createPendingCaptureState() {
  const state = createInitialState({ seed: 9411, maxPlies: 60 });
  state.board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
  state.stashes = [[], []];
  state.onDecks = [null, null];
  state.captured = [[], []];
  state.moves = [];
  state.actions = [];
  state.daggers = [0, 0];
  state.onDeckingPlayer = null;
  state.playerTurn = BLACK;
  state.toMove = BLACK;
  state.isActive = true;
  state.winner = null;
  state.winReason = null;
  state.ply = 1;
  state.movesSinceAction = 0;
  state.revealedIdentities = {};
  state.moveHistoryByPiece = Object.fromEntries(
    Object.keys(state.pieces).map((pieceId) => [pieceId, []]),
  );

  Object.values(state.pieces).forEach((piece) => {
    piece.alive = false;
    piece.zone = 'captured';
    piece.row = -1;
    piece.col = -1;
    piece.capturedBy = piece.color === WHITE ? BLACK : WHITE;
  });

  const whiteRook = Object.values(state.pieces).find((piece) => (
    piece.color === WHITE && piece.identity === IDENTITIES.ROOK
  ));
  const whiteKing = Object.values(state.pieces).find((piece) => (
    piece.color === WHITE && piece.identity === IDENTITIES.KING
  ));
  const blackKnight = Object.values(state.pieces).find((piece) => (
    piece.color === BLACK && piece.identity === IDENTITIES.KNIGHT
  ));
  const blackRook = Object.values(state.pieces).find((piece) => (
    piece.color === BLACK && piece.identity === IDENTITIES.ROOK
  ));
  const blackKing = Object.values(state.pieces).find((piece) => (
    piece.color === BLACK && piece.identity === IDENTITIES.KING
  ));

  placePiece(state, whiteRook, 1, 1);
  placePiece(state, whiteKing, 0, 4);
  placePiece(state, blackKnight, 2, 2);
  placePiece(state, blackRook, 5, 2);
  placePiece(state, blackKing, 5, 4);

  state.moves = [{
    player: WHITE,
    pieceId: whiteRook.id,
    from: { row: 1, col: 1 },
    to: { row: 2, col: 2 },
    declaration: IDENTITIES.ROOK,
    state: MOVE_STATES.PENDING,
    timestamp: 0,
  }];
  state.actions = [{
    type: ACTIONS.MOVE,
    player: WHITE,
    timestamp: 0,
    details: {
      from: { row: 1, col: 1 },
      to: { row: 2, col: 2 },
      declaration: IDENTITIES.ROOK,
    },
  }];
  state.moveHistoryByPiece[whiteRook.id] = [{
    turnIndex: 0,
    from: { row: 1, col: 1 },
    to: { row: 2, col: 2 },
    dr: 1,
    dc: 1,
    declaration: IDENTITIES.ROOK,
    capture: false,
    resolvedState: MOVE_STATES.PENDING,
  }];

  return {
    state,
    whiteRook,
    blackKnight,
    blackRook,
  };
}

function createPendingKingCaptureState() {
  const { state, whiteRook, blackRook } = createPendingCaptureState();
  const blackKnightId = state.board[2][2];
  state.board[2][2] = null;
  state.pieces[blackKnightId].alive = false;
  state.pieces[blackKnightId].zone = 'captured';
  state.pieces[blackKnightId].row = -1;
  state.pieces[blackKnightId].col = -1;
  state.pieces[blackKnightId].capturedBy = WHITE;

  const blackKing = Object.values(state.pieces).find((piece) => (
    piece.color === BLACK && piece.identity === IDENTITIES.KING
  ));
  placePiece(state, blackKing, 2, 2);

  return {
    state,
    whiteRook,
    blackKing,
    blackRook,
  };
}

describe('ML engine pending-move resolution', () => {
  test('generates follow-up moves from the resolved board, not the stale pending board', () => {
    const { state } = createPendingCaptureState();

    const legal = getLegalActions(state, BLACK);

    expect(legal.some((action) => action.type === 'CHALLENGE')).toBe(true);
    expect(legal.some((action) => (
      action.type === 'MOVE'
      && action.from?.row === 2
      && action.from?.col === 2
    ))).toBe(false);
    expect(legal.some((action) => (
      action.type === 'MOVE'
      && action.from?.row === 5
      && action.from?.col === 2
      && action.to?.row === 2
      && action.to?.col === 2
      && action.declaration === IDENTITIES.ROOK
    ))).toBe(true);
  });

  test('applies a follow-up move after implicitly resolving the previous pending move', () => {
    const { state, whiteRook, blackKnight, blackRook } = createPendingCaptureState();
    const captureAction = getLegalActions(state, BLACK).find((action) => (
      action.type === 'MOVE'
      && action.from?.row === 5
      && action.from?.col === 2
      && action.to?.row === 2
      && action.to?.col === 2
      && action.declaration === IDENTITIES.ROOK
    ));

    expect(captureAction).toBeTruthy();

    const nextState = applyAction(state, captureAction);

    expect(nextState.moves).toHaveLength(2);
    expect(nextState.actions).toHaveLength(2);
    expect(nextState.moves[0]).toMatchObject({
      player: WHITE,
      state: MOVE_STATES.RESOLVED,
    });
    expect(nextState.moves[1]).toMatchObject({
      player: BLACK,
      pieceId: blackRook.id,
      from: { row: 5, col: 2 },
      to: { row: 2, col: 2 },
      declaration: IDENTITIES.ROOK,
      state: MOVE_STATES.PENDING,
    });
    expect(nextState.playerTurn).toBe(WHITE);
    expect(nextState.board[1][1]).toBeNull();
    expect(nextState.board[2][2]).toBe(whiteRook.id);
    expect(nextState.captured[WHITE]).toEqual([blackKnight.id]);
  });

  test('suppresses follow-up moves when the implicit resolution would already end the game', () => {
    const { state } = createPendingKingCaptureState();

    const legal = getLegalActions(state, BLACK);

    expect(legal.some((action) => action.type === 'CHALLENGE')).toBe(true);
    expect(legal.some((action) => action.type === 'MOVE')).toBe(false);
  });
});
