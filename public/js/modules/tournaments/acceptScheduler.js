const DEFAULT_ACCEPT_WINDOW_SECONDS = 30;
const DEFAULT_MATCH_ACCEPT_GRACE_MS = 5000;

function normalizeGameId(gameId) {
  if (gameId === null || gameId === undefined) return null;
  const value = String(gameId).trim();
  return value || null;
}

function normalizeRemainingSeconds(value, fallback = DEFAULT_ACCEPT_WINDOW_SECONDS) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return Math.max(1, Number(fallback) || DEFAULT_ACCEPT_WINDOW_SECONDS);
  }
  return Math.max(1, Math.ceil(normalized));
}

/**
 * Owns the client-side delay between "match complete" and the next
 * tournament accept banner. The server still decides whether a game requires
 * accept and enforces the actual timeout; this helper only controls when the
 * player sees the banner and keeps the countdown honest across refreshes.
 */
export function createTournamentAcceptScheduler({
  showAcceptBanner,
  isLocallyAccepted = () => false,
  onDebug = null,
  now = () => Date.now(),
  setTimeoutFn = (handler, delayMs) => window.setTimeout(handler, delayMs),
  clearTimeoutFn = (handle) => window.clearTimeout(handle),
  graceMs = DEFAULT_MATCH_ACCEPT_GRACE_MS,
} = {}) {
  if (typeof showAcceptBanner !== 'function') {
    throw new Error('showAcceptBanner is required');
  }

  const acceptDeadlineByGameId = new Map();
  let pendingBanner = null;
  let pendingTimeout = null;
  let graceDeadlineMs = 0;

  const debug = (event, payload = {}) => {
    if (typeof onDebug === 'function') {
      onDebug(event, payload);
    }
  };

  function rememberDeadline(gameId, startSeconds = DEFAULT_ACCEPT_WINDOW_SECONDS) {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId) return null;
    const durationMs = normalizeRemainingSeconds(startSeconds) * 1000;
    const candidateDeadline = now() + durationMs;
    const existingDeadline = acceptDeadlineByGameId.get(normalizedGameId);
    const resolvedDeadline = Number.isFinite(existingDeadline)
      ? Math.min(existingDeadline, candidateDeadline)
      : candidateDeadline;
    acceptDeadlineByGameId.set(normalizedGameId, resolvedDeadline);
    return resolvedDeadline;
  }

  function forgetDeadline(gameId) {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId) return;
    acceptDeadlineByGameId.delete(normalizedGameId);
  }

  function getRemainingSeconds(gameId, fallbackSeconds = DEFAULT_ACCEPT_WINDOW_SECONDS) {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId) {
      return normalizeRemainingSeconds(fallbackSeconds);
    }
    const deadline = acceptDeadlineByGameId.get(normalizedGameId);
    if (!Number.isFinite(deadline)) {
      return normalizeRemainingSeconds(fallbackSeconds);
    }
    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return 0;
    }
    return Math.max(1, Math.ceil(remainingMs / 1000));
  }

  function clearPending({ preserveDeadline = true } = {}) {
    if (pendingTimeout) {
      clearTimeoutFn(pendingTimeout);
      pendingTimeout = null;
    }
    if (!preserveDeadline && pendingBanner?.gameId) {
      forgetDeadline(pendingBanner.gameId);
    }
    pendingBanner = null;
  }

  function setGrace(delayMs = graceMs) {
    graceDeadlineMs = Math.max(
      graceDeadlineMs,
      now() + Math.max(0, Number(delayMs) || 0)
    );
  }

  function releaseGrace() {
    graceDeadlineMs = 0;
  }

  function flushPending({ forceImmediate = false } = {}) {
    if (!pendingBanner) return false;
    const nextBanner = pendingBanner;
    clearPending({ preserveDeadline: true });
    if (forceImmediate) {
      releaseGrace();
    }
    const remainingSeconds = getRemainingSeconds(nextBanner.gameId, nextBanner.startSeconds);
    if (remainingSeconds <= 0) {
      forgetDeadline(nextBanner.gameId);
      return false;
    }
    debug('client-tournament-accept-flush', {
      gameId: nextBanner.gameId,
      color: nextBanner.color,
      forceImmediate: Boolean(forceImmediate),
      remainingSeconds,
    });
    showAcceptBanner({
      gameId: nextBanner.gameId,
      color: nextBanner.color,
      startSeconds: remainingSeconds,
    });
    return true;
  }

  function queue({ gameId, color, startSeconds = DEFAULT_ACCEPT_WINDOW_SECONDS } = {}) {
    const normalizedGameId = normalizeGameId(gameId);
    if (!normalizedGameId || !Number.isInteger(color)) {
      return false;
    }
    if (Boolean(isLocallyAccepted(normalizedGameId))) {
      return false;
    }

    rememberDeadline(normalizedGameId, startSeconds);
    const remainingSeconds = getRemainingSeconds(normalizedGameId, startSeconds);
    if (remainingSeconds <= 0) {
      forgetDeadline(normalizedGameId);
      return false;
    }

    const remainingGraceMs = Math.max(0, graceDeadlineMs - now());
    if (remainingGraceMs <= 0) {
      clearPending({ preserveDeadline: true });
      debug('client-tournament-accept-immediate', {
        gameId: normalizedGameId,
        color,
        remainingSeconds,
      });
      showAcceptBanner({
        gameId: normalizedGameId,
        color,
        startSeconds: remainingSeconds,
      });
      return true;
    }

    pendingBanner = {
      gameId: normalizedGameId,
      color,
      startSeconds: remainingSeconds,
    };
    if (pendingTimeout) {
      clearTimeoutFn(pendingTimeout);
    }
    debug('client-tournament-accept-queued', {
      gameId: normalizedGameId,
      color,
      remainingSeconds,
      graceRemainingMs: remainingGraceMs,
    });
    pendingTimeout = setTimeoutFn(() => {
      pendingTimeout = null;
      flushPending();
    }, remainingGraceMs);
    return true;
  }

  function dispose() {
    clearPending({ preserveDeadline: false });
    releaseGrace();
    acceptDeadlineByGameId.clear();
  }

  return {
    clearPending,
    dispose,
    flushPending,
    forgetDeadline,
    getRemainingSeconds,
    queue,
    releaseGrace,
    rememberDeadline,
    setGrace,
  };
}

export {
  DEFAULT_ACCEPT_WINDOW_SECONDS,
  DEFAULT_MATCH_ACCEPT_GRACE_MS,
};
