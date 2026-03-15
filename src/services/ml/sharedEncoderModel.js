const {
  ACTIONS,
  DECLARABLE_IDENTITIES,
  IDENTITIES,
  PIECE_POOL_BY_COLOR,
  WHITE,
  BLACK,
  getVisibleIdentity,
} = require('./engine');
const {
  BOARD_SIZE,
  RANKS,
  FILES,
  ensureEncodedState,
  getMoveTemplatesForSquare,
  squareToIndex,
} = require('./stateEncoding');

const SHARED_MODEL_FAMILY = 'shared_encoder_belief_ismcts_v1';
const SHARED_MODEL_VERSION = 3;
const SHARED_HISTORY_ACTION_SLOTS = 8;
const SHARED_BELIEF_SLOT_COUNT = PIECE_POOL_BY_COLOR.length;
const SHARED_BELIEF_IDENTITIES = Object.freeze([
  IDENTITIES.KING,
  IDENTITIES.BOMB,
  IDENTITIES.BISHOP,
  IDENTITIES.ROOK,
  IDENTITIES.KNIGHT,
]);
const SHARED_NON_MOVE_POLICY_SLOTS = Object.freeze([
  { id: 'A:CHALLENGE', type: 'challenge' },
  { id: 'A:BOMB', type: 'bomb' },
  { id: 'A:PASS', type: 'pass' },
  { id: 'A:RESIGN', type: 'resign' },
  { id: `O:${IDENTITIES.KING}`, type: 'on_deck', identity: IDENTITIES.KING },
  { id: `O:${IDENTITIES.BOMB}`, type: 'on_deck', identity: IDENTITIES.BOMB },
  { id: `O:${IDENTITIES.BISHOP}`, type: 'on_deck', identity: IDENTITIES.BISHOP },
  { id: `O:${IDENTITIES.ROOK}`, type: 'on_deck', identity: IDENTITIES.ROOK },
  { id: `O:${IDENTITIES.KNIGHT}`, type: 'on_deck', identity: IDENTITIES.KNIGHT },
]);
const MOVE_STATE_CODES = Object.freeze({
  none: 0,
  pending: 1,
  completed: 2,
  resolved: 3,
});
const ACTION_TYPE_CODES = Object.freeze({
  none: 0,
  move: 1,
  challenge: 2,
  bomb: 3,
  pass: 4,
  on_deck: 5,
  resign: 6,
});
const PIECE_ZONE_CODES = Object.freeze({
  board: 0,
  stash: 1,
  onDeck: 2,
  captured: 3,
  unknown: 4,
});

function clampUnit(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(-1, Math.min(1, parsed));
}

function normalizeZeroOne(value, max = 1) {
  const safeMax = Math.max(1, Number(max || 1));
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed / safeMax));
}

function pushOneHot(target, index, size) {
  for (let slot = 0; slot < size; slot += 1) {
    target.push(slot === index ? 1 : 0);
  }
}

function buildStablePieceIds() {
  return [
    ...Array.from({ length: PIECE_POOL_BY_COLOR.length }, (_, index) => `w-${index}`),
    ...Array.from({ length: PIECE_POOL_BY_COLOR.length }, (_, index) => `b-${index}`),
  ];
}

const SHARED_STABLE_PIECE_IDS = Object.freeze(buildStablePieceIds());
const SHARED_BELIEF_PIECE_IDS_BY_PERSPECTIVE = Object.freeze({
  [WHITE]: Object.freeze(Array.from({ length: PIECE_POOL_BY_COLOR.length }, (_, index) => `b-${index}`)),
  [BLACK]: Object.freeze(Array.from({ length: PIECE_POOL_BY_COLOR.length }, (_, index) => `w-${index}`)),
});

function normalizeActionType(type) {
  const normalized = String(type || '').trim().toUpperCase();
  if (normalized === 'MOVE') return 'move';
  if (normalized === 'CHALLENGE') return 'challenge';
  if (normalized === 'BOMB') return 'bomb';
  if (normalized === 'PASS') return 'pass';
  if (normalized === 'ON_DECK') return 'on_deck';
  if (normalized === 'RESIGN') return 'resign';
  return 'none';
}

function buildSharedPolicyVocabulary() {
  const items = [];
  const indexById = Object.create(null);
  for (let fromIndex = 0; fromIndex < BOARD_SIZE; fromIndex += 1) {
    DECLARABLE_IDENTITIES.forEach((declaration) => {
      const templates = getMoveTemplatesForSquare(fromIndex, declaration);
      templates.forEach((template) => {
        const id = `M:${fromIndex}:${template.toIndex}:${declaration}`;
        if (Object.prototype.hasOwnProperty.call(indexById, id)) return;
        indexById[id] = items.length;
        items.push({
          id,
          type: 'move',
          fromIndex,
          toIndex: template.toIndex,
          declaration,
        });
      });
    });
  }
  SHARED_NON_MOVE_POLICY_SLOTS.forEach((entry) => {
    indexById[entry.id] = items.length;
    items.push({ ...entry });
  });
  return {
    items: Object.freeze(items),
    indexById,
  };
}

const SHARED_POLICY_VOCABULARY = buildSharedPolicyVocabulary();

function getSharedPolicyVocabulary() {
  return SHARED_POLICY_VOCABULARY.items;
}

function getBeliefPieceSlotsForPerspective(perspective) {
  return perspective === BLACK
    ? SHARED_BELIEF_PIECE_IDS_BY_PERSPECTIVE[BLACK]
    : SHARED_BELIEF_PIECE_IDS_BY_PERSPECTIVE[WHITE];
}

function getPublicIdentityForPiece(state, piece, perspective, guessedIdentities = null) {
  if (!piece) return IDENTITIES.UNKNOWN;
  const visibleIdentity = getVisibleIdentity(state, piece, perspective);
  if (visibleIdentity !== IDENTITIES.UNKNOWN) {
    return visibleIdentity;
  }
  const guessedIdentity = guessedIdentities && Object.prototype.hasOwnProperty.call(guessedIdentities, piece.id)
    ? guessedIdentities[piece.id]
    : IDENTITIES.UNKNOWN;
  return Number.isFinite(guessedIdentity) ? guessedIdentity : IDENTITIES.UNKNOWN;
}

function getPieceZoneCode(piece) {
  const zone = String(piece?.zone || '').trim();
  if (Object.prototype.hasOwnProperty.call(PIECE_ZONE_CODES, zone)) {
    return PIECE_ZONE_CODES[zone];
  }
  return PIECE_ZONE_CODES.unknown;
}

function pushIdentityOneHot(target, identity) {
  const safeIdentity = Number.isFinite(identity) ? Number(identity) : IDENTITIES.UNKNOWN;
  pushOneHot(target, Math.max(0, Math.min(IDENTITIES.KNIGHT, safeIdentity)), IDENTITIES.KNIGHT + 1);
}

function pushPieceSlotFeatures(target, state, encoded, perspective, pieceId, guessedIdentities = null) {
  const piece = state?.pieces?.[pieceId] || null;
  const isWhite = pieceId.startsWith('w-');
  const pieceColor = isWhite ? WHITE : BLACK;
  const ownPiece = pieceColor === perspective ? 1 : 0;
  const opponentPiece = ownPiece ? 0 : 1;
  target.push(ownPiece, opponentPiece);

  const zoneCode = getPieceZoneCode(piece);
  pushOneHot(target, zoneCode, Object.keys(PIECE_ZONE_CODES).length);
  target.push(piece?.alive === false ? 0 : 1);

  let capturedByIndex = 2;
  if (Number.isFinite(piece?.capturedBy)) {
    capturedByIndex = Number(piece.capturedBy) === BLACK ? 1 : 0;
  }
  pushOneHot(target, capturedByIndex, 3);

  const boardIndex = zoneCode === PIECE_ZONE_CODES.board
    ? squareToIndex(piece?.row, piece?.col)
    : -1;
  pushOneHot(target, boardIndex >= 0 ? boardIndex : BOARD_SIZE, BOARD_SIZE + 1);

  const publicIdentity = getPublicIdentityForPiece(state, piece, perspective, guessedIdentities);
  pushIdentityOneHot(target, publicIdentity);
  target.push(Number.isFinite(state?.revealedIdentities?.[pieceId]) ? 1 : 0);

  const encodedIndex = Object.prototype.hasOwnProperty.call(encoded.pieceIndexById || {}, pieceId)
    ? encoded.pieceIndexById[pieceId]
    : -1;
  target.push(encodedIndex >= 0 ? normalizeZeroOne(encodedIndex, SHARED_STABLE_PIECE_IDS.length - 1) : 0);
}

function getActionDetails(action = {}) {
  return action?.details && typeof action.details === 'object'
    ? action.details
    : action;
}

function getActionSquareIndex(squareLike) {
  return Number.isFinite(squareLike?.row) && Number.isFinite(squareLike?.col)
    ? squareToIndex(squareLike.row, squareLike.col)
    : -1;
}

function getMoveStateIndex(details = {}) {
  const raw = String(details?.state || '').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(MOVE_STATE_CODES, raw)) {
    return MOVE_STATE_CODES[raw];
  }
  if (Number.isFinite(details?.state)) {
    const numeric = Number(details.state);
    if (numeric >= 0 && numeric <= MOVE_STATE_CODES.resolved) {
      return numeric;
    }
  }
  return MOVE_STATE_CODES.none;
}

function pushHistoryActionFeatures(target, state, perspective, action = null) {
  const details = getActionDetails(action);
  const actionType = normalizeActionType(action?.type);
  pushOneHot(target, ACTION_TYPE_CODES[actionType] || ACTION_TYPE_CODES.none, Object.keys(ACTION_TYPE_CODES).length);

  const playerIndex = Number.isFinite(action?.player)
    ? (Number(action.player) === BLACK ? 1 : 0)
    : 2;
  pushOneHot(target, playerIndex, 3);

  pushOneHot(target, Math.max(-1, getActionSquareIndex(details?.from)) + 1, BOARD_SIZE + 1);
  pushOneHot(target, Math.max(-1, getActionSquareIndex(details?.to)) + 1, BOARD_SIZE + 1);

  const declaration = Number.isFinite(details?.declaration) ? Number(details.declaration) : IDENTITIES.UNKNOWN;
  pushIdentityOneHot(target, declaration);
  pushOneHot(target, getMoveStateIndex(details), Object.keys(MOVE_STATE_CODES).length);

  const revealedIdentity = Number.isFinite(details?.revealedIdentity)
    ? Number(details.revealedIdentity)
    : IDENTITIES.UNKNOWN;
  pushIdentityOneHot(target, revealedIdentity);

  const responsePlayer = Number.isFinite(state?.onDeckingPlayer)
    ? Number(state.onDeckingPlayer)
    : perspective;
  target.push(responsePlayer === perspective ? 1 : -1);
}

function buildSharedStateFeatureLabels() {
  const labels = [];
  labels.push('global.bias');
  labels.push('global.perspective.white', 'global.perspective.black');
  labels.push('global.to_move.white', 'global.to_move.black');
  labels.push('global.on_decking.white', 'global.on_decking.black', 'global.on_decking.none');
  labels.push('global.winner.white', 'global.winner.black', 'global.winner.draw', 'global.winner.none');
  labels.push('global.is_active');
  labels.push('global.daggers.self', 'global.daggers.opp');
  labels.push('global.moves_since_action');
  labels.push('global.ply_progress');
  labels.push('global.max_plies_scaled');
  labels.push('global.setup.white', 'global.setup.black');
  labels.push('global.ready.white', 'global.ready.black');

  SHARED_STABLE_PIECE_IDS.forEach((pieceId) => {
    labels.push(`${pieceId}.side.self`, `${pieceId}.side.opp`);
    Object.keys(PIECE_ZONE_CODES).forEach((zone) => {
      labels.push(`${pieceId}.zone.${zone}`);
    });
    labels.push(`${pieceId}.alive`);
    labels.push(`${pieceId}.captured_by.white`, `${pieceId}.captured_by.black`, `${pieceId}.captured_by.none`);
    for (let boardIndex = 0; boardIndex < BOARD_SIZE; boardIndex += 1) {
      labels.push(`${pieceId}.square.${boardIndex}`);
    }
    labels.push(`${pieceId}.square.offboard`);
    labels.push(
      `${pieceId}.public_identity.unknown`,
      `${pieceId}.public_identity.king`,
      `${pieceId}.public_identity.bomb`,
      `${pieceId}.public_identity.bishop`,
      `${pieceId}.public_identity.rook`,
      `${pieceId}.public_identity.knight`,
    );
    labels.push(`${pieceId}.revealed`);
    labels.push(`${pieceId}.slot_index_scaled`);
  });

  for (let slot = 0; slot < SHARED_HISTORY_ACTION_SLOTS; slot += 1) {
    Object.keys(ACTION_TYPE_CODES).forEach((key) => {
      labels.push(`history.${slot}.type.${key}`);
    });
    labels.push(`history.${slot}.player.white`, `history.${slot}.player.black`, `history.${slot}.player.none`);
    for (let boardIndex = -1; boardIndex < BOARD_SIZE; boardIndex += 1) {
      labels.push(`history.${slot}.from.${boardIndex < 0 ? 'none' : boardIndex}`);
    }
    for (let boardIndex = -1; boardIndex < BOARD_SIZE; boardIndex += 1) {
      labels.push(`history.${slot}.to.${boardIndex < 0 ? 'none' : boardIndex}`);
    }
    labels.push(
      `history.${slot}.declaration.unknown`,
      `history.${slot}.declaration.king`,
      `history.${slot}.declaration.bomb`,
      `history.${slot}.declaration.bishop`,
      `history.${slot}.declaration.rook`,
      `history.${slot}.declaration.knight`,
    );
    Object.keys(MOVE_STATE_CODES).forEach((key) => {
      labels.push(`history.${slot}.move_state.${key}`);
    });
    labels.push(
      `history.${slot}.revealed_identity.unknown`,
      `history.${slot}.revealed_identity.king`,
      `history.${slot}.revealed_identity.bomb`,
      `history.${slot}.revealed_identity.bishop`,
      `history.${slot}.revealed_identity.rook`,
      `history.${slot}.revealed_identity.knight`,
    );
    labels.push(`history.${slot}.response_alignment`);
  }
  return Object.freeze(labels);
}

const SHARED_STATE_FEATURE_LABELS = buildSharedStateFeatureLabels();

function encodeSharedState(state, perspective, guessedIdentities = null) {
  const encoded = ensureEncodedState(state);
  const vector = [];
  const winner = state?.winner;

  vector.push(1);
  pushOneHot(vector, perspective === BLACK ? 1 : 0, 2);
  pushOneHot(vector, Number(state?.playerTurn) === BLACK ? 1 : 0, 2);

  const onDeckIndex = Number.isFinite(state?.onDeckingPlayer)
    ? (Number(state.onDeckingPlayer) === BLACK ? 1 : 0)
    : 2;
  pushOneHot(vector, onDeckIndex, 3);

  const winnerIndex = winner === WHITE
    ? 0
    : winner === BLACK
      ? 1
      : state?.winReason === 'draw'
        ? 2
        : 3;
  pushOneHot(vector, winnerIndex, 4);

  vector.push(state?.isActive === false ? 0 : 1);
  vector.push(normalizeZeroOne(state?.daggers?.[perspective] || 0, 3));
  vector.push(normalizeZeroOne(state?.daggers?.[perspective === WHITE ? BLACK : WHITE] || 0, 3));
  vector.push(normalizeZeroOne(state?.movesSinceAction || 0, 20));
  const maxPlies = Math.max(1, Number(state?.maxPlies || 120));
  vector.push(normalizeZeroOne(state?.ply || 0, maxPlies));
  vector.push(normalizeZeroOne(maxPlies, 240));
  vector.push(state?.setupComplete?.[WHITE] ? 1 : 0, state?.setupComplete?.[BLACK] ? 1 : 0);
  vector.push(state?.playersReady?.[WHITE] ? 1 : 0, state?.playersReady?.[BLACK] ? 1 : 0);

  SHARED_STABLE_PIECE_IDS.forEach((pieceId) => {
    pushPieceSlotFeatures(vector, state, encoded, perspective, pieceId, guessedIdentities);
  });

  const recentActions = Array.isArray(state?.actions)
    ? state.actions.slice(-SHARED_HISTORY_ACTION_SLOTS)
    : [];
  const paddedActions = new Array(SHARED_HISTORY_ACTION_SLOTS).fill(null);
  for (let index = 0; index < recentActions.length; index += 1) {
    paddedActions[(SHARED_HISTORY_ACTION_SLOTS - recentActions.length) + index] = recentActions[index];
  }
  paddedActions.forEach((action) => {
    pushHistoryActionFeatures(vector, state, perspective, action);
  });

  return vector;
}

function getPolicySlotIdForAction(state, perspective, action) {
  const type = normalizeActionType(action?.type);
  if (type === 'move') {
    const details = getActionDetails(action);
    const fromIndex = Number.isFinite(action?._fromIndex)
      ? Number(action._fromIndex)
      : getActionSquareIndex(details?.from);
    const toIndex = Number.isFinite(action?._toIndex)
      ? Number(action._toIndex)
      : getActionSquareIndex(details?.to);
    const declaration = Number.isFinite(details?.declaration) ? Number(details.declaration) : IDENTITIES.UNKNOWN;
    if (fromIndex < 0 || toIndex < 0 || !DECLARABLE_IDENTITIES.includes(declaration)) {
      return null;
    }
    return `M:${fromIndex}:${toIndex}:${declaration}`;
  }

  if (type === 'on_deck') {
    const details = getActionDetails(action);
    let identity = Number.isFinite(details?.identity) ? Number(details.identity) : IDENTITIES.UNKNOWN;
    if (!Number.isFinite(identity) || identity === IDENTITIES.UNKNOWN) {
      const pieceId = details?.pieceId || action?.pieceId || null;
      identity = Number(state?.pieces?.[pieceId]?.identity || IDENTITIES.UNKNOWN);
    }
    return identity > IDENTITIES.UNKNOWN ? `O:${identity}` : null;
  }

  if (type === 'challenge') return 'A:CHALLENGE';
  if (type === 'bomb') return 'A:BOMB';
  if (type === 'pass') return 'A:PASS';
  if (type === 'resign') return 'A:RESIGN';
  return null;
}

function getPolicySlotForAction(state, perspective, action) {
  const id = getPolicySlotIdForAction(state, perspective, action);
  if (!id || !Object.prototype.hasOwnProperty.call(SHARED_POLICY_VOCABULARY.indexById, id)) {
    return null;
  }
  return SHARED_POLICY_VOCABULARY.indexById[id];
}

function mapLegalActionsToPolicySlots(state, perspective, actions = []) {
  return (Array.isArray(actions) ? actions : []).map((action) => ({
    action,
    slotId: getPolicySlotIdForAction(state, perspective, action),
    slotIndex: getPolicySlotForAction(state, perspective, action),
  })).filter((entry) => Number.isFinite(entry.slotIndex));
}

function buildBeliefTargetsForState(state, perspective) {
  const pieceIds = getBeliefPieceSlotsForPerspective(perspective);
  const targets = new Array(pieceIds.length).fill(IDENTITIES.UNKNOWN);
  const mask = new Array(pieceIds.length).fill(0);
  pieceIds.forEach((pieceId, index) => {
    const piece = state?.pieces?.[pieceId];
    if (!piece) return;
    const isHidden = !Number.isFinite(state?.revealedIdentities?.[pieceId]) && piece.alive !== false;
    if (!isHidden) return;
    targets[index] = Number(piece.identity || IDENTITIES.UNKNOWN);
    mask[index] = SHARED_BELIEF_IDENTITIES.includes(targets[index]) ? 1 : 0;
  });
  return { pieceIds, targets, mask };
}

function getSharedModelInterfaceSpec() {
  return {
    family: SHARED_MODEL_FAMILY,
    version: SHARED_MODEL_VERSION,
    boardSize: BOARD_SIZE,
    boardShape: { ranks: RANKS, files: FILES },
    stateInputSize: SHARED_STATE_FEATURE_LABELS.length,
    historyActionSlots: SHARED_HISTORY_ACTION_SLOTS,
    stablePieceIds: SHARED_STABLE_PIECE_IDS.slice(),
    beliefPieceSlotsPerPerspective: SHARED_BELIEF_SLOT_COUNT,
    beliefIdentities: SHARED_BELIEF_IDENTITIES.slice(),
    beliefIdentityCount: SHARED_BELIEF_IDENTITIES.length,
    policyActionVocabularySize: SHARED_POLICY_VOCABULARY.items.length,
  };
}

module.exports = {
  SHARED_MODEL_FAMILY,
  SHARED_MODEL_VERSION,
  SHARED_BELIEF_IDENTITIES,
  SHARED_BELIEF_SLOT_COUNT,
  SHARED_HISTORY_ACTION_SLOTS,
  SHARED_STABLE_PIECE_IDS,
  getSharedModelInterfaceSpec,
  getSharedPolicyVocabulary,
  getBeliefPieceSlotsForPerspective,
  getPolicySlotForAction,
  getPolicySlotIdForAction,
  mapLegalActionsToPolicySlots,
  encodeSharedState,
  buildBeliefTargetsForState,
  SHARED_STATE_FEATURE_LABELS,
};
