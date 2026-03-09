import { ACTIONS, WIN_REASONS, PIECE_IMAGES } from '/js/modules/constants.js';
import { createBoardView } from '/js/modules/components/boardView.js';
import { renderBars } from '/js/modules/render/bars.js';
import { renderStash } from '/js/modules/render/stash.js';
import { computeBoardMetrics } from '/js/modules/layout.js';
import { deriveSpectateView } from '/js/modules/spectate/viewModel.js';
import { getBubbleAsset } from '/js/modules/ui/icons.js';
import { pieceGlyph } from '/js/modules/render/pieceGlyph.js';

const BUILTIN_MEDIUM_ID = 'builtin:medium-bot';

const els = {
  refreshAllBtn: document.getElementById('refreshAllBtn'),
  setAdminSecretBtn: document.getElementById('setAdminSecretBtn'),
  statusText: document.getElementById('statusText'),

  statSnapshots: document.getElementById('statSnapshots'),
  statSimulations: document.getElementById('statSimulations'),
  statGames: document.getElementById('statGames'),
  statTrainingRuns: document.getElementById('statTrainingRuns'),
  liveTrainingBadge: document.getElementById('liveTrainingBadge'),
  liveTrainingBar: document.getElementById('liveTrainingBar'),
  liveTrainingMeta: document.getElementById('liveTrainingMeta'),
  liveSimulationBadge: document.getElementById('liveSimulationBadge'),
  liveSimulationBar: document.getElementById('liveSimulationBar'),
  liveSimulationMeta: document.getElementById('liveSimulationMeta'),
  stopSimulationBtn: document.getElementById('stopSimulationBtn'),

  whiteSnapshotSelect: document.getElementById('whiteSnapshotSelect'),
  blackSnapshotSelect: document.getElementById('blackSnapshotSelect'),
  trainSnapshotSelect: document.getElementById('trainSnapshotSelect'),
  lossSnapshotSelect: document.getElementById('lossSnapshotSelect'),
  snapshotList: document.getElementById('snapshotList'),
  forkSnapshotBtn: document.getElementById('forkSnapshotBtn'),

  gameCountInput: document.getElementById('gameCountInput'),
  maxPliesInput: document.getElementById('maxPliesInput'),
  iterationsInput: document.getElementById('iterationsInput'),
  maxDepthInput: document.getElementById('maxDepthInput'),
  hypothesisCountInput: document.getElementById('hypothesisCountInput'),
  riskBiasInput: document.getElementById('riskBiasInput'),
  explorationInput: document.getElementById('explorationInput'),
  alternateColorsInput: document.getElementById('alternateColorsInput'),
  seedInput: document.getElementById('seedInput'),
  simulationLabelInput: document.getElementById('simulationLabelInput'),
  runSimulationBtn: document.getElementById('runSimulationBtn'),
  simulationList: document.getElementById('simulationList'),

  epochsInput: document.getElementById('epochsInput'),
  lrInput: document.getElementById('lrInput'),
  trainingLabelInput: document.getElementById('trainingLabelInput'),
  trainingSourceSummary: document.getElementById('trainingSourceSummary'),
  trainingSnapshotHint: document.getElementById('trainingSnapshotHint'),
  trainingSelectEligibleBtn: document.getElementById('trainingSelectEligibleBtn'),
  trainingClearSelectionBtn: document.getElementById('trainingClearSelectionBtn'),
  trainingOnlyEligibleInput: document.getElementById('trainingOnlyEligibleInput'),
  trainingSimulationList: document.getElementById('trainingSimulationList'),
  runTrainingBtn: document.getElementById('runTrainingBtn'),

  lossCanvas: document.getElementById('lossCanvas'),
  lossTooltip: document.getElementById('lossTooltip'),
  lossLegend: document.getElementById('lossLegend'),

  replaySimulationSelect: document.getElementById('replaySimulationSelect'),
  replayGameSelect: document.getElementById('replayGameSelect'),
  replayRange: document.getElementById('replayRange'),
  replayFrameLabel: document.getElementById('replayFrameLabel'),
  replayPrevBtn: document.getElementById('replayPrevBtn'),
  replayNextBtn: document.getElementById('replayNextBtn'),
  loadReplayBtn: document.getElementById('loadReplayBtn'),
  replayMeta: document.getElementById('replayMeta'),
  replayBoard: document.getElementById('replayBoard'),
  replayMoveLog: document.getElementById('replayMoveLog'),
  replayPlayArea: document.getElementById('replayPlayArea'),
  replayTopBar: document.getElementById('replayTopBar'),
  replayBottomBar: document.getElementById('replayBottomBar'),
  replayBoardLayer: document.getElementById('replayBoardLayer'),
  replayStashLayer: document.getElementById('replayStashLayer'),
  replayWhiteDeck: document.getElementById('replayWhiteDeck'),
  replayBlackDeck: document.getElementById('replayBlackDeck'),
};

const state = {
  summary: null,
  snapshots: [],
  participants: [],
  simulations: [],
  simulationDetailsById: new Map(),
  replayPayload: null,
  adminSecret: localStorage.getItem('ADMIN_SECRET') || '',
  socket: null,
  liveTraining: null,
  trainingRequestActive: false,
  trainingHasLiveProgress: false,
  trainingHeartbeatTimer: null,
  trainingHeartbeatStartedAt: 0,
  trainingSelection: new Set(),
  trainingVisibleIds: [],
  liveSimulation: null,
  liveSimulationTaskId: '',
  lossChart: {
    history: [],
    plot: null,
    hoverIndex: null,
  },
  replayRenderer: {
    boardView: null,
    refs: {
      boardCells: [],
      activeBubbles: [],
      stashSlots: [],
      deckEl: null,
    },
  },
};

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function toShort(value) {
  if (!value && value !== 0) return '';
  return String(value);
}

function colorToText(color) {
  if (color === 0) return 'White';
  if (color === 1) return 'Black';
  return 'Unknown';
}

function humanizeWinReasonToken(token) {
  const raw = String(token || '').trim();
  if (!raw) return 'Unknown';
  return raw
    .toLowerCase()
    .split('_')
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : ''))
    .join(' ');
}

function winReasonToText(reason) {
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
  return humanizeWinReasonToken(reason);
}

function formatWinReasonSummary(reasonCounts) {
  if (!reasonCounts || typeof reasonCounts !== 'object') return 'n/a';
  const entries = Object.entries(reasonCounts)
    .filter(([, count]) => Number.isFinite(Number(count)) && Number(count) > 0)
    .sort((a, b) => Number(b[1]) - Number(a[1]));
  if (!entries.length) return 'n/a';
  return entries
    .map(([reason, count]) => `${winReasonToText(reason)} ${Number(count)}`)
    .join(' - ');
}

function identityToSymbol(identity) {
  const mapping = { 1: 'K', 2: 'X', 3: 'B', 4: 'R', 5: 'N' };
  return mapping[identity] || '?';
}

function normalizeActionTypeConstant(type) {
  if (Number.isFinite(type)) return Number(type);
  const value = String(type || '').toUpperCase();
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

function actionTypeLabel(type) {
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

function setStatus(message, tone = 'muted') {
  if (!els.statusText) return;
  els.statusText.textContent = message;
  els.statusText.className = 'tiny';
  if (tone === 'ok') {
    els.statusText.classList.add('ok');
  } else if (tone === 'error') {
    els.statusText.classList.add('error');
  } else {
    els.statusText.classList.add('muted');
  }
}

function getHeaders(extra = {}) {
  const headers = { ...extra };
  if (state.adminSecret) {
    headers['x-admin-secret'] = state.adminSecret;
  }
  return headers;
}

async function apiFetch(path, options = {}) {
  const init = { ...options };
  const headers = getHeaders(init.headers || {});
  if (init.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  init.headers = headers;
  const response = await fetch(path, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function parseNumberInput(element, fallback, asFloat = false) {
  const value = element ? element.value : '';
  const parsed = asFloat ? Number.parseFloat(value) : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function fillSelect(select, items, options = {}) {
  if (!select) return;
  const previous = select.value;
  select.innerHTML = '';
  const includeBlank = options.includeBlank || false;
  if (includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = options.blankLabel || 'Auto';
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
  } else if (items.length) {
    select.value = items[0].value;
  }
}

function parseSnapshotIdFromParticipantRef(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('snapshot:')) return trimmed.slice('snapshot:'.length);
  return '';
}

function snapshotOptionLabel(snapshot) {
  const stats = snapshot?.stats || {};
  const winLine = `${stats.whiteWins || 0}W/${stats.blackWins || 0}B/${stats.draws || 0}D`;
  return `${snapshot.label} (${snapshot.id}) - g${snapshot.generation} - ${winLine}`;
}

function participantLabel(participant) {
  if (!participant) return 'Unknown';
  if (participant.type === 'builtin') return participant.label || participant.id;
  if (participant.type === 'snapshot') {
    const generation = Number.isFinite(participant.generation) ? ` g${participant.generation}` : '';
    return `${participant.label || participant.snapshotId || participant.id}${generation}`;
  }
  return participant.label || participant.id || 'Unknown';
}

function simulationSupportsSnapshotTraining(simulation, snapshotId) {
  return getSimulationTrainingEligibility(simulation, snapshotId).eligible;
}

function getSimulationSnapshotIds(simulation) {
  const snapshotIds = new Set();
  if (!simulation || typeof simulation !== 'object') return [];
  const fromParticipants = [
    parseSnapshotIdFromParticipantRef(simulation.participantAId || ''),
    parseSnapshotIdFromParticipantRef(simulation.participantBId || ''),
  ];
  fromParticipants.forEach((id) => {
    if (id) snapshotIds.add(id);
  });
  if (simulation.whiteSnapshotId) snapshotIds.add(String(simulation.whiteSnapshotId));
  if (simulation.blackSnapshotId) snapshotIds.add(String(simulation.blackSnapshotId));
  return Array.from(snapshotIds);
}

function getSimulationTrainingEligibility(simulation, snapshotId) {
  const reasons = [];
  const selectedSnapshotId = String(snapshotId || '').trim();
  const simulationSnapshotIds = getSimulationSnapshotIds(simulation);
  const storage = describeSimulationStorage(simulation);
  const status = String(simulation?.status || 'completed').toLowerCase();
  const games = Number(
    simulation?.stats?.games
    || simulation?.gameCount
    || simulation?.config?.completedGameCount
    || 0,
  );
  const isCompleteLike = status === 'completed' || status === 'stopped';
  const hasSnapshotParticipation = selectedSnapshotId
    ? simulationSnapshotIds.includes(selectedSnapshotId)
    : false;

  if (!selectedSnapshotId) {
    reasons.push('Pick a train snapshot first.');
  } else if (!hasSnapshotParticipation) {
    if (simulationSnapshotIds.length) {
      reasons.push(`This run contains snapshot(s): ${simulationSnapshotIds.join(', ')}`);
    } else {
      reasons.push('This run does not include any snapshot participant.');
    }
  }
  if (!isCompleteLike) {
    reasons.push(`Simulation status is "${status}" (wait for completion).`);
  }
  if (games <= 0) {
    reasons.push('No completed games in this run.');
  }
  if (!storage.ok) {
    reasons.push(`Storage issue: ${storage.label}`);
  }

  const eligible = Boolean(
    selectedSnapshotId
      && hasSnapshotParticipation
      && isCompleteLike
      && games > 0
      && storage.ok,
  );

  return {
    eligible,
    reasons,
    games,
    status,
    storage,
    simulationSnapshotIds,
    hasSnapshotParticipation,
  };
}

function countEligibleTrainingSimulations(snapshotId) {
  if (!snapshotId) return 0;
  return state.simulations.reduce((acc, simulation) => (
    acc + (getSimulationTrainingEligibility(simulation, snapshotId).eligible ? 1 : 0)
  ), 0);
}

function findBestSnapshotForTraining(excludeSnapshotId = '') {
  const candidates = state.snapshots
    .map((snapshot) => ({
      id: snapshot.id,
      label: snapshot.label,
      eligibleCount: countEligibleTrainingSimulations(snapshot.id),
    }))
    .filter((entry) => entry.id !== excludeSnapshotId && entry.eligibleCount > 0)
    .sort((a, b) => b.eligibleCount - a.eligibleCount);
  return candidates[0] || null;
}

function updateTrainingSourceSummary(info = {}) {
  if (!els.trainingSourceSummary) return;
  const selected = Number(info.selected || 0);
  const eligible = Number(info.eligible || 0);
  const total = Number(info.total || 0);
  els.trainingSourceSummary.textContent = `${selected} selected - ${eligible} eligible - ${total} total`;
}

function renderTrainingSnapshotHint({
  selectedSnapshotId = '',
  eligibleCount = 0,
  totalCount = 0,
  visibleCount = 0,
} = {}) {
  if (!els.trainingSnapshotHint) return;
  els.trainingSnapshotHint.innerHTML = '';

  if (!selectedSnapshotId) {
    els.trainingSnapshotHint.textContent = 'Select a snapshot to see trainable simulation sources.';
    return;
  }

  const selectedSnapshot = state.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) || null;
  if (eligibleCount > 0) {
    els.trainingSnapshotHint.textContent = `${eligibleCount} of ${totalCount} simulation runs are trainable for ${selectedSnapshot?.label || selectedSnapshotId}.`;
    return;
  }

  const hintText = document.createElement('span');
  hintText.textContent = `No trainable runs for ${selectedSnapshot?.label || selectedSnapshotId}.`;
  els.trainingSnapshotHint.appendChild(hintText);

  const best = findBestSnapshotForTraining(selectedSnapshotId);
  if (best) {
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'secondary';
    switchBtn.style.padding = '4px 8px';
    switchBtn.textContent = `Switch to ${best.label} (${best.eligibleCount})`;
    switchBtn.addEventListener('click', () => {
      if (els.trainSnapshotSelect) {
        els.trainSnapshotSelect.value = best.id;
      }
      state.trainingSelection.clear();
      renderTrainingSimulationList();
    });
    els.trainingSnapshotHint.appendChild(switchBtn);
  } else if (visibleCount > 0) {
    const detail = document.createElement('span');
    detail.textContent = 'Run new simulations that include this snapshot as a participant.';
    els.trainingSnapshotHint.appendChild(detail);
  }
}

function describeSimulationStorage(simulation) {
  const mongo = simulation?.persistence?.mongo || null;
  if (!mongo) {
    if (simulation?.gamesStoredExternally) {
      return { label: 'MongoDB', ok: true };
    }
    return { label: 'Local runtime', ok: true };
  }
  if (mongo.saved === false) {
    const reason = mongo.message || mongo.reason || 'save failed';
    return { label: `Mongo error: ${reason}`, ok: false };
  }
  const mode = mongo.mode ? ` (${mongo.mode})` : '';
  return { label: `MongoDB${mode}`, ok: true };
}

function formatActionRecord(actionLike = {}) {
  const normalizedType = normalizeActionTypeConstant(actionLike.type);
  const details = actionLike?.details || {};
  if (normalizedType === ACTIONS.MOVE) {
    const from = details.from || actionLike.from || {};
    const to = details.to || actionLike.to || {};
    const declaration = Number.isFinite(details.declaration)
      ? details.declaration
      : actionLike.declaration;
    const declarationText = Number.isFinite(declaration)
      ? ` ${identityToSymbol(declaration)}`
      : '';
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
    const identity = Number.isFinite(details.identity)
      ? details.identity
      : actionLike.identity;
    return Number.isFinite(identity)
      ? `On Deck ${identityToSymbol(identity)}`
      : 'On Deck';
  }
  if (normalizedType === ACTIONS.SETUP) return 'Setup';
  if (normalizedType === ACTIONS.READY) return 'Ready';
  if (normalizedType === ACTIONS.RESIGN) return 'Resign';
  return actionTypeLabel(actionLike.type);
}

function formatDecision(decision = {}) {
  const action = decision.action || decision.move || {};
  return formatActionRecord(action);
}

function updateCountCards() {
  const counts = state.summary?.counts || {};
  if (els.statSnapshots) els.statSnapshots.textContent = counts.snapshots || 0;
  if (els.statSimulations) els.statSimulations.textContent = counts.simulations || 0;
  if (els.statGames) els.statGames.textContent = counts.games || 0;
  if (els.statTrainingRuns) els.statTrainingRuns.textContent = counts.trainingRuns || 0;
}

function renderSnapshotList() {
  if (!els.snapshotList) return;
  els.snapshotList.innerHTML = '';
  if (!state.snapshots.length) {
    els.snapshotList.innerHTML = '<div class="tiny muted">No snapshots yet.</div>';
    return;
  }
  state.snapshots.forEach((snapshot) => {
    const latestLoss = snapshot.latestLoss || null;
    const item = document.createElement('div');
    item.className = 'item';
    item.innerHTML = `
      <h4>${snapshot.label}</h4>
      <p class="tiny">${snapshot.id} - gen ${snapshot.generation} - ${formatDate(snapshot.createdAt)}</p>
      <div class="line"><span>Games</span><strong>${snapshot.stats?.games || 0}</strong></div>
      <div class="line"><span>Train Runs</span><strong>${snapshot.stats?.trainingRuns || 0}</strong></div>
      <div class="line"><span>Loss</span><strong>${latestLoss ? latestLoss.policyLoss.toFixed(3) : 'n/a'} / ${latestLoss ? latestLoss.valueLoss.toFixed(3) : 'n/a'} / ${latestLoss ? latestLoss.identityLoss.toFixed(3) : 'n/a'}</strong></div>
    `;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'secondary';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', async () => {
      try {
        await renameSnapshot(snapshot);
      } catch (err) {
        setStatus(err.message || 'Failed to rename snapshot.', 'error');
      }
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    const canDeleteSnapshot = state.snapshots.length > 1;
    deleteBtn.disabled = !canDeleteSnapshot;
    if (!canDeleteSnapshot) {
      deleteBtn.title = 'At least one snapshot must remain.';
    }
    deleteBtn.addEventListener('click', async () => {
      try {
        await deleteSnapshot(snapshot.id);
      } catch (err) {
        setStatus(err.message || 'Failed to delete snapshot.', 'error');
      }
    });
    actions.appendChild(deleteBtn);

    item.appendChild(actions);
    els.snapshotList.appendChild(item);
  });
}

function renderParticipantSelectors() {
  const fallbackParticipants = [
    { id: BUILTIN_MEDIUM_ID, type: 'builtin', label: 'Medium Bot' },
    ...state.snapshots.map((snapshot) => ({
      id: `snapshot:${snapshot.id}`,
      type: 'snapshot',
      snapshotId: snapshot.id,
      generation: snapshot.generation,
      label: snapshot.label,
    })),
  ];
  const participants = state.participants.length ? state.participants : fallbackParticipants;
  const options = participants.map((participant) => ({
    value: participant.id,
    label: participantLabel(participant),
  }));
  fillSelect(els.whiteSnapshotSelect, options);
  fillSelect(els.blackSnapshotSelect, options);
}

function renderSnapshotTrainingSelectors() {
  const options = state.snapshots.map((snapshot) => ({
    value: snapshot.id,
    label: snapshotOptionLabel(snapshot),
  }));
  fillSelect(els.trainSnapshotSelect, options);
  fillSelect(els.lossSnapshotSelect, options);
}

function renderSimulationList() {
  if (!els.simulationList) return;
  els.simulationList.innerHTML = '';
  if (!state.simulations.length) {
    els.simulationList.innerHTML = '<div class="tiny muted">No simulations yet.</div>';
    return;
  }
  state.simulations.forEach((simulation) => {
    const participantALabel = simulation.participantALabel || simulation.whiteSnapshotId || 'Bot A';
    const participantBLabel = simulation.participantBLabel || simulation.blackSnapshotId || 'Bot B';
    const participantResults = Array.isArray(simulation?.stats?.participantResults)
      ? simulation.stats.participantResults
      : [];
    const participantLine = participantResults.length
      ? participantResults.map((entry) => (
        `${entry.label || entry.participantId}: ${Number(entry.winPct || 0).toFixed(1)}%`
      )).join(' - ')
      : `${simulation.stats?.whiteWins || 0}W / ${simulation.stats?.blackWins || 0}B / ${simulation.stats?.draws || 0}D`;
    const reasonLine = formatWinReasonSummary(simulation?.stats?.winReasons);
    const storage = describeSimulationStorage(simulation);

    const item = document.createElement('div');
    item.className = 'item';
    if (!storage.ok) {
      item.style.borderColor = 'rgba(243, 127, 127, 0.6)';
    }
    item.innerHTML = `
      <h4>${simulation.label || simulation.id}</h4>
      <p class="tiny">${simulation.id} - ${formatDate(simulation.createdAt)}</p>
      <div class="line"><span>Bots</span><strong>${participantALabel} vs ${participantBLabel}</strong></div>
      <div class="line"><span>Sides</span><strong>${simulation.alternateColors ? 'Alternating' : 'Fixed'}</strong></div>
      <div class="line"><span>Games</span><strong>${simulation.stats?.games || 0}</strong></div>
      <div class="line"><span>Win %</span><strong>${participantLine}</strong></div>
      <div class="line"><span>Reasons</span><strong>${reasonLine}</strong></div>
      <div class="line"><span>Avg plies</span><strong>${(simulation.stats?.averagePlies || 0).toFixed(1)}</strong></div>
      <div class="line"><span>Storage</span><strong>${storage.label}</strong></div>
    `;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const replayBtn = document.createElement('button');
    replayBtn.className = 'secondary';
    replayBtn.textContent = 'Replay';
    replayBtn.addEventListener('click', async () => {
      els.replaySimulationSelect.value = simulation.id;
      await onReplaySimulationChanged();
    });
    actions.appendChild(replayBtn);

    const renameBtn = document.createElement('button');
    renameBtn.className = 'secondary';
    renameBtn.textContent = 'Rename';
    renameBtn.addEventListener('click', async () => {
      try {
        await renameSimulationRun(simulation);
      } catch (err) {
        setStatus(err.message || 'Failed to rename simulation.', 'error');
      }
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      try {
        await deleteSimulationRun(simulation.id);
      } catch (err) {
        setStatus(err.message || 'Failed to delete simulation.', 'error');
      }
    });
    actions.appendChild(deleteBtn);

    item.appendChild(actions);
    els.simulationList.appendChild(item);
  });
}

function renderTrainingSimulationList() {
  if (!els.trainingSimulationList) return;
  els.trainingSimulationList.innerHTML = '';
  if (!state.simulations.length) {
    els.trainingSimulationList.innerHTML = '<div class="tiny muted">Run a simulation first.</div>';
    state.trainingVisibleIds = [];
    updateTrainingSourceSummary({ selected: 0, eligible: 0, total: 0 });
    renderTrainingSnapshotHint({
      selectedSnapshotId: els.trainSnapshotSelect?.value || '',
      eligibleCount: 0,
      totalCount: 0,
      visibleCount: 0,
    });
    if (els.trainingSelectEligibleBtn) els.trainingSelectEligibleBtn.disabled = true;
    if (els.trainingClearSelectionBtn) els.trainingClearSelectionBtn.disabled = true;
    return;
  }
  const selectedSnapshotId = els.trainSnapshotSelect?.value || '';
  const showOnlyEligible = Boolean(els.trainingOnlyEligibleInput?.checked);
  let firstEligibleId = '';
  let eligibleCount = 0;
  const visibleEntries = [];
  const eligibleIdSet = new Set();

  state.simulations.forEach((simulation) => {
    const eligibility = getSimulationTrainingEligibility(simulation, selectedSnapshotId);
    if (eligibility.eligible) {
      eligibleCount += 1;
      eligibleIdSet.add(simulation.id);
      if (!firstEligibleId) firstEligibleId = simulation.id;
    }
    if (showOnlyEligible && !eligibility.eligible) {
      return;
    }
    visibleEntries.push({ simulation, eligibility });
  });

  state.trainingVisibleIds = visibleEntries.map((entry) => entry.simulation.id);
  const normalizedSelection = new Set();
  state.trainingSelection.forEach((id) => {
    if (eligibleIdSet.has(id)) normalizedSelection.add(id);
  });
  state.trainingSelection = normalizedSelection;

  if (!state.trainingSelection.size && firstEligibleId) {
    state.trainingSelection.add(firstEligibleId);
  }

  if (!visibleEntries.length) {
    const empty = document.createElement('div');
    empty.className = 'tiny muted';
    empty.textContent = showOnlyEligible
      ? 'No trainable simulations for this snapshot.'
      : 'No simulations to display.';
    els.trainingSimulationList.appendChild(empty);
  }

  visibleEntries.forEach(({ simulation, eligibility }) => {
    const eligible = eligibility.eligible;
    const reasons = Array.isArray(eligibility.reasons) ? eligibility.reasons : [];
    const row = document.createElement('label');
    row.className = 'item';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = 'auto 1fr';
    row.style.gap = '8px';
    row.style.alignItems = 'start';
    if (!eligible) {
      row.style.opacity = '0.62';
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = simulation.id;
    checkbox.style.width = '16px';
    checkbox.style.marginTop = '4px';
    checkbox.disabled = !eligible;
    checkbox.checked = eligible && state.trainingSelection.has(simulation.id);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        state.trainingSelection.add(simulation.id);
      } else {
        state.trainingSelection.delete(simulation.id);
      }
      const selectedCount = getSelectedTrainingSimulationIds(selectedSnapshotId).length;
      updateTrainingSourceSummary({
        selected: selectedCount,
        eligible: eligibleCount,
        total: state.simulations.length,
      });
      if (els.trainingClearSelectionBtn) {
        els.trainingClearSelectionBtn.disabled = state.trainingSelection.size <= 0;
      }
    });
    row.appendChild(checkbox);

    const info = document.createElement('div');
    const selectedSnapshotLabel = state.snapshots.find((snapshot) => snapshot.id === selectedSnapshotId)?.label || selectedSnapshotId;
    const statusText = eligible
      ? `Trainable for ${selectedSnapshotLabel || 'selected snapshot'}`
      : (reasons[0] || 'Not trainable for selected snapshot');
    const extraReasons = reasons.length > 1
      ? `<div class="tiny">${reasons.slice(1).join(' | ')}</div>`
      : '';
    info.innerHTML = `
      <div style="font-size:13px;font-weight:700;">${simulation.id}</div>
      <div class="tiny">${simulation.participantALabel || simulation.whiteSnapshotId} vs ${simulation.participantBLabel || simulation.blackSnapshotId}</div>
      <div class="tiny">${simulation.stats?.games || 0} games - ${formatDate(simulation.createdAt)}</div>
      <div class="training-row-status ${eligible ? 'ok' : 'warn'}">${statusText}</div>
      ${extraReasons}
    `;
    row.appendChild(info);
    els.trainingSimulationList.appendChild(row);
  });

  const selectedCount = getSelectedTrainingSimulationIds(selectedSnapshotId).length;
  updateTrainingSourceSummary({
    selected: selectedCount,
    eligible: eligibleCount,
    total: state.simulations.length,
  });
  renderTrainingSnapshotHint({
    selectedSnapshotId,
    eligibleCount,
    totalCount: state.simulations.length,
    visibleCount: visibleEntries.length,
  });
  if (els.trainingSelectEligibleBtn) els.trainingSelectEligibleBtn.disabled = eligibleCount <= 0;
  if (els.trainingClearSelectionBtn) els.trainingClearSelectionBtn.disabled = state.trainingSelection.size <= 0;
}

function renderReplaySimulationSelector() {
  const options = state.simulations.map((simulation) => ({
    value: simulation.id,
    label: `${simulation.id} - ${simulation.stats?.games || 0} games`,
  }));
  fillSelect(els.replaySimulationSelect, options);
}

function renderMoveLog(actionHistory, actionCount, labels = {}) {
  if (!els.replayMoveLog) return;
  if (!Array.isArray(actionHistory) || !actionHistory.length) {
    els.replayMoveLog.innerHTML = '<div class="tiny muted">No actions recorded.</div>';
    return;
  }
  const safeCount = Math.max(
    0,
    Math.min(actionHistory.length, Number.parseInt(actionCount, 10) || 0),
  );
  els.replayMoveLog.innerHTML = '';
  actionHistory.forEach((action, idx) => {
    const row = document.createElement('div');
    row.className = 'move-line';
    if ((idx + 1) === safeCount) {
      row.style.color = 'var(--accent-strong)';
      row.style.fontWeight = '700';
    }
    const player = Number.isFinite(action?.player) ? action.player : null;
    const actorLabel = player === 0
      ? (labels.white || 'White')
      : player === 1
        ? (labels.black || 'Black')
        : 'System';
    const actor = Number.isFinite(player)
      ? `${colorToText(player)} (${actorLabel})`
      : actorLabel;
    row.textContent = `#${idx + 1} ${actor} ${formatActionRecord(action)}`;
    els.replayMoveLog.appendChild(row);
  });
}

function drawLossChart(history) {
  const canvas = els.lossCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const safeHistory = Array.isArray(history) ? history.slice() : [];
  state.lossChart.history = safeHistory;
  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = '#071b22';
  ctx.fillRect(0, 0, width, height);

  if (!safeHistory.length) {
    state.lossChart.plot = null;
    state.lossChart.hoverIndex = null;
    ctx.fillStyle = '#7ea9a0';
    ctx.font = '24px Trebuchet MS';
    ctx.fillText('No loss history yet', 28, 46);
    if (els.lossLegend) els.lossLegend.textContent = 'Train a snapshot to generate loss stats.';
    if (els.lossTooltip) els.lossTooltip.hidden = true;
    return;
  }

  const margin = { top: 20, right: 16, bottom: 42, left: 62 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const values = [];
  safeHistory.forEach((entry) => {
    values.push(entry.policyLoss || 0, entry.valueLoss || 0, entry.identityLoss || 0);
  });
  const rawMax = Math.max(...values);
  const rawMin = Math.min(...values);
  const spread = Math.max(0.2, rawMax - rawMin);
  const pad = spread * 0.15;
  const maxValue = rawMax + pad;
  const minValue = rawMin - pad;
  const range = Math.max(0.01, maxValue - minValue);

  const series = [
    { field: 'policyLoss', color: '#f4b860', label: 'Policy' },
    { field: 'valueLoss', color: '#8dd9e5', label: 'Value' },
    { field: 'identityLoss', color: '#f37f7f', label: 'Identity' },
  ];

  const xForIndex = (idx) => (
    margin.left + ((plotW * idx) / Math.max(1, safeHistory.length - 1))
  );
  const yForValue = (value) => (
    margin.top + (((maxValue - value) / range) * plotH)
  );

  ctx.strokeStyle = 'rgba(126, 169, 160, 0.22)';
  ctx.lineWidth = 1;
  const yTicks = 5;
  ctx.font = '12px Trebuchet MS';
  ctx.fillStyle = '#7ea9a0';
  for (let tick = 0; tick <= yTicks; tick += 1) {
    const ratio = tick / yTicks;
    const y = margin.top + (plotH * ratio);
    const value = maxValue - (range * ratio);
    ctx.beginPath();
    ctx.moveTo(margin.left, y);
    ctx.lineTo(width - margin.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(3), 10, y + 4);
  }

  const xTickIndices = [];
  const maxXTicks = Math.min(8, safeHistory.length);
  for (let tick = 0; tick < maxXTicks; tick += 1) {
    const idx = Math.round((tick * (safeHistory.length - 1)) / Math.max(1, maxXTicks - 1));
    if (!xTickIndices.includes(idx)) {
      xTickIndices.push(idx);
    }
  }
  ctx.textAlign = 'center';
  xTickIndices.forEach((idx) => {
    const x = xForIndex(idx);
    ctx.beginPath();
    ctx.moveTo(x, margin.top + plotH);
    ctx.lineTo(x, margin.top + plotH + 5);
    ctx.stroke();
    const entry = safeHistory[idx] || {};
    const epoch = Number.isFinite(entry.epoch) ? entry.epoch : (idx + 1);
    ctx.fillText(`E${epoch}`, x, margin.top + plotH + 18);
  });
  ctx.textAlign = 'left';
  ctx.fillText('Loss', 10, 14);
  ctx.textAlign = 'center';
  ctx.fillText('Epoch', margin.left + (plotW / 2), height - 6);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(148, 199, 190, 0.55)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  function plotLine(field, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    safeHistory.forEach((entry, idx) => {
      const x = xForIndex(idx);
      const value = Number(entry[field] || 0);
      const y = yForValue(value);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = color;
    safeHistory.forEach((entry, idx) => {
      const x = xForIndex(idx);
      const y = yForValue(Number(entry[field] || 0));
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  plotLine('policyLoss', '#f4b860');
  plotLine('valueLoss', '#8dd9e5');
  plotLine('identityLoss', '#f37f7f');

  const hoverIndex = Number.isFinite(state.lossChart.hoverIndex)
    ? Math.max(0, Math.min(safeHistory.length - 1, state.lossChart.hoverIndex))
    : null;
  if (hoverIndex !== null) {
    const x = xForIndex(hoverIndex);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    series.forEach((item) => {
      const value = Number(safeHistory[hoverIndex]?.[item.field] || 0);
      const y = yForValue(value);
      ctx.fillStyle = item.color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#052029';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    });
  } else {
    hideLossTooltip();
  }

  state.lossChart.plot = {
    margin,
    plotW,
    plotH,
    width,
    height,
    xForIndex,
    yForValue,
  };

  if (els.lossLegend) {
    const latest = safeHistory[safeHistory.length - 1];
    const hover = hoverIndex !== null ? safeHistory[hoverIndex] : null;
    const hoverLabel = hover
      ? ` | Hover E${Number.isFinite(hover.epoch) ? hover.epoch : (hoverIndex + 1)}`
      : '';
    els.lossLegend.innerHTML = `
      <span style="color:#f4b860;">Policy ${Number(latest.policyLoss || 0).toFixed(3)}</span>
      - <span style="color:#8dd9e5;">Value ${Number(latest.valueLoss || 0).toFixed(3)}</span>
      - <span style="color:#f37f7f;">Identity ${Number(latest.identityLoss || 0).toFixed(3)}</span>
      - Accuracy ${(Number(latest.identityAccuracy || 0) * 100).toFixed(1)}%
      ${hoverLabel}
    `;
  }
}

function hideLossTooltip() {
  if (els.lossTooltip) {
    els.lossTooltip.hidden = true;
  }
}

function updateLossTooltip(event, hoverIndex) {
  if (!els.lossTooltip) return;
  const history = state.lossChart.history || [];
  const entry = history[hoverIndex];
  if (!entry) {
    hideLossTooltip();
    return;
  }

  const epoch = Number.isFinite(entry.epoch) ? entry.epoch : (hoverIndex + 1);
  els.lossTooltip.innerHTML = `
    <div><strong>Epoch ${epoch}</strong></div>
    <div style="color:#f4b860;">Policy: ${Number(entry.policyLoss || 0).toFixed(3)}</div>
    <div style="color:#8dd9e5;">Value: ${Number(entry.valueLoss || 0).toFixed(3)}</div>
    <div style="color:#f37f7f;">Identity: ${Number(entry.identityLoss || 0).toFixed(3)}</div>
    <div>Accuracy: ${(Number(entry.identityAccuracy || 0) * 100).toFixed(1)}%</div>
  `;

  const canvasRect = els.lossCanvas?.getBoundingClientRect();
  const wrapRect = els.lossCanvas?.parentElement?.getBoundingClientRect();
  if (!canvasRect || !wrapRect) {
    hideLossTooltip();
    return;
  }

  const localX = event.clientX - wrapRect.left;
  const localY = event.clientY - wrapRect.top;
  els.lossTooltip.hidden = false;
  let left = localX + 14;
  let top = localY + 10;
  const tipW = els.lossTooltip.offsetWidth || 180;
  const tipH = els.lossTooltip.offsetHeight || 86;
  const maxLeft = Math.max(4, wrapRect.width - tipW - 4);
  const maxTop = Math.max(4, wrapRect.height - tipH - 4);
  left = Math.max(4, Math.min(maxLeft, left));
  top = Math.max(4, Math.min(maxTop, top));
  els.lossTooltip.style.left = `${left}px`;
  els.lossTooltip.style.top = `${top}px`;
}

function onLossCanvasPointerMove(event) {
  const canvas = els.lossCanvas;
  const plot = state.lossChart.plot;
  const history = state.lossChart.history || [];
  if (!canvas || !plot || !history.length) {
    hideLossTooltip();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;

  const minX = plot.margin.left;
  const maxX = plot.margin.left + plot.plotW;
  const minY = plot.margin.top;
  const maxY = plot.margin.top + plot.plotH;
  if (canvasX < minX || canvasX > maxX || canvasY < minY || canvasY > maxY) {
    if (state.lossChart.hoverIndex !== null) {
      state.lossChart.hoverIndex = null;
      drawLossChart(history);
    }
    hideLossTooltip();
    return;
  }

  const ratio = (canvasX - minX) / Math.max(1, plot.plotW);
  const hoverIndex = Math.max(
    0,
    Math.min(history.length - 1, Math.round(ratio * Math.max(1, history.length - 1))),
  );
  if (state.lossChart.hoverIndex !== hoverIndex) {
    state.lossChart.hoverIndex = hoverIndex;
    drawLossChart(history);
  }
  updateLossTooltip(event, hoverIndex);
}

function onLossCanvasPointerLeave() {
  const history = state.lossChart.history || [];
  if (state.lossChart.hoverIndex !== null) {
    state.lossChart.hoverIndex = null;
    drawLossChart(history);
  }
  hideLossTooltip();
}

function normalizeReplayBoard(board) {
  if (!Array.isArray(board)) return [];
  return board.map((row) => (
    Array.isArray(row)
      ? row.map((piece) => (piece ? { ...piece } : null))
      : []
  ));
}

function buildReplayHistoryFallback(decisions) {
  const actions = [];
  const moves = [];
  if (!Array.isArray(decisions)) {
    return { actions, moves };
  }
  decisions.forEach((decision, idx) => {
    const action = decision?.action || decision?.move || null;
    if (!action) return;
    const type = normalizeActionTypeConstant(action.type);
    if (!Number.isFinite(type)) return;
    const player = Number.isFinite(decision?.player)
      ? decision.player
      : (Number.isFinite(action?.player) ? action.player : null);
    const details = {};
    if (action.from && action.to) {
      details.from = { row: action.from.row, col: action.from.col };
      details.to = { row: action.to.row, col: action.to.col };
    }
    if (Number.isFinite(action.declaration)) {
      details.declaration = action.declaration;
    }
    if (Number.isFinite(action.identity)) {
      details.identity = action.identity;
    }
    actions.push({
      type,
      player,
      details,
      timestamp: Number.isFinite(decision?.ply) ? decision.ply : idx,
    });
    if (type === ACTIONS.MOVE && action.from && action.to) {
      moves.push({
        player,
        from: { row: action.from.row, col: action.from.col },
        to: { row: action.to.row, col: action.to.col },
        declaration: action.declaration,
      });
    }
  });
  return { actions, moves };
}

function clearReplayBubbles() {
  const refs = state.replayRenderer.refs;
  if (!Array.isArray(refs.activeBubbles)) {
    refs.activeBubbles = [];
    return;
  }
  refs.activeBubbles.forEach((img) => {
    try {
      if (img && img.parentNode) img.parentNode.removeChild(img);
    } catch (_) {}
  });
  refs.activeBubbles = [];
}

function makeReplayBubbleImg(type, squareSize) {
  const src = getBubbleAsset(type);
  if (!src) return null;
  const img = document.createElement('img');
  img.dataset.bubble = '1';
  img.dataset.bubbleType = type;
  img.draggable = false;
  img.classList.add('cg-spectate-bubble');
  const size = Math.max(0, Math.floor(squareSize * 1.08));
  img.style.setProperty('--cg-spectate-bubble-size', `${size}px`);
  const offsetX = Math.floor(squareSize * 0.6);
  const offsetY = Math.floor(squareSize * 0.5);
  img.style.setProperty('--cg-spectate-bubble-offset-x', `${offsetX}px`);
  img.style.setProperty('--cg-spectate-bubble-offset-y', `${offsetY}px`);
  if (typeof type === 'string' && type.endsWith('Right')) {
    img.classList.add('cg-spectate-bubble--right');
  }
  img.src = src;
  img.alt = '';
  return img;
}

function applyReplayOverlay(squareSize, overlay) {
  clearReplayBubbles();
  const refs = state.replayRenderer.refs;
  if (!overlay) return;
  const cellRef = refs.boardCells?.[overlay.uiR]?.[overlay.uiC];
  if (!cellRef || !cellRef.el) return;
  overlay.types.forEach((type) => {
    const img = makeReplayBubbleImg(type, squareSize);
    if (!img) return;
    try { cellRef.el.style.position = 'relative'; } catch (_) {}
    cellRef.el.appendChild(img);
    refs.activeBubbles.push(img);
  });
}

function ensureReplayRenderer() {
  if (state.replayRenderer.boardView) return;
  if (!els.replayBoardLayer) return;
  state.replayRenderer.refs = {
    boardCells: [],
    activeBubbles: [],
    stashSlots: [],
    deckEl: null,
  };
  state.replayRenderer.boardView = createBoardView({
    container: els.replayBoardLayer,
    identityMap: PIECE_IMAGES,
    refs: state.replayRenderer.refs,
    alwaysAttachGameRefs: true,
  });
  state.replayRenderer.boardView.setReadOnly(true);
}

function renderReplayDeckCard(container, title, piece) {
  if (!container) return;
  container.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = title;
  container.appendChild(label);
  if (!piece) {
    const empty = document.createElement('span');
    empty.className = 'tiny muted';
    empty.textContent = 'None';
    container.appendChild(empty);
    return;
  }
  const glyph = pieceGlyph(piece, 56, PIECE_IMAGES);
  if (glyph) container.appendChild(glyph);
  const text = document.createElement('span');
  text.className = 'tiny';
  text.textContent = `${colorToText(piece.color)} ${identityToSymbol(piece.identity)}`;
  container.appendChild(text);
}

function renderReplayBoardFrame(frame, frameIndex) {
  ensureReplayRenderer();
  if (!state.replayRenderer.boardView || !els.replayPlayArea) return;
  if (!frame || !Array.isArray(frame.board)) {
    state.replayRenderer.boardView.destroy();
    clearReplayBubbles();
    if (els.replayTopBar) els.replayTopBar.innerHTML = '';
    if (els.replayBottomBar) els.replayBottomBar.innerHTML = '';
    if (els.replayStashLayer) els.replayStashLayer.innerHTML = '';
    renderReplayDeckCard(els.replayWhiteDeck, 'White On-Deck', null);
    renderReplayDeckCard(els.replayBlackDeck, 'Black On-Deck', null);
    return;
  }

  const replayGame = state.replayPayload?.game || {};
  const fallbackHistory = buildReplayHistoryFallback(replayGame.decisions || []);
  const actionHistory = Array.isArray(replayGame.actionHistory) && replayGame.actionHistory.length
    ? replayGame.actionHistory
    : fallbackHistory.actions;
  const moveHistory = Array.isArray(replayGame.moveHistory) && replayGame.moveHistory.length
    ? replayGame.moveHistory
    : fallbackHistory.moves;
  const actionCount = Number.isFinite(frame?.actionCount) ? frame.actionCount : frame.ply;
  const moveCount = Number.isFinite(frame?.moveCount) ? frame.moveCount : moveHistory.length;
  const frameActions = actionHistory.slice(0, Math.max(0, Math.min(actionHistory.length, actionCount || 0)));
  const frameMoves = moveHistory
    .slice(0, Math.max(0, Math.min(moveHistory.length, moveCount || 0)))
    .map((move) => ({ ...move }));
  if (frame.lastMove) {
    if (frameMoves.length) {
      frameMoves[frameMoves.length - 1] = { ...frameMoves[frameMoves.length - 1], ...frame.lastMove };
    } else {
      frameMoves.push({ ...frame.lastMove });
    }
  }

  const gameLike = {
    board: normalizeReplayBoard(frame.board),
    actions: frameActions,
    moves: frameMoves,
  };
  const viewState = deriveSpectateView(gameLike);
  const rows = viewState.rows;
  const cols = viewState.cols;
  if (!rows || !cols) return;

  const metrics = computeBoardMetrics(
    els.replayPlayArea.clientWidth,
    els.replayPlayArea.clientHeight,
    cols,
    rows,
  );

  state.replayRenderer.refs.boardCells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  state.replayRenderer.refs.stashSlots = [];

  state.replayRenderer.boardView.render({
    sizes: {
      rows,
      cols,
      squareSize: metrics.squareSize,
      boardLeft: metrics.boardLeft,
      boardTop: metrics.boardTop,
    },
    state: {
      currentBoard: viewState.board,
      currentIsWhite: true,
      selected: null,
      isInSetup: false,
      workingRank: new Array(cols).fill(null),
      pendingCapture: viewState.pendingCapture,
      pendingMoveFrom: viewState.pendingMoveFrom,
      challengeRemoved: viewState.challengeRemoved,
    },
    onAttachGameHandlers: (cell, uiR, uiC) => {
      if (!state.replayRenderer.refs.boardCells[uiR]) {
        state.replayRenderer.refs.boardCells[uiR] = [];
      }
      state.replayRenderer.refs.boardCells[uiR][uiC] = { el: cell, uiR, uiC };
    },
    labelFont: Math.max(10, Math.floor(0.024 * els.replayPlayArea.clientHeight)),
    fileLetters: ['A', 'B', 'C', 'D', 'E'],
    readOnly: true,
    deploymentLines: true,
  });

  const whiteName = state.replayPayload?.game?.whiteParticipantLabel || state.replayPayload?.simulation?.participantALabel || 'White';
  const blackName = state.replayPayload?.game?.blackParticipantLabel || state.replayPayload?.simulation?.participantBLabel || 'Black';

  renderBars({
    topBar: els.replayTopBar,
    bottomBar: els.replayBottomBar,
    sizes: {
      squareSize: metrics.squareSize,
      boardWidth: metrics.boardWidth,
      boardHeight: metrics.boardHeight,
      boardLeft: metrics.boardLeft,
      boardTop: metrics.boardTop,
      playAreaHeight: els.replayPlayArea.clientHeight,
    },
    state: {
      currentIsWhite: true,
      currentCaptured: Array.isArray(frame.captured) ? frame.captured : [[], []],
      currentDaggers: Array.isArray(frame.daggers) ? frame.daggers : [0, 0],
      showChallengeTop: frame.lastAction?.type === ACTIONS.CHALLENGE && frame.lastAction?.player === 1,
      showChallengeBottom: frame.lastAction?.type === ACTIONS.CHALLENGE && frame.lastAction?.player === 0,
      clockTop: '--:--',
      clockBottom: '--:--',
      clockLabel: 'Replay',
      nameTop: blackName,
      nameBottom: whiteName,
      winsTop: 0,
      winsBottom: 0,
      connectionTop: null,
      connectionBottom: null,
      isRankedMatch: false,
    },
    identityMap: PIECE_IMAGES,
  });

  renderStash({
    container: els.replayStashLayer,
    sizes: {
      squareSize: metrics.squareSize,
      boardWidth: metrics.boardWidth,
      boardHeight: metrics.boardHeight,
      boardLeft: metrics.boardLeft,
      boardTop: metrics.boardTop,
      playAreaHeight: els.replayPlayArea.clientHeight,
    },
    state: {
      currentIsWhite: true,
      isInSetup: false,
      workingStash: [],
      workingOnDeck: null,
      currentStashes: Array.isArray(frame.stashes) ? frame.stashes : [[], []],
      currentOnDecks: Array.isArray(frame.onDecks) ? frame.onDecks : [null, null],
      selected: null,
      dragging: null,
      currentOnDeckingPlayer: frame.onDeckingPlayer,
      gameFinished: frame.isActive === false,
    },
    refs: state.replayRenderer.refs,
    identityMap: PIECE_IMAGES,
  });

  const whiteDeck = Array.isArray(frame.onDecks) ? frame.onDecks[0] : null;
  const blackDeck = Array.isArray(frame.onDecks) ? frame.onDecks[1] : null;
  renderReplayDeckCard(els.replayWhiteDeck, 'White On-Deck', whiteDeck);
  renderReplayDeckCard(els.replayBlackDeck, 'Black On-Deck', blackDeck);

  applyReplayOverlay(metrics.squareSize, viewState.overlay);
}

function renderReplayFrame(index) {
  const replay = state.replayPayload?.game?.replay || [];
  const replayGame = state.replayPayload?.game || {};
  const fallbackHistory = buildReplayHistoryFallback(replayGame.decisions || []);
  const actionHistory = Array.isArray(replayGame.actionHistory) && replayGame.actionHistory.length
    ? replayGame.actionHistory
    : fallbackHistory.actions;
  const whiteName = state.replayPayload?.game?.whiteParticipantLabel || state.replayPayload?.simulation?.participantALabel || 'White';
  const blackName = state.replayPayload?.game?.blackParticipantLabel || state.replayPayload?.simulation?.participantBLabel || 'Black';
  if (!replay.length) {
    renderReplayBoardFrame(null, 0);
    if (els.replayFrameLabel) els.replayFrameLabel.textContent = '0 / 0';
    if (els.replayMeta) els.replayMeta.textContent = 'No replay loaded.';
    renderMoveLog([], 0, { white: whiteName, black: blackName });
    return;
  }
  const safeIndex = Math.max(0, Math.min(replay.length - 1, index));
  const frame = replay[safeIndex];
  renderReplayBoardFrame(frame, safeIndex);
  if (els.replayFrameLabel) {
    els.replayFrameLabel.textContent = `${safeIndex} / ${replay.length - 1}`;
  }
  const toMoveText = colorToText(frame.toMove);
  const winnerText = frame.winner === null || frame.winner === undefined ? 'None' : colorToText(frame.winner);
  const decision = frame.decision;
  const frameAction = frame.lastAction || null;
  const frameActionText = frameAction
    ? ` | Last action: ${formatActionRecord(frameAction)}`
    : '';
  const decisionText = decision
    ? ` | Model: ${decision.participantLabel || colorToText(decision.player)} ${formatDecision(decision)} (${Number(decision.valueEstimate || 0).toFixed(3)})`
    : '';
  if (els.replayMeta) {
    const setupText = `Setup ${state.replayPayload?.game?.setupMode || 'random'}`;
    els.replayMeta.textContent = `Frame ${safeIndex} - Ply ${frame.ply} - To move ${toMoveText} - Winner ${winnerText} - Reason ${winReasonToText(frame.winReason)} - ${setupText}${frameActionText}${decisionText}`;
  }
  renderMoveLog(actionHistory, frame.actionCount || frame.ply, { white: whiteName, black: blackName });
}

function stepReplay(delta) {
  const replay = state.replayPayload?.game?.replay || [];
  if (!replay.length || !els.replayRange) return;
  const current = Number.parseInt(els.replayRange.value, 10) || 0;
  const next = Math.max(0, Math.min(replay.length - 1, current + delta));
  els.replayRange.value = String(next);
  renderReplayFrame(next);
}
async function refreshSummary() {
  state.summary = await apiFetch('/api/v1/ml/summary');
  updateCountCards();
}

async function refreshSnapshots() {
  const payload = await apiFetch('/api/v1/ml/snapshots');
  state.snapshots = Array.isArray(payload?.items) ? payload.items : [];
  renderSnapshotTrainingSelectors();
  renderSnapshotList();
}

async function refreshParticipants() {
  try {
    const payload = await apiFetch('/api/v1/ml/participants');
    const items = Array.isArray(payload?.items) ? payload.items : [];
    state.participants = items.map((item) => ({ ...item, id: item.id, type: item.type || 'snapshot' }));
  } catch (_) {
    state.participants = [
      { id: BUILTIN_MEDIUM_ID, type: 'builtin', label: 'Medium Bot' },
      ...state.snapshots.map((snapshot) => ({
        id: `snapshot:${snapshot.id}`,
        type: 'snapshot',
        snapshotId: snapshot.id,
        label: snapshot.label,
        generation: snapshot.generation,
      })),
    ];
  }
  renderParticipantSelectors();
}

async function refreshSimulations() {
  const payload = await apiFetch('/api/v1/ml/simulations?limit=200000');
  state.simulations = Array.isArray(payload?.items) ? payload.items : [];
  const knownIds = new Set(state.simulations.map((simulation) => simulation.id));
  const nextSelection = new Set();
  state.trainingSelection.forEach((id) => {
    if (knownIds.has(id)) nextSelection.add(id);
  });
  state.trainingSelection = nextSelection;
  renderSimulationList();
  renderTrainingSimulationList();
  renderReplaySimulationSelector();
}

async function loadLossForSelectedSnapshot() {
  const snapshotId = els.lossSnapshotSelect?.value || '';
  if (!snapshotId) {
    drawLossChart([]);
    return;
  }
  const payload = await apiFetch(`/api/v1/ml/loss?snapshotId=${encodeURIComponent(snapshotId)}`);
  const history = Array.isArray(payload?.history) ? payload.history : [];
  drawLossChart(history);
}

async function ensureSimulationDetail(simulationId) {
  if (!simulationId) return null;
  const detail = await apiFetch(`/api/v1/ml/simulations/${encodeURIComponent(simulationId)}`);
  state.simulationDetailsById.set(simulationId, detail);
  return detail;
}

async function renameSnapshot(snapshot) {
  if (!snapshot?.id) return;
  const currentLabel = String(snapshot.label || '').trim() || snapshot.id;
  const nextLabelRaw = window.prompt(`Rename snapshot ${snapshot.id}:`, currentLabel);
  if (nextLabelRaw === null) return;
  const nextLabel = nextLabelRaw.trim();
  if (!nextLabel || nextLabel === currentLabel) return;

  setStatus(`Renaming snapshot ${snapshot.id}...`);
  await apiFetch(`/api/v1/ml/snapshots/${encodeURIComponent(snapshot.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: nextLabel }),
  });
  await refreshSummary();
  await refreshSnapshots();
  await refreshParticipants();
  await refreshSimulations();
  setStatus(`Renamed snapshot ${snapshot.id}.`, 'ok');
}

async function deleteSnapshot(snapshotId) {
  if (!snapshotId) return;
  const confirmed = window.confirm(`Delete snapshot ${snapshotId}? This cannot be undone.`);
  if (!confirmed) return;
  setStatus(`Deleting snapshot ${snapshotId}...`);
  await apiFetch(`/api/v1/ml/snapshots/${encodeURIComponent(snapshotId)}`, {
    method: 'DELETE',
  });
  await refreshSummary();
  await refreshSnapshots();
  await refreshParticipants();
  await refreshSimulations();
  await loadLossForSelectedSnapshot();
  setStatus(`Deleted snapshot ${snapshotId}.`, 'ok');
}

async function renameSimulationRun(simulation) {
  if (!simulation?.id) return;
  const currentLabel = String(simulation.label || '').trim() || simulation.id;
  const nextLabelRaw = window.prompt(`Rename simulation ${simulation.id}:`, currentLabel);
  if (nextLabelRaw === null) return;
  const nextLabel = nextLabelRaw.trim();
  if (!nextLabel || nextLabel === currentLabel) return;

  setStatus(`Renaming simulation ${simulation.id}...`);
  await apiFetch(`/api/v1/ml/simulations/${encodeURIComponent(simulation.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: nextLabel }),
  });
  state.simulationDetailsById.delete(simulation.id);
  await refreshSummary();
  await refreshSimulations();
  await onReplaySimulationChanged();
  setStatus(`Renamed simulation ${simulation.id}.`, 'ok');
}

async function deleteSimulationRun(simulationId) {
  if (!simulationId) return;
  const confirmed = window.confirm(`Delete simulation ${simulationId}? This cannot be undone.`);
  if (!confirmed) return;
  const replaySelectionBeforeDelete = els.replaySimulationSelect?.value || '';

  setStatus(`Deleting simulation ${simulationId}...`);
  try {
    await apiFetch(`/api/v1/ml/simulations/${encodeURIComponent(simulationId)}`, {
      method: 'DELETE',
    });
  } catch (err) {
    if (err?.status !== 404) throw err;
  }

  state.simulationDetailsById.delete(simulationId);
  if (state.replayPayload?.simulation?.id === simulationId) {
    state.replayPayload = null;
    if (els.replayRange) {
      els.replayRange.min = '0';
      els.replayRange.max = '0';
      els.replayRange.value = '0';
    }
    renderReplayFrame(0);
  }

  await refreshSummary();
  await refreshSimulations();

  if (replaySelectionBeforeDelete === simulationId) {
    if (state.simulations.length) {
      await onReplaySimulationChanged();
    } else if (els.replayGameSelect) {
      fillSelect(els.replayGameSelect, []);
    }
  }

  setStatus(`Deleted simulation ${simulationId}.`, 'ok');
}

async function stopCurrentSimulationRun() {
  const taskId = state.liveSimulationTaskId || '';
  if (!taskId) {
    setStatus('No running simulation task to stop.', 'error');
    return;
  }
  setStatus(`Stopping simulation task ${taskId}...`);
  try {
    await apiFetch('/api/v1/ml/simulations/stop', {
      method: 'POST',
      body: JSON.stringify({ taskId }),
    });
  } catch (err) {
    if (err?.status !== 404) throw err;
    setStatus('Simulation task is no longer running.', 'error');
    state.liveSimulationTaskId = '';
    setStopSimulationEnabled(false);
    return;
  }
  setLiveSimulationBadge(`Stopping ${taskId}...`, 'ok');
  if (els.liveSimulationMeta) {
    els.liveSimulationMeta.textContent = 'Stop requested. Waiting for current game to finish...';
  }
  setStopSimulationEnabled(false);
}

async function onReplaySimulationChanged() {
  const simulationId = els.replaySimulationSelect?.value || '';
  if (!simulationId) {
    fillSelect(els.replayGameSelect, []);
    return;
  }
  let detail = null;
  try {
    detail = await ensureSimulationDetail(simulationId);
  } catch (err) {
    if (err?.status !== 404) throw err;
    state.simulationDetailsById.delete(simulationId);
    await refreshSummary();
    await refreshSimulations();
    if (!state.simulations.length) {
      fillSelect(els.replayGameSelect, []);
      return;
    }
    detail = await ensureSimulationDetail(els.replaySimulationSelect?.value || '');
  }
  const options = (detail?.games || []).map((game) => ({
    value: game.id,
    label: `${game.id} - ${game.plies} plies - ${game.whiteParticipantLabel || 'White'} vs ${game.blackParticipantLabel || 'Black'} - winner ${game.winner === null ? 'draw' : game.winner === 0 ? 'white' : 'black'} - ${winReasonToText(game.winReason)}`,
  }));
  fillSelect(els.replayGameSelect, options);
}

async function loadReplay() {
  const simulationId = els.replaySimulationSelect?.value || '';
  const gameId = els.replayGameSelect?.value || '';
  if (!simulationId || !gameId) {
    setStatus('Select a simulation and game first.', 'error');
    return;
  }
  setStatus(`Loading replay ${gameId}...`);
  const payload = await apiFetch(`/api/v1/ml/replay/${encodeURIComponent(simulationId)}/${encodeURIComponent(gameId)}`);
  state.replayPayload = payload;
  const replay = payload?.game?.replay || [];
  if (els.replayRange) {
    els.replayRange.min = '0';
    els.replayRange.max = String(Math.max(0, replay.length - 1));
    els.replayRange.value = '0';
  }
  renderReplayFrame(0);
  setStatus(`Replay loaded: ${gameId}`, 'ok');
}

function getSelectedTrainingSimulationIds(snapshotId = '') {
  const targetSnapshotId = String(snapshotId || '').trim() || (els.trainSnapshotSelect?.value || '');
  const selectedSet = state.trainingSelection instanceof Set
    ? state.trainingSelection
    : new Set();
  const selected = Array.from(selectedSet).filter((id) => {
    const simulation = state.simulations.find((item) => item.id === id);
    if (!simulation) return false;
    return getSimulationTrainingEligibility(simulation, targetSnapshotId).eligible;
  });
  return selected;
}

function selectAllEligibleTrainingSources() {
  const snapshotId = els.trainSnapshotSelect?.value || '';
  state.trainingSelection.clear();
  state.simulations.forEach((simulation) => {
    const eligibility = getSimulationTrainingEligibility(simulation, snapshotId);
    if (eligibility.eligible) {
      state.trainingSelection.add(simulation.id);
    }
  });
  renderTrainingSimulationList();
  const selectedCount = getSelectedTrainingSimulationIds(snapshotId).length;
  setStatus(`Selected ${selectedCount} eligible simulation source(s).`, 'ok');
}

function clearTrainingSourceSelection() {
  state.trainingSelection.clear();
  renderTrainingSimulationList();
  setStatus('Cleared selected simulation sources.');
}

async function runSimulation() {
  const whiteParticipantId = els.whiteSnapshotSelect?.value || null;
  const blackParticipantId = els.blackSnapshotSelect?.value || null;
  const payload = {
    whiteParticipantId,
    blackParticipantId,
    gameCount: parseNumberInput(els.gameCountInput, 4),
    maxPlies: parseNumberInput(els.maxPliesInput, 120),
    iterations: parseNumberInput(els.iterationsInput, 90),
    maxDepth: parseNumberInput(els.maxDepthInput, 16),
    hypothesisCount: parseNumberInput(els.hypothesisCountInput, 8),
    riskBias: parseNumberInput(els.riskBiasInput, 0.75, true),
    exploration: parseNumberInput(els.explorationInput, 1.25, true),
    alternateColors: Boolean(els.alternateColorsInput?.checked),
    label: (els.simulationLabelInput?.value || '').trim() || null,
  };
  const whiteSnapshotId = parseSnapshotIdFromParticipantRef(whiteParticipantId || '');
  const blackSnapshotId = parseSnapshotIdFromParticipantRef(blackParticipantId || '');
  if (whiteSnapshotId) payload.whiteSnapshotId = whiteSnapshotId;
  if (blackSnapshotId) payload.blackSnapshotId = blackSnapshotId;

  const seedValue = parseNumberInput(els.seedInput, Number.NaN);
  if (Number.isFinite(seedValue)) payload.seed = seedValue;

  setStatus('Running simulation batch...');
  state.liveSimulationTaskId = '';
  setStopSimulationEnabled(false);
  setLiveSimulationBadge('Submitting simulation run...', 'ok');
  setSimulationProgress(0);
  if (els.liveSimulationMeta) {
    els.liveSimulationMeta.textContent = 'Waiting for first completed game...';
  }
  els.runSimulationBtn.disabled = true;
  try {
    const result = await apiFetch('/api/v1/ml/simulations/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const pctLine = Array.isArray(result?.participantResults)
      ? result.participantResults.map((entry) => `${entry.label}: ${Number(entry.winPct || 0).toFixed(1)}%`).join(' - ')
      : '';
    const isCancelled = Boolean(result?.cancelled);
    const persistenceSaved = result?.persistence?.mongo?.saved !== false;
    const persistenceMessage = result?.persistence?.mongo?.message
      || result?.persistence?.mongo?.reason
      || '';
    const statusPrefix = isCancelled ? 'Simulation stopped' : 'Simulation complete';
    const statusTone = persistenceSaved ? 'ok' : 'error';
    const persistenceSuffix = persistenceSaved ? '' : ` - Mongo save failed (${persistenceMessage || 'unknown'})`;
    setStatus(`${statusPrefix}: ${result?.simulation?.id || ''}${pctLine ? ` - ${pctLine}` : ''}${persistenceSuffix}`, statusTone);
    setLiveSimulationBadge(`${isCancelled ? 'Stopped' : 'Complete'}: ${result?.simulation?.id || ''}`, statusTone);
    if (!isCancelled) {
      setSimulationProgress(1);
    }
    if (els.liveSimulationMeta) {
      const suffix = isCancelled ? ' (stopped)' : '';
      const persistenceText = persistenceSaved ? 'saved to MongoDB' : 'save to MongoDB failed';
      els.liveSimulationMeta.textContent = `${result?.stats?.games || 0} games ${persistenceText}${suffix}`;
    }
    state.simulationDetailsById.clear();
    await refreshSummary();
    await refreshSnapshots();
    await refreshParticipants();
    await refreshSimulations();
    if (result?.simulation?.id) {
      els.replaySimulationSelect.value = result.simulation.id;
      await onReplaySimulationChanged();
    }
  } catch (err) {
    setLiveSimulationBadge('Simulation failed', 'error');
    if (els.liveSimulationMeta) {
      els.liveSimulationMeta.textContent = err.message || 'Simulation failed.';
    }
    throw err;
  } finally {
    els.runSimulationBtn.disabled = false;
  }
}

async function runTraining() {
  const snapshotId = els.trainSnapshotSelect?.value || '';
  if (!snapshotId) {
    setStatus('Select a snapshot to train.', 'error');
    return;
  }
  const simulationIds = getSelectedTrainingSimulationIds(snapshotId);
  if (!simulationIds.length) {
    const eligibleCount = countEligibleTrainingSimulations(snapshotId);
    if (eligibleCount > 0) {
      setStatus('Select at least one eligible simulation source.', 'error');
    } else {
      setStatus('No trainable simulations for this snapshot. Pick a different snapshot or run new simulations.', 'error');
    }
    return;
  }

  const payload = {
    snapshotId,
    simulationIds,
    epochs: parseNumberInput(els.epochsInput, 2),
    learningRate: parseNumberInput(els.lrInput, 0.01, true),
    label: (els.trainingLabelInput?.value || '').trim() || null,
  };

  setStatus(`Training snapshot ${snapshotId}...`);
  state.trainingRequestActive = true;
  state.trainingHasLiveProgress = false;
  setTrainingButtonBusy(true);
  setTrainingProgress(0, { indeterminate: true });
  setTrainingMeta('Submitting training request...');
  setLiveTrainingBadge(`Training ${snapshotId} queued`, 'ok');
  startTrainingHeartbeat();
  try {
    const result = await apiFetch('/api/v1/ml/training/run', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    const newSnapshotId = result?.snapshot?.id;
    setTrainingProgress(1);
    setTrainingMeta(`Training complete. New snapshot: ${newSnapshotId || 'created'}`);
    setLiveTrainingBadge(`Complete: ${newSnapshotId || 'snapshot created'}`, 'ok');
    setStatus(`Training complete. New snapshot: ${newSnapshotId || 'created'}`, 'ok');
    await refreshSummary();
    await refreshSnapshots();
    await refreshParticipants();
    await refreshSimulations();
    if (newSnapshotId) {
      els.trainSnapshotSelect.value = newSnapshotId;
      els.lossSnapshotSelect.value = newSnapshotId;
      await loadLossForSelectedSnapshot();
    }
  } catch (err) {
    setTrainingProgress(0, { error: true });
    setTrainingMeta(err.message || 'Training failed.');
    setLiveTrainingBadge('Training failed', 'error');
    throw err;
  } finally {
    state.trainingRequestActive = false;
    state.trainingHasLiveProgress = false;
    stopTrainingHeartbeat();
    setTrainingButtonBusy(false);
  }
}

async function forkSnapshot() {
  const fromSnapshotId = els.trainSnapshotSelect?.value || '';
  if (!fromSnapshotId) {
    setStatus('Pick a snapshot to fork.', 'error');
    return;
  }
  const label = window.prompt('Fork label (optional):', '') || '';
  setStatus(`Forking ${fromSnapshotId}...`);
  const result = await apiFetch('/api/v1/ml/snapshots/create', {
    method: 'POST',
    body: JSON.stringify({ fromSnapshotId, label: label.trim() || null }),
  });
  setStatus(`Snapshot created: ${result?.snapshot?.id || ''}`, 'ok');
  await refreshSummary();
  await refreshSnapshots();
  await refreshParticipants();
}

function setAdminSecret() {
  const next = window.prompt('Enter ADMIN_SECRET (leave blank to clear):', state.adminSecret || '');
  if (next === null) return;
  state.adminSecret = next.trim();
  if (state.adminSecret) {
    localStorage.setItem('ADMIN_SECRET', state.adminSecret);
    setStatus('Admin secret saved locally.', 'ok');
  } else {
    localStorage.removeItem('ADMIN_SECRET');
    setStatus('Admin secret cleared.', 'ok');
  }
}

async function refreshAll() {
  setStatus('Refreshing ML dashboard...');
  try {
    await refreshSummary();
    await refreshSnapshots();
    await refreshParticipants();
    await refreshSimulations();
    await loadLossForSelectedSnapshot();
    await onReplaySimulationChanged();
    renderReplayFrame(Number.parseInt(els.replayRange?.value || '0', 10) || 0);
    setStatus('Dashboard refreshed.', 'ok');
  } catch (err) {
    setStatus(err.message || 'Failed to refresh dashboard.', 'error');
  }
}

function setSimulationProgress(value) {
  if (!els.liveSimulationBar) return;
  const numeric = Number(value);
  const ratio = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  els.liveSimulationBar.style.width = `${(ratio * 100).toFixed(1)}%`;
}

function setTrainingProgress(value, options = {}) {
  if (!els.liveTrainingBar) return;
  const indeterminate = Boolean(options.indeterminate);
  const error = Boolean(options.error);
  const numeric = Number(value);
  const ratio = Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
  els.liveTrainingBar.classList.toggle('indeterminate', indeterminate);
  els.liveTrainingBar.style.width = indeterminate ? '42%' : `${(ratio * 100).toFixed(1)}%`;
  if (error) {
    els.liveTrainingBar.style.background = 'linear-gradient(90deg, rgba(243, 127, 127, 0.85) 0%, rgba(243, 127, 127, 1) 100%)';
  } else {
    els.liveTrainingBar.style.background = 'linear-gradient(90deg, #f4b860 0%, #ffd58f 100%)';
  }
}

function setTrainingMeta(text = '') {
  if (!els.liveTrainingMeta) return;
  els.liveTrainingMeta.textContent = text;
}

function setTrainingButtonBusy(isBusy) {
  if (!els.runTrainingBtn) return;
  els.runTrainingBtn.disabled = Boolean(isBusy);
  els.runTrainingBtn.textContent = isBusy ? 'Training...' : 'Run Training';
}

function stopTrainingHeartbeat() {
  if (state.trainingHeartbeatTimer) {
    window.clearInterval(state.trainingHeartbeatTimer);
    state.trainingHeartbeatTimer = null;
  }
  state.trainingHeartbeatStartedAt = 0;
}

function startTrainingHeartbeat() {
  stopTrainingHeartbeat();
  state.trainingHeartbeatStartedAt = Date.now();
  state.trainingHeartbeatTimer = window.setInterval(() => {
    if (!state.trainingRequestActive || state.trainingHasLiveProgress) return;
    const elapsedMs = Date.now() - state.trainingHeartbeatStartedAt;
    const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
    setTrainingMeta(`Training request in progress... ${elapsedSec}s elapsed`);
  }, 1000);
}

function setStopSimulationEnabled(enabled) {
  if (!els.stopSimulationBtn) return;
  els.stopSimulationBtn.disabled = !enabled;
}

function setLiveTrainingBadge(text, tone = 'muted') {
  if (!els.liveTrainingBadge) return;
  els.liveTrainingBadge.textContent = text;
  els.liveTrainingBadge.style.borderColor = 'rgba(244, 184, 96, 0.35)';
  els.liveTrainingBadge.style.color = 'var(--accent-strong)';
  if (tone === 'ok') {
    els.liveTrainingBadge.style.borderColor = 'rgba(143, 219, 145, 0.5)';
    els.liveTrainingBadge.style.color = 'var(--success)';
  } else if (tone === 'error') {
    els.liveTrainingBadge.style.borderColor = 'rgba(243, 127, 127, 0.5)';
    els.liveTrainingBadge.style.color = 'var(--danger)';
  }
}

function setLiveSimulationBadge(text, tone = 'muted') {
  if (!els.liveSimulationBadge) return;
  els.liveSimulationBadge.textContent = text;
  els.liveSimulationBadge.style.borderColor = 'rgba(244, 184, 96, 0.35)';
  els.liveSimulationBadge.style.color = 'var(--accent-strong)';
  if (tone === 'ok') {
    els.liveSimulationBadge.style.borderColor = 'rgba(143, 219, 145, 0.5)';
    els.liveSimulationBadge.style.color = 'var(--success)';
  } else if (tone === 'error') {
    els.liveSimulationBadge.style.borderColor = 'rgba(243, 127, 127, 0.5)';
    els.liveSimulationBadge.style.color = 'var(--danger)';
  }
}

function handleTrainingProgress(payload = {}) {
  state.liveTraining = payload;
  const phase = String(payload.phase || '').toLowerCase();
  const totalEpochs = Number(payload.totalEpochs || payload.epochs || 0);
  const currentEpoch = Number(payload.epoch || 0);
  if (phase === 'start') {
    state.trainingHasLiveProgress = true;
    setTrainingProgress(0);
    const simulationCount = Number(payload.sourceSimulations || 0);
    const gameCount = Number(payload.sourceGames || 0);
    setLiveTrainingBadge(`Training ${payload.baseSnapshotId || ''} started`, 'ok');
    setTrainingMeta(`0/${totalEpochs || 0} epochs | ${simulationCount} simulations | ${gameCount} games`);
    setStatus(`Training started for ${payload.baseSnapshotId || 'snapshot'} (${payload.epochs || 0} epochs).`);
    return;
  }
  if (phase === 'epoch') {
    state.trainingHasLiveProgress = true;
    const loss = payload.loss || {};
    const ratio = totalEpochs > 0 ? (currentEpoch / totalEpochs) : 0;
    setTrainingProgress(ratio);
    setLiveTrainingBadge(`Epoch ${payload.epoch || 0}/${payload.totalEpochs || payload.epochs || 0}`, 'ok');
    setTrainingMeta(
      `Epoch ${currentEpoch}/${totalEpochs || 0} | `
      + `P ${Number(loss.policyLoss || 0).toFixed(3)} `
      + `V ${Number(loss.valueLoss || 0).toFixed(3)} `
      + `I ${Number(loss.identityLoss || 0).toFixed(3)}`,
    );
    setStatus(`Epoch ${payload.epoch || 0}/${payload.totalEpochs || payload.epochs || 0} | P ${Number(loss.policyLoss || 0).toFixed(3)} V ${Number(loss.valueLoss || 0).toFixed(3)} I ${Number(loss.identityLoss || 0).toFixed(3)}`);
    return;
  }
  if (phase === 'complete') {
    state.trainingRequestActive = false;
    state.trainingHasLiveProgress = false;
    stopTrainingHeartbeat();
    setTrainingProgress(1);
    setLiveTrainingBadge(`Complete: ${payload.newSnapshotId || 'snapshot created'}`, 'ok');
    setTrainingMeta(`Training complete. New snapshot: ${payload.newSnapshotId || 'created'}`);
    setStatus(`Training complete. New snapshot: ${payload.newSnapshotId || 'created'}`, 'ok');
    return;
  }
  if (phase === 'error') {
    state.trainingRequestActive = false;
    state.trainingHasLiveProgress = false;
    stopTrainingHeartbeat();
    setTrainingProgress(0, { error: true });
    setLiveTrainingBadge('Training failed', 'error');
    setTrainingMeta(payload.message || 'Training failed.');
    setStatus(payload.message || 'Training failed.', 'error');
  }
}

function handleSimulationProgress(payload = {}) {
  state.liveSimulation = payload;
  if (payload.taskId) {
    state.liveSimulationTaskId = payload.taskId;
  }
  const phase = String(payload.phase || '').toLowerCase();
  const completedGames = Number(payload.completedGames || 0);
  const totalGames = Number(payload.gameCount || 0);
  const rawProgress = Number(payload.progress);
  const computedProgress = totalGames > 0 ? (completedGames / totalGames) : 0;
  const progress = Number.isFinite(rawProgress)
    ? Math.max(0, Math.min(1, rawProgress))
    : Math.max(0, Math.min(1, computedProgress));
  const pct = (progress * 100).toFixed(1);

  if (phase === 'start') {
    setLiveSimulationBadge(`Sim ${payload.simulationId || ''} running`, 'ok');
    if (els.liveSimulationMeta) {
      els.liveSimulationMeta.textContent = `0/${totalGames || 0} games complete`;
    }
    setSimulationProgress(0);
    setStopSimulationEnabled(true);
    return;
  }

  if (phase === 'game') {
    const stats = payload.stats || {};
    setLiveSimulationBadge(`Sim ${payload.simulationId || ''}: ${pct}%`, 'ok');
    if (els.liveSimulationMeta) {
      els.liveSimulationMeta.textContent = `${completedGames}/${totalGames || 0} games | ${stats.whiteWins || 0}W ${stats.blackWins || 0}B ${stats.draws || 0}D`;
    }
    setSimulationProgress(progress);
    setStopSimulationEnabled(true);
    return;
  }

  if (phase === 'complete') {
    setLiveSimulationBadge(`Complete: ${payload.simulationId || ''}`, 'ok');
    if (els.liveSimulationMeta) {
      els.liveSimulationMeta.textContent = `${completedGames}/${totalGames || completedGames} games complete`;
    }
    setSimulationProgress(1);
    state.liveSimulationTaskId = '';
    setStopSimulationEnabled(false);
    return;
  }

  if (phase === 'cancelled') {
    setLiveSimulationBadge(`Stopped: ${payload.simulationId || ''}`, 'ok');
    if (els.liveSimulationMeta) {
      els.liveSimulationMeta.textContent = `${completedGames}/${totalGames || completedGames} games complete (stopped)`;
    }
    setSimulationProgress(progress);
    state.liveSimulationTaskId = '';
    setStopSimulationEnabled(false);
    return;
  }

  if (phase === 'error') {
    setLiveSimulationBadge('Simulation failed', 'error');
    if (els.liveSimulationMeta) {
      els.liveSimulationMeta.textContent = payload.message || 'Simulation failed.';
    }
    setSimulationProgress(progress);
    state.liveSimulationTaskId = '';
    setStopSimulationEnabled(false);
  }
}

function connectAdminSocket() {
  if (typeof io !== 'function') {
    setLiveTrainingBadge('Training stream: unavailable', 'error');
    setLiveSimulationBadge('Simulation stream: unavailable', 'error');
    return;
  }
  const origin = window.location.origin.replace(/\/$/, '');
  const socket = io(origin + '/admin');
  state.socket = socket;

  socket.on('connect', () => {
    if (!state.trainingRequestActive) {
      setLiveTrainingBadge('Training stream: connected');
      if (!state.liveTraining || !String(state.liveTraining.phase || '').toLowerCase()) {
        setTrainingMeta('No training running.');
      }
    }
    if (!state.liveSimulation || String(state.liveSimulation.phase || '').toLowerCase() !== 'game') {
      setLiveSimulationBadge('Simulation stream: connected');
    }
  });
  socket.on('disconnect', () => {
    if (state.trainingRequestActive) {
      setLiveTrainingBadge('Training running (stream disconnected)', 'error');
      if (!state.trainingHasLiveProgress) {
        setTrainingMeta('Waiting for API response. Live epoch updates unavailable.');
      }
    } else {
      setLiveTrainingBadge('Training stream: disconnected', 'error');
    }
    setLiveSimulationBadge('Simulation stream: disconnected', 'error');
    setStopSimulationEnabled(false);
  });
  socket.on('ml:trainingProgress', (payload) => handleTrainingProgress(payload));
  socket.on('ml:simulationProgress', (payload) => handleSimulationProgress(payload));
}

function bindEvents() {
  els.refreshAllBtn?.addEventListener('click', () => refreshAll().catch((err) => setStatus(err.message, 'error')));
  els.setAdminSecretBtn?.addEventListener('click', setAdminSecret);
  els.runSimulationBtn?.addEventListener('click', () => runSimulation().catch((err) => setStatus(err.message, 'error')));
  els.stopSimulationBtn?.addEventListener('click', () => stopCurrentSimulationRun().catch((err) => setStatus(err.message, 'error')));
  els.runTrainingBtn?.addEventListener('click', () => runTraining().catch((err) => setStatus(err.message, 'error')));
  els.forkSnapshotBtn?.addEventListener('click', () => forkSnapshot().catch((err) => setStatus(err.message, 'error')));
  els.lossSnapshotSelect?.addEventListener('change', () => loadLossForSelectedSnapshot().catch((err) => setStatus(err.message, 'error')));
  els.lossCanvas?.addEventListener('pointermove', onLossCanvasPointerMove);
  els.lossCanvas?.addEventListener('pointerleave', onLossCanvasPointerLeave);
  els.trainSnapshotSelect?.addEventListener('change', () => {
    state.trainingSelection.clear();
    renderTrainingSimulationList();
  });
  els.trainingSelectEligibleBtn?.addEventListener('click', () => selectAllEligibleTrainingSources());
  els.trainingClearSelectionBtn?.addEventListener('click', () => clearTrainingSourceSelection());
  els.trainingOnlyEligibleInput?.addEventListener('change', () => renderTrainingSimulationList());
  els.replaySimulationSelect?.addEventListener('change', () => onReplaySimulationChanged().catch((err) => setStatus(err.message, 'error')));
  els.loadReplayBtn?.addEventListener('click', () => loadReplay().catch((err) => setStatus(err.message, 'error')));
  els.replayRange?.addEventListener('input', () => {
    const idx = Number.parseInt(els.replayRange.value, 10) || 0;
    renderReplayFrame(idx);
  });
  els.replayPrevBtn?.addEventListener('click', () => stepReplay(-1));
  els.replayNextBtn?.addEventListener('click', () => stepReplay(1));

  window.addEventListener('resize', () => {
    const idx = Number.parseInt(els.replayRange?.value || '0', 10) || 0;
    if (state.replayPayload?.game?.replay?.length) renderReplayFrame(idx);
  });
}

async function boot() {
  connectAdminSocket();
  bindEvents();
  setTrainingProgress(0);
  setTrainingMeta('No training running.');
  setTrainingButtonBusy(false);
  setSimulationProgress(0);
  setStopSimulationEnabled(false);
  await refreshAll();
}

boot().catch((err) => setStatus(err.message || 'Failed to initialize dashboard.', 'error'));
