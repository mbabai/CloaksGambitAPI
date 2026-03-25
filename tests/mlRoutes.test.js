const express = require('express');
const request = require('supertest');

const mockRuntime = {
  getWorkbench: jest.fn(),
  getPromotedBotCatalog: jest.fn(),
  updatePromotedBotCatalog: jest.fn(),
  listRuns: jest.fn(),
  getRun: jest.fn(),
  startRun: jest.fn(),
  renameRunGeneration: jest.fn(),
  stopRun: jest.fn(),
  killRun: jest.fn(),
  continueRun: jest.fn(),
  deleteRun: jest.fn(),
  listRunGames: jest.fn(),
  getRunReplayGameCatalog: jest.fn(),
  getRunReplay: jest.fn(),
  getLiveStatus: jest.fn(),
  trainSnapshot: jest.fn(),
  startTrainingJob: jest.fn(),
  startTestGame: jest.fn(),
};

const mockAdminErrorFeed = {
  getRecentServerErrors: jest.fn(),
  reportServerError: jest.fn(),
};

jest.mock('../src/utils/adminAccess', () => ({
  ensureAdminRequest: jest.fn(async () => ({ userId: 'admin-user' })),
}));

jest.mock('../src/services/ml/runtime', () => ({
  getMlRuntime: jest.fn(() => mockRuntime),
}));

jest.mock('../src/services/adminErrorFeed', () => mockAdminErrorFeed);

const { ensureAdminRequest } = require('../src/utils/adminAccess');
const mlRouter = require('../src/routes/v1/ml');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/ml', mlRouter);
  return app;
}

describe('ml routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ensureAdminRequest.mockResolvedValue({ userId: 'admin-user' });
    mockAdminErrorFeed.getRecentServerErrors.mockReturnValue([
      {
        id: 'server-error-1',
        source: 'guestCleanup',
        level: 'warn',
        message: 'Guest cleanup skipped because MongoDB is not connected.',
      },
    ]);
    mockRuntime.getWorkbench.mockResolvedValue({
      summary: {
        counts: {
          runs: 2,
          activeRuns: 1,
          completedRuns: 1,
          games: 18,
          generations: 5,
        },
      },
      defaults: {
        maxLogicalProcessors: 12,
        numSelfplayWorkers: 32,
        parallelGameWorkers: 16,
        batchSize: 256,
        trainingBackend: 'auto',
        trainingDevicePreference: 'auto',
      },
      seedSources: {
        defaultValue: 'bootstrap',
        items: [
          { id: 'bootstrap', value: 'bootstrap', type: 'bootstrap', label: 'Bootstrap Model' },
          { id: 'random', value: 'random', type: 'random', label: 'Random Init' },
          { id: 'generation:run-1:0', value: 'generation:run-1:0', type: 'promoted_generation', label: 'Run 1 | G0' },
        ],
      },
      runs: {
        items: [{ id: 'run-1', label: 'Run 1', status: 'running' }],
      },
      promotedBots: {
        items: [{ id: 'generation:run-1:0', label: 'Run 1 G0', enabled: true }],
        enabledIds: ['generation:run-1:0'],
        total: 1,
        enabledCount: 1,
      },
      serverErrors: {
        items: [
          {
            id: 'server-error-1',
            source: 'guestCleanup',
            level: 'warn',
            message: 'Guest cleanup skipped because MongoDB is not connected.',
          },
        ],
      },
      live: {
        resourceTelemetry: {
          cpu: { available: true, currentPercent: 18.5, updatedAt: '2026-03-13T06:00:00.000Z', history: [] },
          gpu: { available: false, currentPercent: null, updatedAt: '2026-03-13T06:00:00.000Z', history: [], label: null, source: 'nvidia-smi' },
          sampleIntervalMs: 2000,
          windowMs: 600000,
        },
        runs: [{ runId: 'run-1', phase: 'selfplay', status: 'running' }],
      },
    });
    mockRuntime.getPromotedBotCatalog.mockResolvedValue({
      items: [{ id: 'generation:run-1:0', label: 'Run 1 G0', enabled: true }],
      enabledIds: ['generation:run-1:0'],
      total: 1,
      enabledCount: 1,
    });
    mockRuntime.updatePromotedBotCatalog.mockResolvedValue({
      items: [{ id: 'generation:run-1:0', label: 'Run 1 G0', enabled: false }],
      enabledIds: [],
      total: 1,
      enabledCount: 0,
    });
    mockRuntime.listRuns.mockResolvedValue([
      { id: 'run-1', label: 'Run 1', status: 'running' },
    ]);
    mockRuntime.getRun.mockResolvedValue({
      id: 'run-1',
      label: 'Run 1',
      status: 'running',
      generations: [{ generation: 0, label: 'G0' }],
      evaluationSeries: [],
      generationPairs: [],
    });
    mockRuntime.startRun.mockResolvedValue({
      run: { id: 'run-2', label: 'Run 2', status: 'running' },
      live: { runId: 'run-2', phase: 'start', status: 'running' },
    });
    mockRuntime.stopRun.mockResolvedValue({
      stopped: true,
      run: { id: 'run-1', label: 'Run 1', status: 'stopping' },
    });
    mockRuntime.getRunReplayGameCatalog.mockResolvedValue({
      items: [{ id: 'page-1', whiteGeneration: 1, blackGeneration: 1 }],
      pageInfo: {
        limit: 100,
        beforeId: '',
        nextBeforeId: 'page-1',
        hasMore: true,
        matchingCount: 14,
        totalAvailableCount: 28,
      },
      filters: {
        generationOptions: [0, 1, 2],
        boardPiecesOptions: [],
        advanceDepthOptions: [],
      },
    });
    mockRuntime.killRun.mockResolvedValue({
      killed: true,
      run: { id: 'run-1', label: 'Run 1', status: 'stopped', stopReason: 'manual_kill' },
    });
    mockRuntime.renameRunGeneration.mockResolvedValue({
      id: 'run-1:g1',
      runId: 'run-1',
      generation: 1,
      label: 'Aggro Seed',
      updatedAt: '2026-03-13T06:05:00.000Z',
    });
    mockRuntime.continueRun.mockResolvedValue({
      continued: true,
      run: { id: 'run-1', label: 'Run 1', status: 'running' },
      live: { runId: 'run-1', phase: 'continue', status: 'running' },
    });
    mockRuntime.deleteRun.mockResolvedValue({
      deleted: true,
      id: 'run-1',
    });
    mockRuntime.listRunGames.mockResolvedValue([
      { id: 'game-1', whiteGeneration: 0, blackGeneration: 1 },
    ]);
    mockRuntime.getRunReplay.mockResolvedValue({
      run: { id: 'run-1', label: 'Run 1' },
      game: { id: 'game-1', replay: [{ ply: 0 }, { ply: 1 }] },
    });
    mockRuntime.getLiveStatus.mockResolvedValue({
      resourceTelemetry: {
        cpu: { available: true, currentPercent: 22.1, updatedAt: '2026-03-13T06:00:02.000Z', history: [] },
        gpu: { available: true, currentPercent: 47.3, updatedAt: '2026-03-13T06:00:02.000Z', history: [], label: 'GPU', source: 'nvidia-smi' },
        sampleIntervalMs: 2000,
        windowMs: 600000,
      },
      runs: [{ runId: 'run-1', phase: 'training', status: 'running' }],
      simulation: null,
      training: null,
    });
    mockRuntime.trainSnapshot.mockResolvedValue({
      trainingRun: { id: 'training-1', status: 'completed' },
      snapshot: { id: 'snapshot-2', label: 'Trained Snapshot' },
      lossHistory: [{ epoch: 1, policyLoss: 0.4, trainingBackend: 'python', trainingDevice: 'cpu' }],
      sampleCounts: { policy: 12, value: 12, identity: 12 },
    });
    mockRuntime.startTrainingJob.mockResolvedValue({
      taskId: 'training:training-2',
      trainingRun: { id: 'training-2', status: 'running' },
      live: { trainingRunId: 'training-2', phase: 'start', trainingBackend: 'python', trainingDevicePreference: 'cuda' },
    });
    mockRuntime.startTestGame.mockResolvedValue({
      matchId: 'match-9',
      gameId: 'game-9',
      runId: 'run-1',
      generation: 0,
      generationLabel: 'G0',
      botUserId: 'bot-1',
      botUsername: 'ML0001G0',
      userColor: 0,
      launchUrl: '/',
    });
  });

  test('GET /workbench returns the aggregated run payload', async () => {
    const response = await request(createApp()).get('/api/v1/ml/workbench');

    expect(response.status).toBe(200);
    expect(ensureAdminRequest).toHaveBeenCalledTimes(1);
    expect(mockRuntime.getWorkbench).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({
      summary: {
        counts: {
          runs: 2,
          activeRuns: 1,
          completedRuns: 1,
          games: 18,
          generations: 5,
        },
      },
      defaults: {
        maxLogicalProcessors: 12,
        numSelfplayWorkers: 32,
        parallelGameWorkers: 16,
        batchSize: 256,
        trainingBackend: 'auto',
        trainingDevicePreference: 'auto',
      },
      seedSources: {
        defaultValue: 'bootstrap',
        items: [
          { id: 'bootstrap', value: 'bootstrap', type: 'bootstrap', label: 'Bootstrap Model' },
          { id: 'random', value: 'random', type: 'random', label: 'Random Init' },
          { id: 'generation:run-1:0', value: 'generation:run-1:0', type: 'promoted_generation', label: 'Run 1 | G0' },
        ],
      },
      runs: {
        items: [{ id: 'run-1', label: 'Run 1', status: 'running' }],
      },
      promotedBots: {
        items: [{ id: 'generation:run-1:0', label: 'Run 1 G0', enabled: true }],
        enabledIds: ['generation:run-1:0'],
        total: 1,
        enabledCount: 1,
      },
      serverErrors: {
        items: [
          {
            id: 'server-error-1',
            source: 'guestCleanup',
            level: 'warn',
            message: 'Guest cleanup skipped because MongoDB is not connected.',
          },
        ],
      },
      live: {
        resourceTelemetry: {
          cpu: { available: true, currentPercent: 18.5, updatedAt: '2026-03-13T06:00:00.000Z', history: [] },
          gpu: { available: false, currentPercent: null, updatedAt: '2026-03-13T06:00:00.000Z', history: [], label: null, source: 'nvidia-smi' },
          sampleIntervalMs: 2000,
          windowMs: 600000,
        },
        runs: [{ runId: 'run-1', phase: 'selfplay', status: 'running' }],
      },
    });
  });

  test('GET /workbench reports backend failures through the admin error feed', async () => {
    const err = new Error('Failed to load ML workbench');
    err.code = 'workbench_failed';
    err.details = { readyState: 0 };
    mockRuntime.getWorkbench.mockRejectedValueOnce(err);

    const response = await request(createApp()).get('/api/v1/ml/workbench');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      message: 'Failed to load ML workbench',
      code: 'workbench_failed',
      details: { readyState: 0 },
    });
    expect(mockAdminErrorFeed.reportServerError).toHaveBeenCalledWith(expect.objectContaining({
      source: 'mlRoute:workbench',
      code: 'workbench_failed',
      status: 500,
      message: 'Failed to load ML workbench',
    }));
  });

  test('GET and PUT /promoted-bots expose the admin bot catalog', async () => {
    const getResponse = await request(createApp()).get('/api/v1/ml/promoted-bots');
    expect(getResponse.status).toBe(200);
    expect(mockRuntime.getPromotedBotCatalog).toHaveBeenCalledTimes(1);
    expect(getResponse.body.enabledIds).toEqual(['generation:run-1:0']);

    const putResponse = await request(createApp())
      .put('/api/v1/ml/promoted-bots')
      .send({ enabledIds: [] });
    expect(putResponse.status).toBe(200);
    expect(mockRuntime.updatePromotedBotCatalog).toHaveBeenCalledWith([]);
    expect(putResponse.body.enabledCount).toBe(0);
  });

  test('POST /runs starts a continuous ML run', async () => {
    const response = await request(createApp())
      .post('/api/v1/ml/runs')
      .send({ label: 'Run 2', batchSize: 16 });

    expect(response.status).toBe(200);
    expect(mockRuntime.startRun).toHaveBeenCalledWith({ label: 'Run 2', batchSize: 16 });
    expect(response.body).toEqual({
      run: { id: 'run-2', label: 'Run 2', status: 'running' },
      live: { runId: 'run-2', phase: 'start', status: 'running' },
    });
  });

  test('POST /runs surfaces active-run conflicts', async () => {
    const err = new Error('Another ML run is already active');
    err.statusCode = 409;
    err.code = 'active_run_conflict';
    err.activeRuns = [{ id: 'run-1', label: 'Run 1', status: 'running' }];
    mockRuntime.startRun.mockRejectedValueOnce(err);

    const response = await request(createApp())
      .post('/api/v1/ml/runs')
      .send({ label: 'Run 2' });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({
      message: 'Another ML run is already active',
      code: 'active_run_conflict',
      activeRuns: [{ id: 'run-1', label: 'Run 1', status: 'running' }],
    });
  });

  test('PATCH /runs/:runId/generations/:generation renames a promoted generation', async () => {
    const response = await request(createApp())
      .patch('/api/v1/ml/runs/run-1/generations/1')
      .send({ label: 'Aggro Seed' });

    expect(response.status).toBe(200);
    expect(mockRuntime.renameRunGeneration).toHaveBeenCalledWith('run-1', 1, 'Aggro Seed');
    expect(response.body).toEqual({
      generation: {
        id: 'run-1:g1',
        runId: 'run-1',
        generation: 1,
        label: 'Aggro Seed',
        updatedAt: '2026-03-13T06:05:00.000Z',
      },
    });
  });

  test('GET /runs/:runId and replay endpoints return run-specific data', async () => {
    const detail = await request(createApp()).get('/api/v1/ml/runs/run-1');
    expect(detail.status).toBe(200);
    expect(mockRuntime.getRun).toHaveBeenCalledWith('run-1');

    const allGames = await request(createApp()).get('/api/v1/ml/runs/run-1/games');
    expect(allGames.status).toBe(200);
    expect(mockRuntime.listRunGames).toHaveBeenCalledWith('run-1', null, null, { replayType: 'evaluation' });

    const games = await request(createApp())
      .get('/api/v1/ml/runs/run-1/games')
      .query({ generationA: 0, generationB: 1 });
    expect(games.status).toBe(200);
    expect(mockRuntime.listRunGames).toHaveBeenCalledWith('run-1', 0, 1, { replayType: 'evaluation' });
    expect(games.body).toEqual({
      items: [{ id: 'game-1', whiteGeneration: 0, blackGeneration: 1 }],
    });

    const simulationGames = await request(createApp())
      .get('/api/v1/ml/runs/run-1/games')
      .query({ replayType: 'simulation' });
    expect(simulationGames.status).toBe(200);
    expect(mockRuntime.listRunGames).toHaveBeenCalledWith('run-1', null, null, { replayType: 'simulation' });

    const replay = await request(createApp()).get('/api/v1/ml/runs/run-1/replay/game-1');
    expect(replay.status).toBe(200);
    expect(mockRuntime.getRunReplay).toHaveBeenCalledWith('run-1', 'game-1');
    expect(replay.body.game.replay).toHaveLength(2);
  });

  test('GET /runs/:runId/games supports paged replay catalogs for the replay workbench', async () => {
    const response = await request(createApp())
      .get('/api/v1/ml/runs/run-1/games')
      .query({
        replayType: 'evaluation',
        limit: 100,
        generation: 1,
        beforeId: 'game-older',
      });

    expect(response.status).toBe(200);
    expect(mockRuntime.getRunReplayGameCatalog).toHaveBeenCalledWith('run-1', {
      replayType: 'evaluation',
      limit: '100',
      beforeId: 'game-older',
      generation: 1,
      generationA: null,
      generationB: null,
      boardPieces: null,
      advanceDepth: null,
    });
    expect(response.body.pageInfo).toMatchObject({
      limit: 100,
      hasMore: true,
      matchingCount: 14,
    });
    expect(response.body.filters.generationOptions).toEqual([0, 1, 2]);
  });

  test('GET /runs/:runId/games returns 404 when a paged replay catalog run is missing', async () => {
    mockRuntime.getRunReplayGameCatalog.mockResolvedValueOnce(null);

    const response = await request(createApp())
      .get('/api/v1/ml/runs/missing-run/games')
      .query({
        replayType: 'simulation',
        limit: 100,
      });

    expect(response.status).toBe(404);
    expect(mockRuntime.getRunReplayGameCatalog).toHaveBeenCalledWith('missing-run', {
      replayType: 'simulation',
      limit: '100',
      beforeId: '',
      generation: null,
      generationA: null,
      generationB: null,
      boardPieces: null,
      advanceDepth: null,
    });
    expect(response.body).toEqual({ message: 'Run not found' });
  });

  test('POST /runs/:runId/stop and GET /live surface run state', async () => {
    const stopResponse = await request(createApp()).post('/api/v1/ml/runs/run-1/stop');
    expect(stopResponse.status).toBe(200);
    expect(mockRuntime.stopRun).toHaveBeenCalledWith('run-1');
    expect(stopResponse.body.stopped).toBe(true);

    const liveResponse = await request(createApp()).get('/api/v1/ml/live');
    expect(liveResponse.status).toBe(200);
    expect(mockRuntime.getLiveStatus).toHaveBeenCalledTimes(1);
    expect(liveResponse.body.resourceTelemetry).toEqual({
      cpu: { available: true, currentPercent: 22.1, updatedAt: '2026-03-13T06:00:02.000Z', history: [] },
      gpu: { available: true, currentPercent: 47.3, updatedAt: '2026-03-13T06:00:02.000Z', history: [], label: 'GPU', source: 'nvidia-smi' },
      sampleIntervalMs: 2000,
      windowMs: 600000,
    });
    expect(liveResponse.body.runs).toEqual([
      { runId: 'run-1', phase: 'training', status: 'running' },
    ]);
    expect(liveResponse.body.serverErrors).toEqual({
      items: [
        {
          id: 'server-error-1',
          source: 'guestCleanup',
          level: 'warn',
          message: 'Guest cleanup skipped because MongoDB is not connected.',
        },
      ],
    });
  });

  test('POST /runs/:runId/continue resumes a stopped run', async () => {
    const response = await request(createApp())
      .post('/api/v1/ml/runs/run-1/continue')
      .send({ forceStopOtherRuns: true });

    expect(response.status).toBe(200);
    expect(mockRuntime.continueRun).toHaveBeenCalledWith('run-1', { forceStopOtherRuns: true });
    expect(response.body).toEqual({
      continued: true,
      run: { id: 'run-1', label: 'Run 1', status: 'running' },
      live: { runId: 'run-1', phase: 'continue', status: 'running' },
    });
  });

  test('POST /runs/:runId/kill force-stops a run immediately', async () => {
    const response = await request(createApp()).post('/api/v1/ml/runs/run-1/kill');

    expect(response.status).toBe(200);
    expect(mockRuntime.killRun).toHaveBeenCalledWith('run-1');
    expect(response.body).toEqual({
      killed: true,
      run: { id: 'run-1', label: 'Run 1', status: 'stopped', stopReason: 'manual_kill' },
    });
  });

  test('DELETE /runs/:runId removes terminal runs and blocks active ones', async () => {
    const deletedResponse = await request(createApp()).delete('/api/v1/ml/runs/run-1');
    expect(deletedResponse.status).toBe(200);
    expect(mockRuntime.deleteRun).toHaveBeenCalledWith('run-1');
    expect(deletedResponse.body).toEqual({
      deleted: true,
      id: 'run-1',
    });

    mockRuntime.deleteRun.mockResolvedValueOnce({
      deleted: false,
      reason: 'run_active',
      run: { id: 'run-2', status: 'running' },
    });

    const conflictResponse = await request(createApp()).delete('/api/v1/ml/runs/run-2');
    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body).toEqual({
      message: 'Cancel the run before deleting it',
    });
  });

  test('training routes forward backend and device preferences', async () => {
    const runResponse = await request(createApp())
      .post('/api/v1/ml/training/run')
      .send({
        snapshotId: 'snapshot-1',
        simulationIds: ['sim-1', '', null, 'sim-2'],
        epochs: 2,
        batchSize: 96,
        learningRate: 0.005,
        trainingBackend: 'python',
        trainingDevicePreference: 'cpu',
      });

    expect(runResponse.status).toBe(200);
    expect(mockRuntime.trainSnapshot).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      simulationIds: ['sim-1', 'sim-2'],
      epochs: 2,
      batchSize: 96,
      learningRate: 0.005,
      trainingBackend: 'python',
      trainingDevicePreference: 'cpu',
      notes: '',
    });

    const startResponse = await request(createApp())
      .post('/api/v1/ml/training/start')
      .send({
        snapshotId: 'snapshot-1',
        simulationIds: ['sim-3'],
        epochs: 3,
        batchSize: 192,
        learningRate: 0.002,
        trainingBackend: 'python',
        trainingDevicePreference: 'cuda',
      });

    expect(startResponse.status).toBe(200);
    expect(mockRuntime.startTrainingJob).toHaveBeenCalledWith({
      snapshotId: 'snapshot-1',
      simulationIds: ['sim-3'],
      epochs: 3,
      batchSize: 192,
      learningRate: 0.002,
      trainingBackend: 'python',
      trainingDevicePreference: 'cuda',
      notes: '',
    });
    expect(startResponse.body.live.trainingBackend).toBe('python');
    expect(startResponse.body.live.trainingDevicePreference).toBe('cuda');
  });

  test('POST /test-games launches a live game against a chosen generation', async () => {
    ensureAdminRequest.mockResolvedValueOnce({
      userId: 'admin-user',
      username: 'Admin',
      user: { username: 'Admin' },
    });

    const response = await request(createApp())
      .post('/api/v1/ml/test-games')
      .send({
        runId: 'run-1',
        generation: 0,
        sidePreference: 'black',
      });

    expect(response.status).toBe(200);
    expect(mockRuntime.startTestGame).toHaveBeenCalledWith({
      runId: 'run-1',
      generation: 0,
      sidePreference: 'black',
      userId: 'admin-user',
      username: 'Admin',
    });
    expect(response.body.gameId).toBe('game-9');
    expect(response.body.launchUrl).toBe('/');
  });
});
