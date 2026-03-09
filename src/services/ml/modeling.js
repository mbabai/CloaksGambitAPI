const {
  ACTIONS,
  IDENTITIES,
  IDENTITY_COUNTS,
  PIECE_VALUES,
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
]);

const IDENTITY_FEATURES = Object.freeze([
  'bias',
  'compatibility',
  'historyDepth',
  'captureSeen',
]);

const INFERRED_IDENTITIES = Object.freeze([
  IDENTITIES.KING,
  IDENTITIES.ROOK,
  IDENTITIES.BISHOP,
  IDENTITIES.KNIGHT,
]);

const DEFAULT_POLICY_WEIGHTS = Object.freeze([
  0.0,
  0.12,
  0.08,
  0.08,
  0.05,
  0.06,
  1.1,
  5.0,
  0.42,
  0.18,
  0.12,
  -0.15,
  0.06,
  0.07,
  0.09,
  0.25,
  0.14,
  0.13,
  0.14,
  0.1,
  0.02,
  0.04,
  0.04,
  0.04,
  1.9,
  0.28,
  0.26,
]);

const DEFAULT_VALUE_WEIGHTS = Object.freeze([
  0.0,
  1.25,
  0.55,
  -0.75,
  0.75,
  0.2,
  0.45,
  0.08,
  1.7,
  -1.7,
  0.4,
]);

function clampWeight(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-12, Math.min(12, value));
}

function dot(weights, features) {
  let total = 0;
  const length = Math.min(weights.length, features.length);
  for (let i = 0; i < length; i += 1) {
    total += (weights[i] || 0) * (features[i] || 0);
  }
  return total;
}

function softmax(scores, temperature = 1) {
  const values = Array.isArray(scores) ? scores : [];
  if (!values.length) return [];
  const safeTemp = Number.isFinite(temperature) && temperature > 0 ? temperature : 1;
  const adjusted = values.map((score) => (score || 0) / safeTemp);
  const max = adjusted.reduce((best, value) => (value > best ? value : best), Number.NEGATIVE_INFINITY);
  const exps = adjusted.map((value) => Math.exp(value - max));
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

function cloneWeights(weights) {
  return Array.isArray(weights) ? weights.slice() : [];
}

function cloneIdentityWeights(weightsByIdentity = {}) {
  const next = {};
  INFERRED_IDENTITIES.forEach((identity) => {
    next[identity] = cloneWeights(weightsByIdentity[identity]);
  });
  return next;
}

function createIdentityWeightTemplate(seed = Date.now()) {
  const rng = createRng(seed);
  const total = INFERRED_IDENTITIES.reduce((acc, identity) => acc + (IDENTITY_COUNTS[identity] || 0), 0);
  const byIdentity = {};
  INFERRED_IDENTITIES.forEach((identity) => {
    const prior = Math.log(((IDENTITY_COUNTS[identity] || 1) / total) || 0.25);
    byIdentity[identity] = [
      prior + ((rng() - 0.5) * 0.06),
      1.3 + ((rng() - 0.5) * 0.1),
      0.25 + ((rng() - 0.5) * 0.05),
      0.2 + ((rng() - 0.5) * 0.05),
    ].map(clampWeight);
  });
  return byIdentity;
}

function addNoise(weights, rng, scale = 0.05) {
  return weights.map((value) => clampWeight(value + ((rng() - 0.5) * scale)));
}

function createDefaultModelBundle(options = {}) {
  const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
  const rng = createRng(seed);
  return {
    policy: {
      weights: addNoise(DEFAULT_POLICY_WEIGHTS, rng, 0.05),
      temperature: 1.1,
    },
    value: {
      weights: addNoise(DEFAULT_VALUE_WEIGHTS, rng, 0.04),
    },
    identity: {
      weightsByIdentity: createIdentityWeightTemplate(seed + 11),
      temperature: 1,
      beamWidth: 24,
    },
  };
}

function cloneModelBundle(modelBundle) {
  const source = modelBundle || createDefaultModelBundle();
  return {
    policy: {
      ...source.policy,
      weights: cloneWeights(source.policy?.weights),
    },
    value: {
      ...source.value,
      weights: cloneWeights(source.value?.weights),
    },
    identity: {
      ...source.identity,
      weightsByIdentity: cloneIdentityWeights(source.identity?.weightsByIdentity),
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

function extractStateFeatures(state, perspective, guessedIdentities = null) {
  const opponent = perspective === WHITE ? BLACK : WHITE;
  // Mobility should be measured for both players regardless of whose turn it is.
  const ownMoves = countMoveOptionsForColor(state, perspective);
  const oppMoves = countMoveOptionsForColor(state, opponent);

  const material = summarizeMaterial(state, perspective, guessedIdentities);
  const ownKing = findKing(state, perspective);
  const oppKing = findKing(state, opponent);
  const ownAlive = ownKing ? 1 : 0;
  const oppAlive = oppKing ? 1 : 0;

  const ownPieces = countAlivePieces(state, perspective);
  const oppPieces = countAlivePieces(state, opponent);
  const maxPlies = Number.isFinite(state.maxPlies) && state.maxPlies > 0 ? state.maxPlies : 120;

  const ownKingDistance = ownKing ? distanceToThrone(ownKing) / (RANKS - 1) : 1.5;
  const oppKingDistance = oppKing ? distanceToThrone(oppKing) / (RANKS - 1) : 1.5;

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
    ownAlive,
    oppAlive,
    kingPressure,
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
      const forwardRaw = perspective === WHITE ? dr : -dr;
      forward = forwardRaw / (RANKS - 1);
      const centerRow = (RANKS - 1) / 2;
      const centerCol = (FILES - 1) / 2;
      const centerDistance = Math.abs(action.to.row - centerRow) + Math.abs(action.to.col - centerCol);
      targetCenter = 1 - (centerDistance / (RANKS + FILES));
      capture = action.capturePieceId ? 1 : 0;
      if (!capture) {
        const target = state.board?.[action.to.row]?.[action.to.col];
        capture = target ? 1 : 0;
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

  const features = Array.isArray(stateFeatures)
    ? stateFeatures
    : extractStateFeatures(state, perspective, guessedIdentities);
  const materialDiff = features[1] || 0;
  const mobilityDiff = features[2] || 0;

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
    materialDiff,
    mobilityDiff,
  ];
}

function predictPolicy(modelBundle, state, perspective, actions = null, guessedIdentities = null) {
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
  const weights = modelBundle?.policy?.weights || [];
  const featureMatrix = legalActions.map((action) => (
    extractActionFeatures(state, perspective, action, guessedIdentities, stateFeatures)
  ));
  const scores = featureMatrix.map((vector) => dot(weights, vector));
  const temperature = modelBundle?.policy?.temperature || 1;
  const probabilities = softmax(scores, temperature);

  return {
    actions: legalActions,
    scores,
    probabilities,
    features: featureMatrix,
    stateFeatures,
  };
}

function predictValue(modelBundle, state, perspective, guessedIdentities = null) {
  const features = extractStateFeatures(state, perspective, guessedIdentities);
  const weights = modelBundle?.value?.weights || [];
  const raw = dot(weights, features);
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
  const byIdentity = {};
  INFERRED_IDENTITIES.forEach((identity) => {
    byIdentity[identity] = [
      1,
      moveCompatibilityScore(entries, identity),
      historyDepth,
      captureSeen,
    ];
  });
  return byIdentity;
}

function predictIdentityForPiece(modelBundle, featureByIdentity) {
  const weightsByIdentity = modelBundle?.identity?.weightsByIdentity || {};
  const logits = {};
  INFERRED_IDENTITIES.forEach((identity) => {
    const features = featureByIdentity[identity] || IDENTITY_FEATURES.map(() => 0);
    const weights = weightsByIdentity[identity] || IDENTITY_FEATURES.map(() => 0);
    logits[identity] = dot(weights, features);
  });
  const scores = INFERRED_IDENTITIES.map((identity) => logits[identity]);
  const probabilities = softmax(scores, modelBundle?.identity?.temperature || 1);
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
        const p = probs[identity] || 0;
        if (p <= 0) return;
        const assignment = { ...entry.assignment, [pieceId]: identity };
        const penalty = getAssignmentPenalty(assignment);
        candidates.push({
          assignment,
          logProb: entry.logProb + Math.log(p) - penalty,
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
  const hiddenPieceIds = getHiddenPieceIds(state, perspective);
  if (!hiddenPieceIds.length) {
    return {
      hiddenPieceIds: [],
      perPieceProbabilities: {},
      pieceFeatureByIdentity: {},
      hypotheses: [{ assignment: {}, probability: 1 }],
      samples: [],
    };
  }

  const perPieceProbabilities = {};
  const pieceFeatureByIdentity = {};
  const samples = [];

  hiddenPieceIds.forEach((pieceId) => {
    const featureByIdentity = buildIdentityFeaturesForPiece(state, pieceId);
    pieceFeatureByIdentity[pieceId] = featureByIdentity;
    const probabilities = predictIdentityForPiece(modelBundle, featureByIdentity);
    perPieceProbabilities[pieceId] = probabilities;

    const piece = state.pieces[pieceId];
    if (piece) {
      samples.push({
        pieceId,
        trueIdentity: piece.identity,
        featureByIdentity,
        probabilities,
      });
    }
  });

  const hypotheses = buildIdentityHypotheses(modelBundle, perPieceProbabilities, {
    count: options.count,
    beamWidth: options.beamWidth,
  });

  return {
    hiddenPieceIds,
    perPieceProbabilities,
    pieceFeatureByIdentity,
    hypotheses,
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
    const value = weighted.reduce((acc, item) => acc + (item.value * uniform), 0);
    return {
      value,
      weights: weighted.map(() => uniform),
    };
  }
  const weights = weighted.map((item) => item.weight / totalWeight);
  const value = weighted.reduce((acc, item, idx) => acc + (item.value * weights[idx]), 0);
  return { value, weights };
}

function trainPolicyModel(modelBundle, policySamples, learningRate = 0.01) {
  const samples = Array.isArray(policySamples) ? policySamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0 };
  }
  const lr = Number.isFinite(learningRate) && learningRate > 0 ? learningRate : 0.01;
  const weights = modelBundle.policy.weights;
  let totalLoss = 0;
  let processed = 0;

  samples.forEach((sample) => {
    const features = sample?.features || [];
    const target = sample?.target || [];
    if (!features.length || features.length !== target.length) return;
    processed += 1;
    const logits = features.map((vector) => dot(weights, vector));
    const pred = softmax(logits, modelBundle.policy.temperature || 1);
    let sampleLoss = 0;
    for (let m = 0; m < pred.length; m += 1) {
      const t = target[m] || 0;
      if (t > 0) {
        sampleLoss += -t * Math.log(Math.max(pred[m], 1e-9));
      }
    }
    totalLoss += sampleLoss;

    const gradient = Array.from({ length: weights.length }, () => 0);
    const actionScale = 1 / Math.max(1, pred.length);
    for (let m = 0; m < pred.length; m += 1) {
      const delta = (pred[m] || 0) - (target[m] || 0);
      const vector = features[m];
      for (let i = 0; i < gradient.length; i += 1) {
        gradient[i] += delta * (vector[i] || 0) * actionScale;
      }
    }
    for (let i = 0; i < weights.length; i += 1) {
      weights[i] = clampWeight(weights[i] - (lr * gradient[i]));
    }
  });

  if (!processed) {
    return { samples: 0, loss: 0 };
  }
  return {
    samples: processed,
    loss: totalLoss / processed,
  };
}

function trainValueModel(modelBundle, valueSamples, learningRate = 0.01) {
  const samples = Array.isArray(valueSamples) ? valueSamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0 };
  }
  const lr = Number.isFinite(learningRate) && learningRate > 0 ? learningRate : 0.01;
  const weights = modelBundle.value.weights;
  let totalLoss = 0;

  samples.forEach((sample) => {
    const features = sample?.features || [];
    const target = Number.isFinite(sample?.target) ? sample.target : 0;
    if (!features.length) return;

    const raw = dot(weights, features);
    const pred = tanh(raw);
    const error = pred - target;
    totalLoss += error * error;
    const derivative = 1 - (pred * pred);
    const scalar = 2 * error * derivative;

    for (let i = 0; i < weights.length; i += 1) {
      weights[i] = clampWeight(weights[i] - (lr * scalar * (features[i] || 0)));
    }
  });

  return {
    samples: samples.length,
    loss: totalLoss / samples.length,
  };
}

function trainIdentityModel(modelBundle, identitySamples, learningRate = 0.01) {
  const samples = Array.isArray(identitySamples) ? identitySamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0, accuracy: 0 };
  }
  const lr = Number.isFinite(learningRate) && learningRate > 0 ? learningRate : 0.01;
  const weightsByIdentity = modelBundle.identity.weightsByIdentity;
  let totalLoss = 0;
  let correct = 0;

  let processed = 0;

  samples.forEach((sample) => {
    const truth = sample?.trueIdentity;
    if (!INFERRED_IDENTITIES.includes(truth)) return;
    processed += 1;
    const featureByIdentity = sample?.featureByIdentity || {};
    const logits = {};
    INFERRED_IDENTITIES.forEach((identity) => {
      logits[identity] = dot(
        weightsByIdentity[identity] || IDENTITY_FEATURES.map(() => 0),
        featureByIdentity[identity] || IDENTITY_FEATURES.map(() => 0),
      );
    });
    const probs = softmax(INFERRED_IDENTITIES.map((identity) => logits[identity]), modelBundle.identity.temperature || 1);
    let predictedIdentity = INFERRED_IDENTITIES[0];
    let bestProb = -1;
    INFERRED_IDENTITIES.forEach((identity, idx) => {
      if (probs[idx] > bestProb) {
        bestProb = probs[idx];
        predictedIdentity = identity;
      }
    });
    if (predictedIdentity === truth) {
      correct += 1;
    }

    const truthIndex = INFERRED_IDENTITIES.indexOf(truth);
    const truthProb = Math.max(1e-9, probs[truthIndex] || 0);
    totalLoss += -Math.log(truthProb);

    INFERRED_IDENTITIES.forEach((identity, idx) => {
      const target = identity === truth ? 1 : 0;
      const delta = (probs[idx] || 0) - target;
      const features = featureByIdentity[identity] || IDENTITY_FEATURES.map(() => 0);
      const weights = weightsByIdentity[identity] || IDENTITY_FEATURES.map(() => 0);
      for (let i = 0; i < weights.length; i += 1) {
        weights[i] = clampWeight(weights[i] - (lr * delta * (features[i] || 0)));
      }
      weightsByIdentity[identity] = weights;
    });
  });

  return {
    samples: processed,
    loss: processed > 0 ? totalLoss / processed : 0,
    accuracy: processed > 0 ? (correct / processed) : 0,
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
  createDefaultModelBundle,
  cloneModelBundle,
  extractStateFeatures,
  extractActionFeatures,
  extractMoveFeatures: extractActionFeatures,
  predictPolicy,
  predictValue,
  inferIdentityHypotheses,
  applyRiskBiasToHypotheses,
  trainPolicyModel,
  trainValueModel,
  trainIdentityModel,
  normalizeTargetProbabilities,
};
