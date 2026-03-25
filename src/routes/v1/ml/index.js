const express = require('express');
const { ensureAdminRequest } = require('../../../utils/adminAccess');
const { getMlRuntime } = require('../../../services/ml/runtime');
const { getRecentServerErrors, reportServerError } = require('../../../services/adminErrorFeed');

const router = express.Router();
const mlRuntime = getMlRuntime();

function buildMlErrorBody(err, fallbackMessage) {
  const body = {
    message: err?.message || fallbackMessage,
  };
  if (err?.code) body.code = err.code;
  if (err?.details !== undefined) body.details = err.details;
  if (Array.isArray(err?.activeRuns)) body.activeRuns = err.activeRuns;
  return body;
}

function sendMlError(res, err, fallbackMessage, context) {
  const statusCode = Number.isInteger(err?.statusCode)
    ? err.statusCode
    : (Number.isInteger(err?.status) ? err.status : 500);
  const body = buildMlErrorBody(err, fallbackMessage);
  if (statusCode >= 500) {
    reportServerError({
      source: `mlRoute:${context}`,
      level: 'error',
      code: body.code || `http_${statusCode}`,
      status: statusCode,
      message: body.message,
      error: err,
      details: {
        context,
        details: body.details || null,
        activeRuns: body.activeRuns || null,
      },
    });
  }
  return res.status(statusCode).json(body);
}

function attachServerErrors(payload = {}) {
  return {
    ...payload,
    serverErrors: {
      items: getRecentServerErrors(),
    },
  };
}

router.use(async (req, res, next) => {
  const adminSession = await ensureAdminRequest(req, res);
  if (!adminSession) {
    return;
  }
  req.__adminSession = adminSession;
  next();
});

router.get('/summary', async (req, res) => {
  try {
    const summary = await mlRuntime.getSummary();
    res.json(summary);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load ML summary', 'summary');
  }
});

router.get('/workbench', async (req, res) => {
  try {
    const workbench = await mlRuntime.getWorkbench({
      limit: req.query.limit || 100,
    });
    res.json(attachServerErrors(workbench));
  } catch (err) {
    return sendMlError(res, err, 'Failed to load ML workbench', 'workbench');
  }
});

router.get('/promoted-bots', async (req, res) => {
  try {
    const catalog = await mlRuntime.getPromotedBotCatalog();
    res.json(catalog);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load promoted bot catalog', 'promoted-bots.get');
  }
});

router.put('/promoted-bots', async (req, res) => {
  try {
    const payload = req.body || {};
    const catalog = await mlRuntime.updatePromotedBotCatalog(payload.enabledIds || []);
    res.json(catalog);
  } catch (err) {
    return sendMlError(res, err, 'Failed to update promoted bot catalog', 'promoted-bots.put');
  }
});

router.get('/runs', async (req, res) => {
  try {
    const items = await mlRuntime.listRuns({ limit: req.query.limit || 100 });
    res.json({ items });
  } catch (err) {
    return sendMlError(res, err, 'Failed to load ML runs', 'runs.list');
  }
});

router.get('/runs/:runId', async (req, res) => {
  try {
    const run = await mlRuntime.getRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ message: 'Run not found' });
    }
    res.json(run);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load ML run', 'runs.get');
  }
});

router.post('/runs', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await mlRuntime.startRun(payload);
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to start ML run', 'runs.create');
  }
});

router.patch('/runs/:runId/generations/:generation', async (req, res) => {
  try {
    const payload = req.body || {};
    const generation = Number.parseInt(req.params.generation, 10);
    if (!Number.isFinite(generation)) {
      return res.status(400).json({ message: 'Generation must be an integer' });
    }
    const updated = await mlRuntime.renameRunGeneration(req.params.runId, generation, payload.label);
    if (!updated) {
      return res.status(404).json({ message: 'Run generation not found' });
    }
    res.json({ generation: updated });
  } catch (err) {
    return sendMlError(res, err, 'Failed to rename run generation', 'runs.rename-generation');
  }
});

router.post('/runs/:runId/stop', async (req, res) => {
  try {
    const result = await mlRuntime.stopRun(req.params.runId);
    if (!result?.stopped) {
      return res.status(404).json({ message: 'Run not found' });
    }
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to stop ML run', 'runs.stop');
  }
});

router.post('/runs/:runId/kill', async (req, res) => {
  try {
    const result = await mlRuntime.killRun(req.params.runId);
    if (!result?.killed) {
      return res.status(404).json({ message: 'Run not found' });
    }
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to kill ML run', 'runs.kill');
  }
});

router.post('/runs/:runId/continue', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await mlRuntime.continueRun(req.params.runId, payload);
    if (!result?.continued) {
      return res.status(404).json({ message: 'Run not found' });
    }
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to continue ML run', 'runs.continue');
  }
});

router.post('/test-games', async (req, res) => {
  try {
    const payload = req.body || {};
    const adminSession = req.__adminSession || null;
    const result = await mlRuntime.startTestGame({
      runId: payload.runId || '',
      generation: payload.generation,
      sidePreference: payload.sidePreference || 'random',
      userId: adminSession?.userId || '',
      username: adminSession?.username || adminSession?.user?.username || '',
    });
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to start ML test game', 'test-games.create');
  }
});

router.delete('/runs/:runId', async (req, res) => {
  try {
    const result = await mlRuntime.deleteRun(req.params.runId);
    if (!result?.deleted) {
      if (result?.reason === 'not_found') {
        return res.status(404).json({ message: 'Run not found' });
      }
      if (result?.reason === 'run_active') {
        return res.status(409).json({ message: 'Cancel the run before deleting it' });
      }
      return res.status(400).json({ message: 'Run could not be deleted' });
    }
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to delete ML run', 'runs.delete');
  }
});

router.get('/runs/:runId/games', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const replayType = String(req.query.replayType || 'evaluation').trim().toLowerCase() === 'simulation'
      ? 'simulation'
      : 'evaluation';
    const hasGenerationFilters = req.query.generationA !== undefined || req.query.generationB !== undefined;
    const generationA = hasGenerationFilters ? Number.parseInt(req.query.generationA, 10) : null;
    const generationB = hasGenerationFilters ? Number.parseInt(req.query.generationB, 10) : null;
    const hasPagedFilters = req.query.limit !== undefined
      || req.query.beforeId !== undefined
      || req.query.generation !== undefined
      || req.query.boardPieces !== undefined
      || req.query.advanceDepth !== undefined;
    const generation = req.query.generation !== undefined
      ? Number.parseInt(req.query.generation, 10)
      : null;
    const boardPieces = req.query.boardPieces !== undefined
      ? Number.parseInt(req.query.boardPieces, 10)
      : null;
    const advanceDepth = req.query.advanceDepth !== undefined
      ? Number.parseInt(req.query.advanceDepth, 10)
      : null;
    if (hasGenerationFilters && (!Number.isFinite(generationA) || !Number.isFinite(generationB))) {
      return res.status(400).json({ message: 'generationA and generationB must both be integers when provided' });
    }
    if (req.query.generation !== undefined && !Number.isFinite(generation)) {
      return res.status(400).json({ message: 'generation must be an integer when provided' });
    }
    if (req.query.boardPieces !== undefined && !Number.isFinite(boardPieces)) {
      return res.status(400).json({ message: 'boardPieces must be an integer when provided' });
    }
    if (req.query.advanceDepth !== undefined && !Number.isFinite(advanceDepth)) {
      return res.status(400).json({ message: 'advanceDepth must be an integer when provided' });
    }
    if (hasPagedFilters) {
      const catalog = await mlRuntime.getRunReplayGameCatalog(req.params.runId, {
        replayType,
        limit: req.query.limit,
        beforeId: req.query.beforeId || '',
        generation,
        generationA,
        generationB,
        boardPieces,
        advanceDepth,
      });
      if (!catalog) {
        return res.status(404).json({ message: 'Run not found' });
      }
      return res.json(catalog);
    }
    const items = await mlRuntime.listRunGames(req.params.runId, generationA, generationB, { replayType });
    res.json({ items });
  } catch (err) {
    return sendMlError(res, err, 'Failed to load run games', 'runs.games');
  }
});

router.get('/runs/:runId/replay/:gameId', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const replay = await mlRuntime.getRunReplay(req.params.runId, req.params.gameId);
    if (!replay) {
      return res.status(404).json({ message: 'Replay not found' });
    }
    res.json(replay);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load run replay', 'runs.replay');
  }
});

router.get('/live', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const live = await mlRuntime.getLiveStatus();
    res.json(attachServerErrors(live));
  } catch (err) {
    return sendMlError(res, err, 'Failed to load ML live status', 'live');
  }
});

router.get('/snapshots', async (req, res) => {
  try {
    const snapshots = await mlRuntime.listSnapshots();
    res.json({ items: snapshots });
  } catch (err) {
    return sendMlError(res, err, 'Failed to load snapshots', 'snapshots.list');
  }
});

router.get('/participants', async (req, res) => {
  try {
    const participants = await mlRuntime.listParticipants();
    res.json(participants);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load participants', 'participants.list');
  }
});

router.get('/snapshots/:snapshotId', async (req, res) => {
  try {
    const snapshot = await mlRuntime.getSnapshotDetails(req.params.snapshotId);
    if (!snapshot) {
      return res.status(404).json({ message: 'Snapshot not found' });
    }
    res.json(snapshot);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load snapshot details', 'snapshots.get');
  }
});

router.post('/snapshots/create', async (req, res) => {
  try {
    const payload = req.body || {};
    const snapshot = await mlRuntime.createSnapshot({
      fromSnapshotId: payload.fromSnapshotId || null,
      label: payload.label || null,
      notes: payload.notes || '',
    });
    res.json({ snapshot });
  } catch (err) {
    return sendMlError(res, err, 'Failed to create snapshot', 'snapshots.create');
  }
});

router.patch('/snapshots/:snapshotId', async (req, res) => {
  try {
    const payload = req.body || {};
    const snapshot = await mlRuntime.renameSnapshot(req.params.snapshotId, payload.label);
    if (!snapshot) {
      return res.status(404).json({ message: 'Snapshot not found' });
    }
    res.json({ snapshot });
  } catch (err) {
    return sendMlError(res, err, 'Failed to rename snapshot', 'snapshots.rename');
  }
});

router.delete('/snapshots/:snapshotId', async (req, res) => {
  try {
    const result = await mlRuntime.deleteSnapshot(req.params.snapshotId);
    if (!result?.deleted) {
      return res.status(404).json({ message: 'Snapshot not found' });
    }
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to delete snapshot', 'snapshots.delete');
  }
});

router.get('/simulations', async (req, res) => {
  try {
    const items = await mlRuntime.listSimulations({ limit: req.query.limit });
    res.json({ items });
  } catch (err) {
    return sendMlError(res, err, 'Failed to load simulations', 'simulations.list');
  }
});

router.get('/simulations/:simulationId', async (req, res) => {
  try {
    const simulation = await mlRuntime.getSimulation(req.params.simulationId);
    if (!simulation) {
      return res.status(404).json({ message: 'Simulation not found' });
    }
    res.json(simulation);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load simulation details', 'simulations.get');
  }
});

router.delete('/simulations/:simulationId', async (req, res) => {
  try {
    const result = await mlRuntime.deleteSimulation(req.params.simulationId);
    if (!result?.deleted) {
      return res.status(404).json({ message: 'Simulation not found' });
    }
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to delete simulation', 'simulations.delete');
  }
});

router.patch('/simulations/:simulationId', async (req, res) => {
  try {
    const payload = req.body || {};
    const simulation = await mlRuntime.renameSimulation(req.params.simulationId, payload.label);
    if (!simulation) {
      return res.status(404).json({ message: 'Simulation not found' });
    }
    res.json({ simulation });
  } catch (err) {
    return sendMlError(res, err, 'Failed to rename simulation', 'simulations.rename');
  }
});

router.post('/simulations/run', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await mlRuntime.simulateMatches({
      whiteParticipantId: payload.whiteParticipantId || null,
      blackParticipantId: payload.blackParticipantId || null,
      whiteSnapshotId: payload.whiteSnapshotId || null,
      blackSnapshotId: payload.blackSnapshotId || null,
      gameCount: payload.gameCount,
      maxPlies: payload.maxPlies,
      iterations: payload.iterations,
      maxDepth: payload.maxDepth,
      hypothesisCount: payload.hypothesisCount,
      riskBias: payload.riskBias,
      exploration: payload.exploration,
      alternateColors: payload.alternateColors,
      seed: payload.seed,
      label: payload.label,
    });
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to run simulations', 'simulations.run');
  }
});

router.post('/simulations/start', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await mlRuntime.startSimulationJob({
      whiteParticipantId: payload.whiteParticipantId || null,
      blackParticipantId: payload.blackParticipantId || null,
      whiteSnapshotId: payload.whiteSnapshotId || null,
      blackSnapshotId: payload.blackSnapshotId || null,
      gameCount: payload.gameCount,
      maxPlies: payload.maxPlies,
      iterations: payload.iterations,
      maxDepth: payload.maxDepth,
      hypothesisCount: payload.hypothesisCount,
      riskBias: payload.riskBias,
      exploration: payload.exploration,
      alternateColors: payload.alternateColors,
      seed: payload.seed,
      label: payload.label,
    });
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to start simulations', 'simulations.start');
  }
});

router.post('/simulations/stop', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await mlRuntime.stopSimulationTask(payload.taskId || '');
    if (!result?.stopped) {
      return res.status(404).json({ message: 'Simulation task not running' });
    }
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to stop simulation task', 'simulations.stop');
  }
});

router.get('/replay/:simulationId/:gameId', async (req, res) => {
  try {
    const replay = await mlRuntime.getReplay(req.params.simulationId, req.params.gameId);
    if (!replay) {
      return res.status(404).json({ message: 'Replay not found' });
    }
    res.json(replay);
  } catch (err) {
    return sendMlError(res, err, 'Failed to load replay', 'simulations.replay');
  }
});

router.get('/loss', async (req, res) => {
  try {
    const snapshotId = req.query.snapshotId || null;
    const history = await mlRuntime.getLossHistory({ snapshotId });
    res.json({ snapshotId, history });
  } catch (err) {
    return sendMlError(res, err, 'Failed to load loss history', 'loss.history');
  }
});

router.get('/training/runs', async (req, res) => {
  try {
    const items = await mlRuntime.listTrainingRuns({ limit: req.query.limit });
    res.json({ items });
  } catch (err) {
    return sendMlError(res, err, 'Failed to load training runs', 'training.list');
  }
});

router.post('/training/run', async (req, res) => {
  try {
    const payload = req.body || {};
    const simulationIds = Array.isArray(payload.simulationIds)
      ? payload.simulationIds.filter(Boolean)
      : null;
    const result = await mlRuntime.trainSnapshot({
      snapshotId: payload.snapshotId || null,
      simulationIds,
      epochs: payload.epochs,
      batchSize: payload.batchSize,
      learningRate: payload.learningRate,
      trainingBackend: payload.trainingBackend,
      trainingDevicePreference: payload.trainingDevicePreference,
      notes: payload.notes || '',
    });
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to run training', 'training.run');
  }
});

router.post('/training/start', async (req, res) => {
  try {
    const payload = req.body || {};
    const simulationIds = Array.isArray(payload.simulationIds)
      ? payload.simulationIds.filter(Boolean)
      : null;
    const result = await mlRuntime.startTrainingJob({
      snapshotId: payload.snapshotId || null,
      simulationIds,
      epochs: payload.epochs,
      batchSize: payload.batchSize,
      learningRate: payload.learningRate,
      trainingBackend: payload.trainingBackend,
      trainingDevicePreference: payload.trainingDevicePreference,
      notes: payload.notes || '',
    });
    res.json(result);
  } catch (err) {
    return sendMlError(res, err, 'Failed to start training', 'training.start');
  }
});

module.exports = router;
