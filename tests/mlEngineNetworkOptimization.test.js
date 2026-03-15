const {
  WHITE,
  BLACK,
  MOVE_STATES,
  createInitialState,
  getLegalActions,
  applyAction,
  applyActionMutable,
  applyActionWithUndo,
  undoAppliedAction,
  cloneState,
  cloneStateForSearch,
  getInformationHistoryHash,
} = require('../src/services/ml/engine');
const { ensureEncodedState } = require('../src/services/ml/stateEncoding');
const {
  createDefaultModelBundle,
  extractActionFeatures,
  extractStateFeatures,
} = require('../src/services/ml/modeling');
const {
  createAdamState,
  createGradientBundle,
  forwardNetwork,
  forwardNetworkBatch,
  forwardNetworkScalarBatch,
  applyAdamUpdate,
} = require('../src/services/ml/network');

describe('ML engine/network optimizations', () => {
  test('compiled batch inference matches per-action inference and invalidates after updates', () => {
    const modelBundle = createDefaultModelBundle({ seed: 12001 });
    const state = createInitialState({ seed: 12002, maxPlies: 120 });
    const actions = getLegalActions(state, WHITE);
    const stateFeatures = extractStateFeatures(state, WHITE);
    const featureMatrix = actions.map((action) => (
      extractActionFeatures(state, WHITE, action, null, stateFeatures)
    ));

    const individual = featureMatrix.map((features) => forwardNetwork(modelBundle.policy.network, features)[0]);
    const batched = forwardNetworkBatch(modelBundle.policy.network, featureMatrix).map((output) => output[0]);
    const scalarBatch = forwardNetworkScalarBatch(modelBundle.policy.network, featureMatrix);

    expect(batched).toHaveLength(individual.length);
    batched.forEach((value, index) => {
      expect(value).toBeCloseTo(individual[index], 12);
    });
    scalarBatch.forEach((value, index) => {
      expect(value).toBeCloseTo(individual[index], 12);
    });

    const gradients = createGradientBundle(modelBundle.policy.network);
    const finalLayerIndex = gradients.layers.length - 1;
    gradients.layers[finalLayerIndex].biases[0] = 1;
    const optimizerState = createAdamState(modelBundle.policy.network);
    const before = forwardNetwork(modelBundle.policy.network, featureMatrix[0])[0];
    applyAdamUpdate(modelBundle.policy.network, gradients, optimizerState, {
      learningRate: 0.05,
    });
    const after = forwardNetwork(modelBundle.policy.network, featureMatrix[0])[0];

    expect(after).not.toBeCloseTo(before, 12);
  });

  test('numeric action metadata preserves extracted policy features', () => {
    const state = createInitialState({ seed: 12003, maxPlies: 120 });
    const action = getLegalActions(state, WHITE).find((candidate) => candidate.type === 'MOVE');
    const strippedAction = {
      type: action.type,
      player: action.player,
      pieceId: action.pieceId,
      from: action.from ? { ...action.from } : null,
      to: action.to ? { ...action.to } : null,
      declaration: action.declaration,
      capturePieceId: action.capturePieceId,
    };

    expect(extractActionFeatures(state, WHITE, action)).toEqual(
      extractActionFeatures(state, WHITE, strippedAction),
    );
  });

  test('copy-on-write move histories do not mutate ancestor states', () => {
    const initial = createInitialState({ seed: 13001, maxPlies: 120 });
    const firstMove = getLegalActions(initial, WHITE).find((action) => action.type === 'MOVE');
    const afterFirstMove = applyAction(initial, firstMove);

    expect(afterFirstMove.moves).toHaveLength(1);
    expect(afterFirstMove.moves[0].state).toBe(MOVE_STATES.PENDING);

    const secondMove = getLegalActions(afterFirstMove, BLACK).find((action) => action.type === 'MOVE');
    const afterSecondMove = applyAction(afterFirstMove, secondMove);

    expect(afterFirstMove.moves[0].state).toBe(MOVE_STATES.PENDING);
    expect(afterSecondMove.moves[0].state).not.toBe(MOVE_STATES.PENDING);
    expect(initial.moves).toHaveLength(0);
    expect(initial.actions).toHaveLength(0);
  });

  test('applyActionMutable matches cloned applyAction results', () => {
    const initial = createInitialState({ seed: 14001, maxPlies: 120 });
    const firstMove = getLegalActions(initial, WHITE).find((action) => action.type === 'MOVE');
    const expected = applyAction(initial, firstMove);

    const mutable = cloneState(initial);
    applyActionMutable(mutable, firstMove);

    expect(mutable).toEqual(expected);
  });

  test('search-state clones preserve encoded caches across mutable plies', () => {
    const initial = createInitialState({ seed: 15001, maxPlies: 120 });
    const initialEncoded = ensureEncodedState(initial);
    const searchClone = cloneStateForSearch(initial);
    const clonedEncoded = ensureEncodedState(searchClone);

    expect(clonedEncoded).not.toBe(initialEncoded);
    expect(Array.from(clonedEncoded.boardPieceIndices)).toEqual(Array.from(initialEncoded.boardPieceIndices));

    const firstMove = getLegalActions(searchClone, WHITE).find((action) => action.type === 'MOVE');
    applyActionMutable(searchClone, firstMove);
    const secondMove = getLegalActions(searchClone, BLACK).find((action) => action.type === 'MOVE');
    applyActionMutable(searchClone, secondMove);

    const updatedEncoded = ensureEncodedState(searchClone);
    expect(updatedEncoded).toBe(clonedEncoded);

    const rebuilt = cloneState(searchClone);
    const rebuiltEncoded = ensureEncodedState(rebuilt);
    expect(Array.from(updatedEncoded.boardPieceIndices)).toEqual(Array.from(rebuiltEncoded.boardPieceIndices));
    expect(Array.from(updatedEncoded.pieceSquareIndices)).toEqual(Array.from(rebuiltEncoded.pieceSquareIndices));
    expect(Array.from(updatedEncoded.pieceAlive)).toEqual(Array.from(rebuiltEncoded.pieceAlive));
    expect(Array.from(updatedEncoded.pieceZone)).toEqual(Array.from(rebuiltEncoded.pieceZone));
    expect(updatedEncoded.alivePieceIdsByColor).toEqual(rebuiltEncoded.alivePieceIdsByColor);
    expect(updatedEncoded.hiddenPieceIdsByPerspective).toEqual(rebuiltEncoded.hiddenPieceIdsByPerspective);
  });

  test('search-state clones do not mutate ancestor board or piece objects', () => {
    const initial = createInitialState({ seed: 16001, maxPlies: 120 });
    const initialSnapshot = cloneState(initial);
    const searchClone = cloneStateForSearch(initial);

    const firstMove = getLegalActions(searchClone, WHITE).find((action) => action.type === 'MOVE');
    applyActionMutable(searchClone, firstMove);
    const secondMove = getLegalActions(searchClone, BLACK).find((action) => action.type === 'MOVE');
    applyActionMutable(searchClone, secondMove);

    expect(initial).toEqual(initialSnapshot);
  });

  test('applyActionWithUndo restores state and search caches', () => {
    const initial = createInitialState({ seed: 17001, maxPlies: 120 });
    const searchState = cloneStateForSearch(initial);
    const baseline = cloneState(searchState);
    const baselineEncoded = ensureEncodedState(searchState);
    const baselineHistoryHash = JSON.parse(JSON.stringify(getInformationHistoryHash(searchState)));
    const firstMove = getLegalActions(searchState, WHITE).find((action) => action.type === 'MOVE');

    const undoFrame = applyActionWithUndo(searchState, firstMove);
    expect(searchState).not.toEqual(baseline);

    undoAppliedAction(searchState, undoFrame);

    expect(searchState).toEqual(baseline);
    expect(Array.from(ensureEncodedState(searchState).boardPieceIndices)).toEqual(Array.from(baselineEncoded.boardPieceIndices));
    expect(getInformationHistoryHash(searchState)).toEqual(baselineHistoryHash);
  });

  test('incremental information-history hashes match a clean recompute', () => {
    const initial = createInitialState({ seed: 18001, maxPlies: 120 });
    const incrementalState = cloneStateForSearch(initial);

    getInformationHistoryHash(incrementalState);
    const firstMove = getLegalActions(incrementalState, WHITE).find((action) => action.type === 'MOVE');
    applyActionMutable(incrementalState, firstMove);
    const secondMove = getLegalActions(incrementalState, BLACK).find((action) => action.type === 'MOVE');
    applyActionMutable(incrementalState, secondMove);

    const incrementalHash = JSON.parse(JSON.stringify(getInformationHistoryHash(incrementalState)));
    const rebuiltState = cloneState(incrementalState);
    expect(getInformationHistoryHash(rebuiltState)).toEqual(incrementalHash);
  });
});
