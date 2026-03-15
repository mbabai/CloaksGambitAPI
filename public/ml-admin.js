import { createGenerationWinChart } from '/js/modules/mlAdmin/generationWinChart.js';
import { createReplayWorkbench } from '/js/modules/mlAdmin/replay.js';
import { createResourceUsageChart } from '/js/modules/mlAdmin/resourceUsageChart.js';

const workflowTabs = Array.from(document.querySelectorAll('[data-workflow-tab]'));
const workflowPanels = Array.from(document.querySelectorAll('[data-workflow-panel]'));
const LIVE_POLL_MS = 2000;
const WORKBENCH_POLL_MS = 30000;
const UI_CLOCK_MS = 1000;

const els = {
  refreshWorkbenchBtn: document.getElementById('refreshWorkbenchBtn'),
  statusText: document.getElementById('statusText'),

  countRuns: document.getElementById('countRuns'),
  countActiveRuns: document.getElementById('countActiveRuns'),
  countGames: document.getElementById('countGames'),
  countGenerations: document.getElementById('countGenerations'),
  cpuUsageValue: document.getElementById('cpuUsageValue'),
  cpuUsageMeta: document.getElementById('cpuUsageMeta'),
  cpuUsageCanvas: document.getElementById('cpuUsageCanvas'),
  gpuUsageValue: document.getElementById('gpuUsageValue'),
  gpuUsageMeta: document.getElementById('gpuUsageMeta'),
  gpuUsageCanvas: document.getElementById('gpuUsageCanvas'),
  latestRunSummary: document.getElementById('latestRunSummary'),

  seedModeSelect: document.getElementById('seedModeSelect'),
  seedInput: document.getElementById('seedInput'),
  numSelfplayWorkersInput: document.getElementById('numSelfplayWorkersInput'),
  numMctsSimulationsInput: document.getElementById('numMctsSimulationsInput'),
  maxDepthInput: document.getElementById('maxDepthInput'),
  hypothesisCountInput: document.getElementById('hypothesisCountInput'),
  explorationInput: document.getElementById('explorationInput'),
  replayBufferMaxPositionsInput: document.getElementById('replayBufferMaxPositionsInput'),
  batchSizeInput: document.getElementById('batchSizeInput'),
  learningRateInput: document.getElementById('learningRateInput'),
  weightDecayInput: document.getElementById('weightDecayInput'),
  gradientClipNormInput: document.getElementById('gradientClipNormInput'),
  trainingStepsPerCycleInput: document.getElementById('trainingStepsPerCycleInput'),
  parallelTrainingHeadWorkersInput: document.getElementById('parallelTrainingHeadWorkersInput'),
  checkpointIntervalInput: document.getElementById('checkpointIntervalInput'),
  prePromotionTestGamesInput: document.getElementById('prePromotionTestGamesInput'),
  prePromotionTestWinRateInput: document.getElementById('prePromotionTestWinRateInput'),
  promotionTestGamesInput: document.getElementById('promotionTestGamesInput'),
  promotionTestWinRateInput: document.getElementById('promotionTestWinRateInput'),
  promotionTestPriorGenerationsInput: document.getElementById('promotionTestPriorGenerationsInput'),
  olderGenerationSampleProbabilityInput: document.getElementById('olderGenerationSampleProbabilityInput'),
  maxFailedPromotionsInput: document.getElementById('maxFailedPromotionsInput'),
  startRunBtn: document.getElementById('startRunBtn'),

  runsTableBody: document.getElementById('runsTableBody'),
  stopRunBtn: document.getElementById('stopRunBtn'),
  killRunBtn: document.getElementById('killRunBtn'),
  continueRunBtn: document.getElementById('continueRunBtn'),
  deleteRunBtn: document.getElementById('deleteRunBtn'),
  selectedRunLabel: document.getElementById('selectedRunLabel'),
  selectedRunMeta: document.getElementById('selectedRunMeta'),
  selectedRunStats: document.getElementById('selectedRunStats'),
  selectedRunGenerations: document.getElementById('selectedRunGenerations'),
  selectedRunConfigMeta: document.getElementById('selectedRunConfigMeta'),
  selectedRunConfigBody: document.getElementById('selectedRunConfigBody'),
  generationWinCanvas: document.getElementById('generationWinCanvas'),
  generationWinTooltip: document.getElementById('generationWinTooltip'),
  generationWinLegend: document.getElementById('generationWinLegend'),

  replayRunSelect: document.getElementById('replayRunSelect'),
  replayGenerationFilterSelect: document.getElementById('replayGenerationFilterSelect'),
  replayListTopBtn: document.getElementById('replayListTopBtn'),
  replayListBottomBtn: document.getElementById('replayListBottomBtn'),
  replaySelectionMeta: document.getElementById('replaySelectionMeta'),
  replayGameList: document.getElementById('replayGameList'),

  testPromotedBotList: document.getElementById('testPromotedBotList'),
  testSelectionMeta: document.getElementById('testSelectionMeta'),
  savePromotedBotsBtn: document.getElementById('savePromotedBotsBtn'),

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
  defaults: null,
  runs: [],
  resourceTelemetry: null,
  runDetailsById: new Map(),
  liveRunsById: new Map(),
  activeWorkflowTab: 'config',
  selectedRunId: '',
  seedSourceOptions: [],
  replayRunId: '',
  promotedBots: [],
  replayGenerationFilter: '',
  replayGames: [],
  replayGamesByRunId: new Map(),
  selectedReplayGameId: '',
  replayGamesRequestSeq: 0,
  replayGameRequestSeq: 0,
  replayRefreshHandle: null,
  replayGamesLoad: null,
  replayGamesLoading: false,
  replayGamesError: '',
  savingPromotedBots: false,
  adminSocket: null,
  adminSocketDisabled: false,
  livePollHandle: null,
  workbenchPollHandle: null,
  uiClockHandle: null,
};

const fieldHelpTextById = {
  seedModeSelect: 'Choose whether to start from the preferred larger bootstrap baseline, a fresh random model, or a promoted generation from an existing run.',
  seedInput: 'Optional random seed for reproducible model initialization and self-play ordering.',
  numSelfplayWorkersInput: 'How many fresh self-play games to generate per training cycle. Keep this at or above the CPU worker count to avoid starving the worker pool.',
  numMctsSimulationsInput: 'Search simulations per move. Higher is slower but should improve move quality.',
  maxDepthInput: 'Maximum search depth used by the shared-tree ISMCTS rollout.',
  hypothesisCountInput: 'How many hidden-world belief samples the shared-tree ISMCTS search explores per move.',
  explorationInput: 'Exploration constant for MCTS. Higher values spread visits across more actions.',
  replayBufferMaxPositionsInput: 'Maximum number of recent training positions kept in the sliding replay buffer. Larger buffers support larger batches and slower-moving baselines.',
  batchSizeInput: 'Minibatch size sampled from the replay buffer for each gradient update. The default is auto-tuned from the available Python CPU/CUDA hardware, but you can still override it here.',
  learningRateInput: 'Step size used by the optimizer during training.',
  weightDecayInput: 'L2 penalty applied during training to discourage very large weights.',
  gradientClipNormInput: 'Maximum gradient norm before clipping is applied.',
  trainingStepsPerCycleInput: 'How many gradient steps to run after each self-play cycle. The default is stretched automatically on CUDA-capable systems so training runs stay dense without starving self-play.',
  parallelTrainingHeadWorkersInput: 'How many training heads can run in parallel. Policy, value, and identity can each use a separate worker.',
  checkpointIntervalInput: 'Create an evaluation checkpoint every N training steps. Higher values reduce evaluation interruptions.',
  prePromotionTestGamesInput: 'Stage 1 gate: games against the prior promoted generation before deeper promotion testing.',
  prePromotionTestWinRateInput: 'Stage 1 gate: required win rate against the prior promoted generation.',
  promotionTestGamesInput: 'Stage 2 gate: games per matchup against the prior promoted generations.',
  promotionTestWinRateInput: 'Stage 2 gate: required win rate in each full promotion matchup.',
  promotionTestPriorGenerationsInput: 'How many prior promoted generations to include in the full promotion gate.',
  olderGenerationSampleProbabilityInput: 'Chance that self-play mixes in an older approved generation instead of mirroring the worker generation.',
  maxFailedPromotionsInput: 'Stop after this many consecutive failed promotions.',
};

const selectedRunConfigFields = [
  { key: 'seedMode', label: 'Seed Model' },
  { key: 'seedRunId', label: 'Seed Run' },
  { key: 'seedGeneration', label: 'Seed Generation' },
  { key: 'seed', label: 'Seed' },
  { key: 'numSelfplayWorkers', label: 'Self-Play Games / Cycle' },
  { key: 'numMctsSimulationsPerMove', label: 'MCTS Sims / Move' },
  { key: 'maxDepth', label: 'Search Depth' },
  { key: 'hypothesisCount', label: 'Belief Samples / Move' },
  { key: 'exploration', label: 'Exploration' },
  { key: 'replayBufferMaxPositions', label: 'Replay Buffer Max Positions' },
  { key: 'batchSize', label: 'Batch Size' },
  { key: 'learningRate', label: 'Learning Rate' },
  { key: 'weightDecay', label: 'Weight Decay' },
  { key: 'gradientClipNorm', label: 'Gradient Clip Norm' },
  { key: 'trainingStepsPerCycle', label: 'Training Steps Per Cycle' },
  { key: 'parallelTrainingHeadWorkers', label: 'Parallel Training Head Workers' },
  { key: 'checkpointInterval', label: 'Checkpoint Interval' },
  { key: 'prePromotionTestGames', label: 'Pre-Promotion Test Games' },
  { key: 'prePromotionTestWinRate', label: 'Pre-Promotion Test Win Rate' },
  { key: 'promotionTestGames', label: 'Promotion Test Games' },
  { key: 'promotionTestWinRate', label: 'Promotion Test Win Rate' },
  { key: 'promotionTestPriorGenerations', label: 'Promotion Test Prior Generations' },
  { key: 'olderGenerationSampleProbability', label: 'Older Gen Mix Probability' },
  { key: 'maxFailedPromotions', label: 'Failed Promotion Cap' },
];

const hiddenSelectedRunConfigKeys = new Set([
  'parallelGameWorkers',
  'riskBias',
  'trainingBackend',
  'trainingDevicePreference',
  'modelRefreshIntervalForWorkers',
  'generationComparisonStride',
  'evalGamesPerCheckpoint',
  'promotionWinrateThreshold',
  'stopOnMaxGenerations',
  'maxGenerations',
  'stopOnMaxSelfPlayGames',
  'maxSelfPlayGames',
  'stopOnMaxTrainingSteps',
  'maxTrainingSteps',
  'stopOnMaxFailedPromotions',
  'retainedReplayGames',
]);

const generationWinChart = createGenerationWinChart({
  canvas: els.generationWinCanvas,
  tooltip: els.generationWinTooltip,
  legend: els.generationWinLegend,
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

const cpuUsageChart = createResourceUsageChart({
  canvas: els.cpuUsageCanvas,
  colors: {
    fill: 'rgba(127, 210, 222, 0.18)',
    stroke: '#7fd2de',
  },
});

const gpuUsageChart = createResourceUsageChart({
  canvas: els.gpuUsageCanvas,
  colors: {
    fill: 'rgba(240, 182, 88, 0.2)',
    stroke: '#f0b658',
  },
});

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) return 'n/a';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : '--';
}

function formatUsagePercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : '--';
}

function formatNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toLocaleString() : '0';
}

function formatDuration(valueMs) {
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

function formatDecimal(value, maximumFractionDigits = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  return numeric.toLocaleString(undefined, {
    maximumFractionDigits,
  });
}

function humanizeConfigKey(key) {
  return String(key || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatRunConfigValue(key, value) {
  if (value === null || value === undefined || value === '') return '--';
  if (typeof value === 'boolean') {
    return value ? 'Enabled' : 'Disabled';
  }
  if (typeof value === 'number') {
    if (/winrate|probability/i.test(key)) {
      return formatPercent(value);
    }
    if (Number.isInteger(value)) {
      return formatNumber(value);
    }
    return formatDecimal(value);
  }
  if (Array.isArray(value)) {
    return value.length ? value.join(', ') : '--';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildSelectedRunConfigEntries(config = {}) {
  const entries = [];
  const usedKeys = new Set();
  selectedRunConfigFields.forEach((field) => {
    if (hiddenSelectedRunConfigKeys.has(field.key)) return;
    if (!Object.prototype.hasOwnProperty.call(config, field.key)) return;
    usedKeys.add(field.key);
    entries.push({
      key: field.key,
      label: field.label,
      value: formatRunConfigValue(field.key, config[field.key]),
    });
  });
  Object.keys(config)
    .filter((key) => !usedKeys.has(key) && !hiddenSelectedRunConfigKeys.has(key))
    .sort((left, right) => left.localeCompare(right))
    .forEach((key) => {
      entries.push({
        key,
        label: humanizeConfigKey(key),
        value: formatRunConfigValue(key, config[key]),
      });
    });
  return entries;
}

function getRunElapsedMs(run, live = null, nowMs = Date.now()) {
  const status = String(live?.status || run?.status || '').toLowerCase();
  const isActive = ['running', 'stopping'].includes(status);
  const reportedElapsedMs = Number(live?.elapsedMs ?? run?.elapsedMs);
  if (Number.isFinite(reportedElapsedMs) && reportedElapsedMs >= 0) {
    if (!isActive) return reportedElapsedMs;
    const snapshotAtMs = Date.parse(live?.timestamp || run?.updatedAt || run?.createdAt || '');
    if (!Number.isFinite(snapshotAtMs)) return reportedElapsedMs;
    return Math.max(0, reportedElapsedMs + (nowMs - snapshotAtMs));
  }
  const startedAtMs = Date.parse(run?.createdAt || live?.createdAt || '');
  if (!Number.isFinite(startedAtMs)) return 0;
  const endedAtMs = isActive
    ? nowMs
    : (Date.parse(live?.timestamp || run?.updatedAt || run?.createdAt || '') || startedAtMs);
  return Math.max(0, endedAtMs - startedAtMs);
}

function getRunTimingSnapshot(runId) {
  if (!runId) return null;
  const run = getRunData(runId);
  if (!run) return null;
  const live = state.liveRunsById.get(runId) || null;
  return {
    run,
    live,
    averageSelfPlayGameDurationMs: Number(live?.averageSelfPlayGameDurationMs ?? run.averageSelfPlayGameDurationMs ?? 0),
    averageEvaluationGameDurationMs: Number(live?.averageEvaluationGameDurationMs ?? run.averageEvaluationGameDurationMs ?? 0),
    elapsedMs: Number(live?.elapsedMs ?? run.elapsedMs ?? getRunElapsedMs(run, live)),
  };
}

function formatEvaluationProgressLabel(progress) {
  if (!progress || progress.active === false) return '';
  const stageLabel = progress.stageLabel || humanizeConfigKey(progress.stage || 'evaluation');
  const opponentLabel = progress.opponentLabel || (Number.isFinite(progress.opponentGeneration) ? `G${progress.opponentGeneration}` : '');
  const completedGames = Number(progress.completedGames || 0);
  const targetGames = Number(progress.targetGames || 0);
  const parts = [
    `eval ${stageLabel.toLowerCase()}`,
    opponentLabel ? `vs ${opponentLabel}` : '',
    targetGames > 0 ? `${formatNumber(completedGames)}/${formatNumber(targetGames)}` : '',
    completedGames > 0 ? formatPercent(progress.winRate || 0) : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function formatSelfPlayProgressLabel(progress) {
  if (!progress || progress.active === false) return '';
  const workerLabel = Number.isFinite(progress.workerGeneration) ? `G${progress.workerGeneration}` : 'worker';
  const opponentLabel = Number.isFinite(progress.opponentGeneration) ? `vs G${progress.opponentGeneration}` : '';
  const completedGames = Number(progress.completedGames || 0);
  const targetGames = Number(progress.targetGames || 0);
  const parts = [
    'self-play',
    workerLabel,
    opponentLabel,
    targetGames > 0 ? `${formatNumber(completedGames)}/${formatNumber(targetGames)}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

function sortReplayGamesChronologically(games = []) {
  return [...(Array.isArray(games) ? games : [])].sort((left, right) => {
    const leftTime = Date.parse(left?.createdAt || '') || 0;
    const rightTime = Date.parse(right?.createdAt || '') || 0;
    if (leftTime !== rightTime) return leftTime - rightTime;
    return String(left?.id || '').localeCompare(String(right?.id || ''));
  });
}

function parseNumberInput(element, fallback, asFloat = false) {
  const raw = element?.value || '';
  const parsed = asFloat ? Number.parseFloat(raw) : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildBuiltinSeedSourceOptions() {
  return [
    { value: 'bootstrap', label: 'Bootstrap Shared-Encoder MLP (1.6M params)' },
    { value: 'random', label: 'Random Shared-Encoder MLP (1.6M params)' },
  ];
}

function parseSeedSourceSelection(value) {
  const normalized = String(value || '').trim();
  const promotedMatch = normalized.match(/^generation:([^:]+):(\d+)$/i);
  if (promotedMatch) {
    return {
      seedMode: 'promoted_generation',
      seedRunId: promotedMatch[1],
      seedGeneration: Number.parseInt(promotedMatch[2], 10),
    };
  }
  if (normalized.toLowerCase() === 'random') {
    return {
      seedMode: 'random',
      seedRunId: null,
      seedGeneration: null,
    };
  }
  return {
    seedMode: 'bootstrap',
    seedRunId: null,
    seedGeneration: null,
  };
}

function renderSeedSourceSelect(preferredValue = '') {
  const items = Array.isArray(state.seedSourceOptions) && state.seedSourceOptions.length
    ? state.seedSourceOptions
    : buildBuiltinSeedSourceOptions();
  fillSelect(els.seedModeSelect, items.map((item) => ({
    value: item.value,
    label: item.label,
  })), { preferredValue });
}

function fillSelect(select, items, { includeBlank = false, blankLabel = 'Select', preferredValue = '' } = {}) {
  if (!select) return;
  const previous = preferredValue || select.value;
  select.innerHTML = '';
  if (includeBlank) {
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = blankLabel;
    select.appendChild(blank);
  }
  items.forEach((item) => {
    const option = document.createElement('option');
    option.value = String(item.value);
    option.textContent = item.label;
    select.appendChild(option);
  });
  if (items.some((item) => String(item.value) === String(previous))) {
    select.value = String(previous);
  } else if (!includeBlank && items.length) {
    select.value = String(items[0].value);
  } else {
    select.value = '';
  }
}

function applyFieldTooltips() {
  Object.entries(fieldHelpTextById).forEach(([id, helpText]) => {
    const element = document.getElementById(id);
    const label = document.querySelector(`label[for="${id}"]`);
    if (element) element.title = helpText;
    if (label) label.title = helpText;
  });
}

function setStatus(message, tone = 'muted') {
  if (!els.statusText) return;
  els.statusText.textContent = message;
  els.statusText.className = 'status-text';
  if (tone === 'error') els.statusText.style.color = '#ef8787';
  else if (tone === 'ok') els.statusText.style.color = '#8ed18e';
  else if (tone === 'warn') els.statusText.style.color = '#ffd89a';
  else els.statusText.style.color = '#93afa8';
}

function logMlAdminError(context, error = null, details = {}) {
  console.error(`[ml-admin] ${context}`, {
    message: error?.message || null,
    status: Number.isFinite(error?.status) ? error.status : null,
    stack: error?.stack || null,
    payload: error?.payload || null,
    ...details,
  });
}

function sortRunsByRecent(runs = []) {
  return [...runs].sort((left, right) => {
    const leftTime = Date.parse(left?.updatedAt || left?.createdAt || '') || 0;
    const rightTime = Date.parse(right?.updatedAt || right?.createdAt || '') || 0;
    return rightTime - leftTime;
  });
}

function getRunSummary(runId) {
  return state.runs.find((run) => run.id === runId) || null;
}

function getRunDetail(runId) {
  return state.runDetailsById.get(runId) || null;
}

function getRunData(runId) {
  if (!runId) return null;
  const summary = getRunSummary(runId);
  const detail = getRunDetail(runId);
  if (!summary) return detail || null;
  if (!detail) return summary;
  return {
    ...detail,
    ...summary,
    config: detail.config || summary.config || {},
    generations: Array.isArray(detail.generations) ? detail.generations : (summary.generations || []),
    evaluationSeries: Array.isArray(detail.evaluationSeries) ? detail.evaluationSeries : [],
    metricsHistory: Array.isArray(detail.metricsHistory) ? detail.metricsHistory : [],
    generationPairs: Array.isArray(detail.generationPairs) ? detail.generationPairs : [],
    recentReplayGames: Array.isArray(detail.recentReplayGames) ? detail.recentReplayGames : [],
    canContinue: Boolean(summary.canContinue || detail.canContinue),
  };
}

function getSelectedRunData() {
  return state.selectedRunId ? getRunData(state.selectedRunId) : null;
}

function getReplayRunData(runId = state.replayRunId) {
  return getRunData(runId);
}

function getReplayPreviewGames(runId = state.replayRunId) {
  const run = getReplayRunData(runId);
  return sortReplayGamesChronologically(Array.isArray(run?.recentReplayGames) ? run.recentReplayGames : []);
}

function getReplayGamesForRun(runId = state.replayRunId) {
  if (!runId) return [];
  return Array.isArray(state.replayGamesByRunId.get(runId))
    ? state.replayGamesByRunId.get(runId)
    : [];
}

function getReplayGenerationFilterValue() {
  const parsed = Number.parseInt(state.replayGenerationFilter, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReplayGenerationOptions(runId = state.replayRunId) {
  const sourceGames = getReplayGamesForRun(runId);
  const previewGames = getReplayPreviewGames(runId);
  return [...new Set([...sourceGames, ...previewGames]
    .flatMap((game) => [Number(game?.whiteGeneration), Number(game?.blackGeneration)])
    .filter((generation) => Number.isFinite(generation))
    .sort((left, right) => left - right))];
}

function getVisibleReplayGames(runId = state.replayRunId) {
  const games = getReplayGamesForRun(runId);
  const generationFilter = getReplayGenerationFilterValue();
  if (!Number.isFinite(generationFilter)) {
    return games;
  }
  return games.filter((game) => (
    Number(game?.whiteGeneration) === generationFilter
    || Number(game?.blackGeneration) === generationFilter
  ));
}

function normalizeReplayGenerationFilter(runId = state.replayRunId) {
  const generationFilter = getReplayGenerationFilterValue();
  if (!Number.isFinite(generationFilter)) {
    state.replayGenerationFilter = '';
    return;
  }
  if (!getReplayGenerationOptions(runId).includes(generationFilter)) {
    state.replayGenerationFilter = '';
  }
}

function renderReplayGenerationFilter(runId = state.replayRunId) {
  if (!els.replayGenerationFilterSelect) return;
  const options = getReplayGenerationOptions(runId).map((generation) => ({
    value: String(generation),
    label: `G${generation}`,
  }));
  fillSelect(els.replayGenerationFilterSelect, options, {
    includeBlank: true,
    blankLabel: 'All generations',
    preferredValue: state.replayGenerationFilter,
  });
  if (state.replayGenerationFilter) {
    els.replayGenerationFilterSelect.value = state.replayGenerationFilter;
  }
}

function scrollReplayListTo(position = 'top') {
  if (!els.replayGameList) return;
  const top = position === 'bottom' ? els.replayGameList.scrollHeight : 0;
  els.replayGameList.scrollTo({
    top,
    behavior: 'smooth',
  });
}

function mergeRunSummary(nextSummary) {
  if (!nextSummary?.id) return;
  const existingIndex = state.runs.findIndex((run) => run.id === nextSummary.id);
  if (existingIndex >= 0) {
    state.runs.splice(existingIndex, 1, { ...state.runs[existingIndex], ...nextSummary });
  } else {
    state.runs.unshift(nextSummary);
  }
  state.runs = sortRunsByRecent(state.runs);
}

function clearReplaySelection() {
  state.replayGamesRequestSeq += 1;
  state.replayGameRequestSeq += 1;
  state.replayGamesLoad = null;
  state.replayGamesLoading = false;
  if (state.replayRefreshHandle) {
    window.clearTimeout(state.replayRefreshHandle);
    state.replayRefreshHandle = null;
  }
  state.replayGamesError = '';
  state.replayGenerationFilter = '';
  state.replayGames = [];
  state.selectedReplayGameId = '';
  replayWorkbench.clear();
  els.replayPlayPauseBtn.disabled = true;
  els.replayPrevBtn.disabled = true;
  els.replayNextBtn.disabled = true;
}

function setReplayLoading(message = 'Loading replay...') {
  els.replayMeta.textContent = message;
  els.decisionInspector.innerHTML = `<div class="subtle">${escapeHtml(message)}</div>`;
  els.replayMoveLog.innerHTML = `<div class="subtle">${escapeHtml(message)}</div>`;
  els.replayPlayPauseBtn.disabled = true;
  els.replayPrevBtn.disabled = true;
  els.replayNextBtn.disabled = true;
}

function setReplayControlsEnabled(enabled) {
  const disabled = !enabled;
  els.replayPlayPauseBtn.disabled = disabled;
  els.replayPrevBtn.disabled = disabled;
  els.replayNextBtn.disabled = disabled;
}

function getReplayLoadedGameId() {
  return replayWorkbench.getReplayPayload()?.game?.id || '';
}

function getReplayEmptyStateMessage(runId = state.replayRunId) {
  const run = getReplayRunData(runId);
  const live = run?.id ? state.liveRunsById.get(run.id) || null : null;
  const totalEvaluationGames = Number(live?.totalEvaluationGames ?? run?.totalEvaluationGames ?? 0);
  const knownGenerationChecks = Array.isArray(run?.generationPairs) ? run.generationPairs.length : 0;
  if (totalEvaluationGames > 0 || knownGenerationChecks > 0) {
    return 'No eval replay rows were returned for this run.';
  }
  return 'No eval games for this run yet.';
}

function scheduleReplayGamesRefresh(runId = state.replayRunId, delayMs = 900) {
  if (!runId || state.replayRunId !== runId) return;
  if (state.replayRefreshHandle) {
    window.clearTimeout(state.replayRefreshHandle);
  }
  state.replayRefreshHandle = window.setTimeout(() => {
    state.replayRefreshHandle = null;
    if (state.activeWorkflowTab !== 'replay' || state.replayRunId !== runId) {
      return;
    }
    loadReplayGames({ autoLoadLatest: true, force: true }).catch((err) => setStatus(err.message, 'error'));
  }, delayMs);
}

function removeRunFromState(runId) {
  if (!runId) return;
  state.runs = state.runs.filter((run) => run.id !== runId);
  state.runDetailsById.delete(runId);
  state.liveRunsById.delete(runId);
  state.replayGamesByRunId.delete(runId);
  if (state.selectedRunId === runId) {
    state.selectedRunId = '';
  }
  if (state.replayRunId === runId) {
    state.replayRunId = '';
    clearReplaySelection();
  }
}

function applyLiveRunPayload(payload = {}, { render = true } = {}) {
  if (!payload?.runId) return;
  state.liveRunsById.set(payload.runId, payload);
  mergeRunSummary({
    id: payload.runId,
    label: payload.label || payload.runId,
    status: payload.status || 'running',
    bestGeneration: Number(payload.bestGeneration || 0),
    workerGeneration: Number(payload.workerGeneration || 0),
    totalSelfPlayGames: Number(payload.totalSelfPlayGames || 0),
    totalEvaluationGames: Number(payload.totalEvaluationGames || 0),
    averageSelfPlayGameDurationMs: Number(payload.averageSelfPlayGameDurationMs || 0),
    averageEvaluationGameDurationMs: Number(payload.averageEvaluationGameDurationMs || 0),
    elapsedMs: Number(payload.elapsedMs || 0),
    totalTrainingSteps: Number(payload.totalTrainingSteps || 0),
    replayBuffer: payload.replayBuffer || {},
    latestLoss: payload.latestLoss || null,
    latestEvaluation: payload.latestEvaluation || null,
    createdAt: payload.createdAt || getRunSummary(payload.runId)?.createdAt || null,
    updatedAt: payload.timestamp || new Date().toISOString(),
    stopReason: payload.stopReason || null,
  });
  if (render) {
    renderWorkbenchSummary();
    renderRunsTable();
    renderSelectedRun();
    renderReplaySelectionMeta();
  }
}

function applyResourceTelemetry(resourceTelemetry, { render = true } = {}) {
  if (!resourceTelemetry || typeof resourceTelemetry !== 'object') return;
  state.resourceTelemetry = resourceTelemetry;
  if (render) {
    renderResourceTelemetry();
  }
}

async function apiFetch(path, options = {}) {
  const init = { credentials: 'include', ...options };
  init.headers = { ...(init.headers || {}) };
  if (!init.cache) {
    init.cache = 'no-store';
  }
  if (init.body && !init.headers['Content-Type']) {
    init.headers['Content-Type'] = 'application/json';
  }
  let response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    logMlAdminError('API request failed before response', error, {
      path,
      method: init.method || 'GET',
    });
    throw error;
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (_) {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed (${response.status})`);
    error.status = response.status;
    error.payload = payload;
    logMlAdminError('API request failed', error, {
      path,
      method: init.method || 'GET',
    });
    throw error;
  }
  return payload;
}

function setActiveWorkflowTab(tab) {
  state.activeWorkflowTab = tab;
  workflowTabs.forEach((button) => button.classList.toggle('active', button.dataset.workflowTab === tab));
  workflowPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.workflowPanel === tab));
  window.requestAnimationFrame(() => {
    if (tab === 'runs') {
      generationWinChart.redraw();
      return;
    }
    if (tab === 'replay' && replayWorkbench.getReplayPayload()?.game?.replay?.length) {
      replayWorkbench.renderFrame(Number.parseInt(els.replayRange?.value || '0', 10) || 0);
    }
  });
  hydrateActiveWorkflowTab().catch((err) => setStatus(err.message, 'error'));
}

function applyDefaults(defaults = {}) {
  if (!defaults || state.defaults) return;
  state.defaults = defaults;
  renderSeedSourceSelect(defaults.seedMode || 'bootstrap');
  els.numSelfplayWorkersInput.value = String(defaults.numSelfplayWorkers || 32);
  els.numMctsSimulationsInput.value = String(defaults.numMctsSimulationsPerMove || 512);
  els.maxDepthInput.value = String(defaults.maxDepth || 64);
  els.hypothesisCountInput.value = String(defaults.hypothesisCount || 4);
  els.explorationInput.value = String(defaults.exploration || 1.5);
  els.replayBufferMaxPositionsInput.value = String(defaults.replayBufferMaxPositions || 100000);
  els.batchSizeInput.value = String(defaults.batchSize || 256);
  els.learningRateInput.value = String(defaults.learningRate || 0.0005);
  els.weightDecayInput.value = String(defaults.weightDecay || 0.0001);
  els.gradientClipNormInput.value = String(defaults.gradientClipNorm || 1);
  els.trainingStepsPerCycleInput.value = String(defaults.trainingStepsPerCycle || 32);
  els.parallelTrainingHeadWorkersInput.value = String(defaults.parallelTrainingHeadWorkers || 3);
  els.checkpointIntervalInput.value = String(defaults.checkpointInterval || 200);
  els.prePromotionTestGamesInput.value = String(defaults.prePromotionTestGames || defaults.evalGamesPerCheckpoint || 40);
  els.prePromotionTestWinRateInput.value = String(defaults.prePromotionTestWinRate ?? defaults.promotionWinrateThreshold ?? 0.6);
  els.promotionTestGamesInput.value = String(defaults.promotionTestGames || defaults.evalGamesPerCheckpoint || 100);
  els.promotionTestWinRateInput.value = String(defaults.promotionTestWinRate ?? defaults.promotionWinrateThreshold ?? 0.55);
  els.promotionTestPriorGenerationsInput.value = String(defaults.promotionTestPriorGenerations || 3);
  els.olderGenerationSampleProbabilityInput.value = String(defaults.olderGenerationSampleProbability || 0.10);
  els.maxFailedPromotionsInput.value = String(defaults.maxFailedPromotions || 50);
}

function renderWorkbenchSummary() {
  const runs = sortRunsByRecent(state.runs);
  const activeRuns = runs.filter((run) => ['running', 'stopping'].includes(String(run?.status || '').toLowerCase()));
  const totalGames = runs.reduce((sum, run) => (
    sum + Number(run?.totalSelfPlayGames || 0) + Number(run?.totalEvaluationGames || 0)
  ), 0);
  const totalGenerations = runs.reduce((sum, run) => sum + Number(run?.generationCount || 0), 0);
  els.countRuns.textContent = formatNumber(runs.length);
  els.countActiveRuns.textContent = formatNumber(activeRuns.length);
  els.countGames.textContent = formatNumber(totalGames);
  els.countGenerations.textContent = formatNumber(totalGenerations);
  const latest = runs[0];
  els.latestRunSummary.textContent = latest
    ? `${latest.label} | ${latest.status} | best G${latest.bestGeneration || 0} | buffer ${latest.replayBuffer?.positions || 0}/${latest.replayBuffer?.maxPositions || 0} | updated ${formatDate(latest.updatedAt || latest.createdAt)}`
    : 'No runs yet.';
  renderResourceTelemetry();
}

function renderResourceTelemetry() {
  const telemetry = state.resourceTelemetry || null;
  const cpu = telemetry?.cpu || null;
  const gpu = telemetry?.gpu || null;

  if (els.cpuUsageValue) {
    els.cpuUsageValue.textContent = formatUsagePercent(cpu?.currentPercent);
  }
  if (els.cpuUsageMeta) {
    els.cpuUsageMeta.textContent = cpu?.updatedAt
      ? `2s samples · updated ${new Date(cpu.updatedAt).toLocaleTimeString()}`
      : '2s samples · waiting';
  }
  cpuUsageChart.setHistory(Array.isArray(cpu?.history) ? cpu.history : []);

  if (els.gpuUsageValue) {
    els.gpuUsageValue.textContent = gpu?.available === false
      ? 'n/a'
      : formatUsagePercent(gpu?.currentPercent);
  }
  if (els.gpuUsageMeta) {
    if (gpu?.available === false) {
      els.gpuUsageMeta.textContent = 'nvidia-smi unavailable';
    } else if (gpu?.updatedAt) {
      const label = gpu?.label || 'GPU';
      els.gpuUsageMeta.textContent = `${label} · updated ${new Date(gpu.updatedAt).toLocaleTimeString()}`;
    } else {
      els.gpuUsageMeta.textContent = 'Detecting...';
    }
  }
  gpuUsageChart.setHistory(Array.isArray(gpu?.history) ? gpu.history : []);
}

function runStatusBadge(run) {
  const status = String(run?.status || 'unknown').toLowerCase();
  const tone = status === 'running' ? 'active' : (status === 'completed' || status === 'stopped' ? 'ok' : (status === 'error' ? 'error' : ''));
  return `<span class="badge ${tone}">${escapeHtml(status)}</span>`;
}

function renderRunsTable() {
  const rows = sortRunsByRecent(state.runs).map((run) => {
    const isActive = run.id === state.selectedRunId ? ' active' : '';
    return `
      <tr class="run-title-row${isActive}" data-run-id="${escapeHtml(run.id)}">
        <td class="run-title-cell" colspan="6">
          ${escapeHtml(run.label || run.id)}
        </td>
      </tr>
      <tr class="run-detail-row${isActive}" data-run-id="${escapeHtml(run.id)}">
        <td class="run-detail-cell">
          &nbsp;
        </td>
        <td class="run-detail-cell">
          ${runStatusBadge(run)}
        </td>
        <td class="run-detail-cell">
          <div class="run-detail-v">G${Number(run.bestGeneration || 0)}</div>
        </td>
        <td class="run-detail-cell">
          <div class="run-detail-v">${formatNumber(Number(run.totalSelfPlayGames || 0) + Number(run.totalEvaluationGames || 0))}</div>
        </td>
        <td class="run-detail-cell">
          <div class="run-detail-v">${formatNumber(run.replayBuffer?.positions || 0)}</div>
        </td>
        <td class="run-detail-cell">
          <div class="run-detail-v">${escapeHtml(formatDate(run.updatedAt || run.createdAt))}</div>
        </td>
      </tr>
    `;
  }).join('');
  els.runsTableBody.innerHTML = rows || '<tr><td colspan="6" class="subtle">No runs yet.</td></tr>';
}

function renderSelectedRun() {
  const run = getSelectedRunData();
  if (!run) {
    els.selectedRunLabel.textContent = 'No run selected.';
    els.selectedRunMeta.textContent = 'Select a run to inspect its generation history.';
    els.selectedRunStats.innerHTML = '';
    els.selectedRunGenerations.innerHTML = '';
    els.selectedRunConfigMeta.textContent = 'Select a run to inspect its saved config.';
    els.selectedRunConfigBody.innerHTML = '<tr><td colspan="2" class="subtle">No run selected.</td></tr>';
    els.stopRunBtn.textContent = 'Stop Run';
    els.stopRunBtn.disabled = true;
    els.killRunBtn.disabled = true;
    els.continueRunBtn.disabled = true;
    els.deleteRunBtn.disabled = true;
    generationWinChart.clear();
    return;
  }
  const live = state.liveRunsById.get(run.id) || null;
  const latestLoss = live?.latestLoss || run.latestLoss || null;
  const latestEval = live?.latestEvaluation || run.latestEvaluation || null;
  const selfPlayProgress = live?.selfPlayProgress || null;
  const evaluationProgress = live?.evaluationProgress || null;
  const status = String(run.status || '').toLowerCase();
  const primaryEval = latestEval?.prePromotionTest || latestEval?.againstBest || latestEval?.againstTarget || null;
  const primaryEvalGeneration = Number.isFinite(primaryEval?.generation)
    ? Number(primaryEval.generation)
    : Number(live?.bestGeneration ?? run.bestGeneration ?? 0);
  const primaryEvalLabel = latestEval?.prePromotionTest
    ? `Pre-Promo G${primaryEvalGeneration}`
    : `Vs Best G${primaryEvalGeneration}`;
  const timing = getRunTimingSnapshot(run.id);
  els.selectedRunLabel.textContent = run.label || run.id;
  els.selectedRunMeta.textContent = [
    `${run.status || 'unknown'} | best G${Number(live?.bestGeneration ?? run.bestGeneration ?? 0)} | worker G${Number(live?.workerGeneration ?? run.workerGeneration ?? 0)}`,
    formatSelfPlayProgressLabel(selfPlayProgress),
    formatEvaluationProgressLabel(evaluationProgress),
    run.stopReason ? `stop ${run.stopReason}` : '',
    `updated ${formatDate(live?.timestamp || run.updatedAt || run.createdAt)}`,
  ].filter(Boolean).join(' | ');
  els.stopRunBtn.textContent = status === 'stopping' ? 'Stop Pending' : 'Stop Run';
  els.stopRunBtn.disabled = !['running', 'stopping'].includes(status);
  els.killRunBtn.disabled = !['running', 'stopping'].includes(status);
  els.killRunBtn.title = ['running', 'stopping'].includes(status)
    ? 'Force this run to stop immediately. The latest unsaved in-flight work may be discarded.'
    : 'Only active runs can be killed.';
  const canContinue = status === 'stopped' && run.canContinue;
  els.continueRunBtn.disabled = !canContinue;
  els.continueRunBtn.title = canContinue
    ? 'Resume this stopped run.'
    : (status === 'stopped' ? 'This run was saved without resumable state, so it cannot be continued.' : 'Stop the run before continuing it.');
  els.deleteRunBtn.disabled = ['running', 'stopping'].includes(status);
  const stats = [
    { label: 'Self-Play Games', value: formatNumber(live?.totalSelfPlayGames ?? run.totalSelfPlayGames ?? 0) },
    { label: 'Eval Games', value: formatNumber(live?.totalEvaluationGames ?? run.totalEvaluationGames ?? 0) },
    { label: 'Training Steps', value: formatNumber(live?.totalTrainingSteps ?? run.totalTrainingSteps ?? 0) },
    { label: 'Avg Sim Time', value: formatDuration(timing?.averageSelfPlayGameDurationMs ?? 0) },
    { label: 'Avg Eval Time', value: formatDuration(timing?.averageEvaluationGameDurationMs ?? 0) },
    { label: 'Run Time', value: formatDuration(getRunElapsedMs(run, live)) },
    { label: 'Replay Buffer', value: `${formatNumber(live?.replayBuffer?.positions ?? run.replayBuffer?.positions ?? 0)} / ${formatNumber(live?.replayBuffer?.maxPositions ?? run.replayBuffer?.maxPositions ?? 0)}` },
    { label: 'Latest Loss', value: latestLoss ? `P ${Number(latestLoss.policyLoss || 0).toFixed(3)} | V ${Number(latestLoss.valueLoss || 0).toFixed(3)}` : '--' },
    { label: primaryEvalLabel, value: primaryEval ? formatPercent(primaryEval.winRate) : '--' },
  ];
  els.selectedRunStats.innerHTML = stats.map((entry) => `
    <div class="run-stat">
      <div class="k">${escapeHtml(entry.label)}</div>
      <div class="v">${escapeHtml(entry.value)}</div>
    </div>
  `).join('');
  const generations = Array.isArray(run.generations) ? run.generations : [];
  const currentGeneration = generations.length
    ? Math.max(...generations.map((generation) => Number(generation?.generation || 0)))
    : Number(run.bestGeneration || 0);
  const promotedGenerations = [...new Set(generations
    .filter((generation) => generation && generation.approved !== false)
    .map((generation) => Number(generation.generation))
    .filter((generation) => Number.isFinite(generation))
    .sort((left, right) => left - right))];
  els.selectedRunGenerations.innerHTML = `
    <div class="detail-row"><strong>Current Generation:</strong> ${escapeHtml(`G${currentGeneration}`)}</div>
    <div class="detail-row"><strong>Current Best:</strong> ${escapeHtml(`G${Number(run.bestGeneration || 0)}`)}</div>
    <div class="detail-row"><strong>Promoted generations:</strong> ${escapeHtml(promotedGenerations.length ? promotedGenerations.map((generation) => `G${generation}`).join(', ') : '--')}</div>
  `;
  generationWinChart.setData({
    title: `${run.label} generation checks`,
    series: Array.isArray(run.evaluationSeries) ? run.evaluationSeries : [],
  });
  const configEntries = buildSelectedRunConfigEntries(run.config || {});
  els.selectedRunConfigMeta.textContent = configEntries.length
    ? `Saved config snapshot for this run (${configEntries.length} setting${configEntries.length === 1 ? '' : 's'} shown; auto-managed internals hidden).`
    : 'This run does not expose a saved config snapshot.';
  els.selectedRunConfigBody.innerHTML = configEntries.length
    ? configEntries.map((entry) => `
      <tr>
        <td>${escapeHtml(entry.label)}</td>
        <td>${escapeHtml(entry.value)}</td>
      </tr>
    `).join('')
    : '<tr><td colspan="2" class="subtle">No saved config found for this run.</td></tr>';
}

function renderReplaySelectors() {
  const runs = sortRunsByRecent(state.runs);
  fillSelect(els.replayRunSelect, runs.map((run) => ({
    value: run.id,
    label: `${run.label} (${run.status})`,
  })), { includeBlank: true, blankLabel: 'Choose run', preferredValue: state.replayRunId });
  renderReplayGenerationFilter();
  renderReplaySelectionMeta();
}

function renderReplaySelectionMeta() {
  if (!els.replaySelectionMeta) return;
  if (!state.replayRunId) {
    els.replaySelectionMeta.textContent = 'Choose a run to load its retained games.';
    return;
  }
  const timing = getRunTimingSnapshot(state.replayRunId);
  if (!timing?.run) {
    els.replaySelectionMeta.textContent = 'Loading retained games...';
    return;
  }
  const live = state.liveRunsById.get(state.replayRunId) || null;
  const totalEvaluationGames = Number(live?.totalEvaluationGames ?? timing.run.totalEvaluationGames ?? 0);
  const knownGenerationChecks = Array.isArray(timing.run.generationPairs) ? timing.run.generationPairs.length : 0;
  const loadedGameCount = getReplayGamesForRun(state.replayRunId).length;
  const visibleGameCount = getVisibleReplayGames(state.replayRunId).length;
  const generationFilter = getReplayGenerationFilterValue();
  const filterLabel = Number.isFinite(generationFilter) ? `Filter G${generationFilter}` : 'All generations';
  let gameCountLabel = `${loadedGameCount} eval game(s) loaded`;
  if (state.replayGamesLoading && !loadedGameCount) {
    gameCountLabel = 'Loading eval games';
  } else if (state.replayGamesError && !loadedGameCount) {
    gameCountLabel = state.replayGamesError;
  } else if (!loadedGameCount && (totalEvaluationGames > 0 || knownGenerationChecks > 0)) {
    gameCountLabel = 'No eval games loaded yet';
  } else if (!loadedGameCount) {
    gameCountLabel = 'No eval games yet';
  }
  els.replaySelectionMeta.textContent = [
    `${gameCountLabel} for ${timing.run.label || timing.run.id}.`,
    `Showing ${visibleGameCount}`,
    filterLabel,
    `Avg sim ${formatDuration(timing.averageSelfPlayGameDurationMs)}`,
    `Avg eval ${formatDuration(timing.averageEvaluationGameDurationMs)}`,
    `Run time ${formatDuration(getRunElapsedMs(timing.run, timing.live))}`,
  ].join(' | ');
}

function renderReplayGameList({ scrollToBottom = false } = {}) {
  const loadedGames = getReplayGamesForRun(state.replayRunId);
  state.replayGames = loadedGames;
  const visibleGames = getVisibleReplayGames(state.replayRunId);
  if (els.replayListTopBtn) {
    els.replayListTopBtn.disabled = !visibleGames.length;
  }
  if (els.replayListBottomBtn) {
    els.replayListBottomBtn.disabled = !visibleGames.length;
  }
  if (!state.replayRunId) {
    els.replayGameList.innerHTML = '<div class="detail-row"><div class="subtle">Choose a run to see eval games.</div></div>';
    return;
  }
  if (state.replayGamesLoading && !loadedGames.length) {
    els.replayGameList.innerHTML = '<div class="detail-row"><div class="subtle">Loading eval games...</div></div>';
    return;
  }
  if (state.replayGamesError && !loadedGames.length) {
    els.replayGameList.innerHTML = `<div class="detail-row"><div class="subtle">${escapeHtml(state.replayGamesError)}</div></div>`;
    return;
  }
  if (!loadedGames.length) {
    els.replayGameList.innerHTML = `<div class="detail-row"><div class="subtle">${escapeHtml(getReplayEmptyStateMessage())}</div></div>`;
    return;
  }
  if (!visibleGames.length) {
    const generationFilter = getReplayGenerationFilterValue();
    els.replayGameList.innerHTML = `<div class="detail-row"><div class="subtle">${escapeHtml(`No eval games match ${Number.isFinite(generationFilter) ? `G${generationFilter}` : 'the current filter'}.`)}</div></div>`;
    return;
  }
  els.replayGameList.innerHTML = visibleGames.map((game) => `
    <div class="detail-row ${game.id === state.selectedReplayGameId ? 'active' : ''}" data-game-id="${escapeHtml(game.id)}">
      <div class="detail-row-head">
        <strong>${escapeHtml(`${game.whiteParticipantLabel || `G${game.whiteGeneration}`} vs ${game.blackParticipantLabel || `G${game.blackGeneration}`}`)}</strong>
        <span class="badge">${escapeHtml(game.id || 'eval')}</span>
      </div>
      <div class="detail-row-meta">
        <div class="subtle">Eval | Winner ${escapeHtml(game.winnerLabel || 'Draw')} | ${escapeHtml(formatDuration(game.durationMs || 0))}</div>
        <div class="subtle">${escapeHtml(formatDate(game.createdAt))}</div>
      </div>
    </div>
  `).join('');
  if (scrollToBottom) {
    window.requestAnimationFrame(() => {
      if (!els.replayGameList) return;
      els.replayGameList.scrollTop = els.replayGameList.scrollHeight;
    });
  }
}

async function loadMostRecentAvailableReplay(preferredGameId = state.selectedReplayGameId) {
  const candidateIds = [];
  if (preferredGameId) {
    candidateIds.push(preferredGameId);
  }
  [...getReplayGamesForRun(state.replayRunId)].reverse().forEach((game) => {
    if (game?.id && !candidateIds.includes(game.id)) {
      candidateIds.push(game.id);
    }
  });

  let lastNotFoundError = null;
  for (const gameId of candidateIds.slice(0, 8)) {
    try {
      await loadReplayGame(gameId);
      return true;
    } catch (err) {
      if (err?.status !== 404) {
        throw err;
      }
      lastNotFoundError = err;
    }
  }

  if (lastNotFoundError) {
    replayWorkbench.clear();
    setReplayControlsEnabled(false);
    els.replayMeta.textContent = 'Replay payloads are still syncing for the newest retained games.';
  }
  return false;
}

function renderTestSelectors() {
  if (!els.testPromotedBotList) return;
  const items = Array.isArray(state.promotedBots) ? state.promotedBots : [];
  els.testPromotedBotList.innerHTML = '';
  if (!items.length) {
    els.testPromotedBotList.innerHTML = '<div class="subtle">No promoted models are available yet.</div>';
    if (els.savePromotedBotsBtn) {
      els.savePromotedBotsBtn.disabled = true;
    }
    renderTestSelectionMeta();
    return;
  }

  items.forEach((item) => {
    const row = document.createElement('label');
    row.className = 'test-bot-item';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = item?.enabled === true;
    checkbox.dataset.promotedBotId = String(item?.id || '');

    const copy = document.createElement('div');
    copy.className = 'test-bot-copy';

    const title = document.createElement('div');
    title.className = 'test-bot-title';
    title.textContent = item?.label || item?.id || 'Promoted model';

    const meta = document.createElement('div');
    meta.className = 'test-bot-meta';
    meta.textContent = [
      item?.runLabel ? `${item.runLabel}` : '',
      Number.isFinite(Number(item?.generation)) ? `G${Number(item.generation)}` : '',
      item?.isBest ? 'best generation' : '',
      item?.promotedAt ? `promoted ${formatDate(item.promotedAt)}` : '',
    ].filter(Boolean).join(' | ');

    copy.appendChild(title);
    if (meta.textContent) {
      copy.appendChild(meta);
    }
    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'secondary';
    renameButton.textContent = 'Rename';
    renameButton.dataset.renameModel = 'true';
    renameButton.dataset.runId = String(item?.runId || '');
    renameButton.dataset.generation = String(item?.generation ?? '');
    renameButton.dataset.currentLabel = String(item?.label || '');
    row.appendChild(checkbox);
    row.appendChild(copy);
    row.appendChild(renameButton);
    els.testPromotedBotList.appendChild(row);
  });

  if (els.savePromotedBotsBtn) {
    els.savePromotedBotsBtn.disabled = state.savingPromotedBots;
  }
  renderTestSelectionMeta();
}

function renderTestSelectionMeta() {
  if (!els.testSelectionMeta) return;
  const total = Array.isArray(state.promotedBots) ? state.promotedBots.length : 0;
  if (!total) {
    els.testSelectionMeta.textContent = 'No promoted models are available yet.';
    return;
  }
  const inputs = Array.from(els.testPromotedBotList?.querySelectorAll('input[data-promoted-bot-id]') || []);
  const enabledCount = inputs.length
    ? inputs.filter((input) => input.checked).length
    : state.promotedBots.filter((item) => item?.enabled).length;
  els.testSelectionMeta.textContent = `${enabledCount} of ${total} promoted models will appear in the public bot dropdown.`;
}

async function ensureRunDetail(runId, { force = false } = {}) {
  if (!runId) return null;
  if (!force && state.runDetailsById.has(runId)) {
    return state.runDetailsById.get(runId);
  }
  const detail = await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}`);
  state.runDetailsById.set(runId, detail);
  mergeRunSummary(detail);
  return detail;
}

async function loadReplayGames({ autoLoadLatest = true, force = false } = {}) {
  const runId = state.replayRunId || '';
  const hasCachedList = state.replayGamesByRunId.has(runId);
  if (!runId) {
    state.replayGamesLoad = null;
    state.replayGames = [];
    state.selectedReplayGameId = '';
    state.replayGamesError = '';
    renderReplaySelectors();
    renderReplaySelectionMeta();
    renderReplayGameList();
    return [];
  }

  if (hasCachedList && !force) {
    state.replayGames = getReplayGamesForRun(runId);
    state.replayGamesError = '';
    state.replayGamesLoading = false;
    normalizeReplayGenerationFilter(runId);
    renderReplaySelectors();
    renderReplaySelectionMeta();
    renderReplayGameList();
    if (autoLoadLatest) {
      const targetGameId = state.selectedReplayGameId && state.replayGames.some((game) => game.id === state.selectedReplayGameId)
        ? state.selectedReplayGameId
        : (state.replayGames[state.replayGames.length - 1]?.id || '');
      if (targetGameId && getReplayLoadedGameId() !== targetGameId) {
        loadMostRecentAvailableReplay(targetGameId).catch((err) => setStatus(err.message, 'error'));
      }
    }
    return state.replayGames;
  }

  if (
    state.replayGamesLoad
    && state.replayGamesLoad.runId === runId
  ) {
    state.replayGamesLoad.autoLoadLatest = state.replayGamesLoad.autoLoadLatest || autoLoadLatest;
    return state.replayGamesLoad.promise;
  }

  const requestSeq = state.replayGamesRequestSeq + 1;
  state.replayGamesRequestSeq = requestSeq;
  state.replayGamesLoading = true;
  state.replayGamesError = '';
  renderReplaySelectionMeta();
  renderReplayGameList();
  const loadState = {
    runId,
    requestSeq,
    autoLoadLatest,
    promise: null,
  };
  loadState.promise = (async () => {
    let shouldAutoLoadLatest = false;
    let targetGameId = '';
    let fetchedGames = [];
    try {
      const items = await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/games`);
      shouldAutoLoadLatest = Boolean(loadState.autoLoadLatest);
      if (requestSeq !== state.replayGamesRequestSeq || runId !== state.replayRunId) {
        return [];
      }
      fetchedGames = sortReplayGamesChronologically(
        (Array.isArray(items?.items) ? items.items : [])
          .filter((game) => String(game?.phase || '').toLowerCase() === 'evaluation'),
      );
      state.replayGamesByRunId.set(runId, fetchedGames);
      state.replayGames = fetchedGames;
      state.replayGamesError = '';
      normalizeReplayGenerationFilter(runId);
      if (state.selectedReplayGameId && !state.replayGames.some((game) => game.id === state.selectedReplayGameId)) {
        state.selectedReplayGameId = '';
      }
      renderReplayGenerationFilter(runId);
      renderReplaySelectors();
      renderReplaySelectionMeta();
      if (state.replayGames.length && !state.selectedReplayGameId) {
        state.selectedReplayGameId = state.replayGames[state.replayGames.length - 1].id;
      }
      renderReplayGameList({ scrollToBottom: true });
      if (!state.replayGames.length) {
        replayWorkbench.clear();
        setReplayControlsEnabled(false);
        els.replayMeta.textContent = getReplayEmptyStateMessage(runId);
        return fetchedGames;
      }
      targetGameId = state.selectedReplayGameId || state.replayGames[state.replayGames.length - 1]?.id || '';
    } catch (err) {
      if (requestSeq === state.replayGamesRequestSeq && runId === state.replayRunId) {
        state.replayGamesError = err.message || 'Failed to load eval games.';
      }
      throw err;
    } finally {
      if (requestSeq === state.replayGamesRequestSeq && runId === state.replayRunId) {
        state.replayGamesLoading = false;
        renderReplaySelectionMeta();
        renderReplayGameList();
      }
      if (state.replayGamesLoad === loadState) {
        state.replayGamesLoad = null;
      }
    }

    if (!shouldAutoLoadLatest || !targetGameId) {
      return;
    }
    if (getReplayLoadedGameId() === targetGameId) {
      return fetchedGames;
    }
    loadMostRecentAvailableReplay(targetGameId).catch((err) => setStatus(err.message, 'error'));
    return fetchedGames;
  })();
  state.replayGamesLoad = loadState;
  return loadState.promise;
}

async function loadReplayGame(gameId = state.selectedReplayGameId) {
  const runId = state.replayRunId || '';
  if (!runId || !gameId) return;
  state.selectedReplayGameId = gameId;
  renderReplayGameList();
  const requestSeq = state.replayGameRequestSeq + 1;
  state.replayGameRequestSeq = requestSeq;
  setReplayLoading('Loading replay...');
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  const payload = await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/replay/${encodeURIComponent(gameId)}`);
  if (
    requestSeq !== state.replayGameRequestSeq
    || runId !== state.replayRunId
    || state.selectedReplayGameId !== gameId
  ) {
    return;
  }
  els.replayMeta.textContent = 'Rendering replay...';
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  replayWorkbench.setReplayPayload({
    ...payload,
    simulation: {
      participantALabel: payload?.game?.whiteParticipantLabel || `G${payload?.game?.whiteGeneration ?? '?'}`,
      participantBLabel: payload?.game?.blackParticipantLabel || `G${payload?.game?.blackGeneration ?? '?'}`,
    },
  });
  setReplayControlsEnabled(Boolean(payload?.game?.replay?.length));
  renderReplayGameList();
}

async function selectRun(runId, { syncReplay = false, forceDetail = false } = {}) {
  state.selectedRunId = runId || '';
  if (state.selectedRunId && (forceDetail || state.activeWorkflowTab === 'runs')) {
    await ensureRunDetail(state.selectedRunId, { force: forceDetail });
  }
  if (syncReplay) {
    state.replayRunId = state.selectedRunId;
    clearReplaySelection();
    if (state.activeWorkflowTab === 'replay' && state.replayRunId) {
      await loadReplayGames();
    }
  }
  renderRunsTable();
  renderSelectedRun();
  renderReplaySelectors();
}

async function refreshWorkbench({ silent = false, forceSelectedDetail = false } = {}) {
  if (!silent) setStatus('Refreshing ML run workbench...');
  const payload = await apiFetch('/api/v1/ml/workbench');
  applyDefaults(payload.defaults || {});
  state.seedSourceOptions = Array.isArray(payload?.seedSources?.items) && payload.seedSources.items.length
    ? payload.seedSources.items
    : buildBuiltinSeedSourceOptions();
  renderSeedSourceSelect();
  state.runs = sortRunsByRecent(Array.isArray(payload?.runs?.items) ? payload.runs.items : []);
  state.promotedBots = Array.isArray(payload?.promotedBots?.items) ? payload.promotedBots.items : [];
  applyResourceTelemetry(payload?.live?.resourceTelemetry || null, { render: false });
  state.liveRunsById.clear();
  (payload?.live?.runs || []).forEach((runPayload) => applyLiveRunPayload(runPayload, { render: false }));

  if (!state.selectedRunId && state.runs.length) {
    state.selectedRunId = state.runs[0].id;
  }
  if (
    state.selectedRunId
    && state.runs.some((run) => run.id === state.selectedRunId)
    && state.activeWorkflowTab === 'runs'
  ) {
    await ensureRunDetail(state.selectedRunId, { force: forceSelectedDetail });
  } else if (state.selectedRunId) {
    if (!state.runs.some((run) => run.id === state.selectedRunId)) {
      state.selectedRunId = '';
    }
  }

  if (!state.replayRunId && state.runs.length) {
    state.replayRunId = state.runs[0].id;
  }
  if (state.replayRunId && !state.runs.some((run) => run.id === state.replayRunId)) {
    state.replayRunId = '';
    clearReplaySelection();
  }
  if (state.activeWorkflowTab === 'replay' && state.replayRunId) {
    await loadReplayGames({ autoLoadLatest: true });
  }

  renderWorkbenchSummary();
  renderRunsTable();
  renderSelectedRun();
  renderReplaySelectors();
  renderTestSelectors();
  if (!silent) setStatus('ML run workbench ready.', 'ok');
}

function readRunConfigForm() {
  const seedSelection = parseSeedSourceSelection(els.seedModeSelect.value || 'bootstrap');
  const defaults = state.defaults || {};
  return {
    seedMode: seedSelection.seedMode,
    seedRunId: seedSelection.seedRunId,
    seedGeneration: seedSelection.seedGeneration,
    seed: parseNumberInput(els.seedInput, Number.NaN),
    numSelfplayWorkers: parseNumberInput(els.numSelfplayWorkersInput, defaults.numSelfplayWorkers || 32),
    numMctsSimulationsPerMove: parseNumberInput(els.numMctsSimulationsInput, 512),
    maxDepth: parseNumberInput(els.maxDepthInput, 64),
    hypothesisCount: parseNumberInput(els.hypothesisCountInput, 4),
    exploration: parseNumberInput(els.explorationInput, 1.5, true),
    replayBufferMaxPositions: parseNumberInput(els.replayBufferMaxPositionsInput, defaults.replayBufferMaxPositions || 100000),
    batchSize: parseNumberInput(els.batchSizeInput, defaults.batchSize || 256),
    learningRate: parseNumberInput(els.learningRateInput, 0.0005, true),
    weightDecay: parseNumberInput(els.weightDecayInput, 0.0001, true),
    gradientClipNorm: parseNumberInput(els.gradientClipNormInput, 1, true),
    trainingStepsPerCycle: parseNumberInput(els.trainingStepsPerCycleInput, defaults.trainingStepsPerCycle || 32),
    parallelTrainingHeadWorkers: parseNumberInput(els.parallelTrainingHeadWorkersInput, 3),
    checkpointInterval: parseNumberInput(els.checkpointIntervalInput, defaults.checkpointInterval || 200),
    prePromotionTestGames: parseNumberInput(els.prePromotionTestGamesInput, 40),
    prePromotionTestWinRate: parseNumberInput(els.prePromotionTestWinRateInput, 0.6, true),
    promotionTestGames: parseNumberInput(els.promotionTestGamesInput, 100),
    promotionTestWinRate: parseNumberInput(els.promotionTestWinRateInput, 0.55, true),
    promotionTestPriorGenerations: parseNumberInput(els.promotionTestPriorGenerationsInput, 3),
    olderGenerationSampleProbability: parseNumberInput(els.olderGenerationSampleProbabilityInput, 0.10, true),
    maxFailedPromotions: parseNumberInput(els.maxFailedPromotionsInput, 50),
  };
}

async function renamePromotedModel(runId, generation, currentLabel = '') {
  if (!runId || !Number.isFinite(Number(generation))) return;
  const nextLabel = window.prompt('Rename promoted model', currentLabel || '');
  if (nextLabel === null) return;
  const trimmed = nextLabel.trim();
  if (!trimmed) {
    setStatus('Model name cannot be empty.', 'warn');
    return;
  }
  await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/generations/${encodeURIComponent(generation)}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: trimmed }),
  });
  await refreshWorkbench({ silent: true, forceSelectedDetail: true });
  setStatus(`Renamed promoted model to ${trimmed}.`, 'ok');
}

async function startRun() {
  els.startRunBtn.disabled = true;
  setActiveWorkflowTab('runs');
  setStatus('Starting ML run...');
  let payload = null;
  try {
    payload = readRunConfigForm();
    if (!Number.isFinite(payload.seed)) delete payload.seed;
    let result;
    try {
      result = await apiFetch('/api/v1/ml/runs', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err) {
      if (err?.status === 409 && err?.message && /already active|did not stop in time/i.test(err.message)) {
        const shouldPauseOthers = window.confirm('Another run is active. Pause other runs before starting this one?');
        if (!shouldPauseOthers) {
          setStatus('Start cancelled.', 'warn');
          return;
        }
        result = await apiFetch('/api/v1/ml/runs', {
          method: 'POST',
          body: JSON.stringify({
            ...payload,
            forceStopOtherRuns: true,
          }),
        });
      } else {
        throw err;
      }
    }
    if (result?.live) applyLiveRunPayload(result.live);
    await refreshWorkbench({ silent: true, forceSelectedDetail: true });
    if (result?.run?.id) {
      await selectRun(result.run.id, { syncReplay: true, forceDetail: true });
    }
    setStatus(`Run started: ${result?.run?.label || result?.run?.id || 'accepted'}.`, 'ok');
  } catch (error) {
    logMlAdminError('Failed to start run', error, {
      requestPayload: payload,
    });
    setStatus(error?.message || 'Failed to start ML run.', 'error');
    throw error;
  } finally {
    els.startRunBtn.disabled = false;
  }
}

async function stopSelectedRun() {
  if (!state.selectedRunId) return;
  return stopRunById(state.selectedRunId);
}

async function stopRunById(runId) {
  if (!runId) return;
  await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/stop`, {
    method: 'POST',
  });
  setStatus(`Stop requested for ${runId}.`, 'ok');
  await refreshWorkbench({ silent: true, forceSelectedDetail: true });
}

async function continueSelectedRun() {
  if (!state.selectedRunId) return;
  return continueRunById(state.selectedRunId);
}

async function killSelectedRun() {
  if (!state.selectedRunId) return;
  return killRunById(state.selectedRunId);
}

async function killRunById(runId) {
  if (!runId) return;
  const run = getRunData(runId);
  const label = run?.label || runId;
  const shouldKill = window.confirm(`Kill run "${label}" immediately? The latest unsaved in-flight work may be discarded.`);
  if (!shouldKill) {
    return;
  }
  await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/kill`, {
    method: 'POST',
  });
  setStatus(`Run killed: ${label}.`, 'ok');
  await refreshWorkbench({ silent: true, forceSelectedDetail: true });
}

async function continueRunById(runId) {
  if (!runId) return;
  const run = getRunData(runId);
  if (!run?.canContinue) {
    setStatus('This run does not have resumable state saved, so it cannot be continued.', 'warn');
    return;
  }
  let result;
  try {
    result = await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/continue`, {
      method: 'POST',
    });
  } catch (err) {
    if (err?.status === 409 && err?.message && /already active|did not stop in time/i.test(err.message)) {
      const shouldPauseOthers = window.confirm('Another run is active. Pause other runs before continuing this one?');
      if (!shouldPauseOthers) {
        setStatus('Continue cancelled.', 'warn');
        return;
      }
      result = await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/continue`, {
        method: 'POST',
        body: JSON.stringify({ forceStopOtherRuns: true }),
      });
    } else {
      throw err;
    }
  }
  if (result?.live) applyLiveRunPayload(result.live);
  await refreshWorkbench({ silent: true, forceSelectedDetail: true });
  await selectRun(runId, { syncReplay: false, forceDetail: true });
  setStatus(`Run continued: ${result?.run?.label || result?.run?.id || runId}.`, 'ok');
}

async function deleteSelectedRun() {
  const run = getSelectedRunData();
  return deleteRunById(run?.id || '');
}

async function deleteRunById(runId) {
  const run = runId ? getRunData(runId) : null;
  if (!run?.id) return;
  const status = String(run.status || '').toLowerCase();
  if (['running', 'stopping'].includes(status)) {
    setStatus('Cancel the run before deleting it.', 'warn');
    return;
  }
  const label = run.label || run.id;
  if (!window.confirm(`Delete run "${label}"?`)) {
    return;
  }
  await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(run.id)}`, {
    method: 'DELETE',
  });
  removeRunFromState(run.id);
  await refreshWorkbench({ silent: true, forceSelectedDetail: false });
  if (!state.replayRunId) {
    clearReplaySelection();
    renderReplayGameList();
  }
  setStatus(`Deleted run: ${label}.`, 'ok');
}

async function savePromotedBots() {
  const enabledIds = Array.from(els.testPromotedBotList?.querySelectorAll('input[data-promoted-bot-id]:checked') || [])
    .map((input) => String(input.dataset.promotedBotId || ''))
    .filter(Boolean);

  state.savingPromotedBots = true;
  if (els.savePromotedBotsBtn) {
    els.savePromotedBotsBtn.disabled = true;
  }
  setStatus('Saving promoted bot dropdown...');
  try {
    const result = await apiFetch('/api/v1/ml/promoted-bots', {
      method: 'PUT',
      body: JSON.stringify({ enabledIds }),
    });
    state.promotedBots = Array.isArray(result?.items) ? result.items : [];
    renderTestSelectors();
    setStatus(`Updated bot dropdown: ${enabledIds.length} promoted model${enabledIds.length === 1 ? '' : 's'} enabled.`, 'ok');
  } finally {
    state.savingPromotedBots = false;
    if (els.savePromotedBotsBtn) {
      els.savePromotedBotsBtn.disabled = false;
    }
  }
}

async function refreshSelectedRunDetailIfActive() {
  if (state.activeWorkflowTab !== 'runs') return;
  const run = getRunSummary(state.selectedRunId);
  if (!run || !['running', 'stopping'].includes(String(run.status || '').toLowerCase())) return;
  await ensureRunDetail(state.selectedRunId, { force: true });
  renderSelectedRun();
  if (state.replayRunId === state.selectedRunId) {
    renderReplaySelectors();
  }
}

async function loadLiveStatus() {
  const live = await apiFetch('/api/v1/ml/live');
  applyResourceTelemetry(live?.resourceTelemetry || null, { render: false });
  (live?.runs || []).forEach((payload) => applyLiveRunPayload(payload));
  renderResourceTelemetry();
}

function connectAdminSocket() {
  if (typeof io !== 'function' || state.adminSocketDisabled) return;
  if (state.adminSocket) return state.adminSocket;
  const socket = io(`${window.location.origin.replace(/\/$/, '')}/admin`, {
    withCredentials: true,
    timeout: 5000,
    reconnection: true,
    reconnectionAttempts: 2,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 5000,
  });
  state.adminSocket = socket;

  const disableSocket = () => {
    state.adminSocketDisabled = true;
    if (state.adminSocket) {
      state.adminSocket.removeAllListeners();
      state.adminSocket.close();
      state.adminSocket = null;
    }
  };

  socket.on('connect', () => {
    setStatus('Live updates connected.', 'ok');
  });

  socket.on('connect_error', (err) => {
    const statusCode = Number(
      err?.description?.status
      || err?.context?.status
      || err?.data?.status
      || 0
    );
    const message = String(err?.message || '').toLowerCase();
    const shouldDisable = statusCode === 400
      || statusCode === 401
      || statusCode === 403
      || /xhr poll error|unauthorized|forbidden|invalid namespace/.test(message);
    if (!shouldDisable) {
      return;
    }
    disableSocket();
  });

  socket.on('disconnect', (reason) => {
    if (reason === 'io server disconnect') {
      disableSocket();
    }
  });

  socket.on('ml:runProgress', (payload) => {
    applyLiveRunPayload(payload);
    const phase = String(payload?.phase || '').toLowerCase();
    const isPartialEvaluationUpdate = phase === 'evaluation' && payload?.evaluationProgress?.active;
    if (phase === 'error') {
      logMlAdminError('Run progress reported an error', null, {
        runId: payload?.runId || null,
        label: payload?.label || null,
        phase,
        status: payload?.status || null,
        stopReason: payload?.stopReason || null,
        lastError: payload?.lastError || null,
      });
      setStatus(`Run failed: ${payload?.message || payload?.stopReason || payload?.runId || 'unknown error'}.`, 'error');
    }
    if (payload?.runId && (phase === 'evaluation' || phase === 'promotion' || phase === 'complete' || phase === 'error')) {
      if (state.replayRunId === payload.runId) {
        scheduleReplayGamesRefresh(payload.runId, phase === 'evaluation' ? 450 : 900);
      }
      if (isPartialEvaluationUpdate) {
        return;
      }
      ensureRunDetail(payload.runId, { force: true })
        .then(() => {
          renderSelectedRun();
          if (state.replayRunId === payload.runId) {
            renderReplaySelectors();
          }
        })
        .catch(() => {});
    }
  });
  return socket;
}

function startPolling() {
  if (!state.livePollHandle) {
    state.livePollHandle = window.setInterval(() => {
      loadLiveStatus()
        .then(() => refreshSelectedRunDetailIfActive())
        .catch(() => {});
    }, LIVE_POLL_MS);
  }
  if (!state.workbenchPollHandle) {
    state.workbenchPollHandle = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      refreshWorkbench({ silent: true }).catch(() => {});
    }, WORKBENCH_POLL_MS);
  }
  if (!state.uiClockHandle) {
    state.uiClockHandle = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (state.selectedRunId) renderSelectedRun();
      if (state.replayRunId) renderReplaySelectionMeta();
    }, UI_CLOCK_MS);
  }
}

async function hydrateActiveWorkflowTab() {
  if (state.activeWorkflowTab === 'runs') {
    if (!state.selectedRunId && state.runs.length) {
      state.selectedRunId = state.runs[0].id;
    }
    if (state.selectedRunId) {
      await ensureRunDetail(state.selectedRunId, { force: false });
    }
    renderRunsTable();
    renderSelectedRun();
    return;
  }
  if (state.activeWorkflowTab === 'replay') {
    if (!state.replayRunId && state.runs.length) {
      state.replayRunId = state.runs[0].id;
    }
    if (state.replayRunId) {
      await ensureRunDetail(state.replayRunId, { force: false });
    }
    renderReplaySelectors();
    await loadReplayGames({ autoLoadLatest: true });
    return;
  }
  if (state.activeWorkflowTab === 'test') {
    renderTestSelectors();
  }
}

function bindEvents() {
  workflowTabs.forEach((button) => {
    button.addEventListener('click', () => setActiveWorkflowTab(button.dataset.workflowTab || 'config'));
  });
  els.refreshWorkbenchBtn?.addEventListener('click', () => refreshWorkbench().catch((err) => setStatus(err.message, 'error')));
  els.startRunBtn?.addEventListener('click', () => startRun().catch((err) => setStatus(err.message, 'error')));
  els.stopRunBtn?.addEventListener('click', () => stopSelectedRun().catch((err) => setStatus(err.message, 'error')));
  els.killRunBtn?.addEventListener('click', () => killSelectedRun().catch((err) => setStatus(err.message, 'error')));
  els.continueRunBtn?.addEventListener('click', () => continueSelectedRun().catch((err) => setStatus(err.message, 'error')));
  els.deleteRunBtn?.addEventListener('click', () => deleteSelectedRun().catch((err) => setStatus(err.message, 'error')));

  els.runsTableBody?.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-run-action]');
    if (actionButton) {
      event.stopPropagation();
      const runId = actionButton.dataset.runId || '';
      if (actionButton.dataset.runAction === 'cancel') {
        stopRunById(runId).catch((err) => setStatus(err.message, 'error'));
      } else if (actionButton.dataset.runAction === 'continue') {
        continueRunById(runId).catch((err) => setStatus(err.message, 'error'));
      } else if (actionButton.dataset.runAction === 'delete') {
        deleteRunById(runId).catch((err) => setStatus(err.message, 'error'));
      }
      return;
    }
    const row = event.target.closest('[data-run-id]');
    if (!row) return;
    selectRun(row.dataset.runId || '', { syncReplay: false }).catch((err) => setStatus(err.message, 'error'));
  });

  els.replayRunSelect?.addEventListener('change', async () => {
    state.replayRunId = els.replayRunSelect.value || '';
    clearReplaySelection();
    loadReplayGames({ autoLoadLatest: true }).catch((err) => setStatus(err.message, 'error'));
  });
  els.replayGenerationFilterSelect?.addEventListener('change', () => {
    state.replayGenerationFilter = els.replayGenerationFilterSelect.value || '';
    renderReplaySelectionMeta();
    renderReplayGameList();
  });
  els.replayListTopBtn?.addEventListener('click', () => scrollReplayListTo('top'));
  els.replayListBottomBtn?.addEventListener('click', () => scrollReplayListTo('bottom'));

  els.testPromotedBotList?.addEventListener('change', () => {
    renderTestSelectionMeta();
  });
  els.testPromotedBotList?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-rename-model]');
    if (!button) return;
    event.preventDefault();
    renamePromotedModel(
      button.dataset.runId || '',
      Number.parseInt(button.dataset.generation || '', 10),
      button.dataset.currentLabel || '',
    ).catch((err) => setStatus(err.message, 'error'));
  });
  els.savePromotedBotsBtn?.addEventListener('click', () => {
    savePromotedBots().catch((err) => setStatus(err.message, 'error'));
  });

  els.replayGameList?.addEventListener('click', (event) => {
    const row = event.target.closest('[data-game-id]');
    if (!row) return;
    loadReplayGame(row.dataset.gameId || '').catch((err) => setStatus(err.message, 'error'));
  });
  els.replayPlayPauseBtn?.addEventListener('click', () => replayWorkbench.togglePlayback());
  els.replayPrevBtn?.addEventListener('click', () => {
    replayWorkbench.stopPlayback();
    replayWorkbench.step(-1);
  });
  els.replayNextBtn?.addEventListener('click', () => {
    replayWorkbench.stopPlayback();
    replayWorkbench.step(1);
  });
  els.replaySpeedSelect?.addEventListener('change', () => replayWorkbench.setSpeed(Number.parseInt(els.replaySpeedSelect.value, 10) || 600));
  els.replayRange?.addEventListener('input', () => {
    replayWorkbench.stopPlayback();
    replayWorkbench.renderFrame(Number.parseInt(els.replayRange.value, 10) || 0);
  });

  window.addEventListener('resize', () => {
    generationWinChart.redraw();
    cpuUsageChart.redraw();
    gpuUsageChart.redraw();
    if (replayWorkbench.getReplayPayload()?.game?.replay?.length) {
      replayWorkbench.renderFrame(Number.parseInt(els.replayRange?.value || '0', 10) || 0);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    loadLiveStatus().catch(() => {});
    refreshWorkbench({ silent: true }).catch(() => {});
  });
}

async function boot() {
  connectAdminSocket();
  bindEvents();
  applyFieldTooltips();
  await refreshWorkbench({ silent: false, forceSelectedDetail: false });
  setActiveWorkflowTab(state.activeWorkflowTab);
  startPolling();
}

boot().catch((err) => setStatus(err.message || 'Failed to initialize ML run workbench.', 'error'));
