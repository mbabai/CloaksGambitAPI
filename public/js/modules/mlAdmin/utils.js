import { ACTIONS, WIN_REASONS } from '/js/modules/constants.js';

export const BUILTIN_MEDIUM_ID = 'builtin:medium-bot';

export function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

export function formatDuration(valueMs) {
  const totalMs = Number(valueMs);
  if (!Number.isFinite(totalMs) || totalMs < 0) return '--';
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  }
  if (totalSeconds > 0) {
    return `${totalSeconds}s`;
  }
  return `${totalMs.toFixed(0)}ms`;
}

export function colorToText(color) {
  if (color === 0) return 'White';
  if (color === 1) return 'Black';
  return 'Unknown';
}

export function identityToSymbol(identity) {
  const mapping = { 1: 'K', 2: 'X', 3: 'B', 4: 'R', 5: 'N' };
  return mapping[identity] || '?';
}

function humanizeToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

export function winReasonToText(reason) {
  if (reason === null || reason === undefined || reason === '') return 'n/a';
  const numeric = Number(reason);
  if (Number.isFinite(numeric)) {
    if (numeric === WIN_REASONS.CAPTURED_KING) return 'Captured King';
    if (numeric === WIN_REASONS.THRONE) return 'Throne';
    if (numeric === WIN_REASONS.TRUE_KING) return 'True King';
    if (numeric === WIN_REASONS.DAGGERS) return 'Daggers';
    if (numeric === WIN_REASONS.TIME_CONTROL) return 'Time Control';
    if (numeric === WIN_REASONS.DISCONNECT) return 'Disconnect';
    if (numeric === WIN_REASONS.RESIGN) return 'Resign';
    if (numeric === WIN_REASONS.DRAW) return 'Draw';
  }
  return humanizeToken(reason);
}

export function normalizeActionTypeConstant(type) {
  if (Number.isFinite(type)) return Number(type);
  const value = String(type || '').trim().toUpperCase();
  if (value === 'SETUP') return ACTIONS.SETUP;
  if (value === 'MOVE') return ACTIONS.MOVE;
  if (value === 'CHALLENGE') return ACTIONS.CHALLENGE;
  if (value === 'BOMB') return ACTIONS.BOMB;
  if (value === 'PASS') return ACTIONS.PASS;
  if (value === 'ON_DECK') return ACTIONS.ON_DECK;
  if (value === 'RESIGN') return ACTIONS.RESIGN;
  if (value === 'READY') return ACTIONS.READY;
  return null;
}

export function actionTypeLabel(type) {
  const normalized = normalizeActionTypeConstant(type);
  if (normalized === ACTIONS.SETUP) return 'Setup';
  if (normalized === ACTIONS.MOVE) return 'Move';
  if (normalized === ACTIONS.CHALLENGE) return 'Challenge';
  if (normalized === ACTIONS.BOMB) return 'Bomb';
  if (normalized === ACTIONS.PASS) return 'Pass';
  if (normalized === ACTIONS.ON_DECK) return 'On Deck';
  if (normalized === ACTIONS.RESIGN) return 'Resign';
  if (normalized === ACTIONS.READY) return 'Ready';
  return 'Action';
}

export function formatActionRecord(actionLike = {}) {
  const normalizedType = normalizeActionTypeConstant(actionLike.type);
  const details = actionLike?.details || {};
  if (normalizedType === ACTIONS.MOVE) {
    const from = details.from || actionLike.from || {};
    const to = details.to || actionLike.to || {};
    const declaration = Number.isFinite(details.declaration) ? details.declaration : actionLike.declaration;
    const declarationText = Number.isFinite(declaration) ? ` ${identityToSymbol(declaration)}` : '';
    return `${from.row},${from.col} -> ${to.row},${to.col}${declarationText}`;
  }
  if (normalizedType === ACTIONS.CHALLENGE) {
    const outcome = String(details.outcome || '').toUpperCase();
    if (outcome === 'SUCCESS') return 'Challenge (success)';
    if (outcome === 'FAIL') return 'Challenge (fail)';
    return 'Challenge';
  }
  if (normalizedType === ACTIONS.BOMB) return 'Bomb';
  if (normalizedType === ACTIONS.PASS) return 'Pass';
  if (normalizedType === ACTIONS.ON_DECK) {
    const identity = Number.isFinite(details.identity) ? details.identity : actionLike.identity;
    return Number.isFinite(identity) ? `On Deck ${identityToSymbol(identity)}` : 'On Deck';
  }
  return actionTypeLabel(normalizedType);
}

export function participantLabel(participant) {
  if (!participant) return 'Unknown';
  if (participant.type === 'builtin') return participant.label || participant.id;
  if (participant.type === 'snapshot') {
    const generation = Number.isFinite(participant.generation) ? ` g${participant.generation}` : '';
    return `${participant.label || participant.snapshotId || participant.id}${generation}`;
  }
  return participant.label || participant.id || 'Unknown';
}

export function snapshotOptionLabel(snapshot) {
  const latestLoss = snapshot?.latestLoss || {};
  const lossBits = [];
  if (Number.isFinite(latestLoss.policyLoss)) lossBits.push(`P ${latestLoss.policyLoss.toFixed(3)}`);
  if (Number.isFinite(latestLoss.valueLoss)) lossBits.push(`V ${latestLoss.valueLoss.toFixed(3)}`);
  if (Number.isFinite(latestLoss.identityLoss)) lossBits.push(`I ${latestLoss.identityLoss.toFixed(3)}`);
  const suffix = lossBits.length ? ` | ${lossBits.join(' ')}` : '';
  return `${snapshot.label} (g${snapshot.generation})${suffix}`;
}

export function parseSnapshotIdFromParticipantRef(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('snapshot:') ? trimmed.slice('snapshot:'.length) : '';
}

export function describeStorage(simulation) {
  const mongo = simulation?.persistence?.mongo || null;
  if (!mongo) {
    return simulation?.gamesStoredExternally ? 'MongoDB' : 'Local runtime';
  }
  if (mongo.saved === false) {
    return `Mongo error: ${mongo.message || mongo.reason || 'save failed'}`;
  }
  return mongo.mode ? `MongoDB (${mongo.mode})` : 'MongoDB';
}

export function formatWinReasonSummary(reasonCounts) {
  if (!reasonCounts || typeof reasonCounts !== 'object') return 'n/a';
  const entries = Object.entries(reasonCounts)
    .filter(([, count]) => Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) return 'n/a';
  return entries
    .slice(0, 4)
    .map(([reason, count]) => `${winReasonToText(reason)} ${count}`)
    .join(' | ');
}

export function getSimulationSnapshotIds(simulation) {
  const ids = new Set();
  const refs = [
    parseSnapshotIdFromParticipantRef(simulation?.participantAId || ''),
    parseSnapshotIdFromParticipantRef(simulation?.participantBId || ''),
    simulation?.whiteSnapshotId || '',
    simulation?.blackSnapshotId || '',
  ];
  refs.forEach((id) => {
    if (id) ids.add(String(id));
  });
  return Array.from(ids);
}

export function getSimulationTrainingEligibility(simulation, snapshotId) {
  const selectedSnapshotId = String(snapshotId || '').trim();
  const status = String(simulation?.status || '').toLowerCase();
  const games = Number(simulation?.stats?.games || simulation?.gameCount || 0);
  const simulationSnapshotIds = getSimulationSnapshotIds(simulation);
  const reasons = [];

  if (!selectedSnapshotId) {
    reasons.push('Choose a base snapshot first.');
  }
  if (selectedSnapshotId && !simulationSnapshotIds.includes(selectedSnapshotId)) {
    reasons.push('Selected snapshot did not play in this run.');
  }
  if (!['completed', 'stopped'].includes(status)) {
    reasons.push(`Simulation status is ${status || 'unknown'}.`);
  }
  if (games <= 0) {
    reasons.push('This run has no completed games.');
  }

  return {
    eligible: Boolean(
      selectedSnapshotId
        && simulationSnapshotIds.includes(selectedSnapshotId)
        && ['completed', 'stopped'].includes(status)
        && games > 0
    ),
    reasons,
  };
}

export function flattenLossHistory(records = []) {
  const series = [];
  const runs = [];

  (Array.isArray(records) ? records : []).forEach((record, runIndex) => {
    const history = Array.isArray(record?.history) && record.history.length
      ? record.history
      : [record];

    runs.push({
      runIndex,
      timestamp: record?.timestamp || null,
      epochs: Number(record?.epochs || history.length || 0),
      learningRate: Number(record?.learningRate || 0),
      sourceGames: Number(record?.sourceGames || 0),
      sourceSimulations: Number(record?.sourceSimulations || 0),
      finalLoss: {
        policyLoss: Number(record?.policyLoss || history[history.length - 1]?.policyLoss || 0),
        valueLoss: Number(record?.valueLoss || history[history.length - 1]?.valueLoss || 0),
        identityLoss: Number(record?.identityLoss || history[history.length - 1]?.identityLoss || 0),
        identityAccuracy: Number(record?.identityAccuracy || history[history.length - 1]?.identityAccuracy || 0),
      },
      label: `${formatDate(record?.timestamp)} | ${Number(record?.epochs || history.length || 0)} epoch(s)`,
    });

    history.forEach((entry, epochIndex) => {
      series.push({
        runIndex,
        globalIndex: series.length,
        epoch: Number(entry?.epoch || (epochIndex + 1)),
        policyLoss: Number(entry?.policyLoss || 0),
        valueLoss: Number(entry?.valueLoss || 0),
        identityLoss: Number(entry?.identityLoss || 0),
        identityAccuracy: Number(entry?.identityAccuracy || 0),
        policySamples: Number(entry?.policySamples || 0),
        valueSamples: Number(entry?.valueSamples || 0),
        identitySamples: Number(entry?.identitySamples || 0),
        timestamp: record?.timestamp || null,
      });
    });
  });

  return { series, runs };
}

export function fillSelect(select, items, options = {}) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';
  if (options.includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = options.blankLabel || 'Select';
    select.appendChild(blank);
  }
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.value;
    option.textContent = item.label;
    select.appendChild(option);
  });
  if (items.some((item) => item.value === previous)) {
    select.value = previous;
  } else if (options.preferredValue && items.some((item) => item.value === options.preferredValue)) {
    select.value = options.preferredValue;
  } else if (items.length) {
    select.value = items[0].value;
  }
}

export function parseNumberInput(element, fallback, asFloat = false) {
  const raw = element?.value || '';
  const parsed = asFloat ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
