const {
  getLegalActions,
  applyAction,
  applyActionMutable,
  applyActionWithUndo,
  undoAppliedAction,
  actionKey,
  computeStateHash,
  getInformationHistoryHash,
  IDENTITIES,
  cloneState,
  cloneStateForSearch,
  createRng,
  getHiddenPieceIds,
  getVisibleIdentity,
} = require('./engine');
const { ensureEncodedState } = require('./stateEncoding');
const {
  predictPolicy,
  predictValue,
  inferIdentityHypotheses,
  applyRiskBiasToHypotheses,
  normalizeTargetProbabilities,
} = require('./modeling');

function terminalValueForRoot(state, rootPlayer) {
  if (!state) return 0;
  if (state.winReason === 'draw' || state.winner === null || state.winner === undefined) return 0;
  return state.winner === rootPlayer ? 1 : -1;
}

function normalizeArray(values) {
  if (!Array.isArray(values) || !values.length) return [];
  let sum = 0;
  values.forEach((value) => {
    if (Number.isFinite(value) && value > 0) {
      sum += value;
    }
  });
  if (sum <= 0) {
    const uniform = 1 / values.length;
    return values.map(() => uniform);
  }
  return values.map((value) => (Number.isFinite(value) && value > 0 ? value / sum : 0));
}

function ensureHypotheses(identityInference) {
  const hypotheses = Array.isArray(identityInference?.hypotheses)
    ? identityInference.hypotheses
    : [];
  if (hypotheses.length) return hypotheses;
  return [{ assignment: {}, probability: 1 }];
}

function applyIdentityAssignmentToState(state, assignment = {}) {
  const nextState = cloneState(state);
  Object.keys(assignment || {}).forEach((pieceId) => {
    if (!nextState?.pieces?.[pieceId]) return;
    nextState.pieces[pieceId] = {
      ...nextState.pieces[pieceId],
      identity: assignment[pieceId],
    };
  });
  return nextState;
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

function serializePublicActionDetails(details = {}) {
  const from = details?.from
    ? `${Number(details.from.row)}:${Number(details.from.col)}`
    : '-';
  const to = details?.to
    ? `${Number(details.to.row)}:${Number(details.to.col)}`
    : '-';
  const declaration = Number.isFinite(details?.declaration)
    ? Number(details.declaration)
    : 'x';
  const outcome = details?.outcome || '-';
  return `${from}>${to}:${declaration}:${outcome}`;
}

function mixHashWord(current, value) {
  const word = (Number.isFinite(value) ? Math.floor(value) : 0) >>> 0;
  return (Math.imul((current ^ (word + 0x9e3779b9)) >>> 0, 2246822519) + 0x85ebca6b) >>> 0;
}

function mixHashPair(hash, first, second = 0) {
  hash[0] = mixHashWord(hash[0], first);
  hash[1] = mixHashWord(hash[1], second);
}

function computeInformationStateHash(state, perspective) {
  const cache = getStateCache(state);
  cache.informationStateHashByPerspective = cache.informationStateHashByPerspective || [{}, {}];
  if (cache.informationStateHashByPerspective[perspective]?.hash) {
    return cache.informationStateHashByPerspective[perspective].hash;
  }
  const encoded = ensureEncodedState(state);
  const hash = [
    0x811c9dc5,
    (0x9e3779b9 ^ (Number.isFinite(perspective) ? perspective : 0)) >>> 0,
  ];

  mixHashPair(hash, perspective, state?.playerTurn ?? -1);
  mixHashPair(hash, state?.onDeckingPlayer ?? -1, Number(state?.movesSinceAction || 0));
  mixHashPair(hash, Number(state?.ply || 0), state?.winner ?? -1);
  mixHashPair(hash, state?.isActive === false ? 0 : 1, Number(state?.winReason ? String(state.winReason).length : 0));
  mixHashPair(hash, Number(state?.daggers?.[0] || 0), Number(state?.daggers?.[1] || 0));

  for (let pieceIndex = 0; pieceIndex < encoded.pieceCount; pieceIndex += 1) {
    const pieceId = encoded.pieceIds[pieceIndex];
    const piece = state?.pieces?.[pieceId];
    const color = Number(encoded.pieceColor[pieceIndex] || 0);
    const zone = Number(encoded.pieceZone[pieceIndex] || 0);
    const square = Number(encoded.pieceSquareIndices[pieceIndex] || -1) + 1;
    const publicIdentity = piece
      ? getVisibleIdentity(state, piece, perspective)
      : 0;
    const capturedBy = Number(encoded.pieceCapturedBy[pieceIndex] || -1) + 2;
    mixHashPair(
      hash,
      ((pieceIndex + 1) << 8) ^ (color << 4) ^ zone,
      (publicIdentity << 8) ^ square,
    );
    mixHashPair(hash, capturedBy, Number(encoded.pieceAlive[pieceIndex] || 0));
  }

  const historyHash = getInformationHistoryHash(state);
  mixHashPair(hash, historyHash?.moveHash?.[0] || 0, historyHash?.moveHash?.[1] || 0);
  mixHashPair(hash, historyHash?.actionHash?.[0] || 0, historyHash?.actionHash?.[1] || 0);

  const hashValue = `${hash[0].toString(16).padStart(8, '0')}${hash[1].toString(16).padStart(8, '0')}`;

  cache.informationStateHashByPerspective[perspective] = { hash: hashValue };
  return hashValue;
}

function createInformationNode(infoHash, player, depth = 0) {
  return {
    hash: infoHash,
    player,
    depth,
    visits: 0,
    valueSum: 0,
    expanded: false,
    legalActions: [],
    actionKeys: [],
    unvisitedActionKeys: [],
    nextUnvisitedActionIndex: 0,
    priorsByActionKey: {},
    actionByKey: {},
    actionStatsByKey: {},
    policyFeaturesByActionKey: {},
    policyStateFeatures: [],
    identitySamples: [],
    hypothesisSummary: [],
    valueEstimate: 0,
  };
}

function getOrCreateInformationNode(searchCache, state, player, depth = 0) {
  const infoHash = computeInformationStateHash(state, player);
  if (searchCache.nodesByHash.has(infoHash)) {
    searchCache.stats.transpositionHits += 1;
    const existing = searchCache.nodesByHash.get(infoHash);
    existing.player = player;
    existing.depth = Math.min(Number.isFinite(existing.depth) ? existing.depth : depth, depth);
    return existing;
  }
  const node = createInformationNode(infoHash, player, depth);
  searchCache.nodesByHash.set(infoHash, node);
  searchCache.stats.nodeCount += 1;
  return node;
}

function evaluateInformationState(modelBundle, state, currentPlayer, rootPlayer, options = {}) {
  const evaluationCache = options.searchCache?.informationEvaluationsByHash || null;
  const infoHash = computeInformationStateHash(state, currentPlayer);
  if (evaluationCache && evaluationCache.has(infoHash)) {
    options.searchCache.stats.evaluationCacheHits += 1;
    return evaluationCache.get(infoHash);
  }

  const legalActions = getLegalActions(state, currentPlayer);
  if (!legalActions.length) {
    const evaluation = {
      legalActions,
      priors: [],
      valueRoot: currentPlayer === rootPlayer ? -1 : 1,
      policyFeatures: [],
      policyStateFeatures: [],
      identitySamples: [],
      hypothesisSummary: [],
    };
    if (evaluationCache) {
      evaluationCache.set(infoHash, evaluation);
      options.searchCache.stats.evaluationCount += 1;
    }
    return evaluation;
  }

  const policy = predictPolicy(
    modelBundle,
    state,
    currentPlayer,
    legalActions,
    null,
    null,
  );
  const value = predictValue(
    modelBundle,
    state,
    currentPlayer,
    null,
    policy.stateFeatures,
  );

  const evaluation = {
    legalActions,
    priors: normalizeArray(policy.probabilities),
    valueRoot: currentPlayer === rootPlayer ? value.value : -value.value,
    policyFeatures: policy.features || [],
    policyStateFeatures: policy.stateFeatures || [],
    identitySamples: [],
    hypothesisSummary: [],
  };
  if (evaluationCache) {
    evaluationCache.set(infoHash, evaluation);
    options.searchCache.stats.evaluationCount += 1;
  }
  return evaluation;
}

function buildSampledIdentityGuessMap(state, perspective) {
  const hiddenPieceIds = getHiddenPieceIds(state, perspective);
  if (!hiddenPieceIds.length) return null;
  const guessedIdentities = {};
  hiddenPieceIds.forEach((pieceId) => {
    const piece = state?.pieces?.[pieceId];
    if (!piece || !Number.isFinite(piece.identity)) return;
    guessedIdentities[pieceId] = piece.identity;
  });
  return Object.keys(guessedIdentities).length ? guessedIdentities : null;
}

function evaluateSampledLeaf(modelBundle, state, currentPlayer, rootPlayer, options = {}) {
  const evaluationCache = options.searchCache?.sampledValueByHash || null;
  const cacheKey = `${Number(currentPlayer)}::${computeStateHash(state)}`;
  if (evaluationCache && evaluationCache.has(cacheKey)) {
    options.searchCache.stats.evaluationCacheHits += 1;
    return evaluationCache.get(cacheKey);
  }
  const guessedIdentities = buildSampledIdentityGuessMap(state, currentPlayer);
  const value = predictValue(
    modelBundle,
    state,
    currentPlayer,
    guessedIdentities,
  );
  const valueRoot = currentPlayer === rootPlayer ? value.value : -value.value;
  if (evaluationCache) {
    evaluationCache.set(cacheKey, valueRoot);
    options.searchCache.stats.evaluationCount += 1;
  }
  return valueRoot;
}

function expandInformationNode(node, modelBundle, state, rootPlayer, options = {}) {
  if (node.expanded) {
    return node;
  }

  const evaluation = evaluateInformationState(
    modelBundle,
    state,
    node.player,
    rootPlayer,
    options,
  );

  node.legalActions = evaluation.legalActions;
  node.actionKeys = new Array(node.legalActions.length);
  node.policyStateFeatures = evaluation.policyStateFeatures;
  node.identitySamples = evaluation.identitySamples;
  node.hypothesisSummary = evaluation.hypothesisSummary;

  node.legalActions.forEach((action, idx) => {
    const key = actionKey(action);
    node.actionKeys[idx] = key;
    node.priorsByActionKey[key] = evaluation.priors[idx] || 0;
    node.actionByKey[key] = action;
    node.policyFeaturesByActionKey[key] = evaluation.policyFeatures[idx] || [];
    node.actionStatsByKey[key] = node.actionStatsByKey[key] || {
      visits: 0,
      valueSum: 0,
    };
  });

  node.unvisitedActionKeys = node.actionKeys
    .slice()
    .sort((a, b) => (node.priorsByActionKey[b] || 0) - (node.priorsByActionKey[a] || 0));
  node.nextUnvisitedActionIndex = 0;

  node.valueEstimate = evaluation.valueRoot;
  node.expanded = true;
  return node;
}

function isPopulatedFeatureVector(vector) {
  return Array.isArray(vector) && vector.length > 0;
}

function ensureTrainingPolicySnapshot(node, modelBundle, state, player, actionKeys, actionByKey) {
  const isSharedModel = String(modelBundle?.family || '').trim().toLowerCase() === 'shared_encoder_belief_ismcts_v1';
  const normalizedActionKeys = Array.isArray(actionKeys) ? actionKeys.slice() : [];
  if (!normalizedActionKeys.length) {
    return {
      stateFeatures: Array.isArray(node?.policyStateFeatures) ? node.policyStateFeatures : [],
      features: [],
      stateInput: Array.isArray(node?.policyStateInput) ? node.policyStateInput : [],
      slotIndices: [],
      refreshed: false,
    };
  }

  const existingStateFeatures = Array.isArray(node?.policyStateFeatures)
    ? node.policyStateFeatures
    : [];
  const existingFeatures = normalizedActionKeys.map((key) => node?.policyFeaturesByActionKey?.[key]);
  const hasMissingFeatures = !existingStateFeatures.length
    || existingFeatures.some((vector) => !isPopulatedFeatureVector(vector));
  if (!hasMissingFeatures) {
    return {
      stateFeatures: existingStateFeatures,
      features: existingFeatures,
      stateInput: Array.isArray(node?.policyStateInput) ? node.policyStateInput : [],
      slotIndices: normalizedActionKeys.map((key) => node?.policySlotIndexByActionKey?.[key]).filter(Number.isFinite),
      refreshed: false,
    };
  }

  const legalActions = normalizedActionKeys
    .map((key) => actionByKey?.[key] || null)
    .filter(Boolean);
  if (legalActions.length !== normalizedActionKeys.length) {
    return {
      stateFeatures: existingStateFeatures,
      features: existingFeatures.map((vector) => (Array.isArray(vector) ? vector : [])),
      stateInput: Array.isArray(node?.policyStateInput) ? node.policyStateInput : [],
      slotIndices: normalizedActionKeys.map((key) => node?.policySlotIndexByActionKey?.[key]).filter(Number.isFinite),
      refreshed: false,
    };
  }

  const policy = predictPolicy(
    modelBundle,
    state,
    player,
    legalActions,
    null,
    null,
  );

  node.policyStateFeatures = Array.isArray(policy.stateFeatures) ? policy.stateFeatures : [];
  node.policyStateInput = Array.isArray(policy.stateInput) ? policy.stateInput : [];
  node.policyFeaturesByActionKey = node.policyFeaturesByActionKey || {};
  node.policySlotIndexByActionKey = node.policySlotIndexByActionKey || {};
  node.priorsByActionKey = node.priorsByActionKey || {};
  node.actionByKey = node.actionByKey || {};

  normalizedActionKeys.forEach((key, index) => {
    node.actionByKey[key] = legalActions[index];
    node.policyFeaturesByActionKey[key] = isSharedModel
      ? []
      : (Array.isArray(policy.features?.[index])
      ? policy.features[index]
      : []);
    node.policySlotIndexByActionKey[key] = Number.isFinite(policy.slotIndices?.[index])
      ? policy.slotIndices[index]
      : null;
    if (Array.isArray(policy.probabilities) && Number.isFinite(policy.probabilities[index])) {
      node.priorsByActionKey[key] = policy.probabilities[index];
    }
  });

  return {
    stateFeatures: node.policyStateFeatures,
    features: normalizedActionKeys.map((key) => node.policyFeaturesByActionKey[key] || []),
    stateInput: Array.isArray(node.policyStateInput) ? node.policyStateInput.slice() : [],
    slotIndices: normalizedActionKeys.map((key) => node.policySlotIndexByActionKey[key]),
    refreshed: true,
  };
}

function chooseUnvisitedActionKey(node) {
  const keys = Array.isArray(node.unvisitedActionKeys) && node.unvisitedActionKeys.length
    ? node.unvisitedActionKeys
    : (Array.isArray(node.actionKeys) ? node.actionKeys : []);
  let index = Number(node.nextUnvisitedActionIndex || 0);
  while (index < keys.length) {
    const key = keys[index];
    const stats = node.actionStatsByKey[key];
    if (Number(stats?.visits || 0) <= 0) {
      node.nextUnvisitedActionIndex = index;
      return key;
    }
    index += 1;
  }
  node.nextUnvisitedActionIndex = index;
  return null;
}

function selectActionKeyForInformationNode(node, rootPlayer, exploration = 1.25) {
  const actionKeys = Array.isArray(node.actionKeys) ? node.actionKeys : Object.keys(node.actionByKey || {});
  if (!actionKeys.length) return null;
  const parentVisits = Math.max(1, node.visits);
  let bestKey = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  actionKeys.forEach((key) => {
    const stats = node.actionStatsByKey[key] || { visits: 0, valueSum: 0 };
    const prior = node.priorsByActionKey[key] || 0;
    const qRaw = stats.visits > 0 ? (stats.valueSum / stats.visits) : 0;
    const q = node.player === rootPlayer ? qRaw : -qRaw;
    const u = exploration * prior * (Math.sqrt(parentVisits) / (1 + stats.visits));
    const score = q + u;
    if (score > bestScore) {
      bestScore = score;
      bestKey = key;
    }
  });

  return bestKey;
}

function backpropagateInformationPath(path, valueRoot) {
  const value = Number.isFinite(valueRoot) ? valueRoot : 0;
  path.forEach((entry) => {
    if (!entry?.node) return;
    entry.node.visits += 1;
    entry.node.valueSum += value;
    if (!entry.actionKey) return;
    const stats = entry.node.actionStatsByKey[entry.actionKey]
      || (entry.node.actionStatsByKey[entry.actionKey] = { visits: 0, valueSum: 0 });
    stats.visits += 1;
    stats.valueSum += value;
  });
}

function sampleWeightedIndex(weights = [], rng = Math.random) {
  const normalized = normalizeArray(weights);
  if (!normalized.length) return 0;
  const target = (typeof rng === 'function' ? rng() : Math.random()) || 0;
  let cumulative = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    cumulative += normalized[index];
    if (target <= cumulative) return index;
  }
  return normalized.length - 1;
}

function evaluateDeterminizedState(modelBundle, state, currentPlayer, rootPlayer, options = {}) {
  const evaluationCache = options.searchCache?.evaluationsByHash || null;
  const stateHash = computeStateHash(state);
  if (evaluationCache && evaluationCache.has(stateHash)) {
    options.searchCache.stats.evaluationCacheHits += 1;
    return evaluationCache.get(stateHash);
  }

  const legalActions = getLegalActions(state, currentPlayer);
  if (!legalActions.length) {
    const evaluation = {
      legalActions,
      priors: [],
      valueRoot: currentPlayer === rootPlayer ? -1 : 1,
      policyFeatures: [],
      policyStateFeatures: [],
      identitySamples: [],
      hypothesisSummary: [],
    };
    if (evaluationCache) {
      evaluationCache.set(stateHash, evaluation);
      options.searchCache.stats.evaluationCount += 1;
    }
    return evaluation;
  }

  const policy = predictPolicy(
    modelBundle,
    state,
    currentPlayer,
    legalActions,
    null,
    null,
  );
  const value = predictValue(
    modelBundle,
    state,
    currentPlayer,
    null,
    policy.stateFeatures,
  );

  const evaluation = {
    legalActions,
    priors: normalizeArray(policy.probabilities),
    valueRoot: currentPlayer === rootPlayer ? value.value : -value.value,
    policyFeatures: policy.features || [],
    policyStateFeatures: policy.stateFeatures || [],
    identitySamples: [],
    hypothesisSummary: [],
  };
  if (evaluationCache) {
    evaluationCache.set(stateHash, evaluation);
    options.searchCache.stats.evaluationCount += 1;
  }
  return evaluation;
}

function createNode(state, parent = null, actionFromParent = null, depth = 0) {
  return {
    hash: computeStateHash(state),
    state,
    parent,
    actionFromParent,
    depth,
    visits: 0,
    valueSum: 0,
    expanded: false,
    legalActions: [],
    priorsByActionKey: {},
    actionByKey: {},
    childrenByActionKey: {},
    policyFeaturesByActionKey: {},
    policyStateFeatures: [],
    identitySamples: [],
    hypothesisSummary: [],
  };
}

function createSearchCache() {
  return {
    nodesByHash: new Map(),
    evaluationsByHash: new Map(),
    informationEvaluationsByHash: new Map(),
    sampledValueByHash: new Map(),
    stats: {
      transpositionHits: 0,
      evaluationCacheHits: 0,
      evaluationCount: 0,
      nodeCount: 0,
    },
  };
}

function getOrCreateNode(searchCache, state, parent = null, actionFromParent = null, depth = 0) {
  const hash = computeStateHash(state);
  if (searchCache.nodesByHash.has(hash)) {
    searchCache.stats.transpositionHits += 1;
    const existing = searchCache.nodesByHash.get(hash);
    if (!existing.parent && parent) {
      existing.parent = parent;
      existing.actionFromParent = actionFromParent;
    }
    return existing;
  }
  const node = createNode(state, parent, actionFromParent, depth);
  searchCache.nodesByHash.set(hash, node);
  searchCache.stats.nodeCount += 1;
  return node;
}

function selectChild(node, rootPlayer, exploration = 1.25) {
  const actionKeys = Object.keys(node.childrenByActionKey || {});
  if (!actionKeys.length) return null;
  const parentVisits = Math.max(1, node.visits);
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  actionKeys.forEach((key) => {
    const child = node.childrenByActionKey[key];
    const prior = node.priorsByActionKey[key] || 0;
    const qRaw = child.visits > 0 ? (child.valueSum / child.visits) : 0;
    const q = node.state.toMove === rootPlayer ? qRaw : -qRaw;
    const u = exploration * prior * (Math.sqrt(parentVisits) / (1 + child.visits));
    const score = q + u;
    if (score > bestScore) {
      bestScore = score;
      best = child;
    }
  });

  return best;
}

function expandNode(node, modelBundle, rootPlayer, options = {}) {
  if (node.expanded) {
    return node;
  }

  const evaluation = evaluateDeterminizedState(
    modelBundle,
    node.state,
    node.state.toMove,
    rootPlayer,
    options,
  );

  node.legalActions = evaluation.legalActions;
  node.policyStateFeatures = evaluation.policyStateFeatures;
  node.identitySamples = evaluation.identitySamples;
  node.hypothesisSummary = evaluation.hypothesisSummary;

  node.legalActions.forEach((action, idx) => {
    const key = actionKey(action);
    node.priorsByActionKey[key] = evaluation.priors[idx] || 0;
    node.actionByKey[key] = action;
    node.policyFeaturesByActionKey[key] = evaluation.policyFeatures[idx] || [];
  });

  node.valueEstimate = evaluation.valueRoot;
  node.expanded = true;
  return node;
}

function maybeExpandChild(node, key) {
  if (node.childrenByActionKey[key]) {
    return node.childrenByActionKey[key];
  }
  const action = node.actionByKey[key];
  if (!action) return null;
  const nextState = applyAction(node.state, action);
  const child = getOrCreateNode(
    node.searchCache,
    nextState,
    node,
    action,
    node.depth + 1,
  );
  node.childrenByActionKey[key] = child;
  return child;
}

function chooseUnexpandedActionKey(node) {
  const allKeys = Object.keys(node.actionByKey || {});
  if (!allKeys.length) return null;
  const unexpanded = allKeys.filter((key) => !node.childrenByActionKey[key]);
  if (!unexpanded.length) return null;
  unexpanded.sort((a, b) => (node.priorsByActionKey[b] || 0) - (node.priorsByActionKey[a] || 0));
  return unexpanded[0];
}

function backpropagate(path, valueRoot) {
  const value = Number.isFinite(valueRoot) ? valueRoot : 0;
  path.forEach((node) => {
    node.visits += 1;
    node.valueSum += value;
  });
}

function buildSearchResult(payload) {
  return {
    ...payload,
    move: payload.action || null,
  };
}

function isCatastrophicKingBluff(state, action) {
  if (!state || !action || String(action.type || '').toUpperCase() !== 'MOVE') {
    return false;
  }
  const piece = state.pieces?.[action.pieceId]
    || state.pieces?.[state.board?.[action.from?.row]?.[action.from?.col]];
  if (!piece) return false;
  return piece.identity === IDENTITIES.KING
    && Number.isFinite(action.declaration)
    && action.declaration !== IDENTITIES.KING;
}

function runDeterminizedMcts(modelBundle, rootState, options = {}) {
  const rootPlayer = Number.isFinite(options.rootPlayer) ? options.rootPlayer : rootState.toMove;
  const iterations = Number.isFinite(options.iterations) ? Math.max(1, Math.floor(options.iterations)) : 80;
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, Math.floor(options.maxDepth)) : 16;
  const exploration = Number.isFinite(options.exploration) ? Math.max(0, options.exploration) : 1.25;

  const searchCache = createSearchCache();
  const root = getOrCreateNode(searchCache, rootState);
  root.searchCache = searchCache;
  expandNode(root, modelBundle, rootPlayer, {
    ...options,
    searchCache,
  });

  if (!root.legalActions.length) {
    return buildSearchResult({
      action: null,
      root,
      policyTarget: [],
      valueEstimate: terminalValueForRoot(rootState, rootPlayer),
      trace: {
        iterations: 0,
        rootVisits: 0,
        transpositionHits: searchCache.stats.transpositionHits,
        evaluationCacheHits: searchCache.stats.evaluationCacheHits,
        evaluationCount: searchCache.stats.evaluationCount,
        nodeCount: searchCache.stats.nodeCount,
      },
      trainingRecord: null,
    });
  }

  for (let iter = 0; iter < iterations; iter += 1) {
    let node = root;
    const path = [node];

    while (true) {
      if (!node.state.isActive) {
        const terminal = terminalValueForRoot(node.state, rootPlayer);
        backpropagate(path, terminal);
        break;
      }

      if ((path.length - 1) >= maxDepth) {
        expandNode(node, modelBundle, rootPlayer, {
          ...options,
          searchCache,
        });
        backpropagate(path, node.valueEstimate || 0);
        break;
      }

      node.searchCache = searchCache;
      expandNode(node, modelBundle, rootPlayer, {
        ...options,
        searchCache,
      });
      const unexpandedKey = chooseUnexpandedActionKey(node);
      if (unexpandedKey) {
        const child = maybeExpandChild(node, unexpandedKey);
        if (!child) {
          backpropagate(path, 0);
          break;
        }
        path.push(child);
        if (!child.state.isActive) {
          backpropagate(path, terminalValueForRoot(child.state, rootPlayer));
          break;
        }
        child.searchCache = searchCache;
        expandNode(child, modelBundle, rootPlayer, {
          ...options,
          searchCache,
        });
        backpropagate(path, child.valueEstimate || 0);
        break;
      }

      const selected = selectChild(node, rootPlayer, exploration);
      if (!selected) {
        backpropagate(path, node.valueEstimate || 0);
        break;
      }
      node = selected;
      path.push(node);
    }
  }

  const actionKeys = Object.keys(root.childrenByActionKey || {});
  if (!actionKeys.length) {
    return buildSearchResult({
      action: root.legalActions[0] || null,
      root,
      policyTarget: normalizeTargetProbabilities(root.legalActions.map(() => 1)),
      valueEstimate: root.valueEstimate || 0,
      trace: {
        iterations,
        rootVisits: root.visits,
        transpositionHits: searchCache.stats.transpositionHits,
        evaluationCacheHits: searchCache.stats.evaluationCacheHits,
        evaluationCount: searchCache.stats.evaluationCount,
        nodeCount: searchCache.stats.nodeCount,
      },
      trainingRecord: null,
    });
  }

  const visits = actionKeys.map((key) => {
    const child = root.childrenByActionKey[key];
    return child ? child.visits : 0;
  });
  const policyTarget = normalizeTargetProbabilities(visits);
  const ranked = actionKeys
    .map((key, idx) => ({
      key,
      visits: visits[idx],
    }))
    .sort((a, b) => b.visits - a.visits);
  const nonCatastrophic = ranked.find((entry) => {
    const candidate = root.actionByKey[entry.key];
    return !isCatastrophicKingBluff(rootState, candidate);
  });
  const selectedEntry = nonCatastrophic || ranked[0];
  const selectedKey = selectedEntry?.key || actionKeys[0];
  const selectedAction = root.actionByKey[selectedKey] || root.legalActions[0] || null;
  const averageRootValue = root.visits > 0 ? (root.valueSum / root.visits) : (root.valueEstimate || 0);

  const actionStats = actionKeys.map((key, idx) => {
    const child = root.childrenByActionKey[key];
    const q = child && child.visits > 0 ? (child.valueSum / child.visits) : 0;
    return {
      actionKey: key,
      moveKey: key,
      visits: visits[idx],
      prior: root.priorsByActionKey[key] || 0,
      q,
    };
  });
  const trainingPolicy = ensureTrainingPolicySnapshot(
    root,
    modelBundle,
    rootState,
    rootState.toMove,
    actionKeys,
    root.actionByKey,
  );
  const isSharedModel = String(modelBundle?.family || '').trim().toLowerCase() === 'shared_encoder_belief_ismcts_v1';
  const sharedPolicyTarget = isSharedModel
    ? (() => {
      const dense = new Array(Number(modelBundle?.policy?.network?.outputSize || 0)).fill(0);
      (trainingPolicy.slotIndices || []).forEach((slotIndex, index) => {
        if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex >= dense.length) return;
        dense[slotIndex] = Number(policyTarget[index] || 0);
      });
      return dense;
    })()
    : policyTarget;

  const trainingRecord = {
    player: rootState.toMove,
    stateFeatures: trainingPolicy.stateFeatures || [],
    policy: {
      actionKeys,
      moveKeys: actionKeys.slice(),
      features: trainingPolicy.features,
      target: sharedPolicyTarget,
      stateInput: trainingPolicy.stateInput || [],
      slotIndices: trainingPolicy.slotIndices || [],
      selectedActionKey: selectedKey,
      selectedMoveKey: selectedKey,
    },
    value: {
      features: trainingPolicy.stateFeatures || [],
      stateInput: trainingPolicy.stateInput || [],
      target: 0,
    },
    identitySamples: [],
    hypothesisSummary: [],
  };

  return buildSearchResult({
    action: selectedAction,
    root,
    policyTarget,
    valueEstimate: averageRootValue,
    trace: {
      iterations,
      rootVisits: root.visits,
      actionStats,
      moveStats: actionStats,
      kingBluffGuardApplied: Boolean(nonCatastrophic && selectedEntry && selectedEntry.key !== ranked[0]?.key),
      transpositionHits: searchCache.stats.transpositionHits,
      evaluationCacheHits: searchCache.stats.evaluationCacheHits,
      evaluationCount: searchCache.stats.evaluationCount,
      nodeCount: searchCache.stats.nodeCount,
    },
    trainingRecord,
  });
}

function runHiddenInfoMcts(modelBundle, rootState, options = {}) {
  const rootPlayer = Number.isFinite(options.rootPlayer) ? options.rootPlayer : rootState.toMove;
  const rootLegalActions = getLegalActions(rootState, rootPlayer);
  if (!rootLegalActions.length) {
    return buildSearchResult({
      action: null,
      root: {
        state: rootState,
        visits: 0,
        legalActions: [],
        childrenByActionKey: {},
      },
      policyTarget: [],
      valueEstimate: terminalValueForRoot(rootState, rootPlayer),
      trace: {
        iterations: 0,
        rootVisits: 0,
        hypothesisCount: 0,
        transpositionHits: 0,
        evaluationCacheHits: 0,
        evaluationCount: 0,
        nodeCount: 0,
      },
      trainingRecord: null,
    });
  }

  const iterations = Number.isFinite(options.iterations) ? Math.max(1, Math.floor(options.iterations)) : 80;
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, Math.floor(options.maxDepth)) : 16;
  const exploration = Number.isFinite(options.exploration) ? Math.max(0, options.exploration) : 1.25;
  const rng = typeof options.rng === 'function'
    ? options.rng
    : createRng(Number.isFinite(options.seed) ? options.seed : Date.now());
  const searchCache = options.searchCache || createSearchCache();
  const statsBefore = {
    transpositionHits: Number(searchCache.stats?.transpositionHits || 0),
    evaluationCacheHits: Number(searchCache.stats?.evaluationCacheHits || 0),
    evaluationCount: Number(searchCache.stats?.evaluationCount || 0),
    nodeCount: Number(searchCache.stats?.nodeCount || 0),
  };
  const identityInference = inferIdentityHypotheses(
    modelBundle,
    rootState,
    rootPlayer,
    { count: options.hypothesisCount },
  );
  const hypotheses = ensureHypotheses(identityInference);
  const useUndoTraversal = options.useUndoTraversal !== false && (
    Boolean(options.forceUndoTraversal)
    || (((rootState?.moves?.length || 0) + (rootState?.actions?.length || 0)) >= 8)
  );
  const actionKeys = rootLegalActions.map((action) => actionKey(action));
  const actionByKey = {};
  rootLegalActions.forEach((action, idx) => {
    const key = actionKeys[idx];
    actionByKey[key] = action;
  });
  const determinizedRootStates = hypotheses.map((hypothesis) => (
    applyIdentityAssignmentToState(rootState, hypothesis?.assignment || {})
  ));
  const reusableSampledStates = useUndoTraversal
    ? determinizedRootStates.map((state) => cloneStateForSearch(state))
    : null;
  const rootValueEstimates = determinizedRootStates.map((determinizedState) => {
    const guessedIdentities = buildSampledIdentityGuessMap(determinizedState, rootPlayer);
    return Number(predictValue(modelBundle, determinizedState, rootPlayer, guessedIdentities).value || 0);
  });
  const riskAggregation = applyRiskBiasToHypotheses(hypotheses, rootValueEstimates, options.riskBias);
  const hypothesisWeights = riskAggregation.weights.length === hypotheses.length
    ? riskAggregation.weights
    : normalizeArray(hypotheses.map((hypothesis) => Number(hypothesis?.probability || 0)));
  const hypothesisSampleCounts = Array.from({ length: hypotheses.length }, () => 0);
  const root = getOrCreateInformationNode(searchCache, rootState, rootPlayer, 0);
  expandInformationNode(root, modelBundle, rootState, rootPlayer, {
    ...options,
    searchCache,
  });

  for (let iter = 0; iter < iterations; iter += 1) {
    const sampledHypothesisIndex = sampleWeightedIndex(hypothesisWeights, rng);
    hypothesisSampleCounts[sampledHypothesisIndex] += 1;
    const sampledState = reusableSampledStates
      ? reusableSampledStates[sampledHypothesisIndex]
      : cloneStateForSearch(determinizedRootStates[sampledHypothesisIndex] || rootState);
    const undoFrames = [];
    let node = root;
    const path = [{ node, actionKey: null }];
    let depth = 0;

    try {
      while (true) {
        if (!sampledState.isActive) {
          backpropagateInformationPath(path, terminalValueForRoot(sampledState, rootPlayer));
          break;
        }

        expandInformationNode(node, modelBundle, sampledState, rootPlayer, {
          ...options,
          searchCache,
        });

        if (!node.legalActions.length) {
          backpropagateInformationPath(path, evaluateSampledLeaf(
            modelBundle,
            sampledState,
            node.player,
            rootPlayer,
            {
              ...options,
              searchCache,
            },
          ));
          break;
        }

        if (depth >= maxDepth) {
          backpropagateInformationPath(path, evaluateSampledLeaf(
            modelBundle,
            sampledState,
            node.player,
            rootPlayer,
            {
              ...options,
              searchCache,
            },
          ));
          break;
        }

        const unvisitedKey = chooseUnvisitedActionKey(node);
        const selectedKey = unvisitedKey || selectActionKeyForInformationNode(node, rootPlayer, exploration);
        if (!selectedKey) {
          backpropagateInformationPath(path, evaluateSampledLeaf(
            modelBundle,
            sampledState,
            node.player,
            rootPlayer,
            {
              ...options,
              searchCache,
            },
          ));
          break;
        }

        const selectedAction = node.actionByKey[selectedKey];
        if (!selectedAction) {
          backpropagateInformationPath(path, 0);
          break;
        }

        if (reusableSampledStates) {
          undoFrames.push(applyActionWithUndo(sampledState, selectedAction));
        } else {
          applyActionMutable(sampledState, selectedAction);
        }
        const nextPlayer = Number.isFinite(sampledState?.toMove) ? sampledState.toMove : sampledState?.playerTurn;
        const child = getOrCreateInformationNode(searchCache, sampledState, nextPlayer, depth + 1);
        path[path.length - 1].actionKey = selectedKey;
        node = child;
        path.push({ node, actionKey: null });
        depth += 1;

        if (unvisitedKey) {
          if (!sampledState.isActive) {
            backpropagateInformationPath(path, terminalValueForRoot(sampledState, rootPlayer));
          } else {
            expandInformationNode(node, modelBundle, sampledState, rootPlayer, {
              ...options,
              searchCache,
            });
            backpropagateInformationPath(path, evaluateSampledLeaf(
              modelBundle,
              sampledState,
              node.player,
              rootPlayer,
              {
                ...options,
                searchCache,
              },
            ));
          }
          break;
        }
      }
    } finally {
      if (reusableSampledStates) {
        while (undoFrames.length) {
          undoAppliedAction(sampledState, undoFrames.pop());
        }
      }
    }
  }

  const rootActionStats = actionKeys.map((key) => {
    const stats = root.actionStatsByKey[key] || { visits: 0, valueSum: 0 };
    const visits = Number(stats.visits || 0);
    return {
      actionKey: key,
      moveKey: key,
      visits,
      prior: root.priorsByActionKey[key] || 0,
      q: visits > 0 ? (stats.valueSum / visits) : 0,
    };
  });
  const policyTarget = normalizeTargetProbabilities(rootActionStats.map((entry) => entry.visits));
  const ranked = rootActionStats
    .map((entry) => ({
      key: entry.actionKey,
      visits: entry.visits,
    }))
    .sort((a, b) => b.visits - a.visits);
  const nonCatastrophic = ranked.find((entry) => !isCatastrophicKingBluff(rootState, actionByKey[entry.key]));
  const selectedEntry = nonCatastrophic || ranked[0];
  const selectedKey = selectedEntry?.key || actionKeys[0];
  const selectedAction = actionByKey[selectedKey] || rootLegalActions[0] || null;
  const hypothesisSummary = hypotheses.map((hypothesis, index) => ({
    probability: Number(hypothesis?.probability || 0),
    searchWeight: Number(hypothesisWeights[index] || 0),
    valueRoot: Number(rootValueEstimates[index] || 0),
    sampledCount: Number(hypothesisSampleCounts[index] || 0),
    assignment: hypothesis?.assignment || {},
  }));

  root.state = rootState;
  root.childrenByActionKey = actionKeys.reduce((acc, key) => {
    const stats = root.actionStatsByKey[key] || { visits: 0, valueSum: 0 };
    acc[key] = {
      visits: Number(stats.visits || 0),
      valueSum: Number(stats.valueSum || 0),
    };
    return acc;
  }, {});
  root.hypothesisSummary = hypothesisSummary;
  root.identitySamples = identityInference.samples || [];
  const trainingPolicy = ensureTrainingPolicySnapshot(
    root,
    modelBundle,
    rootState,
    rootPlayer,
    actionKeys,
    actionByKey,
  );
  const isSharedModel = String(modelBundle?.family || '').trim().toLowerCase() === 'shared_encoder_belief_ismcts_v1';
  const sharedPolicyTarget = isSharedModel
    ? (() => {
      const dense = new Array(Number(modelBundle?.policy?.network?.outputSize || 0)).fill(0);
      (trainingPolicy.slotIndices || []).forEach((slotIndex, index) => {
        if (!Number.isFinite(slotIndex) || slotIndex < 0 || slotIndex >= dense.length) return;
        dense[slotIndex] = Number(policyTarget[index] || 0);
      });
      return dense;
    })()
    : policyTarget;

  const trainingRecord = {
    player: rootState.toMove,
    stateFeatures: trainingPolicy.stateFeatures || [],
    policy: {
      actionKeys,
      moveKeys: actionKeys.slice(),
      features: trainingPolicy.features,
      target: sharedPolicyTarget,
      stateInput: trainingPolicy.stateInput || [],
      slotIndices: trainingPolicy.slotIndices || [],
      selectedActionKey: selectedKey,
      selectedMoveKey: selectedKey,
    },
    value: {
      features: trainingPolicy.stateFeatures ? trainingPolicy.stateFeatures.slice() : [],
      stateInput: trainingPolicy.stateInput || [],
      target: 0,
    },
    identitySamples: identityInference.samples || [],
    hypothesisSummary,
  };
  const statsDelta = {
    transpositionHits: Math.max(0, Number(searchCache.stats.transpositionHits || 0) - statsBefore.transpositionHits),
    evaluationCacheHits: Math.max(0, Number(searchCache.stats.evaluationCacheHits || 0) - statsBefore.evaluationCacheHits),
    evaluationCount: Math.max(0, Number(searchCache.stats.evaluationCount || 0) - statsBefore.evaluationCount),
    nodeCount: Math.max(0, Number(searchCache.stats.nodeCount || 0) - statsBefore.nodeCount),
  };

  return buildSearchResult({
    action: selectedAction,
    root,
    policyTarget,
    valueEstimate: root.visits > 0
      ? (root.valueSum / root.visits)
      : Number(riskAggregation.value || 0),
    trace: {
      algorithm: 'ismcts',
      iterations,
      iterationsPerHypothesis: null,
      hypothesisCount: hypotheses.length,
      rootVisits: root.visits,
      actionStats: rootActionStats,
      moveStats: rootActionStats,
      hypothesisSummary,
      sampledHypothesisCounts: hypothesisSampleCounts.slice(),
      legalActionMismatchCount: 0,
      kingBluffGuardApplied: Boolean(nonCatastrophic && selectedEntry && selectedEntry.key !== ranked[0]?.key),
      transpositionHits: statsDelta.transpositionHits,
      evaluationCacheHits: statsDelta.evaluationCacheHits,
      evaluationCount: statsDelta.evaluationCount,
      nodeCount: statsDelta.nodeCount,
      sharedTree: {
        totalNodeCount: Number(searchCache.stats.nodeCount || 0),
        totalEvaluationCount: Number(searchCache.stats.evaluationCount || 0),
      },
    },
    trainingRecord,
  });
}

function chooseActionFromPolicy(actions, probabilities) {
  if (!Array.isArray(actions) || !actions.length) return null;
  const probs = normalizeArray(probabilities);
  let bestIndex = 0;
  for (let i = 1; i < probs.length; i += 1) {
    if (probs[i] > probs[bestIndex]) {
      bestIndex = i;
    }
  }
  return actions[bestIndex] || actions[0];
}

module.exports = {
  createSearchCache,
  runHiddenInfoMcts,
  chooseActionFromPolicy,
  chooseMoveFromPolicy: chooseActionFromPolicy,
  terminalValueForRoot,
};
