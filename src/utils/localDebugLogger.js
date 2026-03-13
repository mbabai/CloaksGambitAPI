const fs = require('fs');
const os = require('os');
const path = require('path');
const { isInternalSimulationActive } = require('./simulationRequestContext');

const DEBUG_DIR = path.join(os.tmpdir(), 'cloaks-gambit-debug');
const DEBUG_LOG_FILE = path.join(DEBUG_DIR, 'clock-events.jsonl');

let announcedPath = false;

function isLocalDebugLoggingEnabled() {
  if (isInternalSimulationActive()) {
    return false;
  }
  const explicit = String(process.env.CG_LOCAL_GAME_LOGS || '').trim().toLowerCase();
  if (explicit === 'false' || explicit === '0' || explicit === 'off') {
    return false;
  }
  if (explicit === 'true' || explicit === '1' || explicit === 'on') {
    return true;
  }
  const env = String(process.env.NODE_ENV || '').trim().toLowerCase();
  return env !== 'production' && env !== 'test';
}

function ensureDebugDir() {
  if (!isLocalDebugLoggingEnabled()) {
    return false;
  }
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  if (!announcedPath) {
    announcedPath = true;
    console.log(`[local-debug] writing temp logs to ${DEBUG_DIR}`);
  }
  return true;
}

function normalizeRelativeDebugPath(relativePath) {
  const value = String(relativePath || '').trim().replace(/\\/g, '/');
  if (!value) {
    throw new Error('A relative debug log path is required');
  }
  const normalized = path.posix.normalize(value).replace(/^\/+/, '');
  if (!normalized || normalized.startsWith('..') || normalized.includes('../')) {
    throw new Error(`Invalid debug log path: ${relativePath}`);
  }
  return normalized;
}

function resolveDebugLogPath(relativePath) {
  return path.join(DEBUG_DIR, normalizeRelativeDebugPath(relativePath));
}

function sanitizeValue(value, seen = new WeakSet(), depth = 0) {
  if (value === null || value === undefined) return value;
  if (depth > 6) return '[MaxDepth]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'function') {
    return `[Function:${value.name || 'anonymous'}]`;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((entry) => sanitizeValue(entry, seen, depth + 1));
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);
    const entries = Object.entries(value).slice(0, 80);
    const result = {};
    entries.forEach(([key, entryValue]) => {
      result[key] = sanitizeValue(entryValue, seen, depth + 1);
    });
    seen.delete(value);
    return result;
  }
  return String(value);
}

function appendLocalDebugLog(event, payload = {}) {
  if (!ensureDebugDir()) {
    return null;
  }

  const record = {
    ts: new Date().toISOString(),
    pid: process.pid,
    event,
    payload: sanitizeValue(payload),
  };

  fs.appendFileSync(DEBUG_LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8');
  return DEBUG_LOG_FILE;
}

function appendNamedLocalDebugLog(relativePath, event, payload = {}) {
  if (!ensureDebugDir()) {
    return null;
  }
  const targetPath = resolveDebugLogPath(relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const record = {
    ts: new Date().toISOString(),
    pid: process.pid,
    event,
    payload: sanitizeValue(payload),
  };
  fs.appendFileSync(targetPath, `${JSON.stringify(record)}\n`, 'utf8');
  return targetPath;
}

function appendNamedLocalDebugLine(relativePath, line) {
  if (!ensureDebugDir()) {
    return null;
  }
  const targetPath = resolveDebugLogPath(relativePath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const normalizedLine = String(line || '').replace(/\r?\n/g, '\n');
  fs.appendFileSync(targetPath, normalizedLine.endsWith('\n') ? normalizedLine : `${normalizedLine}\n`, 'utf8');
  return targetPath;
}

function getLocalDebugLogPaths(relativePath = null) {
  if (relativePath) {
    return {
      dir: DEBUG_DIR,
      file: resolveDebugLogPath(relativePath),
    };
  }
  return {
    dir: DEBUG_DIR,
    file: DEBUG_LOG_FILE,
  };
}

module.exports = {
  isLocalDebugLoggingEnabled,
  appendLocalDebugLog,
  appendNamedLocalDebugLine,
  appendNamedLocalDebugLog,
  getLocalDebugLogPaths,
  sanitizeValue,
};
