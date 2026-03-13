const {
  getLegalActions,
  applyAction,
  actionKey,
  computeStateHash,
  IDENTITIES,
  cloneState,
} = require('./engine');
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

  const trainingRecord = {
    player: rootState.toMove,
    stateFeatures: root.policyStateFeatures || [],
    policy: {
      actionKeys,
      moveKeys: actionKeys.slice(),
      features: actionKeys.map((key) => root.policyFeaturesByActionKey[key] || []),
      target: policyTarget,
      selectedActionKey: selectedKey,
      selectedMoveKey: selectedKey,
    },
    value: {
      features: root.policyStateFeatures || [],
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

  const observationPolicy = predictPolicy(
    modelBundle,
    rootState,
    rootPlayer,
    rootLegalActions,
    null,
    null,
  );
  const observationStateFeatures = observationPolicy.stateFeatures || [];
  const identityInference = inferIdentityHypotheses(
    modelBundle,
    rootState,
    rootPlayer,
    { count: options.hypothesisCount },
  );
  const hypotheses = ensureHypotheses(identityInference);
  const hypothesisSearches = hypotheses.map((hypothesis) => {
    const assignment = hypothesis?.assignment || {};
    const determinizedState = applyIdentityAssignmentToState(rootState, assignment);
    const search = runDeterminizedMcts(modelBundle, determinizedState, {
      ...options,
      rootPlayer,
    });
    return {
      hypothesis,
      search,
    };
  });

  const valuesRoot = hypothesisSearches.map(({ search }) => Number(search?.valueEstimate || 0));
  const riskAggregation = applyRiskBiasToHypotheses(hypotheses, valuesRoot, options.riskBias);
  const hypothesisWeights = riskAggregation.weights.length === hypothesisSearches.length
    ? riskAggregation.weights
    : normalizeArray(hypotheses.map((hypothesis) => Number(hypothesis?.probability || 0)));
  const actionKeys = rootLegalActions.map((action) => actionKey(action));
  const actionByKey = {};
  const policyFeaturesByActionKey = {};
  rootLegalActions.forEach((action, idx) => {
    const key = actionKeys[idx];
    actionByKey[key] = action;
    policyFeaturesByActionKey[key] = observationPolicy.features?.[idx] || [];
  });

  let legalActionMismatchCount = 0;
  const statsByActionKeyByHypothesis = hypothesisSearches.map(({ search }) => {
    const statsByActionKey = {};
    const searchActionKeys = new Set();
    (search?.trace?.actionStats || []).forEach((entry) => {
      const key = entry?.actionKey || entry?.moveKey || '';
      if (!key) return;
      statsByActionKey[key] = entry;
      searchActionKeys.add(key);
    });
    if (searchActionKeys.size !== actionKeys.length || actionKeys.some((key) => !searchActionKeys.has(key))) {
      legalActionMismatchCount += 1;
    }
    return statsByActionKey;
  });

  const aggregatedVisits = actionKeys.map((key) => (
    hypothesisSearches.reduce((sum, _, hypothesisIndex) => (
      sum + (Number(statsByActionKeyByHypothesis[hypothesisIndex]?.[key]?.visits || 0) * (hypothesisWeights[hypothesisIndex] || 0))
    ), 0)
  ));
  const policyTarget = normalizeTargetProbabilities(aggregatedVisits);
  const ranked = actionKeys
    .map((key, idx) => ({
      key,
      visits: aggregatedVisits[idx],
    }))
    .sort((a, b) => b.visits - a.visits);
  const nonCatastrophic = ranked.find((entry) => !isCatastrophicKingBluff(rootState, actionByKey[entry.key]));
  const selectedEntry = nonCatastrophic || ranked[0];
  const selectedKey = selectedEntry?.key || actionKeys[0];
  const selectedAction = actionByKey[selectedKey] || rootLegalActions[0] || null;
  const actionStats = actionKeys.map((key, idx) => ({
    actionKey: key,
    moveKey: key,
    visits: aggregatedVisits[idx],
    prior: observationPolicy.probabilities?.[idx] || 0,
    q: hypothesisSearches.reduce((sum, _, hypothesisIndex) => (
      sum + (Number(statsByActionKeyByHypothesis[hypothesisIndex]?.[key]?.q || 0) * (hypothesisWeights[hypothesisIndex] || 0))
    ), 0),
  }));

  const totalRootVisits = hypothesisSearches.reduce((sum, { search }) => sum + Number(search?.trace?.rootVisits || 0), 0);
  const hypothesisSummary = hypothesisSearches.map(({ hypothesis, search }, index) => ({
    probability: Number(hypothesis?.probability || 0),
    searchWeight: Number(hypothesisWeights[index] || 0),
    valueRoot: Number(search?.valueEstimate || 0),
    selectedActionKey: search?.action ? actionKey(search.action) : null,
    assignment: hypothesis?.assignment || {},
  }));

  const root = {
    hash: computeStateHash(rootState),
    state: rootState,
    visits: totalRootVisits,
    valueSum: Number(riskAggregation.value || 0) * totalRootVisits,
    expanded: true,
    legalActions: rootLegalActions,
    priorsByActionKey: actionKeys.reduce((acc, key, idx) => {
      acc[key] = observationPolicy.probabilities?.[idx] || 0;
      return acc;
    }, {}),
    actionByKey,
    childrenByActionKey: actionKeys.reduce((acc, key, idx) => {
      acc[key] = {
        visits: aggregatedVisits[idx],
        valueSum: (actionStats[idx]?.q || 0) * aggregatedVisits[idx],
      };
      return acc;
    }, {}),
    policyFeaturesByActionKey,
    policyStateFeatures: observationStateFeatures,
    identitySamples: identityInference.samples || [],
    hypothesisSummary,
  };

  const trainingRecord = {
    player: rootState.toMove,
    stateFeatures: observationStateFeatures,
    policy: {
      actionKeys,
      moveKeys: actionKeys.slice(),
      features: observationPolicy.features?.map((vector) => vector.slice()) || [],
      target: policyTarget,
      selectedActionKey: selectedKey,
      selectedMoveKey: selectedKey,
    },
    value: {
      features: observationStateFeatures.slice(),
      target: 0,
    },
    identitySamples: identityInference.samples || [],
    hypothesisSummary,
  };

  const aggregateTrace = hypothesisSearches.reduce((acc, { search }) => {
    acc.iterations += Number(search?.trace?.iterations || 0);
    acc.transpositionHits += Number(search?.trace?.transpositionHits || 0);
    acc.evaluationCacheHits += Number(search?.trace?.evaluationCacheHits || 0);
    acc.evaluationCount += Number(search?.trace?.evaluationCount || 0);
    acc.nodeCount += Number(search?.trace?.nodeCount || 0);
    return acc;
  }, {
    iterations: 0,
    transpositionHits: 0,
    evaluationCacheHits: 0,
    evaluationCount: 0,
    nodeCount: 0,
  });

  return buildSearchResult({
    action: selectedAction,
    root,
    policyTarget,
    valueEstimate: Number(riskAggregation.value || 0),
    trace: {
      iterations: aggregateTrace.iterations,
      iterationsPerHypothesis: hypothesisSearches.length ? Number(hypothesisSearches[0]?.trace?.iterations || 0) : 0,
      hypothesisCount: hypothesisSearches.length,
      rootVisits: totalRootVisits,
      actionStats,
      moveStats: actionStats,
      hypothesisSummary,
      legalActionMismatchCount,
      kingBluffGuardApplied: Boolean(nonCatastrophic && selectedEntry && selectedEntry.key !== ranked[0]?.key),
      transpositionHits: aggregateTrace.transpositionHits,
      evaluationCacheHits: aggregateTrace.evaluationCacheHits,
      evaluationCount: aggregateTrace.evaluationCount,
      nodeCount: aggregateTrace.nodeCount,
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
  runHiddenInfoMcts,
  chooseActionFromPolicy,
  chooseMoveFromPolicy: chooseActionFromPolicy,
  terminalValueForRoot,
};
