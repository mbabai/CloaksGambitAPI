const {
  ACTIONS,
  IDENTITIES,
  IDENTITY_COUNTS,
  PIECE_VALUES,
  MOVE_STATES,
  RANKS,
  FILES,
  WHITE,
  BLACK,
  createRng,
  getLegalActions,
  countMoveOptionsForColor,
  getHiddenPieceIds,
  moveCompatibilityScore,
  summarizeMaterial,
  findKing,
  distanceToThrone,
} = require('./engine');
const {
  addL2Penalty,
  applyAdamUpdate,
  backpropagateInto,
  clipGradientBundle,
  cloneNetwork,
  createAdamState,
  createGradientBundle,
  createMlp,
  forwardNetwork,
  prepareInputVector,
  scaleGradientBundle,
  zeroGradientBundle,
} = require('./network');

const POLICY_FEATURES = Object.freeze([
  'bias',
  'isMove',
  'isChallenge',
  'isBomb',
  'isPass',
  'isOnDeck',
  'capture',
  'captureKing',
  'forward',
  'distance',
  'targetCenter',
  'moverKing',
  'moverRook',
  'moverBishop',
  'moverKnight',
  'declaredKing',
  'declaredRook',
  'declaredBishop',
  'declaredKnight',
  'onDeckKing',
  'onDeckBomb',
  'onDeckBishop',
  'onDeckRook',
  'onDeckKnight',
  'kingThroneDelta',
  'materialDiff',
  'mobilityDiff',
  'responsePhase',
  'challengeWindow',
  'bombWindow',
  'ownDaggers',
  'oppDaggers',
  'stashDiff',
  'onDeckAdvantage',
]);

const VALUE_FEATURES = Object.freeze([
  'bias',
  'materialDiff',
  'mobilityDiff',
  'ownKingDistance',
  'oppKingDistance',
  'turnAdvantage',
  'pieceCountDiff',
  'plyProgress',
  'ownKingAlive',
  'oppKingAlive',
  'kingPressure',
  'daggerDiff',
  'stashDiff',
  'onDeckAdvantage',
  'movesSinceAction',
  'responsePressure',
]);

const IDENTITY_FEATURES = Object.freeze([
  'bias',
  'historyDepth',
  'captureSeen',
  'compatKing',
  'compatRook',
  'compatBishop',
  'compatKnight',
  'truthfulSignals',
  'failedSignals',
]);

const INFERRED_IDENTITIES = Object.freeze([
  IDENTITIES.KING,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
]);

const POLICY_HIDDEN_SIZES = Object.freeze([24]);
const VALUE_HIDDEN_SIZES = Object.freeze([16]);
const IDENTITY_HIDDEN_SIZES = Object.freeze([12]);

const DEFAULT_TRAINING_OPTIONS = Object.freeze({
  batchSize: 24,
  learningRate: 0.0025,
  weightDecay: 0.0001,
  gradientClipNorm: 5,
});

function softmax(scores, temperature = 1) {
  const values = Array.isArray(scores) ? scores : [];
  if (!values.length) return [];
  const safeTemp = Number.isFinite(temperature) && temperature > 0 ? temperature : 1;
  const scaled = values.map((score) => (score || 0) / safeTemp);
  const max = scaled.reduce((best, value) => (value > best ? value : best), Number.NEGATIVE_INFINITY);
  const exps = scaled.map((value) => Math.exp(value - max));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) {
    const uniform = 1 / values.length;
    return values.map(() => uniform);
  }
  return exps.map((value) => value / sum);
}

function tanh(value) {
  const clamped = Math.max(-25, Math.min(25, value || 0));
  return Math.tanh(clamped);
}

function shuffleInPlace(values, rng) {
  const source = Array.isArray(values) ? values.slice() : [];
  const random = typeof rng === 'function' ? rng : createRng(Date.now());
  for (let idx = source.length - 1; idx > 0; idx -= 1) {
    const swapIndex = Math.floor(random() * (idx + 1));
    [source[idx], source[swapIndex]] = [source[swapIndex], source[idx]];
  }
  return source;
}

function normalizeTrainingOptions(optionsOrLearningRate, overrides = {}) {
  const fromNumber = Number.isFinite(optionsOrLearningRate)
    ? { learningRate: optionsOrLearningRate }
    : (optionsOrLearningRate || {});
  return {
    ...DEFAULT_TRAINING_OPTIONS,
    ...fromNumber,
    ...overrides,
    batchSize: Math.max(1, Math.floor(fromNumber.batchSize || overrides.batchSize || DEFAULT_TRAINING_OPTIONS.batchSize)),
    learningRate: Math.max(1e-5, Number(fromNumber.learningRate || overrides.learningRate || DEFAULT_TRAINING_OPTIONS.learningRate)),
    weightDecay: Math.max(0, Number(fromNumber.weightDecay || overrides.weightDecay || DEFAULT_TRAINING_OPTIONS.weightDecay)),
    gradientClipNorm: Math.max(0, Number(
      fromNumber.gradientClipNorm
      || overrides.gradientClipNorm
      || DEFAULT_TRAINING_OPTIONS.gradientClipNorm
    )),
  };
}

function createPolicyNetwork(seed = Date.now()) {
  return createMlp({
    inputSize: POLICY_FEATURES.length,
    hiddenSizes: POLICY_HIDDEN_SIZES,
    outputSize: 1,
    seed,
  });
}

function createValueNetwork(seed = Date.now()) {
  return createMlp({
    inputSize: VALUE_FEATURES.length,
    hiddenSizes: VALUE_HIDDEN_SIZES,
    outputSize: 1,
    seed,
  });
}

function createIdentityNetwork(seed = Date.now()) {
  return createMlp({
    inputSize: IDENTITY_FEATURES.length,
    hiddenSizes: IDENTITY_HIDDEN_SIZES,
    outputSize: INFERRED_IDENTITIES.length,
    seed,
  });
}

function cloneLegacyWeights(weights, size) {
  return prepareInputVector(Array.isArray(weights) ? weights : [], size);
}

function convertLegacyPolicyNetwork(weights) {
  const network = createMlp({
    inputSize: POLICY_FEATURES.length,
    hiddenSizes: [],
    outputSize: 1,
    seed: 1,
  });
  network.layers[0].weights[0] = cloneLegacyWeights(weights, POLICY_FEATURES.length);
  network.layers[0].biases[0] = 0;
  return network;
}

function convertLegacyValueNetwork(weights) {
  const network = createMlp({
    inputSize: VALUE_FEATURES.length,
    hiddenSizes: [],
    outputSize: 1,
    seed: 2,
  });
  network.layers[0].weights[0] = cloneLegacyWeights(weights, VALUE_FEATURES.length);
  network.layers[0].biases[0] = 0;
  return network;
}

function legacyIdentityWeightsToRow(weights, identity) {
  const source = Array.isArray(weights) ? weights : [];
  const row = Array.from({ length: IDENTITY_FEATURES.length }, () => 0);
  row[0] = Number(source[0] || 0);
  row[1] = Number(source[2] || 0);
  row[2] = Number(source[3] || 0);
  row[7] = Number(source[2] || 0) * 0.2;
  row[8] = Number(source[3] || 0) * 0.1;
  if (identity === IDENTITIES.KING) row[3] = Number(source[1] || 0);
  if (identity === IDENTITIES.ROOK) row[4] = Number(source[1] || 0);
  if (identity === IDENTITIES.BISHOP) row[5] = Number(source[1] || 0);
  if (identity === IDENTITIES.KNIGHT) row[6] = Number(source[1] || 0);
  return row;
}

function convertLegacyIdentityNetwork(weightsByIdentity = {}) {
  const network = createMlp({
    inputSize: IDENTITY_FEATURES.length,
    hiddenSizes: [],
    outputSize: INFERRED_IDENTITIES.length,
    seed: 3,
  });
  INFERRED_IDENTITIES.forEach((identity, idx) => {
    network.layers[0].weights[idx] = legacyIdentityWeightsToRow(weightsByIdentity[identity], identity);
    network.layers[0].biases[idx] = 0;
  });
  return network;
}

function ensurePolicyModel(model = {}) {
  if (model.network && Array.isArray(model.network.layers) && model.network.layers.length) {
    return model;
  }
  model.version = 2;
  model.temperature = Number.isFinite(model.temperature) ? model.temperature : 1.1;
  model.network = Array.isArray(model.weights)
    ? convertLegacyPolicyNetwork(model.weights)
    : createPolicyNetwork(Date.now());
  delete model.weights;
  return model;
}

function ensureValueModel(model = {}) {
  if (model.network && Array.isArray(model.network.layers) && model.network.layers.length) {
    return model;
  }
  model.version = 2;
  model.network = Array.isArray(model.weights)
    ? convertLegacyValueNetwork(model.weights)
    : createValueNetwork(Date.now());
  delete model.weights;
  return model;
}

function ensureIdentityModel(model = {}) {
  if (model.network && Array.isArray(model.network.layers) && model.network.layers.length) {
    return model;
  }
  model.version = 2;
  model.temperature = Number.isFinite(model.temperature) ? model.temperature : 1;
  model.beamWidth = Number.isFinite(model.beamWidth) ? model.beamWidth : 24;
  model.network = model.weightsByIdentity
    ? convertLegacyIdentityNetwork(model.weightsByIdentity)
    : createIdentityNetwork(Date.now());
  delete model.weightsByIdentity;
  return model;
}

function normalizeModelBundle(modelBundle) {
  const source = modelBundle || {};
  source.version = 2;
  source.policy = ensurePolicyModel(source.policy || {});
  source.value = ensureValueModel(source.value || {});
  source.identity = ensureIdentityModel(source.identity || {});
  return source;
}

function createDefaultModelBundle(options = {}) {
  const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
  return normalizeModelBundle({
    version: 2,
    policy: {
      version: 2,
      temperature: 1,
      network: createPolicyNetwork(seed + 11),
    },
    value: {
      version: 2,
      network: createValueNetwork(seed + 29),
    },
    identity: {
      version: 2,
      temperature: 1,
      beamWidth: 24,
      network: createIdentityNetwork(seed + 47),
    },
  });
}

function cloneModelBundle(modelBundle) {
  const normalized = normalizeModelBundle(modelBundle || createDefaultModelBundle());
  return {
    version: 2,
    policy: {
      version: 2,
      temperature: normalized.policy.temperature,
      network: cloneNetwork(normalized.policy.network),
    },
    value: {
      version: 2,
      network: cloneNetwork(normalized.value.network),
    },
    identity: {
      version: 2,
      temperature: normalized.identity.temperature,
      beamWidth: normalized.identity.beamWidth,
      network: cloneNetwork(normalized.identity.network),
    },
  };
}

function identityForFeature(piece, perspective, guessedIdentities) {
  if (!piece) return IDENTITIES.UNKNOWN;
  if (piece.color === perspective) {
    return piece.identity;
  }
  if (guessedIdentities && Object.prototype.hasOwnProperty.call(guessedIdentities, piece.id)) {
    return guessedIdentities[piece.id];
  }
  return IDENTITIES.UNKNOWN;
}

function countAlivePieces(state, color) {
  let count = 0;
  Object.values(state.pieces || {}).forEach((piece) => {
    if (piece && piece.alive && piece.color === color) {
      count += 1;
    }
  });
  return count;
}

function countStashPieces(state, color) {
  return Array.isArray(state?.stashes?.[color]) ? state.stashes[color].length : 0;
}

function getResponsePhaseInfo(state) {
  const lastAction = Array.isArray(state?.actions) && state.actions.length
    ? state.actions[state.actions.length - 1]
    : null;
  const lastMove = Array.isArray(state?.moves) && state.moves.length
    ? state.moves[state.moves.length - 1]
    : null;
  const lastType = String(lastAction?.type || '').toUpperCase();
  const movePending = Boolean(lastMove && lastMove.state === MOVE_STATES.PENDING);
  const responsePhase = Boolean(
    (lastType === ACTIONS.MOVE || lastType === 'MOVE') && movePending,
  );
  const bombPhase = lastType === ACTIONS.BOMB || lastType === 'BOMB';
  return {
    responsePhase: responsePhase || bombPhase ? 1 : 0,
    challengeWindow: responsePhase || bombPhase ? 1 : 0,
    bombWindow: responsePhase ? 1 : 0,
  };
}

function extractStateFeatures(state, perspective, guessedIdentities = null) {
  const opponent = perspective === WHITE ? BLACK : WHITE;
  const ownMoves = countMoveOptionsForColor(state, perspective);
  const oppMoves = countMoveOptionsForColor(state, opponent);
  const material = summarizeMaterial(state, perspective, guessedIdentities);
  const ownKing = findKing(state, perspective);
  const oppKing = findKing(state, opponent);
  const ownPieces = countAlivePieces(state, perspective);
  const oppPieces = countAlivePieces(state, opponent);
  const maxPlies = Number.isFinite(state.maxPlies) && state.maxPlies > 0 ? state.maxPlies : 120;
  const ownKingDistance = ownKing ? distanceToThrone(ownKing) / (RANKS - 1) : 1.5;
  const oppKingDistance = oppKing ? distanceToThrone(oppKing) / (RANKS - 1) : 1.5;
  const daggerDiff = ((state?.daggers?.[perspective] || 0) - (state?.daggers?.[opponent] || 0)) / 3;
  const stashDiff = (countStashPieces(state, perspective) - countStashPieces(state, opponent)) / 4;
  const onDeckAdvantage = ((state?.onDecks?.[perspective] ? 1 : 0) - (state?.onDecks?.[opponent] ? 1 : 0));
  const movesSinceAction = Math.min(1, (Number(state.movesSinceAction || 0) || 0) / 20);
  const responseInfo = getResponsePhaseInfo(state);
  const materialDiff = (material.own - material.enemy) / 20;
  const mobilityDiff = (ownMoves - oppMoves) / 20;
  const pieceCountDiff = (ownPieces - oppPieces) / 5;
  const plyProgress = Math.min(1, (state.ply || 0) / maxPlies);
  const kingPressure = ((1 - oppKingDistance) - (1 - ownKingDistance)) * 0.5;

  return [
    1,
    materialDiff,
    mobilityDiff,
    ownKingDistance,
    oppKingDistance,
    state.toMove === perspective ? 1 : -1,
    pieceCountDiff,
    plyProgress,
    ownKing ? 1 : 0,
    oppKing ? 1 : 0,
    kingPressure,
    daggerDiff,
    stashDiff,
    onDeckAdvantage,
    movesSinceAction,
    responseInfo.responsePhase,
  ];
}

function toActionType(action) {
  if (!action || typeof action.type !== 'string') return '';
  return action.type.toUpperCase();
}

function getTargetIdentityEstimate(state, perspective, action, guessedIdentities = null) {
  if (!action || !action.to || !Number.isFinite(action.to.row) || !Number.isFinite(action.to.col)) {
    return IDENTITIES.UNKNOWN;
  }
  const target = state.board?.[action.to.row]?.[action.to.col];
  if (!target) return IDENTITIES.UNKNOWN;
  const piece = state.pieces[target];
  return identityForFeature(piece, perspective, guessedIdentities);
}

function extractActionFeatures(state, perspective, action, guessedIdentities = null, stateFeatures = null) {
  const type = toActionType(action);
  const isMove = type === ACTIONS.MOVE || type === 'MOVE';
  const isChallenge = type === ACTIONS.CHALLENGE || type === 'CHALLENGE';
  const isBomb = type === ACTIONS.BOMB || type === 'BOMB';
  const isPass = type === ACTIONS.PASS || type === 'PASS';
  const isOnDeck = type === ACTIONS.ON_DECK || type === 'ON_DECK';
  const responseInfo = getResponsePhaseInfo(state);
  const features = Array.isArray(stateFeatures)
    ? stateFeatures
    : extractStateFeatures(state, perspective, guessedIdentities);

  let capture = 0;
  let captureKing = 0;
  let forward = 0;
  let distance = 0;
  let targetCenter = 0;
  let moverKing = 0;
  let moverRook = 0;
  let moverBishop = 0;
  let moverKnight = 0;
  let declaredKing = 0;
  let declaredRook = 0;
  let declaredBishop = 0;
  let declaredKnight = 0;
  let onDeckKing = 0;
  let onDeckBomb = 0;
  let onDeckBishop = 0;
  let onDeckRook = 0;
  let onDeckKnight = 0;
  let kingThroneDelta = 0;

  if (isMove) {
    const piece = state.pieces[action.pieceId]
      || state.pieces[state.board?.[action.from?.row]?.[action.from?.col]]
      || null;
    if (piece && action.from && action.to) {
      const dr = action.to.row - action.from.row;
      const dc = action.to.col - action.from.col;
      distance = Math.sqrt((dr * dr) + (dc * dc)) / 5;
      forward = (perspective === WHITE ? dr : -dr) / (RANKS - 1);
      const centerRow = (RANKS - 1) / 2;
      const centerCol = (FILES - 1) / 2;
      const centerDistance = Math.abs(action.to.row - centerRow) + Math.abs(action.to.col - centerCol);
      targetCenter = 1 - (centerDistance / (RANKS + FILES));
      capture = action.capturePieceId ? 1 : 0;
      if (!capture) {
        capture = state.board?.[action.to.row]?.[action.to.col] ? 1 : 0;
      }
      const targetIdentity = getTargetIdentityEstimate(state, perspective, action, guessedIdentities);
      captureKing = (capture && targetIdentity === IDENTITIES.KING) ? 1 : 0;
      moverKing = piece.identity === IDENTITIES.KING ? 1 : 0;
      moverRook = piece.identity === IDENTITIES.ROOK ? 1 : 0;
      moverBishop = piece.identity === IDENTITIES.BISHOP ? 1 : 0;
      moverKnight = piece.identity === IDENTITIES.KNIGHT ? 1 : 0;
      const declaration = Number.isFinite(action.declaration) ? action.declaration : IDENTITIES.UNKNOWN;
      declaredKing = declaration === IDENTITIES.KING ? 1 : 0;
      declaredRook = declaration === IDENTITIES.ROOK ? 1 : 0;
      declaredBishop = declaration === IDENTITIES.BISHOP ? 1 : 0;
      declaredKnight = declaration === IDENTITIES.KNIGHT ? 1 : 0;
      const distBefore = piece.identity === IDENTITIES.KING
        ? (piece.color === WHITE ? (RANKS - 1 - action.from.row) : action.from.row)
        : 0;
      const distAfter = piece.identity === IDENTITIES.KING
        ? (piece.color === WHITE ? (RANKS - 1 - action.to.row) : action.to.row)
        : 0;
      kingThroneDelta = piece.identity === IDENTITIES.KING
        ? ((distBefore - distAfter) / (RANKS - 1))
        : 0;
    }
  } else if (isOnDeck) {
    const onDeckPiece = state.pieces[action.pieceId] || null;
    const identity = Number.isFinite(action.identity)
      ? action.identity
      : (onDeckPiece ? onDeckPiece.identity : IDENTITIES.UNKNOWN);
    onDeckKing = identity === IDENTITIES.KING ? 1 : 0;
    onDeckBomb = identity === IDENTITIES.BOMB ? 1 : 0;
    onDeckBishop = identity === IDENTITIES.BISHOP ? 1 : 0;
    onDeckRook = identity === IDENTITIES.ROOK ? 1 : 0;
    onDeckKnight = identity === IDENTITIES.KNIGHT ? 1 : 0;
  }

  return [
    1,
    isMove ? 1 : 0,
    isChallenge ? 1 : 0,
    isBomb ? 1 : 0,
    isPass ? 1 : 0,
    isOnDeck ? 1 : 0,
    capture,
    captureKing,
    forward,
    distance,
    targetCenter,
    moverKing,
    moverRook,
    moverBishop,
    moverKnight,
    declaredKing,
    declaredRook,
    declaredBishop,
    declaredKnight,
    onDeckKing,
    onDeckBomb,
    onDeckBishop,
    onDeckRook,
    onDeckKnight,
    kingThroneDelta,
    features[1] || 0,
    features[2] || 0,
    responseInfo.responsePhase,
    responseInfo.challengeWindow,
    responseInfo.bombWindow,
    (state?.daggers?.[perspective] || 0) / 3,
    (state?.daggers?.[perspective === WHITE ? BLACK : WHITE] || 0) / 3,
    features[12] || 0,
    features[13] || 0,
  ];
}

function predictPolicy(modelBundle, state, perspective, actions = null, guessedIdentities = null) {
  const normalizedBundle = normalizeModelBundle(modelBundle);
  const model = normalizedBundle.policy;
  const legalActions = Array.isArray(actions) ? actions : getLegalActions(state, perspective);
  if (!legalActions.length) {
    return {
      actions: [],
      scores: [],
      probabilities: [],
      features: [],
      stateFeatures: extractStateFeatures(state, perspective, guessedIdentities),
    };
  }

  const stateFeatures = extractStateFeatures(state, perspective, guessedIdentities);
  const featureMatrix = legalActions.map((action) => (
    extractActionFeatures(state, perspective, action, guessedIdentities, stateFeatures)
  ));
  const scores = featureMatrix.map((vector) => (
    forwardNetwork(model.network, vector)[0] || 0
  ));
  const probabilities = softmax(scores, model.temperature || 1);

  return {
    actions: legalActions,
    scores,
    probabilities,
    features: featureMatrix,
    stateFeatures,
  };
}

function predictValue(modelBundle, state, perspective, guessedIdentities = null) {
  const normalizedBundle = normalizeModelBundle(modelBundle);
  const features = extractStateFeatures(state, perspective, guessedIdentities);
  const raw = forwardNetwork(normalizedBundle.value.network, features)[0] || 0;
  return {
    value: tanh(raw),
    raw,
    features,
  };
}

function normalizeProbabilityMap(mapLike) {
  const keys = Object.keys(mapLike || {});
  if (!keys.length) return {};
  let sum = 0;
  keys.forEach((key) => {
    const value = Number(mapLike[key]);
    if (Number.isFinite(value) && value > 0) {
      sum += value;
    }
  });
  if (sum <= 0) {
    const uniform = 1 / keys.length;
    const uniformMap = {};
    keys.forEach((key) => {
      uniformMap[key] = uniform;
    });
    return uniformMap;
  }
  const normalized = {};
  keys.forEach((key) => {
    const value = Number(mapLike[key]);
    normalized[key] = Number.isFinite(value) && value > 0 ? value / sum : 0;
  });
  return normalized;
}

function buildIdentityFeaturesForPiece(state, pieceId) {
  const entries = state.moveHistoryByPiece?.[pieceId] || [];
  const captureSeen = entries.some((entry) => entry && entry.capture) ? 1 : 0;
  const historyDepth = Math.min(1, entries.length / 6);
  const truthfulSignals = Math.min(1, entries.filter((entry) => entry?.truthfulChallenge === true).length / 3);
  const failedSignals = Math.min(1, entries.filter((entry) => (
    entry
    && Number.isFinite(entry.revealedIdentity)
    && entry.declaration !== entry.revealedIdentity
  )).length / 3);
  const compatKing = moveCompatibilityScore(entries, IDENTITIES.KING);
  const compatRook = moveCompatibilityScore(entries, IDENTITIES.ROOK);
  const compatBishop = moveCompatibilityScore(entries, IDENTITIES.BISHOP);
  const compatKnight = moveCompatibilityScore(entries, IDENTITIES.KNIGHT);

  return {
    pieceFeatures: [
      1,
      historyDepth,
      captureSeen,
      compatKing,
      compatRook,
      compatBishop,
      compatKnight,
      truthfulSignals,
      failedSignals,
    ],
    featureByIdentity: {
      [IDENTITIES.KING]: [1, compatKing, historyDepth, captureSeen],
      [IDENTITIES.ROOK]: [1, compatRook, historyDepth, captureSeen],
      [IDENTITIES.BISHOP]: [1, compatBishop, historyDepth, captureSeen],
      [IDENTITIES.KNIGHT]: [1, compatKnight, historyDepth, captureSeen],
    },
  };
}

function legacyFeaturePacketToPieceFeatures(featureByIdentity = {}) {
  const compatKing = Number(featureByIdentity?.[IDENTITIES.KING]?.[1] || 0);
  const compatRook = Number(featureByIdentity?.[IDENTITIES.ROOK]?.[1] || 0);
  const compatBishop = Number(featureByIdentity?.[IDENTITIES.BISHOP]?.[1] || 0);
  const compatKnight = Number(featureByIdentity?.[IDENTITIES.KNIGHT]?.[1] || 0);
  const historyDepth = Number(
    featureByIdentity?.[IDENTITIES.KING]?.[2]
      || featureByIdentity?.[IDENTITIES.ROOK]?.[2]
      || 0,
  );
  const captureSeen = Number(
    featureByIdentity?.[IDENTITIES.KING]?.[3]
      || featureByIdentity?.[IDENTITIES.ROOK]?.[3]
      || 0,
  );
  return [
    1,
    historyDepth,
    captureSeen,
    compatKing,
    compatRook,
    compatBishop,
    compatKnight,
    0,
    0,
  ];
}

function predictIdentityForPiece(modelBundle, featurePacket) {
  const normalizedBundle = normalizeModelBundle(modelBundle);
  const model = normalizedBundle.identity;
  const pieceFeatures = Array.isArray(featurePacket?.pieceFeatures)
    ? featurePacket.pieceFeatures
    : legacyFeaturePacketToPieceFeatures(featurePacket?.featureByIdentity || featurePacket);
  const logits = forwardNetwork(model.network, pieceFeatures);
  const probabilities = softmax(logits, model.temperature || 1);
  const map = {};
  probabilities.forEach((value, idx) => {
    map[INFERRED_IDENTITIES[idx]] = value;
  });
  return normalizeProbabilityMap(map);
}

function getAssignmentPenalty(assignment) {
  const counts = {};
  Object.keys(assignment || {}).forEach((pieceId) => {
    const identity = assignment[pieceId];
    counts[identity] = (counts[identity] || 0) + 1;
  });
  let penalty = 0;
  INFERRED_IDENTITIES.forEach((identity) => {
    const maxCount = IDENTITY_COUNTS[identity] || Number.POSITIVE_INFINITY;
    const used = counts[identity] || 0;
    if (used > maxCount) {
      penalty += (used - maxCount) * 2.4;
    }
  });
  return penalty;
}

function buildIdentityHypotheses(modelBundle, perPieceProbabilities, options = {}) {
  const pieceIds = Object.keys(perPieceProbabilities || {});
  if (!pieceIds.length) {
    return [{ assignment: {}, probability: 1 }];
  }

  const beamWidth = Number.isFinite(options.beamWidth) && options.beamWidth > 0
    ? Math.floor(options.beamWidth)
    : Math.max(10, modelBundle?.identity?.beamWidth || 24);
  const hypothesisCount = Number.isFinite(options.count) && options.count > 0
    ? Math.floor(options.count)
    : 8;

  const entropyByPiece = {};
  pieceIds.forEach((pieceId) => {
    const probs = perPieceProbabilities[pieceId] || {};
    const entropy = INFERRED_IDENTITIES.reduce((sum, identity) => {
      const p = probs[identity] || 0;
      if (p <= 0) return sum;
      return sum - (p * Math.log(p));
    }, 0);
    entropyByPiece[pieceId] = entropy;
  });
  pieceIds.sort((a, b) => entropyByPiece[a] - entropyByPiece[b]);

  let beam = [{ assignment: {}, logProb: 0 }];
  pieceIds.forEach((pieceId) => {
    const probs = perPieceProbabilities[pieceId] || {};
    const candidates = [];
    beam.forEach((entry) => {
      INFERRED_IDENTITIES.forEach((identity) => {
        const probability = probs[identity] || 0;
        if (probability <= 0) return;
        const assignment = { ...entry.assignment, [pieceId]: identity };
        candidates.push({
          assignment,
          logProb: entry.logProb + Math.log(probability) - getAssignmentPenalty(assignment),
        });
      });
    });
    if (!candidates.length) {
      beam = beam.map((entry) => ({
        assignment: { ...entry.assignment, [pieceId]: IDENTITIES.ROOK },
        logProb: entry.logProb - 3,
      }));
      return;
    }
    candidates.sort((a, b) => b.logProb - a.logProb);
    beam = candidates.slice(0, beamWidth);
  });

  const maxLog = beam.reduce((best, entry) => (entry.logProb > best ? entry.logProb : best), Number.NEGATIVE_INFINITY);
  const exps = beam.map((entry) => Math.exp(entry.logProb - maxLog));
  const sum = exps.reduce((acc, value) => acc + value, 0);
  const normalized = beam.map((entry, idx) => ({
    assignment: entry.assignment,
    probability: sum > 0 ? exps[idx] / sum : (1 / beam.length),
  }));
  normalized.sort((a, b) => b.probability - a.probability);
  return normalized.slice(0, hypothesisCount);
}

function inferIdentityHypotheses(modelBundle, state, perspective, options = {}) {
  const revealed = state?.revealedIdentities || {};
  const hiddenPieceIds = getHiddenPieceIds(state, perspective).filter((pieceId) => !Number.isFinite(revealed[pieceId]));
  if (!hiddenPieceIds.length) {
    return {
      hiddenPieceIds: [],
      perPieceProbabilities: {},
      pieceFeatureByIdentity: {},
      pieceFeatureVectors: {},
      hypotheses: [{ assignment: {}, probability: 1 }],
      samples: [],
    };
  }

  const perPieceProbabilities = {};
  const pieceFeatureByIdentity = {};
  const pieceFeatureVectors = {};
  const samples = [];

  hiddenPieceIds.forEach((pieceId) => {
    const featurePacket = buildIdentityFeaturesForPiece(state, pieceId);
    pieceFeatureByIdentity[pieceId] = featurePacket.featureByIdentity;
    pieceFeatureVectors[pieceId] = featurePacket.pieceFeatures;
    const probabilities = predictIdentityForPiece(modelBundle, featurePacket);
    perPieceProbabilities[pieceId] = probabilities;

    const piece = state.pieces[pieceId];
    if (piece) {
      samples.push({
        pieceId,
        trueIdentity: piece.identity,
        pieceFeatures: featurePacket.pieceFeatures.slice(),
        featureByIdentity: featurePacket.featureByIdentity,
        probabilities,
      });
    }
  });

  return {
    hiddenPieceIds,
    perPieceProbabilities,
    pieceFeatureByIdentity,
    pieceFeatureVectors,
    hypotheses: buildIdentityHypotheses(modelBundle, perPieceProbabilities, options),
    samples,
  };
}

function applyRiskBiasToHypotheses(hypotheses, values, riskBias = 0.65) {
  if (!Array.isArray(hypotheses) || !hypotheses.length || !Array.isArray(values)) {
    return {
      value: 0,
      weights: [],
    };
  }
  const safeRisk = Number.isFinite(riskBias) ? Math.max(0, riskBias) : 0.65;
  const weighted = hypotheses.map((hypothesis, idx) => {
    const probability = hypothesis?.probability || 0;
    const value = Number.isFinite(values[idx]) ? values[idx] : 0;
    const adversity = Math.max(0, -value);
    const weight = probability * (1 + (safeRisk * adversity));
    return { weight, value };
  });
  const totalWeight = weighted.reduce((acc, item) => acc + item.weight, 0);
  if (totalWeight <= 0) {
    const uniform = 1 / weighted.length;
    return {
      value: weighted.reduce((acc, item) => acc + (item.value * uniform), 0),
      weights: weighted.map(() => uniform),
    };
  }
  const weights = weighted.map((item) => item.weight / totalWeight);
  return {
    value: weighted.reduce((acc, item, idx) => acc + (item.value * weights[idx]), 0),
    weights,
  };
}

function createOptimizerState(modelBundle) {
  const normalizedBundle = normalizeModelBundle(modelBundle);
  return {
    policy: createAdamState(normalizedBundle.policy.network),
    value: createAdamState(normalizedBundle.value.network),
    identity: createAdamState(normalizedBundle.identity.network),
  };
}

function trainPolicyModel(modelBundle, policySamples, optionsOrLearningRate = 0.01) {
  const samples = Array.isArray(policySamples) ? policySamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0, optimizerState: null };
  }

  const normalizedBundle = normalizeModelBundle(modelBundle);
  const model = normalizedBundle.policy;
  const options = normalizeTrainingOptions(optionsOrLearningRate, {
    learningRate: Number.isFinite(optionsOrLearningRate) ? optionsOrLearningRate : undefined,
    batchSize: 16,
  });
  const optimizerState = options.optimizerState || createAdamState(model.network);
  const shuffled = shuffleInPlace(samples, createRng(Date.now() + samples.length));
  let totalLoss = 0;
  let processed = 0;

  for (let start = 0; start < shuffled.length; start += options.batchSize) {
    const batch = shuffled.slice(start, start + options.batchSize);
    const gradients = zeroGradientBundle(createGradientBundle(model.network));
    let batchLoss = 0;
    let batchCount = 0;

    batch.forEach((sample) => {
      const features = Array.isArray(sample?.features) ? sample.features : [];
      const target = Array.isArray(sample?.target) ? normalizeTargetProbabilities(sample.target) : [];
      if (!features.length || features.length !== target.length) return;

      const caches = [];
      const logits = features.map((vector) => {
        const forward = forwardNetwork(model.network, vector, { keepCache: true });
        caches.push(forward.cache);
        return forward.output[0] || 0;
      });
      const probs = softmax(logits, model.temperature || 1);
      let sampleLoss = 0;
      for (let idx = 0; idx < probs.length; idx += 1) {
        const truth = target[idx] || 0;
        if (truth > 0) {
          sampleLoss += -truth * Math.log(Math.max(probs[idx], 1e-9));
        }
      }
      batchLoss += sampleLoss;
      batchCount += 1;

      for (let idx = 0; idx < probs.length; idx += 1) {
        const delta = (probs[idx] || 0) - (target[idx] || 0);
        backpropagateInto(model.network, caches[idx], [delta], gradients);
      }
    });

    if (!batchCount) continue;
    addL2Penalty(gradients, model.network, options.weightDecay);
    scaleGradientBundle(gradients, 1 / batchCount);
    clipGradientBundle(gradients, options.gradientClipNorm);
    applyAdamUpdate(model.network, gradients, optimizerState, options);

    totalLoss += batchLoss;
    processed += batchCount;
  }

  return {
    samples: processed,
    loss: processed > 0 ? totalLoss / processed : 0,
    optimizerState,
  };
}

function trainValueModel(modelBundle, valueSamples, optionsOrLearningRate = 0.01) {
  const samples = Array.isArray(valueSamples) ? valueSamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0, optimizerState: null };
  }

  const normalizedBundle = normalizeModelBundle(modelBundle);
  const model = normalizedBundle.value;
  const options = normalizeTrainingOptions(optionsOrLearningRate, {
    learningRate: Number.isFinite(optionsOrLearningRate) ? optionsOrLearningRate : undefined,
  });
  const optimizerState = options.optimizerState || createAdamState(model.network);
  const shuffled = shuffleInPlace(samples, createRng(Date.now() + (samples.length * 3)));
  let totalLoss = 0;
  let processed = 0;

  for (let start = 0; start < shuffled.length; start += options.batchSize) {
    const batch = shuffled.slice(start, start + options.batchSize);
    const gradients = zeroGradientBundle(createGradientBundle(model.network));
    let batchLoss = 0;
    let batchCount = 0;

    batch.forEach((sample) => {
      const features = Array.isArray(sample?.features) ? sample.features : [];
      const target = Number.isFinite(sample?.target) ? sample.target : 0;
      if (!features.length) return;
      const forward = forwardNetwork(model.network, features, { keepCache: true });
      const raw = forward.output[0] || 0;
      const pred = tanh(raw);
      const error = pred - target;
      batchLoss += error * error;
      batchCount += 1;
      const delta = 2 * error * (1 - (pred * pred));
      backpropagateInto(model.network, forward.cache, [delta], gradients);
    });

    if (!batchCount) continue;
    addL2Penalty(gradients, model.network, options.weightDecay);
    scaleGradientBundle(gradients, 1 / batchCount);
    clipGradientBundle(gradients, options.gradientClipNorm);
    applyAdamUpdate(model.network, gradients, optimizerState, options);

    totalLoss += batchLoss;
    processed += batchCount;
  }

  return {
    samples: processed,
    loss: processed > 0 ? totalLoss / processed : 0,
    optimizerState,
  };
}

function trainIdentityModel(modelBundle, identitySamples, optionsOrLearningRate = 0.01) {
  const samples = Array.isArray(identitySamples) ? identitySamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0, accuracy: 0, optimizerState: null };
  }

  const normalizedBundle = normalizeModelBundle(modelBundle);
  const model = normalizedBundle.identity;
  const options = normalizeTrainingOptions(optionsOrLearningRate, {
    learningRate: Number.isFinite(optionsOrLearningRate) ? optionsOrLearningRate : undefined,
  });
  const optimizerState = options.optimizerState || createAdamState(model.network);
  const shuffled = shuffleInPlace(samples, createRng(Date.now() + (samples.length * 5)));
  let totalLoss = 0;
  let processed = 0;
  let correct = 0;

  for (let start = 0; start < shuffled.length; start += options.batchSize) {
    const batch = shuffled.slice(start, start + options.batchSize);
    const gradients = zeroGradientBundle(createGradientBundle(model.network));
    let batchLoss = 0;
    let batchCount = 0;

    batch.forEach((sample) => {
      const truth = sample?.trueIdentity;
      const truthIndex = INFERRED_IDENTITIES.indexOf(truth);
      if (truthIndex < 0) return;

      const pieceFeatures = Array.isArray(sample?.pieceFeatures)
        ? sample.pieceFeatures
        : legacyFeaturePacketToPieceFeatures(sample?.featureByIdentity || {});
      const forward = forwardNetwork(model.network, pieceFeatures, { keepCache: true });
      const logits = Array.isArray(forward.output) ? forward.output : [];
      const probs = softmax(logits, model.temperature || 1);
      const predictedIndex = probs.reduce((bestIdx, value, idx, arr) => (
        value > arr[bestIdx] ? idx : bestIdx
      ), 0);
      if (predictedIndex === truthIndex) {
        correct += 1;
      }

      batchLoss += -Math.log(Math.max(probs[truthIndex] || 0, 1e-9));
      batchCount += 1;
      const gradient = probs.map((value, idx) => value - (idx === truthIndex ? 1 : 0));
      backpropagateInto(model.network, forward.cache, gradient, gradients);
    });

    if (!batchCount) continue;
    addL2Penalty(gradients, model.network, options.weightDecay);
    scaleGradientBundle(gradients, 1 / batchCount);
    clipGradientBundle(gradients, options.gradientClipNorm);
    applyAdamUpdate(model.network, gradients, optimizerState, options);

    totalLoss += batchLoss;
    processed += batchCount;
  }

  return {
    samples: processed,
    loss: processed > 0 ? totalLoss / processed : 0,
    accuracy: processed > 0 ? (correct / processed) : 0,
    optimizerState,
  };
}

function normalizeTargetProbabilities(target) {
  if (!Array.isArray(target) || !target.length) return [];
  let sum = 0;
  target.forEach((value) => {
    if (Number.isFinite(value) && value > 0) sum += value;
  });
  if (sum <= 0) {
    const uniform = 1 / target.length;
    return target.map(() => uniform);
  }
  return target.map((value) => {
    if (!Number.isFinite(value) || value <= 0) return 0;
    return value / sum;
  });
}

module.exports = {
  POLICY_FEATURES,
  VALUE_FEATURES,
  IDENTITY_FEATURES,
  INFERRED_IDENTITIES,
  applyRiskBiasToHypotheses,
  cloneModelBundle,
  createDefaultModelBundle,
  createOptimizerState,
  extractActionFeatures,
  extractMoveFeatures: extractActionFeatures,
  extractStateFeatures,
  inferIdentityHypotheses,
  normalizeModelBundle,
  normalizeTargetProbabilities,
  predictPolicy,
  predictValue,
  trainIdentityModel,
  trainPolicyModel,
  trainValueModel,
};
