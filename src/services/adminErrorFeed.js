const eventBus = require('../eventBus');

const MAX_ERROR_ENTRIES = 25;
const MAX_STACK_LINES = 12;
const MAX_OBJECT_DEPTH = 4;
const MAX_OBJECT_KEYS = 20;
const MAX_ARRAY_ITEMS = 12;
const DEDUPE_WINDOW_MS = 15000;

let errorSequence = 0;
const recentErrors = [];

function nowIso() {
  return new Date().toISOString();
}

function cloneJsonSafe(value) {
  if (value === undefined) {
    return undefined;
  }
  return JSON.parse(JSON.stringify(value));
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function sanitizeStack(stack) {
  const text = typeof stack === 'string' ? stack.trim() : '';
  if (!text) return null;
  return text
    .split('\n')
    .slice(0, MAX_STACK_LINES)
    .join('\n');
}

function sanitizeValue(value, depth = 0) {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (depth >= MAX_OBJECT_DEPTH) {
    return '[truncated]';
  }
  if (value instanceof Error) {
    return {
      name: typeof value.name === 'string' ? value.name : 'Error',
      message: typeof value.message === 'string' ? value.message : 'Unknown error',
      code: value.code ? String(value.code) : null,
      stack: sanitizeStack(value.stack),
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'function') {
    return '[function]';
  }
  if (typeof value === 'object') {
    const output = {};
    Object.keys(value)
      .slice(0, MAX_OBJECT_KEYS)
      .forEach((key) => {
        output[key] = sanitizeValue(value[key], depth + 1);
      });
    return output;
  }
  return String(value);
}

function normalizeLevel(level) {
  const normalized = String(level || '').trim().toLowerCase();
  if (normalized === 'warn' || normalized === 'warning') {
    return 'warn';
  }
  if (normalized === 'info') {
    return 'info';
  }
  return 'error';
}

function buildFingerprint(entry) {
  return [
    entry.source || 'server',
    entry.level || 'error',
    entry.code || '',
    entry.message || '',
  ].join('::');
}

function normalizeServerErrorEntry(input = {}) {
  const error = input.error instanceof Error
    ? input.error
    : null;
  const createdAt = (() => {
    const raw = typeof input.createdAt === 'string' ? input.createdAt : '';
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : nowIso();
  })();
  const id = typeof input.id === 'string' && input.id.trim()
    ? input.id.trim()
    : `server-error-${Date.now()}-${errorSequence += 1}`;
  const source = typeof input.source === 'string' && input.source.trim()
    ? input.source.trim()
    : 'server';
  const message = typeof input.message === 'string' && input.message.trim()
    ? input.message.trim()
    : (typeof error?.message === 'string' && error.message.trim()
      ? error.message.trim()
      : 'Server error');
  const code = input.code
    ? String(input.code)
    : (error?.code ? String(error.code) : null);
  const status = toFiniteNumber(input.status);
  const details = sanitizeValue(input.details);
  const stack = sanitizeStack(input.stack || error?.stack || '');
  const count = Math.max(1, Math.floor(toFiniteNumber(input.count) || 1));
  const lastSeenAt = (() => {
    const raw = typeof input.lastSeenAt === 'string' ? input.lastSeenAt : '';
    return raw && !Number.isNaN(Date.parse(raw)) ? raw : createdAt;
  })();
  const entry = {
    id,
    createdAt,
    lastSeenAt,
    level: normalizeLevel(input.level),
    source,
    message,
    code,
    status,
    count,
    details,
    stack,
  };
  entry.fingerprint = buildFingerprint(entry);
  return entry;
}

function sortEntries(entries) {
  return entries.sort((left, right) => {
    const leftTime = Date.parse(left.lastSeenAt || left.createdAt || '') || 0;
    const rightTime = Date.parse(right.lastSeenAt || right.createdAt || '') || 0;
    return rightTime - leftTime;
  });
}

function reportServerError(input = {}) {
  const entry = normalizeServerErrorEntry(input);
  const entryTime = Date.parse(entry.lastSeenAt || entry.createdAt || '') || Date.now();
  const duplicate = recentErrors.find((candidate) => {
    if (candidate.fingerprint !== entry.fingerprint) {
      return false;
    }
    const candidateTime = Date.parse(candidate.lastSeenAt || candidate.createdAt || '') || 0;
    return Math.abs(entryTime - candidateTime) <= DEDUPE_WINDOW_MS;
  });

  if (duplicate) {
    duplicate.lastSeenAt = entry.lastSeenAt;
    duplicate.count = Math.max(1, Number(duplicate.count || 1)) + 1;
    if (!duplicate.stack && entry.stack) {
      duplicate.stack = entry.stack;
    }
    if (!duplicate.status && entry.status) {
      duplicate.status = entry.status;
    }
    if ((!duplicate.code || duplicate.code === 'null') && entry.code) {
      duplicate.code = entry.code;
    }
    if ((!duplicate.details || duplicate.details === null) && entry.details) {
      duplicate.details = entry.details;
    }
    sortEntries(recentErrors);
    const cloned = cloneJsonSafe(duplicate);
    eventBus.emit('admin:serverError', cloned);
    return cloned;
  }

  recentErrors.unshift(entry);
  sortEntries(recentErrors);
  if (recentErrors.length > MAX_ERROR_ENTRIES) {
    recentErrors.length = MAX_ERROR_ENTRIES;
  }
  const cloned = cloneJsonSafe(entry);
  eventBus.emit('admin:serverError', cloned);
  return cloned;
}

function getRecentServerErrors(limit = MAX_ERROR_ENTRIES) {
  const normalizedLimit = Math.max(0, Math.floor(toFiniteNumber(limit) || MAX_ERROR_ENTRIES));
  return cloneJsonSafe(recentErrors.slice(0, normalizedLimit));
}

function clearRecentServerErrors() {
  recentErrors.length = 0;
}

module.exports = {
  reportServerError,
  getRecentServerErrors,
  clearRecentServerErrors,
};
