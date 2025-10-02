import { ACTIONS } from '../constants.js';

function parseTimestamp(value) {
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
  const defaults = [false, false];
  if (!Array.isArray(flags)) {
    return defaults;
  }
  const normalized = defaults.map((fallback, index) => {
    if (index >= flags.length) return fallback;
    return Boolean(flags[index]);
  });
  return normalized;
}

function mapActions(actions, startTs) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((action) => {
      const ts = parseTimestamp(action?.timestamp);
      return {
        timestamp: ts,
        type: action?.type || null,
        player: normalizePlayer(action?.player),
      };
    })
    .filter((action) => Number.isFinite(action.timestamp) && (startTs === null || action.timestamp >= startTs))
    .sort((a, b) => a.timestamp - b.timestamp);
}

export function computeGameClockState({
  baseTime,
  increment,
  startTime,
  endTime,
  actions,
  setupComplete,
  playerTurn,
  isActive,
  now = Date.now(),
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
  const startTs = parseTimestamp(startTime);
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

    if (action.type === ACTIONS.SETUP) {
      if (action.player === 0 || action.player === 1) {
        setupTimeline[action.player] = true;
        if (setupTimeline[0] && setupTimeline[1] && derivedTurn === null) {
          derivedTurn = 0;
        }
      }
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

  const endTs = parseTimestamp(endTime);
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
