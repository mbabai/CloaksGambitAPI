const { appendLocalDebugLog } = require('./localDebugLogger');

function toTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function normalizePlayer(value) {
  if (value === 0 || value === 1) return value;
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    if (parsed === 0 || parsed === 1) {
      return parsed;
    }
  }
  return null;
}

function normalizeSetupFlags(flags) {
  if (!Array.isArray(flags)) return [false, false];
  return [
    Boolean(flags[0]),
    Boolean(flags[1]),
  ];
}

function resolveStartTimeMs(game) {
  if (!game) return null;

  const actionTimestamps = Array.isArray(game.actions)
    ? game.actions
        .map((action) => toTimestamp(action?.timestamp))
        .filter((value) => Number.isFinite(value))
    : [];
  const firstAction = actionTimestamps.length > 0 ? Math.min(...actionTimestamps) : null;

  const candidates = [game.startTime, firstAction, game.createdAt];
  for (const candidate of candidates) {
    const ms = toTimestamp(candidate);
    if (Number.isFinite(ms)) {
      return ms;
    }
  }
  return null;
}

function calculateElapsedMs(game, now = Date.now()) {
  const startTimeMs = resolveStartTimeMs(game);
  if (!Number.isFinite(startTimeMs)) {
    return 0;
  }
  return Math.max(0, now - startTimeMs);
}

function mapActions(actions, startTs) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((action) => ({
      timestamp: toTimestamp(action?.timestamp),
      type: action?.type ?? null,
      player: normalizePlayer(action?.player),
    }))
    .filter((action) => Number.isFinite(action.timestamp) && (startTs === null || action.timestamp >= startTs))
    .sort((a, b) => a.timestamp - b.timestamp);
}

function computeGameClockState({
  baseTime,
  increment = 0,
  startTime,
  endTime,
  actions,
  setupComplete,
  playerTurn,
  isActive,
  now = Date.now(),
  setupActionType,
} = {}) {
  const base = Number(baseTime);
  if (!Number.isFinite(base) || base <= 0) {
    return {
      whiteMs: 0,
      blackMs: 0,
      activeColor: null,
      setupComplete: [false, false],
      lastTimestamp: null,
      referenceTimestamp: null,
      tickingWhite: false,
      tickingBlack: false,
    };
  }

  const inc = Number.isFinite(increment) && increment >= 0 ? increment : 0;
  const startTs = toTimestamp(startTime);
  const normalizedSetup = normalizeSetupFlags(setupComplete);

  if (!Number.isFinite(startTs)) {
    const whiteMs = Math.max(0, Math.round(base));
    const blackMs = Math.max(0, Math.round(base));
    const bothSetupDone = normalizedSetup[0] && normalizedSetup[1];
    const activeColor = bothSetupDone ? 0 : null;
    const tickingWhite = Boolean(isActive) && (bothSetupDone ? activeColor === 0 : !normalizedSetup[0]);
    const tickingBlack = Boolean(isActive) && (bothSetupDone ? activeColor === 1 : !normalizedSetup[1]);
    return {
      whiteMs,
      blackMs,
      activeColor,
      setupComplete: normalizedSetup,
      lastTimestamp: null,
      referenceTimestamp: null,
      tickingWhite,
      tickingBlack,
    };
  }

  const orderedActions = mapActions(actions, startTs);
  let white = base;
  let black = base;
  const setupTimeline = [false, false];
  let lastTs = startTs;
  let derivedTurn = null;
  const hasSetupActionType = setupActionType !== undefined && setupActionType !== null;

  orderedActions.forEach((action) => {
    const ts = action.timestamp;
    const delta = Math.max(0, ts - lastTs);
    if (delta > 0) {
      if (!setupTimeline[0] || !setupTimeline[1]) {
        if (!setupTimeline[0]) white -= delta;
        if (!setupTimeline[1]) black -= delta;
      } else if (derivedTurn === 0) {
        white -= delta;
      } else if (derivedTurn === 1) {
        black -= delta;
      }
    }
    lastTs = ts;

    const isSetupAction = hasSetupActionType
      ? action.type === setupActionType
      : action.type === 0;
    if (isSetupAction) {
      if (action.player === 0 || action.player === 1) {
        setupTimeline[action.player] = true;
        if (setupTimeline[0] && setupTimeline[1] && derivedTurn === null) {
          derivedTurn = 0;
        }
      }
      return;
    }

    if (action.type === 7 || action.type === 'READY') {
      return;
    }

    if (derivedTurn === null) {
      derivedTurn = 0;
    }

    if (action.player === 0) {
      white += inc;
      derivedTurn = 1;
    } else if (action.player === 1) {
      black += inc;
      derivedTurn = 0;
    }
  });

  const providedTurn = normalizePlayer(playerTurn);
  const finalSetupFlags = [
    normalizedSetup[0] || setupTimeline[0],
    normalizedSetup[1] || setupTimeline[1],
  ];
  const bothSetupDone = finalSetupFlags[0] && finalSetupFlags[1];
  const activeColor = providedTurn !== null
    ? providedTurn
    : (bothSetupDone ? derivedTurn : null);

  const endTs = toTimestamp(endTime);
  const referenceTimestamp = isActive ? now : (Number.isFinite(endTs) ? endTs : lastTs);
  const tailDelta = Math.max(0, referenceTimestamp - lastTs);
  if (tailDelta > 0) {
    if (!finalSetupFlags[0] || !finalSetupFlags[1]) {
      if (!finalSetupFlags[0]) white -= tailDelta;
      if (!finalSetupFlags[1]) black -= tailDelta;
    } else if (activeColor === 0) {
      white -= tailDelta;
    } else if (activeColor === 1) {
      black -= tailDelta;
    }
  }

  const whiteMs = Math.max(0, Math.round(white));
  const blackMs = Math.max(0, Math.round(black));
  const tickingWhite = Boolean(isActive) && (bothSetupDone ? activeColor === 0 : !finalSetupFlags[0]);
  const tickingBlack = Boolean(isActive) && (bothSetupDone ? activeColor === 1 : !finalSetupFlags[1]);

  return {
    whiteMs,
    blackMs,
    activeColor,
    setupComplete: finalSetupFlags,
    lastTimestamp: lastTs,
    referenceTimestamp,
    tickingWhite,
    tickingBlack,
  };
}

function coerceClockMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric));
}

function cloneClockState(state) {
  if (!state || typeof state !== 'object') {
    return null;
  }
  return {
    whiteMs: coerceClockMs(state.whiteMs),
    blackMs: coerceClockMs(state.blackMs),
    activeColor: normalizePlayer(state.activeColor),
    setupComplete: normalizeSetupFlags(state.setupComplete),
    tickingWhite: Boolean(state.tickingWhite),
    tickingBlack: Boolean(state.tickingBlack),
    lastUpdatedAt: toTimestamp(state.lastUpdatedAt),
  };
}

function summarizeClockState(state) {
  const cloned = cloneClockState(state);
  if (!cloned) {
    return null;
  }
  return {
    whiteMs: cloned.whiteMs,
    blackMs: cloned.blackMs,
    activeColor: cloned.activeColor,
    setupComplete: cloned.setupComplete,
    tickingWhite: cloned.tickingWhite,
    tickingBlack: cloned.tickingBlack,
    lastUpdatedAt: cloned.lastUpdatedAt
      ? new Date(cloned.lastUpdatedAt).toISOString()
      : null,
  };
}

function markClockStateModified(game) {
  if (game && typeof game.markModified === 'function') {
    game.markModified('clockState');
  }
}

function deriveClockActivity({
  setupComplete,
  playerTurn,
  isActive,
} = {}) {
  const normalizedSetup = normalizeSetupFlags(setupComplete);
  if (!isActive) {
    return {
      setupComplete: normalizedSetup,
      activeColor: null,
      tickingWhite: false,
      tickingBlack: false,
    };
  }

  if (!normalizedSetup[0] || !normalizedSetup[1]) {
    return {
      setupComplete: normalizedSetup,
      activeColor: null,
      tickingWhite: !normalizedSetup[0],
      tickingBlack: !normalizedSetup[1],
    };
  }

  const activeColor = normalizePlayer(playerTurn);
  return {
    setupComplete: normalizedSetup,
    activeColor,
    tickingWhite: activeColor === 0,
    tickingBlack: activeColor === 1,
  };
}

function bootstrapStoredClockState(game, { now = Date.now(), setupActionType } = {}) {
  const baseTime = Number(game?.timeControlStart);
  const increment = Number(game?.increment);
  const computed = computeGameClockState({
    baseTime,
    increment: Number.isFinite(increment) && increment >= 0 ? increment : 0,
    startTime: resolveStartTimeMs(game),
    endTime: game?.endTime,
    actions: game?.actions,
    setupComplete: game?.setupComplete,
    playerTurn: game?.playerTurn,
    isActive: Boolean(game?.isActive),
    now,
    setupActionType,
  });
  const activity = deriveClockActivity({
    setupComplete: game?.setupComplete,
    playerTurn: game?.playerTurn,
    isActive: Boolean(game?.isActive),
  });
  return {
    whiteMs: computed.whiteMs,
    blackMs: computed.blackMs,
    activeColor: activity.activeColor,
    setupComplete: activity.setupComplete,
    tickingWhite: activity.tickingWhite,
    tickingBlack: activity.tickingBlack,
    lastUpdatedAt: now,
  };
}

function ensureStoredClockState(game, { now = Date.now(), setupActionType } = {}) {
  if (!game || typeof game !== 'object') {
    return null;
  }

  if (!game.clockState || typeof game.clockState !== 'object') {
    game.clockState = bootstrapStoredClockState(game, { now, setupActionType });
    markClockStateModified(game);
    return game.clockState;
  }

  const cloned = cloneClockState(game.clockState);
  if (!cloned) {
    game.clockState = bootstrapStoredClockState(game, { now, setupActionType });
    markClockStateModified(game);
    return game.clockState;
  }

  game.clockState = {
    whiteMs: cloned.whiteMs,
    blackMs: cloned.blackMs,
    activeColor: cloned.activeColor,
    setupComplete: cloned.setupComplete,
    tickingWhite: cloned.tickingWhite,
    tickingBlack: cloned.tickingBlack,
    lastUpdatedAt: cloned.lastUpdatedAt || now,
  };
  markClockStateModified(game);
  return game.clockState;
}

function advanceStoredClockState(game, { now = Date.now(), setupActionType } = {}) {
  const state = ensureStoredClockState(game, { now, setupActionType });
  if (!state) {
    return null;
  }

  const startTs = toTimestamp(game?.startTime);
  const lastUpdatedAt = (() => {
    const stored = toTimestamp(state.lastUpdatedAt) || now;
    if (Number.isFinite(startTs) && stored < startTs) {
      return startTs;
    }
    return stored;
  })();
  const elapsed = Math.max(0, now - lastUpdatedAt);
  if (elapsed > 0) {
    if (state.tickingWhite) {
      state.whiteMs = Math.max(0, coerceClockMs(state.whiteMs) - elapsed);
    }
    if (state.tickingBlack) {
      state.blackMs = Math.max(0, coerceClockMs(state.blackMs) - elapsed);
    }
  }
  state.lastUpdatedAt = now;
  markClockStateModified(game);
  return state;
}

function addIncrementToColor(state, increment, color) {
  const inc = Number.isFinite(increment) && increment >= 0 ? increment : 0;
  if (!inc || !state) return;
  if (color === 0) {
    state.whiteMs = coerceClockMs(state.whiteMs) + inc;
  } else if (color === 1) {
    state.blackMs = coerceClockMs(state.blackMs) + inc;
  }
}

function transitionStoredClockState(
  game,
  {
    actingColor = null,
    now = Date.now(),
    setupActionType,
    applyIncrement = true,
    reason = 'transition',
  } = {},
) {
  const before = summarizeClockState(game?.clockState);
  const state = advanceStoredClockState(game, { now, setupActionType });
  if (!state) {
    return null;
  }

  if (applyIncrement) {
    addIncrementToColor(state, Number(game?.increment), normalizePlayer(actingColor));
  }

  const activity = deriveClockActivity({
    setupComplete: game?.setupComplete,
    playerTurn: game?.playerTurn,
    isActive: Boolean(game?.isActive),
  });
  state.activeColor = activity.activeColor;
  state.setupComplete = activity.setupComplete;
  state.tickingWhite = activity.tickingWhite;
  state.tickingBlack = activity.tickingBlack;
  state.lastUpdatedAt = now;
  markClockStateModified(game);

  appendLocalDebugLog('clock-transition', {
    gameId: game?._id?.toString?.() || game?._id || null,
    reason,
    actingColor: normalizePlayer(actingColor),
    incrementMs: Number(game?.increment) || 0,
    before,
    after: summarizeClockState(state),
    playerTurn: game?.playerTurn,
    setupComplete: normalizeSetupFlags(game?.setupComplete),
    onDeckingPlayer: game?.onDeckingPlayer ?? null,
    isActive: Boolean(game?.isActive),
  });

  return state;
}

function finalizeStoredClockState(game, { now = Date.now(), setupActionType, reason = 'finalize' } = {}) {
  const before = summarizeClockState(game?.clockState);
  const state = advanceStoredClockState(game, { now, setupActionType });
  if (!state) {
    return null;
  }
  state.activeColor = null;
  state.setupComplete = normalizeSetupFlags(game?.setupComplete);
  state.tickingWhite = false;
  state.tickingBlack = false;
  state.lastUpdatedAt = now;
  markClockStateModified(game);

  appendLocalDebugLog('clock-finalize', {
    gameId: game?._id?.toString?.() || game?._id || null,
    reason,
    before,
    after: summarizeClockState(state),
    winner: game?.winner ?? null,
    winReason: game?.winReason ?? null,
  });

  return state;
}

function getLiveClockStateSnapshot(game, { now = Date.now(), setupActionType } = {}) {
  if (game?.clockState && typeof game.clockState === 'object') {
    const base = cloneClockState(game.clockState);
    if (base) {
      const startTs = toTimestamp(game?.startTime);
      const lastUpdatedAt = (() => {
        const stored = base.lastUpdatedAt || now;
        if (Number.isFinite(startTs) && stored < startTs) {
          return startTs;
        }
        return stored;
      })();
      const elapsed = Math.max(0, now - lastUpdatedAt);
      if (elapsed > 0) {
        if (base.tickingWhite) {
          base.whiteMs = Math.max(0, base.whiteMs - elapsed);
        }
        if (base.tickingBlack) {
          base.blackMs = Math.max(0, base.blackMs - elapsed);
        }
      }
      return {
        whiteMs: base.whiteMs,
        blackMs: base.blackMs,
        activeColor: base.activeColor,
        setupComplete: base.setupComplete,
        tickingWhite: base.tickingWhite,
        tickingBlack: base.tickingBlack,
        lastTimestamp: lastUpdatedAt,
        referenceTimestamp: now,
      };
    }
  }

  const baseTime = Number(game?.timeControlStart);
  const increment = Number(game?.increment);
  return computeGameClockState({
    baseTime,
    increment: Number.isFinite(increment) && increment >= 0 ? increment : 0,
    startTime: resolveStartTimeMs(game),
    endTime: game?.endTime,
    actions: game?.actions,
    setupComplete: game?.setupComplete,
    playerTurn: game?.playerTurn,
    isActive: Boolean(game?.isActive),
    now,
    setupActionType,
  });
}

function describeTimeControl(baseMs, incMs) {
  const parts = [];
  if (Number.isFinite(baseMs) && baseMs > 0) {
    const minutes = Math.floor(baseMs / 60000);
    const seconds = Math.round((baseMs % 60000) / 1000);
    if (minutes > 0 && seconds > 0) {
      parts.push(`${minutes}m ${seconds}s`);
    } else if (minutes > 0) {
      parts.push(`${minutes}m`);
    } else if (seconds > 0) {
      parts.push(`${seconds}s`);
    }
  }
  if (Number.isFinite(incMs) && incMs > 0) {
    const incSeconds = incMs / 1000;
    const formatted = Number.isInteger(incSeconds) ? String(incSeconds) : incSeconds.toFixed(1);
    parts.push(`+ ${formatted}s`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
}

function buildClockPayload(game, { now = Date.now(), setupActionType } = {}) {
  const baseTime = Number(game?.timeControlStart);
  const increment = Number(game?.increment);
  const label = describeTimeControl(
    Number.isFinite(baseTime) ? baseTime : null,
    Number.isFinite(increment) ? increment : null,
  );

  if (!Number.isFinite(baseTime) || baseTime <= 0) {
    return {
      whiteMs: 0,
      blackMs: 0,
      activeColor: null,
      setupComplete: [false, false],
      tickingWhite: false,
      tickingBlack: false,
      label,
    };
  }

  const computed = getLiveClockStateSnapshot(game, {
    now,
    setupActionType,
  });

  return {
    ...computed,
    label,
  };
}

function resolveTimeoutResult(game, { now = Date.now(), setupActionType } = {}) {
  const baseTime = Number(game?.timeControlStart);
  if (!Number.isFinite(baseTime) || baseTime <= 0) {
    return { expired: false, winner: null, draw: false, clock: null };
  }

  const computed = getLiveClockStateSnapshot(game, {
    now,
    setupActionType,
  });

  const whiteExpired = computed.whiteMs <= 0;
  const blackExpired = computed.blackMs <= 0;

  if (!whiteExpired && !blackExpired) {
    return {
      expired: false,
      winner: null,
      draw: false,
      clock: computed,
    };
  }

  if (whiteExpired && blackExpired) {
    return {
      expired: true,
      winner: null,
      draw: true,
      clock: computed,
    };
  }

  return {
    expired: true,
    winner: whiteExpired ? 1 : 0,
    draw: false,
    clock: computed,
  };
}

module.exports = {
  toTimestamp,
  normalizePlayer,
  normalizeSetupFlags,
  resolveStartTimeMs,
  calculateElapsedMs,
  computeGameClockState,
  cloneClockState,
  summarizeClockState,
  deriveClockActivity,
  bootstrapStoredClockState,
  ensureStoredClockState,
  advanceStoredClockState,
  transitionStoredClockState,
  finalizeStoredClockState,
  getLiveClockStateSnapshot,
  describeTimeControl,
  buildClockPayload,
  resolveTimeoutResult,
};
