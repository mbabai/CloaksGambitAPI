import { createLossChart } from '/js/modules/mlAdmin/lossChart.js';
import { createReplayWorkbench } from '/js/modules/mlAdmin/replay.js';
import {
  BUILTIN_MEDIUM_ID,
  colorToText,
  describeStorage,
  fillSelect,
  flattenLossHistory,
  formatDate,
  formatWinReasonSummary,
  getSimulationTrainingEligibility,
  parseNumberInput,
  parseSnapshotIdFromParticipantRef,
  participantLabel,
  snapshotOptionLabel,
  winReasonToText,
} from '/js/modules/mlAdmin/utils.js';

const workflowTabs = Array.from(document.querySelectorAll('[data-workflow-tab]'));
const workflowPanels = Array.from(document.querySelectorAll('[data-workflow-panel]'));
const LIVE_POLL_MS = 3000;
const WORKBENCH_POLL_MS = 15000;

const els = {
  refreshWorkbenchBtn: document.getElementById('refreshWorkbenchBtn'),
  statusText: document.getElementById('statusText'),

  countSnapshots: document.getElementById('countSnapshots'),
  countSimulations: document.getElementById('countSimulations'),
  countGames: document.getElementById('countGames'),
  countTrainingRuns: document.getElementById('countTrainingRuns'),
  latestSimulationSummary: document.getElementById('latestSimulationSummary'),
  latestTrainingSummary: document.getElementById('latestTrainingSummary'),

  simulationStreamBadge: document.getElementById('simulationStreamBadge'),
  simulationProgressBar: document.getElementById('simulationProgressBar'),
  simulationProgressMeta: document.getElementById('simulationProgressMeta'),
  stopSimulationBtn: document.getElementById('stopSimulationBtn'),

  trainingStreamBadge: document.getElementById('trainingStreamBadge'),
  trainingProgressBar: document.getElementById('trainingProgressBar'),
  trainingProgressMeta: document.getElementById('trainingProgressMeta'),
  trainingPolicyLossBar: document.getElementById('trainingPolicyLossBar'),
  trainingPolicyLossValue: document.getElementById('trainingPolicyLossValue'),
  trainingValueLossBar: document.getElementById('trainingValueLossBar'),
  trainingValueLossValue: document.getElementById('trainingValueLossValue'),
  trainingIdentityLossBar: document.getElementById('trainingIdentityLossBar'),
  trainingIdentityLossValue: document.getElementById('trainingIdentityLossValue'),
  trainingAccuracyMeta: document.getElementById('trainingAccuracyMeta'),

  selectedSnapshotSelect: document.getElementById('selectedSnapshotSelect'),
  snapshotList: document.getElementById('snapshotList'),
  forkSnapshotBtn: document.getElementById('forkSnapshotBtn'),
  selectedModelSummary: document.getElementById('selectedModelSummary'),
  selectedModelMeta: document.getElementById('selectedModelMeta'),
  selectedModelStats: document.getElementById('selectedModelStats'),

  whiteParticipantSelect: document.getElementById('whiteParticipantSelect'),
  blackParticipantSelect: document.getElementById('blackParticipantSelect'),
  gameCountInput: document.getElementById('gameCountInput'),
  maxPliesInput: document.getElementById('maxPliesInput'),
  iterationsInput: document.getElementById('iterationsInput'),
  maxDepthInput: document.getElementById('maxDepthInput'),
  hypothesisCountInput: document.getElementById('hypothesisCountInput'),
  riskBiasInput: document.getElementById('riskBiasInput'),
  explorationInput: document.getElementById('explorationInput'),
  seedInput: document.getElementById('seedInput'),
  simulationLabelInput: document.getElementById('simulationLabelInput'),
  alternateColorsInput: document.getElementById('alternateColorsInput'),
  runSimulationBtn: document.getElementById('runSimulationBtn'),
  simulationRunsMeta: document.getElementById('simulationRunsMeta'),
  simulationList: document.getElementById('simulationList'),
  selectedSimulationLabel: document.getElementById('selectedSimulationLabel'),
  selectedSimulationMeta: document.getElementById('selectedSimulationMeta'),
  simulationGameList: document.getElementById('simulationGameList'),

  trainSnapshotSelect: document.getElementById('trainSnapshotSelect'),
  epochsInput: document.getElementById('epochsInput'),
  learningRateInput: document.getElementById('learningRateInput'),
  trainingLabelInput: document.getElementById('trainingLabelInput'),
  trainingSourceMeta: document.getElementById('trainingSourceMeta'),
  trainingSourceList: document.getElementById('trainingSourceList'),
  selectEligibleSourcesBtn: document.getElementById('selectEligibleSourcesBtn'),
  clearTrainingSourcesBtn: document.getElementById('clearTrainingSourcesBtn'),
  runTrainingBtn: document.getElementById('runTrainingBtn'),
  trainingRunList: document.getElementById('trainingRunList'),

  lossSnapshotSelect: document.getElementById('lossSnapshotSelect'),
  lossCanvas: document.getElementById('lossCanvas'),
  lossTooltip: document.getElementById('lossTooltip'),
  lossLegend: document.getElementById('lossLegend'),
  lossRunList: document.getElementById('lossRunList'),

  replaySimulationSelect: document.getElementById('replaySimulationSelect'),
  replayGameSelect: document.getElementById('replayGameSelect'),
  loadReplayBtn: document.getElementById('loadReplayBtn'),
  replayPlayPauseBtn: document.getElementById('replayPlayPauseBtn'),
  replayPrevBtn: document.getElementById('replayPrevBtn'),
  replayNextBtn: document.getElementById('replayNextBtn'),
  replaySpeedSelect: document.getElementById('replaySpeedSelect'),
  replayRange: document.getElementById('replayRange'),
  replayFrameLabel: document.getElementById('replayFrameLabel'),
  replayMeta: document.getElementById('replayMeta'),
  replayWhiteDeck: document.getElementById('replayWhiteDeck'),
  replayBlackDeck: document.getElementById('replayBlackDeck'),
  replayPlayArea: document.getElementById('replayPlayArea'),
  replayTopBar: document.getElementById('replayTopBar'),
  replayBottomBar: document.getElementById('replayBottomBar'),
  replayBoardLayer: document.getElementById('replayBoardLayer'),
  replayStashLayer: document.getElementById('replayStashLayer'),
  replayMoveLog: document.getElementById('replayMoveLog'),
  decisionInspector: document.getElementById('decisionInspector'),
};

const state = {
  summary: null,
  snapshots: [],
  participants: [],
  simulations: [],
  trainingRuns: [],
  simulationDetailsById: new Map(),
  trainingSelection: new Set(),
  activeSimulationTaskId: '',
  activeWorkflowTab: 'simulations',
  selectedSimulationId: '',
  selectedGameId: '',
  selectedSnapshotId: '',
  selectedTrainingRunId: '',
  loadingSimulationId: '',
  liveSimulation: null,
  liveTraining: null,
  liveTrainingHistory: [],
  liveTrainingMeta: null,
  lossChartMode: 'stored',
  lossRequestToken: 0,
  livePollHandle: null,
  workbenchPollHandle: null,
  isRefreshingWorkbench: false,
};

const lossChart = createLossChart({
  canvas: els.lossCanvas,
  tooltip: els.lossTooltip,
  legend: els.lossLegend,
  runList: els.lossRunList,
});

const replayWorkbench = createReplayWorkbench({
  playArea: els.replayPlayArea,
  boardLayer: els.replayBoardLayer,
  topBar: els.replayTopBar,
  bottomBar: els.replayBottomBar,
  stashLayer: els.replayStashLayer,
  whiteDeck: els.replayWhiteDeck,
  blackDeck: els.replayBlackDeck,
  moveLog: els.replayMoveLog,
  decisionInspector: els.decisionInspector,
  meta: els.replayMeta,
  frameLabel: els.replayFrameLabel,
  range: els.replayRange,
  playPauseBtn: els.replayPlayPauseBtn,
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sortByNewest(items = [], getDate = (item) => item?.createdAt) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(getDate(left) || '') || 0;
    const rightTime = Date.parse(getDate(right) || '') || 0;
    return rightTime - leftTime;
  });
}

function getSortedSnapshots() {
  return sortByNewest(state.snapshots, (snapshot) => snapshot?.updatedAt || snapshot?.createdAt)
    .sort((left, right) => {
      const generationDiff = Number(right?.generation || 0) - Number(left?.generation || 0);
      if (generationDiff !== 0) return generationDiff;
      const rightTime = Date.parse(right?.updatedAt || right?.createdAt || '') || 0;
      const leftTime = Date.parse(left?.updatedAt || left?.createdAt || '') || 0;
      return rightTime - leftTime;
    });
}

function getSortedSimulations() {
  return sortByNewest(state.simulations);
}

function getSortedTrainingRuns() {
  return sortByNewest(state.trainingRuns);
}

function getSnapshotById(snapshotId) {
  return state.snapshots.find((snapshot) => snapshot.id === snapshotId) || null;
}

function getTrainingRunById(trainingRunId) {
  return state.trainingRuns.find((trainingRun) => trainingRun.id === trainingRunId) || null;
}

function getSimulationById(simulationId) {
  return state.simulations.find((simulation) => simulation.id === simulationId) || null;
}

function getBootstrapSnapshot() {
  return state.snapshots.find((snapshot) => Number(snapshot?.generation) === 0)
    || state.snapshots.find((snapshot) => String(snapshot?.label || '').toLowerCase().includes('bootstrap'))
    || null;
}

function isTrainingActive() {
  const phase = String(state.liveTraining?.phase || '').toLowerCase();
  return phase === 'start' || phase === 'epoch';
}

function isSimulationActive() {
  const phase = String(state.liveSimulation?.phase || '').toLowerCase();
  return phase === 'start' || phase === 'game';
}

function isTrainingRunSelectable(trainingRun) {
  if (!trainingRun) return false;
  const status = String(trainingRun.status || '').toLowerCase();
  return status === 'running' || status === 'completed' || status === 'error';
}

function setStatus(message, tone = 'muted') {
  if (!els.statusText) return;
  els.statusText.textContent = message;
  els.statusText.className = 'status-text';
  if (tone === 'ok') els.statusText.classList.add('ok');
  else if (tone === 'error') els.statusText.classList.add('error');
  else if (tone === 'warn') els.statusText.classList.add('warn');
  else els.statusText.classList.add('subtle');
}

function updateProgressBar(element, value, tone = 'default') {
  if (!element) return;
  const ratio = Math.max(0, Math.min(1, Number(value) || 0));
  element.style.width = `${(ratio * 100).toFixed(1)}%`;
  element.classList.remove('active', 'error');
  if (tone === 'active') element.classList.add('active');
  if (tone === 'error') element.classList.add('error');
}

function lossToProgress(loss) {
  const numeric = Number(loss);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return Math.max(0, Math.min(1, 1 / (1 + numeric)));
}

function formatLossValue(loss) {
  const numeric = Number(loss);
  return Number.isFinite(numeric) ? numeric.toFixed(3) : '--';
}

function updateLossBar(fillEl, valueEl, loss) {
  if (fillEl) fillEl.style.width = `${(lossToProgress(loss) * 100).toFixed(1)}%`;
  if (valueEl) valueEl.textContent = formatLossValue(loss);
}

function setTrainingLossDisplay(loss = null) {
  updateLossBar(els.trainingPolicyLossBar, els.trainingPolicyLossValue, loss?.policyLoss);
  updateLossBar(els.trainingValueLossBar, els.trainingValueLossValue, loss?.valueLoss);
  updateLossBar(els.trainingIdentityLossBar, els.trainingIdentityLossValue, loss?.identityLoss);
  const accuracy = Number(loss?.identityAccuracy);
  els.trainingAccuracyMeta.textContent = Number.isFinite(accuracy)
    ? `Identity accuracy: ${(accuracy * 100).toFixed(1)}%`
    : 'Identity accuracy: --';
}

function updateReplayControlsState() {
  if (els.loadReplayBtn) {
    els.loadReplayBtn.disabled = !(state.selectedSimulationId && state.selectedGameId);
  }
}

function getHeaders(extra = {}) {
  return { ...extra };
}

async function apiFetch(path, options = {}) {
  const init = { credentials: 'include', ...options };
  init.headers = getHeaders(init.headers || {});
  if (init.body && !init.headers['Content-Type']) {
    init.headers['Content-Type'] = 'application/json';
  }
  const response = await fetch(path, init);
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.code = payload?.code || null;
    throw error;
  }
  return payload;
}

function normalizeWorkbenchPayload(payload = {}) {
  const summary = payload?.summary && typeof payload.summary === 'object' ? payload.summary : { counts: {} };
  const snapshots = Array.isArray(payload?.snapshots?.items)
    ? payload.snapshots.items
    : (Array.isArray(payload?.snapshots)
      ? payload.snapshots
      : (Array.isArray(summary?.snapshots) ? summary.snapshots : []));
  const participants = Array.isArray(payload?.participants?.items)
    ? payload.participants.items
    : (Array.isArray(payload?.participants) ? payload.participants : []);
  const simulations = Array.isArray(payload?.simulations?.items)
    ? payload.simulations.items
    : (Array.isArray(payload?.simulations) ? payload.simulations : []);
  const trainingRuns = Array.isArray(payload?.trainingRuns?.items)
    ? payload.trainingRuns.items
    : (Array.isArray(payload?.trainingRuns) ? payload.trainingRuns : []);
  const live = payload?.live && typeof payload.live === 'object' ? payload.live : null;
  return { summary, snapshots, participants, simulations, trainingRuns, live };
}

async function loadWorkbenchFromLegacyEndpoints() {
  const responses = await Promise.allSettled([
    apiFetch('/api/v1/ml/summary'),
    apiFetch('/api/v1/ml/snapshots'),
    apiFetch('/api/v1/ml/participants'),
    apiFetch('/api/v1/ml/simulations?limit=500'),
    apiFetch('/api/v1/ml/training/runs?limit=50'),
    apiFetch('/api/v1/ml/live'),
  ]);
  const [summaryResponse, snapshotsResponse, participantsResponse, simulationsResponse, trainingRunsResponse, liveResponse] = responses;
  const summary = summaryResponse.status === 'fulfilled' ? summaryResponse.value : {};
  const snapshotsPayload = snapshotsResponse.status === 'fulfilled' ? snapshotsResponse.value : {};
  const participantsPayload = participantsResponse.status === 'fulfilled' ? participantsResponse.value : {};
  const simulationsPayload = simulationsResponse.status === 'fulfilled' ? simulationsResponse.value : {};
  const trainingRunsPayload = trainingRunsResponse.status === 'fulfilled' ? trainingRunsResponse.value : {};
  const livePayload = liveResponse.status === 'fulfilled' ? liveResponse.value : null;
  return {
    summary: {
      ...(summary || {}),
      snapshots: Array.isArray(summary?.snapshots)
        ? summary.snapshots
        : (Array.isArray(snapshotsPayload?.items) ? snapshotsPayload.items : []),
    },
    snapshots: Array.isArray(snapshotsPayload?.items) ? snapshotsPayload.items : [],
    participants: Array.isArray(participantsPayload?.items)
      ? participantsPayload.items
      : (Array.isArray(participantsPayload) ? participantsPayload : []),
    simulations: { items: Array.isArray(simulationsPayload?.items) ? simulationsPayload.items : [] },
    trainingRuns: { items: Array.isArray(trainingRunsPayload?.items) ? trainingRunsPayload.items : [] },
    live: livePayload,
  };
}

async function loadWorkbench() {
  let payload = null;
  try {
    payload = await apiFetch('/api/v1/ml/workbench?limit=500&trainingLimit=50');
  } catch (err) {
    if (err?.status !== 404) throw err;
    console.warn('ML workbench endpoint unavailable; falling back to legacy ML endpoints.', err);
    payload = await loadWorkbenchFromLegacyEndpoints();
  }
  const normalized = normalizeWorkbenchPayload(payload);
  state.summary = normalized.summary;
  state.snapshots = normalized.snapshots;
  state.participants = normalized.participants;
  state.simulations = normalized.simulations;
  state.trainingRuns = normalized.trainingRuns;
  const knownSimulationIds = new Set(state.simulations.map((simulation) => simulation.id));
  state.trainingSelection = new Set(
    Array.from(state.trainingSelection).filter((simulationId) => knownSimulationIds.has(simulationId)),
  );
  return normalized.live;
}

function buildParticipantOptions() {
  const catalog = state.participants.length
    ? state.participants
    : [
        ...state.snapshots.map((snapshot) => ({
          id: `snapshot:${snapshot.id}`,
          type: 'snapshot',
          snapshotId: snapshot.id,
          label: snapshot.label,
          generation: snapshot.generation,
        })),
        { id: BUILTIN_MEDIUM_ID, type: 'builtin', label: 'Medium Bot' },
      ];
  const seen = new Set();
  const options = catalog.filter((participant) => {
    if (!participant?.id || seen.has(participant.id)) return false;
    seen.add(participant.id);
    return true;
  });
  const bootstrapSnapshot = getBootstrapSnapshot();
  const bootstrapParticipantId = bootstrapSnapshot ? `snapshot:${bootstrapSnapshot.id}` : '';
  options.sort((left, right) => {
    const rank = (participant) => {
      if (participant.id === bootstrapParticipantId) return 0;
      if (participant.id === BUILTIN_MEDIUM_ID) return 1;
      if (participant.type === 'snapshot') return 10 - Number(participant.generation || 0);
      return 20;
    };
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) return rankDiff;
    return participantLabel(left).localeCompare(participantLabel(right));
  });
  return options.map((participant) => ({ value: participant.id, label: participantLabel(participant) }));
}

function getDefaultParticipantSelections(options) {
  const bootstrapSnapshot = getBootstrapSnapshot();
  const bootstrapId = bootstrapSnapshot ? `snapshot:${bootstrapSnapshot.id}` : '';
  const values = new Set(options.map((option) => option.value));
  const whiteDefault = values.has(bootstrapId)
    ? bootstrapId
    : values.has(BUILTIN_MEDIUM_ID)
      ? BUILTIN_MEDIUM_ID
      : (options[0]?.value || '');
  const blackDefault = values.has(BUILTIN_MEDIUM_ID)
    ? BUILTIN_MEDIUM_ID
    : values.has(bootstrapId)
      ? bootstrapId
      : (options.find((option) => option.value !== whiteDefault)?.value || options[0]?.value || '');
  return { whiteDefault, blackDefault };
}

function pruneTrainingSelection(snapshotId) {
  state.trainingSelection = new Set(
    Array.from(state.trainingSelection).filter((simulationId) => (
      getSimulationTrainingEligibility(getSimulationById(simulationId), snapshotId).eligible
    )),
  );
}

function syncSelections(options = {}) {
  const snapshotIds = new Set(state.snapshots.map((snapshot) => snapshot.id));
  const simulationIds = new Set(state.simulations.map((simulation) => simulation.id));
  const trainingRunIds = new Set(state.trainingRuns.map((trainingRun) => trainingRun.id));
  if (options.preferSnapshotId && snapshotIds.has(options.preferSnapshotId)) {
    state.selectedSnapshotId = options.preferSnapshotId;
    state.selectedTrainingRunId = '';
  } else if (!snapshotIds.has(state.selectedSnapshotId)) {
    state.selectedSnapshotId = getSortedSnapshots()[0]?.id || '';
  }
  if (options.preferTrainingRunId && trainingRunIds.has(options.preferTrainingRunId)) {
    state.selectedTrainingRunId = options.preferTrainingRunId;
  } else if (state.selectedTrainingRunId && !trainingRunIds.has(state.selectedTrainingRunId)) {
    state.selectedTrainingRunId = '';
  }
  if (options.preferSimulationId && simulationIds.has(options.preferSimulationId)) {
    state.selectedSimulationId = options.preferSimulationId;
  } else if (!simulationIds.has(state.selectedSimulationId)) {
    state.selectedSimulationId = getSortedSimulations()[0]?.id || '';
  }
  const trainSnapshotId = snapshotIds.has(els.trainSnapshotSelect?.value || '')
    ? els.trainSnapshotSelect.value
    : state.selectedSnapshotId;
  pruneTrainingSelection(trainSnapshotId);
  if (options.workflowTab) state.activeWorkflowTab = options.workflowTab;
}

function setActiveWorkflowTab(nextTab) {
  const activeTab = nextTab === 'training' ? 'training' : 'simulations';
  state.activeWorkflowTab = activeTab;
  workflowTabs.forEach((button) => {
    const isActive = button.dataset.workflowTab === activeTab;
    button.classList.toggle('active', isActive);
    button.classList.toggle('secondary', !isActive);
  });
  workflowPanels.forEach((panel) => {
    panel.classList.toggle('active', panel.dataset.workflowPanel === activeTab);
  });
}

function updateSummaryPanel() {
  const counts = state.summary?.counts || {};
  els.countSnapshots.textContent = counts.snapshots || 0;
  els.countSimulations.textContent = counts.simulations || 0;
  els.countGames.textContent = counts.games || 0;
  els.countTrainingRuns.textContent = counts.trainingRuns || 0;
  const latestSimulation = state.summary?.latestSimulation || null;
  const latestTraining = state.summary?.latestTraining || null;
  els.latestSimulationSummary.textContent = latestSimulation
    ? `Latest simulation: ${latestSimulation.label} | ${latestSimulation.gameCount} games | ${formatWinReasonSummary(latestSimulation?.stats?.winReasons)}`
    : 'No simulations yet.';
  els.latestTrainingSummary.textContent = latestTraining
    ? `Latest training: ${latestTraining.newSnapshotId} from ${latestTraining.sourceGames} games at ${formatDate(latestTraining.createdAt)}`
    : 'No training runs yet.';
}

function renderSnapshotSelects() {
  const options = getSortedSnapshots().map((snapshot) => ({
    value: snapshot.id,
    label: snapshotOptionLabel(snapshot),
  }));
  fillSelect(els.selectedSnapshotSelect, options, { preferredValue: state.selectedSnapshotId || '' });
  fillSelect(els.trainSnapshotSelect, options, {
    preferredValue: els.trainSnapshotSelect?.value || state.selectedSnapshotId || '',
  });
  fillSelect(els.lossSnapshotSelect, options, { preferredValue: state.selectedSnapshotId || '' });
  state.selectedSnapshotId = els.selectedSnapshotSelect?.value || '';
}

function renderParticipantSelects() {
  const options = buildParticipantOptions();
  const defaults = getDefaultParticipantSelections(options);
  fillSelect(els.whiteParticipantSelect, options, {
    preferredValue: els.whiteParticipantSelect?.value || defaults.whiteDefault,
  });
  fillSelect(els.blackParticipantSelect, options, {
    preferredValue: els.blackParticipantSelect?.value || defaults.blackDefault,
  });
}

function updateTrainingSourceMeta() {
  const snapshotId = els.trainSnapshotSelect?.value || '';
  if (!snapshotId) {
    els.trainingSourceMeta.textContent = 'Choose a base snapshot to see trainable simulation runs.';
    els.selectEligibleSourcesBtn.disabled = true;
    els.clearTrainingSourcesBtn.disabled = state.trainingSelection.size <= 0;
    return;
  }
  let eligibleCount = 0;
  let selectedEligibleCount = 0;
  state.simulations.forEach((simulation) => {
    const eligibility = getSimulationTrainingEligibility(simulation, snapshotId);
    if (eligibility.eligible) {
      eligibleCount += 1;
      if (state.trainingSelection.has(simulation.id)) selectedEligibleCount += 1;
    }
  });
  els.trainingSourceMeta.textContent = `${selectedEligibleCount} selected | ${eligibleCount} eligible | ${state.simulations.length} total runs`;
  els.selectEligibleSourcesBtn.disabled = eligibleCount <= 0;
  els.clearTrainingSourcesBtn.disabled = state.trainingSelection.size <= 0;
}

function renderSnapshotList() {
  els.snapshotList.innerHTML = '';
  const selectedTrainingRun = getTrainingRunById(state.selectedTrainingRunId);
  if (selectedTrainingRun && !selectedTrainingRun.newSnapshotId) {
    const latestLoss = selectedTrainingRun.finalLoss || null;
    const row = document.createElement('article');
    row.className = 'detail-row active';
    row.dataset.trainingRunId = selectedTrainingRun.id;
    row.innerHTML = `
      <div class="detail-row-head">
        <div>
          <strong>${escapeHtml(selectedTrainingRun.label || selectedTrainingRun.id)}</strong>
          <div class="card-meta">${escapeHtml(selectedTrainingRun.id)} | output pending</div>
        </div>
        <span class="pill">${escapeHtml(String(selectedTrainingRun.status || 'running'))}</span>
      </div>
      <div class="detail-row-meta">
        <div class="subtle">${selectedTrainingRun.sourceGames || 0} games | ${selectedTrainingRun.epochs || 0} epoch(s) | LR ${Number(selectedTrainingRun.learningRate || 0).toFixed(4)}</div>
        <div class="subtle">${escapeHtml(latestLoss
          ? `Policy ${formatLossValue(latestLoss.policyLoss)} | Value ${formatLossValue(latestLoss.valueLoss)} | Identity ${formatLossValue(latestLoss.identityLoss)}`
          : 'Waiting for the first live loss update.')}</div>
      </div>
    `;
    els.snapshotList.appendChild(row);
  }
  const snapshots = getSortedSnapshots();
  if (!snapshots.length) {
    if (!selectedTrainingRun) {
      els.snapshotList.innerHTML = '<div class="subtle">No output models available.</div>';
    }
    return;
  }
  snapshots.forEach((snapshot) => {
    const latestLoss = snapshot.latestLoss || null;
    const row = document.createElement('article');
    row.className = `detail-row ${!state.selectedTrainingRunId && snapshot.id === state.selectedSnapshotId ? 'active' : ''}`;
    row.dataset.snapshotId = snapshot.id;
    row.innerHTML = `
      <div class="detail-row-head">
        <div>
          <strong>${escapeHtml(snapshot.label || snapshot.id)}</strong>
          <div class="card-meta">${escapeHtml(snapshot.id)} | generation ${Number(snapshot.generation || 0)}</div>
        </div>
        <span class="pill">${escapeHtml(formatDate(snapshot.updatedAt || snapshot.createdAt))}</span>
      </div>
      <div class="detail-row-meta">
        <div class="subtle">Loss entries ${snapshot.lossCount || 0} | Training runs ${snapshot?.stats?.trainingRuns || 0}</div>
        <div class="subtle">${escapeHtml(latestLoss
          ? `Policy ${formatLossValue(latestLoss.policyLoss)} | Value ${formatLossValue(latestLoss.valueLoss)} | Identity ${formatLossValue(latestLoss.identityLoss)}`
          : 'No stored loss history yet.')}</div>
      </div>
      <div class="detail-actions">
        <button type="button" class="secondary" data-action="use-base" data-snapshot-id="${escapeHtml(snapshot.id)}">Use As Base</button>
        <button type="button" class="danger" data-action="delete" data-snapshot-id="${escapeHtml(snapshot.id)}">Delete Model</button>
      </div>
    `;
    els.snapshotList.appendChild(row);
  });
}

function renderSelectedModelDetails() {
  const selectedTrainingRun = getTrainingRunById(state.selectedTrainingRunId);
  if (selectedTrainingRun && !selectedTrainingRun.newSnapshotId) {
    const latestLoss = selectedTrainingRun.finalLoss || null;
    const completedEpochs = Number(
      selectedTrainingRun?.checkpoint?.completedEpochs
      || selectedTrainingRun?.history?.length
      || 0
    );
    const totalEpochs = Number(selectedTrainingRun?.checkpoint?.totalEpochs || selectedTrainingRun?.epochs || 0);
    els.selectedModelSummary.textContent = `${selectedTrainingRun.label || selectedTrainingRun.id} (training)`;
    els.selectedModelMeta.textContent = `${selectedTrainingRun.id} | ${formatDate(selectedTrainingRun.updatedAt || selectedTrainingRun.createdAt)} | Base ${selectedTrainingRun.baseSnapshotId || 'none'}`;
    els.selectedModelStats.textContent = latestLoss
      ? `Live loss: policy ${formatLossValue(latestLoss.policyLoss)}, value ${formatLossValue(latestLoss.valueLoss)}, identity ${formatLossValue(latestLoss.identityLoss)}, identity accuracy ${(Number(latestLoss.identityAccuracy || 0) * 100).toFixed(1)}%. Epoch ${completedEpochs}/${totalEpochs || selectedTrainingRun.epochs || 0}.`
      : `Training run is live. ${selectedTrainingRun.sourceGames || 0} source games across ${selectedTrainingRun.sourceSimulations || 0} run(s). Waiting for the first epoch update.`;
    els.forkSnapshotBtn.disabled = true;
    return;
  }
  const snapshot = getSnapshotById(state.selectedSnapshotId);
  if (!snapshot) {
    els.selectedModelSummary.textContent = 'No model selected.';
    els.selectedModelMeta.textContent = 'Select an output model to inspect it.';
    els.selectedModelStats.textContent = 'No model stats available.';
    els.forkSnapshotBtn.disabled = true;
    return;
  }
  const parent = snapshot.parentSnapshotId ? getSnapshotById(snapshot.parentSnapshotId) : null;
  const latestLoss = snapshot.latestLoss || null;
  els.selectedModelSummary.textContent = `${snapshot.label || snapshot.id} (g${Number(snapshot.generation || 0)})`;
  els.selectedModelMeta.textContent = `${snapshot.id} | ${formatDate(snapshot.updatedAt || snapshot.createdAt)} | Parent ${parent?.label || snapshot.parentSnapshotId || 'none'}`;
  els.selectedModelStats.textContent = latestLoss
    ? `Latest loss: policy ${formatLossValue(latestLoss.policyLoss)}, value ${formatLossValue(latestLoss.valueLoss)}, identity ${formatLossValue(latestLoss.identityLoss)}, identity accuracy ${(Number(latestLoss.identityAccuracy || 0) * 100).toFixed(1)}%.`
    : `Notes: ${snapshot.notes || 'No notes.'} | Loss entries ${snapshot.lossCount || 0} | Training runs ${snapshot?.stats?.trainingRuns || 0}.`;
  els.forkSnapshotBtn.disabled = false;
}

function renderTrainingRunList() {
  els.trainingRunList.innerHTML = '';
  const runs = getSortedTrainingRuns();
  if (!runs.length) {
    els.trainingRunList.innerHTML = '<div class="subtle">No training runs recorded.</div>';
    return;
  }
  runs.forEach((run) => {
    const finalLoss = run?.finalLoss || {};
    const status = String(run?.status || 'completed').toLowerCase();
    const isCompleted = status === 'completed';
    const row = document.createElement('article');
    row.className = `detail-row ${run.id === state.selectedTrainingRunId || (!state.selectedTrainingRunId && run.newSnapshotId === state.selectedSnapshotId) ? 'active' : ''}`;
    row.dataset.outputSnapshotId = run.newSnapshotId || '';
    row.dataset.trainingRunId = run.id;
    row.innerHTML = `
      <div class="detail-row-head">
        <div>
          <strong>${escapeHtml(run.newSnapshotId || run.label || run.id || 'Training run')}</strong>
          <div class="card-meta">${escapeHtml(formatDate(run.createdAt))} | from ${escapeHtml(run.baseSnapshotId || 'n/a')}</div>
        </div>
        <button type="button" class="secondary" data-action="open-model" data-snapshot-id="${escapeHtml(run.newSnapshotId || '')}" ${isCompleted && run.newSnapshotId ? '' : 'disabled'}>Open Model</button>
      </div>
      <div class="detail-row-meta">
        <div class="subtle">${run.sourceGames} games | ${run.sourceSimulations} run(s) | ${run.epochs} epoch(s) | LR ${Number(run.learningRate || 0).toFixed(4)} | ${escapeHtml(status)}</div>
      </div>
      <div class="metric-bar-list" style="margin-top:12px;">
        <div class="metric-bar-row">
          <span class="metric-bar-label">Policy</span>
          <div class="metric-bar-track"><span class="metric-bar-fill policy" style="width:${(lossToProgress(finalLoss.policyLoss) * 100).toFixed(1)}%;"></span></div>
          <span class="metric-bar-value">${formatLossValue(finalLoss.policyLoss)}</span>
        </div>
        <div class="metric-bar-row">
          <span class="metric-bar-label">Value</span>
          <div class="metric-bar-track"><span class="metric-bar-fill value" style="width:${(lossToProgress(finalLoss.valueLoss) * 100).toFixed(1)}%;"></span></div>
          <span class="metric-bar-value">${formatLossValue(finalLoss.valueLoss)}</span>
        </div>
        <div class="metric-bar-row">
          <span class="metric-bar-label">Identity</span>
          <div class="metric-bar-track"><span class="metric-bar-fill identity" style="width:${(lossToProgress(finalLoss.identityLoss) * 100).toFixed(1)}%;"></span></div>
          <span class="metric-bar-value">${formatLossValue(finalLoss.identityLoss)}</span>
        </div>
      </div>
      <div class="subtle" style="margin-top:8px;">Identity accuracy: ${(Number(finalLoss.identityAccuracy || 0) * 100).toFixed(1)}%</div>
    `;
    els.trainingRunList.appendChild(row);
  });
}

function renderTrainingSourceList() {
  els.trainingSourceList.innerHTML = '';
  const snapshotId = els.trainSnapshotSelect?.value || '';
  if (!snapshotId) {
    updateTrainingSourceMeta();
    return;
  }
  const simulations = getSortedSimulations().sort((left, right) => {
    const leftEligible = getSimulationTrainingEligibility(left, snapshotId).eligible;
    const rightEligible = getSimulationTrainingEligibility(right, snapshotId).eligible;
    if (leftEligible !== rightEligible) return leftEligible ? -1 : 1;
    const leftSelected = state.trainingSelection.has(left.id);
    const rightSelected = state.trainingSelection.has(right.id);
    if (leftSelected !== rightSelected) return leftSelected ? -1 : 1;
    return 0;
  });
  if (!simulations.length) {
    els.trainingSourceList.innerHTML = '<div class="subtle">Run simulations first to create training sources.</div>';
    updateTrainingSourceMeta();
    return;
  }
  simulations.forEach((simulation) => {
    const eligibility = getSimulationTrainingEligibility(simulation, snapshotId);
    const row = document.createElement('label');
    row.className = `source-row ${eligibility.eligible ? '' : 'dim'}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = simulation.id;
    checkbox.style.width = '16px';
    checkbox.style.marginTop = '4px';
    checkbox.checked = eligibility.eligible && state.trainingSelection.has(simulation.id);
    checkbox.disabled = !eligibility.eligible;
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.trainingSelection.add(simulation.id);
      else state.trainingSelection.delete(simulation.id);
      renderTrainingSourceList();
    });
    const body = document.createElement('div');
    body.innerHTML = `
      <strong>${escapeHtml(simulation.label || simulation.id)}</strong>
      <div class="card-meta">${escapeHtml(simulation.id)} | ${simulation.gameCount} games | ${escapeHtml(formatDate(simulation.createdAt))}</div>
      <div class="card-meta">${escapeHtml(simulation.participantALabel || simulation.participantAId || 'Player 1')} vs ${escapeHtml(simulation.participantBLabel || simulation.participantBId || 'Player 2')}</div>
      <div class="${eligibility.eligible ? 'ok' : 'warn'}" style="font-size:12px;margin-top:6px;">
        ${escapeHtml(eligibility.eligible ? 'Trainable for the selected base snapshot.' : eligibility.reasons.join(' | '))}
      </div>
    `;
    row.appendChild(checkbox);
    row.appendChild(body);
    els.trainingSourceList.appendChild(row);
  });
  updateTrainingSourceMeta();
}

function renderSimulationList() {
  els.simulationList.innerHTML = '';
  const simulations = getSortedSimulations();
  if (!simulations.length) {
    els.simulationRunsMeta.textContent = 'No simulation runs yet.';
    els.simulationList.innerHTML = '<div class="subtle">Run a simulation batch to populate this list.</div>';
    return;
  }
  els.simulationRunsMeta.textContent = `${simulations.length} run(s) recorded. Click one to inspect its games.`;
  simulations.forEach((simulation) => {
    const participantResults = Array.isArray(simulation?.stats?.participantResults)
      ? simulation.stats.participantResults
      : [];
    const resultSummary = participantResults
      .map((entry) => `${entry.label}: ${Number(entry.winPct || 0).toFixed(1)}%`)
      .join(' | ');
    const row = document.createElement('article');
    row.className = `detail-row ${simulation.id === state.selectedSimulationId ? 'active' : ''}`;
    row.dataset.simulationId = simulation.id;
    row.innerHTML = `
      <div class="detail-row-head">
        <div>
          <strong>${escapeHtml(simulation.label || simulation.id)}</strong>
          <div class="card-meta">${escapeHtml(simulation.participantALabel || simulation.participantAId || 'Player 1')} vs ${escapeHtml(simulation.participantBLabel || simulation.participantBId || 'Player 2')}</div>
        </div>
        <span class="pill">${escapeHtml(String(simulation.status || 'completed'))}</span>
      </div>
      <div class="detail-row-meta">
        <div class="subtle">${simulation.gameCount} games | ${Number(simulation?.stats?.averagePlies || 0).toFixed(1)} avg plies</div>
        <div class="subtle">${escapeHtml(formatWinReasonSummary(simulation?.stats?.winReasons))}</div>
        <div class="subtle">${escapeHtml(resultSummary || describeStorage(simulation))}</div>
      </div>
      <div class="detail-actions">
        <button type="button" class="danger" data-action="delete" data-simulation-id="${escapeHtml(simulation.id)}">Delete Run</button>
      </div>
    `;
    els.simulationList.appendChild(row);
  });
}

function formatGameWinner(game) {
  if (game?.winner === 0 || game?.winner === 1) return colorToText(game.winner);
  if (String(game?.winReason || '').toLowerCase() === 'draw') return 'Draw';
  return 'No winner';
}

function syncReplaySimulationSelect() {
  const options = getSortedSimulations().map((simulation) => ({
    value: simulation.id,
    label: `${simulation.label} | ${simulation.gameCount} games`,
  }));
  fillSelect(els.replaySimulationSelect, options, {
    includeBlank: true,
    blankLabel: 'Select simulation',
    preferredValue: state.selectedSimulationId || '',
  });
  if (!state.selectedSimulationId) els.replaySimulationSelect.value = '';
}

function syncReplayGameSelect(games = [], preferredGameId = '') {
  const options = games.map((game) => ({
    value: game.id,
    label: `${game.id} | ${game.plies} plies | ${formatDate(game.createdAt)}`,
  }));
  fillSelect(els.replayGameSelect, options, {
    includeBlank: true,
    blankLabel: 'Select game',
    preferredValue: preferredGameId || '',
  });
  if (!preferredGameId) els.replayGameSelect.value = '';
}

function renderSelectedSimulation() {
  const simulation = getSimulationById(state.selectedSimulationId);
  if (!simulation) {
    els.selectedSimulationLabel.textContent = 'No simulation selected.';
    els.selectedSimulationMeta.textContent = 'Select a simulation run to load its game list.';
    els.simulationGameList.innerHTML = '<div class="subtle">No games loaded.</div>';
    state.selectedGameId = '';
    syncReplayGameSelect([]);
    replayWorkbench.clear();
    updateReplayControlsState();
    return;
  }
  const detail = state.simulationDetailsById.get(simulation.id) || null;
  const participantResults = Array.isArray(simulation?.stats?.participantResults)
    ? simulation.stats.participantResults
    : [];
  const resultSummary = participantResults
    .map((entry) => `${entry.label}: ${Number(entry.winPct || 0).toFixed(1)}%`)
    .join(' | ');
  els.selectedSimulationLabel.textContent = simulation.label || simulation.id;
  els.selectedSimulationMeta.textContent = `${simulation.id} | ${simulation.gameCount} games | ${formatDate(simulation.createdAt)} | ${resultSummary || describeStorage(simulation)}`;
  if (state.loadingSimulationId === simulation.id && !detail) {
    els.simulationGameList.innerHTML = '<div class="subtle">Loading games for this run...</div>';
    updateReplayControlsState();
    return;
  }
  const games = Array.isArray(detail?.games) ? detail.games : [];
  if (!games.length) {
    els.simulationGameList.innerHTML = '<div class="subtle">This run has no stored games yet.</div>';
    updateReplayControlsState();
    return;
  }
  els.simulationGameList.innerHTML = '';
  games.forEach((game) => {
    const row = document.createElement('article');
    row.className = `detail-row ${game.id === state.selectedGameId ? 'active' : ''}`;
    row.dataset.gameId = game.id;
    row.innerHTML = `
      <div class="detail-row-head">
        <div>
          <strong>${escapeHtml(game.id)}</strong>
          <div class="card-meta">${escapeHtml(game.whiteParticipantLabel || simulation.participantALabel || 'White')} vs ${escapeHtml(game.blackParticipantLabel || simulation.participantBLabel || 'Black')}</div>
        </div>
        <span class="pill">${escapeHtml(formatGameWinner(game))}</span>
      </div>
      <div class="detail-row-meta">
        <div class="subtle">${game.plies} plies | ${game.decisionCount || 0} decisions | ${escapeHtml(formatDate(game.createdAt))}</div>
        <div class="subtle">Reason: ${escapeHtml(winReasonToText(game.winReason))}</div>
      </div>
    `;
    els.simulationGameList.appendChild(row);
  });
  updateReplayControlsState();
}

function renderWorkbench() {
  setActiveWorkflowTab(state.activeWorkflowTab);
  updateSummaryPanel();
  renderSnapshotSelects();
  renderParticipantSelects();
  syncReplaySimulationSelect();
  renderSimulationList();
  renderSelectedSimulation();
  renderTrainingSourceList();
  renderTrainingRunList();
  renderSnapshotList();
  renderSelectedModelDetails();
  updateReplayControlsState();
}

function renderLiveLossChart() {
  if (!state.liveTrainingHistory.length) {
    lossChart.clear();
    return;
  }
  lossChart.setData(flattenLossHistory([{
    timestamp: state.liveTrainingMeta?.startedAt || new Date().toISOString(),
    epochs: state.liveTrainingMeta?.epochs || state.liveTrainingHistory.length,
    learningRate: Number(state.liveTrainingMeta?.learningRate || 0),
    sourceGames: Number(state.liveTrainingMeta?.sourceGames || 0),
    sourceSimulations: Number(state.liveTrainingMeta?.sourceSimulations || 0),
    history: state.liveTrainingHistory,
  }]));
}

function selectTrainingRun(trainingRunId, options = {}) {
  const trainingRun = getTrainingRunById(trainingRunId);
  if (!trainingRun || !isTrainingRunSelectable(trainingRun)) return;
  state.selectedTrainingRunId = trainingRun.id;
  if (trainingRun.newSnapshotId && getSnapshotById(trainingRun.newSnapshotId)) {
    state.selectedSnapshotId = trainingRun.newSnapshotId;
    if (els.selectedSnapshotSelect) els.selectedSnapshotSelect.value = trainingRun.newSnapshotId;
    if (els.lossSnapshotSelect) els.lossSnapshotSelect.value = trainingRun.newSnapshotId;
  }
  if (options.preferLive === true) {
    state.lossChartMode = 'live';
  }
  renderTrainingRunList();
  renderSnapshotList();
  renderSelectedModelDetails();
  if (state.lossChartMode === 'live') {
    renderLiveLossChart();
  } else if (trainingRun.newSnapshotId) {
    loadLossHistory(trainingRun.newSnapshotId).catch((err) => setStatus(err.message, 'error'));
  }
}

async function loadLossHistory(snapshotId) {
  const token = ++state.lossRequestToken;
  if (!snapshotId) {
    lossChart.clear();
    return;
  }
  const payload = await apiFetch(`/api/v1/ml/loss?snapshotId=${encodeURIComponent(snapshotId)}`);
  if (token !== state.lossRequestToken || state.lossChartMode === 'live') return;
  lossChart.setData(flattenLossHistory(Array.isArray(payload?.history) ? payload.history : []));
}

async function ensureSimulationDetail(simulationId) {
  if (!simulationId) return null;
  if (state.simulationDetailsById.has(simulationId)) return state.simulationDetailsById.get(simulationId);
  const detail = await apiFetch(`/api/v1/ml/simulations/${encodeURIComponent(simulationId)}`);
  state.simulationDetailsById.set(simulationId, detail);
  return detail;
}

async function loadSelectedSimulationDetail(options = {}) {
  const simulationId = state.selectedSimulationId;
  if (!simulationId) {
    syncReplayGameSelect([]);
    renderSelectedSimulation();
    return null;
  }
  state.loadingSimulationId = simulationId;
  renderSelectedSimulation();
  const detail = await ensureSimulationDetail(simulationId);
  if (state.selectedSimulationId !== simulationId) return detail;
  state.loadingSimulationId = '';
  const games = Array.isArray(detail?.games) ? detail.games : [];
  if (!games.some((game) => game.id === state.selectedGameId)) {
    state.selectedGameId = options.autoSelectFirstGame ? (games[0]?.id || '') : '';
  }
  syncReplayGameSelect(games, state.selectedGameId);
  renderSelectedSimulation();
  if (options.autoLoadReplay && state.selectedGameId) await loadReplay();
  return detail;
}

async function selectSimulation(simulationId, options = {}) {
  state.selectedSimulationId = simulationId || '';
  if (!options.preserveGame) state.selectedGameId = '';
  syncReplaySimulationSelect();
  if (els.replaySimulationSelect) els.replaySimulationSelect.value = state.selectedSimulationId || '';
  renderSimulationList();
  renderSelectedSimulation();
  if (!state.selectedSimulationId) {
    syncReplayGameSelect([]);
    replayWorkbench.clear();
    updateReplayControlsState();
    return;
  }
  await loadSelectedSimulationDetail({
    autoSelectFirstGame: Boolean(options.autoSelectFirstGame),
    autoLoadReplay: Boolean(options.autoLoadReplay),
  });
}

async function selectReplayGame(gameId, options = {}) {
  state.selectedGameId = gameId || '';
  if (els.replayGameSelect) els.replayGameSelect.value = state.selectedGameId || '';
  renderSelectedSimulation();
  if (options.autoLoadReplay && state.selectedGameId) await loadReplay();
}

async function loadReplay() {
  replayWorkbench.stopPlayback();
  const simulationId = state.selectedSimulationId || els.replaySimulationSelect?.value || '';
  const gameId = state.selectedGameId || els.replayGameSelect?.value || '';
  if (!simulationId || !gameId) {
    setStatus('Select a simulation run and game before loading replay.', 'warn');
    return;
  }
  if (els.replaySimulationSelect) els.replaySimulationSelect.value = simulationId;
  if (els.replayGameSelect) els.replayGameSelect.value = gameId;
  setStatus(`Loading replay ${gameId}...`);
  const payload = await apiFetch(`/api/v1/ml/replay/${encodeURIComponent(simulationId)}/${encodeURIComponent(gameId)}`);
  replayWorkbench.setReplayPayload(payload);
  setStatus(`Replay loaded: ${gameId}.`, 'ok');
}

async function openReplayForSimulation(simulationId) {
  if (!simulationId) return;
  setActiveWorkflowTab('simulations');
  await selectSimulation(simulationId, { autoSelectFirstGame: true, autoLoadReplay: true });
}

async function refreshWorkbench(options = {}) {
  if (!options.silent) setStatus('Refreshing ML workbench...');
  state.isRefreshingWorkbench = true;
  try {
    const live = await loadWorkbench();
    state.simulationDetailsById = new Map();
    state.loadingSimulationId = '';
    syncSelections(options);
    if (state.selectedSimulationId) state.loadingSimulationId = state.selectedSimulationId;
    renderWorkbench();
    const followUps = [];
    if (state.selectedSimulationId) {
      followUps.push(loadSelectedSimulationDetail({
        autoSelectFirstGame: Boolean(options.autoSelectFirstGame),
        autoLoadReplay: Boolean(options.autoLoadReplay),
      }));
    }
    if (state.lossChartMode === 'live') renderLiveLossChart();
    else if (state.selectedSnapshotId) followUps.push(loadLossHistory(state.selectedSnapshotId));
    else lossChart.clear();
    await Promise.allSettled(followUps);
    if (live) applyLiveStatusPayload(live);
    if (!options.silent) setStatus('Workbench refreshed.', 'ok');
  } finally {
    state.isRefreshingWorkbench = false;
  }
}

function setMasterSnapshot(snapshotId) {
  if (!snapshotId) return;
  state.selectedTrainingRunId = '';
  state.selectedSnapshotId = snapshotId;
  if (els.selectedSnapshotSelect) els.selectedSnapshotSelect.value = snapshotId;
  if (els.trainSnapshotSelect) els.trainSnapshotSelect.value = snapshotId;
  if (els.lossSnapshotSelect) els.lossSnapshotSelect.value = snapshotId;
  pruneTrainingSelection(snapshotId);
  renderSnapshotList();
  renderSelectedModelDetails();
  renderTrainingSourceList();
  renderTrainingRunList();
  if (state.lossChartMode !== 'live') {
    loadLossHistory(snapshotId).catch((err) => setStatus(err.message, 'error'));
  }
}

async function deleteSnapshot(snapshotId) {
  if (!window.confirm(`Delete model ${snapshotId}? This cannot be undone.`)) return;
  await apiFetch(`/api/v1/ml/snapshots/${encodeURIComponent(snapshotId)}`, { method: 'DELETE' });
  await refreshWorkbench({ workflowTab: 'training' });
}

async function forkSelectedSnapshot() {
  const snapshotId = state.selectedSnapshotId || '';
  if (!snapshotId) {
    setStatus('Choose a model to fork.', 'warn');
    return;
  }
  const nextLabel = (window.prompt('Fork label (optional):', '') || '').trim();
  const result = await apiFetch('/api/v1/ml/snapshots/create', {
    method: 'POST',
    body: JSON.stringify({ fromSnapshotId: snapshotId, label: nextLabel || null }),
  });
  await refreshWorkbench({
    workflowTab: 'training',
    preferSnapshotId: result?.snapshot?.id || snapshotId,
  });
}

async function deleteSimulation(simulationId) {
  if (!window.confirm(`Delete simulation run ${simulationId}?`)) return;
  await apiFetch(`/api/v1/ml/simulations/${encodeURIComponent(simulationId)}`, { method: 'DELETE' });
  await refreshWorkbench({ workflowTab: 'simulations' });
}

function selectEligibleSources() {
  const snapshotId = els.trainSnapshotSelect?.value || '';
  state.simulations.forEach((simulation) => {
    if (getSimulationTrainingEligibility(simulation, snapshotId).eligible) {
      state.trainingSelection.add(simulation.id);
    }
  });
  renderTrainingSourceList();
}

function clearTrainingSources() {
  state.trainingSelection.clear();
  renderTrainingSourceList();
}

function pushLiveTrainingLoss(epochLoss, epochNumber) {
  const nextEntry = {
    epoch: epochNumber,
    policyLoss: Number(epochLoss?.policyLoss || 0),
    valueLoss: Number(epochLoss?.valueLoss || 0),
    identityLoss: Number(epochLoss?.identityLoss || 0),
    identityAccuracy: Number(epochLoss?.identityAccuracy || 0),
    policySamples: Number(epochLoss?.policySamples || 0),
    valueSamples: Number(epochLoss?.valueSamples || 0),
    identitySamples: Number(epochLoss?.identitySamples || 0),
  };
  const existingIndex = state.liveTrainingHistory.findIndex((entry) => entry.epoch === epochNumber);
  if (existingIndex >= 0) state.liveTrainingHistory.splice(existingIndex, 1, nextEntry);
  else {
    state.liveTrainingHistory.push(nextEntry);
    state.liveTrainingHistory.sort((left, right) => Number(left.epoch || 0) - Number(right.epoch || 0));
  }
}

function replaceLiveTrainingHistory(history = []) {
  state.liveTrainingHistory = Array.isArray(history)
    ? history
      .map((entry) => ({
        epoch: Number(entry?.epoch || 0),
        policyLoss: Number(entry?.policyLoss || 0),
        valueLoss: Number(entry?.valueLoss || 0),
        identityLoss: Number(entry?.identityLoss || 0),
        identityAccuracy: Number(entry?.identityAccuracy || 0),
        policySamples: Number(entry?.policySamples || 0),
        valueSamples: Number(entry?.valueSamples || 0),
        identitySamples: Number(entry?.identitySamples || 0),
      }))
      .sort((left, right) => Number(left.epoch || 0) - Number(right.epoch || 0))
    : [];
}

function upsertLiveSimulationSummary(payload = {}) {
  const simulationId = payload.simulationId || '';
  if (!simulationId) return;
  const index = state.simulations.findIndex((simulation) => simulation.id === simulationId);
  const summary = {
    ...(index >= 0 ? state.simulations[index] : {}),
    id: simulationId,
    label: payload.label || state.simulations[index]?.label || simulationId,
    status: payload.status || (String(payload.phase || '').toLowerCase() === 'cancelled' ? 'stopped' : 'running'),
    participantAId: payload.participantAId || state.simulations[index]?.participantAId || null,
    participantBId: payload.participantBId || state.simulations[index]?.participantBId || null,
    participantALabel: payload.participantALabel || state.simulations[index]?.participantALabel || null,
    participantBLabel: payload.participantBLabel || state.simulations[index]?.participantBLabel || null,
    gameCount: Number(payload.completedGames || state.simulations[index]?.gameCount || 0),
    stats: payload.stats || state.simulations[index]?.stats || {},
    config: {
      ...(state.simulations[index]?.config || {}),
      requestedGameCount: Number(payload.gameCount || state.simulations[index]?.config?.requestedGameCount || 0),
      completedGameCount: Number(payload.completedGames || state.simulations[index]?.config?.completedGameCount || 0),
      alternateColors: Boolean(payload.alternateColors ?? state.simulations[index]?.config?.alternateColors),
    },
  };
  if (index >= 0) state.simulations.splice(index, 1, summary);
  else state.simulations.unshift(summary);
}

function upsertLiveTrainingRunSummary(payload = {}) {
  const trainingRunId = payload.trainingRunId || '';
  if (!trainingRunId) return;
  const index = state.trainingRuns.findIndex((run) => run.id === trainingRunId);
  const existing = index >= 0 ? state.trainingRuns[index] : {};
  const next = {
    ...existing,
    id: trainingRunId,
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: payload.timestamp || new Date().toISOString(),
    status: payload.status || (String(payload.phase || '').toLowerCase() === 'complete' ? 'completed' : 'running'),
    baseSnapshotId: payload.baseSnapshotId || existing.baseSnapshotId || null,
    newSnapshotId: payload.newSnapshotId || existing.newSnapshotId || null,
    epochs: Number(payload.totalEpochs || payload.epochs || existing.epochs || 0),
    learningRate: Number(payload.learningRate || existing.learningRate || 0),
    sourceSimulationIds: Array.isArray(payload.sourceSimulationIds)
      ? payload.sourceSimulationIds.slice()
      : (Array.isArray(existing.sourceSimulationIds) ? existing.sourceSimulationIds : []),
    sourceGames: Number(payload.sourceGames || existing.sourceGames || 0),
    sourceSimulations: Number(payload.sourceSimulations || existing.sourceSimulations || 0),
    sampleCounts: payload.sampleCounts || existing.sampleCounts || {},
    history: Array.isArray(payload.history) ? payload.history.slice() : (existing.history || []),
    finalLoss: payload.loss || existing.finalLoss || null,
    checkpoint: {
      completedEpochs: Number(payload.epoch || existing.checkpoint?.completedEpochs || 0),
      totalEpochs: Number(payload.totalEpochs || payload.epochs || existing.checkpoint?.totalEpochs || 0),
      checkpointedAt: payload.timestamp || existing.checkpoint?.checkpointedAt || null,
    },
  };
  if (index >= 0) state.trainingRuns.splice(index, 1, next);
  else state.trainingRuns.unshift(next);
}

async function loadLiveStatus() {
  try {
    return await apiFetch('/api/v1/ml/live');
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

function applyLiveStatusPayload(live = null) {
  const hadSimulation = isSimulationActive();
  const hadTraining = isTrainingActive();
  if (live?.simulation) {
    const sameSimulationEvent = state.liveSimulation
      && state.liveSimulation.phase === live.simulation.phase
      && state.liveSimulation.timestamp === live.simulation.timestamp
      && state.liveSimulation.simulationId === live.simulation.simulationId;
    if (!sameSimulationEvent) {
      handleSimulationProgress(live.simulation);
    }
  } else if (hadSimulation) {
    state.liveSimulation = null;
    state.activeSimulationTaskId = '';
    els.stopSimulationBtn.disabled = true;
    refreshWorkbench({ workflowTab: 'simulations', silent: true }).catch(() => {});
  }

  if (live?.training) {
    const sameTrainingEvent = state.liveTraining
      && state.liveTraining.phase === live.training.phase
      && state.liveTraining.timestamp === live.training.timestamp
      && state.liveTraining.trainingRunId === live.training.trainingRunId;
    if (!sameTrainingEvent) {
      handleTrainingProgress(live.training);
    }
  } else if (hadTraining) {
    state.liveTraining = null;
    state.lossChartMode = 'stored';
    refreshWorkbench({ workflowTab: 'training', silent: true }).catch(() => {});
  }
}

function startServerPolling() {
  if (!state.livePollHandle) {
    state.livePollHandle = window.setInterval(() => {
      loadLiveStatus()
        .then((live) => {
          if (live) applyLiveStatusPayload(live);
        })
        .catch(() => {});
    }, LIVE_POLL_MS);
  }

  if (!state.workbenchPollHandle) {
    state.workbenchPollHandle = window.setInterval(() => {
      if (document.visibilityState === 'hidden' || state.isRefreshingWorkbench) return;
      if (isTrainingActive() || isSimulationActive()) return;
      refreshWorkbench({ workflowTab: state.activeWorkflowTab, silent: true }).catch(() => {});
    }, WORKBENCH_POLL_MS);
  }
}

async function runSimulation() {
  const whiteParticipantId = els.whiteParticipantSelect?.value || '';
  const blackParticipantId = els.blackParticipantSelect?.value || '';
  if (!whiteParticipantId || !blackParticipantId) {
    setStatus('Choose both controllers before running simulations.', 'warn');
    return;
  }
  const payload = {
    whiteParticipantId,
    blackParticipantId,
    gameCount: parseNumberInput(els.gameCountInput, 20),
    maxPlies: parseNumberInput(els.maxPliesInput, 120),
    iterations: parseNumberInput(els.iterationsInput, 90),
    maxDepth: parseNumberInput(els.maxDepthInput, 16),
    hypothesisCount: parseNumberInput(els.hypothesisCountInput, 8),
    riskBias: parseNumberInput(els.riskBiasInput, 0.75, true),
    exploration: parseNumberInput(els.explorationInput, 1.25, true),
    alternateColors: Boolean(els.alternateColorsInput?.checked),
    label: (els.simulationLabelInput?.value || '').trim() || null,
  };
  const whiteSnapshotId = parseSnapshotIdFromParticipantRef(whiteParticipantId);
  const blackSnapshotId = parseSnapshotIdFromParticipantRef(blackParticipantId);
  if (whiteSnapshotId) payload.whiteSnapshotId = whiteSnapshotId;
  if (blackSnapshotId) payload.blackSnapshotId = blackSnapshotId;
  const seed = parseNumberInput(els.seedInput, Number.NaN);
  if (Number.isFinite(seed)) payload.seed = seed;

  els.runSimulationBtn.disabled = true;
  setActiveWorkflowTab('simulations');
  updateProgressBar(els.simulationProgressBar, 0, 'active');
  els.simulationStreamBadge.textContent = 'Submitting';
  els.simulationProgressMeta.textContent = 'Submitting simulation batch...';
  setStatus('Starting simulation batch...');
  try {
    const result = await apiFetch('/api/v1/ml/simulations/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    await refreshWorkbench({
      workflowTab: 'simulations',
      preferSimulationId: result?.simulation?.id || '',
      silent: true,
    });
    if (result?.live) handleSimulationProgress(result.live);
    setStatus(`Simulation started: ${result?.simulation?.label || result?.simulation?.id || 'run accepted'}.`, 'ok');
  } finally {
    els.runSimulationBtn.disabled = false;
  }
}

async function runTraining() {
  const snapshotId = els.trainSnapshotSelect?.value || '';
  if (!snapshotId) {
    setStatus('Choose a base snapshot before training.', 'warn');
    return;
  }
  pruneTrainingSelection(snapshotId);
  const selectedSimulationIds = Array.from(state.trainingSelection).filter((simulationId) => (
    getSimulationTrainingEligibility(getSimulationById(simulationId), snapshotId).eligible
  ));
  if (!selectedSimulationIds.length) {
    setStatus('Select at least one eligible simulation run.', 'warn');
    return;
  }

  els.runTrainingBtn.disabled = true;
  setActiveWorkflowTab('training');
  updateProgressBar(els.trainingProgressBar, 0, 'active');
  els.trainingStreamBadge.textContent = 'Submitting';
  els.trainingProgressMeta.textContent = `Submitting training job on ${selectedSimulationIds.length} simulation source(s)...`;
  setStatus(`Starting training for ${snapshotId}...`);
  try {
    const result = await apiFetch('/api/v1/ml/training/start', {
      method: 'POST',
      body: JSON.stringify({
        snapshotId,
        simulationIds: selectedSimulationIds,
        epochs: parseNumberInput(els.epochsInput, 3),
        learningRate: parseNumberInput(els.learningRateInput, 0.01, true),
        label: (els.trainingLabelInput?.value || '').trim() || null,
      }),
    });
    if (result?.live) handleTrainingProgress(result.live);
    if (result?.trainingRun?.id) {
      upsertLiveTrainingRunSummary({
        ...(result.live || {}),
        trainingRunId: result.trainingRun.id,
        baseSnapshotId: snapshotId,
        sourceSimulationIds: selectedSimulationIds,
        sourceSimulations: selectedSimulationIds.length,
        epochs: parseNumberInput(els.epochsInput, 3),
        learningRate: parseNumberInput(els.learningRateInput, 0.01, true),
        history: [],
      });
      selectTrainingRun(result.trainingRun.id, { preferLive: true });
    }
    setStatus(`Training started from ${snapshotId}.`, 'ok');
  } finally {
    els.runTrainingBtn.disabled = false;
  }
}

async function stopSimulationRun() {
  const taskId = state.activeSimulationTaskId || '';
  if (!taskId) {
    setStatus('No active simulation task to stop.', 'warn');
    return;
  }
  await apiFetch('/api/v1/ml/simulations/stop', {
    method: 'POST',
    body: JSON.stringify({ taskId }),
  });
  setStatus('Stop requested for the active simulation run.', 'ok');
}

function handleTrainingProgress(payload = {}) {
  state.liveTraining = payload;
  const phase = String(payload.phase || '').toLowerCase();
  const totalEpochs = Number(payload.totalEpochs || payload.epochs || 0);
  const currentEpoch = Number(payload.epoch || 0);
  if (Array.isArray(payload.history)) {
    replaceLiveTrainingHistory(payload.history);
  }
  upsertLiveTrainingRunSummary(payload);
  if (payload.trainingRunId && (!state.selectedTrainingRunId || state.selectedTrainingRunId === payload.trainingRunId || phase === 'start')) {
    state.selectedTrainingRunId = payload.trainingRunId;
  }
  renderTrainingRunList();
  renderSnapshotList();
  renderSelectedModelDetails();
  if (phase === 'start') {
    state.lossChartMode = 'live';
    if (!Array.isArray(payload.history) || !payload.history.length) {
      state.liveTrainingHistory = [];
    }
    state.liveTrainingMeta = {
      startedAt: new Date().toISOString(),
      epochs: totalEpochs,
      learningRate: Number(payload.learningRate || 0),
      sourceGames: Number(payload.sourceGames || 0),
      sourceSimulations: Number(payload.sourceSimulationIds?.length || payload.sourceSimulations || 0),
    };
    els.trainingStreamBadge.textContent = `Training ${payload.baseSnapshotId || ''}`;
    els.trainingProgressMeta.textContent = `${payload.sourceSimulationIds?.length || payload.sourceSimulations || 0} simulation source(s) | ${payload.sourceGames || 0} games`;
    updateProgressBar(els.trainingProgressBar, 0, 'active');
    setTrainingLossDisplay(null);
    renderLiveLossChart();
    return;
  }
  if (phase === 'epoch') {
    const ratio = totalEpochs > 0 ? (currentEpoch / totalEpochs) : 0;
    const loss = payload.loss || {};
    state.lossChartMode = 'live';
    if (!Array.isArray(payload.history)) {
      pushLiveTrainingLoss(loss, currentEpoch);
    }
    els.trainingStreamBadge.textContent = `Epoch ${currentEpoch}/${totalEpochs || 0}`;
    els.trainingProgressMeta.textContent = `P ${Number(loss.policyLoss || 0).toFixed(3)} | V ${Number(loss.valueLoss || 0).toFixed(3)} | I ${Number(loss.identityLoss || 0).toFixed(3)} | Acc ${(Number(loss.identityAccuracy || 0) * 100).toFixed(1)}%`;
    updateProgressBar(els.trainingProgressBar, ratio, 'active');
    setTrainingLossDisplay(loss);
    renderLiveLossChart();
    return;
  }
  if (phase === 'complete') {
    els.trainingStreamBadge.textContent = `Complete ${payload.newSnapshotId || ''}`;
    els.trainingProgressMeta.textContent = `Training complete. New model ${payload.newSnapshotId || 'created'}.`;
    updateProgressBar(els.trainingProgressBar, 1, 'default');
    setTrainingLossDisplay(payload.loss || null);
    state.lossChartMode = 'stored';
    if (payload.newSnapshotId) {
      state.selectedTrainingRunId = '';
      state.selectedSnapshotId = payload.newSnapshotId;
    }
    refreshWorkbench({ workflowTab: 'training', preferSnapshotId: payload.newSnapshotId || state.selectedSnapshotId }).catch(() => {});
    return;
  }
  if (phase === 'error') {
    els.trainingStreamBadge.textContent = 'Training Error';
    els.trainingProgressMeta.textContent = payload.message || 'Training failed.';
    updateProgressBar(els.trainingProgressBar, 1, 'error');
    setTrainingLossDisplay(payload.loss || null);
  }
}

function handleSimulationProgress(payload = {}) {
  state.liveSimulation = payload;
  if (payload.taskId) state.activeSimulationTaskId = payload.taskId;
  const phase = String(payload.phase || '').toLowerCase();
  const progress = Number.isFinite(Number(payload.progress))
    ? Math.max(0, Math.min(1, Number(payload.progress)))
    : 0;
  upsertLiveSimulationSummary(payload);
  renderSimulationList();
  if (phase === 'start') {
    els.stopSimulationBtn.disabled = false;
    els.simulationStreamBadge.textContent = payload.label || payload.simulationId || 'Running';
    els.simulationProgressMeta.textContent = `${payload.completedGames || 0}/${payload.gameCount || 0} games complete`;
    updateProgressBar(els.simulationProgressBar, progress, 'active');
    return;
  }
  if (phase === 'game') {
    const stats = payload.stats || {};
    els.stopSimulationBtn.disabled = false;
    els.simulationStreamBadge.textContent = `${payload.label || payload.simulationId || 'Simulation'} ${(progress * 100).toFixed(1)}%`;
    els.simulationProgressMeta.textContent = `${payload.completedGames || 0}/${payload.gameCount || 0} games | ${stats.whiteWins || 0}W ${stats.blackWins || 0}B ${stats.draws || 0}D`;
    updateProgressBar(els.simulationProgressBar, progress, 'active');
    return;
  }
  if (phase === 'complete' || phase === 'cancelled') {
    els.stopSimulationBtn.disabled = true;
    state.activeSimulationTaskId = '';
    els.simulationStreamBadge.textContent = phase === 'complete'
      ? `Complete ${payload.simulationId || ''}`
      : `Stopped ${payload.simulationId || ''}`;
    els.simulationProgressMeta.textContent = phase === 'complete'
      ? `${payload.completedGames || payload.gameCount || 0}/${payload.gameCount || payload.completedGames || 0} games complete`
      : `${payload.completedGames || 0}/${payload.gameCount || payload.completedGames || 0} games complete (stopped)`;
    updateProgressBar(els.simulationProgressBar, phase === 'complete' ? 1 : progress, 'default');
    refreshWorkbench({ workflowTab: 'simulations', preferSimulationId: payload.simulationId || state.selectedSimulationId }).catch(() => {});
    return;
  }
  if (phase === 'error') {
    els.stopSimulationBtn.disabled = true;
    state.activeSimulationTaskId = '';
    els.simulationStreamBadge.textContent = 'Simulation Error';
    els.simulationProgressMeta.textContent = payload.message || 'Simulation failed.';
    updateProgressBar(els.simulationProgressBar, 1, 'error');
  }
}

function connectAdminSocket() {
  if (typeof io !== 'function') return;
  const socket = io(`${window.location.origin.replace(/\/$/, '')}/admin`, { withCredentials: true });
  socket.on('connect', () => {
    if (!isTrainingActive()) {
      els.trainingStreamBadge.textContent = 'Connected';
      els.trainingProgressMeta.textContent = 'No training running.';
      if (!state.liveTrainingHistory.length) setTrainingLossDisplay(null);
    }
    if (!isSimulationActive()) {
      els.simulationStreamBadge.textContent = 'Connected';
      els.simulationProgressMeta.textContent = 'No simulation running.';
    }
  });
  socket.on('disconnect', () => {
    els.trainingStreamBadge.textContent = 'Disconnected';
    els.simulationStreamBadge.textContent = 'Disconnected';
  });
  socket.on('ml:trainingProgress', handleTrainingProgress);
  socket.on('ml:simulationProgress', handleSimulationProgress);
}

function bindEvents() {
  workflowTabs.forEach((button) => {
    button.addEventListener('click', () => setActiveWorkflowTab(button.dataset.workflowTab || 'simulations'));
  });
  els.refreshWorkbenchBtn?.addEventListener('click', () => refreshWorkbench({ workflowTab: state.activeWorkflowTab }).catch((err) => setStatus(err.message, 'error')));
  els.trainSnapshotSelect?.addEventListener('change', () => {
    const snapshotId = els.trainSnapshotSelect.value || '';
    pruneTrainingSelection(snapshotId);
    setMasterSnapshot(snapshotId);
  });
  els.forkSnapshotBtn?.addEventListener('click', () => forkSelectedSnapshot().catch((err) => setStatus(err.message, 'error')));
  els.snapshotList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (button) {
      const snapshotId = button.dataset.snapshotId || '';
      if (button.dataset.action === 'use-base') setMasterSnapshot(snapshotId);
      if (button.dataset.action === 'delete') deleteSnapshot(snapshotId).catch((err) => setStatus(err.message, 'error'));
      return;
    }
    const row = event.target.closest('[data-snapshot-id]');
    if (row) setMasterSnapshot(row.dataset.snapshotId || '');
    const trainingRow = event.target.closest('[data-training-run-id]');
    if (trainingRow?.dataset.trainingRunId) {
      selectTrainingRun(trainingRow.dataset.trainingRunId, { preferLive: true });
    }
  });
  els.trainingRunList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="open-model"]');
    if (button?.dataset.snapshotId) {
      setMasterSnapshot(button.dataset.snapshotId);
      return;
    }
    const runRow = event.target.closest('[data-training-run-id]');
    if (runRow?.dataset.trainingRunId) {
      selectTrainingRun(runRow.dataset.trainingRunId, { preferLive: true });
      return;
    }
    const row = event.target.closest('[data-output-snapshot-id]');
    if (row?.dataset.outputSnapshotId) setMasterSnapshot(row.dataset.outputSnapshotId);
  });
  els.selectEligibleSourcesBtn?.addEventListener('click', selectEligibleSources);
  els.clearTrainingSourcesBtn?.addEventListener('click', clearTrainingSources);
  els.runTrainingBtn?.addEventListener('click', () => runTraining().catch((err) => setStatus(err.message, 'error')));
  els.runSimulationBtn?.addEventListener('click', () => runSimulation().catch((err) => setStatus(err.message, 'error')));
  els.stopSimulationBtn?.addEventListener('click', () => stopSimulationRun().catch((err) => setStatus(err.message, 'error')));
  els.simulationList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="delete"]');
    if (button) {
      deleteSimulation(button.dataset.simulationId || '').catch((err) => setStatus(err.message, 'error'));
      return;
    }
    const row = event.target.closest('[data-simulation-id]');
    if (row) selectSimulation(row.dataset.simulationId || '').catch((err) => setStatus(err.message, 'error'));
  });
  els.simulationGameList?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-game-id]');
    if (row) selectReplayGame(row.dataset.gameId || '', { autoLoadReplay: true }).catch((err) => setStatus(err.message, 'error'));
  });
  els.replaySimulationSelect?.addEventListener('change', () => selectSimulation(els.replaySimulationSelect.value || '').catch((err) => setStatus(err.message, 'error')));
  els.replayGameSelect?.addEventListener('change', () => {
    state.selectedGameId = els.replayGameSelect.value || '';
    renderSelectedSimulation();
  });
  els.loadReplayBtn?.addEventListener('click', () => loadReplay().catch((err) => setStatus(err.message, 'error')));
  els.replayPlayPauseBtn?.addEventListener('click', () => replayWorkbench.togglePlayback());
  els.replayPrevBtn?.addEventListener('click', () => { replayWorkbench.stopPlayback(); replayWorkbench.step(-1); });
  els.replayNextBtn?.addEventListener('click', () => { replayWorkbench.stopPlayback(); replayWorkbench.step(1); });
  els.replaySpeedSelect?.addEventListener('change', () => replayWorkbench.setSpeed(Number.parseInt(els.replaySpeedSelect.value, 10) || 600));
  els.replayRange?.addEventListener('input', () => {
    replayWorkbench.stopPlayback();
    replayWorkbench.renderFrame(Number.parseInt(els.replayRange.value, 10) || 0);
  });
  window.addEventListener('resize', () => {
    if (replayWorkbench.getReplayPayload()?.game?.replay?.length) {
      replayWorkbench.renderFrame(Number.parseInt(els.replayRange?.value || '0', 10) || 0);
    }
    lossChart.redraw();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadLiveStatus()
      .then((live) => {
        if (live) applyLiveStatusPayload(live);
      })
      .catch(() => {});
    if (!isTrainingActive() && !isSimulationActive()) {
      refreshWorkbench({ workflowTab: state.activeWorkflowTab, silent: true }).catch(() => {});
    }
  });
}

async function boot() {
  try {
    localStorage.removeItem('ADMIN_SECRET');
  } catch (_) {
    // Ignore storage failures; the workbench now relies on cookie-based admin auth.
  }
  connectAdminSocket();
  bindEvents();
  setActiveWorkflowTab(state.activeWorkflowTab);
  updateProgressBar(els.simulationProgressBar, 0, 'default');
  updateProgressBar(els.trainingProgressBar, 0, 'default');
  setTrainingLossDisplay(null);
  updateReplayControlsState();
  await refreshWorkbench({ workflowTab: 'simulations' });
  startServerPolling();
}

boot().catch((err) => setStatus(err.message || 'Failed to initialize workbench.', 'error'));
