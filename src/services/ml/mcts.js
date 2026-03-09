const {
  getLegalActions,
  applyAction,
  actionKey,
  computeStateHash,
  IDENTITIES,
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

function evaluateState(modelBundle, state, currentPlayer, rootPlayer, options = {}) {
  const legalActions = getLegalActions(state, currentPlayer);
  if (!legalActions.length) {
    const value = currentPlayer === rootPlayer ? -1 : 1;
    return {
      legalActions,
      priors: [],
      valueRoot: value,
      policyFeatures: [],
      policyStateFeatures: [],
      identitySamples: [],
      hypothesisSummary: [],
    };
  }

  const identityInference = inferIdentityHypotheses(
    modelBundle,
    state,
    currentPlayer,
    { count: options.hypothesisCount },
  );
  const hypotheses = ensureHypotheses(identityInference);
  const weightedPriors = Array.from({ length: legalActions.length }, () => 0);
  const valuesCurrent = [];
  const hypothesisSummary = [];
  let representativeFeatures = null;
  let representativeStateFeatures = null;

  hypotheses.forEach((hypothesis, idx) => {
    const assignment = hypothesis.assignment || {};
    const policy = predictPolicy(modelBundle, state, currentPlayer, legalActions, assignment);
    const value = predictValue(modelBundle, state, currentPlayer, assignment);

    const probability = Number.isFinite(hypothesis.probability) ? hypothesis.probability : 0;
    policy.probabilities.forEach((p, actionIdx) => {
      weightedPriors[actionIdx] += (p || 0) * probability;
    });
    valuesCurrent.push(value.value);

    if (!representativeFeatures || idx === 0) {
      representativeFeatures = policy.features;
      representativeStateFeatures = policy.stateFeatures;
    }

    hypothesisSummary.push({
      probability,
      valueCurrent: value.value,
      assignment,
    });
  });

  const priors = normalizeArray(weightedPriors);
  const risk = applyRiskBiasToHypotheses(hypotheses, valuesCurrent, options.riskBias);
  const valueCurrent = risk.value;
  const valueRoot = currentPlayer === rootPlayer ? valueCurrent : -valueCurrent;

  return {
    legalActions,
    priors,
    valueRoot,
    policyFeatures: representativeFeatures || [],
    policyStateFeatures: representativeStateFeatures || [],
    identitySamples: identityInference.samples || [],
    hypothesisSummary,
  };
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

  const evaluation = evaluateState(
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
  const child = createNode(nextState, node, action, node.depth + 1);
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

function runHiddenInfoMcts(modelBundle, rootState, options = {}) {
  const rootPlayer = Number.isFinite(options.rootPlayer) ? options.rootPlayer : rootState.toMove;
  const iterations = Number.isFinite(options.iterations) ? Math.max(1, Math.floor(options.iterations)) : 80;
  const maxDepth = Number.isFinite(options.maxDepth) ? Math.max(1, Math.floor(options.maxDepth)) : 16;
  const exploration = Number.isFinite(options.exploration) ? Math.max(0, options.exploration) : 1.25;

  const root = createNode(rootState);
  expandNode(root, modelBundle, rootPlayer, options);

  if (!root.legalActions.length) {
    return buildSearchResult({
      action: null,
      root,
      policyTarget: [],
      valueEstimate: terminalValueForRoot(rootState, rootPlayer),
      trace: {
        iterations: 0,
        rootVisits: 0,
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

      if (node.depth >= maxDepth) {
        expandNode(node, modelBundle, rootPlayer, options);
        backpropagate(path, node.valueEstimate || 0);
        break;
      }

      expandNode(node, modelBundle, rootPlayer, options);
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
        expandNode(child, modelBundle, rootPlayer, options);
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
    identitySamples: root.identitySamples || [],
    hypothesisSummary: root.hypothesisSummary || [],
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
