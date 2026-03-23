import { createGenerationWinChart } from '/js/modules/mlAdmin/generationWinChart.js';
import { createReplayWorkbench } from '/js/modules/mlAdmin/replay.js';
import { createResourceUsageChart } from '/js/modules/mlAdmin/resourceUsageChart.js';

const workflowTabs = Array.from(document.querySelectorAll('[data-workflow-tab]'));
const workflowPanels = Array.from(document.querySelectorAll('[data-workflow-panel]'));
const LIVE_POLL_MS = 2000;
const WORKBENCH_POLL_MS = 30000;
const UI_CLOCK_MS = 1000;
const ACTIVE_RUN_DETAIL_REFRESH_MS = 15000;
const ACTIVE_WORKFLOW_TAB_STORAGE_KEY = 'mlAdminActiveWorkflowTab';

function loadStoredWorkflowTab() {
  try {
    const stored = window.localStorage?.getItem(ACTIVE_WORKFLOW_TAB_STORAGE_KEY) || '';
    return ['config', 'runs', 'replay', 'test'].includes(stored) ? stored : 'config';
  } catch (_) {
    return 'config';
  }
}

function persistWorkflowTab(tab) {
  try {
    window.localStorage?.setItem(ACTIVE_WORKFLOW_TAB_STORAGE_KEY, tab);
  } catch (_) {}
}

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
  modelSizePresetSelect: document.getElementById('modelSizePresetSelect'),
  seedInput: document.getElementById('seedInput'),
  maxLogicalProcessorsInput: document.getElementById('maxLogicalProcessorsInput'),
  numSelfplayWorkersInput: document.getElementById('numSelfplayWorkersInput'),
  curriculumCadenceInput: document.getElementById('curriculumCadenceInput'),
  parallelGameWorkersInput: document.getElementById('parallelGameWorkersInput'),
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
  selectedRunRuntime: document.getElementById('selectedRunRuntime'),
  selectedRunLabel: document.getElementById('selectedRunLabel'),
  selectedRunMeta: document.getElementById('selectedRunMeta'),
  selectedRunStats: document.getElementById('selectedRunStats'),
  selectedRunGenerations: document.getElementById('selectedRunGenerations'),
  selectedRunDiagnostics: document.getElementById('selectedRunDiagnostics'),
  selectedRunConfigMeta: document.getElementById('selectedRunConfigMeta'),
  selectedRunConfigBody: document.getElementById('selectedRunConfigBody'),
  generationWinCanvas: document.getElementById('generationWinCanvas'),
  generationWinTooltip: document.getElementById('generationWinTooltip'),
  generationWinLegend: document.getElementById('generationWinLegend'),

  replayRunSelect: document.getElementById('replayRunSelect'),
  replayTypeSelect: document.getElementById('replayTypeSelect'),
  replayGenerationFilterGroup: document.getElementById('replayGenerationFilterGroup'),
  replayGenerationFilterSelect: document.getElementById('replayGenerationFilterSelect'),
  replayBoardPiecesFilterGroup: document.getElementById('replayBoardPiecesFilterGroup'),
  replayBoardPiecesFilterSelect: document.getElementById('replayBoardPiecesFilterSelect'),
  replayAdvanceDepthFilterGroup: document.getElementById('replayAdvanceDepthFilterGroup'),
  replayAdvanceDepthFilterSelect: document.getElementById('replayAdvanceDepthFilterSelect'),
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
  activeWorkflowTab: loadStoredWorkflowTab(),
  selectedRunId: '',
  seedSourceOptions: [],
  replayRunId: '',
  promotedBots: [],
  replayGameType: 'evaluation',
  replayGenerationFilter: '',
  replayBoardPiecesFilter: '',
  replayAdvanceDepthFilter: '',
  replayGames: [],
  replayGamesByRunId: new Map(),
  selectedReplayGameId: '',
  replayGamesRequestSeq: 0,
  replayGameRequestSeq: 0,
  replayRefreshHandle: null,
  replayGamesLoad: null,
  replayGamesLoading: false,
  replayGamesError: '',
  replayPayloadCache: new Map(),
  savingPromotedBots: false,
  apiBaseOrigin: '',
  adminSocket: null,
  adminSocketOrigin: '',
  adminSocketDisabled: false,
  livePollHandle: null,
  workbenchPollHandle: null,
  uiClockHandle: null,
  liveRenderQueued: false,
  runDetailRefreshedAtMs: new Map(),
};

const fieldHelpTextById = {
  seedModeSelect: 'Choose whether to start from the preferred bootstrap baseline, a fresh random model, or a promoted generation from an existing run.',
  modelSizePresetSelect: 'Choose the shared-encoder parameter budget for new bootstrap or random runs. Smaller presets are much faster and leave more CPU headroom, while published run names still use the exact live parameter count.',
  seedInput: 'Optional random seed for reproducible model initialization and self-play ordering.',
  numSelfplayWorkersInput: 'How many fresh self-play games to generate per training cycle. Keep this at or above the CPU worker count to avoid starving the worker pool.',
  curriculumCadenceInput: 'How many self-play games it takes to advance one curriculum rung. At 100, the setup bias moves one quarter of the way every 100 self-play games while still keeping some corner exploration.',
  parallelGameWorkersInput: 'How many self-play or evaluation games may run at once. Higher values use more CPU and improve throughput until system responsiveness becomes the limit.',
  maxLogicalProcessorsInput: 'Top-level ML CPU budget. Game worker concurrency and CPU-side trainer threading will not exceed this logical-processor cap.',
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
  checkpointIntervalInput: 'Create an evaluation checkpoint every N training steps. Higher values reduce evaluation interruptions.',
  prePromotionTestGamesInput: 'Stage 1 gate: games against the current baseline generation before any promotion lineage tests run.',
  prePromotionTestWinRateInput: 'Stage 1 gate: required baseline win rate before promotion lineage tests can start.',
  promotionTestGamesInput: 'Stage 2 gate: games per matchup against the most recent promoted generations, falling back to the baseline generation when the lineage is shorter.',
  promotionTestWinRateInput: 'Stage 2 gate: required win rate in each promotion-lineage matchup.',
  promotionTestPriorGenerationsInput: 'How many sequential promotion-lineage checks to run after the baseline gate passes.',
  olderGenerationSampleProbabilityInput: 'Chance that self-play mixes in an older approved generation instead of mirroring the worker generation.',
  maxFailedPromotionsInput: 'Stop after this many consecutive failed promotions.',
};

const selectedRunConfigFields = [
  { key: 'seedMode', label: 'Seed Model' },
  { key: 'seedRunId', label: 'Seed Run' },
  { key: 'seedGeneration', label: 'Seed Generation' },
  { key: 'seed', label: 'Seed' },
  { key: 'modelSizePreset', label: 'Model Size' },
  { key: 'maxLogicalProcessors', label: 'Max Logical Processors' },
  { key: 'numSelfplayWorkers', label: 'Self-Play Games / Cycle' },
  { key: 'curriculumCadence', label: 'Curriculum Cadence' },
  { key: 'parallelGameWorkers', label: 'Game Worker Concurrency' },
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
  { key: 'checkpointInterval', label: 'Checkpoint Interval' },
  { key: 'prePromotionTestGames', label: 'Baseline Test Games' },
  { key: 'prePromotionTestWinRate', label: 'Baseline Test Win Rate' },
  { key: 'promotionTestGames', label: 'Promotion Test Games' },
  { key: 'promotionTestWinRate', label: 'Promotion Test Win Rate' },
  { key: 'promotionTestPriorGenerations', label: 'Promotion Test Prior Generations' },
  { key: 'olderGenerationSampleProbability', label: 'Older Gen Mix Probability' },
  { key: 'maxFailedPromotions', label: 'Failed Promotion Cap' },
];

const hiddenSelectedRunConfigKeys = new Set([
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
const REPLAY_LIST_PAGE_LIMIT = 100;
const REPLAY_PAYLOAD_CACHE_LIMIT = 8;

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
  const totalSeconds = totalMs / 1000;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds - (hours * 3600) - (minutes * 60);
  const formattedSeconds = seconds.toFixed(1).padStart(4, '0');
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${formattedSeconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${formattedSeconds}s`;
  }
  if (totalSeconds >= 1) {
    return `${totalSeconds.toFixed(1)}s`;
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

function formatConcurrency(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '--';
  return numeric.toFixed(1);
}

function formatRate(value, { decimals = 1, signed = false } = {}) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '--';
  const prefix = signed ? (numeric >= 0 ? '+' : '') : '';
  return `${prefix}${numeric.toFixed(decimals)}`;
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

function formatOptionalNumber(value) {
  return Number.isFinite(Number(value)) ? formatNumber(value) : '--';
}

function formatOptionalDecimal(value, maximumFractionDigits = 2) {
  return Number.isFinite(Number(value)) ? formatDecimal(value, maximumFractionDigits) : '--';
}

function formatConditionalPercent(value, enabled = true) {
  return enabled ? formatPercent(value) : '--';
}

function renderSelectedRunDiagnostics(diagnostics) {
  if (!diagnostics) {
    return '<div class="subtle">No diagnostics yet.</div>';
  }
  const sampleWindow = diagnostics.sampleWindow || {};
  const openings = diagnostics.openings || {};
  const actions = diagnostics.actions || {};
  const legalCounts = actions.legalCounts || {};
  const chosenCounts = actions.chosenCounts || {};
  const replayTargets = diagnostics.replayTargets || {};
  const latestBatch = replayTargets.latestBatch || null;
  const policyCoverage = actions.policyCoverage || {};
  const evaluation = diagnostics.evaluation || {};
  const checks = Array.isArray(diagnostics.checks) ? diagnostics.checks : [];
  const cards = [
    {
      label: 'Setup Variety',
      value: `${formatNumber(openings.uniqueStartingSetups || 0)} / ${formatNumber(openings.sampleGames || 0)}`,
      subvalue: [
        `Top ${formatPercent(openings?.mostCommonStartingSetup?.share || 0)}`,
        `Source ${String(sampleWindow.sourcePhase || 'selfplay')}`,
      ].join(' | '),
    },
    {
      label: 'First Move Variety',
      value: `${formatNumber(openings.uniqueFirstMoves || 0)} / ${formatNumber(openings.sampleGames || 0)}`,
      subvalue: [
        `Top ${formatPercent(openings?.mostCommonFirstMove?.share || 0)}`,
        `2-ply ${formatNumber(openings.uniqueOpeningTwoPlyPrefixes || 0)}/${formatNumber(openings.sampleGames || 0)}`,
      ].join(' | '),
    },
    {
      label: 'Opening Prefixes',
      value: `${formatNumber(openings.uniqueOpeningPrefixes || 0)} / ${formatNumber(openings.sampleGames || 0)}`,
      subvalue: [
        `Top ${formatPercent(openings?.mostCommonOpeningPrefix?.share || 0)}`,
        `Full seq ${formatNumber(openings.uniqueFullSequences || 0)}/${formatNumber(openings.sampleGames || 0)}`,
      ].join(' | '),
    },
    {
      label: 'Simple Actions',
      value: `C/B/P/O ${formatNumber(legalCounts.challenge || 0)}/${formatNumber(legalCounts.bomb || 0)}/${formatNumber(legalCounts.pass || 0)}/${formatNumber(legalCounts.onDeck || 0)}`,
      subvalue: `Chosen ${formatNumber(chosenCounts.challenge || 0)}/${formatNumber(chosenCounts.bomb || 0)}/${formatNumber(chosenCounts.pass || 0)}/${formatNumber(chosenCounts.onDeck || 0)}`,
    },
    {
      label: 'Choice When Legal',
      value: `C ${formatConditionalPercent(actions?.choiceRatesWhenLegal?.challenge || 0, Number(legalCounts.challenge || 0) > 0)} | B ${formatConditionalPercent(actions?.choiceRatesWhenLegal?.bomb || 0, Number(legalCounts.bomb || 0) > 0)}`,
      subvalue: `P ${formatConditionalPercent(actions?.choiceRatesWhenLegal?.pass || 0, Number(legalCounts.pass || 0) > 0)} | O ${formatConditionalPercent(actions?.choiceRatesWhenLegal?.onDeck || 0, Number(legalCounts.onDeck || 0) > 0)}`,
    },
    {
      label: 'Policy Coverage',
      value: formatConditionalPercent(policyCoverage.mappedActionShare || 0, Number(policyCoverage.decisions || 0) > 0),
      subvalue: [
        `Fallback ${formatNumber(actions.fallbackCount || 0)}`,
        `Unmapped ${formatNumber(policyCoverage.unmappedLegalActions || 0)}`,
      ].join(' | '),
    },
    {
      label: 'Replay Targets',
      value: `P/V/I ${formatOptionalNumber(replayTargets.policySamples)}/${formatOptionalNumber(replayTargets.valueSamples)}/${formatOptionalNumber(replayTargets.identitySamples)}`,
      subvalue: latestBatch
        ? `Batch ${formatNumber(latestBatch.policySamples || 0)}/${formatNumber(latestBatch.valueSamples || 0)}/${formatNumber(latestBatch.identitySamples || 0)}`
        : `V/P ${formatOptionalDecimal(replayTargets.valueToPolicyRatio, 2)} | I/P ${formatOptionalDecimal(replayTargets.identityToPolicyRatio, 2)}`,
    },
    {
      label: 'Latest Eval',
      value: evaluation.hasLatestEvaluation ? `${formatNumber(evaluation.latestGames || 0)} games` : '--',
      subvalue: evaluation.hasLatestEvaluation ? `Win ${formatPercent(evaluation.latestWinRate || 0)}` : 'No completed eval yet',
    },
  ];
  const checkRows = checks.length
    ? checks.map((check) => `
      <div class="diagnostic-check ${escapeHtml(String(check.severity || 'info').toLowerCase())}">
        <div class="k">${escapeHtml(`${String(check.severity || 'info').toUpperCase()} | ${humanizeConfigKey(check.code || 'check')}`)}</div>
        <div class="v">${escapeHtml(check.message || '')}</div>
      </div>
    `).join('')
    : `
      <div class="diagnostic-check">
        <div class="k">Checks</div>
        <div class="v">No diagnostic warnings in the current window.</div>
      </div>
    `;
  return `
    <div class="subtle">Diagnostics window: ${formatNumber(sampleWindow.analyzedGames || 0)} recent ${escapeHtml(sampleWindow.sourcePhase || 'selfplay')} game(s), with ${formatNumber(sampleWindow.selfPlayGames || 0)} retained self-play and ${formatNumber(sampleWindow.evaluationGames || 0)} retained eval games available.</div>
    <div class="run-stat-grid">
      ${cards.map((entry) => `
        <div class="run-stat">
          <div class="k">${escapeHtml(entry.label)}</div>
          <div class="v">${escapeHtml(entry.value)}</div>
          ${entry.subvalue ? `<div class="subv">${escapeHtml(entry.subvalue)}</div>` : ''}
        </div>
      `).join('')}
    </div>
    <div class="diagnostic-check-list">${checkRows}</div>
  `;
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
    averageSelfPlayConcurrency: Number(live?.averageSelfPlayConcurrency ?? run.averageSelfPlayConcurrency ?? 0),
    averageEvaluationConcurrency: Number(live?.averageEvaluationConcurrency ?? run.averageEvaluationConcurrency ?? 0),
    averageSelfPlayNetDurationMs: Number(live?.averageSelfPlayNetDurationMs ?? run.averageSelfPlayNetDurationMs ?? 0),
    averageEvaluationNetDurationMs: Number(live?.averageEvaluationNetDurationMs ?? run.averageEvaluationNetDurationMs ?? 0),
    averageTrainingStepDurationMs: Number(live?.averageTrainingStepDurationMs ?? run.averageTrainingStepDurationMs ?? 0),
    averageMctsSearchDurationMs: Number(
      live?.averageMctsSearchDurationMs
      ?? live?.selfPlayProgress?.averageMctsSearchDurationMs
      ?? run.averageMctsSearchDurationMs
      ?? 0
    ),
    averageForwardPassDurationMs: Number(
      live?.averageForwardPassDurationMs
      ?? live?.selfPlayProgress?.averageForwardPassDurationMs
      ?? run.averageForwardPassDurationMs
      ?? 0
    ),
    elapsedMs: Number(live?.elapsedMs ?? run.elapsedMs ?? getRunElapsedMs(run, live)),
  };
}

function getReplayBufferRateSnapshot(run, live = null, timing = null) {
  const replayBuffer = live?.replayBuffer || run?.replayBuffer || {};
  const totalPositionsSeen = Number(replayBuffer.totalPositionsSeen ?? 0);
  const selfPlayGames = Number(live?.totalSelfPlayGames ?? run?.totalSelfPlayGames ?? 0);
  const elapsedMs = Number(timing?.elapsedMs ?? getRunElapsedMs(run, live));
  const perSecond = elapsedMs > 0 ? (totalPositionsSeen / (elapsedMs / 1000)) : null;
  const perGame = selfPlayGames > 0 ? (totalPositionsSeen / selfPlayGames) : null;
  return {
    totalPositionsSeen,
    perSecond,
    perGame,
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

function getModelSizePresetOptions() {
  const presetOptions = Array.isArray(state.defaults?.modelSizePresetOptions)
    ? state.defaults.modelSizePresetOptions
    : [];
  if (presetOptions.length) {
    return presetOptions.map((item) => ({
      value: String(item.value || item.id || ''),
      label: item.label || String(item.value || item.id || '').toUpperCase(),
    })).filter((item) => item.value);
  }
  return [
    { value: '32k', label: '32K' },
    { value: '65k', label: '65K' },
    { value: '126k', label: '126K' },
    { value: '256k', label: '256K' },
    { value: '512k', label: '512K' },
  ];
}

function getSelectedModelSizePreset() {
  const fallback = String(state.defaults?.modelSizePreset || '32k');
  return String(els.modelSizePresetSelect?.value || fallback);
}

function getModelSizePresetDescriptor(selected = getSelectedModelSizePreset()) {
  const presetOptions = Array.isArray(state.defaults?.modelSizePresetOptions)
    ? state.defaults.modelSizePresetOptions
    : [];
  const option = presetOptions.find((item) => String(item.value || item.id || '') === String(selected));
  return option?.descriptor || `Shared-Encoder MLP (${String(selected || '').toUpperCase()} preset)`;
}

function buildBuiltinSeedSourceOptions() {
  const selectedDescriptor = getModelSizePresetDescriptor();
  return [
    { value: 'bootstrap', label: `Bootstrap ${selectedDescriptor}` },
    { value: 'random', label: `Random ${selectedDescriptor}` },
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
    label: ['bootstrap', 'random'].includes(String(item.value || '').toLowerCase())
      ? buildBuiltinSeedSourceOptions().find((builtin) => builtin.value === item.value)?.label || item.label
      : item.label,
  })), { preferredValue });
}

function renderModelSizePresetSelect(preferredValue = '') {
  fillSelect(els.modelSizePresetSelect, getModelSizePresetOptions(), {
    preferredValue: preferredValue || state.defaults?.modelSizePreset || '32k',
  });
}

function scheduleLiveRunRender() {
  if (state.liveRenderQueued) return;
  state.liveRenderQueued = true;
  window.requestAnimationFrame(() => {
    state.liveRenderQueued = false;
    renderWorkbenchSummary();
    if (state.activeWorkflowTab === 'runs') {
      renderRunsTable();
      renderSelectedRun();
    } else if (state.activeWorkflowTab === 'replay') {
      renderReplaySelectionMeta();
    }
  });
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
    recentSimulationGames: Array.isArray(detail.recentSimulationGames) ? detail.recentSimulationGames : [],
    canContinue: Boolean(summary.canContinue || detail.canContinue),
  };
}

function getSelectedRunData() {
  return state.selectedRunId ? getRunData(state.selectedRunId) : null;
}

function getReplayRunData(runId = state.replayRunId) {
  return getRunData(runId);
}

function getReplayGamesCacheKey(runId = state.replayRunId, replayType = state.replayGameType) {
  const normalizedType = String(replayType || 'evaluation').trim().toLowerCase() === 'simulation'
    ? 'simulation'
    : 'evaluation';
  const generation = normalizedType === 'evaluation'
    ? String(state.replayGenerationFilter || '').trim()
    : '';
  const boardPieces = normalizedType === 'simulation'
    ? String(state.replayBoardPiecesFilter || '').trim()
    : '';
  const advanceDepth = normalizedType === 'simulation'
    ? String(state.replayAdvanceDepthFilter || '').trim()
    : '';
  return `${String(runId || '')}::${normalizedType}::${generation}::${boardPieces}::${advanceDepth}`;
}

function getReplayPreviewGames(runId = state.replayRunId) {
  const run = getReplayRunData(runId);
  const source = state.replayGameType === 'simulation'
    ? (Array.isArray(run?.recentSimulationGames) ? run.recentSimulationGames : [])
    : (Array.isArray(run?.recentReplayGames) ? run.recentReplayGames : []);
  return sortReplayGamesChronologically(source);
}

function createEmptyReplayPageInfo() {
  return {
    limit: REPLAY_LIST_PAGE_LIMIT,
    beforeId: '',
    nextBeforeId: '',
    hasMore: false,
    matchingCount: 0,
    totalAvailableCount: 0,
    usingPreview: false,
  };
}

function createEmptyReplayFilterInfo() {
  return {
    generationOptions: [],
    boardPiecesOptions: [],
    advanceDepthOptions: [],
  };
}

function getReplayListState(runId = state.replayRunId) {
  if (!runId) return null;
  const cacheKey = getReplayGamesCacheKey(runId);
  const cached = state.replayGamesByRunId.get(cacheKey);
  return cached && typeof cached === 'object' ? cached : null;
}

function getReplayGamesForRun(runId = state.replayRunId) {
  return Array.isArray(getReplayListState(runId)?.items)
    ? getReplayListState(runId).items
    : [];
}

function getReplayPageInfo(runId = state.replayRunId) {
  return {
    ...createEmptyReplayPageInfo(),
    ...(getReplayListState(runId)?.pageInfo || {}),
  };
}

function getReplayFilterInfo(runId = state.replayRunId) {
  return {
    ...createEmptyReplayFilterInfo(),
    ...(getReplayListState(runId)?.filters || {}),
  };
}

function isReplayFilterActive() {
  if (state.replayGameType === 'simulation') {
    return Boolean(state.replayBoardPiecesFilter || state.replayAdvanceDepthFilter);
  }
  return Boolean(state.replayGenerationFilter);
}

function getReplayPreviewTotalCount(runId = state.replayRunId) {
  const run = getReplayRunData(runId);
  const live = run?.id ? state.liveRunsById.get(run.id) || null : null;
  return state.replayGameType === 'simulation'
    ? Number(live?.totalSelfPlayGames ?? run?.totalSelfPlayGames ?? 0)
    : Number(live?.totalEvaluationGames ?? run?.totalEvaluationGames ?? 0);
}

function buildReplayListSourceInfo(runId = state.replayRunId, replayType = state.replayGameType) {
  const normalizedType = String(replayType || 'evaluation').trim().toLowerCase() === 'simulation'
    ? 'simulation'
    : 'evaluation';
  const run = getReplayRunData(runId);
  const live = run?.id ? state.liveRunsById.get(run.id) || null : null;
  return {
    replayType: normalizedType,
    totalGames: normalizedType === 'simulation'
      ? Number(live?.totalSelfPlayGames ?? run?.totalSelfPlayGames ?? 0)
      : Number(live?.totalEvaluationGames ?? run?.totalEvaluationGames ?? 0),
    latestGameId: normalizedType === 'simulation'
      ? String(live?.selfPlayProgress?.latestGameId || '')
      : String(live?.evaluationProgress?.latestGameId || ''),
    status: String(live?.status || run?.status || '').trim().toLowerCase(),
  };
}

function hasReplaySiblingCacheItems(runId = state.replayRunId, replayType = state.replayGameType, currentListState = null) {
  const normalizedType = String(replayType || 'evaluation').trim().toLowerCase() === 'simulation'
    ? 'simulation'
    : 'evaluation';
  const prefix = `${String(runId || '')}::${normalizedType}::`;
  return Array.from(state.replayGamesByRunId.entries()).some(([key, value]) => (
    key.startsWith(prefix)
    && value !== currentListState
    && Array.isArray(value?.items)
    && value.items.length > 0
  ));
}

function isReplayListStateStale(runId = state.replayRunId, listState = null, replayType = state.replayGameType) {
  if (!runId || !listState || typeof listState !== 'object') {
    return true;
  }
  const currentSource = buildReplayListSourceInfo(runId, replayType);
  const hasLoadedItems = Array.isArray(listState.items) && listState.items.length > 0;
  if (!hasLoadedItems && !isReplayFilterActive()) {
    if (Number(currentSource.totalGames || 0) > 0) {
      return true;
    }
    if (getReplayPreviewGames(runId).length > 0) {
      return true;
    }
    if (hasReplaySiblingCacheItems(runId, currentSource.replayType, listState)) {
      return true;
    }
  }
  const cachedSource = listState.sourceInfo && typeof listState.sourceInfo === 'object'
    ? listState.sourceInfo
    : null;
  if (!cachedSource) {
    return Number(currentSource.totalGames || 0) > 0;
  }
  if (String(cachedSource.replayType || '') !== currentSource.replayType) {
    return true;
  }
  if (Number(cachedSource.totalGames || 0) !== Number(currentSource.totalGames || 0)) {
    return true;
  }
  const isActiveRun = ['running', 'stopping'].includes(currentSource.status);
  return Boolean(
    isActiveRun
    && currentSource.latestGameId
    && String(cachedSource.latestGameId || '') !== currentSource.latestGameId
  );
}

function maybeSeedReplayPreview(runId = state.replayRunId) {
  if (!runId || isReplayFilterActive()) {
    return false;
  }
  const previewGames = getReplayPreviewGames(runId);
  if (!previewGames.length) {
    return false;
  }
  const cacheKey = getReplayGamesCacheKey(runId);
  state.replayGamesByRunId.set(cacheKey, {
    items: previewGames,
    pageInfo: {
      limit: REPLAY_LIST_PAGE_LIMIT,
      beforeId: '',
      nextBeforeId: previewGames[0]?.id || '',
      hasMore: getReplayPreviewTotalCount(runId) > previewGames.length,
      matchingCount: previewGames.length,
      totalAvailableCount: getReplayPreviewTotalCount(runId),
      usingPreview: true,
    },
    filters: createEmptyReplayFilterInfo(),
    sourceInfo: buildReplayListSourceInfo(runId),
  });
  return true;
}

function getReplayPayloadCacheKey(runId = state.replayRunId, gameId = '') {
  return `${String(runId || '')}::${String(gameId || '')}`;
}

function getCachedReplayPayload(runId = state.replayRunId, gameId = '') {
  const cacheKey = getReplayPayloadCacheKey(runId, gameId);
  if (!state.replayPayloadCache.has(cacheKey)) {
    return null;
  }
  const payload = state.replayPayloadCache.get(cacheKey);
  state.replayPayloadCache.delete(cacheKey);
  state.replayPayloadCache.set(cacheKey, payload);
  return payload;
}

function cacheReplayPayload(runId = state.replayRunId, gameId = '', payload = null) {
  if (!runId || !gameId || !payload) return;
  const cacheKey = getReplayPayloadCacheKey(runId, gameId);
  state.replayPayloadCache.delete(cacheKey);
  state.replayPayloadCache.set(cacheKey, payload);
  while (state.replayPayloadCache.size > REPLAY_PAYLOAD_CACHE_LIMIT) {
    const oldestKey = state.replayPayloadCache.keys().next().value;
    state.replayPayloadCache.delete(oldestKey);
  }
}

function getReplayGenerationFilterValue() {
  const parsed = Number.parseInt(state.replayGenerationFilter, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReplayGenerationOptions(runId = state.replayRunId) {
  const filterInfo = getReplayFilterInfo(runId);
  if (Array.isArray(filterInfo.generationOptions) && filterInfo.generationOptions.length) {
    return [...filterInfo.generationOptions];
  }
  const previewGames = getReplayPreviewGames(runId);
  return [...new Set(previewGames
    .flatMap((game) => [Number(game?.whiteGeneration), Number(game?.blackGeneration)])
    .filter((generation) => Number.isFinite(generation))
    .sort((left, right) => left - right))];
}

function getReplayBoardPiecesFilterValue() {
  const parsed = Number.parseInt(state.replayBoardPiecesFilter, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReplayAdvanceDepthFilterValue() {
  const parsed = Number.parseInt(state.replayAdvanceDepthFilter, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function getReplayBoardPiecesOptions(runId = state.replayRunId) {
  const filterInfo = getReplayFilterInfo(runId);
  if (Array.isArray(filterInfo.boardPiecesOptions) && filterInfo.boardPiecesOptions.length) {
    return [...filterInfo.boardPiecesOptions];
  }
  const previewGames = getReplayPreviewGames(runId);
  return [...new Set(previewGames
    .map((game) => Number(game?.curriculum?.totalBoardPieces))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right))];
}

function getReplayAdvanceDepthOptions(runId = state.replayRunId) {
  const filterInfo = getReplayFilterInfo(runId);
  if (Array.isArray(filterInfo.advanceDepthOptions) && filterInfo.advanceDepthOptions.length) {
    return [...filterInfo.advanceDepthOptions];
  }
  const previewGames = getReplayPreviewGames(runId);
  return [...new Set(previewGames
    .map((game) => Number(game?.curriculum?.advanceDepth))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right))];
}

function getVisibleReplayGames(runId = state.replayRunId) {
  return getReplayGamesForRun(runId);
}

function normalizeReplayGenerationFilter(runId = state.replayRunId) {
  if (state.replayGameType !== 'evaluation') {
    state.replayGenerationFilter = '';
    return;
  }
  const generationFilter = getReplayGenerationFilterValue();
  if (!Number.isFinite(generationFilter)) {
    state.replayGenerationFilter = '';
    return;
  }
  if (!getReplayGenerationOptions(runId).includes(generationFilter)) {
    state.replayGenerationFilter = '';
  }
}

function normalizeReplayCurriculumFilters(runId = state.replayRunId) {
  if (state.replayGameType !== 'simulation') {
    state.replayBoardPiecesFilter = '';
    state.replayAdvanceDepthFilter = '';
    return;
  }
  const boardPiecesFilter = getReplayBoardPiecesFilterValue();
  const advanceDepthFilter = getReplayAdvanceDepthFilterValue();
  if (Number.isFinite(boardPiecesFilter) && !getReplayBoardPiecesOptions(runId).includes(boardPiecesFilter)) {
    state.replayBoardPiecesFilter = '';
  }
  if (Number.isFinite(advanceDepthFilter) && !getReplayAdvanceDepthOptions(runId).includes(advanceDepthFilter)) {
    state.replayAdvanceDepthFilter = '';
  }
}

function renderReplayGenerationFilter(runId = state.replayRunId) {
  if (!els.replayGenerationFilterSelect) return;
  const generations = getReplayGenerationOptions(runId);
  const currentGeneration = getReplayGenerationFilterValue();
  if (Number.isFinite(currentGeneration) && !generations.includes(currentGeneration)) {
    generations.push(currentGeneration);
    generations.sort((left, right) => left - right);
  }
  const options = generations.map((generation) => ({
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

function renderReplayCurriculumFilters(runId = state.replayRunId) {
  if (els.replayBoardPiecesFilterSelect) {
    const boardPieceOptions = getReplayBoardPiecesOptions(runId);
    const currentBoardPieces = getReplayBoardPiecesFilterValue();
    if (Number.isFinite(currentBoardPieces) && !boardPieceOptions.includes(currentBoardPieces)) {
      boardPieceOptions.push(currentBoardPieces);
      boardPieceOptions.sort((left, right) => left - right);
    }
    fillSelect(els.replayBoardPiecesFilterSelect, boardPieceOptions.map((value) => ({
      value: String(value),
      label: `${value} total`,
    })), {
      includeBlank: true,
      blankLabel: 'All totals',
      preferredValue: state.replayBoardPiecesFilter,
    });
    if (state.replayBoardPiecesFilter) {
      els.replayBoardPiecesFilterSelect.value = state.replayBoardPiecesFilter;
    }
  }
  if (els.replayAdvanceDepthFilterSelect) {
    const advanceDepthOptions = getReplayAdvanceDepthOptions(runId);
    const currentAdvanceDepth = getReplayAdvanceDepthFilterValue();
    if (Number.isFinite(currentAdvanceDepth) && !advanceDepthOptions.includes(currentAdvanceDepth)) {
      advanceDepthOptions.push(currentAdvanceDepth);
      advanceDepthOptions.sort((left, right) => left - right);
    }
    fillSelect(els.replayAdvanceDepthFilterSelect, advanceDepthOptions.map((value) => ({
      value: String(value),
      label: `Advance ${value}`,
    })), {
      includeBlank: true,
      blankLabel: 'All depths',
      preferredValue: state.replayAdvanceDepthFilter,
    });
    if (state.replayAdvanceDepthFilter) {
      els.replayAdvanceDepthFilterSelect.value = state.replayAdvanceDepthFilter;
    }
  }
}

function renderReplayFilterControls(runId = state.replayRunId) {
  const simulationMode = state.replayGameType === 'simulation';
  if (els.replayGenerationFilterGroup) {
    els.replayGenerationFilterGroup.hidden = simulationMode;
  }
  if (els.replayBoardPiecesFilterGroup) {
    els.replayBoardPiecesFilterGroup.hidden = !simulationMode;
  }
  if (els.replayAdvanceDepthFilterGroup) {
    els.replayAdvanceDepthFilterGroup.hidden = !simulationMode;
  }
  renderReplayGenerationFilter(runId);
  renderReplayCurriculumFilters(runId);
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

function clearReplaySelection({ preserveFilters = false } = {}) {
  state.replayGamesRequestSeq += 1;
  state.replayGameRequestSeq += 1;
  state.replayGamesLoad = null;
  state.replayGamesLoading = false;
  if (state.replayRefreshHandle) {
    window.clearTimeout(state.replayRefreshHandle);
    state.replayRefreshHandle = null;
  }
  state.replayGamesError = '';
  if (!preserveFilters) {
    state.replayGenerationFilter = '';
    state.replayBoardPiecesFilter = '';
    state.replayAdvanceDepthFilter = '';
  }
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
  if (state.replayGameType === 'simulation') {
    const boardPiecesFilter = getReplayBoardPiecesFilterValue();
    const advanceDepthFilter = getReplayAdvanceDepthFilterValue();
    if (Number.isFinite(boardPiecesFilter) || Number.isFinite(advanceDepthFilter)) {
      const filterParts = [
        Number.isFinite(boardPiecesFilter) ? `board ${boardPiecesFilter}` : '',
        Number.isFinite(advanceDepthFilter) ? `advance ${advanceDepthFilter}` : '',
      ].filter(Boolean);
      return `No simulation games match ${filterParts.join(' / ') || 'the current filters'}.`;
    }
    const totalSelfPlayGames = Number(live?.totalSelfPlayGames ?? run?.totalSelfPlayGames ?? 0);
    if (totalSelfPlayGames > 0) {
      return 'No simulation replay rows were returned for this run.';
    }
    return 'No simulation games for this run yet.';
  }
  const generationFilter = getReplayGenerationFilterValue();
  if (Number.isFinite(generationFilter)) {
    return `No eval games match G${generationFilter}.`;
  }
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
  state.runDetailRefreshedAtMs.delete(runId);
  Array.from(state.replayGamesByRunId.keys()).forEach((key) => {
    if (key.startsWith(`${runId}::`)) {
      state.replayGamesByRunId.delete(key);
    }
  });
  Array.from(state.replayPayloadCache.keys()).forEach((key) => {
    if (key.startsWith(`${runId}::`)) {
      state.replayPayloadCache.delete(key);
    }
  });
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
    averageTrainingStepDurationMs: Number(payload.averageTrainingStepDurationMs || 0),
    averageMctsSearchDurationMs: Number(payload.averageMctsSearchDurationMs || payload.selfPlayProgress?.averageMctsSearchDurationMs || 0),
    averageForwardPassDurationMs: Number(payload.averageForwardPassDurationMs || payload.selfPlayProgress?.averageForwardPassDurationMs || 0),
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
    scheduleLiveRunRender();
  }
}

function applyResourceTelemetry(resourceTelemetry, { render = true } = {}) {
  if (!resourceTelemetry || typeof resourceTelemetry !== 'object') return;
  state.resourceTelemetry = resourceTelemetry;
  if (render) {
    renderResourceTelemetry();
  }
}

function disconnectAdminSocket({ disable = false } = {}) {
  state.adminSocketDisabled = disable;
  if (state.adminSocket) {
    state.adminSocket.removeAllListeners();
    state.adminSocket.close();
    state.adminSocket = null;
  }
  state.adminSocketOrigin = '';
}

function normalizeOrigin(origin) {
  return String(origin || '').replace(/\/$/, '');
}

function getResolvedResponseOrigin(origin, response, path) {
  const fallbackOrigin = normalizeOrigin(origin || window.location.origin);
  const resolvedUrl = String(response?.url || '').trim();
  if (!resolvedUrl) {
    return fallbackOrigin;
  }
  try {
    return normalizeOrigin(new URL(resolvedUrl, `${fallbackOrigin}${String(path || '')}`).origin);
  } catch (_) {
    return fallbackOrigin;
  }
}

function isLocalDevOrigin(origin) {
  try {
    const parsed = new URL(String(origin || ''), window.location.origin);
    return ['localhost', '127.0.0.1'].includes(String(parsed.hostname || '').toLowerCase());
  } catch (_) {
    return false;
  }
}

function maybeNavigateToResolvedOrigin(origin) {
  const normalizedOrigin = normalizeOrigin(origin);
  const currentOrigin = normalizeOrigin(window.location.origin);
  if (!normalizedOrigin || normalizedOrigin === currentOrigin) {
    return false;
  }
  if (!isLocalDevOrigin(normalizedOrigin) || !isLocalDevOrigin(currentOrigin)) {
    return false;
  }
  const nextUrl = `${normalizedOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.replace(nextUrl);
  return true;
}

async function apiFetch(path, options = {}) {
  function buildApiUrl(origin, requestPath) {
    if (/^https?:\/\//i.test(String(requestPath || ''))) {
      return String(requestPath);
    }
    const normalizedOrigin = normalizeOrigin(origin || window.location.origin);
    const normalizedPath = String(requestPath || '').startsWith('/')
      ? String(requestPath)
      : `/${String(requestPath || '')}`;
    return `${normalizedOrigin}${normalizedPath}`;
  }

  function getCandidateApiOrigins() {
    const candidates = [];
    const pushOrigin = (origin) => {
      const normalized = normalizeOrigin(origin);
      if (!normalized || candidates.includes(normalized)) {
        return;
      }
      candidates.push(normalized);
    };
    pushOrigin(state.apiBaseOrigin);
    pushOrigin(window.location.origin);
    const isLocalhost = ['localhost', '127.0.0.1'].includes(String(window.location.hostname || '').toLowerCase());
    if (isLocalhost) {
      const protocol = window.location.protocol || 'http:';
      const host = window.location.hostname || 'localhost';
      pushOrigin(`${protocol}//${host}:3000`);
      for (let port = 3100; port <= 3125; port += 1) {
        pushOrigin(`${protocol}//${host}:${port}`);
      }
    }
    return candidates;
  }

  const init = { credentials: 'include', ...options };
  init.headers = { ...(init.headers || {}) };
  if (!init.headers.Accept) {
    init.headers.Accept = 'application/json';
  }
  if (!init.cache) {
    init.cache = 'no-store';
  }
  if (init.body && !init.headers['Content-Type']) {
    init.headers['Content-Type'] = 'application/json';
  }
  let response;
  let lastFetchError = null;
  const candidateOrigins = getCandidateApiOrigins();
  for (const origin of candidateOrigins) {
    try {
      response = await fetch(buildApiUrl(origin, path), init);
      const resolvedOrigin = getResolvedResponseOrigin(origin, response, path);
      const previousOrigin = state.apiBaseOrigin;
      state.apiBaseOrigin = resolvedOrigin;
      if (previousOrigin !== resolvedOrigin) {
        if (state.adminSocket && state.adminSocketOrigin !== resolvedOrigin) {
          disconnectAdminSocket();
        }
        state.adminSocketDisabled = false;
      }
      if ((!state.adminSocket || state.adminSocketOrigin !== resolvedOrigin) && !state.adminSocketDisabled) {
        connectAdminSocket();
      }
      if (maybeNavigateToResolvedOrigin(resolvedOrigin)) {
        return new Promise(() => {});
      }
      break;
    } catch (error) {
      lastFetchError = error;
    }
  }
  if (!response) {
    logMlAdminError('API request failed before response', lastFetchError, {
      path,
      method: init.method || 'GET',
      candidateOrigins,
    });
    throw lastFetchError || new Error('Failed to fetch');
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

function isValidReplayCatalogPayload(payload) {
  return Boolean(payload && typeof payload === 'object' && Array.isArray(payload.items));
}

function isSuspiciousEmptyReplayCatalogPayload(runId = state.replayRunId, replayType = state.replayGameType, payload = null) {
  if (!runId || isReplayFilterActive()) {
    return false;
  }
  const previewGames = getReplayPreviewGames(runId);
  const sourceInfo = buildReplayListSourceInfo(runId, replayType);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return previewGames.length > 0
    && Number(sourceInfo.totalGames || 0) > 0
    && items.length === 0;
}

function setActiveWorkflowTab(tab) {
  state.activeWorkflowTab = tab;
  persistWorkflowTab(tab);
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
  renderModelSizePresetSelect(defaults.modelSizePreset || '32k');
  renderSeedSourceSelect(defaults.seedMode || 'bootstrap');
  if (els.modelSizePresetSelect) {
    els.modelSizePresetSelect.value = String(defaults.modelSizePreset || '32k');
  }
  if (els.maxLogicalProcessorsInput) {
    els.maxLogicalProcessorsInput.value = String(defaults.maxLogicalProcessors || 1);
  }
  els.numSelfplayWorkersInput.value = String(defaults.numSelfplayWorkers || 64);
  if (els.curriculumCadenceInput) {
    els.curriculumCadenceInput.value = String(defaults.curriculumCadence || 100);
  }
  if (els.parallelGameWorkersInput) {
    els.parallelGameWorkersInput.value = String(defaults.parallelGameWorkers || 14);
  }
  els.numMctsSimulationsInput.value = String(defaults.numMctsSimulationsPerMove || 64);
  els.maxDepthInput.value = String(defaults.maxDepth || 16);
  els.hypothesisCountInput.value = String(defaults.hypothesisCount || 4);
  els.explorationInput.value = String(defaults.exploration || 1.5);
  els.replayBufferMaxPositionsInput.value = String(defaults.replayBufferMaxPositions || 10000);
  els.batchSizeInput.value = String(defaults.batchSize || 4096);
  els.learningRateInput.value = String(defaults.learningRate || 0.0005);
  els.weightDecayInput.value = String(defaults.weightDecay || 0.0001);
  els.gradientClipNormInput.value = String(defaults.gradientClipNorm || 1);
  els.trainingStepsPerCycleInput.value = String(defaults.trainingStepsPerCycle || 32);
  els.checkpointIntervalInput.value = String(defaults.checkpointInterval || 200);
  els.prePromotionTestGamesInput.value = String(defaults.prePromotionTestGames || defaults.evalGamesPerCheckpoint || 50);
  els.prePromotionTestWinRateInput.value = String(defaults.prePromotionTestWinRate ?? defaults.promotionWinrateThreshold ?? 0.55);
  els.promotionTestGamesInput.value = String(defaults.promotionTestGames || defaults.evalGamesPerCheckpoint || 50);
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
    if (els.selectedRunRuntime) {
      els.selectedRunRuntime.querySelector('.v').textContent = '--';
    }
    els.selectedRunLabel.textContent = 'No run selected.';
    els.selectedRunMeta.textContent = 'Select a run to inspect its generation history.';
    els.selectedRunStats.innerHTML = '';
    els.selectedRunGenerations.innerHTML = '';
    if (els.selectedRunDiagnostics) {
      els.selectedRunDiagnostics.innerHTML = '';
    }
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
  const diagnostics = live?.diagnostics || run.diagnostics || null;
  const selfPlayProgress = live?.selfPlayProgress || null;
  const evaluationProgress = live?.evaluationProgress || null;
  const trainingProgress = live?.trainingProgress || null;
  const status = String(run.status || '').toLowerCase();
  const primaryEval = latestEval?.againstBest || latestEval?.baselineInfo || latestEval?.againstTarget || latestEval?.prePromotionTest || null;
  const primaryEvalGeneration = Number.isFinite(primaryEval?.generation)
    ? Number(primaryEval.generation)
    : Number(live?.bestGeneration ?? run.bestGeneration ?? 0);
  const primaryEvalLabel = latestEval?.againstBest
    ? `Promotion G${primaryEvalGeneration}`
    : `Baseline G${primaryEvalGeneration}`;
  const timing = getRunTimingSnapshot(run.id);
  const replayBufferRate = getReplayBufferRateSnapshot(run, live, timing);
  const phase = String(live?.phase || '').toLowerCase();
  const selfPlayActive = Boolean(selfPlayProgress?.active) || phase === 'selfplay';
  const evaluationActive = Boolean(evaluationProgress?.active) || phase === 'evaluation' || phase === 'promotion';
  const trainingActive = Boolean(trainingProgress?.active) || phase === 'training';
  if (els.selectedRunRuntime) {
    els.selectedRunRuntime.querySelector('.v').textContent = formatDuration(getRunElapsedMs(run, live));
  }
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
    {
      label: 'Self-Play Games',
      value: formatNumber(live?.totalSelfPlayGames ?? run.totalSelfPlayGames ?? 0),
      subvalue: [
        `Avg ${formatDuration(timing?.averageSelfPlayGameDurationMs ?? 0)}`,
        `Avg concurrent ${formatConcurrency(timing?.averageSelfPlayConcurrency ?? 0)}`,
        `Avg net ${formatDuration(timing?.averageSelfPlayNetDurationMs ?? 0)}`,
      ].join(' | '),
      active: selfPlayActive,
    },
    {
      label: 'Eval Games',
      value: formatNumber(live?.totalEvaluationGames ?? run.totalEvaluationGames ?? 0),
      subvalue: [
        `Avg ${formatDuration(timing?.averageEvaluationGameDurationMs ?? 0)}`,
        `Avg concurrent ${formatConcurrency(timing?.averageEvaluationConcurrency ?? 0)}`,
        `Avg net ${formatDuration(timing?.averageEvaluationNetDurationMs ?? 0)}`,
      ].join(' | '),
      active: evaluationActive,
    },
    {
      label: 'Training Steps',
      value: formatNumber(live?.totalTrainingSteps ?? run.totalTrainingSteps ?? 0),
      subvalue: [
        `Avg ${formatDuration(timing?.averageTrainingStepDurationMs ?? 0)}`,
        (
        trainingProgress?.trainingDevice
        || latestLoss?.trainingDevice
      ) ? `${String(trainingProgress?.trainingBackend || latestLoss?.trainingBackend || 'node')} / ${String(trainingProgress?.trainingDevice || latestLoss?.trainingDevice || 'cpu')}` : '',
      ].filter(Boolean).join(' | '),
      active: trainingActive,
    },
    { label: 'Avg MCTS Search', value: formatDuration(timing?.averageMctsSearchDurationMs ?? 0) },
    { label: 'Avg Forward Pass', value: formatDuration(timing?.averageForwardPassDurationMs ?? 0) },
    {
      label: 'Replay Buffer',
      value: `${formatNumber(live?.replayBuffer?.positions ?? run.replayBuffer?.positions ?? 0)} / ${formatNumber(live?.replayBuffer?.maxPositions ?? run.replayBuffer?.maxPositions ?? 0)}`,
      subvalue: [
        Number.isFinite(replayBufferRate.perSecond) ? `Avg ${formatRate(replayBufferRate.perSecond, { signed: true })}/sec` : '',
        Number.isFinite(replayBufferRate.perGame) ? `Avg ${formatRate(replayBufferRate.perGame)} /game` : '',
      ].filter(Boolean).join(' | '),
    },
    {
      label: 'Latest Loss',
      value: latestLoss ? `P ${Number(latestLoss.policyLoss || 0).toFixed(3)} | V ${Number(latestLoss.valueLoss || 0).toFixed(3)}` : '--',
      subvalue: latestLoss
        ? `Samples ${formatNumber(latestLoss.policySamples || 0)}/${formatNumber(latestLoss.valueSamples || 0)}/${formatNumber(latestLoss.identitySamples || 0)}`
        : '',
    },
    { label: primaryEvalLabel, value: primaryEval ? formatPercent(primaryEval.winRate) : '--' },
  ];
  els.selectedRunStats.innerHTML = stats.map((entry) => `
    <div class="run-stat${entry.active ? ' active' : ''}">
      <div class="run-stat-head">
        <div class="k">${escapeHtml(entry.label)}</div>
      </div>
      <div class="v">${escapeHtml(entry.value)}</div>
      ${entry.subvalue ? `<div class="subv">${escapeHtml(entry.subvalue)}</div>` : ''}
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
  if (els.selectedRunDiagnostics) {
    els.selectedRunDiagnostics.innerHTML = renderSelectedRunDiagnostics(diagnostics);
  }
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
  fillSelect(els.replayTypeSelect, [
    { value: 'evaluation', label: 'Evaluation' },
    { value: 'simulation', label: 'Simulation' },
  ], { preferredValue: state.replayGameType });
  renderReplayFilterControls();
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
  const loadedGameCount = getReplayGamesForRun(state.replayRunId).length;
  const pageInfo = getReplayPageInfo(state.replayRunId);
  const visibleGameCount = getVisibleReplayGames(state.replayRunId).length;
  const matchingCount = Number(pageInfo.matchingCount || 0);
  const loadedCountLabel = matchingCount > loadedGameCount
    ? `${loadedGameCount} of ${matchingCount} loaded`
    : `${loadedGameCount} loaded`;
  const previewLabel = pageInfo.usingPreview
    ? 'Recent preview only'
    : (pageInfo.hasMore ? 'Older games available' : 'Full current page loaded');
  if (state.replayGameType === 'simulation') {
    const totalSelfPlayGames = Number(live?.totalSelfPlayGames ?? timing.run.totalSelfPlayGames ?? 0);
    const boardPiecesFilter = state.replayBoardPiecesFilter ? Number.parseInt(state.replayBoardPiecesFilter, 10) : null;
    const advanceDepthFilter = state.replayAdvanceDepthFilter ? Number.parseInt(state.replayAdvanceDepthFilter, 10) : null;
    let gameCountLabel = `${loadedCountLabel} simulation game(s)`;
    if (state.replayGamesLoading && !loadedGameCount) {
      gameCountLabel = pageInfo.usingPreview ? `Loading full simulation list (${loadedCountLabel})` : 'Loading simulation games';
    } else if (state.replayGamesLoading && loadedGameCount) {
      gameCountLabel = `Loading more simulation games (${loadedCountLabel})`;
    } else if (state.replayGamesError && !loadedGameCount) {
      gameCountLabel = state.replayGamesError;
    } else if (!loadedGameCount && totalSelfPlayGames > 0) {
      gameCountLabel = 'No simulation games loaded yet';
    } else if (!loadedGameCount) {
      gameCountLabel = 'No simulation games yet';
    }
    els.replaySelectionMeta.textContent = [
      `${gameCountLabel} for ${timing.run.label || timing.run.id}.`,
      `Showing ${visibleGameCount}`,
      previewLabel,
      Number.isFinite(boardPiecesFilter) ? `Board ${boardPiecesFilter}` : 'All board totals',
      Number.isFinite(advanceDepthFilter) ? `Advance ${advanceDepthFilter}` : 'All advance depths',
      `Avg sim ${formatDuration(timing.averageSelfPlayGameDurationMs)}`,
      `Run time ${formatDuration(getRunElapsedMs(timing.run, timing.live))}`,
    ].join(' | ');
    return;
  }
  const totalEvaluationGames = Number(live?.totalEvaluationGames ?? timing.run.totalEvaluationGames ?? 0);
  const knownGenerationChecks = Array.isArray(timing.run.generationPairs) ? timing.run.generationPairs.length : 0;
  const generationFilter = getReplayGenerationFilterValue();
  const filterLabel = Number.isFinite(generationFilter) ? `Filter G${generationFilter}` : 'All generations';
  let gameCountLabel = `${loadedCountLabel} eval game(s)`;
  if (state.replayGamesLoading && !loadedGameCount) {
    gameCountLabel = pageInfo.usingPreview ? `Loading full eval list (${loadedCountLabel})` : 'Loading eval games';
  } else if (state.replayGamesLoading && loadedGameCount) {
    gameCountLabel = `Loading more eval games (${loadedCountLabel})`;
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
    previewLabel,
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
  const pageInfo = getReplayPageInfo(state.replayRunId);
  if (els.replayListTopBtn) {
    els.replayListTopBtn.disabled = !visibleGames.length;
  }
  if (els.replayListBottomBtn) {
    els.replayListBottomBtn.disabled = !visibleGames.length;
  }
  if (!state.replayRunId) {
    els.replayGameList.innerHTML = `<div class="detail-row"><div class="subtle">${escapeHtml(`Choose a run to see ${state.replayGameType} games.`)}</div></div>`;
    return;
  }
  if (state.replayGamesLoading && !loadedGames.length) {
    els.replayGameList.innerHTML = `<div class="detail-row"><div class="subtle">${escapeHtml(`Loading ${state.replayGameType} games...`)}</div></div>`;
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
  const rows = visibleGames.map((game) => {
    if (state.replayGameType === 'simulation') {
      const curriculum = game?.curriculum || {};
      const totalBoardPieces = Number.isFinite(curriculum.totalBoardPieces) ? curriculum.totalBoardPieces : '--';
      const whiteBoardPieces = Number.isFinite(curriculum.whiteBoardPieces) ? curriculum.whiteBoardPieces : '--';
      const blackBoardPieces = Number.isFinite(curriculum.blackBoardPieces) ? curriculum.blackBoardPieces : '--';
      const advanceDepth = Number.isFinite(curriculum.advanceDepth) ? curriculum.advanceDepth : '--';
      return `
    <div class="detail-row ${game.id === state.selectedReplayGameId ? 'active' : ''}" data-game-id="${escapeHtml(game.id)}">
      <div class="detail-row-head">
        <strong>${escapeHtml(`${game.whiteParticipantLabel || `G${game.whiteGeneration}`} vs ${game.blackParticipantLabel || `G${game.blackGeneration}`}`)}</strong>
        <span class="badge">${escapeHtml(game.id || 'simulation')}</span>
      </div>
      <div class="detail-row-meta">
        <div class="subtle">Simulation | Winner ${escapeHtml(game.winnerLabel || 'Draw')} | Board ${escapeHtml(String(totalBoardPieces))} total (W${escapeHtml(String(whiteBoardPieces))}/B${escapeHtml(String(blackBoardPieces))}) | Advance ${escapeHtml(String(advanceDepth))}</div>
        <div class="subtle">${escapeHtml(formatDate(game.createdAt))}</div>
      </div>
    </div>
  `;
    }
    return `
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
  `;
  });
  if (pageInfo.hasMore) {
    const loadOlderLabel = state.replayGamesLoading
      ? (pageInfo.usingPreview ? 'Loading full list...' : 'Loading older games...')
      : 'Load older games';
    rows.unshift(`
    <div class="detail-row">
      <button class="secondary" type="button" data-load-older-replays="true"${state.replayGamesLoading ? ' disabled' : ''}>
        ${loadOlderLabel}
      </button>
    </div>
  `);
  }
  els.replayGameList.innerHTML = rows.join('');
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
  state.runDetailRefreshedAtMs.set(runId, Date.now());
  mergeRunSummary(detail);
  return detail;
}

function buildReplayGamesRequestParams({ replayType = state.replayGameType, beforeId = '' } = {}) {
  const params = new URLSearchParams();
  params.set('replayType', replayType);
  params.set('limit', String(REPLAY_LIST_PAGE_LIMIT));
  if (beforeId) {
    params.set('beforeId', beforeId);
  }
  if (replayType === 'simulation') {
    if (state.replayBoardPiecesFilter) {
      params.set('boardPieces', state.replayBoardPiecesFilter);
    }
    if (state.replayAdvanceDepthFilter) {
      params.set('advanceDepth', state.replayAdvanceDepthFilter);
    }
  } else if (state.replayGenerationFilter) {
    params.set('generation', state.replayGenerationFilter);
  }
  return params;
}

function mergeReplayPageItems(olderItems = [], newerItems = []) {
  const merged = [...olderItems, ...newerItems];
  const seen = new Set();
  return merged.filter((game) => {
    const gameId = String(game?.id || '');
    if (!gameId || seen.has(gameId)) {
      return false;
    }
    seen.add(gameId);
    return true;
  });
}

async function loadReplayGames({ autoLoadLatest = true, force = false, append = false } = {}) {
  const runId = state.replayRunId || '';
  const replayType = state.replayGameType;
  const cacheKey = getReplayGamesCacheKey(runId, replayType);
  const cachedListState = getReplayListState(runId);
  const hasCachedList = Boolean(cachedListState);
  const hasFreshCachedList = hasCachedList && !isReplayListStateStale(runId, cachedListState, replayType);
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

  if (append && !cachedListState?.pageInfo?.hasMore) {
    return cachedListState?.items || [];
  }

  if (hasFreshCachedList && !force && !append && !cachedListState?.pageInfo?.usingPreview) {
    state.replayGames = getReplayGamesForRun(runId);
    state.replayGamesError = '';
    state.replayGamesLoading = false;
    normalizeReplayGenerationFilter(runId);
    normalizeReplayCurriculumFilters(runId);
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
    && state.replayGamesLoad.replayType === replayType
    && state.replayGamesLoad.cacheKey === cacheKey
  ) {
    state.replayGamesLoad.autoLoadLatest = state.replayGamesLoad.autoLoadLatest || autoLoadLatest;
    return state.replayGamesLoad.promise;
  }

  const requestSeq = state.replayGamesRequestSeq + 1;
  state.replayGamesRequestSeq = requestSeq;
  state.replayGamesLoading = true;
  state.replayGamesError = '';
  if (!append && !hasCachedList) {
    maybeSeedReplayPreview(runId);
  }
  renderReplayFilterControls(runId);
  renderReplaySelectors();
  renderReplaySelectionMeta();
  renderReplayGameList();
  const beforeId = append
    ? (cachedListState?.pageInfo?.nextBeforeId || cachedListState?.items?.[0]?.id || '')
    : '';
  const loadState = {
    runId,
    replayType,
    cacheKey,
    requestSeq,
    autoLoadLatest,
    append,
    requestSourceInfo: buildReplayListSourceInfo(runId, replayType),
    promise: null,
  };
  loadState.promise = (async () => {
    let shouldAutoLoadLatest = false;
    let targetGameId = '';
    let fetchedGames = [];
    try {
      const params = buildReplayGamesRequestParams({ replayType, beforeId });
      const payload = await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/games?${params.toString()}`);
      shouldAutoLoadLatest = Boolean(loadState.autoLoadLatest);
      if (requestSeq !== state.replayGamesRequestSeq || runId !== state.replayRunId || replayType !== state.replayGameType) {
        return [];
      }
      if (isSuspiciousEmptyReplayCatalogPayload(runId, replayType, payload)) {
        maybeSeedReplayPreview(runId);
        state.replayGames = getReplayGamesForRun(runId);
        state.replayGamesError = '';
        scheduleReplayGamesRefresh(runId, 1200);
        return state.replayGames;
      }
      if (!isValidReplayCatalogPayload(payload)) {
        throw new Error(`Invalid ${replayType} replay catalog response.`);
      }
      fetchedGames = sortReplayGamesChronologically(Array.isArray(payload?.items) ? payload.items : []);
      if (
        !append
        && !isReplayFilterActive()
        && fetchedGames.length === 0
        && Number(buildReplayListSourceInfo(runId, replayType).totalGames || 0) > 0
        && Array.isArray(cachedListState?.items)
        && cachedListState.items.length > 0
      ) {
        state.replayGames = cachedListState.items;
        state.replayGamesError = '';
        scheduleReplayGamesRefresh(runId, 1200);
        return state.replayGames;
      }
      const nextListState = {
        items: append
          ? mergeReplayPageItems(fetchedGames, cachedListState?.items || [])
          : fetchedGames,
        pageInfo: {
          ...createEmptyReplayPageInfo(),
          ...(payload?.pageInfo || {}),
          usingPreview: false,
        },
        filters: {
          ...createEmptyReplayFilterInfo(),
          ...(payload?.filters || {}),
        },
        sourceInfo: loadState.requestSourceInfo,
      };
      state.replayGamesByRunId.set(cacheKey, nextListState);
      state.replayGames = nextListState.items;
      state.replayGamesError = '';
      normalizeReplayGenerationFilter(runId);
      normalizeReplayCurriculumFilters(runId);
      if (state.selectedReplayGameId && !state.replayGames.some((game) => game.id === state.selectedReplayGameId)) {
        state.selectedReplayGameId = '';
      }
      renderReplayFilterControls(runId);
      renderReplaySelectors();
      renderReplaySelectionMeta();
      if (state.replayGames.length && !state.selectedReplayGameId) {
        state.selectedReplayGameId = state.replayGames[state.replayGames.length - 1].id;
      }
      renderReplayGameList({ scrollToBottom: !append });
      if (!state.replayGames.length) {
        replayWorkbench.clear();
        setReplayControlsEnabled(false);
        els.replayMeta.textContent = getReplayEmptyStateMessage(runId);
        return nextListState.items;
      }
      targetGameId = state.selectedReplayGameId || state.replayGames[state.replayGames.length - 1]?.id || '';
    } catch (err) {
      if (requestSeq === state.replayGamesRequestSeq && runId === state.replayRunId && replayType === state.replayGameType) {
        state.replayGamesError = err.message || `Failed to load ${replayType} games.`;
      }
      throw err;
    } finally {
      if (requestSeq === state.replayGamesRequestSeq && runId === state.replayRunId && replayType === state.replayGameType) {
        state.replayGamesLoading = false;
        renderReplaySelectionMeta();
        renderReplayGameList();
      }
      if (state.replayGamesLoad === loadState) {
        state.replayGamesLoad = null;
      }
    }

    if (!shouldAutoLoadLatest || !targetGameId) {
      return state.replayGames;
    }
    if (getReplayLoadedGameId() === targetGameId) {
      return state.replayGames;
    }
    loadMostRecentAvailableReplay(targetGameId).catch((err) => setStatus(err.message, 'error'));
    return state.replayGames;
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
  let payload = getCachedReplayPayload(runId, gameId);
  if (!payload) {
    setReplayLoading('Loading replay...');
    await new Promise((resolve) => window.requestAnimationFrame(resolve));
    payload = await apiFetch(`/api/v1/ml/runs/${encodeURIComponent(runId)}/replay/${encodeURIComponent(gameId)}`);
    cacheReplayPayload(runId, gameId, payload);
  } else {
    els.replayMeta.textContent = 'Rendering cached replay...';
  }
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
  ) {
    const needsDetail = forceSelectedDetail
      || !state.runDetailsById.has(state.selectedRunId)
      || state.activeWorkflowTab === 'runs'
      || state.activeWorkflowTab === 'replay';
    if (needsDetail) {
      try {
        await ensureRunDetail(state.selectedRunId, { force: forceSelectedDetail });
      } catch (_) {}
    }
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
    modelSizePreset: String(els.modelSizePresetSelect?.value || defaults.modelSizePreset || '32k'),
    maxLogicalProcessors: parseNumberInput(els.maxLogicalProcessorsInput, defaults.maxLogicalProcessors || 1),
    numSelfplayWorkers: parseNumberInput(els.numSelfplayWorkersInput, defaults.numSelfplayWorkers || 64),
    curriculumCadence: parseNumberInput(els.curriculumCadenceInput, defaults.curriculumCadence || 100),
    parallelGameWorkers: parseNumberInput(els.parallelGameWorkersInput, defaults.parallelGameWorkers || 14),
    numMctsSimulationsPerMove: parseNumberInput(els.numMctsSimulationsInput, defaults.numMctsSimulationsPerMove || 64),
    maxDepth: parseNumberInput(els.maxDepthInput, defaults.maxDepth || 16),
    hypothesisCount: parseNumberInput(els.hypothesisCountInput, 4),
    exploration: parseNumberInput(els.explorationInput, 1.5, true),
    replayBufferMaxPositions: parseNumberInput(els.replayBufferMaxPositionsInput, defaults.replayBufferMaxPositions || 10000),
    batchSize: parseNumberInput(els.batchSizeInput, defaults.batchSize || 4096),
    learningRate: parseNumberInput(els.learningRateInput, 0.0005, true),
    weightDecay: parseNumberInput(els.weightDecayInput, 0.0001, true),
    gradientClipNorm: parseNumberInput(els.gradientClipNormInput, 1, true),
    trainingStepsPerCycle: parseNumberInput(els.trainingStepsPerCycleInput, defaults.trainingStepsPerCycle || 32),
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
  const lastRefreshAtMs = Number(state.runDetailRefreshedAtMs.get(state.selectedRunId) || 0);
  if (state.runDetailsById.has(state.selectedRunId) && (Date.now() - lastRefreshAtMs) < ACTIVE_RUN_DETAIL_REFRESH_MS) {
    return;
  }
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
  const socketOrigin = String(state.apiBaseOrigin || window.location.origin).replace(/\/$/, '');
  if (state.adminSocket) {
    if (state.adminSocketOrigin === socketOrigin) {
      return state.adminSocket;
    }
    disconnectAdminSocket();
  }
  const socket = io(`${socketOrigin}/admin`, {
    withCredentials: true,
    timeout: 5000,
    reconnection: true,
    reconnectionAttempts: 2,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 5000,
  });
  state.adminSocket = socket;
  state.adminSocketOrigin = socketOrigin;

  const disableSocket = () => disconnectAdminSocket({ disable: true });

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
    const shouldRefreshSimulationReplay = payload?.runId
      && phase === 'selfplay'
      && state.replayRunId === payload.runId
      && state.replayGameType === 'simulation';
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
    if (shouldRefreshSimulationReplay) {
      scheduleReplayGamesRefresh(payload.runId, 900);
    }
  });
  return socket;
}

function startPolling() {
  if (!state.livePollHandle) {
    state.livePollHandle = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
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
      if (state.activeWorkflowTab === 'runs' && state.selectedRunId) renderSelectedRun();
      if (state.activeWorkflowTab === 'replay' && state.replayRunId) renderReplaySelectionMeta();
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
  els.modelSizePresetSelect?.addEventListener('change', () => {
    renderSeedSourceSelect(els.seedModeSelect?.value || 'bootstrap');
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
    loadReplayGames({ autoLoadLatest: true, force: true }).catch((err) => setStatus(err.message, 'error'));
  });
  els.replayTypeSelect?.addEventListener('change', () => {
    state.replayGameType = els.replayTypeSelect.value === 'simulation' ? 'simulation' : 'evaluation';
    clearReplaySelection();
    renderReplaySelectors();
    loadReplayGames({ autoLoadLatest: true, force: true }).catch((err) => setStatus(err.message, 'error'));
  });
  els.replayGenerationFilterSelect?.addEventListener('change', () => {
    state.replayGenerationFilter = els.replayGenerationFilterSelect.value || '';
    clearReplaySelection({ preserveFilters: true });
    loadReplayGames({ autoLoadLatest: true, force: true }).catch((err) => setStatus(err.message, 'error'));
  });
  els.replayBoardPiecesFilterSelect?.addEventListener('change', () => {
    state.replayBoardPiecesFilter = els.replayBoardPiecesFilterSelect.value || '';
    clearReplaySelection({ preserveFilters: true });
    loadReplayGames({ autoLoadLatest: true, force: true }).catch((err) => setStatus(err.message, 'error'));
  });
  els.replayAdvanceDepthFilterSelect?.addEventListener('change', () => {
    state.replayAdvanceDepthFilter = els.replayAdvanceDepthFilterSelect.value || '';
    clearReplaySelection({ preserveFilters: true });
    loadReplayGames({ autoLoadLatest: true, force: true }).catch((err) => setStatus(err.message, 'error'));
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
    const loadOlderButton = event.target.closest('[data-load-older-replays]');
    if (loadOlderButton) {
      loadReplayGames({ autoLoadLatest: false, append: true }).catch((err) => setStatus(err.message, 'error'));
      return;
    }
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
  let bootError = null;
  bindEvents();
  applyFieldTooltips();
  try {
    await refreshWorkbench({ silent: false, forceSelectedDetail: false });
  } catch (err) {
    bootError = err;
    logMlAdminError('Initial ML workbench load failed', err);
  }
  connectAdminSocket();
  setActiveWorkflowTab(state.activeWorkflowTab);
  startPolling();
  if (bootError) {
    setStatus(bootError.message || 'Failed to initialize ML run workbench.', 'error');
  }
}

boot().catch((err) => setStatus(err.message || 'Failed to initialize ML run workbench.', 'error'));
