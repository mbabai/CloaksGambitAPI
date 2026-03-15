const fs = require('fs');
const os = require('os');
const path = require('path');
const mongoose = require('mongoose');
const { execFile } = require('child_process');
const { Worker } = require('worker_threads');

const {
  WHITE,
  BLACK,
  createRng,
  getLegalActions,
  applyAction,
  actionKey,
} = require('./engine');
const {
  INFERRED_IDENTITIES,
  SHARED_MODEL_FAMILY,
  createDefaultModelBundle,
  cloneModelBundle,
  createOptimizerState,
  describeModelBundle,
  normalizeModelBundle,
  trainSharedModelBundleBatch,
  trainPolicyModel,
  trainValueModel,
  trainIdentityModel,
} = require('./modeling');
const { getPythonTrainingBridge } = require('./pythonTrainingBridge');
const {
  runFastGame,
  buildTrainingSamplesFromDecisions,
  chooseActionForParticipant: chooseActionForParticipantImpl,
} = require('./gameRunner');
const {
  BUILTIN_PARTICIPANTS,
  normalizeParticipantId,
  isBuiltinParticipantId,
  getBuiltinParticipant,
} = require('./builtinBots');
const {
  appendMlDebugLog,
  appendMlRunDebugLog,
  appendMlTrainingDebugLog,
  getMlDebugLogPaths,
} = require('./mlDebugLogger');
const {
  decodeMlPersistenceArtifacts,
  encodeMlPersistenceArtifacts,
} = require('./persistenceCodec');
const eventBus = require('../../eventBus');
const MlRunModel = require('../../models/MlRun');
const MlRunCheckpointModel = require('../../models/MlRunCheckpoint');
const SimulationModel = require('../../models/Simulation');
const SimulationGameModel = require('../../models/SimulationGame');
const TrainingRunModel = require('../../models/TrainingRun');
const Match = require('../../models/Match');
const Game = require('../../models/Game');
const User = require('../../models/User');
const lobbyStore = require('../../state/lobby');
const getServerConfig = require('../../utils/getServerConfig');
const matchesCreateRoute = require('../../routes/v1/matches/create');
const gamesCreateRoute = require('../../routes/v1/games/create');
const setupRoute = require('../../routes/v1/gameAction/setup');
const readyRoute = require('../../routes/v1/gameAction/ready');
const moveRoute = require('../../routes/v1/gameAction/move');
const challengeRoute = require('../../routes/v1/gameAction/challenge');
const bombRoute = require('../../routes/v1/gameAction/bomb');
const passRoute = require('../../routes/v1/gameAction/pass');
const onDeckRoute = require('../../routes/v1/gameAction/onDeck');
const resignRoute = require('../../routes/v1/gameAction/resign');
const drawRoute = require('../../routes/v1/gameAction/draw');
const { runInSimulationRequestContext } = require('../../utils/simulationRequestContext');

const SIMULATION_CHECKPOINT_GAME_INTERVAL = 2;
const SIMULATION_CHECKPOINT_MS = 5000;
const LIVE_STATUS_RETENTION_MS = 30000;
const SAVE_RENAME_RETRY_DELAYS_MS = [25, 75, 150];
const FILE_ACCESS_RETRY_DELAYS_MS = [25, 75, 150, 300, 750];
const DEFAULT_RUN_CHECKPOINT_INTERVAL = 200;
const DEFAULT_RUN_MAX_REPLAY_GAMES = 240;
const RUN_LOOP_YIELD_EVERY_GAMES = 1;
const RUN_PROGRESS_EMIT_MIN_INTERVAL_MS = 750;
const RUN_STATE_SAVE_INTERVAL_MS = 5000;
const RUN_STATE_PERSIST_REPLAY_POSITION_LIMIT = 1024;
const RUN_STATE_PERSIST_REPLAY_IDENTITY_MULTIPLIER = 8;
const RUN_STATE_PERSIST_REPLAY_POSITION_FALLBACK_LIMIT = 128;
const RUN_STATE_JOURNAL_REPLAY_POSITION_LIMIT = 256;
const RUN_STATE_JOURNAL_REPLAY_IDENTITY_MULTIPLIER = 8;
const RUN_PERSISTENCE_LAYOUT_VERSION = 1;
const RUN_CHECKPOINT_HISTORY_LIMIT = 12;
const RUN_REPLAY_ACTION_STATS_LIMIT = 8;
const RUN_REPLAY_PARITY_MISMATCH_LIMIT = 8;
const RUN_EVAL_BASELINE_GAMES = 50;
const RUN_EVAL_BASELINE_ADVANCE_STREAK = 3;
const RUN_EVAL_PROGRESS_MAX_CHUNK_GAMES = 16;
const RUN_HYDRATE_REPLAY_BUFFER_MAX_BYTES = 16 * 1024 * 1024;
const RUN_HYDRATE_RETAINED_GAMES_MAX_BYTES = 32 * 1024 * 1024;
const RUN_HYDRATE_WORKING_STATE_MAX_BYTES = 64 * 1024 * 1024;
const RUN_JOURNAL_TAIL_READ_MAX_BYTES = 8 * 1024 * 1024;
const MAX_PARALLEL_WORKER_TASK_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const DEFAULT_PARALLEL_WORKER_TASK_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_RUN_BATCH_SIZE_CPU = 256;
const DEFAULT_RUN_BATCH_SIZE_PYTHON_CPU = 512;
const DEFAULT_RUN_BATCH_SIZE_CUDA_SMALL = 512;
const DEFAULT_RUN_BATCH_SIZE_CUDA_MEDIUM = 1024;
const DEFAULT_RUN_BATCH_SIZE_CUDA_LARGE = 1536;
const DEFAULT_RUN_BATCH_SIZE_CUDA_XL = 2048;
const DEFAULT_RUN_TRAINING_STEPS_CPU = 32;
const DEFAULT_RUN_TRAINING_STEPS_CUDA_SMALL = 48;
const DEFAULT_RUN_TRAINING_STEPS_CUDA_LARGE = 64;
const RESOURCE_SAMPLE_INTERVAL_MS = 2000;
const RESOURCE_HISTORY_WINDOW_MS = 10 * 60 * 1000;
const RESOURCE_SAMPLE_HISTORY_LIMIT = Math.ceil(RESOURCE_HISTORY_WINDOW_MS / RESOURCE_SAMPLE_INTERVAL_MS);
const ML_PARALLEL_TASK_WORKER_PATH = path.join(__dirname, 'parallelTaskWorker.js');
const TRAINING_BACKENDS = Object.freeze({
  AUTO: 'auto',
  NODE: 'node',
  PYTHON: 'python',
});
const TRAINING_DEVICE_PREFERENCES = Object.freeze({
  AUTO: 'auto',
  CPU: 'cpu',
  CUDA: 'cuda',
});
const RUN_SEED_MODES = Object.freeze({
  BOOTSTRAP: 'bootstrap',
  RANDOM: 'random',
  PROMOTED_GENERATION: 'promoted_generation',
});
const LIVE_TEST_SIDE_PREFERENCES = Object.freeze({
  RANDOM: 'random',
  WHITE: 'white',
  BLACK: 'black',
});
const PREFERRED_BOOTSTRAP_BASELINE_KEY = 'modern-default-v1';
const PREFERRED_BOOTSTRAP_BASELINE_SEED = 20260314;
const PREFERRED_BOOTSTRAP_NOTES = 'Preferred larger baseline model bundle for future runs';

function buildModelDescriptorLabel(baseLabel, modelBundle) {
  const prefix = String(baseLabel || '').trim();
  const descriptor = describeModelBundle(modelBundle);
  return prefix ? `${prefix} ${descriptor}` : descriptor;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeRunStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function isRunStatusActive(value) {
  const status = normalizeRunStatus(value);
  return status === 'running' || status === 'stopping';
}

function isRunStatusResumable(value) {
  const status = normalizeRunStatus(value);
  return status === 'running' || status === 'stopping' || status === 'stopped';
}

function isFilesystemAccessErrorCode(code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  return normalizedCode === 'EBUSY'
    || normalizedCode === 'EPERM'
    || normalizedCode === 'EACCES'
    || normalizedCode === 'ENOENT';
}

function isRecoverableRunJournalError(run) {
  if (!run || typeof run !== 'object') return false;
  const stopReason = String(run?.stopReason || '');
  const lastErrorMessage = String(run?.lastError?.message || '');
  const lastErrorCode = String(run?.lastError?.code || '');
  const combinedMessage = `${stopReason} ${lastErrorMessage}`.toLowerCase();
  const inlineAccessCodeMatch = combinedMessage.match(/\b(ebusy|eperm|eacces|enoent)\b/i);
  const inferredCode = inlineAccessCodeMatch ? inlineAccessCodeMatch[1].toUpperCase() : '';
  const mentionsJournalPath = /journal[\\/].*events\.jsonl/.test(combinedMessage)
    || /journal events?/.test(combinedMessage);
  const mentionsJournalFailure = /filesystem_journal_write_failed/.test(combinedMessage);
  return (mentionsJournalPath || mentionsJournalFailure) && isFilesystemAccessErrorCode(lastErrorCode || inferredCode);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSystemParallelism() {
  if (typeof os.availableParallelism === 'function') {
    return Math.max(1, Math.floor(os.availableParallelism()));
  }
  return Math.max(1, Math.floor((Array.isArray(os.cpus()) ? os.cpus().length : 1) || 1));
}

function defaultParallelGameWorkers() {
  return Math.max(1, getSystemParallelism());
}

function defaultNumSelfplayWorkers() {
  return Math.max(8, Math.min(128, defaultParallelGameWorkers() * 2));
}

function defaultParallelTrainingHeadWorkers() {
  return Math.max(1, Math.min(3, getSystemParallelism()));
}

function hasOwnDefinedValue(object, key) {
  return Boolean(
    object
    && Object.prototype.hasOwnProperty.call(object, key)
    && object[key] !== undefined
    && object[key] !== null
    && object[key] !== ''
  );
}

function getLargestTrainingSampleCount(samples = {}) {
  const getSampleCount = (value) => {
    if (Array.isArray(value)) return value.length;
    if (Number.isFinite(Number(value))) return Math.max(0, Math.floor(Number(value)));
    return 0;
  };
  return Math.max(
    getSampleCount(samples?.policySamples ?? samples?.policySampleCount),
    getSampleCount(samples?.valueSamples ?? samples?.valueSampleCount),
    getSampleCount(samples?.identitySamples ?? samples?.identitySampleCount),
    1,
  );
}

function recommendPythonCpuBatchSize(cpuParallelism = getSystemParallelism()) {
  if (cpuParallelism >= 24) return 1024;
  if (cpuParallelism >= 12) return 768;
  if (cpuParallelism >= 8) return DEFAULT_RUN_BATCH_SIZE_PYTHON_CPU;
  return DEFAULT_RUN_BATCH_SIZE_CPU;
}

function recommendCudaBatchSize(capabilities = null) {
  const totalMemoryMb = Number(capabilities?.cudaTotalMemoryMb || 0);
  if (totalMemoryMb >= 20000) return DEFAULT_RUN_BATCH_SIZE_CUDA_XL;
  if (totalMemoryMb >= 12000) return DEFAULT_RUN_BATCH_SIZE_CUDA_LARGE;
  if (totalMemoryMb >= 8000) return DEFAULT_RUN_BATCH_SIZE_CUDA_MEDIUM;
  if (totalMemoryMb >= 4000) return DEFAULT_RUN_BATCH_SIZE_CUDA_SMALL;
  return DEFAULT_RUN_BATCH_SIZE_CPU;
}

function recommendCudaTrainingStepsPerCycle(capabilities = null) {
  const totalMemoryMb = Number(capabilities?.cudaTotalMemoryMb || 0);
  if (totalMemoryMb >= 12000) return DEFAULT_RUN_TRAINING_STEPS_CUDA_LARGE;
  if (totalMemoryMb >= 4000) return DEFAULT_RUN_TRAINING_STEPS_CUDA_SMALL;
  return DEFAULT_RUN_TRAINING_STEPS_CPU;
}

function resolveRecommendedTrainingBatchSize(requestedBatchSize, backendResolution = null, samples = {}) {
  const availableSampleCount = getLargestTrainingSampleCount(samples);
  const maxBatchSize = Math.max(1, Math.min(4096, availableSampleCount));
  if (Number.isFinite(Number(requestedBatchSize)) && Number(requestedBatchSize) > 0) {
    return clampPositiveInt(requestedBatchSize, maxBatchSize, 1, maxBatchSize);
  }

  let recommended = DEFAULT_RUN_BATCH_SIZE_CPU;
  if (backendResolution?.backend === TRAINING_BACKENDS.PYTHON) {
    recommended = backendResolution?.device === TRAINING_DEVICE_PREFERENCES.CUDA
      ? recommendCudaBatchSize(backendResolution?.capabilities || null)
      : recommendPythonCpuBatchSize(getSystemParallelism());
  }
  return Math.max(1, Math.min(maxBatchSize, recommended));
}

function resolveRecommendedRunTrainingStepsPerCycle(backendResolution = null) {
  if (backendResolution?.backend === TRAINING_BACKENDS.PYTHON) {
    return backendResolution?.device === TRAINING_DEVICE_PREFERENCES.CUDA
      ? recommendCudaTrainingStepsPerCycle(backendResolution?.capabilities || null)
      : DEFAULT_RUN_TRAINING_STEPS_CPU;
  }
  return DEFAULT_RUN_TRAINING_STEPS_CPU;
}

function describeParallelTask(task = {}) {
  const type = String(task?.type || '').trim().toLowerCase();
  if (type === 'playgame') {
    return `playGame:${task?.options?.gameId || 'unknown'}`;
  }
  if (type === 'trainhead') {
    return `trainHead:${task?.head || 'unknown'}`;
  }
  return type || 'task';
}

function resolveParallelWorkerTaskTimeoutMs(task = {}, options = {}) {
  if (Number.isFinite(Number(options.taskTimeoutMs)) && Number(options.taskTimeoutMs) > 0) {
    return clampPositiveInt(options.taskTimeoutMs, DEFAULT_PARALLEL_WORKER_TASK_TIMEOUT_MS, 1, MAX_PARALLEL_WORKER_TASK_TIMEOUT_MS);
  }
  const type = String(task?.type || '').trim().toLowerCase();
  if (type === 'playgame') {
    const iterations = clampPositiveInt(task?.options?.iterations, 32, 1, 5000);
    const maxPlies = clampPositiveInt(task?.options?.maxPlies, 120, 1, 2000);
    const hypothesisCount = clampPositiveInt(task?.options?.hypothesisCount, 4, 1, 64);
    const estimatedMs = 120000 + (iterations * maxPlies * hypothesisCount * 8);
    return Math.max(60000, Math.min(MAX_PARALLEL_WORKER_TASK_TIMEOUT_MS, estimatedMs));
  }
  if (type === 'trainhead') {
    const sampleCount = Array.isArray(task?.samples) ? task.samples.length : 0;
    const estimatedMs = 60000 + (sampleCount * 20);
    return Math.max(30000, Math.min(MAX_PARALLEL_WORKER_TASK_TIMEOUT_MS, estimatedMs));
  }
  return DEFAULT_PARALLEL_WORKER_TASK_TIMEOUT_MS;
}

function withAsyncTimeout(promiseOrFactory, timeoutMs, message) {
  const normalizedTimeoutMs = Number.isFinite(Number(timeoutMs)) && Number(timeoutMs) > 0
    ? clampPositiveInt(timeoutMs, DEFAULT_PARALLEL_WORKER_TASK_TIMEOUT_MS, 1, MAX_PARALLEL_WORKER_TASK_TIMEOUT_MS)
    : 0;
  const promise = typeof promiseOrFactory === 'function'
    ? Promise.resolve().then(() => promiseOrFactory())
    : Promise.resolve(promiseOrFactory);
  if (!normalizedTimeoutMs) {
    return promise;
  }

  let timeoutHandle = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(message || `Task timed out after ${normalizedTimeoutMs}ms`);
      err.code = 'ML_TASK_TIMEOUT';
      reject(err);
    }, normalizedTimeoutMs);
    if (typeof timeoutHandle?.unref === 'function') {
      timeoutHandle.unref();
    }
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  });
}

function resolveParallelGameWorkers(requestedWorkers, taskCount) {
  const maxWorkers = Math.max(1, getSystemParallelism());
  const cappedTaskCount = clampPositiveInt(taskCount, 1, 1, maxWorkers);
  const configuredWorkers = Number.isFinite(Number(requestedWorkers))
    ? clampPositiveInt(requestedWorkers, cappedTaskCount, 1, maxWorkers)
    : clampPositiveInt(defaultParallelGameWorkers(), cappedTaskCount, 1, maxWorkers);
  return Math.max(1, Math.min(cappedTaskCount, configuredWorkers));
}

function normalizeTrainingBackend(value, fallback = TRAINING_BACKENDS.AUTO) {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === TRAINING_BACKENDS.NODE) return TRAINING_BACKENDS.NODE;
  if (normalized === TRAINING_BACKENDS.PYTHON) return TRAINING_BACKENDS.PYTHON;
  return TRAINING_BACKENDS.AUTO;
}

function normalizeTrainingDevicePreference(value, fallback = TRAINING_DEVICE_PREFERENCES.AUTO) {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === TRAINING_DEVICE_PREFERENCES.CPU) return TRAINING_DEVICE_PREFERENCES.CPU;
  if (normalized === TRAINING_DEVICE_PREFERENCES.CUDA) return TRAINING_DEVICE_PREFERENCES.CUDA;
  return TRAINING_DEVICE_PREFERENCES.AUTO;
}

function normalizeLiveTestSidePreference(value, fallback = LIVE_TEST_SIDE_PREFERENCES.RANDOM) {
  const normalized = String(value || fallback).trim().toLowerCase();
  if (normalized === LIVE_TEST_SIDE_PREFERENCES.WHITE) return LIVE_TEST_SIDE_PREFERENCES.WHITE;
  if (normalized === LIVE_TEST_SIDE_PREFERENCES.BLACK) return LIVE_TEST_SIDE_PREFERENCES.BLACK;
  return LIVE_TEST_SIDE_PREFERENCES.RANDOM;
}

function compactAlphaNumeric(value, maxLength = 6) {
  const sanitized = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
  return sanitized.slice(-Math.max(1, maxLength)) || 'run';
}

function normalizeOrdinalBaseLabel(value, fallback = 'Run') {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
  return normalized || fallback;
}

function buildMlTestBotUsername(runId, generation) {
  const runSuffix = compactAlphaNumeric(runId, 4).toUpperCase();
  const generationLabel = `G${Math.max(0, Number(generation || 0))}`;
  const base = `ML${runSuffix}${generationLabel}`;
  return base.slice(0, 18);
}

function buildMlTestBotEmail(runId, generation) {
  const runSuffix = compactAlphaNumeric(runId, 12);
  const generationLabel = Math.max(0, Number(generation || 0));
  return `ml.test.${runSuffix}.g${generationLabel}@cg-bots.local`;
}

function buildPromotedModelBotId(runId, generation) {
  const normalizedRunId = String(runId || '').trim();
  const normalizedGeneration = Math.max(0, Number(generation || 0));
  return `generation:${normalizedRunId}:${normalizedGeneration}`;
}

function parsePromotedModelBotId(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^generation:([^:]+):(\d+)$/i);
  if (!match) return null;
  return {
    runId: match[1],
    generation: Number.parseInt(match[2], 10),
  };
}

function uniqueStrings(values = []) {
  const normalized = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (!trimmed || normalized.includes(trimmed)) return;
    normalized.push(trimmed);
  });
  return normalized;
}

function isPromotedGenerationRecord(generation) {
  if (!generation || generation.approved === false || !generation.modelBundle) {
    return false;
  }
  return Boolean(
    generation.promotedAt
    || generation.isBest
    || String(generation.source || '').toLowerCase() === 'promoted'
  );
}

function isNodeAdamOptimizerState(state) {
  return Boolean(
    state
    && typeof state === 'object'
    && Number.isFinite(state.step)
    && Array.isArray(state.layers)
  );
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeWorkerError(err, fallback = 'Worker task failed') {
  if (!err) return fallback;
  if (typeof err === 'string') return err;
  if (typeof err?.message === 'string' && err.message.trim()) return err.message;
  return fallback;
}

async function terminateWorkers(workerInfos = []) {
  await Promise.all((Array.isArray(workerInfos) ? workerInfos : []).map(async (workerInfo) => {
    if (!workerInfo?.worker) return;
    if (workerInfo.pending?.timeoutHandle) {
      clearTimeout(workerInfo.pending.timeoutHandle);
    }
    if (workerInfo.activeTaskTimeout) {
      clearTimeout(workerInfo.activeTaskTimeout);
    }
    workerInfo.pending = null;
    workerInfo.busy = false;
    try {
      await workerInfo.worker.terminate();
    } catch (_) {}
  }));
}

class ParallelTaskPool {
  constructor(workerPath) {
    this.workerPath = workerPath;
    this.workerInfos = [];
  }

  createWorkerInfo() {
    const worker = new Worker(this.workerPath);
    if (typeof worker.unref === 'function') {
      worker.unref();
    }
    const workerInfo = {
      worker,
      busy: false,
      exited: false,
      pending: null,
    };

    worker.on('message', (message = {}) => {
      const pending = workerInfo.pending;
      workerInfo.pending = null;
      workerInfo.busy = false;
      if (!pending) return;
      if (pending.timeoutHandle) {
        clearTimeout(pending.timeoutHandle);
      }
      if (message.ok !== true) {
        pending.reject(new Error(normalizeWorkerError(message.error, 'Parallel worker task failed')));
        return;
      }
      pending.resolve(message.result);
    });

    worker.on('error', (err) => {
      workerInfo.exited = true;
      const pending = workerInfo.pending;
      workerInfo.pending = null;
      workerInfo.busy = false;
      if (pending) {
        if (pending.timeoutHandle) {
          clearTimeout(pending.timeoutHandle);
        }
        pending.reject(err);
      }
    });

    worker.on('exit', (code) => {
      workerInfo.exited = true;
      const pending = workerInfo.pending;
      workerInfo.pending = null;
      workerInfo.busy = false;
      if (pending) {
        if (pending.timeoutHandle) {
          clearTimeout(pending.timeoutHandle);
        }
        if (code !== 0) {
          pending.reject(new Error(`Parallel worker exited with code ${code}`));
        }
      }
    });

    return workerInfo;
  }

  async ensureWorkerCount(count) {
    this.workerInfos = this.workerInfos.filter((workerInfo) => !workerInfo.exited);
    while (this.workerInfos.length < count) {
      this.workerInfos.push(this.createWorkerInfo());
    }
  }

  async runTask(workerInfo, task, requestId, options = {}) {
    if (!workerInfo || workerInfo.exited) {
      throw new Error('Parallel worker is unavailable');
    }
    if (workerInfo.busy) {
      throw new Error('Parallel worker is already busy');
    }
    workerInfo.busy = true;
    return new Promise((resolve, reject) => {
      const timeoutMs = resolveParallelWorkerTaskTimeoutMs(task, options);
      const taskLabel = describeParallelTask(task);
      const pending = {
        resolve,
        reject,
        timeoutHandle: null,
      };
      if (timeoutMs > 0) {
        pending.timeoutHandle = setTimeout(() => {
          if (workerInfo.pending !== pending) return;
          workerInfo.pending = null;
          workerInfo.busy = false;
          workerInfo.exited = true;
          const err = new Error(`Parallel worker task timed out after ${timeoutMs}ms (${taskLabel})`);
          err.code = 'ML_WORKER_TASK_TIMEOUT';
          reject(err);
          workerInfo.worker.terminate().catch(() => {});
        }, timeoutMs);
        if (typeof pending.timeoutHandle?.unref === 'function') {
          pending.timeoutHandle.unref();
        }
      }
      workerInfo.pending = pending;
      workerInfo.worker.postMessage({
        requestId,
        task,
      });
    });
  }

  async runTasks(taskPayloads = [], workerCount = 1, options = {}) {
    const tasks = Array.isArray(taskPayloads) ? taskPayloads.filter(Boolean) : [];
    if (!tasks.length) return [];
    const concurrency = Math.max(1, Math.min(Math.floor(workerCount || 1), tasks.length));
    if (concurrency <= 1 && options.preferWorkerExecution !== true) {
      const sequentialResults = [];
      for (let index = 0; index < tasks.length; index += 1) {
        if (typeof options.shouldStop === 'function' && options.shouldStop()) {
          break;
        }
        if (typeof options.runTask !== 'function') {
          throw new Error('ParallelTaskPool.runTasks requires options.runTask for sequential execution');
        }
        const task = tasks[index];
        const timeoutMs = resolveParallelWorkerTaskTimeoutMs(task, options);
        sequentialResults.push(await withAsyncTimeout(
          () => options.runTask(task, index),
          timeoutMs,
          `Sequential task timed out after ${timeoutMs}ms (${describeParallelTask(task)})`,
        ));
      }
      return sequentialResults;
    }

    await this.ensureWorkerCount(concurrency);
    const workers = this.workerInfos.slice(0, concurrency);
    const results = [];
    let nextTaskIndex = 0;

    await Promise.all(workers.map(async (workerInfo, workerIndex) => {
      while (nextTaskIndex < tasks.length) {
        if (typeof options.shouldStop === 'function' && options.shouldStop()) {
          return;
        }
        const taskIndex = nextTaskIndex;
        nextTaskIndex += 1;
        const requestId = (workerIndex * 1000000) + taskIndex;
        results[taskIndex] = await this.runTask(workerInfo, tasks[taskIndex], requestId, options);
      }
    }));

    return results.filter((entry) => entry !== undefined);
  }

  async terminate() {
    await terminateWorkers(this.workerInfos);
    this.workerInfos = [];
  }
}

async function runParallelWorkerTasks(taskPayloads = [], workerCount = 1, options = {}) {
  const tasks = Array.isArray(taskPayloads) ? taskPayloads.filter(Boolean) : [];
  if (!tasks.length) return [];
  const concurrency = Math.max(1, Math.min(Math.floor(workerCount || 1), tasks.length));
  if (concurrency <= 1 && options.preferWorkerExecution !== true) {
    const sequentialResults = [];
    for (let index = 0; index < tasks.length; index += 1) {
      if (typeof options.shouldStop === 'function' && options.shouldStop()) {
        break;
      }
      if (typeof options.runTask !== 'function') {
        throw new Error('runParallelWorkerTasks requires options.runTask for sequential execution');
      }
      const task = tasks[index];
      const timeoutMs = resolveParallelWorkerTaskTimeoutMs(task, options);
      sequentialResults.push(await withAsyncTimeout(
        () => options.runTask(task, index),
        timeoutMs,
        `Sequential task timed out after ${timeoutMs}ms (${describeParallelTask(task)})`,
      ));
    }
    return sequentialResults;
  }

  if (options.workerPool instanceof ParallelTaskPool) {
    return options.workerPool.runTasks(tasks, concurrency, options);
  }

  const workerInfos = [];
  const results = [];
  let nextTaskIndex = 0;
  let activeTasks = 0;
  let completedTasks = 0;
  let stopping = false;
  let resolved = false;

  return new Promise((resolve, reject) => {
    const finishResolve = async () => {
      if (resolved) return;
      resolved = true;
      await terminateWorkers(workerInfos);
      resolve(results.filter((entry) => entry !== undefined));
    };

    const finishReject = async (err) => {
      if (resolved) return;
      resolved = true;
      stopping = true;
      await terminateWorkers(workerInfos);
      reject(err);
    };

    const maybeDone = () => {
      if (resolved) return;
      const noMoreTasks = nextTaskIndex >= tasks.length || (typeof options.shouldStop === 'function' && options.shouldStop());
      if (noMoreTasks && activeTasks === 0) {
        finishResolve().catch((err) => {
          reject(err);
        });
      }
    };

    const assignNextTask = (workerInfo) => {
      if (!workerInfo || stopping || resolved) return;
      if (typeof options.shouldStop === 'function' && options.shouldStop()) {
        maybeDone();
        return;
      }
      if (nextTaskIndex >= tasks.length) {
        maybeDone();
        return;
      }
      const taskIndex = nextTaskIndex;
      nextTaskIndex += 1;
      activeTasks += 1;
      workerInfo.activeTaskIndex = taskIndex;
      const timeoutMs = resolveParallelWorkerTaskTimeoutMs(tasks[taskIndex], options);
      if (timeoutMs > 0) {
        workerInfo.activeTaskTimeout = setTimeout(() => {
          if (resolved || stopping || workerInfo.activeTaskIndex !== taskIndex) return;
          stopping = true;
          workerInfo.activeTaskIndex = null;
          activeTasks = Math.max(0, activeTasks - 1);
          const err = new Error(`Parallel worker task timed out after ${timeoutMs}ms (${describeParallelTask(tasks[taskIndex])})`);
          err.code = 'ML_WORKER_TASK_TIMEOUT';
          workerInfo.worker.terminate().catch(() => {});
          finishReject(err).catch(() => {});
        }, timeoutMs);
        if (typeof workerInfo.activeTaskTimeout?.unref === 'function') {
          workerInfo.activeTaskTimeout.unref();
        }
      }
      workerInfo.worker.postMessage({
        requestId: taskIndex,
        task: tasks[taskIndex],
      });
    };

    for (let workerIndex = 0; workerIndex < concurrency; workerIndex += 1) {
      const worker = new Worker(ML_PARALLEL_TASK_WORKER_PATH);
      const workerInfo = {
        worker,
        activeTaskIndex: null,
        activeTaskTimeout: null,
      };
      workerInfos.push(workerInfo);

      worker.on('message', (message = {}) => {
        if (resolved || stopping) return;
        if (workerInfo.activeTaskTimeout) {
          clearTimeout(workerInfo.activeTaskTimeout);
          workerInfo.activeTaskTimeout = null;
        }
        const taskIndex = Number.isInteger(message.requestId)
          ? message.requestId
          : workerInfo.activeTaskIndex;
        workerInfo.activeTaskIndex = null;
        activeTasks = Math.max(0, activeTasks - 1);
        completedTasks += 1;

        if (message.ok !== true) {
          stopping = true;
          finishReject(new Error(normalizeWorkerError(message.error, 'Parallel worker task failed'))).catch(() => {});
          return;
        }

        results[taskIndex] = message.result;
        assignNextTask(workerInfo);
        if (!stopping && completedTasks >= tasks.length) {
          maybeDone();
        }
      });

      worker.on('error', (err) => {
        if (resolved || stopping) return;
        if (workerInfo.activeTaskTimeout) {
          clearTimeout(workerInfo.activeTaskTimeout);
          workerInfo.activeTaskTimeout = null;
        }
        stopping = true;
        finishReject(err).catch(() => {});
      });

      worker.on('exit', (code) => {
        if (resolved || stopping) return;
        if (workerInfo.activeTaskTimeout) {
          clearTimeout(workerInfo.activeTaskTimeout);
          workerInfo.activeTaskTimeout = null;
        }
        if (code !== 0) {
          stopping = true;
          finishReject(new Error(`Parallel worker exited with code ${code}`)).catch(() => {});
        }
      });
    }

    workerInfos.forEach((workerInfo) => assignNextTask(workerInfo));
  });
}

function ensureDirSync(targetDir) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }
}

function sanitizePathSegment(value, fallback = 'item') {
  const sanitized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return sanitized || fallback;
}

function isRetriableRenameError(err) {
  const code = String(err?.code || '').toUpperCase();
  return code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
}

function isMissingPathError(err) {
  return String(err?.code || '').toUpperCase() === 'ENOENT';
}

function isInvalidStringLengthError(err) {
  return err instanceof RangeError && /invalid string length/i.test(String(err?.message || ''));
}

async function persistJsonWithFallback(targetPath, payload) {
  const tmpPath = `${targetPath}.tmp`;
  ensureDirSync(path.dirname(targetPath));
  await fs.promises.writeFile(tmpPath, payload, 'utf8');
  let lastRenameError = null;
  for (const delayMs of [0, ...SAVE_RENAME_RETRY_DELAYS_MS]) {
    if (delayMs) await sleep(delayMs);
    try {
      await fs.promises.rename(tmpPath, targetPath);
      return;
    } catch (err) {
      lastRenameError = err;
      if (isMissingPathError(err)) {
        break;
      }
      if (!isRetriableRenameError(err)) {
        throw err;
      }
    }
  }
  try {
    ensureDirSync(path.dirname(targetPath));
    await fs.promises.writeFile(targetPath, payload, 'utf8');
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
  if (lastRenameError) {
    console.warn('[ml-runtime] rename fallback used while persisting state', {
      code: lastRenameError.code,
      path: tmpPath,
      dest: targetPath,
    });
  }
}

async function appendFileWithRetry(targetPath, payload, encoding = 'utf8') {
  let lastError = null;
  for (const delayMs of [0, ...FILE_ACCESS_RETRY_DELAYS_MS]) {
    if (delayMs) await sleep(delayMs);
    try {
      ensureDirSync(path.dirname(targetPath));
      await fs.promises.appendFile(targetPath, payload, encoding);
      return;
    } catch (err) {
      lastError = err;
      if (isMissingPathError(err)) {
        continue;
      }
      if (!isRetriableRenameError(err)) {
        throw err;
      }
    }
  }
  throw lastError;
}

async function readJsonIfExists(targetPath) {
  try {
    const raw = await fs.promises.readFile(targetPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (String(err?.code || '').toUpperCase() === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

async function readJsonIfExistsBounded(targetPath, options = {}) {
  if (!targetPath) return null;
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? Math.floor(options.maxBytes)
    : 0;
  const hasFallback = Object.prototype.hasOwnProperty.call(options, 'fallback');

  try {
    if (maxBytes > 0) {
      const stats = await fs.promises.stat(targetPath);
      if (stats.size > maxBytes) {
        if (typeof options.onOversize === 'function') {
          options.onOversize({
            path: targetPath,
            size: stats.size,
            maxBytes,
          });
        }
        return hasFallback ? options.fallback : null;
      }
    }

    const raw = await fs.promises.readFile(targetPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (String(err?.code || '').toUpperCase() === 'ENOENT') {
      return hasFallback ? options.fallback : null;
    }
    throw err;
  }
}

async function readLastJsonLineIfExists(targetPath, options = {}) {
  if (!targetPath) return null;
  const maxBytes = Number.isFinite(options.maxBytes) && options.maxBytes > 0
    ? Math.floor(options.maxBytes)
    : RUN_JOURNAL_TAIL_READ_MAX_BYTES;
  let handle = null;

  try {
    handle = await fs.promises.open(targetPath, 'r');
    const stats = await handle.stat();
    const fileSize = Number(stats?.size || 0);
    if (fileSize <= 0) {
      return null;
    }

    const bytesToRead = Math.min(fileSize, maxBytes);
    const start = fileSize - bytesToRead;
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, start);
    let text = buffer.toString('utf8', 0, bytesRead);

    if (start > 0) {
      const firstNewlineIndex = text.indexOf('\n');
      if (firstNewlineIndex < 0) {
        if (typeof options.onTruncated === 'function') {
          options.onTruncated({
            path: targetPath,
            fileSize,
            maxBytes,
          });
        }
        return null;
      }
      text = text.slice(firstNewlineIndex + 1);
    }

    const lines = text.split(/\r?\n/).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]);
      } catch (_) {}
    }
    return null;
  } catch (err) {
    if (String(err?.code || '').toUpperCase() === 'ENOENT') {
      return null;
    }
    throw err;
  } finally {
    await handle?.close?.().catch(() => {});
  }
}

async function removeFileIfExists(targetPath) {
  if (!targetPath) return;
  await fs.promises.unlink(targetPath).catch(() => {});
}

async function removeDirectoryIfExists(targetPath) {
  if (!targetPath) return;
  await fs.promises.rm(targetPath, { recursive: true, force: true }).catch(() => {});
}

function toPortableRelativePath(rootDir, targetPath) {
  if (!rootDir || !targetPath) return null;
  const relativePath = path.relative(rootDir, targetPath);
  return relativePath.split(path.sep).join('/');
}

function resolvePortableRelativePath(rootDir, relativePath) {
  if (!rootDir || !relativePath) return null;
  return path.resolve(rootDir, ...String(relativePath).split(/[\\/]+/));
}

function clampPositiveInt(value, fallback, min = 1, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function clampNonNegativeInt(value, fallback, max = 100000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(0, Math.floor(parsed)));
}

function createCpuUsageSnapshot() {
  const cpus = Array.isArray(os.cpus()) ? os.cpus() : [];
  const totals = cpus.reduce((acc, cpu) => {
    const times = cpu?.times || {};
    acc.idle += Number(times.idle || 0);
    acc.total += Object.values(times).reduce((sum, value) => sum + Number(value || 0), 0);
    return acc;
  }, { idle: 0, total: 0 });
  return {
    capturedAtMs: Date.now(),
    idle: totals.idle,
    total: totals.total,
  };
}

function computeCpuUsagePercent(previousSnapshot, nextSnapshot) {
  if (!previousSnapshot || !nextSnapshot) return null;
  const totalDelta = Number(nextSnapshot.total || 0) - Number(previousSnapshot.total || 0);
  const idleDelta = Number(nextSnapshot.idle || 0) - Number(previousSnapshot.idle || 0);
  if (!Number.isFinite(totalDelta) || totalDelta <= 0) return null;
  const usagePercent = ((totalDelta - Math.max(0, idleDelta)) / totalDelta) * 100;
  if (!Number.isFinite(usagePercent)) return null;
  return Math.max(0, Math.min(100, usagePercent));
}

function appendResourceSample(history = [], sample = null) {
  const nextHistory = Array.isArray(history) ? history.slice() : [];
  if (sample && Number.isFinite(sample.percent)) {
    nextHistory.push({
      timestamp: sample.timestamp || nowIso(),
      percent: Math.max(0, Math.min(100, Number(sample.percent))),
    });
  }
  while (nextHistory.length > RESOURCE_SAMPLE_HISTORY_LIMIT) {
    nextHistory.shift();
  }
  return nextHistory;
}

function createEmptyResourceTelemetry() {
  return {
    sampleIntervalMs: RESOURCE_SAMPLE_INTERVAL_MS,
    windowMs: RESOURCE_HISTORY_WINDOW_MS,
    cpu: {
      available: true,
      currentPercent: null,
      updatedAt: null,
      history: [],
    },
    gpu: {
      available: null,
      currentPercent: null,
      updatedAt: null,
      history: [],
      label: null,
      source: null,
    },
  };
}

function queryGpuUsageFromNvidiaSmi() {
  const executableCandidates = uniqueStrings([
    'nvidia-smi',
    process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'nvidia-smi.exe')
      : '',
    process.platform === 'win32' && process.env.ProgramW6432
      ? path.join(process.env.ProgramW6432, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
      : '',
    process.platform === 'win32' && process.env.ProgramFiles
      ? path.join(process.env.ProgramFiles, 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
      : '',
    process.platform === 'win32' && process.env['ProgramFiles(x86)']
      ? path.join(process.env['ProgramFiles(x86)'], 'NVIDIA Corporation', 'NVSMI', 'nvidia-smi.exe')
      : '',
  ]);
  const nvidiaSmiArgs = ['--query-gpu=utilization.gpu,name', '--format=csv,noheader,nounits'];
  const unavailablePayload = {
    available: false,
    currentPercent: null,
    label: null,
    source: 'nvidia-smi',
  };
  return new Promise((resolve) => {
    const tryExecutable = (candidateIndex = 0) => {
      const executable = executableCandidates[candidateIndex];
      if (!executable) {
        resolve(unavailablePayload);
        return;
      }
      execFile(
        executable,
        nvidiaSmiArgs,
        { timeout: 1500, windowsHide: true },
        (err, stdout = '') => {
        if (err) {
          tryExecutable(candidateIndex + 1);
          return;
        }
        const rows = String(stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        if (!rows.length) {
          tryExecutable(candidateIndex + 1);
          return;
        }

        const parsedRows = rows
          .map((line) => {
            const parts = line.split(',').map((part) => part.trim());
            const usagePercent = Number.parseFloat(parts[0] || '');
            const label = parts.slice(1).join(', ') || null;
            return {
              usagePercent: Number.isFinite(usagePercent) ? Math.max(0, Math.min(100, usagePercent)) : null,
              label,
            };
          })
          .filter((entry) => Number.isFinite(entry.usagePercent));

        if (!parsedRows.length) {
          tryExecutable(candidateIndex + 1);
          return;
        }

        const hottest = parsedRows.reduce((best, entry) => (
          !best || Number(entry.usagePercent) > Number(best.usagePercent) ? entry : best
        ), null);
        resolve({
          available: true,
          currentPercent: Number(hottest?.usagePercent || 0),
          label: parsedRows.length === 1
            ? (parsedRows[0].label || 'GPU')
            : `${parsedRows.length} GPUs`,
          source: 'nvidia-smi',
        });
        },
      );
    };
    tryExecutable(0);
  });
}

function normalizeFloat(value, fallback, min = -Infinity, max = Infinity) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const SNAPSHOT_REF_PREFIX = 'snapshot:';

function toSnapshotParticipantId(snapshotId) {
  if (!snapshotId) return '';
  return `${SNAPSHOT_REF_PREFIX}${snapshotId}`;
}

function parseSnapshotParticipantId(participantId) {
  if (typeof participantId !== 'string') return null;
  const value = participantId.trim();
  if (!value) return null;
  if (value.startsWith(SNAPSHOT_REF_PREFIX)) {
    const snapshotId = value.slice(SNAPSHOT_REF_PREFIX.length).trim();
    return snapshotId || null;
  }
  return null;
}

function normalizeParticipantStatsEntry(entry, games) {
  const safeGames = Number.isFinite(games) && games > 0 ? games : 0;
  const wins = Number(entry?.wins || 0);
  const draws = Number(entry?.draws || 0);
  const losses = Number(entry?.losses || 0);
  const winRate = safeGames > 0 ? (wins / safeGames) : 0;
  const drawRate = safeGames > 0 ? (draws / safeGames) : 0;
  const lossRate = safeGames > 0 ? (losses / safeGames) : 0;
  return {
    ...entry,
    games: safeGames,
    wins,
    draws,
    losses,
    winRate,
    drawRate,
    lossRate,
    winPct: winRate * 100,
    drawPct: drawRate * 100,
    lossPct: lossRate * 100,
  };
}

function parseTimeValue(value) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function simulationHasDetailedGames(simulation) {
  const games = Array.isArray(simulation?.games) ? simulation.games : [];
  return games.some((game) => (
    Array.isArray(game?.replay)
    || Array.isArray(game?.decisions)
    || game?.training
    || Array.isArray(game?.actionHistory)
    || Array.isArray(game?.moveHistory)
  ));
}

function choosePreferredSimulationRecord(existing, candidate) {
  if (!existing) return candidate;
  if (!candidate) return existing;

  const existingDetailed = simulationHasDetailedGames(existing);
  const candidateDetailed = simulationHasDetailedGames(candidate);
  if (existingDetailed !== candidateDetailed) {
    return candidateDetailed ? candidate : existing;
  }

  const existingGames = Array.isArray(existing.games) ? existing.games.length : 0;
  const candidateGames = Array.isArray(candidate.games) ? candidate.games.length : 0;
  if (candidateGames !== existingGames) {
    return candidateGames > existingGames ? candidate : existing;
  }

  const existingTime = Math.max(parseTimeValue(existing?.updatedAt), parseTimeValue(existing?.createdAt));
  const candidateTime = Math.max(parseTimeValue(candidate?.updatedAt), parseTimeValue(candidate?.createdAt));
  return candidateTime >= existingTime ? candidate : existing;
}

function mergeSimulationRecords(sources = [], limit = null) {
  const byId = new Map();
  sources.forEach((items) => {
    if (!Array.isArray(items)) return;
    items.forEach((simulation) => {
      if (!simulation || !simulation.id) return;
      const existing = byId.get(simulation.id);
      byId.set(simulation.id, choosePreferredSimulationRecord(existing, simulation));
    });
  });

  const merged = Array.from(byId.values()).sort((a, b) => (
    Math.max(parseTimeValue(b?.updatedAt), parseTimeValue(b?.createdAt))
    - Math.max(parseTimeValue(a?.updatedAt), parseTimeValue(a?.createdAt))
  ));
  if (!Number.isFinite(limit) || limit <= 0) {
    return merged;
  }
  return merged.slice(0, limit);
}

function chunkArray(values, chunkSize = 10) {
  const size = Math.max(1, Math.floor(chunkSize));
  const arr = Array.isArray(values) ? values : [];
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function deriveWinReasonCountsFromGames(simulation) {
  const games = Array.isArray(simulation?.games) ? simulation.games : [];
  const counts = {};
  games.forEach((game) => {
    const reason = game?.winReason;
    if (reason === null || reason === undefined || reason === '') return;
    const key = String(reason);
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function summarizeGameForStorage(game) {
  if (!game || typeof game !== 'object') return null;
  const decisions = Array.isArray(game.decisions) ? game.decisions : [];
  const replay = Array.isArray(game.replay) ? game.replay : [];
  return {
    id: game.id,
    createdAt: game.createdAt,
    seed: game.seed,
    setupMode: game.setupMode || 'random',
    whiteParticipantId: game.whiteParticipantId || null,
    blackParticipantId: game.blackParticipantId || null,
    whiteParticipantLabel: game.whiteParticipantLabel || null,
    blackParticipantLabel: game.blackParticipantLabel || null,
    winner: Number.isFinite(game.winner) ? game.winner : null,
    winReason: game.winReason ?? null,
    plies: Number.isFinite(game.plies) ? game.plies : decisions.length,
    decisionCount: decisions.length,
    replayFrameCount: replay.length,
  };
}

function compactSimulationForState(simulation) {
  if (!simulation || typeof simulation !== 'object') return simulation;
  const games = Array.isArray(simulation.games) ? simulation.games : [];
  const isTerminal = !['running', 'stopping'].includes(String(simulation.status || '').toLowerCase());
  if (!simulation.gamesStoredExternally && !isTerminal) {
    return simulation;
  }
  return {
    ...simulation,
    gamesStoredExternally: Boolean(simulation.gamesStoredExternally),
    gameDetailsCompacted: simulation.gamesStoredExternally ? Boolean(simulation.gameDetailsCompacted) : true,
    gameCount: Number.isFinite(simulation.gameCount)
      ? simulation.gameCount
      : games.length,
    games: games
      .map((game) => summarizeGameForStorage(game))
      .filter(Boolean),
  };
}

function compactActionStatsForReplay(stats = []) {
  return (Array.isArray(stats) ? stats : [])
    .slice()
    .sort((left, right) => Number(right?.visits || 0) - Number(left?.visits || 0))
    .slice(0, RUN_REPLAY_ACTION_STATS_LIMIT)
    .map((entry) => ({
      actionKey: typeof entry?.actionKey === 'string'
        ? entry.actionKey
        : (typeof entry?.moveKey === 'string' ? entry.moveKey : ''),
      moveKey: typeof entry?.moveKey === 'string'
        ? entry.moveKey
        : (typeof entry?.actionKey === 'string' ? entry.actionKey : ''),
      visits: Number(entry?.visits || 0),
      prior: Number(entry?.prior || 0),
      q: Number(entry?.q || 0),
    }));
}

function compactDecisionTraceForReplay(trace = {}) {
  const actionStats = compactActionStatsForReplay(trace?.actionStats || trace?.moveStats || []);
  const hypothesisSummary = (Array.isArray(trace?.hypothesisSummary) ? trace.hypothesisSummary : [])
    .slice(0, RUN_REPLAY_ACTION_STATS_LIMIT)
    .map((entry) => ({
      probability: Number(entry?.probability || 0),
      searchWeight: Number(entry?.searchWeight || 0),
      valueRoot: Number(entry?.valueRoot || 0),
      sampledCount: Number(entry?.sampledCount || 0),
    }));
  return {
    algorithm: typeof trace?.algorithm === 'string' ? trace.algorithm : null,
    iterations: Number(trace?.iterations || 0),
    iterationsPerHypothesis: Number.isFinite(trace?.iterationsPerHypothesis)
      ? Number(trace.iterationsPerHypothesis)
      : null,
    hypothesisCount: Number(trace?.hypothesisCount || 0),
    rootVisits: Number(trace?.rootVisits || 0),
    kingBluffGuardApplied: Boolean(trace?.kingBluffGuardApplied),
    transpositionHits: Number(trace?.transpositionHits || 0),
    evaluationCacheHits: Number(trace?.evaluationCacheHits || 0),
    evaluationCount: Number(trace?.evaluationCount || 0),
    nodeCount: Number(trace?.nodeCount || 0),
    sampledHypothesisCounts: Array.isArray(trace?.sampledHypothesisCounts)
      ? trace.sampledHypothesisCounts
        .slice(0, RUN_REPLAY_ACTION_STATS_LIMIT)
        .map((value) => Number(value || 0))
      : [],
    hypothesisSummary,
    sharedTree: trace?.sharedTree && typeof trace.sharedTree === 'object'
      ? {
          totalNodeCount: Number(trace.sharedTree.totalNodeCount || 0),
          totalEvaluationCount: Number(trace.sharedTree.totalEvaluationCount || 0),
        }
      : null,
    actionStats,
    moveStats: actionStats,
    fastPath: trace?.fastPath && typeof trace.fastPath === 'object'
      ? {
          fallbackUsed: Boolean(trace.fastPath.fallbackUsed),
          adaptiveSearchApplied: Boolean(trace.fastPath.adaptiveSearchApplied),
          quietPosition: Boolean(trace.fastPath.quietPosition),
          responsePhase: Boolean(trace.fastPath.responsePhase),
          hiddenPieceCount: Number(trace.fastPath.hiddenPieceCount || 0),
          iterations: Number(trace.fastPath.iterations || 0),
          maxDepth: Number(trace.fastPath.maxDepth || 0),
          hypothesisCount: Number(trace.fastPath.hypothesisCount || 0),
          riskBias: Number(trace.fastPath.riskBias || 0),
          exploration: Number(trace.fastPath.exploration || 0),
        }
      : null,
    liveRoute: {
      fallbackUsed: Boolean(trace?.liveRoute?.fallbackUsed),
      parityMismatches: Array.isArray(trace?.liveRoute?.parityMismatches)
        ? trace.liveRoute.parityMismatches
          .slice(0, RUN_REPLAY_PARITY_MISMATCH_LIMIT)
          .map((entry) => String(entry))
        : [],
    },
  };
}

function compactDecisionTrainingRecordForReplay(trainingRecord = null) {
  const selectedActionKey = trainingRecord?.policy?.selectedActionKey || trainingRecord?.policy?.selectedMoveKey || null;
  const selectedMoveKey = trainingRecord?.policy?.selectedMoveKey || trainingRecord?.policy?.selectedActionKey || null;
  if (!selectedActionKey && !selectedMoveKey) {
    return null;
  }
  return {
    policy: {
      selectedActionKey,
      selectedMoveKey,
    },
  };
}

function compactDecisionForReplay(decision = null) {
  if (!decision || typeof decision !== 'object') return null;
  return {
    ply: Number.isFinite(decision?.ply) ? Number(decision.ply) : null,
    player: Number.isFinite(decision?.player) ? Number(decision.player) : null,
    participantId: decision?.participantId || null,
    participantLabel: decision?.participantLabel || null,
    snapshotId: decision?.snapshotId || null,
    action: decision?.action ? deepClone(decision.action) : null,
    move: decision?.move ? deepClone(decision.move) : null,
    valueEstimate: Number.isFinite(decision?.valueEstimate) ? Number(decision.valueEstimate) : 0,
    trace: compactDecisionTraceForReplay(decision?.trace || {}),
    trainingRecord: compactDecisionTrainingRecordForReplay(decision?.trainingRecord || null),
  };
}

function compactReplayFrameForRun(frame = null) {
  if (!frame || typeof frame !== 'object') return null;
  return {
    ply: Number.isFinite(frame?.ply) ? Number(frame.ply) : 0,
    toMove: Number.isFinite(frame?.toMove) ? Number(frame.toMove) : null,
    winner: Number.isFinite(frame?.winner) ? Number(frame.winner) : null,
    winReason: frame?.winReason ?? null,
    note: frame?.note || null,
    isActive: frame?.isActive !== false,
    board: Array.isArray(frame?.board) ? deepClone(frame.board) : [],
    stashes: Array.isArray(frame?.stashes) ? deepClone(frame.stashes) : [[], []],
    onDecks: Array.isArray(frame?.onDecks) ? deepClone(frame.onDecks) : [null, null],
    onDeckingPlayer: Number.isFinite(frame?.onDeckingPlayer) ? Number(frame.onDeckingPlayer) : null,
    daggers: Array.isArray(frame?.daggers) ? deepClone(frame.daggers) : [0, 0],
    captured: Array.isArray(frame?.captured) ? deepClone(frame.captured) : [[], []],
    lastMove: frame?.lastMove ? deepClone(frame.lastMove) : null,
    lastAction: frame?.lastAction ? deepClone(frame.lastAction) : null,
    actionCount: Number.isFinite(frame?.actionCount) ? Number(frame.actionCount) : 0,
    moveCount: Number.isFinite(frame?.moveCount) ? Number(frame.moveCount) : 0,
    decision: compactDecisionForReplay(frame?.decision || null),
  };
}

function compactRunRetainedGame(game = null) {
  if (!game || typeof game !== 'object') return null;
  return {
    id: game.id,
    createdAt: game.createdAt || nowIso(),
    seed: game.seed,
    setupMode: game.setupMode || 'live-route',
    whiteParticipantId: game.whiteParticipantId || null,
    blackParticipantId: game.blackParticipantId || null,
    whiteParticipantLabel: game.whiteParticipantLabel || null,
    blackParticipantLabel: game.blackParticipantLabel || null,
    winner: Number.isFinite(game?.winner) ? Number(game.winner) : null,
    winReason: game?.winReason ?? null,
    plies: Number.isFinite(game?.plies) ? Number(game.plies) : 0,
    phase: game.phase || 'selfplay',
    checkpointIndex: Number(game.checkpointIndex || 0),
    whiteGeneration: Number.isFinite(game?.whiteGeneration) ? Number(game.whiteGeneration) : null,
    blackGeneration: Number.isFinite(game?.blackGeneration) ? Number(game.blackGeneration) : null,
    retainedAt: game.retainedAt || nowIso(),
    actionHistory: Array.isArray(game?.actionHistory) ? deepClone(game.actionHistory) : [],
    moveHistory: Array.isArray(game?.moveHistory) ? deepClone(game.moveHistory) : [],
    replay: Array.isArray(game?.replay)
      ? game.replay.map((frame) => compactReplayFrameForRun(frame)).filter(Boolean)
      : [],
    result: game?.result ? deepClone(game.result) : null,
  };
}

function summarizeRunReplayGame(game = null) {
  if (!game || typeof game !== 'object') return null;
  return {
    id: game.id,
    createdAt: game.createdAt || nowIso(),
    durationMs: Number(game.durationMs || 0),
    phase: game.phase || 'selfplay',
    whiteGeneration: Number.isFinite(game?.whiteGeneration) ? Number(game.whiteGeneration) : 0,
    blackGeneration: Number.isFinite(game?.blackGeneration) ? Number(game.blackGeneration) : 0,
    whiteParticipantLabel: game.whiteParticipantLabel || `G${game.whiteGeneration}`,
    blackParticipantLabel: game.blackParticipantLabel || `G${game.blackGeneration}`,
    winner: Number.isFinite(game.winner) ? Number(game.winner) : null,
    winnerGeneration: Number.isFinite(game.winner)
      ? (Number(game.winner) === WHITE
        ? Number(game.whiteGeneration || 0)
        : Number(game.blackGeneration || 0))
      : null,
    winnerLabel: Number.isFinite(game.winner)
      ? (Number(game.winner) === WHITE
        ? (game.whiteParticipantLabel || `G${game.whiteGeneration}`)
        : (game.blackParticipantLabel || `G${game.blackGeneration}`))
      : 'Draw',
    title: `${game.whiteParticipantLabel || `G${game.whiteGeneration}`} vs ${game.blackParticipantLabel || `G${game.blackGeneration}`}`,
    winReason: game.winReason ?? null,
    plies: Number(game.plies || 0),
    replayFrameCount: Array.isArray(game?.replay) ? game.replay.length : 0,
  };
}

function createEmptyState() {
  return {
    version: 3,
    counters: {
      snapshot: 1,
      simulation: 1,
      game: 1,
      training: 1,
      run: 1,
    },
    snapshots: [],
    simulations: [],
    trainingRuns: [],
    runs: [],
    promotedBots: {
      enabledIds: [],
    },
    activeJobs: {
      simulation: null,
      training: null,
    },
  };
}

function normalizePromotedBotState(state) {
  return {
    enabledIds: uniqueStrings(state?.enabledIds || []),
  };
}

function isBootstrapSnapshotLabel(label) {
  return /^bootstrap(?:\b|\s|$)/i.test(String(label || '').trim());
}

function normalizeModelBundleForStorage(modelBundle) {
  if (!modelBundle || typeof modelBundle !== 'object') return null;
  return cloneModelBundle(normalizeModelBundle(deepClone(modelBundle)));
}

function getNetworkShapeSignature(network) {
  return {
    inputSize: Number(network?.inputSize || 0),
    outputSize: Number(network?.outputSize || 0),
    hiddenSizes: Array.isArray(network?.hiddenSizes)
      ? network.hiddenSizes.map((size) => Number(size || 0))
      : [],
    layers: Array.isArray(network?.layers)
      ? network.layers.map((layer) => ({
        inputSize: Number(layer?.inputSize || 0),
        outputSize: Number(layer?.outputSize || 0),
      }))
      : [],
  };
}

function getModelBundleShapeSignature(modelBundle) {
  const family = String(modelBundle?.family || '').trim().toLowerCase();
  if (family === SHARED_MODEL_FAMILY) {
    return {
      version: Number(modelBundle?.version || 0),
      family,
      interface: {
        stateInputSize: Number(modelBundle?.interface?.stateInputSize || 0),
        policyActionVocabularySize: Number(modelBundle?.interface?.policyActionVocabularySize || 0),
        beliefPieceSlotsPerPerspective: Number(modelBundle?.interface?.beliefPieceSlotsPerPerspective || 0),
        beliefIdentityCount: Number(modelBundle?.interface?.beliefIdentityCount || 0),
      },
      encoder: getNetworkShapeSignature(modelBundle?.encoder?.network),
      policy: getNetworkShapeSignature(modelBundle?.policy?.network),
      value: getNetworkShapeSignature(modelBundle?.value?.network),
      identity: {
        network: getNetworkShapeSignature(modelBundle?.identity?.network),
        inferredIdentityCount: Array.isArray(modelBundle?.identity?.inferredIdentities)
          ? modelBundle.identity.inferredIdentities.length
          : 0,
      },
    };
  }
  return {
    version: Number(modelBundle?.version || 0),
    policy: getNetworkShapeSignature(modelBundle?.policy?.network),
    value: getNetworkShapeSignature(modelBundle?.value?.network),
    identity: {
      network: getNetworkShapeSignature(modelBundle?.identity?.network),
      inferredIdentityCount: Array.isArray(modelBundle?.identity?.inferredIdentities)
        ? modelBundle.identity.inferredIdentities.length
        : 0,
    },
  };
}

function isPreferredBootstrapModelBundle(modelBundle) {
  const expectedShape = getModelBundleShapeSignature(createDefaultModelBundle({
    seed: PREFERRED_BOOTSTRAP_BASELINE_SEED,
  }));
  return JSON.stringify(getModelBundleShapeSignature(modelBundle)) === JSON.stringify(expectedShape);
}

function isPreferredBootstrapSnapshotRecord(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  if (snapshot.bootstrapKey === PREFERRED_BOOTSTRAP_BASELINE_KEY) return true;
  return snapshot.parentSnapshotId == null
    && isBootstrapSnapshotLabel(snapshot.label)
    && isPreferredBootstrapModelBundle(snapshot.modelBundle);
}

function normalizeModelBundleArtifact(modelBundle) {
  if (!modelBundle || typeof modelBundle !== 'object') {
    return {
      modelBundle: null,
      shapeChanged: false,
    };
  }
  const normalizedModelBundle = normalizeModelBundleForStorage(modelBundle);
  const shapeChanged = JSON.stringify(getModelBundleShapeSignature(modelBundle))
    !== JSON.stringify(getModelBundleShapeSignature(normalizedModelBundle));
  return {
    modelBundle: normalizedModelBundle,
    shapeChanged,
  };
}

function isNodeAdamLayerCompatible(stateLayer, networkLayer) {
  const inputSize = Number(networkLayer?.inputSize || 0);
  const outputSize = Number(networkLayer?.outputSize || 0);
  if (!stateLayer || typeof stateLayer !== 'object') return false;
  if (!Array.isArray(stateLayer.mWeights) || stateLayer.mWeights.length !== outputSize) return false;
  if (!Array.isArray(stateLayer.vWeights) || stateLayer.vWeights.length !== outputSize) return false;
  if (!Array.isArray(stateLayer.mBiases) || stateLayer.mBiases.length !== outputSize) return false;
  if (!Array.isArray(stateLayer.vBiases) || stateLayer.vBiases.length !== outputSize) return false;
  if (stateLayer.mWeights.some((row) => !Array.isArray(row) || row.length !== inputSize)) return false;
  if (stateLayer.vWeights.some((row) => !Array.isArray(row) || row.length !== inputSize)) return false;
  return true;
}

function isNodeAdamOptimizerStateCompatibleWithNetwork(state, network) {
  if (!isNodeAdamOptimizerState(state)) return false;
  const layers = Array.isArray(network?.layers) ? network.layers : [];
  if (state.layers.length !== layers.length) return false;
  return layers.every((layer, index) => isNodeAdamLayerCompatible(state.layers[index], layer));
}

function hasNodeStyleOptimizerState(optimizerState) {
  return Boolean(
    optimizerState
    && typeof optimizerState === 'object'
    && (
      isNodeAdamOptimizerState(optimizerState.encoder)
      || isNodeAdamOptimizerState(optimizerState.policy)
      || isNodeAdamOptimizerState(optimizerState.value)
      || isNodeAdamOptimizerState(optimizerState.identity)
    )
  );
}

function createDefaultRunConfig() {
  return {
    seedMode: RUN_SEED_MODES.BOOTSTRAP,
    seedSnapshotId: null,
    seedRunId: null,
    seedGeneration: null,
    seed: null,
    numSelfplayWorkers: defaultNumSelfplayWorkers(),
    parallelGameWorkers: defaultParallelGameWorkers(),
    numMctsSimulationsPerMove: 512,
    maxDepth: 64,
    hypothesisCount: 4,
    riskBias: 0,
    exploration: 1.5,
    replayBufferMaxPositions: 100000,
    batchSize: 256,
    learningRate: 0.0005,
    weightDecay: 0.0001,
    gradientClipNorm: 1,
    trainingStepsPerCycle: 32,
    parallelTrainingHeadWorkers: 3,
    trainingBackend: TRAINING_BACKENDS.AUTO,
    trainingDevicePreference: TRAINING_DEVICE_PREFERENCES.AUTO,
    checkpointInterval: DEFAULT_RUN_CHECKPOINT_INTERVAL,
    evalGamesPerCheckpoint: 40,
    promotionWinrateThreshold: 0.6,
    prePromotionTestGames: 40,
    prePromotionTestWinRate: 0.6,
    promotionTestGames: 100,
    promotionTestWinRate: 0.55,
    promotionTestPriorGenerations: 3,
    modelRefreshIntervalForWorkers: 5,
    olderGenerationSampleProbability: 0.10,
    generationComparisonStride: 5,
    stopOnMaxGenerations: false,
    maxGenerations: 200,
    stopOnMaxSelfPlayGames: false,
    maxSelfPlayGames: 10000,
    stopOnMaxTrainingSteps: false,
    maxTrainingSteps: 200000,
    stopOnMaxFailedPromotions: true,
    maxFailedPromotions: 50,
    retainedReplayGames: DEFAULT_RUN_MAX_REPLAY_GAMES,
  };
}

function normalizeRunLabel(input) {
  if (typeof input !== 'string') return '';
  return input.trim();
}

function normalizeRunConfig(options = {}) {
  const defaults = createDefaultRunConfig();
  const prePromotionTestGames = clampPositiveInt(
    options.prePromotionTestGames ?? options.evalGamesPerCheckpoint,
    defaults.prePromotionTestGames,
    1,
    400,
  );
  const prePromotionTestWinRate = normalizeFloat(
    options.prePromotionTestWinRate ?? options.promotionWinrateThreshold,
    defaults.prePromotionTestWinRate,
    0,
    1,
  );
  const promotionTestGames = clampPositiveInt(
    options.promotionTestGames ?? options.evalGamesPerCheckpoint,
    defaults.promotionTestGames,
    1,
    400,
  );
  const promotionTestWinRate = normalizeFloat(
    options.promotionTestWinRate ?? options.promotionWinrateThreshold,
    defaults.promotionTestWinRate,
    0,
    1,
  );
  const promotionTestPriorGenerations = clampPositiveInt(
    options.promotionTestPriorGenerations,
    defaults.promotionTestPriorGenerations,
    1,
    10,
  );
  const rawSeedMode = String(options.seedMode || defaults.seedMode).trim();
  const directPromotedSelection = parsePromotedModelBotId(
    typeof options.seedModelId === 'string' && options.seedModelId.trim()
      ? options.seedModelId.trim()
      : rawSeedMode,
  );
  let seedMode = RUN_SEED_MODES.BOOTSTRAP;
  let seedRunId = null;
  let seedGeneration = null;
  if (directPromotedSelection) {
    seedMode = RUN_SEED_MODES.PROMOTED_GENERATION;
    seedRunId = directPromotedSelection.runId;
    seedGeneration = directPromotedSelection.generation;
  } else {
    const normalizedSeedMode = rawSeedMode.toLowerCase();
    if (normalizedSeedMode === RUN_SEED_MODES.RANDOM) {
      seedMode = RUN_SEED_MODES.RANDOM;
    } else if ([
      RUN_SEED_MODES.PROMOTED_GENERATION,
      'promoted',
      'generation',
      'run_generation',
    ].includes(normalizedSeedMode)) {
      const parsedSeedGeneration = Number.parseInt(options.seedGeneration, 10);
      if (
        typeof options.seedRunId === 'string'
        && options.seedRunId.trim()
        && Number.isFinite(parsedSeedGeneration)
      ) {
        seedMode = RUN_SEED_MODES.PROMOTED_GENERATION;
        seedRunId = options.seedRunId.trim();
        seedGeneration = Math.max(0, parsedSeedGeneration);
      }
    }
  }
  const seedSnapshotId = seedMode === RUN_SEED_MODES.BOOTSTRAP
    && typeof options.seedSnapshotId === 'string'
    && options.seedSnapshotId.trim()
    ? options.seedSnapshotId.trim()
    : null;
  const seed = Number.isFinite(options.seed) ? Math.floor(options.seed) : null;
  return {
    seedMode,
    seedSnapshotId,
    seedRunId,
    seedGeneration,
    seed,
    numSelfplayWorkers: clampPositiveInt(options.numSelfplayWorkers, defaults.numSelfplayWorkers, 1, 128),
    parallelGameWorkers: clampPositiveInt(
      options.parallelGameWorkers,
      defaultParallelGameWorkers(),
      1,
      Math.max(1, getSystemParallelism()),
    ),
    numMctsSimulationsPerMove: clampPositiveInt(
      options.numMctsSimulationsPerMove,
      defaults.numMctsSimulationsPerMove,
      1,
      1200,
    ),
    maxDepth: clampPositiveInt(options.maxDepth, defaults.maxDepth, 1, 128),
    hypothesisCount: clampPositiveInt(options.hypothesisCount, defaults.hypothesisCount, 1, 32),
    riskBias: normalizeFloat(options.riskBias, defaults.riskBias, 0, 5),
    exploration: normalizeFloat(options.exploration, defaults.exploration, 0, 8),
    replayBufferMaxPositions: clampPositiveInt(
      options.replayBufferMaxPositions,
      defaults.replayBufferMaxPositions,
      16,
      500000,
    ),
    batchSize: clampPositiveInt(options.batchSize, defaults.batchSize, 1, 4096),
    learningRate: normalizeFloat(options.learningRate, defaults.learningRate, 0.00001, 1),
    weightDecay: normalizeFloat(options.weightDecay, defaults.weightDecay, 0, 1),
    gradientClipNorm: normalizeFloat(options.gradientClipNorm, defaults.gradientClipNorm, 0, 100),
    trainingStepsPerCycle: clampPositiveInt(options.trainingStepsPerCycle, defaults.trainingStepsPerCycle, 1, 5000),
    parallelTrainingHeadWorkers: clampPositiveInt(
      options.parallelTrainingHeadWorkers,
      defaults.parallelTrainingHeadWorkers,
      1,
      3,
    ),
    trainingBackend: normalizeTrainingBackend(options.trainingBackend, defaults.trainingBackend),
    trainingDevicePreference: normalizeTrainingDevicePreference(
      options.trainingDevicePreference,
      defaults.trainingDevicePreference,
    ),
    checkpointInterval: clampPositiveInt(options.checkpointInterval, defaults.checkpointInterval, 1, 100000),
    evalGamesPerCheckpoint: prePromotionTestGames,
    promotionWinrateThreshold: prePromotionTestWinRate,
    prePromotionTestGames,
    prePromotionTestWinRate,
    promotionTestGames,
    promotionTestWinRate,
    promotionTestPriorGenerations,
    modelRefreshIntervalForWorkers: clampPositiveInt(
      options.modelRefreshIntervalForWorkers,
      defaults.modelRefreshIntervalForWorkers,
      1,
      1000,
    ),
    olderGenerationSampleProbability: normalizeFloat(
      options.olderGenerationSampleProbability,
      defaults.olderGenerationSampleProbability,
      0,
      1,
    ),
    generationComparisonStride: clampPositiveInt(
      options.generationComparisonStride,
      defaults.generationComparisonStride,
      1,
      1000,
    ),
    stopOnMaxGenerations: options.stopOnMaxGenerations === true,
    maxGenerations: clampPositiveInt(options.maxGenerations, defaults.maxGenerations, 1, 100000),
    stopOnMaxSelfPlayGames: options.stopOnMaxSelfPlayGames === true,
    maxSelfPlayGames: clampPositiveInt(options.maxSelfPlayGames, defaults.maxSelfPlayGames, 1, 100000000),
    stopOnMaxTrainingSteps: options.stopOnMaxTrainingSteps === true,
    maxTrainingSteps: clampPositiveInt(options.maxTrainingSteps, defaults.maxTrainingSteps, 1, 100000000),
    stopOnMaxFailedPromotions: options.stopOnMaxFailedPromotions !== false,
    maxFailedPromotions: clampPositiveInt(options.maxFailedPromotions, defaults.maxFailedPromotions, 1, 1000000),
    retainedReplayGames: clampPositiveInt(
      options.retainedReplayGames,
      defaults.retainedReplayGames,
      20,
      10000,
    ),
  };
}

function applyRecommendedRunConfigDefaults(config = {}, rawOptions = {}, recommendedDefaults = {}) {
  const nextConfig = {
    ...config,
  };
  [
    'parallelGameWorkers',
    'numSelfplayWorkers',
    'batchSize',
    'trainingStepsPerCycle',
  ].forEach((key) => {
    if (!hasOwnDefinedValue(rawOptions, key) && hasOwnDefinedValue(recommendedDefaults, key)) {
      nextConfig[key] = recommendedDefaults[key];
    }
  });
  return nextConfig;
}

function computeEntropy(probabilities = []) {
  if (!Array.isArray(probabilities) || !probabilities.length) return 0;
  return probabilities.reduce((sum, value) => {
    const probability = Number(value);
    if (!Number.isFinite(probability) || probability <= 0) return sum;
    return sum - (probability * Math.log(probability));
  }, 0);
}

function averageNumbers(values = []) {
  const numbers = (Array.isArray(values) ? values : []).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function pickUniqueRandomIndices(totalCount, sampleCount, rng) {
  const total = clampPositiveInt(totalCount, 0, 0, Number.MAX_SAFE_INTEGER);
  const count = clampPositiveInt(sampleCount, 0, 0, total);
  if (!count || !total) return [];
  if (count >= total) {
    return Array.from({ length: total }, (_, index) => index);
  }
  const picks = new Set();
  while (picks.size < count) {
    picks.add(Math.floor(rng() * total));
  }
  return Array.from(picks);
}

function isValidPolicyTrainingSample(sample) {
  if (!sample || !Array.isArray(sample.features) || !Array.isArray(sample.target)) {
    return false;
  }
  if (!sample.features.length || sample.target.length !== sample.features.length) {
    return false;
  }
  return sample.features.every((vector) => Array.isArray(vector) && vector.length > 0);
}

function isValidValueTrainingSample(sample) {
  return Boolean(sample && Array.isArray(sample.features) && sample.features.length > 0);
}

function isValidIdentityTrainingSample(sample) {
  return Boolean(sample && Array.isArray(sample.pieceFeatures) && sample.pieceFeatures.length > 0);
}

function normalizeElapsedMs(value) {
  const elapsedMs = Number(value);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return 0;
  return elapsedMs;
}

function getRunTimingState(run) {
  if (!run || typeof run !== 'object') return { elapsedMs: 0, activeSegmentStartedAt: null };
  const timing = run.timing && typeof run.timing === 'object' ? run.timing : {};
  return {
    elapsedMs: normalizeElapsedMs(timing.elapsedMs ?? run.elapsedMs),
    activeSegmentStartedAt: timing.activeSegmentStartedAt || null,
  };
}

function initializeRunTiming(run, options = {}) {
  if (!run || typeof run !== 'object') return { elapsedMs: 0, activeSegmentStartedAt: null };
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const status = normalizeRunStatus(run?.status);
  const createdAtMs = parseTimeValue(run?.createdAt);
  const updatedAtMs = Math.max(parseTimeValue(run?.updatedAt), createdAtMs);
  const storedTiming = getRunTimingState(run);
  const legacyElapsedMs = createdAtMs > 0 ? Math.max(0, updatedAtMs - createdAtMs) : 0;
  const elapsedMs = storedTiming.elapsedMs > 0 ? storedTiming.elapsedMs : legacyElapsedMs;
  const nextTiming = {
    elapsedMs,
    activeSegmentStartedAt: null,
  };

  if (isRunStatusActive(status)) {
    nextTiming.activeSegmentStartedAt = new Date(nowMs).toISOString();
  }

  run.timing = nextTiming;
  return nextTiming;
}

function startRunTimingSegment(run, startedAt = nowIso()) {
  if (!run || typeof run !== 'object') return { elapsedMs: 0, activeSegmentStartedAt: null };
  const timing = getRunTimingState(run);
  run.timing = {
    elapsedMs: timing.elapsedMs,
    activeSegmentStartedAt: timing.activeSegmentStartedAt || startedAt,
  };
  return run.timing;
}

function finalizeRunTiming(run, endedAt = nowIso()) {
  if (!run || typeof run !== 'object') return { elapsedMs: 0, activeSegmentStartedAt: null };
  const timing = getRunTimingState(run);
  const startedAtMs = parseTimeValue(timing.activeSegmentStartedAt);
  const endedAtMs = parseTimeValue(endedAt);
  const elapsedMs = timing.elapsedMs + (
    startedAtMs > 0 && endedAtMs >= startedAtMs
      ? (endedAtMs - startedAtMs)
      : 0
  );
  run.timing = {
    elapsedMs: normalizeElapsedMs(elapsedMs),
    activeSegmentStartedAt: null,
  };
  return run.timing;
}

function computeRunElapsedMs(run, nowMs = Date.now()) {
  const timing = getRunTimingState(run);
  const createdAtMs = parseTimeValue(run?.createdAt);
  const updatedAtMs = Math.max(parseTimeValue(run?.updatedAt), createdAtMs);
  const legacyElapsedMs = createdAtMs > 0 ? Math.max(0, updatedAtMs - createdAtMs) : 0;
  const elapsedMs = timing.elapsedMs > 0 ? timing.elapsedMs : legacyElapsedMs;
  const status = normalizeRunStatus(run?.status);
  if (!isRunStatusActive(status)) {
    return elapsedMs;
  }
  const startedAtMs = parseTimeValue(timing.activeSegmentStartedAt);
  if (!Number.isFinite(startedAtMs) || startedAtMs <= 0) {
    return elapsedMs;
  }
  return elapsedMs + Math.max(0, nowMs - startedAtMs);
}

function summarizeDistinctNumbers(values = [], limit = 8) {
  const distinct = Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .filter((value) => Number.isFinite(value))
      .map((value) => Number(value)),
  ));
  distinct.sort((left, right) => left - right);
  return distinct.slice(0, limit);
}

function getErrorStatusCode(err) {
  if (Number.isFinite(err?.statusCode)) {
    return Number(err.statusCode);
  }
  if (Number.isFinite(err?.status)) {
    return Number(err.status);
  }
  return null;
}

function summarizeError(err) {
  if (!err) return null;
  return {
    name: err?.name || null,
    message: err?.message || String(err),
    code: err?.code || null,
    statusCode: getErrorStatusCode(err),
    stack: typeof err?.stack === 'string' ? err.stack : null,
    details: err?.details || null,
  };
}

function summarizePolicySamplesForDebug(policySamples = [], expectedInputSize = 0, options = {}) {
  const samples = Array.isArray(policySamples) ? policySamples : [];
  const sharedFamily = String(options.family || '').trim().toLowerCase() === SHARED_MODEL_FAMILY;
  const actionCounts = [];
  const featureLengths = [];
  let targetLengthMismatchCount = 0;
  let emptyTargetCount = 0;
  samples.forEach((sample) => {
    const features = sharedFamily
      ? (Array.isArray(sample?.stateInput) ? sample.stateInput : [])
      : (Array.isArray(sample?.features) ? sample.features : []);
    const target = Array.isArray(sample?.target) ? sample.target : [];
    actionCounts.push(sharedFamily ? Number(sample?.actionKeys?.length || 0) : features.length);
    if (!target.length) emptyTargetCount += 1;
    if (sharedFamily) {
      if (target.length > 0 && Number(expectedInputSize || 0) <= 0) {
        targetLengthMismatchCount += 0;
      }
      featureLengths.push(features.length);
    } else {
      if (features.length !== target.length) targetLengthMismatchCount += 1;
      features.forEach((vector) => {
        if (Array.isArray(vector)) {
          featureLengths.push(vector.length);
        }
      });
    }
  });
  return {
    count: samples.length,
    actionCountValues: summarizeDistinctNumbers(actionCounts),
    featureLengthValues: summarizeDistinctNumbers(featureLengths),
    expectedInputSize: Number(expectedInputSize || 0),
    targetLengthMismatchCount,
    emptyTargetCount,
  };
}

function summarizeValueSamplesForDebug(valueSamples = [], expectedInputSize = 0, options = {}) {
  const samples = Array.isArray(valueSamples) ? valueSamples : [];
  const sharedFamily = String(options.family || '').trim().toLowerCase() === SHARED_MODEL_FAMILY;
  const featureLengths = samples
    .map((sample) => {
      if (sharedFamily && Array.isArray(sample?.stateInput)) {
        return sample.stateInput.length;
      }
      return Array.isArray(sample?.features) ? sample.features.length : null;
    })
    .filter((value) => Number.isFinite(value));
  const targetValues = samples
    .map((sample) => (Number.isFinite(sample?.target) ? Number(sample.target) : null))
    .filter((value) => Number.isFinite(value));
  return {
    count: samples.length,
    featureLengthValues: summarizeDistinctNumbers(featureLengths),
    expectedInputSize: Number(expectedInputSize || 0),
    minTarget: targetValues.length ? Math.min(...targetValues) : null,
    maxTarget: targetValues.length ? Math.max(...targetValues) : null,
  };
}

function summarizeIdentitySamplesForDebug(identitySamples = [], expectedInputSize = 0, expectedOutputSize = 0, options = {}) {
  const samples = Array.isArray(identitySamples) ? identitySamples : [];
  const sharedFamily = String(options.family || '').trim().toLowerCase() === SHARED_MODEL_FAMILY;
  const featureLengths = [];
  const truthIndexHistogram = {};
  let unknownTruthCount = 0;
  let maxTruthIndex = -1;
  samples.forEach((sample) => {
    if (sharedFamily && Array.isArray(sample?.stateInput)) {
      featureLengths.push(sample.stateInput.length);
    } else if (Array.isArray(sample?.pieceFeatures)) {
      featureLengths.push(sample.pieceFeatures.length);
    }
    const truthIndex = sharedFamily
      ? (Number.isFinite(sample?.trueIdentityIndex) ? Number(sample.trueIdentityIndex) : INFERRED_IDENTITIES.indexOf(sample?.trueIdentity))
      : INFERRED_IDENTITIES.indexOf(sample?.trueIdentity);
    if (truthIndex < 0) {
      unknownTruthCount += 1;
      return;
    }
    truthIndexHistogram[truthIndex] = (truthIndexHistogram[truthIndex] || 0) + 1;
    if (truthIndex > maxTruthIndex) {
      maxTruthIndex = truthIndex;
    }
  });
  return {
    count: samples.length,
    featureLengthValues: summarizeDistinctNumbers(featureLengths),
    expectedInputSize: Number(expectedInputSize || 0),
    expectedOutputSize: Number(expectedOutputSize || 0),
    inferredIdentityCount: INFERRED_IDENTITIES.length,
    unknownTruthCount,
    maxTruthIndex,
    truthIndexHistogram,
  };
}

function buildTrainingBatchDebugSummary(options = {}, backendResolution = null) {
  const modelBundle = options.modelBundle || {};
  const family = String(modelBundle?.family || '').trim().toLowerCase();
  const sharedFamily = family === SHARED_MODEL_FAMILY;
  const policyInputSize = Number(modelBundle?.policy?.network?.inputSize || 0);
  const valueInputSize = Number(modelBundle?.value?.network?.inputSize || 0);
  const identityInputSize = Number(modelBundle?.identity?.network?.inputSize || 0);
  const identityOutputSize = Number(modelBundle?.identity?.network?.outputSize || 0);
  return {
    debugContext: options.debugContext || null,
    requestedBackend: options.trainingBackend || null,
    requestedDevicePreference: options.trainingDevicePreference || null,
    resolvedBackend: backendResolution?.backend || null,
    resolvedDevice: backendResolution?.device || null,
    epochs: Number(options.epochs || 1),
    trainingOptions: {
      learningRate: Number(options.learningRate || 0),
      batchSize: Number(options.batchSize || 0),
      weightDecay: Number(options.weightDecay || 0),
      gradientClipNorm: Number(options.gradientClipNorm || 0),
      parallelTrainingHeadWorkers: Number(options.parallelTrainingHeadWorkers || 0),
    },
    model: {
      family: family || 'legacy',
      encoderInputSize: Number(modelBundle?.interface?.stateInputSize || 0),
      policyInputSize,
      valueInputSize,
      identityInputSize,
      identityOutputSize,
      inferredIdentities: INFERRED_IDENTITIES.slice(),
      inferredIdentityCount: INFERRED_IDENTITIES.length,
    },
    samples: {
      policy: summarizePolicySamplesForDebug(
        options?.samples?.policySamples || [],
        sharedFamily ? Number(modelBundle?.interface?.stateInputSize || 0) : policyInputSize,
        { family },
      ),
      value: summarizeValueSamplesForDebug(
        options?.samples?.valueSamples || [],
        sharedFamily ? Number(modelBundle?.interface?.stateInputSize || 0) : valueInputSize,
        { family },
      ),
      identity: summarizeIdentitySamplesForDebug(
        options?.samples?.identitySamples || [],
        sharedFamily ? Number(modelBundle?.interface?.stateInputSize || 0) : identityInputSize,
        identityOutputSize,
        { family },
      ),
    },
  };
}

function getTrainingBatchDebugIssues(summary = {}) {
  const issues = [];
  const model = summary.model || {};
  const samples = summary.samples || {};
  if (
    String(model.family || '') !== SHARED_MODEL_FAMILY
    && model.identityOutputSize > 0
    && model.identityOutputSize !== model.inferredIdentityCount
  ) {
    issues.push(
      `Identity network output size ${model.identityOutputSize} does not match inferred identity count ${model.inferredIdentityCount}`,
    );
  }
  if ((samples.policy?.featureLengthValues || []).some((value) => value !== samples.policy.expectedInputSize)) {
    issues.push(`Policy feature length mismatch: expected ${samples.policy.expectedInputSize}, saw ${samples.policy.featureLengthValues.join(',')}`);
  }
  if (String(model.family || '') !== SHARED_MODEL_FAMILY && Number(samples.policy?.targetLengthMismatchCount || 0) > 0) {
    issues.push(`Policy samples with feature/target length mismatch: ${samples.policy.targetLengthMismatchCount}`);
  }
  if ((samples.value?.featureLengthValues || []).some((value) => value !== samples.value.expectedInputSize)) {
    issues.push(`Value feature length mismatch: expected ${samples.value.expectedInputSize}, saw ${samples.value.featureLengthValues.join(',')}`);
  }
  if ((samples.identity?.featureLengthValues || []).some((value) => value !== samples.identity.expectedInputSize)) {
    issues.push(`Identity feature length mismatch: expected ${samples.identity.expectedInputSize}, saw ${samples.identity.featureLengthValues.join(',')}`);
  }
  if (Number(samples.identity?.unknownTruthCount || 0) > 0) {
    issues.push(`Identity samples with unknown truth labels: ${samples.identity.unknownTruthCount}`);
  }
  if (
    Number.isFinite(samples.identity?.maxTruthIndex)
    && Number(samples.identity.maxTruthIndex) >= Number(model.identityOutputSize || 0)
  ) {
    issues.push(
      `Identity truth index ${samples.identity.maxTruthIndex} exceeds output size ${model.identityOutputSize}`,
    );
  }
  return issues;
}

function safeWinRate(wins, losses, draws) {
  const total = Number(wins || 0) + Number(losses || 0) + Number(draws || 0);
  if (total <= 0) return 0;
  return (Number(wins || 0) + (Number(draws || 0) * 0.5)) / total;
}

function estimateEloDeltaFromWinRate(winRate) {
  const clamped = Math.max(0.001, Math.min(0.999, Number(winRate) || 0.5));
  return 400 * Math.log10(clamped / (1 - clamped));
}

function buildGenerationPairKey(generationA, generationB) {
  const left = Number.isFinite(generationA) ? Number(generationA) : -1;
  const right = Number.isFinite(generationB) ? Number(generationB) : -1;
  return left <= right ? `${left}:${right}` : `${right}:${left}`;
}

function extractPostHandler(router) {
  if (!router || !Array.isArray(router.stack)) {
    throw new Error('Router stack unavailable');
  }
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

function createInternalRequestSession(userId, username = 'SimulationUser') {
  if (!userId) return null;
  return {
    userId: String(userId),
    username,
    authenticated: false,
    isGuest: true,
    email: '',
    user: {
      _id: String(userId),
      username,
      isGuest: true,
      isBot: true,
      botDifficulty: 'medium',
    },
  };
}

async function callPostHandler(handler, body = {}, options = {}) {
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
      headers: { ...(options.headers || {}) },
      body: deepClone(body),
      query: { ...(options.query || {}) },
      params: { ...(options.params || {}) },
      __resolvedSession: options.session || null,
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

    const execute = () => Promise.resolve(handler(req, res, next));
    const runner = options.simulationContext === false
      ? execute()
      : runInSimulationRequestContext(execute, {
        route: options.routeName || 'internal',
        gameId: body?.gameId || null,
        matchId: body?.matchId || null,
      });

    runner
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

const ROUTE_HANDLERS = Object.freeze({
  matchCreate: extractPostHandler(matchesCreateRoute),
  gameCreate: extractPostHandler(gamesCreateRoute),
  setup: extractPostHandler(setupRoute),
  ready: extractPostHandler(readyRoute),
  move: extractPostHandler(moveRoute),
  challenge: extractPostHandler(challengeRoute),
  bomb: extractPostHandler(bombRoute),
  pass: extractPostHandler(passRoute),
  onDeck: extractPostHandler(onDeckRoute),
  resign: extractPostHandler(resignRoute),
  draw: extractPostHandler(drawRoute),
});

function normalizeActionType(type) {
  return String(type || '').trim().toUpperCase();
}

function isRecoverableLiveActionError(err) {
  const statusCode = getErrorStatusCode(err);
  return statusCode === 400 || statusCode === 404 || statusCode === 409;
}

function buildPreferredLiveActionCandidates(search, legalActions = []) {
  const legalByKey = new Map(
    (Array.isArray(legalActions) ? legalActions : []).map((action) => [actionKey(action), action]),
  );
  const candidates = [];
  const seen = new Set();
  const appendCandidate = (action) => {
    if (!action) return;
    const key = actionKey(action);
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(action);
  };

  const requestedAction = search?.action || null;
  const requestedKey = requestedAction ? actionKey(requestedAction) : '';
  if (requestedKey && legalByKey.has(requestedKey)) {
    appendCandidate(legalByKey.get(requestedKey));
  }

  const rankedCandidates = Array.isArray(search?.trace?.actionStats)
    ? search.trace.actionStats
    : [];
  rankedCandidates.forEach((entry) => {
    appendCandidate(legalByKey.get(String(entry?.actionKey || '')));
  });

  legalByKey.forEach((action) => {
    appendCandidate(action);
  });

  return candidates;
}

function liveTestBotMustAct(game, botColor) {
  return (
    (Number.isFinite(game?.playerTurn) && Number(game.playerTurn) === botColor)
    || (Number.isFinite(game?.onDeckingPlayer) && Number(game.onDeckingPlayer) === botColor)
  );
}

function clonePiece(piece, fallbackColor = null) {
  if (!piece || typeof piece !== 'object') return null;
  const color = Number.isFinite(piece.color) ? piece.color : fallbackColor;
  const identity = Number.isFinite(piece.identity) ? piece.identity : null;
  if (!Number.isFinite(color) || !Number.isFinite(identity)) return null;
  return { color, identity };
}

function shuffleWithRng(values, rng) {
  const arr = Array.isArray(values) ? values.slice() : [];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildRandomSetupFromGame(game, color, rng, config) {
  const ranks = Number(config?.boardDimensions?.RANKS) || 6;
  const files = Number(config?.boardDimensions?.FILES) || 5;
  const kingIdentity = config?.identities?.get
    ? config.identities.get('KING')
    : 1;

  const row = color === WHITE ? 0 : (ranks - 1);
  const stash = Array.isArray(game?.stashes?.[color]) ? game.stashes[color] : [];
  const candidates = stash
    .map((piece) => clonePiece(piece, color))
    .filter(Boolean);
  if (candidates.length < (files + 1)) {
    throw new Error(`Insufficient stash pieces for setup (color ${color})`);
  }

  const kingIndex = candidates.findIndex((piece) => piece.identity === kingIdentity);
  if (kingIndex < 0) {
    throw new Error(`Setup stash missing king for color ${color}`);
  }

  const kingPiece = candidates.splice(kingIndex, 1)[0];
  const shuffled = shuffleWithRng(candidates, rng);
  const rankPieces = [kingPiece, ...shuffled.slice(0, files - 1)];
  const remaining = shuffled.slice(files - 1);
  if (!remaining.length) {
    throw new Error(`Setup stash missing on-deck piece for color ${color}`);
  }
  const onDeck = remaining[0];

  const columns = shuffleWithRng(
    Array.from({ length: files }, (_, idx) => idx),
    rng,
  );

  const pieces = rankPieces.map((piece, index) => ({
    row,
    col: columns[index],
    color,
    identity: piece.identity,
  }));

  return {
    pieces,
    onDeck: {
      color,
      identity: onDeck.identity,
    },
  };
}

function buildLiveTestSetupFromGame(game, color, config) {
  const ranks = Number(config?.boardDimensions?.RANKS) || 6;
  const files = Number(config?.boardDimensions?.FILES) || 5;
  const kingIdentity = config?.identities?.get
    ? config.identities.get('KING')
    : 1;
  const row = color === WHITE ? 0 : (ranks - 1);
  const stash = Array.isArray(game?.stashes?.[color]) ? game.stashes[color] : [];
  const candidates = stash
    .map((piece) => clonePiece(piece, color))
    .filter(Boolean);
  const kingPiece = candidates.find((piece) => piece.identity === kingIdentity) || null;
  const nonKingPieces = candidates.filter((piece) => piece.identity !== kingIdentity);
  if (!kingPiece || nonKingPieces.length < files) {
    throw new Error(`Insufficient stash pieces for live test setup (color ${color})`);
  }

  const rankPieces = [kingPiece, ...nonKingPieces.slice(0, files - 1)];
  const onDeckPiece = nonKingPieces[files - 1];

  return {
    pieces: rankPieces.map((piece, index) => ({
      row,
      col: index,
      color,
      identity: piece.identity,
    })),
    onDeck: {
      color,
      identity: onDeckPiece.identity,
    },
  };
}

async function loadGameLean(gameId) {
  const query = Game.findById(gameId);
  if (!query) return null;
  if (typeof query.lean === 'function') {
    return query.lean();
  }
  const doc = await query;
  if (!doc) return null;
  return typeof doc.toObject === 'function' ? doc.toObject() : deepClone(doc);
}

async function loadGameDocument(gameId) {
  const query = Game.findById(gameId);
  if (!query) return null;
  const doc = await query;
  return doc || null;
}

function toReplayPiece(piece, zone, row = -1, col = -1, id = '') {
  if (!piece) return null;
  return {
    id: id || `${zone}:${row}:${col}:${piece.color}:${piece.identity}`,
    color: piece.color,
    identity: piece.identity,
    zone,
    row,
    col,
  };
}

function toReplayFrameFromGame(game, metadata = {}) {
  const board = Array.isArray(game?.board)
    ? game.board.map((row, rIdx) => (
      Array.isArray(row)
        ? row.map((piece, cIdx) => (
          piece
            ? toReplayPiece(piece, 'board', rIdx, cIdx, `b:${rIdx}:${cIdx}`)
            : null
        ))
        : []
    ))
    : [];

  const onDecks = [WHITE, BLACK].map((color) => {
    const piece = game?.onDecks?.[color] || null;
    return piece ? toReplayPiece(piece, 'onDeck', -1, -1, `d:${color}`) : null;
  });

  const stashes = [WHITE, BLACK].map((color) => (
    Array.isArray(game?.stashes?.[color])
      ? game.stashes[color]
        .map((piece, idx) => toReplayPiece(piece, 'stash', -1, idx, `s:${color}:${idx}`))
        .filter(Boolean)
      : []
  ));

  const captured = [WHITE, BLACK].map((color) => (
    Array.isArray(game?.captured?.[color])
      ? game.captured[color]
        .map((piece, idx) => toReplayPiece(piece, 'captured', -1, idx, `c:${color}:${idx}`))
        .filter(Boolean)
      : []
  ));

  const moves = Array.isArray(game?.moves) ? game.moves : [];
  const actions = Array.isArray(game?.actions) ? game.actions : [];
  const lastMove = moves.length ? deepClone(moves[moves.length - 1]) : null;
  const lastAction = actions.length ? deepClone(actions[actions.length - 1]) : null;

  return {
    ply: actions.length,
    actionCount: actions.length,
    moveCount: moves.length,
    toMove: Number.isFinite(game?.playerTurn) ? game.playerTurn : WHITE,
    winner: Number.isFinite(game?.winner) ? game.winner : null,
    winReason: game?.winReason ?? null,
    isActive: Boolean(game?.isActive),
    board,
    onDecks,
    stashes,
    captured,
    daggers: Array.isArray(game?.daggers) ? game.daggers.slice(0, 2) : [0, 0],
    movesSinceAction: Number.isFinite(game?.movesSinceAction) ? game.movesSinceAction : 0,
    onDeckingPlayer: Number.isFinite(game?.onDeckingPlayer) ? game.onDeckingPlayer : null,
    lastMove,
    lastAction,
    ...metadata,
  };
}

function buildMlStateFromGame(game, options = {}) {
  const rows = Number(options?.rows) || 6;
  const cols = Number(options?.cols) || 5;
  const board = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  const pieces = {};
  const stashes = [[], []];
  const onDecks = [null, null];
  const captured = [[], []];
  const moveHistoryByPiece = {};
  const revealedIdentities = {};
  let counter = 0;

  const register = (piece, zone, color, row = -1, col = -1, capturedBy = null) => {
    const normalized = clonePiece(piece, color);
    if (!normalized) return null;
    const id = `p-${counter}`;
    counter += 1;
    pieces[id] = {
      id,
      color: normalized.color,
      identity: normalized.identity,
      alive: zone !== 'captured',
      zone,
      row,
      col,
      capturedBy,
    };
    moveHistoryByPiece[id] = [];
    if (zone === 'board') {
      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        board[row][col] = id;
      }
    } else if (zone === 'stash') {
      stashes[normalized.color].push(id);
    } else if (zone === 'onDeck') {
      onDecks[normalized.color] = id;
    } else if (zone === 'captured' && Number.isFinite(capturedBy)) {
      captured[capturedBy].push(id);
    }
    return id;
  };

  if (Array.isArray(game?.board)) {
    game.board.forEach((row, rIdx) => {
      if (!Array.isArray(row)) return;
      row.forEach((piece, cIdx) => {
        if (piece) {
          register(piece, 'board', piece.color, rIdx, cIdx, null);
        }
      });
    });
  }

  [WHITE, BLACK].forEach((color) => {
    if (Array.isArray(game?.stashes?.[color])) {
      game.stashes[color].forEach((piece) => {
        register(piece, 'stash', color, -1, -1, null);
      });
    }
    const onDeckPiece = game?.onDecks?.[color];
    if (onDeckPiece) {
      register(onDeckPiece, 'onDeck', color, -1, -1, null);
    }
    if (Array.isArray(game?.captured?.[color])) {
      game.captured[color].forEach((piece) => {
        register(piece, 'captured', piece?.color, -1, -1, color);
      });
    }
  });

  const actions = Array.isArray(game?.actions)
    ? game.actions.map((action, idx) => ({
      type: action.type,
      player: action.player,
      timestamp: idx,
      details: deepClone(action.details || {}),
    }))
    : [];
  const moves = Array.isArray(game?.moves)
    ? game.moves.map((move, idx) => ({
      player: move.player,
      pieceId: null,
      from: move.from ? { row: move.from.row, col: move.from.col } : null,
      to: move.to ? { row: move.to.row, col: move.to.col } : null,
      declaration: move.declaration,
      state: move.state,
      timestamp: idx,
    }))
    : [];

  return {
    board,
    pieces,
    stashes,
    onDecks,
    captured,
    moves,
    actions,
    daggers: Array.isArray(game?.daggers) ? game.daggers.slice(0, 2) : [0, 0],
    movesSinceAction: Number.isFinite(game?.movesSinceAction) ? game.movesSinceAction : 0,
    setupComplete: Array.isArray(game?.setupComplete) ? game.setupComplete.slice(0, 2) : [true, true],
    playersReady: Array.isArray(game?.playersReady) ? game.playersReady.slice(0, 2) : [true, true],
    onDeckingPlayer: Number.isFinite(game?.onDeckingPlayer) ? game.onDeckingPlayer : null,
    playerTurn: Number.isFinite(game?.playerTurn) ? game.playerTurn : WHITE,
    toMove: Number.isFinite(game?.playerTurn) ? game.playerTurn : WHITE,
    winner: Number.isFinite(game?.winner) ? game.winner : null,
    winReason: game?.winReason ?? null,
    isActive: Boolean(game?.isActive),
    ply: actions.length,
    maxPlies: Number.isFinite(options?.maxPlies) ? options.maxPlies : 120,
    seed: Number.isFinite(options?.seed) ? options.seed : Date.now(),
    moveHistoryByPiece,
    revealedIdentities,
  };
}

function createShadowStateFromLiveGame(game, options = {}) {
  const state = buildMlStateFromGame(game, options);
  if (options.resetActionHistory) {
    state.actions = [];
    state.moves = [];
    state.movesSinceAction = Number.isFinite(game?.movesSinceAction) ? game.movesSinceAction : 0;
  }
  if (Number.isFinite(options.playablePly)) {
    state.ply = options.playablePly;
  }
  if (Number.isFinite(game?.playerTurn)) {
    state.playerTurn = game.playerTurn;
    state.toMove = game.playerTurn;
  }
  if (Number.isFinite(options.maxPlies)) {
    state.maxPlies = options.maxPlies;
  }
  return state;
}

async function resolveLiveAiMatchSettings() {
  const config = typeof getServerConfig.getServerConfigSnapshotSync === 'function'
    ? getServerConfig.getServerConfigSnapshotSync()
    : await getServerConfig();
  const quickplaySettings = config?.gameModeSettings?.get
    ? (config.gameModeSettings.get('QUICKPLAY') || {})
    : (config?.gameModeSettings?.QUICKPLAY || {});
  const incrementSetting = config?.gameModeSettings?.get
    ? config.gameModeSettings.get('INCREMENT')
    : config?.gameModeSettings?.INCREMENT;
  const timeControl = Number(quickplaySettings?.TIME_CONTROL) || 300000;
  const increment = Number(incrementSetting) || 0;
  const type = config?.gameModes?.get
    ? (config.gameModes.get('AI') || 'AI')
    : (config?.gameModes?.AI || 'AI');
  return { timeControl, increment, type, config };
}

async function createApiBackedGame(seed) {
  const { config, timeControl, increment } = await resolveLiveAiMatchSettings();
  const type = config?.gameModes?.get
    ? (config.gameModes.get('QUICKPLAY') || 'QUICKPLAY')
    : (config?.gameModes?.QUICKPLAY || 'QUICKPLAY');

  const player1 = new mongoose.Types.ObjectId().toString();
  const player2 = new mongoose.Types.ObjectId().toString();
  const sessionsByColor = {
    [WHITE]: createInternalRequestSession(player1, 'SimulationWhite'),
    [BLACK]: createInternalRequestSession(player2, 'SimulationBlack'),
  };
  const match = await callPostHandler(ROUTE_HANDLERS.matchCreate, {
    type,
    player1,
    player2,
    player1Score: 0,
    player2Score: 0,
    drawCount: 0,
    games: [],
    // Keep match inactive so game end does not auto-spawn follow-up games.
    isActive: false,
  });
  const matchId = String(match?._id || '');
  if (!matchId) {
    throw new Error('Failed to create API simulation match');
  }

  const game = await callPostHandler(ROUTE_HANDLERS.gameCreate, {
    matchId,
      players: [player1, player2],
    timeControlStart: timeControl,
    increment,
  });
  const gameId = String(game?._id || '');
  if (!gameId) {
    throw new Error('Failed to create API simulation game');
  }

  const rng = createRng(seed);
  let liveGame = await loadGameLean(gameId);
  if (!liveGame) {
    throw new Error('Created game was not found');
  }
  const whiteSetup = buildRandomSetupFromGame(liveGame, WHITE, rng, config);
  await callPostHandler(ROUTE_HANDLERS.setup, {
    gameId,
    color: WHITE,
    pieces: whiteSetup.pieces,
    onDeck: whiteSetup.onDeck,
  }, { session: sessionsByColor[WHITE] });
  liveGame = await loadGameLean(gameId);
  const blackSetup = buildRandomSetupFromGame(liveGame, BLACK, rng, config);
  await callPostHandler(ROUTE_HANDLERS.setup, {
    gameId,
    color: BLACK,
    pieces: blackSetup.pieces,
    onDeck: blackSetup.onDeck,
  }, { session: sessionsByColor[BLACK] });

  await callPostHandler(ROUTE_HANDLERS.ready, { gameId, color: WHITE }, { session: sessionsByColor[WHITE] });
  await callPostHandler(ROUTE_HANDLERS.ready, { gameId, color: BLACK }, { session: sessionsByColor[BLACK] });

  const readyGame = await loadGameLean(gameId);
  if (!readyGame) {
    throw new Error('Game disappeared after setup');
  }

  return {
    gameId,
    matchId,
    game: readyGame,
    players: [player1, player2],
    sessionsByColor,
  };
}

async function cleanupApiBackedGame({ gameId, matchId }) {
  const canTouchMongoHistory = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  if (gameId) {
    try {
      await Game.deleteMany({ _id: gameId });
    } catch (_) {}
    try {
      if (
        canTouchMongoHistory
        && Game.historyModel
        && typeof Game.historyModel.deleteOne === 'function'
      ) {
        await Game.historyModel.deleteOne({ _id: gameId });
      }
    } catch (_) {}
  }
  if (matchId) {
    try {
      await Match.deleteMany({ _id: matchId });
    } catch (_) {}
    try {
      if (
        canTouchMongoHistory
        && Match.historyModel
        && typeof Match.historyModel.deleteOne === 'function'
      ) {
        await Match.historyModel.deleteOne({ _id: matchId });
      }
    } catch (_) {}
  }
}

function summarizeLiveBoard(game) {
  return Array.isArray(game?.board)
    ? game.board.map((row) => (
      Array.isArray(row)
        ? row.map((piece) => (piece ? `${piece.color}:${piece.identity}` : '.')).join('|')
        : ''
    ))
    : [];
}

function summarizeShadowBoard(state) {
  return Array.isArray(state?.board)
    ? state.board.map((row) => (
      Array.isArray(row)
        ? row.map((pieceId) => {
          if (!pieceId) return '.';
          const piece = state.pieces?.[pieceId];
          return piece ? `${piece.color}:${piece.identity}` : '.';
        }).join('|')
        : ''
    ))
    : [];
}

function summarizeLiveZone(zone = []) {
  return (Array.isArray(zone) ? zone : [])
    .map((piece) => (piece ? `${piece.color}:${piece.identity}` : '.'))
    .sort();
}

function summarizeShadowZone(state, pieceIds = []) {
  return (Array.isArray(pieceIds) ? pieceIds : [])
    .map((pieceId) => {
      const piece = state?.pieces?.[pieceId];
      return piece ? `${piece.color}:${piece.identity}` : '.';
    })
    .sort();
}

function compareLiveGameToShadowState(liveGame, shadowState) {
  const mismatches = [];
  if (!liveGame || !shadowState) {
    return {
      ok: false,
      mismatches: ['missing_state'],
    };
  }
  if ((liveGame.playerTurn ?? null) !== (shadowState.playerTurn ?? null)) {
    mismatches.push('playerTurn');
  }
  if ((liveGame.onDeckingPlayer ?? null) !== (shadowState.onDeckingPlayer ?? null)) {
    mismatches.push('onDeckingPlayer');
  }
  if (Boolean(liveGame.isActive) !== Boolean(shadowState.isActive)) {
    mismatches.push('isActive');
  }
  if (summarizeLiveBoard(liveGame).join('/') !== summarizeShadowBoard(shadowState).join('/')) {
    mismatches.push('board');
  }
  [WHITE, BLACK].forEach((color) => {
    if (summarizeLiveZone(liveGame?.stashes?.[color]).join(',') !== summarizeShadowZone(shadowState, shadowState?.stashes?.[color]).join(',')) {
      mismatches.push(`stash:${color}`);
    }
    if (summarizeLiveZone(liveGame?.captured?.[color]).join(',') !== summarizeShadowZone(shadowState, shadowState?.captured?.[color]).join(',')) {
      mismatches.push(`captured:${color}`);
    }
    const liveOnDeck = liveGame?.onDecks?.[color] ? `${liveGame.onDecks[color].color}:${liveGame.onDecks[color].identity}` : '.';
    const shadowOnDeckId = shadowState?.onDecks?.[color];
    const shadowOnDeckPiece = shadowOnDeckId ? shadowState?.pieces?.[shadowOnDeckId] : null;
    const shadowOnDeck = shadowOnDeckPiece ? `${shadowOnDeckPiece.color}:${shadowOnDeckPiece.identity}` : '.';
    if (liveOnDeck !== shadowOnDeck) {
      mismatches.push(`onDeck:${color}`);
    }
  });
  return {
    ok: mismatches.length === 0,
    mismatches,
  };
}

async function applyLiveActionToGame(context, action, shadowState) {
  const type = normalizeActionType(action?.type);
  const color = Number.isFinite(action?.player) ? action.player : shadowState?.playerTurn;
  const session = context?.sessionsByColor?.[color] || null;
  if (!context?.gameId || !session) {
    throw new Error('Simulation live game context is incomplete');
  }

  if (type === 'MOVE') {
    await callPostHandler(ROUTE_HANDLERS.move, {
      gameId: context.gameId,
      color,
      from: action.from,
      to: action.to,
      declaration: action.declaration,
    }, { session, simulationContext: context?.simulationContext });
  } else if (type === 'CHALLENGE') {
    await callPostHandler(ROUTE_HANDLERS.challenge, {
      gameId: context.gameId,
      color,
    }, { session, simulationContext: context?.simulationContext });
  } else if (type === 'BOMB') {
    await callPostHandler(ROUTE_HANDLERS.bomb, {
      gameId: context.gameId,
      color,
    }, { session, simulationContext: context?.simulationContext });
  } else if (type === 'PASS') {
    await callPostHandler(ROUTE_HANDLERS.pass, {
      gameId: context.gameId,
      color,
    }, { session, simulationContext: context?.simulationContext });
  } else if (type === 'ON_DECK') {
    const onDeckPiece = action.pieceId ? shadowState?.pieces?.[action.pieceId] : null;
    await callPostHandler(ROUTE_HANDLERS.onDeck, {
      gameId: context.gameId,
      color,
      piece: {
        identity: Number.isFinite(action.identity)
          ? action.identity
          : onDeckPiece?.identity,
      },
    }, { session, simulationContext: context?.simulationContext });
  } else if (type === 'RESIGN') {
    await callPostHandler(ROUTE_HANDLERS.resign, {
      gameId: context.gameId,
      color,
    }, { session, simulationContext: context?.simulationContext });
  } else {
    throw new Error(`Unsupported live action type: ${type || 'unknown'}`);
  }

  const liveGame = await loadGameLean(context.gameId);
  if (!liveGame) {
    throw new Error('Live simulation game disappeared after action');
  }
  return liveGame;
}

async function tryApplyLiveActionCandidates(context, shadowState, candidates = [], options = {}) {
  const rejectedCandidates = Array.isArray(options.rejectedCandidates)
    ? options.rejectedCandidates.slice()
    : [];

  for (let idx = 0; idx < candidates.length; idx += 1) {
    const candidate = candidates[idx];
    try {
      const liveGame = await applyLiveActionToGame(context, candidate, shadowState);
      return {
        executedAction: candidate,
        liveGame,
        rejectedCandidates,
      };
    } catch (err) {
      if (!isRecoverableLiveActionError(err)) {
        throw err;
      }
      rejectedCandidates.push({
        actionKey: actionKey(candidate),
        message: err?.message || 'Action rejected',
        statusCode: getErrorStatusCode(err),
      });
    }
  }

  return {
    executedAction: null,
    liveGame: null,
    rejectedCandidates,
  };
}

async function forceLiveGameDraw(context) {
  const game = await loadGameDocument(context?.gameId);
  if (!game || !game.isActive) {
    return loadGameLean(context?.gameId);
  }
  const config = typeof getServerConfig.getServerConfigSnapshotSync === 'function'
    ? getServerConfig.getServerConfigSnapshotSync()
    : await getServerConfig();
  await game.endGame(null, config.winReasons.get('DRAW'));
  return loadGameLean(context.gameId);
}

class MlRuntime {
  constructor(options = {}) {
    const defaultPath = path.join(process.cwd(), 'data', 'ml', 'runtime.json');
    this.dataFilePath = options.dataFilePath || defaultPath;
    this.persist = options.persist !== false;
    this.useMongoSimulations = options.useMongoSimulations !== false;
    this.useMongoRuns = options.useMongoRuns !== false;
    this.maxSimulationHistory = clampPositiveInt(options.maxSimulationHistory, 200000, 100, 1000000);
    this.trimMongoSimulationHistoryEnabled = options.trimMongoSimulationHistory === true;
    this.state = createEmptyState();
    this.loaded = false;
    this.savePromise = Promise.resolve();
    this.saveQueued = false;
    this.pendingSaveRequested = false;
    this.didAttemptMongoSimulationMigration = false;
    this.simulationTasks = new Map();
    this.trainingTasks = new Map();
    this.runTasks = new Map();
    this.runTaskSequence = 0;
    this.liveTestGameTasks = new Map();
    this.liveTestGameConfigs = new Map();
    this.parallelTaskPool = new ParallelTaskPool(ML_PARALLEL_TASK_WORKER_PATH);
    this.parallelTaskPoolTerminationPromise = null;
    this.resumePromise = null;
    this.lastLiveStatus = {
      simulation: null,
      training: null,
      runs: [],
    };
    this.resourceTelemetry = createEmptyResourceTelemetry();
    this.previousCpuUsageSnapshot = createCpuUsageSnapshot();
    this.resourceTelemetrySamplePromise = null;
    this.resourceTelemetryTimer = setInterval(() => {
      this.collectResourceTelemetrySample().catch(() => {});
    }, RESOURCE_SAMPLE_INTERVAL_MS);
    if (typeof this.resourceTelemetryTimer?.unref === 'function') {
      this.resourceTelemetryTimer.unref();
    }
    this.collectResourceTelemetrySample().catch(() => {});
    this.lastLoadedFileMtimeMs = 0;
    this.lastLoadedFileSizeBytes = 0;
    this.mlDebugLogPaths = getMlDebugLogPaths();
    this.boundHandleMlTestGameChanged = this.handleMlTestGameChanged.bind(this);
    eventBus.on('gameChanged', this.boundHandleMlTestGameChanged);
  }

  logMlEvent(event, payload = {}) {
    return appendMlDebugLog(event, payload);
  }

  logRunEvent(runOrId, event, payload = {}) {
    const runId = typeof runOrId === 'string' ? runOrId : runOrId?.id;
    if (!runId) {
      return this.logMlEvent(event, payload);
    }
    return appendMlRunDebugLog(runId, event, payload);
  }

  logTrainingEvent(trainingRunOrId, event, payload = {}) {
    const trainingRunId = typeof trainingRunOrId === 'string'
      ? trainingRunOrId
      : trainingRunOrId?.id;
    if (!trainingRunId) {
      return this.logMlEvent(event, payload);
    }
    return appendMlTrainingDebugLog(trainingRunId, event, payload);
  }

  dispose() {
    if (this.boundHandleMlTestGameChanged) {
      eventBus.off('gameChanged', this.boundHandleMlTestGameChanged);
    }
    if (this.resourceTelemetryTimer) {
      clearInterval(this.resourceTelemetryTimer);
      this.resourceTelemetryTimer = null;
    }
    if (this.parallelTaskPool) {
      this.parallelTaskPoolTerminationPromise = this.parallelTaskPool
        .terminate()
        .catch(() => {});
      this.parallelTaskPool = null;
    }
    return this.parallelTaskPoolTerminationPromise || Promise.resolve();
  }

  async resetParallelTaskPool() {
    const currentPool = this.parallelTaskPool;
    if (currentPool) {
      this.parallelTaskPoolTerminationPromise = currentPool
        .terminate()
        .catch(() => {});
      this.parallelTaskPool = null;
      await this.parallelTaskPoolTerminationPromise;
    }
    this.parallelTaskPool = new ParallelTaskPool(ML_PARALLEL_TASK_WORKER_PATH);
    this.parallelTaskPoolTerminationPromise = null;
    return this.parallelTaskPool;
  }

  async collectResourceTelemetrySample() {
    if (this.resourceTelemetrySamplePromise) {
      return this.resourceTelemetrySamplePromise;
    }
    this.resourceTelemetrySamplePromise = (async () => {
      const capturedAt = nowIso();
      const cpuSnapshot = createCpuUsageSnapshot();
      const cpuPercent = computeCpuUsagePercent(this.previousCpuUsageSnapshot, cpuSnapshot);
      this.previousCpuUsageSnapshot = cpuSnapshot;

      const gpuSnapshot = await queryGpuUsageFromNvidiaSmi();
      this.resourceTelemetry = {
        sampleIntervalMs: RESOURCE_SAMPLE_INTERVAL_MS,
        windowMs: RESOURCE_HISTORY_WINDOW_MS,
        cpu: {
          available: true,
          currentPercent: Number.isFinite(cpuPercent) ? Number(cpuPercent.toFixed(1)) : null,
          updatedAt: capturedAt,
          history: appendResourceSample(this.resourceTelemetry?.cpu?.history, {
            timestamp: capturedAt,
            percent: cpuPercent,
          }),
        },
        gpu: {
          available: gpuSnapshot?.available === true,
          currentPercent: Number.isFinite(gpuSnapshot?.currentPercent)
            ? Number(Number(gpuSnapshot.currentPercent).toFixed(1))
            : null,
          updatedAt: capturedAt,
          history: appendResourceSample(this.resourceTelemetry?.gpu?.history, {
            timestamp: capturedAt,
            percent: gpuSnapshot?.currentPercent,
          }),
          label: gpuSnapshot?.label || this.resourceTelemetry?.gpu?.label || null,
          source: gpuSnapshot?.source || null,
        },
      };
      return this.resourceTelemetry;
    })();

    try {
      return await this.resourceTelemetrySamplePromise;
    } finally {
      this.resourceTelemetrySamplePromise = null;
    }
  }

  async ensureFreshResourceTelemetry() {
    const lastSampleAtMs = Date.parse(
      this.resourceTelemetry?.cpu?.updatedAt
      || this.resourceTelemetry?.gpu?.updatedAt
      || '',
    );
    if (!Number.isFinite(lastSampleAtMs) || (Date.now() - lastSampleAtMs) >= RESOURCE_SAMPLE_INTERVAL_MS) {
      await this.collectResourceTelemetrySample();
    }
    return this.resourceTelemetry;
  }

  getResourceTelemetryPayload() {
    return deepClone(this.resourceTelemetry || createEmptyResourceTelemetry());
  }

  async ensureLoaded() {
    if (this.loaded) {
      await this.refreshPersistedStateIfChanged();
      const normalization = this.normalizeActiveModelArtifacts();
      if (normalization.changed) {
        await this.save();
      }
      return;
    }
    if (!this.persist) {
      this.state = createEmptyState();
      this.ensureBootstrapSnapshot();
      this.ensurePreferredBootstrapSnapshot();
      this.loaded = true;
      return;
    }

    const hadPersistedData = fs.existsSync(this.dataFilePath);
    try {
      if (hadPersistedData) {
        await this.loadStateFromDisk();
      } else {
        ensureDirSync(path.dirname(this.dataFilePath));
      }
    } catch (err) {
      console.error('[ml-runtime] failed to load persisted state, resetting runtime', err);
      this.logMlEvent('runtime_load_error', {
        dataFilePath: this.dataFilePath,
        error: summarizeError(err),
      });
      this.state = createEmptyState();
    }

    const snapshotCountBeforeBootstrap = Array.isArray(this.state.snapshots) ? this.state.snapshots.length : 0;
    const preferredSnapshotBeforeBootstrap = (this.state.snapshots || []).find((snapshot) => (
      isPreferredBootstrapSnapshotRecord(snapshot)
    )) || null;
    this.ensureBootstrapSnapshot();
    const preferredSnapshot = this.ensurePreferredBootstrapSnapshot();
    const bootstrapStateChanged = !hadPersistedData
      || snapshotCountBeforeBootstrap !== (Array.isArray(this.state.snapshots) ? this.state.snapshots.length : 0)
      || !preferredSnapshotBeforeBootstrap
      || preferredSnapshotBeforeBootstrap.label !== preferredSnapshot?.label
      || preferredSnapshotBeforeBootstrap.bootstrapKey !== preferredSnapshot?.bootstrapKey;
    this.loaded = true;
    this.logMlEvent('runtime_loaded', {
      persist: this.persist,
      dataFilePath: this.dataFilePath,
      snapshotCount: Array.isArray(this.state.snapshots) ? this.state.snapshots.length : 0,
      trainingRunCount: Array.isArray(this.state.trainingRuns) ? this.state.trainingRuns.length : 0,
      runCount: Array.isArray(this.state.runs) ? this.state.runs.length : 0,
      logPaths: this.mlDebugLogPaths,
    });
    if (bootstrapStateChanged) {
      await this.save();
    }
    await this.ensureResumedJobs();
  }

  hasActiveLocalTasks() {
    return this.runTasks.size > 0 || this.trainingTasks.size > 0 || this.simulationTasks.size > 0;
  }

  async loadStateFromDisk() {
    const raw = await fs.promises.readFile(this.dataFilePath, 'utf8');
    const parsed = decodeMlPersistenceArtifacts(JSON.parse(raw));
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }
    const emptyState = createEmptyState();
    this.state = {
      ...emptyState,
      ...parsed,
      counters: {
        ...emptyState.counters,
        ...(parsed.counters || {}),
      },
      activeJobs: {
        ...emptyState.activeJobs,
        ...(parsed.activeJobs || {}),
      },
    };
    this.state.promotedBots = normalizePromotedBotState(this.state.promotedBots);
    if (Array.isArray(this.state.snapshots)) {
      this.state.snapshots = this.state.snapshots
        .map((snapshot) => this.normalizeStoredSnapshotRecord(snapshot))
        .filter(Boolean);
    } else {
      this.state.snapshots = [];
    }
    if (Array.isArray(this.state.simulations)) {
      this.state.simulations = this.state.simulations
        .map((simulation) => compactSimulationForState(simulation))
        .slice(0, this.maxSimulationHistory);
    }
    if (!Array.isArray(this.state.trainingRuns)) {
      this.state.trainingRuns = [];
    } else {
      this.state.trainingRuns = this.state.trainingRuns
        .map((trainingRun) => this.normalizeStoredTrainingRunRecord(trainingRun))
        .filter(Boolean);
    }
    if (!Array.isArray(this.state.runs)) {
      this.state.runs = [];
    } else {
      const persistedRunEntries = this.state.runs.slice();
      const runReferences = persistedRunEntries.filter((entry) => (
        entry?.manifestPath
        || entry?.latestCheckpointPath
        || entry?.persistence?.manifestPath
        || entry?.persistence?.latestCheckpointPath
      ));
      const legacyRuns = persistedRunEntries
        .filter((entry) => !runReferences.includes(entry))
        .map((run) => this.normalizeStoredRunRecord(run))
        .filter(Boolean);
      const persistedRuns = await this.loadPersistedRuns(runReferences);
      const mergedRuns = [];
      const seenIds = new Set();
      [...persistedRuns, ...legacyRuns].forEach((run) => {
        if (!run?.id || seenIds.has(run.id)) return;
        seenIds.add(run.id);
        mergedRuns.push(run);
      });
      this.state.runs = mergedRuns;
    }
    this.state.activeJobs.training = this.normalizeStoredTrainingJob(this.state.activeJobs?.training);
    try {
      const stat = await fs.promises.stat(this.dataFilePath);
      this.lastLoadedFileMtimeMs = Number(stat?.mtimeMs || 0);
      this.lastLoadedFileSizeBytes = Number(stat?.size || 0);
    } catch (_) {
      this.lastLoadedFileMtimeMs = Date.now();
      this.lastLoadedFileSizeBytes = 0;
    }
    return true;
  }

  async refreshPersistedStateIfChanged() {
    if (!this.persist || !this.loaded || this.hasActiveLocalTasks()) return false;
    if (!fs.existsSync(this.dataFilePath)) return false;
    let stat = null;
    try {
      stat = await fs.promises.stat(this.dataFilePath);
    } catch (_) {
      return false;
    }
    const mtimeMs = Number(stat?.mtimeMs || 0);
    const sizeBytes = Number(stat?.size || 0);
    if (
      (!Number.isFinite(mtimeMs) || mtimeMs <= Number(this.lastLoadedFileMtimeMs || 0))
      && sizeBytes === Number(this.lastLoadedFileSizeBytes || 0)
    ) {
      return false;
    }
    await this.loadStateFromDisk();
    return true;
  }

  async syncPersistedStateForRead() {
    if (!this.persist || !this.loaded || this.hasActiveLocalTasks()) return false;
    if (!fs.existsSync(this.dataFilePath)) return false;
    await this.loadStateFromDisk();
    return true;
  }

  ensureBootstrapSnapshot() {
    if (Array.isArray(this.state.snapshots) && this.state.snapshots.length) return;
    const bootstrapBundle = createDefaultModelBundle({ seed: PREFERRED_BOOTSTRAP_BASELINE_SEED });
    const snapshot = this.createSnapshotRecord({
      label: buildModelDescriptorLabel('Bootstrap', bootstrapBundle),
      generation: 0,
      parentSnapshotId: null,
      modelBundle: bootstrapBundle,
      notes: PREFERRED_BOOTSTRAP_NOTES,
      bootstrapKey: PREFERRED_BOOTSTRAP_BASELINE_KEY,
    });
    this.state.snapshots = [snapshot];
  }

  ensurePreferredBootstrapSnapshot() {
    this.ensureBootstrapSnapshot();
    const snapshots = Array.isArray(this.state.snapshots) ? this.state.snapshots : [];
    const existing = snapshots.find((snapshot) => isPreferredBootstrapSnapshotRecord(snapshot));
    if (existing) {
      existing.bootstrapKey = PREFERRED_BOOTSTRAP_BASELINE_KEY;
      const preferredLabel = buildModelDescriptorLabel('Bootstrap', existing.modelBundle);
      if (existing.label !== preferredLabel) {
        existing.label = preferredLabel;
        existing.updatedAt = nowIso();
      }
      return existing;
    }

    const bootstrapBundle = createDefaultModelBundle({ seed: PREFERRED_BOOTSTRAP_BASELINE_SEED });
    const snapshot = this.createSnapshotRecord({
      label: buildModelDescriptorLabel('Bootstrap', bootstrapBundle),
      generation: 0,
      parentSnapshotId: null,
      modelBundle: bootstrapBundle,
      notes: PREFERRED_BOOTSTRAP_NOTES,
      bootstrapKey: PREFERRED_BOOTSTRAP_BASELINE_KEY,
    });
    this.state.snapshots.unshift(snapshot);
    return snapshot;
  }

  getBootstrapSnapshot() {
    return this.ensurePreferredBootstrapSnapshot();
  }

  nextId(prefix) {
    const key = prefix === 'snapshot'
      ? 'snapshot'
      : prefix === 'simulation'
        ? 'simulation'
        : prefix === 'game'
          ? 'game'
          : prefix === 'run'
            ? 'run'
            : 'training';
    const current = clampPositiveInt(this.state.counters[key], 1);
    this.state.counters[key] = current + 1;
    return `${prefix}-${String(current).padStart(4, '0')}`;
  }

  createSnapshotRecord(options = {}) {
    const createdAt = nowIso();
    return {
      id: options.id || this.nextId('snapshot'),
      label: options.label || 'Snapshot',
      createdAt,
      updatedAt: createdAt,
      generation: clampPositiveInt(options.generation, 0, 0, 100000),
      parentSnapshotId: options.parentSnapshotId || null,
      bootstrapKey: options.bootstrapKey || null,
      notes: options.notes || '',
      modelBundle: cloneModelBundle(options.modelBundle || createDefaultModelBundle()),
      stats: {
        simulations: 0,
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        draws: 0,
        trainingRuns: 0,
        ...options.stats,
      },
      losses: Array.isArray(options.losses) ? options.losses.slice() : [],
    };
  }

  maybeRememberNormalizedId(target, value, limit = 12) {
    if (!Array.isArray(target) || !value || target.includes(value) || target.length >= limit) {
      return;
    }
    target.push(value);
  }

  reconcileOptimizerStateForModelBundle(modelBundle, optimizerState, options = {}) {
    const normalizedModelBundle = options.normalizedModelBundle || normalizeModelBundleForStorage(modelBundle);
    if (!normalizedModelBundle) return null;

    const trainingBackend = normalizeTrainingBackend(options.trainingBackend, TRAINING_BACKENDS.AUTO);
    if (options.forceReset === true) {
      return trainingBackend === TRAINING_BACKENDS.NODE
        ? createOptimizerState(normalizedModelBundle)
        : null;
    }

    const isCompatibleNodeState = Boolean(
      optimizerState
      && typeof optimizerState === 'object'
      && (
        String(normalizedModelBundle?.family || '').trim().toLowerCase() !== SHARED_MODEL_FAMILY
        || isNodeAdamOptimizerStateCompatibleWithNetwork(optimizerState.encoder, normalizedModelBundle.encoder?.network)
      )
      && isNodeAdamOptimizerStateCompatibleWithNetwork(optimizerState.policy, normalizedModelBundle.policy.network)
      && isNodeAdamOptimizerStateCompatibleWithNetwork(optimizerState.value, normalizedModelBundle.value.network)
      && isNodeAdamOptimizerStateCompatibleWithNetwork(optimizerState.identity, normalizedModelBundle.identity.network)
    );
    if (isCompatibleNodeState) {
      return optimizerState;
    }
    if (trainingBackend === TRAINING_BACKENDS.NODE) {
      return createOptimizerState(normalizedModelBundle);
    }
    if (hasNodeStyleOptimizerState(optimizerState)) {
      return null;
    }
    return optimizerState || null;
  }

  normalizeActiveModelArtifacts() {
    const summary = {
      snapshotBundlesNormalized: 0,
      runGenerationBundlesNormalized: 0,
      runWorkingBundlesNormalized: 0,
      trainingRunCheckpointBundlesNormalized: 0,
      activeTrainingJobBundlesNormalized: 0,
      optimizerStatesReset: 0,
      snapshotIds: [],
      runIds: [],
      trainingRunIds: [],
    };
    let changed = false;

    (this.state.snapshots || []).forEach((snapshot) => {
      if (!snapshot?.modelBundle) return;
      const normalized = normalizeModelBundleArtifact(snapshot.modelBundle);
      if (!normalized.shapeChanged) return;
      snapshot.modelBundle = normalized.modelBundle;
      snapshot.updatedAt = nowIso();
      changed = true;
      summary.snapshotBundlesNormalized += 1;
      this.maybeRememberNormalizedId(summary.snapshotIds, snapshot.id);
    });

    (this.state.trainingRuns || []).forEach((trainingRun) => {
      if (!trainingRun?.checkpoint?.modelBundle) return;
      const normalized = normalizeModelBundleArtifact(trainingRun.checkpoint.modelBundle);
      let recordChanged = false;
      if (normalized.shapeChanged) {
        trainingRun.checkpoint.modelBundle = normalized.modelBundle;
        recordChanged = true;
        summary.trainingRunCheckpointBundlesNormalized += 1;
        this.maybeRememberNormalizedId(summary.trainingRunIds, trainingRun.id);
      }
      const shouldReconcileOptimizer = Boolean(
        normalized.shapeChanged
        || trainingRun?.status === 'running'
        || trainingRun?.checkpoint?.optimizerState,
      );
      if (shouldReconcileOptimizer) {
        const nextOptimizerState = this.reconcileOptimizerStateForModelBundle(
          normalized.modelBundle || trainingRun.checkpoint.modelBundle,
          trainingRun.checkpoint.optimizerState,
          {
            normalizedModelBundle: normalized.modelBundle || trainingRun.checkpoint.modelBundle,
            trainingBackend: trainingRun.trainingBackend,
            forceReset: normalized.shapeChanged,
          },
        );
        if (nextOptimizerState !== trainingRun.checkpoint.optimizerState) {
          trainingRun.checkpoint.optimizerState = nextOptimizerState ? deepClone(nextOptimizerState) : null;
          recordChanged = true;
          summary.optimizerStatesReset += 1;
          this.maybeRememberNormalizedId(summary.trainingRunIds, trainingRun.id);
        }
      }
      if (recordChanged) {
        trainingRun.updatedAt = nowIso();
        changed = true;
      }
    });

    (this.state.runs || []).forEach((run) => {
      let runChanged = false;
      (run.generations || []).forEach((generation) => {
        if (!generation?.modelBundle) return;
        const normalized = normalizeModelBundleArtifact(generation.modelBundle);
        if (!normalized.shapeChanged) return;
        generation.modelBundle = normalized.modelBundle;
        generation.updatedAt = nowIso();
        runChanged = true;
        summary.runGenerationBundlesNormalized += 1;
        this.maybeRememberNormalizedId(summary.runIds, run.id);
      });

      if (run?.working?.modelBundle) {
        const normalized = normalizeModelBundleArtifact(run.working.modelBundle);
        if (normalized.shapeChanged) {
          run.working.modelBundle = normalized.modelBundle;
          runChanged = true;
          summary.runWorkingBundlesNormalized += 1;
          this.maybeRememberNormalizedId(summary.runIds, run.id);
        }
        const nextOptimizerState = this.reconcileOptimizerStateForModelBundle(
          normalized.modelBundle || run.working.modelBundle,
          run.working.optimizerState,
          {
            normalizedModelBundle: normalized.modelBundle || run.working.modelBundle,
            trainingBackend: run?.config?.trainingBackend,
            forceReset: normalized.shapeChanged,
          },
        );
        if (nextOptimizerState !== run.working.optimizerState) {
          run.working.optimizerState = nextOptimizerState ? deepClone(nextOptimizerState) : null;
          runChanged = true;
          summary.optimizerStatesReset += 1;
          this.maybeRememberNormalizedId(summary.runIds, run.id);
        }
      }

      if (runChanged) {
        run.updatedAt = nowIso();
        changed = true;
      }
    });

    if (this.state.activeJobs?.training?.checkpoint?.modelBundle) {
      const job = this.state.activeJobs.training;
      const normalized = normalizeModelBundleArtifact(job.checkpoint.modelBundle);
      let jobChanged = false;
      if (normalized.shapeChanged) {
        job.checkpoint.modelBundle = normalized.modelBundle;
        jobChanged = true;
        summary.activeTrainingJobBundlesNormalized += 1;
        this.maybeRememberNormalizedId(summary.trainingRunIds, job.trainingRunId);
      }
      const nextOptimizerState = this.reconcileOptimizerStateForModelBundle(
        normalized.modelBundle || job.checkpoint.modelBundle,
        job.checkpoint.optimizerState,
        {
          normalizedModelBundle: normalized.modelBundle || job.checkpoint.modelBundle,
          trainingBackend: job.trainingBackend,
          forceReset: normalized.shapeChanged,
        },
      );
      if (nextOptimizerState !== job.checkpoint.optimizerState) {
        job.checkpoint.optimizerState = nextOptimizerState ? deepClone(nextOptimizerState) : null;
        jobChanged = true;
        summary.optimizerStatesReset += 1;
        this.maybeRememberNormalizedId(summary.trainingRunIds, job.trainingRunId);
      }
      if (jobChanged) {
        job.updatedAt = nowIso();
        changed = true;
      }
    }

    if (changed) {
      this.logMlEvent('runtime_state_normalized', summary);
    }
    return {
      changed,
      summary,
    };
  }

  compactTerminalRunState(run) {
    if (!run || typeof run !== 'object') return run;
    if (isRunStatusResumable(run?.status)) return run;
    const replayBufferSummary = this.summarizeRunReplayBuffer(run);
    run.replayBuffer = {
      maxPositions: Number(run?.replayBuffer?.maxPositions || run?.config?.replayBufferMaxPositions || 0),
      totalPositionsSeen: Number(run?.replayBuffer?.totalPositionsSeen || 0),
      evictedPositions: Number(run?.replayBuffer?.evictedPositions || 0),
      summary: replayBufferSummary,
      policySamples: [],
      valueSamples: [],
      identitySamples: [],
    };
    (run.generations || []).forEach((generation) => {
      if (generation?.approved === false) {
        generation.modelBundle = null;
      }
    });
    run.working = {
      baseGeneration: Number(run?.working?.baseGeneration || run?.bestGeneration || 0),
      checkpointIndex: Number(run?.working?.checkpointIndex || 0),
      lastLoss: run?.working?.lastLoss ? deepClone(run.working.lastLoss) : null,
      modelBundle: null,
      optimizerState: null,
    };
    return run;
  }

  normalizeStoredRunRecord(run) {
    if (!run || typeof run !== 'object') return null;
    const normalized = {
      ...run,
      status: run.status || 'completed',
      stopReason: run.stopReason || null,
      lastError: run?.lastError ? summarizeError(run.lastError) : null,
      evaluationTargetGeneration: Number.isFinite(run?.evaluationTargetGeneration)
        ? Number(run.evaluationTargetGeneration)
        : 0,
      generations: Array.isArray(run.generations) ? run.generations.map((generation) => ({
        ...generation,
        approved: generation?.approved !== false,
        stats: generation?.stats || {},
        latestLoss: generation?.latestLoss || null,
        promotionEvaluation: generation?.promotionEvaluation || null,
        modelBundle: generation?.approved === false
          ? null
          : (generation?.modelBundle ? normalizeModelBundleForStorage(generation.modelBundle) : null),
      })) : [],
      replayBuffer: {
        maxPositions: Number(run?.replayBuffer?.maxPositions || run?.config?.replayBufferMaxPositions || 0),
        totalPositionsSeen: Number(run?.replayBuffer?.totalPositionsSeen || 0),
        evictedPositions: Number(run?.replayBuffer?.evictedPositions || 0),
        summary: run?.replayBuffer?.summary ? deepClone(run.replayBuffer.summary) : null,
        policySamples: Array.isArray(run?.replayBuffer?.policySamples) ? run.replayBuffer.policySamples : [],
        valueSamples: Array.isArray(run?.replayBuffer?.valueSamples) ? run.replayBuffer.valueSamples : [],
        identitySamples: Array.isArray(run?.replayBuffer?.identitySamples) ? run.replayBuffer.identitySamples : [],
      },
      retainedGames: Array.isArray(run.retainedGames)
        ? run.retainedGames.map((game) => compactRunRetainedGame(game)).filter(Boolean)
        : [],
      metricsHistory: Array.isArray(run.metricsHistory) ? run.metricsHistory : [],
      evaluationHistory: Array.isArray(run.evaluationHistory) ? run.evaluationHistory : [],
      working: {
        modelBundle: run?.working?.modelBundle ? normalizeModelBundleForStorage(run.working.modelBundle) : null,
        optimizerState: run?.working?.optimizerState || null,
        baseGeneration: Number(run?.working?.baseGeneration || run?.bestGeneration || 0),
        checkpointIndex: Number(run?.working?.checkpointIndex || 0),
        lastLoss: run?.working?.lastLoss || null,
      },
    };
    const normalizedStatus = normalizeRunStatus(normalized.status);
    if (
      normalizedStatus === 'error'
      && isRecoverableRunJournalError(normalized)
      && (normalized?.working?.modelBundle || this.findContinueGenerationRecord(normalized))
    ) {
      normalized.status = 'stopped';
      normalized.stopReason = null;
      normalized.lastError = null;
      normalized.updatedAt = nowIso();
    }
    initializeRunTiming(normalized);
    if (['running', 'stopping'].includes(String(normalized.status).toLowerCase()) && !normalized.working.modelBundle) {
      normalized.status = 'error';
      normalized.stopReason = normalized.stopReason || 'missing_working_model';
      finalizeRunTiming(normalized, normalized.updatedAt || normalized.createdAt || nowIso());
    }
    if (!['running', 'stopping'].includes(String(normalized.status).toLowerCase())) {
      finalizeRunTiming(normalized, normalized.updatedAt || normalized.createdAt || nowIso());
      this.compactTerminalRunState(normalized);
    }
    return normalized;
  }

  compactRunForPersistence(run, options = {}) {
    if (!run || typeof run !== 'object') return null;
    const isTerminal = !isRunStatusResumable(run.status);
    const replayBufferSummary = this.summarizeRunReplayBuffer(run);
    const replayPositionLimit = clampNonNegativeInt(
      options.replayPositionLimit,
      RUN_STATE_PERSIST_REPLAY_POSITION_LIMIT,
    );
    const replayIdentityLimit = clampNonNegativeInt(
      options.replayIdentityLimit,
      replayPositionLimit
        ? replayPositionLimit * RUN_STATE_PERSIST_REPLAY_IDENTITY_MULTIPLIER
        : 0,
    );
    const replayBuffer = run?.replayBuffer || {};
    const policySamples = Array.isArray(replayBuffer.policySamples) ? replayBuffer.policySamples : [];
    const valueSamples = Array.isArray(replayBuffer.valueSamples) ? replayBuffer.valueSamples : [];
    const identitySamples = Array.isArray(replayBuffer.identitySamples) ? replayBuffer.identitySamples : [];
    const replayStartIndex = (!isTerminal && replayPositionLimit > 0 && policySamples.length > replayPositionLimit)
      ? (policySamples.length - replayPositionLimit)
      : 0;
    const persistedPolicySamples = isTerminal || replayPositionLimit === 0
      ? []
      : deepClone(policySamples.slice(replayStartIndex));
    const persistedValueSamples = isTerminal || replayPositionLimit === 0
      ? []
      : deepClone(valueSamples.slice(replayStartIndex));
    let persistedIdentitySamples = [];
    if (!isTerminal && replayIdentityLimit > 0) {
      const oldestPersistedPolicySample = policySamples[replayStartIndex] || null;
      const identityCutoffMs = parseTimeValue(oldestPersistedPolicySample?.createdAt);
      const filteredIdentitySamples = identityCutoffMs > 0
        ? identitySamples.filter((sample) => parseTimeValue(sample?.createdAt) >= identityCutoffMs)
        : identitySamples;
      persistedIdentitySamples = deepClone(filteredIdentitySamples.slice(-replayIdentityLimit));
    }
    return {
      id: run.id,
      label: run.label,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt || run.createdAt,
      status: run.status || 'completed',
      stopReason: run.stopReason || null,
      lastError: run?.lastError ? summarizeError(run.lastError) : null,
      timing: {
        elapsedMs: computeRunElapsedMs(run),
        activeSegmentStartedAt: isRunStatusActive(run?.status)
          ? getRunTimingState(run).activeSegmentStartedAt
          : null,
      },
      config: deepClone(run.config || {}),
      bestGeneration: Number(run.bestGeneration || 0),
      evaluationTargetGeneration: Number.isFinite(run.evaluationTargetGeneration)
        ? Number(run.evaluationTargetGeneration)
        : 0,
      workerGeneration: Number(run.workerGeneration || 0),
      pendingWorkerGeneration: Number.isFinite(run.pendingWorkerGeneration) ? Number(run.pendingWorkerGeneration) : null,
      cyclesSinceWorkerRefresh: Number(run.cyclesSinceWorkerRefresh || 0),
      generations: (run.generations || []).map((generation) => ({
        id: generation.id,
        generation: Number(generation.generation || 0),
        label: generation.label || `G${Number(generation.generation || 0)}`,
        createdAt: generation.createdAt || null,
        updatedAt: generation.updatedAt || generation.createdAt || null,
        promotedAt: generation.promotedAt || null,
        parentGeneration: Number.isFinite(generation.parentGeneration) ? Number(generation.parentGeneration) : null,
        isBest: Boolean(generation.isBest),
        approved: generation.approved !== false,
        source: generation.source || 'promoted',
        modelBundle: generation.approved === false ? null : (generation.modelBundle ? cloneModelBundle(generation.modelBundle) : null),
        stats: deepClone(generation.stats || {}),
        latestLoss: generation.latestLoss ? deepClone(generation.latestLoss) : null,
        promotionEvaluation: generation.promotionEvaluation ? deepClone(generation.promotionEvaluation) : null,
      })),
      replayBuffer: {
        maxPositions: Number(run?.replayBuffer?.maxPositions || run?.config?.replayBufferMaxPositions || 0),
        totalPositionsSeen: Number(run?.replayBuffer?.totalPositionsSeen || 0),
        evictedPositions: Number(run?.replayBuffer?.evictedPositions || 0),
        summary: replayBufferSummary,
        policySamples: persistedPolicySamples,
        valueSamples: persistedValueSamples,
        identitySamples: persistedIdentitySamples,
      },
      retainedGames: (run.retainedGames || []).map((game) => compactRunRetainedGame(game)).filter(Boolean),
      metricsHistory: deepClone(run.metricsHistory || []),
      evaluationHistory: deepClone(run.evaluationHistory || []),
      working: {
        baseGeneration: Number(run?.working?.baseGeneration || run?.bestGeneration || 0),
        checkpointIndex: Number(run?.working?.checkpointIndex || 0),
        lastLoss: run?.working?.lastLoss ? deepClone(run.working.lastLoss) : null,
        modelBundle: isTerminal ? null : (run?.working?.modelBundle ? cloneModelBundle(run.working.modelBundle) : null),
        optimizerState: isTerminal ? null : (run?.working?.optimizerState ? deepClone(run.working.optimizerState) : null),
      },
      stats: deepClone(run.stats || {}),
    };
  }

  buildPersistedState(options = {}) {
    const persistedRunRefs = Array.isArray(options.persistedRunRefs)
      ? options.persistedRunRefs.filter(Boolean)
      : (this.state.runs || []).map((run) => this.buildPersistedRunReference(run)).filter(Boolean);
    return encodeMlPersistenceArtifacts({
      version: this.state.version,
      counters: this.state.counters || {},
      snapshots: this.state.snapshots || [],
      simulations: (this.state.simulations || []).map((simulation) => compactSimulationForState(simulation)),
      trainingRuns: this.state.trainingRuns || [],
      runs: persistedRunRefs,
      promotedBots: normalizePromotedBotState(this.state.promotedBots),
      activeJobs: this.state.activeJobs || {},
    });
  }

  async save() {
    if (!this.persist) return;
    ensureDirSync(path.dirname(this.dataFilePath));
    this.pendingSaveRequested = true;
    if (this.saveQueued) {
      await this.savePromise;
      return;
    }
    this.saveQueued = true;
    this.savePromise = this.savePromise
      .then(async () => {
        while (this.pendingSaveRequested) {
          this.pendingSaveRequested = false;
          let payload = null;
          let payloadReplayPositionLimit = RUN_STATE_PERSIST_REPLAY_POSITION_LIMIT;
          const persistAttempts = [
            {
              replayPositionLimit: RUN_STATE_PERSIST_REPLAY_POSITION_LIMIT,
              replayIdentityLimit: RUN_STATE_PERSIST_REPLAY_POSITION_LIMIT * RUN_STATE_PERSIST_REPLAY_IDENTITY_MULTIPLIER,
            },
            {
              replayPositionLimit: RUN_STATE_PERSIST_REPLAY_POSITION_FALLBACK_LIMIT,
              replayIdentityLimit: RUN_STATE_PERSIST_REPLAY_POSITION_FALLBACK_LIMIT * RUN_STATE_PERSIST_REPLAY_IDENTITY_MULTIPLIER,
            },
            {
              replayPositionLimit: 0,
              replayIdentityLimit: 0,
            },
          ];
          let stringifyError = null;
          for (let attemptIndex = 0; attemptIndex < persistAttempts.length; attemptIndex += 1) {
            const persistOptions = persistAttempts[attemptIndex];
            try {
              const persistedRunRefs = [];
              for (let runIndex = 0; runIndex < (this.state.runs || []).length; runIndex += 1) {
                const persistedRunRef = await this.persistRunToFilesystem(this.state.runs[runIndex], {
                  persistOptions,
                  force: attemptIndex > 0,
                });
                if (persistedRunRef) {
                  persistedRunRefs.push(persistedRunRef);
                }
              }
              payload = JSON.stringify(this.buildPersistedState({
                persistedRunRefs,
              }));
              payloadReplayPositionLimit = persistOptions.replayPositionLimit;
              stringifyError = null;
              break;
            } catch (err) {
              if (!isInvalidStringLengthError(err)) {
                throw err;
              }
              stringifyError = err;
            }
          }
          if (stringifyError) {
            throw stringifyError;
          }
          if (payloadReplayPositionLimit !== RUN_STATE_PERSIST_REPLAY_POSITION_LIMIT) {
            console.warn('[ml-runtime] persisted state with reduced replay buffer checkpoint', {
              replayPositionLimit: payloadReplayPositionLimit,
            });
          }
          await persistJsonWithFallback(this.dataFilePath, payload);
          try {
            const stat = await fs.promises.stat(this.dataFilePath);
            this.lastLoadedFileMtimeMs = Number(stat?.mtimeMs || this.lastLoadedFileMtimeMs || 0);
            this.lastLoadedFileSizeBytes = Number(stat?.size || this.lastLoadedFileSizeBytes || 0);
          } catch (_) {}
        }
      })
      .catch((err) => {
        console.error('[ml-runtime] failed to persist state', err);
      })
      .finally(() => {
        this.saveQueued = false;
      });
    await this.savePromise;
  }

  async flushForShutdown() {
    if (!this.persist) return;
    if (!this.loaded) {
      await this.ensureLoaded();
    }
    await this.save();
  }

  async ensureResumedJobs() {
    if (!this.persist) return;
    const hasSimulationJob = Boolean(this.state.activeJobs?.simulation);
    const hasTrainingJob = Boolean(this.state.activeJobs?.training);
    const hasActiveRuns = (this.state.runs || []).some((run) => isRunStatusActive(run?.status));
    if (!hasSimulationJob && !hasTrainingJob && !hasActiveRuns) {
      return;
    }
    if (this.resumePromise) {
      await this.resumePromise;
      return;
    }
    this.resumePromise = Promise.resolve()
      .then(async () => {
        await this.hydrateActiveJobsFromMongo();
        await this.resumePersistedJobs();
        await this.resumeRunTasks();
      })
      .catch((err) => {
        console.error('[ml-runtime] failed to resume persisted jobs', err);
      });
    await this.resumePromise;
  }

  async hydrateActiveJobsFromMongo() {
    if (!this.isMongoSimulationPersistenceAvailable()) return;
    let stateChanged = false;

    if (!this.state.activeJobs?.simulation) {
      const doc = await SimulationModel.findOne(
        { status: { $in: ['running', 'stopping'] } },
        { _id: 0, __v: 0 },
      )
        .sort({ createdAt: -1 })
        .lean()
        .catch(() => null);
      const simulation = doc ? this.normalizeStoredSimulationRecord(doc) : null;
      if (simulation?.id) {
        const config = simulation.config || {};
        this.state.activeJobs.simulation = {
          type: 'simulation',
          taskId: simulation?.persistence?.taskId || `simulation:${simulation.id}`,
          simulationId: simulation.id,
          status: simulation.status === 'stopping' ? 'stopping' : 'running',
          createdAt: simulation.createdAt || nowIso(),
          updatedAt: simulation.updatedAt || simulation.createdAt || nowIso(),
          label: simulation.label || simulation.id,
          participantAId: simulation.participantAId || null,
          participantBId: simulation.participantBId || null,
          participantALabel: simulation.participantALabel || null,
          participantBLabel: simulation.participantBLabel || null,
          whiteSnapshotId: simulation.whiteSnapshotId || null,
          blackSnapshotId: simulation.blackSnapshotId || null,
          options: {
            whiteParticipantId: simulation.participantAId || null,
            blackParticipantId: simulation.participantBId || null,
            whiteSnapshotId: simulation.whiteSnapshotId || null,
            blackSnapshotId: simulation.blackSnapshotId || null,
            gameCount: config.requestedGameCount || config.gameCount || simulation.gameCount || 0,
            maxPlies: config.maxPlies,
            iterations: config.iterations,
            maxDepth: config.maxDepth,
            hypothesisCount: config.hypothesisCount,
            riskBias: config.riskBias,
            exploration: config.exploration,
            alternateColors: Boolean(config.alternateColors),
            seed: config.seed,
            label: simulation.label || null,
          },
          checkpoint: {
            requestedGameCount: config.requestedGameCount || config.gameCount || simulation.gameCount || 0,
            completedGames: Number(config.completedGameCount || simulation?.stats?.games || simulation.gameCount || 0),
            stats: deepClone(simulation.stats || {}),
            lastCheckpointAt: simulation?.persistence?.checkpointedAt || simulation.updatedAt || simulation.createdAt || nowIso(),
          },
        };
        if (!this.getInMemorySimulation(simulation.id)) {
          this.state.simulations.unshift(simulation);
          this.state.simulations = this.state.simulations.slice(0, this.maxSimulationHistory);
        }
        stateChanged = true;
      }
    }

    if (!this.state.activeJobs?.training) {
      const doc = await TrainingRunModel.findOne(
        { status: 'running' },
        { _id: 0, __v: 0 },
      )
        .sort({ createdAt: -1 })
        .lean()
        .catch(() => null);
      const run = doc ? this.normalizeStoredTrainingRunRecord(doc) : null;
      if (run?.id) {
        this.state.activeJobs.training = {
          type: 'training',
          taskId: run?.checkpoint?.taskId || `training:${run.id}`,
          trainingRunId: run.id,
          status: 'running',
          createdAt: run.createdAt || nowIso(),
          updatedAt: run.updatedAt || run.createdAt || nowIso(),
          baseSnapshotId: run.baseSnapshotId || null,
          epochs: Number(run.epochs || 0),
          learningRate: Number(run.learningRate || 0),
          sourceSimulationIds: Array.isArray(run.sourceSimulationIds) ? run.sourceSimulationIds.slice() : [],
          sourceGames: Number(run.sourceGames || 0),
          sourceSimulations: Number(run.sourceSimulations || 0),
          sampleCounts: deepClone(run.sampleCounts || {}),
          label: run.label || '',
          notes: run.notes || '',
          checkpoint: deepClone(run.checkpoint || {}),
        };
        if (!this.getInMemoryTrainingRun(run.id)) {
          this.state.trainingRuns.unshift({
            ...run,
            checkpoint: {
              ...deepClone(run.checkpoint || {}),
              modelBundle: undefined,
              optimizerState: undefined,
            },
          });
          this.state.trainingRuns = this.state.trainingRuns.slice(0, 500);
        }
        stateChanged = true;
      }
    }

    const activeRunsHydrated = await this.hydrateActiveRunsFromMongo();
    if (activeRunsHydrated) {
      stateChanged = true;
    }

    if (stateChanged) {
      await this.save();
    }
  }

  async resumePersistedJobs() {
    const simulationJob = this.state.activeJobs?.simulation || null;
    if (simulationJob && String(simulationJob.status || '').toLowerCase() === 'running') {
      this.resumeSimulationJob(simulationJob);
    }

    const trainingJob = this.state.activeJobs?.training || null;
    if (trainingJob && String(trainingJob.status || '').toLowerCase() === 'running') {
      this.resumeTrainingJob(trainingJob);
    }
  }

  rememberLiveStatus(type, payload = null) {
    if (!type) return;
    if (!payload) {
      this.lastLiveStatus[type] = null;
      return;
    }
    this.lastLiveStatus[type] = {
      observedAt: nowIso(),
      payload: deepClone(payload),
    };
  }

  getRecentRememberedLiveStatus(type) {
    const entry = this.lastLiveStatus?.[type] || null;
    if (!entry?.observedAt || !entry?.payload) return null;
    const age = Date.now() - parseTimeValue(entry.observedAt);
    if (!Number.isFinite(age) || age < 0 || age > LIVE_STATUS_RETENTION_MS) {
      return null;
    }
    return deepClone(entry.payload);
  }

  getInMemoryTrainingRun(trainingRunId) {
    return (this.state.trainingRuns || []).find((item) => item.id === trainingRunId) || null;
  }

  normalizeStoredSnapshotRecord(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const normalized = deepClone(snapshot);
    if (normalized.modelBundle) {
      normalized.modelBundle = normalizeModelBundleForStorage(normalized.modelBundle);
    }
    if (isPreferredBootstrapSnapshotRecord(normalized)) {
      normalized.bootstrapKey = PREFERRED_BOOTSTRAP_BASELINE_KEY;
    }
    return normalized;
  }

  normalizeStoredTrainingRunRecord(trainingRun) {
    if (!trainingRun || typeof trainingRun !== 'object') return null;
    const normalized = deepClone(trainingRun);
    if (Object.prototype.hasOwnProperty.call(normalized, '_id')) {
      delete normalized._id;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, '__v')) {
      delete normalized.__v;
    }
    if (normalized?.checkpoint?.modelBundle) {
      normalized.checkpoint.modelBundle = normalizeModelBundleForStorage(normalized.checkpoint.modelBundle);
    }
    return normalized;
  }

  normalizeStoredTrainingJob(job) {
    if (!job || typeof job !== 'object') return null;
    const normalized = deepClone(job);
    if (normalized?.checkpoint?.modelBundle) {
      normalized.checkpoint.modelBundle = normalizeModelBundleForStorage(normalized.checkpoint.modelBundle);
    }
    return normalized;
  }

  getRuntimeDataRootDir() {
    return path.dirname(this.dataFilePath);
  }

  getRunsDataDir() {
    return path.join(this.getRuntimeDataRootDir(), 'runs');
  }

  getRunStorageDir(runId) {
    return path.join(this.getRunsDataDir(), sanitizePathSegment(runId, 'run'));
  }

  getRunArtifactsDir(runId) {
    return path.join(this.getRunStorageDir(runId), 'artifacts');
  }

  getRunCheckpointsDir(runId) {
    return path.join(this.getRunStorageDir(runId), 'checkpoints');
  }

  getRunManifestPath(runId) {
    return path.join(this.getRunStorageDir(runId), 'manifest.json');
  }

  getRunJournalDir(runId) {
    return path.join(this.getRunStorageDir(runId), 'journal');
  }

  getRunJournalArtifactsDir(runId) {
    return path.join(this.getRunJournalDir(runId), 'artifacts');
  }

  getRunJournalPath(runId) {
    return path.join(this.getRunJournalDir(runId), 'events.jsonl');
  }

  buildRunCheckpointId(run) {
    const checkpointIndex = String(Number(run?.working?.checkpointIndex || 0)).padStart(6, '0');
    return `ckpt-${checkpointIndex}-${Date.now()}`;
  }

  buildPersistedRunReference(run) {
    if (!run?.id) return null;
    return {
      id: run.id,
      createdAt: run.createdAt || null,
      updatedAt: run.updatedAt || run.createdAt || null,
      status: run.status || 'completed',
      manifestPath: run?.persistence?.manifestPath || null,
      latestCheckpointId: run?.persistence?.latestCheckpointId || null,
      latestCheckpointPath: run?.persistence?.latestCheckpointPath || null,
      checkpointedAt: run?.persistence?.checkpointedAt || null,
      journalPath: run?.persistence?.journalPath || null,
      latestJournalSequence: Number(run?.persistence?.latestJournalSequence || 0),
      latestJournalEventAt: run?.persistence?.latestJournalEventAt || null,
    };
  }

  buildRunCheckpointPayload(run, persistOptions = {}) {
    const checkpointRun = this.compactRunForPersistence(run, persistOptions);
    const replayBuffer = checkpointRun?.replayBuffer
      ? deepClone(checkpointRun.replayBuffer)
      : {
        maxPositions: Number(run?.replayBuffer?.maxPositions || run?.config?.replayBufferMaxPositions || 0),
        totalPositionsSeen: Number(run?.replayBuffer?.totalPositionsSeen || 0),
        evictedPositions: Number(run?.replayBuffer?.evictedPositions || 0),
        summary: this.summarizeRunReplayBuffer(run),
        policySamples: [],
        valueSamples: [],
        identitySamples: [],
      };
    const retainedGames = Array.isArray(checkpointRun?.retainedGames)
      ? deepClone(checkpointRun.retainedGames)
      : [];
    const canReuseBaseGenerationModel = Boolean(
      Number(run?.stats?.totalTrainingSteps || 0) <= 0
      && Number.isFinite(run?.working?.baseGeneration)
      && (run?.generations || []).some((generation) => (
        Number(generation?.generation || 0) === Number(run.working.baseGeneration)
        && generation?.approved !== false
        && generation?.modelBundle
      ))
    );
    const workingArtifacts = {
      modelBundle: !canReuseBaseGenerationModel && checkpointRun?.working?.modelBundle
        ? cloneModelBundle(checkpointRun.working.modelBundle)
        : null,
      optimizerState: checkpointRun?.working?.optimizerState
        ? deepClone(checkpointRun.working.optimizerState)
        : null,
    };

    checkpointRun.replayBuffer = {
      maxPositions: Number(replayBuffer.maxPositions || run?.config?.replayBufferMaxPositions || 0),
      totalPositionsSeen: Number(replayBuffer.totalPositionsSeen || 0),
      evictedPositions: Number(replayBuffer.evictedPositions || 0),
      summary: replayBuffer.summary ? deepClone(replayBuffer.summary) : this.summarizeRunReplayBuffer(run),
      policySamples: [],
      valueSamples: [],
      identitySamples: [],
    };
    checkpointRun.retainedGames = [];
    checkpointRun.working = {
      ...(checkpointRun.working || {}),
      modelBundle: null,
      optimizerState: null,
    };

    return {
      run: checkpointRun,
      replayBuffer,
      retainedGames,
      workingArtifacts,
    };
  }

  buildRunJournalPayload(run) {
    return this.buildRunCheckpointPayload(run, {
      replayPositionLimit: RUN_STATE_JOURNAL_REPLAY_POSITION_LIMIT,
      replayIdentityLimit: RUN_STATE_JOURNAL_REPLAY_POSITION_LIMIT * RUN_STATE_JOURNAL_REPLAY_IDENTITY_MULTIPLIER,
    });
  }

  buildRunCheckpointMetadata(run, checkpointId, relativePaths = {}, checkpointSavedAt = nowIso()) {
    return {
      id: checkpointId,
      createdAt: checkpointSavedAt,
      updatedAt: run?.updatedAt || run?.createdAt || checkpointSavedAt,
      status: run?.status || 'completed',
      bestGeneration: Number(run?.bestGeneration || 0),
      workerGeneration: Number(run?.workerGeneration || 0),
      checkpointIndex: Number(run?.working?.checkpointIndex || 0),
      totalTrainingSteps: Number(run?.stats?.totalTrainingSteps || 0),
      totalSelfPlayGames: Number(run?.stats?.totalSelfPlayGames || 0),
      totalEvaluationGames: Number(run?.stats?.totalEvaluationGames || 0),
      generationCount: Array.isArray(run?.generations) ? run.generations.length : 0,
      retainedGameCount: Array.isArray(run?.retainedGames) ? run.retainedGames.length : 0,
      replayBuffer: this.summarizeRunReplayBuffer(run),
      paths: {
        checkpoint: relativePaths.checkpoint || null,
        replayBuffer: relativePaths.replayBuffer || null,
        retainedGames: relativePaths.retainedGames || null,
        workingState: relativePaths.workingState || null,
      },
    };
  }

  buildRunManifestRecord(run, checkpointMetadata, options = {}) {
    return {
      version: RUN_PERSISTENCE_LAYOUT_VERSION,
      id: run?.id || null,
      createdAt: run?.createdAt || null,
      updatedAt: run?.updatedAt || run?.createdAt || null,
      status: run?.status || 'completed',
      summary: this.summarizeRun(run),
      checkpoints: Array.isArray(options.checkpoints) ? deepClone(options.checkpoints) : [],
      latestCheckpointId: checkpointMetadata?.id || null,
      latestCheckpointPath: checkpointMetadata?.paths?.checkpoint || null,
      checkpointedAt: checkpointMetadata?.createdAt || null,
      persistence: {
        layoutVersion: RUN_PERSISTENCE_LAYOUT_VERSION,
        manifestPath: options.manifestPath || null,
        latestCheckpointId: checkpointMetadata?.id || null,
        latestCheckpointPath: checkpointMetadata?.paths?.checkpoint || null,
        replayBufferPath: checkpointMetadata?.paths?.replayBuffer || null,
        retainedGamesPath: checkpointMetadata?.paths?.retainedGames || null,
        workingStatePath: checkpointMetadata?.paths?.workingState || null,
        journalPath: options.journalPath || run?.persistence?.journalPath || null,
        latestJournalSequence: Number(
          options.latestJournalSequence
          ?? run?.persistence?.latestJournalSequence
          ?? 0
        ),
        latestJournalEventAt: options.latestJournalEventAt || null,
        checkpointedAt: checkpointMetadata?.createdAt || null,
        checkpointedForUpdatedAt: run?.updatedAt || run?.createdAt || null,
        mongo: options.mongo || run?.persistence?.mongo || null,
      },
    };
  }

  buildRunPersistenceSignature(run) {
    if (!run || typeof run !== 'object') return '';
    return JSON.stringify({
      updatedAt: run.updatedAt || run.createdAt || null,
      status: run.status || 'completed',
      stopReason: run.stopReason || null,
      bestGeneration: Number(run.bestGeneration || 0),
      workerGeneration: Number(run.workerGeneration || 0),
      pendingWorkerGeneration: Number.isFinite(run.pendingWorkerGeneration) ? Number(run.pendingWorkerGeneration) : null,
      checkpointIndex: Number(run?.working?.checkpointIndex || 0),
      workingBaseGeneration: Number(run?.working?.baseGeneration || 0),
      replayPositions: Number(run?.replayBuffer?.policySamples?.length || 0),
      replayIdentityPositions: Number(run?.replayBuffer?.identitySamples?.length || 0),
      replayTotalPositionsSeen: Number(run?.replayBuffer?.totalPositionsSeen || 0),
      retainedGames: (run?.retainedGames || []).map((game) => ({
        id: game?.id || null,
        createdAt: game?.createdAt || null,
        phase: game?.phase || null,
        whiteGeneration: Number.isFinite(game?.whiteGeneration) ? Number(game.whiteGeneration) : null,
        blackGeneration: Number.isFinite(game?.blackGeneration) ? Number(game.blackGeneration) : null,
        plies: Number.isFinite(game?.plies) ? Number(game.plies) : null,
      })),
      totalTrainingSteps: Number(run?.stats?.totalTrainingSteps || 0),
      totalSelfPlayGames: Number(run?.stats?.totalSelfPlayGames || 0),
      totalEvaluationGames: Number(run?.stats?.totalEvaluationGames || 0),
      latestLossStep: Number.isFinite(run?.working?.lastLoss?.step) ? Number(run.working.lastLoss.step) : null,
      metricsHistoryLength: Array.isArray(run?.metricsHistory) ? run.metricsHistory.length : 0,
      evaluationHistoryLength: Array.isArray(run?.evaluationHistory) ? run.evaluationHistory.length : 0,
    });
  }

  async persistRunToFilesystem(run, options = {}) {
    if (!run?.id) return null;
    const currentUpdatedAt = run.updatedAt || run.createdAt || nowIso();
    const persistenceSignature = this.buildRunPersistenceSignature(run);
    if (
      options.force !== true
      && run?.persistence?.checkpointedForUpdatedAt
      && String(run.persistence.checkpointedForUpdatedAt) === String(currentUpdatedAt)
      && String(run?.persistence?.lastPersistedSignature || '') === persistenceSignature
      && run?.persistence?.manifestPath
    ) {
      return this.buildPersistedRunReference(run);
    }

    const rootDir = this.getRuntimeDataRootDir();
    const runManifestPath = this.getRunManifestPath(run.id);
    const journalPath = this.getRunJournalPath(run.id);
    const checkpointsDir = this.getRunCheckpointsDir(run.id);
    const artifactsDir = this.getRunArtifactsDir(run.id);
    ensureDirSync(checkpointsDir);
    ensureDirSync(artifactsDir);

    const checkpointId = this.buildRunCheckpointId(run);
    const checkpointSavedAt = nowIso();
    const checkpointPath = path.join(checkpointsDir, `${checkpointId}.json`);
    const replayBufferPath = path.join(artifactsDir, `replay-buffer.${checkpointId}.json`);
    const retainedGamesPath = path.join(artifactsDir, `retained-games.${checkpointId}.json`);
    const workingStatePath = path.join(artifactsDir, `working-state.${checkpointId}.json`);
    const relativePaths = {
      checkpoint: toPortableRelativePath(rootDir, checkpointPath),
      replayBuffer: toPortableRelativePath(rootDir, replayBufferPath),
      retainedGames: toPortableRelativePath(rootDir, retainedGamesPath),
      workingState: toPortableRelativePath(rootDir, workingStatePath),
    };

    const payload = this.buildRunCheckpointPayload(run, options.persistOptions);
    await persistJsonWithFallback(replayBufferPath, JSON.stringify(payload.replayBuffer));
    await persistJsonWithFallback(retainedGamesPath, JSON.stringify(payload.retainedGames));
    await persistJsonWithFallback(workingStatePath, JSON.stringify(encodeMlPersistenceArtifacts(payload.workingArtifacts)));
    await persistJsonWithFallback(checkpointPath, JSON.stringify(encodeMlPersistenceArtifacts({
      version: RUN_PERSISTENCE_LAYOUT_VERSION,
      checkpointId,
      runId: run.id,
      createdAt: checkpointSavedAt,
      run: payload.run,
      artifacts: {
        replayBufferPath: relativePaths.replayBuffer,
        retainedGamesPath: relativePaths.retainedGames,
        workingStatePath: relativePaths.workingState,
      },
    })));

    const existingManifest = await readJsonIfExists(runManifestPath);
    const existingCheckpoints = Array.isArray(existingManifest?.checkpoints)
      ? existingManifest.checkpoints.filter(Boolean)
      : (Array.isArray(run?.persistence?.checkpoints) ? run.persistence.checkpoints.filter(Boolean) : []);
    const checkpointMetadata = this.buildRunCheckpointMetadata(run, checkpointId, relativePaths, checkpointSavedAt);
    const mergedCheckpoints = [
      checkpointMetadata,
      ...existingCheckpoints.filter((entry) => entry?.id && entry.id !== checkpointId),
    ];
    const retainedCheckpoints = mergedCheckpoints.slice(0, RUN_CHECKPOINT_HISTORY_LIMIT);
    const removedCheckpoints = mergedCheckpoints.slice(RUN_CHECKPOINT_HISTORY_LIMIT);
    const manifestRelativePath = toPortableRelativePath(rootDir, runManifestPath);
    const journalRelativePath = toPortableRelativePath(rootDir, journalPath);
    const manifestRecord = this.buildRunManifestRecord(run, checkpointMetadata, {
      checkpoints: retainedCheckpoints,
      manifestPath: manifestRelativePath,
      journalPath: journalRelativePath,
      latestJournalSequence: Number(run?.persistence?.latestJournalSequence || 0),
      latestJournalEventAt: run?.persistence?.latestJournalEventAt || null,
      mongo: run?.persistence?.mongo || null,
    });
    await persistJsonWithFallback(runManifestPath, JSON.stringify(manifestRecord));

    await Promise.all(removedCheckpoints.flatMap((entry) => ([
      removeFileIfExists(resolvePortableRelativePath(rootDir, entry?.paths?.checkpoint)),
      removeFileIfExists(resolvePortableRelativePath(rootDir, entry?.paths?.replayBuffer)),
      removeFileIfExists(resolvePortableRelativePath(rootDir, entry?.paths?.retainedGames)),
      removeFileIfExists(resolvePortableRelativePath(rootDir, entry?.paths?.workingState)),
    ])));

    const mongoStatus = await this.persistRunMetadataToMongo(run, manifestRecord, checkpointMetadata);
    const latestJournalSequence = Number(run?.persistence?.latestJournalSequence || 0);
    const latestJournalEventAt = run?.persistence?.latestJournalEventAt || null;
    run.persistence = {
      layoutVersion: RUN_PERSISTENCE_LAYOUT_VERSION,
      manifestPath: manifestRelativePath,
      latestCheckpointId: checkpointMetadata.id,
      latestCheckpointPath: checkpointMetadata.paths.checkpoint,
      replayBufferPath: checkpointMetadata.paths.replayBuffer,
      retainedGamesPath: checkpointMetadata.paths.retainedGames,
      workingStatePath: checkpointMetadata.paths.workingState,
      journalPath: journalRelativePath,
      latestJournalSequence,
      latestJournalEventAt,
      journalReplayBufferPath: run?.persistence?.journalReplayBufferPath || null,
      journalRetainedGamesPath: run?.persistence?.journalRetainedGamesPath || null,
      journalWorkingStatePath: run?.persistence?.journalWorkingStatePath || null,
      checkpointedAt: checkpointSavedAt,
      checkpointedForUpdatedAt: currentUpdatedAt,
      lastPersistedSignature: persistenceSignature,
      checkpoints: retainedCheckpoints,
      mongo: mongoStatus?.saved ? mongoStatus : (run?.persistence?.mongo || mongoStatus || null),
    };
    return this.buildPersistedRunReference(run);
  }

  async hydrateRunFromExternalState(runState, artifacts = {}, persistence = {}) {
    if (!runState || typeof runState !== 'object') return null;
    const rootDir = this.getRuntimeDataRootDir();
    const replayBufferPath = resolvePortableRelativePath(
      rootDir,
      artifacts.replayBufferPath || persistence.replayBufferPath,
    );
    const retainedGamesPath = resolvePortableRelativePath(
      rootDir,
      artifacts.retainedGamesPath || persistence.retainedGamesPath,
    );
    const workingStatePath = resolvePortableRelativePath(
      rootDir,
      artifacts.workingStatePath || persistence.workingStatePath,
    );
    const replayBuffer = await readJsonIfExistsBounded(replayBufferPath, {
      maxBytes: RUN_HYDRATE_REPLAY_BUFFER_MAX_BYTES,
      fallback: null,
      onOversize: ({ path: oversizedPath, size, maxBytes }) => {
        console.warn('[ml-runtime] skipping oversized persisted replay buffer while hydrating run', {
          runId: runState.id || null,
          path: oversizedPath,
          bytes: size,
          maxBytes,
        });
      },
    });
    const retainedGames = await readJsonIfExistsBounded(retainedGamesPath, {
      maxBytes: RUN_HYDRATE_RETAINED_GAMES_MAX_BYTES,
      fallback: null,
      onOversize: ({ path: oversizedPath, size, maxBytes }) => {
        console.warn('[ml-runtime] skipping oversized retained games while hydrating run', {
          runId: runState.id || null,
          path: oversizedPath,
          bytes: size,
          maxBytes,
        });
      },
    });
    const workingState = await readJsonIfExistsBounded(workingStatePath, {
      maxBytes: RUN_HYDRATE_WORKING_STATE_MAX_BYTES,
      fallback: null,
      onOversize: ({ path: oversizedPath, size, maxBytes }) => {
        console.warn('[ml-runtime] skipping oversized working state while hydrating run', {
          runId: runState.id || null,
          path: oversizedPath,
          bytes: size,
          maxBytes,
        });
      },
    });
    const decodedRunState = decodeMlPersistenceArtifacts(runState);
    const decodedWorkingState = decodeMlPersistenceArtifacts(workingState);
    const workingBaseGeneration = Number(decodedRunState?.working?.baseGeneration || decodedRunState?.bestGeneration || 0);
    const fallbackGenerationModelBundle = (decodedRunState?.generations || []).find((generation) => (
      Number(generation?.generation || 0) === workingBaseGeneration
      && generation?.approved !== false
      && generation?.modelBundle
    ))?.modelBundle || null;

    const hydratedRun = {
      ...deepClone(decodedRunState),
      replayBuffer: replayBuffer || decodedRunState.replayBuffer || {},
      retainedGames: Array.isArray(retainedGames) ? retainedGames : (decodedRunState.retainedGames || []),
      working: {
        ...(decodedRunState.working || {}),
        modelBundle: decodedWorkingState?.modelBundle
          || decodedRunState?.working?.modelBundle
          || fallbackGenerationModelBundle
          || null,
        optimizerState: Object.prototype.hasOwnProperty.call(decodedWorkingState || {}, 'optimizerState')
          ? decodedWorkingState.optimizerState
          : (decodedRunState?.working?.optimizerState || null),
      },
    };
    const normalized = this.normalizeStoredRunRecord(hydratedRun);
    if (!normalized) return null;
    normalized.persistence = {
      ...(normalized.persistence || {}),
      ...deepClone(persistence || {}),
    };
    return normalized;
  }

  async hydrateRunFromCheckpointRecord(checkpointRecord, manifestRecord = null) {
    const decodedRecord = decodeMlPersistenceArtifacts(checkpointRecord);
    if (!decodedRecord?.run || !decodedRecord?.runId) return null;
    const artifacts = decodedRecord.artifacts || {};
    return this.hydrateRunFromExternalState(decodedRecord.run, artifacts, {
      layoutVersion: RUN_PERSISTENCE_LAYOUT_VERSION,
      manifestPath: manifestRecord?.persistence?.manifestPath || manifestRecord?.manifestPath || null,
      latestCheckpointId: manifestRecord?.latestCheckpointId || decodedRecord?.checkpointId || null,
      latestCheckpointPath: manifestRecord?.latestCheckpointPath || manifestRecord?.persistence?.latestCheckpointPath || null,
      replayBufferPath: manifestRecord?.persistence?.replayBufferPath || artifacts.replayBufferPath || null,
      retainedGamesPath: manifestRecord?.persistence?.retainedGamesPath || artifacts.retainedGamesPath || null,
      workingStatePath: manifestRecord?.persistence?.workingStatePath || artifacts.workingStatePath || null,
      journalPath: manifestRecord?.persistence?.journalPath || null,
      latestJournalSequence: Number(manifestRecord?.persistence?.latestJournalSequence || 0),
      latestJournalEventAt: manifestRecord?.persistence?.latestJournalEventAt || null,
      checkpointedAt: manifestRecord?.checkpointedAt || decodedRecord?.createdAt || null,
      checkpointedForUpdatedAt: decodedRecord?.run?.updatedAt || decodedRecord?.run?.createdAt || null,
      checkpoints: Array.isArray(manifestRecord?.checkpoints) ? deepClone(manifestRecord.checkpoints) : [],
      mongo: manifestRecord?.persistence?.mongo || null,
    });
  }

  async loadLatestRunJournalEvent(runId, manifestRecord = null) {
    if (!runId) return null;
    const rootDir = this.getRuntimeDataRootDir();
    const journalRelativePath = manifestRecord?.persistence?.journalPath
      || toPortableRelativePath(rootDir, this.getRunJournalPath(runId));
    const journalPath = resolvePortableRelativePath(rootDir, journalRelativePath);
    if (!journalPath || !fs.existsSync(journalPath)) {
      return null;
    }
    const parsed = await readLastJsonLineIfExists(journalPath, {
      maxBytes: RUN_JOURNAL_TAIL_READ_MAX_BYTES,
      onTruncated: ({ path: truncatedPath, fileSize, maxBytes }) => {
        console.warn('[ml-runtime] skipped oversized journal tail while loading run state', {
          runId,
          path: truncatedPath,
          bytes: fileSize,
          maxBytes,
        });
      },
    });
    if (parsed?.runId === runId && parsed?.state) {
      return {
        ...decodeMlPersistenceArtifacts(parsed),
        journalPath: journalRelativePath,
      };
    }
    return null;
  }

  async hydrateRunFromJournalEvent(journalEvent, manifestRecord = null) {
    if (!journalEvent?.state || !journalEvent?.runId) return null;
    const checkpointedAt = manifestRecord?.checkpointedAt || manifestRecord?.persistence?.checkpointedAt || null;
    if (checkpointedAt && parseTimeValue(journalEvent.createdAt) <= parseTimeValue(checkpointedAt)) {
      return null;
    }
    return this.hydrateRunFromExternalState(journalEvent.state, journalEvent.artifacts || {}, {
      layoutVersion: RUN_PERSISTENCE_LAYOUT_VERSION,
      manifestPath: manifestRecord?.persistence?.manifestPath || manifestRecord?.manifestPath || null,
      latestCheckpointId: manifestRecord?.latestCheckpointId || manifestRecord?.persistence?.latestCheckpointId || null,
      latestCheckpointPath: manifestRecord?.latestCheckpointPath || manifestRecord?.persistence?.latestCheckpointPath || null,
      replayBufferPath: journalEvent?.artifacts?.replayBufferPath || manifestRecord?.persistence?.replayBufferPath || null,
      retainedGamesPath: journalEvent?.artifacts?.retainedGamesPath || manifestRecord?.persistence?.retainedGamesPath || null,
      workingStatePath: journalEvent?.artifacts?.workingStatePath || manifestRecord?.persistence?.workingStatePath || null,
      journalPath: journalEvent?.journalPath || manifestRecord?.persistence?.journalPath || null,
      latestJournalSequence: Number(journalEvent?.sequence || 0),
      latestJournalEventAt: journalEvent?.createdAt || null,
      checkpointedAt: manifestRecord?.checkpointedAt || null,
      checkpointedForUpdatedAt: journalEvent?.state?.updatedAt || journalEvent?.state?.createdAt || null,
      checkpoints: Array.isArray(manifestRecord?.checkpoints) ? deepClone(manifestRecord.checkpoints) : [],
      mongo: manifestRecord?.persistence?.mongo || null,
    });
  }

  async appendRunJournalSnapshot(run, reason, options = {}) {
    if (!this.persist || !run?.id) return null;
    const rootDir = this.getRuntimeDataRootDir();
    const journalDir = this.getRunJournalDir(run.id);
    const journalArtifactsDir = this.getRunJournalArtifactsDir(run.id);
    const journalPath = this.getRunJournalPath(run.id);
    ensureDirSync(journalDir);
    ensureDirSync(journalArtifactsDir);

    const sequence = Number(run?.persistence?.latestJournalSequence || 0) + 1;
    const eventId = `evt-${String(sequence).padStart(6, '0')}-${Date.now()}`;
    const payload = this.buildRunJournalPayload(run);
    let replayBufferRelativePath = run?.persistence?.journalReplayBufferPath || run?.persistence?.replayBufferPath || null;
    let retainedGamesRelativePath = run?.persistence?.journalRetainedGamesPath || run?.persistence?.retainedGamesPath || null;
    let workingStateRelativePath = run?.persistence?.journalWorkingStatePath || run?.persistence?.workingStatePath || null;

    if (options.includeReplayBuffer === true || !replayBufferRelativePath) {
      const replayBufferPath = path.join(journalArtifactsDir, `replay-buffer.${eventId}.json`);
      await persistJsonWithFallback(replayBufferPath, JSON.stringify(payload.replayBuffer));
      replayBufferRelativePath = toPortableRelativePath(rootDir, replayBufferPath);
    }
    if (options.includeRetainedGames === true || !retainedGamesRelativePath) {
      const retainedGamesPath = path.join(journalArtifactsDir, `retained-games.${eventId}.json`);
      await persistJsonWithFallback(retainedGamesPath, JSON.stringify(payload.retainedGames));
      retainedGamesRelativePath = toPortableRelativePath(rootDir, retainedGamesPath);
    }
    if (options.includeWorkingState === true || !workingStateRelativePath) {
      const workingStatePath = path.join(journalArtifactsDir, `working-state.${eventId}.json`);
      await persistJsonWithFallback(workingStatePath, JSON.stringify(encodeMlPersistenceArtifacts(payload.workingArtifacts)));
      workingStateRelativePath = toPortableRelativePath(rootDir, workingStatePath);
    }

    const entry = {
      version: RUN_PERSISTENCE_LAYOUT_VERSION,
      sequence,
      type: 'state',
      reason: reason || 'update',
      createdAt: nowIso(),
      runId: run.id,
      state: payload.run,
      artifacts: {
        replayBufferPath: replayBufferRelativePath,
        retainedGamesPath: retainedGamesRelativePath,
        workingStatePath: workingStateRelativePath,
      },
    };
    await appendFileWithRetry(journalPath, `${JSON.stringify(encodeMlPersistenceArtifacts(entry))}\n`, 'utf8');

    run.persistence = {
      ...(run.persistence || {}),
      layoutVersion: RUN_PERSISTENCE_LAYOUT_VERSION,
      journalPath: toPortableRelativePath(rootDir, journalPath),
      latestJournalSequence: sequence,
      latestJournalEventAt: entry.createdAt,
      journalReplayBufferPath: replayBufferRelativePath,
      journalRetainedGamesPath: retainedGamesRelativePath,
      journalWorkingStatePath: workingStateRelativePath,
    };
    return {
      sequence,
      createdAt: entry.createdAt,
    };
  }

  async loadPersistedRunFromReference(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const manifestRelativePath = entry.manifestPath || entry?.persistence?.manifestPath || null;
    if (!manifestRelativePath) {
      return this.normalizeStoredRunRecord(entry);
    }
    const rootDir = this.getRuntimeDataRootDir();
    const manifestPath = resolvePortableRelativePath(rootDir, manifestRelativePath);
    const manifestRecord = await readJsonIfExists(manifestPath);
    if (!manifestRecord || !manifestRecord.id) {
      return null;
    }
    manifestRecord.persistence = {
      ...(manifestRecord.persistence || {}),
      manifestPath: manifestRelativePath,
    };
    const checkpointRelativePath = manifestRecord.latestCheckpointPath
      || manifestRecord?.persistence?.latestCheckpointPath
      || entry.latestCheckpointPath
      || entry?.persistence?.latestCheckpointPath
      || null;
    if (!checkpointRelativePath) {
      return null;
    }
    const checkpointPath = resolvePortableRelativePath(rootDir, checkpointRelativePath);
    const checkpointRecord = await readJsonIfExists(checkpointPath);
    if (!checkpointRecord) {
      return null;
    }
    manifestRecord.latestCheckpointPath = checkpointRelativePath;
    const checkpointRun = await this.hydrateRunFromCheckpointRecord(checkpointRecord, manifestRecord);
    const journalEvent = await this.loadLatestRunJournalEvent(manifestRecord.id, manifestRecord);
    if (!journalEvent) {
      return checkpointRun;
    }
    const journalRun = await this.hydrateRunFromJournalEvent(journalEvent, manifestRecord);
    return journalRun || checkpointRun;
  }

  async loadPersistedRuns(entries = []) {
    const loadedRuns = [];
    for (let index = 0; index < entries.length; index += 1) {
      const run = await this.loadPersistedRunFromReference(entries[index]);
      if (run?.id) {
        loadedRuns.push(run);
      }
    }
    return loadedRuns;
  }

  async deletePersistedRunArtifacts(runId) {
    if (!runId) return;
    await removeDirectoryIfExists(this.getRunStorageDir(runId));
  }

  isMongoSimulationPersistenceAvailable() {
    if (!this.persist || !this.useMongoSimulations) return false;
    return mongoose.connection && mongoose.connection.readyState === 1;
  }

  normalizeStoredSimulationRecord(simulation) {
    if (!simulation || typeof simulation !== 'object') return null;
    const normalized = deepClone(simulation);
    if (Object.prototype.hasOwnProperty.call(normalized, '_id')) {
      delete normalized._id;
    }
    if (Object.prototype.hasOwnProperty.call(normalized, '__v')) {
      delete normalized.__v;
    }
    return normalized;
  }

  getInMemorySimulation(simulationId) {
    return (this.state.simulations || []).find((item) => item.id === simulationId) || null;
  }

  async listStoredSimulations(options = {}) {
    const rawLimit = Number(options.limit);
    const hasLimit = Number.isFinite(rawLimit);
    const limit = hasLimit
      ? clampPositiveInt(rawLimit, this.maxSimulationHistory, 1, this.maxSimulationHistory)
      : null;
    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      let query = SimulationModel.find({}, { _id: 0, __v: 0 })
        .sort({ createdAt: -1 });
      if (limit) {
        query = query.limit(limit);
      }
      const docs = await query.lean();
      const mongoRecords = (Array.isArray(docs) ? docs : [])
        .map((doc) => this.normalizeStoredSimulationRecord(doc))
        .filter(Boolean);
      const memoryRecords = (this.state.simulations || [])
        .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
        .filter(Boolean);
      const mongoIds = new Set(mongoRecords.map((record) => record.id));
      const unsavedMemoryRecords = memoryRecords.filter((record) => !mongoIds.has(record.id));
      return mergeSimulationRecords([mongoRecords, unsavedMemoryRecords], limit);
    }

    const source = Array.isArray(this.state.simulations) ? this.state.simulations : [];
    const bounded = limit ? source.slice(0, limit) : source.slice();
    return bounded
      .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
      .filter(Boolean);
  }

  async maybeMigrateStateSimulationsToMongo() {
    if (!this.isMongoSimulationPersistenceAvailable()) return;
    if (this.didAttemptMongoSimulationMigration) return;
    this.didAttemptMongoSimulationMigration = true;

    const legacySimulations = Array.isArray(this.state.simulations)
      ? this.state.simulations
      : [];
    if (!legacySimulations.length) return;

    try {
      for (let idx = 0; idx < legacySimulations.length; idx += 1) {
        const simulation = this.normalizeStoredSimulationRecord(legacySimulations[idx]);
        if (!simulation || !simulation.id) continue;
        const existing = await SimulationModel.exists({ id: simulation.id });
        if (existing) continue;
        await this.persistSimulationToMongo(simulation, { skipMigration: true });
      }
    } catch (err) {
      console.error('[ml-runtime] failed to migrate local simulation history to MongoDB', err);
    }
  }

  async getStoredSimulationById(simulationId) {
    if (!simulationId) return null;

    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      const doc = await SimulationModel.findOne({ id: simulationId }, { _id: 0, __v: 0 }).lean();
      const mongoRecord = doc ? this.normalizeStoredSimulationRecord(doc) : null;
      const memoryRecord = this.normalizeStoredSimulationRecord(this.getInMemorySimulation(simulationId));
      if (memoryRecord && !mongoRecord) {
        return memoryRecord;
      }
      if (!memoryRecord) {
        return mongoRecord;
      }
      const mongoDetailed = simulationHasDetailedGames(mongoRecord);
      const memoryDetailed = simulationHasDetailedGames(memoryRecord);
      if (memoryDetailed && !mongoDetailed) {
        return memoryRecord;
      }
      return mongoRecord;
    }

    return this.normalizeStoredSimulationRecord(this.getInMemorySimulation(simulationId));
  }

  async listStoredSimulationsForTraining(simulationIds = null) {
    const allowed = Array.isArray(simulationIds) && simulationIds.length
      ? new Set(simulationIds)
      : null;

    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      const query = allowed ? { id: { $in: Array.from(allowed) } } : {};
      const docs = await SimulationModel.find(query, { _id: 0, __v: 0 })
        .sort({ createdAt: -1 })
        .lean();
      const mongoRecords = (Array.isArray(docs) ? docs : [])
        .map((doc) => this.normalizeStoredSimulationRecord(doc))
        .filter(Boolean);
      const memoryRecords = (this.state.simulations || [])
        .filter((simulation) => !allowed || allowed.has(simulation.id))
        .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
        .filter(Boolean);
      const mongoIds = new Set(mongoRecords.map((record) => record.id));
      const unsavedMemoryRecords = memoryRecords.filter((record) => !mongoIds.has(record.id));
      const memoryDetailedRecords = memoryRecords
        .filter((record) => simulationHasDetailedGames(record));
      const merged = mergeSimulationRecords(
        [mongoRecords, memoryDetailedRecords, unsavedMemoryRecords],
        null,
      );

      const externalSimulationIds = merged
        .filter((simulation) => simulation?.gamesStoredExternally && !simulationHasDetailedGames(simulation))
        .map((simulation) => simulation.id)
        .filter(Boolean);
      const gamesBySimulationId = new Map();
      if (externalSimulationIds.length) {
        const gameDocs = await SimulationGameModel
          .find(
            { simulationId: { $in: externalSimulationIds } },
            { _id: 0, __v: 0 },
          )
          .sort({ simulationId: 1, createdAt: 1 })
          .lean();
        (Array.isArray(gameDocs) ? gameDocs : []).forEach((gameDoc) => {
          const normalized = this.normalizeStoredSimulationRecord(gameDoc);
          if (!normalized?.simulationId) return;
          if (!gamesBySimulationId.has(normalized.simulationId)) {
            gamesBySimulationId.set(normalized.simulationId, []);
          }
          gamesBySimulationId.get(normalized.simulationId).push(normalized);
        });
      }

      return merged.map((simulation) => {
        if (!simulation?.gamesStoredExternally || simulationHasDetailedGames(simulation)) {
          return simulation;
        }
        const hydratedGames = gamesBySimulationId.get(simulation.id);
        if (!Array.isArray(hydratedGames) || !hydratedGames.length) {
          return simulation;
        }
        return {
          ...simulation,
          games: hydratedGames,
        };
      });
    }

    return (this.state.simulations || [])
      .filter((simulation) => !allowed || allowed.has(simulation.id))
      .map((simulation) => this.normalizeStoredSimulationRecord(simulation))
      .filter(Boolean);
  }

  async persistSimulationToMongo(simulation, options = {}) {
    if (!simulation || !this.isMongoSimulationPersistenceAvailable()) {
      return {
        saved: false,
        reason: 'mongo_unavailable',
      };
    }

    try {
      if (!options.skipMigration) {
        await this.maybeMigrateStateSimulationsToMongo();
      }
      const payload = this.normalizeStoredSimulationRecord(simulation);
      if (!payload || !payload.id) {
        return {
          saved: false,
          reason: 'invalid_payload',
        };
      }

      const gamePayloads = Array.isArray(payload.games) ? payload.games : [];
      const checkpointGameIds = Array.isArray(options.gameIds)
        ? new Set(options.gameIds.filter(Boolean))
        : null;
      const hasDetailedGamePayloads = simulationHasDetailedGames(payload);
      const gameSummaries = gamePayloads
        .map((game) => summarizeGameForStorage(game))
        .filter(Boolean);
      const inlineSummaryLimit = 256;
      const inlineSummaries = gameSummaries.slice(0, inlineSummaryLimit);

      const mongoStatus = {
        saved: true,
        mode: 'external-games',
        gameCount: gameSummaries.length,
      };
      const simulationDoc = {
        ...payload,
        games: inlineSummaries,
        gameCount: gameSummaries.length,
        gamesStoredExternally: true,
        status: payload.status || 'completed',
        persistence: {
          ...(payload.persistence || {}),
          mongo: mongoStatus,
        },
      };

      await SimulationModel.updateOne(
        { id: simulationDoc.id },
        { $set: simulationDoc },
        { upsert: true, setDefaultsOnInsert: true },
      );

      const shouldSyncDetailedGames = hasDetailedGamePayloads || !payload.gamesStoredExternally;
      if (shouldSyncDetailedGames) {
        const checkpointGames = checkpointGameIds
          ? gamePayloads.filter((game) => checkpointGameIds.has(game?.id))
          : gamePayloads;
        const gameOperations = checkpointGames
          .filter((game) => game && game.id)
          .map((game) => {
            const summary = summarizeGameForStorage(game) || {};
            return {
              updateOne: {
                filter: { simulationId: simulationDoc.id, id: game.id },
                update: {
                  $set: {
                    simulationId: simulationDoc.id,
                    decisionCount: summary.decisionCount || 0,
                    replayFrameCount: summary.replayFrameCount || 0,
                    ...deepClone(game),
                  },
                },
                upsert: true,
              },
            };
          });

        if (gameOperations.length) {
          const chunks = chunkArray(gameOperations, 10);
          for (let idx = 0; idx < chunks.length; idx += 1) {
            await SimulationGameModel.bulkWrite(chunks[idx], { ordered: false });
          }
        }

        if (options.pruneMissingGames === true) {
          const gameIds = gamePayloads
            .map((game) => game?.id)
            .filter(Boolean);
          if (gameIds.length) {
            await SimulationGameModel.deleteMany({
              simulationId: simulationDoc.id,
              id: { $nin: gameIds },
            });
          } else {
            await SimulationGameModel.deleteMany({ simulationId: simulationDoc.id });
          }
        }
      }

      return mongoStatus;
    } catch (err) {
      const status = {
        saved: false,
        reason: 'mongo_write_failed',
        message: err?.message || 'MongoDB write failed',
      };
      console.error('[ml-runtime] failed to persist simulation to MongoDB', err);
      return status;
    }
  }

  isMongoTrainingPersistenceAvailable() {
    return this.isMongoSimulationPersistenceAvailable();
  }

  isMongoRunPersistenceAvailable() {
    if (!this.persist || !this.useMongoRuns) return false;
    return mongoose.connection && mongoose.connection.readyState === 1;
  }

  async persistRunMetadataToMongo(run, manifestRecord, checkpointMetadata) {
    if (!run?.id || !this.isMongoRunPersistenceAvailable()) {
      return {
        saved: false,
        reason: 'mongo_unavailable',
      };
    }

    try {
      const summary = this.summarizeRun(run) || {};
      const mongoStatus = {
        saved: true,
        mode: 'metadata',
        manifestPath: manifestRecord?.persistence?.manifestPath || null,
        latestCheckpointId: checkpointMetadata?.id || null,
        latestCheckpointPath: checkpointMetadata?.paths?.checkpoint || null,
        checkpointedAt: checkpointMetadata?.createdAt || null,
      };

      await MlRunModel.updateOne(
        { id: run.id },
        {
          $set: {
            id: run.id,
            createdAt: run.createdAt || nowIso(),
            updatedAt: run.updatedAt || run.createdAt || nowIso(),
            status: run.status || 'completed',
            stopReason: run.stopReason || null,
            label: run.label || '',
            config: deepClone(run.config || {}),
            stats: {
              totalTrainingSteps: Number(run.stats?.totalTrainingSteps || 0),
              totalSelfPlayGames: Number(run.stats?.totalSelfPlayGames || 0),
              totalEvaluationGames: Number(run.stats?.totalEvaluationGames || 0),
              totalPromotions: Number(run.stats?.totalPromotions || 0),
              failedPromotions: Number(run.stats?.failedPromotions || 0),
            },
            replayBuffer: deepClone(summary.replayBuffer || {}),
            latestLoss: summary.latestLoss ? deepClone(summary.latestLoss) : null,
            latestEvaluation: summary.latestEvaluation ? deepClone(summary.latestEvaluation) : null,
            persistence: {
              layoutVersion: RUN_PERSISTENCE_LAYOUT_VERSION,
              storage: 'filesystem',
              manifestPath: manifestRecord?.persistence?.manifestPath || null,
              latestCheckpointId: checkpointMetadata?.id || null,
              latestCheckpointPath: checkpointMetadata?.paths?.checkpoint || null,
              checkpointedAt: checkpointMetadata?.createdAt || null,
              replayBufferPath: checkpointMetadata?.paths?.replayBuffer || null,
              retainedGamesPath: checkpointMetadata?.paths?.retainedGames || null,
              workingStatePath: checkpointMetadata?.paths?.workingState || null,
              mongo: mongoStatus,
            },
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );

      await MlRunCheckpointModel.updateOne(
        { runId: run.id, checkpointId: checkpointMetadata?.id || '' },
        {
          $set: {
            runId: run.id,
            checkpointId: checkpointMetadata?.id || '',
            createdAt: checkpointMetadata?.createdAt || nowIso(),
            updatedAt: checkpointMetadata?.updatedAt || checkpointMetadata?.createdAt || nowIso(),
            status: checkpointMetadata?.status || run.status || 'completed',
            bestGeneration: Number(checkpointMetadata?.bestGeneration || 0),
            workerGeneration: Number(checkpointMetadata?.workerGeneration || 0),
            checkpointIndex: Number(checkpointMetadata?.checkpointIndex || 0),
            totalTrainingSteps: Number(checkpointMetadata?.totalTrainingSteps || 0),
            totalSelfPlayGames: Number(checkpointMetadata?.totalSelfPlayGames || 0),
            totalEvaluationGames: Number(checkpointMetadata?.totalEvaluationGames || 0),
            replayBuffer: deepClone(checkpointMetadata?.replayBuffer || {}),
            paths: deepClone(checkpointMetadata?.paths || {}),
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );

      const retainedCheckpointIds = Array.isArray(manifestRecord?.checkpoints)
        ? manifestRecord.checkpoints.map((entry) => entry?.id).filter(Boolean)
        : [];
      if (retainedCheckpointIds.length) {
        await MlRunCheckpointModel.deleteMany({
          runId: run.id,
          checkpointId: { $nin: retainedCheckpointIds },
        });
      }

      return mongoStatus;
    } catch (err) {
      const status = {
        saved: false,
        reason: 'mongo_write_failed',
        message: err?.message || 'MongoDB write failed',
      };
      console.error('[ml-runtime] failed to persist run metadata to MongoDB', err);
      return status;
    }
  }

  async deleteRunMetadataFromMongo(runId) {
    if (!runId || !this.isMongoRunPersistenceAvailable()) return;
    try {
      await MlRunModel.deleteOne({ id: runId });
      await MlRunCheckpointModel.deleteMany({ runId });
    } catch (err) {
      console.error('[ml-runtime] failed to delete run metadata from MongoDB', err);
    }
  }

  async hydrateActiveRunsFromMongo() {
    if (!this.isMongoRunPersistenceAvailable()) return false;
    const docs = await MlRunModel.find(
      { status: { $in: ['running', 'stopping'] } },
      { _id: 0, __v: 0 },
    )
      .sort({ updatedAt: -1 })
      .lean()
      .catch(() => []);
    let changed = false;
    for (let index = 0; index < (Array.isArray(docs) ? docs.length : 0); index += 1) {
      const doc = docs[index];
      if (!doc?.id || this.getRunById(doc.id)) {
        continue;
      }
      const run = await this.loadPersistedRunFromReference({
        id: doc.id,
        manifestPath: doc?.persistence?.manifestPath || null,
        latestCheckpointId: doc?.persistence?.latestCheckpointId || null,
        latestCheckpointPath: doc?.persistence?.latestCheckpointPath || null,
      });
      if (!run?.id) {
        continue;
      }
      run.persistence = {
        ...(run.persistence || {}),
        mongo: doc?.persistence?.mongo || null,
      };
      this.state.runs.unshift(run);
      changed = true;
    }
    return changed;
  }

  async persistTrainingRunToMongo(trainingRun, options = {}) {
    if (!trainingRun || !this.isMongoTrainingPersistenceAvailable()) {
      return {
        saved: false,
        reason: 'mongo_unavailable',
      };
    }

    try {
      const payload = this.normalizeStoredTrainingRunRecord(trainingRun);
      if (!payload?.id) {
        return {
          saved: false,
          reason: 'invalid_payload',
        };
      }

      const checkpoint = deepClone(payload.checkpoint || {});
      if (options.includeCheckpointArtifacts !== true) {
        delete checkpoint.modelBundle;
        delete checkpoint.optimizerState;
      }

      await TrainingRunModel.updateOne(
        { id: payload.id },
        {
          $set: {
            ...payload,
            checkpoint,
            updatedAt: payload.updatedAt || nowIso(),
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );

      return {
        saved: true,
        mode: options.includeCheckpointArtifacts === true ? 'checkpoint' : 'summary',
      };
    } catch (err) {
      const status = {
        saved: false,
        reason: 'mongo_write_failed',
        message: err?.message || 'MongoDB write failed',
      };
      console.error('[ml-runtime] failed to persist training run to MongoDB', err);
      return status;
    }
  }

  async listStoredTrainingRuns(options = {}) {
    const limit = clampPositiveInt(options.limit, 20, 1, 500);
    if (this.isMongoTrainingPersistenceAvailable()) {
      const docs = await TrainingRunModel.find(
        {},
        {
          _id: 0,
          __v: 0,
          'checkpoint.modelBundle': 0,
          'checkpoint.optimizerState': 0,
        },
      )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      const mongoRecords = (Array.isArray(docs) ? docs : [])
        .map((doc) => this.normalizeStoredTrainingRunRecord(doc))
        .filter(Boolean);
      const memoryRecords = (this.state.trainingRuns || [])
        .map((run) => this.normalizeStoredTrainingRunRecord(run))
        .filter(Boolean);
      const mergedById = new Map();
      [...mongoRecords, ...memoryRecords].forEach((run) => {
        if (!run?.id) return;
        const existing = mergedById.get(run.id);
        if (!existing) {
          mergedById.set(run.id, run);
          return;
        }
        const existingTime = Math.max(parseTimeValue(existing.updatedAt), parseTimeValue(existing.createdAt));
        const candidateTime = Math.max(parseTimeValue(run.updatedAt), parseTimeValue(run.createdAt));
        if (candidateTime >= existingTime) {
          mergedById.set(run.id, run);
        }
      });
      return Array.from(mergedById.values())
        .sort((a, b) => (
          Math.max(parseTimeValue(b?.updatedAt), parseTimeValue(b?.createdAt))
          - Math.max(parseTimeValue(a?.updatedAt), parseTimeValue(a?.createdAt))
        ))
        .slice(0, limit);
    }

    return (this.state.trainingRuns || [])
      .slice(0, limit)
      .map((run) => this.normalizeStoredTrainingRunRecord(run))
      .filter(Boolean);
  }

  async trimMongoSimulationHistory() {
    if (!this.trimMongoSimulationHistoryEnabled) return;
    if (!this.isMongoSimulationPersistenceAvailable()) return;

    try {
      await this.maybeMigrateStateSimulationsToMongo();
      const stale = await SimulationModel.find({}, { id: 1, _id: 0 })
        .sort({ createdAt: -1 })
        .skip(this.maxSimulationHistory)
        .lean();
      if (!stale.length) return;
      const staleIds = stale
        .map((entry) => entry.id)
        .filter(Boolean);
      if (!staleIds.length) return;
      await SimulationModel.deleteMany({ id: { $in: staleIds } });
      await SimulationGameModel.deleteMany({ simulationId: { $in: staleIds } });
    } catch (err) {
      console.error('[ml-runtime] failed to trim simulation history in MongoDB', err);
    }
  }

  getSnapshotById(snapshotId) {
    return (this.state.snapshots || []).find((snapshot) => snapshot.id === snapshotId) || null;
  }

  summarizeSnapshot(snapshot) {
    if (!snapshot) return null;
    const latestLoss = Array.isArray(snapshot.losses) && snapshot.losses.length
      ? snapshot.losses[snapshot.losses.length - 1]
      : null;
    return {
      id: snapshot.id,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      generation: snapshot.generation,
      parentSnapshotId: snapshot.parentSnapshotId,
      bootstrapKey: snapshot.bootstrapKey || null,
      notes: snapshot.notes,
      stats: snapshot.stats,
      latestLoss,
      lossCount: Array.isArray(snapshot.losses) ? snapshot.losses.length : 0,
    };
  }

  summarizeSimulation(simulation) {
    if (!simulation) return null;
    const participantResults = Array.isArray(simulation?.stats?.participantResults)
      ? simulation.stats.participantResults.map((entry) => (
        normalizeParticipantStatsEntry(entry, entry?.games)
      ))
      : [];
    const stats = {
      ...(simulation.stats || {}),
      participantResults,
    };
    const hasReasonStats = stats.winReasons
      && typeof stats.winReasons === 'object'
      && Object.keys(stats.winReasons).length > 0;
    if (!hasReasonStats) {
      const derived = deriveWinReasonCountsFromGames(simulation);
      if (Object.keys(derived).length) {
        stats.winReasons = derived;
      }
    }
    const errorMessage = simulation?.persistence?.error
      || simulation?.persistence?.message
      || simulation?.persistence?.mongo?.message
      || null;
    return {
      id: simulation.id,
      createdAt: simulation.createdAt,
      label: simulation.label,
      whiteSnapshotId: simulation.whiteSnapshotId,
      blackSnapshotId: simulation.blackSnapshotId,
      participantAId: simulation.participantAId || null,
      participantBId: simulation.participantBId || null,
      participantALabel: simulation.participantALabel || null,
      participantBLabel: simulation.participantBLabel || null,
      alternateColors: Boolean(simulation?.config?.alternateColors),
      status: simulation.status || 'completed',
      config: simulation.config,
      gameCount: Number.isFinite(simulation.gameCount)
        ? simulation.gameCount
        : Number.isFinite(simulation?.stats?.games)
          ? Number(simulation.stats.games)
          : (Array.isArray(simulation.games) ? simulation.games.length : 0),
      gamesStoredExternally: Boolean(simulation.gamesStoredExternally),
      persistence: simulation.persistence || null,
      errorMessage,
      stats,
    };
  }

  summarizeTrainingRun(trainingRun) {
    if (!trainingRun) return null;
    const history = Array.isArray(trainingRun.history) ? trainingRun.history : [];
    const latestLoss = trainingRun.finalLoss || (history.length ? history[history.length - 1] : null);
    return {
      id: trainingRun.id,
      createdAt: trainingRun.createdAt,
      updatedAt: trainingRun.updatedAt || trainingRun.createdAt,
      status: trainingRun.status || 'completed',
      label: trainingRun.label || '',
      notes: trainingRun.notes || '',
      baseSnapshotId: trainingRun.baseSnapshotId || null,
      newSnapshotId: trainingRun.newSnapshotId || null,
      epochs: Number(trainingRun.epochs || 0),
      batchSize: Number(trainingRun.batchSize || 0),
      learningRate: Number(trainingRun.learningRate || 0),
      trainingBackend: trainingRun.trainingBackend || TRAINING_BACKENDS.NODE,
      trainingDevicePreference: trainingRun.trainingDevicePreference || TRAINING_DEVICE_PREFERENCES.AUTO,
      sourceSimulationIds: Array.isArray(trainingRun.sourceSimulationIds)
        ? trainingRun.sourceSimulationIds.slice()
        : [],
      sourceGames: Number(trainingRun.sourceGames || 0),
      sourceSimulations: Number(trainingRun.sourceSimulations || 0),
      sampleCounts: deepClone(trainingRun.sampleCounts || {}),
      history: deepClone(history),
      finalLoss: latestLoss ? deepClone(latestLoss) : null,
      checkpoint: {
        completedEpochs: Number(trainingRun?.checkpoint?.completedEpochs || history.length || 0),
        totalEpochs: Number(trainingRun?.checkpoint?.totalEpochs || trainingRun.epochs || 0),
        checkpointedAt: trainingRun?.checkpoint?.checkpointedAt || null,
      },
    };
  }

  async getSummary() {
    await this.ensureLoaded();
    const snapshots = (this.state.snapshots || []).map((snapshot) => this.summarizeSnapshot(snapshot));
    const simulations = await this.listStoredSimulations({ limit: this.maxSimulationHistory });
    const trainingRuns = await this.listStoredTrainingRuns({ limit: 1 });
    const runs = await this.listRuns({ limit: 1 });
    const totalGames = simulations.reduce((acc, simulation) => (
      acc + ((simulation.stats && simulation.stats.games) || 0)
    ), 0);
    const totalTrainingRuns = (await this.listStoredTrainingRuns({ limit: 500 })).length;
    const latestSimulation = simulations.length ? this.summarizeSimulation(simulations[0]) : null;
    const latestTraining = trainingRuns.length ? this.summarizeTrainingRun(trainingRuns[0]) : null;

    return {
      snapshots,
      counts: {
        snapshots: snapshots.length,
        simulations: simulations.length,
        games: totalGames,
        trainingRuns: totalTrainingRuns,
        runs: (this.state.runs || []).length,
      },
      latestSimulation,
      latestTraining,
      latestRun: runs.length ? runs[0] : null,
    };
  }

  async listSnapshots() {
    await this.ensureLoaded();
    return (this.state.snapshots || []).map((snapshot) => this.summarizeSnapshot(snapshot));
  }

  async listParticipants() {
    await this.ensureLoaded();
    const snapshots = (this.state.snapshots || []).map((snapshot) => ({
      id: toSnapshotParticipantId(snapshot.id),
      type: 'snapshot',
      snapshotId: snapshot.id,
      label: snapshot.label,
      generation: snapshot.generation,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
      stats: snapshot.stats || {},
      notes: snapshot.notes || '',
    }));
    return {
      builtins: this.listBuiltinParticipants(),
      snapshots,
      items: [...snapshots, ...this.listBuiltinParticipants()],
    };
  }

  async getSnapshotDetails(snapshotId) {
    await this.ensureLoaded();
    const snapshot = this.getSnapshotById(snapshotId);
    if (!snapshot) return null;
    return deepClone(snapshot);
  }

  async createSnapshot(options = {}) {
    await this.ensureLoaded();
    const base = options.fromSnapshotId ? this.getSnapshotById(options.fromSnapshotId) : null;
    const generation = base ? (base.generation + 1) : 0;
    const label = options.label
      || (base ? `${base.label} (fork)` : 'Snapshot');
    const record = this.createSnapshotRecord({
      label,
      generation,
      parentSnapshotId: base ? base.id : null,
      modelBundle: base ? base.modelBundle : createDefaultModelBundle({ seed: Date.now() }),
      notes: options.notes || '',
    });
    this.state.snapshots.unshift(record);
    await this.save();
    return this.summarizeSnapshot(record);
  }

  async renameSnapshot(snapshotId, nextLabel) {
    await this.ensureLoaded();
    const id = typeof snapshotId === 'string' ? snapshotId.trim() : '';
    const label = typeof nextLabel === 'string' ? nextLabel.trim() : '';
    if (!id) {
      const err = new Error('Snapshot id is required');
      err.statusCode = 400;
      err.code = 'INVALID_SNAPSHOT_ID';
      throw err;
    }
    if (!label) {
      const err = new Error('Snapshot label is required');
      err.statusCode = 400;
      err.code = 'INVALID_SNAPSHOT_LABEL';
      throw err;
    }

    const snapshot = this.getSnapshotById(id);
    if (!snapshot) {
      return null;
    }
    snapshot.label = label;
    snapshot.updatedAt = nowIso();
    await this.save();
    return this.summarizeSnapshot(snapshot);
  }

  async renameRunGeneration(runId, generationNumber, nextLabel) {
    await this.ensureLoaded();
    const id = typeof runId === 'string' ? runId.trim() : '';
    const generation = Number.parseInt(generationNumber, 10);
    const label = typeof nextLabel === 'string' ? nextLabel.trim() : '';
    if (!id) {
      const err = new Error('Run id is required');
      err.statusCode = 400;
      err.code = 'INVALID_RUN_ID';
      throw err;
    }
    if (!Number.isFinite(generation) || generation < 0) {
      const err = new Error('Generation must be a non-negative integer');
      err.statusCode = 400;
      err.code = 'INVALID_GENERATION';
      throw err;
    }
    if (!label) {
      const err = new Error('Generation label is required');
      err.statusCode = 400;
      err.code = 'INVALID_GENERATION_LABEL';
      throw err;
    }

    const run = this.getRunById(id);
    const generationRecord = this.getRunGeneration(run, generation);
    if (!generationRecord) {
      return null;
    }
    generationRecord.label = label;
    generationRecord.updatedAt = nowIso();
    if (run) {
      run.updatedAt = generationRecord.updatedAt;
    }
    await this.save();
    return {
      id: generationRecord.id,
      runId: run?.id || id,
      generation: Number(generationRecord.generation || 0),
      label: generationRecord.label || `G${Number(generationRecord.generation || 0)}`,
      updatedAt: generationRecord.updatedAt || null,
    };
  }

  async deleteSnapshot(snapshotId) {
    await this.ensureLoaded();
    const id = typeof snapshotId === 'string' ? snapshotId.trim() : '';
    if (!id) {
      const err = new Error('Snapshot id is required');
      err.statusCode = 400;
      err.code = 'INVALID_SNAPSHOT_ID';
      throw err;
    }

    const snapshots = Array.isArray(this.state.snapshots) ? this.state.snapshots : [];
    const index = snapshots.findIndex((snapshot) => snapshot.id === id);
    if (index < 0) {
      return { deleted: false, id };
    }

    if (snapshots.length <= 1) {
      const err = new Error('Cannot delete the last snapshot');
      err.statusCode = 409;
      err.code = 'LAST_SNAPSHOT';
      throw err;
    }

    const [removed] = snapshots.splice(index, 1);
    await this.save();
    return {
      deleted: true,
      id,
      removedSnapshot: this.summarizeSnapshot(removed),
      remainingSnapshots: snapshots.length,
    };
  }

  getLatestSnapshot() {
    return (this.state.snapshots || [])[0] || null;
  }

  resolveSnapshot(snapshotId) {
    if (!snapshotId) return this.getLatestSnapshot();
    return this.getSnapshotById(snapshotId) || this.getLatestSnapshot();
  }

  listBuiltinParticipants() {
    return BUILTIN_PARTICIPANTS.map((participant) => ({
      id: participant.id,
      type: participant.type,
      label: participant.label,
      notes: participant.notes || '',
    }));
  }

  resolveParticipant(participantId, fallbackSnapshotId = null) {
    const normalizedBuiltinId = normalizeParticipantId(participantId);
    if (normalizedBuiltinId && isBuiltinParticipantId(normalizedBuiltinId)) {
      const builtin = getBuiltinParticipant(normalizedBuiltinId);
      if (builtin) {
        return {
          id: builtin.id,
          type: 'builtin',
          label: builtin.label,
          notes: builtin.notes || '',
          snapshot: null,
          snapshotId: null,
          builtinId: builtin.id,
        };
      }
    }

    let snapshotId = parseSnapshotParticipantId(participantId);
    if (!snapshotId && typeof participantId === 'string' && participantId.trim()) {
      snapshotId = participantId.trim();
    }
    if (!snapshotId && fallbackSnapshotId) {
      snapshotId = fallbackSnapshotId;
    }

    const snapshot = this.resolveSnapshot(snapshotId);
    if (!snapshot) return null;
    return {
      id: toSnapshotParticipantId(snapshot.id),
      type: 'snapshot',
      label: snapshot.label || snapshot.id,
      notes: snapshot.notes || '',
      snapshot,
      snapshotId: snapshot.id,
      builtinId: null,
    };
  }

  getDisplayParticipantId(participant) {
    if (!participant) return '';
    if (participant.type === 'builtin') return participant.id || '';
    if (participant.type === 'generation') return participant.id || '';
    if (participant.snapshotId) return toSnapshotParticipantId(participant.snapshotId);
    return participant.id || '';
  }

  getDisplayParticipantLabel(participant, fallbackId = '') {
    if (!participant) return fallbackId || 'Unknown';
    if (participant.type === 'generation') {
      if (Number.isFinite(participant.generation)) {
        return participant.label || `G${participant.generation}`;
      }
      return participant.label || participant.id || fallbackId || 'Unknown';
    }
    return participant.label || participant.snapshot?.label || participant.snapshotId || participant.id || fallbackId || 'Unknown';
  }

  async buildUniqueSimulationLabel(baseLabel, options = {}) {
    const normalizedBase = typeof baseLabel === 'string'
      ? baseLabel.trim()
      : '';
    const safeBase = normalizedBase || 'Simulation';
    const forceOrdinal = Boolean(options.forceOrdinal);

    const existingSimulations = await this.listStoredSimulations({ limit: this.maxSimulationHistory });
    const existingLabels = new Set(
      existingSimulations
        .map((simulation) => String(simulation?.label || '').trim())
        .filter(Boolean),
    );

    if (!forceOrdinal && !existingLabels.has(safeBase)) {
      return safeBase;
    }

    let index = 1;
    let candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    while (existingLabels.has(candidate)) {
      index += 1;
      candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    }
    return candidate;
  }

  async buildUniqueRunLabel(baseLabel) {
    const safeBase = normalizeOrdinalBaseLabel(baseLabel, 'Run');
    const existingLabels = new Set(
      (this.state.runs || [])
        .map((run) => String(run?.label || '').trim())
        .filter(Boolean),
    );
    let index = 1;
    let candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    while (existingLabels.has(candidate)) {
      index += 1;
      candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    }
    return candidate;
  }

  async buildUniqueTrainingLabel(baseLabel) {
    const safeBase = normalizeOrdinalBaseLabel(baseLabel, 'Model');
    const existingLabels = new Set([
      ...(this.state.snapshots || []).map((snapshot) => String(snapshot?.label || '').trim()),
      ...(this.state.trainingRuns || []).map((trainingRun) => String(trainingRun?.label || '').trim()),
    ].filter(Boolean));
    let index = 1;
    let candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    while (existingLabels.has(candidate)) {
      index += 1;
      candidate = `${safeBase} ${String(index).padStart(3, '0')}`;
    }
    return candidate;
  }

  chooseActionForParticipant(participant, state, options = {}) {
    return chooseActionForParticipantImpl(participant, state, options);
  }

  recordSimulationOnSnapshot(snapshot, stats = {}, asColor = WHITE) {
    if (!snapshot) return;
    snapshot.stats = snapshot.stats || {};
    snapshot.stats.simulations = (snapshot.stats.simulations || 0) + 1;
    snapshot.stats.games = (snapshot.stats.games || 0) + (stats.games || 0);
    snapshot.stats.whiteWins = (snapshot.stats.whiteWins || 0) + (stats.whiteWins || 0);
    snapshot.stats.blackWins = (snapshot.stats.blackWins || 0) + (stats.blackWins || 0);
    snapshot.stats.draws = (snapshot.stats.draws || 0) + (stats.draws || 0);
    snapshot.updatedAt = nowIso();
    snapshot.lastUsedAs = asColor === WHITE ? 'white' : 'black';
  }

  buildTrainingSamplesFromDecisions(decisions, winner) {
    return buildTrainingSamplesFromDecisions(decisions, winner);
  }

  async runSingleGameFast(options = {}) {
    const game = await runFastGame({
      ...options,
      gameId: options.gameId || this.nextId('game'),
    });
    if (!game.id) {
      game.id = options.gameId || this.nextId('game');
    }
    return game;
  }

  getSimulationIndex(simulationId) {
    return (this.state.simulations || []).findIndex((simulation) => simulation.id === simulationId);
  }

  upsertSimulationRecord(simulation) {
    if (!simulation?.id) return null;
    const index = this.getSimulationIndex(simulation.id);
    if (index >= 0) {
      this.state.simulations.splice(index, 1);
    }
    this.state.simulations.unshift(simulation);
    if (this.state.simulations.length > this.maxSimulationHistory) {
      this.state.simulations.length = this.maxSimulationHistory;
    }
    return simulation;
  }

  getTrainingRunIndex(trainingRunId) {
    return (this.state.trainingRuns || []).findIndex((trainingRun) => trainingRun.id === trainingRunId);
  }

  upsertTrainingRunRecord(trainingRun) {
    if (!trainingRun?.id) return null;
    const index = this.getTrainingRunIndex(trainingRun.id);
    if (index >= 0) {
      this.state.trainingRuns.splice(index, 1);
    }
    this.state.trainingRuns.unshift(trainingRun);
    if (this.state.trainingRuns.length > 500) {
      this.state.trainingRuns.length = 500;
    }
    return trainingRun;
  }

  async runSingleGame(options = {}) {
    const startedAtMs = Date.now();
    const whiteParticipant = options.whiteParticipant || null;
    const blackParticipant = options.blackParticipant || null;
    const whiteParticipantId = this.getDisplayParticipantId(whiteParticipant);
    const blackParticipantId = this.getDisplayParticipantId(blackParticipant);
    const whiteParticipantLabel = this.getDisplayParticipantLabel(whiteParticipant, whiteParticipantId);
    const blackParticipantLabel = this.getDisplayParticipantLabel(blackParticipant, blackParticipantId);
    const seed = Number.isFinite(options.seed) ? options.seed : Date.now();
    const maxPlies = clampPositiveInt(options.maxPlies, 120, 40, 300);
    const mctsOptions = {
      iterations: clampPositiveInt(options.iterations, 90, 10, 800),
      maxDepth: clampPositiveInt(options.maxDepth, 16, 4, 80),
      hypothesisCount: clampPositiveInt(options.hypothesisCount, 8, 1, 24),
      riskBias: normalizeFloat(options.riskBias, 0, 0, 3),
      exploration: normalizeFloat(options.exploration, 1.25, 0, 5),
    };
    const maxDecisionSafety = Math.max(maxPlies * 6, maxPlies + 24);

    const replay = [];
    const decisions = [];
    let forcedStopReason = null;
    const liveContext = await createApiBackedGame(seed);
    let liveGame = liveContext.game;
    let shadowState = createShadowStateFromLiveGame(liveGame, {
      maxPlies,
      seed,
      playablePly: 0,
      resetActionHistory: true,
    });

    replay.push(toReplayFrameFromGame(liveGame, {
      note: 'start',
      actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
      moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
    }));

    try {
      for (let step = 0; step < maxDecisionSafety; step += 1) {
        if (!liveGame || !liveGame.isActive || !shadowState || !shadowState.isActive) break;
        const currentPlayer = Number.isFinite(shadowState.playerTurn) ? shadowState.playerTurn : WHITE;
        const participant = currentPlayer === WHITE ? whiteParticipant : blackParticipant;
        const participantId = this.getDisplayParticipantId(participant);
        const participantLabel = this.getDisplayParticipantLabel(participant, participantId);

        if (!participant) {
          forcedStopReason = 'missing_participant';
          liveGame = await applyLiveActionToGame(liveContext, {
            type: 'RESIGN',
            player: currentPlayer,
          }, shadowState);
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          }));
          break;
        }

        const observationState = shadowState;
        const legalActions = getLegalActions(observationState, currentPlayer);
        if (!legalActions.length) {
          forcedStopReason = 'no_legal_actions';
          liveGame = await applyLiveActionToGame(liveContext, {
            type: 'RESIGN',
            player: currentPlayer,
          }, shadowState);
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          }));
          break;
        }

        const search = this.chooseActionForParticipant(participant, observationState, {
          ...mctsOptions,
          seed: seed + (decisions.length * 104729),
        });
        const requestedKey = actionKey(search?.action);

        const candidates = buildPreferredLiveActionCandidates(search, legalActions);

        let executedAction = null;
        let nextLiveGame = liveGame;
        let nextShadowState = shadowState;
        const liveRejectedCandidates = [];

        for (let idx = 0; idx < candidates.length; idx += 1) {
          const candidate = candidates[idx];
          try {
            nextLiveGame = await applyLiveActionToGame(liveContext, candidate, shadowState);
          } catch (err) {
            liveRejectedCandidates.push({
              actionKey: actionKey(candidate),
              message: err.message || 'Action rejected',
            });
            continue;
          }

          const shadowCandidate = applyAction(shadowState, candidate);
          executedAction = candidate;
          nextShadowState = shadowCandidate === shadowState
            ? createShadowStateFromLiveGame(nextLiveGame, {
              maxPlies,
              seed,
              playablePly: decisions.length + 1,
            })
            : shadowCandidate;
          break;
        }

        if (!executedAction) {
          forcedStopReason = 'all_legal_actions_rejected';
          liveGame = await applyLiveActionToGame(liveContext, {
            type: 'RESIGN',
            player: currentPlayer,
          }, shadowState);
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
            decision: {
              player: currentPlayer,
              participantId,
              participantLabel,
              snapshotId: participant.snapshotId || null,
              action: { type: 'RESIGN', player: currentPlayer },
              move: { type: 'RESIGN', player: currentPlayer },
              valueEstimate: 0,
              trace: {
                reason: forcedStopReason,
                liveRejectedCandidates,
              },
            },
          }));
          break;
        }

        const parity = compareLiveGameToShadowState(nextLiveGame, nextShadowState);
        if (!parity.ok) {
          nextShadowState = createShadowStateFromLiveGame(nextLiveGame, {
            maxPlies,
            seed,
            playablePly: decisions.length + 1,
          });
        }

        const executedKey = actionKey(executedAction);
        const useTrainingRecord = Boolean(requestedKey && executedKey === requestedKey);
        const decisionTrace = {
          ...deepClone(search?.trace || {}),
          liveRoute: {
            fallbackUsed: Boolean(requestedKey && executedKey && requestedKey !== executedKey),
            rejectedCandidates: liveRejectedCandidates,
            parityMismatches: parity.ok ? [] : parity.mismatches,
          },
        };
        const decision = {
          ply: decisions.length,
          player: currentPlayer,
          participantId,
          participantLabel,
          snapshotId: participant.snapshotId || null,
          action: deepClone(executedAction),
          move: deepClone(executedAction),
          trace: decisionTrace,
          valueEstimate: Number.isFinite(search?.valueEstimate) ? search.valueEstimate : 0,
          trainingRecord: useTrainingRecord && search?.trainingRecord
            ? {
              ...deepClone(search.trainingRecord),
              snapshotId: participant.snapshotId || null,
              sourceGeneration: Number.isFinite(participant.generation) ? participant.generation : null,
            }
            : null,
        };
        decisions.push(decision);
        liveGame = nextLiveGame;
        shadowState = nextShadowState;
        replay.push(toReplayFrameFromGame(liveGame, {
          actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
          moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          decision,
        }));

        if (decisions.length >= maxPlies && liveGame.isActive) {
          forcedStopReason = 'max_plies';
          liveGame = await forceLiveGameDraw(liveContext);
          shadowState = createShadowStateFromLiveGame(liveGame, {
            maxPlies,
            seed,
            playablePly: decisions.length,
          });
          replay.push(toReplayFrameFromGame(liveGame, {
            note: forcedStopReason,
            actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
            moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
          }));
          break;
        }
      }

      if (liveGame && liveGame.isActive) {
        forcedStopReason = forcedStopReason || 'safety_stop';
        liveGame = await forceLiveGameDraw(liveContext);
        shadowState = createShadowStateFromLiveGame(liveGame, {
          maxPlies,
          seed,
          playablePly: decisions.length,
        });
        replay.push(toReplayFrameFromGame(liveGame, {
          note: forcedStopReason,
          actionCount: Array.isArray(liveGame.actions) ? liveGame.actions.length : 0,
          moveCount: Array.isArray(liveGame.moves) ? liveGame.moves.length : 0,
        }));
      }

      const winner = Number.isFinite(liveGame?.winner) ? liveGame.winner : null;
      const winReason = liveGame?.winReason ?? forcedStopReason ?? null;
      const training = this.buildTrainingSamplesFromDecisions(decisions, winner);
      const plies = decisions.length;

      return {
        id: options.gameId || this.nextId('game'),
        createdAt: nowIso(),
        durationMs: Math.max(0, Date.now() - startedAtMs),
        seed,
        setupMode: 'live-route',
        whiteParticipantId,
        blackParticipantId,
        whiteParticipantLabel,
        blackParticipantLabel,
        winner,
        winReason,
        plies,
        actionHistory: Array.isArray(liveGame?.actions) ? deepClone(liveGame.actions) : [],
        moveHistory: Array.isArray(liveGame?.moves) ? deepClone(liveGame.moves) : [],
        replay,
        decisions,
        training,
        result: {
          whiteValue: winner === null ? 0 : (winner === WHITE ? 1 : -1),
          blackValue: winner === null ? 0 : (winner === BLACK ? 1 : -1),
        },
      };
    } finally {
      await cleanupApiBackedGame(liveContext);
    }
  }

  createSimulationAccumulator(participantA, participantB) {
    const participantResultById = {};
    [participantA, participantB].forEach((participant) => {
      const id = this.getDisplayParticipantId(participant);
      participantResultById[id] = {
        participantId: id,
        participantType: participant?.type || 'snapshot',
        snapshotId: participant?.snapshotId || null,
        label: this.getDisplayParticipantLabel(participant, id),
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        asWhite: 0,
        asBlack: 0,
        whiteWins: 0,
        blackWins: 0,
      };
    });

    return {
      stats: {
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        draws: 0,
        averagePlies: 0,
        winReasons: {},
        participantResults: [],
      },
      participantResultById,
    };
  }

  applyGameToSimulationAccumulator(stats, participantResultById, game, whiteParticipant, blackParticipant) {
    if (!stats || !game) return;
    const previousGames = Number(stats.games || 0);
    const nextGames = previousGames + 1;
    stats.games = nextGames;
    stats.averagePlies = (
      ((Number(stats.averagePlies || 0) * previousGames) + Number(game.plies || 0))
      / nextGames
    );
    if (game.winner === WHITE) stats.whiteWins += 1;
    else if (game.winner === BLACK) stats.blackWins += 1;
    else stats.draws += 1;
    const reasonKey = String(game.winReason ?? 'unknown');
    stats.winReasons[reasonKey] = (stats.winReasons[reasonKey] || 0) + 1;

    const whiteId = game.whiteParticipantId || this.getDisplayParticipantId(whiteParticipant);
    const blackId = game.blackParticipantId || this.getDisplayParticipantId(blackParticipant);
    const whiteStats = participantResultById[whiteId];
    const blackStats = participantResultById[blackId];
    if (whiteStats) {
      whiteStats.games += 1;
      whiteStats.asWhite += 1;
    }
    if (blackStats) {
      blackStats.games += 1;
      blackStats.asBlack += 1;
    }
    if (game.winner === WHITE) {
      if (whiteStats) {
        whiteStats.wins += 1;
        whiteStats.whiteWins += 1;
      }
      if (blackStats) blackStats.losses += 1;
    } else if (game.winner === BLACK) {
      if (blackStats) {
        blackStats.wins += 1;
        blackStats.blackWins += 1;
      }
      if (whiteStats) whiteStats.losses += 1;
    } else {
      if (whiteStats) whiteStats.draws += 1;
      if (blackStats) blackStats.draws += 1;
    }
  }

  finalizeSimulationAccumulator(stats, participantResultById) {
    const normalizedStats = {
      ...(stats || {}),
      games: Number(stats?.games || 0),
      whiteWins: Number(stats?.whiteWins || 0),
      blackWins: Number(stats?.blackWins || 0),
      draws: Number(stats?.draws || 0),
      averagePlies: Number(stats?.averagePlies || 0),
      winReasons: deepClone(stats?.winReasons || {}),
    };
    normalizedStats.participantResults = Object.values(participantResultById || {}).map((entry) => (
      normalizeParticipantStatsEntry(entry, entry.games)
    ));
    return normalizedStats;
  }

  rebuildSimulationAccumulator(games, participantA, participantB) {
    const { stats, participantResultById } = this.createSimulationAccumulator(participantA, participantB);
    (Array.isArray(games) ? games : []).forEach((game) => {
      const whiteParticipant = game?.whiteParticipantId === this.getDisplayParticipantId(participantB)
        ? participantB
        : participantA;
      const blackParticipant = game?.blackParticipantId === this.getDisplayParticipantId(participantA)
        ? participantA
        : participantB;
      this.applyGameToSimulationAccumulator(stats, participantResultById, game, whiteParticipant, blackParticipant);
    });
    return {
      stats: this.finalizeSimulationAccumulator(stats, participantResultById),
      participantResultById,
    };
  }

  shouldCheckpointProgress(completedUnits, lastCheckpointAt, options = {}) {
    if (options.force === true) return true;
    const count = Number(completedUnits || 0);
    if (count <= 0) return false;
    if ((count % SIMULATION_CHECKPOINT_GAME_INTERVAL) === 0) return true;
    const elapsed = Date.now() - (Number(lastCheckpointAt || 0) || 0);
    return Number.isFinite(elapsed) && elapsed >= SIMULATION_CHECKPOINT_MS;
  }

  buildSimulationJobPayload(job, phase = null, overrides = {}) {
    const simulation = job?.simulationId ? this.getInMemorySimulation(job.simulationId) : null;
    const config = simulation?.config || job?.options || {};
    const requestedGameCount = Number(
      job?.checkpoint?.requestedGameCount
      || config.requestedGameCount
      || config.gameCount
      || simulation?.gameCount
      || 0
    );
    const completedGames = Number(
      overrides.completedGames
      ?? job?.checkpoint?.completedGames
      ?? simulation?.stats?.games
      ?? 0
    );
    const progress = requestedGameCount > 0 ? (completedGames / requestedGameCount) : 0;
    const inferredPhase = phase || (completedGames > 0 ? 'game' : 'start');
    return {
      phase: inferredPhase,
      taskId: job?.taskId || '',
      simulationId: job?.simulationId || simulation?.id || '',
      timestamp: nowIso(),
      label: simulation?.label || job?.label || job?.simulationId || '',
      gameCount: requestedGameCount,
      participantAId: simulation?.participantAId || job?.participantAId || null,
      participantBId: simulation?.participantBId || job?.participantBId || null,
      participantALabel: simulation?.participantALabel || job?.participantALabel || null,
      participantBLabel: simulation?.participantBLabel || job?.participantBLabel || null,
      alternateColors: Boolean(config.alternateColors),
      completedGames,
      progress: Math.max(0, Math.min(1, progress)),
      latestGameId: overrides.latestGameId || job?.checkpoint?.latestGameId || null,
      status: simulation?.status || job?.status || 'running',
      stats: deepClone(simulation?.stats || job?.checkpoint?.stats || {}),
      ...overrides,
    };
  }

  emitSimulationJobProgress(job, phase, overrides = {}) {
    const payload = this.buildSimulationJobPayload(job, phase, overrides);
    this.rememberLiveStatus('simulation', payload);
    eventBus.emit('ml:simulationProgress', payload);
    return payload;
  }

  async checkpointSimulationJob(job, simulation, options = {}) {
    if (!job || !simulation) return;
    const checkpointedAt = nowIso();
    simulation.updatedAt = checkpointedAt;
    simulation.status = options.status || simulation.status || 'running';
    simulation.config = {
      ...(simulation.config || {}),
      requestedGameCount: Number(job?.checkpoint?.requestedGameCount || simulation?.config?.requestedGameCount || 0),
      completedGameCount: Number(simulation?.stats?.games || simulation?.gameCount || 0),
    };
    simulation.gameCount = Number(simulation?.stats?.games || simulation?.gameCount || 0);
    simulation.persistence = {
      ...(simulation.persistence || {}),
      taskId: job.taskId,
      checkpointedAt,
    };

    job.updatedAt = checkpointedAt;
    job.status = simulation.status === 'stopping' ? 'stopping' : (options.jobStatus || 'running');
    job.checkpoint = {
      ...(job.checkpoint || {}),
      requestedGameCount: Number(job?.checkpoint?.requestedGameCount || simulation?.config?.requestedGameCount || 0),
      completedGames: Number(simulation?.stats?.games || simulation?.gameCount || 0),
      latestGameId: options.latestGameId || job?.checkpoint?.latestGameId || null,
      lastCheckpointAt: checkpointedAt,
      checkpointedAt,
      stats: deepClone(simulation.stats || {}),
    };

    const mongoPersistence = await this.persistSimulationToMongo(simulation, {
      gameIds: options.gameIds || null,
      pruneMissingGames: options.pruneMissingGames === true,
    });
    simulation.persistence.mongo = mongoPersistence;
    if (mongoPersistence?.saved) {
      simulation.gamesStoredExternally = true;
    }
    this.state.activeJobs.simulation = deepClone(job);
    this.upsertSimulationRecord(simulation.gamesStoredExternally
      ? compactSimulationForState(simulation)
      : simulation);
    await this.save();
  }

  resumeSimulationJob(jobRecord) {
    const job = jobRecord || this.state.activeJobs?.simulation;
    if (!job?.taskId || !job?.simulationId) return;
    if (this.simulationTasks.has(job.taskId)) return;
    const taskState = {
      id: job.taskId,
      status: 'running',
      cancelRequested: String(job.status || '').toLowerCase() === 'stopping',
    };
    this.simulationTasks.set(job.taskId, taskState);
    this.runSimulationJob(taskState).catch((err) => {
      console.error('[ml-runtime] simulation background job failed', err);
    });
  }

  async startSimulationJob(options = {}) {
    await this.ensureLoaded();
    const activeJob = this.state.activeJobs?.simulation || null;
    if (activeJob && String(activeJob.status || '').toLowerCase() === 'running') {
      const err = new Error('A simulation batch is already running');
      err.statusCode = 409;
      err.code = 'SIMULATION_ALREADY_RUNNING';
      throw err;
    }

    const participantA = this.resolveParticipant(
      options.whiteParticipantId || options.whiteSnapshotId,
      options.whiteSnapshotId || null,
    );
    const participantB = this.resolveParticipant(
      options.blackParticipantId || options.blackSnapshotId,
      options.blackSnapshotId || null,
    );
    if (!participantA || !participantB) {
      const err = new Error('Choose two valid controllers before starting a simulation batch');
      err.statusCode = 400;
      err.code = 'INVALID_SIMULATION_PARTICIPANTS';
      throw err;
    }

    const gameCount = clampPositiveInt(options.gameCount, 4, 1, 100000);
    const baseSeed = Number.isFinite(options.seed) ? Math.floor(options.seed) : Date.now();
    const participantAId = this.getDisplayParticipantId(participantA);
    const participantBId = this.getDisplayParticipantId(participantB);
    const participantALabel = this.getDisplayParticipantLabel(participantA, participantAId);
    const participantBLabel = this.getDisplayParticipantLabel(participantB, participantBId);
    const customLabel = typeof options.label === 'string' ? options.label.trim() : '';
    const labelBase = customLabel || `${participantALabel} vs ${participantBLabel}`;
    const label = await this.buildUniqueSimulationLabel(labelBase, {
      forceOrdinal: !customLabel,
    });
    const simulationId = this.nextId('simulation');
    const taskId = `simulation:${simulationId}`;
    const {
      stats,
      participantResultById,
    } = this.createSimulationAccumulator(participantA, participantB);
    const normalizedStats = this.finalizeSimulationAccumulator(stats, participantResultById);
    const simulation = {
      id: simulationId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      label,
      participantAId,
      participantBId,
      participantALabel,
      participantBLabel,
      whiteSnapshotId: participantA.snapshotId || null,
      blackSnapshotId: participantB.snapshotId || null,
      config: {
        gameCount,
        requestedGameCount: gameCount,
        completedGameCount: 0,
        maxPlies: clampPositiveInt(options.maxPlies, 120, 40, 300),
        iterations: clampPositiveInt(options.iterations, 90, 10, 800),
        maxDepth: clampPositiveInt(options.maxDepth, 16, 4, 80),
        hypothesisCount: clampPositiveInt(options.hypothesisCount, 8, 1, 24),
        riskBias: normalizeFloat(options.riskBias, 0.75, 0, 3),
        exploration: normalizeFloat(options.exploration, 1.25, 0, 5),
        adaptiveSearch: options.adaptiveSearch !== false,
        alternateColors: Boolean(options.alternateColors),
        setupMode: 'engine-fast',
        seed: baseSeed,
      },
      stats: normalizedStats,
      games: [],
      gameCount: 0,
      gamesStoredExternally: false,
      status: 'running',
      persistence: {
        taskId,
      },
    };
    const job = {
      type: 'simulation',
      taskId,
      simulationId,
      status: 'running',
      createdAt: simulation.createdAt,
      updatedAt: simulation.updatedAt,
      label,
      participantAId,
      participantBId,
      participantALabel,
      participantBLabel,
      whiteSnapshotId: participantA.snapshotId || null,
      blackSnapshotId: participantB.snapshotId || null,
      options: {
        whiteParticipantId: participantAId,
        blackParticipantId: participantBId,
        whiteSnapshotId: participantA.snapshotId || null,
        blackSnapshotId: participantB.snapshotId || null,
        gameCount,
        maxPlies: simulation.config.maxPlies,
        iterations: simulation.config.iterations,
        maxDepth: simulation.config.maxDepth,
        hypothesisCount: simulation.config.hypothesisCount,
        riskBias: simulation.config.riskBias,
        exploration: simulation.config.exploration,
        adaptiveSearch: simulation.config.adaptiveSearch,
        alternateColors: simulation.config.alternateColors,
        seed: baseSeed,
        label,
      },
      checkpoint: {
        requestedGameCount: gameCount,
        completedGames: 0,
        latestGameId: null,
        lastCheckpointAt: simulation.updatedAt,
        checkpointedAt: simulation.updatedAt,
        stats: deepClone(normalizedStats),
      },
    };

    this.state.activeJobs.simulation = deepClone(job);
    this.upsertSimulationRecord(simulation);
    const mongoPersistence = await this.persistSimulationToMongo(simulation, { pruneMissingGames: true });
    simulation.persistence.mongo = mongoPersistence;
    if (mongoPersistence?.saved) {
      simulation.gamesStoredExternally = true;
      this.upsertSimulationRecord(simulation);
    }
    await this.save();
    this.emitSimulationJobProgress(job, 'start', {
      completedGames: 0,
      progress: 0,
      stats: deepClone(normalizedStats),
    });
    this.resumeSimulationJob(job);
    return {
      taskId,
      simulation: this.summarizeSimulation(simulation),
      live: this.buildSimulationJobPayload(job, 'start'),
    };
  }

  async runSimulationJob(taskState) {
    const job = this.state.activeJobs?.simulation || null;
    if (!job || job.taskId !== taskState?.id) {
      this.simulationTasks.delete(taskState?.id);
      return;
    }

    let simulation = this.getInMemorySimulation(job.simulationId);
    if (!simulation) {
      simulation = await this.getStoredSimulationById(job.simulationId);
      if (!simulation) {
        throw new Error(`Simulation ${job.simulationId} not found for resume`);
      }
      this.upsertSimulationRecord(simulation);
    }

    const participantA = this.resolveParticipant(
      job?.options?.whiteParticipantId || simulation.participantAId,
      job?.options?.whiteSnapshotId || simulation.whiteSnapshotId,
    );
    const participantB = this.resolveParticipant(
      job?.options?.blackParticipantId || simulation.participantBId,
      job?.options?.blackSnapshotId || simulation.blackSnapshotId,
    );
    if (!participantA || !participantB) {
      throw new Error('Could not resolve simulation participants while resuming the batch');
    }

    const requestedGameCount = clampPositiveInt(
      job?.checkpoint?.requestedGameCount || simulation?.config?.requestedGameCount || simulation?.config?.gameCount,
      1,
      1,
      100000,
    );
    const baseSeed = Number.isFinite(simulation?.config?.seed)
      ? Math.floor(simulation.config.seed)
      : Date.now();
    const alternateColors = Boolean(simulation?.config?.alternateColors);
    const games = Array.isArray(simulation.games) ? simulation.games : [];
    const rebuilt = this.rebuildSimulationAccumulator(games, participantA, participantB);
    let stats = rebuilt.stats;
    const participantResultById = rebuilt.participantResultById;
    simulation.stats = deepClone(stats);
    simulation.gameCount = stats.games;
    simulation.config = {
      ...(simulation.config || {}),
      requestedGameCount,
      completedGameCount: stats.games,
    };
    this.upsertSimulationRecord(simulation);

    this.emitSimulationJobProgress(job, stats.games > 0 ? 'game' : 'start', {
      completedGames: stats.games,
      progress: requestedGameCount > 0 ? (stats.games / requestedGameCount) : 0,
      stats: deepClone(stats),
    });

    let cancelled = false;
    let lastCheckpointAt = parseTimeValue(job?.checkpoint?.lastCheckpointAt) || Date.now();

    try {
      for (let gameIndex = stats.games; gameIndex < requestedGameCount; gameIndex += 1) {
        const latestJob = this.state.activeJobs?.simulation || null;
        if (!latestJob || latestJob.taskId !== job.taskId) break;
        if (taskState.cancelRequested || String(latestJob.status || '').toLowerCase() === 'stopping') {
          cancelled = true;
          break;
        }

        const shouldSwap = alternateColors && (gameIndex % 2 === 1);
        const whiteParticipant = shouldSwap ? participantB : participantA;
        const blackParticipant = shouldSwap ? participantA : participantB;
        const game = await this.runSingleGameFast({
          whiteParticipant,
          blackParticipant,
          seed: baseSeed + (gameIndex * 7919),
          maxPlies: simulation.config.maxPlies,
          iterations: simulation.config.iterations,
          maxDepth: simulation.config.maxDepth,
          hypothesisCount: simulation.config.hypothesisCount,
          riskBias: simulation.config.riskBias,
          exploration: simulation.config.exploration,
          adaptiveSearch: simulation?.config?.adaptiveSearch !== false,
        });

        games.push(game);
        this.applyGameToSimulationAccumulator(stats, participantResultById, game, whiteParticipant, blackParticipant);
        stats = this.finalizeSimulationAccumulator(stats, participantResultById);
        simulation.games = games;
        simulation.stats = deepClone(stats);
        simulation.gameCount = stats.games;
        simulation.status = 'running';
        simulation.updatedAt = nowIso();
        simulation.config.completedGameCount = stats.games;
        job.updatedAt = simulation.updatedAt;
        job.checkpoint = {
          ...(job.checkpoint || {}),
          requestedGameCount,
          completedGames: stats.games,
          latestGameId: game.id,
          stats: deepClone(stats),
        };
        this.state.activeJobs.simulation = deepClone(job);
        this.upsertSimulationRecord(simulation.gamesStoredExternally
          ? compactSimulationForState(simulation)
          : simulation);

        this.emitSimulationJobProgress(job, 'game', {
          completedGames: stats.games,
          progress: requestedGameCount > 0 ? (stats.games / requestedGameCount) : 0,
          latestGameId: game.id,
          winner: game.winner,
          winReason: game.winReason,
          stats: deepClone(stats),
        });

        if (this.shouldCheckpointProgress(stats.games, lastCheckpointAt, {
          force: stats.games >= requestedGameCount,
        })) {
          await this.checkpointSimulationJob(job, simulation, {
            gameIds: [game.id],
            latestGameId: game.id,
          });
          lastCheckpointAt = Date.now();
        }

        await new Promise((resolve) => setImmediate(resolve));
      }

      simulation.status = cancelled ? 'stopped' : 'completed';
      simulation.updatedAt = nowIso();
      simulation.config.completedGameCount = stats.games;
      simulation.gameCount = stats.games;
      simulation.stats = deepClone(this.finalizeSimulationAccumulator(stats, participantResultById));
      if (!simulation.persistence?.snapshotStatsApplied) {
        if (participantA.type === 'snapshot' && participantA.snapshot) {
          this.recordSimulationOnSnapshot(participantA.snapshot, simulation.stats, WHITE);
        }
        if (participantB.type === 'snapshot' && participantB.snapshot) {
          this.recordSimulationOnSnapshot(participantB.snapshot, simulation.stats, BLACK);
        }
        simulation.persistence = {
          ...(simulation.persistence || {}),
          snapshotStatsApplied: true,
        };
      }
      await this.checkpointSimulationJob(job, simulation, {
        status: cancelled ? 'stopped' : 'completed',
        jobStatus: cancelled ? 'stopping' : 'completed',
        latestGameId: job?.checkpoint?.latestGameId || null,
        pruneMissingGames: true,
      });
      if (simulation.gamesStoredExternally) {
        this.upsertSimulationRecord(compactSimulationForState(simulation));
      } else {
        this.upsertSimulationRecord(simulation);
      }
      this.state.activeJobs.simulation = null;
      await this.save();
      if (simulation.gamesStoredExternally) {
        await this.trimMongoSimulationHistory();
      }

      const phase = cancelled ? 'cancelled' : 'complete';
      this.emitSimulationJobProgress({
        ...job,
        status: simulation.status,
        checkpoint: {
          ...(job.checkpoint || {}),
          completedGames: simulation.stats.games,
          stats: deepClone(simulation.stats),
        },
      }, phase, {
        completedGames: simulation.stats.games,
        progress: requestedGameCount > 0 ? (simulation.stats.games / requestedGameCount) : 0,
        stats: deepClone(simulation.stats),
        status: simulation.status,
      });
    } catch (err) {
      simulation.status = 'error';
      simulation.updatedAt = nowIso();
      simulation.persistence = {
        ...(simulation.persistence || {}),
        error: err?.message || 'Simulation failed',
      };
      this.upsertSimulationRecord(simulation.gamesStoredExternally
        ? compactSimulationForState(simulation)
        : simulation);
      await this.checkpointSimulationJob(job, simulation, {
        status: 'error',
        jobStatus: 'error',
        pruneMissingGames: false,
      }).catch(() => {});
      this.state.activeJobs.simulation = null;
      await this.save().catch(() => {});
      this.emitSimulationJobProgress(job, 'error', {
        completedGames: simulation?.stats?.games || 0,
        progress: requestedGameCount > 0 ? ((simulation?.stats?.games || 0) / requestedGameCount) : 0,
        stats: deepClone(simulation?.stats || {}),
        message: err.message || 'Simulation failed',
      });
      throw err;
    } finally {
      this.simulationTasks.delete(taskState?.id);
    }
  }

  async simulateMatches(options = {}) {
    await this.ensureLoaded();
    const participantA = this.resolveParticipant(
      options.whiteParticipantId || options.whiteSnapshotId,
      options.whiteSnapshotId || null,
    );
    const participantB = this.resolveParticipant(
      options.blackParticipantId || options.blackSnapshotId,
      options.blackSnapshotId || null,
    );
    if (!participantA || !participantB) {
      throw new Error('At least one snapshot is required to simulate games');
    }

    const gameCount = clampPositiveInt(options.gameCount, 4, 1, 100000);
    const baseSeed = Number.isFinite(options.seed) ? Math.floor(options.seed) : Date.now();
    const alternateColors = Boolean(options.alternateColors);
    const participantAId = this.getDisplayParticipantId(participantA);
    const participantBId = this.getDisplayParticipantId(participantB);
    const participantALabel = this.getDisplayParticipantLabel(participantA, participantAId);
    const participantBLabel = this.getDisplayParticipantLabel(participantB, participantBId);
    const customLabel = typeof options.label === 'string' ? options.label.trim() : '';
    const labelBase = customLabel || `${participantALabel} vs ${participantBLabel}`;
    const label = await this.buildUniqueSimulationLabel(labelBase, {
      forceOrdinal: !customLabel,
    });
    const simulationId = this.nextId('simulation');
    const taskId = `simulation-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const taskState = {
      id: taskId,
      status: 'running',
      cancelRequested: false,
      createdAt: nowIso(),
    };
    this.simulationTasks.set(taskId, taskState);
    const emitSimulationProgress = (phase, payload = {}) => {
      eventBus.emit('ml:simulationProgress', {
        phase,
        taskId,
        simulationId,
        timestamp: nowIso(),
        label,
        gameCount,
        participantAId,
        participantBId,
        participantALabel,
        participantBLabel,
        alternateColors,
        ...payload,
      });
    };

    const games = [];
    const participantResultById = {};
    [participantA, participantB].forEach((participant) => {
      const id = this.getDisplayParticipantId(participant);
      participantResultById[id] = {
        participantId: id,
        participantType: participant.type || 'snapshot',
        snapshotId: participant.snapshotId || null,
        label: this.getDisplayParticipantLabel(participant, id),
        games: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        asWhite: 0,
        asBlack: 0,
        whiteWins: 0,
        blackWins: 0,
      };
    });

    const stats = {
      games: 0,
      whiteWins: 0,
      blackWins: 0,
      draws: 0,
      averagePlies: 0,
      winReasons: {},
      participantResults: [],
    };

    emitSimulationProgress('start', {
      completedGames: 0,
      progress: 0,
      stats: {
        games: 0,
        whiteWins: 0,
        blackWins: 0,
        draws: 0,
        averagePlies: 0,
      },
    });

    try {
      let cancelled = false;
      for (let i = 0; i < gameCount; i += 1) {
        if (taskState.cancelRequested) {
          cancelled = true;
          break;
        }
        const shouldSwap = alternateColors && (i % 2 === 1);
        const whiteParticipant = shouldSwap ? participantB : participantA;
        const blackParticipant = shouldSwap ? participantA : participantB;
        const game = await this.runSingleGameFast({
          whiteParticipant,
          blackParticipant,
          seed: baseSeed + (i * 7919),
          maxPlies: options.maxPlies,
          iterations: options.iterations,
          maxDepth: options.maxDepth,
          hypothesisCount: options.hypothesisCount,
          riskBias: options.riskBias,
          exploration: options.exploration,
          adaptiveSearch: options.adaptiveSearch !== false,
        });
        games.push(game);
        stats.games += 1;
        stats.averagePlies += game.plies;
        if (game.winner === WHITE) stats.whiteWins += 1;
        else if (game.winner === BLACK) stats.blackWins += 1;
        else stats.draws += 1;
        const reasonKey = String(game.winReason ?? 'unknown');
        stats.winReasons[reasonKey] = (stats.winReasons[reasonKey] || 0) + 1;

        const whiteId = game.whiteParticipantId || this.getDisplayParticipantId(whiteParticipant);
        const blackId = game.blackParticipantId || this.getDisplayParticipantId(blackParticipant);
        const whiteStats = participantResultById[whiteId];
        const blackStats = participantResultById[blackId];
        if (whiteStats) {
          whiteStats.games += 1;
          whiteStats.asWhite += 1;
        }
        if (blackStats) {
          blackStats.games += 1;
          blackStats.asBlack += 1;
        }
        if (game.winner === WHITE) {
          if (whiteStats) {
            whiteStats.wins += 1;
            whiteStats.whiteWins += 1;
          }
          if (blackStats) {
            blackStats.losses += 1;
          }
        } else if (game.winner === BLACK) {
          if (blackStats) {
            blackStats.wins += 1;
            blackStats.blackWins += 1;
          }
          if (whiteStats) {
            whiteStats.losses += 1;
          }
        } else {
          if (whiteStats) whiteStats.draws += 1;
          if (blackStats) blackStats.draws += 1;
        }

        emitSimulationProgress('game', {
          completedGames: i + 1,
          progress: (i + 1) / gameCount,
          latestGameId: game.id,
          winner: game.winner,
          winReason: game.winReason,
          stats: {
            games: stats.games,
            whiteWins: stats.whiteWins,
            blackWins: stats.blackWins,
            draws: stats.draws,
            averagePlies: stats.games > 0 ? (stats.averagePlies / stats.games) : 0,
          },
        });

        await new Promise((resolve) => setImmediate(resolve));
      }

      stats.averagePlies = stats.games > 0 ? (stats.averagePlies / stats.games) : 0;
      stats.participantResults = Object.values(participantResultById).map((entry) => (
        normalizeParticipantStatsEntry(entry, entry.games)
      ));

      const simulation = {
        id: simulationId,
        createdAt: nowIso(),
        label,
        participantAId,
        participantBId,
        participantALabel,
        participantBLabel,
        whiteSnapshotId: participantA.snapshotId || null,
        blackSnapshotId: participantB.snapshotId || null,
        config: {
          gameCount,
          requestedGameCount: gameCount,
          completedGameCount: stats.games,
          maxPlies: clampPositiveInt(options.maxPlies, 120, 40, 300),
          iterations: clampPositiveInt(options.iterations, 90, 10, 800),
          maxDepth: clampPositiveInt(options.maxDepth, 16, 4, 80),
          hypothesisCount: clampPositiveInt(options.hypothesisCount, 8, 1, 24),
          riskBias: normalizeFloat(options.riskBias, 0.75, 0, 3),
          exploration: normalizeFloat(options.exploration, 1.25, 0, 5),
          adaptiveSearch: options.adaptiveSearch !== false,
          alternateColors,
          setupMode: 'engine-fast',
          seed: baseSeed,
        },
        stats,
        games,
        gameCount: stats.games,
        gamesStoredExternally: false,
        status: cancelled ? 'stopped' : 'completed',
      };

      const mongoPersistence = await this.persistSimulationToMongo(simulation);
      simulation.persistence = {
        ...(simulation.persistence || {}),
        mongo: mongoPersistence,
      };
      simulation.gamesStoredExternally = Boolean(mongoPersistence?.saved);
      if (mongoPersistence?.saved) {
        await this.trimMongoSimulationHistory();
      }

      const simulationForState = simulation.gamesStoredExternally
        ? {
            ...simulation,
            games: games.map((game) => summarizeGameForStorage(game)).filter(Boolean),
          }
        : simulation;

      this.state.simulations.unshift(simulationForState);
      if (this.state.simulations.length > this.maxSimulationHistory) {
        this.state.simulations.length = this.maxSimulationHistory;
      }

      if (participantA.type === 'snapshot' && participantA.snapshot) {
        this.recordSimulationOnSnapshot(participantA.snapshot, stats, WHITE);
      }
      if (participantB.type === 'snapshot' && participantB.snapshot) {
        this.recordSimulationOnSnapshot(participantB.snapshot, stats, BLACK);
      }

      await this.save();

      if (cancelled) {
        emitSimulationProgress('cancelled', {
          completedGames: stats.games,
          progress: gameCount > 0 ? (stats.games / gameCount) : 0,
          stats: deepClone(stats),
        });
      } else {
        emitSimulationProgress('complete', {
          completedGames: gameCount,
          progress: 1,
          stats: deepClone(stats),
        });
      }

      return {
        simulation: this.summarizeSimulation(simulation),
        stats,
        participantResults: stats.participantResults,
        gameIds: games.map((game) => game.id),
        cancelled,
        requestedGameCount: gameCount,
        persistence: deepClone(simulation.persistence || null),
      };
    } catch (err) {
      emitSimulationProgress('error', {
        completedGames: stats.games,
        progress: gameCount > 0 ? (stats.games / gameCount) : 0,
        message: err.message || 'Simulation failed',
      });
      throw err;
    } finally {
      taskState.status = taskState.cancelRequested ? 'stopped' : 'complete';
      this.simulationTasks.delete(taskId);
    }
  }

  async listSimulations(options = {}) {
    await this.ensureLoaded();
    const simulations = await this.listStoredSimulations({ limit: options.limit });
    return simulations
      .map((simulation) => this.summarizeSimulation(simulation));
  }

  async renameSimulation(simulationId, nextLabel) {
    await this.ensureLoaded();
    const id = typeof simulationId === 'string' ? simulationId.trim() : '';
    const label = typeof nextLabel === 'string' ? nextLabel.trim() : '';
    if (!id) {
      const err = new Error('Simulation id is required');
      err.statusCode = 400;
      err.code = 'INVALID_SIMULATION_ID';
      throw err;
    }
    if (!label) {
      const err = new Error('Simulation label is required');
      err.statusCode = 400;
      err.code = 'INVALID_SIMULATION_LABEL';
      throw err;
    }

    let renamed = null;
    const memorySimulation = this.getInMemorySimulation(id);
    if (memorySimulation) {
      memorySimulation.label = label;
      memorySimulation.updatedAt = nowIso();
      renamed = memorySimulation;
    }

    if (this.isMongoSimulationPersistenceAvailable()) {
      await this.maybeMigrateStateSimulationsToMongo();
      const updatedAt = nowIso();
      const result = await SimulationModel.updateOne(
        { id },
        { $set: { label, updatedAt } },
      );
      const matched = Number(result?.matchedCount || 0);
      if (matched > 0) {
        if (!renamed) {
          const doc = await SimulationModel.findOne({ id }, { _id: 0, __v: 0 }).lean();
          renamed = doc ? this.normalizeStoredSimulationRecord(doc) : renamed;
        } else {
          renamed.updatedAt = updatedAt;
        }
      }
    }

    if (renamed && memorySimulation) {
      await this.save();
    }

    return renamed ? this.summarizeSimulation(renamed) : null;
  }

  async deleteSimulation(simulationId) {
    await this.ensureLoaded();
    const id = typeof simulationId === 'string' ? simulationId.trim() : '';
    if (!id) return { deleted: false };

    const mongoAvailable = this.isMongoSimulationPersistenceAvailable();
    let mongoSimulationDeleted = 0;
    let mongoGameDeleted = 0;
    let deleted = false;

    if (mongoAvailable) {
      await this.maybeMigrateStateSimulationsToMongo();
      const simulationDelete = await SimulationModel.deleteOne({ id });
      const gameDelete = await SimulationGameModel.deleteMany({ simulationId: id });
      mongoSimulationDeleted = Number(simulationDelete?.deletedCount || 0);
      mongoGameDeleted = Number(gameDelete?.deletedCount || 0);
      if ((mongoSimulationDeleted + mongoGameDeleted) > 0) {
        deleted = true;
      }
    }

    const before = Array.isArray(this.state.simulations) ? this.state.simulations.length : 0;
    this.state.simulations = (this.state.simulations || []).filter((simulation) => simulation.id !== id);
    const removedFromMemory = (this.state.simulations || []).length < before;
    if (removedFromMemory) {
      deleted = true;
    }

    if (removedFromMemory) {
      await this.save();
    }

    return {
      deleted,
      id,
      removedFromMemory,
      mongoSimulationDeleted,
      mongoGameDeleted,
    };
  }

  async stopSimulationTask(taskId) {
    await this.ensureLoaded();
    const id = typeof taskId === 'string' ? taskId.trim() : '';
    if (!id) {
      return { stopped: false, reason: 'missing_task_id' };
    }
    const activeJob = this.state.activeJobs?.simulation || null;
    if (!activeJob || activeJob.taskId !== id) {
      const legacyTask = this.simulationTasks.get(id);
      if (!legacyTask || legacyTask.status !== 'running') {
        return { stopped: false, reason: 'not_running', taskId: id };
      }
      legacyTask.cancelRequested = true;
      legacyTask.cancelRequestedAt = nowIso();
      return { stopped: true, taskId: id };
    }
    const task = this.simulationTasks.get(id);
    if (task) {
      task.cancelRequested = true;
      task.cancelRequestedAt = nowIso();
    }
    activeJob.status = 'stopping';
    activeJob.updatedAt = nowIso();
    this.state.activeJobs.simulation = deepClone(activeJob);
    const simulation = this.getInMemorySimulation(activeJob.simulationId);
    if (simulation) {
      simulation.status = 'stopping';
      simulation.updatedAt = activeJob.updatedAt;
      simulation.persistence = {
        ...(simulation.persistence || {}),
        stopRequestedAt: activeJob.updatedAt,
      };
      this.upsertSimulationRecord(simulation);
      await this.checkpointSimulationJob(activeJob, simulation, {
        status: 'stopping',
        jobStatus: 'stopping',
        pruneMissingGames: false,
      }).catch(() => {});
    } else {
      await this.save();
    }
    return { stopped: true, taskId: id };
  }

  async getSimulation(simulationId) {
    await this.ensureLoaded();
    const simulation = await this.getStoredSimulationById(simulationId);
    if (!simulation) return null;

    let games = Array.isArray(simulation.games) ? simulation.games : [];
    if (simulation.gamesStoredExternally && this.isMongoSimulationPersistenceAvailable()) {
      const gameDocs = await SimulationGameModel.find(
        { simulationId: simulation.id },
        {
          _id: 0,
          __v: 0,
          replay: 0,
          decisions: 0,
          actionHistory: 0,
          moveHistory: 0,
          training: 0,
          result: 0,
        },
      )
        .sort({ createdAt: 1 })
        .lean();
      if (Array.isArray(gameDocs) && gameDocs.length) {
        games = gameDocs
          .map((gameDoc) => this.normalizeStoredSimulationRecord(gameDoc))
          .filter(Boolean);
      }
    }

    return {
      ...this.summarizeSimulation(simulation),
      games: games.map((game) => ({
        id: game.id,
        createdAt: game.createdAt,
        seed: game.seed,
        setupMode: game.setupMode || 'random',
        whiteParticipantId: game.whiteParticipantId || null,
        blackParticipantId: game.blackParticipantId || null,
        whiteParticipantLabel: game.whiteParticipantLabel || null,
        blackParticipantLabel: game.blackParticipantLabel || null,
        winner: game.winner,
        winReason: game.winReason,
        plies: game.plies,
        decisionCount: Number.isFinite(game.decisionCount)
          ? game.decisionCount
          : (Array.isArray(game.decisions) ? game.decisions.length : 0),
    })),
  };
  }

  async getReplay(simulationId, gameId) {
    await this.ensureLoaded();
    const simulation = await this.getStoredSimulationById(simulationId);
    if (!simulation) return null;
    const simulationGames = Array.isArray(simulation.games) ? simulation.games : [];
    let game = simulationGames.find((item) => item.id === gameId);
    const hasDetailedReplay = game && (
      Array.isArray(game.replay)
      || Array.isArray(game.decisions)
      || Array.isArray(game.actionHistory)
      || Array.isArray(game.moveHistory)
    );

    if ((!game || !hasDetailedReplay) && simulation.gamesStoredExternally && this.isMongoSimulationPersistenceAvailable()) {
      const doc = await SimulationGameModel.findOne(
        { simulationId: simulation.id, id: gameId },
        { _id: 0, __v: 0 },
      ).lean();
      if (doc) {
        game = this.normalizeStoredSimulationRecord(doc);
      }
    }

    if (!game) return null;
    if (!Array.isArray(game.replay)) return null;

    return deepClone({
      simulation: this.summarizeSimulation(simulation),
      game: {
        id: game.id,
        createdAt: game.createdAt,
        seed: game.seed,
        setupMode: game.setupMode || 'random',
        whiteParticipantId: game.whiteParticipantId || null,
        blackParticipantId: game.blackParticipantId || null,
        whiteParticipantLabel: game.whiteParticipantLabel || null,
        blackParticipantLabel: game.blackParticipantLabel || null,
        winner: game.winner,
        winReason: game.winReason,
        plies: game.plies,
        actionHistory: game.actionHistory || [],
        moveHistory: game.moveHistory || [],
        replay: game.replay || [],
        decisions: game.decisions || [],
      },
    });
  }

  async collectTrainingSamples(snapshotId, simulationIds = null) {
    await this.ensureLoaded();
    const simulations = await this.listStoredSimulationsForTraining(simulationIds);
    const policySamples = [];
    const valueSamples = [];
    const identitySamples = [];
    let sourceGames = 0;
    let sourceSimulations = 0;

    simulations.forEach((simulation) => {
      sourceSimulations += 1;
      (simulation.games || []).forEach((game) => {
        sourceGames += 1;
        (game.training?.policySamples || []).forEach((sample) => {
          if (!snapshotId || sample.snapshotId === snapshotId) {
            policySamples.push(deepClone(sample));
          }
        });
        (game.training?.valueSamples || []).forEach((sample) => {
          if (!snapshotId || sample.snapshotId === snapshotId) {
            valueSamples.push(deepClone(sample));
          }
        });
        (game.training?.identitySamples || []).forEach((sample) => {
          if (!snapshotId || sample.snapshotId === snapshotId) {
            identitySamples.push(deepClone(sample));
          }
        });
      });
    });

    return {
      sourceSimulations,
      sourceGames,
      policySamples,
      valueSamples,
      identitySamples,
    };
  }

  buildTrainingJobPayload(job, phase = null, overrides = {}) {
    const trainingRun = job?.trainingRunId ? this.getInMemoryTrainingRun(job.trainingRunId) : null;
    const history = Array.isArray(overrides.history)
      ? overrides.history
      : (Array.isArray(trainingRun?.history) ? trainingRun.history : []);
    const completedEpochs = Number(
      overrides.epoch
      ?? overrides.completedEpochs
      ?? job?.checkpoint?.completedEpochs
      ?? history.length
      ?? 0
    );
    const totalEpochs = Number(job?.epochs || trainingRun?.epochs || 0);
    const inferredPhase = phase || (completedEpochs > 0 ? 'epoch' : 'start');
    const latestLoss = overrides.loss
      || trainingRun?.finalLoss
      || (history.length ? history[history.length - 1] : null)
      || null;
    return {
      phase: inferredPhase,
      taskId: job?.taskId || '',
      trainingRunId: job?.trainingRunId || trainingRun?.id || '',
      timestamp: nowIso(),
      baseSnapshotId: job?.baseSnapshotId || trainingRun?.baseSnapshotId || null,
      newSnapshotId: trainingRun?.newSnapshotId || null,
      epochs: totalEpochs,
      totalEpochs,
      epoch: completedEpochs,
      batchSize: Number(job?.batchSize || trainingRun?.batchSize || 0),
      learningRate: Number(job?.learningRate || trainingRun?.learningRate || 0),
      trainingBackend: job?.trainingBackend || trainingRun?.trainingBackend || TRAINING_BACKENDS.NODE,
      trainingDevicePreference: job?.trainingDevicePreference
        || trainingRun?.trainingDevicePreference
        || TRAINING_DEVICE_PREFERENCES.AUTO,
      sourceSimulationIds: Array.isArray(job?.sourceSimulationIds)
        ? job.sourceSimulationIds.slice()
        : (Array.isArray(trainingRun?.sourceSimulationIds) ? trainingRun.sourceSimulationIds.slice() : []),
      sourceGames: Number(job?.sourceGames || trainingRun?.sourceGames || 0),
      sourceSimulations: Number(job?.sourceSimulations || trainingRun?.sourceSimulations || 0),
      sampleCounts: deepClone(job?.sampleCounts || trainingRun?.sampleCounts || {}),
      loss: latestLoss ? deepClone(latestLoss) : null,
      history: deepClone(history),
      status: trainingRun?.status || job?.status || 'running',
      ...overrides,
    };
  }

  emitTrainingJobProgress(job, phase, overrides = {}) {
    const payload = this.buildTrainingJobPayload(job, phase, overrides);
    this.rememberLiveStatus('training', payload);
    eventBus.emit('ml:trainingProgress', payload);
    this.logTrainingEvent(payload.trainingRunId || job?.trainingRunId, 'training_progress', {
      phase: payload.phase,
      status: payload.status,
      epoch: payload.epoch,
      totalEpochs: payload.totalEpochs,
      baseSnapshotId: payload.baseSnapshotId,
      newSnapshotId: payload.newSnapshotId || null,
      trainingBackend: payload.trainingBackend,
      trainingDevicePreference: payload.trainingDevicePreference,
      loss: payload.loss || null,
    });
    return payload;
  }

  async checkpointTrainingJob(job, trainingRun, options = {}) {
    if (!job || !trainingRun) return;
    const checkpointedAt = nowIso();
    trainingRun.updatedAt = checkpointedAt;
    trainingRun.status = options.status || trainingRun.status || 'running';
    trainingRun.finalLoss = trainingRun.finalLoss || (
      Array.isArray(trainingRun.history) && trainingRun.history.length
        ? trainingRun.history[trainingRun.history.length - 1]
        : null
    );
    trainingRun.checkpoint = {
      taskId: job.taskId,
      completedEpochs: Number(job?.checkpoint?.completedEpochs || trainingRun.history?.length || 0),
      totalEpochs: Number(job?.epochs || trainingRun.epochs || 0),
      checkpointedAt,
    };

    job.updatedAt = checkpointedAt;
    job.status = options.jobStatus || trainingRun.status || 'running';
    job.checkpoint = {
      ...(job.checkpoint || {}),
      completedEpochs: Number(job?.checkpoint?.completedEpochs || trainingRun.history?.length || 0),
      totalEpochs: Number(job?.epochs || trainingRun.epochs || 0),
      checkpointedAt,
      lastLoss: trainingRun.finalLoss ? deepClone(trainingRun.finalLoss) : null,
    };

    this.state.activeJobs.training = deepClone(job);
    this.upsertTrainingRunRecord(trainingRun);

    const mongoPersistence = await this.persistTrainingRunToMongo({
      ...trainingRun,
      checkpoint: {
        ...deepClone(trainingRun.checkpoint || {}),
        modelBundle: deepClone(job?.checkpoint?.modelBundle || null),
        optimizerState: deepClone(job?.checkpoint?.optimizerState || null),
      },
    }, {
      includeCheckpointArtifacts: options.includeCheckpointArtifacts === true,
    });
    trainingRun.persistence = {
      ...(trainingRun.persistence || {}),
      mongo: mongoPersistence,
    };
    await this.save();
  }

  resumeTrainingJob(jobRecord) {
    const job = jobRecord || this.state.activeJobs?.training;
    if (!job?.taskId || !job?.trainingRunId) return;
    if (this.trainingTasks.has(job.taskId)) return;
    const taskState = {
      id: job.taskId,
      status: 'running',
    };
    this.trainingTasks.set(job.taskId, taskState);
    this.runTrainingJob(taskState).catch((err) => {
      console.error('[ml-runtime] training background job failed', err);
    });
  }

  async startTrainingJob(options = {}) {
    await this.ensureLoaded();
    const activeJob = this.state.activeJobs?.training || null;
    if (activeJob && String(activeJob.status || '').toLowerCase() === 'running') {
      const err = new Error('A training run is already active');
      err.statusCode = 409;
      err.code = 'TRAINING_ALREADY_RUNNING';
      throw err;
    }

    const baseSnapshot = this.resolveSnapshot(options.snapshotId);
    if (!baseSnapshot) {
      const err = new Error('Snapshot not found for training');
      err.code = 'SNAPSHOT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const epochs = clampPositiveInt(options.epochs, 2, 1, 50);
    const learningRate = normalizeFloat(options.learningRate, 0.01, 0.0001, 0.5);
    const trainingBackend = normalizeTrainingBackend(options.trainingBackend, TRAINING_BACKENDS.AUTO);
    const trainingDevicePreference = normalizeTrainingDevicePreference(
      options.trainingDevicePreference,
      TRAINING_DEVICE_PREFERENCES.AUTO,
    );
    const simulationIds = Array.isArray(options.simulationIds)
      ? options.simulationIds.filter(Boolean)
      : null;
    const samples = await this.collectTrainingSamples(baseSnapshot.id, simulationIds);
    if (!samples.policySamples.length && !samples.valueSamples.length && !samples.identitySamples.length) {
      const err = new Error(
        'No training samples found for the selected snapshot/simulations. '
        + 'Select runs where that snapshot actually played (not builtin-vs-builtin only).',
      );
      err.code = 'NO_TRAINING_SAMPLES';
      err.statusCode = 400;
      err.details = {
        snapshotId: baseSnapshot.id,
        simulationIds: simulationIds || [],
        sourceSimulations: samples.sourceSimulations,
        sourceGames: samples.sourceGames,
      };
      throw err;
    }

    const sampleCounts = {
      policy: samples.policySamples.length,
      value: samples.valueSamples.length,
      identity: samples.identitySamples.length,
    };
    const batchSize = await this.resolveTrainingBatchSize({
      batchSize: options.batchSize,
      trainingBackend,
      trainingDevicePreference,
      samples,
      modelBundle: baseSnapshot.modelBundle,
    });
    const trainingRunId = this.nextId('training');
    const taskId = `training:${trainingRunId}`;
    const checkpointBundle = cloneModelBundle(baseSnapshot.modelBundle);
    const checkpointOptimizer = trainingBackend === TRAINING_BACKENDS.NODE
      ? createOptimizerState(checkpointBundle)
      : null;
    const createdAt = nowIso();
    const trainingRunLabel = await this.buildUniqueTrainingLabel(baseSnapshot.label);
    const trainingRun = {
      id: trainingRunId,
      createdAt,
      updatedAt: createdAt,
      status: 'running',
      label: trainingRunLabel,
      notes: options.notes || '',
      baseSnapshotId: baseSnapshot.id,
      newSnapshotId: null,
      epochs,
      batchSize,
      learningRate,
      trainingBackend,
      trainingDevicePreference,
      sourceSimulationIds: simulationIds || [],
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
      sampleCounts,
      history: [],
      finalLoss: null,
      checkpoint: {
        taskId,
        completedEpochs: 0,
        totalEpochs: epochs,
        checkpointedAt: createdAt,
      },
    };
    const job = {
      type: 'training',
      taskId,
      trainingRunId,
      status: 'running',
      createdAt,
      updatedAt: createdAt,
      baseSnapshotId: baseSnapshot.id,
      epochs,
      batchSize,
      learningRate,
      trainingBackend,
      trainingDevicePreference,
      sourceSimulationIds: simulationIds || [],
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
      sampleCounts,
      label: trainingRun.label,
      notes: trainingRun.notes,
      checkpoint: {
        completedEpochs: 0,
        totalEpochs: epochs,
        checkpointedAt: createdAt,
        modelBundle: checkpointBundle,
        optimizerState: checkpointOptimizer,
      },
    };

    this.logTrainingEvent(trainingRunId, 'training_job_started', {
      taskId,
      baseSnapshotId: baseSnapshot.id,
      epochs,
      learningRate,
      batchSize,
      trainingBackend,
      trainingDevicePreference,
      sampleCounts,
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
    });
    this.state.activeJobs.training = deepClone(job);
    this.upsertTrainingRunRecord(trainingRun);
    await this.persistTrainingRunToMongo({
      ...trainingRun,
      checkpoint: {
        ...deepClone(trainingRun.checkpoint || {}),
        modelBundle: checkpointBundle,
        optimizerState: checkpointOptimizer,
      },
    }, {
      includeCheckpointArtifacts: true,
    });
    await this.save();
    this.emitTrainingJobProgress(job, 'start', {
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
      history: [],
    });
    this.resumeTrainingJob(job);
    return {
      taskId,
      trainingRun: this.summarizeTrainingRun(trainingRun),
      live: this.buildTrainingJobPayload(job, 'start'),
    };
  }

  async runTrainingJob(taskState) {
    const job = this.state.activeJobs?.training || null;
    if (!job || job.taskId !== taskState?.id) {
      this.trainingTasks.delete(taskState?.id);
      return;
    }

    const trainingRun = this.getInMemoryTrainingRun(job.trainingRunId);
    if (!trainingRun) {
      throw new Error(`Training run ${job.trainingRunId} not found for resume`);
    }

    const baseSnapshot = this.getSnapshotById(job.baseSnapshotId);
    if (!baseSnapshot) {
      throw new Error(`Base snapshot ${job.baseSnapshotId} is missing`);
    }

    const samples = await this.collectTrainingSamples(baseSnapshot.id, job.sourceSimulationIds || null);
    if (!samples.policySamples.length && !samples.valueSamples.length && !samples.identitySamples.length) {
      throw new Error('Training samples disappeared before the run could resume');
    }

    let trainedBundle = job?.checkpoint?.modelBundle
      ? cloneModelBundle(job.checkpoint.modelBundle)
      : cloneModelBundle(baseSnapshot.modelBundle);
    let optimizerState = job?.checkpoint?.optimizerState
      ? deepClone(job.checkpoint.optimizerState)
      : (job.trainingBackend === TRAINING_BACKENDS.NODE ? createOptimizerState(trainedBundle) : null);
    let completedEpochs = Number(job?.checkpoint?.completedEpochs || trainingRun.history.length || 0);
    const batchSize = Number.isFinite(Number(job?.batchSize)) && Number(job.batchSize) > 0
      ? clampPositiveInt(job.batchSize, 256, 1, 4096)
      : await this.resolveTrainingBatchSize({
        batchSize: null,
        trainingBackend: job.trainingBackend,
        trainingDevicePreference: job.trainingDevicePreference,
        samples,
        modelBundle: trainedBundle,
      });
    job.batchSize = batchSize;
    trainingRun.batchSize = batchSize;

    this.emitTrainingJobProgress(job, completedEpochs > 0 ? 'epoch' : 'start', {
      epoch: completedEpochs,
      totalEpochs: job.epochs,
      history: deepClone(trainingRun.history || []),
      loss: trainingRun.finalLoss || null,
    });

    try {
      for (let epoch = completedEpochs; epoch < job.epochs; epoch += 1) {
        const trainingResult = await this.trainModelBundleBatch({
          modelBundle: trainedBundle,
          optimizerState,
          samples,
          learningRate: job.learningRate,
          batchSize,
          weightDecay: 0.0001,
          gradientClipNorm: 5,
          epochs: 1,
          trainingBackend: job.trainingBackend,
          trainingDevicePreference: job.trainingDevicePreference,
          parallelTrainingHeadWorkers: 1,
          debugContext: {
            trainingRunId: trainingRun.id,
            taskId: job.taskId,
            baseSnapshotId: job.baseSnapshotId,
            epoch: epoch + 1,
            source: 'background_training_job',
          },
        });
        trainedBundle = trainingResult.modelBundle;
        optimizerState = trainingResult.optimizerState || optimizerState;
        const latestMetrics = Array.isArray(trainingResult.history) && trainingResult.history.length
          ? trainingResult.history[trainingResult.history.length - 1]
          : {};

        const epochLoss = {
          epoch: epoch + 1,
          policyLoss: Number(latestMetrics.policyLoss || 0),
          valueLoss: Number(latestMetrics.valueLoss || 0),
          identityLoss: Number(latestMetrics.identityLoss || 0),
          identityAccuracy: Number(latestMetrics.identityAccuracy || 0),
          policySamples: Number(latestMetrics.policySamples || 0),
          valueSamples: Number(latestMetrics.valueSamples || 0),
          identitySamples: Number(latestMetrics.identitySamples || 0),
          trainingBackend: trainingResult.backend || TRAINING_BACKENDS.NODE,
          trainingDevice: trainingResult.device || TRAINING_DEVICE_PREFERENCES.CPU,
        };
        trainingRun.history.push(epochLoss);
        trainingRun.finalLoss = epochLoss;
        trainingRun.updatedAt = nowIso();
        trainingRun.status = 'running';
        completedEpochs = epoch + 1;
        job.updatedAt = trainingRun.updatedAt;
        job.checkpoint = {
          ...(job.checkpoint || {}),
          completedEpochs,
          totalEpochs: job.epochs,
          checkpointedAt: trainingRun.updatedAt,
          modelBundle: cloneModelBundle(trainedBundle),
          optimizerState: deepClone(optimizerState),
        };

        await this.checkpointTrainingJob(job, trainingRun, {
          includeCheckpointArtifacts: true,
        });
        this.emitTrainingJobProgress(job, 'epoch', {
          epoch: completedEpochs,
          totalEpochs: job.epochs,
          history: deepClone(trainingRun.history),
          loss: epochLoss,
        });
        await new Promise((resolve) => setImmediate(resolve));
      }

      const latestLoss = trainingRun.finalLoss || (trainingRun.history.length
        ? trainingRun.history[trainingRun.history.length - 1]
        : null);
      const lossRecord = {
        timestamp: nowIso(),
        learningRate: job.learningRate,
        epochs: job.epochs,
        sourceSimulations: trainingRun.sourceSimulations,
        sourceGames: trainingRun.sourceGames,
        history: trainingRun.history.map((entry) => ({ ...entry })),
        ...(latestLoss || {}),
      };

      const newSnapshot = this.createSnapshotRecord({
        label: trainingRun.label,
        generation: (baseSnapshot.generation || 0) + 1,
        parentSnapshotId: baseSnapshot.id,
        modelBundle: trainedBundle,
        notes: trainingRun.notes || `Trained from ${trainingRun.sourceGames} game(s)`,
        stats: {
          ...baseSnapshot.stats,
          trainingRuns: (baseSnapshot.stats?.trainingRuns || 0) + 1,
        },
        losses: [
          ...(baseSnapshot.losses || []),
          lossRecord,
        ],
      });
      this.state.snapshots.unshift(newSnapshot);
      baseSnapshot.stats = baseSnapshot.stats || {};
      baseSnapshot.stats.trainingRuns = (baseSnapshot.stats.trainingRuns || 0) + 1;
      baseSnapshot.updatedAt = nowIso();

      trainingRun.newSnapshotId = newSnapshot.id;
      trainingRun.status = 'completed';
      trainingRun.updatedAt = nowIso();
      trainingRun.finalLoss = latestLoss;
      trainingRun.checkpoint = {
        taskId: job.taskId,
        completedEpochs: completedEpochs,
        totalEpochs: job.epochs,
        checkpointedAt: trainingRun.updatedAt,
      };
      this.upsertTrainingRunRecord(trainingRun);
      await this.persistTrainingRunToMongo(trainingRun, {
        includeCheckpointArtifacts: false,
      });
      this.state.activeJobs.training = null;
      await this.save();

      this.emitTrainingJobProgress(job, 'complete', {
        epoch: completedEpochs,
        totalEpochs: job.epochs,
        trainingRunId: trainingRun.id,
        newSnapshotId: newSnapshot.id,
        history: deepClone(trainingRun.history),
        loss: latestLoss,
      });
      this.logTrainingEvent(trainingRun.id, 'training_job_completed', {
        taskId: job.taskId,
        baseSnapshotId: baseSnapshot.id,
        newSnapshotId: newSnapshot.id,
        epochs: completedEpochs,
        finalLoss: latestLoss || null,
      });
    } catch (err) {
      trainingRun.status = 'error';
      trainingRun.updatedAt = nowIso();
      await this.checkpointTrainingJob(job, trainingRun, {
        includeCheckpointArtifacts: true,
        status: 'error',
        jobStatus: 'error',
      }).catch(() => {});
      this.state.activeJobs.training = null;
      await this.save().catch(() => {});
      this.emitTrainingJobProgress(job, 'error', {
        epoch: completedEpochs,
        totalEpochs: job.epochs,
        history: deepClone(trainingRun.history || []),
        loss: trainingRun.finalLoss || null,
        message: err.message || 'Training failed',
      });
      this.logTrainingEvent(trainingRun.id, 'training_job_error', {
        taskId: job.taskId,
        baseSnapshotId: baseSnapshot.id,
        epochsCompleted: completedEpochs,
        finalLoss: trainingRun.finalLoss || null,
        error: summarizeError(err),
      });
      throw err;
    } finally {
      this.trainingTasks.delete(taskState?.id);
    }
  }

  async trainSnapshot(options = {}) {
    await this.ensureLoaded();
    const baseSnapshot = this.resolveSnapshot(options.snapshotId);
    if (!baseSnapshot) {
      const err = new Error('Snapshot not found for training');
      err.code = 'SNAPSHOT_NOT_FOUND';
      err.statusCode = 404;
      throw err;
    }
    const epochs = clampPositiveInt(options.epochs, 2, 1, 50);
    const learningRate = normalizeFloat(options.learningRate, 0.01, 0.0001, 0.5);
    const trainingBackend = normalizeTrainingBackend(options.trainingBackend, TRAINING_BACKENDS.AUTO);
    const trainingDevicePreference = normalizeTrainingDevicePreference(
      options.trainingDevicePreference,
      TRAINING_DEVICE_PREFERENCES.AUTO,
    );
    const simulationIds = Array.isArray(options.simulationIds)
      ? options.simulationIds.filter(Boolean)
      : null;

    const samples = await this.collectTrainingSamples(baseSnapshot.id, simulationIds);
    if (!samples.policySamples.length && !samples.valueSamples.length && !samples.identitySamples.length) {
      const err = new Error(
        'No training samples found for the selected snapshot/simulations. '
        + 'Select runs where that snapshot actually played (not builtin-vs-builtin only).',
      );
      err.code = 'NO_TRAINING_SAMPLES';
      err.statusCode = 400;
      err.details = {
        snapshotId: baseSnapshot.id,
        simulationIds: simulationIds || [],
        sourceSimulations: samples.sourceSimulations,
        sourceGames: samples.sourceGames,
      };
      throw err;
    }
    const sampleCounts = {
      policy: samples.policySamples.length,
      value: samples.valueSamples.length,
      identity: samples.identitySamples.length,
    };
    const batchSize = await this.resolveTrainingBatchSize({
      batchSize: options.batchSize,
      trainingBackend,
      trainingDevicePreference,
      samples,
      modelBundle: baseSnapshot.modelBundle,
    });
    const taskId = `training-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
    const trainingRunLabel = await this.buildUniqueTrainingLabel(baseSnapshot.label);
    const emitTrainingProgress = (phase, payload = {}) => {
      eventBus.emit('ml:trainingProgress', {
        phase,
        taskId,
        timestamp: nowIso(),
        baseSnapshotId: baseSnapshot.id,
        epochs,
        batchSize,
        learningRate,
        sourceSimulationIds: simulationIds || [],
        sampleCounts,
        ...payload,
      });
    };

    this.logMlEvent('train_snapshot_started', {
      taskId,
      baseSnapshotId: baseSnapshot.id,
      epochs,
      learningRate,
      batchSize,
      trainingBackend,
      trainingDevicePreference,
      sampleCounts,
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
    });
    emitTrainingProgress('start', {
      sourceGames: samples.sourceGames,
      sourceSimulations: samples.sourceSimulations,
    });

    try {
      let trainedBundle = cloneModelBundle(baseSnapshot.modelBundle);
      let optimizerState = trainingBackend === TRAINING_BACKENDS.NODE
        ? createOptimizerState(trainedBundle)
        : null;
      const lossEntries = [];

      for (let epoch = 0; epoch < epochs; epoch += 1) {
        const trainingResult = await this.trainModelBundleBatch({
          modelBundle: trainedBundle,
          optimizerState,
          samples,
          learningRate,
          batchSize,
          weightDecay: 0.0001,
          gradientClipNorm: 5,
          epochs: 1,
          trainingBackend,
          trainingDevicePreference,
          parallelTrainingHeadWorkers: 1,
          debugContext: {
            taskId,
            snapshotId: baseSnapshot.id,
            epoch: epoch + 1,
            source: 'train_snapshot',
          },
        });
        trainedBundle = trainingResult.modelBundle || trainedBundle;
        optimizerState = trainingResult.optimizerState || optimizerState;
        const latestMetrics = Array.isArray(trainingResult.history) && trainingResult.history.length
          ? trainingResult.history[trainingResult.history.length - 1]
          : {};
        const epochLoss = {
          epoch: epoch + 1,
          policyLoss: Number(latestMetrics.policyLoss || 0),
          valueLoss: Number(latestMetrics.valueLoss || 0),
          identityLoss: Number(latestMetrics.identityLoss || 0),
          identityAccuracy: Number(latestMetrics.identityAccuracy || 0),
          policySamples: Number(latestMetrics.policySamples || 0),
          valueSamples: Number(latestMetrics.valueSamples || 0),
          identitySamples: Number(latestMetrics.identitySamples || 0),
          trainingBackend: trainingResult.backend || trainingBackend,
          trainingDevice: trainingResult.device || TRAINING_DEVICE_PREFERENCES.CPU,
        };
        lossEntries.push(epochLoss);
        emitTrainingProgress('epoch', {
          epoch: epoch + 1,
          totalEpochs: epochs,
          loss: epochLoss,
        });
      }

      const latestLoss = lossEntries[lossEntries.length - 1];
      const lossRecord = {
        timestamp: nowIso(),
        learningRate,
        epochs,
        sourceSimulations: samples.sourceSimulations,
        sourceGames: samples.sourceGames,
        history: lossEntries.map((entry) => ({ ...entry })),
        ...latestLoss,
      };
      const newSnapshot = this.createSnapshotRecord({
        label: trainingRunLabel,
        generation: (baseSnapshot.generation || 0) + 1,
        parentSnapshotId: baseSnapshot.id,
        modelBundle: trainedBundle,
        notes: options.notes || `Trained from ${samples.sourceGames} game(s)`,
        stats: {
          ...baseSnapshot.stats,
          trainingRuns: (baseSnapshot.stats?.trainingRuns || 0) + 1,
        },
        losses: [
          ...(baseSnapshot.losses || []),
          lossRecord,
        ],
      });

      this.state.snapshots.unshift(newSnapshot);
      const trainingRun = {
        id: this.nextId('training'),
        createdAt: nowIso(),
        updatedAt: nowIso(),
        status: 'completed',
        label: trainingRunLabel,
        notes: options.notes || '',
        baseSnapshotId: baseSnapshot.id,
        newSnapshotId: newSnapshot.id,
        epochs,
        batchSize,
        learningRate,
        trainingBackend,
        trainingDevicePreference,
        sourceSimulationIds: simulationIds || [],
        sourceGames: samples.sourceGames,
        sourceSimulations: samples.sourceSimulations,
        sampleCounts,
        history: lossEntries.map((entry) => ({ ...entry })),
        finalLoss: latestLoss,
      };
      this.state.trainingRuns.unshift(trainingRun);
      if (this.state.trainingRuns.length > 500) {
        this.state.trainingRuns.length = 500;
      }

      baseSnapshot.stats = baseSnapshot.stats || {};
      baseSnapshot.stats.trainingRuns = (baseSnapshot.stats.trainingRuns || 0) + 1;
      baseSnapshot.updatedAt = nowIso();

      await this.save();

      emitTrainingProgress('complete', {
        epoch: epochs,
        totalEpochs: epochs,
        trainingRunId: trainingRun.id,
        newSnapshotId: newSnapshot.id,
        loss: latestLoss,
      });
      this.logTrainingEvent(trainingRun.id, 'train_snapshot_completed', {
        taskId,
        baseSnapshotId: baseSnapshot.id,
        newSnapshotId: newSnapshot.id,
        epochs,
        finalLoss: latestLoss || null,
      });

      return {
        trainingRun,
        snapshot: this.summarizeSnapshot(newSnapshot),
        lossHistory: lossEntries,
        sampleCounts,
      };
    } catch (err) {
      emitTrainingProgress('error', {
        message: err.message || 'Training failed',
      });
      this.logMlEvent('train_snapshot_error', {
        taskId,
        baseSnapshotId: baseSnapshot.id,
        epochs,
        trainingBackend,
        trainingDevicePreference,
        error: summarizeError(err),
      });
      throw err;
    }
  }

  async getLossHistory(options = {}) {
    await this.ensureLoaded();
    const snapshotId = options.snapshotId || null;
    if (snapshotId) {
      const snapshot = this.getSnapshotById(snapshotId);
      if (!snapshot) return [];
      return deepClone(snapshot.losses || []);
    }
    return deepClone((this.state.snapshots || []).map((snapshot) => ({
      snapshotId: snapshot.id,
      label: snapshot.label,
      losses: snapshot.losses || [],
    })));
  }

  getRunIndex(runId) {
    return (this.state.runs || []).findIndex((run) => run.id === runId);
  }

  getRunById(runId) {
    return (this.state.runs || []).find((run) => run.id === runId) || null;
  }

  getRunGeneration(run, generationNumber) {
    if (!run || !Number.isFinite(generationNumber)) return null;
    return (run.generations || []).find((generation) => Number(generation?.generation) === Number(generationNumber)) || null;
  }

  buildRunGenerationId(runId, generationNumber) {
    return `${runId}:g${String(generationNumber).padStart(4, '0')}`;
  }

  createRunGenerationRecord(run, options = {}) {
    const generationNumber = Number.isFinite(options.generation)
      ? Number(options.generation)
      : Number(run?.generations?.length || 0);
    const createdAt = nowIso();
    return {
      id: this.buildRunGenerationId(run?.id || this.nextId('run'), generationNumber),
      generation: generationNumber,
      label: options.label || `G${generationNumber}`,
      createdAt,
      updatedAt: createdAt,
      promotedAt: options.promotedAt || (options.isBest ? createdAt : null),
      parentGeneration: Number.isFinite(options.parentGeneration) ? Number(options.parentGeneration) : null,
      isBest: Boolean(options.isBest),
      approved: options.approved !== false,
      source: options.source || 'promoted',
      modelBundle: cloneModelBundle(options.modelBundle || createDefaultModelBundle({ seed: Date.now() })),
      stats: {
        selfPlayGames: 0,
        evaluationGames: 0,
        replayPositions: 0,
        ...deepClone(options.stats || {}),
      },
      latestLoss: options.latestLoss ? deepClone(options.latestLoss) : null,
      promotionEvaluation: options.promotionEvaluation ? deepClone(options.promotionEvaluation) : null,
    };
  }

  createGenerationParticipant(run, generationNumber) {
    const generation = this.getRunGeneration(run, generationNumber);
    if (!generation) return null;
    return {
      id: buildPromotedModelBotId(run.id, generation.generation),
      type: 'generation',
      label: generation.label || `G${generation.generation}`,
      generation: generation.generation,
      runId: run.id,
      modelBundle: generation.modelBundle,
    };
  }

  buildPromotedBotCatalogEntry(run, generation) {
    if (!run || !isPromotedGenerationRecord(generation)) return null;
    const id = buildPromotedModelBotId(run.id, generation.generation);
    const enabledIds = new Set(this.state?.promotedBots?.enabledIds || []);
    return {
      id,
      type: 'promoted_model',
      label: this.buildMlTestLabel(run, generation),
      runId: run.id,
      runLabel: run.label || run.id,
      generation: Number(generation.generation || 0),
      generationId: generation.id || null,
      generationLabel: generation.label || `G${Number(generation.generation || 0)}`,
      promotedAt: generation.promotedAt || null,
      createdAt: generation.createdAt || null,
      updatedAt: generation.updatedAt || generation.createdAt || null,
      isBest: Boolean(generation.isBest),
      enabled: enabledIds.has(id),
      botUsername: buildMlTestBotUsername(run.id, generation.generation),
    };
  }

  listPromotedBotCatalogEntries() {
    const items = [];
    (this.state.runs || []).forEach((run) => {
      (run.generations || []).forEach((generation) => {
        const entry = this.buildPromotedBotCatalogEntry(run, generation);
        if (entry) items.push(entry);
      });
    });
    return items.sort((left, right) => {
      const promotedDelta = parseTimeValue(right?.promotedAt) - parseTimeValue(left?.promotedAt);
      if (promotedDelta !== 0) return promotedDelta;
      const createdDelta = parseTimeValue(right?.createdAt) - parseTimeValue(left?.createdAt);
      if (createdDelta !== 0) return createdDelta;
      const generationDelta = Number(right?.generation || 0) - Number(left?.generation || 0);
      if (generationDelta !== 0) return generationDelta;
      return String(left?.label || '').localeCompare(String(right?.label || ''));
    });
  }

  prunePromotedBotSelections() {
    const availableIds = new Set(this.listPromotedBotCatalogEntries().map((entry) => entry.id));
    const currentIds = uniqueStrings(this.state?.promotedBots?.enabledIds || []);
    const nextIds = currentIds.filter((id) => availableIds.has(id));
    const changed = currentIds.length !== nextIds.length || currentIds.some((id, index) => id !== nextIds[index]);
    this.state.promotedBots = {
      enabledIds: nextIds,
    };
    return changed;
  }

  buildPromotedBotCatalogSummary() {
    const items = this.listPromotedBotCatalogEntries();
    const enabledIds = items.filter((entry) => entry.enabled).map((entry) => entry.id);
    return {
      items,
      enabledIds,
      total: items.length,
      enabledCount: enabledIds.length,
    };
  }

  getEnabledPromotedBotCatalogEntry(botId) {
    if (typeof botId !== 'string' || !botId.trim()) return null;
    return this.listPromotedBotCatalogEntries()
      .find((entry) => entry.id === botId && entry.enabled)
      || null;
  }

  async getPromotedBotCatalog() {
    await this.ensureLoaded();
    this.prunePromotedBotSelections();
    return this.buildPromotedBotCatalogSummary();
  }

  async updatePromotedBotCatalog(enabledIds = []) {
    await this.ensureLoaded();
    const availableIds = new Set(this.listPromotedBotCatalogEntries().map((entry) => entry.id));
    this.state.promotedBots = {
      enabledIds: uniqueStrings(enabledIds).filter((id) => availableIds.has(id)),
    };
    await this.save();
    return this.buildPromotedBotCatalogSummary();
  }

  async listEnabledPromotedBotCatalog() {
    await this.ensureLoaded();
    this.prunePromotedBotSelections();
    return this.listPromotedBotCatalogEntries()
      .filter((entry) => entry.enabled)
      .map((entry) => ({
        ...entry,
        playable: true,
      }));
  }

  async ensureMlTestBotUser(runId, generationNumber, options = {}) {
    const email = buildMlTestBotEmail(runId, generationNumber);
    const username = buildMlTestBotUsername(runId, generationNumber);
    const botDifficulty = typeof options.botDifficulty === 'string' && options.botDifficulty.trim()
      ? options.botDifficulty.trim()
      : buildPromotedModelBotId(runId, generationNumber);
    const hasMongoConnection = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
    if (!hasMongoConnection) {
      return {
        _id: new mongoose.Types.ObjectId(),
        username,
        email,
        elo: 1600,
        isBot: true,
        botDifficulty,
        isGuest: false,
      };
    }

    let bot = await User.findOne({ email }).lean();
    if (bot) {
      return bot;
    }

    const existingByUsername = await User.findOne({ username }).lean();
    if (existingByUsername) {
      await User.updateOne(
        { _id: existingByUsername._id },
        {
          $set: {
            email,
            isBot: true,
            botDifficulty,
            isGuest: false,
          },
        },
      );
      return {
        ...existingByUsername,
        email,
        isBot: true,
        botDifficulty,
        isGuest: false,
      };
    }

    const created = await User.create({
      username,
      email,
      elo: 1600,
      isBot: true,
      botDifficulty,
      isGuest: false,
    });
    return created.toObject();
  }

  buildMlTestLabel(run, generationRecord) {
    const customLabel = String(generationRecord?.label || '').trim();
    const modelDescriptor = describeModelBundle(generationRecord?.modelBundle);
    if (customLabel) {
      return `${customLabel} ${modelDescriptor}`;
    }
    const generation = Number(generationRecord?.generation || 0);
    const runLabel = String(run?.label || run?.id || 'Run').trim();
    return `${runLabel} G${generation} ${modelDescriptor}`;
  }

  async registerMlTestGame(gameId, mlTestConfig) {
    const normalizedGameId = typeof gameId === 'string' ? gameId : gameId?.toString?.();
    if (!normalizedGameId || !mlTestConfig?.enabled) {
      return null;
    }
    this.liveTestGameConfigs.set(normalizedGameId, deepClone(mlTestConfig));
    await this.scheduleMlTestGame(normalizedGameId);
    return mlTestConfig;
  }

  async startLiveMlMatch(options = {}) {
    const run = options.run || null;
    const generationRecord = options.generationRecord || null;
    const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
    const username = typeof options.username === 'string' ? options.username.trim() : '';
    const sidePreference = normalizeLiveTestSidePreference(options.sidePreference);
    const initiatorAction = typeof options.initiatorAction === 'string' && options.initiatorAction.trim()
      ? options.initiatorAction.trim()
      : 'ml-test-match-created';
    const logEvent = typeof options.logEvent === 'string' && options.logEvent.trim()
      ? options.logEvent.trim()
      : 'test_game_started';

    if (!run?.id) {
      const err = new Error('Run not found');
      err.statusCode = 404;
      throw err;
    }
    if (!generationRecord || generationRecord.approved === false || !generationRecord.modelBundle) {
      const err = new Error(`Generation G${Number(generationRecord?.generation || 0)} is not available for live testing`);
      err.statusCode = 404;
      throw err;
    }
    if (!userId) {
      const err = new Error('User session is required');
      err.statusCode = 401;
      throw err;
    }

    if (lobbyStore.isInGame(userId)) {
      const err = new Error('User is already in a game');
      err.statusCode = 409;
      throw err;
    }

    if (lobbyStore.isInAnyQueue(userId)) {
      lobbyStore.removeFromAllQueues(userId);
      lobbyStore.emitQueueChanged([userId]);
    }

    const botId = buildPromotedModelBotId(run.id, generationRecord.generation);
    const botUser = await this.ensureMlTestBotUser(run.id, generationRecord.generation, {
      botDifficulty: botId,
    });
    const { timeControl, increment, type } = await resolveLiveAiMatchSettings();
    const userPlaysWhite = sidePreference === LIVE_TEST_SIDE_PREFERENCES.WHITE
      ? true
      : (sidePreference === LIVE_TEST_SIDE_PREFERENCES.BLACK ? false : Math.random() < 0.5);
    const players = userPlaysWhite
      ? [userId, botUser._id.toString()]
      : [botUser._id.toString(), userId];

    const match = await Match.create({
      player1: userId,
      player2: botUser._id,
      type,
      player1Score: 0,
      player2Score: 0,
      games: [],
    });

    const mlTestConfig = {
      enabled: true,
      botId,
      runId: run.id,
      runLabel: run.label || run.id,
      generation: generationRecord.generation,
      generationLabel: generationRecord.label || `G${generationRecord.generation}`,
      participantId: buildPromotedModelBotId(run.id, generationRecord.generation),
      modelLabel: this.buildMlTestLabel(run, generationRecord),
      botUserId: botUser._id.toString(),
      botUsername: botUser.username,
      sidePreference,
      createdAt: nowIso(),
    };

    const game = await Game.create({
      players,
      match: match._id,
      timeControlStart: timeControl,
      increment,
      mlTestConfig,
    });

    match.games.push(game._id);
    await match.save();

    lobbyStore.addInGame([userId]);
    lobbyStore.emitQueueChanged([userId]);

    const affectedUsers = players.map((id) => id.toString());
    const gamePayload = typeof game.toObject === 'function' ? game.toObject() : game;

    eventBus.emit('gameChanged', {
      game: gamePayload,
      affectedUsers,
      initiator: {
        action: initiatorAction,
        userId,
        username,
      },
      botPlayers: [botUser._id.toString()],
    });

    eventBus.emit('players:bothNext', {
      game: gamePayload,
      affectedUsers,
      botPlayers: [botUser._id.toString()],
    });

    eventBus.emit('match:created', {
      matchId: match._id.toString(),
      players: affectedUsers,
      type,
      botPlayers: [botUser._id.toString()],
    });

    await this.registerMlTestGame(game._id.toString(), mlTestConfig);
    this.logMlEvent(logEvent, {
      runId: run.id,
      generation: generationRecord.generation,
      gameId: game._id.toString(),
      matchId: match._id.toString(),
      userId,
      botId,
      botUserId: botUser._id.toString(),
      sidePreference,
      userPlaysWhite,
    });

    return {
      status: 'matched',
      userId,
      username,
      matchId: match._id.toString(),
      gameId: game._id.toString(),
      runId: run.id,
      generation: generationRecord.generation,
      generationLabel: generationRecord.label || `G${generationRecord.generation}`,
      botId,
      botUserId: botUser._id.toString(),
      botUsername: botUser.username,
      userColor: userPlaysWhite ? WHITE : BLACK,
      launchUrl: '/',
    };
  }

  async startPromotedBotGame(options = {}) {
    await this.ensureLoaded();

    const botId = typeof options.botId === 'string' ? options.botId.trim() : '';
    const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
    const username = typeof options.username === 'string' ? options.username.trim() : '';
    if (!botId) {
      const err = new Error('Bot is required');
      err.statusCode = 400;
      throw err;
    }
    const selection = this.getEnabledPromotedBotCatalogEntry(botId);
    if (!selection) {
      const err = new Error('Selected promoted bot is not available');
      err.statusCode = 404;
      throw err;
    }
    const run = this.getRunById(selection.runId);
    const generationRecord = this.getRunGeneration(run, selection.generation);
    return this.startLiveMlMatch({
      run,
      generationRecord,
      userId,
      username,
      sidePreference: options.sidePreference || LIVE_TEST_SIDE_PREFERENCES.RANDOM,
      initiatorAction: 'bot-match-created',
      logEvent: 'promoted_bot_game_started',
    });
  }

  async startTestGame(options = {}) {
    await this.ensureLoaded();

    const runId = typeof options.runId === 'string' ? options.runId.trim() : '';
    const requestedGeneration = Number.parseInt(options.generation, 10);
    const generationNumber = Number.isFinite(requestedGeneration) ? requestedGeneration : 0;
    const userId = typeof options.userId === 'string' ? options.userId.trim() : '';
    const username = typeof options.username === 'string' ? options.username.trim() : '';
    const sidePreference = normalizeLiveTestSidePreference(options.sidePreference);

    if (!runId) {
      const err = new Error('Run is required');
      err.statusCode = 400;
      throw err;
    }
    if (!userId) {
      const err = new Error('User session is required');
      err.statusCode = 401;
      throw err;
    }

    const run = this.getRunById(runId);
    if (!run) {
      const err = new Error('Run not found');
      err.statusCode = 404;
      throw err;
    }
    const generationRecord = this.getRunGeneration(run, generationNumber);
    return this.startLiveMlMatch({
      run,
      generationRecord,
      userId,
      username,
      sidePreference,
      initiatorAction: 'ml-test-match-created',
      logEvent: 'test_game_started',
    });
  }

  handleMlTestGameChanged(payload = {}) {
    let game = payload?.game;
    if (game && typeof game.toObject === 'function') {
      game = game.toObject();
    }
    const gameId = game?._id?.toString?.() || payload?.gameId?.toString?.() || null;
    const mlTestConfig = game?.mlTestConfig || this.liveTestGameConfigs.get(gameId) || null;
    if (!gameId || !mlTestConfig?.enabled) return;
    this.scheduleMlTestGame(gameId);
  }

  scheduleMlTestGame(gameId) {
    const id = typeof gameId === 'string' ? gameId : gameId?.toString?.();
    if (!id) return Promise.resolve();
    if (this.liveTestGameTasks.has(id)) {
      return this.liveTestGameTasks.get(id);
    }
    const task = this.runMlTestGameLoop(id)
      .catch((err) => {
        this.logMlEvent('test_game_loop_error', {
          gameId: id,
          error: summarizeError(err),
        });
        return false;
      })
      .finally(() => {
        this.liveTestGameTasks.delete(id);
      });
    this.liveTestGameTasks.set(id, task);
    return task;
  }

  async runMlTestGameLoop(gameId) {
    for (let step = 0; step < 12; step += 1) {
      const didAct = await this.runMlTestGameStep(gameId);
      if (!didAct) return;
      await sleep(10);
    }
  }

  async runMlTestGameStep(gameId) {
    const game = await loadGameLean(gameId);
    const mlTestConfig = game?.mlTestConfig || this.liveTestGameConfigs.get(gameId) || null;
    if (!game?.isActive || !mlTestConfig?.enabled) {
      if (!game?.isActive) {
        this.liveTestGameConfigs.delete(gameId);
      }
      return false;
    }
    const botUserId = String(mlTestConfig.botUserId || '');
    if (!botUserId) return false;
    const botColor = Array.isArray(game.players)
      ? game.players.findIndex((playerId) => String(playerId) === botUserId)
      : -1;
    if (botColor !== WHITE && botColor !== BLACK) {
      return false;
    }

    const botSession = createInternalRequestSession(botUserId, mlTestConfig.botUsername || 'ML Test Bot');
    const gameConfig = typeof getServerConfig.getServerConfigSnapshotSync === 'function'
      ? getServerConfig.getServerConfigSnapshotSync()
      : await getServerConfig();

    if (!Array.isArray(game.setupComplete) || !game.setupComplete[botColor]) {
      const setup = buildLiveTestSetupFromGame(game, botColor, gameConfig);
      await callPostHandler(ROUTE_HANDLERS.setup, {
        gameId,
        color: botColor,
        pieces: setup.pieces,
        onDeck: setup.onDeck,
      }, { session: botSession, routeName: 'ml-test-setup', simulationContext: false });
      return true;
    }

    if (!Array.isArray(game.playersReady) || !game.playersReady[botColor]) {
      await callPostHandler(ROUTE_HANDLERS.ready, {
        gameId,
        color: botColor,
      }, { session: botSession, routeName: 'ml-test-ready', simulationContext: false });
      return true;
    }

    if (!liveTestBotMustAct(game, botColor)) {
      return false;
    }

    const run = this.getRunById(String(mlTestConfig.runId || ''));
    const participant = run
      ? this.createGenerationParticipant(run, Number(mlTestConfig.generation || 0))
      : null;
    if (!participant?.modelBundle) {
      await callPostHandler(ROUTE_HANDLERS.resign, {
        gameId,
        color: botColor,
      }, { session: botSession, routeName: 'ml-test-resign-missing-model', simulationContext: false });
      return true;
    }

    const runConfig = run?.config || {};
    const searchOptions = {
      iterations: runConfig.numMctsSimulationsPerMove,
      maxDepth: runConfig.maxDepth,
      hypothesisCount: runConfig.hypothesisCount,
      riskBias: runConfig.riskBias,
      exploration: runConfig.exploration,
    };
    const liveContext = {
      gameId,
      sessionsByColor: {
        [botColor]: botSession,
      },
      simulationContext: false,
    };
    const buildActionAttempt = (liveGame, seed) => {
      const shadowState = createShadowStateFromLiveGame(liveGame, {
        maxPlies: 200,
        seed,
      });
      const legalActions = getLegalActions(shadowState, botColor);
      const search = legalActions.length
        ? this.chooseActionForParticipant(participant, shadowState, searchOptions)
        : null;
      return {
        shadowState,
        legalActions,
        candidates: buildPreferredLiveActionCandidates(search, legalActions),
      };
    };

    const initialAttempt = buildActionAttempt(game, Date.now());
    if (!initialAttempt.legalActions.length) {
      await callPostHandler(ROUTE_HANDLERS.resign, {
        gameId,
        color: botColor,
      }, { session: botSession, routeName: 'ml-test-resign-no-legal-actions', simulationContext: false });
      return true;
    }

    const initialResult = await tryApplyLiveActionCandidates(
      liveContext,
      initialAttempt.shadowState,
      initialAttempt.candidates,
    );
    if (initialResult.executedAction) {
      return true;
    }

    const refreshedGame = await loadGameLean(gameId);
    if (!refreshedGame?.isActive) {
      this.liveTestGameConfigs.delete(gameId);
      return false;
    }
    if (!liveTestBotMustAct(refreshedGame, botColor)) {
      return false;
    }

    const refreshedAttempt = buildActionAttempt(refreshedGame, Date.now() + 1);
    if (!refreshedAttempt.legalActions.length) {
      await callPostHandler(ROUTE_HANDLERS.resign, {
        gameId,
        color: botColor,
      }, { session: botSession, routeName: 'ml-test-resign-no-legal-actions', simulationContext: false });
      return true;
    }

    const refreshedResult = await tryApplyLiveActionCandidates(
      liveContext,
      refreshedAttempt.shadowState,
      refreshedAttempt.candidates,
      { rejectedCandidates: initialResult.rejectedCandidates },
    );
    if (refreshedResult.executedAction) {
      return true;
    }

    this.logMlEvent('test_game_all_legal_actions_rejected', {
      gameId,
      runId: run?.id || null,
      generation: Number(mlTestConfig.generation || 0),
      botColor,
      rejectedCandidates: refreshedResult.rejectedCandidates,
    });
    try {
      await callPostHandler(ROUTE_HANDLERS.resign, {
        gameId,
        color: botColor,
      }, { session: botSession, routeName: 'ml-test-resign-all-actions-rejected', simulationContext: false });
      return true;
    } catch (err) {
      if (isRecoverableLiveActionError(err)) {
        return false;
      }
      throw err;
    }
  }

  summarizeRunReplayBuffer(run) {
    const replayBuffer = run?.replayBuffer || {};
    const policySamples = Array.isArray(replayBuffer.policySamples) ? replayBuffer.policySamples : [];
    if (!policySamples.length && replayBuffer.summary && typeof replayBuffer.summary === 'object') {
      return {
        positions: Number(replayBuffer.summary.positions || 0),
        maxPositions: Number(replayBuffer.maxPositions || replayBuffer.summary.maxPositions || 0),
        totalPositionsSeen: Number(replayBuffer.totalPositionsSeen || replayBuffer.summary.totalPositionsSeen || 0),
        oldestGeneration: Number.isFinite(replayBuffer.summary.oldestGeneration)
          ? Number(replayBuffer.summary.oldestGeneration)
          : null,
        newestGeneration: Number.isFinite(replayBuffer.summary.newestGeneration)
          ? Number(replayBuffer.summary.newestGeneration)
          : null,
        freshness: Number.isFinite(replayBuffer.summary.freshness)
          ? Number(replayBuffer.summary.freshness)
          : null,
        oldestAt: replayBuffer.summary.oldestAt || null,
        newestAt: replayBuffer.summary.newestAt || null,
      };
    }
    const sorted = policySamples
      .filter((sample) => sample && typeof sample === 'object')
      .sort((left, right) => parseTimeValue(left?.createdAt) - parseTimeValue(right?.createdAt));
    const oldest = sorted[0] || null;
    const newest = sorted.length ? sorted[sorted.length - 1] : null;
    const oldestGeneration = Number.isFinite(oldest?.generation) ? Number(oldest.generation) : null;
    const newestGeneration = Number.isFinite(newest?.generation) ? Number(newest.generation) : null;
    return {
      positions: policySamples.length,
      maxPositions: Number(replayBuffer.maxPositions || 0),
      totalPositionsSeen: Number(replayBuffer.totalPositionsSeen || 0),
      oldestGeneration,
      newestGeneration,
      freshness: (
        Number.isFinite(oldestGeneration)
        && Number.isFinite(newestGeneration)
        ? Math.max(0, newestGeneration - oldestGeneration)
        : null
      ),
      oldestAt: oldest?.createdAt || null,
      newestAt: newest?.createdAt || null,
    };
  }

  summarizeRun(run) {
    if (!run) return null;
    const elapsedMs = computeRunElapsedMs(run);
    const generations = Array.isArray(run.generations) ? run.generations : [];
    const evaluationHistory = Array.isArray(run.evaluationHistory) ? run.evaluationHistory : [];
    const latestEvaluation = evaluationHistory.length ? evaluationHistory[evaluationHistory.length - 1] : null;
    const latestMetrics = Array.isArray(run.metricsHistory) && run.metricsHistory.length
      ? run.metricsHistory[run.metricsHistory.length - 1]
      : null;
    return {
      id: run.id,
      label: run.label,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt || run.createdAt,
      status: run.status || 'completed',
      stopReason: run.stopReason || null,
      lastError: run?.lastError ? summarizeError(run.lastError) : null,
      config: deepClone(run.config || {}),
      bestGeneration: Number(run.bestGeneration || 0),
      evaluationTargetGeneration: Number.isFinite(run.evaluationTargetGeneration)
        ? Number(run.evaluationTargetGeneration)
        : 0,
      workerGeneration: Number(run.workerGeneration || 0),
      generationCount: generations.length,
      totalSelfPlayGames: Number(run.stats?.totalSelfPlayGames || 0),
      totalEvaluationGames: Number(run.stats?.totalEvaluationGames || 0),
      averageSelfPlayGameDurationMs: Number(run.stats?.averageSelfPlayGameDurationMs || 0),
      averageEvaluationGameDurationMs: Number(run.stats?.averageEvaluationGameDurationMs || 0),
      elapsedMs,
      totalTrainingSteps: Number(run.stats?.totalTrainingSteps || 0),
      totalPromotions: Number(run.stats?.totalPromotions || 0),
      failedPromotions: Number(run.stats?.failedPromotions || 0),
      canContinue: this.canContinueRun(run),
      replayBuffer: this.summarizeRunReplayBuffer(run),
      latestLoss: latestMetrics?.latestLoss || run.working?.lastLoss || null,
      latestEvaluation: latestEvaluation ? deepClone(latestEvaluation) : null,
      generations: generations.map((generation) => ({
        id: generation.id,
        generation: generation.generation,
        label: generation.label,
        isBest: Boolean(generation.isBest),
        approved: generation.approved !== false,
        createdAt: generation.createdAt,
        promotedAt: generation.promotedAt || null,
        latestLoss: generation.latestLoss ? deepClone(generation.latestLoss) : null,
        promotionEvaluation: generation.promotionEvaluation ? deepClone(generation.promotionEvaluation) : null,
        stats: deepClone(generation.stats || {}),
      })),
    };
  }

  buildRunEvaluationSeries(run) {
    const hasStagedEvaluations = (run?.evaluationHistory || []).some((evaluation) => (
      this.getEvaluationBaselineInfo(evaluation)
      || evaluation?.prePromotionTest
      || Array.isArray(evaluation?.promotionTests)
    ));
    if (hasStagedEvaluations) {
      const markerShapeForEvaluation = (evaluation, stage = 'baseline') => {
        if (evaluation?.promoted) return 'star';
        if (stage === 'pre-promotion' && evaluation?.prePromotionPassed) return 'diamond';
        return 'circle';
      };
      const baselineSeriesByGeneration = new Map();
      const prePromotionSeries = {
        key: 'pre-promotion',
        opponentGeneration: -1,
        label: 'pre-promo gate',
        color: '#7fd2de',
        lineStyle: 'solid',
        points: [],
      };
      const promotionSeriesByGeneration = new Map();

      (run?.evaluationHistory || []).forEach((evaluation) => {
        const candidateGeneration = Number.isFinite(evaluation?.candidateGeneration)
          ? Number(evaluation.candidateGeneration)
          : null;
        if (!Number.isFinite(candidateGeneration)) return;
        const tooltipSections = Array.isArray(evaluation?.tooltipSections)
          ? deepClone(evaluation.tooltipSections)
          : this.createEvaluationTooltipSections(evaluation);
        const baselineInfo = this.getEvaluationBaselineInfo(evaluation);
        if (baselineInfo) {
          const baselineGeneration = Number(baselineInfo.generation || 0);
          if (!baselineSeriesByGeneration.has(baselineGeneration)) {
            baselineSeriesByGeneration.set(baselineGeneration, {
              key: `baseline-info:${baselineGeneration}`,
              opponentGeneration: baselineGeneration,
              label: `baseline vs G${baselineGeneration}`,
              lineStyle: 'solid',
              points: [],
            });
          }
          baselineSeriesByGeneration.get(baselineGeneration).points.push({
            candidateGeneration,
            checkpointIndex: Number(evaluation?.checkpointIndex || 0),
            generation: baselineGeneration,
            winRate: Number(baselineInfo.winRate || 0),
            games: Number(baselineInfo.games || 0),
            wins: Number(baselineInfo.wins || 0),
            losses: Number(baselineInfo.losses || 0),
            draws: Number(baselineInfo.draws || 0),
            promoted: Boolean(evaluation?.promoted),
            timestamp: evaluation?.evaluatedAt || null,
            markerShape: markerShapeForEvaluation(evaluation, 'baseline'),
            tooltipSections,
          });
        }
        if (evaluation?.prePromotionTest) {
          prePromotionSeries.points.push({
            candidateGeneration,
            checkpointIndex: Number(evaluation?.checkpointIndex || 0),
            winRate: Number(evaluation.prePromotionTest.winRate || 0),
            games: Number(evaluation.prePromotionTest.games || 0),
            wins: Number(evaluation.prePromotionTest.wins || 0),
            losses: Number(evaluation.prePromotionTest.losses || 0),
            draws: Number(evaluation.prePromotionTest.draws || 0),
            promoted: Boolean(evaluation?.promoted),
            timestamp: evaluation?.evaluatedAt || null,
            markerShape: markerShapeForEvaluation(evaluation, 'pre-promotion'),
            tooltipSections,
          });
        }
        (evaluation?.promotionTests || []).forEach((entry) => {
          const opponentGeneration = Number(entry?.generation);
          if (!Number.isFinite(opponentGeneration)) return;
          if (!promotionSeriesByGeneration.has(opponentGeneration)) {
            promotionSeriesByGeneration.set(opponentGeneration, {
              key: `promotion:${opponentGeneration}`,
              opponentGeneration,
              label: `promotion vs G${opponentGeneration}`,
              color: '#7fd2de',
              lineStyle: 'none',
              points: [],
            });
          }
          promotionSeriesByGeneration.get(opponentGeneration).points.push({
            candidateGeneration,
            checkpointIndex: Number(evaluation?.checkpointIndex || 0),
            generation: opponentGeneration,
            winRate: Number(entry.winRate || 0),
            games: Number(entry.games || 0),
            wins: Number(entry.wins || 0),
            losses: Number(entry.losses || 0),
            draws: Number(entry.draws || 0),
            promoted: Boolean(evaluation?.promoted),
            timestamp: evaluation?.evaluatedAt || null,
            markerShape: markerShapeForEvaluation(evaluation, 'promotion'),
            tooltipSections,
          });
        });
      });

      return [
        ...Array.from(baselineSeriesByGeneration.values()),
        ...Array.from(promotionSeriesByGeneration.values()),
        prePromotionSeries,
      ]
        .map((series) => ({
          ...series,
          points: (series.points || [])
            .filter((point) => Number.isFinite(point.candidateGeneration))
            .sort((left, right) => Number(left.candidateGeneration || 0) - Number(right.candidateGeneration || 0)),
        }))
        .filter((series) => series.points.length)
        .sort((left, right) => {
          if (left.key === 'pre-promotion') return 1;
          if (right.key === 'pre-promotion') return -1;
          return Number(left.opponentGeneration || 0) - Number(right.opponentGeneration || 0);
        });
    }

    const seriesByOpponent = new Map();
    (run?.evaluationHistory || []).forEach((evaluation) => {
      const points = [];
      if (evaluation?.againstBest) points.push(evaluation.againstBest);
      if (
        evaluation?.againstTarget
        && Number(evaluation.againstTarget?.generation) !== Number(evaluation.againstBest?.generation)
      ) {
        points.push(evaluation.againstTarget);
      }
      (evaluation?.againstGenerations || []).forEach((entry) => points.push(entry));
      points.forEach((entry) => {
        const candidateGeneration = Number.isFinite(evaluation?.candidateGeneration)
          ? Number(evaluation.candidateGeneration)
          : null;
        const opponentGeneration = Number(entry?.generation);
        if (!Number.isFinite(opponentGeneration) || !Number.isFinite(candidateGeneration)) return;
        if (candidateGeneration <= opponentGeneration) return;
        if (!seriesByOpponent.has(opponentGeneration)) {
          seriesByOpponent.set(opponentGeneration, []);
        }
        seriesByOpponent.get(opponentGeneration).push({
          candidateGeneration,
          checkpointIndex: Number(evaluation?.checkpointIndex || 0),
          winRate: Number(entry?.winRate || 0),
          games: Number(entry?.games || 0),
          wins: Number(entry?.wins || 0),
          losses: Number(entry?.losses || 0),
          draws: Number(entry?.draws || 0),
          promoted: Boolean(evaluation?.promoted),
          timestamp: evaluation?.evaluatedAt || null,
        });
      });
    });
    return Array.from(seriesByOpponent.entries())
      .map(([opponentGeneration, points]) => ({
        opponentGeneration: Number(opponentGeneration),
        label: `vs G${opponentGeneration}`,
        points: points
          .filter((point) => Number.isFinite(point.candidateGeneration))
          .sort((left, right) => Number(left.candidateGeneration || 0) - Number(right.candidateGeneration || 0)),
      }))
      .sort((left, right) => left.opponentGeneration - right.opponentGeneration);
  }

  getRunConfigDefaults() {
    return deepClone(createDefaultRunConfig());
  }

  createRunRecord(options = {}) {
    const id = options.id || this.nextId('run');
    const label = normalizeRunLabel(options.label) || `Run ${String(id).replace(/^run-/, '')}`;
    const config = normalizeRunConfig(options.config || {});
    const createdAt = nowIso();
    const seedBundle = options.seedBundle || createDefaultModelBundle({
      seed: Number.isFinite(config.seed) ? config.seed : Date.now(),
    });
    const generation0 = this.createRunGenerationRecord({
      id,
      generations: [],
    }, {
      generation: 0,
      label: 'G0',
      source: options.seedSource || config.seedMode,
      modelBundle: seedBundle,
      isBest: true,
      promotedAt: createdAt,
    });
    return {
      id,
      label,
      createdAt,
      updatedAt: createdAt,
      status: 'running',
      stopReason: null,
      lastError: null,
      config,
      bestGeneration: 0,
      evaluationTargetGeneration: 0,
      workerGeneration: 0,
      pendingWorkerGeneration: null,
      cyclesSinceWorkerRefresh: 0,
      generations: [generation0],
      replayBuffer: {
        maxPositions: config.replayBufferMaxPositions,
        policySamples: [],
        valueSamples: [],
        identitySamples: [],
        totalPositionsSeen: 0,
        evictedPositions: 0,
      },
      retainedGames: [],
      metricsHistory: [],
      evaluationHistory: [],
      working: {
        modelBundle: cloneModelBundle(seedBundle),
        optimizerState: null,
        baseGeneration: 0,
        checkpointIndex: 0,
        lastLoss: null,
      },
      stats: {
        totalSelfPlayGames: 0,
        totalEvaluationGames: 0,
        timedSelfPlayGames: 0,
        timedEvaluationGames: 0,
        totalSelfPlayGameDurationMs: 0,
        totalEvaluationGameDurationMs: 0,
        averageSelfPlayGameDurationMs: 0,
        averageEvaluationGameDurationMs: 0,
        totalTrainingSteps: 0,
        totalPromotions: 0,
        failedPromotions: 0,
        averageGameLength: 0,
        policyEntropy: 0,
        moveDiversity: 0,
      },
      timing: {
        elapsedMs: 0,
        activeSegmentStartedAt: createdAt,
      },
      live: null,
    };
  }

  sanitizeRunReplayBuffer(run) {
    if (!run) {
      return {
        removedPolicySamples: 0,
        removedValueSamples: 0,
        removedIdentitySamples: 0,
      };
    }

    const replayBuffer = run.replayBuffer || {};
    const rawPolicySamples = Array.isArray(replayBuffer.policySamples) ? replayBuffer.policySamples : [];
    const rawValueSamples = Array.isArray(replayBuffer.valueSamples) ? replayBuffer.valueSamples : [];
    const rawIdentitySamples = Array.isArray(replayBuffer.identitySamples) ? replayBuffer.identitySamples : [];
    const policySamples = [];
    const valueSamples = [];
    const pairedCount = Math.max(rawPolicySamples.length, rawValueSamples.length);

    for (let index = 0; index < pairedCount; index += 1) {
      const policySample = rawPolicySamples[index];
      if (!isValidPolicyTrainingSample(policySample)) {
        continue;
      }
      policySamples.push(policySample);
      const valueSample = rawValueSamples[index];
      if (isValidValueTrainingSample(valueSample)) {
        valueSamples.push(valueSample);
      }
    }

    const identitySamples = rawIdentitySamples.filter(isValidIdentityTrainingSample);
    replayBuffer.policySamples = policySamples;
    replayBuffer.valueSamples = valueSamples;
    replayBuffer.identitySamples = identitySamples;
    run.replayBuffer = replayBuffer;

    return {
      removedPolicySamples: Math.max(0, rawPolicySamples.length - policySamples.length),
      removedValueSamples: Math.max(0, rawValueSamples.length - valueSamples.length),
      removedIdentitySamples: Math.max(0, rawIdentitySamples.length - identitySamples.length),
    };
  }

  appendRunReplayBuffer(run, samples = {}, options = {}) {
    if (!run) return this.summarizeRunReplayBuffer(run);
    this.sanitizeRunReplayBuffer(run);
    const replayBuffer = run.replayBuffer || {};
    replayBuffer.maxPositions = Number(replayBuffer.maxPositions || run.config?.replayBufferMaxPositions || 0);
    replayBuffer.policySamples = Array.isArray(replayBuffer.policySamples) ? replayBuffer.policySamples : [];
    replayBuffer.valueSamples = Array.isArray(replayBuffer.valueSamples) ? replayBuffer.valueSamples : [];
    replayBuffer.identitySamples = Array.isArray(replayBuffer.identitySamples) ? replayBuffer.identitySamples : [];
    replayBuffer.totalPositionsSeen = Number(replayBuffer.totalPositionsSeen || 0);
    replayBuffer.evictedPositions = Number(replayBuffer.evictedPositions || 0);

    const generation = Number.isFinite(options.generation) ? Number(options.generation) : null;
    const createdAt = options.createdAt || nowIso();
    const rawPolicySamples = Array.isArray(samples.policySamples) ? samples.policySamples : [];
    const rawValueSamples = Array.isArray(samples.valueSamples) ? samples.valueSamples : [];
    const policySamples = [];
    const valueSamples = [];
    const pairedCount = Math.max(rawPolicySamples.length, rawValueSamples.length);
    for (let index = 0; index < pairedCount; index += 1) {
      const policySample = rawPolicySamples[index];
      if (!isValidPolicyTrainingSample(policySample)) {
        continue;
      }
      policySamples.push(policySample);
      const valueSample = rawValueSamples[index];
      if (isValidValueTrainingSample(valueSample)) {
        valueSamples.push(valueSample);
      }
    }
    const identitySamples = (Array.isArray(samples.identitySamples) ? samples.identitySamples : [])
      .filter(isValidIdentityTrainingSample);

    const normalizeSample = (sample) => ({
      ...deepClone(sample),
      generation: Number.isFinite(sample?.generation) ? Number(sample.generation) : generation,
      createdAt,
    });

    replayBuffer.policySamples.push(...policySamples.map(normalizeSample));
    replayBuffer.valueSamples.push(...valueSamples.map(normalizeSample));
    replayBuffer.identitySamples.push(...identitySamples.map(normalizeSample));
    replayBuffer.totalPositionsSeen += policySamples.length;

    const maxPositions = Math.max(1, Number(replayBuffer.maxPositions || 1));
    const overflowCount = Math.max(0, replayBuffer.policySamples.length - maxPositions);
    if (overflowCount > 0) {
      replayBuffer.policySamples.splice(0, overflowCount);
      if (replayBuffer.valueSamples.length) {
        replayBuffer.valueSamples.splice(0, Math.min(overflowCount, replayBuffer.valueSamples.length));
      }
      replayBuffer.evictedPositions += overflowCount;
    }

    const identityCutoff = replayBuffer.policySamples.length
      ? (parseTimeValue(replayBuffer.policySamples[0]?.createdAt) || Number.MAX_SAFE_INTEGER)
      : Number.MAX_SAFE_INTEGER;
    replayBuffer.identitySamples = replayBuffer.identitySamples.filter((sample) => (
      (parseTimeValue(sample?.createdAt) || 0) >= identityCutoff
    ));

    run.replayBuffer = replayBuffer;
    return this.summarizeRunReplayBuffer(run);
  }

  sampleReplayBufferSamples(run) {
    this.sanitizeRunReplayBuffer(run);
    const replayBuffer = run?.replayBuffer || {};
    const policySamples = Array.isArray(replayBuffer.policySamples) ? replayBuffer.policySamples : [];
    const valueSamples = Array.isArray(replayBuffer.valueSamples) ? replayBuffer.valueSamples : [];
    const identitySamples = Array.isArray(replayBuffer.identitySamples) ? replayBuffer.identitySamples : [];
    const batchSize = clampPositiveInt(run?.config?.batchSize, 32, 1, 4096);
    const sampleCount = Math.min(batchSize, policySamples.length);
    if (!sampleCount) {
      return {
        policySamples: [],
        valueSamples: [],
        identitySamples: [],
      };
    }

    const rng = createRng(Date.now() + sampleCount + Number(run?.stats?.totalTrainingSteps || 0));
    const sampleIndices = pickUniqueRandomIndices(policySamples.length, sampleCount, rng);
    const selectedTimes = new Set();
    const selectedPolicy = sampleIndices.map((index) => {
      const sample = deepClone(policySamples[index]);
      if (sample?.createdAt) selectedTimes.add(String(sample.createdAt));
      return sample;
    });
    const selectedValue = sampleIndices
      .map((index) => deepClone(valueSamples[index] || null))
      .filter(Boolean);
    const selectedIdentity = identitySamples
      .filter((sample) => selectedTimes.has(String(sample?.createdAt || '')))
      .slice(0, Math.max(sampleCount * 3, sampleCount))
      .map((sample) => deepClone(sample));

    return {
      policySamples: selectedPolicy,
      valueSamples: selectedValue,
      identitySamples: selectedIdentity,
    };
  }

  recordRunGameDurations(run, games = [], phase = 'selfplay') {
    if (!run) return;
    const durations = (Array.isArray(games) ? games : [])
      .map((game) => Number(game?.durationMs || 0))
      .filter((durationMs) => Number.isFinite(durationMs) && durationMs >= 0);
    if (!durations.length) return;

    const isEvaluation = String(phase || '').toLowerCase() === 'evaluation';
    const totalKey = isEvaluation ? 'totalEvaluationGameDurationMs' : 'totalSelfPlayGameDurationMs';
    const countKey = isEvaluation ? 'timedEvaluationGames' : 'timedSelfPlayGames';
    const averageKey = isEvaluation ? 'averageEvaluationGameDurationMs' : 'averageSelfPlayGameDurationMs';
    const previousTotalDuration = Number(run.stats?.[totalKey] || 0);
    const previousCount = Number(run.stats?.[countKey] || 0);
    const nextTotalDuration = previousTotalDuration + durations.reduce((sum, value) => sum + value, 0);
    const nextCount = previousCount + durations.length;

    run.stats[totalKey] = nextTotalDuration;
    run.stats[countKey] = nextCount;
    run.stats[averageKey] = nextCount > 0 ? (nextTotalDuration / nextCount) : 0;
  }

  computeRunSelfPlayMetrics(games = []) {
    const plies = games.map((game) => Number(game?.plies || 0));
    const policySamples = games.flatMap((game) => game?.training?.policySamples || []);
    const entropy = averageNumbers(policySamples.map((sample) => computeEntropy(sample?.target || [])));
    const diversity = policySamples.length
      ? (new Set(policySamples.map((sample) => sample?.selectedActionKey || sample?.selectedMoveKey || '')).size / policySamples.length)
      : 0;
    return {
      averageGameLength: averageNumbers(plies),
      policyEntropy: entropy,
      moveDiversity: diversity,
    };
  }

  retainRunGames(run, games = []) {
    if (!run) return;
    const retainedGames = Array.isArray(run.retainedGames) ? run.retainedGames : [];
    games.forEach((game) => {
      const compactGame = compactRunRetainedGame(game);
      if (compactGame) {
        retainedGames.push(compactGame);
      }
    });
    const maxGames = clampPositiveInt(
      run?.config?.retainedReplayGames,
      DEFAULT_RUN_MAX_REPLAY_GAMES,
      20,
      10000,
    );
    const overflowCount = Math.max(0, retainedGames.length - maxGames);
    if (overflowCount > 0) {
      retainedGames.splice(0, overflowCount);
    }
    run.retainedGames = retainedGames;
  }

  listRunGenerationPairs(run) {
    const pairs = new Map();
    (run?.retainedGames || []).forEach((game) => {
      const key = buildGenerationPairKey(game?.whiteGeneration, game?.blackGeneration);
      if (!pairs.has(key)) {
        pairs.set(key, {
          key,
          generationA: Math.min(Number(game?.whiteGeneration || 0), Number(game?.blackGeneration || 0)),
          generationB: Math.max(Number(game?.whiteGeneration || 0), Number(game?.blackGeneration || 0)),
          games: 0,
          latestGameAt: game?.createdAt || null,
        });
      }
      const entry = pairs.get(key);
      entry.games += 1;
      if (parseTimeValue(game?.createdAt) > parseTimeValue(entry.latestGameAt)) {
        entry.latestGameAt = game.createdAt;
      }
    });
    return Array.from(pairs.values()).sort((left, right) => (
      parseTimeValue(right.latestGameAt) - parseTimeValue(left.latestGameAt)
    ));
  }

  listRunReplayGameSummaries(run, generationA, generationB, options = {}) {
    if (!run) return [];
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.floor(Number(options.limit))) : null;
    const hasGenerationFilter = generationA !== null
      && generationA !== undefined
      && generationB !== null
      && generationB !== undefined;
    const items = (run.retainedGames || [])
      .filter((game) => String(game?.phase || '').toLowerCase() === 'evaluation')
      .filter((game) => {
        if (!hasGenerationFilter) {
          return true;
        }
        const left = Number(generationA);
        const right = Number(generationB);
        if (!Number.isFinite(left) || !Number.isFinite(right)) {
          return true;
        }
        return buildGenerationPairKey(game?.whiteGeneration, game?.blackGeneration) === buildGenerationPairKey(left, right);
      })
      .map((game) => summarizeRunReplayGame(game))
      .filter(Boolean)
      .sort((leftGame, rightGame) => parseTimeValue(rightGame.createdAt) - parseTimeValue(leftGame.createdAt));
    return Number.isFinite(limit) ? items.slice(0, limit) : items;
  }

  async getWorkbench() {
    await this.ensureLoaded();
    await this.ensureFreshResourceTelemetry();
    this.prunePromotedBotSelections();
    const defaults = await this.getRecommendedRunConfigDefaults();
    const runs = (this.state.runs || []).map((run) => this.summarizeRun(run));
    const activeRuns = runs.filter((run) => isRunStatusActive(run?.status));
    const totalGames = runs.reduce((sum, run) => (
      sum + Number(run?.totalSelfPlayGames || 0) + Number(run?.totalEvaluationGames || 0)
    ), 0);
    return {
      summary: {
        counts: {
          runs: runs.length,
          activeRuns: activeRuns.length,
          completedRuns: runs.length - activeRuns.length,
          games: totalGames,
          generations: runs.reduce((sum, run) => sum + Number(run?.generationCount || 0), 0),
        },
        latestRun: runs.length ? runs[0] : null,
      },
      defaults,
      seedSources: {
        defaultValue: RUN_SEED_MODES.BOOTSTRAP,
        items: this.listRunSeedSourceOptions(),
      },
      runs: {
        items: runs,
      },
      promotedBots: this.buildPromotedBotCatalogSummary(),
      live: {
        serverTime: nowIso(),
        resourceTelemetry: this.getResourceTelemetryPayload(),
        runs: activeRuns.map((run) => this.buildRunProgressPayload(this.getRunById(run.id))),
      },
    };
  }

  async listRuns(options = {}) {
    await this.ensureLoaded();
    const source = Array.isArray(this.state.runs) ? this.state.runs : [];
    const limit = Number.isFinite(Number(options.limit)) ? Math.max(1, Math.floor(Number(options.limit))) : null;
    const items = source
      .slice()
      .sort((left, right) => (
        Math.max(parseTimeValue(right?.updatedAt), parseTimeValue(right?.createdAt))
        - Math.max(parseTimeValue(left?.updatedAt), parseTimeValue(left?.createdAt))
      ))
      .map((run) => this.summarizeRun(run));
    return Number.isFinite(limit) ? items.slice(0, limit) : items;
  }

  async resolveRunForRead(runId) {
    await this.ensureLoaded();
    const inMemoryRun = this.getRunById(runId);
    if (inMemoryRun) {
      return inMemoryRun;
    }
    await this.syncPersistedStateForRead();
    return this.getRunById(runId) || null;
  }

  async getRun(runId) {
    const run = await this.resolveRunForRead(runId);
    if (!run) return null;
    const summary = this.summarizeRun(run);
    return {
      ...summary,
      evaluationSeries: this.buildRunEvaluationSeries(run),
      metricsHistory: deepClone(run.metricsHistory || []),
      generationPairs: this.listRunGenerationPairs(run),
      recentReplayGames: this.listRunReplayGameSummaries(run, null, null, { limit: 60 }),
    };
  }

  async listRunGames(runId, generationA, generationB) {
    const run = await this.resolveRunForRead(runId);
    if (!run) return [];
    return this.listRunReplayGameSummaries(run, generationA, generationB);
  }

  async getRunReplay(runId, gameId) {
    const run = await this.resolveRunForRead(runId);
    if (!run) return null;
    const game = (run.retainedGames || []).find((entry) => entry.id === gameId) || null;
    if (!game) return null;
    return {
      run: this.summarizeRun(run),
      game: deepClone(game),
    };
  }

  buildRunProgressPayload(run, phase = null, overrides = {}) {
    if (!run) return null;
    const elapsedMs = computeRunElapsedMs(run);
    const replayBuffer = this.summarizeRunReplayBuffer(run);
    const latestEvaluation = Array.isArray(run.evaluationHistory) && run.evaluationHistory.length
      ? run.evaluationHistory[run.evaluationHistory.length - 1]
      : null;
    const payload = {
      phase: phase || overrides.phase || run.live?.phase || 'running',
      runId: run.id,
      label: run.label,
      createdAt: run.createdAt || null,
      status: overrides.status || run.status || 'running',
      bestGeneration: Number(run.bestGeneration || 0),
      evaluationTargetGeneration: this.getRunEvaluationTargetGeneration(run),
      workerGeneration: Number(run.workerGeneration || 0),
      cycle: Number(run.stats?.cycle || 0),
      totalTrainingSteps: Number(run.stats?.totalTrainingSteps || 0),
      totalSelfPlayGames: Number(run.stats?.totalSelfPlayGames || 0),
      totalEvaluationGames: Number(run.stats?.totalEvaluationGames || 0),
      averageSelfPlayGameDurationMs: Number(run.stats?.averageSelfPlayGameDurationMs || 0),
      averageEvaluationGameDurationMs: Number(run.stats?.averageEvaluationGameDurationMs || 0),
      elapsedMs,
      totalPromotions: Number(run.stats?.totalPromotions || 0),
      failedPromotions: Number(run.stats?.failedPromotions || 0),
      replayBuffer,
      latestLoss: run.working?.lastLoss ? deepClone(run.working.lastLoss) : null,
      latestEvaluation: latestEvaluation ? deepClone(latestEvaluation) : null,
      selfPlayProgress: run.working?.selfPlayProgress ? deepClone(run.working.selfPlayProgress) : null,
      evaluationProgress: run.working?.evaluationProgress ? deepClone(run.working.evaluationProgress) : null,
      averageGameLength: Number(run.stats?.averageGameLength || 0),
      policyEntropy: Number(run.stats?.policyEntropy || 0),
      moveDiversity: Number(run.stats?.moveDiversity || 0),
      stopReason: run.stopReason || null,
      lastError: run?.lastError ? summarizeError(run.lastError) : null,
      timestamp: nowIso(),
      ...deepClone(overrides || {}),
    };
    run.live = deepClone(payload);
    return payload;
  }

  emitRunProgress(run, phase, overrides = {}) {
    if (!run) return null;
    const payload = this.buildRunProgressPayload(run, phase, overrides);
    const phaseKey = String(phase || '').toLowerCase();
    const shouldThrottle = phaseKey === 'selfplay' || phaseKey === 'training';
    const dispatchState = run.liveDispatchState || {};
    const lastEmittedAt = Number(dispatchState[phaseKey] || 0);
    const now = Date.now();
    if (shouldThrottle && (now - lastEmittedAt) < RUN_PROGRESS_EMIT_MIN_INTERVAL_MS) {
      run.liveDispatchState = dispatchState;
      return payload;
    }
    dispatchState[phaseKey] = now;
    run.liveDispatchState = dispatchState;
    eventBus.emit('ml:runProgress', payload);
    this.logRunEvent(run, 'run_progress', {
      phase: payload.phase,
      status: payload.status,
      cycle: payload.cycle,
      bestGeneration: payload.bestGeneration,
      workerGeneration: payload.workerGeneration,
      totalTrainingSteps: payload.totalTrainingSteps,
      totalSelfPlayGames: payload.totalSelfPlayGames,
      totalEvaluationGames: payload.totalEvaluationGames,
      totalPromotions: payload.totalPromotions,
      failedPromotions: payload.failedPromotions,
      stopReason: payload.stopReason || null,
      latestLoss: payload.latestLoss || null,
      latestEvaluation: payload.latestEvaluation || null,
    });
    return payload;
  }

  isCurrentRunTask(runId, taskState) {
    if (!runId || !taskState) return false;
    return this.runTasks.get(runId) === taskState;
  }

  shouldAbortRunTask(runId, taskState) {
    if (!runId || !taskState) return false;
    return Boolean(taskState.killRequested) || !this.isCurrentRunTask(runId, taskState);
  }

  async maybeSaveRunState(run, options = {}) {
    if (!this.persist || !run) return false;
    const force = options.force === true;
    const waitForCompletion = force || options.waitForCompletion === true;
    const now = Date.now();
    const lastPersistedAt = Number(run.lastPersistedAtMs || 0);
    if (!force && (now - lastPersistedAt) < RUN_STATE_SAVE_INTERVAL_MS) {
      return false;
    }
    run.lastPersistedAtMs = now;
    const savePromise = this.save();
    if (waitForCompletion) {
      await savePromise;
    }
    return true;
  }

  refreshRunWorkerGeneration(run, options = {}) {
    if (!run) return;
    const targetGeneration = Number(run.bestGeneration || 0);
    const force = options.force === true;
    run.cyclesSinceWorkerRefresh = Number(run.cyclesSinceWorkerRefresh || 0) + 1;
    if (
      force
      || !Number.isFinite(run.workerGeneration)
      || run.workerGeneration === targetGeneration
      || run.cyclesSinceWorkerRefresh >= clampPositiveInt(run?.config?.modelRefreshIntervalForWorkers, 5, 1, 1000)
    ) {
      run.workerGeneration = targetGeneration;
      run.pendingWorkerGeneration = null;
      run.cyclesSinceWorkerRefresh = 0;
      return;
    }
    run.pendingWorkerGeneration = targetGeneration;
  }

  chooseRunSelfPlayOpponentGeneration(run, rng) {
    const bestGeneration = Number(run?.workerGeneration || run?.bestGeneration || 0);
    const allGenerations = (run?.generations || [])
      .filter((generation) => generation?.approved !== false)
      .map((generation) => Number(generation?.generation))
      .filter((generation) => Number.isFinite(generation) && generation < bestGeneration);
    if (!allGenerations.length) return bestGeneration;
    const probability = Number(run?.config?.olderGenerationSampleProbability || 0);
    if ((typeof rng === 'function' ? rng() : Math.random()) >= probability) {
      return bestGeneration;
    }
    const stride = clampPositiveInt(run?.config?.generationComparisonStride, 5, 1, 1000);
    const candidateGenerations = allGenerations.filter((generation) => generation === 0 || ((bestGeneration - generation) % stride === 0));
    const source = candidateGenerations.length ? candidateGenerations : allGenerations;
    const index = Math.floor((typeof rng === 'function' ? rng() : Math.random()) * source.length);
    return source[index] ?? bestGeneration;
  }

  buildRunGameRecord(game, options = {}) {
    return {
      ...deepClone(game),
      phase: options.phase || 'selfplay',
      checkpointIndex: Number(options.checkpointIndex || 0),
      whiteGeneration: Number.isFinite(options.whiteGeneration) ? Number(options.whiteGeneration) : null,
      blackGeneration: Number.isFinite(options.blackGeneration) ? Number(options.blackGeneration) : null,
      retainedAt: nowIso(),
    };
  }

  getNextRunGenerationNumber(run) {
    const generations = Array.isArray(run?.generations) ? run.generations : [];
    if (!generations.length) return 0;
    return Math.max(...generations.map((generation) => Number(generation?.generation || 0))) + 1;
  }

  getApprovedRunGenerations(run) {
    return (run?.generations || [])
      .filter((generation) => generation?.approved !== false)
      .sort((left, right) => Number(left?.generation || 0) - Number(right?.generation || 0));
  }

  findContinueGenerationRecord(run) {
    if (!run) return null;
    const preferredGenerations = [
      Number(run?.workerGeneration),
      Number(run?.bestGeneration),
      Number(run?.working?.baseGeneration),
    ].filter((generation, index, source) => Number.isFinite(generation) && source.indexOf(generation) === index);
    for (let index = 0; index < preferredGenerations.length; index += 1) {
      const generationRecord = this.getRunGeneration(run, preferredGenerations[index]);
      if (isPromotedGenerationRecord(generationRecord)) {
        return generationRecord;
      }
    }
    const approvedGenerations = this.getApprovedRunGenerations(run)
      .filter((generation) => isPromotedGenerationRecord(generation));
    return approvedGenerations.length ? approvedGenerations[approvedGenerations.length - 1] : null;
  }

  ensureRunContinueState(run) {
    if (!run || typeof run !== 'object') return null;
    if (run?.working?.modelBundle) {
      return {
        source: 'working_state',
        generation: Number(run?.working?.baseGeneration || run?.workerGeneration || run?.bestGeneration || 0),
      };
    }
    const generationRecord = this.findContinueGenerationRecord(run);
    if (!generationRecord) return null;
    const restoredBundle = cloneModelBundle(generationRecord.modelBundle);
    run.working = {
      ...(run.working || {}),
      baseGeneration: Number(generationRecord.generation || 0),
      checkpointIndex: Number(run?.working?.checkpointIndex || 0),
      lastLoss: run?.working?.lastLoss ? deepClone(run.working.lastLoss) : (generationRecord.latestLoss ? deepClone(generationRecord.latestLoss) : null),
      modelBundle: restoredBundle,
      optimizerState: createOptimizerState(restoredBundle),
    };
    run.workerGeneration = Number(generationRecord.generation || 0);
    run.pendingWorkerGeneration = null;
    run.cyclesSinceWorkerRefresh = 0;
    run.updatedAt = nowIso();
    return {
      source: 'promoted_generation',
      generation: Number(generationRecord.generation || 0),
    };
  }

  canContinueRun(run) {
    const status = normalizeRunStatus(run?.status);
    if (!['stopped', 'error'].includes(status)) return false;
    return Boolean(run?.working?.modelBundle || this.findContinueGenerationRecord(run));
  }

  buildRunSeedSourceOption(run, generation) {
    if (!run || !isPromotedGenerationRecord(generation)) return null;
    const generationNumber = Number(generation?.generation || 0);
    if (generationNumber < 1) return null;
    return {
      id: buildPromotedModelBotId(run.id, generationNumber),
      value: buildPromotedModelBotId(run.id, generationNumber),
      type: 'promoted_generation',
      label: this.buildMlTestLabel(run, generation),
      notes: generation?.isBest ? 'Current promoted best generation' : 'Promoted generation',
      runId: run.id,
      runLabel: run.label || run.id,
      generation: generationNumber,
      generationLabel: generation?.label || `G${generationNumber}`,
      promotedAt: generation?.promotedAt || null,
      updatedAt: generation?.updatedAt || generation?.createdAt || run?.updatedAt || run?.createdAt || null,
      isBest: Boolean(generation?.isBest),
      status: run?.status || 'completed',
    };
  }

  getRunSeedLabel(config = {}) {
    if (config.seedMode === RUN_SEED_MODES.RANDOM) {
      const seedBundle = createDefaultModelBundle({
        seed: Number.isFinite(config.seed) ? config.seed : Date.now(),
      });
      return buildModelDescriptorLabel('Random', seedBundle);
    }
    if (config.seedMode === RUN_SEED_MODES.PROMOTED_GENERATION) {
      const sourceRun = this.getRunById(config.seedRunId);
      const sourceGeneration = this.getRunGeneration(sourceRun, config.seedGeneration);
      if (sourceRun && sourceGeneration) {
        return this.buildMlTestLabel(sourceRun, sourceGeneration);
      }
      return buildModelDescriptorLabel('Promoted', createDefaultModelBundle());
    }
    const bootstrapSnapshot = this.getBootstrapSnapshot();
    return bootstrapSnapshot
      ? buildModelDescriptorLabel('Bootstrap', bootstrapSnapshot.modelBundle)
      : buildModelDescriptorLabel('Bootstrap', createDefaultModelBundle());
  }

  listRunSeedSourceOptions() {
    const bootstrapSnapshot = this.getBootstrapSnapshot();
    const bootstrapBundle = bootstrapSnapshot?.modelBundle || createDefaultModelBundle();
    const randomBundle = createDefaultModelBundle();
    const builtins = [
      {
        id: RUN_SEED_MODES.BOOTSTRAP,
        value: RUN_SEED_MODES.BOOTSTRAP,
        type: 'bootstrap',
        label: buildModelDescriptorLabel('Bootstrap', bootstrapBundle),
        notes: 'Start from the preferred larger bootstrap baseline.',
      },
      {
        id: RUN_SEED_MODES.RANDOM,
        value: RUN_SEED_MODES.RANDOM,
        type: 'random',
        label: buildModelDescriptorLabel('Random', randomBundle),
        notes: 'Start from a fresh randomized model.',
      },
    ];
    const promoted = [];
    (this.state.runs || []).forEach((run) => {
      (run?.generations || []).forEach((generation) => {
        const entry = this.buildRunSeedSourceOption(run, generation);
        if (entry) {
          promoted.push(entry);
        }
      });
    });
    promoted.sort((left, right) => {
      const promotedDelta = parseTimeValue(right?.promotedAt) - parseTimeValue(left?.promotedAt);
      if (promotedDelta !== 0) return promotedDelta;
      const updatedDelta = parseTimeValue(right?.updatedAt) - parseTimeValue(left?.updatedAt);
      if (updatedDelta !== 0) return updatedDelta;
      const generationDelta = Number(right?.generation || 0) - Number(left?.generation || 0);
      if (generationDelta !== 0) return generationDelta;
      return String(left?.label || '').localeCompare(String(right?.label || ''));
    });
    return [...builtins, ...promoted];
  }

  resolveRunSeedBundle(config = {}) {
    if (config.seedMode === RUN_SEED_MODES.RANDOM) {
      return {
        seedBundle: createDefaultModelBundle({
          seed: Number.isFinite(config.seed) ? config.seed : Date.now(),
        }),
        seedSource: RUN_SEED_MODES.RANDOM,
      };
    }

    if (config.seedMode === RUN_SEED_MODES.PROMOTED_GENERATION) {
      const sourceRun = this.getRunById(config.seedRunId);
      if (!sourceRun) {
        const err = new Error(`Seed run ${config.seedRunId || 'unknown'} was not found`);
        err.statusCode = 400;
        err.code = 'seed_run_not_found';
        throw err;
      }
      const generationRecord = this.getRunGeneration(sourceRun, Number(config.seedGeneration));
      if (!isPromotedGenerationRecord(generationRecord)) {
        const err = new Error(`Seed generation G${Number(config.seedGeneration || 0)} is not available`);
        err.statusCode = 400;
        err.code = 'seed_generation_not_found';
        throw err;
      }
      return {
        seedBundle: cloneModelBundle(generationRecord.modelBundle),
        seedSource: buildPromotedModelBotId(sourceRun.id, generationRecord.generation),
      };
    }

    const snapshot = config.seedSnapshotId
      ? this.resolveSnapshot(config.seedSnapshotId)
      : this.getBootstrapSnapshot();
    return {
      seedBundle: snapshot?.modelBundle ? cloneModelBundle(snapshot.modelBundle) : createDefaultModelBundle({
        seed: Number.isFinite(config.seed) ? config.seed : Date.now(),
      }),
      seedSource: snapshot?.id ? `bootstrap:${snapshot.id}` : RUN_SEED_MODES.BOOTSTRAP,
    };
  }

  getActiveRunsExcluding(exceptRunId = '') {
    return (this.state.runs || [])
      .filter((run) => normalizeRunStatus(run?.status) === 'running' && run?.id !== exceptRunId);
  }

  async settleActiveRunsForActivation(options = {}) {
    const exceptRunId = typeof options.exceptRunId === 'string' ? options.exceptRunId : '';
    const activeRuns = this.getActiveRunsExcluding(exceptRunId);
    if (!activeRuns.length) {
      return [];
    }
    if (options.forceStopOtherRuns !== true) {
      const err = new Error('Another ML run is already active');
      err.statusCode = 409;
      err.code = 'active_run_conflict';
      err.activeRuns = activeRuns.map((run) => this.summarizeRun(run));
      throw err;
    }
    for (let index = 0; index < activeRuns.length; index += 1) {
      await this.stopRun(activeRuns[index].id);
    }
    const settleDeadline = Date.now() + 30000;
    while (this.getActiveRunsExcluding(exceptRunId).length) {
      if (Date.now() > settleDeadline) {
        const err = new Error('Other runs did not stop in time');
        err.statusCode = 409;
        err.code = 'active_run_conflict';
        err.activeRuns = this.getActiveRunsExcluding(exceptRunId)
          .map((run) => this.summarizeRun(run));
        throw err;
      }
      await sleep(100);
    }
    return activeRuns;
  }

  markRunBestGeneration(run, generationNumber) {
    (run?.generations || []).forEach((generation) => {
      generation.isBest = Number(generation?.generation) === Number(generationNumber);
      if (generation.isBest) {
        generation.approved = true;
        generation.promotedAt = generation.promotedAt || nowIso();
      }
    });
    run.bestGeneration = Number(generationNumber || 0);
  }

  selectEvaluationOpponentGenerations(run, bestGeneration) {
    const approvedGenerations = this.getApprovedRunGenerations(run)
      .map((generation) => Number(generation?.generation))
      .filter((generation) => Number.isFinite(generation));
    const stride = clampPositiveInt(run?.config?.generationComparisonStride, 5, 1, 1000);
    const opponents = approvedGenerations.filter((generation) => generation < bestGeneration && (
      generation === 0 || ((bestGeneration - generation) % stride === 0)
    ));
    return opponents;
  }

  getEvaluationBaselineInfo(evaluation) {
    if (!evaluation || typeof evaluation !== 'object') return null;
    return evaluation.baselineInfo || evaluation.gen0Info || evaluation.againstTarget || null;
  }

  filterRunTrainingSamplesByGeneration(training, generationNumber) {
    const generation = Number.isFinite(generationNumber) ? Number(generationNumber) : null;
    const filterItems = (items = []) => items.filter((sample) => (
      generation === null || Number(sample?.generation) === generation
    ));
    return {
      policySamples: filterItems(training?.policySamples || []),
      valueSamples: filterItems(training?.valueSamples || []),
      identitySamples: filterItems(training?.identitySamples || []),
    };
  }

  async getTrainingExecutionProfile(preferredBackend, devicePreference, options = {}) {
    const backend = normalizeTrainingBackend(preferredBackend, TRAINING_BACKENDS.AUTO);
    const device = normalizeTrainingDevicePreference(devicePreference, TRAINING_DEVICE_PREFERENCES.AUTO);
    if (backend === TRAINING_BACKENDS.NODE) {
      return {
        backend: TRAINING_BACKENDS.NODE,
        device: TRAINING_DEVICE_PREFERENCES.CPU,
      };
    }

    try {
      const bridge = getPythonTrainingBridge();
      const capabilities = await bridge.getCapabilities();
      if (device === TRAINING_DEVICE_PREFERENCES.CUDA && !capabilities?.cudaAvailable) {
        throw new Error('Python training backend is available, but CUDA is not available for PyTorch');
      }
      return {
        backend: TRAINING_BACKENDS.PYTHON,
        device: device === TRAINING_DEVICE_PREFERENCES.AUTO
          ? (capabilities?.cudaAvailable ? TRAINING_DEVICE_PREFERENCES.CUDA : TRAINING_DEVICE_PREFERENCES.CPU)
          : device,
        capabilities: capabilities || null,
      };
    } catch (err) {
      if (options.logErrors !== false) {
        this.logMlEvent('training_backend_resolution_error', {
          requestedBackend: backend,
          requestedDevicePreference: device,
          fallbackBackend: backend === TRAINING_BACKENDS.PYTHON ? null : TRAINING_BACKENDS.NODE,
          error: summarizeError(err),
        });
      }
      if (backend === TRAINING_BACKENDS.PYTHON || options.fallbackToNode !== true) {
        throw err;
      }
      return {
        backend: TRAINING_BACKENDS.NODE,
        device: TRAINING_DEVICE_PREFERENCES.CPU,
        error: err,
      };
    }
  }

  async getRecommendedRunConfigDefaults(preferredBackend = TRAINING_BACKENDS.AUTO, devicePreference = TRAINING_DEVICE_PREFERENCES.AUTO) {
    const defaults = createDefaultRunConfig();
    try {
      const backendResolution = await this.getTrainingExecutionProfile(preferredBackend, devicePreference, {
        logErrors: false,
        fallbackToNode: true,
      });
      defaults.batchSize = resolveRecommendedTrainingBatchSize(null, backendResolution, {
        policySampleCount: defaults.replayBufferMaxPositions,
      });
      defaults.trainingStepsPerCycle = resolveRecommendedRunTrainingStepsPerCycle(backendResolution);
    } catch (_) {}
    return defaults;
  }

  async resolveTrainingBatchSize(options = {}) {
    const backendResolution = await this.getTrainingExecutionProfile(
      options.trainingBackend,
      options.trainingDevicePreference,
      {
        logErrors: false,
        fallbackToNode: true,
      },
    );
    return resolveRecommendedTrainingBatchSize(
      options.batchSize,
      backendResolution,
      options.samples || {},
    );
  }

  async resolveEffectiveTrainingBackend(preferredBackend, devicePreference) {
    return this.getTrainingExecutionProfile(preferredBackend, devicePreference, {
      logErrors: true,
      fallbackToNode: true,
    });
  }

  async trainModelBundleBatch(options = {}) {
    const modelBundle = options.modelBundle || createDefaultModelBundle();
    const samples = options.samples || {};
    const trainingOptions = {
      learningRate: options.learningRate,
      batchSize: options.batchSize,
      weightDecay: options.weightDecay,
      gradientClipNorm: options.gradientClipNorm,
    };
    const preflightSummary = buildTrainingBatchDebugSummary({
      ...options,
      modelBundle,
      samples,
      ...trainingOptions,
    }, null);
    const debugIssues = getTrainingBatchDebugIssues(preflightSummary);
    const debugContext = options.debugContext || {};
    this.logMlEvent('training_batch_preflight', {
      ...preflightSummary,
      validationIssues: debugIssues,
    });
    if (debugContext.runId) {
      this.logRunEvent(debugContext.runId, 'training_batch_preflight', {
        ...preflightSummary,
        validationIssues: debugIssues,
      });
    }
    if (debugContext.trainingRunId) {
      this.logTrainingEvent(debugContext.trainingRunId, 'training_batch_preflight', {
        ...preflightSummary,
        validationIssues: debugIssues,
      });
    }
    if (debugIssues.length) {
      const err = new Error(`Training batch validation failed: ${debugIssues.join('; ')}`);
      err.code = 'ML_TRAINING_BATCH_INVALID';
      err.details = {
        summary: preflightSummary,
        issues: debugIssues,
      };
      this.logMlEvent('training_batch_invalid', {
        ...preflightSummary,
        validationIssues: debugIssues,
      });
      if (debugContext.runId) {
        this.logRunEvent(debugContext.runId, 'training_batch_invalid', {
          ...preflightSummary,
          validationIssues: debugIssues,
        });
      }
      if (debugContext.trainingRunId) {
        this.logTrainingEvent(debugContext.trainingRunId, 'training_batch_invalid', {
          ...preflightSummary,
          validationIssues: debugIssues,
        });
      }
      throw err;
    }
    const backendResolution = await this.resolveEffectiveTrainingBackend(
      options.trainingBackend,
      options.trainingDevicePreference,
    );
    const effectiveTrainingOptions = {
      ...trainingOptions,
      batchSize: resolveRecommendedTrainingBatchSize(trainingOptions.batchSize, backendResolution, samples),
    };
    const debugSummary = buildTrainingBatchDebugSummary({
      ...options,
      modelBundle,
      samples,
      ...effectiveTrainingOptions,
    }, backendResolution);
    this.logMlEvent('training_batch_resolution', debugSummary);
    if (debugContext.runId) {
      this.logRunEvent(debugContext.runId, 'training_batch_resolution', debugSummary);
    }
    if (debugContext.trainingRunId) {
      this.logTrainingEvent(debugContext.trainingRunId, 'training_batch_resolution', debugSummary);
    }

    if (backendResolution.backend === TRAINING_BACKENDS.PYTHON) {
      const bridge = getPythonTrainingBridge();
      const payloadBundle = cloneModelBundle(modelBundle);
      payloadBundle.identity = {
        ...payloadBundle.identity,
        inferredIdentities: INFERRED_IDENTITIES.slice(),
      };
      try {
        const result = await bridge.trainBatch({
          devicePreference: backendResolution.device,
          epochs: Math.max(1, Number(options.epochs || 1)),
          modelBundle: payloadBundle,
          optimizerState: deepClone(options.optimizerState || null),
          trainingOptions: deepClone(effectiveTrainingOptions),
          inferredIdentities: INFERRED_IDENTITIES.slice(),
          samples: {
            policySamples: deepClone(samples.policySamples || []),
            valueSamples: deepClone(samples.valueSamples || []),
            identitySamples: deepClone(samples.identitySamples || []),
          },
        });
        return {
          backend: TRAINING_BACKENDS.PYTHON,
          device: result.device || backendResolution.device,
          modelBundle: result.modelBundle ? cloneModelBundle(result.modelBundle) : cloneModelBundle(modelBundle),
          optimizerState: result.optimizerState ? deepClone(result.optimizerState) : null,
          history: Array.isArray(result.history) ? result.history.map((entry) => deepClone(entry)) : [],
          capabilities: backendResolution.capabilities || null,
        };
      } catch (err) {
        this.logMlEvent('training_batch_python_error', {
          summary: debugSummary,
          error: summarizeError(err),
          capabilities: backendResolution.capabilities || null,
        });
        if (debugContext.runId) {
          this.logRunEvent(debugContext.runId, 'training_batch_python_error', {
            summary: debugSummary,
            error: summarizeError(err),
          });
        }
        if (debugContext.trainingRunId) {
          this.logTrainingEvent(debugContext.trainingRunId, 'training_batch_python_error', {
            summary: debugSummary,
            error: summarizeError(err),
          });
        }
        throw err;
      }
    }

    if (String(modelBundle?.family || '').trim().toLowerCase() === SHARED_MODEL_FAMILY) {
      const result = trainSharedModelBundleBatch(modelBundle, {
        policySamples: deepClone(samples.policySamples || []),
        valueSamples: deepClone(samples.valueSamples || []),
        identitySamples: deepClone(samples.identitySamples || []),
      }, {
        ...effectiveTrainingOptions,
        epochs: Math.max(1, Number(options.epochs || 1)),
        optimizerState: deepClone(options.optimizerState || null),
      });
      return {
        backend: TRAINING_BACKENDS.NODE,
        device: TRAINING_DEVICE_PREFERENCES.CPU,
        modelBundle: cloneModelBundle(result.modelBundle || modelBundle),
        optimizerState: deepClone(result.optimizerState || null),
        history: Array.isArray(result.history) ? result.history.map((entry) => deepClone(entry)) : [],
      };
    }

    const initialOptimizerState = (
      options.optimizerState
      && isNodeAdamOptimizerState(options.optimizerState.policy)
      && isNodeAdamOptimizerState(options.optimizerState.value)
      && isNodeAdamOptimizerState(options.optimizerState.identity)
    )
      ? options.optimizerState
      : createOptimizerState(modelBundle);

    const trainedBundle = modelBundle;
    const optimizerState = {
      policy: initialOptimizerState.policy,
      value: initialOptimizerState.value,
      identity: initialOptimizerState.identity,
    };
    const headTaskPayloads = [];
    if (Array.isArray(samples.policySamples) && samples.policySamples.length) {
      headTaskPayloads.push({
        type: 'trainHead',
        head: 'policy',
        modelBundle: cloneModelBundle(trainedBundle),
        samples: deepClone(samples.policySamples),
        trainingOptions: deepClone(effectiveTrainingOptions),
        optimizerState: deepClone(optimizerState.policy || null),
      });
    }
    if (Array.isArray(samples.valueSamples) && samples.valueSamples.length) {
      headTaskPayloads.push({
        type: 'trainHead',
        head: 'value',
        modelBundle: cloneModelBundle(trainedBundle),
        samples: deepClone(samples.valueSamples),
        trainingOptions: deepClone(effectiveTrainingOptions),
        optimizerState: deepClone(optimizerState.value || null),
      });
    }
    if (Array.isArray(samples.identitySamples) && samples.identitySamples.length) {
      headTaskPayloads.push({
        type: 'trainHead',
        head: 'identity',
        modelBundle: cloneModelBundle(trainedBundle),
        samples: deepClone(samples.identitySamples),
        trainingOptions: deepClone(effectiveTrainingOptions),
        optimizerState: deepClone(optimizerState.identity || null),
      });
    }

    const headResults = await runParallelWorkerTasks(
      headTaskPayloads,
      clampPositiveInt(options.parallelTrainingHeadWorkers, 1, 1, 3),
      {
        preferWorkerExecution: true,
        runTask: async (taskPayload) => {
          const head = taskPayload?.head;
          if (head === 'policy') {
            const result = trainPolicyModel(taskPayload.modelBundle, taskPayload.samples, {
              ...(taskPayload.trainingOptions || {}),
              optimizerState: taskPayload.optimizerState || null,
            });
            return {
              head,
              updatedModel: taskPayload.modelBundle?.policy || null,
              optimizerState: result.optimizerState || null,
              metrics: {
                samples: Number(result.samples || 0),
                loss: Number(result.loss || 0),
              },
            };
          }
          if (head === 'value') {
            const result = trainValueModel(taskPayload.modelBundle, taskPayload.samples, {
              ...(taskPayload.trainingOptions || {}),
              optimizerState: taskPayload.optimizerState || null,
            });
            return {
              head,
              updatedModel: taskPayload.modelBundle?.value || null,
              optimizerState: result.optimizerState || null,
              metrics: {
                samples: Number(result.samples || 0),
                loss: Number(result.loss || 0),
              },
            };
          }
          const result = trainIdentityModel(taskPayload.modelBundle, taskPayload.samples, {
            ...(taskPayload.trainingOptions || {}),
            optimizerState: taskPayload.optimizerState || null,
          });
          return {
            head: 'identity',
            updatedModel: taskPayload.modelBundle?.identity || null,
            optimizerState: result.optimizerState || null,
            metrics: {
              samples: Number(result.samples || 0),
              loss: Number(result.loss || 0),
              accuracy: Number(result.accuracy || 0),
            },
          };
        },
      },
    );

    const lossEntry = {
      epoch: 1,
      policyLoss: 0,
      valueLoss: 0,
      identityLoss: 0,
      identityAccuracy: 0,
      policySamples: 0,
      valueSamples: 0,
      identitySamples: 0,
    };

    headResults.forEach((result) => {
      const head = String(result?.head || '').trim().toLowerCase();
      if (head === 'policy') {
        if (result.updatedModel) trainedBundle.policy = result.updatedModel;
        optimizerState.policy = result.optimizerState || optimizerState.policy;
        lossEntry.policyLoss = Number(result?.metrics?.loss || 0);
        lossEntry.policySamples = Number(result?.metrics?.samples || 0);
        return;
      }
      if (head === 'value') {
        if (result.updatedModel) trainedBundle.value = result.updatedModel;
        optimizerState.value = result.optimizerState || optimizerState.value;
        lossEntry.valueLoss = Number(result?.metrics?.loss || 0);
        lossEntry.valueSamples = Number(result?.metrics?.samples || 0);
        return;
      }
      if (head === 'identity') {
        if (result.updatedModel) trainedBundle.identity = result.updatedModel;
        optimizerState.identity = result.optimizerState || optimizerState.identity;
        lossEntry.identityLoss = Number(result?.metrics?.loss || 0);
        lossEntry.identitySamples = Number(result?.metrics?.samples || 0);
        lossEntry.identityAccuracy = Number(result?.metrics?.accuracy || 0);
      }
    });

    return {
      backend: TRAINING_BACKENDS.NODE,
      device: TRAINING_DEVICE_PREFERENCES.CPU,
      modelBundle: trainedBundle,
      optimizerState,
      history: [lossEntry],
    };
  }

  buildRunGameTaskPayload(run, options = {}) {
    const whiteGeneration = Number(options.whiteGeneration);
    const blackGeneration = Number(options.blackGeneration);
    const whiteParticipant = this.createGenerationParticipant(run, whiteGeneration);
    const blackParticipant = this.createGenerationParticipant(run, blackGeneration);
    if (!whiteParticipant || !blackParticipant) {
      throw new Error(`Missing generation participant for replay/evaluation game ${whiteGeneration} vs ${blackGeneration}`);
    }
    return {
      type: 'playGame',
      options: {
        gameId: options.gameId || this.nextId('game'),
        whiteParticipant,
        blackParticipant,
        seed: options.seed,
        maxPlies: options.maxPlies,
        iterations: options.iterations,
        maxDepth: options.maxDepth,
        hypothesisCount: options.hypothesisCount,
        riskBias: options.riskBias,
        exploration: options.exploration,
        adaptiveSearch: options.adaptiveSearch !== false,
      },
      meta: {
        whiteGeneration,
        blackGeneration,
      },
    };
  }

  async playRunGenerationGames(run, options = {}) {
    const gameCount = clampPositiveInt(options.gameCount, 1, 1, 400);
    const phase = options.phase || 'selfplay';
    const baseSeed = Number.isFinite(options.seed) ? Math.floor(options.seed) : Date.now();
    const checkpointIndex = Number(options.checkpointIndex || 0);
    const gameIndexOffset = clampPositiveInt(options.gameIndexOffset, 0, 0, 1000000);
    const taskState = options.taskState || null;
    const maxPlies = run?.config?.maxDepth ? Math.max(60, run.config.maxDepth * 8) : 120;
    const taskPayloads = [];

    for (let index = 0; index < gameCount; index += 1) {
      if (taskState?.cancelRequested) break;
      const gameIndex = gameIndexOffset + index;
      const shouldSwap = Boolean(options.alternateColors !== false) && (gameIndex % 2 === 1);
      const whiteGeneration = shouldSwap ? Number(options.blackGeneration) : Number(options.whiteGeneration);
      const blackGeneration = shouldSwap ? Number(options.whiteGeneration) : Number(options.blackGeneration);
      taskPayloads.push(this.buildRunGameTaskPayload(run, {
        gameId: this.nextId('game'),
        whiteGeneration,
        blackGeneration,
        seed: baseSeed + (gameIndex * 7919),
        maxPlies,
        iterations: run?.config?.numMctsSimulationsPerMove,
        maxDepth: run?.config?.maxDepth,
        hypothesisCount: run?.config?.hypothesisCount,
        riskBias: run?.config?.riskBias,
        exploration: run?.config?.exploration,
        adaptiveSearch: phase !== 'evaluation',
      }));
    }

    const workerCount = resolveParallelGameWorkers(
      run?.config?.parallelGameWorkers,
      taskPayloads.length || gameCount,
    );
    const workerPool = this.runTasks.size <= 1 ? this.parallelTaskPool : null;

    const games = await runParallelWorkerTasks(taskPayloads, workerCount, {
      shouldStop: () => Boolean(taskState?.cancelRequested),
      preferWorkerExecution: true,
      workerPool,
      runTask: async (taskPayload) => {
        if (taskState?.cancelRequested) return null;
        return this.runSingleGameFast(taskPayload.options || {});
      },
    });

    return games
      .map((game, index) => (game ? this.buildRunGameRecord(game, {
        phase,
        checkpointIndex,
        whiteGeneration: taskPayloads[index]?.meta?.whiteGeneration,
        blackGeneration: taskPayloads[index]?.meta?.blackGeneration,
      }) : null))
      .filter(Boolean);
  }

  getRunEvaluationChunkSize(run, gameCount) {
    const totalGames = clampPositiveInt(gameCount, 1, 1, 400);
    const workerCount = resolveParallelGameWorkers(run?.config?.parallelGameWorkers, totalGames);
    const chunkSize = Math.max(workerCount, Math.min(RUN_EVAL_PROGRESS_MAX_CHUNK_GAMES, workerCount * 4));
    return Math.min(totalGames, chunkSize);
  }

  getRunSelfPlayChunkSize(run, gameCount) {
    const totalGames = clampPositiveInt(gameCount, 1, 1, 400);
    const workerCount = resolveParallelGameWorkers(run?.config?.parallelGameWorkers, totalGames);
    return Math.min(totalGames, workerCount);
  }

  async playRunGenerationGamesChunked(run, options = {}) {
    const totalGames = clampPositiveInt(options.gameCount, 1, 1, 400);
    const phase = String(options.phase || '').toLowerCase();
    const chunkSize = phase === 'selfplay'
      ? this.getRunSelfPlayChunkSize(run, totalGames)
      : this.getRunEvaluationChunkSize(run, totalGames);
    const allGames = [];
    for (let completedGames = 0; completedGames < totalGames; completedGames += chunkSize) {
      if (options?.taskState?.cancelRequested) break;
      const nextChunkSize = Math.min(chunkSize, totalGames - completedGames);
      const chunkGames = await this.playRunGenerationGames(run, {
        ...options,
        gameCount: nextChunkSize,
        gameIndexOffset: completedGames,
      });
      if (Array.isArray(chunkGames) && chunkGames.length) {
        allGames.push(...chunkGames);
      }
      if (typeof options.onChunk === 'function') {
        await options.onChunk(chunkGames, {
          completedGames: allGames.length,
          targetGames: totalGames,
          chunkSize: nextChunkSize,
        });
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    return allGames;
  }

  summarizeGenerationMatchup(games, candidateGeneration, opponentGeneration) {
    let wins = 0;
    let losses = 0;
    let draws = 0;
    (Array.isArray(games) ? games : []).forEach((game) => {
      if (game?.winner === null || game?.winner === undefined) {
        draws += 1;
        return;
      }
      const candidateColor = Number(game?.whiteGeneration) === Number(candidateGeneration) ? WHITE : BLACK;
      if (Number(game.winner) === candidateColor) wins += 1;
      else losses += 1;
    });
    const gamesPlayed = wins + losses + draws;
    const winRate = safeWinRate(wins, losses, draws);
    return {
      generation: Number(opponentGeneration),
      games: gamesPlayed,
      wins,
      losses,
      draws,
      winRate,
      eloDelta: estimateEloDeltaFromWinRate(winRate),
    };
  }

  getRunEvaluationTargetGeneration(run) {
    if (!run) return 0;
    const bestGeneration = Math.max(0, Number(run.bestGeneration || 0));
    const approvedGenerations = this.getApprovedRunGenerations(run)
      .map((generation) => Number(generation?.generation))
      .filter((generation) => Number.isFinite(generation) && generation <= bestGeneration);
    if (!approvedGenerations.length) return bestGeneration;
    const storedTarget = Number.isFinite(run?.evaluationTargetGeneration)
      ? Number(run.evaluationTargetGeneration)
      : approvedGenerations[0];
    if (storedTarget >= bestGeneration) return bestGeneration;
    if (approvedGenerations.includes(storedTarget)) return storedTarget;
    const nextTarget = approvedGenerations.find((generation) => generation >= storedTarget);
    return Number.isFinite(nextTarget) ? nextTarget : approvedGenerations[approvedGenerations.length - 1];
  }

  advanceRunEvaluationTargetGeneration(run, completedTargetGeneration) {
    if (!run) return this.getRunEvaluationTargetGeneration(run);
    const bestGeneration = Math.max(0, Number(run.bestGeneration || 0));
    const approvedGenerations = this.getApprovedRunGenerations(run)
      .map((generation) => Number(generation?.generation))
      .filter((generation) => Number.isFinite(generation) && generation <= bestGeneration);
    if (!approvedGenerations.length) {
      run.evaluationTargetGeneration = bestGeneration;
      return run.evaluationTargetGeneration;
    }
    const nextTarget = approvedGenerations.find((generation) => generation > Number(completedTargetGeneration));
    run.evaluationTargetGeneration = Number.isFinite(nextTarget) ? nextTarget : bestGeneration;
    return run.evaluationTargetGeneration;
  }

  countRunBaselinePerfectSweepStreak(run, targetGeneration) {
    const evaluations = Array.isArray(run?.evaluationHistory) ? run.evaluationHistory : [];
    let streak = 0;
    for (let index = evaluations.length - 1; index >= 0; index -= 1) {
      const evaluation = evaluations[index];
      const baselineInfo = this.getEvaluationBaselineInfo(evaluation);
      const baselineGeneration = Number.isFinite(evaluation?.targetGeneration)
        ? Number(evaluation.targetGeneration)
        : Number(baselineInfo?.generation);
      if (!Number.isFinite(baselineGeneration) || baselineGeneration !== Number(targetGeneration)) {
        break;
      }
      if (Number(baselineInfo?.winRate || 0) < 1) {
        break;
      }
      streak += 1;
    }
    return streak;
  }

  listRunPromotedGenerations(run) {
    return (run?.generations || [])
      .filter((generation) => (
        generation
        && generation.approved !== false
        && Number.isFinite(generation.generation)
        && Number(generation.generation) <= Number(run?.bestGeneration || 0)
      ))
      .sort((left, right) => Number(right.generation || 0) - Number(left.generation || 0));
  }

  listRunPromotionOpponents(run, candidateGeneration, limit) {
    return this.listRunPromotedGenerations(run)
      .filter((generation) => Number(generation.generation) < Number(candidateGeneration || 0))
      .slice(0, clampPositiveInt(limit, 3, 1, 10));
  }

  recordRunEvaluationGames(run, candidateGenerationRecord, games = []) {
    if (!Array.isArray(games) || !games.length) return;
    this.retainRunGames(run, games);
    this.recordRunGameDurations(run, games, 'evaluation');
    run.stats.totalEvaluationGames = Number(run.stats.totalEvaluationGames || 0) + games.length;
    if (candidateGenerationRecord) {
      candidateGenerationRecord.stats.evaluationGames = Number(candidateGenerationRecord.stats?.evaluationGames || 0) + games.length;
    }
  }

  buildRunEvaluationProgress(options = {}) {
    const summary = options.summary || null;
    return {
      active: options.active !== false,
      checkpointIndex: Number(options.checkpointIndex || 0),
      candidateGeneration: Number(options.candidateGeneration || 0),
      stage: String(options.stage || 'baseline'),
      stageLabel: options.stageLabel || null,
      opponentGeneration: Number.isFinite(Number(options.opponentGeneration))
        ? Number(options.opponentGeneration)
        : null,
      opponentLabel: options.opponentLabel || null,
      completedGames: Number(options.completedGames || 0),
      targetGames: Number(options.targetGames || 0),
      requiredWinRate: Number.isFinite(Number(options.requiredWinRate))
        ? Number(options.requiredWinRate)
        : null,
      wins: Number(summary?.wins || 0),
      losses: Number(summary?.losses || 0),
      draws: Number(summary?.draws || 0),
      winRate: Number(summary?.winRate || 0),
    };
  }

  buildRunSelfPlayProgress(options = {}) {
    return {
      active: options.active !== false,
      cycle: Number(options.cycle || 0),
      workerGeneration: Number(options.workerGeneration || 0),
      opponentGeneration: Number.isFinite(Number(options.opponentGeneration))
        ? Number(options.opponentGeneration)
        : null,
      completedGames: Number(options.completedGames || 0),
      targetGames: Number(options.targetGames || 0),
      latestGameId: options.latestGameId || null,
    };
  }

  async updateRunSelfPlayProgress(run, options = {}) {
    if (!run?.working) run.working = {};
    const progress = this.buildRunSelfPlayProgress(options);
    run.working.selfPlayProgress = progress;
    run.updatedAt = nowIso();
    this.emitRunProgress(run, 'selfplay', {
      selfPlayProgress: progress,
      latestGameId: options.latestGameId || null,
      replayBuffer: options.replayBuffer || this.summarizeRunReplayBuffer(run),
    });
    await this.maybeSaveRunState(run);
    return progress;
  }

  clearRunSelfPlayProgress(run) {
    if (!run?.working) return;
    run.working.selfPlayProgress = null;
  }

  async updateRunEvaluationProgress(run, options = {}) {
    if (!run?.working) run.working = {};
    const progress = this.buildRunEvaluationProgress(options);
    run.working.evaluationProgress = progress;
    run.updatedAt = nowIso();
    this.emitRunProgress(run, 'evaluation', {
      evaluationProgress: progress,
    });
    await this.maybeSaveRunState(run);
    return progress;
  }

  clearRunEvaluationProgress(run) {
    if (!run?.working) return;
    run.working.evaluationProgress = null;
  }

  createEvaluationTooltipSections(evaluation) {
    const sections = [];
    const appendSection = (title, entry, extra = {}) => {
      if (!entry || !Number.isFinite(Number(entry.generation))) return;
      sections.push({
        title,
        generation: Number(entry.generation),
        winRate: Number(entry.winRate || 0),
        wins: Number(entry.wins || 0),
        losses: Number(entry.losses || 0),
        draws: Number(entry.draws || 0),
        games: Number(entry.games || 0),
        passed: extra.passed === true ? true : (extra.passed === false ? false : null),
        requiredWinRate: Number.isFinite(extra.requiredWinRate) ? Number(extra.requiredWinRate) : null,
      });
    };

    appendSection('Baseline', this.getEvaluationBaselineInfo(evaluation));
    appendSection('Pre-promotion', evaluation?.prePromotionTest, {
      passed: evaluation?.prePromotionPassed,
      requiredWinRate: evaluation?.prePromotionRequiredWinRate,
    });
    (evaluation?.promotionTests || []).forEach((entry) => {
      appendSection('Promotion', entry, {
        passed: entry?.passed,
        requiredWinRate: evaluation?.promotionTestRequiredWinRate,
      });
    });
    return sections;
  }

  async evaluateRunGeneration(run, candidateGenerationRecord, taskState) {
    const bestGeneration = Math.max(0, Number(run.bestGeneration || 0));
    const candidateGeneration = Number(candidateGenerationRecord?.generation || 0);
    const baselineTargetGeneration = this.getRunEvaluationTargetGeneration(run);
    const prePromotionGamesRequired = clampPositiveInt(run?.config?.prePromotionTestGames, 50, 1, 400);
    const prePromotionWinRateRequired = normalizeFloat(run?.config?.prePromotionTestWinRate, 0.55, 0, 1);
    const promotionTestGamesRequired = clampPositiveInt(run?.config?.promotionTestGames, 100, 1, 400);
    const promotionTestWinRateRequired = normalizeFloat(run?.config?.promotionTestWinRate, 0.55, 0, 1);
    const promotionOpponentLimit = clampPositiveInt(run?.config?.promotionTestPriorGenerations, 3, 1, 10);
    const checkpointIndex = Number(run.working?.checkpointIndex || 0);
    const baselineGames = [];
    const prePromotionGames = [];
    let baselineInfo = null;
    let prePromotionTest = null;
    let prePromotionPassed = false;
    let targetPerfectSweepStreak = 0;
    let targetAdvanced = false;
    let nextEvaluationTargetGeneration = baselineTargetGeneration;
    const promotionTests = [];

    try {
      const playedBaselineGames = await this.playRunGenerationGamesChunked(run, {
        phase: 'evaluation',
        whiteGeneration: candidateGeneration,
        blackGeneration: baselineTargetGeneration,
        gameCount: RUN_EVAL_BASELINE_GAMES,
        checkpointIndex,
        taskState,
        onChunk: async (chunkGames, progressState) => {
          baselineGames.push(...(Array.isArray(chunkGames) ? chunkGames : []));
          this.recordRunEvaluationGames(run, candidateGenerationRecord, chunkGames);
          const summary = this.summarizeGenerationMatchup(
            baselineGames,
            candidateGeneration,
            baselineTargetGeneration,
          );
          await this.updateRunEvaluationProgress(run, {
            checkpointIndex,
            candidateGeneration,
            stage: 'baseline',
            stageLabel: 'Baseline',
            opponentGeneration: baselineTargetGeneration,
            opponentLabel: `G${baselineTargetGeneration}`,
            completedGames: progressState.completedGames,
            targetGames: progressState.targetGames,
            summary,
          });
        },
      });
      baselineInfo = this.summarizeGenerationMatchup(
        playedBaselineGames,
        candidateGeneration,
        baselineTargetGeneration,
      );
      const previousPerfectSweepStreak = this.countRunBaselinePerfectSweepStreak(run, baselineTargetGeneration);
      targetPerfectSweepStreak = Number(baselineInfo?.winRate || 0) >= 1
        ? previousPerfectSweepStreak + 1
        : 0;
      nextEvaluationTargetGeneration = targetPerfectSweepStreak >= RUN_EVAL_BASELINE_ADVANCE_STREAK
        ? this.advanceRunEvaluationTargetGeneration(run, baselineTargetGeneration)
        : baselineTargetGeneration;
      targetAdvanced = Number(nextEvaluationTargetGeneration) !== baselineTargetGeneration;
      if (!targetAdvanced) {
        run.evaluationTargetGeneration = baselineTargetGeneration;
      }

      const playedPrePromotionGames = await this.playRunGenerationGamesChunked(run, {
        phase: 'evaluation',
        whiteGeneration: candidateGeneration,
        blackGeneration: bestGeneration,
        gameCount: prePromotionGamesRequired,
        checkpointIndex,
        taskState,
        onChunk: async (chunkGames, progressState) => {
          prePromotionGames.push(...(Array.isArray(chunkGames) ? chunkGames : []));
          this.recordRunEvaluationGames(run, candidateGenerationRecord, chunkGames);
          const summary = this.summarizeGenerationMatchup(
            prePromotionGames,
            candidateGeneration,
            bestGeneration,
          );
          await this.updateRunEvaluationProgress(run, {
            checkpointIndex,
            candidateGeneration,
            stage: 'pre_promotion',
            stageLabel: 'Pre-promotion',
            opponentGeneration: bestGeneration,
            opponentLabel: `G${bestGeneration}`,
            completedGames: progressState.completedGames,
            targetGames: progressState.targetGames,
            requiredWinRate: prePromotionWinRateRequired,
            summary,
          });
        },
      });
      prePromotionTest = this.summarizeGenerationMatchup(
        playedPrePromotionGames,
        candidateGeneration,
        bestGeneration,
      );
      prePromotionPassed = Boolean(
        prePromotionTest
        && Number(prePromotionTest.winRate || 0) >= prePromotionWinRateRequired
      );

      const promotionOpponents = this.listRunPromotionOpponents(run, candidateGeneration, promotionOpponentLimit);
      if (prePromotionPassed && !taskState?.cancelRequested) {
        for (const opponent of promotionOpponents) {
          const promotionGames = [];
          const opponentGeneration = Number(opponent.generation);
          const opponentLabel = opponent.label || `G${opponent.generation}`;
          const playedPromotionGames = await this.playRunGenerationGamesChunked(run, {
            phase: 'evaluation',
            whiteGeneration: candidateGeneration,
            blackGeneration: opponentGeneration,
            gameCount: promotionTestGamesRequired,
            checkpointIndex,
            taskState,
            onChunk: async (chunkGames, progressState) => {
              promotionGames.push(...(Array.isArray(chunkGames) ? chunkGames : []));
              this.recordRunEvaluationGames(run, candidateGenerationRecord, chunkGames);
              const summary = this.summarizeGenerationMatchup(
                promotionGames,
                candidateGeneration,
                opponentGeneration,
              );
              await this.updateRunEvaluationProgress(run, {
                checkpointIndex,
                candidateGeneration,
                stage: 'promotion',
                stageLabel: 'Promotion',
                opponentGeneration,
                opponentLabel,
                completedGames: progressState.completedGames,
                targetGames: progressState.targetGames,
                requiredWinRate: promotionTestWinRateRequired,
                summary,
              });
            },
          });
          const summary = this.summarizeGenerationMatchup(
            playedPromotionGames,
            candidateGeneration,
            opponentGeneration,
          );
          promotionTests.push({
            ...summary,
            label: opponentLabel,
            passed: Boolean(summary && Number(summary.winRate || 0) >= promotionTestWinRateRequired),
          });
        }
      }

      const promoted = Boolean(
        prePromotionPassed
        && promotionTests.length > 0
        && promotionTests.every((entry) => entry?.passed)
      );
      const tooltipSections = this.createEvaluationTooltipSections({
        baselineInfo,
        gen0Info: baselineInfo,
        prePromotionTest,
        prePromotionPassed,
        prePromotionRequiredWinRate: prePromotionWinRateRequired,
        promotionTests,
        promotionTestRequiredWinRate: promotionTestWinRateRequired,
      });

      return {
        id: `${run.id}:eval:${String(checkpointIndex).padStart(4, '0')}`,
        checkpointIndex,
        evaluatedAt: nowIso(),
        candidateGeneration,
        bestGenerationAtEvaluation: bestGeneration,
        promoted,
        baselineInfo,
        gen0Info: baselineInfo,
        prePromotionTest: prePromotionTest
          ? {
            ...prePromotionTest,
            passed: prePromotionPassed,
          }
          : null,
        prePromotionPassed,
        prePromotionRequiredWinRate: prePromotionWinRateRequired,
        promotionTests,
        promotionTestGames: promotionTestGamesRequired,
        promotionTestRequiredWinRate: promotionTestWinRateRequired,
        promotionOpponentLimit,
        againstBest: prePromotionTest,
        againstTarget: baselineInfo,
        againstGenerations: promotionTests,
        targetGeneration: baselineTargetGeneration,
        targetWinRateThreshold: null,
        targetAdvanced,
        targetAdvancedToGeneration: targetAdvanced ? nextEvaluationTargetGeneration : baselineTargetGeneration,
        targetPerfectSweepStreak,
        targetPerfectSweepRequired: RUN_EVAL_BASELINE_ADVANCE_STREAK,
        tooltipSections,
        loss: candidateGenerationRecord.latestLoss ? deepClone(candidateGenerationRecord.latestLoss) : null,
      };
    } finally {
      this.clearRunEvaluationProgress(run);
    }
  }

  async trainRunWorkingModel(run, taskState) {
    const steps = clampPositiveInt(run?.config?.trainingStepsPerCycle, 1, 1, 5000);
    const losses = [];
    for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
      if (taskState?.cancelRequested) break;
      const batch = this.sampleReplayBufferSamples(run);
      if (!batch.policySamples.length && !batch.valueSamples.length && !batch.identitySamples.length) {
        break;
      }
      const trainingOptions = {
        learningRate: run?.config?.learningRate,
        batchSize: run?.config?.batchSize,
        weightDecay: run?.config?.weightDecay,
        gradientClipNorm: run?.config?.gradientClipNorm,
      };
      const trainingResult = await this.trainModelBundleBatch({
        modelBundle: run.working.modelBundle,
        optimizerState: run.working.optimizerState,
        samples: batch,
        ...trainingOptions,
        epochs: 1,
        trainingBackend: run?.config?.trainingBackend,
        trainingDevicePreference: run?.config?.trainingDevicePreference,
        parallelTrainingHeadWorkers: run?.config?.parallelTrainingHeadWorkers,
        debugContext: {
          runId: run.id,
          cycle: Number(run.stats?.cycle || 0),
          step: Number(run.stats?.totalTrainingSteps || 0) + 1,
          checkpointIndex: Number(run.working?.checkpointIndex || 0),
          source: 'continuous_run_training',
        },
      });
      if (this.shouldAbortRunTask(run.id, taskState)) {
        return losses;
      }
      run.working.modelBundle = trainingResult.modelBundle;
      run.working.optimizerState = trainingResult.optimizerState || run.working.optimizerState;
      const latestMetrics = Array.isArray(trainingResult.history) && trainingResult.history.length
        ? trainingResult.history[trainingResult.history.length - 1]
        : {};

      const lossEntry = {
        step: Number(run.stats?.totalTrainingSteps || 0) + 1,
        policyLoss: Number(latestMetrics.policyLoss || 0),
        valueLoss: Number(latestMetrics.valueLoss || 0),
        identityLoss: Number(latestMetrics.identityLoss || 0),
        identityAccuracy: Number(latestMetrics.identityAccuracy || 0),
        policySamples: Number(latestMetrics.policySamples || 0),
        valueSamples: Number(latestMetrics.valueSamples || 0),
        identitySamples: Number(latestMetrics.identitySamples || 0),
        trainingBackend: trainingResult.backend || TRAINING_BACKENDS.NODE,
        trainingDevice: trainingResult.device || TRAINING_DEVICE_PREFERENCES.CPU,
      };
      run.working.lastLoss = deepClone(lossEntry);
      run.stats.totalTrainingSteps = Number(run.stats.totalTrainingSteps || 0) + 1;
      losses.push(lossEntry);
      this.emitRunProgress(run, 'training', {
        latestLoss: lossEntry,
      });
      let didEvaluateThisStep = false;
      if ((run.stats.totalTrainingSteps % clampPositiveInt(run.config?.checkpointInterval, DEFAULT_RUN_CHECKPOINT_INTERVAL, 1, 100000)) === 0) {
        run.working.checkpointIndex = Number(run.working.checkpointIndex || 0) + 1;
        const candidateGeneration = this.createRunGenerationRecord(run, {
          generation: this.getNextRunGenerationNumber(run),
          label: `G${this.getNextRunGenerationNumber(run)}`,
          source: 'candidate',
          modelBundle: run.working.modelBundle,
          parentGeneration: run.bestGeneration,
          approved: false,
          isBest: false,
          latestLoss: lossEntry,
        });
        run.generations.push(candidateGeneration);
        const evaluation = await this.evaluateRunGeneration(run, candidateGeneration, taskState);
        if (this.shouldAbortRunTask(run.id, taskState)) {
          return losses;
        }
        didEvaluateThisStep = true;
        candidateGeneration.promotionEvaluation = deepClone(evaluation);
        run.evaluationHistory.push(deepClone(evaluation));
        if (run.evaluationHistory.length > 500) {
          run.evaluationHistory.shift();
        }
        if (evaluation.promoted) {
          candidateGeneration.approved = true;
          candidateGeneration.isBest = true;
          candidateGeneration.source = 'promoted';
          candidateGeneration.promotedAt = nowIso();
          this.markRunBestGeneration(run, candidateGeneration.generation);
          run.working.baseGeneration = candidateGeneration.generation;
          run.stats.totalPromotions = Number(run.stats.totalPromotions || 0) + 1;
          run.stats.failedPromotions = 0;
          this.refreshRunWorkerGeneration(run);
          this.emitRunProgress(run, 'promotion', {
            latestEvaluation: evaluation,
            promotedGeneration: candidateGeneration.generation,
          });
        } else {
          candidateGeneration.modelBundle = null;
          run.stats.failedPromotions = Number(run.stats.failedPromotions || 0) + 1;
          this.emitRunProgress(run, 'evaluation', {
            latestEvaluation: evaluation,
          });
        }
      }
      run.updatedAt = nowIso();
      await this.appendRunJournalSnapshot(run, didEvaluateThisStep ? 'training_evaluation_step' : 'training_step', {
        includeRetainedGames: didEvaluateThisStep,
        includeWorkingState: true,
      });
      await new Promise((resolve) => setImmediate(resolve));
    }
    return losses;
  }

  determineRunStopReason(run, taskState) {
    if (taskState?.killRequested) {
      return 'manual_kill';
    }
    if (taskState?.cancelRequested || String(run?.status || '').toLowerCase() === 'stopping') {
      return 'manual_stop';
    }
    if (run?.config?.stopOnMaxGenerations !== false && Number(run?.bestGeneration || 0) >= Number(run?.config?.maxGenerations || 0)) {
      return 'max_generations';
    }
    if (
      run?.config?.stopOnMaxSelfPlayGames !== false
      && Number(run?.stats?.totalSelfPlayGames || 0) >= Number(run?.config?.maxSelfPlayGames || 0)
    ) {
      return 'max_selfplay_games';
    }
    if (
      run?.config?.stopOnMaxTrainingSteps !== false
      && Number(run?.stats?.totalTrainingSteps || 0) >= Number(run?.config?.maxTrainingSteps || 0)
    ) {
      return 'max_training_steps';
    }
    if (
      run?.config?.stopOnMaxFailedPromotions !== false
      && Number(run?.stats?.failedPromotions || 0) >= Number(run?.config?.maxFailedPromotions || 0)
    ) {
      return 'training_plateau';
    }
    return null;
  }

  recordRunMetrics(run, selfPlayGames = []) {
    if (!run) return;
    const selfPlayMetrics = this.computeRunSelfPlayMetrics(selfPlayGames);
    const previousSelfPlayGames = Number(run.stats.totalSelfPlayGames || 0);
    const nextSelfPlayGames = previousSelfPlayGames + selfPlayGames.length;
    run.stats.averageGameLength = nextSelfPlayGames > 0
      ? (
        ((Number(run.stats.averageGameLength || 0) * previousSelfPlayGames)
        + (selfPlayMetrics.averageGameLength * selfPlayGames.length))
        / nextSelfPlayGames
      )
      : 0;
    run.stats.policyEntropy = selfPlayMetrics.policyEntropy || Number(run.stats.policyEntropy || 0);
    run.stats.moveDiversity = selfPlayMetrics.moveDiversity || Number(run.stats.moveDiversity || 0);
    const entry = {
      timestamp: nowIso(),
      cycle: Number(run.stats?.cycle || 0),
      bestGeneration: Number(run.bestGeneration || 0),
      workerGeneration: Number(run.workerGeneration || 0),
      totalSelfPlayGames: Number(run.stats?.totalSelfPlayGames || 0),
      totalTrainingSteps: Number(run.stats?.totalTrainingSteps || 0),
      replayBuffer: this.summarizeRunReplayBuffer(run),
      latestLoss: run.working?.lastLoss ? deepClone(run.working.lastLoss) : null,
      latestEvaluation: Array.isArray(run.evaluationHistory) && run.evaluationHistory.length
        ? deepClone(run.evaluationHistory[run.evaluationHistory.length - 1])
        : null,
      averageSelfPlayGameDurationMs: Number(run.stats?.averageSelfPlayGameDurationMs || 0),
      averageEvaluationGameDurationMs: Number(run.stats?.averageEvaluationGameDurationMs || 0),
      elapsedMs: computeRunElapsedMs(run),
      averageGameLength: Number(run.stats.averageGameLength || 0),
      policyEntropy: Number(run.stats.policyEntropy || 0),
      moveDiversity: Number(run.stats.moveDiversity || 0),
    };
    run.metricsHistory = Array.isArray(run.metricsHistory) ? run.metricsHistory : [];
    run.metricsHistory.push(entry);
    if (run.metricsHistory.length > 1000) {
      run.metricsHistory.shift();
    }
  }

  async runContinuousPipeline(run, taskState) {
    const rng = createRng(Number(run?.config?.seed) || Date.now());
    this.refreshRunWorkerGeneration(run, { force: true });
    this.logRunEvent(run, 'run_pipeline_started', {
      config: run?.config || null,
      bestGeneration: Number(run?.bestGeneration || 0),
      workerGeneration: Number(run?.workerGeneration || 0),
    });
    this.emitRunProgress(run, 'start');
    if (this.shouldAbortRunTask(run.id, taskState)) {
      return;
    }
    while (String(run.status || '').toLowerCase() === 'running' || String(run.status || '').toLowerCase() === 'stopping') {
      if (this.shouldAbortRunTask(run.id, taskState)) {
        return;
      }
      const stopReasonBeforeCycle = this.determineRunStopReason(run, taskState);
      if (stopReasonBeforeCycle) {
        run.stopReason = stopReasonBeforeCycle;
        run.status = (stopReasonBeforeCycle === 'manual_stop' || stopReasonBeforeCycle === 'manual_kill')
          ? 'stopped'
          : 'completed';
        finalizeRunTiming(run, nowIso());
        break;
      }

      run.stats.cycle = Number(run.stats.cycle || 0) + 1;
      this.logRunEvent(run, 'run_cycle_started', {
        cycle: Number(run.stats.cycle || 0),
        workerGeneration: Number(run.workerGeneration || 0),
        bestGeneration: Number(run.bestGeneration || 0),
      });
      this.refreshRunWorkerGeneration(run);
      const workerGeneration = Number(run.workerGeneration || run.bestGeneration || 0);
      const opponentGeneration = this.chooseRunSelfPlayOpponentGeneration(run, rng);
      const selfPlayGames = [];
      await this.playRunGenerationGamesChunked(run, {
        phase: 'selfplay',
        whiteGeneration: workerGeneration,
        blackGeneration: opponentGeneration,
        gameCount: run.config?.numSelfplayWorkers,
        checkpointIndex: run.working?.checkpointIndex || 0,
        taskState,
        alternateColors: true,
        seed: (Number(run.config?.seed) || Date.now()) + (Number(run.stats?.cycle || 0) * 10007),
        onChunk: async (chunkGames, progressState) => {
          const normalizedChunkGames = Array.isArray(chunkGames) ? chunkGames : [];
          if (normalizedChunkGames.length) {
            selfPlayGames.push(...normalizedChunkGames);
            this.retainRunGames(run, normalizedChunkGames);
            this.recordRunGameDurations(run, normalizedChunkGames, 'selfplay');
            run.stats.totalSelfPlayGames = Number(run.stats.totalSelfPlayGames || 0) + normalizedChunkGames.length;
          }

          const generationRecord = this.getRunGeneration(run, workerGeneration);
          let replayBufferSummary = this.summarizeRunReplayBuffer(run);
          normalizedChunkGames.forEach((game) => {
            const filteredTraining = this.filterRunTrainingSamplesByGeneration(game.training, workerGeneration);
            replayBufferSummary = this.appendRunReplayBuffer(run, filteredTraining, {
              generation: workerGeneration,
              createdAt: game.createdAt || nowIso(),
            });
            if (generationRecord) {
              generationRecord.stats.replayPositions = Number(generationRecord.stats.replayPositions || 0)
                + Number(filteredTraining.policySamples.length || 0);
            }
          });
          if (generationRecord && normalizedChunkGames.length) {
            generationRecord.stats.selfPlayGames = Number(generationRecord.stats.selfPlayGames || 0) + normalizedChunkGames.length;
          }
          await this.updateRunSelfPlayProgress(run, {
            cycle: Number(run.stats.cycle || 0),
            workerGeneration,
            opponentGeneration,
            completedGames: Number(progressState?.completedGames || 0),
            targetGames: Number(progressState?.targetGames || run.config?.numSelfplayWorkers || 0),
            latestGameId: normalizedChunkGames.length ? normalizedChunkGames[normalizedChunkGames.length - 1].id : null,
            replayBuffer: replayBufferSummary,
          });
        },
      });
      if (this.shouldAbortRunTask(run.id, taskState)) {
        return;
      }
      this.clearRunSelfPlayProgress(run);
      this.logRunEvent(run, 'run_selfplay_batch_completed', {
        cycle: Number(run.stats.cycle || 0),
        gameCount: selfPlayGames.length,
        workerGeneration,
        opponentGeneration,
        replayBufferBeforeTraining: this.summarizeRunReplayBuffer(run),
      });
      run.updatedAt = nowIso();
      await this.appendRunJournalSnapshot(run, 'selfplay_batch', {
        includeReplayBuffer: true,
        includeRetainedGames: true,
      });

      if (this.summarizeRunReplayBuffer(run).positions >= Number(run.config?.batchSize || 0)) {
        await this.trainRunWorkingModel(run, taskState);
        if (this.shouldAbortRunTask(run.id, taskState)) {
          return;
        }
      }

      this.recordRunMetrics(run, selfPlayGames);
      run.updatedAt = nowIso();
      await this.appendRunJournalSnapshot(run, 'cycle_metrics');
      await this.maybeSaveRunState(run);
      await new Promise((resolve) => setImmediate(resolve));
    }
    if (this.shouldAbortRunTask(run.id, taskState)) {
      return;
    }
    if (!isRunStatusActive(run.status)) {
      finalizeRunTiming(run, run.updatedAt || nowIso());
      this.compactTerminalRunState(run);
    }
    run.updatedAt = nowIso();
    run.live = this.buildRunProgressPayload(run, run.status === 'completed' ? 'complete' : 'stopping', {
      status: run.status,
      stopReason: run.stopReason,
    });
    await this.maybeSaveRunState(run, { force: true });
    this.logRunEvent(run, 'run_pipeline_finished', {
      status: run.status,
      stopReason: run.stopReason || null,
      bestGeneration: Number(run.bestGeneration || 0),
      workerGeneration: Number(run.workerGeneration || 0),
      totalTrainingSteps: Number(run.stats?.totalTrainingSteps || 0),
      totalSelfPlayGames: Number(run.stats?.totalSelfPlayGames || 0),
      totalEvaluationGames: Number(run.stats?.totalEvaluationGames || 0),
    });
    this.emitRunProgress(run, run.status === 'completed' ? 'complete' : 'stopping', {
      status: run.status,
      stopReason: run.stopReason,
    });
  }

  resumeRunTask(runRecord) {
    const run = runRecord?.id ? runRecord : this.getRunById(runRecord);
    if (!run?.id) return;
    if (this.runTasks.has(run.id)) return;
    const taskState = {
      id: run.id,
      cancelRequested: String(run.status || '').toLowerCase() === 'stopping',
      killRequested: false,
      token: this.runTaskSequence += 1,
    };
    this.runTasks.set(run.id, taskState);
    Promise.resolve()
      .then(async () => {
        await this.runContinuousPipeline(run, taskState);
      })
      .catch(async (err) => {
        if (this.shouldAbortRunTask(run.id, taskState)) {
          return;
        }
        run.status = 'error';
        run.stopReason = err.message || 'run_failed';
        run.lastError = summarizeError(err);
        finalizeRunTiming(run, nowIso());
        console.error('[ml-runtime] run pipeline failed', {
          runId: run.id,
          label: run.label,
          stopReason: run.stopReason,
          error: run.lastError,
        });
        this.logRunEvent(run, 'run_pipeline_error', {
          status: 'error',
          stopReason: run.stopReason,
          error: run.lastError,
        });
        this.compactTerminalRunState(run);
        run.updatedAt = nowIso();
        await this.appendRunJournalSnapshot(run, 'pipeline_error', {
          includeWorkingState: true,
        }).catch(() => {});
        await this.maybeSaveRunState(run, { force: true }).catch(() => {});
        this.emitRunProgress(run, 'error', {
          status: 'error',
          message: err.message || 'Run failed',
          stopReason: run.stopReason,
          lastError: run.lastError,
        });
      })
      .finally(() => {
        if (this.isCurrentRunTask(run.id, taskState)) {
          this.runTasks.delete(run.id);
        }
      });
  }

  async resumeRunTasks() {
    if (!this.loaded) {
      await this.ensureLoaded();
    }
    (this.state.runs || [])
      .filter((run) => isRunStatusActive(run?.status))
      .forEach((run) => this.resumeRunTask(run));
  }

  async startRun(options = {}) {
    await this.ensureLoaded();
    await this.settleActiveRunsForActivation({
      forceStopOtherRuns: options.forceStopOtherRuns === true,
    });
    const genericConfig = normalizeRunConfig(options);
    const recommendedDefaults = await this.getRecommendedRunConfigDefaults(
      genericConfig.trainingBackend,
      genericConfig.trainingDevicePreference,
    );
    const config = applyRecommendedRunConfigDefaults(genericConfig, options, recommendedDefaults);
    const { seedBundle, seedSource } = this.resolveRunSeedBundle(config);
    const runLabel = await this.buildUniqueRunLabel(this.getRunSeedLabel(config));

    const run = this.createRunRecord({
      label: runLabel,
      config,
      seedBundle,
      seedSource,
    });
    this.logRunEvent(run, 'run_started', {
      label: run.label,
      config,
      seedSource,
      seed: config.seed,
    });
    this.state.runs.unshift(run);
    await this.save();
    this.resumeRunTask(run);
    return {
      run: this.summarizeRun(run),
      live: this.buildRunProgressPayload(run, 'start'),
    };
  }

  async stopRun(runId) {
    await this.ensureLoaded();
    const run = this.getRunById(runId);
    if (!run) return { stopped: false };
    run.status = 'stopping';
    run.updatedAt = nowIso();
    run.stopReason = 'manual_stop';
    const taskState = this.runTasks.get(run.id);
    if (taskState) {
      taskState.cancelRequested = true;
    }
    this.logRunEvent(run, 'run_stop_requested', {
      status: run.status,
      stopReason: run.stopReason,
    });
    await this.save();
    this.emitRunProgress(run, 'stopping', {
      status: 'stopping',
      stopReason: 'manual_stop',
    });
    return {
      stopped: true,
      run: this.summarizeRun(run),
    };
  }

  async killRun(runId) {
    await this.ensureLoaded();
    const run = this.getRunById(runId);
    if (!run) return { killed: false };
    const taskState = this.runTasks.get(run.id) || null;
    if (taskState) {
      taskState.cancelRequested = true;
      taskState.killRequested = true;
      this.runTasks.delete(run.id);
    }

    run.status = 'stopped';
    run.updatedAt = nowIso();
    run.stopReason = 'manual_kill';
    run.lastError = null;
    finalizeRunTiming(run, run.updatedAt);
    this.clearRunSelfPlayProgress(run);
    this.clearRunEvaluationProgress(run);
    run.live = this.buildRunProgressPayload(run, 'killed', {
      status: 'stopped',
      stopReason: 'manual_kill',
    });
    this.logRunEvent(run, 'run_killed', {
      status: run.status,
      stopReason: run.stopReason,
      hadActiveTask: Boolean(taskState),
    });

    if (taskState) {
      await this.resetParallelTaskPool().catch(() => {});
    }

    await this.save();
    this.emitRunProgress(run, 'killed', {
      status: 'stopped',
      stopReason: 'manual_kill',
    });
    return {
      killed: true,
      run: this.summarizeRun(run),
    };
  }

  async continueRun(runId, options = {}) {
    await this.ensureLoaded();
    const run = this.getRunById(runId);
    if (!run) return { continued: false, reason: 'not_found' };
    const status = normalizeRunStatus(run.status);
    if (!['stopped', 'error'].includes(status)) {
      const err = new Error('Only stopped or errored runs can be continued');
      err.statusCode = 409;
      err.code = 'run_not_resumable_status';
      throw err;
    }
    if (!this.canContinueRun(run)) {
      const err = new Error('This stopped run no longer has resumable state');
      err.statusCode = 409;
      err.code = 'run_not_resumable';
      throw err;
    }
    const continueState = this.ensureRunContinueState(run);
    if (!continueState) {
      const err = new Error('This stopped run no longer has resumable state');
      err.statusCode = 409;
      err.code = 'run_not_resumable';
      throw err;
    }

    await this.settleActiveRunsForActivation({
      exceptRunId: run.id,
      forceStopOtherRuns: options.forceStopOtherRuns === true,
    });

    run.status = 'running';
    run.stopReason = null;
    run.lastError = null;
    run.updatedAt = nowIso();
    startRunTimingSegment(run, run.updatedAt);
    run.live = this.buildRunProgressPayload(run, 'continue', {
      status: 'running',
      stopReason: null,
    });
    this.logRunEvent(run, 'run_continued', {
      status: run.status,
      bestGeneration: Number(run.bestGeneration || 0),
      workerGeneration: Number(run.workerGeneration || 0),
      continueSource: continueState.source,
      continueGeneration: Number(continueState.generation || 0),
      checkpointIndex: Number(run?.working?.checkpointIndex || 0),
      totalTrainingSteps: Number(run?.stats?.totalTrainingSteps || 0),
    });
    await this.save();
    this.resumeRunTask(run);
    this.emitRunProgress(run, 'continue', {
      status: 'running',
      stopReason: null,
    });
    return {
      continued: true,
      run: this.summarizeRun(run),
      live: this.buildRunProgressPayload(run, 'continue'),
    };
  }

  async deleteRun(runId) {
    await this.ensureLoaded();
    const runs = Array.isArray(this.state.runs) ? this.state.runs : [];
    const runIndex = runs.findIndex((run) => run.id === runId);
    if (runIndex < 0) {
      return { deleted: false, reason: 'not_found' };
    }
    const run = runs[runIndex];
    if (isRunStatusActive(run?.status)) {
      return {
        deleted: false,
        reason: 'run_active',
        run: this.summarizeRun(run),
      };
    }
    runs.splice(runIndex, 1);
    this.prunePromotedBotSelections();
    this.runTasks.delete(runId);
    await this.deletePersistedRunArtifacts(runId);
    await this.deleteRunMetadataFromMongo(runId);
    await this.save();
    return {
      deleted: true,
      id: runId,
    };
  }

  async getLiveStatus() {
    await this.ensureLoaded();
    await this.ensureFreshResourceTelemetry();
    const simulationJob = this.state.activeJobs?.simulation || null;
    const trainingJob = this.state.activeJobs?.training || null;
    const simulation = simulationJob
      ? this.buildSimulationJobPayload(simulationJob)
      : this.getRecentRememberedLiveStatus('simulation');
    const training = trainingJob
      ? this.buildTrainingJobPayload(trainingJob)
      : this.getRecentRememberedLiveStatus('training');
    return {
      serverTime: nowIso(),
      resourceTelemetry: this.getResourceTelemetryPayload(),
      simulation,
      training,
      runs: (this.state.runs || [])
        .filter((run) => isRunStatusActive(run?.status))
        .map((run) => this.buildRunProgressPayload(run)),
    };
  }

  async listTrainingRuns(options = {}) {
    await this.ensureLoaded();
    const runs = await this.listStoredTrainingRuns({ limit: options.limit });
    return runs.map((run) => this.summarizeTrainingRun(run));
  }
}

let defaultRuntime = null;

function getMlRuntime() {
  if (!defaultRuntime) {
    defaultRuntime = new MlRuntime();
    defaultRuntime.ensureLoaded().catch((err) => {
      console.error('[ml-runtime] failed to initialize default runtime', err);
    });
  }
  return defaultRuntime;
}

module.exports = {
  MlRuntime,
  getMlRuntime,
};
