const gameConstants = require('../../../shared/constants/game.json');
const {
  NO_PIECE,
  ensureEncodedState,
  cloneEncodedState,
  syncEncodedPieceState,
  syncEncodedPieceReveal,
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
const SQUARE_COORDS = Array.from({ length: RANKS * FILES }, (_, index) => Object.freeze(indexToSquare(index)));

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

const INFO_ACTION_TYPES = Object.freeze({
  MOVE: 1,
  CHALLENGE: 2,
  BOMB: 3,
  PASS: 4,
  ON_DECK: 5,
});

const INFO_OUTCOMES = Object.freeze({
  SUCCESS: 1,
  FAIL: 2,
});

let infoHashSeed = 0x51ed270b;

function nextInfoHashWord() {
  infoHashSeed = (Math.imul(infoHashSeed, 1664525) + 1013904223) >>> 0;
  return infoHashSeed;
}

function createInfoHashPair() {
  return [nextInfoHashWord(), nextInfoHashWord()];
}

function xorInfoHashPair(target, pair) {
  if (!pair) return;
  target[0] = (target[0] ^ pair[0]) >>> 0;
  target[1] = (target[1] ^ pair[1]) >>> 0;
}

function cloneHashPair(pair) {
  return Array.isArray(pair) ? [pair[0] >>> 0, pair[1] >>> 0] : [0, 0];
}

function createInfoPairTable(initialSize = 0) {
  const pairs = [];
  for (let index = 0; index < initialSize; index += 1) {
    pairs.push(createInfoHashPair());
  }
  return {
    get(index) {
      const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
      while (pairs.length <= safeIndex) {
        pairs.push(createInfoHashPair());
      }
      return pairs[safeIndex];
    },
  };
}

const infoMoveIndexHash = createInfoPairTable(256);
const infoMovePieceHash = createInfoPairTable(20);
const infoMoveDeclarationHash = createInfoPairTable(16);
const infoMoveStateHash = createInfoPairTable(8);
const infoMoveSquareHash = createInfoPairTable((RANKS * FILES) + 2);
const infoMovePlayerHash = [createInfoHashPair(), createInfoHashPair()];
const infoActionIndexHash = createInfoPairTable(256);
const infoActionTypeHash = createInfoPairTable(8);
const infoActionPlayerHash = [createInfoHashPair(), createInfoHashPair()];
const infoActionDeclarationHash = createInfoPairTable(16);
const infoActionOutcomeHash = createInfoPairTable(8);
const infoActionSquareHash = createInfoPairTable((RANKS * FILES) + 2);

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

const CURRICULUM_BINOMIAL_WEIGHTS = Object.freeze([1, 4, 6, 4, 1]);
const CURRICULUM_MAX_RUNG = CURRICULUM_BINOMIAL_WEIGHTS.length - 1;
const CURRICULUM_EXPLORATION_WEIGHT = 0.1;

function normalizeCurriculumProgress(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeCurriculumGameIndex(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.floor(parsed));
}

function normalizeCurriculumCadence(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.floor(parsed));
}

function resolveCurriculumProgress(curriculum = null) {
  if (!curriculum || typeof curriculum !== 'object') return null;
  const directProgress = normalizeCurriculumProgress(curriculum.progress);
  if (directProgress !== null) {
    return {
      progress: directProgress,
      gameIndex: normalizeCurriculumGameIndex(curriculum.gameIndex),
      cadence: normalizeCurriculumCadence(curriculum.cadence),
    };
  }
  const gameIndex = normalizeCurriculumGameIndex(curriculum.gameIndex);
  const cadence = normalizeCurriculumCadence(curriculum.cadence);
  if (gameIndex === null || cadence === null) return null;
  return {
    progress: Math.max(0, Math.min(1, gameIndex / (cadence * CURRICULUM_MAX_RUNG))),
    gameIndex,
    cadence,
  };
}

function sampleWeightedIndex(weights, rng) {
  const normalizedWeights = Array.isArray(weights) ? weights : [];
  const total = normalizedWeights.reduce((sum, weight) => {
    const numericWeight = Number(weight);
    return numericWeight > 0 ? sum + numericWeight : sum;
  }, 0);
  if (total <= 0) {
    return randomInt(rng, 0, Math.max(0, normalizedWeights.length - 1));
  }
  let remaining = rng() * total;
  for (let index = 0; index < normalizedWeights.length; index += 1) {
    const weight = Number(normalizedWeights[index]);
    if (!(weight > 0)) continue;
    remaining -= weight;
    if (remaining <= 0) return index;
  }
  return Math.max(0, normalizedWeights.length - 1);
}

function sampleCurriculumRung(rng, progress) {
  const safeProgress = normalizeCurriculumProgress(progress);
  if (safeProgress === null) {
    return randomInt(rng, 0, CURRICULUM_MAX_RUNG);
  }
  const weights = CURRICULUM_BINOMIAL_WEIGHTS.map((coefficient, rung) => {
    const binomialWeight = coefficient
      * (safeProgress ** rung)
      * ((1 - safeProgress) ** (CURRICULUM_MAX_RUNG - rung));
    return ((1 - CURRICULUM_EXPLORATION_WEIGHT) * binomialWeight)
      + (CURRICULUM_EXPLORATION_WEIGHT / CURRICULUM_BINOMIAL_WEIGHTS.length);
  });
  return sampleWeightedIndex(weights, rng);
}

function getCurriculumRow(color, relativeRank) {
  return color === WHITE
    ? relativeRank
    : (RANKS - 1 - relativeRank);
}

function listCurriculumPlacementSquares(color, advanceDepth) {
  const maxRelativeRank = Math.max(0, Math.min(CURRICULUM_MAX_RUNG, Math.floor(advanceDepth)));
  const squares = [];
  for (let relativeRank = 0; relativeRank <= maxRelativeRank; relativeRank += 1) {
    const row = getCurriculumRow(color, relativeRank);
    for (let col = 0; col < FILES; col += 1) {
      squares.push({ row, col });
    }
  }
  return squares;
}

function setBoardPiece(board, pieces, pieceId, square) {
  const piece = pieces[pieceId];
  if (!piece || !square) return;
  board[square.row][square.col] = pieceId;
  piece.zone = 'board';
  piece.row = square.row;
  piece.col = square.col;
}

function setCapturedPiece(pieces, captured, revealedIdentities, pieceId, captorColor) {
  const piece = pieces[pieceId];
  if (!piece) return;
  piece.alive = false;
  piece.zone = 'captured';
  piece.row = -1;
  piece.col = -1;
  piece.capturedBy = captorColor;
  captured[captorColor].push(pieceId);
  revealedIdentities[pieceId] = piece.identity;
}

function setOnDeckPiece(pieces, onDecks, color, pieceId) {
  if (!pieceId) return;
  const piece = pieces[pieceId];
  if (!piece) return;
  onDecks[color] = pieceId;
  piece.zone = 'onDeck';
  piece.row = -1;
  piece.col = -1;
}

function setStashPiece(pieces, stashes, color, pieceId) {
  const piece = pieces[pieceId];
  if (!piece) return;
  stashes[color].push(pieceId);
  piece.zone = 'stash';
  piece.row = -1;
  piece.col = -1;
}

function buildStartingIdsForColor(color, pieces, moveHistoryByPiece) {
  return PIECE_POOL_BY_COLOR.map((identity, idx) => {
    const id = `${color === WHITE ? 'w' : 'b'}-${idx}`;
    pieces[id] = createPiece(id, color, identity);
    moveHistoryByPiece[id] = [];
    return id;
  });
}

function createDefaultStartingArrangement({
  rng,
  board,
  pieces,
  stashes,
  onDecks,
  moveHistoryByPiece,
}) {
  const columns = Array.from({ length: FILES }, (_, idx) => idx);
  [WHITE, BLACK].forEach((color) => {
    const ids = buildStartingIdsForColor(color, pieces, moveHistoryByPiece);
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
      setBoardPiece(board, pieces, pieceId, {
        row: homeRow,
        col: shuffledCols[index],
      });
    });
    setOnDeckPiece(pieces, onDecks, color, onDeckId);
    stashIds.forEach((pieceId) => setStashPiece(pieces, stashes, color, pieceId));
  });
  return null;
}

function chooseCurriculumDaggers(rng, totalDaggers) {
  const safeTotalDaggers = Math.max(0, Math.min(CURRICULUM_MAX_RUNG, Math.floor(totalDaggers)));
  const allocations = [];
  for (let whiteDaggers = 0; whiteDaggers <= 2; whiteDaggers += 1) {
    const blackDaggers = safeTotalDaggers - whiteDaggers;
    if (blackDaggers < 0 || blackDaggers > 2) continue;
    allocations.push([whiteDaggers, blackDaggers]);
  }
  if (!allocations.length) return [0, 0];
  return allocations[randomInt(rng, 0, allocations.length - 1)];
}

function createCurriculumStartingArrangement({
  rng,
  board,
  pieces,
  stashes,
  onDecks,
  captured,
  revealedIdentities,
  moveHistoryByPiece,
  curriculum,
}) {
  const resolvedProgress = resolveCurriculumProgress(curriculum);
  if (!resolvedProgress) {
    return createDefaultStartingArrangement({
      rng,
      board,
      pieces,
      stashes,
      onDecks,
      moveHistoryByPiece,
    });
  }

  const blackBoardPieces = 1 + sampleCurriculumRung(rng, resolvedProgress.progress);
  const whiteBoardPieces = 1 + sampleCurriculumRung(rng, resolvedProgress.progress);
  const advanceDepth = CURRICULUM_MAX_RUNG - sampleCurriculumRung(rng, resolvedProgress.progress);
  const totalDaggers = CURRICULUM_MAX_RUNG - sampleCurriculumRung(rng, resolvedProgress.progress);
  const daggers = chooseCurriculumDaggers(rng, totalDaggers);

  [WHITE, BLACK].forEach((color) => {
    const boardPieceCount = color === WHITE ? whiteBoardPieces : blackBoardPieces;
    const ids = buildStartingIdsForColor(color, pieces, moveHistoryByPiece);
    const kingId = ids.find((id) => pieces[id].identity === IDENTITIES.KING);
    const nonKingIds = shuffle(ids.filter((id) => id !== kingId), rng);
    const boardIds = [kingId, ...nonKingIds.slice(0, Math.max(0, boardPieceCount - 1))];
    const remainingIds = nonKingIds.slice(Math.max(0, boardPieceCount - 1));
    const capturedCount = Math.max(0, 5 - boardPieceCount);
    const capturedIds = remainingIds.slice(0, capturedCount);
    const hiddenReserveIds = remainingIds.slice(capturedCount);
    const onDeckId = hiddenReserveIds[0] || null;
    const stashIds = hiddenReserveIds.slice(1);

    const availableSquares = shuffle(
      listCurriculumPlacementSquares(color, advanceDepth)
        .filter((square) => board[square.row][square.col] === null),
      rng,
    );
    boardIds.forEach((pieceId, index) => {
      setBoardPiece(board, pieces, pieceId, availableSquares[index]);
    });
    capturedIds.forEach((pieceId) => setCapturedPiece(
      pieces,
      captured,
      revealedIdentities,
      pieceId,
      otherColor(color),
    ));
    setOnDeckPiece(pieces, onDecks, color, onDeckId);
    stashIds.forEach((pieceId) => setStashPiece(pieces, stashes, color, pieceId));
  });

  return {
    mode: 'selfplay-curriculum',
    progress: resolvedProgress.progress,
    gameIndex: resolvedProgress.gameIndex,
    cadence: resolvedProgress.cadence,
    blackBoardPieces,
    whiteBoardPieces,
    advanceDepth,
    totalDaggers,
    daggers,
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
  const captured = [[], []];
  const moveHistoryByPiece = {};
  const revealedIdentities = {};
  const curriculumState = createCurriculumStartingArrangement({
    rng,
    board,
    pieces,
    stashes,
    onDecks,
    captured,
    revealedIdentities,
    moveHistoryByPiece,
    curriculum: options.curriculum,
  });

  return {
    board,
    pieces,
    stashes,
    onDecks,
    captured,
    moves: [],
    actions: [],
    daggers: Array.isArray(curriculumState?.daggers) ? curriculumState.daggers.slice() : [0, 0],
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
    curriculum: curriculumState ? { ...curriculumState, daggers: curriculumState.daggers.slice() } : null,
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
  return {
    ...state,
    board,
    pieces,
    curriculum: state.curriculum
      ? {
        ...state.curriculum,
        daggers: Array.isArray(state.curriculum.daggers)
          ? state.curriculum.daggers.slice()
          : state.curriculum.daggers,
      }
      : null,
    stashes: (state.stashes || [[], []]).map((stash) => stash.slice()),
    onDecks: (state.onDecks || [null, null]).slice(),
    captured: (state.captured || [[], []]).map((arr) => arr.slice()),
    moves: (state.moves || []).slice(),
    actions: (state.actions || []).slice(),
    daggers: (state.daggers || [0, 0]).slice(),
    setupComplete: (state.setupComplete || [true, true]).slice(),
    playersReady: (state.playersReady || [true, true]).slice(),
    moveHistoryByPiece: { ...(state.moveHistoryByPiece || {}) },
    revealedIdentities: { ...(state.revealedIdentities || {}) },
  };
}

function cloneStateForSearch(state) {
  const next = cloneState(state);
  const sourceCache = getStateCache(state);
  if (!sourceCache.encoded) {
    return next;
  }
  const targetCache = getStateCache(next);
  targetCache.encoded = cloneEncodedState(sourceCache.encoded);
  if (sourceCache.encodedHash) {
    targetCache.encodedHash = sourceCache.encodedHash;
  }
  if (sourceCache.infoHistoryHash) {
    targetCache.infoHistoryHash = cloneInfoHistoryHash(sourceCache.infoHistoryHash);
  }
  if (sourceCache.declaredMoveActionsByColor) {
    targetCache.declaredMoveActionsByColor = sourceCache.declaredMoveActionsByColor.map((actions) => (
      Array.isArray(actions) ? actions.slice() : actions
    ));
  }
  if (sourceCache.moveOptionCountsByColor) {
    targetCache.moveOptionCountsByColor = sourceCache.moveOptionCountsByColor.slice();
  }
  return next;
}

function normalizeInfoActionType(type) {
  const normalized = String(type || '').trim().toUpperCase();
  return INFO_ACTION_TYPES[normalized] || 0;
}

function normalizeInfoOutcome(outcome) {
  const normalized = String(outcome || '').trim().toUpperCase();
  return INFO_OUTCOMES[normalized] || 0;
}

function hashMoveEntryPair(state, move, index) {
  if (!move) return null;
  const encoded = ensureEncodedState(state);
  const pair = [0, 0];
  const pieceIndex = move?.pieceId && Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, move.pieceId)
    ? (encoded.pieceIndexById[move.pieceId] + 1)
    : 0;
  xorInfoHashPair(pair, infoMoveIndexHash.get(index + 1));
  xorInfoHashPair(pair, infoMovePieceHash.get(pieceIndex));
  xorInfoHashPair(pair, infoMovePlayerHash[move.player === BLACK ? BLACK : WHITE]);
  xorInfoHashPair(pair, infoMoveDeclarationHash.get(Number(move.declaration || 0)));
  xorInfoHashPair(pair, infoMoveStateHash.get(Number(move.state || 0)));
  xorInfoHashPair(pair, infoMoveSquareHash.get(squareToIndex(move?.from?.row, move?.from?.col) + 1));
  xorInfoHashPair(pair, infoMoveSquareHash.get(squareToIndex(move?.to?.row, move?.to?.col) + 1));
  return pair;
}

function hashActionEntryPair(action, index) {
  if (!action) return null;
  const details = action.details || {};
  const pair = [0, 0];
  xorInfoHashPair(pair, infoActionIndexHash.get(index + 1));
  xorInfoHashPair(pair, infoActionTypeHash.get(normalizeInfoActionType(action.type)));
  xorInfoHashPair(pair, infoActionPlayerHash[action.player === BLACK ? BLACK : WHITE]);
  xorInfoHashPair(pair, infoActionDeclarationHash.get(Number(details.declaration || 0)));
  xorInfoHashPair(pair, infoActionOutcomeHash.get(normalizeInfoOutcome(details.outcome)));
  xorInfoHashPair(pair, infoActionSquareHash.get(squareToIndex(details?.from?.row, details?.from?.col) + 1));
  xorInfoHashPair(pair, infoActionSquareHash.get(squareToIndex(details?.to?.row, details?.to?.col) + 1));
  return pair;
}

function cloneInfoHistoryHash(infoHistoryHash) {
  if (!infoHistoryHash) return null;
  return {
    moveHash: cloneHashPair(infoHistoryHash.moveHash),
    actionHash: cloneHashPair(infoHistoryHash.actionHash),
    moveEntries: Array.isArray(infoHistoryHash.moveEntries)
      ? infoHistoryHash.moveEntries.map((pair) => (pair ? cloneHashPair(pair) : null))
      : [],
    actionEntries: Array.isArray(infoHistoryHash.actionEntries)
      ? infoHistoryHash.actionEntries.map((pair) => (pair ? cloneHashPair(pair) : null))
      : [],
  };
}

function ensureInfoHistoryHash(state) {
  const cache = getStateCache(state);
  if (cache.infoHistoryHash) {
    return cache.infoHistoryHash;
  }

  const moveHash = [0, 0];
  const actionHash = [0, 0];
  const moves = Array.isArray(state.moves) ? state.moves : [];
  const actions = Array.isArray(state.actions) ? state.actions : [];
  const moveEntries = new Array(moves.length);
  const actionEntries = new Array(actions.length);

  for (let index = 0; index < moves.length; index += 1) {
    const pair = hashMoveEntryPair(state, moves[index], index);
    moveEntries[index] = pair;
    xorInfoHashPair(moveHash, pair);
  }

  for (let index = 0; index < actions.length; index += 1) {
    const pair = hashActionEntryPair(actions[index], index);
    actionEntries[index] = pair;
    xorInfoHashPair(actionHash, pair);
  }

  cache.infoHistoryHash = {
    moveHash,
    actionHash,
    moveEntries,
    actionEntries,
  };
  return cache.infoHistoryHash;
}

function refreshInfoMoveHashEntry(state, index) {
  const cache = getStateCache(state);
  if (!cache.infoHistoryHash || !Number.isFinite(index) || index < 0) return;
  const history = cache.infoHistoryHash;
  const oldPair = history.moveEntries[index];
  if (oldPair) {
    xorInfoHashPair(history.moveHash, oldPair);
  }
  const move = Array.isArray(state.moves) ? state.moves[index] : null;
  const nextPair = move ? hashMoveEntryPair(state, move, index) : null;
  history.moveEntries[index] = nextPair;
  if (nextPair) {
    xorInfoHashPair(history.moveHash, nextPair);
  }
  history.moveEntries.length = Array.isArray(state.moves) ? state.moves.length : 0;
}

function refreshInfoActionHashEntry(state, index) {
  const cache = getStateCache(state);
  if (!cache.infoHistoryHash || !Number.isFinite(index) || index < 0) return;
  const history = cache.infoHistoryHash;
  const oldPair = history.actionEntries[index];
  if (oldPair) {
    xorInfoHashPair(history.actionHash, oldPair);
  }
  const action = Array.isArray(state.actions) ? state.actions[index] : null;
  const nextPair = action ? hashActionEntryPair(action, index) : null;
  history.actionEntries[index] = nextPair;
  if (nextPair) {
    xorInfoHashPair(history.actionHash, nextPair);
  }
  history.actionEntries.length = Array.isArray(state.actions) ? state.actions.length : 0;
}

function getInformationHistoryHash(state) {
  return ensureInfoHistoryHash(state);
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

function clearStateCache(state, options = {}) {
  if (!state || typeof state !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(state, '__mlCache')) {
    const preserveEncoded = options.preserveEncoded !== false;
    const preserveInfoHistoryHash = options.preserveInfoHistoryHash !== false;
    const preserveMoveGeneration = options.preserveMoveGeneration === true;
    const nextCache = {};
    if (preserveEncoded && state.__mlCache?.encoded) {
      nextCache.encoded = state.__mlCache.encoded;
    }
    if (preserveInfoHistoryHash && state.__mlCache?.infoHistoryHash) {
      nextCache.infoHistoryHash = state.__mlCache.infoHistoryHash;
    }
    if (preserveMoveGeneration && state.__mlCache?.declaredMoveActionsByColor) {
      nextCache.declaredMoveActionsByColor = state.__mlCache.declaredMoveActionsByColor;
    }
    if (preserveMoveGeneration && state.__mlCache?.moveOptionCountsByColor) {
      nextCache.moveOptionCountsByColor = state.__mlCache.moveOptionCountsByColor;
    }
    state.__mlCache = nextCache;
  }
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

function shouldResolvePendingMoveBeforeMove(state, color) {
  if (!state || !state.isActive) return false;
  if (state.playerTurn !== color) return false;
  if (state.onDeckingPlayer === color) return false;
  const lastAction = getLastAction(state);
  const lastMove = getLastMove(state);
  return Boolean(
    lastAction
    && lastAction.type === ACTIONS.MOVE
    && lastMove
    && lastMove.state === MOVE_STATES.PENDING
    && lastMove.player !== color
  );
}

function getMoveGenerationState(state, color) {
  if (!shouldResolvePendingMoveBeforeMove(state, color)) {
    return state;
  }
  const cache = getStateCache(state);
  cache.moveGenerationStateByColor = cache.moveGenerationStateByColor || [null, null];
  if (cache.moveGenerationStateByColor[color]) {
    return cache.moveGenerationStateByColor[color];
  }

  const preview = cloneState(state);
  const previewMoveIndex = preview.moves.length - 1;
  const previewMove = ensureWritableMoveAt(preview, previewMoveIndex);
  resolveMove(preview, previewMove, previewMoveIndex);
  preview.playerTurn = color;
  preview.toMove = color;
  cache.moveGenerationStateByColor[color] = preview;
  return preview;
}

function cloneSquareLike(square) {
  return square ? { ...square } : square;
}

function cloneMoveLike(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    ...entry,
    from: cloneSquareLike(entry.from),
    to: cloneSquareLike(entry.to),
  };
}

function cloneMoveHistoryEntries(entries = []) {
  return entries.map((entry) => cloneMoveLike(entry));
}

function createCacheSnapshot(state) {
  const cache = getStateCache(state);
  return {
    encoded: cache.encoded ? cloneEncodedState(cache.encoded) : null,
    infoHistoryHash: cache.infoHistoryHash ? cloneInfoHistoryHash(cache.infoHistoryHash) : null,
    declaredMoveActionsByColor: cache.declaredMoveActionsByColor
      ? cache.declaredMoveActionsByColor.map((actions) => (Array.isArray(actions) ? actions.slice() : actions))
      : null,
    moveOptionCountsByColor: cache.moveOptionCountsByColor
      ? cache.moveOptionCountsByColor.slice()
      : null,
  };
}

function createUndoFrame(state) {
  return {
    scalars: {
      playerTurn: state.playerTurn,
      toMove: state.toMove,
      onDeckingPlayer: state.onDeckingPlayer,
      movesSinceAction: state.movesSinceAction,
      ply: state.ply,
      winner: state.winner,
      winReason: state.winReason,
      isActive: state.isActive,
    },
    onDecks: (state.onDecks || [null, null]).slice(),
    daggers: (state.daggers || [0, 0]).slice(),
    stashes: (state.stashes || [[], []]).map((stash) => stash.slice()),
    captured: (state.captured || [[], []]).map((arr) => arr.slice()),
    revealedIdentities: { ...(state.revealedIdentities || {}) },
    movesLength: Array.isArray(state.moves) ? state.moves.length : 0,
    actionsLength: Array.isArray(state.actions) ? state.actions.length : 0,
    moveEntries: Object.create(null),
    moveHistoryByPiece: Object.create(null),
    boardCells: Object.create(null),
    pieces: Object.create(null),
    cache: createCacheSnapshot(state),
  };
}

function setActiveUndoFrame(state, frame) {
  if (!state || typeof state !== 'object') return;
  Object.defineProperty(state, '__mlUndoFrame', {
    value: frame,
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

function clearActiveUndoFrame(state) {
  if (!state || typeof state !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(state, '__mlUndoFrame')) {
    state.__mlUndoFrame = null;
  }
}

function getActiveUndoFrame(state) {
  if (!state || typeof state !== 'object') return null;
  return Object.prototype.hasOwnProperty.call(state, '__mlUndoFrame')
    ? state.__mlUndoFrame
    : null;
}

function recordUndoBoardCell(state, row, col) {
  const frame = getActiveUndoFrame(state);
  if (!frame || !isInside(row, col)) return;
  const key = `${row}:${col}`;
  if (!Object.prototype.hasOwnProperty.call(frame.boardCells, key)) {
    frame.boardCells[key] = state.board[row][col];
  }
}

function recordUndoPiece(state, pieceId) {
  const frame = getActiveUndoFrame(state);
  if (!frame || !pieceId || Object.prototype.hasOwnProperty.call(frame.pieces, pieceId)) return;
  const piece = state.pieces[pieceId];
  frame.pieces[pieceId] = piece ? { ...piece } : null;
}

function recordUndoMoveEntry(state, index) {
  const frame = getActiveUndoFrame(state);
  if (!frame || !Number.isFinite(index) || index < 0) return;
  const key = String(index);
  if (Object.prototype.hasOwnProperty.call(frame.moveEntries, key)) return;
  frame.moveEntries[key] = cloneMoveLike(state.moves?.[index] || null);
}

function recordUndoMoveHistory(state, pieceId) {
  const frame = getActiveUndoFrame(state);
  if (!frame || !pieceId || Object.prototype.hasOwnProperty.call(frame.moveHistoryByPiece, pieceId)) return;
  frame.moveHistoryByPiece[pieceId] = cloneMoveHistoryEntries(state.moveHistoryByPiece?.[pieceId] || []);
}

function applyActionWithUndo(state, rawAction) {
  const frame = createUndoFrame(state);
  setActiveUndoFrame(state, frame);
  applyActionInPlace(state, rawAction);
  clearActiveUndoFrame(state);
  return frame;
}

function undoAppliedAction(state, frame) {
  if (!state || !frame) return state;

  Object.assign(state, frame.scalars || {});
  state.onDecks = (frame.onDecks || [null, null]).slice();
  state.daggers = (frame.daggers || [0, 0]).slice();
  state.stashes = (frame.stashes || [[], []]).map((stash) => stash.slice());
  state.captured = (frame.captured || [[], []]).map((arr) => arr.slice());
  state.revealedIdentities = { ...(frame.revealedIdentities || {}) };

  const boardKeys = Object.keys(frame.boardCells || {});
  boardKeys.forEach((key) => {
    const [rowText, colText] = key.split(':');
    const row = Number(rowText);
    const col = Number(colText);
    if (isInside(row, col)) {
      state.board[row][col] = frame.boardCells[key];
    }
  });

  Object.keys(frame.pieces || {}).forEach((pieceId) => {
    const pieceSnapshot = frame.pieces[pieceId];
    state.pieces[pieceId] = pieceSnapshot ? { ...pieceSnapshot } : pieceSnapshot;
  });

  Object.keys(frame.moveHistoryByPiece || {}).forEach((pieceId) => {
    state.moveHistoryByPiece[pieceId] = cloneMoveHistoryEntries(frame.moveHistoryByPiece[pieceId]);
  });

  state.moves.length = Number(frame.movesLength || 0);
  Object.keys(frame.moveEntries || {}).forEach((key) => {
    const index = Number(key);
    state.moves[index] = cloneMoveLike(frame.moveEntries[key]);
  });
  state.actions.length = Number(frame.actionsLength || 0);

  const cacheSnapshot = frame.cache || {};
  state.__mlCache = {};
  if (cacheSnapshot.encoded) {
    state.__mlCache.encoded = cloneEncodedState(cacheSnapshot.encoded);
  }
  if (cacheSnapshot.infoHistoryHash) {
    state.__mlCache.infoHistoryHash = cloneInfoHistoryHash(cacheSnapshot.infoHistoryHash);
  }
  if (cacheSnapshot.declaredMoveActionsByColor) {
    state.__mlCache.declaredMoveActionsByColor = cacheSnapshot.declaredMoveActionsByColor.map((actions) => (
      Array.isArray(actions) ? actions.slice() : actions
    ));
  }
  if (cacheSnapshot.moveOptionCountsByColor) {
    state.__mlCache.moveOptionCountsByColor = cacheSnapshot.moveOptionCountsByColor.slice();
  }
  clearActiveUndoFrame(state);
  return state;
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
    recordUndoBoardCell(state, piece.row, piece.col);
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

function syncEncodedPieceMutation(state, pieceId, previousPiece = null) {
  if (!pieceId) return;
  const cache = getStateCache(state);
  const encoded = cache.encoded;
  if (!encoded) return;
  const nextPiece = state.pieces[pieceId] || null;
  if (cache.mutationFlags && (
    String(previousPiece?.zone || '') === 'board'
    || String(nextPiece?.zone || '') === 'board'
  )) {
    cache.mutationFlags.boardChanged = true;
  }
  const pieceIndex = Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, pieceId)
    ? encoded.pieceIndexById[pieceId]
    : -1;
  if (pieceIndex < 0) {
    clearStateCache(state, { preserveEncoded: false });
    return;
  }
  syncEncodedPieceState(encoded, pieceIndex, previousPiece, nextPiece);
}

function setRevealedIdentity(state, pieceId, identity) {
  if (!pieceId) return;
  if (Number.isFinite(identity)) {
    state.revealedIdentities[pieceId] = identity;
  } else {
    delete state.revealedIdentities[pieceId];
  }
  const cache = getStateCache(state);
  const encoded = cache.encoded;
  if (!encoded) return;
  const pieceIndex = Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, pieceId)
    ? encoded.pieceIndexById[pieceId]
    : -1;
  if (pieceIndex < 0) {
    clearStateCache(state, { preserveEncoded: false });
    return;
  }
  syncEncodedPieceReveal(encoded, pieceIndex, Number.isFinite(identity) ? identity : 0);
}

function placePieceOnBoard(state, pieceId, row, col) {
  if (!pieceId) {
    if (isInside(row, col)) {
      recordUndoBoardCell(state, row, col);
      state.board[row][col] = null;
    }
    return;
  }
  const piece = state.pieces[pieceId];
  if (!piece) return;
  recordUndoPiece(state, pieceId);
  const previousPiece = { ...piece };
  removePieceFromZones(state, pieceId);
  recordUndoBoardCell(state, row, col);
  state.board[row][col] = pieceId;
  piece.zone = 'board';
  piece.row = row;
  piece.col = col;
  piece.alive = true;
  piece.capturedBy = null;
  syncEncodedPieceMutation(state, pieceId, previousPiece);
}

function movePieceToStash(state, pieceId, color) {
  if (!pieceId) return;
  const piece = state.pieces[pieceId];
  if (!piece) return;
  recordUndoPiece(state, pieceId);
  const previousPiece = { ...piece };
  removePieceFromZones(state, pieceId);
  if (!state.stashes[color].includes(pieceId)) {
    state.stashes[color].push(pieceId);
  }
  piece.zone = 'stash';
  piece.row = -1;
  piece.col = -1;
  piece.alive = true;
  piece.capturedBy = null;
  syncEncodedPieceMutation(state, pieceId, previousPiece);
}

function movePieceToOnDeck(state, pieceId, color) {
  if (!pieceId) return;
  const piece = state.pieces[pieceId];
  if (!piece) return;
  recordUndoPiece(state, pieceId);
  const previousPiece = { ...piece };
  removePieceFromZones(state, pieceId);
  state.onDecks[color] = pieceId;
  piece.zone = 'onDeck';
  piece.row = -1;
  piece.col = -1;
  piece.alive = true;
  piece.capturedBy = null;
  syncEncodedPieceMutation(state, pieceId, previousPiece);
}

function capturePiece(state, pieceId, captorColor) {
  if (!pieceId) return null;
  const piece = state.pieces[pieceId];
  if (!piece || !piece.alive) return null;
  recordUndoPiece(state, pieceId);
  const previousPiece = { ...piece };

  removePieceFromZones(state, pieceId);
  piece.alive = false;
  piece.zone = 'captured';
  piece.row = -1;
  piece.col = -1;
  piece.capturedBy = captorColor;
  if (!state.captured[captorColor].includes(pieceId)) {
    state.captured[captorColor].push(pieceId);
  }
  syncEncodedPieceMutation(state, pieceId, previousPiece);
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
  refreshInfoActionHashEntry(state, state.actions.length - 1);
}

function cloneMoveEntry(move) {
  if (!move) return move;
  return {
    ...move,
    from: move.from ? { ...move.from } : null,
    to: move.to ? { ...move.to } : null,
  };
}

function ensureWritableMoveAt(state, index) {
  if (!Array.isArray(state?.moves) || index < 0 || index >= state.moves.length) return null;
  recordUndoMoveEntry(state, index);
  const move = state.moves[index];
  const cloned = cloneMoveEntry(move);
  state.moves[index] = cloned;
  return cloned;
}

function ensureWritableMoveHistoryForPiece(state, pieceId) {
  if (!pieceId) return [];
  recordUndoMoveHistory(state, pieceId);
  const existing = Array.isArray(state?.moveHistoryByPiece?.[pieceId])
    ? state.moveHistoryByPiece[pieceId]
    : [];
  const cloned = existing.slice();
  state.moveHistoryByPiece[pieceId] = cloned;
  return cloned;
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

  const moveState = getMoveGenerationState(state, color);
  if (!moveState?.isActive) {
    cache.declaredMoveActionsByColor = cache.declaredMoveActionsByColor || [null, null];
    cache.declaredMoveActionsByColor[color] = [];
    return [];
  }
  const encoded = ensureEncodedState(moveState);
  const actions = [];
  let boardMask = encoded.boardMaskByColor[color] >>> 0;

  while (boardMask) {
    const bit = boardMask & -boardMask;
    const squareIndex = 31 - Math.clz32(bit);
    boardMask ^= bit;
    const pieceIndex = encoded.boardPieceIndices[squareIndex];
    if (pieceIndex === NO_PIECE) continue;
    const pieceId = encoded.pieceIds[pieceIndex];
    const from = SQUARE_COORDS[squareIndex];

    for (let declarationIndex = 0; declarationIndex < DECLARABLE_IDENTITIES.length; declarationIndex += 1) {
      const declaration = DECLARABLE_IDENTITIES[declarationIndex];
      const templates = getMoveTemplatesForSquare(squareIndex, declaration);
      for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
        const template = templates[templateIndex];
        if ((encoded.occupancyMask & template.blockersMask) !== 0) {
          continue;
        }
        const targetPieceIndex = encoded.boardPieceIndices[template.toIndex];
        if (targetPieceIndex !== NO_PIECE && encoded.pieceColor[targetPieceIndex] === color) {
          continue;
        }
        const capturePieceId = targetPieceIndex !== NO_PIECE
          ? encoded.pieceIds[targetPieceIndex]
          : null;
        actions.push({
          type: 'MOVE',
          player: color,
          pieceId,
          from,
          to: SQUARE_COORDS[template.toIndex],
          declaration,
          capturePieceId,
          _pieceIndex: pieceIndex,
          _fromIndex: squareIndex,
          _toIndex: template.toIndex,
          _capturePieceIndex: targetPieceIndex !== NO_PIECE ? targetPieceIndex : NO_PIECE,
          _key: `M:${pieceId}:${squareIndex}:${template.toIndex}:${declaration}`,
        });
      }
    }
  }

  cache.declaredMoveActionsByColor = cache.declaredMoveActionsByColor || [null, null];
  cache.declaredMoveActionsByColor[color] = actions;
  return actions;
}

function countDeclaredMoveOptionsForColorEncoded(state, color) {
  const encoded = ensureEncodedState(state);
  let boardMask = encoded.boardMaskByColor[color] >>> 0;
  let count = 0;

  while (boardMask) {
    const bit = boardMask & -boardMask;
    const squareIndex = 31 - Math.clz32(bit);
    boardMask ^= bit;

    for (let declarationIndex = 0; declarationIndex < DECLARABLE_IDENTITIES.length; declarationIndex += 1) {
      const declaration = DECLARABLE_IDENTITIES[declarationIndex];
      const templates = getMoveTemplatesForSquare(squareIndex, declaration);
      for (let templateIndex = 0; templateIndex < templates.length; templateIndex += 1) {
        const template = templates[templateIndex];
        if ((encoded.occupancyMask & template.blockersMask) !== 0) {
          continue;
        }
        const targetPieceIndex = encoded.boardPieceIndices[template.toIndex];
        if (targetPieceIndex !== NO_PIECE && encoded.pieceColor[targetPieceIndex] === color) {
          continue;
        }
        count += 1;
      }
    }
  }

  return count;
}

function countMoveOptionsForColor(state, color) {
  const cache = getStateCache(state);
  cache.moveOptionCountsByColor = cache.moveOptionCountsByColor || [null, null];
  if (Number.isFinite(cache.moveOptionCountsByColor[color])) {
    return cache.moveOptionCountsByColor[color];
  }
  const moveState = getMoveGenerationState(state, color);
  const count = moveState?.isActive
    ? countDeclaredMoveOptionsForColorEncoded(moveState, color)
    : 0;
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
  const entries = ensureWritableMoveHistoryForPiece(state, pieceId);
  if (!entries.length) return;
  const last = entries[entries.length - 1];
  entries[entries.length - 1] = { ...(last || {}) };
  const writableLast = entries[entries.length - 1];
  Object.assign(writableLast, patch);
}

function appendMoveHistory(state, move) {
  if (!move || !move.pieceId) return;
  const entries = ensureWritableMoveHistoryForPiece(state, move.pieceId);
  const from = move.from || { row: -1, col: -1 };
  const to = move.to || { row: -1, col: -1 };
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  entries.push({
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

function resolveMove(state, move, moveIndex = -1) {
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
  recordUndoBoardCell(state, from.row, from.col);
  state.board[from.row][from.col] = null;
  move.state = MOVE_STATES.RESOLVED;
  if (moveIndex >= 0) {
    refreshInfoMoveHashEntry(state, moveIndex);
  }
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
  if (!state?.isActive || !action) return { ok: false };
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
  const color = action.player;
  const validationState = getMoveGenerationState(state, color);
  const validation = validateMoveAction(validationState, action);
  if (!validation.ok) return false;

  const from = { ...action.from };
  const to = { ...action.to };
  const declaration = action.declaration;
  let earlyResolved = false;
  if (shouldResolvePendingMoveBeforeMove(state, color)) {
    earlyResolved = true;
    const writablePrevMove = ensureWritableMoveAt(state, state.moves.length - 1);
    const endedEarly = resolveMove(state, writablePrevMove, state.moves.length - 1);
    if (endedEarly) {
      state.ply += 1;
      syncTurn(state);
      return true;
    }
  }

  const checkAfterResolution = validateMoveAction(state, action);
  if (!checkAfterResolution.ok) return false;
  const pieceId = checkAfterResolution.piece.id;

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
  refreshInfoMoveHashEntry(state, state.moves.length - 1);
  appendMoveHistory(state, move);

  if (!earlyResolved && state.moves.length > 1) {
    const prevMove = state.moves[state.moves.length - 2];
    if (prevMove && prevMove.state === MOVE_STATES.PENDING) {
      const writablePrevMove = ensureWritableMoveAt(state, state.moves.length - 2);
      const ended = resolveMove(state, writablePrevMove, state.moves.length - 2);
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
  let lastMove = getLastMove(state);
  if (!lastMove) return false;
  const piece = getPieceAt(state, lastMove.from.row, lastMove.from.col);
  if (!piece) return false;

  lastMove = ensureWritableMoveAt(state, state.moves.length - 1);
  const captured = capturePiece(state, piece.id, color);
  lastMove.state = MOVE_STATES.RESOLVED;
  refreshInfoMoveHashEntry(state, state.moves.length - 1);
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
  let lastMove = getLastMove(state);
  if (!lastAction || !lastMove) return false;
  if (lastAction.type !== ACTIONS.MOVE && lastAction.type !== ACTIONS.BOMB) return false;
  if (lastAction.type === ACTIONS.MOVE && lastMove.state !== MOVE_STATES.PENDING) return false;
  lastMove = ensureWritableMoveAt(state, state.moves.length - 1);

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
      refreshInfoMoveHashEntry(state, state.moves.length - 1);
      updateMoveHistoryEntry(state, lastMove.pieceId, {
        resolvedState: MOVE_STATES.RESOLVED,
        revealedIdentity: pieceFrom.identity,
      });
      setRevealedIdentity(state, pieceFrom.id, pieceFrom.identity);
      wasSuccessful = true;
      state.onDeckingPlayer = null;
    } else {
      lastMove.state = MOVE_STATES.COMPLETED;
      refreshInfoMoveHashEntry(state, state.moves.length - 1);
      updateMoveHistoryEntry(state, lastMove.pieceId, {
        resolvedState: MOVE_STATES.COMPLETED,
        truthfulChallenge: true,
        revealedIdentity: pieceFrom.identity,
      });
      state.daggers[challenger] += 1;
      setRevealedIdentity(state, pieceFrom.id, pieceFrom.identity);

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
        recordUndoBoardCell(state, to.row, to.col);
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
      recordUndoBoardCell(state, from.row, from.col);
      state.board[from.row][from.col] = null;
      lastMove.state = MOVE_STATES.RESOLVED;
      refreshInfoMoveHashEntry(state, state.moves.length - 1);
      updateMoveHistoryEntry(state, lastMove.pieceId, {
        resolvedState: MOVE_STATES.RESOLVED,
      });
      wasSuccessful = true;
      state.onDeckingPlayer = null;
    } else {
      setRevealedIdentity(state, pieceTo.id, IDENTITIES.BOMB);
      movePieceToStash(state, pieceTo.id, pieceTo.color);
      const deckPieceId = state.onDecks[pieceTo.color];
      state.onDecks[pieceTo.color] = null;
      if (deckPieceId) {
        placePieceOnBoard(state, deckPieceId, to.row, to.col);
      } else {
        recordUndoBoardCell(state, to.row, to.col);
        state.board[to.row][to.col] = null;
      }

      state.onDeckingPlayer = otherColor(challenger);
      state.playerTurn = otherColor(challenger);

      capturePiece(state, pieceFrom.id, otherColor(challenger));
      capturedPieceId = pieceFrom.id;
      captureBy = pieceTo.color;
      state.daggers[challenger] += 1;
      lastMove.state = MOVE_STATES.COMPLETED;
      refreshInfoMoveHashEntry(state, state.moves.length - 1);
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
    const lastMove = ensureWritableMoveAt(state, state.moves.length - 1);
    lastMove.state = MOVE_STATES.RESOLVED;
    refreshInfoMoveHashEntry(state, state.moves.length - 1);
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

function applyActionInPlace(state, rawAction) {
  if (!state?.isActive) return state;
  clearStateCache(state, { preserveMoveGeneration: true });
  getStateCache(state).mutationFlags = { boardChanged: false };
  const action = normalizeAction(rawAction, state.playerTurn);
  let applied = false;

  if (action.type === 'MOVE') {
    applied = applyMoveAction(state, action);
  } else if (action.type === 'CHALLENGE') {
    applied = applyChallengeAction(state, action);
  } else if (action.type === 'BOMB') {
    applied = applyBombAction(state, action);
  } else if (action.type === 'PASS') {
    applied = applyPassAction(state, action);
  } else if (action.type === 'ON_DECK') {
    applied = applyOnDeckAction(state, action);
  }

  const mutationFlags = getStateCache(state).mutationFlags || { boardChanged: false };
  delete getStateCache(state).mutationFlags;
  if (!applied) {
    clearStateCache(state, { preserveMoveGeneration: true });
    return state;
  }

  if (state.isActive && state.ply >= state.maxPlies) {
    endGame(state, null, 'draw');
  }
  syncTurn(state);
  clearStateCache(state, {
    preserveMoveGeneration: !mutationFlags.boardChanged,
  });
  return state;
}

function applyActionMutable(state, rawAction) {
  return applyActionInPlace(state, rawAction);
}

function applyAction(state, rawAction) {
  const next = cloneState(state);
  return applyActionInPlace(next, rawAction);
}

function actionKey(action) {
  if (!action || !action.type) return '';
  if (action._key) return action._key;
  if (action.type === 'MOVE') {
    const fromIndex = Number.isFinite(action?._fromIndex)
      ? action._fromIndex
      : squareToIndex(action?.from?.row, action?.from?.col);
    const toIndex = Number.isFinite(action?._toIndex)
      ? action._toIndex
      : squareToIndex(action?.to?.row, action?.to?.col);
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
  cloneStateForSearch,
  otherColor,
  getPieceAt,
  getPieceIdAt,
  getLastMove,
  getLastAction,
  getLegalActions,
  getLegalMoves,
  countMoveOptionsForColor,
  applyAction,
  applyActionMutable,
  applyActionWithUndo,
  undoAppliedAction,
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
  getInformationHistoryHash,
  toReplayFrame,
};
