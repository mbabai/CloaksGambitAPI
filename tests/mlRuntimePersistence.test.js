const fs = require('fs');
const os = require('os');
const path = require('path');
const { MlRuntime } = require('../src/services/ml/runtime');
const { createDefaultModelBundle } = require('../src/services/ml/modeling');
const MlRunModel = require('../src/models/MlRun');
const MlRunCheckpointModel = require('../src/models/MlRunCheckpoint');

function buildReplaySample(index) {
  const createdAt = new Date(Date.UTC(2026, 2, 12, 21, 0, Math.floor(index / 10), index % 10)).toISOString();
  return {
    createdAt,
    generation: Math.floor(index / 64),
    input: [index, index + 1, index + 2],
    target: [0.2, 0.8],
    selectedActionKey: `action-${index}`,
  };
}

describe('ML runtime persistence compaction', () => {
  let runtime;
  let tempDir;

  function createPersistedRuntime() {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ml-runtime-'));
    return new MlRuntime({
      dataFilePath: path.join(tempDir, 'runtime.json'),
      persist: true,
      useMongoSimulations: false,
      useMongoRuns: false,
    });
  }

  beforeEach(() => {
    runtime = new MlRuntime({ persist: false });
  });

  afterEach(() => {
    runtime?.dispose?.();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
    jest.restoreAllMocks();
  });

  test('keeps only a bounded tail of active replay samples in persisted state', () => {
    const policySamples = Array.from({ length: 1500 }, (_, index) => buildReplaySample(index));
    const valueSamples = policySamples.map((sample, index) => ({
      createdAt: sample.createdAt,
      generation: sample.generation,
      input: [index],
      target: (index % 7) / 7,
    }));
    const identitySamples = policySamples.flatMap((sample, index) => ([
      {
        createdAt: sample.createdAt,
        generation: sample.generation,
        pieceId: `piece-a-${index}`,
        target: [1, 0, 0],
      },
      {
        createdAt: sample.createdAt,
        generation: sample.generation,
        pieceId: `piece-b-${index}`,
        target: [0, 1, 0],
      },
    ]));

    const persisted = runtime.compactRunForPersistence({
      id: 'run-test',
      label: 'Run Test',
      createdAt: '2026-03-12T21:00:00.000Z',
      updatedAt: '2026-03-12T21:15:00.000Z',
      status: 'running',
      config: { replayBufferMaxPositions: 10000 },
      replayBuffer: {
        maxPositions: 10000,
        totalPositionsSeen: 1500,
        evictedPositions: 0,
        policySamples,
        valueSamples,
        identitySamples,
      },
      generations: [],
      retainedGames: [],
      metricsHistory: [],
      evaluationHistory: [],
      working: {},
      stats: {},
    });

    expect(persisted.replayBuffer.policySamples).toHaveLength(1024);
    expect(persisted.replayBuffer.valueSamples).toHaveLength(1024);
    expect(persisted.replayBuffer.identitySamples.length).toBeLessThanOrEqual(8192);
    expect(persisted.replayBuffer.policySamples[0].createdAt).toBe(policySamples[476].createdAt);
    expect(persisted.replayBuffer.valueSamples[0].createdAt).toBe(valueSamples[476].createdAt);
    expect(
      persisted.replayBuffer.identitySamples.every((sample) => sample.createdAt >= policySamples[476].createdAt),
    ).toBe(true);
  });

  test('drops replay samples entirely for terminal runs', () => {
    const persisted = runtime.compactRunForPersistence({
      id: 'run-complete',
      label: 'Run Complete',
      createdAt: '2026-03-12T21:00:00.000Z',
      updatedAt: '2026-03-12T21:20:00.000Z',
      status: 'completed',
      config: { replayBufferMaxPositions: 64 },
      replayBuffer: {
        maxPositions: 64,
        totalPositionsSeen: 64,
        evictedPositions: 0,
        policySamples: [buildReplaySample(0)],
        valueSamples: [{ createdAt: '2026-03-12T21:00:00.000Z', generation: 0, input: [0], target: 0.5 }],
        identitySamples: [{ createdAt: '2026-03-12T21:00:00.000Z', generation: 0, pieceId: 'piece-0', target: [1] }],
      },
      generations: [],
      retainedGames: [],
      metricsHistory: [],
      evaluationHistory: [],
      working: {},
      stats: {},
    });

    expect(persisted.replayBuffer.policySamples).toEqual([]);
    expect(persisted.replayBuffer.valueSamples).toEqual([]);
    expect(persisted.replayBuffer.identitySamples).toEqual([]);
  });

  test('keeps stopped runs resumable across persistence reloads', async () => {
    runtime.dispose();
    runtime = createPersistedRuntime();
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-stopped-persisted',
      label: 'Stopped Persisted Run',
    });
    run.status = 'stopped';
    run.stopReason = 'manual_stop';
    run.updatedAt = '2026-03-12T21:25:00.000Z';
    run.replayBuffer.policySamples = Array.from({ length: 12 }, (_, index) => buildReplaySample(index));
    run.replayBuffer.valueSamples = run.replayBuffer.policySamples.map((sample, index) => ({
      createdAt: sample.createdAt,
      generation: sample.generation,
      input: [index],
      target: index / 12,
    }));
    run.replayBuffer.identitySamples = [{
      createdAt: run.replayBuffer.policySamples[0].createdAt,
      generation: 0,
      pieceId: 'piece-stopped',
      target: [1, 0],
    }];
    runtime.state.runs = [run];

    await runtime.save();

    runtime.dispose();
    runtime = new MlRuntime({
      dataFilePath: path.join(tempDir, 'runtime.json'),
      persist: true,
      useMongoSimulations: false,
      useMongoRuns: false,
    });
    await runtime.ensureLoaded();

    const reloadedRun = runtime.getRunById('run-stopped-persisted');
    expect(reloadedRun).toBeTruthy();
    expect(reloadedRun.status).toBe('stopped');
    expect(reloadedRun.working.modelBundle).toBeTruthy();
    expect(reloadedRun.working.optimizerState).toBeTruthy();
    expect(reloadedRun.replayBuffer.policySamples).toHaveLength(12);
    expect(runtime.canContinueRun(reloadedRun)).toBe(true);
  });

  test('legacy stopped runs remain continuable from the best promoted generation after reload', async () => {
    runtime.dispose();
    runtime = createPersistedRuntime();
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-stopped-legacy',
      label: 'Stopped Legacy Run',
    });
    run.generations.push(runtime.createRunGenerationRecord(run, {
      generation: 1,
      label: 'G1',
      source: 'promoted',
      approved: true,
      isBest: true,
      promotedAt: '2026-03-12T21:20:00.000Z',
      modelBundle: createDefaultModelBundle({ seed: 606 }),
    }));
    runtime.markRunBestGeneration(run, 1);
    run.workerGeneration = 1;
    run.status = 'stopped';
    run.stopReason = 'manual_stop';
    run.updatedAt = '2026-03-12T21:25:00.000Z';
    run.working.baseGeneration = 1;
    run.working.modelBundle = null;
    run.working.optimizerState = null;
    runtime.state.runs = [run];

    await runtime.save();

    runtime.dispose();
    runtime = new MlRuntime({
      dataFilePath: path.join(tempDir, 'runtime.json'),
      persist: true,
      useMongoSimulations: false,
      useMongoRuns: false,
    });
    await runtime.ensureLoaded();

    const reloadedRun = runtime.getRunById('run-stopped-legacy');
    expect(reloadedRun).toBeTruthy();
    expect(reloadedRun.status).toBe('stopped');
    expect(reloadedRun.working.modelBundle).toBeNull();
    expect(runtime.canContinueRun(reloadedRun)).toBe(true);

    const pipelineSpy = jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});
    const continued = await runtime.continueRun(reloadedRun.id);
    expect(continued.continued).toBe(true);
    expect(runtime.getRunById(reloadedRun.id).working.modelBundle).toEqual(reloadedRun.generations[1].modelBundle);
    expect(runtime.getRunById(reloadedRun.id).working.optimizerState).toBeTruthy();
    expect(pipelineSpy).toHaveBeenCalledTimes(1);
  });

  test('persists runs into per-run manifest and checkpoint files and reloads them', async () => {
    runtime.dispose();
    runtime = createPersistedRuntime();
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-fs-test',
      label: 'Filesystem Run',
    });
    run.updatedAt = '2026-03-12T21:30:00.000Z';
    run.replayBuffer.policySamples = Array.from({ length: 12 }, (_, index) => buildReplaySample(index));
    run.replayBuffer.valueSamples = run.replayBuffer.policySamples.map((sample, index) => ({
      createdAt: sample.createdAt,
      generation: sample.generation,
      input: [index],
      target: index / 12,
    }));
    run.replayBuffer.identitySamples = run.replayBuffer.policySamples.flatMap((sample, index) => ([
      {
        createdAt: sample.createdAt,
        generation: sample.generation,
        pieceId: `piece-a-${index}`,
        target: [1, 0],
      },
      {
        createdAt: sample.createdAt,
        generation: sample.generation,
        pieceId: `piece-b-${index}`,
        target: [0, 1],
      },
    ]));
    run.retainedGames = [{
      id: 'game-eval-1',
      createdAt: '2026-03-12T21:29:00.000Z',
      phase: 'evaluation',
      whiteGeneration: 1,
      blackGeneration: 0,
      whiteParticipantLabel: 'G1',
      blackParticipantLabel: 'G0',
      winner: 0,
      winReason: 'CHECKMATE',
      plies: 18,
      actionHistory: [],
      moveHistory: [],
      replay: [{
        ply: 18,
        toMove: 1,
        winner: 0,
        board: [],
        stashes: [[], []],
        onDecks: [null, null],
        daggers: [0, 0],
        captured: [[], []],
      }],
      result: { winner: 0 },
    }];
    runtime.state.runs = [run];

    await runtime.save();

    const persistedState = JSON.parse(fs.readFileSync(runtime.dataFilePath, 'utf8'));
    expect(Array.isArray(persistedState.runs)).toBe(true);
    expect(persistedState.runs).toHaveLength(1);
    expect(persistedState.runs[0].manifestPath).toBeTruthy();
    expect(persistedState.runs[0].latestCheckpointPath).toBeTruthy();
    expect(persistedState.runs[0].config).toBeUndefined();

    const manifestPath = path.join(tempDir, persistedState.runs[0].manifestPath);
    const checkpointPath = path.join(tempDir, persistedState.runs[0].latestCheckpointPath);
    expect(fs.existsSync(manifestPath)).toBe(true);
    expect(fs.existsSync(checkpointPath)).toBe(true);

    runtime.dispose();
    runtime = new MlRuntime({
      dataFilePath: path.join(tempDir, 'runtime.json'),
      persist: true,
      useMongoSimulations: false,
      useMongoRuns: false,
    });
    await runtime.ensureLoaded();

    const reloadedRun = runtime.getRunById('run-fs-test');
    expect(reloadedRun).toBeTruthy();
    expect(reloadedRun.retainedGames).toHaveLength(1);
    expect(reloadedRun.replayBuffer.policySamples).toHaveLength(12);
    expect(reloadedRun.working.modelBundle).toBeTruthy();
    expect(runtime.listRunReplayGameSummaries(reloadedRun, null, null)).toHaveLength(1);
  });

  test('persists only run metadata to Mongo', async () => {
    runtime.dispose();
    runtime = createPersistedRuntime();
    runtime.useMongoRuns = true;
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-mongo-test',
      label: 'Mongo Metadata Run',
    });
    run.updatedAt = '2026-03-12T22:00:00.000Z';
    run.replayBuffer.policySamples = Array.from({ length: 4 }, (_, index) => buildReplaySample(index));
    run.replayBuffer.valueSamples = run.replayBuffer.policySamples.map((sample, index) => ({
      createdAt: sample.createdAt,
      generation: sample.generation,
      input: [index],
      target: 0.5,
    }));
    run.replayBuffer.identitySamples = [{
      createdAt: run.replayBuffer.policySamples[0].createdAt,
      generation: 0,
      pieceId: 'piece-0',
      target: [1, 0],
    }];
    runtime.state.runs = [run];

    const runUpdateSpy = jest.spyOn(MlRunModel, 'updateOne').mockResolvedValue({ acknowledged: true });
    const checkpointUpdateSpy = jest.spyOn(MlRunCheckpointModel, 'updateOne').mockResolvedValue({ acknowledged: true });
    const checkpointDeleteSpy = jest.spyOn(MlRunCheckpointModel, 'deleteMany').mockResolvedValue({ acknowledged: true });
    jest.spyOn(runtime, 'isMongoRunPersistenceAvailable').mockReturnValue(true);

    await runtime.save();

    expect(runUpdateSpy).toHaveBeenCalled();
    expect(checkpointUpdateSpy).toHaveBeenCalled();
    expect(checkpointDeleteSpy).toHaveBeenCalled();

    const runUpdate = runUpdateSpy.mock.calls[0][1].$set;
    const checkpointUpdate = checkpointUpdateSpy.mock.calls[0][1].$set;
    expect(runUpdate.persistence.latestCheckpointPath).toBeTruthy();
    expect(runUpdate.working).toBeUndefined();
    expect(checkpointUpdate.paths.checkpoint).toBeTruthy();
    expect(checkpointUpdate.replayBuffer.positions).toBeGreaterThanOrEqual(0);
  });

  test('replays the latest journaled run state on restart between checkpoints', async () => {
    runtime.dispose();
    runtime = createPersistedRuntime();
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-journal-test',
      label: 'Journal Run',
    });
    runtime.state.runs = [run];
    await runtime.save();

    run.updatedAt = '2026-03-12T22:10:00.000Z';
    run.stats.totalTrainingSteps = 7;
    run.stats.totalSelfPlayGames = 3;
    run.working.lastLoss = {
      step: 7,
      policyLoss: 0.12,
      valueLoss: 0.09,
      identityLoss: 0.04,
    };
    run.replayBuffer.policySamples = Array.from({ length: 5 }, (_, index) => buildReplaySample(index));
    run.replayBuffer.valueSamples = run.replayBuffer.policySamples.map((sample, index) => ({
      createdAt: sample.createdAt,
      generation: sample.generation,
      input: [index],
      target: 0.25,
    }));
    run.replayBuffer.identitySamples = [{
      createdAt: run.replayBuffer.policySamples[0].createdAt,
      generation: 0,
      pieceId: 'piece-journal',
      target: [1, 0],
    }];
    run.retainedGames = [{
      id: 'game-journal-1',
      createdAt: '2026-03-12T22:09:00.000Z',
      phase: 'evaluation',
      whiteGeneration: 1,
      blackGeneration: 0,
      whiteParticipantLabel: 'G1',
      blackParticipantLabel: 'G0',
      winner: 0,
      winReason: 'CHECKMATE',
      plies: 21,
      actionHistory: [],
      moveHistory: [],
      replay: [],
      result: { winner: 0 },
    }];
    await runtime.appendRunJournalSnapshot(run, 'training_step', {
      includeReplayBuffer: true,
      includeRetainedGames: true,
      includeWorkingState: true,
    });

    runtime.dispose();
    runtime = new MlRuntime({
      dataFilePath: path.join(tempDir, 'runtime.json'),
      persist: true,
      useMongoSimulations: false,
      useMongoRuns: false,
    });
    await runtime.ensureLoaded();

    const resumedRun = runtime.getRunById('run-journal-test');
    expect(resumedRun).toBeTruthy();
    expect(resumedRun.updatedAt).toBe('2026-03-12T22:10:00.000Z');
    expect(resumedRun.stats.totalTrainingSteps).toBe(7);
    expect(resumedRun.stats.totalSelfPlayGames).toBe(3);
    expect(resumedRun.replayBuffer.policySamples).toHaveLength(5);
    expect(resumedRun.retainedGames).toHaveLength(1);
    expect(resumedRun.working.lastLoss.step).toBe(7);
  });
});
