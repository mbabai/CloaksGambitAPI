import { ACTIONS, WIN_REASONS } from '../constants.js';
import { groupCapturedPiecesByColor } from '../utils/captured.js';

const DEFAULT_TOAST_MS = 2000;
const ANNOUNCEMENT_TOAST_MS = 1400;
const DEFAULT_PULSE_MS = 1500;
const RESULT_TOAST_MS = 5000;
const SPECTATOR_RESULT_MATCH_TYPES = new Set(['RANKED', 'TOURNAMENT_ELIMINATION']);

function toIdString(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'object') {
    if (Object.prototype.hasOwnProperty.call(value, '_id')) {
      return toIdString(value._id);
    }
    if (typeof value.toHexString === 'function') {
      try {
        return value.toHexString();
      } catch (_) {}
    }
    if (typeof value.toString === 'function') {
      try {
        const stringified = value.toString();
        return stringified === '[object Object]' ? '' : stringified;
      } catch (_) {}
    }
  }
  return '';
}

function normalizePlayer(value) {
  if (value === 0 || value === 1) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return parsed === 0 || parsed === 1 ? parsed : null;
  }
  return null;
}

function normalizeTurn(value) {
  return value === 0 || value === 1 ? value : null;
}

function normalizeOutcome(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}

function normalizeDaggers(rawDaggers) {
  if (!Array.isArray(rawDaggers)) {
    return [0, 0];
  }
  return [0, 1].map((color) => {
    const numeric = Number(rawDaggers[color] || 0);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
  });
}

function normalizeCaptured(rawCaptured) {
  const grouped = groupCapturedPiecesByColor(rawCaptured);
  return [0, 1].map((colorIdx) => {
    const pieces = Array.isArray(grouped[colorIdx]) ? grouped[colorIdx] : [];
    return pieces
      .map((piece) => {
        if (!piece || typeof piece !== 'object') {
          return null;
        }
        const color = piece.color === 1 ? 1 : piece.color === 0 ? 0 : null;
        if (color === null) {
          return null;
        }
        const identity = Number(piece.identity);
        return {
          color,
          identity: Number.isFinite(identity) ? identity : null,
        };
      })
      .filter(Boolean);
  });
}

function normalizeActions(rawActions) {
  if (!Array.isArray(rawActions)) {
    return [];
  }
  return rawActions.map((action) => {
    if (!action || typeof action !== 'object') {
      return null;
    }
    return {
      type: Number(action.type),
      player: normalizePlayer(action.player),
      outcome: normalizeOutcome(action?.details?.outcome),
    };
  }).filter(Boolean);
}

function buildPieceKey(piece) {
  if (!piece || typeof piece !== 'object') {
    return 'unknown';
  }
  const color = piece.color === 1 ? 1 : 0;
  const identity = Number.isFinite(Number(piece.identity)) ? Number(piece.identity) : 'unknown';
  return `${color}:${identity}`;
}

function findAddedCaptured(previousCaptured, currentCaptured) {
  const added = [];
  for (let colorIdx = 0; colorIdx < 2; colorIdx += 1) {
    const previousPieces = Array.isArray(previousCaptured?.[colorIdx]) ? previousCaptured[colorIdx] : [];
    const currentPieces = Array.isArray(currentCaptured?.[colorIdx]) ? currentCaptured[colorIdx] : [];
    if (currentPieces.length <= previousPieces.length) {
      continue;
    }

    const previousCounts = new Map();
    previousPieces.forEach((piece) => {
      const key = buildPieceKey(piece);
      previousCounts.set(key, (previousCounts.get(key) || 0) + 1);
    });

    const seenCurrent = new Map();
    currentPieces.forEach((piece, index) => {
      const key = buildPieceKey(piece);
      const occurrence = (seenCurrent.get(key) || 0) + 1;
      seenCurrent.set(key, occurrence);
      if (occurrence > (previousCounts.get(key) || 0)) {
        added.push({
          color: colorIdx,
          index,
          durationMs: DEFAULT_PULSE_MS,
        });
      }
    });
  }
  return added;
}

function buildTurnToast({ currentTurn, viewerColor, viewMode }) {
  if (currentTurn !== 0 && currentTurn !== 1) {
    return null;
  }
  const isSpectator = String(viewMode || '').toLowerCase() === 'spectator';
  if (isSpectator) {
    return {
      text: currentTurn === 0 ? 'White\'s turn' : 'Black\'s turn',
      tone: 'light',
      placement: 'board-center',
      appearance: 'board-turn',
      durationMs: ANNOUNCEMENT_TOAST_MS,
    };
  }
  if (viewerColor !== 0 && viewerColor !== 1) {
    return null;
  }
  return {
    text: currentTurn === viewerColor ? 'Your turn!' : 'Opponent\'s turn',
    tone: 'light',
    placement: 'board-center',
    appearance: 'board-turn',
    durationMs: ANNOUNCEMENT_TOAST_MS,
  };
}

function normalizeName(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function colorLabel(color) {
  return color === 0 ? 'White' : color === 1 ? 'Black' : null;
}

function normalizeMatchType(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isSpectatorResultToastMatchType(matchType) {
  return SPECTATOR_RESULT_MATCH_TYPES.has(normalizeMatchType(matchType));
}

export function describeGameResult({
  winnerColor = null,
  winReason = null,
  whiteName = 'White',
  blackName = 'Black',
} = {}) {
  const numericWinner = Number(winnerColor);
  const normalizedWinner = numericWinner === 0 || numericWinner === 1 ? numericWinner : null;
  const whiteLabel = normalizeName(whiteName, 'White');
  const blackLabel = normalizeName(blackName, 'Black');
  const isDraw = normalizedWinner === null || Number(winReason) === WIN_REASONS.DRAW;

  if (isDraw) {
    return {
      title: 'Draw',
      description: `${whiteLabel} and ${blackLabel} drew the game.`,
      isDraw: true,
      winnerColor: null,
      loserColor: null,
      winnerName: null,
      loserName: null,
    };
  }

  const loserColor = normalizedWinner === 0 ? 1 : 0;
  const winnerName = normalizedWinner === 0 ? whiteLabel : blackLabel;
  const loserName = loserColor === 0 ? whiteLabel : blackLabel;
  const winnerColorLabel = colorLabel(normalizedWinner);
  let description;

  switch (Number(winReason)) {
    case WIN_REASONS.CAPTURED_KING:
      description = `${winnerName} (${winnerColorLabel}) won by capturing ${loserName}'s Heart.`;
      break;
    case WIN_REASONS.THRONE:
      description = `${winnerName} (${winnerColorLabel}) won by advancing their Heart to the final rank.`;
      break;
    case WIN_REASONS.TRUE_KING:
      description = `${winnerName} (${winnerColorLabel}) won because ${loserName} challenged the true Heart.`;
      break;
    case WIN_REASONS.DAGGERS:
      description = `${winnerName} (${winnerColorLabel}) won because ${loserName} accumulated 3 dagger tokens.`;
      break;
    case WIN_REASONS.TIME_CONTROL:
      description = `${winnerName} (${winnerColorLabel}) won because ${loserName} ran out of time.`;
      break;
    case WIN_REASONS.DISCONNECT:
      description = `${winnerName} (${winnerColorLabel}) won because ${loserName} disconnected.`;
      break;
    case WIN_REASONS.RESIGN:
      description = `${winnerName} (${winnerColorLabel}) won because ${loserName} resigned.`;
      break;
    default:
      description = `${winnerName} (${winnerColorLabel}) prevailed.`;
  }

  return {
    title: `${winnerName} Victory`,
    description,
    isDraw: false,
    winnerColor: normalizedWinner,
    loserColor,
    winnerName,
    loserName,
  };
}

export function buildSpectatorGameResultToast({
  matchType = null,
  winner = null,
  winReason = null,
  whiteName = 'White',
  blackName = 'Black',
} = {}) {
  if (!isSpectatorResultToastMatchType(matchType)) {
    return null;
  }
  const result = describeGameResult({
    winnerColor: winner,
    winReason,
    whiteName,
    blackName,
  });
  return {
    title: result.title,
    text: result.description,
    tone: result.isDraw ? 'light' : 'gold',
    placement: 'board-below',
    appearance: 'board-result',
    durationMs: RESULT_TOAST_MS,
  };
}

export function createGameToastSnapshot(gameLike) {
  if (!gameLike || typeof gameLike !== 'object') {
    return null;
  }

  const gameId = toIdString(gameLike.gameId || gameLike._id || gameLike.id);
  if (!gameId) {
    return null;
  }

  return {
    gameId,
    playerTurn: normalizeTurn(gameLike.playerTurn),
    actions: normalizeActions(gameLike.actions),
    daggers: normalizeDaggers(gameLike.daggers),
    capturedByColor: normalizeCaptured(gameLike.captured),
  };
}

export function deriveGameToastFeedback({
  previous,
  current,
  viewerColor = null,
  viewMode = 'player',
} = {}) {
  const emptyFeedback = {
    toasts: [],
    pulses: {
      daggerColors: [],
      captured: [],
    },
  };

  if (!previous || !current) {
    return emptyFeedback;
  }

  if (!previous.gameId || !current.gameId || previous.gameId !== current.gameId) {
    return emptyFeedback;
  }

  const normalizedViewMode = String(viewMode || 'player').toLowerCase();
  const toasts = [];
  const pulses = {
    daggerColors: [],
    captured: [],
  };

  if (current.actions.length > previous.actions.length) {
    const newActions = current.actions.slice(previous.actions.length);
    newActions.forEach((action) => {
      if (!action) return;
      if (
        normalizedViewMode !== 'spectator'
        && action.type === ACTIONS.BOMB
        && action.player !== null
        && action.player !== viewerColor
      ) {
        toasts.push({
          text: 'Poison!',
          tone: 'danger',
          placement: 'board-center',
          appearance: 'board-alert',
          durationMs: ANNOUNCEMENT_TOAST_MS,
        });
      }

      if (normalizedViewMode !== 'spectator' && action.type === ACTIONS.CHALLENGE) {
        toasts.push({
          text: action.outcome === 'SUCCESS' ? 'Challenge Successful!' : 'Challenge Failed',
          tone: 'danger',
          placement: 'board-center',
          appearance: 'board-alert',
          durationMs: ANNOUNCEMENT_TOAST_MS,
        });
      }
    });
  }

  if (
    previous.playerTurn !== null
    && current.playerTurn !== null
    && previous.playerTurn !== current.playerTurn
  ) {
    const turnToast = buildTurnToast({
      currentTurn: current.playerTurn,
      viewerColor,
      viewMode: normalizedViewMode,
    });
    if (turnToast) {
      toasts.push(turnToast);
    }
  }

  [0, 1].forEach((colorIdx) => {
    if ((current.daggers?.[colorIdx] || 0) > (previous.daggers?.[colorIdx] || 0)) {
      pulses.daggerColors.push({
        color: colorIdx,
        durationMs: DEFAULT_PULSE_MS,
      });
    }
  });

  pulses.captured = findAddedCaptured(previous.capturedByColor, current.capturedByColor);

  return { toasts, pulses };
}
