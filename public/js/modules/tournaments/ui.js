import { createOverlay } from '../ui/overlays.js';
import { upgradeButton } from '../ui/buttons.js';
import { createBotIcon, createThroneIcon } from '../ui/icons.js';
import { createEloBadge } from '../render/eloBadge.js';
import {
  apiReady,
  apiGetTournaments,
  apiGetCurrentTournament,
  apiCreateTournament,
  apiUpdateTournamentConfig,
  apiJoinTournament,
  apiLeaveTournament,
  apiCancelTournament,
  apiAddTournamentBot,
  apiStartTournament,
  apiStartTournamentElimination,
  apiKickTournamentPlayer,
  apiGetTournamentDetails,
  apiGetTournamentHistoryDetails,
  apiGetAdminTournamentDetails,
  apiUpdateTournamentMessage,
} from '../api/game.js';

function asText(value, fallback = '') {
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
}

function el(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === 'className') {
      node.className = value;
      return;
    }
    if (key === 'html') {
      node.innerHTML = value;
      return;
    }
    node.setAttribute(key, value);
  });
  if (text) node.textContent = text;
  return node;
}

function clearNode(node) {
  if (!node) return;
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

function createModalShell(titleText) {
  const title = el('h2', { className: 'tournament-modal__title' }, titleText);
  const status = el('div', { className: 'menu-message tournament-modal__status' }, '');
  const section = el('div', { className: 'tournament-modal__section' });
  return { title, status, section };
}

function formatPhaseLabel(phase) {
  if (phase === 'round_robin') return 'Round Robin';
  if (phase === 'round_robin_complete') return 'Round Robin Complete';
  if (phase === 'elimination') return 'Elimination';
  if (phase === 'completed') return 'Completed';
  return 'Lobby';
}

function getRoundRobinTimeRemaining(tournament, nowMs = Date.now()) {
  const startedAt = Date.parse(tournament?.roundRobinRoundsStartedAt || tournament?.startedAt || '');
  const minutes = Number(tournament?.config?.roundRobinMinutes) || 15;
  if (!Number.isFinite(startedAt)) return null;
  const endTs = startedAt + (minutes * 60 * 1000);
  const remainingMs = Math.max(0, endTs - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function getEliminationBreakTimeRemaining(tournament, nowMs = Date.now()) {
  const startAt = Date.parse(tournament?.eliminationStartsAt || '');
  if (!Number.isFinite(startAt)) return null;
  const remainingMs = Math.max(0, startAt - nowMs);
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function getTournamentPhaseTimer(tournament, nowMs = Date.now()) {
  if (tournament?.phase === 'round_robin') {
    const value = getRoundRobinTimeRemaining(tournament, nowMs);
    return value ? `Time remaining: ${value}` : '';
  }
  if (tournament?.phase === 'round_robin_complete') {
    const value = getEliminationBreakTimeRemaining(tournament, nowMs);
    return value ? `Break remaining: ${value}` : '';
  }
  return '';
}

function formatPlacementDepth(value, { section = 'winners', bracket = null } = {}) {
  const roundIndex = Number(value);
  if (!Number.isFinite(roundIndex) || roundIndex < 0) return '\u2014';

  const normalizedSection = String(section || 'winners').toLowerCase();
  const normalizedBracket = normalizeBracketCollections(bracket);
  const totalRounds = normalizedSection === 'losers'
    ? normalizedBracket.losersRounds.length
    : normalizedSection === 'finals'
      ? normalizedBracket.finalsRounds.length
      : normalizedBracket.winnersRounds.length;
  const roundsFromEnd = totalRounds - roundIndex;
  const hasLosersBracket = normalizedBracket.losersRounds.length > 0;

  if (normalizedSection === 'finals') {
    if (roundIndex === 0) return 'Grand Finals';
    if (roundIndex === 1) return 'Grand Finals Reset';
    return String(roundIndex + 1);
  }

  if (normalizedSection === 'losers') {
    if (roundsFromEnd === 1) return 'Losers Finals';
    if (roundsFromEnd === 2) return 'Losers Semifinals';
    if (roundsFromEnd === 3) return 'Losers Quarterfinals';
    return String(roundIndex + 1);
  }

  if (hasLosersBracket && roundsFromEnd === 1) return 'Winner Finals';
  if (!hasLosersBracket && totalRounds === 1) return 'Final';
  if (!hasLosersBracket && roundsFromEnd === 1) return 'Final';
  if (roundsFromEnd === 2) return 'Semifinals';
  if (roundsFromEnd === 3) return 'Quarterfinals';
  return String(roundIndex + 1);
}

function getTournamentStatusHint(tournament, {
  isInTournamentGame = false,
  currentUserGame = null,
  currentUserRequiresAccept = false,
} = {}) {
  if (!tournament) return '';
  if (tournament.phase === 'completed') return 'Tournament complete.';
  if (currentUserRequiresAccept) return 'Match ready. Accept to begin.';
  if (isInTournamentGame && currentUserGame) return 'Current tournament game in progress.';
  if (tournament.phase === 'round_robin' && tournament.roundRobinWaitingForGames) {
    return 'Waiting for games to finish.';
  }
  if (currentUserGame?.opponentUsername) {
    return `Waiting for next match vs ${currentUserGame.opponentUsername}.`;
  }
  if (tournament.phase === 'round_robin_complete' && tournament.eliminationStartsAt) {
    return 'Waiting for elimination break to end.';
  }
  if (tournament.phase === 'elimination') {
    return 'Waiting for next elimination match.';
  }
  return 'Waiting for next match.';
}

function shouldShowTournamentStage(tournament, {
  isInTournamentGame = false,
  currentUserGame = null,
  isReadOnlyView = false,
} = {}) {
  if (!tournament) return false;
  if (isReadOnlyView) return tournament.phase === 'completed' || Boolean(tournament.bracket);
  if (tournament.phase === 'completed') return true;
  if (isInTournamentGame || currentUserGame?.gameId) return true;
  return tournament.state !== 'starting';
}

function normalizeTournamentConfig(config = {}) {
  return {
    roundRobinMinutes: Number.isFinite(Number(config?.roundRobinMinutes))
      ? Math.max(1, Math.min(30, Number(config.roundRobinMinutes)))
      : 15,
    breakMinutes: Number.isFinite(Number(config?.breakMinutes))
      ? Math.max(0, Math.min(30, Number(config.breakMinutes)))
      : 5,
    eliminationStyle: String(config?.eliminationStyle || 'single').toLowerCase() === 'double'
      ? 'double'
      : 'single',
    victoryPoints: [3, 4, 5].includes(Number(config?.victoryPoints)) ? Number(config.victoryPoints) : 3,
  };
}

function appendTournamentSettingSummary(settingsList, config, { includeBreakTime = true } = {}) {
  if (includeBreakTime) {
    settingsList.appendChild(el('div', { className: 'tournament-panel__setting' }, `Break time: ${config.breakMinutes} min`));
  }
  settingsList.appendChild(el('div', { className: 'tournament-panel__setting' }, `Round robin: ${config.roundRobinMinutes} min`));
  settingsList.appendChild(el('div', { className: 'tournament-panel__setting' }, `Elimination: ${config.eliminationStyle === 'double' ? 'Double' : 'Single'}`));
  settingsList.appendChild(el('div', { className: 'tournament-panel__setting' }, `Victory target: ${config.victoryPoints}`));
}

function createTournamentNumberSettingField(labelText, { value, min, max }) {
  const field = el('label', { className: 'tournament-panel__setting-field' });
  field.appendChild(el('span', { className: 'tournament-panel__setting-label' }, labelText));
  const input = el('input', {
    className: 'tournament-panel__setting-input',
    type: 'number',
    min: String(min),
    max: String(max),
    value: String(value),
  });
  field.appendChild(input);
  return { field, input };
}

function formatStandingPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0';
  return Math.abs(numeric - Math.round(numeric)) < 1e-9
    ? String(Math.round(numeric))
    : numeric.toFixed(1);
}

function resolveTournamentDisplayElo(entry) {
  const preTournamentElo = Number(entry?.preTournamentElo);
  if (Number.isFinite(preTournamentElo) && preTournamentElo > 0) {
    return preTournamentElo;
  }
  const elo = Number(entry?.elo);
  if (Number.isFinite(elo) && elo > 0) {
    return elo;
  }
  return null;
}

function isTournamentBot(entry) {
  return entry?.type === 'bot';
}

function resolveTournamentIdentityEntry(entry, participantLookup = null) {
  const participantEntry = participantLookup?.get?.(String(entry?.userId || '')) || null;
  return participantEntry || entry || null;
}

function buildRoleFlags(role) {
  return {
    isHost: role === 'host' || role === 'host_player',
    isPlayer: role === 'player' || role === 'host_player',
    isViewer: role === 'viewer',
  };
}

function getOrdinalLabel(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return String(value || '');
  const tens = number % 100;
  if (tens >= 11 && tens <= 13) return `${number}th`;
  const ones = number % 10;
  if (ones === 1) return `${number}st`;
  if (ones === 2) return `${number}nd`;
  if (ones === 3) return `${number}rd`;
  return `${number}th`;
}

function normalizeBracketCollections(bracket = {}) {
  return {
    winnersRounds: Array.isArray(bracket?.winnersRounds)
      ? bracket.winnersRounds
      : (Array.isArray(bracket?.rounds) ? bracket.rounds : []),
    losersRounds: Array.isArray(bracket?.losersRounds) ? bracket.losersRounds : [],
    finalsRounds: Array.isArray(bracket?.finalsRounds) ? bracket.finalsRounds : [],
  };
}

function cloneBracketRounds(rounds = []) {
  return Array.isArray(rounds)
    ? rounds.map((round) => ({
        ...round,
        matches: Array.isArray(round?.matches)
          ? round.matches.map((match) => ({ ...match }))
          : [],
      }))
    : [];
}

function getMatchLoser(match) {
  const winnerId = String(match?.winner?.userId || '');
  const playerA = match?.playerA || null;
  const playerB = match?.playerB || null;
  const playerAId = String(playerA?.userId || '');
  const playerBId = String(playerB?.userId || '');
  if (!winnerId || !playerAId || !playerBId) return null;
  if (winnerId === playerAId) return playerB;
  if (winnerId === playerBId) return playerA;
  return null;
}

function buildCompletedPlacements(participants = [], bracket = null) {
  const allParticipants = Array.isArray(participants) ? participants.filter((entry) => entry?.userId) : [];
  if (!allParticipants.length) return [];

  const participantByUserId = new Map(allParticipants.map((entry) => [String(entry.userId), entry]));
  const progressByUserId = new Map();
  const ensureProgress = (userId) => {
    const key = String(userId || '');
    if (!key) {
      return {
        maxWinnersRound: -1,
        maxLosersRound: -1,
        maxFinalsRound: -1,
      };
    }
    if (!progressByUserId.has(key)) {
      progressByUserId.set(key, {
        maxWinnersRound: -1,
        maxLosersRound: -1,
        maxFinalsRound: -1,
      });
    }
    return progressByUserId.get(key);
  };

  const { winnersRounds, losersRounds, finalsRounds } = normalizeBracketCollections(bracket);
  winnersRounds.forEach((round, roundIndex) => {
    (Array.isArray(round?.matches) ? round.matches : []).forEach((match) => {
      [match?.playerA, match?.playerB].forEach((player) => {
        const progress = ensureProgress(player?.userId);
        progress.maxWinnersRound = Math.max(progress.maxWinnersRound, roundIndex);
      });
    });
  });
  losersRounds.forEach((round, roundIndex) => {
    (Array.isArray(round?.matches) ? round.matches : []).forEach((match) => {
      [match?.playerA, match?.playerB].forEach((player) => {
        const progress = ensureProgress(player?.userId);
        progress.maxLosersRound = Math.max(progress.maxLosersRound, roundIndex);
      });
    });
  });
  finalsRounds.forEach((round, roundIndex) => {
    (Array.isArray(round?.matches) ? round.matches : []).forEach((match) => {
      [match?.playerA, match?.playerB].forEach((player) => {
        const progress = ensureProgress(player?.userId);
        progress.maxFinalsRound = Math.max(progress.maxFinalsRound, roundIndex);
      });
    });
  });

  const decidingFinal = (() => {
    if (finalsRounds.length > 0) {
      for (let index = finalsRounds.length - 1; index >= 0; index -= 1) {
        const match = finalsRounds[index]?.matches?.[0] || null;
        if (match?.winner?.userId) return match;
      }
    }
    const finalRound = winnersRounds[winnersRounds.length - 1] || null;
    return finalRound?.matches?.[0] || null;
  })();

  const championId = String(decidingFinal?.winner?.userId || '');
  const runnerUpId = String(getMatchLoser(decidingFinal)?.userId || '');
  const buildEntry = (participant) => {
    const progress = ensureProgress(participant?.userId);
    const points = Number.isFinite(Number(participant?.points)) ? Number(participant.points) : null;
    return {
      participant,
      deepestLosersRound: progress.maxLosersRound,
      deepestWinnersRound: progress.maxWinnersRound,
      deepestFinalsRound: progress.maxFinalsRound,
      points,
    };
  };

  const ordered = [];
  if (championId && participantByUserId.has(championId)) {
    ordered.push(buildEntry(participantByUserId.get(championId)));
  }
  if (runnerUpId && participantByUserId.has(runnerUpId) && runnerUpId !== championId) {
    ordered.push(buildEntry(participantByUserId.get(runnerUpId)));
  }

  const remaining = allParticipants
    .filter((entry) => {
      const userId = String(entry.userId || '');
      return userId && userId !== championId && userId !== runnerUpId;
    })
    .map(buildEntry)
    .sort((left, right) => {
      if (left.deepestFinalsRound !== right.deepestFinalsRound) {
        return right.deepestFinalsRound - left.deepestFinalsRound;
      }
      if (left.deepestLosersRound !== right.deepestLosersRound) {
        return right.deepestLosersRound - left.deepestLosersRound;
      }
      if (left.deepestWinnersRound !== right.deepestWinnersRound) {
        return right.deepestWinnersRound - left.deepestWinnersRound;
      }
      const leftPoints = Number.isFinite(left.points) ? left.points : Number.NEGATIVE_INFINITY;
      const rightPoints = Number.isFinite(right.points) ? right.points : Number.NEGATIVE_INFINITY;
      if (leftPoints !== rightPoints) return rightPoints - leftPoints;
      return 0;
    });

  const ranked = ordered.concat(remaining);
  let lastComparable = null;
  let lastPlacement = 0;
  return ranked.map((entry, index) => {
    const comparable = {
      deepestFinalsRound: entry.deepestFinalsRound,
      deepestLosersRound: entry.deepestLosersRound,
      deepestWinnersRound: entry.deepestWinnersRound,
      points: entry.points,
    };
    const isTie = Boolean(
      lastComparable
      && comparable.deepestFinalsRound === lastComparable.deepestFinalsRound
      && comparable.deepestLosersRound === lastComparable.deepestLosersRound
      && comparable.deepestWinnersRound === lastComparable.deepestWinnersRound
      && comparable.points === lastComparable.points
    );
    const position = isTie ? lastPlacement : index + 1;
    lastComparable = comparable;
    lastPlacement = position;
    return {
      position,
      label: getOrdinalLabel(position),
      participant: entry.participant,
      deepestFinalsRound: entry.deepestFinalsRound,
      deepestLosersRound: entry.deepestLosersRound,
      deepestWinnersRound: entry.deepestWinnersRound,
      points: entry.points,
    };
  });
}

function createOverlayOptions(ariaLabel, closeLabel) {
  return {
    ariaLabel,
    baseClass: 'cg-overlay',
    dialogClass: 'history-modal tournament-modal',
    contentClass: 'history-modal-content tournament-modal__content',
    backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
    closeButtonClass: 'history-close-btn',
    closeLabel,
    closeText: 'x',
    openClass: 'open cg-overlay--open',
    bodyOpenClass: 'history-overlay-open cg-overlay-open',
  };
}

export function initTournamentUi({
  triggerButton,
  getSessionInfo,
  onSessionRefresh,
  onSpectateMatch,
  registerSpectateUsername,
  onParticipantStateChange,
  onTournamentAcceptStateChange,
}) {
  if (!triggerButton) return null;

  const browserOverlay = createOverlay(createOverlayOptions('Tournament browser', 'Close tournament browser'));
  const createOverlayModal = createOverlay({
    ...createOverlayOptions('Create tournament', 'Close create tournament dialog'),
    onCloseRequest: () => {
      createOverlayModal.hide({ restoreFocus: false });
      browserOverlay.show();
    },
  });
  const addBotOverlay = createOverlay({
    ...createOverlayOptions('Add tournament bot', 'Close add bot dialog'),
    onCloseRequest: () => {
      addBotOverlay.hide({ restoreFocus: false });
      renderPanel();
    },
  });
  const confirmOverlay = createOverlay(createOverlayOptions('Tournament confirmation', 'Close confirmation'));
  const bracketOverlay = createOverlay(createOverlayOptions('Tournament bracket', 'Close bracket viewer'));

  let browserStatusEl = null;
  let browserListEl = null;
  let joinBtn = null;
  let viewBtn = null;
  let createBtn = null;
  let selectedTournamentId = null;
  let cachedRows = [];
  let botDifficultyOptions = [];
  let browserTestModeEnabled = false;

  let currentTournament = null;
  let currentRole = null;
  let currentViewMode = 'live';
  let isInTournamentGame = false;
  let messageDraft = '';
  let messageDirty = false;
  let settingsDraft = normalizeTournamentConfig();
  let settingsDirty = false;
  let lastTournamentId = null;
  let pollHandle = null;
  let roundRobinTimerHandle = null;
  let roundRobinTimerEl = null;
  let tournamentServerClockOffsetMs = 0;
  let lastAcceptStateKey = null;

  const panelRoot = el('div', { className: 'tournament-panel', hidden: 'hidden' });
  const panelLayout = el('div', { className: 'tournament-panel__layout' });
  const hostColumn = el('aside', { className: 'tournament-panel__column tournament-panel__column--host' });
  const centerColumn = el('section', { className: 'tournament-panel__column tournament-panel__column--center' });
  const sideColumn = el('aside', { className: 'tournament-panel__column tournament-panel__column--side' });
  const participantColumn = el('aside', { className: 'tournament-panel__column tournament-panel__column--participants' });
  const panelTabs = el('div', { className: 'tournament-panel__tabs', role: 'tablist', 'aria-label': 'Tournament sections' });
  const panelSections = [
    { key: 'setup', label: 'Setup', column: hostColumn },
    { key: 'game', label: 'Game', column: centerColumn },
    { key: 'status', label: 'Status', column: sideColumn },
    { key: 'participants', label: 'Participants', column: participantColumn },
  ];
  const panelTabButtons = new Map();
  let activePanelSection = 'setup';
  const stageFrame = el('div', { className: 'tournament-panel__stage-frame' });
  const stagePlaceholder = el('div', { className: 'tournament-panel__stage-placeholder' });
  const stagePlaceholderTitle = el('div', { className: 'tournament-panel__stage-title' }, 'Current Game');
  const stagePlaceholderBody = el('div', { className: 'tournament-panel__stage-body' }, 'Waiting for your next tournament game.');
  const stagePlaceholderActions = el('div', { className: 'tournament-panel__actions tournament-panel__actions--stage' });
  const stageSurface = el('div', { className: 'tournament-panel__stage-surface' });
  stagePlaceholder.appendChild(stagePlaceholderTitle);
  stagePlaceholder.appendChild(stagePlaceholderBody);
  stagePlaceholder.appendChild(stagePlaceholderActions);
  stageFrame.appendChild(stagePlaceholder);
  stageFrame.appendChild(stageSurface);
  centerColumn.appendChild(stageFrame);
  panelLayout.appendChild(hostColumn);
  panelLayout.appendChild(centerColumn);
  panelLayout.appendChild(sideColumn);
  panelLayout.appendChild(participantColumn);
  panelSections.forEach(({ key, label, column }) => {
    column.dataset.tournamentSection = key;
    column.setAttribute('role', 'tabpanel');
    column.setAttribute('aria-label', label);
    const tab = el('button', {
      type: 'button',
      className: 'tournament-panel__tab',
      role: 'tab',
      'aria-controls': `tournament-panel-section-${key}`,
    }, label);
    column.id = `tournament-panel-section-${key}`;
    tab.addEventListener('click', () => {
      setActivePanelSection(key, { scroll: true });
    });
    panelTabButtons.set(key, tab);
    panelTabs.appendChild(tab);
  });
  panelRoot.appendChild(panelTabs);
  panelRoot.appendChild(panelLayout);
  document.body.appendChild(panelRoot);

  function isReadOnlyTournamentView() {
    return currentViewMode === 'archive' || currentViewMode === 'admin';
  }

  function clearTournamentQueryParams() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('adminTournamentId');
      url.searchParams.delete('archiveTournamentId');
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, '', next);
    } catch (_) {}
  }

  function notifyPanelState() {
    if (typeof onParticipantStateChange === 'function') {
      onParticipantStateChange(Boolean(currentTournament && (currentRole || isReadOnlyTournamentView())));
    }
  }

  function notifyAcceptState() {
    if (typeof onTournamentAcceptStateChange !== 'function') return;
    if (isReadOnlyTournamentView()) {
      if (lastAcceptStateKey === 'none') return;
      lastAcceptStateKey = 'none';
      onTournamentAcceptStateChange({
        requiresAccept: false,
        tournament: currentTournament,
        currentUserGame: null,
      });
      return;
    }
    const currentUserGame = currentTournament?.currentUserGame || null;
    const requiresAccept = Boolean(
      currentRole
      && currentUserGame?.requiresAccept
      && currentUserGame?.gameId
      && Number.isInteger(currentUserGame?.color)
    );
    const nextKey = requiresAccept
      ? `${String(currentTournament?.id || '')}:${String(currentUserGame?.gameId || '')}:${String(currentUserGame?.color)}`
      : 'none';
    if (nextKey === lastAcceptStateKey) return;
    lastAcceptStateKey = nextKey;
    onTournamentAcceptStateChange({
      requiresAccept,
      tournament: currentTournament,
      currentUserGame: requiresAccept ? currentUserGame : null,
    });
  }

  function stopPolling() {
    if (pollHandle) {
      clearInterval(pollHandle);
      pollHandle = null;
    }
  }

  function stopRoundRobinTimer({ preserveElement = false } = {}) {
    if (roundRobinTimerHandle) {
      clearTimeout(roundRobinTimerHandle);
      roundRobinTimerHandle = null;
    }
    if (!preserveElement) {
      roundRobinTimerEl = null;
    }
  }

  function getTournamentServerNowMs() {
    return Date.now() + tournamentServerClockOffsetMs;
  }

  function syncTournamentServerClock(payload) {
    const serverNowMs = Number(payload?.serverNowMs);
    if (!Number.isFinite(serverNowMs) || serverNowMs <= 0) return;
    tournamentServerClockOffsetMs = serverNowMs - Date.now();
  }

  function refreshRoundRobinTimerDisplay() {
    if (!roundRobinTimerEl || !currentTournament) return;
    const timerText = getTournamentPhaseTimer(currentTournament, getTournamentServerNowMs());
    if (!timerText) {
      roundRobinTimerEl.textContent = '';
      return;
    }
    roundRobinTimerEl.textContent = timerText;
  }

  function scheduleRoundRobinTimerTick() {
    const canTick = currentTournament
      && (currentTournament.phase === 'round_robin' || currentTournament.phase === 'round_robin_complete')
      && roundRobinTimerEl
      && roundRobinTimerEl.isConnected;
    if (!canTick) {
      return;
    }
    refreshRoundRobinTimerDisplay();
    const nowMs = getTournamentServerNowMs();
    const delayMs = Math.max(100, 1000 - (nowMs % 1000));
    roundRobinTimerHandle = window.setTimeout(() => {
      scheduleRoundRobinTimerTick();
    }, delayMs);
  }

  function startRoundRobinTimer() {
    stopRoundRobinTimer({ preserveElement: true });
    const canTick = currentTournament
      && (currentTournament.phase === 'round_robin' || currentTournament.phase === 'round_robin_complete')
      && roundRobinTimerEl
      && roundRobinTimerEl.isConnected;
    if (!canTick) {
      return;
    }
    scheduleRoundRobinTimerTick();
  }

  function startPolling() {
    stopPolling();
    if (!currentTournament) return;
    pollHandle = window.setInterval(() => {
      refreshCurrentTournament({
        silent: true,
        tournamentId: currentViewMode === 'live' ? null : currentTournament.id,
        viewMode: currentViewMode,
      }).catch(() => null);
    }, 10000);
  }

  function setActivePanelSection(sectionKey, { scroll = false } = {}) {
    const target = panelSections.find((section) => section.key === sectionKey && !section.column.hidden);
    const nextKey = target ? target.key : 'setup';
    activePanelSection = nextKey;
    panelSections.forEach(({ key, column }) => {
      const active = key === nextKey;
      column.classList.toggle('tournament-panel__column--active', active);
      const tab = panelTabButtons.get(key);
      if (tab) {
        tab.classList.toggle('tournament-panel__tab--active', active);
        tab.setAttribute('aria-selected', active ? 'true' : 'false');
        tab.tabIndex = active ? 0 : -1;
      }
    });
    if (scroll && target) {
      target.column.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' });
    }
  }

  function syncActivePanelSectionFromScroll() {
    const layoutRect = panelLayout.getBoundingClientRect();
    if (!layoutRect.width) return;
    const layoutCenter = layoutRect.left + (layoutRect.width / 2);
    let bestSection = null;
    let bestDistance = Infinity;
    panelSections.forEach((section) => {
      if (section.column.hidden) return;
      const rect = section.column.getBoundingClientRect();
      if (!rect.width) return;
      const distance = Math.abs((rect.left + (rect.width / 2)) - layoutCenter);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSection = section;
      }
    });
    if (bestSection && bestSection.key !== activePanelSection) {
      setActivePanelSection(bestSection.key);
    }
  }

  function syncPanelSections({ showStage = true } = {}) {
    centerColumn.hidden = !showStage;
    const gameTab = panelTabButtons.get('game');
    if (gameTab) {
      gameTab.hidden = !showStage;
    }
    panelRoot.classList.toggle('tournament-panel--prestart', !showStage);
    if (!showStage && activePanelSection === 'game') {
      setActivePanelSection('setup');
      return;
    }
    setActivePanelSection(activePanelSection);
  }

  function syncPanelTabLabels(roleFlags = {}) {
    const setupTab = panelTabButtons.get('setup');
    if (!setupTab) return;
    setupTab.textContent = roleFlags.isHost ? 'Admin' : 'Config';
    hostColumn.setAttribute('aria-label', roleFlags.isHost ? 'Admin' : 'Config');
  }

  let panelScrollFrame = null;
  panelLayout.addEventListener('scroll', () => {
    if (panelScrollFrame) return;
    panelScrollFrame = window.requestAnimationFrame(() => {
      panelScrollFrame = null;
      syncActivePanelSectionFromScroll();
    });
  }, { passive: true });

  function syncPanelVisibility() {
    const visible = Boolean(currentTournament && (currentRole || isReadOnlyTournamentView()));
    panelRoot.hidden = !visible;
    panelRoot.classList.toggle('tournament-panel--visible', visible);
    if (visible) {
      startPolling();
    } else {
      stopPolling();
      stopRoundRobinTimer();
    }
    notifyPanelState();
  }

  function registerKnownTournamentUsers(tournament, games = []) {
    if (typeof registerSpectateUsername !== 'function') return;
    (Array.isArray(tournament?.participants) ? tournament.participants : []).forEach((entry) => {
      if (!entry?.userId || !entry?.username) return;
      registerSpectateUsername(entry.userId, entry.username, { priority: 20 });
    });
    (Array.isArray(games) ? games : []).forEach((game) => {
      (Array.isArray(game?.players) ? game.players : []).forEach((player) => {
        if (!player?.userId || !player?.username) return;
        registerSpectateUsername(player.userId, player.username, { priority: 20 });
      });
    });
  }

  function setCurrentTournamentState(payload, { viewMode = null } = {}) {
    syncTournamentServerClock(payload);
    currentTournament = payload?.tournament || null;
    currentRole = payload?.role || null;
    if (!currentTournament) {
      currentViewMode = 'live';
      currentRole = null;
      messageDraft = '';
      messageDirty = false;
      settingsDraft = normalizeTournamentConfig();
      settingsDirty = false;
      lastTournamentId = null;
      lastAcceptStateKey = null;
      notifyAcceptState();
      syncPanelVisibility();
      renderPanel();
      return;
    }
    currentViewMode = viewMode || currentViewMode || 'live';
    if (lastTournamentId !== currentTournament.id) {
      messageDraft = asText(currentTournament.message, '');
      messageDirty = false;
      settingsDraft = normalizeTournamentConfig(currentTournament.config);
      settingsDirty = false;
      lastTournamentId = currentTournament.id;
    } else if (!messageDirty) {
      messageDraft = asText(currentTournament.message, '');
      if (!settingsDirty) {
        settingsDraft = normalizeTournamentConfig(currentTournament.config);
      }
    }
    registerKnownTournamentUsers(currentTournament, payload?.games || []);
    notifyAcceptState();
    syncPanelVisibility();
    renderPanel();
  }

  async function refreshCurrentTournament({ silent = false, tournamentId = null, viewMode = null } = {}) {
    const nextViewMode = viewMode || currentViewMode || 'live';
    const targetTournamentId = tournamentId || currentTournament?.id || null;
    try {
      let payload = null;
      if (nextViewMode === 'admin') {
        if (!targetTournamentId) {
          setCurrentTournamentState(null);
          return null;
        }
        payload = await apiGetAdminTournamentDetails({ tournamentId: targetTournamentId });
      } else if (nextViewMode === 'archive') {
        if (!targetTournamentId) {
          setCurrentTournamentState(null);
          return null;
        }
        payload = await apiGetTournamentHistoryDetails({ tournamentId: targetTournamentId });
      } else {
        payload = targetTournamentId
          ? await apiGetTournamentDetails({ tournamentId: targetTournamentId })
          : await apiGetCurrentTournament();
      }
      if (!payload?.tournament) {
        setCurrentTournamentState(null);
        return null;
      }
      setCurrentTournamentState(payload, { viewMode: nextViewMode });
      return payload;
    } catch (err) {
      if ([401, 403, 404].includes(Number(err?.response?.status || 0))) {
        setCurrentTournamentState(null);
      }
      if (!silent) {
        try {
          window.alert(err.message || 'Unable to load tournament.');
        } catch (_) {}
      }
      return null;
    }
  }

  function closeTournamentPanel() {
    clearTournamentQueryParams();
    setCurrentTournamentState(null);
    confirmOverlay.hide({ restoreFocus: false });
  }

  async function leaveCurrentTournament({ reopenBrowser = true } = {}) {
    if (!currentTournament?.id) return;
    if (isReadOnlyTournamentView()) {
      closeTournamentPanel();
      return;
    }
    await apiLeaveTournament({ tournamentId: currentTournament.id });
    setCurrentTournamentState(null);
    confirmOverlay.hide({ restoreFocus: false });
    if (reopenBrowser) {
      browserOverlay.show();
      await refreshBrowser();
    }
  }

  function getSelectedTournament() {
    return cachedRows.find((row) => row.id === selectedTournamentId) || null;
  }

  function updateBrowserButtons() {
    const session = getSessionInfo ? getSessionInfo() : null;
    const selected = getSelectedTournament();
    const isLoggedIn = Boolean(session?.authenticated);
    const canParticipate = isLoggedIn || (browserTestModeEnabled && Boolean(session?.isGuest));

    if (joinBtn) {
      const canJoin = Boolean(selected && selected.state === 'starting' && canParticipate);
      joinBtn.disabled = !canJoin;
      if (!isLoggedIn && !browserTestModeEnabled) {
        joinBtn.title = 'Login required for participation.';
      } else if (!selected) {
        joinBtn.title = 'Select a tournament first.';
      } else if (selected.state !== 'starting') {
        joinBtn.title = 'Join is only available before the tournament starts.';
      } else {
        joinBtn.title = '';
      }
    }

    if (viewBtn) {
      const canView = Boolean(selected && (selected.state === 'starting' || selected.state === 'active'));
      viewBtn.disabled = !canView;
    }

    if (createBtn) createBtn.disabled = false;
  }

  function renderTournamentRows(rows = []) {
    if (!browserListEl) return;
    clearNode(browserListEl);

    if (!rows.length) {
      browserListEl.appendChild(el('div', { className: 'menu-message' }, 'No live tournaments yet.'));
      return;
    }

    rows.forEach((row) => {
      const rowBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-browser-row' }), {
        variant: 'neutral',
        position: 'relative',
      });
      if (selectedTournamentId === row.id) rowBtn.classList.add('active');
      rowBtn.innerHTML = `
        <span class="tournament-browser-row__title">${row.label}</span>
        <span class="tournament-browser-row__meta">${row.state.toUpperCase()} | ${(row.phase || 'lobby').replace(/_/g, ' ')}</span>
        <span class="tournament-browser-row__meta">Host: ${row.hostUsername}</span>
        <span class="tournament-browser-row__meta">Players: ${row.playerCount} | Viewers: ${row.viewerCount}</span>
      `;
      rowBtn.addEventListener('click', () => {
        selectedTournamentId = row.id;
        renderTournamentRows(cachedRows);
        updateBrowserButtons();
      });
      browserListEl.appendChild(rowBtn);
    });
  }

  async function refreshBrowser() {
    if (browserStatusEl) browserStatusEl.textContent = 'Loading tournaments...';
    try {
      const payload = await apiGetTournaments();
      cachedRows = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
      botDifficultyOptions = Array.isArray(payload?.botDifficultyOptions) ? payload.botDifficultyOptions : [];
      browserTestModeEnabled = Boolean(payload?.testModeEnabled);
      if (selectedTournamentId && !cachedRows.some((entry) => entry.id === selectedTournamentId)) {
        selectedTournamentId = null;
      }
      renderTournamentRows(cachedRows);
      if (browserStatusEl) browserStatusEl.textContent = '';
      updateBrowserButtons();
    } catch (err) {
      if (browserStatusEl) browserStatusEl.textContent = err.message || 'Failed to load tournaments.';
    }
  }

  function openConfirmation({ titleText, messageText, confirmLabel = 'Confirm', confirmVariant = 'danger', onConfirm }) {
    confirmOverlay.content.innerHTML = '';
    const title = el('h2', { className: 'tournament-modal__title' }, titleText);
    const message = el('div', { className: 'menu-message tournament-modal__status' }, messageText);
    const actions = el('div', { className: 'tournament-modal__actions' });
    const confirmBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, confirmLabel), {
      variant: confirmVariant,
      position: 'relative',
    });
    const stayBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Stay'), {
      variant: 'neutral',
      position: 'relative',
    });
    actions.appendChild(confirmBtn);
    actions.appendChild(stayBtn);
    confirmOverlay.content.appendChild(title);
    confirmOverlay.content.appendChild(message);
    confirmOverlay.content.appendChild(actions);

    confirmBtn.addEventListener('click', async () => {
      try {
        await Promise.resolve(onConfirm && onConfirm());
        confirmOverlay.hide({ restoreFocus: false });
      } catch (err) {
        message.textContent = err?.message || 'Action failed.';
      }
    });

    stayBtn.addEventListener('click', () => {
      confirmOverlay.hide({ restoreFocus: false });
    });

    confirmOverlay.show();
  }

  async function handleLeaveRequest() {
    if (!currentTournament?.id) return;
    if (isReadOnlyTournamentView()) {
      closeTournamentPanel();
      return;
    }
    const roleFlags = buildRoleFlags(currentRole);
    const isCompletedTournament = currentTournament.phase === 'completed' || currentTournament.state === 'completed';

    if (roleFlags.isViewer) {
      await leaveCurrentTournament();
      return;
    }

    openConfirmation({
      titleText: 'Leave Tournament?',
      messageText: isCompletedTournament
        ? 'Are you sure you wish to leave this completed tournament?'
        : 'Are you sure you wish to leave? You will forfeit all subsequent tournament games.',
      confirmLabel: 'Leave',
      confirmVariant: 'danger',
      onConfirm: () => leaveCurrentTournament(),
    });
  }

  function renderBracketOverlay() {
    if (!currentTournament?.bracket) return;
    bracketOverlay.content.innerHTML = '';
    const title = el('h2', { className: 'tournament-modal__title' }, `${asText(currentTournament.label, 'Tournament')} Bracket`);
    const viewport = el('div', { className: 'tournament-bracket__viewport' });
    const stage = el('div', { className: 'tournament-bracket__stage' });
    const content = el('div', { className: 'tournament-bracket__content' });
    const connectorLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    connectorLayer.classList.add('tournament-bracket__connectors');
    viewport.appendChild(stage);
    stage.appendChild(connectorLayer);
    stage.appendChild(content);
    bracketOverlay.content.appendChild(title);
    bracketOverlay.content.appendChild(viewport);

    const pan = { x: 24, y: 24, scale: 1 };
    const applyPan = () => {
      stage.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${pan.scale})`;
    };
    applyPan();

    let dragStart = null;
    viewport.addEventListener('wheel', (event) => {
      event.preventDefault();
      pan.scale = Math.max(0.6, Math.min(2.2, pan.scale + (event.deltaY < 0 ? 0.1 : -0.1)));
      applyPan();
    }, { passive: false });
    viewport.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.tournament-bracket__match--clickable')) return;
      dragStart = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!dragStart) return;
      pan.x = dragStart.panX + (event.clientX - dragStart.x);
      pan.y = dragStart.panY + (event.clientY - dragStart.y);
      applyPan();
    });
    viewport.addEventListener('pointerup', () => {
      dragStart = null;
    });
    viewport.addEventListener('pointercancel', () => {
      dragStart = null;
    });

    const bracketParticipantLookup = new Map(
      (Array.isArray(currentTournament?.participants) ? currentTournament.participants : [])
        .filter((participant) => participant?.userId)
        .map((participant) => [String(participant.userId), participant])
    );

    const bracket = currentTournament.bracket || {};
    const normalizedBracket = {
      winnersRounds: cloneBracketRounds(
        Array.isArray(bracket?.winnersRounds)
          ? bracket.winnersRounds
          : (Array.isArray(bracket?.rounds) ? bracket.rounds : []),
      ),
      losersRounds: cloneBracketRounds(Array.isArray(bracket?.losersRounds) ? bracket.losersRounds : []),
      finalsRounds: cloneBracketRounds(
        Array.isArray(bracket?.finalsRounds)
          ? bracket.finalsRounds.filter((round) => round?.active !== false || (Array.isArray(round?.matches) && round.matches.some((match) => match?.winner || match?.playerA || match?.playerB)))
          : [],
      ),
    };
    const resetRoundIndex = normalizedBracket.finalsRounds.findIndex(
      (round) => round?.matches?.[0]?.finalStage === 'reset_final',
    );
    if (resetRoundIndex >= 0) {
      const resetRound = normalizedBracket.finalsRounds[resetRoundIndex];
      const resetMatch = resetRound?.matches?.[0] || null;
      const grandFinalRound = normalizedBracket.finalsRounds.find(
        (round) => round?.matches?.[0]?.finalStage === 'grand_final',
      ) || normalizedBracket.finalsRounds[0] || null;
      const hasVisibleReset = Boolean(
        resetMatch
        && (
          resetRound?.active !== false
          || resetMatch?.winner?.userId
          || resetMatch?.playerA?.userId
          || resetMatch?.playerB?.userId
        )
      );
      if (grandFinalRound?.matches?.[0] && hasVisibleReset) {
        grandFinalRound.label = resetRound?.label || 'Grand Finals Reset';
        grandFinalRound.matches[0].resetMatch = { ...resetMatch };
      }
      normalizedBracket.finalsRounds.splice(resetRoundIndex, 1);
    }

    const MATCH_HEIGHT = 116;
    const MATCH_GAP = 24;
    const ROUND_BODY_TOP = 12;
    const ROUND_WIDTH = 258;
    const ROUND_GAP = 48;
    const SECTION_GAP = 68;

    const statusElements = new Map();
    const slotNameElements = new Map();
    const matchPositions = new Map();
    const matchDataByKey = new Map();
    const sectionHeights = new Map();
    const allMatches = [];
    const buildMatchKey = (section, roundIndex, matchIndex) => `${section}:${roundIndex}:${matchIndex}`;
    const getWinnerRoundTop = (roundIndex, matchIndex) => {
      const spacingUnit = MATCH_HEIGHT + MATCH_GAP;
      const roundMultiplier = Math.pow(2, roundIndex);
      return ROUND_BODY_TOP
        + (((roundMultiplier - 1) * spacingUnit) / 2)
        + (matchIndex * roundMultiplier * spacingUnit);
    };
    const getFallbackSource = (sectionKey, roundIndex, matchIndex, slotKey) => {
      if (sectionKey === 'winnersRounds' && roundIndex > 0) {
        return {
          section: 'winnersRounds',
          roundIndex: roundIndex - 1,
          matchIndex: (matchIndex * 2) + (slotKey === 'A' ? 0 : 1),
        };
      }
      return null;
    };
    const createSvgNode = (tagName, attrs = {}) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tagName);
      Object.entries(attrs).forEach(([key, value]) => {
        if (value === undefined || value === null) return;
        node.setAttribute(key, String(value));
      });
      return node;
    };
    const getDisplayStatus = (status) => {
      const normalized = String(status || '').toLowerCase();
      if (normalized === 'active') return 'Active';
      if (normalized === 'completed' || normalized === 'bye') return 'Complete';
      return 'Waiting';
    };
    const getSourcePosition = (source) => {
      if (!source) return null;
      return matchPositions.get(buildMatchKey(source.section, source.roundIndex, source.matchIndex)) || null;
    };
    const getSlotPresentation = (match, slotKey, player) => {
      const identityEntry = resolveTournamentIdentityEntry(player, bracketParticipantLookup);
      if (player?.username) {
        return {
          label: player.username,
          className: 'tournament-bracket__slot-name',
          elo: resolveTournamentDisplayElo(identityEntry),
          isBot: isTournamentBot(identityEntry),
        };
      }
      const other = slotKey === 'A' ? match?.playerB : match?.playerA;
      if (String(match?.status || '').toLowerCase() === 'bye' && other?.userId) {
        return {
          label: 'BYE',
          className: 'tournament-bracket__slot-name tournament-bracket__slot-name--bye',
          elo: null,
          isBot: false,
        };
      }
      return {
        label: '_________',
        className: 'tournament-bracket__slot-name tournament-bracket__slot-name--placeholder',
        elo: null,
        isBot: false,
      };
    };
    const computeRoundPositions = (rounds, sectionKey) => {
      const sectionRounds = Array.isArray(rounds) ? rounds : [];
      let sectionHeight = MATCH_HEIGHT + (ROUND_BODY_TOP * 2);
      sectionRounds.forEach((round, roundIndex) => {
        const matches = Array.isArray(round?.matches) ? round.matches : [];
        let previousBottom = ROUND_BODY_TOP - MATCH_GAP;
        matches.forEach((match, matchIndex) => {
          const roundId = Number.isInteger(round?.roundIndex) ? round.roundIndex : roundIndex;
          const matchKey = buildMatchKey(sectionKey, roundId, matchIndex);
          const sourceCenters = [match?.sourceA, match?.sourceB]
            .map((source) => getSourcePosition(source))
            .filter(Boolean)
            .map((position) => position.center);

          let top = sectionKey === 'winnersRounds'
            ? getWinnerRoundTop(roundId, matchIndex)
            : ROUND_BODY_TOP + (matchIndex * (MATCH_HEIGHT + MATCH_GAP));
          if (sectionKey !== 'winnersRounds' && sourceCenters.length > 0) {
            const averageCenter = sourceCenters.reduce((sum, value) => sum + value, 0) / sourceCenters.length;
            top = averageCenter - (MATCH_HEIGHT / 2);
          }

          top = Math.max(ROUND_BODY_TOP, top);
          if (sectionKey !== 'winnersRounds' && top < previousBottom + MATCH_GAP) {
            top = previousBottom + MATCH_GAP;
          }

          matchPositions.set(matchKey, {
            top,
            center: top + (MATCH_HEIGHT / 2),
          });
          allMatches.push({
            match,
            matchKey,
            sectionKey,
            roundIndex: roundId,
            matchIndex,
          });
          matchDataByKey.set(matchKey, match);
          previousBottom = top + MATCH_HEIGHT;
          sectionHeight = Math.max(sectionHeight, previousBottom + ROUND_BODY_TOP);
        });
      });
      sectionHeights.set(sectionKey, sectionHeight);
    };

    computeRoundPositions(normalizedBracket.winnersRounds, 'winnersRounds');
    computeRoundPositions(normalizedBracket.losersRounds, 'losersRounds');
    computeRoundPositions(normalizedBracket.finalsRounds, 'finalsRounds');
    const stageHeight = Math.max(
      MATCH_HEIGHT + (ROUND_BODY_TOP * 2),
      ...Array.from(matchPositions.values()).map((position) => position.top + MATCH_HEIGHT + ROUND_BODY_TOP),
    );

    const buildMatchCard = (match, matchKey, side = 'winners') => {
      const isClickable = match?.status === 'active' && match?.matchId;
      const statusClass = String(match?.status || 'waiting').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const hasResetDisplay = Boolean(match?.resetMatch);
      const matchWrap = el('div', {
        className: `tournament-bracket__match-wrap tournament-bracket__match-wrap--${side}${hasResetDisplay ? ' tournament-bracket__match-wrap--wide' : ''}`,
      });
      const position = matchPositions.get(matchKey);
      if (position) {
        matchWrap.style.top = `${position.top}px`;
      }

      const matchCard = el('button', {
        type: 'button',
        className: `tournament-bracket__match tournament-bracket__match--${side} tournament-bracket__match--status-${statusClass}${isClickable ? ' tournament-bracket__match--clickable' : ''}${hasResetDisplay ? ' tournament-bracket__match--wide' : ''}`,
      });
      if (!isClickable) {
        matchCard.disabled = true;
      }

      const buildScoreSegment = (wins, target, name) => {
        const total = Math.max(0, Number(target) || 0);
        if (total <= 0) return null;
        const segment = el('div', { className: 'tournament-bracket__slot-score-segment' });
        const filled = Math.max(0, Math.min(total, Number(wins) || 0));
        for (let index = 0; index < filled; index += 1) {
          const icon = createThroneIcon({
            size: 14,
            alt: `${name || 'Player'} win`,
            title: `${name || 'Player'} win ${index + 1}`,
          });
          icon.classList.add('tournament-bracket__score-token');
          segment.appendChild(icon);
        }
        for (let index = filled; index < total; index += 1) {
          const icon = createThroneIcon({
            size: 14,
            alt: `${name || 'Player'} pending win`,
            title: `${name || 'Player'} pending win ${index + 1}`,
          });
          icon.classList.add('tournament-bracket__score-token', 'tournament-bracket__score-token--empty');
          segment.appendChild(icon);
        }
        return segment;
      };

      const buildSlotScore = ({ wins, target, name, resetWins = null, resetTarget = 0 } = {}) => {
        const primarySegment = buildScoreSegment(wins, target, name);
        const secondarySegment = buildScoreSegment(resetWins, resetTarget, `${name || 'Player'} reset`);
        if (!primarySegment && !secondarySegment) return null;
        const scoreWrap = el('div', {
          className: `tournament-bracket__slot-score${secondarySegment ? ' tournament-bracket__slot-score--reset' : ''}`,
        });
        if (primarySegment) {
          scoreWrap.appendChild(primarySegment);
        }
        if (secondarySegment) {
          scoreWrap.appendChild(el('span', { className: 'tournament-bracket__score-separator' }, '|'));
          scoreWrap.appendChild(secondarySegment);
        }
        return scoreWrap;
      };

      const buildSlot = (player, slotKey, slotClass, wins = 0, target = 0) => {
        const slot = el('div', { className: `tournament-bracket__slot ${slotClass}` });
        const presentation = getSlotPresentation(match, slotKey, player);
        const slotName = el('span', { className: presentation.className }, presentation.label);
        const identity = el('div', { className: 'tournament-bracket__slot-identity' });
        if (presentation.isBot) {
          const botIcon = createBotIcon({
            size: 18,
            alt: `${presentation.label} bot`,
            title: `${presentation.label} bot`,
          });
          botIcon.classList.add('tournament-bracket__slot-bot');
          identity.appendChild(botIcon);
        } else if (Number.isFinite(presentation.elo)) {
          const eloBadge = createEloBadge({
            elo: presentation.elo,
            size: 18,
            variant: 'light',
            alt: `${presentation.label} Elo`,
            title: `${presentation.label} Elo ${Math.round(presentation.elo)}`,
          });
          eloBadge.classList.add('tournament-bracket__slot-elo');
          identity.appendChild(eloBadge);
        }
        identity.appendChild(slotName);
        slot.appendChild(identity);
        const score = buildSlotScore({
          wins,
          target,
          name: presentation.label,
          resetWins: slotKey === 'A' ? match?.resetMatch?.playerAScore : match?.resetMatch?.playerBScore,
          resetTarget: match?.resetMatch?.winScoreTarget || 0,
        });
        if (score) {
          slot.appendChild(score);
        }
        slotNameElements.set(`${matchKey}:${slotKey}`, slotName);
        return slot;
      };

      matchCard.appendChild(buildSlot(match?.playerA, 'A', 'tournament-bracket__slot--top', match?.playerAScore, match?.winScoreTarget));
      matchCard.appendChild(buildSlot(match?.playerB, 'B', 'tournament-bracket__slot--bottom', match?.playerBScore, match?.winScoreTarget));
      const statusTab = el('div', { className: 'tournament-bracket__match-status' }, getDisplayStatus(match?.status));
      matchWrap.appendChild(matchCard);
      matchWrap.appendChild(statusTab);
      statusElements.set(matchKey, statusTab);

      if (isClickable) {
        matchCard.addEventListener('click', () => {
          bracketOverlay.hide({ restoreFocus: false });
          if (typeof onSpectateMatch === 'function') {
            onSpectateMatch(match.matchId);
          }
        });
      }
      return matchWrap;
    };

    const buildSide = (rounds, side, heading, sectionKey) => {
      if (!Array.isArray(rounds) || rounds.length === 0) return null;
      const sideWrap = el('section', { className: `tournament-bracket__side tournament-bracket__side--${side}` });
      if (heading) {
        sideWrap.appendChild(el('div', { className: 'tournament-bracket__side-title' }, heading));
      }
      const grid = el('div', { className: `tournament-bracket__grid tournament-bracket__grid--${side}` });
      const sectionHeight = sectionHeights.get(sectionKey) || stageHeight;
      rounds.forEach((round, roundIndex) => {
        const matches = Array.isArray(round?.matches) ? round.matches : [];
        const hasWideMatch = matches.some((match) => Boolean(match?.resetMatch));
        const roundColumn = el('div', { className: `tournament-bracket__round${hasWideMatch ? ' tournament-bracket__round--wide' : ''}` });
        roundColumn.appendChild(el('div', { className: 'tournament-bracket__round-label' }, round.label || 'Round'));
        const roundBody = el('div', { className: `tournament-bracket__round-body${hasWideMatch ? ' tournament-bracket__round-body--wide' : ''}` });
        roundBody.style.height = `${sectionHeight}px`;
        matches.forEach((match, matchIndex) => {
          const roundId = Number.isInteger(round?.roundIndex) ? round.roundIndex : roundIndex;
          roundBody.appendChild(buildMatchCard(match, buildMatchKey(sectionKey, roundId, matchIndex), side));
        });
        roundColumn.appendChild(roundBody);
        grid.appendChild(roundColumn);
      });
      sideWrap.appendChild(grid);
      return sideWrap;
    };

    content.style.setProperty('--tournament-stage-height', `${stageHeight}px`);
    content.style.setProperty('--tournament-round-width', `${ROUND_WIDTH}px`);
    content.style.setProperty('--tournament-round-width-wide', '336px');
    content.style.setProperty('--tournament-round-gap', `${ROUND_GAP}px`);
    content.style.setProperty('--tournament-section-gap', `${SECTION_GAP}px`);

    const winnersSide = buildSide(
      normalizedBracket.winnersRounds,
      'winners',
      normalizedBracket.losersRounds.length || normalizedBracket.finalsRounds.length ? 'Winners Bracket' : '',
      'winnersRounds',
    );
    const finalsSide = buildSide(
      normalizedBracket.finalsRounds,
      'finals',
      normalizedBracket.losersRounds.length ? 'Finals' : '',
      'finalsRounds',
    );
    const losersSide = buildSide(
      normalizedBracket.losersRounds,
      'losers',
      'Losers Bracket',
      'losersRounds',
    );

    if (losersSide) {
      content.classList.add('tournament-bracket__content--double');
      const stack = el('div', { className: 'tournament-bracket__stack' });
      if (winnersSide) {
        stack.appendChild(winnersSide);
      }
      stack.appendChild(losersSide);
      content.appendChild(stack);
      if (finalsSide) {
        content.appendChild(finalsSide);
      }
    } else {
      if (winnersSide) {
        content.appendChild(winnersSide);
      }
      if (finalsSide) {
        content.appendChild(finalsSide);
      }
    }

    const drawConnectors = () => {
      clearNode(connectorLayer);
      const contentRect = content.getBoundingClientRect();
      const width = Math.max(1, Math.ceil(contentRect.width));
      const height = Math.max(1, Math.ceil(contentRect.height));
      connectorLayer.setAttribute('width', width);
      connectorLayer.setAttribute('height', height);
      connectorLayer.setAttribute('viewBox', `0 0 ${width} ${height}`);
      connectorLayer.style.width = `${width}px`;
      connectorLayer.style.height = `${height}px`;

      allMatches.forEach(({ match, matchKey, sectionKey, roundIndex, matchIndex }) => {
        ['A', 'B'].forEach((slotKey) => {
          const source = (slotKey === 'A' ? match?.sourceA : match?.sourceB)
            || getFallbackSource(sectionKey, roundIndex, matchIndex, slotKey);
          if (!source) return;
          const sourceKey = buildMatchKey(source.section, source.roundIndex, source.matchIndex);
          const sourceMatch = matchDataByKey.get(sourceKey) || null;
          const connectorKind = source.outcome === 'loser' ? 'loser' : 'advance';
          const sourceStatusVariant = getDisplayStatus(sourceMatch?.status) === 'Complete' ? 'complete' : 'pending';
          const sourceStatusEl = statusElements.get(sourceKey) || null;
          const targetNameEl = slotNameElements.get(`${matchKey}:${slotKey}`) || null;
          if (!sourceStatusEl || !targetNameEl) return;

          const sourceRect = sourceStatusEl.getBoundingClientRect();
          const targetRect = targetNameEl.getBoundingClientRect();
          const sourceOnLeft = sourceRect.left <= targetRect.left;
          const startX = (sourceRect.left + (sourceRect.width / 2)) - contentRect.left;
          const endX = sourceOnLeft
            ? (targetRect.left - contentRect.left)
            : (targetRect.right - contentRect.left);
          const startY = (sourceRect.top + (sourceRect.height / 2)) - contentRect.top;
          const endY = (targetRect.top + (targetRect.height / 2)) - contentRect.top;
          const curve = Math.max(52, Math.min(140, Math.abs(endX - startX) * 0.5));
          const control1X = sourceOnLeft ? (startX + curve) : (startX - curve);
          const control2X = sourceOnLeft ? (endX - curve) : (endX + curve);

          connectorLayer.appendChild(createSvgNode('path', {
            class: `tournament-bracket__connector tournament-bracket__connector--${connectorKind} tournament-bracket__connector--${sourceStatusVariant}`,
            d: `M ${startX} ${startY} C ${control1X} ${startY}, ${control2X} ${endY}, ${endX} ${endY}`,
          }));
          connectorLayer.appendChild(createSvgNode('circle', {
            class: `tournament-bracket__connector-node tournament-bracket__connector-node--${connectorKind} tournament-bracket__connector-node--${sourceStatusVariant}`,
            cx: startX,
            cy: startY,
            r: 2.25,
          }));
          connectorLayer.appendChild(createSvgNode('circle', {
            class: `tournament-bracket__connector-node tournament-bracket__connector-node--${connectorKind} tournament-bracket__connector-node--${sourceStatusVariant}`,
            cx: endX,
            cy: endY,
            r: 2.25,
          }));
        });
      });
    };

    bracketOverlay.show();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        drawConnectors();
      });
    });
  }

  function renderPanel() {
    stopRoundRobinTimer();
    clearNode(hostColumn);
    clearNode(sideColumn);
    clearNode(participantColumn);
    clearNode(stageSurface);
    clearNode(stagePlaceholderActions);
    stageSurface.hidden = false;
    stagePlaceholder.hidden = true;
    stagePlaceholder.setAttribute('hidden', 'hidden');
    stagePlaceholderTitle.textContent = '';
    stagePlaceholderBody.textContent = '';

    if (!currentTournament || (!currentRole && !isReadOnlyTournamentView())) {
      syncPanelSections({ showStage: false });
      stageSurface.hidden = true;
      return;
    }

    const roleFlags = buildRoleFlags(currentRole);
    const isReadOnlyView = isReadOnlyTournamentView();
    syncPanelTabLabels(roleFlags);
    const currentUserGame = currentTournament.currentUserGame || null;
    const showStageSection = shouldShowTournamentStage(currentTournament, {
      isInTournamentGame,
      currentUserGame,
      isReadOnlyView,
    });
    syncPanelSections({ showStage: showStageSection });
    stageSurface.hidden = !showStageSection;
    stagePlaceholderTitle.textContent = (!showStageSection || isReadOnlyView) ? '' : 'Current Game';
    stagePlaceholderBody.textContent = (!showStageSection || isReadOnlyView)
      ? ''
      : 'Waiting for your next tournament game.';
    const currentConfig = normalizeTournamentConfig(currentTournament.config);
    const editableConfig = settingsDirty ? settingsDraft : currentConfig;
    const participants = Array.isArray(currentTournament.participants) ? currentTournament.participants : [];
    const phaseTimerText = getTournamentPhaseTimer(currentTournament, getTournamentServerNowMs());
    const currentUserRequiresAccept = Boolean(currentUserGame?.requiresAccept && currentUserGame?.gameId && Number.isInteger(currentUserGame?.color));
    const tournamentStatusHint = getTournamentStatusHint(currentTournament, {
      isInTournamentGame,
      currentUserGame,
      currentUserRequiresAccept,
    });

    if (currentTournament.phase === 'completed') {
      const placements = buildCompletedPlacements(participants, currentTournament.bracket);
      const resultsWrap = el('div', { className: 'tournament-panel__results' });
      const resultsCard = el('div', { className: 'tournament-panel__results-card' });
      resultsCard.appendChild(el('div', { className: 'tournament-panel__results-title' }, 'Final Results'));
      const resultsHeader = el('div', { className: 'tournament-panel__results-header' });
      resultsHeader.appendChild(el('div', { className: 'tournament-panel__results-head tournament-panel__results-head--place' }, 'Placement'));
      resultsHeader.appendChild(el('div', { className: 'tournament-panel__results-head tournament-panel__results-head--name' }, 'Name'));
      resultsHeader.appendChild(el('div', { className: 'tournament-panel__results-head tournament-panel__results-head--losers' }, 'Deepest Losers'));
      resultsHeader.appendChild(el('div', { className: 'tournament-panel__results-head tournament-panel__results-head--winners' }, 'Deepest Winners'));
      resultsHeader.appendChild(el('div', { className: 'tournament-panel__results-head tournament-panel__results-head--points' }, 'Points'));
      resultsCard.appendChild(resultsHeader);
      const resultsList = el('div', { className: 'tournament-panel__results-list' });
      placements.forEach((entry) => {
        const row = el('div', { className: 'tournament-panel__results-row' });
        const place = el('div', { className: 'tournament-panel__results-place' });
        place.appendChild(el('span', { className: 'tournament-panel__results-place-label' }, entry.label));
        if (entry.position <= 3) {
          const icon = createThroneIcon({
            size: 20,
            alt: `${entry.label} place`,
            title: `${entry.label} place`,
          });
          icon.classList.add('tournament-panel__results-icon', `tournament-panel__results-icon--${entry.position}`);
          place.appendChild(icon);
        }
        row.appendChild(place);
        const nameCell = el('div', { className: 'tournament-panel__results-name' });
        const eloValue = resolveTournamentDisplayElo(entry.participant);
        if (isTournamentBot(entry.participant)) {
          const botIcon = createBotIcon({
            size: 20,
            alt: `${entry.participant?.username || 'Bot'} bot`,
            title: `${entry.participant?.username || 'Bot'} bot`,
          });
          botIcon.classList.add('tournament-panel__results-bot');
          nameCell.appendChild(botIcon);
        } else if (Number.isFinite(eloValue)) {
          const eloBadge = createEloBadge({
            elo: eloValue,
            size: 22,
            variant: 'light',
            alt: `${entry.participant?.username || 'Player'} Elo`,
            title: `${entry.participant?.username || 'Player'} Elo ${Math.round(eloValue)}`,
          });
          eloBadge.classList.add('tournament-panel__results-elo');
          nameCell.appendChild(eloBadge);
        }
        nameCell.appendChild(el('span', { className: 'tournament-panel__results-name-label' }, entry.participant?.username || 'Player'));
        row.appendChild(nameCell);
        row.appendChild(el('div', { className: 'tournament-panel__results-depth' }, formatPlacementDepth(entry.deepestLosersRound, {
          section: 'losers',
          bracket: currentTournament?.bracket,
        })));
        row.appendChild(el('div', { className: 'tournament-panel__results-depth' }, formatPlacementDepth(
          entry.deepestFinalsRound >= 0 ? entry.deepestFinalsRound : entry.deepestWinnersRound,
          {
            section: entry.deepestFinalsRound >= 0 ? 'finals' : 'winners',
            bracket: currentTournament?.bracket,
          },
        )));
        row.appendChild(el('div', { className: 'tournament-panel__results-points' }, formatStandingPoints(entry.points)));
        resultsList.appendChild(row);
      });
      resultsCard.appendChild(resultsList);
      resultsWrap.appendChild(resultsCard);
      stageSurface.appendChild(resultsWrap);
    }

    const hasHost = Boolean(currentTournament.host?.userId);
    const hostCard = el('div', { className: 'tournament-panel__card tournament-panel__card--host' });
    hostCard.appendChild(el('div', { className: 'tournament-panel__card-title' }, hasHost ? 'Host Controls' : 'Tournament Status'));
    hostCard.appendChild(el('div', { className: 'tournament-panel__host-name' }, hasHost ? (currentTournament.host?.username || 'Tournament Host') : 'Autopilot'));
    const statsRow = el('div', { className: 'tournament-panel__stats' });
    statsRow.appendChild(el('div', { className: 'tournament-panel__stat' }, `Viewers: ${Number(currentTournament.viewerCount || 0)}`));
    hostCard.appendChild(statsRow);

    const settingsList = el('div', { className: 'tournament-panel__settings' });
    const hostCanEditSettings = !isReadOnlyView && roleFlags.isHost && currentTournament.state === 'starting';
    const hostCanEditBreakTime = !isReadOnlyView && roleFlags.isHost && Boolean(currentTournament.canEditBreakTime) && currentTournament.state !== 'starting';
    if (hostCanEditSettings) {
      const { field: breakField, input: breakInput } = createTournamentNumberSettingField('Break time', {
        value: editableConfig.breakMinutes,
        min: 0,
        max: 30,
      });
      settingsList.appendChild(breakField);

      const { field: minutesField, input: minutesInput } = createTournamentNumberSettingField('Round robin', {
        value: editableConfig.roundRobinMinutes,
        min: 1,
        max: 30,
      });
      settingsList.appendChild(minutesField);

      const styleField = el('label', { className: 'tournament-panel__setting-field' });
      styleField.appendChild(el('span', { className: 'tournament-panel__setting-label' }, 'Elimination'));
      const styleSelect = el('select', { className: 'tournament-panel__setting-input' });
      styleSelect.innerHTML = '<option value="single">Single</option><option value="double">Double</option>';
      styleSelect.value = editableConfig.eliminationStyle;
      styleField.appendChild(styleSelect);
      settingsList.appendChild(styleField);

      const victoryField = el('label', { className: 'tournament-panel__setting-field' });
      victoryField.appendChild(el('span', { className: 'tournament-panel__setting-label' }, 'Victory target'));
      const victorySelect = el('select', { className: 'tournament-panel__setting-input' });
      victorySelect.innerHTML = '<option value="3">3</option><option value="4">4</option><option value="5">5</option>';
      victorySelect.value = String(editableConfig.victoryPoints);
      victoryField.appendChild(victorySelect);
      settingsList.appendChild(victoryField);

      const settingsActions = el('div', { className: 'tournament-panel__actions' });
      const saveSettingsBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Save Settings'), {
        variant: 'neutral',
        position: 'relative',
      });
      const syncSettingsDraft = () => {
        settingsDraft = normalizeTournamentConfig({
          breakMinutes: breakInput.value,
          roundRobinMinutes: minutesInput.value,
          eliminationStyle: styleSelect.value,
          victoryPoints: victorySelect.value,
        });
        settingsDirty = settingsDraft.breakMinutes !== currentConfig.breakMinutes
          || settingsDraft.roundRobinMinutes !== currentConfig.roundRobinMinutes
          || settingsDraft.eliminationStyle !== currentConfig.eliminationStyle
          || settingsDraft.victoryPoints !== currentConfig.victoryPoints;
        saveSettingsBtn.disabled = !settingsDirty;
      };
      breakInput.addEventListener('input', syncSettingsDraft);
      minutesInput.addEventListener('input', syncSettingsDraft);
      styleSelect.addEventListener('change', syncSettingsDraft);
      victorySelect.addEventListener('change', syncSettingsDraft);
      saveSettingsBtn.disabled = !settingsDirty;
      saveSettingsBtn.addEventListener('click', async () => {
        syncSettingsDraft();
        if (!settingsDirty) return;
        await apiUpdateTournamentConfig({
          tournamentId: currentTournament.id,
          config: settingsDraft,
        });
        settingsDirty = false;
        await refreshCurrentTournament({ tournamentId: currentTournament.id });
      });
      settingsActions.appendChild(saveSettingsBtn);
      settingsList.appendChild(settingsActions);
    } else if (hostCanEditBreakTime) {
      appendTournamentSettingSummary(settingsList, currentConfig, { includeBreakTime: false });

      const { field: breakField, input: breakInput } = createTournamentNumberSettingField('Break time', {
        value: editableConfig.breakMinutes,
        min: 0,
        max: 30,
      });
      settingsList.appendChild(breakField);

      const settingsActions = el('div', { className: 'tournament-panel__actions' });
      const saveBreakBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Save Break Time'), {
        variant: 'neutral',
        position: 'relative',
      });
      const syncBreakDraft = () => {
        settingsDraft = normalizeTournamentConfig({
          ...currentConfig,
          breakMinutes: breakInput.value,
        });
        settingsDirty = settingsDraft.breakMinutes !== currentConfig.breakMinutes;
        saveBreakBtn.disabled = !settingsDirty;
      };
      breakInput.addEventListener('input', syncBreakDraft);
      saveBreakBtn.disabled = !settingsDirty;
      saveBreakBtn.addEventListener('click', async () => {
        syncBreakDraft();
        if (!settingsDirty) return;
        await apiUpdateTournamentConfig({
          tournamentId: currentTournament.id,
          config: { breakMinutes: settingsDraft.breakMinutes },
        });
        settingsDirty = false;
        await refreshCurrentTournament({ tournamentId: currentTournament.id });
      });
      settingsActions.appendChild(saveBreakBtn);
      settingsList.appendChild(settingsActions);
    } else {
      appendTournamentSettingSummary(settingsList, currentConfig);
    }
    hostCard.appendChild(settingsList);

    const controls = el('div', { className: 'tournament-panel__actions' });
    const alreadyPlayer = participants.some((entry) => String(entry?.userId || '') === String(getSessionInfo?.()?.userId || ''));

    if (!isReadOnlyView && currentTournament.state === 'starting' && !alreadyPlayer) {
      const joinPlayerBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Join as Player'), {
        variant: 'neutral',
        position: 'relative',
      });
      joinPlayerBtn.addEventListener('click', async () => {
        await apiJoinTournament({ tournamentId: currentTournament.id, role: 'player' });
        await refreshCurrentTournament({ tournamentId: currentTournament.id });
      });
      controls.appendChild(joinPlayerBtn);
    }

    if (!isReadOnlyView && roleFlags.isHost && currentTournament.state === 'starting') {
      const startBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--danger' }, 'Start Tournament'), {
        variant: 'danger',
        position: 'relative',
      });
      startBtn.addEventListener('click', async () => {
        await apiStartTournament({ tournamentId: currentTournament.id });
        await refreshCurrentTournament({ tournamentId: currentTournament.id });
      });
      controls.appendChild(startBtn);

      const addBotBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Add Bot'), {
        variant: 'neutral',
        position: 'relative',
      });
      addBotBtn.addEventListener('click', () => {
        openAddBotModal();
      });
      controls.appendChild(addBotBtn);

      const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--danger' }, 'Cancel Tournament'), {
        variant: 'danger',
        position: 'relative',
      });
      cancelBtn.addEventListener('click', () => {
        openConfirmation({
          titleText: 'Cancel Tournament?',
          messageText: 'This will close the tournament for everyone.',
          confirmLabel: 'Cancel Tournament',
          confirmVariant: 'danger',
          onConfirm: async () => {
            await apiCancelTournament({ tournamentId: currentTournament.id });
            setCurrentTournamentState(null);
            browserOverlay.show();
            await refreshBrowser();
          },
        });
      });
      controls.appendChild(cancelBtn);
    }

    if (!isReadOnlyView && roleFlags.isHost && currentTournament.canStartElimination) {
      const eliminationBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--danger' }, 'Start Elimination'), {
        variant: 'danger',
        position: 'relative',
      });
      eliminationBtn.addEventListener('click', async () => {
        await apiStartTournamentElimination({ tournamentId: currentTournament.id });
        await refreshCurrentTournament({ tournamentId: currentTournament.id });
      });
      controls.appendChild(eliminationBtn);
    }

    hostCard.appendChild(controls);

    const messageWrap = el('div', { className: 'tournament-panel__message' });
    messageWrap.appendChild(el('div', { className: 'tournament-panel__subheading' }, hasHost ? 'Host Message' : 'Tournament Message'));
    const messageInput = el('textarea', {
      className: 'tournament-panel__message-input',
      rows: '4',
      placeholder: (!isReadOnlyView && roleFlags.isHost) ? 'Share a message with the tournament.' : (hasHost ? 'No host message yet.' : 'Tournament is running on autopilot.'),
    });
    messageInput.value = (!isReadOnlyView && roleFlags.isHost) ? messageDraft : asText(currentTournament.message, '');
    messageInput.readOnly = isReadOnlyView || !roleFlags.isHost;
    messageWrap.appendChild(messageInput);
    if (!isReadOnlyView && roleFlags.isHost) {
      const saveMessageBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Save Message'), {
        variant: 'neutral',
        position: 'relative',
      });
      messageInput.addEventListener('input', () => {
        messageDraft = messageInput.value;
        messageDirty = true;
      });
      saveMessageBtn.addEventListener('click', async () => {
        await apiUpdateTournamentMessage({
          tournamentId: currentTournament.id,
          message: messageDraft,
        });
        messageDirty = false;
        await refreshCurrentTournament({ tournamentId: currentTournament.id });
      });
      messageWrap.appendChild(saveMessageBtn);
    }
    hostCard.appendChild(messageWrap);
    hostColumn.appendChild(hostCard);

    const sideTop = el('div', { className: 'tournament-panel__card tournament-panel__card--summary' });
    sideTop.appendChild(el('div', { className: 'tournament-panel__tournament-name' }, asText(currentTournament.label, 'Tournament')));
    sideTop.appendChild(el('div', { className: 'tournament-panel__status-line' }, `${formatPhaseLabel(currentTournament.phase)} | ${currentTournament.currentRoundLabel || 'Tournament'}`));
    if (phaseTimerText) {
      roundRobinTimerEl = el('div', { className: 'tournament-panel__status-line' }, phaseTimerText);
      sideTop.appendChild(roundRobinTimerEl);
    }
    if (tournamentStatusHint) {
      sideTop.appendChild(el('div', { className: 'tournament-panel__status-line' }, tournamentStatusHint));
    }

    const sideActions = el('div', { className: 'tournament-panel__actions tournament-panel__actions--summary' });
    const leaveBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--danger' }, isReadOnlyView ? 'Close Tournament' : 'Leave Tournament'), {
      variant: isReadOnlyView ? 'neutral' : 'danger',
      position: 'relative',
    });
    leaveBtn.addEventListener('click', () => {
      handleLeaveRequest().catch((err) => {
        try {
          window.alert(err.message || 'Unable to leave tournament.');
        } catch (_) {}
      });
    });
    sideActions.appendChild(leaveBtn);

    if (currentTournament.bracket) {
      const bracketBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-panel__bracket-button' }), {
        variant: 'neutral',
        position: 'relative',
      });
      bracketBtn.appendChild(el('img', {
        className: 'tournament-panel__bracket-icon',
        src: '/assets/images/Tournement.png',
        alt: 'Bracket',
      }));
      bracketBtn.appendChild(el('span', {}, 'Bracket'));
      bracketBtn.addEventListener('click', () => {
        renderBracketOverlay();
      });
      sideActions.appendChild(bracketBtn);
    }

    sideTop.appendChild(sideActions);
    sideColumn.appendChild(sideTop);

    const rosterCard = el('div', { className: 'tournament-panel__card tournament-panel__card--roster' });
    rosterCard.appendChild(el('div', { className: 'tournament-panel__subheading' }, 'Participants'));
    const rosterList = el('div', { className: 'tournament-panel__roster' });
    if (!participants.length) {
      rosterList.appendChild(el('div', { className: 'menu-message' }, 'No tournament players yet.'));
    } else {
      const table = el('table', { className: 'tournament-panel__roster-table' });
      const thead = el('thead');
      const headerRow = el('tr');
      headerRow.appendChild(el('th', { className: 'tournament-panel__roster-header tournament-panel__roster-header--name' }, 'Player'));
      headerRow.appendChild(el('th', { className: 'tournament-panel__roster-header tournament-panel__roster-header--points' }, 'Points'));
      headerRow.appendChild(el('th', { className: 'tournament-panel__roster-header tournament-panel__roster-header--action' }, 'Action'));
      headerRow.appendChild(el('th', { className: 'tournament-panel__roster-header tournament-panel__roster-header--seed' }, 'Seed'));
      thead.appendChild(headerRow);
      table.appendChild(thead);

      const tbody = el('tbody');
      participants.forEach((participant) => {
        const row = el('tr', { className: 'tournament-panel__participant-row' });
        const nameCell = el('td', { className: 'tournament-panel__participant-name-cell' });
        const identity = el('div', { className: 'tournament-panel__participant-identity' });
        if (isTournamentBot(participant)) {
          const botIcon = createBotIcon({
            size: 20,
            alt: `${participant.username || 'Bot'} bot`,
            title: `${participant.username || 'Bot'} bot`,
          });
          botIcon.classList.add('tournament-panel__participant-bot');
          identity.appendChild(botIcon);
        } else {
          const eloValue = resolveTournamentDisplayElo(participant);
          if (Number.isFinite(eloValue)) {
            const eloBadge = createEloBadge({
              elo: eloValue,
              size: 20,
              variant: 'light',
              alt: 'Pre-tournament ELO',
              title: `Pre-tournament ELO: ${Math.round(eloValue).toLocaleString()}`,
            });
            eloBadge.classList.add('tournament-panel__participant-elo');
            identity.appendChild(eloBadge);
          }
        }
        identity.appendChild(el('div', { className: 'tournament-panel__participant-name' }, participant.username || 'Player'));
        nameCell.appendChild(identity);
        row.appendChild(nameCell);

        const pointsCell = el('td', { className: 'tournament-panel__participant-points-cell' });
        pointsCell.appendChild(el('div', { className: 'tournament-panel__participant-points' }, formatStandingPoints(participant.points)));
        row.appendChild(pointsCell);

        const actionCell = el('td', { className: 'tournament-panel__participant-action-cell' });
        if (!isReadOnlyView && roleFlags.isHost && currentTournament.state === 'starting' && String(participant.userId || '') !== String(currentTournament.host?.userId || '')) {
          const kickBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, participant.type === 'bot' ? 'Remove Bot' : 'Remove'), {
            variant: 'neutral',
            position: 'relative',
          });
          kickBtn.addEventListener('click', async () => {
            try {
              await apiKickTournamentPlayer({
                tournamentId: currentTournament.id,
                userId: participant.userId,
              });
              await refreshCurrentTournament({ tournamentId: currentTournament.id });
            } catch (err) {
              try {
                window.alert(err.message || 'Unable to remove player.');
              } catch (_) {}
            }
          });
          actionCell.appendChild(kickBtn);
        } else if (participant.activeGame?.matchId) {
          const watchBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Watch'), {
            variant: 'neutral',
            position: 'relative',
          });
          watchBtn.addEventListener('click', () => {
            if (typeof onSpectateMatch === 'function') {
              onSpectateMatch(participant.activeGame.matchId);
            }
          });
          actionCell.appendChild(watchBtn);
        } else if (!isReadOnlyView && String(participant.userId || '') === String(getSessionInfo?.()?.userId || '') && participant.activeGame?.requiresAccept) {
          const acceptBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--danger' }, 'Accept'), {
            variant: 'danger',
            position: 'relative',
          });
          acceptBtn.addEventListener('click', async () => {
            try {
              await apiReady(participant.activeGame.gameId, participant.activeGame.color);
              await refreshCurrentTournament({ tournamentId: currentTournament.id, silent: true });
            } catch (err) {
              try {
                window.alert(err.message || 'Unable to accept tournament match.');
              } catch (_) {}
            }
          });
          actionCell.appendChild(acceptBtn);
        }
        row.appendChild(actionCell);
        const seedCell = el('td', { className: 'tournament-panel__participant-seed-cell' });
        seedCell.appendChild(participant.seed
          ? el('div', { className: 'tournament-panel__seed-pill' }, String(participant.seed))
          : el('div', { className: 'tournament-panel__seed-pill tournament-panel__seed-pill--empty' }, '-'));
        row.appendChild(seedCell);
        tbody.appendChild(row);
      });
      table.appendChild(tbody);
      rosterList.appendChild(table);
    }
    rosterCard.appendChild(rosterList);
    participantColumn.appendChild(rosterCard);
    startRoundRobinTimer();
  }

  function buildBrowserModal() {
    const { title, status, section } = createModalShell('Tournament Browser');
    const topRow = el('div', { className: 'tournament-modal__actions' });

    createBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Create'), {
      variant: 'neutral',
      position: 'relative',
    });
    joinBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Join'), {
      variant: 'neutral',
      position: 'relative',
    });
    viewBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'View'), {
      variant: 'neutral',
      position: 'relative',
    });

    topRow.appendChild(createBtn);
    topRow.appendChild(joinBtn);
    topRow.appendChild(viewBtn);

    browserStatusEl = status;
    browserListEl = el('div', { className: 'tournament-browser-list' });

    browserOverlay.content.appendChild(title);
    browserOverlay.content.appendChild(topRow);
    browserOverlay.content.appendChild(browserStatusEl);
    section.appendChild(browserListEl);
    browserOverlay.content.appendChild(section);

    createBtn.addEventListener('click', () => {
      browserOverlay.hide({ restoreFocus: false });
      openCreateModal();
    });

    joinBtn.addEventListener('click', async () => {
      if (!selectedTournamentId) return;
      try {
        await apiJoinTournament({ tournamentId: selectedTournamentId, role: 'player' });
        browserOverlay.hide({ restoreFocus: false });
        await refreshCurrentTournament({ tournamentId: selectedTournamentId });
      } catch (err) {
        if (browserStatusEl) browserStatusEl.textContent = err.message || 'Failed to join tournament.';
      }
    });

    viewBtn.addEventListener('click', async () => {
      if (!selectedTournamentId) return;
      try {
        await apiJoinTournament({ tournamentId: selectedTournamentId, role: 'viewer' });
        browserOverlay.hide({ restoreFocus: false });
        await refreshCurrentTournament({ tournamentId: selectedTournamentId });
      } catch (err) {
        if (browserStatusEl) browserStatusEl.textContent = err.message || 'Unable to load tournament.';
      }
    });
  }

  function openCreateModal() {
    createOverlayModal.content.innerHTML = '';
    const { title, status, section } = createModalShell('Create Tournament');
    const labelInput = el('input', { type: 'text', placeholder: 'Tournament label', maxlength: '60' });
    const minutesInput = el('input', { type: 'number', min: '1', max: '30', value: '15' });
    const breakInput = el('input', { type: 'number', min: '0', max: '30', value: '5' });
    const styleSelect = el('select');
    styleSelect.innerHTML = '<option value="single">Single Elimination</option><option value="double">Double Elimination</option>';
    const victorySelect = el('select');
    victorySelect.innerHTML = '<option value="3">3</option><option value="4">4</option><option value="5">5</option>';
    const saveBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Create Tournament'), {
      variant: 'neutral',
      position: 'relative',
    });
    const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Cancel'), {
      variant: 'neutral',
      position: 'relative',
    });

    const row = (label, control) => {
      const wrap = el('label', { className: 'tournament-modal__field' });
      wrap.appendChild(el('span', {}, label));
      wrap.appendChild(control);
      return wrap;
    };

    createOverlayModal.content.appendChild(title);
    section.appendChild(row('Label', labelInput));
    section.appendChild(row('Round robin minutes', minutesInput));
    section.appendChild(row('Break time minutes', breakInput));
    section.appendChild(row('Elimination style', styleSelect));
    section.appendChild(row('Victory points', victorySelect));
    section.appendChild(saveBtn);
    section.appendChild(cancelBtn);
    createOverlayModal.content.appendChild(section);
    createOverlayModal.content.appendChild(status);

    saveBtn.addEventListener('click', async () => {
      status.textContent = 'Creating...';
      try {
        const result = await apiCreateTournament({
          label: labelInput.value,
          config: {
            roundRobinMinutes: Number(minutesInput.value),
            breakMinutes: Number(breakInput.value),
            eliminationStyle: styleSelect.value,
            victoryPoints: Number(victorySelect.value),
          },
        });
        createOverlayModal.hide({ restoreFocus: false });
        await refreshCurrentTournament({ tournamentId: result?.tournament?.id });
      } catch (err) {
        status.textContent = err.message || 'Failed to create tournament.';
      }
    });

    cancelBtn.addEventListener('click', () => {
      createOverlayModal.hide({ restoreFocus: false });
      browserOverlay.show();
    });

    createOverlayModal.show();
  }

  function openAddBotModal() {
    if (!currentTournament?.id) return;
    addBotOverlay.content.innerHTML = '';
    const { title, status, section } = createModalShell('Add Bot');
    const nameInput = el('input', { type: 'text', placeholder: 'Bot display name', maxlength: '40' });
    const difficulty = el('select');
    const options = botDifficultyOptions.length
      ? botDifficultyOptions
      : [{ id: 'easy', label: 'Easy' }, { id: 'medium', label: 'Medium' }];
    options.forEach((entry) => {
      difficulty.appendChild(el('option', { value: entry.id }, entry.label));
    });
    const addBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Add Bot Player'), {
      variant: 'neutral',
      position: 'relative',
    });
    const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Cancel'), {
      variant: 'neutral',
      position: 'relative',
    });

    section.appendChild(nameInput);
    section.appendChild(difficulty);
    section.appendChild(addBtn);
    section.appendChild(cancelBtn);
    addBotOverlay.content.appendChild(title);
    addBotOverlay.content.appendChild(section);
    addBotOverlay.content.appendChild(status);

    addBtn.addEventListener('click', async () => {
      status.textContent = 'Adding bot...';
      try {
        await apiAddTournamentBot({
          tournamentId: currentTournament.id,
          name: nameInput.value,
          difficulty: difficulty.value,
        });
        addBotOverlay.hide({ restoreFocus: false });
        await refreshCurrentTournament({ tournamentId: currentTournament.id });
      } catch (err) {
        status.textContent = err.message || 'Failed to add bot.';
      }
    });

    cancelBtn.addEventListener('click', () => {
      addBotOverlay.hide({ restoreFocus: false });
    });

    addBotOverlay.show();
  }

  buildBrowserModal();

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentTournament) {
      refreshCurrentTournament({
        silent: true,
        tournamentId: currentViewMode === 'live' ? null : currentTournament.id,
        viewMode: currentViewMode,
      }).catch(() => null);
    }
  });

  triggerButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof onSessionRefresh === 'function') {
      await onSessionRefresh().catch(() => null);
    }
    if (currentTournament) {
      renderPanel();
      return;
    }
    browserOverlay.show();
    await refreshBrowser();
  });

  return {
    openBrowser: async () => {
      browserOverlay.show();
      await refreshBrowser();
    },
    restoreCurrentTournament: async () => {
      await refreshCurrentTournament({ silent: true });
    },
    openHistoricalTournament: async (tournamentId, { admin = false } = {}) => {
      if (!tournamentId) return null;
      if (currentViewMode === 'live' && currentRole && currentTournament) {
        throw new Error('Leave your current tournament before opening another tournament view.');
      }
      return refreshCurrentTournament({
        silent: false,
        tournamentId,
        viewMode: admin ? 'admin' : 'archive',
      });
    },
    hasPersistentTournament: () => Boolean(currentViewMode === 'live' && currentRole && currentTournament),
    handleTournamentUpdated: (payload = {}) => {
      const tournamentId = String(payload?.tournamentId || '');
      if (!currentTournament?.id || tournamentId !== String(currentTournament.id)) {
        return;
      }
      refreshCurrentTournament({
        silent: true,
        tournamentId: currentTournament.id,
        viewMode: currentViewMode,
      }).catch(() => null);
    },
    openHomeIfParticipant: () => {
      syncPanelVisibility();
      renderPanel();
    },
    // Used by the live game client after a tournament match ends. We refresh the
    // tournament state immediately so the next accept/banner decision is based on
    // the server's latest match assignment instead of waiting for poll cadence.
    exitTournamentGameToPanel: async () => {
      const wasInTournamentGame = isInTournamentGame;
      isInTournamentGame = false;
      syncPanelVisibility();
      renderPanel();
      lastAcceptStateKey = null;
      if (currentTournament?.id) {
        await refreshCurrentTournament({ silent: true, tournamentId: currentTournament.id });
        return;
      }
      if (wasInTournamentGame) {
        notifyAcceptState();
      }
    },
    setTournamentGameActive: (inGame) => {
      const wasInTournamentGame = isInTournamentGame;
      isInTournamentGame = Boolean(inGame);
      syncPanelVisibility();
      renderPanel();
      if (wasInTournamentGame && !isInTournamentGame) {
        lastAcceptStateKey = null;
        notifyAcceptState();
      }
      if (!isInTournamentGame && currentTournament?.id) {
        refreshCurrentTournament({ silent: true, tournamentId: currentTournament.id }).catch(() => null);
      }
    },
    getPlayAreaBounds: () => {
      if (!currentRole || !currentTournament || panelRoot.hidden) return null;
      const rect = stageSurface.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      return {
        left: rect.left + 8,
        top: rect.top + 8,
        width: Math.max(0, rect.width - 16),
        height: Math.max(0, rect.height - 16),
      };
    },
  };
}
