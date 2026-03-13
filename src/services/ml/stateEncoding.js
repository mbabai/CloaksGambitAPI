const gameConstants = require('../../../shared/constants/game.json');

const IDENTITIES = gameConstants.identities;
const BOARD_DIMENSIONS = gameConstants.boardDimensions;
const COLORS = gameConstants.colors;

const RANKS = BOARD_DIMENSIONS.RANKS;
const FILES = BOARD_DIMENSIONS.FILES;
const BOARD_SIZE = RANKS * FILES;

const WHITE = COLORS.WHITE;
const BLACK = COLORS.BLACK;

const NO_PIECE = -1;

const PIECE_VALUES = Object.freeze({
  [IDENTITIES.KING]: 10,
  [IDENTITIES.BOMB]: 4.3,
  [IDENTITIES.BISHOP]: 3.3,
  [IDENTITIES.ROOK]: 3.8,
  [IDENTITIES.KNIGHT]: 3.6,
  [IDENTITIES.UNKNOWN]: 0,
});

const ZONE_CODES = Object.freeze({
  board: 0,
  stash: 1,
  onDeck: 2,
  captured: 3,
  unknown: 4,
});

const HASH_TYPES = Object.freeze({
  NONE: 0,
  MOVE: 1,
  CHALLENGE: 2,
  BOMB: 3,
  PASS: 4,
  ON_DECK: 5,
});

function createMlCache(state) {
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

function squareToIndex(row, col) {
  if (!Number.isFinite(row) || !Number.isFinite(col)) return -1;
  if (row < 0 || row >= RANKS || col < 0 || col >= FILES) return -1;
  return (row * FILES) + col;
}

function indexToSquare(index) {
  if (!Number.isFinite(index) || index < 0 || index >= BOARD_SIZE) {
    return { row: -1, col: -1 };
  }
  return {
    row: Math.floor(index / FILES),
    col: index % FILES,
  };
}

const MOVE_TEMPLATES = (() => {
  const templates = Array.from({ length: BOARD_SIZE }, () => ({
    [IDENTITIES.KING]: [],
    [IDENTITIES.ROOK]: [],
    [IDENTITIES.BISHOP]: [],
    [IDENTITIES.KNIGHT]: [],
  }));

  function pushTemplate(squareIndex, identity, toRow, toCol, blockersMask) {
    const toIndex = squareToIndex(toRow, toCol);
    if (toIndex < 0) return;
    templates[squareIndex][identity].push({
      toIndex,
      toRow,
      toCol,
      blockersMask: blockersMask >>> 0,
    });
  }

  for (let row = 0; row < RANKS; row += 1) {
    for (let col = 0; col < FILES; col += 1) {
      const fromIndex = squareToIndex(row, col);

      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          if (dr === 0 && dc === 0) continue;
          pushTemplate(fromIndex, IDENTITIES.KING, row + dr, col + dc, 0);
        }
      }

      [
        { dr: -2, dc: -1 },
        { dr: -2, dc: 1 },
        { dr: -1, dc: -2 },
        { dr: -1, dc: 2 },
        { dr: 1, dc: -2 },
        { dr: 1, dc: 2 },
        { dr: 2, dc: -1 },
        { dr: 2, dc: 1 },
      ].forEach(({ dr, dc }) => {
        pushTemplate(fromIndex, IDENTITIES.KNIGHT, row + dr, col + dc, 0);
      });

      [
        { identity: IDENTITIES.ROOK, deltas: [{ dr: -1, dc: 0 }, { dr: 1, dc: 0 }, { dr: 0, dc: -1 }, { dr: 0, dc: 1 }] },
        { identity: IDENTITIES.BISHOP, deltas: [{ dr: -1, dc: -1 }, { dr: -1, dc: 1 }, { dr: 1, dc: -1 }, { dr: 1, dc: 1 }] },
      ].forEach(({ identity, deltas }) => {
        deltas.forEach(({ dr, dc }) => {
          let blockersMask = 0;
          for (let step = 1; step <= 3; step += 1) {
            const nextRow = row + (dr * step);
            const nextCol = col + (dc * step);
            const nextIndex = squareToIndex(nextRow, nextCol);
            if (nextIndex < 0) break;
            pushTemplate(fromIndex, identity, nextRow, nextCol, blockersMask);
            blockersMask |= (1 << nextIndex);
          }
        });
      });
    }
  }

  return templates;
})();

let zobristState = 0x9e3779b9;

function nextHashWord() {
  zobristState = (Math.imul(zobristState, 1664525) + 1013904223) >>> 0;
  return zobristState;
}

function createHashPair() {
  return [nextHashWord(), nextHashWord()];
}

function xorHashPair(target, pair) {
  target[0] = (target[0] ^ pair[0]) >>> 0;
  target[1] = (target[1] ^ pair[1]) >>> 0;
}

function createExtensiblePairTable(initialSize = 0) {
  const pairs = [];
  for (let index = 0; index < initialSize; index += 1) {
    pairs.push(createHashPair());
  }
  return {
    get(index) {
      const safeIndex = Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0;
      while (pairs.length <= safeIndex) {
        pairs.push(createHashPair());
      }
      return pairs[safeIndex];
    },
  };
}

const pieceBoardHashTables = [];
const pieceZoneHashTables = [];
const pieceRevealHashTables = [];
const playerTurnHash = [createHashPair(), createHashPair()];
const onDeckingPlayerHash = [createHashPair(), createHashPair(), createHashPair()];
const movesSinceActionHash = createExtensiblePairTable(32);
const plyHash = createExtensiblePairTable(256);
const daggerHash = [createExtensiblePairTable(8), createExtensiblePairTable(8)];
const lastMovePieceHash = createExtensiblePairTable(16);
const lastMoveSquareHash = createExtensiblePairTable(BOARD_SIZE);
const lastMoveDeclarationHash = createExtensiblePairTable(16);
const lastMoveStateHash = createExtensiblePairTable(8);
const lastMovePlayerHash = [createHashPair(), createHashPair()];
const lastActionTypeHash = createExtensiblePairTable(8);
const lastActionPlayerHash = [createHashPair(), createHashPair()];

function ensurePieceHashCapacity(pieceCount) {
  const target = Number.isFinite(pieceCount) && pieceCount > 0 ? Math.floor(pieceCount) : 0;
  while (pieceBoardHashTables.length < target) {
    pieceBoardHashTables.push(Array.from({ length: BOARD_SIZE }, () => createHashPair()));
    pieceZoneHashTables.push(Array.from({ length: 5 }, () => createHashPair()));
    pieceRevealHashTables.push(Array.from({ length: 16 }, () => createHashPair()));
  }
}

function normalizeActionTypeForHash(type) {
  const normalized = String(type || '').toUpperCase();
  if (normalized === 'MOVE') return HASH_TYPES.MOVE;
  if (normalized === 'CHALLENGE') return HASH_TYPES.CHALLENGE;
  if (normalized === 'BOMB') return HASH_TYPES.BOMB;
  if (normalized === 'PASS') return HASH_TYPES.PASS;
  if (normalized === 'ON_DECK') return HASH_TYPES.ON_DECK;
  return HASH_TYPES.NONE;
}

function ensureEncodedState(state) {
  const cache = createMlCache(state);
  if (cache.encoded) return cache.encoded;

  const pieceIds = Object.keys(state?.pieces || {});
  const pieceCount = pieceIds.length;
  ensurePieceHashCapacity(pieceCount);

  const pieceIndexById = Object.create(null);
  const boardPieceIndices = new Int16Array(BOARD_SIZE);
  boardPieceIndices.fill(NO_PIECE);
  const pieceSquareIndices = new Int16Array(pieceCount);
  pieceSquareIndices.fill(-1);
  const pieceColor = new Uint8Array(pieceCount);
  const pieceIdentity = new Uint8Array(pieceCount);
  const pieceAlive = new Uint8Array(pieceCount);
  const pieceZone = new Uint8Array(pieceCount);
  const pieceCapturedBy = new Int8Array(pieceCount);
  pieceCapturedBy.fill(-1);
  const revealedIdentity = new Uint8Array(pieceCount);

  const boardMaskByColor = [0, 0];
  const aliveCountByColor = [0, 0];
  const stashCountByColor = [0, 0];
  const materialTruthByColor = [0, 0];
  const kingIndexByColor = [-1, -1];
  const onDeckPieceIndexByColor = [-1, -1];
  const alivePieceIdsByColor = [[], []];
  const hiddenPieceIdsByPerspective = [[], []];

  pieceIds.forEach((pieceId, index) => {
    pieceIndexById[pieceId] = index;
    const piece = state.pieces[pieceId];
    const color = Number.isFinite(piece?.color) ? piece.color : 0;
    const identity = Number.isFinite(piece?.identity) ? piece.identity : IDENTITIES.UNKNOWN;
    const alive = Boolean(piece?.alive);
    const zoneCode = Object.prototype.hasOwnProperty.call(ZONE_CODES, piece?.zone)
      ? ZONE_CODES[piece.zone]
      : ZONE_CODES.unknown;

    pieceColor[index] = color;
    pieceIdentity[index] = identity;
    pieceAlive[index] = alive ? 1 : 0;
    pieceZone[index] = zoneCode;
    revealedIdentity[index] = Number.isFinite(state?.revealedIdentities?.[pieceId])
      ? Number(state.revealedIdentities[pieceId])
      : 0;

    if (alive) {
      aliveCountByColor[color] += 1;
      alivePieceIdsByColor[color].push(pieceId);
      materialTruthByColor[color] += PIECE_VALUES[identity] || 0;
      if (identity === IDENTITIES.KING) {
        kingIndexByColor[color] = index;
      }
    }

    if (zoneCode === ZONE_CODES.board) {
      const squareIndex = squareToIndex(piece?.row, piece?.col);
      if (squareIndex >= 0) {
        boardPieceIndices[squareIndex] = index;
        pieceSquareIndices[index] = squareIndex;
        boardMaskByColor[color] = (boardMaskByColor[color] | (1 << squareIndex)) >>> 0;
      }
    } else if (zoneCode === ZONE_CODES.stash) {
      stashCountByColor[color] += 1;
    } else if (zoneCode === ZONE_CODES.onDeck) {
      onDeckPieceIndexByColor[color] = index;
    } else if (zoneCode === ZONE_CODES.captured) {
      const capturedBy = Number.isFinite(piece?.capturedBy) ? piece.capturedBy : -1;
      pieceCapturedBy[index] = capturedBy;
    }
  });

  hiddenPieceIdsByPerspective[WHITE] = alivePieceIdsByColor[BLACK].filter(
    (pieceId) => !Number.isFinite(state?.revealedIdentities?.[pieceId]),
  );
  hiddenPieceIdsByPerspective[BLACK] = alivePieceIdsByColor[WHITE].filter(
    (pieceId) => !Number.isFinite(state?.revealedIdentities?.[pieceId]),
  );

  const encoded = {
    pieceIds,
    pieceIndexById,
    pieceCount,
    boardPieceIndices,
    pieceSquareIndices,
    pieceColor,
    pieceIdentity,
    pieceAlive,
    pieceZone,
    pieceCapturedBy,
    revealedIdentity,
    boardMaskByColor,
    occupancyMask: (boardMaskByColor[WHITE] | boardMaskByColor[BLACK]) >>> 0,
    aliveCountByColor,
    stashCountByColor,
    materialTruthByColor,
    kingIndexByColor,
    onDeckPieceIndexByColor,
    alivePieceIdsByColor,
    hiddenPieceIdsByPerspective,
    moveActionsByColor: [null, null],
    moveCountsByColor: [null, null],
  };

  cache.encoded = encoded;
  return encoded;
}

function getMoveTemplatesForSquare(squareIndex, declaration) {
  if (!Number.isFinite(squareIndex) || squareIndex < 0 || squareIndex >= BOARD_SIZE) {
    return [];
  }
  return MOVE_TEMPLATES[squareIndex]?.[declaration] || [];
}

function computeEncodedStateHash(state) {
  const cache = createMlCache(state);
  if (cache.encodedHash) return cache.encodedHash;

  const encoded = ensureEncodedState(state);
  const hash = [0, 0];

  for (let pieceIndex = 0; pieceIndex < encoded.pieceCount; pieceIndex += 1) {
    const zoneCode = encoded.pieceZone[pieceIndex];
    if (zoneCode === ZONE_CODES.board) {
      const squareIndex = encoded.pieceSquareIndices[pieceIndex];
      if (squareIndex >= 0) {
        xorHashPair(hash, pieceBoardHashTables[pieceIndex][squareIndex]);
      }
    } else if (zoneCode === ZONE_CODES.captured) {
      const captor = encoded.pieceCapturedBy[pieceIndex] === BLACK ? 4 : 3;
      xorHashPair(hash, pieceZoneHashTables[pieceIndex][captor]);
    } else {
      xorHashPair(hash, pieceZoneHashTables[pieceIndex][zoneCode]);
    }

    const revealed = encoded.revealedIdentity[pieceIndex];
    if (revealed > 0) {
      xorHashPair(hash, pieceRevealHashTables[pieceIndex][revealed]);
    }
  }

  const playerTurn = Number.isFinite(state?.playerTurn) ? state.playerTurn : WHITE;
  const onDeckingPlayer = Number.isFinite(state?.onDeckingPlayer)
    ? state.onDeckingPlayer
    : 2;

  xorHashPair(hash, playerTurnHash[playerTurn === BLACK ? BLACK : WHITE]);
  xorHashPair(hash, onDeckingPlayerHash[onDeckingPlayer === BLACK ? BLACK : (onDeckingPlayer === WHITE ? WHITE : 2)]);
  xorHashPair(hash, movesSinceActionHash.get(Number(state?.movesSinceAction || 0)));
  xorHashPair(hash, plyHash.get(Number(state?.ply || 0)));
  xorHashPair(hash, daggerHash[WHITE].get(Number(state?.daggers?.[WHITE] || 0)));
  xorHashPair(hash, daggerHash[BLACK].get(Number(state?.daggers?.[BLACK] || 0)));

  const lastMove = Array.isArray(state?.moves) && state.moves.length
    ? state.moves[state.moves.length - 1]
    : null;
  if (lastMove) {
    const movePieceIndex = lastMove.pieceId && Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, lastMove.pieceId)
      ? encoded.pieceIndexById[lastMove.pieceId]
      : 0;
    xorHashPair(hash, lastMovePieceHash.get(movePieceIndex));
    xorHashPair(hash, lastMovePlayerHash[lastMove.player === BLACK ? BLACK : WHITE]);
    xorHashPair(hash, lastMoveSquareHash.get(squareToIndex(lastMove?.from?.row, lastMove?.from?.col) + 1));
    xorHashPair(hash, lastMoveSquareHash.get(squareToIndex(lastMove?.to?.row, lastMove?.to?.col) + 1));
    xorHashPair(hash, lastMoveDeclarationHash.get(Number(lastMove.declaration || 0)));
    xorHashPair(hash, lastMoveStateHash.get(Number(lastMove.state || 0)));
  }

  const lastAction = Array.isArray(state?.actions) && state.actions.length
    ? state.actions[state.actions.length - 1]
    : null;
  if (lastAction) {
    xorHashPair(hash, lastActionTypeHash.get(normalizeActionTypeForHash(lastAction.type)));
    xorHashPair(hash, lastActionPlayerHash[lastAction.player === BLACK ? BLACK : WHITE]);
  }

  const encodedHash = `${hash[0].toString(16).padStart(8, '0')}${hash[1].toString(16).padStart(8, '0')}`;
  cache.encodedHash = encodedHash;
  return encodedHash;
}

module.exports = {
  NO_PIECE,
  RANKS,
  FILES,
  BOARD_SIZE,
  WHITE,
  BLACK,
  ensureEncodedState,
  computeEncodedStateHash,
  getMoveTemplatesForSquare,
  squareToIndex,
  indexToSquare,
};
