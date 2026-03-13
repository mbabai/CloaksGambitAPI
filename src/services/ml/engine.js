const gameConstants = require('../../../shared/constants/game.json');
const {
  NO_PIECE,
  ensureEncodedState,
  computeEncodedStateHash,
  getMoveTemplatesForSquare,
  squareToIndex,
  indexToSquare,
} = require('./stateEncoding');

const COLORS = gameConstants.colors;
const IDENTITIES = gameConstants.identities;
const ACTIONS = gameConstants.actions;
const MOVE_STATES = gameConstants.moveStates;
const BOARD_DIMENSIONS = gameConstants.boardDimensions;

const RANKS = BOARD_DIMENSIONS.RANKS;
const FILES = BOARD_DIMENSIONS.FILES;

const WHITE = COLORS.WHITE;
const BLACK = COLORS.BLACK;

const DECLARABLE_IDENTITIES = Object.freeze([
  IDENTITIES.KING,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
]);

const PIECE_POOL_BY_COLOR = Object.freeze([
  IDENTITIES.ROOK,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
  IDENTITIES.KNIGHT,
  IDENTITIES.KING,
  IDENTITIES.BOMB,
]);

const IDENTITY_COUNTS = Object.freeze({
  [IDENTITIES.KING]: 1,
  [IDENTITIES.BOMB]: 1,
  [IDENTITIES.BISHOP]: 2,
  [IDENTITIES.ROOK]: 2,
  [IDENTITIES.KNIGHT]: 2,
});

const PIECE_VALUES = Object.freeze({
  [IDENTITIES.KING]: 10,
  [IDENTITIES.BOMB]: 4.3,
  [IDENTITIES.BISHOP]: 3.3,
  [IDENTITIES.ROOK]: 3.8,
  [IDENTITIES.KNIGHT]: 3.6,
  [IDENTITIES.UNKNOWN]: 0,
});

function createRng(seed) {
  let t = Number(seed) || Date.now();
  if (!Number.isFinite(t)) {
    t = Date.now();
  }
  let state = (t >>> 0) + 0x6d2b79f5;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rng, minInclusive, maxInclusive) {
  const low = Number(minInclusive);
  const high = Number(maxInclusive);
  return Math.floor(rng() * (high - low + 1)) + low;
}

function shuffle(source, rng) {
  const values = Array.isArray(source) ? source.slice() : [];
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, 0, i);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function createEmptyBoard() {
  return Array.from({ length: RANKS }, () => Array.from({ length: FILES }, () => null));
}

function otherColor(color) {
  return color === WHITE ? BLACK : WHITE;
}

function isInside(row, col) {
  return row >= 0 && row < RANKS && col >= 0 && col < FILES;
}

function equalsSquare(a, b) {
  if (!a || !b) return false;
  return a.row === b.row && a.col === b.col;
}

function createPiece(id, color, identity) {
  return {
    id,
    color,
    identity,
    alive: true,
    zone: 'stash',
    row: -1,
    col: -1,
    capturedBy: null,
  };
}

function toPieceView(piece) {
  if (!piece) return null;
  return {
    id: piece.id,
    color: piece.color,
    identity: piece.identity,
    zone: piece.zone,
    row: piece.row,
    col: piece.col,
  };
}

function createInitialState(options = {}) {
  const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
  const maxPlies = Number.isFinite(options.maxPlies) && options.maxPlies > 0
    ? Math.floor(options.maxPlies)
    : 200;
  const rng = createRng(seed);

  const board = createEmptyBoard();
  const pieces = {};
  const stashes = [[], []];
  const onDecks = [null, null];
  const moveHistoryByPiece = {};
  const revealedIdentities = {};
  const columns = Array.from({ length: FILES }, (_, idx) => idx);

  [WHITE, BLACK].forEach((color) => {
    const ids = PIECE_POOL_BY_COLOR.map((identity, idx) => {
      const id = `${color === WHITE ? 'w' : 'b'}-${idx}`;
      pieces[id] = createPiece(id, color, identity);
      moveHistoryByPiece[id] = [];
      return id;
    });

    const kingId = ids.find((id) => pieces[id].identity === IDENTITIES.KING);
    const nonKingIds = ids.filter((id) => id !== kingId);
    const shuffledOthers = shuffle(nonKingIds, rng);
    const boardIds = [kingId, ...shuffledOthers.slice(0, 4)];
    const reserves = shuffledOthers.slice(4);
    const onDeckId = reserves[0] || null;
    const stashIds = reserves.slice(1);

    const homeRow = color === WHITE ? 0 : (RANKS - 1);
    const shuffledCols = shuffle(columns, rng);
    boardIds.forEach((pieceId, index) => {
      const col = shuffledCols[index];
      board[homeRow][col] = pieceId;
      const piece = pieces[pieceId];
      piece.zone = 'board';
      piece.row = homeRow;
      piece.col = col;
    });

    if (onDeckId) {
      onDecks[color] = onDeckId;
      pieces[onDeckId].zone = 'onDeck';
      pieces[onDeckId].row = -1;
      pieces[onDeckId].col = -1;
    }

    stashIds.forEach((pieceId) => {
      stashes[color].push(pieceId);
      pieces[pieceId].zone = 'stash';
    });
  });

  return {
    board,
    pieces,
    stashes,
    onDecks,
    captured: [[], []],
    moves: [],
    actions: [],
    daggers: [0, 0],
    movesSinceAction: 0,
    setupComplete: [true, true],
    playersReady: [true, true],
    onDeckingPlayer: null,
    playerTurn: WHITE,
    toMove: WHITE,
    winner: null,
    winReason: null,
    isActive: true,
    ply: 0,
    maxPlies,
    seed,
    moveHistoryByPiece,
    revealedIdentities,
  };
}

function cloneState(state) {
  const board = state.board.map((row) => row.slice());
  const pieces = {};
  Object.keys(state.pieces || {}).forEach((id) => {
    pieces[id] = { ...state.pieces[id] };
  });
  const moveHistoryByPiece = {};
  Object.keys(state.moveHistoryByPiece || {}).forEach((id) => {
    moveHistoryByPiece[id] = (state.moveHistoryByPiece[id] || []).map((entry) => ({ ...entry }));
  });
  return {
    ...state,
    board,
    pieces,
    stashes: (state.stashes || [[], []]).map((stash) => stash.slice()),
    onDecks: (state.onDecks || [null, null]).slice(),
    captured: (state.captured || [[], []]).map((arr) => arr.slice()),
    moves: (state.moves || []).map((move) => ({
      ...move,
      from: move.from ? { ...move.from } : null,
      to: move.to ? { ...move.to } : null,
    })),
    actions: (state.actions || []).map((action) => ({
      ...action,
      details: action.details ? { ...action.details } : {},
    })),
    daggers: (state.daggers || [0, 0]).slice(),
    setupComplete: (state.setupComplete || [true, true]).slice(),
    playersReady: (state.playersReady || [true, true]).slice(),
    moveHistoryByPiece,
    revealedIdentities: { ...(state.revealedIdentities || {}) },
  };
}

function getStateCache(state) {
  if (!state || typeof state !== 'object') return {};
  if (!Object.prototype.hasOwnProperty.call(state, '__mlCache')) {
    Object.defineProperty(state, '__mlCache', {
      value: {},
      configurable: true,
      enumerable: false,
      writable: true,
    });
  }
  return state.__mlCache;
}

function getPieceAt(state, row, col) {
  if (!isInside(row, col)) return null;
  const pieceId = state.board[row][col];
  if (!pieceId) return null;
  return state.pieces[pieceId] || null;
}

function getPieceIdAt(state, row, col) {
  if (!isInside(row, col)) return null;
  return state.board[row][col] || null;
}

function getLastMove(state) {
  if (!Array.isArray(state.moves) || !state.moves.length) return null;
  return state.moves[state.moves.length - 1];
}

function getLastAction(state) {
  if (!Array.isArray(state.actions) || !state.actions.length) return null;
  return state.actions[state.actions.length - 1];
}

function removeFromArray(array, value) {
  if (!Array.isArray(array)) return false;
  const index = array.indexOf(value);
  if (index === -1) return false;
  array.splice(index, 1);
  return true;
}

function removePieceFromZones(state, pieceId) {
  if (!pieceId) return;
  const piece = state.pieces[pieceId];
  if (!piece) return;

  if (piece.zone === 'board' && isInside(piece.row, piece.col)) {
    if (state.board[piece.row][piece.col] === pieceId) {
      state.board[piece.row][piece.col] = null;
    }
  }

  if (piece.zone === 'stash') {
    removeFromArray(state.stashes[piece.color], pieceId);
  } else if (piece.zone === 'onDeck') {
    if (state.onDecks[piece.color] === pieceId) {
      state.onDecks[piece.color] = null;
    }
  } else if (piece.zone === 'captured') {
    if (piece.capturedBy === WHITE || piece.capturedBy === BLACK) {
      removeFromArray(state.captured[piece.capturedBy], pieceId);
    } else {
      removeFromArray(state.captured[WHITE], pieceId);
      removeFromArray(state.captured[BLACK], pieceId);
    }
  }
}

function placePieceOnBoard(state, pieceId, row, col) {
  if (!pieceId) {
    if (isInside(row, col)) {
      state.board[row][col] = null;
    }
    return;
  }
  const piece = state.pieces[pieceId];
  if (!piece) return;
  removePieceFromZones(state, pieceId);
  state.board[row][col] = pieceId;
  piece.zone = 'board';
  piece.row = row;
  piece.col = col;
  piece.alive = true;
  piece.capturedBy = null;
}

function movePieceToStash(state, pieceId, color) {
  if (!pieceId) return;
  const piece = state.pieces[pieceId];
  if (!piece) return;
  removePieceFromZones(state, pieceId);
  if (!state.stashes[color].includes(pieceId)) {
    state.stashes[color].push(pieceId);
  }
  piece.zone = 'stash';
  piece.row = -1;
  piece.col = -1;
  piece.alive = true;
  piece.capturedBy = null;
}

function movePieceToOnDeck(state, pieceId, color) {
  if (!pieceId) return;
  const piece = state.pieces[pieceId];
  if (!piece) return;
  removePieceFromZones(state, pieceId);
  state.onDecks[color] = pieceId;
  piece.zone = 'onDeck';
  piece.row = -1;
  piece.col = -1;
  piece.alive = true;
  piece.capturedBy = null;
}

function capturePiece(state, pieceId, captorColor) {
  if (!pieceId) return null;
  const piece = state.pieces[pieceId];
  if (!piece || !piece.alive) return null;

  removePieceFromZones(state, pieceId);
  piece.alive = false;
  piece.zone = 'captured';
  piece.row = -1;
  piece.col = -1;
  piece.capturedBy = captorColor;
  if (!state.captured[captorColor].includes(pieceId)) {
    state.captured[captorColor].push(pieceId);
  }
  return piece;
}

function syncTurn(state) {
  state.toMove = state.playerTurn;
}

function endGame(state, winner, reason) {
  state.winner = winner;
  state.winReason = reason;
  state.isActive = false;
  syncTurn(state);
}

function addAction(state, type, player, details = {}) {
  state.actions.push({
    type,
    player,
    timestamp: state.ply,
    details: { ...(details || {}) },
  });
}

function isLineClear(state, from, to) {
  const dr = Math.sign(to.row - from.row);
  const dc = Math.sign(to.col - from.col);
  let row = from.row + dr;
  let col = from.col + dc;
  while (row !== to.row || col !== to.col) {
    if (!isInside(row, col)) return false;
    if (state.board[row][col]) return false;
    row += dr;
    col += dc;
  }
  return true;
}

function declarationLegalByGeometry(state, from, to, declaration) {
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
    return isLineClear(state, from, to);
  }
  if (declaration === IDENTITIES.ROOK) {
    if (!((dr === 0 || dc === 0) && absDr <= 3 && absDc <= 3)) return false;
    return isLineClear(state, from, to);
  }
  return false;
}

function getDeclaredMoveActionsForColor(state, color) {
  if (!state || !state.isActive) return [];
  const cache = getStateCache(state);
  if (cache.declaredMoveActionsByColor?.[color]) {
    return cache.declaredMoveActionsByColor[color];
  }

  const encoded = ensureEncodedState(state);
  const actions = [];
  const boardMask = encoded.boardMaskByColor[color] >>> 0;

  for (let squareIndex = 0; squareIndex < boardPieceIndicesLength(encoded); squareIndex += 1) {
    if ((boardMask & (1 << squareIndex)) === 0) continue;
    const pieceIndex = encoded.boardPieceIndices[squareIndex];
    if (pieceIndex === NO_PIECE) continue;
    const pieceId = encoded.pieceIds[pieceIndex];
    const from = indexToSquare(squareIndex);

    DECLARABLE_IDENTITIES.forEach((declaration) => {
      const templates = getMoveTemplatesForSquare(squareIndex, declaration);
      templates.forEach((template) => {
        if ((encoded.occupancyMask & template.blockersMask) !== 0) {
          return;
        }
        const targetPieceIndex = encoded.boardPieceIndices[template.toIndex];
        if (targetPieceIndex !== NO_PIECE && encoded.pieceColor[targetPieceIndex] === color) {
          return;
        }
        const capturePieceId = targetPieceIndex !== NO_PIECE
          ? encoded.pieceIds[targetPieceIndex]
          : null;
        actions.push({
          type: 'MOVE',
          player: color,
          pieceId,
          from,
          to: { row: template.toRow, col: template.toCol },
          declaration,
          capturePieceId,
          _key: `M:${pieceId}:${squareIndex}:${template.toIndex}:${declaration}`,
        });
      });
    });
  }

  cache.declaredMoveActionsByColor = cache.declaredMoveActionsByColor || [null, null];
  cache.declaredMoveActionsByColor[color] = actions;
  return actions;
}

function countDeclaredMoveOptionsForColorEncoded(state, color) {
  const encoded = ensureEncodedState(state);
  const boardMask = encoded.boardMaskByColor[color] >>> 0;
  let count = 0;

  for (let squareIndex = 0; squareIndex < boardPieceIndicesLength(encoded); squareIndex += 1) {
    if ((boardMask & (1 << squareIndex)) === 0) continue;

    DECLARABLE_IDENTITIES.forEach((declaration) => {
      const templates = getMoveTemplatesForSquare(squareIndex, declaration);
      templates.forEach((template) => {
        if ((encoded.occupancyMask & template.blockersMask) !== 0) {
          return;
        }
        const targetPieceIndex = encoded.boardPieceIndices[template.toIndex];
        if (targetPieceIndex !== NO_PIECE && encoded.pieceColor[targetPieceIndex] === color) {
          return;
        }
        count += 1;
      });
    });
  }

  return count;
}

function countMoveOptionsForColor(state, color) {
  const cache = getStateCache(state);
  cache.moveOptionCountsByColor = cache.moveOptionCountsByColor || [null, null];
  if (Number.isFinite(cache.moveOptionCountsByColor[color])) {
    return cache.moveOptionCountsByColor[color];
  }
  const count = countDeclaredMoveOptionsForColorEncoded(state, color);
  cache.moveOptionCountsByColor[color] = count;
  return count;
}

function canChallenge(state, color) {
  if (!state || !state.isActive) return false;
  if (state.playerTurn !== color) return false;
  if (state.onDeckingPlayer === color) return false;
  const lastAction = getLastAction(state);
  if (!lastAction) return false;
  const lastMove = getLastMove(state);
  if (!lastMove) return false;
  if (lastAction.type === ACTIONS.MOVE) {
    return lastMove.state === MOVE_STATES.PENDING;
  }
  if (lastAction.type === ACTIONS.BOMB) {
    return true;
  }
  return false;
}

function canBomb(state, color) {
  if (!state || !state.isActive) return false;
  if (state.playerTurn !== color) return false;
  const lastAction = getLastAction(state);
  if (!lastAction || lastAction.type !== ACTIONS.MOVE) return false;
  const lastMove = getLastMove(state);
  if (!lastMove) return false;
  const pieceAtTarget = getPieceAt(state, lastMove.to.row, lastMove.to.col);
  if (!pieceAtTarget || pieceAtTarget.color !== color) return false;
  if (lastMove.declaration === IDENTITIES.KING) return false;
  return true;
}

function canPass(state, color) {
  if (!state || !state.isActive) return false;
  if (state.playerTurn !== color) return false;
  const lastAction = getLastAction(state);
  if (!lastAction || lastAction.type !== ACTIONS.BOMB) return false;
  const lastMove = getLastMove(state);
  if (!lastMove) return false;
  const piece = getPieceAt(state, lastMove.from.row, lastMove.from.col);
  return Boolean(piece);
}

function getLegalActions(state, color = state.playerTurn) {
  if (!state || !state.isActive) return [];
  if (color !== state.playerTurn) return [];

  const cache = getStateCache(state);
  cache.legalActionsByColor = cache.legalActionsByColor || [null, null];
  if (cache.legalActionsByColor[color]) {
    return cache.legalActionsByColor[color];
  }

  if (state.onDeckingPlayer === color) {
    const stash = state.stashes[color] || [];
    const actions = stash
      .map((pieceId) => {
        const piece = state.pieces[pieceId];
        if (!piece || !piece.alive) return null;
        return {
          type: 'ON_DECK',
          player: color,
          pieceId,
          identity: piece.identity,
          _key: `O:${pieceId || piece.identity || 'x'}`,
        };
      })
      .filter(Boolean);
    cache.legalActionsByColor[color] = actions;
    return actions;
  }

  const actions = [];
  const lastAction = getLastAction(state);

  if (lastAction && lastAction.type === ACTIONS.BOMB) {
    if (canChallenge(state, color)) actions.push({ type: 'CHALLENGE', player: color });
    if (canPass(state, color)) actions.push({ type: 'PASS', player: color });
    return actions;
  }

  if (canChallenge(state, color)) actions.push({ type: 'CHALLENGE', player: color });
  if (canBomb(state, color)) actions.push({ type: 'BOMB', player: color });
  actions.push(...getDeclaredMoveActionsForColor(state, color));
  cache.legalActionsByColor[color] = actions;
  return actions;
}

function getLegalMoves(state, color = state.playerTurn) {
  return getLegalActions(state, color).filter((action) => action.type === 'MOVE');
}

function updateMoveHistoryEntry(state, pieceId, patch = {}) {
  const entries = state.moveHistoryByPiece[pieceId];
  if (!Array.isArray(entries) || !entries.length) return;
  const last = entries[entries.length - 1];
  Object.assign(last, patch);
}

function appendMoveHistory(state, move) {
  if (!move || !move.pieceId) return;
  if (!Array.isArray(state.moveHistoryByPiece[move.pieceId])) {
    state.moveHistoryByPiece[move.pieceId] = [];
  }
  const from = move.from || { row: -1, col: -1 };
  const to = move.to || { row: -1, col: -1 };
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  state.moveHistoryByPiece[move.pieceId].push({
    turnIndex: state.ply,
    from: { ...from },
    to: { ...to },
    dr,
    dc,
    declaration: move.declaration,
    capture: Boolean(move.capturePieceId),
    resolvedState: move.state,
  });
}

function resolveMove(state, move) {
  if (!move) return false;
  const from = move.from;
  const to = move.to;
  if (!from || !to) return false;
  if (!isInside(from.row, from.col) || !isInside(to.row, to.col)) return false;

  const movingPieceId = state.board[from.row][from.col];
  if (!movingPieceId) return false;
  const movingPiece = state.pieces[movingPieceId];
  if (!movingPiece || !movingPiece.alive) return false;

  const targetPieceId = state.board[to.row][to.col];
  let targetPiece = null;
  if (targetPieceId) {
    targetPiece = capturePiece(state, targetPieceId, move.player);
  }

  placePieceOnBoard(state, movingPieceId, to.row, to.col);
  state.board[from.row][from.col] = null;
  move.state = MOVE_STATES.RESOLVED;
  updateMoveHistoryEntry(state, movingPieceId, {
    resolvedState: MOVE_STATES.RESOLVED,
    capture: Boolean(targetPiece),
  });

  if (targetPiece && targetPiece.identity === IDENTITIES.KING) {
    endGame(state, move.player, 'capture_king');
    return true;
  }

  if (move.declaration === IDENTITIES.KING) {
    const throneRow = move.player === WHITE ? (RANKS - 1) : 0;
    if (to.row === throneRow) {
      endGame(state, move.player, 'throne');
      return true;
    }
  }

  if (targetPiece) {
    state.movesSinceAction = 0;
  } else {
    state.movesSinceAction += 1;
    if (state.movesSinceAction >= 20 && state.isActive) {
      endGame(state, null, 'draw');
      return true;
    }
  }

  return !state.isActive;
}

function validateMoveAction(state, action) {
  if (!action) return { ok: false };
  const color = action.player;
  const from = action.from || {};
  const to = action.to || {};
  const declaration = action.declaration;

  if (color !== WHITE && color !== BLACK) return { ok: false };
  if (state.playerTurn !== color) return { ok: false };
  if (!state.setupComplete[WHITE] || !state.setupComplete[BLACK]) return { ok: false };
  if (state.onDeckingPlayer === color) return { ok: false };

  const lastAction = getLastAction(state);
  if (lastAction && lastAction.type === ACTIONS.BOMB) return { ok: false };

  if (!isInside(from.row, from.col) || !isInside(to.row, to.col)) return { ok: false };
  const piece = getPieceAt(state, from.row, from.col);
  if (!piece || piece.color !== color) return { ok: false };
  const target = getPieceAt(state, to.row, to.col);
  if (target && target.color === color) return { ok: false };
  if (declaration === IDENTITIES.BOMB) return { ok: false };
  if (!DECLARABLE_IDENTITIES.includes(declaration)) return { ok: false };
  if (!declarationLegalByGeometry(state, from, to, declaration)) return { ok: false };
  return {
    ok: true,
    piece,
    target,
  };
}

function applyMoveAction(state, action) {
  const validation = validateMoveAction(state, action);
  if (!validation.ok) return false;

  const color = action.player;
  const from = { ...action.from };
  const to = { ...action.to };
  const declaration = action.declaration;
  const pieceId = validation.piece.id;

  let earlyResolved = false;
  if (state.moves.length > 0) {
    const prevMove = state.moves[state.moves.length - 1];
    if (
      prevMove
      && prevMove.state === MOVE_STATES.PENDING
      && prevMove.player !== color
      && equalsSquare(prevMove.to, to)
    ) {
      earlyResolved = true;
      const endedEarly = resolveMove(state, prevMove);
      if (endedEarly) {
        state.ply += 1;
        syncTurn(state);
        return true;
      }
    }
  }

  const checkAfterResolution = validateMoveAction(state, action);
  if (!checkAfterResolution.ok) return false;

  const move = {
    player: color,
    pieceId,
    from,
    to,
    declaration,
    state: MOVE_STATES.PENDING,
    timestamp: state.ply,
  };
  state.moves.push(move);
  appendMoveHistory(state, move);

  if (!earlyResolved && state.moves.length > 1) {
    const prevMove = state.moves[state.moves.length - 2];
    if (prevMove && prevMove.state === MOVE_STATES.PENDING) {
      const ended = resolveMove(state, prevMove);
      if (ended) {
        state.ply += 1;
        syncTurn(state);
        return true;
      }
    }
  }

  state.playerTurn = otherColor(color);
  addAction(state, ACTIONS.MOVE, color, {
    from: { ...from },
    to: { ...to },
    declaration,
  });
  state.ply += 1;
  syncTurn(state);
  return true;
}

function applyBombAction(state, action) {
  const color = action.player;
  if (!state.isActive) return false;
  if (state.playerTurn !== color) return false;
  const lastAction = getLastAction(state);
  if (!lastAction || lastAction.type !== ACTIONS.MOVE) return false;
  const lastMove = getLastMove(state);
  if (!lastMove) return false;
  const pieceAtTarget = getPieceAt(state, lastMove.to.row, lastMove.to.col);
  if (!pieceAtTarget || pieceAtTarget.color !== color) return false;
  if (lastMove.declaration === IDENTITIES.KING) return false;

  addAction(state, ACTIONS.BOMB, color, {});
  state.playerTurn = otherColor(color);
  state.ply += 1;
  syncTurn(state);
  return true;
}

function applyPassAction(state, action) {
  const color = action.player;
  if (!state.isActive) return false;
  if (state.playerTurn !== color) return false;
  const lastAction = getLastAction(state);
  if (!lastAction || lastAction.type !== ACTIONS.BOMB) return false;
  const lastMove = getLastMove(state);
  if (!lastMove) return false;
  const piece = getPieceAt(state, lastMove.from.row, lastMove.from.col);
  if (!piece) return false;

  const captured = capturePiece(state, piece.id, color);
  lastMove.state = MOVE_STATES.RESOLVED;
  updateMoveHistoryEntry(state, lastMove.pieceId, {
    resolvedState: MOVE_STATES.RESOLVED,
  });

  state.playerTurn = otherColor(color);
  addAction(state, ACTIONS.PASS, color, {});
  state.movesSinceAction = 0;

  if (captured && captured.identity === IDENTITIES.KING && state.isActive) {
    endGame(state, otherColor(color), 'capture_king');
  }

  state.ply += 1;
  syncTurn(state);
  return true;
}

function applyChallengeAction(state, action) {
  const challenger = action.player;
  if (!state.isActive) return false;
  if (state.playerTurn !== challenger) return false;
  if (state.onDeckingPlayer === challenger) return false;

  const lastAction = getLastAction(state);
  const lastMove = getLastMove(state);
  if (!lastAction || !lastMove) return false;
  if (lastAction.type !== ACTIONS.MOVE && lastAction.type !== ACTIONS.BOMB) return false;
  if (lastAction.type === ACTIONS.MOVE && lastMove.state !== MOVE_STATES.PENDING) return false;

  let capturedPieceId = null;
  let captureBy = null;
  let trueKing = false;
  let wasSuccessful = false;

  if (lastAction.type === ACTIONS.MOVE) {
    const from = lastMove.from;
    const to = lastMove.to;
    if (!isInside(from.row, from.col) || !isInside(to.row, to.col)) return false;
    const pieceFrom = getPieceAt(state, from.row, from.col);
    const pieceTo = getPieceAt(state, to.row, to.col);
    if (!pieceFrom) return false;

    if (pieceFrom.identity !== lastMove.declaration) {
      capturePiece(state, pieceFrom.id, challenger);
      capturedPieceId = pieceFrom.id;
      captureBy = challenger;
      lastMove.state = MOVE_STATES.RESOLVED;
      updateMoveHistoryEntry(state, lastMove.pieceId, {
        resolvedState: MOVE_STATES.RESOLVED,
        revealedIdentity: pieceFrom.identity,
      });
      state.revealedIdentities[pieceFrom.id] = pieceFrom.identity;
      wasSuccessful = true;
      state.onDeckingPlayer = null;
    } else {
      lastMove.state = MOVE_STATES.COMPLETED;
      updateMoveHistoryEntry(state, lastMove.pieceId, {
        resolvedState: MOVE_STATES.COMPLETED,
        truthfulChallenge: true,
        revealedIdentity: pieceFrom.identity,
      });
      state.daggers[challenger] += 1;
      state.revealedIdentities[pieceFrom.id] = pieceFrom.identity;

      if (
        lastMove.declaration === IDENTITIES.KING
        && pieceFrom.identity === IDENTITIES.KING
      ) {
        trueKing = true;
      }

      if (pieceTo && pieceTo.color !== pieceFrom.color) {
        capturePiece(state, pieceTo.id, lastMove.player);
        capturedPieceId = pieceTo.id;
        captureBy = lastMove.player;
      }

      movePieceToStash(state, pieceFrom.id, lastMove.player);
      const deckPieceId = state.onDecks[lastMove.player];
      state.onDecks[lastMove.player] = null;
      if (deckPieceId) {
        placePieceOnBoard(state, deckPieceId, to.row, to.col);
      } else {
        state.board[to.row][to.col] = null;
      }

      state.onDeckingPlayer = otherColor(challenger);
      state.playerTurn = otherColor(challenger);
    }
  } else if (lastAction.type === ACTIONS.BOMB) {
    const from = lastMove.from;
    const to = lastMove.to;
    if (!isInside(from.row, from.col) || !isInside(to.row, to.col)) return false;
    const pieceFrom = getPieceAt(state, from.row, from.col);
    const pieceTo = getPieceAt(state, to.row, to.col);
    if (!pieceFrom) return false;

    if (!pieceTo || pieceTo.identity !== IDENTITIES.BOMB) {
      if (pieceTo) {
        capturePiece(state, pieceTo.id, lastMove.player);
        capturedPieceId = pieceTo.id;
        captureBy = lastMove.player;
        state.daggers[pieceTo.color] += 1;
      }
      placePieceOnBoard(state, pieceFrom.id, to.row, to.col);
      state.board[from.row][from.col] = null;
      lastMove.state = MOVE_STATES.RESOLVED;
      updateMoveHistoryEntry(state, lastMove.pieceId, {
        resolvedState: MOVE_STATES.RESOLVED,
      });
      wasSuccessful = true;
      state.onDeckingPlayer = null;
    } else {
      state.revealedIdentities[pieceTo.id] = IDENTITIES.BOMB;
      movePieceToStash(state, pieceTo.id, pieceTo.color);
      const deckPieceId = state.onDecks[pieceTo.color];
      state.onDecks[pieceTo.color] = null;
      if (deckPieceId) {
        placePieceOnBoard(state, deckPieceId, to.row, to.col);
      } else {
        state.board[to.row][to.col] = null;
      }

      state.onDeckingPlayer = otherColor(challenger);
      state.playerTurn = otherColor(challenger);

      capturePiece(state, pieceFrom.id, otherColor(challenger));
      capturedPieceId = pieceFrom.id;
      captureBy = pieceTo.color;
      state.daggers[challenger] += 1;
      lastMove.state = MOVE_STATES.COMPLETED;
      updateMoveHistoryEntry(state, lastMove.pieceId, {
        resolvedState: MOVE_STATES.COMPLETED,
      });
      wasSuccessful = false;
    }
  }

  if (state.onDeckingPlayer !== null) {
    state.playerTurn = state.onDeckingPlayer;
  } else {
    state.playerTurn = otherColor(lastMove.player);
  }

  addAction(state, ACTIONS.CHALLENGE, challenger, {
    outcome: wasSuccessful ? 'SUCCESS' : 'FAIL',
  });
  state.movesSinceAction = 0;

  if (trueKing && state.isActive) {
    endGame(state, lastMove.player, 'true_king');
  }

  if (capturedPieceId) {
    const capturedPiece = state.pieces[capturedPieceId];
    if (capturedPiece && capturedPiece.identity === IDENTITIES.KING && state.isActive) {
      endGame(state, captureBy, 'capture_king');
    }
  }

  if (state.isActive && (state.daggers[WHITE] >= 3 || state.daggers[BLACK] >= 3)) {
    const loser = state.daggers[WHITE] >= 3 ? WHITE : BLACK;
    endGame(state, otherColor(loser), 'daggers');
  }

  state.ply += 1;
  syncTurn(state);
  return true;
}

function applyOnDeckAction(state, action) {
  const color = action.player;
  if (!state.isActive) return false;
  if (color !== WHITE && color !== BLACK) return false;
  if (state.playerTurn !== color && state.onDeckingPlayer !== color) return false;
  if (state.onDeckingPlayer !== color) return false;

  const stash = state.stashes[color] || [];
  if (!stash.length) return false;
  let pieceId = action.pieceId || null;
  if (pieceId && !stash.includes(pieceId)) {
    pieceId = null;
  }
  if (!pieceId && Number.isFinite(action.identity)) {
    pieceId = stash.find((id) => state.pieces[id] && state.pieces[id].identity === action.identity) || null;
  }
  if (!pieceId) {
    pieceId = stash[0];
  }
  if (!pieceId) return false;

  movePieceToOnDeck(state, pieceId, color);
  state.onDeckingPlayer = null;

  if (state.moves.length > 0) {
    const lastMove = state.moves[state.moves.length - 1];
    lastMove.state = MOVE_STATES.RESOLVED;
    updateMoveHistoryEntry(state, lastMove.pieceId, {
      resolvedState: MOVE_STATES.RESOLVED,
    });
    state.playerTurn = otherColor(lastMove.player);
  }

  addAction(state, ACTIONS.ON_DECK, color, {
    identity: state.pieces[pieceId].identity,
  });
  state.ply += 1;
  syncTurn(state);
  return true;
}

function normalizeAction(rawAction, playerTurn) {
  const action = rawAction || {};
  const type = typeof action.type === 'string'
    ? action.type.toUpperCase()
    : action.type;
  const player = Number.isFinite(action.player) ? action.player : playerTurn;

  if (type === 'MOVE') {
    return {
      type: 'MOVE',
      player,
      pieceId: action.pieceId || null,
      from: action.from ? { row: action.from.row, col: action.from.col } : null,
      to: action.to ? { row: action.to.row, col: action.to.col } : null,
      declaration: action.declaration,
    };
  }
  if (type === 'CHALLENGE') return { type: 'CHALLENGE', player };
  if (type === 'BOMB') return { type: 'BOMB', player };
  if (type === 'PASS') return { type: 'PASS', player };
  if (type === 'ON_DECK') {
    return {
      type: 'ON_DECK',
      player,
      pieceId: action.pieceId || null,
      identity: action.identity,
    };
  }
  return { type: null, player };
}

function applyAction(state, rawAction) {
  const next = cloneState(state);
  if (!next.isActive) return next;
  const action = normalizeAction(rawAction, next.playerTurn);
  let applied = false;

  if (action.type === 'MOVE') {
    applied = applyMoveAction(next, action);
  } else if (action.type === 'CHALLENGE') {
    applied = applyChallengeAction(next, action);
  } else if (action.type === 'BOMB') {
    applied = applyBombAction(next, action);
  } else if (action.type === 'PASS') {
    applied = applyPassAction(next, action);
  } else if (action.type === 'ON_DECK') {
    applied = applyOnDeckAction(next, action);
  }

  if (!applied) return next;

  if (next.isActive && next.ply >= next.maxPlies) {
    endGame(next, null, 'draw');
  }
  syncTurn(next);
  return next;
}

function actionKey(action) {
  if (!action || !action.type) return '';
  if (action._key) return action._key;
  if (action.type === 'MOVE') {
    const fromIndex = squareToIndex(action?.from?.row, action?.from?.col);
    const toIndex = squareToIndex(action?.to?.row, action?.to?.col);
    return `M:${action.pieceId}:${fromIndex}:${toIndex}:${action.declaration}`;
  }
  if (action.type === 'ON_DECK') {
    return `O:${action.pieceId || action.identity || 'x'}`;
  }
  if (action.type === 'CHALLENGE') return 'C';
  if (action.type === 'BOMB') return 'B';
  if (action.type === 'PASS') return 'P';
  return String(action.type);
}

function hasAliveKing(state, color) {
  return Object.values(state.pieces || {}).some((piece) => (
    piece && piece.alive && piece.color === color && piece.identity === IDENTITIES.KING
  ));
}

function getAlivePieceIdsForColor(state, color) {
  const encoded = ensureEncodedState(state);
  return encoded.alivePieceIdsByColor[color].slice();
}

function getHiddenPieceIds(state, perspective) {
  const encoded = ensureEncodedState(state);
  return encoded.hiddenPieceIdsByPerspective[perspective].slice();
}

function getVisibleIdentity(state, piece, perspective, guessedIdentities = null) {
  if (!piece) return IDENTITIES.UNKNOWN;
  if (piece.color === perspective) return piece.identity;
  const revealed = state.revealedIdentities?.[piece.id];
  if (Number.isFinite(revealed) && revealed > 0) {
    return revealed;
  }
  if (guessedIdentities && Object.prototype.hasOwnProperty.call(guessedIdentities, piece.id)) {
    return guessedIdentities[piece.id];
  }
  return IDENTITIES.UNKNOWN;
}

function serializeBoardWithTruth(state) {
  return state.board.map((row) => row.map((pieceId) => {
    if (!pieceId) return null;
    return toPieceView(state.pieces[pieceId]);
  }));
}

function buildPerspectiveBoard(state, perspective, guessedIdentities = null) {
  return state.board.map((row) => row.map((pieceId) => {
    if (!pieceId) return null;
    const piece = state.pieces[pieceId];
    if (!piece) return null;
    return {
      id: piece.id,
      color: piece.color,
      identity: getVisibleIdentity(state, piece, perspective, guessedIdentities),
      realIdentity: piece.identity,
    };
  }));
}

function serializePieceList(state, list, perspective = null, guessedIdentities = null) {
  return (list || []).map((pieceId) => {
    const piece = state.pieces[pieceId];
    if (!piece) return null;
    const identity = perspective === null
      ? piece.identity
      : getVisibleIdentity(state, piece, perspective, guessedIdentities);
    return {
      id: piece.id,
      color: piece.color,
      identity,
      realIdentity: piece.identity,
      zone: piece.zone,
    };
  }).filter(Boolean);
}

function summarizeMaterial(state, perspective, guessedIdentities = null) {
  const cache = getStateCache(state);
  const guessKey = getGuessKey(state, guessedIdentities);
  cache.materialSummaryByPerspective = cache.materialSummaryByPerspective || [{}, {}];
  if (cache.materialSummaryByPerspective[perspective][guessKey]) {
    return cache.materialSummaryByPerspective[perspective][guessKey];
  }

  const encoded = ensureEncodedState(state);
  let own = 0;
  let enemy = 0;
  for (let pieceIndex = 0; pieceIndex < encoded.pieceCount; pieceIndex += 1) {
    if (!encoded.pieceAlive[pieceIndex]) continue;
    const piece = state.pieces[encoded.pieceIds[pieceIndex]];
    if (!piece) continue;
    const identity = piece.color === perspective
      ? piece.identity
      : getVisibleIdentity(state, piece, perspective, guessedIdentities);
    const value = PIECE_VALUES[identity] || 0;
    if (piece.color === perspective) own += value;
    else enemy += value;
  }

  const result = { own, enemy };
  cache.materialSummaryByPerspective[perspective][guessKey] = result;
  return result;
}

function findKing(state, color) {
  const encoded = ensureEncodedState(state);
  const kingIndex = encoded.kingIndexByColor[color];
  if (kingIndex < 0) return null;
  return state.pieces[encoded.pieceIds[kingIndex]] || null;
}

function distanceToThrone(piece) {
  if (!piece) return RANKS;
  return piece.color === WHITE ? (RANKS - 1 - piece.row) : piece.row;
}

function moveCompatibilityScore(historyEntries, identity) {
  const entries = Array.isArray(historyEntries) ? historyEntries : [];
  if (!entries.length) return 1;
  let score = 0.6;
  entries.forEach((entry) => {
    if (!entry) return;
    if (entry.declaration === identity) score += 0.32;
    else score += 0.14;
    if (Number.isFinite(entry.revealedIdentity)) {
      score += entry.revealedIdentity === identity ? 2.4 : -2.8;
    }
    if (entry.truthfulChallenge === true) {
      score += entry.declaration === identity ? 0.9 : -1.5;
    }
  });
  return Math.max(0.02, score / entries.length);
}

function computeStateHash(state) {
  return computeEncodedStateHash(state);
}

function boardPieceIndicesLength(encoded) {
  return encoded?.boardPieceIndices?.length || 0;
}

function getGuessKey(state, guessedIdentities) {
  if (!guessedIdentities) return 'truth';
  const encoded = ensureEncodedState(state);
  const parts = [];
  for (let pieceIndex = 0; pieceIndex < encoded.pieceCount; pieceIndex += 1) {
    const pieceId = encoded.pieceIds[pieceIndex];
    if (!Object.prototype.hasOwnProperty.call(guessedIdentities, pieceId)) continue;
    parts.push(`${pieceIndex}:${guessedIdentities[pieceId]}`);
  }
  return parts.length ? parts.join('|') : 'truth';
}

function toReplayFrame(state, metadata = {}) {
  return {
    ply: state.ply,
    toMove: state.playerTurn,
    winner: state.winner,
    winReason: state.winReason,
    isActive: state.isActive,
    board: serializeBoardWithTruth(state),
    onDecks: state.onDecks.map((pieceId) => (pieceId ? toPieceView(state.pieces[pieceId]) : null)),
    stashes: [
      serializePieceList(state, state.stashes[WHITE]),
      serializePieceList(state, state.stashes[BLACK]),
    ],
    captured: [
      serializePieceList(state, state.captured[WHITE]),
      serializePieceList(state, state.captured[BLACK]),
    ],
    daggers: state.daggers.slice(),
    movesSinceAction: state.movesSinceAction,
    onDeckingPlayer: state.onDeckingPlayer,
    lastMove: getLastMove(state) ? { ...getLastMove(state) } : null,
    lastAction: getLastAction(state) ? { ...getLastAction(state) } : null,
    ...metadata,
  };
}

module.exports = {
  COLORS,
  IDENTITIES,
  ACTIONS,
  MOVE_STATES,
  PIECE_VALUES,
  IDENTITY_COUNTS,
  DECLARABLE_IDENTITIES,
  PIECE_POOL_BY_COLOR,
  RANKS,
  FILES,
  WHITE,
  BLACK,
  createRng,
  randomInt,
  shuffle,
  createEmptyBoard,
  createInitialState,
  cloneState,
  otherColor,
  getPieceAt,
  getPieceIdAt,
  getLastMove,
  getLastAction,
  getLegalActions,
  getLegalMoves,
  countMoveOptionsForColor,
  applyAction,
  actionKey,
  isInside,
  equalsSquare,
  hasAliveKing,
  getAlivePieceIdsForColor,
  getHiddenPieceIds,
  getVisibleIdentity,
  buildPerspectiveBoard,
  summarizeMaterial,
  findKing,
  distanceToThrone,
  moveCompatibilityScore,
  serializeBoardWithTruth,
  computeStateHash,
  toReplayFrame,
};
