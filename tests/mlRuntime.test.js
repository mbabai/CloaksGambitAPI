const fs = require('fs');
const os = require('os');
const path = require('path');
const { MlRuntime } = require('../src/services/ml/runtime');
const { getPythonTrainingBridge } = require('../src/services/ml/pythonTrainingBridge');
const eventBus = require('../src/eventBus');
const getServerConfig = require('../src/utils/getServerConfig');
const setupRoute = require('../src/routes/v1/gameAction/setup');
const readyRoute = require('../src/routes/v1/gameAction/ready');
const {
  WHITE,
  BLACK,
  RANKS,
  IDENTITIES,
  IDENTITY_COUNTS,
  ACTIONS,
  MOVE_STATES,
  createInitialState,
  getLegalActions,
  applyAction,
  actionKey,
} = require('../src/services/ml/engine');
const {
  INFERRED_IDENTITIES,
  createDefaultModelBundle,
  createLegacyDefaultModelBundle,
  createOptimizerState,
  describeModelBundle,
  inferIdentityHypotheses,
  applyRiskBiasToHypotheses,
} = require('../src/services/ml/modeling');
const {
  getPolicySlotForAction,
  mapLegalActionsToPolicySlots,
} = require('../src/services/ml/sharedEncoderModel');
const { createSearchCache, runHiddenInfoMcts } = require('../src/services/ml/mcts');
const { runFastGame } = require('../src/services/ml/gameRunner');
const { BUILTIN_MEDIUM_ID, chooseBuiltinAction } = require('../src/services/ml/builtinBots');
const SimulationModel = require('../src/models/Simulation');
const SimulationGameModel = require('../src/models/SimulationGame');
const GameModel = require('../src/models/Game');
const { isMlWorkflowEnabled } = require('../src/utils/mlFeatureGate');

const describeMlWorkflow = isMlWorkflowEnabled() ? describe : describe.skip;
const DEFAULT_MODEL_DESCRIPTOR = describeModelBundle(createDefaultModelBundle({ seed: 1 }));

function extractPostHandler(router) {
  const layer = router.stack.find((entry) => (
    entry
    && entry.route
    && entry.route.path === '/'
    && entry.route.methods
    && entry.route.methods.post
    && Array.isArray(entry.route.stack)
    && entry.route.stack.length
  ));
  if (!layer) {
    throw new Error('POST handler not found on router');
  }
  return layer.route.stack[0].handle;
}

async function callRoutePostHandler(handler, body = {}, session = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    const req = {
      method: 'POST',
      url: '/',
      headers: {},
      body: JSON.parse(JSON.stringify(body)),
      query: {},
      params: {},
      __resolvedSession: session,
    };
    const res = {
      statusCode: 200,
      headersSent: false,
      cookie() {
        return this;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        if (this.statusCode >= 400) {
          const err = new Error(payload?.message || `Request failed (${this.statusCode})`);
          err.status = this.statusCode;
          err.payload = payload;
          finish(reject, err);
          return this;
        }
        finish(resolve, payload || {});
        return this;
      },
    };

    const next = (err) => {
      if (err) {
        finish(reject, err);
      } else {
        finish(resolve, {});
      }
    };

    Promise.resolve(handler(req, res, next))
      .then(() => {
        if (!res.headersSent) {
          finish(resolve, {});
        }
      })
      .catch((err) => {
        finish(reject, err);
      });
  });
}

function createInternalSession(userId, username, options = {}) {
  return {
    userId: String(userId),
    username,
    authenticated: false,
    isGuest: Boolean(options.isGuest),
    email: '',
    user: {
      _id: String(userId),
      username,
      isGuest: Boolean(options.isGuest),
      isBot: Boolean(options.isBot),
      botDifficulty: options.botDifficulty || null,
    },
  };
}

function getExpectedDefaultParallelGameWorkers() {
  const systemParallelism = (typeof os.availableParallelism === 'function')
    ? Math.max(1, Math.floor(os.availableParallelism()))
    : Math.max(1, Math.floor((Array.isArray(os.cpus()) ? os.cpus().length : 1) || 1));
  if (systemParallelism <= 2) return 1;
  if (systemParallelism <= 4) return Math.max(1, systemParallelism - 1);
  const headroom = Math.min(systemParallelism - 1, Math.max(2, Math.ceil(systemParallelism * 0.25)));
  return Math.max(1, systemParallelism - headroom);
}

function getExpectedDefaultNumSelfplayWorkers() {
  return Math.max(8, Math.min(128, getExpectedDefaultParallelGameWorkers() * 2));
}

async function buildDeterministicSetupFromGame(game, color) {
  const config = typeof getServerConfig.getServerConfigSnapshotSync === 'function'
    ? getServerConfig.getServerConfigSnapshotSync()
    : await getServerConfig();
  const ranks = Number(config?.boardDimensions?.RANKS) || 6;
  const files = Number(config?.boardDimensions?.FILES) || 5;
  const kingIdentity = config?.identities?.get
    ? config.identities.get('KING')
    : 1;
  const row = color === WHITE ? 0 : (ranks - 1);
  const stash = Array.isArray(game?.stashes?.[color]) ? game.stashes[color] : [];
  const candidates = stash
    .filter((piece) => Number.isFinite(piece?.identity))
    .map((piece) => ({
      color,
      identity: piece.identity,
    }));
  const kingPiece = candidates.find((piece) => piece.identity === kingIdentity) || null;
  const nonKingPieces = candidates.filter((piece) => piece.identity !== kingIdentity);
  if (!kingPiece || nonKingPieces.length < files) {
    throw new Error(`Insufficient stash pieces for test setup (color ${color})`);
  }

  return {
    pieces: [kingPiece, ...nonKingPieces.slice(0, files - 1)].map((piece, index) => ({
      row,
      col: index,
      color,
      identity: piece.identity,
    })),
    onDeck: {
      color,
      identity: nonKingPieces[files - 1].identity,
    },
  };
}

describeMlWorkflow('ML runtime', () => {
  let runtime;
  jest.setTimeout(60000);

  async function waitFor(condition, timeoutMs = 10000) {
    const started = Date.now();
    while (!(await Promise.resolve(condition()))) {
      if ((Date.now() - started) > timeoutMs) {
        throw new Error('Timed out waiting for condition');
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  beforeEach(() => {
    runtime = new MlRuntime({ persist: false });
  });

  afterEach(() => {
    const disposePromise = runtime?.dispose?.();
    jest.useRealTimers();
    jest.restoreAllMocks();
    return Promise.all([
      Promise.resolve(disposePromise),
      getPythonTrainingBridge().close().catch(() => {}),
    ]);
  });

  function createSmallRunConfig(overrides = {}) {
    return {
      label: 'test-run',
      maxLogicalProcessors: 4,
      numSelfplayWorkers: 1,
      parallelGameWorkers: 1,
      replayBufferMaxPositions: 32,
      batchSize: 4,
      trainingStepsPerCycle: 1,
      trainingBackend: 'node',
      trainingDevicePreference: 'auto',
      checkpointInterval: 1,
      evalGamesPerCheckpoint: 1,
      promotionWinrateThreshold: 0,
      prePromotionTestGames: 1,
      prePromotionTestWinRate: 0,
      promotionTestGames: 1,
      promotionTestWinRate: 0,
      promotionTestPriorGenerations: 1,
      stopOnMaxGenerations: true,
      maxGenerations: 1,
      stopOnMaxSelfPlayGames: true,
      maxSelfPlayGames: 3,
      stopOnMaxTrainingSteps: true,
      maxTrainingSteps: 6,
      stopOnMaxFailedPromotions: true,
      maxFailedPromotions: 6,
      curriculumCadence: 100,
      numMctsSimulationsPerMove: 4,
      maxDepth: 4,
      hypothesisCount: 2,
      ...overrides,
    };
  }

  function summarizeCurriculumState(state) {
    const boardCounts = { [WHITE]: 0, [BLACK]: 0 };
    const boardRelativeRanks = { [WHITE]: [], [BLACK]: [] };
    Object.values(state?.pieces || {}).forEach((piece) => {
      if (!piece || piece.zone !== 'board') return;
      boardCounts[piece.color] += 1;
      boardRelativeRanks[piece.color].push(
        piece.color === WHITE
          ? piece.row
          : (RANKS - 1 - piece.row),
      );
    });
    return {
      boardCounts,
      boardRelativeRanks,
      capturedCounts: {
        [WHITE]: Array.isArray(state?.captured?.[WHITE]) ? state.captured[WHITE].length : 0,
        [BLACK]: Array.isArray(state?.captured?.[BLACK]) ? state.captured[BLACK].length : 0,
      },
      daggers: Array.isArray(state?.daggers) ? state.daggers.slice() : [0, 0],
    };
  }

  function createPendingChallengeState(actualIdentity) {
    const state = createInitialState({ seed: 9013, maxPlies: 60 });
    state.board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
    state.stashes = [[], []];
    state.onDecks = [null, null];
    state.captured = [[], []];
    state.moves = [];
    state.actions = [];
    state.daggers = [0, 0];
    state.onDeckingPlayer = null;
    state.playerTurn = WHITE;
    state.toMove = WHITE;
    state.isActive = true;
    state.winner = null;
    state.winReason = null;
    state.ply = 1;
    state.movesSinceAction = 0;
    state.revealedIdentities = {};
    state.moveHistoryByPiece = Object.fromEntries(
      Object.keys(state.pieces).map((pieceId) => [pieceId, []]),
    );

    Object.values(state.pieces).forEach((piece) => {
      piece.alive = false;
      piece.zone = 'captured';
      piece.row = -1;
      piece.col = -1;
      piece.capturedBy = piece.color === WHITE ? BLACK : WHITE;
    });

    const whiteKing = Object.values(state.pieces).find(
      (piece) => piece.color === WHITE && piece.identity === IDENTITIES.KING,
    );
    const blackMover = Object.values(state.pieces).find(
      (piece) => piece.color === BLACK && piece.identity === IDENTITIES.ROOK,
    );
    const blackKing = Object.values(state.pieces).find(
      (piece) => piece.color === BLACK && piece.identity === IDENTITIES.KING,
    );

    blackMover.identity = actualIdentity;
    whiteKing.alive = true;
    whiteKing.zone = 'board';
    whiteKing.row = 2;
    whiteKing.col = 3;
    whiteKing.capturedBy = null;
    state.board[2][3] = whiteKing.id;

    blackMover.alive = true;
    blackMover.zone = 'board';
    blackMover.row = 5;
    blackMover.col = 0;
    blackMover.capturedBy = null;
    state.board[5][0] = blackMover.id;

    blackKing.alive = true;
    blackKing.zone = 'board';
    blackKing.row = 5;
    blackKing.col = 4;
    blackKing.capturedBy = null;
    state.board[5][4] = blackKing.id;

    state.moves = [{
      player: BLACK,
      pieceId: blackMover.id,
      from: { row: 5, col: 0 },
      to: { row: 2, col: 3 },
      declaration: IDENTITIES.BISHOP,
      state: MOVE_STATES.PENDING,
      timestamp: 0,
    }];
    state.actions = [{
      type: ACTIONS.MOVE,
      player: BLACK,
      timestamp: 0,
      details: {
        from: { row: 5, col: 0 },
        to: { row: 2, col: 3 },
        declaration: IDENTITIES.BISHOP,
      },
    }];
    state.moveHistoryByPiece[blackMover.id] = [{
      turnIndex: 0,
      from: { row: 5, col: 0 },
      to: { row: 2, col: 3 },
      dr: -3,
      dc: 3,
      declaration: IDENTITIES.BISHOP,
      capture: true,
      resolvedState: MOVE_STATES.PENDING,
    }];

    return state;
  }

  function createDiagnosticBoard(setupIndex = 0) {
    const board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
    board[0][setupIndex % 5] = { color: WHITE, identity: IDENTITIES.KING };
    board[0][(setupIndex + 1) % 5] = { color: WHITE, identity: IDENTITIES.ROOK };
    board[5][(setupIndex + 2) % 5] = { color: BLACK, identity: IDENTITIES.KING };
    board[5][(setupIndex + 3) % 5] = { color: BLACK, identity: IDENTITIES.BISHOP };
    return board;
  }

  function createDiagnosticAction(action, index = 0) {
    if (action?.type === 'MOVE') {
      return {
        type: 'MOVE',
        player: index % 2 === 0 ? WHITE : BLACK,
        from: { row: 0, col: index % 5 },
        to: { row: 1, col: (index + 1) % 5 },
        declaration: action.declaration ?? IDENTITIES.ROOK,
      };
    }
    if (action?.type === 'ON_DECK') {
      return {
        type: 'ON_DECK',
        player: action.player ?? WHITE,
        identity: action.identity ?? IDENTITIES.BISHOP,
      };
    }
    return {
      type: action?.type || 'CHALLENGE',
      player: action?.player ?? (index % 2 === 0 ? WHITE : BLACK),
    };
  }

  function createDiagnosticRetainedGame(options = {}) {
    const sequence = Array.isArray(options.sequence) ? options.sequence : [];
    const legalSummaries = Array.isArray(options.legalSummaries) ? options.legalSummaries : [];
    const board = createDiagnosticBoard(options.setupIndex || 0);
    const replay = [{
      board,
      onDecks: [
        { color: WHITE, identity: options.whiteOnDeckIdentity ?? IDENTITIES.BISHOP },
        { color: BLACK, identity: options.blackOnDeckIdentity ?? IDENTITIES.ROOK },
      ],
    }];
    sequence.forEach((entry, index) => {
      const action = createDiagnosticAction(entry, index);
      const legalSummary = {
        total: 1,
        move: 0,
        challenge: 0,
        bomb: 0,
        pass: 0,
        onDeck: 0,
        resign: 0,
        ...(legalSummaries[index] || {}),
      };
      replay.push({
        decision: {
          action,
          move: action,
          trace: {
            legalActionSummary: legalSummary,
            policyCoverage: {
              totalLegalActions: Number(legalSummary.total || 0),
              mappedPolicyActions: options.unmappedLegalActions
                ? Math.max(0, Number(legalSummary.total || 0) - Number(options.unmappedLegalActions || 0))
                : Number(legalSummary.total || 0),
              unmappedLegalActions: Number(options.unmappedLegalActions || 0),
            },
            fastPath: {
              fallbackUsed: options.fallbackUsed === true,
            },
          },
        },
      });
    });
    return {
      id: options.id || `diag-${Math.random().toString(16).slice(2)}`,
      phase: options.phase || 'selfplay',
      whiteGeneration: Number.isFinite(options.whiteGeneration) ? options.whiteGeneration : 0,
      blackGeneration: Number.isFinite(options.blackGeneration) ? options.blackGeneration : 0,
      replay,
    };
  }

  function createLegacyIdentityBundle(seed = 1601) {
    const legacyBundle = createLegacyDefaultModelBundle({ seed });
    legacyBundle.identity.network.outputSize = 4;
    const finalLayer = legacyBundle.identity.network.layers[legacyBundle.identity.network.layers.length - 1];
    finalLayer.outputSize = 4;
    finalLayer.weights = finalLayer.weights.slice(0, 4);
    finalLayer.biases = finalLayer.biases.slice(0, 4);
    delete legacyBundle.identity.inferredIdentities;
    return legacyBundle;
  }

  function createLegacyLinearBundle(seed = 2601) {
    const modernBundle = createLegacyDefaultModelBundle({ seed });
    const identityCount = Array.isArray(modernBundle.identity.inferredIdentities)
      ? modernBundle.identity.inferredIdentities.length
      : INFERRED_IDENTITIES.length;
    return {
      version: 2,
      policy: {
        ...modernBundle.policy,
        network: {
          type: 'mlp',
          version: 2,
          inputSize: modernBundle.policy.network.inputSize,
          hiddenSizes: [],
          outputSize: 1,
          layers: [{
            inputSize: modernBundle.policy.network.inputSize,
            outputSize: 1,
            weights: [Array.from({ length: modernBundle.policy.network.inputSize }, () => 0)],
            biases: [0],
          }],
        },
      },
      value: {
        ...modernBundle.value,
        network: {
          type: 'mlp',
          version: 2,
          inputSize: modernBundle.value.network.inputSize,
          hiddenSizes: [],
          outputSize: 1,
          layers: [{
            inputSize: modernBundle.value.network.inputSize,
            outputSize: 1,
            weights: [Array.from({ length: modernBundle.value.network.inputSize }, () => 0)],
            biases: [0],
          }],
        },
      },
      identity: {
        ...modernBundle.identity,
        inferredIdentities: modernBundle.identity.inferredIdentities || INFERRED_IDENTITIES.slice(),
        network: {
          type: 'mlp',
          version: 2,
          inputSize: modernBundle.identity.network.inputSize,
          hiddenSizes: [],
          outputSize: identityCount,
          layers: [{
            inputSize: modernBundle.identity.network.inputSize,
            outputSize: identityCount,
            weights: Array.from(
              { length: identityCount },
              () => Array.from({ length: modernBundle.identity.network.inputSize }, () => 0)
            ),
            biases: Array.from({ length: identityCount }, () => 0),
          }],
        },
      },
    };
  }

  test('default model bundles use the larger future-run architecture', () => {
    const modelBundle = createDefaultModelBundle({ seed: 2201 });

    expect(modelBundle.family).toBe('shared_encoder_belief_ismcts_v1');
    expect(modelBundle.architecture?.presetId).toBe('65k');
    expect(modelBundle.encoder.network.hiddenSizes).toEqual([28, 24, 24]);
    expect(modelBundle.policy.network.hiddenSizes).toEqual([24]);
    expect(modelBundle.value.network.hiddenSizes).toEqual([8]);
    expect(modelBundle.identity.network.hiddenSizes).toEqual([40]);
  });

  test('continuous runs promote generations and expose replay by generation pair', async () => {
    const started = await runtime.startRun(createSmallRunConfig());
    expect(started.run).toBeTruthy();
    expect(started.live).toBeTruthy();

    await waitFor(() => {
      const run = runtime.getRunById(started.run.id);
      return Boolean(run && ['completed', 'stopped', 'error'].includes(run.status));
    }, 30000);

    const detail = await runtime.getRun(started.run.id);
    expect(detail).toBeTruthy();
    expect(detail.status).toBe('completed');
    expect(detail.bestGeneration).toBeGreaterThanOrEqual(1);
    expect(detail.generations.length).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(detail.evaluationSeries)).toBe(true);
    detail.evaluationSeries.forEach((series) => {
      series.points.forEach((point) => {
        expect(point.candidateGeneration).toBeGreaterThan(series.opponentGeneration);
      });
    });
    expect(detail.generationPairs.length).toBeGreaterThan(0);

    const allGames = await runtime.listRunGames(detail.id);
    expect(allGames.length).toBeGreaterThan(0);

    const rawRun = runtime.getRunById(started.run.id);
    expect(rawRun).toBeTruthy();
    expect(rawRun.replayBuffer.policySamples).toHaveLength(0);
    expect(rawRun.working.modelBundle).toBeNull();
    expect(rawRun.retainedGames.length).toBeGreaterThan(0);
    expect(rawRun.retainedGames[0].training).toBeUndefined();

    const pair = detail.generationPairs.find((entry) => entry.generationA !== entry.generationB) || detail.generationPairs[0];
    const games = await runtime.listRunGames(detail.id, pair.generationA, pair.generationB);
    expect(games.length).toBeGreaterThan(0);

    const replay = await runtime.getRunReplay(detail.id, games[0].id);
    expect(replay).toBeTruthy();
    expect(replay.game.id).toBe(games[0].id);
    expect(Array.isArray(replay.game.replay)).toBe(true);
    expect(replay.game.replay.length).toBeGreaterThan(1);
    expect(replay.game.replay[0].decision?.trace?.actionStats?.length || 0).toBeLessThanOrEqual(8);
  });

  test('run workbench surfaces defaults, live runs, and stop requests', async () => {
    const started = await runtime.startRun(createSmallRunConfig({
      label: 'stoppable-run',
      checkpointInterval: 1000,
      maxGenerations: 5,
      maxSelfPlayGames: 20,
      maxTrainingSteps: 20,
    }));

    const workbench = await runtime.getWorkbench();
    expect(workbench.defaults).toBeTruthy();
    expect(workbench.defaults).toMatchObject({
      modelSizePreset: started.run.config.modelSizePreset,
      maxLogicalProcessors: started.run.config.maxLogicalProcessors,
      numSelfplayWorkers: started.run.config.numSelfplayWorkers,
      curriculumCadence: started.run.config.curriculumCadence,
      parallelGameWorkers: started.run.config.parallelGameWorkers,
      numMctsSimulationsPerMove: started.run.config.numMctsSimulationsPerMove,
      maxDepth: started.run.config.maxDepth,
      hypothesisCount: started.run.config.hypothesisCount,
      riskBias: started.run.config.riskBias,
      exploration: started.run.config.exploration,
      replayBufferMaxPositions: started.run.config.replayBufferMaxPositions,
      batchSize: started.run.config.batchSize,
      learningRate: started.run.config.learningRate,
      weightDecay: started.run.config.weightDecay,
      gradientClipNorm: started.run.config.gradientClipNorm,
      trainingStepsPerCycle: started.run.config.trainingStepsPerCycle,
      trainingBackend: started.run.config.trainingBackend,
      trainingDevicePreference: started.run.config.trainingDevicePreference,
      checkpointInterval: started.run.config.checkpointInterval,
      evalGamesPerCheckpoint: started.run.config.evalGamesPerCheckpoint,
      promotionWinrateThreshold: started.run.config.promotionWinrateThreshold,
      modelRefreshIntervalForWorkers: started.run.config.modelRefreshIntervalForWorkers,
      generationComparisonStride: started.run.config.generationComparisonStride,
      olderGenerationSampleProbability: started.run.config.olderGenerationSampleProbability,
      stopOnMaxGenerations: started.run.config.stopOnMaxGenerations,
      maxGenerations: started.run.config.maxGenerations,
      stopOnMaxSelfPlayGames: started.run.config.stopOnMaxSelfPlayGames,
      maxSelfPlayGames: started.run.config.maxSelfPlayGames,
      stopOnMaxTrainingSteps: started.run.config.stopOnMaxTrainingSteps,
      maxTrainingSteps: started.run.config.maxTrainingSteps,
      stopOnMaxFailedPromotions: started.run.config.stopOnMaxFailedPromotions,
      maxFailedPromotions: started.run.config.maxFailedPromotions,
    });
    expect(Array.isArray(workbench.defaults.modelSizePresetOptions)).toBe(true);
    expect(Array.isArray(workbench.runs.items)).toBe(true);
    expect(workbench.runs.items.some((run) => run.id === started.run.id)).toBe(true);
    expect(workbench.live.resourceTelemetry).toBeTruthy();
    expect(workbench.live.resourceTelemetry.sampleIntervalMs).toBe(2000);
    expect(workbench.live.resourceTelemetry.windowMs).toBe(600000);
    expect(workbench.live.resourceTelemetry.cpu.available).toBe(true);
    expect(Array.isArray(workbench.live.resourceTelemetry.cpu.history)).toBe(true);
    expect(workbench.live.resourceTelemetry.gpu).toBeTruthy();
    expect(Array.isArray(workbench.live.runs)).toBe(true);
    expect(workbench.live.runs.some((run) => run.runId === started.run.id)).toBe(true);

    const stop = await runtime.stopRun(started.run.id);
    expect(stop.stopped).toBe(true);

    await waitFor(() => {
      const run = runtime.getRunById(started.run.id);
      return Boolean(run && ['stopped', 'completed', 'error'].includes(run.status));
    }, 30000);

    const detail = await runtime.getRun(started.run.id);
    expect(['stopped', 'completed']).toContain(detail.status);
  });

  test('startRun applies hardware-tuned defaults when batch settings are omitted', async () => {
    await runtime.ensureLoaded();
    jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});
    jest.spyOn(runtime, 'getRecommendedRunConfigDefaults').mockResolvedValue({
      ...runtime.getRunConfigDefaults(),
      parallelGameWorkers: 12,
      numSelfplayWorkers: 24,
      batchSize: 1024,
      trainingStepsPerCycle: 64,
    });

    const started = await runtime.startRun({
      label: 'auto-tuned-run',
    });

    expect(started.run.config).toMatchObject({
      maxLogicalProcessors: runtime.getRunConfigDefaults().maxLogicalProcessors,
      parallelGameWorkers: 12,
      numSelfplayWorkers: 24,
      curriculumCadence: 100,
      batchSize: 1024,
      trainingStepsPerCycle: 64,
    });
    runtime.getRunById(started.run.id).status = 'stopped';
  });

  test('startRun caps worker defaults and overrides by max logical processors', async () => {
    await runtime.ensureLoaded();
    jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});

    const started = await runtime.startRun({
      label: 'capped-cpu-budget-run',
      maxLogicalProcessors: 6,
      numSelfplayWorkers: 20,
      parallelGameWorkers: 10,
    });

    expect(started.run.config).toMatchObject({
      maxLogicalProcessors: 6,
      parallelGameWorkers: 6,
      numSelfplayWorkers: 20,
    });
    runtime.getRunById(started.run.id).status = 'stopped';
  });

  test('curriculum start states shift from advanced endgames toward setup-heavy openings', () => {
    const earlySummaries = [];
    const lateSummaries = [];

    for (let seed = 5000; seed < 5120; seed += 1) {
      earlySummaries.push(createInitialState({
        seed,
        maxPlies: 80,
        curriculum: { progress: 0 },
      }).curriculum);
      lateSummaries.push(createInitialState({
        seed,
        maxPlies: 80,
        curriculum: { progress: 1 },
      }).curriculum);
    }

    const average = (items, key) => (
      items.reduce((sum, item) => sum + Number(item?.[key] || 0), 0) / items.length
    );

    expect(average(earlySummaries, 'whiteBoardPieces')).toBeLessThan(2);
    expect(average(earlySummaries, 'blackBoardPieces')).toBeLessThan(2);
    expect(average(earlySummaries, 'advanceDepth')).toBeGreaterThan(3);
    expect(average(earlySummaries, 'totalDaggers')).toBeGreaterThan(3);

    expect(average(lateSummaries, 'whiteBoardPieces')).toBeGreaterThan(4);
    expect(average(lateSummaries, 'blackBoardPieces')).toBeGreaterThan(4);
    expect(average(lateSummaries, 'advanceDepth')).toBeLessThan(1);
    expect(average(lateSummaries, 'totalDaggers')).toBeLessThan(1);
  });

  test('curriculum states keep captured pieces public, reserves intact, and placements inside the allowed ranks', () => {
    const state = createInitialState({
      seed: 6401,
      maxPlies: 80,
      curriculum: { progress: 0.45 },
    });
    const summary = summarizeCurriculumState(state);

    expect(state.curriculum).toBeTruthy();
    expect(state.curriculum.mode).toBe('selfplay-curriculum');
    expect(summary.boardCounts[WHITE]).toBe(state.curriculum.whiteBoardPieces);
    expect(summary.boardCounts[BLACK]).toBe(state.curriculum.blackBoardPieces);
    expect(summary.capturedCounts[BLACK]).toBe(5 - state.curriculum.whiteBoardPieces);
    expect(summary.capturedCounts[WHITE]).toBe(5 - state.curriculum.blackBoardPieces);
    expect(state.stashes[WHITE]).toHaveLength(2);
    expect(state.stashes[BLACK]).toHaveLength(2);
    expect(state.onDecks[WHITE]).toBeTruthy();
    expect(state.onDecks[BLACK]).toBeTruthy();
    expect(summary.daggers[WHITE] + summary.daggers[BLACK]).toBe(state.curriculum.totalDaggers);
    expect(summary.daggers[WHITE]).toBeLessThanOrEqual(2);
    expect(summary.daggers[BLACK]).toBeLessThanOrEqual(2);
    expect(Math.max(...summary.boardRelativeRanks[WHITE])).toBeLessThanOrEqual(state.curriculum.advanceDepth);
    expect(Math.max(...summary.boardRelativeRanks[BLACK])).toBeLessThanOrEqual(state.curriculum.advanceDepth);

    state.captured[WHITE].forEach((pieceId) => {
      expect(state.pieces[pieceId].capturedBy).toBe(WHITE);
      expect(state.pieces[pieceId].alive).toBe(false);
      expect(state.revealedIdentities[pieceId]).toBe(state.pieces[pieceId].identity);
    });
    state.captured[BLACK].forEach((pieceId) => {
      expect(state.pieces[pieceId].capturedBy).toBe(BLACK);
      expect(state.pieces[pieceId].alive).toBe(false);
      expect(state.revealedIdentities[pieceId]).toBe(state.pieces[pieceId].identity);
    });
  });

  test('self-play task payloads include curriculum progression while evaluation stays on the default setup path', async () => {
    await runtime.ensureLoaded();
    const run = runtime.createRunRecord({
      label: 'curriculum-payload-run',
      config: createSmallRunConfig({
        curriculumCadence: 25,
      }),
    });
    run.stats.totalSelfPlayGames = 40;

    const selfPlayTask = runtime.buildRunGameTaskPayload(run, {
      phase: 'selfplay',
      whiteGeneration: 0,
      blackGeneration: 0,
      curriculumGameIndex: 42,
    });
    const evaluationTask = runtime.buildRunGameTaskPayload(run, {
      phase: 'evaluation',
      whiteGeneration: 0,
      blackGeneration: 0,
      curriculumGameIndex: 42,
    });

    expect(selfPlayTask.options.curriculum).toEqual({
      cadence: 25,
      gameIndex: 42,
    });
    expect(evaluationTask.options.curriculum).toBeNull();
  });

  test('bootstrap seeding upgrades legacy root baselines to the preferred modern snapshot', async () => {
    await runtime.ensureLoaded();
    runtime.state.snapshots = [
      runtime.createSnapshotRecord({
        id: 'snapshot-legacy-bootstrap',
        label: 'Bootstrap',
        generation: 0,
        parentSnapshotId: null,
        modelBundle: createLegacyLinearBundle(),
        notes: 'Initial baseline model bundle',
      }),
    ];

    const bootstrapSnapshot = runtime.getBootstrapSnapshot();

    expect(runtime.state.snapshots).toHaveLength(2);
    expect(bootstrapSnapshot.id).not.toBe('snapshot-legacy-bootstrap');
    expect(bootstrapSnapshot.bootstrapKey).toBe('modern-default-v1');
    expect(bootstrapSnapshot.modelBundle.family).toBe('shared_encoder_belief_ismcts_v1');
    expect(bootstrapSnapshot.modelBundle.architecture?.presetId).toBe('65k');
    expect(bootstrapSnapshot.modelBundle.encoder.network.hiddenSizes).toEqual([28, 24, 24]);
    expect(bootstrapSnapshot.modelBundle.policy.network.hiddenSizes).toEqual([24]);
    expect(bootstrapSnapshot.modelBundle.value.network.hiddenSizes).toEqual([8]);
    expect(bootstrapSnapshot.modelBundle.identity.network.hiddenSizes).toEqual([40]);

    const seed = runtime.resolveRunSeedBundle({
      seedMode: 'bootstrap',
      seedSnapshotId: null,
    });
    expect(seed.seedSource).toBe(`bootstrap:${bootstrapSnapshot.id}`);
    expect(seed.seedBundle.family).toBe('shared_encoder_belief_ismcts_v1');
  });

  test('bootstrap seeding replaces stale keyed bootstrap snapshots with the preferred 65k baseline', async () => {
    await runtime.ensureLoaded();
    runtime.state.snapshots = [
      runtime.createSnapshotRecord({
        id: 'snapshot-stale-bootstrap',
        label: 'Bootstrap Shared-Encoder MLP (1.6M params)',
        generation: 0,
        parentSnapshotId: null,
        modelBundle: createDefaultModelBundle({ seed: 7331, modelSizePreset: '512k' }),
        notes: 'Old preferred bootstrap snapshot',
        bootstrapKey: 'modern-default-v1',
      }),
    ];

    const bootstrapSnapshot = runtime.getBootstrapSnapshot();

    expect(bootstrapSnapshot.id).not.toBe('snapshot-stale-bootstrap');
    expect(bootstrapSnapshot.bootstrapKey).toBe('modern-default-v1');
    expect(bootstrapSnapshot.modelBundle.architecture?.presetId).toBe('65k');

    const seed = runtime.resolveRunSeedBundle({
      seedMode: 'bootstrap',
      modelSizePreset: '65k',
      seedSnapshotId: null,
    });

    expect(seed.seedSource).toBe(`bootstrap:${bootstrapSnapshot.id}`);
    expect(seed.seedBundle.architecture?.presetId).toBe('65k');
  });

  test('new runs can seed from an existing promoted generation and workbench lists it', async () => {
    await runtime.ensureLoaded();

    const sourceRun = runtime.createRunRecord({
      id: 'run-seed-source',
      label: 'Seed Source',
      config: createSmallRunConfig(),
    });
    sourceRun.status = 'completed';
    sourceRun.updatedAt = '2026-03-13T01:00:00.000Z';
    sourceRun.generations.push(runtime.createRunGenerationRecord(sourceRun, {
      generation: 1,
      label: 'G1',
      source: 'promoted',
      approved: true,
      isBest: true,
      promotedAt: '2026-03-13T01:00:00.000Z',
      modelBundle: createDefaultModelBundle({ seed: 404 }),
    }));
    sourceRun.bestGeneration = 1;
    runtime.markRunBestGeneration(sourceRun, 1);
    runtime.compactTerminalRunState(sourceRun);
    runtime.state.runs.push(sourceRun);

    const workbench = await runtime.getWorkbench();
    expect(workbench.seedSources.items.slice(0, 2).map((item) => item.id)).toEqual(['bootstrap', 'random']);
    expect(workbench.seedSources.items[0].label).toBe(`Bootstrap ${DEFAULT_MODEL_DESCRIPTOR}`);
    expect(workbench.seedSources.items[1].label).toBe(`Random ${DEFAULT_MODEL_DESCRIPTOR}`);
    expect(workbench.seedSources.items.map((item) => item.id)).toContain('generation:run-seed-source:1');

    const sourceGeneration = runtime.getRunGeneration(sourceRun, 1);
    const started = await runtime.startRun(createSmallRunConfig({
      label: 'seeded-from-promoted',
      seedMode: 'promoted_generation',
      seedRunId: sourceRun.id,
      seedGeneration: 1,
      maxGenerations: 5,
      maxSelfPlayGames: 20,
      maxTrainingSteps: 20,
    }));
    expect(started.run.config).toMatchObject({
      seedMode: 'promoted_generation',
      seedRunId: sourceRun.id,
      seedGeneration: 1,
    });

    const seededRun = runtime.getRunById(started.run.id);
    expect(seededRun).toBeTruthy();
    expect(seededRun.generations[0].source).toBe('generation:run-seed-source:1');
    expect(seededRun.generations[0].modelBundle).toEqual(sourceGeneration.modelBundle);

    await runtime.stopRun(started.run.id);
  });

  test('new runs auto-name from the selected seed source', async () => {
    await runtime.ensureLoaded();
    jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});

    const bootstrapFirst = await runtime.startRun(createSmallRunConfig({
      maxFailedPromotions: 1,
    }));
    expect(bootstrapFirst.run.label).toBe(`Bootstrap ${DEFAULT_MODEL_DESCRIPTOR} 001`);
    runtime.getRunById(bootstrapFirst.run.id).status = 'stopped';

    const bootstrapSecond = await runtime.startRun(createSmallRunConfig({
      maxFailedPromotions: 1,
    }));
    expect(bootstrapSecond.run.label).toBe(`Bootstrap ${DEFAULT_MODEL_DESCRIPTOR} 002`);
    runtime.getRunById(bootstrapSecond.run.id).status = 'stopped';

    const sourceRun = runtime.createRunRecord({
      id: 'run-seed-names',
      label: 'Source Sweep',
      config: createSmallRunConfig(),
    });
    sourceRun.status = 'completed';
    sourceRun.generations.push(runtime.createRunGenerationRecord(sourceRun, {
      generation: 1,
      label: 'Aggro Seed',
      source: 'promoted',
      approved: true,
      isBest: true,
      promotedAt: '2026-03-13T01:00:00.000Z',
      modelBundle: createDefaultModelBundle({ seed: 909 }),
    }));
    sourceRun.bestGeneration = 1;
    runtime.markRunBestGeneration(sourceRun, 1);
    runtime.compactTerminalRunState(sourceRun);
    runtime.state.runs.push(sourceRun);

    const promotedStart = await runtime.startRun(createSmallRunConfig({
      seedMode: 'promoted_generation',
      seedRunId: sourceRun.id,
      seedGeneration: 1,
      maxFailedPromotions: 1,
    }));
    expect(promotedStart.run.label).toBe(`Aggro Seed ${DEFAULT_MODEL_DESCRIPTOR} 001`);
    runtime.getRunById(promotedStart.run.id).status = 'stopped';
  });

  test('stopped runs can be continued in place when resumable state exists', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-continue',
      label: 'Continue Me',
      config: createSmallRunConfig(),
    });
    run.status = 'stopped';
    run.stopReason = 'manual_stop';
    runtime.state.runs.push(run);

    const pipelineSpy = jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});

    const result = await runtime.continueRun(run.id);
    expect(result.continued).toBe(true);
    expect(result.run.id).toBe(run.id);
    expect(runtime.getRunById(run.id).status).toBe('running');
    expect(runtime.getRunById(run.id).stopReason).toBeNull();

    await waitFor(() => pipelineSpy.mock.calls.length === 1, 1000);
  });

  test('killRun stops a run immediately with manual_kill and clears the active task slot', async () => {
    await runtime.ensureLoaded();
    const releasePipeline = {};
    const pipelineSpy = jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(() => new Promise((resolve) => {
      releasePipeline.resolve = resolve;
    }));

    const started = await runtime.startRun(createSmallRunConfig({
      label: 'kill-me',
    }));

    await waitFor(() => pipelineSpy.mock.calls.length === 1, 1000);
    expect(runtime.runTasks.has(started.run.id)).toBe(true);

    const result = await runtime.killRun(started.run.id);

    expect(result.killed).toBe(true);
    expect(result.run.status).toBe('stopped');
    expect(result.run.stopReason).toBe('manual_kill');
    expect(runtime.runTasks.has(started.run.id)).toBe(false);
    expect(runtime.getRunById(started.run.id).status).toBe('stopped');
    expect(runtime.getRunById(started.run.id).stopReason).toBe('manual_kill');

    releasePipeline.resolve();
    await waitFor(() => pipelineSpy.mock.results[0]?.type === 'return', 1000);
  });

  test('killRun prevents stale pipeline failures from rewriting the killed run state', async () => {
    await runtime.ensureLoaded();
    let releasePipeline = null;
    const pipelineSpy = jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(() => new Promise((resolve, reject) => {
      releasePipeline = { resolve, reject };
    }));

    const started = await runtime.startRun(createSmallRunConfig({
      label: 'kill-stale-error',
    }));

    await waitFor(() => pipelineSpy.mock.calls.length === 1, 1000);
    const killResult = await runtime.killRun(started.run.id);
    expect(killResult.killed).toBe(true);

    releasePipeline.reject(new Error('late pipeline failure'));
    await waitFor(() => !runtime.runTasks.has(started.run.id), 1000);

    const killedRun = runtime.getRunById(started.run.id);
    expect(killedRun.status).toBe('stopped');
    expect(killedRun.stopReason).toBe('manual_kill');
    expect(killedRun.lastError).toBeNull();
  });

  test('continued runs accumulate elapsed time from prior active segments', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-13T03:00:00.000Z'));
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-continue-elapsed',
      label: 'Continue Elapsed',
      config: createSmallRunConfig(),
    });
    run.status = 'stopped';
    run.stopReason = 'manual_stop';
    run.timing = {
      elapsedMs: 120000,
      activeSegmentStartedAt: null,
    };
    runtime.state.runs.push(run);

    const pipelineSpy = jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});

    const result = await runtime.continueRun(run.id);
    expect(result.continued).toBe(true);
    expect(result.run.elapsedMs).toBe(120000);

    jest.setSystemTime(new Date('2026-03-13T03:00:30.000Z'));
    expect(runtime.summarizeRun(run).elapsedMs).toBe(150000);

    await waitFor(() => pipelineSpy.mock.calls.length === 1, 1000);
  });

  test('stopped runs can continue from their best promoted generation when working state was compacted', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-continue-legacy',
      label: 'Continue Legacy',
      config: createSmallRunConfig(),
    });
    run.generations.push(runtime.createRunGenerationRecord(run, {
      generation: 1,
      label: 'G1',
      source: 'promoted',
      approved: true,
      isBest: true,
      promotedAt: '2026-03-13T02:00:00.000Z',
      modelBundle: createDefaultModelBundle({ seed: 505 }),
    }));
    runtime.markRunBestGeneration(run, 1);
    run.workerGeneration = 1;
    run.status = 'stopped';
    run.stopReason = 'manual_stop';
    run.working.modelBundle = null;
    run.working.optimizerState = null;
    runtime.state.runs.push(run);

    expect(runtime.canContinueRun(run)).toBe(true);

    const pipelineSpy = jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});

    const result = await runtime.continueRun(run.id);
    expect(result.continued).toBe(true);
    expect(runtime.getRunById(run.id).status).toBe('running');
    expect(runtime.getRunById(run.id).working.modelBundle).toEqual(run.generations[1].modelBundle);
    expect(runtime.getRunById(run.id).working.optimizerState).toBeTruthy();
    expect(runtime.getRunById(run.id).working.baseGeneration).toBe(1);
    expect(runtime.getRunById(run.id).workerGeneration).toBe(1);

    await waitFor(() => pipelineSpy.mock.calls.length === 1, 1000);
  });

  test('errored runs can continue from their best promoted generation when working state was compacted', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-error-continue-legacy',
      label: 'Continue Errored Legacy',
      config: createSmallRunConfig(),
    });
    run.generations.push(runtime.createRunGenerationRecord(run, {
      generation: 1,
      label: 'G1',
      source: 'promoted',
      approved: true,
      isBest: true,
      promotedAt: '2026-03-13T02:00:00.000Z',
      modelBundle: createDefaultModelBundle({ seed: 606 }),
    }));
    runtime.markRunBestGeneration(run, 1);
    run.workerGeneration = 1;
    run.status = 'error';
    run.stopReason = 'filesystem_journal_write_failed';
    run.lastError = {
      name: 'Error',
      message: 'filesystem_journal_write_failed',
      code: 'ENOENT',
    };
    run.working.modelBundle = null;
    run.working.optimizerState = null;
    runtime.state.runs.push(run);

    expect(runtime.canContinueRun(run)).toBe(true);

    const pipelineSpy = jest.spyOn(runtime, 'runContinuousPipeline').mockImplementation(async () => {});

    const result = await runtime.continueRun(run.id);
    expect(result.continued).toBe(true);
    expect(runtime.getRunById(run.id).status).toBe('running');
    expect(runtime.getRunById(run.id).stopReason).toBeNull();
    expect(runtime.getRunById(run.id).lastError).toBeNull();
    expect(runtime.getRunById(run.id).working.modelBundle).toEqual(run.generations[1].modelBundle);
    expect(runtime.getRunById(run.id).working.optimizerState).toBeTruthy();
    expect(runtime.getRunById(run.id).working.baseGeneration).toBe(1);

    await waitFor(() => pipelineSpy.mock.calls.length === 1, 1000);
  });

  test('identity hypotheses include bombs and obey piece-count limits', () => {
    const state = createInitialState({ seed: 1201, maxPlies: 80 });
    const modelBundle = createDefaultModelBundle({ seed: 1202 });
    const inference = inferIdentityHypotheses(modelBundle, state, WHITE, { count: 8 });

    expect(inference.hiddenPieceIds.length).toBeGreaterThan(0);
    const sampleProbabilities = inference.perPieceProbabilities[inference.hiddenPieceIds[0]];
    expect(Object.keys(sampleProbabilities).map((identity) => Number(identity))).toContain(IDENTITIES.BOMB);
    expect(inference.hypotheses.length).toBeGreaterThan(0);

    inference.hypotheses.forEach((hypothesis) => {
      const counts = {};
      Object.values(hypothesis.assignment || {}).forEach((identity) => {
        counts[identity] = (counts[identity] || 0) + 1;
      });
      Object.keys(counts).forEach((identity) => {
        expect(counts[identity]).toBeLessThanOrEqual(IDENTITY_COUNTS[identity]);
      });
      expect(Object.values(hypothesis.assignment || {})).toContain(IDENTITIES.BOMB);
    });
  });

  test('risk bias zero is neutral across symmetric hypothesis values', () => {
    const risk = applyRiskBiasToHypotheses(
      [{ probability: 0.5 }, { probability: 0.5 }],
      [1, -1],
      0,
    );

    expect(risk.value).toBeCloseTo(0, 8);
    expect(risk.weights[0]).toBeCloseTo(0.5, 8);
    expect(risk.weights[1]).toBeCloseTo(0.5, 8);
  });

  test('ensureLoaded migrates persisted legacy identity heads from 4 outputs to 5', async () => {
    const now = new Date().toISOString();
    const legacyBundle = createLegacyIdentityBundle(1601);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ml-runtime-'));
    const dataFilePath = path.join(tempDir, 'runtime.json');
    const persistedState = {
      version: 3,
      counters: {
        snapshot: 2,
        simulation: 1,
        game: 1,
        training: 1,
        run: 2,
      },
      snapshots: [{
        id: 'snapshot-0001',
        label: 'Legacy Bootstrap',
        createdAt: now,
        updatedAt: now,
        generation: 0,
        parentSnapshotId: null,
        notes: '',
        modelBundle: legacyBundle,
        stats: {
          simulations: 0,
          games: 0,
          whiteWins: 0,
          blackWins: 0,
          draws: 0,
          trainingRuns: 0,
        },
        losses: [],
      }],
      simulations: [],
      trainingRuns: [],
      runs: [{
        id: 'run-0001',
        label: 'Legacy Run',
        createdAt: now,
        updatedAt: now,
        status: 'completed',
        stopReason: 'manual_stop',
        config: {
          ...createSmallRunConfig(),
        },
        bestGeneration: 0,
        evaluationTargetGeneration: 0,
        workerGeneration: 0,
        replayBuffer: {
          maxPositions: 32,
          totalPositionsSeen: 0,
          evictedPositions: 0,
          summary: null,
          policySamples: [],
          valueSamples: [],
          identitySamples: [],
        },
        retainedGames: [],
        metricsHistory: [],
        evaluationHistory: [],
        stats: {
          cycle: 0,
          totalSelfPlayGames: 0,
          totalEvaluationGames: 0,
          totalTrainingSteps: 0,
          totalPromotions: 0,
          failedPromotions: 0,
          averageGameLength: 0,
          policyEntropy: 0,
          moveDiversity: 0,
        },
        generations: [{
          id: 'run-0001:generation:0',
          generation: 0,
          label: 'G0',
          source: 'bootstrap',
          approved: true,
          isBest: true,
          createdAt: now,
          promotedAt: now,
          stats: {},
          latestLoss: null,
          promotionEvaluation: null,
          modelBundle: legacyBundle,
        }],
        working: {
          modelBundle: legacyBundle,
          optimizerState: null,
          baseGeneration: 0,
          checkpointIndex: 0,
          lastLoss: null,
        },
      }],
      activeJobs: {
        simulation: null,
        training: null,
      },
    };
    fs.writeFileSync(dataFilePath, JSON.stringify(persistedState, null, 2));

    const persistedRuntime = new MlRuntime({
      dataFilePath,
      persist: true,
      useMongoSimulations: false,
    });

    try {
      await persistedRuntime.ensureLoaded();
      const snapshot = persistedRuntime.getSnapshotById('snapshot-0001');
      const run = persistedRuntime.getRunById('run-0001');
      expect(snapshot?.modelBundle?.identity?.network?.outputSize).toBe(INFERRED_IDENTITIES.length);
      expect(snapshot?.modelBundle?.identity?.inferredIdentities).toEqual(INFERRED_IDENTITIES);
      expect(run?.generations?.[0]?.modelBundle?.identity?.network?.outputSize).toBe(INFERRED_IDENTITIES.length);

      const savedState = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
      expect(savedState.snapshots[0].modelBundle.identity.network.outputSize).toBe(INFERRED_IDENTITIES.length);
      expect(savedState.runs[0].generations[0].modelBundle.identity.network.outputSize).toBe(INFERRED_IDENTITIES.length);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('ensureLoaded re-normalizes already-loaded in-memory runs and optimizer checkpoints', async () => {
    await runtime.ensureLoaded();

    const legacyBundle = createLegacyIdentityBundle(1701);
    runtime.state.snapshots[0].modelBundle = legacyBundle;

    const run = runtime.createRunRecord({
      label: 'stale-live-run',
      config: createSmallRunConfig({
        trainingBackend: 'node',
      }),
    });
    run.working.modelBundle = createLegacyIdentityBundle(1702);
    run.working.optimizerState = createOptimizerState(createDefaultModelBundle({ seed: 1703 }));
    const identityState = run.working.optimizerState.identity.layers[run.working.optimizerState.identity.layers.length - 1];
    identityState.mWeights = identityState.mWeights.slice(0, 4);
    identityState.vWeights = identityState.vWeights.slice(0, 4);
    identityState.mBiases = identityState.mBiases.slice(0, 4);
    identityState.vBiases = identityState.vBiases.slice(0, 4);
    run.generations[0].modelBundle = createLegacyIdentityBundle(1704);
    runtime.state.runs.push(run);

    await runtime.ensureLoaded();

    expect(runtime.state.snapshots[0].modelBundle.identity.network.outputSize).toBe(INFERRED_IDENTITIES.length);
    expect(run.generations[0].modelBundle.identity.network.outputSize).toBe(INFERRED_IDENTITIES.length);
    expect(run.working.modelBundle.identity.network.outputSize).toBe(INFERRED_IDENTITIES.length);
    expect(run.working.optimizerState.identity.layers[run.working.optimizerState.identity.layers.length - 1].mWeights)
      .toHaveLength(INFERRED_IDENTITIES.length);
  });

  test('startRun persists latest kickoff config as workbench defaults across reloads', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ml-runtime-'));
    const dataFilePath = path.join(tempDir, 'runtime.json');
    const runtimeA = new MlRuntime({
      dataFilePath,
      persist: true,
      useMongoSimulations: false,
      useMongoRuns: false,
    });

    try {
      jest.spyOn(runtimeA, 'runContinuousPipeline').mockImplementation(async () => {});
      const started = await runtimeA.startRun(createSmallRunConfig({
        modelSizePreset: '32k',
        replayBufferMaxPositions: 24000,
        batchSize: 64,
        learningRate: 0.001,
        numSelfplayWorkers: 3,
        parallelGameWorkers: 2,
      }));

      const savedState = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
      expect(savedState.runConfigDefaults).toMatchObject({
        modelSizePreset: started.run.config.modelSizePreset,
        replayBufferMaxPositions: 24000,
        batchSize: 64,
        learningRate: 0.001,
        numSelfplayWorkers: 3,
        parallelGameWorkers: 2,
      });

      const runtimeB = new MlRuntime({
        dataFilePath,
        persist: true,
        useMongoSimulations: false,
        useMongoRuns: false,
      });
      try {
        const workbench = await runtimeB.getWorkbench();
        expect(workbench.defaults).toMatchObject({
          modelSizePreset: started.run.config.modelSizePreset,
          replayBufferMaxPositions: 24000,
          batchSize: 64,
          learningRate: 0.001,
          numSelfplayWorkers: 3,
          parallelGameWorkers: 2,
        });
        expect(Array.isArray(workbench.defaults.modelSizePresetOptions)).toBe(true);
      } finally {
        await runtimeB.dispose();
      }
    } finally {
      await runtimeA.dispose();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('ensureLoaded refreshes persisted state when the data file changed externally', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-ml-refresh-'));
    const dataFilePath = path.join(tempDir, 'runtime.json');
    const runtimeA = new MlRuntime({
      dataFilePath,
      persist: true,
      useMongoSimulations: false,
    });

    try {
      await runtimeA.ensureLoaded();
      const run = runtimeA.createRunRecord({
        id: 'run-refresh',
        label: 'Refresh Run',
        config: createSmallRunConfig(),
      });
      run.status = 'completed';
      run.retainedGames = [
        {
          id: 'eval-a',
          createdAt: new Date().toISOString(),
          phase: 'evaluation',
          whiteGeneration: 1,
          blackGeneration: 0,
          whiteParticipantLabel: 'G1',
          blackParticipantLabel: 'G0',
          winner: WHITE,
          winReason: null,
          plies: 20,
        },
      ];
      runtimeA.state.runs.push(run);
      await runtimeA.save();

      const runtimeB = new MlRuntime({
        dataFilePath,
        persist: true,
        useMongoSimulations: false,
      });
      await runtimeB.ensureLoaded();
      expect((await runtimeB.listRunGames('run-refresh')).length).toBe(1);

      run.retainedGames.push({
        id: 'eval-b',
        createdAt: new Date().toISOString(),
        phase: 'evaluation',
        whiteGeneration: 2,
        blackGeneration: 1,
        whiteParticipantLabel: 'G2',
        blackParticipantLabel: 'G1',
        winner: WHITE,
        winReason: null,
        plies: 24,
      });
      await runtimeA.save();

      const refreshed = await runtimeB.listRunGames('run-refresh');
      expect(refreshed.length).toBe(2);
      runtimeB.dispose?.();
    } finally {
      runtimeA.dispose?.();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('run summaries expose timing stats for replay and live status', () => {
    const run = runtime.createRunRecord({
      label: 'timed-run',
      config: createSmallRunConfig(),
    });
    run.createdAt = '2026-03-12T00:00:00.000Z';
    run.updatedAt = '2026-03-12T00:05:00.000Z';
    run.status = 'completed';
    run.stats.averageSelfPlayGameDurationMs = 2400;
    run.stats.averageEvaluationGameDurationMs = 3100;
    run.stats.averageTrainingStepDurationMs = 420;

    const summary = runtime.summarizeRun(run);
    const livePayload = runtime.buildRunProgressPayload(run, 'complete');

    expect(summary.averageSelfPlayGameDurationMs).toBe(2400);
    expect(summary.averageEvaluationGameDurationMs).toBe(3100);
    expect(summary.averageTrainingStepDurationMs).toBe(420);
    expect(summary.elapsedMs).toBe(300000);
    expect(livePayload.averageSelfPlayGameDurationMs).toBe(2400);
    expect(livePayload.averageEvaluationGameDurationMs).toBe(3100);
    expect(livePayload.averageTrainingStepDurationMs).toBe(420);
    expect(livePayload.elapsedMs).toBe(300000);
  });

  test('run live payload includes overlapping self-play and training progress', () => {
    const run = runtime.createRunRecord({
      label: 'overlap-live-run',
      config: createSmallRunConfig(),
    });
    run.working.selfPlayProgress = {
      active: true,
      cycle: 3,
      workerGeneration: 0,
      opponentGeneration: 0,
      completedGames: 2,
      targetGames: 8,
      latestGameId: 'game-1',
      activeGames: 4,
      averageMctsSearchDurationMs: 55,
      averageForwardPassDurationMs: 4,
    };
    run.working.trainingProgress = {
      active: true,
      cycle: 3,
      completedSteps: 1,
      targetSteps: 4,
      checkpointIndex: 0,
      background: true,
      trainingBackend: 'python',
      trainingDevice: 'cuda',
    };

    const payload = runtime.buildRunProgressPayload(run, 'selfplay');

    expect(payload.selfPlayProgress).toMatchObject({
      active: true,
      completedGames: 2,
      activeGames: 4,
    });
    expect(payload.trainingProgress).toMatchObject({
      active: true,
      completedSteps: 1,
      targetSteps: 4,
      background: true,
      trainingBackend: 'python',
      trainingDevice: 'cuda',
    });
  });

  test('run summaries and live payloads expose lastError details', () => {
    const run = runtime.createRunRecord({
      label: 'errored-run',
      config: createSmallRunConfig(),
    });
    run.status = 'error';
    run.stopReason = 'requestedKey is not defined';
    run.lastError = {
      message: 'requestedKey is not defined',
      stack: 'ReferenceError: requestedKey is not defined',
    };

    const summary = runtime.summarizeRun(run);
    const livePayload = runtime.buildRunProgressPayload(run, 'error');

    expect(summary.lastError).toMatchObject({
      message: 'requestedKey is not defined',
    });
    expect(livePayload.lastError).toMatchObject({
      message: 'requestedKey is not defined',
    });
  });

  test('timing averages only use games recorded after timing instrumentation is available', () => {
    const run = runtime.createRunRecord({
      label: 'timing-migration-run',
      config: createSmallRunConfig(),
    });
    run.stats.totalSelfPlayGames = 500;
    run.stats.totalEvaluationGames = 600;

    runtime.recordRunGameDurations(run, [
      { durationMs: 2000 },
      { durationMs: 4000 },
    ], 'selfplay');
    runtime.recordRunGameDurations(run, [
      { durationMs: 5000 },
    ], 'evaluation');

    expect(run.stats.timedSelfPlayGames).toBe(2);
    expect(run.stats.averageSelfPlayGameDurationMs).toBe(3000);
    expect(run.stats.timedEvaluationGames).toBe(1);
    expect(run.stats.averageEvaluationGameDurationMs).toBe(5000);
  });

  test('appendRunReplayBuffer drops malformed policy samples with empty feature vectors', () => {
    const run = runtime.createRunRecord({
      label: 'replay-buffer-filter',
      config: createSmallRunConfig(),
    });

    runtime.appendRunReplayBuffer(run, {
      policySamples: [
        {
          features: [[1, 2, 3], [4, 5, 6]],
          target: [0.5, 0.5],
          selectedActionKey: 'ok',
        },
        {
          features: [],
          target: [],
          selectedActionKey: 'empty',
        },
        {
          features: [[], [1, 2, 3]],
          target: [0.1, 0.9],
          selectedActionKey: 'zero-length-vector',
        },
      ],
      valueSamples: [
        { features: [1, 2, 3], target: 1 },
        { features: [], target: -1 },
      ],
      identitySamples: [
        { pieceId: 'p1', trueIdentity: 1, pieceFeatures: [1, 2, 3] },
        { pieceId: 'p2', trueIdentity: 2, pieceFeatures: [] },
      ],
    }, {
      generation: 0,
      createdAt: '2026-03-14T07:04:00.000Z',
    });

    expect(run.replayBuffer.policySamples).toHaveLength(1);
    expect(run.replayBuffer.policySamples[0].selectedActionKey).toBe('ok');
    expect(run.replayBuffer.valueSamples).toHaveLength(1);
    expect(run.replayBuffer.identitySamples).toHaveLength(1);
  });

  test('appendRunReplayBuffer accepts shared-family stateInput samples', () => {
    const run = runtime.createRunRecord({
      label: 'shared-replay-buffer-filter',
      config: createSmallRunConfig(),
    });

    runtime.appendRunReplayBuffer(run, {
      policySamples: [
        {
          stateInput: [1, 2, 3],
          target: [0.2, 0.8],
          selectedActionKey: 'shared-ok',
        },
        {
          stateInput: [],
          target: [1],
          selectedActionKey: 'shared-empty',
        },
      ],
      valueSamples: [
        { stateInput: [4, 5, 6], target: 1 },
        { stateInput: [], target: -1 },
      ],
      identitySamples: [
        { stateInput: [7, 8, 9], pieceSlot: 0, trueIdentityIndex: 1 },
        { stateInput: [7, 8, 9], pieceSlot: null, trueIdentityIndex: 1 },
      ],
    }, {
      generation: 0,
      createdAt: '2026-03-16T09:40:00.000Z',
    });

    expect(run.replayBuffer.policySamples).toHaveLength(1);
    expect(run.replayBuffer.policySamples[0].selectedActionKey).toBe('shared-ok');
    expect(run.replayBuffer.valueSamples).toHaveLength(1);
    expect(run.replayBuffer.identitySamples).toHaveLength(1);
  });

  test('appendRunReplayBuffer accepts shared-model self-play samples emitted by runFastGame', async () => {
    const modelBundle = createDefaultModelBundle({ seed: 1, modelSizePreset: '32k' });
    const participant = {
      id: 'generation:test:0',
      type: 'generation',
      label: 'G0',
      generation: 0,
      runId: 'test',
      modelBundle,
    };
    const game = await runFastGame({
      whiteParticipant: participant,
      blackParticipant: participant,
      maxTurns: 8,
      mlTrainingMode: true,
      mctsConfig: {
        numSimulations: 8,
        maxDepth: 6,
        hypothesisCount: 2,
      },
    });
    const run = runtime.createRunRecord({
      label: 'shared-replay-buffer-live-game',
      config: createSmallRunConfig(),
    });
    const filtered = runtime.filterRunTrainingSamplesByGeneration(game.training, 0);

    expect(filtered.policySamples.length).toBeGreaterThan(0);

    runtime.appendRunReplayBuffer(run, filtered, {
      generation: 0,
      createdAt: '2026-03-16T09:45:00.000Z',
    });

    expect(run.replayBuffer.policySamples.length).toBeGreaterThan(0);
    expect(run.replayBuffer.valueSamples.length).toBeGreaterThan(0);
    expect(run.replayBuffer.identitySamples.length).toBeGreaterThan(0);
  });

  test('sampleReplayBufferSamples includes combined shared samples for the active shared-family path', async () => {
    const modelBundle = createDefaultModelBundle({ seed: 21, modelSizePreset: '32k' });
    const participant = {
      id: 'generation:test:0',
      type: 'generation',
      label: 'G0',
      generation: 0,
      runId: 'test',
      modelBundle,
    };
    const game = await runFastGame({
      gameId: 'shared-sample-batch',
      phase: 'selfplay',
      whiteParticipant: participant,
      blackParticipant: participant,
      seed: 7000,
      iterations: 8,
      maxDepth: 6,
      hypothesisCount: 2,
      riskBias: 0,
      exploration: 1.25,
      maxPlies: 16,
      adaptiveSearch: true,
    });
    const run = runtime.createRunRecord({
      label: 'shared-replay-buffer-combined-batch',
      config: createSmallRunConfig({
        batchSize: 4,
      }),
    });

    expect(game.training.identitySamples.length).toBeGreaterThan(0);

    runtime.appendRunReplayBuffer(run, game.training, {
      generation: 0,
      createdAt: game.createdAt,
    });

    const batch = runtime.sampleReplayBufferSamples(run);

    expect(run.replayBuffer.valueSamples.length).toBeGreaterThan(0);
    expect(run.replayBuffer.identitySamples.length).toBeGreaterThan(0);
    expect(batch.policySamples.length).toBeGreaterThan(0);
    expect(batch.valueSamples.length).toBeGreaterThan(0);
    expect(batch.identitySamples.length).toBeGreaterThan(0);
    expect(batch.sharedSamples.length).toBeGreaterThan(0);
    expect(batch.sharedSamples[0].stateInput.length).toBeGreaterThan(0);
    expect(batch.sharedSamples.some((sample) => Number.isFinite(sample.valueTarget))).toBe(true);
    expect(batch.sharedSamples.some((sample) => Array.isArray(sample.identityTargets) && sample.identityTargets.length > 0)).toBe(true);
  });

  test('sampleReplayBufferSamples sanitizes legacy malformed replay entries without misaligning values', () => {
    const run = runtime.createRunRecord({
      label: 'replay-buffer-sanitize',
      config: createSmallRunConfig({
        batchSize: 8,
      }),
    });
    run.replayBuffer = {
      maxPositions: 32,
      totalPositionsSeen: 3,
      evictedPositions: 0,
      policySamples: [
        {
          features: [[1, 2, 3]],
          target: [1],
          selectedActionKey: 'p1',
          createdAt: '2026-03-14T07:00:01.000Z',
        },
        {
          features: [[], [1, 2, 3]],
          target: [0.2, 0.8],
          selectedActionKey: 'broken',
          createdAt: '2026-03-14T07:00:02.000Z',
        },
        {
          features: [[7, 8, 9]],
          target: [1],
          selectedActionKey: 'p3',
          createdAt: '2026-03-14T07:00:03.000Z',
        },
      ],
      valueSamples: [
        { features: [11], target: 11, createdAt: '2026-03-14T07:00:01.000Z' },
        { features: [22], target: 22, createdAt: '2026-03-14T07:00:02.000Z' },
        { features: [33], target: 33, createdAt: '2026-03-14T07:00:03.000Z' },
      ],
      identitySamples: [],
    };

    runtime.sampleReplayBufferSamples(run);

    expect(run.replayBuffer.policySamples).toHaveLength(2);
    expect(run.replayBuffer.policySamples.map((sample) => sample.selectedActionKey)).toEqual(['p1', 'p3']);
    expect(run.replayBuffer.valueSamples).toHaveLength(2);
    expect(run.replayBuffer.valueSamples.map((sample) => sample.target)).toEqual([11, 33]);
  });

  test('listRunGames separates retained evaluation and simulation games for replay', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      label: 'eval-replay-run',
      config: createSmallRunConfig(),
    });
    run.retainedGames = [
      {
        id: 'selfplay-1',
        createdAt: '2026-03-12T00:00:00.000Z',
        phase: 'selfplay',
        whiteGeneration: 1,
        blackGeneration: 1,
        whiteParticipantLabel: 'G1',
        blackParticipantLabel: 'G1',
        winner: WHITE,
        winReason: null,
        plies: 20,
        curriculum: {
          whiteBoardPieces: 2,
          blackBoardPieces: 3,
          totalBoardPieces: 5,
          advanceDepth: 3,
          totalDaggers: 3,
        },
      },
      {
        id: 'eval-1',
        createdAt: '2026-03-12T00:01:00.000Z',
        phase: 'evaluation',
        whiteGeneration: 2,
        blackGeneration: 1,
        whiteParticipantLabel: 'G2',
        blackParticipantLabel: 'G1',
        winner: WHITE,
        winReason: null,
        plies: 24,
      },
    ];
    runtime.state.runs.push(run);

    const games = await runtime.listRunGames(run.id);
    const gamesViaNullFilter = await runtime.listRunGames(run.id, null, null);
    const simulationGames = await runtime.listRunGames(run.id, null, null, { replayType: 'simulation' });

    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('eval-1');
    expect(games[0].phase).toBe('evaluation');
    expect(gamesViaNullFilter).toHaveLength(1);
    expect(gamesViaNullFilter[0].id).toBe('eval-1');
    expect(simulationGames).toHaveLength(1);
    expect(simulationGames[0].id).toBe('selfplay-1');
    expect(simulationGames[0].phase).toBe('selfplay');
    expect(simulationGames[0].curriculum).toEqual({
      progress: null,
      whiteBoardPieces: 2,
      blackBoardPieces: 3,
      totalBoardPieces: 5,
      advanceDepth: 3,
      totalDaggers: 3,
    });

    const detail = await runtime.getRun(run.id);
    expect(Array.isArray(detail.recentReplayGames)).toBe(true);
    expect(detail.recentReplayGames).toHaveLength(1);
    expect(detail.recentReplayGames[0].id).toBe('eval-1');
    expect(Array.isArray(detail.recentSimulationGames)).toBe(true);
    expect(detail.recentSimulationGames).toHaveLength(1);
    expect(detail.recentSimulationGames[0].id).toBe('selfplay-1');
  });

  test('getRunReplayGameCatalog returns null when the run is missing', async () => {
    await runtime.ensureLoaded();

    const catalog = await runtime.getRunReplayGameCatalog('missing-run', {
      replayType: 'simulation',
      limit: 10,
    });

    expect(catalog).toBeNull();
  });

  test('getRunReplayGameCatalog pages retained games and exposes replay filters', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      label: 'paged-replay-catalog',
      config: createSmallRunConfig(),
    });
    run.retainedGames = [
      {
        id: 'eval-1',
        createdAt: '2026-03-12T00:01:00.000Z',
        phase: 'evaluation',
        whiteGeneration: 0,
        blackGeneration: 1,
        whiteParticipantLabel: 'G0',
        blackParticipantLabel: 'G1',
        winner: WHITE,
        plies: 20,
      },
      {
        id: 'eval-2',
        createdAt: '2026-03-12T00:02:00.000Z',
        phase: 'evaluation',
        whiteGeneration: 1,
        blackGeneration: 2,
        whiteParticipantLabel: 'G1',
        blackParticipantLabel: 'G2',
        winner: BLACK,
        plies: 22,
      },
      {
        id: 'selfplay-1',
        createdAt: '2026-03-12T00:03:00.000Z',
        phase: 'selfplay',
        whiteGeneration: 2,
        blackGeneration: 2,
        whiteParticipantLabel: 'G2',
        blackParticipantLabel: 'G2',
        winner: WHITE,
        plies: 18,
        curriculum: {
          whiteBoardPieces: 2,
          blackBoardPieces: 3,
          totalBoardPieces: 5,
          advanceDepth: 3,
        },
      },
      {
        id: 'selfplay-2',
        createdAt: '2026-03-12T00:04:00.000Z',
        phase: 'selfplay',
        whiteGeneration: 3,
        blackGeneration: 3,
        whiteParticipantLabel: 'G3',
        blackParticipantLabel: 'G3',
        winner: BLACK,
        plies: 24,
        curriculum: {
          whiteBoardPieces: 3,
          blackBoardPieces: 3,
          totalBoardPieces: 6,
          advanceDepth: 4,
        },
      },
    ];
    runtime.state.runs.push(run);

    const evalCatalog = await runtime.getRunReplayGameCatalog(run.id, {
      replayType: 'evaluation',
      limit: 1,
    });

    expect(evalCatalog.items).toHaveLength(1);
    expect(evalCatalog.items[0].id).toBe('eval-2');
    expect(evalCatalog.pageInfo).toMatchObject({
      limit: 1,
      hasMore: true,
      nextBeforeId: 'eval-2',
      matchingCount: 2,
      totalAvailableCount: 2,
    });
    expect(evalCatalog.filters.generationOptions).toEqual([0, 1, 2]);

    const nextEvalCatalog = await runtime.getRunReplayGameCatalog(run.id, {
      replayType: 'evaluation',
      limit: 1,
      beforeId: 'eval-2',
    });
    expect(nextEvalCatalog.items).toHaveLength(1);
    expect(nextEvalCatalog.items[0].id).toBe('eval-1');

    const simulationCatalog = await runtime.getRunReplayGameCatalog(run.id, {
      replayType: 'simulation',
      limit: 5,
      boardPieces: 5,
    });
    expect(simulationCatalog.items).toHaveLength(1);
    expect(simulationCatalog.items[0].id).toBe('selfplay-1');
    expect(simulationCatalog.pageInfo).toMatchObject({
      matchingCount: 1,
      totalAvailableCount: 2,
      hasMore: false,
    });
    expect(simulationCatalog.filters.boardPiecesOptions).toEqual([5, 6]);
    expect(simulationCatalog.filters.advanceDepthOptions).toEqual([3, 4]);
  });

  test('getRunReplayGameCatalog normalizes legacy simulation replay phases', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      label: 'legacy-simulation-replay-phases',
      config: createSmallRunConfig(),
    });
    run.retainedGames = [
      {
        id: 'legacy-sim-1',
        createdAt: '2026-03-12T00:01:00.000Z',
        phase: 'simulation',
        whiteGeneration: 1,
        blackGeneration: 1,
        whiteParticipantLabel: 'G1',
        blackParticipantLabel: 'G1',
        winner: WHITE,
        plies: 16,
        curriculum: {
          whiteBoardPieces: 2,
          blackBoardPieces: 3,
          totalBoardPieces: 5,
          advanceDepth: 3,
        },
      },
      {
        id: 'legacy-sim-2',
        createdAt: '2026-03-12T00:02:00.000Z',
        whiteGeneration: 2,
        blackGeneration: 2,
        whiteParticipantLabel: 'G2',
        blackParticipantLabel: 'G2',
        winner: BLACK,
        plies: 18,
        curriculum: {
          whiteBoardPieces: 3,
          blackBoardPieces: 3,
          totalBoardPieces: 6,
          advanceDepth: 4,
        },
      },
      {
        id: 'legacy-eval-1',
        createdAt: '2026-03-12T00:03:00.000Z',
        phase: 'promotion',
        whiteGeneration: 3,
        blackGeneration: 2,
        whiteParticipantLabel: 'G3',
        blackParticipantLabel: 'G2',
        winner: WHITE,
        plies: 22,
      },
    ];
    runtime.state.runs.push(run);

    const simulationCatalog = await runtime.getRunReplayGameCatalog(run.id, {
      replayType: 'simulation',
      limit: 10,
    });
    const evaluationCatalog = await runtime.getRunReplayGameCatalog(run.id, {
      replayType: 'evaluation',
      limit: 10,
    });
    const detail = await runtime.getRun(run.id);

    expect(simulationCatalog.items.map((game) => game.id)).toEqual(['legacy-sim-1', 'legacy-sim-2']);
    expect(simulationCatalog.items.map((game) => game.phase)).toEqual(['selfplay', 'selfplay']);
    expect(simulationCatalog.filters.boardPiecesOptions).toEqual([5, 6]);
    expect(simulationCatalog.filters.advanceDepthOptions).toEqual([3, 4]);
    expect(evaluationCatalog.items.map((game) => game.id)).toEqual(['legacy-eval-1']);
    expect(detail.recentSimulationGames.map((game) => game.id)).toEqual(['legacy-sim-2', 'legacy-sim-1']);
    expect(detail.recentSimulationGames.map((game) => game.phase)).toEqual(['selfplay', 'selfplay']);
  });

  test('listRunGames repairs duplicate retained game ids from older runs', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      label: 'duplicate-retained-game-ids',
      config: createSmallRunConfig(),
    });
    runtime.state.counters.game = 100000;
    run.retainedGames = [
      {
        id: 'game-100000',
        createdAt: '2026-03-12T00:00:00.000Z',
        phase: 'selfplay',
        whiteGeneration: 0,
        blackGeneration: 0,
        whiteParticipantLabel: 'G0',
        blackParticipantLabel: 'G0',
        winner: WHITE,
        plies: 10,
        replay: [{ ply: 0, board: [] }, { ply: 1, board: [] }],
      },
      {
        id: 'game-100000',
        createdAt: '2026-03-12T00:01:00.000Z',
        phase: 'selfplay',
        whiteGeneration: 0,
        blackGeneration: 0,
        whiteParticipantLabel: 'G0',
        blackParticipantLabel: 'G0',
        winner: BLACK,
        plies: 12,
        replay: [{ ply: 0, board: [{ duplicate: true }] }, { ply: 1, board: [] }],
      },
    ];
    runtime.state.runs.push(run);

    const games = await runtime.listRunGames(run.id, null, null, { replayType: 'simulation' });

    expect(games).toHaveLength(2);
    expect(new Set(games.map((game) => game.id)).size).toBe(2);
    expect(games.map((game) => game.id)).toContain('game-100000');
    expect(games.map((game) => game.id)).toContain('game-100001');

    const repairedReplay = await runtime.getRunReplay(run.id, 'game-100001');
    expect(repairedReplay).toBeTruthy();
    expect(repairedReplay.game.winner).toBe(BLACK);
  });

  test('active runs use in-memory retained games for replay reads', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-live-replay-read',
      label: 'Live Replay Read',
      config: createSmallRunConfig(),
    });
    run.status = 'running';
    run.retainedGames = [
      {
        id: 'eval-live-1',
        createdAt: '2026-03-12T00:02:00.000Z',
        phase: 'evaluation',
        whiteGeneration: 2,
        blackGeneration: 1,
        whiteParticipantLabel: 'G2',
        blackParticipantLabel: 'G1',
        winner: WHITE,
        winReason: null,
        plies: 24,
        replay: [{ ply: 0, board: [] }, { ply: 1, board: [] }],
      },
    ];
    runtime.state.runs.push(run);

    const syncSpy = jest.spyOn(runtime, 'syncPersistedStateForRead');

    const games = await runtime.listRunGames(run.id);
    const replay = await runtime.getRunReplay(run.id, 'eval-live-1');

    expect(syncSpy).not.toHaveBeenCalled();
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('eval-live-1');
    expect(replay).toBeTruthy();
    expect(replay.game.id).toBe('eval-live-1');
    expect(replay.game.replay).toHaveLength(2);
  });

  test('completed runs already loaded in memory do not resync persisted state for replay reads', async () => {
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-complete-replay-read',
      label: 'Complete Replay Read',
      config: createSmallRunConfig(),
    });
    run.status = 'completed';
    run.retainedGames = [
      {
        id: 'eval-complete-1',
        createdAt: '2026-03-12T00:03:00.000Z',
        phase: 'evaluation',
        whiteGeneration: 3,
        blackGeneration: 2,
        whiteParticipantLabel: 'G3',
        blackParticipantLabel: 'G2',
        winner: WHITE,
        winReason: null,
        plies: 28,
        replay: [{ ply: 0, board: [] }, { ply: 1, board: [] }],
      },
    ];
    runtime.state.runs.push(run);

    const syncSpy = jest.spyOn(runtime, 'syncPersistedStateForRead');

    const detail = await runtime.getRun(run.id);
    const games = await runtime.listRunGames(run.id);
    const replay = await runtime.getRunReplay(run.id, 'eval-complete-1');

    expect(syncSpy).not.toHaveBeenCalled();
    expect(Array.isArray(detail.recentReplayGames)).toBe(true);
    expect(detail.recentReplayGames).toHaveLength(1);
    expect(detail.recentReplayGames[0].id).toBe('eval-complete-1');
    expect(games).toHaveLength(1);
    expect(games[0].id).toBe('eval-complete-1');
    expect(replay).toBeTruthy();
    expect(replay.game.id).toBe('eval-complete-1');
    expect(replay.game.replay).toHaveLength(2);
  });

  test('startTestGame creates a live game against a chosen generation and the bot auto-readies', async () => {
    const mongoose = require('mongoose');
    const gameChangedEvents = [];
    const handleGameChanged = (payload) => {
      gameChangedEvents.push(payload);
    };
    eventBus.on('gameChanged', handleGameChanged);

    try {
      await runtime.ensureLoaded();

      const run = runtime.createRunRecord({
        id: 'run-test-live',
        label: 'Live Test Run',
        config: createSmallRunConfig(),
      });
      run.status = 'completed';
      runtime.state.runs.push(run);

      const humanUserId = new mongoose.Types.ObjectId().toString();
      const launched = await runtime.startTestGame({
        runId: run.id,
        generation: 0,
        userId: humanUserId,
        username: 'Admin',
        sidePreference: 'black',
      });

      expect(launched.runId).toBe(run.id);
      expect(launched.generation).toBe(0);
      expect(launched.userColor).toBe(BLACK);

      let latestGame = null;
      await waitFor(async () => {
        latestGame = await GameModel.findById(launched.gameId).lean();
        return Boolean(
          latestGame
          && latestGame.setupComplete?.[WHITE]
          && latestGame.playersReady?.[WHITE]
        );
      }, 10000);

      expect(latestGame).toBeTruthy();
      expect(runtime.liveTestGameConfigs.get(launched.gameId)?.runId).toBe(run.id);
      expect(runtime.liveTestGameConfigs.get(launched.gameId)?.generation).toBe(0);
      expect(Array.isArray(latestGame.players)).toBe(true);
      expect(latestGame.players).toHaveLength(2);

      const relevantEvents = gameChangedEvents.filter((payload) => {
        const id = payload?.game?._id?.toString?.() || payload?.gameId || null;
        return id === launched.gameId;
      });
      expect(relevantEvents.some((payload) => payload?.game?.setupComplete?.[WHITE])).toBe(true);
      expect(relevantEvents.some((payload) => payload?.game?.playersReady?.[WHITE])).toBe(true);
    } finally {
      eventBus.off('gameChanged', handleGameChanged);
    }
  });

  test('scheduleMlTestGame logs loop failures without rejecting the background task', async () => {
    const loopError = new Error("Not this player's turn");
    loopError.status = 400;
    const loopSpy = jest.spyOn(runtime, 'runMlTestGameLoop').mockRejectedValue(loopError);
    const logSpy = jest.spyOn(runtime, 'logMlEvent').mockImplementation(() => {});

    await expect(runtime.scheduleMlTestGame('game-loop-error')).resolves.toBe(false);

    expect(loopSpy).toHaveBeenCalledWith('game-loop-error');
    expect(logSpy).toHaveBeenCalledWith('test_game_loop_error', expect.objectContaining({
      gameId: 'game-loop-error',
      error: expect.objectContaining({
        message: "Not this player's turn",
        statusCode: 400,
      }),
    }));
    expect(runtime.liveTestGameTasks.has('game-loop-error')).toBe(false);
  });

  test('runMlTestGameStep continues after a transient live turn rejection', async () => {
    const mongoose = require('mongoose');
    const setupHandler = extractPostHandler(setupRoute);
    const readyHandler = extractPostHandler(readyRoute);
    await runtime.ensureLoaded();

    jest.spyOn(runtime, 'scheduleMlTestGame').mockResolvedValue(false);

    const run = runtime.createRunRecord({
      id: 'run-live-turn-retry',
      label: 'Live Retry Run',
      config: createSmallRunConfig(),
    });
    run.status = 'completed';
    runtime.state.runs.push(run);

    const humanUserId = new mongoose.Types.ObjectId().toString();
    const launched = await runtime.startTestGame({
      runId: run.id,
      generation: 0,
      userId: humanUserId,
      username: 'Admin',
      sidePreference: 'black',
    });

    const mlTestConfig = runtime.liveTestGameConfigs.get(launched.gameId);
    expect(mlTestConfig).toBeTruthy();

    await expect(runtime.runMlTestGameStep(launched.gameId)).resolves.toBe(true);

    let liveGame = await GameModel.findById(launched.gameId).lean();
    expect(liveGame.setupComplete?.[WHITE]).toBe(true);

    const humanSetup = await buildDeterministicSetupFromGame(liveGame, BLACK);
    const humanSession = createInternalSession(humanUserId, 'Admin', {
      isGuest: false,
      isBot: false,
    });
    await callRoutePostHandler(setupHandler, {
      gameId: launched.gameId,
      color: BLACK,
      pieces: humanSetup.pieces,
      onDeck: humanSetup.onDeck,
    }, humanSession);

    await expect(runtime.runMlTestGameStep(launched.gameId)).resolves.toBe(true);

    await callRoutePostHandler(readyHandler, {
      gameId: launched.gameId,
      color: BLACK,
    }, humanSession);

    liveGame = await GameModel.findById(launched.gameId).lean();
    expect(liveGame.playersReady?.[WHITE]).toBe(true);
    expect(liveGame.playersReady?.[BLACK]).toBe(true);

    const originalFindById = GameModel.findById.bind(GameModel);
    const chooseSpy = jest.spyOn(runtime, 'chooseActionForParticipant');
    let targetedFindCall = 0;
    jest.spyOn(GameModel, 'findById').mockImplementation((id, ...args) => {
      if (String(id) !== launched.gameId) {
        return originalFindById(id, ...args);
      }
      targetedFindCall += 1;
      const result = originalFindById(id, ...args);
      if (targetedFindCall === 2) {
        return Promise.resolve(result).then((doc) => {
          if (doc) {
            const copy = typeof doc.toObject === 'function'
              ? doc.toObject()
              : JSON.parse(JSON.stringify(doc));
            copy.playerTurn = BLACK;
            return copy;
          }
          return doc;
        });
      }
      return result;
    });

    await expect(runtime.runMlTestGameStep(launched.gameId)).resolves.toBe(true);

    liveGame = await GameModel.findById(launched.gameId).lean();
    expect(chooseSpy).toHaveBeenCalledTimes(1);
    expect(targetedFindCall).toBeGreaterThanOrEqual(4);
    expect(liveGame.moves.length).toBeGreaterThan(0);
    expect(liveGame.playerTurn).toBe(BLACK);
    expect(liveGame.isActive).toBe(true);
  });

  test('promoted bot catalog can enable a generation for the normal bot flow', async () => {
    const mongoose = require('mongoose');
    await runtime.ensureLoaded();

    const run = runtime.createRunRecord({
      id: 'run-bot-catalog',
      label: 'Catalog Run',
      config: createSmallRunConfig(),
    });
    run.status = 'completed';
    runtime.state.runs.push(run);

    const initialCatalog = await runtime.getPromotedBotCatalog();
    expect(initialCatalog.items.map((item) => item.id)).toContain('generation:run-bot-catalog:0');
    expect(initialCatalog.enabledCount).toBe(0);

    const updatedCatalog = await runtime.updatePromotedBotCatalog(['generation:run-bot-catalog:0']);
    expect(updatedCatalog.enabledIds).toEqual(['generation:run-bot-catalog:0']);

    const publicCatalog = await runtime.listEnabledPromotedBotCatalog();
    expect(publicCatalog).toHaveLength(1);
    expect(publicCatalog[0]).toMatchObject({
      id: 'generation:run-bot-catalog:0',
      label: 'Catalog Run G0',
      playable: true,
    });

    const humanUserId = new mongoose.Types.ObjectId().toString();
    const launched = await runtime.startPromotedBotGame({
      botId: 'generation:run-bot-catalog:0',
      userId: humanUserId,
      username: 'GuestOne',
    });

    expect(launched.status).toBe('matched');
    expect(launched.botId).toBe('generation:run-bot-catalog:0');
    const latestGame = await GameModel.findById(launched.gameId).lean();
    expect(latestGame).toBeTruthy();
    expect(runtime.liveTestGameConfigs.get(launched.gameId)?.botId).toBe('generation:run-bot-catalog:0');
  });

  test('terminal runs can be deleted while active runs are protected', async () => {
    const started = await runtime.startRun(createSmallRunConfig({
      label: 'deletable-run',
      maxGenerations: 5,
      maxSelfPlayGames: 20,
      maxTrainingSteps: 20,
    }));

    const activeDelete = await runtime.deleteRun(started.run.id);
    expect(activeDelete).toMatchObject({
      deleted: false,
      reason: 'run_active',
    });

    const stop = await runtime.stopRun(started.run.id);
    expect(stop.stopped).toBe(true);

    await waitFor(() => {
      const run = runtime.getRunById(started.run.id);
      return Boolean(run && ['stopped', 'completed', 'error'].includes(run.status));
    }, 30000);

    const deleted = await runtime.deleteRun(started.run.id);
    expect(deleted).toEqual({
      deleted: true,
      id: started.run.id,
    });
    expect(runtime.getRunById(started.run.id)).toBeNull();
  });

  test('only one active continuous run is allowed at a time', async () => {
    const first = await runtime.startRun(createSmallRunConfig({
      label: 'first-run',
      maxGenerations: 5,
      maxSelfPlayGames: 20,
      maxTrainingSteps: 20,
    }));
    expect(first.run).toBeTruthy();

    await expect(runtime.startRun(createSmallRunConfig({
      label: 'second-run',
      maxGenerations: 5,
      maxSelfPlayGames: 20,
      maxTrainingSteps: 20,
    }))).rejects.toMatchObject({
      statusCode: 409,
      code: 'active_run_conflict',
    });

    const forced = await runtime.startRun(createSmallRunConfig({
      label: 'second-run',
      forceStopOtherRuns: true,
      maxGenerations: 1,
      maxSelfPlayGames: 3,
      maxTrainingSteps: 6,
    }));
    expect(forced.run).toBeTruthy();
    expect(forced.run.id).not.toBe(first.run.id);
    expect(runtime.getRunById(forced.run.id)).toBeTruthy();
  });

  test('a stop-pending run does not block starting a replacement run', async () => {
    const first = await runtime.startRun(createSmallRunConfig({
      label: 'stop-pending-first',
      maxGenerations: 5,
      maxSelfPlayGames: 20,
      maxTrainingSteps: 20,
    }));
    expect(first.run).toBeTruthy();

    const stop = await runtime.stopRun(first.run.id);
    expect(stop.stopped).toBe(true);
    expect(runtime.getRunById(first.run.id).status).toBe('stopping');

    const second = await runtime.startRun(createSmallRunConfig({
      label: 'stop-pending-second',
      maxGenerations: 1,
      maxSelfPlayGames: 3,
      maxTrainingSteps: 6,
    }));
    expect(second.run).toBeTruthy();
    expect(second.run.id).not.toBe(first.run.id);
    expect(runtime.getRunById(second.run.id).status).toBe('running');
    expect(runtime.getRunById(first.run.id).status).toBe('stopping');
  });

  test('evaluation uses a baseline gate before ordered prior-promotion tests', async () => {
    const run = runtime.createRunRecord({
      label: 'gate-run',
      config: createSmallRunConfig({
        prePromotionTestGames: 10,
        prePromotionTestWinRate: 0.55,
        promotionTestGames: 20,
        promotionTestWinRate: 0.55,
        promotionTestPriorGenerations: 3,
      }),
    });
    for (let generation = 1; generation <= 5; generation += 1) {
      run.generations.push(runtime.createRunGenerationRecord(run, {
        generation,
        label: `G${generation}`,
        source: generation === 5 ? 'promoted' : 'selfplay',
        approved: true,
        isBest: generation === 5,
        modelBundle: createDefaultModelBundle({ seed: 100 + generation }),
      }));
    }
    run.bestGeneration = 5;
    run.workerGeneration = 5;
    run.evaluationTargetGeneration = 0;

    const candidateGeneration = runtime.createRunGenerationRecord(run, {
      generation: 6,
      label: 'G6',
      source: 'candidate',
      approved: false,
      modelBundle: createDefaultModelBundle({ seed: 123 }),
    });

    const stagedPools = {
      baseline: { wins: 7, losses: 3 },
      promotion5: { wins: 12, losses: 8 },
      promotion4: { wins: 12, losses: 8 },
      promotion3: { wins: 12, losses: 8 },
    };
    const consumeGames = (poolKey, count, blackGeneration) => {
      const pool = stagedPools[poolKey];
      const games = [];
      const winsToTake = Math.min(pool.wins, count);
      for (let index = 0; index < winsToTake; index += 1) {
        games.push({
          id: `${poolKey}-win-${pool.wins}-${index}`,
          winner: WHITE,
          whiteGeneration: 6,
          blackGeneration,
        });
      }
      pool.wins -= winsToTake;
      const lossesToTake = Math.min(pool.losses, count - winsToTake);
      for (let index = 0; index < lossesToTake; index += 1) {
        games.push({
          id: `${poolKey}-loss-${pool.losses}-${index}`,
          winner: BLACK,
          whiteGeneration: 6,
          blackGeneration,
        });
      }
      pool.losses -= lossesToTake;
      return games;
    };
    const playSpy = jest.spyOn(runtime, 'playRunGenerationGames').mockImplementation(async (_run, options) => {
      expect(options.whiteGeneration).toBe(6);
      if (options.blackGeneration === 0) {
        return consumeGames('baseline', options.gameCount, 0);
      }
      if (options.blackGeneration === 5) {
        return consumeGames('promotion5', options.gameCount, 5);
      }
      if (options.blackGeneration === 4) {
        return consumeGames('promotion4', options.gameCount, 4);
      }
      return consumeGames('promotion3', options.gameCount, 3);
    });
    jest.spyOn(runtime, 'retainRunGames').mockImplementation(() => {});

    const evaluation = await runtime.evaluateRunGeneration(run, candidateGeneration, { cancelRequested: false });

    expect(playSpy.mock.calls.length).toBeGreaterThan(5);
    expect(evaluation.gen0Info.generation).toBe(0);
    expect(evaluation.gen0Info.games).toBe(10);
    expect(evaluation.gen0Info.winRate).toBe(0.7);
    expect(evaluation.baselinePassed).toBe(true);
    expect(evaluation.targetGeneration).toBe(0);
    expect(evaluation.targetAdvanced).toBe(false);
    expect(evaluation.prePromotionTest).toBeNull();
    expect(evaluation.promotionTests).toHaveLength(3);
    expect(evaluation.promotionTests.map((entry) => entry.generation)).toEqual([5, 4, 3]);
    expect(evaluation.promotionTests.every((entry) => entry.games === 20)).toBe(true);
    expect(evaluation.promotionTests.every((entry) => entry.winRate === 0.6)).toBe(true);
    expect(evaluation.promotionTests.every((entry) => entry.passed)).toBe(true);
    expect(evaluation.promoted).toBe(true);
    expect(evaluation.againstBest?.generation).toBe(5);
    expect(Array.isArray(evaluation.tooltipSections)).toBe(true);
    expect(evaluation.tooltipSections).toHaveLength(4);
  });

  test('evaluation stops promotion testing after the first failed promotion opponent', async () => {
    const run = runtime.createRunRecord({
      label: 'promotion-short-circuit',
      config: createSmallRunConfig({
        prePromotionTestGames: 10,
        prePromotionTestWinRate: 0.55,
        promotionTestGames: 20,
        promotionTestWinRate: 0.55,
        promotionTestPriorGenerations: 3,
      }),
    });
    for (let generation = 1; generation <= 5; generation += 1) {
      run.generations.push(runtime.createRunGenerationRecord(run, {
        generation,
        label: `G${generation}`,
        source: generation === 5 ? 'promoted' : 'selfplay',
        approved: true,
        isBest: generation === 5,
        modelBundle: createDefaultModelBundle({ seed: 300 + generation }),
      }));
    }
    run.bestGeneration = 5;
    run.workerGeneration = 5;
    run.evaluationTargetGeneration = 0;

    const candidateGeneration = runtime.createRunGenerationRecord(run, {
      generation: 6,
      label: 'G6',
      source: 'candidate',
      approved: false,
      modelBundle: createDefaultModelBundle({ seed: 456 }),
    });

    const stagedPools = {
      baseline: { wins: 7, losses: 3, calls: 0 },
      promotion5: { wins: 8, losses: 12, calls: 0 },
      promotion4: { wins: 12, losses: 8, calls: 0 },
      promotion3: { wins: 12, losses: 8, calls: 0 },
    };
    const consumeGames = (poolKey, count, blackGeneration) => {
      const pool = stagedPools[poolKey];
      pool.calls += 1;
      const games = [];
      const winsToTake = Math.min(pool.wins, count);
      for (let index = 0; index < winsToTake; index += 1) {
        games.push({
          id: `${poolKey}-win-${pool.calls}-${index}`,
          winner: WHITE,
          whiteGeneration: 6,
          blackGeneration,
        });
      }
      pool.wins -= winsToTake;
      const lossesToTake = Math.min(pool.losses, count - winsToTake);
      for (let index = 0; index < lossesToTake; index += 1) {
        games.push({
          id: `${poolKey}-loss-${pool.calls}-${index}`,
          winner: BLACK,
          whiteGeneration: 6,
          blackGeneration,
        });
      }
      pool.losses -= lossesToTake;
      return games;
    };

    jest.spyOn(runtime, 'playRunGenerationGames').mockImplementation(async (_run, options) => {
      expect(options.whiteGeneration).toBe(6);
      if (options.blackGeneration === 0) {
        return consumeGames('baseline', options.gameCount, 0);
      }
      if (options.blackGeneration === 5) {
        return consumeGames('promotion5', options.gameCount, 5);
      }
      if (options.blackGeneration === 4) {
        return consumeGames('promotion4', options.gameCount, 4);
      }
      return consumeGames('promotion3', options.gameCount, 3);
    });
    jest.spyOn(runtime, 'retainRunGames').mockImplementation(() => {});

    const evaluation = await runtime.evaluateRunGeneration(run, candidateGeneration, { cancelRequested: false });

    expect(evaluation.baselinePassed).toBe(true);
    expect(evaluation.promoted).toBe(false);
    expect(evaluation.promotionTests).toHaveLength(1);
    expect(evaluation.promotionTests[0]).toMatchObject({
      generation: 5,
      games: 20,
      winRate: 0.4,
      passed: false,
    });
    expect(stagedPools.promotion5.calls).toBeGreaterThan(0);
    expect(stagedPools.promotion4.calls).toBe(0);
    expect(stagedPools.promotion3.calls).toBe(0);
  });

  test('promotion tests fall back to the baseline generation when the promoted lineage is too short', async () => {
    const run = runtime.createRunRecord({
      label: 'promotion-baseline-fallback',
      config: createSmallRunConfig({
        prePromotionTestGames: 10,
        prePromotionTestWinRate: 0.55,
        promotionTestGames: 10,
        promotionTestWinRate: 0.55,
        promotionTestPriorGenerations: 3,
      }),
    });
    for (let generation = 1; generation <= 2; generation += 1) {
      run.generations.push(runtime.createRunGenerationRecord(run, {
        generation,
        label: `G${generation}`,
        source: 'promoted',
        approved: true,
        isBest: generation === 2,
        modelBundle: createDefaultModelBundle({ seed: 200 + generation }),
      }));
    }
    run.bestGeneration = 2;
    run.workerGeneration = 2;
    run.evaluationTargetGeneration = 0;

    const playSpy = jest.spyOn(runtime, 'playRunGenerationGames').mockImplementation(async (_run, options) => {
      if (options.whiteGeneration === 3 && options.blackGeneration === 0) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `baseline-g3-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 3,
          blackGeneration: 0,
        }));
      }
      if (options.whiteGeneration === 3 && options.blackGeneration === 2) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `promotion-g2-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 3,
          blackGeneration: 2,
        }));
      }
      if (options.whiteGeneration === 3 && options.blackGeneration === 1) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `promotion-g1-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 3,
          blackGeneration: 1,
        }));
      }
      if (options.whiteGeneration === 3 && options.blackGeneration === 0) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `fallback-g0-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 3,
          blackGeneration: 0,
        }));
      }
      throw new Error(`unexpected matchup ${options.whiteGeneration}-${options.blackGeneration}`);
    });
    jest.spyOn(runtime, 'retainRunGames').mockImplementation(() => {});

    const candidateGeneration3 = runtime.createRunGenerationRecord(run, {
      generation: 3,
      label: 'G3',
      source: 'candidate',
      approved: false,
      modelBundle: createDefaultModelBundle({ seed: 303 }),
    });
    const evaluation = await runtime.evaluateRunGeneration(run, candidateGeneration3, { cancelRequested: false });

    expect(evaluation.baselinePassed).toBe(true);
    expect(evaluation.promoted).toBe(true);
    expect(evaluation.promotionTests.map((entry) => entry.generation)).toEqual([2, 1, 0]);
    expect(evaluation.promotionTests[0].isBaselineFallback).toBe(false);
    expect(evaluation.promotionTests[1].isBaselineFallback).toBe(false);
    expect(evaluation.promotionTests[2].isBaselineFallback).toBe(true);
    expect(evaluation.promotionTests.slice(2).map((entry) => entry.chartLabel)).toEqual([
      'promotion fallback 3 vs G0',
    ]);
    expect(playSpy).toHaveBeenCalledWith(run, expect.objectContaining({
      whiteGeneration: 3,
      blackGeneration: 2,
    }));
  });

  test('baseline target advances to the newly promoted generation after a perfect baseline sweep', async () => {
    const run = runtime.createRunRecord({
      label: 'baseline-advance',
      config: createSmallRunConfig({
        prePromotionTestGames: 10,
        prePromotionTestWinRate: 0.55,
        promotionTestGames: 10,
        promotionTestWinRate: 0.55,
        promotionTestPriorGenerations: 1,
      }),
    });
    for (let generation = 1; generation <= 3; generation += 1) {
      run.generations.push(runtime.createRunGenerationRecord(run, {
        generation,
        label: `G${generation}`,
        source: 'promoted',
        approved: true,
        isBest: generation === 3,
        modelBundle: createDefaultModelBundle({ seed: 200 + generation }),
      }));
    }
    run.bestGeneration = 3;
    run.workerGeneration = 3;
    run.evaluationTargetGeneration = 0;

    const playSpy = jest.spyOn(runtime, 'playRunGenerationGames').mockImplementation(async (_run, options) => {
      if (options.whiteGeneration === 4 && options.blackGeneration === 0) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `baseline-g4-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 4,
          blackGeneration: 0,
        }));
      }
      if (options.whiteGeneration === 4 && options.blackGeneration === 3) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `promotion-g3-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 4,
          blackGeneration: 3,
        }));
      }
      if (options.whiteGeneration === 5 && options.blackGeneration === 4) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `baseline-g5-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 5,
          blackGeneration: 4,
        }));
      }
      if (options.whiteGeneration === 5 && options.blackGeneration === 3) {
        return Array.from({ length: options.gameCount }, (_, index) => ({
          id: `promotion-g5-${options.gameCount}-${index}`,
          winner: WHITE,
          whiteGeneration: 5,
          blackGeneration: 3,
        }));
      }
      throw new Error(`unexpected matchup ${options.whiteGeneration}-${options.blackGeneration}`);
    });
    jest.spyOn(runtime, 'retainRunGames').mockImplementation(() => {});

    const candidateGeneration4 = runtime.createRunGenerationRecord(run, {
      generation: 4,
      label: 'G4',
      source: 'candidate',
      approved: false,
      modelBundle: createDefaultModelBundle({ seed: 304 }),
    });
    const evaluation4 = await runtime.evaluateRunGeneration(run, candidateGeneration4, { cancelRequested: false });
    runtime.applyRunGenerationEvaluation(run, candidateGeneration4, evaluation4);

    expect(evaluation4.gen0Info.generation).toBe(0);
    expect(evaluation4.gen0Info.games).toBe(10);
    expect(evaluation4.gen0Info.winRate).toBe(1);
    expect(evaluation4.baselinePassed).toBe(true);
    expect(evaluation4.promoted).toBe(true);
    expect(evaluation4.targetGeneration).toBe(0);
    expect(evaluation4.targetPerfectSweepStreak).toBe(1);
    expect(evaluation4.targetAdvanced).toBe(true);
    expect(evaluation4.targetAdvancedToGeneration).toBe(4);
    expect(run.evaluationTargetGeneration).toBe(4);

    const candidateGeneration5 = runtime.createRunGenerationRecord(run, {
      generation: 5,
      label: 'G5',
      source: 'candidate',
      approved: false,
      modelBundle: createDefaultModelBundle({ seed: 305 }),
    });
    const evaluation5 = await runtime.evaluateRunGeneration(run, candidateGeneration5, { cancelRequested: false });

    expect(evaluation5.gen0Info.generation).toBe(4);
    expect(evaluation5.gen0Info.games).toBe(10);
    expect(evaluation5.targetGeneration).toBe(4);
    expect(playSpy).toHaveBeenCalledWith(run, expect.objectContaining({
      whiteGeneration: 5,
      blackGeneration: 4,
    }));
  });

  test('evaluation emits partial progress updates while chunking the baseline and promotion batches', async () => {
    const run = runtime.createRunRecord({
      label: 'progress-run',
      config: createSmallRunConfig({
        prePromotionTestGames: 5,
        prePromotionTestWinRate: 1,
        promotionTestGames: 5,
        promotionTestWinRate: 1,
        promotionTestPriorGenerations: 1,
      }),
    });
    run.bestGeneration = 2;
    run.workerGeneration = 2;
    run.generations.push(runtime.createRunGenerationRecord(run, {
      generation: 1,
      label: 'G1',
      source: 'promoted',
      approved: true,
      isBest: false,
      modelBundle: createDefaultModelBundle({ seed: 411 }),
    }));
    run.generations.push(runtime.createRunGenerationRecord(run, {
      generation: 2,
      label: 'G2',
      source: 'promoted',
      approved: true,
      isBest: true,
      modelBundle: createDefaultModelBundle({ seed: 412 }),
    }));

    const candidateGeneration = runtime.createRunGenerationRecord(run, {
      generation: 3,
      label: 'G3',
      source: 'candidate',
      approved: false,
      modelBundle: createDefaultModelBundle({ seed: 413 }),
    });

    jest.spyOn(runtime, 'retainRunGames').mockImplementation(() => {});
    jest.spyOn(runtime, 'maybeSaveRunState').mockResolvedValue(false);
    jest.spyOn(runtime, 'playRunGenerationGames').mockImplementation(async (_run, options) => {
      const winner = options.blackGeneration === 0 ? WHITE : BLACK;
      return Array.from({ length: options.gameCount }, (_, index) => ({
        id: `progress-${options.whiteGeneration}-${options.blackGeneration}-${index}`,
        winner,
        whiteGeneration: options.whiteGeneration,
        blackGeneration: options.blackGeneration,
      }));
    });
    const emitSpy = jest.spyOn(runtime, 'emitRunProgress');

    const evaluation = await runtime.evaluateRunGeneration(run, candidateGeneration, { cancelRequested: false });

    const progressCalls = emitSpy.mock.calls
      .filter(([_, phase, overrides]) => phase === 'evaluation' && overrides?.evaluationProgress?.active);
    expect(progressCalls.length).toBeGreaterThanOrEqual(3);
    expect(progressCalls[0][2].evaluationProgress.stage).toBe('baseline');
    expect(progressCalls.some(([, , overrides]) => overrides?.evaluationProgress?.stage === 'promotion')).toBe(true);
    expect(run.working.evaluationProgress).toBeNull();
    expect(evaluation.baselinePassed).toBe(true);
    expect(evaluation.promoted).toBe(false);
  });

  test('continuous self-play emits partial progress updates while chunking long batches', async () => {
    jest.spyOn(runtime, 'playRunGenerationGames').mockImplementation(async (_run, options) => (
      Array.from({ length: options.gameCount }, (_, index) => ({
        id: `selfplay-progress-${options.gameIndexOffset || 0}-${index}`,
        createdAt: new Date(Date.now() + index).toISOString(),
        durationMs: 25,
        training: {
          policySamples: [],
          valueSamples: [],
          identitySamples: [],
        },
        replay: [],
      }))
    ));
    jest.spyOn(runtime, 'maybeSaveRunState').mockResolvedValue(false);
    const emitSpy = jest.spyOn(runtime, 'emitRunProgress');

    const started = await runtime.startRun(createSmallRunConfig({
      label: 'selfplay-progress-run',
      numSelfplayWorkers: 5,
      parallelGameWorkers: 4,
      batchSize: 999,
      checkpointInterval: 1000,
      stopOnMaxGenerations: false,
      stopOnMaxTrainingSteps: false,
      stopOnMaxSelfPlayGames: true,
      maxSelfPlayGames: 5,
    }));

    await waitFor(() => {
      const run = runtime.getRunById(started.run.id);
      return Boolean(run && ['completed', 'stopped', 'error'].includes(run.status));
    }, 5000);

    const progressCalls = emitSpy.mock.calls
      .filter(([_, phase, overrides]) => phase === 'selfplay' && overrides?.selfPlayProgress?.active);
    const completedCalls = progressCalls
      .filter(([_, __, overrides]) => Number(overrides?.selfPlayProgress?.completedGames || 0) > 0);
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(completedCalls[0][2].selfPlayProgress.completedGames).toBe(4);
    expect(completedCalls[0][2].selfPlayProgress.targetGames).toBe(5);
    expect(completedCalls[completedCalls.length - 1][2].selfPlayProgress.completedGames).toBe(5);
    expect(runtime.getRunById(started.run.id).working?.selfPlayProgress ?? null).toBeNull();
  });

  test('playRunGenerationGamesChunked can stream self-play chunks without retaining completed games', async () => {
    const run = runtime.createRunRecord({
      label: 'chunked-selfplay-streaming',
      config: createSmallRunConfig({
        parallelGameWorkers: 2,
      }),
    });
    const completedCounts = [];

    jest.spyOn(runtime, 'playRunGenerationGames').mockImplementation(async (_run, options) => (
      Array.from({ length: options.gameCount }, (_, index) => ({
        id: `stream-${options.gameIndexOffset || 0}-${index}`,
        createdAt: `2026-03-19T00:00:0${index}.000Z`,
        training: {
          policySamples: [{ sampleKey: `ply:${options.gameIndexOffset || 0}:${index}`, stateInput: [1], target: [1] }],
          valueSamples: [{ sampleKey: `ply:${options.gameIndexOffset || 0}:${index}`, stateInput: [1], target: 1 }],
          identitySamples: [{ sampleKey: `ply:${options.gameIndexOffset || 0}:${index}`, stateInput: [1], pieceSlot: 0, trueIdentityIndex: 0 }],
        },
      }))
    ));

    const games = await runtime.playRunGenerationGamesChunked(run, {
      phase: 'selfplay',
      collectGames: false,
      gameCount: 5,
      onChunk: async (_chunkGames, progress) => {
        completedCounts.push(progress.completedGames);
      },
    });

    expect(games).toEqual([]);
    expect(completedCounts).toEqual([2, 4, 5]);
  });

  test('continuous runs can overlap background training with the next self-play cycle', async () => {
    const run = runtime.createRunRecord({
      label: 'concurrent-training-run',
      config: createSmallRunConfig({
        batchSize: 1,
        checkpointInterval: 1000,
        stopOnMaxGenerations: false,
        stopOnMaxTrainingSteps: false,
        stopOnMaxSelfPlayGames: true,
        maxSelfPlayGames: 2,
        trainingBackend: 'auto',
        trainingDevicePreference: 'auto',
      }),
    });
    run.replayBuffer.summary = {
      positions: 1,
      maxPositions: run.config.replayBufferMaxPositions,
      totalPositionsSeen: 1,
      oldestGeneration: 0,
      newestGeneration: 0,
      freshness: 0,
      oldestAt: '2026-03-16T00:00:00.000Z',
      newestAt: '2026-03-16T00:00:00.000Z',
    };
    runtime.state.runs = [run];
    const taskState = {
      id: run.id,
      cancelRequested: false,
      killRequested: false,
      token: 1,
    };
    runtime.runTasks.set(run.id, taskState);
    const sequence = [];
    let selfPlayCalls = 0;

    jest.spyOn(runtime, 'canRunTrainingConcurrently').mockResolvedValue(true);
    jest.spyOn(runtime, 'playRunGenerationGamesChunked').mockImplementation(async (runRecord, options = {}) => {
      if (options.phase !== 'selfplay') {
        throw new Error(`unexpected phase ${options.phase}`);
      }
      selfPlayCalls += 1;
      sequence.push(taskState.trainingPromise ? `selfplay_${selfPlayCalls}_during_training` : `selfplay_${selfPlayCalls}`);
      runRecord.stats.totalSelfPlayGames = Number(runRecord.stats.totalSelfPlayGames || 0) + 1;
      if (typeof options.onChunk === 'function') {
        await options.onChunk([], {
          completedGames: 1,
          targetGames: 1,
        });
      }
      if (selfPlayCalls >= 2) {
        runRecord.status = 'stopping';
        taskState.cancelRequested = true;
      }
      return [];
    });
    jest.spyOn(runtime, 'trainRunWorkingModel').mockImplementation(async (runRecord, currentTaskState, options = {}) => {
      sequence.push(options.deferEvaluation === true ? 'training_background_started' : 'training_inline_started');
      await runtime.updateRunTrainingProgress(runRecord, {
        cycle: Number(runRecord.stats?.cycle || 0),
        completedSteps: 0,
        targetSteps: 1,
        checkpointIndex: Number(runRecord.working?.checkpointIndex || 0),
        background: options.deferEvaluation === true,
        trainingBackend: 'python',
        trainingDevice: 'cuda',
      });
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (runtime.shouldAbortRunTask(runRecord.id, currentTaskState)) {
        return [];
      }
      const loss = {
        step: Number(runRecord.stats.totalTrainingSteps || 0) + 1,
        policyLoss: 1,
        valueLoss: 1,
        identityLoss: 0,
        identityAccuracy: 0,
        trainingBackend: 'python',
        trainingDevice: 'cuda',
      };
      runRecord.working.lastLoss = loss;
      runRecord.stats.totalTrainingSteps = Number(runRecord.stats.totalTrainingSteps || 0) + 1;
      await runtime.updateRunTrainingProgress(runRecord, {
        cycle: Number(runRecord.stats?.cycle || 0),
        completedSteps: 1,
        targetSteps: 1,
        checkpointIndex: Number(runRecord.working?.checkpointIndex || 0),
        background: options.deferEvaluation === true,
        trainingBackend: 'python',
        trainingDevice: 'cuda',
        latestLoss: loss,
      });
      runtime.clearRunTrainingProgress(runRecord);
      sequence.push('training_finished');
      return [loss];
    });

    await runtime.runContinuousPipeline(run, taskState);

    expect(sequence).toContain('training_background_started');
    expect(sequence).toContain('selfplay_2_during_training');
    expect(run.stats.totalTrainingSteps).toBe(1);
    expect(run.working.trainingProgress).toBeNull();
    runtime.runTasks.delete(run.id);
  });

  test('evaluation series separates baseline and promotion opponents and uses circle diamond star markers', () => {
    const run = runtime.createRunRecord({
      label: 'series-shapes',
      config: createSmallRunConfig({
        promotionTestPriorGenerations: 2,
      }),
    });

    run.evaluationHistory.push(
      {
        candidateGeneration: 4,
        promoted: false,
        baselineInfo: {
          generation: 0,
          games: 50,
          wins: 50,
          losses: 0,
          draws: 0,
          winRate: 1,
        },
        baselinePassed: false,
        promotionTests: [],
      },
      {
        candidateGeneration: 5,
        promoted: false,
        baselineInfo: {
          generation: 1,
          games: 50,
          wins: 50,
          losses: 0,
          draws: 0,
          winRate: 1,
        },
        baselinePassed: true,
        promotionTests: [
          {
            generation: 4,
            games: 100,
            wins: 54,
            losses: 46,
            draws: 0,
            winRate: 0.54,
            passed: false,
            chartLabel: 'promotion vs G4',
            seriesKey: 'promotion:4',
          },
          {
            generation: 3,
            games: 100,
            wins: 60,
            losses: 40,
            draws: 0,
            winRate: 0.6,
            passed: true,
            chartLabel: 'promotion vs G3',
            seriesKey: 'promotion:3',
          },
        ],
      },
      {
        candidateGeneration: 6,
        promoted: true,
        baselineInfo: {
          generation: 1,
          games: 50,
          wins: 50,
          losses: 0,
          draws: 0,
          winRate: 1,
        },
        baselinePassed: true,
        promotionTests: [
          {
            generation: 5,
            games: 100,
            wins: 80,
            losses: 20,
            draws: 0,
            winRate: 0.8,
            passed: true,
            chartLabel: 'promotion vs G5',
            seriesKey: 'promotion:5',
          },
          {
            generation: 4,
            games: 100,
            wins: 76,
            losses: 24,
            draws: 0,
            winRate: 0.76,
            passed: true,
            chartLabel: 'promotion vs G4',
            seriesKey: 'promotion:4',
          },
        ],
      }
    );

    const series = runtime.buildRunEvaluationSeries(run);

    expect(series.map((entry) => entry.label)).toEqual([
      'baseline vs G0',
      'baseline vs G1',
      'promotion vs G3',
      'promotion vs G4',
      'promotion vs G5',
    ]);
    expect(series.find((entry) => entry.label === 'promotion vs G4')).toMatchObject({
      color: '#7fd2de',
      lineStyle: 'none',
    });
    expect(series.find((entry) => entry.label === 'baseline vs G0').points[0].markerShape).toBe('circle');
    expect(series.find((entry) => entry.label === 'baseline vs G1').points.map((point) => point.markerShape)).toEqual([
      'diamond',
      'star',
    ]);
    expect(series.find((entry) => entry.label === 'promotion vs G4').points.map((point) => point.markerShape)).toEqual([
      'circle',
      'star',
    ]);
  });

  test('hidden-info search does not depend on unrevealed ground-truth identities', () => {
    const truthfulState = createPendingChallengeState(IDENTITIES.BISHOP);
    const bluffState = createPendingChallengeState(IDENTITIES.ROOK);
    const modelBundle = createDefaultModelBundle({ seed: 1301 });

    const truthfulSearch = runHiddenInfoMcts(modelBundle, truthfulState, {
      rootPlayer: WHITE,
      iterations: 64,
      maxDepth: 8,
      hypothesisCount: 4,
      riskBias: 0,
      exploration: 1.5,
      seed: 1701,
    });
    const bluffSearch = runHiddenInfoMcts(modelBundle, bluffState, {
      rootPlayer: WHITE,
      iterations: 64,
      maxDepth: 8,
      hypothesisCount: 4,
      riskBias: 0,
      exploration: 1.5,
      seed: 1701,
    });

    expect(actionKey(truthfulSearch.action)).toBe(actionKey(bluffSearch.action));
    expect(truthfulSearch.valueEstimate).toBeCloseTo(bluffSearch.valueEstimate, 8);
    expect(truthfulSearch.trace.algorithm).toBe('ismcts');
    expect(bluffSearch.trace.algorithm).toBe('ismcts');
  });

  test('hidden-info search rebuilds root policy features when shared-tree reuse left a missing entry', () => {
    const state = createInitialState({ seed: 19001, maxPlies: 80 });
    const modelBundle = createDefaultModelBundle({ seed: 19002 });
    const searchCache = createSearchCache();

    const firstSearch = runHiddenInfoMcts(modelBundle, state, {
      rootPlayer: WHITE,
      iterations: 16,
      maxDepth: 6,
      hypothesisCount: 3,
      riskBias: 0,
      exploration: 1.25,
      seed: 19003,
      searchCache,
    });

    const rootActionKeys = firstSearch.trainingRecord?.policy?.actionKeys || [];
    expect(rootActionKeys.length).toBeGreaterThan(0);
    delete firstSearch.root.policyFeaturesByActionKey[rootActionKeys[0]];

    const secondSearch = runHiddenInfoMcts(modelBundle, state, {
      rootPlayer: WHITE,
      iterations: 16,
      maxDepth: 6,
      hypothesisCount: 3,
      riskBias: 0,
      exploration: 1.25,
      seed: 19003,
      searchCache,
    });

    expect(secondSearch.trainingRecord.policy.features).toHaveLength(rootActionKeys.length);
    secondSearch.trainingRecord.policy.features.forEach((vector) => {
      expect(Array.isArray(vector)).toBe(true);
      expect(vector.length).toBeGreaterThan(0);
    });
  });

  test('playRunGenerationGames supports parallel game workers with unique ids', async () => {
    const run = runtime.createRunRecord({
      label: 'parallel-games',
      config: createSmallRunConfig({
        numSelfplayWorkers: 2,
        parallelGameWorkers: 2,
      }),
    });

    const games = await runtime.playRunGenerationGames(run, {
      phase: 'selfplay',
      whiteGeneration: 0,
      blackGeneration: 0,
      gameCount: 2,
      checkpointIndex: 0,
    });

    expect(games).toHaveLength(2);
    expect(new Set(games.map((game) => game.id)).size).toBe(2);
    games.forEach((game) => {
      expect(game.setupMode).toBe('engine-fast');
      expect(Array.isArray(game.replay)).toBe(true);
      expect(game.replay.length).toBeGreaterThan(1);
      const firstDecisionFrame = game.replay.find((frame) => frame?.decision?.trace?.fastPath);
      expect(firstDecisionFrame?.decision?.trace?.algorithm).toBe('ismcts');
      expect(firstDecisionFrame?.decision?.trace?.fastPath).toMatchObject({
        adaptiveSearchApplied: true,
      });
      expect(firstDecisionFrame?.decision?.trace?.legalActionSummary?.total).toBeGreaterThan(0);
      expect(firstDecisionFrame?.decision?.trace?.policyCoverage).toMatchObject({
        totalLegalActions: expect.any(Number),
        mappedPolicyActions: expect.any(Number),
        unmappedLegalActions: expect.any(Number),
      });
    });
  });

  test('playRunGenerationGames keeps unique ids after the game counter passes 100000', async () => {
    const run = runtime.createRunRecord({
      label: 'parallel-games-high-counter',
      config: createSmallRunConfig({
        numSelfplayWorkers: 2,
        parallelGameWorkers: 2,
      }),
    });
    runtime.state.counters.game = 100000;

    const games = await runtime.playRunGenerationGames(run, {
      phase: 'selfplay',
      whiteGeneration: 0,
      blackGeneration: 0,
      gameCount: 2,
      checkpointIndex: 0,
    });

    expect(games).toHaveLength(2);
    expect(games.map((game) => game.id)).toEqual(['game-100000', 'game-100001']);
    expect(new Set(games.map((game) => game.id)).size).toBe(2);
  });

  test('playRunGenerationGames preserves evaluation phase and keeps root sampling deterministic', async () => {
    const run = runtime.createRunRecord({
      label: 'evaluation-phase-games',
      config: createSmallRunConfig({
        numSelfplayWorkers: 2,
        parallelGameWorkers: 2,
      }),
    });

    const games = await runtime.playRunGenerationGames(run, {
      phase: 'evaluation',
      whiteGeneration: 0,
      blackGeneration: 0,
      gameCount: 2,
      checkpointIndex: 0,
    });

    expect(games).toHaveLength(2);
    games.forEach((game) => {
      expect(game.phase).toBe('evaluation');
      const firstDecisionFrame = game.replay.find((frame) => frame?.decision?.trace?.fastPath);
      expect(firstDecisionFrame?.decision?.trace?.fastPath?.stochasticRoot).toBe(false);
    });
  });

  test('playRunGenerationGames falls back to sequential execution after a worker timeout', async () => {
    const run = runtime.createRunRecord({
      label: 'timeout-fallback-games',
      config: createSmallRunConfig({
        numSelfplayWorkers: 2,
        parallelGameWorkers: 2,
      }),
    });

    const timeoutError = new Error('Parallel worker task timed out after 1000ms (playGame:game-timeout)');
    timeoutError.code = 'ML_WORKER_TASK_TIMEOUT';
    jest.spyOn(runtime.parallelTaskPool, 'runTasks').mockRejectedValueOnce(timeoutError);
    const runSingleGameFastSpy = jest.spyOn(runtime, 'runSingleGameFast').mockImplementation(async (options = {}) => ({
      id: options.gameId || 'game-timeout-fallback',
      createdAt: new Date().toISOString(),
      durationMs: 5,
      seed: options.seed,
      phase: options.phase || 'evaluation',
      setupMode: 'engine-fast',
      whiteParticipantId: 'generation:test:0',
      blackParticipantId: 'generation:test:0',
      whiteParticipantLabel: 'G0',
      blackParticipantLabel: 'G0',
      winner: null,
      winReason: null,
      plies: 2,
      replay: [{ ply: 0, board: [] }, { ply: 1, board: [] }],
      decisions: [],
      training: {
        policySamples: [],
        valueSamples: [],
        identitySamples: [],
      },
      actionHistory: [],
      moveHistory: [],
    }));

    const games = await runtime.playRunGenerationGames(run, {
      phase: 'evaluation',
      whiteGeneration: 0,
      blackGeneration: 0,
      gameCount: 2,
      checkpointIndex: 0,
    });

    expect(games).toHaveLength(2);
    expect(runSingleGameFastSpy).toHaveBeenCalledTimes(2);
    games.forEach((game) => {
      expect(game.phase).toBe('evaluation');
      expect(game.setupMode).toBe('engine-fast');
    });
  });

  test('self-play fast games vary openings across seeds', async () => {
    const modelBundle = createDefaultModelBundle({ seed: 51, modelSizePreset: '32k' });
    const participant = {
      id: 'generation:test:0',
      type: 'generation',
      label: 'G0',
      generation: 0,
      runId: 'test',
      modelBundle,
    };
    const games = [];
    for (let index = 0; index < 5; index += 1) {
      games.push(await runFastGame({
        gameId: `seed-variation-${index}`,
        phase: 'selfplay',
        whiteParticipant: participant,
        blackParticipant: participant,
        seed: 7000 + index,
        iterations: 8,
        maxDepth: 6,
        hypothesisCount: 2,
        riskBias: 0,
        exploration: 1.25,
        maxPlies: 16,
        adaptiveSearch: true,
      }));
    }

    const openingBoards = new Set(games.map((game) => JSON.stringify(game.replay?.[0]?.board || [])));
    const openingActions = new Set(games.map((game) => game.decisions?.[0]?.action?._key || null));

    expect(openingBoards.size).toBeGreaterThan(1);
    expect(openingActions.size).toBeGreaterThan(1);
    games.forEach((game) => {
      expect(game.phase).toBe('selfplay');
      expect(game.decisions?.[0]?.trace?.rootSelection?.stochastic).toBe(true);
    });
  });

  test('run diagnostics flag repeated setups and opening prefixes', () => {
    const run = runtime.createRunRecord({
      label: 'diagnostic-repetition',
      config: createSmallRunConfig(),
    });
    run.bestGeneration = 1;
    run.retainedGames = Array.from({ length: 10 }, (_, index) => createDiagnosticRetainedGame({
      id: `repeat-${index}`,
      setupIndex: 0,
      whiteGeneration: 1,
      blackGeneration: 1,
      sequence: [
        { type: 'MOVE', declaration: IDENTITIES.ROOK },
        { type: 'MOVE', declaration: IDENTITIES.BISHOP },
      ],
      legalSummaries: [
        { total: 3, move: 1, challenge: 1, bomb: 1 },
        { total: 2, move: 1, challenge: 1 },
      ],
    }));

    const diagnostics = runtime.summarizeRunDiagnostics(run);
    const codes = diagnostics.checks.map((check) => check.code);

    expect(diagnostics.openings.uniqueStartingSetups).toBe(1);
    expect(diagnostics.openings.uniqueFirstMoves).toBe(1);
    expect(codes).toEqual(expect.arrayContaining([
      'low_setup_variety',
      'low_first_move_variety',
      'repeated_opening_prefix',
      'repeated_full_sequences',
    ]));
  });

  test('run diagnostics count simple-action legal and chosen coverage', () => {
    const run = runtime.createRunRecord({
      label: 'diagnostic-simple-actions',
      config: createSmallRunConfig(),
    });
    run.retainedGames = [
      createDiagnosticRetainedGame({
        id: 'diag-challenge',
        setupIndex: 0,
        sequence: [{ type: 'CHALLENGE' }],
        legalSummaries: [{ total: 2, challenge: 1, move: 1 }],
      }),
      createDiagnosticRetainedGame({
        id: 'diag-bomb',
        setupIndex: 1,
        sequence: [{ type: 'BOMB' }],
        legalSummaries: [{ total: 2, challenge: 1, bomb: 1 }],
      }),
      createDiagnosticRetainedGame({
        id: 'diag-pass',
        setupIndex: 2,
        sequence: [{ type: 'PASS' }],
        legalSummaries: [{ total: 2, challenge: 1, pass: 1 }],
      }),
      createDiagnosticRetainedGame({
        id: 'diag-ondeck',
        setupIndex: 3,
        sequence: [{ type: 'ON_DECK', identity: IDENTITIES.BISHOP, player: WHITE }],
        legalSummaries: [{ total: 1, onDeck: 1 }],
      }),
    ];

    const diagnostics = runtime.summarizeRunDiagnostics(run);

    expect(diagnostics.actions.legalCounts.challenge).toBe(3);
    expect(diagnostics.actions.legalCounts.bomb).toBe(1);
    expect(diagnostics.actions.legalCounts.pass).toBe(1);
    expect(diagnostics.actions.legalCounts.onDeck).toBe(1);
    expect(diagnostics.actions.chosenCounts.challenge).toBe(1);
    expect(diagnostics.actions.chosenCounts.bomb).toBe(1);
    expect(diagnostics.actions.chosenCounts.pass).toBe(1);
    expect(diagnostics.actions.chosenCounts.onDeck).toBe(1);
    expect(diagnostics.actions.choiceRatesWhenLegal.bomb).toBeCloseTo(1, 8);
    expect(diagnostics.actions.choiceRatesWhenLegal.pass).toBeCloseTo(1, 8);
    expect(diagnostics.actions.choiceRatesWhenLegal.onDeck).toBeCloseTo(1, 8);
    expect(diagnostics.actions.policyCoverage.unmappedLegalActions).toBe(0);
  });

  test('run diagnostics flag missing replay and batch value samples', () => {
    const run = runtime.createRunRecord({
      label: 'diagnostic-missing-value',
      config: createSmallRunConfig(),
    });
    run.replayBuffer.policySamples = Array.from({ length: 12 }, (_, index) => ({ sampleKey: `p-${index}` }));
    run.replayBuffer.valueSamples = [];
    run.replayBuffer.identitySamples = Array.from({ length: 3 }, (_, index) => ({ sampleKey: `i-${index}` }));
    run.working.lastLoss = {
      policyLoss: 1.5,
      valueLoss: 0,
      identityLoss: 0.5,
      policySamples: 4,
      valueSamples: 0,
      identitySamples: 2,
    };

    const diagnostics = runtime.summarizeRunDiagnostics(run);
    const codes = diagnostics.checks.map((check) => check.code);

    expect(codes).toEqual(expect.arrayContaining([
      'missing_value_targets',
      'latest_batch_missing_value_samples',
    ]));
  });

  test('run diagnostics treat compacted terminal replay counts as unknown instead of missing', () => {
    const run = runtime.createRunRecord({
      label: 'diagnostic-compacted-replay',
      config: createSmallRunConfig(),
    });
    run.status = 'completed';
    run.replayBuffer = {
      maxPositions: 32,
      totalPositionsSeen: 12,
      evictedPositions: 0,
      summary: {
        positions: 12,
        maxPositions: 32,
        totalPositionsSeen: 12,
      },
      policySamples: [],
      valueSamples: [],
      identitySamples: [],
    };

    const diagnostics = runtime.summarizeRunDiagnostics(run);
    const codes = diagnostics.checks.map((check) => check.code);

    expect(diagnostics.replayTargets.countsCompacted).toBe(true);
    expect(diagnostics.replayTargets.policySamples).toBe(12);
    expect(diagnostics.replayTargets.valueSamples).toBeNull();
    expect(codes).not.toContain('missing_value_targets');
  });

  test('shared policy slots cover challenge, bomb, pass, and on-deck actions', () => {
    const challengeState = createPendingChallengeState(IDENTITIES.ROOK);
    const challengeLegal = getLegalActions(challengeState, WHITE);
    const challengeAction = challengeLegal.find((action) => action.type === 'CHALLENGE');
    const bombAction = challengeLegal.find((action) => action.type === 'BOMB');

    expect(challengeAction).toBeTruthy();
    expect(bombAction).toBeTruthy();
    expect(Number.isFinite(getPolicySlotForAction(challengeState, WHITE, challengeAction))).toBe(true);
    expect(Number.isFinite(getPolicySlotForAction(challengeState, WHITE, bombAction))).toBe(true);

    const bombState = applyAction(challengeState, bombAction);
    const bombResponder = bombState.playerTurn;
    const bombResponseLegal = getLegalActions(bombState, bombResponder);
    const passAction = bombResponseLegal.find((action) => action.type === 'PASS');

    expect(passAction).toBeTruthy();
    expect(Number.isFinite(getPolicySlotForAction(bombState, bombResponder, passAction))).toBe(true);

    const onDeckState = createInitialState({ seed: 2337, maxPlies: 60 });
    onDeckState.onDeckingPlayer = WHITE;
    onDeckState.playerTurn = WHITE;
    onDeckState.toMove = WHITE;
    const onDeckLegal = getLegalActions(onDeckState, WHITE);

    expect(onDeckLegal.every((action) => action.type === 'ON_DECK')).toBe(true);
    expect(mapLegalActionsToPolicySlots(onDeckState, WHITE, onDeckLegal)).toHaveLength(onDeckLegal.length);
    expect(Number.isFinite(getPolicySlotForAction(onDeckState, WHITE, onDeckLegal[0]))).toBe(true);
  });

  test('fast self-play reuses shared ISMCTS trees per participant across plies', async () => {
    const run = runtime.createRunRecord({
      label: 'shared-tree-fast-game',
      config: createSmallRunConfig(),
    });

    const game = await runtime.runSingleGameFast({
      whiteParticipant: runtime.createGenerationParticipant(run, 0),
      blackParticipant: runtime.createGenerationParticipant(run, 0),
      seed: 6262,
      iterations: 6,
      maxDepth: 4,
      hypothesisCount: 3,
      riskBias: 0,
      exploration: 1.25,
      maxPlies: 16,
      adaptiveSearch: true,
    });

    const searchFrames = game.replay.filter((frame) => frame?.decision?.trace?.sharedTree);
    expect(searchFrames.length).toBeGreaterThan(1);
    const totalNodeCounts = searchFrames.map((frame) => Number(frame.decision.trace.sharedTree.totalNodeCount || 0));
    expect(totalNodeCounts.some((count, index) => index > 0 && count >= totalNodeCounts[index - 1])).toBe(true);
  });

  test('trainRunWorkingModel advances a shared-family CPU training step when Python is not used', async () => {
    const run = runtime.createRunRecord({
      label: 'cpu-training-step',
      config: createSmallRunConfig({
        checkpointInterval: 100,
      }),
    });
    const participant = runtime.createGenerationParticipant(run, 0);
    const game = await runFastGame({
      whiteParticipant: participant,
      blackParticipant: participant,
      maxTurns: 8,
      mlTrainingMode: true,
      mctsConfig: {
        numSimulations: 8,
        maxDepth: 6,
        hypothesisCount: 2,
      },
    });

    const filteredTraining = runtime.filterRunTrainingSamplesByGeneration(game.training, 0);
    runtime.appendRunReplayBuffer(run, filteredTraining, {
      generation: 0,
      createdAt: game.createdAt,
    });

    const taskState = {
      id: run.id,
      cancelRequested: false,
      killRequested: false,
    };
    runtime.runTasks.set(run.id, taskState);
    const losses = await runtime.trainRunWorkingModel(run, taskState);
    runtime.runTasks.delete(run.id);

    expect(losses).toHaveLength(1);
    expect(run.stats.totalTrainingSteps).toBe(1);
    expect(run.working.lastLoss).toMatchObject({
      step: 1,
    });
  });

  test('runSingleGame keeps the requested action key available for live-route fallback logging', async () => {
    const run = runtime.createRunRecord({
      label: 'requested-key-regression',
      config: createSmallRunConfig(),
    });
    const chooseSpy = jest.spyOn(runtime, 'chooseActionForParticipant').mockImplementation((_participant, observationState) => {
      const legalActions = getLegalActions(observationState, observationState.playerTurn);
      const action = legalActions[0];
      return {
        action,
        trace: {
          actionStats: [{ actionKey: actionKey(action) }],
        },
        valueEstimate: 0,
        trainingRecord: {
          player: observationState.playerTurn,
        },
      };
    });

    const game = await runtime.runSingleGame({
      whiteParticipant: runtime.createGenerationParticipant(run, 0),
      blackParticipant: runtime.createGenerationParticipant(run, 0),
      seed: 5252,
      iterations: 2,
      maxDepth: 3,
      hypothesisCount: 2,
      riskBias: 0,
      exploration: 1.25,
      maxPlies: 12,
    });

    const firstDecision = game.replay.find((frame) => frame?.decision?.trainingRecord);
    expect(chooseSpy).toHaveBeenCalled();
    expect(firstDecision?.decision?.trace?.liveRoute?.fallbackUsed).toBe(false);
    expect(firstDecision?.decision?.trainingRecord).toMatchObject({
      player: WHITE,
    });
  });

  test('bootstraps snapshots and stores replayed simulations', async () => {
    const snapshots = await runtime.listSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);

    const baseSnapshotId = snapshots[0].id;
    const simulation = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 12,
      maxDepth: 8,
      hypothesisCount: 4,
      maxPlies: 60,
      seed: 4242,
    });

    expect(simulation.stats.games).toBe(1);
    expect(simulation.simulation).toBeTruthy();

    const details = await runtime.getSimulation(simulation.simulation.id);
    expect(details).toBeTruthy();
    expect(details.games.length).toBe(1);

    const replay = await runtime.getReplay(simulation.simulation.id, details.games[0].id);
    expect(replay).toBeTruthy();
    expect(Array.isArray(replay.game.replay)).toBe(true);
    expect(replay.game.replay.length).toBeGreaterThan(1);

    const firstFrame = replay.game.replay[0];
    const pieceCells = firstFrame.board.flat().filter(Boolean);
    expect(pieceCells.length).toBeGreaterThan(0);
    expect(pieceCells[0]).toHaveProperty('identity');
  });

  test('training creates a child snapshot with loss history', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const simulation = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 12,
      maxDepth: 8,
      hypothesisCount: 4,
      maxPlies: 60,
      seed: 4243,
    });

    const training = await runtime.trainSnapshot({
      snapshotId: baseSnapshotId,
      simulationIds: [simulation.simulation.id],
      epochs: 1,
      learningRate: 0.01,
    });

    expect(training.snapshot).toBeTruthy();
    expect(training.snapshot.parentSnapshotId).toBe(baseSnapshotId);
    expect(training.trainingRun.label).toBe(`Bootstrap ${DEFAULT_MODEL_DESCRIPTOR} 001`);
    expect(training.snapshot.label).toBe(`Bootstrap ${DEFAULT_MODEL_DESCRIPTOR} 001`);
    expect(training.lossHistory.length).toBe(1);
    expect(training.sampleCounts.policy).toBeGreaterThan(0);

    const lossHistory = await runtime.getLossHistory({ snapshotId: training.snapshot.id });
    expect(Array.isArray(lossHistory)).toBe(true);
    expect(lossHistory.length).toBeGreaterThan(0);
  });

  test('python-trained snapshots still run through Node CPU inference', async () => {
    const bridge = getPythonTrainingBridge();
    const capabilities = await bridge.getCapabilities();
    expect(capabilities).toBeTruthy();

    const baseBundle = createDefaultModelBundle({ seed: 4244 });
    const game = await runtime.runSingleGame({
      whiteParticipant: {
        id: 'snapshot:test-white',
        type: 'snapshot',
        label: 'Test White',
        snapshotId: 'snapshot-test-white',
        modelBundle: createDefaultModelBundle({ seed: 5001 }),
      },
      blackParticipant: {
        id: 'snapshot:test-black',
        type: 'snapshot',
        label: 'Test Black',
        snapshotId: 'snapshot-test-black',
        modelBundle: createDefaultModelBundle({ seed: 5002 }),
      },
      seed: 4245,
      iterations: 2,
      maxDepth: 3,
      hypothesisCount: 2,
      riskBias: 0,
      exploration: 1.5,
      maxPlies: 20,
    });

    const trainingResult = await runtime.trainModelBundleBatch({
      modelBundle: baseBundle,
      optimizerState: null,
      samples: {
        policySamples: (game.training?.policySamples || []).slice(0, 4),
        valueSamples: (game.training?.valueSamples || []).slice(0, 4),
        identitySamples: (game.training?.identitySamples || []).slice(0, 4),
      },
      epochs: 1,
      batchSize: 4,
      learningRate: 0.01,
      weightDecay: 0.0001,
      gradientClipNorm: 5,
      trainingBackend: 'python',
      trainingDevicePreference: 'cpu',
    });

    expect(trainingResult.modelBundle).toBeTruthy();
    expect(trainingResult.history).toHaveLength(1);
    expect(trainingResult.backend).toBe('python');
    expect(trainingResult.device).toBe('cpu');

    const state = createInitialState({ seed: 4246, maxPlies: 60 });
    const search = runHiddenInfoMcts(trainingResult.modelBundle, state, {
      rootPlayer: WHITE,
      iterations: 8,
      maxDepth: 6,
      hypothesisCount: 3,
      riskBias: 0,
      exploration: 1.5,
    });

    expect(search.action).toBeTruthy();
    expect(getLegalActions(state, WHITE).some((action) => actionKey(action) === actionKey(search.action))).toBe(true);
  }, 120000);

  test('auto backend prefers Python CPU when the bridge is available without CUDA', async () => {
    const bridge = getPythonTrainingBridge();
    jest.spyOn(bridge, 'getCapabilities').mockResolvedValue({
      backend: 'python',
      torchVersion: 'test',
      cudaAvailable: false,
      cpuCount: 16,
      torchNumThreads: 16,
      torchNumInteropThreads: 4,
    });

    const resolution = await runtime.resolveEffectiveTrainingBackend('auto', 'auto');
    expect(resolution).toMatchObject({
      backend: 'python',
      device: 'cpu',
    });
  });

  test('trainSnapshot persists the trained model bundle returned by the trainer', async () => {
    await runtime.ensureLoaded();
    const baseSnapshot = runtime.state.snapshots[0];
    const updatedBundle = createDefaultModelBundle({ seed: 9191 });
    updatedBundle.encoder.network.layers[0].biases[0] += 0.25;

    jest.spyOn(runtime, 'collectTrainingSamples').mockResolvedValue({
      sourceGames: 1,
      sourceSimulations: 1,
      policySamples: [{ sample: 'policy' }],
      valueSamples: [{ sample: 'value' }],
      identitySamples: [{ sample: 'identity' }],
    });
    jest.spyOn(runtime, 'trainModelBundleBatch').mockResolvedValue({
      backend: 'python',
      device: 'cpu',
      modelBundle: updatedBundle,
      optimizerState: null,
      history: [{
        epoch: 1,
        policyLoss: 0.1,
        valueLoss: 0.2,
        identityLoss: 0.3,
        identityAccuracy: 0.4,
        policySamples: 1,
        valueSamples: 1,
        identitySamples: 1,
      }],
    });

    const result = await runtime.trainSnapshot({
      snapshotId: baseSnapshot.id,
      epochs: 1,
      learningRate: 0.01,
      trainingBackend: 'python',
      trainingDevicePreference: 'cpu',
    });

    const persistedSnapshot = runtime.getSnapshotById(result.snapshot.id);
    expect(persistedSnapshot.modelBundle).toEqual(updatedBundle);
  });

  test('background simulation jobs complete and expose live status', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const started = await runtime.startSimulationJob({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 12,
      maxDepth: 8,
      hypothesisCount: 4,
      maxPlies: 60,
      seed: 5252,
      label: 'background-sim-test',
    });

    expect(started.simulation).toBeTruthy();
    expect(started.taskId).toBeTruthy();

    const live = await runtime.getLiveStatus();
    expect(live.simulation).toBeTruthy();
    expect(live.simulation.simulationId).toBe(started.simulation.id);
    expect(live.resourceTelemetry).toBeTruthy();
    expect(live.resourceTelemetry.cpu.available).toBe(true);
    expect(Array.isArray(live.resourceTelemetry.cpu.history)).toBe(true);

    await waitFor(() => !runtime.state.activeJobs.simulation, 30000);
    const completed = await runtime.getSimulation(started.simulation.id);
    expect(completed).toBeTruthy();
    expect(completed.status).toBe('completed');
    expect(completed.gameCount).toBe(1);
  });

  test('background training jobs complete and create a new snapshot', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const simulation = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 12,
      maxDepth: 8,
      hypothesisCount: 4,
      maxPlies: 60,
      seed: 5253,
    });

    const started = await runtime.startTrainingJob({
      snapshotId: baseSnapshotId,
      simulationIds: [simulation.simulation.id],
      epochs: 1,
      learningRate: 0.01,
    });

    expect(started.trainingRun).toBeTruthy();
    expect(started.taskId).toBeTruthy();

    const live = await runtime.getLiveStatus();
    expect(live.training).toBeTruthy();
    expect(live.training.trainingRunId).toBe(started.trainingRun.id);
    expect(live.resourceTelemetry).toBeTruthy();
    expect(live.resourceTelemetry.cpu.available).toBe(true);

    await waitFor(() => !runtime.state.activeJobs.training, 30000);
    const run = runtime.getInMemoryTrainingRun(started.trainingRun.id);
    expect(run).toBeTruthy();
    expect(run.status).toBe('completed');
    expect(run.newSnapshotId).toBeTruthy();
    expect(run.label).toBe(`Bootstrap ${DEFAULT_MODEL_DESCRIPTOR} 001`);
  });

  test('training returns a client error when no matching samples exist', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    await expect(runtime.trainSnapshot({
      snapshotId: baseSnapshotId,
      simulationIds: ['simulation-does-not-exist'],
      epochs: 1,
      learningRate: 0.01,
    })).rejects.toMatchObject({
      code: 'NO_TRAINING_SAMPLES',
      statusCode: 400,
    });
  });

  test('mcts supports on-deck action phases', () => {
    const state = createInitialState({ seed: 1337, maxPlies: 60 });
    state.onDeckingPlayer = WHITE;
    state.playerTurn = WHITE;
    state.toMove = WHITE;

    const legalActions = getLegalActions(state, WHITE);
    expect(legalActions.length).toBeGreaterThan(0);
    expect(legalActions.every((action) => action.type === 'ON_DECK')).toBe(true);

    const modelBundle = createDefaultModelBundle({ seed: 4242 });
    const search = runHiddenInfoMcts(modelBundle, state, {
      rootPlayer: WHITE,
      iterations: 16,
      maxDepth: 8,
      hypothesisCount: 4,
    });

    expect(search.action).toBeTruthy();
    expect(search.action.type).toBe('ON_DECK');

    const nextState = applyAction(state, search.action);
    expect(nextState.ply).toBe(state.ply + 1);
    expect(nextState.onDeckingPlayer).toBeNull();
  });

  test('builtin medium takes immediate king-throne wins when available', () => {
    const state = createInitialState({ seed: 9001, maxPlies: 60 });
    const rows = state.board.length;

    state.board = state.board.map((row) => row.map(() => null));
    state.stashes = [[], []];
    state.onDecks = [null, null];
    state.captured = [[], []];
    state.moves = [];
    state.actions = [];
    state.daggers = [0, 0];
    state.onDeckingPlayer = null;
    state.playerTurn = WHITE;
    state.toMove = WHITE;
    state.isActive = true;
    state.winner = null;
    state.winReason = null;
    state.ply = 0;

    Object.values(state.pieces).forEach((piece) => {
      piece.alive = false;
      piece.zone = 'captured';
      piece.row = -1;
      piece.col = -1;
      piece.capturedBy = piece.color === WHITE ? BLACK : WHITE;
    });

    const whiteKing = Object.values(state.pieces).find(
      (piece) => piece.color === WHITE && piece.identity === IDENTITIES.KING,
    );
    const blackKing = Object.values(state.pieces).find(
      (piece) => piece.color === BLACK && piece.identity === IDENTITIES.KING,
    );
    expect(whiteKing).toBeTruthy();
    expect(blackKing).toBeTruthy();

    whiteKing.alive = true;
    whiteKing.zone = 'board';
    whiteKing.row = rows - 2;
    whiteKing.col = 2;
    whiteKing.capturedBy = null;
    state.board[rows - 2][2] = whiteKing.id;

    blackKing.alive = true;
    blackKing.zone = 'board';
    blackKing.row = rows - 1;
    blackKing.col = 4;
    blackKing.capturedBy = null;
    state.board[rows - 1][4] = blackKing.id;

    const choice = chooseBuiltinAction(BUILTIN_MEDIUM_ID, state, { seed: 9101 });
    expect(choice?.action).toBeTruthy();
    expect(choice.action.type).toBe('MOVE');
    expect(choice.action.pieceId).toBe(whiteKing.id);
    expect(choice.action.declaration).toBe(IDENTITIES.KING);
    expect(choice.action.to).toEqual({ row: rows - 1, col: 2 });
  });

  test('builtin medium avoids opening king drift when stronger rook lines exist', () => {
    const state = createInitialState({ seed: 9002, maxPlies: 60 });
    const rows = state.board.length;

    state.board = state.board.map((row) => row.map(() => null));
    state.stashes = [[], []];
    state.onDecks = [null, null];
    state.captured = [[], []];
    state.moves = [];
    state.actions = [];
    state.daggers = [0, 0];
    state.onDeckingPlayer = null;
    state.playerTurn = WHITE;
    state.toMove = WHITE;
    state.isActive = true;
    state.winner = null;
    state.winReason = null;
    state.ply = 0;

    Object.values(state.pieces).forEach((piece) => {
      piece.alive = false;
      piece.zone = 'captured';
      piece.row = -1;
      piece.col = -1;
      piece.capturedBy = piece.color === WHITE ? BLACK : WHITE;
    });

    const whiteKing = Object.values(state.pieces).find(
      (piece) => piece.color === WHITE && piece.identity === IDENTITIES.KING,
    );
    const whiteRook = Object.values(state.pieces).find(
      (piece) => piece.color === WHITE && piece.identity === IDENTITIES.ROOK,
    );
    const blackKing = Object.values(state.pieces).find(
      (piece) => piece.color === BLACK && piece.identity === IDENTITIES.KING,
    );
    const blackRook = Object.values(state.pieces).find(
      (piece) => piece.color === BLACK && piece.identity === IDENTITIES.ROOK,
    );
    expect(whiteKing).toBeTruthy();
    expect(whiteRook).toBeTruthy();
    expect(blackKing).toBeTruthy();
    expect(blackRook).toBeTruthy();

    whiteKing.alive = true;
    whiteKing.zone = 'board';
    whiteKing.row = 0;
    whiteKing.col = 2;
    whiteKing.capturedBy = null;
    state.board[0][2] = whiteKing.id;

    whiteRook.alive = true;
    whiteRook.zone = 'board';
    whiteRook.row = 0;
    whiteRook.col = 0;
    whiteRook.capturedBy = null;
    state.board[0][0] = whiteRook.id;

    blackKing.alive = true;
    blackKing.zone = 'board';
    blackKing.row = rows - 1;
    blackKing.col = 4;
    blackKing.capturedBy = null;
    state.board[rows - 1][4] = blackKing.id;

    blackRook.alive = true;
    blackRook.zone = 'board';
    blackRook.row = 3;
    blackRook.col = 0;
    blackRook.capturedBy = null;
    state.board[3][0] = blackRook.id;

    const choice = chooseBuiltinAction(BUILTIN_MEDIUM_ID, state, { seed: 9102 });
    expect(choice?.action).toBeTruthy();
    expect(choice.action.type).toBe('MOVE');
    expect(choice.action.pieceId).toBe(whiteRook.id);
    expect(choice.action.declaration).toBe(IDENTITIES.ROOK);
  });

  test('builtin medium stays in response actions during pending move phases', () => {
    const state = createInitialState({ seed: 9010, maxPlies: 60 });
    const openingMove = getLegalActions(state, WHITE).find((action) => action.type === 'MOVE');
    expect(openingMove).toBeTruthy();

    const pendingState = applyAction(state, openingMove);
    expect(pendingState.playerTurn).toBe(BLACK);

    const legal = getLegalActions(pendingState, BLACK);
    expect(legal.some((action) => action.type === 'MOVE')).toBe(true);
    expect(legal.some((action) => action.type === 'CHALLENGE')).toBe(true);

    const choice = chooseBuiltinAction(BUILTIN_MEDIUM_ID, pendingState, { seed: 9011 });
    expect(choice?.action).toBeTruthy();
    expect(['CHALLENGE', 'BOMB', 'PASS']).toContain(choice.action.type);
  });

  test('pass after a bomb awards the win to the bomber when the mover king is exposed', () => {
    const state = createInitialState({ seed: 9012, maxPlies: 60 });
    const whiteKingId = Object.keys(state.pieces).find((id) => (
      state.pieces[id].color === WHITE && state.pieces[id].identity === IDENTITIES.KING
    ));
    const blackRookId = Object.keys(state.pieces).find((id) => (
      state.pieces[id].color === BLACK && state.pieces[id].identity === IDENTITIES.ROOK
    ));

    state.board = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => null));
    Object.values(state.pieces).forEach((piece) => {
      piece.alive = true;
      piece.zone = 'stash';
      piece.row = -1;
      piece.col = -1;
      piece.capturedBy = null;
    });
    state.stashes = [[], []];
    state.onDecks = [null, null];
    state.captured = [[], []];
    state.moves = [
      {
        player: WHITE,
        pieceId: whiteKingId,
        from: { row: 0, col: 4 },
        to: { row: 2, col: 2 },
        declaration: IDENTITIES.BISHOP,
        state: 0,
      },
    ];
    state.actions = [
      { type: 1, player: WHITE, timestamp: 0, details: {} },
      { type: 3, player: BLACK, timestamp: 1, details: {} },
    ];
    state.playerTurn = WHITE;
    state.toMove = WHITE;
    state.ply = 2;

    state.board[0][4] = whiteKingId;
    state.pieces[whiteKingId].zone = 'board';
    state.pieces[whiteKingId].row = 0;
    state.pieces[whiteKingId].col = 4;

    state.board[2][2] = blackRookId;
    state.pieces[blackRookId].zone = 'board';
    state.pieces[blackRookId].row = 2;
    state.pieces[blackRookId].col = 2;

    const nextState = applyAction(state, { type: 'PASS', player: WHITE });

    expect(nextState.isActive).toBe(false);
    expect(nextState.winner).toBe(BLACK);
    expect(nextState.winReason).toBe('capture_king');
  });

  test('simulations support medium bot participants and alternating colors', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const result = await runtime.simulateMatches({
      whiteParticipantId: `snapshot:${baseSnapshotId}`,
      blackParticipantId: 'builtin:medium-bot',
      gameCount: 4,
      alternateColors: true,
      iterations: 12,
      maxDepth: 8,
      hypothesisCount: 4,
      maxPlies: 60,
      seed: 5001,
    });

    expect(result.simulation).toBeTruthy();
    expect(Array.isArray(result.participantResults)).toBe(true);
    expect(result.participantResults.length).toBeGreaterThanOrEqual(2);
    const snapshotResult = result.participantResults.find((entry) => entry.participantId === `snapshot:${baseSnapshotId}`);
    const mediumResult = result.participantResults.find((entry) => entry.participantId === 'builtin:medium-bot');
    expect(snapshotResult).toBeTruthy();
    expect(mediumResult).toBeTruthy();
    expect(snapshotResult.asWhite).toBeGreaterThan(0);
    expect(snapshotResult.asBlack).toBeGreaterThan(0);
    expect(mediumResult.asWhite).toBeGreaterThan(0);
    expect(mediumResult.asBlack).toBeGreaterThan(0);
  });

  test('snapshot simulations preserve identity-history signal across plies', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const result = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 8,
      maxDepth: 6,
      hypothesisCount: 4,
      maxPlies: 80,
      seed: 5050,
    });

    const details = await runtime.getSimulation(result.simulation.id);
    expect(details).toBeTruthy();

    let observedHistoryDepth = false;
    for (const game of details.games || []) {
      const replay = await runtime.getReplay(result.simulation.id, game.id);
      const decisions = replay?.game?.decisions || [];
      decisions.forEach((decision) => {
        const samples = decision?.trainingRecord?.identitySamples || [];
        samples.forEach((sample) => {
          const featureByIdentity = sample?.featureByIdentity || {};
          Object.values(featureByIdentity).forEach((vector) => {
            if (Array.isArray(vector) && Number(vector[2] || 0) > 0) {
              observedHistoryDepth = true;
            }
          });
        });
      });
      if (observedHistoryDepth) break;
    }

    expect(observedHistoryDepth).toBe(true);
  }, 120000);

  test('medium bot self-play no longer collapses to 8-9 ply races', async () => {
    const result = await runtime.simulateMatches({
      whiteParticipantId: BUILTIN_MEDIUM_ID,
      blackParticipantId: BUILTIN_MEDIUM_ID,
      gameCount: 20,
      alternateColors: true,
      maxPlies: 80,
      seed: 5101,
    });

    expect(result.stats.games).toBe(20);
    expect(result.stats.averagePlies).toBeGreaterThan(10);
  }, 20000);

  test('default simulation labels are uniquely numbered', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const first = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 8,
      maxDepth: 6,
      hypothesisCount: 3,
      maxPlies: 40,
      seed: 7001,
    });

    const second = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 8,
      maxDepth: 6,
      hypothesisCount: 3,
      maxPlies: 40,
      seed: 7002,
    });

    expect(first.simulation.label).toMatch(/ 001$/);
    expect(second.simulation.label).toMatch(/ 002$/);
    expect(first.simulation.label).not.toBe(second.simulation.label);
  });

  test('can rename a snapshot after creation', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;
    const renamed = await runtime.renameSnapshot(baseSnapshotId, 'Renamed Snapshot');
    expect(renamed).toBeTruthy();
    expect(renamed.label).toBe('Renamed Snapshot');

    const list = await runtime.listSnapshots();
    const updated = list.find((item) => item.id === baseSnapshotId);
    expect(updated).toBeTruthy();
    expect(updated.label).toBe('Renamed Snapshot');
  });

  test('can rename a promoted generation and reuse that name in seed options', async () => {
    await runtime.ensureLoaded();
    const run = runtime.createRunRecord({
      id: 'run-rename-seed',
      label: 'Rename Source',
      config: createSmallRunConfig(),
    });
    run.status = 'completed';
    run.generations.push(runtime.createRunGenerationRecord(run, {
      generation: 1,
      label: 'G1',
      source: 'promoted',
      approved: true,
      isBest: true,
      promotedAt: '2026-03-13T01:00:00.000Z',
      modelBundle: createDefaultModelBundle({ seed: 1201 }),
    }));
    run.bestGeneration = 1;
    runtime.markRunBestGeneration(run, 1);
    runtime.compactTerminalRunState(run);
    runtime.state.runs.push(run);

    const renamed = await runtime.renameRunGeneration(run.id, 1, 'Control Model');
    expect(renamed).toBeTruthy();
    expect(renamed.label).toBe('Control Model');

    const workbench = await runtime.getWorkbench();
    const seedOption = workbench.seedSources.items.find((item) => item.id === `generation:${run.id}:1`);
    expect(seedOption).toBeTruthy();
    expect(seedOption.label).toBe(`Control Model ${DEFAULT_MODEL_DESCRIPTOR}`);
  });

  test('can delete a snapshot when another snapshot exists', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const fork = await runtime.createSnapshot({
      fromSnapshotId: baseSnapshotId,
      label: 'Deletable Snapshot',
    });
    expect(fork?.id).toBeTruthy();

    const result = await runtime.deleteSnapshot(fork.id);
    expect(result.deleted).toBe(true);
    expect(result.id).toBe(fork.id);

    const updated = await runtime.listSnapshots();
    expect(updated.some((snapshot) => snapshot.id === fork.id)).toBe(false);
    expect(updated.some((snapshot) => snapshot.id === baseSnapshotId)).toBe(true);
  });

  test('rejects deleting the final remaining snapshot', async () => {
    const snapshots = await runtime.listSnapshots();
    expect(snapshots.length).toBe(1);

    await expect(runtime.deleteSnapshot(snapshots[0].id)).rejects.toMatchObject({
      code: 'LAST_SNAPSHOT',
      statusCode: 409,
    });
  });

  test('can rename a simulation after creation', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const created = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 8,
      maxDepth: 6,
      hypothesisCount: 3,
      maxPlies: 40,
      seed: 7003,
    });
    const simulationId = created?.simulation?.id;
    expect(simulationId).toBeTruthy();

    const renamed = await runtime.renameSimulation(simulationId, 'Renamed Simulation');
    expect(renamed).toBeTruthy();
    expect(renamed.label).toBe('Renamed Simulation');

    const listed = await runtime.listSimulations();
    const updated = listed.find((item) => item.id === simulationId);
    expect(updated).toBeTruthy();
    expect(updated.label).toBe('Renamed Simulation');
  });

  test('simulation run emits start/game/complete progress events', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;
    const events = [];
    const handler = (payload) => {
      events.push(payload);
    };
    eventBus.on('ml:simulationProgress', handler);
    try {
      await runtime.simulateMatches({
        whiteSnapshotId: baseSnapshotId,
        blackSnapshotId: baseSnapshotId,
        gameCount: 2,
        iterations: 8,
        maxDepth: 6,
        hypothesisCount: 3,
        maxPlies: 40,
        seed: 7101,
      });
    } finally {
      eventBus.off('ml:simulationProgress', handler);
    }

    expect(events.some((entry) => entry.phase === 'start')).toBe(true);
    expect(events.filter((entry) => entry.phase === 'game').length).toBe(2);
    expect(events.some((entry) => entry.phase === 'complete')).toBe(true);
  });

  test('can delete a simulation run', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const created = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 1,
      iterations: 8,
      maxDepth: 6,
      hypothesisCount: 3,
      maxPlies: 40,
      seed: 7201,
    });

    const simulationId = created?.simulation?.id;
    expect(simulationId).toBeTruthy();

    const beforeDelete = await runtime.getSimulation(simulationId);
    expect(beforeDelete).toBeTruthy();

    const deleted = await runtime.deleteSimulation(simulationId);
    expect(deleted.deleted).toBe(true);

    const afterDelete = await runtime.getSimulation(simulationId);
    expect(afterDelete).toBeNull();

    const listed = await runtime.listSimulations();
    expect(listed.some((item) => item.id === simulationId)).toBe(false);
  });

  test('getReplay hydrates externally stored games from Mongo query path', async () => {
    jest.spyOn(runtime, 'isMongoSimulationPersistenceAvailable').mockReturnValue(true);
    jest.spyOn(runtime, 'maybeMigrateStateSimulationsToMongo').mockResolvedValue();
    jest.spyOn(runtime, 'getStoredSimulationById').mockResolvedValue({
      id: 'simulation-ext',
      createdAt: new Date().toISOString(),
      label: 'External',
      gamesStoredExternally: true,
      games: [{ id: 'game-ext-1' }],
      stats: {},
      config: {},
    });
    jest.spyOn(SimulationGameModel, 'findOne').mockReturnValue({
      lean: async () => ({
        simulationId: 'simulation-ext',
        id: 'game-ext-1',
        createdAt: new Date().toISOString(),
        winner: WHITE,
        plies: 12,
        replay: [{ ply: 0, board: [] }, { ply: 1, board: [] }],
        actionHistory: [{ type: 'READY' }],
        moveHistory: [],
        decisions: [],
      }),
    });

    const replay = await runtime.getReplay('simulation-ext', 'game-ext-1');
    expect(replay).toBeTruthy();
    expect(replay.game.id).toBe('game-ext-1');
    expect(Array.isArray(replay.game.replay)).toBe(true);
    expect(replay.game.replay.length).toBeGreaterThan(0);
  });

  test('deleteSimulation cascades to SimulationGame documents', async () => {
    jest.spyOn(runtime, 'isMongoSimulationPersistenceAvailable').mockReturnValue(true);
    jest.spyOn(runtime, 'maybeMigrateStateSimulationsToMongo').mockResolvedValue();
    jest.spyOn(SimulationModel, 'deleteOne').mockResolvedValue({ deletedCount: 1 });
    jest.spyOn(SimulationGameModel, 'deleteMany').mockResolvedValue({ deletedCount: 7 });

    const result = await runtime.deleteSimulation('simulation-cascade');
    expect(result.deleted).toBe(true);
    expect(result.mongoSimulationDeleted).toBe(1);
    expect(result.mongoGameDeleted).toBe(7);
  });

  test('supports game counts above previous 64 cap', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    const result = await runtime.simulateMatches({
      whiteSnapshotId: baseSnapshotId,
      blackSnapshotId: baseSnapshotId,
      gameCount: 65,
      iterations: 2,
      maxDepth: 3,
      hypothesisCount: 2,
      maxPlies: 30,
      seed: 7301,
    });

    expect(result.stats.games).toBe(65);
  }, 20000);

  test('can stop a running simulation task', async () => {
    const snapshots = await runtime.listSnapshots();
    const baseSnapshotId = snapshots[0].id;

    let taskId = '';
    let stopRequested = false;
    const handler = (payload) => {
      if (!taskId && payload?.taskId) {
        taskId = payload.taskId;
      }
      if (!stopRequested && payload?.phase === 'game' && taskId) {
        stopRequested = true;
        runtime.stopSimulationTask(taskId).catch(() => {});
      }
    };
    eventBus.on('ml:simulationProgress', handler);
    try {
      const result = await runtime.simulateMatches({
        whiteSnapshotId: baseSnapshotId,
        blackSnapshotId: baseSnapshotId,
        gameCount: 30,
        iterations: 4,
        maxDepth: 4,
        hypothesisCount: 2,
        maxPlies: 40,
        seed: 7302,
      });

      expect(stopRequested).toBe(true);
      expect(result.cancelled).toBe(true);
      expect(result.stats.games).toBeGreaterThan(0);
      expect(result.stats.games).toBeLessThan(30);
    } finally {
      eventBus.off('ml:simulationProgress', handler);
    }
  });
});
