const express = require('express');
const { ensureAdminRequest } = require('../../../utils/adminAccess');
const { getMlRuntime } = require('../../../services/ml/runtime');

const router = express.Router();
const mlRuntime = getMlRuntime();

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
    res.status(500).json({ message: err.message || 'Failed to load ML summary' });
  }
});

router.get('/workbench', async (req, res) => {
  try {
    const workbench = await mlRuntime.getWorkbench({
      limit: req.query.limit || 100,
    });
    res.json(workbench);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load ML workbench' });
  }
});

router.get('/promoted-bots', async (req, res) => {
  try {
    const catalog = await mlRuntime.getPromotedBotCatalog();
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load promoted bot catalog' });
  }
});

router.put('/promoted-bots', async (req, res) => {
  try {
    const payload = req.body || {};
    const catalog = await mlRuntime.updatePromotedBotCatalog(payload.enabledIds || []);
    res.json(catalog);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to update promoted bot catalog' });
  }
});

router.get('/runs', async (req, res) => {
  try {
    const items = await mlRuntime.listRuns({ limit: req.query.limit || 100 });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load ML runs' });
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
    res.status(500).json({ message: err.message || 'Failed to load ML run' });
  }
});

router.post('/runs', async (req, res) => {
  try {
    const payload = req.body || {};
    const result = await mlRuntime.startRun(payload);
    res.json(result);
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to start ML run' };
    if (err?.code) body.code = err.code;
    if (Array.isArray(err?.activeRuns)) body.activeRuns = err.activeRuns;
    res.status(statusCode).json(body);
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
    res.status(500).json({ message: err.message || 'Failed to stop ML run' });
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
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to continue ML run' };
    if (err?.code) body.code = err.code;
    if (Array.isArray(err?.activeRuns)) body.activeRuns = err.activeRuns;
    res.status(statusCode).json(body);
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
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    res.status(statusCode).json({ message: err.message || 'Failed to start ML test game' });
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
    res.status(500).json({ message: err.message || 'Failed to delete ML run' });
  }
});

router.get('/runs/:runId/games', async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    const hasGenerationFilters = req.query.generationA !== undefined || req.query.generationB !== undefined;
    const generationA = hasGenerationFilters ? Number.parseInt(req.query.generationA, 10) : null;
    const generationB = hasGenerationFilters ? Number.parseInt(req.query.generationB, 10) : null;
    if (hasGenerationFilters && (!Number.isFinite(generationA) || !Number.isFinite(generationB))) {
      return res.status(400).json({ message: 'generationA and generationB must both be integers when provided' });
    }
    const items = await mlRuntime.listRunGames(req.params.runId, generationA, generationB);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load run games' });
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
    res.status(500).json({ message: err.message || 'Failed to load run replay' });
  }
});

router.get('/live', async (req, res) => {
  try {
    const live = await mlRuntime.getLiveStatus();
    res.json(live);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load ML live status' });
  }
});

router.get('/snapshots', async (req, res) => {
  try {
    const snapshots = await mlRuntime.listSnapshots();
    res.json({ items: snapshots });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load snapshots' });
  }
});

router.get('/participants', async (req, res) => {
  try {
    const participants = await mlRuntime.listParticipants();
    res.json(participants);
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load participants' });
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
    res.status(500).json({ message: err.message || 'Failed to load snapshot details' });
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
    res.status(500).json({ message: err.message || 'Failed to create snapshot' });
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
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to rename snapshot' };
    if (err?.code) body.code = err.code;
    res.status(statusCode).json(body);
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
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to delete snapshot' };
    if (err?.code) body.code = err.code;
    res.status(statusCode).json(body);
  }
});

router.get('/simulations', async (req, res) => {
  try {
    const items = await mlRuntime.listSimulations({ limit: req.query.limit });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load simulations' });
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
    res.status(500).json({ message: err.message || 'Failed to load simulation details' });
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
    res.status(500).json({ message: err.message || 'Failed to delete simulation' });
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
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to rename simulation' };
    if (err?.code) body.code = err.code;
    res.status(statusCode).json(body);
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
    res.status(500).json({ message: err.message || 'Failed to run simulations' });
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
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to start simulations' };
    if (err?.code) body.code = err.code;
    res.status(statusCode).json(body);
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
    res.status(500).json({ message: err.message || 'Failed to stop simulation task' });
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
    res.status(500).json({ message: err.message || 'Failed to load replay' });
  }
});

router.get('/loss', async (req, res) => {
  try {
    const snapshotId = req.query.snapshotId || null;
    const history = await mlRuntime.getLossHistory({ snapshotId });
    res.json({ snapshotId, history });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load loss history' });
  }
});

router.get('/training/runs', async (req, res) => {
  try {
    const items = await mlRuntime.listTrainingRuns({ limit: req.query.limit });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load training runs' });
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
      learningRate: payload.learningRate,
      trainingBackend: payload.trainingBackend,
      trainingDevicePreference: payload.trainingDevicePreference,
      label: payload.label || null,
      notes: payload.notes || '',
    });
    res.json(result);
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to run training' };
    if (err?.code) body.code = err.code;
    if (err?.details) body.details = err.details;
    res.status(statusCode).json(body);
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
      learningRate: payload.learningRate,
      trainingBackend: payload.trainingBackend,
      trainingDevicePreference: payload.trainingDevicePreference,
      label: payload.label || null,
      notes: payload.notes || '',
    });
    res.json(result);
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    const body = { message: err.message || 'Failed to start training' };
    if (err?.code) body.code = err.code;
    if (err?.details) body.details = err.details;
    res.status(statusCode).json(body);
  }
});

module.exports = router;
