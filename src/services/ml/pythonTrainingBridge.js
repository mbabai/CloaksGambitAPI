const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const {
  appendMlBridgeDebugLog,
  appendMlBridgeStderrLine,
} = require('./mlDebugLogger');

const DEFAULT_BRIDGE_SCRIPT = path.join(process.cwd(), 'ml_backend', 'torch_training_bridge.py');
const DEFAULT_VENV_PYTHON = path.join(process.cwd(), 'ml_backend', 'venv', 'Scripts', 'python.exe');
const BRIDGE_START_RETRY_BACKOFF_MS = 30000;
const BRIDGE_HANDSHAKE_TIMEOUT_MS = 15000;
const BRIDGE_DEFAULT_REQUEST_TIMEOUT_MS = 60000;
const BRIDGE_TRAIN_BATCH_BASE_TIMEOUT_MS = 120000;
const BRIDGE_TRAIN_BATCH_PER_EPOCH_TIMEOUT_MS = 45000;
const BRIDGE_TRAIN_BATCH_PER_SAMPLE_TIMEOUT_MS = 10;
const BRIDGE_MAX_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

function isFilesystemPath(value) {
  return typeof value === 'string' && /[\\/]/.test(value);
}

function resolvePythonExecutable(explicitExecutable = null) {
  const candidates = [
    explicitExecutable,
    process.env.ML_TRAINING_PYTHON_EXECUTABLE || null,
    DEFAULT_VENV_PYTHON,
    'python',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!isFilesystemPath(candidate)) {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveBridgeScript(explicitScript = null) {
  const candidate = explicitScript || process.env.ML_TRAINING_PYTHON_SCRIPT || DEFAULT_BRIDGE_SCRIPT;
  if (candidate && fs.existsSync(candidate)) {
    return candidate;
  }
  return null;
}

function summarizeTrainBatchPayload(payload = {}) {
  const modelBundle = payload.modelBundle || {};
  const samples = payload.samples || {};
  const inferredIdentities = modelBundle?.identity?.inferredIdentities || payload.inferredIdentities || [];
  return {
    command: 'train_batch',
    devicePreference: payload.devicePreference || 'auto',
    epochs: Number(payload.epochs || 1),
    trainingOptions: {
      learningRate: Number(payload?.trainingOptions?.learningRate || 0),
      batchSize: Number(payload?.trainingOptions?.batchSize || 0),
      weightDecay: Number(payload?.trainingOptions?.weightDecay || 0),
      gradientClipNorm: Number(payload?.trainingOptions?.gradientClipNorm || 0),
    },
    sampleCounts: {
      policy: Array.isArray(samples.policySamples) ? samples.policySamples.length : 0,
      value: Array.isArray(samples.valueSamples) ? samples.valueSamples.length : 0,
      identity: Array.isArray(samples.identitySamples) ? samples.identitySamples.length : 0,
    },
    model: {
      family: modelBundle?.family || 'legacy',
      encoderInputSize: Number(modelBundle?.interface?.stateInputSize || modelBundle?.encoder?.network?.inputSize || 0),
      policyInputSize: Number(modelBundle?.policy?.network?.inputSize || 0),
      valueInputSize: Number(modelBundle?.value?.network?.inputSize || 0),
      identityInputSize: Number(modelBundle?.identity?.network?.inputSize || 0),
      identityOutputSize: Number(modelBundle?.identity?.network?.outputSize || 0),
      inferredIdentityCount: Array.isArray(inferredIdentities) ? inferredIdentities.length : 0,
    },
    optimizerStatePresent: Boolean(payload.optimizerState),
  };
}

function summarizePayload(payload = {}) {
  const command = String(payload.command || '').trim().toLowerCase();
  if (command === 'train_batch') {
    return summarizeTrainBatchPayload(payload);
  }
  return {
    command: command || 'unknown',
  };
}

function countTrainBatchSamples(payload = {}) {
  return (
    (Array.isArray(payload?.samples?.policySamples) ? payload.samples.policySamples.length : 0)
    + (Array.isArray(payload?.samples?.valueSamples) ? payload.samples.valueSamples.length : 0)
    + (Array.isArray(payload?.samples?.identitySamples) ? payload.samples.identitySamples.length : 0)
  );
}

function resolvePayloadTimeoutMs(payload = {}, options = {}) {
  if (Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0) {
    return Math.max(1, Math.min(BRIDGE_MAX_REQUEST_TIMEOUT_MS, Math.floor(Number(options.timeoutMs))));
  }
  const command = String(payload.command || '').trim().toLowerCase();
  if (command === 'handshake') {
    return BRIDGE_HANDSHAKE_TIMEOUT_MS;
  }
  if (command === 'train_batch') {
    const epochs = Math.max(1, Math.floor(Number(payload.epochs || 1)));
    const sampleCount = countTrainBatchSamples(payload);
    const estimatedMs = BRIDGE_TRAIN_BATCH_BASE_TIMEOUT_MS
      + (epochs * BRIDGE_TRAIN_BATCH_PER_EPOCH_TIMEOUT_MS)
      + (sampleCount * BRIDGE_TRAIN_BATCH_PER_SAMPLE_TIMEOUT_MS);
    return Math.max(BRIDGE_DEFAULT_REQUEST_TIMEOUT_MS, Math.min(BRIDGE_MAX_REQUEST_TIMEOUT_MS, estimatedMs));
  }
  return BRIDGE_DEFAULT_REQUEST_TIMEOUT_MS;
}

class PythonTrainingBridge {
  constructor(options = {}) {
    this.pythonExecutable = resolvePythonExecutable(options.pythonExecutable);
    this.scriptPath = resolveBridgeScript(options.scriptPath);
    this.child = null;
    this.stdoutReader = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.startPromise = null;
    this.capabilities = null;
    this.stderrLines = [];
    this.lastStartFailure = null;
    this.lastStartFailureAtMs = 0;
  }

  async ensureStarted() {
    if (this.startPromise) {
      return this.startPromise;
    }
    if (
      this.lastStartFailure
      && (Date.now() - this.lastStartFailureAtMs) < BRIDGE_START_RETRY_BACKOFF_MS
    ) {
      throw this.lastStartFailure;
    }
    this.startPromise = this.start()
      .then((capabilities) => {
        this.lastStartFailure = null;
        this.lastStartFailureAtMs = 0;
        return capabilities;
      })
      .catch((err) => {
        this.startPromise = null;
        this.lastStartFailure = err instanceof Error ? err : new Error(String(err || 'Python training bridge failed to start'));
        this.lastStartFailureAtMs = Date.now();
        throw this.lastStartFailure;
      });
    return this.startPromise;
  }

  async start() {
    if (!this.pythonExecutable) {
      throw new Error('No Python executable was found for the ML training bridge');
    }
    if (!this.scriptPath) {
      throw new Error('The Python ML training bridge script was not found');
    }

    appendMlBridgeDebugLog('bridge_starting', {
      pythonExecutable: this.pythonExecutable,
      scriptPath: this.scriptPath,
    });
    this.stderrLines = [];
    this.child = spawn(this.pythonExecutable, ['-u', this.scriptPath], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
    });

    this.stdoutReader = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });
    this.stdoutReader.on('line', (line) => this.handleStdoutLine(line));

    this.child.stderr.on('data', (chunk) => {
      const lines = String(chunk || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      lines.forEach((text) => {
        this.stderrLines.push(text);
        if (this.stderrLines.length > 50) {
          this.stderrLines.shift();
        }
        appendMlBridgeStderrLine(text, {
          childPid: this.child?.pid || null,
        });
      });
    });

    this.child.on('error', (err) => {
      appendMlBridgeDebugLog('bridge_process_error', {
        childPid: this.child?.pid || null,
        message: err?.message || String(err),
        stack: err?.stack || null,
      });
      this.rejectAllPending(err);
    });

    this.child.on('exit', (code, signal) => {
      appendMlBridgeDebugLog('bridge_exit', {
        childPid: this.child?.pid || null,
        code: Number.isFinite(code) ? code : null,
        signal: signal || null,
        stderrLines: this.stderrLines.slice(-10),
      });
      const message = signal
        ? `Python training bridge exited with signal ${signal}`
        : `Python training bridge exited with code ${code}`;
      this.rejectAllPending(new Error(message));
      this.child = null;
      this.startPromise = null;
      this.capabilities = null;
    });

    this.capabilities = await this.sendPayload({
      command: 'handshake',
    }, { skipEnsureStarted: true });
    appendMlBridgeDebugLog('bridge_started', {
      childPid: this.child?.pid || null,
      capabilities: this.capabilities || null,
    });
    return this.capabilities;
  }

  handleStdoutLine(line) {
    if (!line) return;
    let message = null;
    try {
      message = JSON.parse(line);
    } catch (_) {
      appendMlBridgeDebugLog('bridge_invalid_stdout', {
        line,
      });
      return;
    }
    const requestId = Number(message.requestId);
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }
    if (message.ok === true) {
      appendMlBridgeDebugLog('bridge_request_ok', {
        requestId,
        durationMs: Date.now() - pending.startedAtMs,
        summary: pending.summary,
        resultSummary: {
          backend: message?.result?.backend || null,
          device: message?.result?.device || null,
          historyLength: Array.isArray(message?.result?.history) ? message.result.history.length : 0,
        },
      });
      pending.resolve(message.result);
      return;
    }
    const stderr = this.stderrLines.length ? ` stderr: ${this.stderrLines.join(' | ')}` : '';
    appendMlBridgeDebugLog('bridge_request_error', {
      requestId,
      durationMs: Date.now() - pending.startedAtMs,
      summary: pending.summary,
      error: message.error || 'Python training bridge request failed',
      stderrLines: this.stderrLines.slice(-10),
    });
    pending.reject(new Error(`${message.error || 'Python training bridge request failed'}${stderr}`));
  }

  rejectAllPending(err) {
    const error = err instanceof Error ? err : new Error(String(err || 'Python training bridge failed'));
    const pendingEntries = Array.from(this.pending.values());
    this.pending.clear();
    pendingEntries.forEach((entry) => {
      if (entry.timeoutHandle) {
        clearTimeout(entry.timeoutHandle);
      }
      entry.reject(error);
    });
  }

  async restartChild(error) {
    const child = this.child;
    this.child = null;
    this.capabilities = null;
    this.startPromise = null;
    if (this.stdoutReader) {
      this.stdoutReader.close();
      this.stdoutReader = null;
    }
    this.rejectAllPending(error);
    if (!child) return;
    appendMlBridgeDebugLog('bridge_restart_requested', {
      childPid: child?.pid || null,
      reason: error?.message || String(error || 'bridge_restart'),
    });
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, 1000);
    });
  }

  async sendPayload(payload, options = {}) {
    if (!options.skipEnsureStarted) {
      await this.ensureStarted();
    }
    if (!this.child || !this.child.stdin) {
      throw new Error('Python training bridge is not running');
    }
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const summary = summarizePayload(payload);
    const message = JSON.stringify({
      requestId,
      payload,
    });
    return new Promise((resolve, reject) => {
      const timeoutMs = resolvePayloadTimeoutMs(payload, options);
      this.pending.set(requestId, {
        resolve,
        reject,
        startedAtMs: Date.now(),
        summary,
        timeoutHandle: null,
      });
      const pending = this.pending.get(requestId);
      if (pending && timeoutMs > 0) {
        pending.timeoutHandle = setTimeout(() => {
          if (!this.pending.has(requestId)) return;
          const err = new Error(`Python training bridge request timed out after ${timeoutMs}ms (${summary.command || 'unknown'})`);
          err.code = 'ML_PYTHON_BRIDGE_TIMEOUT';
          appendMlBridgeDebugLog('bridge_request_timeout', {
            requestId,
            timeoutMs,
            summary,
            childPid: this.child?.pid || null,
          });
          this.restartChild(err).catch(() => {});
        }, timeoutMs);
        if (typeof pending.timeoutHandle?.unref === 'function') {
          pending.timeoutHandle.unref();
        }
      }
      appendMlBridgeDebugLog('bridge_request_start', {
        requestId,
        childPid: this.child?.pid || null,
        summary,
      });
      this.child.stdin.write(`${message}\n`, 'utf8', (err) => {
        if (!err) return;
        const pendingEntry = this.pending.get(requestId);
        if (pendingEntry?.timeoutHandle) {
          clearTimeout(pendingEntry.timeoutHandle);
        }
        this.pending.delete(requestId);
        appendMlBridgeDebugLog('bridge_request_write_error', {
          requestId,
          summary,
          message: err?.message || String(err),
          stack: err?.stack || null,
        });
        reject(err);
      });
    });
  }

  async getCapabilities() {
    if (this.capabilities) return this.capabilities;
    await this.ensureStarted();
    return this.capabilities;
  }

  async trainBatch(payload = {}) {
    return this.sendPayload({
      command: 'train_batch',
      ...payload,
    });
  }

  async close() {
    this.lastStartFailure = null;
    this.lastStartFailureAtMs = 0;
    this.capabilities = null;
    this.startPromise = null;
    if (!this.child) return;
    const child = this.child;
    this.child = null;
    if (this.stdoutReader) {
      this.stdoutReader.close();
      this.stdoutReader = null;
    }
    this.rejectAllPending(new Error('Python training bridge closed'));
    appendMlBridgeDebugLog('bridge_closing', {
      childPid: child?.pid || null,
    });
    await new Promise((resolve) => {
      child.once('exit', () => resolve());
      child.kill();
      setTimeout(resolve, 1000);
    });
  }
}

let sharedBridge = null;

function getPythonTrainingBridge(options = {}) {
  if (!sharedBridge) {
    sharedBridge = new PythonTrainingBridge(options);
  }
  return sharedBridge;
}

module.exports = {
  DEFAULT_BRIDGE_SCRIPT,
  DEFAULT_VENV_PYTHON,
  PythonTrainingBridge,
  getPythonTrainingBridge,
  resolveBridgeScript,
  resolvePythonExecutable,
};
