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
  countModelBundleParameters,
  createDefaultModelBundle,
  createOptimizerState,
  describeModelBundle,
  getSharedModelSizePresetOptions,
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

  test('shared encoder presets expose selectable parameter budgets', () => {
    const presetOptions = getSharedModelSizePresetOptions();
    expect(presetOptions.map((item) => item.id || item.value)).toEqual(['32k', '65k', '126k', '256k', '512k']);

    const compactBundle = createDefaultModelBundle({ seed: 1501, modelSizePreset: '32k' });
    const mediumBundle = createDefaultModelBundle({ seed: 1502, modelSizePreset: '65k' });
    const largerBundle = createDefaultModelBundle({ seed: 1503, modelSizePreset: '126k' });

    expect(compactBundle.architecture?.presetId).toBe('32k');
    expect(mediumBundle.architecture?.presetId).toBe('65k');
    expect(largerBundle.architecture?.presetId).toBe('126k');
    expect(countModelBundleParameters(compactBundle)).toBe(32148);
    expect(countModelBundleParameters(mediumBundle)).toBe(65600);
    expect(countModelBundleParameters(largerBundle)).toBe(126812);
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

  test('shared training also accepts the combined sharedSamples batch shape', () => {
    const state = createInitialState({ seed: 1415 });
    const initialBundle = createDefaultModelBundle({ seed: 1416, modelSizePreset: '32k' });
    const search = runHiddenInfoMcts(initialBundle, state, {
      rootPlayer: WHITE,
      iterations: 8,
      maxDepth: 5,
      hypothesisCount: 2,
      exploration: 1.25,
      seed: 1417,
    });
    const samples = buildTrainingSamplesFromDecisions([search], WHITE);
    const sharedSamples = samples.policySamples.map((policySample, index) => ({
      stateInput: policySample.stateInput.slice(),
      policyTarget: policySample.target.slice(),
      valueTarget: Number(samples.valueSamples[index]?.target ?? 0),
      identityTargets: samples.identitySamples
        .filter((identitySample) => identitySample.sampleKey === policySample.sampleKey)
        .map((identitySample) => ({
          pieceSlot: Number(identitySample.pieceSlot),
          truthIndex: Number(identitySample.trueIdentityIndex),
        })),
    }));

    const training = trainSharedModelBundleBatch(cloneModelBundle(initialBundle), {
      sharedSamples,
    }, {
      epochs: 1,
      batchSize: 4,
      learningRate: 0.0005,
      weightDecay: 0.0001,
      gradientClipNorm: 1,
    });

    expect(training.history).toHaveLength(1);
    expect(training.history[0].policySamples).toBeGreaterThan(0);
    expect(training.history[0].valueSamples).toBeGreaterThan(0);
  });

  test('shared training resets incompatible optimizer checkpoints instead of crashing', () => {
    const state = createInitialState({ seed: 1425 });
    const targetBundle = createDefaultModelBundle({ seed: 1426, modelSizePreset: '65k' });
    const staleBundle = createDefaultModelBundle({ seed: 1427, modelSizePreset: '32k' });
    const search = runHiddenInfoMcts(targetBundle, state, {
      rootPlayer: WHITE,
      iterations: 8,
      maxDepth: 5,
      hypothesisCount: 2,
      exploration: 1.25,
      seed: 1428,
    });
    const samples = buildTrainingSamplesFromDecisions([search], WHITE);
    const staleOptimizerState = createOptimizerState(staleBundle);

    const training = trainSharedModelBundleBatch(cloneModelBundle(targetBundle), samples, {
      epochs: 1,
      batchSize: 4,
      learningRate: 0.0005,
      weightDecay: 0.0001,
      gradientClipNorm: 1,
      optimizerState: staleOptimizerState,
    });

    expect(training.history).toHaveLength(1);
    expect(training.optimizerState).toBeTruthy();
    expect(training.optimizerState.encoder).not.toBe(staleOptimizerState.encoder);
    expect(training.optimizerState.encoder.layers[0].mWeights)
      .toHaveLength(targetBundle.encoder.network.layers[0].outputSize);
    expect(training.optimizerState.encoder.layers[0].mWeights[0])
      .toHaveLength(targetBundle.encoder.network.layers[0].inputSize);
  });
});
