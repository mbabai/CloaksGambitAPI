const { MlRuntime } = require('../src/services/ml/runtime');
const eventBus = require('../src/eventBus');
const {
  WHITE,
  BLACK,
  IDENTITIES,
  createInitialState,
  getLegalActions,
  applyAction,
} = require('../src/services/ml/engine');
const { createDefaultModelBundle } = require('../src/services/ml/modeling');
const { runHiddenInfoMcts } = require('../src/services/ml/mcts');
const { BUILTIN_MEDIUM_ID, chooseBuiltinAction } = require('../src/services/ml/builtinBots');
const SimulationModel = require('../src/models/Simulation');
const SimulationGameModel = require('../src/models/SimulationGame');
const { isMlWorkflowEnabled } = require('../src/utils/mlFeatureGate');

const describeMlWorkflow = isMlWorkflowEnabled() ? describe : describe.skip;

describeMlWorkflow('ML runtime', () => {
  let runtime;
  jest.setTimeout(60000);

  beforeEach(() => {
    runtime = new MlRuntime({ persist: false });
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      label: 'test-trained',
    });

    expect(training.snapshot).toBeTruthy();
    expect(training.snapshot.parentSnapshotId).toBe(baseSnapshotId);
    expect(training.lossHistory.length).toBe(1);
    expect(training.sampleCounts.policy).toBeGreaterThan(0);

    const lossHistory = await runtime.getLossHistory({ snapshotId: training.snapshot.id });
    expect(Array.isArray(lossHistory)).toBe(true);
    expect(lossHistory.length).toBeGreaterThan(0);
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
