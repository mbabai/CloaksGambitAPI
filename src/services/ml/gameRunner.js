const {
  ACTIONS,
  MOVE_STATES,
  WHITE,
  BLACK,
  otherColor,
  createInitialState,
  getLegalActions,
  applyAction,
  actionKey,
  getHiddenPieceIds,
  getLastAction,
  getLastMove,
  toReplayFrame,
  cloneState,
} = require('./engine');
const { createSearchCache, runHiddenInfoMcts } = require('./mcts');
const { chooseBuiltinAction } = require('./builtinBots');

function deepClone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function clampPositiveInt(value, fallback, min = 1, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function normalizeFloat(value, fallback, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function getDisplayParticipantId(participant) {
  if (!participant) return '';
  if (participant.type === 'builtin') return participant.id || '';
  if (participant.type === 'generation') return participant.id || '';
  if (participant.snapshotId) return `snapshot:${participant.snapshotId}`;
  return participant.id || '';
}

function getDisplayParticipantLabel(participant, fallbackId = '') {
  if (!participant) return fallbackId || 'Unknown';
  if (participant.type === 'generation') {
    if (Number.isFinite(participant.generation)) {
      return participant.label || `G${participant.generation}`;
    }
    return participant.label || participant.id || fallbackId || 'Unknown';
  }
  return participant.label || participant.snapshot?.label || participant.snapshotId || participant.id || fallbackId || 'Unknown';
}

function buildTrainingSamplesFromDecisions(decisions, winner) {
  const policySamples = [];
  const valueSamples = [];
  const identitySamples = [];

  const resultValueForPlayer = (player) => {
    if (winner === null || winner === undefined) return 0;
    return winner === player ? 1 : -1;
  };

  (Array.isArray(decisions) ? decisions : []).forEach((decision) => {
    if (!decision || !decision.trainingRecord) return;
    const record = decision.trainingRecord;
    const valueTarget = resultValueForPlayer(record.player);

    if (record.policy && Array.isArray(record.policy.features) && Array.isArray(record.policy.target)) {
      const stateInput = Array.isArray(record.policy.stateInput) ? record.policy.stateInput : null;
      const actionKeys = Array.isArray(record.policy.actionKeys)
        ? record.policy.actionKeys
        : (Array.isArray(record.policy.moveKeys) ? record.policy.moveKeys : []);
      const selectedActionKey = record.policy.selectedActionKey
        || record.policy.selectedMoveKey
        || null;
      policySamples.push({
        snapshotId: record.snapshotId,
        generation: Number.isFinite(record.sourceGeneration) ? record.sourceGeneration : null,
        player: record.player,
        features: record.policy.features.map((vector) => vector.slice()),
        stateInput: Array.isArray(stateInput) ? stateInput.slice() : null,
        target: record.policy.target.slice(),
        selectedActionKey,
        selectedMoveKey: selectedActionKey,
        actionKeys: actionKeys.slice(),
        moveKeys: actionKeys.slice(),
        slotIndices: Array.isArray(record.policy.slotIndices) ? record.policy.slotIndices.slice() : null,
      });
    } else if (record.policy && Array.isArray(record.policy.stateInput) && Array.isArray(record.policy.target)) {
      const actionKeys = Array.isArray(record.policy.actionKeys)
        ? record.policy.actionKeys
        : (Array.isArray(record.policy.moveKeys) ? record.policy.moveKeys : []);
      const selectedActionKey = record.policy.selectedActionKey
        || record.policy.selectedMoveKey
        || null;
      policySamples.push({
        snapshotId: record.snapshotId,
        generation: Number.isFinite(record.sourceGeneration) ? record.sourceGeneration : null,
        player: record.player,
        features: [],
        stateInput: record.policy.stateInput.slice(),
        target: record.policy.target.slice(),
        selectedActionKey,
        selectedMoveKey: selectedActionKey,
        actionKeys: actionKeys.slice(),
        moveKeys: actionKeys.slice(),
        slotIndices: Array.isArray(record.policy.slotIndices) ? record.policy.slotIndices.slice() : null,
      });
    }

    if (record.value && (Array.isArray(record.value.features) || Array.isArray(record.value.stateInput))) {
      valueSamples.push({
        snapshotId: record.snapshotId,
        generation: Number.isFinite(record.sourceGeneration) ? record.sourceGeneration : null,
        player: record.player,
        features: Array.isArray(record.value.features) ? record.value.features.slice() : [],
        stateInput: Array.isArray(record.value.stateInput) ? record.value.stateInput.slice() : null,
        target: valueTarget,
      });
    }

    if (Array.isArray(record.identitySamples)) {
      record.identitySamples.forEach((sample) => {
        identitySamples.push({
          snapshotId: record.snapshotId,
          generation: Number.isFinite(record.sourceGeneration) ? record.sourceGeneration : null,
          player: record.player,
          pieceId: sample.pieceId,
          pieceSlot: Number.isFinite(sample.pieceSlot) ? sample.pieceSlot : null,
          trueIdentity: sample.trueIdentity,
          trueIdentityIndex: Number.isFinite(sample.trueIdentityIndex) ? sample.trueIdentityIndex : null,
          stateInput: Array.isArray(sample.stateInput) ? sample.stateInput.slice() : null,
          pieceFeatures: Array.isArray(sample.pieceFeatures)
            ? sample.pieceFeatures.slice()
            : null,
          featureByIdentity: deepClone(sample.featureByIdentity),
          probabilities: deepClone(sample.probabilities),
        });
      });
    }
  });

  return { policySamples, valueSamples, identitySamples };
}

function hasResponsePhase(state) {
  const lastAction = getLastAction(state);
  const lastMove = getLastMove(state);
  if (!lastAction) return false;
  if (state?.onDeckingPlayer === state?.playerTurn) return true;
  if (lastAction.type === ACTIONS.BOMB) return true;
  return lastAction.type === ACTIONS.MOVE
    && Boolean(lastMove && lastMove.state === MOVE_STATES.PENDING);
}

function buildAdaptiveSearchOptions(state, participant, legalActions, baseOptions = {}) {
  const normalized = {
    iterations: clampPositiveInt(baseOptions.iterations, 90, 10, 800),
    maxDepth: clampPositiveInt(baseOptions.maxDepth, 16, 4, 80),
    hypothesisCount: clampPositiveInt(baseOptions.hypothesisCount, 8, 1, 24),
    riskBias: normalizeFloat(baseOptions.riskBias, 0, 0, 3),
    exploration: normalizeFloat(baseOptions.exploration, 1.25, 0, 5),
  };
  if (!baseOptions.adaptiveSearch || !participant || participant.type === 'builtin') {
    return {
      ...normalized,
      adaptiveSearchApplied: false,
      quietPosition: false,
      responsePhase: hasResponsePhase(state),
      hiddenPieceCount: getHiddenPieceIds(state, state.playerTurn).length,
    };
  }

  const responsePhase = hasResponsePhase(state);
  const legalCount = Array.isArray(legalActions) ? legalActions.length : 0;
  const hiddenPieceCount = getHiddenPieceIds(state, state.playerTurn).length;
  const quietPosition = !responsePhase && state?.onDeckingPlayer === null && legalCount >= 12;

  let iterations = normalized.iterations;
  let hypothesisCount = normalized.hypothesisCount;

  if (!responsePhase) {
    if ((state?.ply || 0) <= 6) {
      iterations = Math.max(16, Math.floor(iterations / 4));
    } else if (legalCount >= 40) {
      iterations = Math.max(16, Math.floor(iterations / 3));
    } else if (legalCount >= 24) {
      iterations = Math.max(24, Math.floor(iterations / 2));
    }

    if (hiddenPieceCount >= 4) {
      hypothesisCount = 1;
    } else if (hiddenPieceCount >= 2) {
      hypothesisCount = Math.min(hypothesisCount, 2);
    }
  }

  return {
    ...normalized,
    iterations,
    hypothesisCount,
    adaptiveSearchApplied: true,
    quietPosition,
    responsePhase,
    hiddenPieceCount,
  };
}

function chooseActionForParticipant(participant, state, options = {}) {
  if (!participant || !state || !state.isActive) {
    return {
      action: null,
      trace: { reason: 'inactive_or_missing_participant' },
      valueEstimate: 0,
      trainingRecord: null,
    };
  }

  if (participant.type === 'builtin') {
    return chooseBuiltinAction(participant.id, state, options);
  }

  const modelBundle = participant.snapshot?.modelBundle || participant.modelBundle || null;
  if (!modelBundle) {
    return {
      action: null,
      trace: { reason: 'snapshot_missing_model' },
      valueEstimate: 0,
      trainingRecord: null,
    };
  }

  return runHiddenInfoMcts(modelBundle, state, {
    rootPlayer: state.toMove,
    iterations: options.iterations,
    maxDepth: options.maxDepth,
    hypothesisCount: options.hypothesisCount,
    riskBias: options.riskBias,
    exploration: options.exploration,
    searchCache: options.searchCache || null,
    seed: options.seed,
  });
}

function forceTerminalState(state, winner, winReason) {
  const next = cloneState(state);
  next.winner = winner;
  next.winReason = winReason;
  next.isActive = false;
  next.toMove = next.playerTurn;
  return next;
}

function buildDecisionTrace(search = {}, searchOptions = {}, fallbackUsed = false) {
  return {
    ...deepClone(search?.trace || {}),
    fastPath: {
      fallbackUsed: Boolean(fallbackUsed),
      adaptiveSearchApplied: Boolean(searchOptions.adaptiveSearchApplied),
      quietPosition: Boolean(searchOptions.quietPosition),
      responsePhase: Boolean(searchOptions.responsePhase),
      hiddenPieceCount: Number(searchOptions.hiddenPieceCount || 0),
      iterations: Number(searchOptions.iterations || 0),
      maxDepth: Number(searchOptions.maxDepth || 0),
      hypothesisCount: Number(searchOptions.hypothesisCount || 0),
      riskBias: Number(searchOptions.riskBias || 0),
      exploration: Number(searchOptions.exploration || 0),
    },
  };
}

async function runFastGame(options = {}) {
  const startedAtMs = Date.now();
  const whiteParticipant = options.whiteParticipant || null;
  const blackParticipant = options.blackParticipant || null;
  const whiteParticipantId = getDisplayParticipantId(whiteParticipant);
  const blackParticipantId = getDisplayParticipantId(blackParticipant);
  const whiteParticipantLabel = getDisplayParticipantLabel(whiteParticipant, whiteParticipantId);
  const blackParticipantLabel = getDisplayParticipantLabel(blackParticipant, blackParticipantId);
  const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
  const maxPlies = clampPositiveInt(options.maxPlies, 120, 40, 300);
  const baseSearchOptions = {
    iterations: clampPositiveInt(options.iterations, 90, 10, 800),
    maxDepth: clampPositiveInt(options.maxDepth, 16, 4, 80),
    hypothesisCount: clampPositiveInt(options.hypothesisCount, 8, 1, 24),
    riskBias: normalizeFloat(options.riskBias, 0, 0, 3),
    exploration: normalizeFloat(options.exploration, 1.25, 0, 5),
    adaptiveSearch: options.adaptiveSearch !== false,
  };
  const maxDecisionSafety = Math.max(maxPlies * 6, maxPlies + 24);

  let state = createInitialState({ seed, maxPlies });
  const searchContextByParticipantId = new Map();
  const replay = [toReplayFrame(state, {
    note: 'start',
    actionCount: Array.isArray(state.actions) ? state.actions.length : 0,
    moveCount: Array.isArray(state.moves) ? state.moves.length : 0,
  })];
  const decisions = [];
  let forcedStopReason = null;

  for (let step = 0; step < maxDecisionSafety; step += 1) {
    if (!state?.isActive) break;
    const currentPlayer = Number.isFinite(state?.playerTurn) ? state.playerTurn : WHITE;
    const participant = currentPlayer === WHITE ? whiteParticipant : blackParticipant;
    const participantId = getDisplayParticipantId(participant);
    const participantLabel = getDisplayParticipantLabel(participant, participantId);

    if (!participant) {
      forcedStopReason = 'missing_participant';
      state = forceTerminalState(state, otherColor(currentPlayer), 'resign');
      replay.push(toReplayFrame(state, {
        note: forcedStopReason,
        actionCount: state.actions.length,
        moveCount: state.moves.length,
      }));
      break;
    }

    const legalActions = getLegalActions(state, currentPlayer);
    if (!legalActions.length) {
      forcedStopReason = 'no_legal_actions';
      state = forceTerminalState(state, otherColor(currentPlayer), 'resign');
      replay.push(toReplayFrame(state, {
        note: forcedStopReason,
        actionCount: state.actions.length,
        moveCount: state.moves.length,
      }));
      break;
    }

    const searchOptions = buildAdaptiveSearchOptions(state, participant, legalActions, baseSearchOptions);
    const searchContextKey = participantId || `${participant?.type || 'unknown'}:${currentPlayer}`;
    if (!searchContextByParticipantId.has(searchContextKey)) {
      searchContextByParticipantId.set(searchContextKey, {
        searchCache: createSearchCache(),
      });
    }
    const searchContext = searchContextByParticipantId.get(searchContextKey);
    const search = chooseActionForParticipant(participant, state, {
      ...searchOptions,
      seed: seed + (decisions.length * 104729),
      searchCache: searchContext?.searchCache || null,
    });
    const requestedKey = actionKey(search?.action);
    const legalByKey = new Map(legalActions.map((action) => [actionKey(action), action]));
    const executedAction = legalByKey.get(requestedKey) || legalActions[0];
    const executedKey = actionKey(executedAction);
    const fallbackUsed = Boolean(requestedKey && executedKey && requestedKey !== executedKey);
    state = applyAction(state, executedAction);

    const decision = {
      ply: decisions.length,
      player: currentPlayer,
      participantId,
      participantLabel,
      snapshotId: participant.snapshotId || null,
      action: deepClone(executedAction),
      move: deepClone(executedAction),
      trace: buildDecisionTrace(search, searchOptions, fallbackUsed),
      valueEstimate: Number.isFinite(search?.valueEstimate) ? search.valueEstimate : 0,
      trainingRecord: !fallbackUsed && search?.trainingRecord
        ? {
          ...deepClone(search.trainingRecord),
          snapshotId: participant.snapshotId || null,
          sourceGeneration: Number.isFinite(participant.generation) ? participant.generation : null,
        }
        : null,
    };
    decisions.push(decision);
    replay.push(toReplayFrame(state, {
      actionCount: state.actions.length,
      moveCount: state.moves.length,
      decision,
    }));

    if (decisions.length >= maxPlies && state.isActive) {
      forcedStopReason = 'max_plies';
      state = forceTerminalState(state, null, 'draw');
      replay.push(toReplayFrame(state, {
        note: forcedStopReason,
        actionCount: state.actions.length,
        moveCount: state.moves.length,
      }));
      break;
    }
  }

  if (state?.isActive) {
    forcedStopReason = forcedStopReason || 'safety_stop';
    state = forceTerminalState(state, null, 'draw');
    replay.push(toReplayFrame(state, {
      note: forcedStopReason,
      actionCount: state.actions.length,
      moveCount: state.moves.length,
    }));
  }

  const winner = Number.isFinite(state?.winner) ? state.winner : null;
  const winReason = state?.winReason ?? forcedStopReason ?? null;
  const training = buildTrainingSamplesFromDecisions(decisions, winner);

  return {
    id: options.gameId || null,
    createdAt: new Date().toISOString(),
    durationMs: Math.max(0, Date.now() - startedAtMs),
    seed,
    setupMode: 'engine-fast',
    whiteParticipantId,
    blackParticipantId,
    whiteParticipantLabel,
    blackParticipantLabel,
    winner,
    winReason,
    plies: decisions.length,
    actionHistory: Array.isArray(state?.actions) ? deepClone(state.actions) : [],
    moveHistory: Array.isArray(state?.moves) ? deepClone(state.moves) : [],
    replay,
    decisions,
    training,
    result: {
      whiteValue: winner === null ? 0 : (winner === WHITE ? 1 : -1),
      blackValue: winner === null ? 0 : (winner === BLACK ? 1 : -1),
    },
  };
}

module.exports = {
  buildTrainingSamplesFromDecisions,
  buildAdaptiveSearchOptions,
  chooseActionForParticipant,
  getDisplayParticipantId,
  getDisplayParticipantLabel,
  runFastGame,
};
