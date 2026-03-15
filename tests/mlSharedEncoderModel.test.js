const {
  WHITE,
  createInitialState,
  getLegalActions,
  actionKey,
} = require('../src/services/ml/engine');
const { runHiddenInfoMcts } = require('../src/services/ml/mcts');
const { buildTrainingSamplesFromDecisions } = require('../src/services/ml/gameRunner');
const {
  SHARED_MODEL_FAMILY,
  cloneModelBundle,
  createDefaultModelBundle,
  describeModelBundle,
  trainSharedModelBundleBatch,
} = require('../src/services/ml/modeling');

describe('shared encoder model family', () => {
  test('default bundles publish the shared encoder interface', () => {
    const modelBundle = createDefaultModelBundle({ seed: 1401 });

    expect(modelBundle.family).toBe(SHARED_MODEL_FAMILY);
    expect(modelBundle.interface.stateInputSize).toBeGreaterThan(1000);
    expect(modelBundle.policy.network.outputSize).toBe(modelBundle.interface.policyActionVocabularySize);
    expect(modelBundle.identity.network.outputSize).toBe(
      modelBundle.interface.beliefPieceSlotsPerPerspective * modelBundle.interface.beliefIdentityCount,
    );
    expect(describeModelBundle(modelBundle)).toMatch(/^Shared-Encoder MLP \(.+ params\)$/);
  });

  test('ISMCTS training records expose fixed shared inputs and belief slots', () => {
    const state = createInitialState({ seed: 1402 });
    const modelBundle = createDefaultModelBundle({ seed: 1403 });
    const search = runHiddenInfoMcts(modelBundle, state, {
      rootPlayer: WHITE,
      iterations: 12,
      maxDepth: 6,
      hypothesisCount: 4,
      exploration: 1.25,
      seed: 1404,
    });

    expect(search.action).toBeTruthy();
    expect(getLegalActions(state, WHITE).some((action) => actionKey(action) === actionKey(search.action))).toBe(true);
    expect(search.trainingRecord.policy.stateInput).toHaveLength(modelBundle.interface.stateInputSize);
    expect(search.trainingRecord.policy.target).toHaveLength(modelBundle.policy.network.outputSize);
    expect(Array.isArray(search.trainingRecord.identitySamples)).toBe(true);
    expect(search.trainingRecord.identitySamples.length).toBeGreaterThan(0);
    search.trainingRecord.identitySamples.forEach((sample) => {
      expect(sample.stateInput).toHaveLength(modelBundle.interface.stateInputSize);
      expect(Number.isFinite(sample.pieceSlot)).toBe(true);
      expect(sample.trueIdentityIndex).toBeGreaterThanOrEqual(0);
    });
  });

  test('shared training updates the bundle and reports policy, value, and belief losses', () => {
    const state = createInitialState({ seed: 1405 });
    const initialBundle = createDefaultModelBundle({ seed: 1406 });
    const search = runHiddenInfoMcts(initialBundle, state, {
      rootPlayer: WHITE,
      iterations: 10,
      maxDepth: 5,
      hypothesisCount: 4,
      exploration: 1.25,
      seed: 1407,
    });
    const samples = buildTrainingSamplesFromDecisions([search], WHITE);
    const bundleBefore = cloneModelBundle(initialBundle);
    const beforeWeight = bundleBefore.encoder.network.layers[0].weights[0][0];

    const training = trainSharedModelBundleBatch(cloneModelBundle(initialBundle), samples, {
      epochs: 1,
      batchSize: 4,
      learningRate: 0.0005,
      weightDecay: 0.0001,
      gradientClipNorm: 1,
    });

    expect(training.modelBundle.family).toBe(SHARED_MODEL_FAMILY);
    expect(training.history).toHaveLength(1);
    expect(training.history[0].policySamples).toBeGreaterThan(0);
    expect(training.history[0].valueSamples).toBeGreaterThan(0);
    expect(training.history[0].identitySamples).toBeGreaterThan(0);
    expect(training.modelBundle.encoder.network.layers[0].weights[0][0]).not.toBe(beforeWeight);
  });
});
