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
  forwardNetworkScalarBatch,
  prepareInputVector,
  scaleGradientBundle,
  zeroGradientBundle,
} = require('./network');
const {
  ensureEncodedState,
  squareToIndex,
  NO_PIECE,
} = require('./stateEncoding');
const {
  SHARED_MODEL_FAMILY,
  SHARED_MODEL_VERSION,
  SHARED_BELIEF_IDENTITIES,
  getSharedModelInterfaceSpec,
  encodeSharedState,
  getBeliefPieceSlotsForPerspective,
  mapLegalActionsToPolicySlots,
  buildBeliefTargetsForState,
} = require('./sharedEncoderModel');
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
  IDENTITIES.BOMB,
]);

const POLICY_HIDDEN_SIZES = Object.freeze([128, 128]);
const VALUE_HIDDEN_SIZES = Object.freeze([64, 64]);
const IDENTITY_HIDDEN_SIZES = Object.freeze([64, 64]);

const DEFAULT_TRAINING_OPTIONS = Object.freeze({
  batchSize: 24,
  learningRate: 0.0025,
  weightDecay: 0.0001,
  gradientClipNorm: 5,
});
const DEFAULT_SHARED_MODEL_SIZE_PRESET = '32k';
const SHARED_MODEL_SIZE_PRESETS = Object.freeze([
  Object.freeze({
    id: '32k',
    label: '32K',
    encoderHiddenSizes: Object.freeze([16, 16, 12]),
    policyHiddenSizes: Object.freeze([8]),
    valueHiddenSizes: Object.freeze([12]),
    identityHiddenSizes: Object.freeze([8]),
  }),
  Object.freeze({
    id: '65k',
    label: '65K',
    encoderHiddenSizes: Object.freeze([28, 24, 24]),
    policyHiddenSizes: Object.freeze([24]),
    valueHiddenSizes: Object.freeze([8]),
    identityHiddenSizes: Object.freeze([40]),
  }),
  Object.freeze({
    id: '126k',
    label: '126K',
    encoderHiddenSizes: Object.freeze([64, 40, 28]),
    policyHiddenSizes: Object.freeze([28]),
    valueHiddenSizes: Object.freeze([12]),
    identityHiddenSizes: Object.freeze([40]),
  }),
  Object.freeze({
    id: '256k',
    label: '256K',
    encoderHiddenSizes: Object.freeze([96, 96, 56]),
    policyHiddenSizes: Object.freeze([112]),
    valueHiddenSizes: Object.freeze([28]),
    identityHiddenSizes: Object.freeze([80]),
  }),
  Object.freeze({
    id: '512k',
    label: '512K',
    encoderHiddenSizes: Object.freeze([160, 144, 144]),
    policyHiddenSizes: Object.freeze([224]),
    valueHiddenSizes: Object.freeze([144]),
    identityHiddenSizes: Object.freeze([72]),
  }),
]);

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

function cloneSizePresetDefinition(definition) {
  return {
    ...definition,
    encoderHiddenSizes: definition.encoderHiddenSizes.slice(),
    policyHiddenSizes: definition.policyHiddenSizes.slice(),
    valueHiddenSizes: definition.valueHiddenSizes.slice(),
    identityHiddenSizes: definition.identityHiddenSizes.slice(),
  };
}

function getSharedModelSizePresetDefinition(value) {
  const normalized = String(value || DEFAULT_SHARED_MODEL_SIZE_PRESET).trim().toLowerCase();
  return SHARED_MODEL_SIZE_PRESETS.find((preset) => preset.id === normalized)
    || SHARED_MODEL_SIZE_PRESETS.find((preset) => preset.id === DEFAULT_SHARED_MODEL_SIZE_PRESET)
    || SHARED_MODEL_SIZE_PRESETS[0];
}

function normalizeSharedModelCreationOptions(options = {}) {
  if (Number.isFinite(options)) {
    return {
      seed: Number(options),
      preset: cloneSizePresetDefinition(getSharedModelSizePresetDefinition(DEFAULT_SHARED_MODEL_SIZE_PRESET)),
    };
  }
  const source = options || {};
  return {
    seed: Number.isFinite(source.seed) ? Number(source.seed) : Date.now(),
    preset: cloneSizePresetDefinition(getSharedModelSizePresetDefinition(
      source.modelSizePreset || source.sizePreset || source.presetId,
    )),
  };
}

function inferSharedModelSizePresetId(modelBundle) {
  const encoderHiddenSizes = Array.isArray(modelBundle?.encoder?.network?.hiddenSizes)
    ? modelBundle.encoder.network.hiddenSizes.map((size) => Number(size || 0))
    : [];
  const policyHiddenSizes = Array.isArray(modelBundle?.policy?.network?.hiddenSizes)
    ? modelBundle.policy.network.hiddenSizes.map((size) => Number(size || 0))
    : [];
  const valueHiddenSizes = Array.isArray(modelBundle?.value?.network?.hiddenSizes)
    ? modelBundle.value.network.hiddenSizes.map((size) => Number(size || 0))
    : [];
  const identityHiddenSizes = Array.isArray(modelBundle?.identity?.network?.hiddenSizes)
    ? modelBundle.identity.network.hiddenSizes.map((size) => Number(size || 0))
    : [];
  const matched = SHARED_MODEL_SIZE_PRESETS.find((preset) => (
    JSON.stringify(preset.encoderHiddenSizes) === JSON.stringify(encoderHiddenSizes)
    && JSON.stringify(preset.policyHiddenSizes) === JSON.stringify(policyHiddenSizes)
    && JSON.stringify(preset.valueHiddenSizes) === JSON.stringify(valueHiddenSizes)
    && JSON.stringify(preset.identityHiddenSizes) === JSON.stringify(identityHiddenSizes)
  ));
  return matched?.id || null;
}

function getSharedModelSizePresetOptions() {
  return SHARED_MODEL_SIZE_PRESETS.map((preset) => {
    const bundle = createSharedDefaultModelBundle({
      seed: 1,
      modelSizePreset: preset.id,
    });
    return {
      id: preset.id,
      value: preset.id,
      label: preset.label,
      descriptor: describeModelBundle(bundle),
      parameterCount: countModelBundleParameters(bundle),
    };
  });
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

function needsIdentityNetworkMigration(network) {
  if (!network || !Array.isArray(network.layers) || !network.layers.length) {
    return true;
  }
  if (Number(network.inputSize || 0) !== IDENTITY_FEATURES.length) {
    return true;
  }
  if (Number(network.outputSize || 0) !== INFERRED_IDENTITIES.length) {
    return true;
  }
  const finalLayer = network.layers[network.layers.length - 1] || null;
  if (Number(finalLayer?.outputSize || 0) !== INFERRED_IDENTITIES.length) {
    return true;
  }
  return false;
}

function migrateIdentityNetwork(network, seed = Date.now()) {
  const source = cloneNetwork(network || createIdentityNetwork(seed));
  const hiddenSizes = Array.isArray(source.hiddenSizes)
    ? source.hiddenSizes
      .map((size) => Math.max(1, Math.floor(size)))
      .filter(Boolean)
    : [];
  const target = createMlp({
    inputSize: IDENTITY_FEATURES.length,
    hiddenSizes,
    outputSize: INFERRED_IDENTITIES.length,
    seed,
  });

  const sharedLayerCount = Math.min(source.layers.length, target.layers.length);
  for (let layerIdx = 0; layerIdx < sharedLayerCount; layerIdx += 1) {
    const sourceLayer = source.layers[layerIdx];
    const targetLayer = target.layers[layerIdx];
    const sharedOutputs = Math.min(
      Math.max(0, Number(sourceLayer?.outputSize || 0)),
      Math.max(0, Number(targetLayer?.outputSize || 0)),
    );
    const sharedInputs = Math.min(
      Math.max(0, Number(sourceLayer?.inputSize || 0)),
      Math.max(0, Number(targetLayer?.inputSize || 0)),
    );
    for (let out = 0; out < sharedOutputs; out += 1) {
      for (let input = 0; input < sharedInputs; input += 1) {
        targetLayer.weights[out][input] = Number(sourceLayer?.weights?.[out]?.[input] || 0);
      }
      targetLayer.biases[out] = Number(sourceLayer?.biases?.[out] || 0);
    }
  }
  return target;
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
  model.version = 2;
  model.temperature = Number.isFinite(model.temperature) ? model.temperature : 1;
  model.beamWidth = Number.isFinite(model.beamWidth) ? model.beamWidth : 24;
  if (model.network && Array.isArray(model.network.layers) && model.network.layers.length) {
    model.network = needsIdentityNetworkMigration(model.network)
      ? migrateIdentityNetwork(model.network, Date.now())
      : model.network;
  } else {
    model.network = model.weightsByIdentity
      ? convertLegacyIdentityNetwork(model.weightsByIdentity)
      : createIdentityNetwork(Date.now());
  }
  model.inferredIdentities = INFERRED_IDENTITIES.slice();
  delete model.weightsByIdentity;
  return model;
}

function normalizeLegacyModelBundle(modelBundle) {
  const source = modelBundle || {};
  source.version = 2;
  source.policy = ensurePolicyModel(source.policy || {});
  source.value = ensureValueModel(source.value || {});
  source.identity = ensureIdentityModel(source.identity || {});
  return source;
}

function createLegacyDefaultModelBundle(options = {}) {
  const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
  return normalizeLegacyModelBundle({
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

function createSharedEncoderNetwork(options = {}) {
  const { seed, preset } = normalizeSharedModelCreationOptions(options);
  return createMlp({
    inputSize: getSharedModelInterfaceSpec().stateInputSize,
    hiddenSizes: preset.encoderHiddenSizes,
    outputSize: preset.encoderHiddenSizes[preset.encoderHiddenSizes.length - 1],
    seed,
  });
}

function createSharedPolicyHead(options = {}) {
  const { seed, preset } = normalizeSharedModelCreationOptions(options);
  return createMlp({
    inputSize: preset.encoderHiddenSizes[preset.encoderHiddenSizes.length - 1],
    hiddenSizes: preset.policyHiddenSizes,
    outputSize: getSharedModelInterfaceSpec().policyActionVocabularySize,
    seed,
  });
}

function createSharedValueHead(options = {}) {
  const { seed, preset } = normalizeSharedModelCreationOptions(options);
  return createMlp({
    inputSize: preset.encoderHiddenSizes[preset.encoderHiddenSizes.length - 1],
    hiddenSizes: preset.valueHiddenSizes,
    outputSize: 1,
    seed,
  });
}

function createSharedIdentityHead(options = {}) {
  const { seed, preset } = normalizeSharedModelCreationOptions(options);
  const spec = getSharedModelInterfaceSpec();
  return createMlp({
    inputSize: preset.encoderHiddenSizes[preset.encoderHiddenSizes.length - 1],
    hiddenSizes: preset.identityHiddenSizes,
    outputSize: spec.beliefPieceSlotsPerPerspective * spec.beliefIdentityCount,
    seed,
  });
}

function ensureSharedEncoderModel(model = {}) {
  model.version = SHARED_MODEL_VERSION;
  model.network = (model.network && Array.isArray(model.network.layers) && model.network.layers.length)
    ? cloneNetwork(model.network)
    : createSharedEncoderNetwork({
      seed: Date.now(),
      modelSizePreset: model.modelSizePreset,
    });
  delete model.modelSizePreset;
  return model;
}

function ensureSharedPolicyHead(model = {}) {
  model.version = SHARED_MODEL_VERSION;
  model.temperature = Number.isFinite(model.temperature) ? model.temperature : 1;
  model.vocabularyVersion = 'shared_policy_v1';
  model.network = (model.network && Array.isArray(model.network.layers) && model.network.layers.length)
    ? cloneNetwork(model.network)
    : createSharedPolicyHead({
      seed: Date.now(),
      modelSizePreset: model.modelSizePreset,
    });
  delete model.modelSizePreset;
  return model;
}

function ensureSharedValueHead(model = {}) {
  model.version = SHARED_MODEL_VERSION;
  model.network = (model.network && Array.isArray(model.network.layers) && model.network.layers.length)
    ? cloneNetwork(model.network)
    : createSharedValueHead({
      seed: Date.now(),
      modelSizePreset: model.modelSizePreset,
    });
  delete model.modelSizePreset;
  return model;
}

function ensureSharedIdentityHead(model = {}) {
  model.version = SHARED_MODEL_VERSION;
  model.temperature = Number.isFinite(model.temperature) ? model.temperature : 1;
  model.beamWidth = Number.isFinite(model.beamWidth) ? model.beamWidth : 24;
  model.inferredIdentities = SHARED_BELIEF_IDENTITIES.slice();
  model.beliefSlotCount = getSharedModelInterfaceSpec().beliefPieceSlotsPerPerspective;
  model.network = (model.network && Array.isArray(model.network.layers) && model.network.layers.length)
    ? cloneNetwork(model.network)
    : createSharedIdentityHead({
      seed: Date.now(),
      modelSizePreset: model.modelSizePreset,
    });
  delete model.modelSizePreset;
  return model;
}

function isSharedEncoderModelBundle(modelBundle) {
  return String(modelBundle?.family || '').trim().toLowerCase() === SHARED_MODEL_FAMILY;
}

function normalizeSharedModelBundle(modelBundle) {
  const source = modelBundle || {};
  const inferredPresetId = inferSharedModelSizePresetId(source)
    || String(source?.architecture?.presetId || source?.modelSizePreset || '').trim().toLowerCase()
    || DEFAULT_SHARED_MODEL_SIZE_PRESET;
  source.version = SHARED_MODEL_VERSION;
  source.family = SHARED_MODEL_FAMILY;
  source.interface = {
    ...getSharedModelInterfaceSpec(),
    ...(source.interface || {}),
  };
  source.architecture = {
    type: 'shared_encoder_mlp',
    presetId: inferSharedModelSizePresetId(source) || null,
    ...((source.architecture && typeof source.architecture === 'object') ? source.architecture : {}),
  };
  source.encoder = ensureSharedEncoderModel({ ...(source.encoder || {}), modelSizePreset: inferredPresetId });
  source.policy = ensureSharedPolicyHead({ ...(source.policy || {}), modelSizePreset: inferredPresetId });
  source.value = ensureSharedValueHead({ ...(source.value || {}), modelSizePreset: inferredPresetId });
  source.identity = ensureSharedIdentityHead({ ...(source.identity || {}), modelSizePreset: inferredPresetId });
  source.architecture.presetId = inferSharedModelSizePresetId(source) || inferredPresetId || null;
  return source;
}

function normalizeModelBundle(modelBundle) {
  if (isSharedEncoderModelBundle(modelBundle)) {
    return normalizeSharedModelBundle(modelBundle);
  }
  return normalizeLegacyModelBundle(modelBundle);
}

function createSharedDefaultModelBundle(options = {}) {
  const { seed, preset } = normalizeSharedModelCreationOptions(options);
  return normalizeSharedModelBundle({
    version: SHARED_MODEL_VERSION,
    family: SHARED_MODEL_FAMILY,
    interface: getSharedModelInterfaceSpec(),
    architecture: {
      type: 'shared_encoder_mlp',
      presetId: preset.id,
    },
    encoder: {
      version: SHARED_MODEL_VERSION,
      network: createSharedEncoderNetwork({
        seed: seed + 11,
        modelSizePreset: preset.id,
      }),
    },
    policy: {
      version: SHARED_MODEL_VERSION,
      temperature: 1,
      vocabularyVersion: 'shared_policy_v1',
      network: createSharedPolicyHead({
        seed: seed + 29,
        modelSizePreset: preset.id,
      }),
    },
    value: {
      version: SHARED_MODEL_VERSION,
      network: createSharedValueHead({
        seed: seed + 47,
        modelSizePreset: preset.id,
      }),
    },
    identity: {
      version: SHARED_MODEL_VERSION,
      temperature: 1,
      beamWidth: 24,
      inferredIdentities: SHARED_BELIEF_IDENTITIES.slice(),
      beliefSlotCount: getSharedModelInterfaceSpec().beliefPieceSlotsPerPerspective,
      network: createSharedIdentityHead({
        seed: seed + 71,
        modelSizePreset: preset.id,
      }),
    },
  });
}

function createDefaultModelBundle(options = {}) {
  return createSharedDefaultModelBundle(options);
}

function cloneModelBundle(modelBundle) {
  const normalized = normalizeModelBundle(modelBundle || createDefaultModelBundle());
  if (isSharedEncoderModelBundle(normalized)) {
    return {
      version: SHARED_MODEL_VERSION,
      family: SHARED_MODEL_FAMILY,
      interface: {
        ...getSharedModelInterfaceSpec(),
        ...(normalized.interface || {}),
      },
      architecture: normalized.architecture && typeof normalized.architecture === 'object'
        ? { ...normalized.architecture }
        : null,
      encoder: {
        version: SHARED_MODEL_VERSION,
        network: cloneNetwork(normalized.encoder.network),
      },
      policy: {
        version: SHARED_MODEL_VERSION,
        temperature: normalized.policy.temperature,
        vocabularyVersion: normalized.policy.vocabularyVersion || 'shared_policy_v1',
        network: cloneNetwork(normalized.policy.network),
      },
      value: {
        version: SHARED_MODEL_VERSION,
        network: cloneNetwork(normalized.value.network),
      },
      identity: {
        version: SHARED_MODEL_VERSION,
        temperature: normalized.identity.temperature,
        beamWidth: normalized.identity.beamWidth,
        inferredIdentities: SHARED_BELIEF_IDENTITIES.slice(),
        beliefSlotCount: normalized.identity.beliefSlotCount || getSharedModelInterfaceSpec().beliefPieceSlotsPerPerspective,
        network: cloneNetwork(normalized.identity.network),
      },
    };
  }
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
      inferredIdentities: INFERRED_IDENTITIES.slice(),
      network: cloneNetwork(normalized.identity.network),
    },
  };
}

function countNetworkParameters(network) {
  const layers = Array.isArray(network?.layers) ? network.layers : [];
  return layers.reduce((total, layer) => {
    const inputSize = Math.max(0, Number(layer?.inputSize || 0));
    const outputSize = Math.max(0, Number(layer?.outputSize || 0));
    return total + (inputSize * outputSize) + outputSize;
  }, 0);
}

function countModelBundleParameters(modelBundle) {
  const normalized = normalizeModelBundle(modelBundle || createDefaultModelBundle());
  if (isSharedEncoderModelBundle(normalized)) {
    return (
      countNetworkParameters(normalized.encoder?.network)
      + countNetworkParameters(normalized.policy?.network)
      + countNetworkParameters(normalized.value?.network)
      + countNetworkParameters(normalized.identity?.network)
    );
  }
  return (
    countNetworkParameters(normalized.policy?.network)
    + countNetworkParameters(normalized.value?.network)
    + countNetworkParameters(normalized.identity?.network)
  );
}

function formatCompactParameterCount(value) {
  const count = Math.max(0, Number(value || 0));
  const formatCompactUnit = (unitValue, suffix) => {
    const fixed = Number(unitValue || 0).toFixed(1)
      .replace(/\.0$/, '')
      .replace(/(\.\d*[1-9])0+$/, '$1');
    return `${fixed}${suffix}`;
  };
  if (count >= 1000000) {
    return formatCompactUnit(count / 1000000, 'M');
  }
  if (count >= 1000) {
    return formatCompactUnit(count / 1000, 'K');
  }
  return String(Math.round(count));
}

function getModelBundleTypeLabel(modelBundle) {
  const normalized = normalizeModelBundle(modelBundle || createDefaultModelBundle());
  if (isSharedEncoderModelBundle(normalized)) {
    return 'Shared-Encoder MLP';
  }
  const networkTypes = [
    normalized.policy?.network?.type,
    normalized.value?.network?.type,
    normalized.identity?.network?.type,
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean);
  if (!networkTypes.length) {
    return 'Model';
  }
  const uniqueTypes = [...new Set(networkTypes)];
  if (uniqueTypes.length === 1) {
    const type = uniqueTypes[0];
    if (type === 'mlp') return 'MLP';
    return type.toUpperCase();
  }
  return 'Hybrid';
}

function describeModelBundle(modelBundle) {
  const typeLabel = getModelBundleTypeLabel(modelBundle);
  const parameterCount = countModelBundleParameters(modelBundle);
  return `${typeLabel} (${formatCompactParameterCount(parameterCount)} params)`;
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

function getSharedStateInput(state, perspective, guessedIdentities = null) {
  const cache = getStateCache(state);
  cache.sharedStateInputByPerspective = cache.sharedStateInputByPerspective || [{}, {}];
  const guessKey = getGuessKey(state, guessedIdentities);
  const cached = cache.sharedStateInputByPerspective[perspective]?.[guessKey];
  if (cached) {
    return cached.slice();
  }
  const encoded = encodeSharedState(state, perspective, guessedIdentities);
  cache.sharedStateInputByPerspective[perspective][guessKey] = encoded.slice();
  return encoded;
}

function normalizeSharedPolicyTarget(sampleTarget = [], vocabSize = 0) {
  const safeVocabSize = Math.max(0, Number(vocabSize || 0));
  const dense = Array.from({ length: safeVocabSize }, () => 0);
  if (!Array.isArray(sampleTarget) || !safeVocabSize) {
    return dense;
  }
  for (let index = 0; index < Math.min(sampleTarget.length, safeVocabSize); index += 1) {
    dense[index] = Number.isFinite(sampleTarget[index]) && sampleTarget[index] > 0
      ? Number(sampleTarget[index])
      : 0;
  }
  return normalizeTargetProbabilities(dense);
}

function runSharedModelForward(modelBundle, state, perspective, guessedIdentities = null, options = {}) {
  const normalizedBundle = normalizeSharedModelBundle(modelBundle);
  const stateInput = Array.isArray(options.stateInput)
    ? options.stateInput.slice()
    : getSharedStateInput(state, perspective, guessedIdentities);
  const keepCache = options.keepCache === true;
  const encoderForward = forwardNetwork(normalizedBundle.encoder.network, stateInput, { keepCache });
  const latent = Array.isArray(encoderForward.output) ? encoderForward.output : [];
  const policyForward = forwardNetwork(normalizedBundle.policy.network, latent, { keepCache });
  const valueForward = forwardNetwork(normalizedBundle.value.network, latent, { keepCache });
  const identityForward = forwardNetwork(normalizedBundle.identity.network, latent, { keepCache });
  return {
    stateInput,
    latent,
    policyLogits: Array.isArray(policyForward.output) ? policyForward.output : [],
    valueRaw: Number(valueForward.output?.[0] || 0),
    beliefLogits: Array.isArray(identityForward.output) ? identityForward.output : [],
    caches: keepCache
      ? {
        encoder: encoderForward.cache,
        policy: policyForward.cache,
        value: valueForward.cache,
        identity: identityForward.cache,
      }
      : null,
  };
}

function getBeliefDistributionForSlot(logits = [], slotIndex = 0, temperature = 1) {
  const beliefWidth = SHARED_BELIEF_IDENTITIES.length;
  const offset = slotIndex * beliefWidth;
  const slotLogits = logits.slice(offset, offset + beliefWidth);
  const probabilities = softmax(slotLogits, temperature || 1);
  const map = {};
  SHARED_BELIEF_IDENTITIES.forEach((identity, index) => {
    map[identity] = Number(probabilities[index] || 0);
  });
  return normalizeProbabilityMap(map);
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

function countAlivePieces(state, color) {
  const encoded = ensureEncodedState(state);
  return encoded.aliveCountByColor[color] || 0;
}

function countStashPieces(state, color) {
  const encoded = ensureEncodedState(state);
  return Number(encoded.stashCountByColor?.[color] || 0);
}

function getGuessedIdentityByPieceIndex(state, guessedIdentities = null) {
  if (!guessedIdentities || typeof guessedIdentities !== 'object') return null;
  const cache = getStateCache(state);
  cache.guessedIdentityByKey = cache.guessedIdentityByKey || {};
  const guessKey = getGuessKey(state, guessedIdentities);
  if (cache.guessedIdentityByKey[guessKey]) {
    return cache.guessedIdentityByKey[guessKey];
  }
  const encoded = ensureEncodedState(state);
  const guessedIdentityByPieceIndex = new Uint8Array(encoded.pieceCount);
  Object.keys(guessedIdentities).forEach((pieceId) => {
    if (!Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, pieceId)) return;
    guessedIdentityByPieceIndex[encoded.pieceIndexById[pieceId]] = Number(guessedIdentities[pieceId] || 0);
  });
  cache.guessedIdentityByKey[guessKey] = guessedIdentityByPieceIndex;
  return guessedIdentityByPieceIndex;
}

function getVisibleIdentityByPieceIndex(encoded, pieceIndex, perspective, guessedIdentityByPieceIndex = null) {
  if (!Number.isFinite(pieceIndex) || pieceIndex < 0 || pieceIndex >= encoded.pieceCount) {
    return IDENTITIES.UNKNOWN;
  }
  const pieceColor = encoded.pieceColor[pieceIndex];
  if (pieceColor === perspective) {
    return encoded.pieceIdentity[pieceIndex];
  }
  const revealedIdentity = encoded.revealedIdentity[pieceIndex];
  if (revealedIdentity > 0) {
    return revealedIdentity;
  }
  if (guessedIdentityByPieceIndex && guessedIdentityByPieceIndex[pieceIndex] > 0) {
    return guessedIdentityByPieceIndex[pieceIndex];
  }
  return IDENTITIES.UNKNOWN;
}

function summarizeMaterialEncoded(state, perspective, guessedIdentities = null) {
  const cache = getStateCache(state);
  const guessKey = getGuessKey(state, guessedIdentities);
  cache.materialSummaryByPerspective = cache.materialSummaryByPerspective || [{}, {}];
  if (cache.materialSummaryByPerspective[perspective][guessKey]) {
    return cache.materialSummaryByPerspective[perspective][guessKey];
  }
  const encoded = ensureEncodedState(state);
  const guessedIdentityByPieceIndex = getGuessedIdentityByPieceIndex(state, guessedIdentities);
  let own = 0;
  let enemy = 0;
  for (let pieceIndex = 0; pieceIndex < encoded.pieceCount; pieceIndex += 1) {
    if (!encoded.pieceAlive[pieceIndex]) continue;
    const pieceColor = encoded.pieceColor[pieceIndex];
    const identity = getVisibleIdentityByPieceIndex(
      encoded,
      pieceIndex,
      perspective,
      guessedIdentityByPieceIndex,
    );
    const value = PIECE_VALUES[identity] || 0;
    if (pieceColor === perspective) own += value;
    else enemy += value;
  }
  const result = { own, enemy };
  cache.materialSummaryByPerspective[perspective][guessKey] = result;
  return result;
}

function getKingDistanceForPerspective(state, kingColor, perspective, guessedIdentities = null) {
  const encoded = ensureEncodedState(state);
  const guessedIdentityByPieceIndex = getGuessedIdentityByPieceIndex(state, guessedIdentities);
  for (let pieceIndex = 0; pieceIndex < encoded.pieceCount; pieceIndex += 1) {
    if (!encoded.pieceAlive[pieceIndex]) continue;
    if (encoded.pieceColor[pieceIndex] !== kingColor) continue;
    if (getVisibleIdentityByPieceIndex(encoded, pieceIndex, perspective, guessedIdentityByPieceIndex) !== IDENTITIES.KING) {
      continue;
    }
    const squareIndex = encoded.pieceSquareIndices[pieceIndex];
    if (!Number.isFinite(squareIndex) || squareIndex < 0) return 1.5;
    const row = Math.floor(squareIndex / FILES);
    return kingColor === WHITE
      ? (RANKS - 1 - row) / (RANKS - 1)
      : row / (RANKS - 1);
  }
  return 1.5;
}

function findKingForPerspective(state, kingColor, perspective, guessedIdentities = null) {
  const encoded = ensureEncodedState(state);
  for (let pieceIndex = 0; pieceIndex < encoded.pieceCount; pieceIndex += 1) {
    if (!encoded.pieceAlive[pieceIndex]) continue;
    const pieceId = encoded.pieceIds[pieceIndex];
    const piece = state?.pieces?.[pieceId];
    if (!piece || piece.color !== kingColor) continue;
    if (identityForFeature(piece, perspective, guessedIdentities) === IDENTITIES.KING) {
      return piece;
    }
  }
  return null;
}

function getResponsePhaseInfo(state) {
  const cache = getStateCache(state);
  if (cache.responsePhaseInfo) {
    return cache.responsePhaseInfo;
  }
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
  cache.responsePhaseInfo = {
    responsePhase: responsePhase || bombPhase ? 1 : 0,
    challengeWindow: responsePhase || bombPhase ? 1 : 0,
    bombWindow: responsePhase ? 1 : 0,
  };
  return cache.responsePhaseInfo;
}

function extractStateFeatures(state, perspective, guessedIdentities = null) {
  const cache = getStateCache(state);
  cache.stateFeaturesByPerspective = cache.stateFeaturesByPerspective || [{}, {}];
  const guessKey = getGuessKey(state, guessedIdentities);
  const cached = cache.stateFeaturesByPerspective[perspective][guessKey];
  if (cached) {
    return cached;
  }

  const opponent = perspective === WHITE ? BLACK : WHITE;
  const ownMoves = countMoveOptionsForColor(state, perspective);
  const oppMoves = countMoveOptionsForColor(state, opponent);
  const encoded = ensureEncodedState(state);
  const material = summarizeMaterialEncoded(state, perspective, guessedIdentities);
  const ownPieces = countAlivePieces(state, perspective);
  const oppPieces = countAlivePieces(state, opponent);
  const maxPlies = Number.isFinite(state.maxPlies) && state.maxPlies > 0 ? state.maxPlies : 120;
  const ownKingDistance = getKingDistanceForPerspective(state, perspective, perspective, guessedIdentities);
  const oppKingDistance = getKingDistanceForPerspective(state, opponent, perspective, guessedIdentities);
  const daggerDiff = ((state?.daggers?.[perspective] || 0) - (state?.daggers?.[opponent] || 0)) / 3;
  const stashDiff = (countStashPieces(state, perspective) - countStashPieces(state, opponent)) / 4;
  const onDeckAdvantage = ((encoded.onDeckPieceIndexByColor?.[perspective] >= 0 ? 1 : 0) - (encoded.onDeckPieceIndexByColor?.[opponent] >= 0 ? 1 : 0));
  const movesSinceAction = Math.min(1, (Number(state.movesSinceAction || 0) || 0) / 20);
  const responseInfo = getResponsePhaseInfo(state);
  const materialDiff = (material.own - material.enemy) / 20;
  const mobilityDiff = (ownMoves - oppMoves) / 20;
  const pieceCountDiff = (ownPieces - oppPieces) / 5;
  const plyProgress = Math.min(1, (state.ply || 0) / maxPlies);
  const kingPressure = ((1 - oppKingDistance) - (1 - ownKingDistance)) * 0.5;

  const features = [
    1,
    materialDiff,
    mobilityDiff,
    ownKingDistance,
    oppKingDistance,
    state.toMove === perspective ? 1 : -1,
    pieceCountDiff,
    plyProgress,
    ownKingDistance < 1.5 ? 1 : 0,
    oppKingDistance < 1.5 ? 1 : 0,
    kingPressure,
    daggerDiff,
    stashDiff,
    onDeckAdvantage,
    movesSinceAction,
    responseInfo.responsePhase,
  ];
  cache.stateFeaturesByPerspective[perspective][guessKey] = features;
  return features;
}

function toActionType(action) {
  if (!action || typeof action.type !== 'string') return '';
  return action.type.toUpperCase();
}

function createFeatureExtractionContext(state, perspective, guessedIdentities = null, precomputedStateFeatures = null) {
  return {
    encoded: ensureEncodedState(state),
    guessedIdentityByPieceIndex: getGuessedIdentityByPieceIndex(state, guessedIdentities),
    responseInfo: getResponsePhaseInfo(state),
    stateFeatures: Array.isArray(precomputedStateFeatures)
      ? precomputedStateFeatures
      : extractStateFeatures(state, perspective, guessedIdentities),
  };
}

function extractActionFeatures(state, perspective, action, guessedIdentities = null, stateFeatures = null) {
  const context = stateFeatures && typeof stateFeatures === 'object' && !Array.isArray(stateFeatures) && stateFeatures.encoded
    ? stateFeatures
    : createFeatureExtractionContext(
      state,
      perspective,
      guessedIdentities,
      Array.isArray(stateFeatures) ? stateFeatures : null,
    );
  const encoded = context.encoded;
  const guessedIdentityByPieceIndex = context.guessedIdentityByPieceIndex;
  const type = toActionType(action);
  const isMove = type === ACTIONS.MOVE || type === 'MOVE';
  const isChallenge = type === ACTIONS.CHALLENGE || type === 'CHALLENGE';
  const isBomb = type === ACTIONS.BOMB || type === 'BOMB';
  const isPass = type === ACTIONS.PASS || type === 'PASS';
  const isOnDeck = type === ACTIONS.ON_DECK || type === 'ON_DECK';
  const responseInfo = context.responseInfo;
  const features = context.stateFeatures;

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
    const fromIndex = Number.isFinite(action?._fromIndex)
      ? action._fromIndex
      : (Number.isFinite(action?.from?.row) && Number.isFinite(action?.from?.col)
        ? squareToIndex(action.from.row, action.from.col)
        : -1);
    const toIndex = Number.isFinite(action?._toIndex)
      ? action._toIndex
      : (Number.isFinite(action?.to?.row) && Number.isFinite(action?.to?.col)
        ? squareToIndex(action.to.row, action.to.col)
        : -1);
    const pieceIndex = Number.isFinite(action?._pieceIndex)
      ? action._pieceIndex
      : (action?.pieceId && Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, action.pieceId)
        ? encoded.pieceIndexById[action.pieceId]
        : (fromIndex >= 0 ? encoded.boardPieceIndices[fromIndex] : NO_PIECE));
    if (pieceIndex !== NO_PIECE && fromIndex >= 0 && toIndex >= 0) {
      const fromRow = Math.floor(fromIndex / FILES);
      const fromCol = fromIndex % FILES;
      const toRow = Math.floor(toIndex / FILES);
      const toCol = toIndex % FILES;
      const dr = toRow - fromRow;
      const dc = toCol - fromCol;
      distance = Math.sqrt((dr * dr) + (dc * dc)) / 5;
      forward = (perspective === WHITE ? dr : -dr) / (RANKS - 1);
      const centerRow = (RANKS - 1) / 2;
      const centerCol = (FILES - 1) / 2;
      const centerDistance = Math.abs(toRow - centerRow) + Math.abs(toCol - centerCol);
      targetCenter = 1 - (centerDistance / (RANKS + FILES));
      const targetPieceIndex = Number.isFinite(action?._capturePieceIndex)
        ? action._capturePieceIndex
        : (action?.capturePieceId && Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, action.capturePieceId)
          ? encoded.pieceIndexById[action.capturePieceId]
          : (toIndex >= 0 ? encoded.boardPieceIndices[toIndex] : NO_PIECE));
      capture = targetPieceIndex !== NO_PIECE ? 1 : 0;
      const targetIdentity = capture
        ? getVisibleIdentityByPieceIndex(encoded, targetPieceIndex, perspective, guessedIdentityByPieceIndex)
        : IDENTITIES.UNKNOWN;
      captureKing = (capture && targetIdentity === IDENTITIES.KING) ? 1 : 0;
      const moverIdentity = encoded.pieceIdentity[pieceIndex];
      moverKing = moverIdentity === IDENTITIES.KING ? 1 : 0;
      moverRook = moverIdentity === IDENTITIES.ROOK ? 1 : 0;
      moverBishop = moverIdentity === IDENTITIES.BISHOP ? 1 : 0;
      moverKnight = moverIdentity === IDENTITIES.KNIGHT ? 1 : 0;
      const declaration = Number.isFinite(action.declaration) ? action.declaration : IDENTITIES.UNKNOWN;
      declaredKing = declaration === IDENTITIES.KING ? 1 : 0;
      declaredRook = declaration === IDENTITIES.ROOK ? 1 : 0;
      declaredBishop = declaration === IDENTITIES.BISHOP ? 1 : 0;
      declaredKnight = declaration === IDENTITIES.KNIGHT ? 1 : 0;
      const moverColor = encoded.pieceColor[pieceIndex];
      const distBefore = moverIdentity === IDENTITIES.KING
        ? (moverColor === WHITE ? (RANKS - 1 - fromRow) : fromRow)
        : 0;
      const distAfter = moverIdentity === IDENTITIES.KING
        ? (moverColor === WHITE ? (RANKS - 1 - toRow) : toRow)
        : 0;
      kingThroneDelta = moverIdentity === IDENTITIES.KING
        ? ((distBefore - distAfter) / (RANKS - 1))
        : 0;
    }
  } else if (isOnDeck) {
    const pieceIndex = action?.pieceId && Object.prototype.hasOwnProperty.call(encoded.pieceIndexById, action.pieceId)
      ? encoded.pieceIndexById[action.pieceId]
      : NO_PIECE;
    const identity = Number.isFinite(action.identity)
      ? action.identity
      : (pieceIndex !== NO_PIECE ? encoded.pieceIdentity[pieceIndex] : IDENTITIES.UNKNOWN);
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

function predictPolicy(
  modelBundle,
  state,
  perspective,
  actions = null,
  guessedIdentities = null,
  precomputedStateFeatures = null,
) {
  if (isSharedEncoderModelBundle(modelBundle)) {
    const normalizedBundle = normalizeSharedModelBundle(modelBundle);
    const legalActions = Array.isArray(actions) ? actions : getLegalActions(state, perspective);
    const stateInput = Array.isArray(precomputedStateFeatures)
      ? precomputedStateFeatures.slice()
      : getSharedStateInput(state, perspective, guessedIdentities);
    if (!legalActions.length) {
      return {
        actions: [],
        scores: [],
        probabilities: [],
        features: [],
        stateFeatures: stateInput.slice(),
        stateInput,
        slotIndices: [],
        slotIds: [],
      };
    }
    const forward = runSharedModelForward(normalizedBundle, state, perspective, guessedIdentities, {
      stateInput,
      keepCache: false,
    });
    const legalMappings = mapLegalActionsToPolicySlots(state, perspective, legalActions);
    const filteredActions = legalMappings.map((entry) => entry.action);
    const scores = legalMappings.map((entry) => Number(forward.policyLogits[entry.slotIndex] || 0));
    const probabilities = softmax(scores, normalizedBundle.policy.temperature || 1);
    return {
      actions: filteredActions,
      scores,
      probabilities,
      features: [],
      stateFeatures: stateInput.slice(),
      stateInput,
      slotIndices: legalMappings.map((entry) => entry.slotIndex),
      slotIds: legalMappings.map((entry) => entry.slotId),
    };
  }
  const normalizedBundle = normalizeModelBundle(modelBundle);
  const model = normalizedBundle.policy;
  const legalActions = Array.isArray(actions) ? actions : getLegalActions(state, perspective);
  if (!legalActions.length) {
    return {
      actions: [],
      scores: [],
      probabilities: [],
      features: [],
      stateFeatures: Array.isArray(precomputedStateFeatures)
        ? precomputedStateFeatures
        : extractStateFeatures(state, perspective, guessedIdentities),
    };
  }

  const stateFeatures = Array.isArray(precomputedStateFeatures)
    ? precomputedStateFeatures
    : extractStateFeatures(state, perspective, guessedIdentities);
  const featureContext = createFeatureExtractionContext(
    state,
    perspective,
    guessedIdentities,
    stateFeatures,
  );
  const featureMatrix = new Array(legalActions.length);
  for (let index = 0; index < legalActions.length; index += 1) {
    featureMatrix[index] = extractActionFeatures(
      state,
      perspective,
      legalActions[index],
      guessedIdentities,
      featureContext,
    );
  }
  const scores = forwardNetworkScalarBatch(model.network, featureMatrix);
  const probabilities = softmax(scores, model.temperature || 1);

  return {
    actions: legalActions,
    scores,
    probabilities,
    features: featureMatrix,
    stateFeatures,
  };
}

function predictValue(modelBundle, state, perspective, guessedIdentities = null, precomputedStateFeatures = null) {
  if (isSharedEncoderModelBundle(modelBundle)) {
    const stateInput = Array.isArray(precomputedStateFeatures)
      ? precomputedStateFeatures.slice()
      : getSharedStateInput(state, perspective, guessedIdentities);
    const forward = runSharedModelForward(modelBundle, state, perspective, guessedIdentities, {
      stateInput,
      keepCache: false,
    });
    return {
      value: tanh(forward.valueRaw),
      raw: forward.valueRaw,
      features: stateInput,
    };
  }
  const normalizedBundle = normalizeModelBundle(modelBundle);
  const features = Array.isArray(precomputedStateFeatures)
    ? precomputedStateFeatures
    : extractStateFeatures(state, perspective, guessedIdentities);
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
  const cache = getStateCache(state);
  cache.identityFeatureByPieceId = cache.identityFeatureByPieceId || {};
  if (cache.identityFeatureByPieceId[pieceId]) {
    return cache.identityFeatureByPieceId[pieceId];
  }
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

  const featurePacket = {
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
  cache.identityFeatureByPieceId[pieceId] = featurePacket;
  return featurePacket;
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
  if (isSharedEncoderModelBundle(modelBundle)) {
    return normalizeProbabilityMap(featurePacket || {});
  }
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
  const limits = arguments.length > 1 && arguments[1] && typeof arguments[1] === 'object'
    ? arguments[1]
    : IDENTITY_COUNTS;
  const knownCounts = arguments.length > 2 && arguments[2] && typeof arguments[2] === 'object'
    ? arguments[2]
    : {};
  const counts = {};
  Object.keys(knownCounts).forEach((identity) => {
    counts[identity] = Number(knownCounts[identity] || 0);
  });
  Object.keys(assignment || {}).forEach((pieceId) => {
    const identity = assignment[pieceId];
    counts[identity] = (counts[identity] || 0) + 1;
  });
  let penalty = 0;
  INFERRED_IDENTITIES.forEach((identity) => {
    const maxCount = limits[identity] || Number.POSITIVE_INFINITY;
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
  const knownIdentityCounts = Object.keys(options.knownIdentityCounts || {}).reduce((acc, identity) => {
    acc[identity] = Math.max(0, Number(options.knownIdentityCounts[identity] || 0));
    return acc;
  }, {});

  function canAssignIdentity(assignment, identity) {
    const maxCount = IDENTITY_COUNTS[identity] || Number.POSITIVE_INFINITY;
    const known = Number(knownIdentityCounts[identity] || 0);
    let used = known;
    Object.keys(assignment || {}).forEach((pieceId) => {
      if (assignment[pieceId] === identity) {
        used += 1;
      }
    });
    return used < maxCount;
  }

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
      const rankedIdentities = INFERRED_IDENTITIES
        .map((identity) => ({
          identity,
          probability: Math.max(0, Number(probs[identity] || 0)),
        }))
        .sort((left, right) => right.probability - left.probability);
      rankedIdentities.forEach(({ identity, probability }) => {
        if (!canAssignIdentity(entry.assignment, identity)) return;
        const assignment = { ...entry.assignment, [pieceId]: identity };
        candidates.push({
          assignment,
          logProb: entry.logProb + Math.log(Math.max(probability, 1e-12)) - getAssignmentPenalty(
            assignment,
            IDENTITY_COUNTS,
            knownIdentityCounts,
          ),
        });
      });
    });
    if (!candidates.length) {
      beam = beam
        .map((entry) => {
          const fallbackIdentity = INFERRED_IDENTITIES.find((identity) => canAssignIdentity(entry.assignment, identity));
          if (!fallbackIdentity) return null;
          return {
            assignment: { ...entry.assignment, [pieceId]: fallbackIdentity },
            logProb: entry.logProb - 6,
          };
        })
        .filter(Boolean);
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
  if (isSharedEncoderModelBundle(modelBundle)) {
    const stateInput = getSharedStateInput(state, perspective, null);
    const forward = runSharedModelForward(modelBundle, state, perspective, null, {
      stateInput,
      keepCache: false,
    });
    const slotPieceIds = getBeliefPieceSlotsForPerspective(perspective);
    const perPieceProbabilities = {};
    const pieceFeatureByIdentity = {};
    const pieceFeatureVectors = {};
    const samples = [];
    const hiddenPieceIds = [];
    const knownIdentityCounts = {};
    const opponent = perspective === WHITE ? BLACK : WHITE;

    Object.keys(state?.pieces || {}).forEach((pieceId) => {
      const piece = state.pieces[pieceId];
      if (!piece || piece.color !== opponent) return;
      const revealedIdentity = state?.revealedIdentities?.[pieceId];
      if (!Number.isFinite(revealedIdentity)) return;
      knownIdentityCounts[revealedIdentity] = (knownIdentityCounts[revealedIdentity] || 0) + 1;
    });

    slotPieceIds.forEach((pieceId, slotIndex) => {
      const piece = state?.pieces?.[pieceId];
      if (!piece) return;
      const probabilities = getBeliefDistributionForSlot(
        forward.beliefLogits,
        slotIndex,
        normalizeSharedModelBundle(modelBundle).identity.temperature || 1,
      );
      perPieceProbabilities[pieceId] = probabilities;
      pieceFeatureVectors[pieceId] = stateInput.slice();
      pieceFeatureByIdentity[pieceId] = probabilities;
      if (piece.alive !== false && !Number.isFinite(state?.revealedIdentities?.[pieceId])) {
        hiddenPieceIds.push(pieceId);
        samples.push({
          pieceId,
          pieceSlot: slotIndex,
          trueIdentity: piece.identity,
          trueIdentityIndex: SHARED_BELIEF_IDENTITIES.indexOf(piece.identity),
          stateInput: stateInput.slice(),
          probabilities,
        });
      }
    });

    return {
      hiddenPieceIds,
      perPieceProbabilities,
      pieceFeatureByIdentity,
      pieceFeatureVectors,
      hypotheses: buildIdentityHypotheses(modelBundle, perPieceProbabilities, {
        ...options,
        knownIdentityCounts,
      }),
      samples,
      stateInput,
    };
  }
  const revealed = state?.revealedIdentities || {};
  const opponent = perspective === WHITE ? BLACK : WHITE;
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
  const knownIdentityCounts = {};

  Object.keys(state?.pieces || {}).forEach((pieceId) => {
    const piece = state.pieces[pieceId];
    if (!piece || piece.color !== opponent) return;
    const revealedIdentity = revealed[pieceId];
    if (!Number.isFinite(revealedIdentity)) return;
    knownIdentityCounts[revealedIdentity] = (knownIdentityCounts[revealedIdentity] || 0) + 1;
  });

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
    hypotheses: buildIdentityHypotheses(modelBundle, perPieceProbabilities, {
      ...options,
      knownIdentityCounts,
    }),
    samples,
  };
}

function applyRiskBiasToHypotheses(hypotheses, values, riskBias = 0) {
  if (!Array.isArray(hypotheses) || !hypotheses.length || !Array.isArray(values)) {
    return {
      value: 0,
      weights: [],
    };
  }
  const safeRisk = Number.isFinite(riskBias) ? Math.max(0, riskBias) : 0;
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
  if (isSharedEncoderModelBundle(normalizedBundle)) {
    return {
      encoder: createAdamState(normalizedBundle.encoder.network),
      policy: createAdamState(normalizedBundle.policy.network),
      value: createAdamState(normalizedBundle.value.network),
      identity: createAdamState(normalizedBundle.identity.network),
    };
  }
  return {
    policy: createAdamState(normalizedBundle.policy.network),
    value: createAdamState(normalizedBundle.value.network),
    identity: createAdamState(normalizedBundle.identity.network),
  };
}

function isAdamStateLayerCompatible(stateLayer, networkLayer) {
  const inputSize = Number(networkLayer?.inputSize || 0);
  const outputSize = Number(networkLayer?.outputSize || 0);
  if (!stateLayer || typeof stateLayer !== 'object') return false;
  if (!Array.isArray(stateLayer.mWeights) || stateLayer.mWeights.length !== outputSize) return false;
  if (!Array.isArray(stateLayer.vWeights) || stateLayer.vWeights.length !== outputSize) return false;
  if (!Array.isArray(stateLayer.mBiases) || stateLayer.mBiases.length !== outputSize) return false;
  if (!Array.isArray(stateLayer.vBiases) || stateLayer.vBiases.length !== outputSize) return false;
  if (stateLayer.mWeights.some((row) => !Array.isArray(row) || row.length !== inputSize)) return false;
  if (stateLayer.vWeights.some((row) => !Array.isArray(row) || row.length !== inputSize)) return false;
  return true;
}

function isAdamOptimizerStateCompatible(state, network) {
  if (!state || typeof state !== 'object') return false;
  if (!Number.isFinite(Number(state.step))) return false;
  if (!Array.isArray(state.layers)) return false;
  const layers = Array.isArray(network?.layers) ? network.layers : [];
  if (state.layers.length !== layers.length) return false;
  return layers.every((layer, layerIndex) => isAdamStateLayerCompatible(state.layers[layerIndex], layer));
}

function resolveSharedOptimizerState(modelBundle, optimizerState = null) {
  const normalizedBundle = normalizeSharedModelBundle(modelBundle);
  const fallback = createOptimizerState(normalizedBundle);
  const resolveHeadState = (headKey, network) => (
    isAdamOptimizerStateCompatible(optimizerState?.[headKey], network)
      ? optimizerState[headKey]
      : fallback[headKey]
  );
  return {
    encoder: resolveHeadState('encoder', normalizedBundle.encoder.network),
    policy: resolveHeadState('policy', normalizedBundle.policy.network),
    value: resolveHeadState('value', normalizedBundle.value.network),
    identity: resolveHeadState('identity', normalizedBundle.identity.network),
  };
}

function addGradientBundleInto(targetBundle, sourceBundle) {
  const targetLayers = Array.isArray(targetBundle?.layers) ? targetBundle.layers : [];
  const sourceLayers = Array.isArray(sourceBundle?.layers) ? sourceBundle.layers : [];
  targetLayers.forEach((targetLayer, layerIndex) => {
    const sourceLayer = sourceLayers[layerIndex];
    if (!targetLayer || !sourceLayer) return;
    const targetWeights = Array.isArray(targetLayer.weightGradients) ? targetLayer.weightGradients : [];
    const sourceWeights = Array.isArray(sourceLayer.weightGradients) ? sourceLayer.weightGradients : [];
    targetWeights.forEach((row, rowIndex) => {
      const sourceRow = sourceWeights[rowIndex];
      if (!Array.isArray(row) || !Array.isArray(sourceRow)) return;
      row.forEach((_, colIndex) => {
        row[colIndex] += Number(sourceRow[colIndex] || 0);
      });
    });
    const targetBiases = Array.isArray(targetLayer.biasGradients) ? targetLayer.biasGradients : [];
    const sourceBiases = Array.isArray(sourceLayer.biasGradients) ? sourceLayer.biasGradients : [];
    targetBiases.forEach((_, biasIndex) => {
      targetBiases[biasIndex] += Number(sourceBiases[biasIndex] || 0);
    });
  });
  return targetBundle;
}

function buildSharedTrainingSamples(samples = {}) {
  if (Array.isArray(samples?.sharedSamples) && samples.sharedSamples.length) {
    return samples.sharedSamples
      .filter((sample) => sample && typeof sample === 'object')
      .map((sample) => ({
        stateInput: Array.isArray(sample.stateInput) ? sample.stateInput.slice() : [],
        policyTarget: Array.isArray(sample.policyTarget) ? sample.policyTarget.slice() : null,
        valueTarget: Number.isFinite(sample.valueTarget) ? Number(sample.valueTarget) : null,
        identityTargets: Array.isArray(sample.identityTargets)
          ? sample.identityTargets
            .filter((identityTarget) => Number.isFinite(identityTarget?.pieceSlot) && Number.isFinite(identityTarget?.truthIndex))
            .map((identityTarget) => ({
              pieceSlot: Number(identityTarget.pieceSlot),
              truthIndex: Number(identityTarget.truthIndex),
            }))
          : [],
      }))
      .filter((sample) => (
        Array.isArray(sample.stateInput)
        && sample.stateInput.length
        && (
          (Array.isArray(sample.policyTarget) && sample.policyTarget.length)
          || Number.isFinite(sample.valueTarget)
          || sample.identityTargets.length
        )
      ));
  }
  const combined = new Map();

  const ensureEntry = (sample, key) => {
    const stateInput = Array.isArray(sample?.stateInput)
      ? sample.stateInput
      : (Array.isArray(sample?.features) ? sample.features : []);
    const existing = combined.get(key);
    if (existing) {
      if ((!Array.isArray(existing.stateInput) || !existing.stateInput.length) && stateInput.length) {
        existing.stateInput = stateInput.slice();
      }
      return existing;
    }
    const entry = {
      stateInput: stateInput.slice(),
      policyTarget: null,
      valueTarget: null,
      identityTargets: [],
    };
    combined.set(key, entry);
    return entry;
  };

  const getKey = (sample, prefix, index) => {
    const sampleKey = typeof sample?.sampleKey === 'string' ? sample.sampleKey.trim() : '';
    if (sampleKey) return sampleKey;
    const createdAt = typeof sample?.createdAt === 'string' ? sample.createdAt.trim() : '';
    if (createdAt) return `t:${createdAt}`;
    return `${prefix}:${index}`;
  };

  const policySamples = Array.isArray(samples.policySamples) ? samples.policySamples : [];
  const valueSamples = Array.isArray(samples.valueSamples) ? samples.valueSamples : [];
  const pairedCount = Math.max(policySamples.length, valueSamples.length);
  for (let index = 0; index < pairedCount; index += 1) {
    const policySample = policySamples[index] || null;
    const valueSample = valueSamples[index] || null;
    const sample = policySample || valueSample;
    if (!sample) continue;
    const entry = ensureEntry(sample, getKey(sample, 'paired', index));
    if (Array.isArray(policySample?.target) && policySample.target.length) {
      entry.policyTarget = policySample.target.slice();
    }
    if (Number.isFinite(valueSample?.target)) {
      entry.valueTarget = Number(valueSample.target);
    }
  }

  (Array.isArray(samples.identitySamples) ? samples.identitySamples : []).forEach((sample, index) => {
    const entry = ensureEntry(sample, getKey(sample, 'identity', index));
    const pieceSlot = Number.isFinite(sample?.pieceSlot) ? Number(sample.pieceSlot) : -1;
    const truthIndex = Number.isFinite(sample?.trueIdentityIndex)
      ? Number(sample.trueIdentityIndex)
      : SHARED_BELIEF_IDENTITIES.indexOf(sample?.trueIdentity);
    if (pieceSlot >= 0 && truthIndex >= 0) {
      entry.identityTargets.push({
        pieceSlot,
        truthIndex,
      });
    }
  });

  return Array.from(combined.values()).filter((sample) => (
    Array.isArray(sample.stateInput)
    && sample.stateInput.length
    && (
      (Array.isArray(sample.policyTarget) && sample.policyTarget.length)
      || Number.isFinite(sample.valueTarget)
      || (Array.isArray(sample.identityTargets) && sample.identityTargets.length)
    )
  ));
}

function trainSharedPolicyHead(modelBundle, policySamples, optionsOrLearningRate = 0.01) {
  const samples = Array.isArray(policySamples) ? policySamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0, optimizerState: resolveSharedOptimizerState(modelBundle, null) };
  }
  const normalizedBundle = normalizeSharedModelBundle(modelBundle);
  const options = normalizeTrainingOptions(optionsOrLearningRate, {
    learningRate: Number.isFinite(optionsOrLearningRate) ? optionsOrLearningRate : undefined,
    batchSize: 16,
  });
  const optimizerState = resolveSharedOptimizerState(normalizedBundle, options.optimizerState);
  const shuffled = shuffleInPlace(samples, createRng(Date.now() + samples.length));
  const vocabSize = Number(normalizedBundle.policy?.network?.outputSize || 0);
  let totalLoss = 0;
  let processed = 0;

  for (let start = 0; start < shuffled.length; start += options.batchSize) {
    const batch = shuffled.slice(start, start + options.batchSize);
    const encoderGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.encoder.network));
    const policyGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.policy.network));
    let batchLoss = 0;
    let batchCount = 0;

    batch.forEach((sample) => {
      const stateInput = Array.isArray(sample?.stateInput)
        ? sample.stateInput
        : (Array.isArray(sample?.features) ? sample.features : []);
      const target = normalizeSharedPolicyTarget(sample?.target || [], vocabSize);
      if (!stateInput.length || target.length !== vocabSize) return;

      const forward = runSharedModelForward(normalizedBundle, null, WHITE, null, {
        stateInput,
        keepCache: true,
      });
      const probs = softmax(forward.policyLogits, normalizedBundle.policy.temperature || 1);
      let sampleLoss = 0;
      for (let index = 0; index < probs.length; index += 1) {
        const truth = target[index] || 0;
        if (truth > 0) {
          sampleLoss += -truth * Math.log(Math.max(probs[index], 1e-9));
        }
      }
      const policyDelta = probs.map((value, index) => value - (target[index] || 0));
      const latentGradient = backpropagateInto(
        normalizedBundle.policy.network,
        forward.caches.policy,
        policyDelta,
        policyGradients,
      );
      backpropagateInto(normalizedBundle.encoder.network, forward.caches.encoder, latentGradient, encoderGradients);
      batchLoss += sampleLoss;
      batchCount += 1;
    });

    if (!batchCount) continue;
    addL2Penalty(encoderGradients, normalizedBundle.encoder.network, options.weightDecay);
    addL2Penalty(policyGradients, normalizedBundle.policy.network, options.weightDecay);
    scaleGradientBundle(encoderGradients, 1 / batchCount);
    scaleGradientBundle(policyGradients, 1 / batchCount);
    clipGradientBundle(encoderGradients, options.gradientClipNorm);
    clipGradientBundle(policyGradients, options.gradientClipNorm);
    applyAdamUpdate(normalizedBundle.encoder.network, encoderGradients, optimizerState.encoder, options);
    applyAdamUpdate(normalizedBundle.policy.network, policyGradients, optimizerState.policy, options);

    totalLoss += batchLoss;
    processed += batchCount;
  }

  return {
    samples: processed,
    loss: processed > 0 ? totalLoss / processed : 0,
    optimizerState,
  };
}

function trainSharedValueHead(modelBundle, valueSamples, optionsOrLearningRate = 0.01) {
  const samples = Array.isArray(valueSamples) ? valueSamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0, optimizerState: resolveSharedOptimizerState(modelBundle, null) };
  }
  const normalizedBundle = normalizeSharedModelBundle(modelBundle);
  const options = normalizeTrainingOptions(optionsOrLearningRate, {
    learningRate: Number.isFinite(optionsOrLearningRate) ? optionsOrLearningRate : undefined,
  });
  const optimizerState = resolveSharedOptimizerState(normalizedBundle, options.optimizerState);
  const shuffled = shuffleInPlace(samples, createRng(Date.now() + (samples.length * 3)));
  let totalLoss = 0;
  let processed = 0;

  for (let start = 0; start < shuffled.length; start += options.batchSize) {
    const batch = shuffled.slice(start, start + options.batchSize);
    const encoderGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.encoder.network));
    const valueGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.value.network));
    let batchLoss = 0;
    let batchCount = 0;

    batch.forEach((sample) => {
      const stateInput = Array.isArray(sample?.stateInput)
        ? sample.stateInput
        : (Array.isArray(sample?.features) ? sample.features : []);
      const target = Number.isFinite(sample?.target) ? sample.target : 0;
      if (!stateInput.length) return;
      const forward = runSharedModelForward(normalizedBundle, null, WHITE, null, {
        stateInput,
        keepCache: true,
      });
      const pred = tanh(forward.valueRaw);
      const error = pred - target;
      const valueDelta = [2 * error * (1 - (pred * pred))];
      const latentGradient = backpropagateInto(
        normalizedBundle.value.network,
        forward.caches.value,
        valueDelta,
        valueGradients,
      );
      backpropagateInto(normalizedBundle.encoder.network, forward.caches.encoder, latentGradient, encoderGradients);
      batchLoss += error * error;
      batchCount += 1;
    });

    if (!batchCount) continue;
    addL2Penalty(encoderGradients, normalizedBundle.encoder.network, options.weightDecay);
    addL2Penalty(valueGradients, normalizedBundle.value.network, options.weightDecay);
    scaleGradientBundle(encoderGradients, 1 / batchCount);
    scaleGradientBundle(valueGradients, 1 / batchCount);
    clipGradientBundle(encoderGradients, options.gradientClipNorm);
    clipGradientBundle(valueGradients, options.gradientClipNorm);
    applyAdamUpdate(normalizedBundle.encoder.network, encoderGradients, optimizerState.encoder, options);
    applyAdamUpdate(normalizedBundle.value.network, valueGradients, optimizerState.value, options);

    totalLoss += batchLoss;
    processed += batchCount;
  }

  return {
    samples: processed,
    loss: processed > 0 ? totalLoss / processed : 0,
    optimizerState,
  };
}

function trainSharedIdentityHead(modelBundle, identitySamples, optionsOrLearningRate = 0.01) {
  const samples = Array.isArray(identitySamples) ? identitySamples : [];
  if (!samples.length) {
    return { samples: 0, loss: 0, accuracy: 0, optimizerState: resolveSharedOptimizerState(modelBundle, null) };
  }
  const normalizedBundle = normalizeSharedModelBundle(modelBundle);
  const options = normalizeTrainingOptions(optionsOrLearningRate, {
    learningRate: Number.isFinite(optionsOrLearningRate) ? optionsOrLearningRate : undefined,
  });
  const optimizerState = resolveSharedOptimizerState(normalizedBundle, options.optimizerState);
  const shuffled = shuffleInPlace(samples, createRng(Date.now() + (samples.length * 5)));
  const beliefWidth = SHARED_BELIEF_IDENTITIES.length;
  let totalLoss = 0;
  let processed = 0;
  let correct = 0;

  for (let start = 0; start < shuffled.length; start += options.batchSize) {
    const batch = shuffled.slice(start, start + options.batchSize);
    const encoderGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.encoder.network));
    const identityGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.identity.network));
    let batchLoss = 0;
    let batchCount = 0;

    batch.forEach((sample) => {
      const stateInput = Array.isArray(sample?.stateInput)
        ? sample.stateInput
        : (Array.isArray(sample?.features) ? sample.features : []);
      const pieceSlot = Number.isFinite(sample?.pieceSlot) ? Number(sample.pieceSlot) : -1;
      const truthIndex = Number.isFinite(sample?.trueIdentityIndex)
        ? Number(sample.trueIdentityIndex)
        : SHARED_BELIEF_IDENTITIES.indexOf(sample?.trueIdentity);
      if (!stateInput.length || pieceSlot < 0 || truthIndex < 0 || truthIndex >= beliefWidth) return;

      const forward = runSharedModelForward(normalizedBundle, null, WHITE, null, {
        stateInput,
        keepCache: true,
      });
      const startIndex = pieceSlot * beliefWidth;
      const slotLogits = forward.beliefLogits.slice(startIndex, startIndex + beliefWidth);
      if (slotLogits.length !== beliefWidth) return;
      const probs = softmax(slotLogits, normalizedBundle.identity.temperature || 1);
      const predictedIndex = probs.reduce((bestIdx, value, index, values) => (
        value > values[bestIdx] ? index : bestIdx
      ), 0);
      if (predictedIndex === truthIndex) {
        correct += 1;
      }
      batchLoss += -Math.log(Math.max(probs[truthIndex] || 0, 1e-9));
      const identityDelta = new Array(forward.beliefLogits.length).fill(0);
      for (let index = 0; index < beliefWidth; index += 1) {
        identityDelta[startIndex + index] = probs[index] - (index === truthIndex ? 1 : 0);
      }
      const latentGradient = backpropagateInto(
        normalizedBundle.identity.network,
        forward.caches.identity,
        identityDelta,
        identityGradients,
      );
      backpropagateInto(normalizedBundle.encoder.network, forward.caches.encoder, latentGradient, encoderGradients);
      batchCount += 1;
    });

    if (!batchCount) continue;
    addL2Penalty(encoderGradients, normalizedBundle.encoder.network, options.weightDecay);
    addL2Penalty(identityGradients, normalizedBundle.identity.network, options.weightDecay);
    scaleGradientBundle(encoderGradients, 1 / batchCount);
    scaleGradientBundle(identityGradients, 1 / batchCount);
    clipGradientBundle(encoderGradients, options.gradientClipNorm);
    clipGradientBundle(identityGradients, options.gradientClipNorm);
    applyAdamUpdate(normalizedBundle.encoder.network, encoderGradients, optimizerState.encoder, options);
    applyAdamUpdate(normalizedBundle.identity.network, identityGradients, optimizerState.identity, options);

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

function trainSharedModelBundleBatch(modelBundle, samples = {}, options = {}) {
  const normalizedBundle = normalizeSharedModelBundle(modelBundle);
  const epochs = Math.max(1, Math.floor(Number(options.epochs || 1)));
  const normalizedSamples = Array.isArray(samples?.sharedSamples) && samples.sharedSamples.length
    ? buildSharedTrainingSamples({ sharedSamples: samples.sharedSamples })
    : buildSharedTrainingSamples(samples);
  const trainingOptions = normalizeTrainingOptions(options, {
    learningRate: Number.isFinite(options?.learningRate) ? options.learningRate : undefined,
    batchSize: 24,
  });
  let optimizerState = resolveSharedOptimizerState(normalizedBundle, trainingOptions.optimizerState || options.optimizerState);
  const history = [];
  const beliefWidth = SHARED_BELIEF_IDENTITIES.length;

  if (!normalizedSamples.length) {
    return {
      modelBundle: normalizedBundle,
      optimizerState,
      history: [{
        epoch: 1,
        policyLoss: 0,
        valueLoss: 0,
        identityLoss: 0,
        identityAccuracy: 0,
        policySamples: 0,
        valueSamples: 0,
        identitySamples: 0,
      }],
    };
  }

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const shuffled = shuffleInPlace(normalizedSamples.slice(), createRng(Date.now() + (epoch * 8191) + normalizedSamples.length));
    let policyLossTotal = 0;
    let valueLossTotal = 0;
    let identityLossTotal = 0;
    let policySampleCount = 0;
    let valueSampleCount = 0;
    let identitySampleCount = 0;
    let identityCorrect = 0;

    for (let start = 0; start < shuffled.length; start += trainingOptions.batchSize) {
      const batch = shuffled.slice(start, start + trainingOptions.batchSize);
      const encoderGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.encoder.network));
      const encoderPolicyGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.encoder.network));
      const encoderValueGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.encoder.network));
      const encoderIdentityGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.encoder.network));
      const policyGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.policy.network));
      const valueGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.value.network));
      const identityGradients = zeroGradientBundle(createGradientBundle(normalizedBundle.identity.network));
      let batchPolicySamples = 0;
      let batchValueSamples = 0;
      let batchIdentitySamples = 0;

      batch.forEach((sample) => {
        if (!Array.isArray(sample?.stateInput) || !sample.stateInput.length) return;
        const forward = runSharedModelForward(normalizedBundle, null, WHITE, null, {
          stateInput: sample.stateInput,
          keepCache: true,
        });

        if (Array.isArray(sample.policyTarget) && sample.policyTarget.length === Number(normalizedBundle.policy?.network?.outputSize || 0)) {
          const probs = softmax(forward.policyLogits, normalizedBundle.policy.temperature || 1);
          let sampleLoss = 0;
          for (let index = 0; index < probs.length; index += 1) {
            const truth = sample.policyTarget[index] || 0;
            if (truth > 0) {
              sampleLoss += -truth * Math.log(Math.max(probs[index], 1e-9));
            }
          }
          const policyDelta = probs.map((value, index) => value - (sample.policyTarget[index] || 0));
          const latentGradient = backpropagateInto(
            normalizedBundle.policy.network,
            forward.caches.policy,
            policyDelta,
            policyGradients,
          );
          backpropagateInto(normalizedBundle.encoder.network, forward.caches.encoder, latentGradient, encoderPolicyGradients);
          policyLossTotal += sampleLoss;
          policySampleCount += 1;
          batchPolicySamples += 1;
        }

        if (Number.isFinite(sample.valueTarget)) {
          const pred = tanh(forward.valueRaw);
          const error = pred - Number(sample.valueTarget);
          const valueDelta = [2 * error * (1 - (pred * pred))];
          const latentGradient = backpropagateInto(
            normalizedBundle.value.network,
            forward.caches.value,
            valueDelta,
            valueGradients,
          );
          backpropagateInto(normalizedBundle.encoder.network, forward.caches.encoder, latentGradient, encoderValueGradients);
          valueLossTotal += error * error;
          valueSampleCount += 1;
          batchValueSamples += 1;
        }

        if (Array.isArray(sample.identityTargets) && sample.identityTargets.length) {
          const identityDelta = new Array(forward.beliefLogits.length).fill(0);
          let sampleIdentityCount = 0;
          sample.identityTargets.forEach((identityTarget) => {
            const pieceSlot = Number(identityTarget?.pieceSlot);
            const truthIndex = Number(identityTarget?.truthIndex);
            if (!Number.isFinite(pieceSlot) || !Number.isFinite(truthIndex) || pieceSlot < 0 || truthIndex < 0 || truthIndex >= beliefWidth) {
              return;
            }
            const startIndex = pieceSlot * beliefWidth;
            const slotLogits = forward.beliefLogits.slice(startIndex, startIndex + beliefWidth);
            if (slotLogits.length !== beliefWidth) return;
            const probs = softmax(slotLogits, normalizedBundle.identity.temperature || 1);
            const predictedIndex = probs.reduce((bestIdx, value, index, values) => (
              value > values[bestIdx] ? index : bestIdx
            ), 0);
            if (predictedIndex === truthIndex) {
              identityCorrect += 1;
            }
            identityLossTotal += -Math.log(Math.max(probs[truthIndex] || 0, 1e-9));
            for (let index = 0; index < beliefWidth; index += 1) {
              identityDelta[startIndex + index] += probs[index] - (index === truthIndex ? 1 : 0);
            }
            identitySampleCount += 1;
            batchIdentitySamples += 1;
            sampleIdentityCount += 1;
          });
          if (sampleIdentityCount > 0) {
            const latentGradient = backpropagateInto(
              normalizedBundle.identity.network,
              forward.caches.identity,
              identityDelta,
              identityGradients,
            );
            backpropagateInto(normalizedBundle.encoder.network, forward.caches.encoder, latentGradient, encoderIdentityGradients);
          }
        }
      });

      if (!batchPolicySamples && !batchValueSamples && !batchIdentitySamples) {
        continue;
      }

      if (batchPolicySamples > 0) {
        scaleGradientBundle(policyGradients, 1 / batchPolicySamples);
        scaleGradientBundle(encoderPolicyGradients, 1 / batchPolicySamples);
        addGradientBundleInto(encoderGradients, encoderPolicyGradients);
      }
      if (batchValueSamples > 0) {
        scaleGradientBundle(valueGradients, 1 / batchValueSamples);
        scaleGradientBundle(encoderValueGradients, 1 / batchValueSamples);
        addGradientBundleInto(encoderGradients, encoderValueGradients);
      }
      if (batchIdentitySamples > 0) {
        scaleGradientBundle(identityGradients, 1 / batchIdentitySamples);
        scaleGradientBundle(encoderIdentityGradients, 1 / batchIdentitySamples);
        addGradientBundleInto(encoderGradients, encoderIdentityGradients);
      }

      addL2Penalty(encoderGradients, normalizedBundle.encoder.network, trainingOptions.weightDecay);
      if (batchPolicySamples > 0) addL2Penalty(policyGradients, normalizedBundle.policy.network, trainingOptions.weightDecay);
      if (batchValueSamples > 0) addL2Penalty(valueGradients, normalizedBundle.value.network, trainingOptions.weightDecay);
      if (batchIdentitySamples > 0) addL2Penalty(identityGradients, normalizedBundle.identity.network, trainingOptions.weightDecay);

      clipGradientBundle(encoderGradients, trainingOptions.gradientClipNorm);
      if (batchPolicySamples > 0) clipGradientBundle(policyGradients, trainingOptions.gradientClipNorm);
      if (batchValueSamples > 0) clipGradientBundle(valueGradients, trainingOptions.gradientClipNorm);
      if (batchIdentitySamples > 0) clipGradientBundle(identityGradients, trainingOptions.gradientClipNorm);

      applyAdamUpdate(normalizedBundle.encoder.network, encoderGradients, optimizerState.encoder, trainingOptions);
      if (batchPolicySamples > 0) applyAdamUpdate(normalizedBundle.policy.network, policyGradients, optimizerState.policy, trainingOptions);
      if (batchValueSamples > 0) applyAdamUpdate(normalizedBundle.value.network, valueGradients, optimizerState.value, trainingOptions);
      if (batchIdentitySamples > 0) applyAdamUpdate(normalizedBundle.identity.network, identityGradients, optimizerState.identity, trainingOptions);
    }

    history.push({
      epoch: epoch + 1,
      policyLoss: policySampleCount > 0 ? (policyLossTotal / policySampleCount) : 0,
      valueLoss: valueSampleCount > 0 ? (valueLossTotal / valueSampleCount) : 0,
      identityLoss: identitySampleCount > 0 ? (identityLossTotal / identitySampleCount) : 0,
      identityAccuracy: identitySampleCount > 0 ? (identityCorrect / identitySampleCount) : 0,
      policySamples: policySampleCount,
      valueSamples: valueSampleCount,
      identitySamples: identitySampleCount,
    });
  }

  return {
    modelBundle: normalizedBundle,
    optimizerState,
    history,
  };
}

function trainPolicyModel(modelBundle, policySamples, optionsOrLearningRate = 0.01) {
  if (isSharedEncoderModelBundle(modelBundle)) {
    return trainSharedPolicyHead(modelBundle, policySamples, optionsOrLearningRate);
  }
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
  if (isSharedEncoderModelBundle(modelBundle)) {
    return trainSharedValueHead(modelBundle, valueSamples, optionsOrLearningRate);
  }
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
  if (isSharedEncoderModelBundle(modelBundle)) {
    return trainSharedIdentityHead(modelBundle, identitySamples, optionsOrLearningRate);
  }
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
  SHARED_MODEL_FAMILY,
  applyRiskBiasToHypotheses,
  cloneModelBundle,
  countModelBundleParameters,
  createDefaultModelBundle,
  createLegacyDefaultModelBundle,
  createOptimizerState,
  describeModelBundle,
  extractActionFeatures,
  extractMoveFeatures: extractActionFeatures,
  extractStateFeatures,
  formatCompactParameterCount,
  getModelBundleTypeLabel,
  getSharedModelSizePresetOptions,
  inferIdentityHypotheses,
  normalizeModelBundle,
  normalizeTargetProbabilities,
  predictPolicy,
  predictValue,
  trainSharedModelBundleBatch,
  trainIdentityModel,
  trainPolicyModel,
  trainValueModel,
};
