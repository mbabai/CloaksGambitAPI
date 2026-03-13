const path = require('path');
const {
  appendNamedLocalDebugLine,
  appendNamedLocalDebugLog,
  getLocalDebugLogPaths,
} = require('../../utils/localDebugLogger');

const ML_DEBUG_DIR_RELATIVE = path.posix.join('ml');
const ML_EVENTS_FILE_RELATIVE = path.posix.join(ML_DEBUG_DIR_RELATIVE, 'ml-events.jsonl');
const ML_BRIDGE_EVENTS_FILE_RELATIVE = path.posix.join(ML_DEBUG_DIR_RELATIVE, 'python-bridge.jsonl');
const ML_BRIDGE_STDERR_FILE_RELATIVE = path.posix.join(ML_DEBUG_DIR_RELATIVE, 'python-bridge.stderr.log');

function sanitizeSegment(value, fallback) {
  const normalized = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function appendMlDebugLog(event, payload = {}) {
  return appendNamedLocalDebugLog(ML_EVENTS_FILE_RELATIVE, event, payload);
}

function appendMlRunDebugLog(runId, event, payload = {}) {
  const safeRunId = sanitizeSegment(runId, 'unknown-run');
  const relativePath = path.posix.join(ML_DEBUG_DIR_RELATIVE, 'runs', `${safeRunId}.jsonl`);
  appendMlDebugLog(event, {
    runId: safeRunId,
    ...payload,
  });
  return appendNamedLocalDebugLog(relativePath, event, payload);
}

function appendMlTrainingDebugLog(trainingRunId, event, payload = {}) {
  const safeTrainingRunId = sanitizeSegment(trainingRunId, 'unknown-training');
  const relativePath = path.posix.join(ML_DEBUG_DIR_RELATIVE, 'training', `${safeTrainingRunId}.jsonl`);
  appendMlDebugLog(event, {
    trainingRunId: safeTrainingRunId,
    ...payload,
  });
  return appendNamedLocalDebugLog(relativePath, event, payload);
}

function appendMlBridgeDebugLog(event, payload = {}) {
  appendMlDebugLog(event, payload);
  return appendNamedLocalDebugLog(ML_BRIDGE_EVENTS_FILE_RELATIVE, event, payload);
}

function appendMlBridgeStderrLine(line, payload = {}) {
  const text = String(line || '').trim();
  if (!text) return null;
  appendMlBridgeDebugLog('bridge_stderr', {
    ...payload,
    line: text,
  });
  return appendNamedLocalDebugLine(ML_BRIDGE_STDERR_FILE_RELATIVE, text);
}

function getMlDebugLogPaths() {
  return {
    dir: getLocalDebugLogPaths(ML_EVENTS_FILE_RELATIVE).dir,
    eventsFile: getLocalDebugLogPaths(ML_EVENTS_FILE_RELATIVE).file,
    bridgeEventsFile: getLocalDebugLogPaths(ML_BRIDGE_EVENTS_FILE_RELATIVE).file,
    bridgeStderrFile: getLocalDebugLogPaths(ML_BRIDGE_STDERR_FILE_RELATIVE).file,
    runsDir: getLocalDebugLogPaths(path.posix.join(ML_DEBUG_DIR_RELATIVE, 'runs', 'placeholder.jsonl')).file.replace(/[\\/]placeholder\.jsonl$/, ''),
    trainingDir: getLocalDebugLogPaths(path.posix.join(ML_DEBUG_DIR_RELATIVE, 'training', 'placeholder.jsonl')).file.replace(/[\\/]placeholder\.jsonl$/, ''),
  };
}

module.exports = {
  appendMlBridgeDebugLog,
  appendMlBridgeStderrLine,
  appendMlDebugLog,
  appendMlRunDebugLog,
  appendMlTrainingDebugLog,
  getMlDebugLogPaths,
};
