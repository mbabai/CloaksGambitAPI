import { createOverlay } from '../ui/overlays.js';
import { upgradeButton } from '../ui/buttons.js';
import { createThroneIcon } from '../ui/icons.js';
import {
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
  apiTransferTournamentHost,
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

function normalizeTournamentConfig(config = {}) {
  return {
    roundRobinMinutes: Number.isFinite(Number(config?.roundRobinMinutes))
      ? Math.max(1, Math.min(30, Number(config.roundRobinMinutes)))
      : 15,
    eliminationStyle: String(config?.eliminationStyle || 'single').toLowerCase() === 'double'
      ? 'double'
      : 'single',
    victoryPoints: [3, 4, 5].includes(Number(config?.victoryPoints)) ? Number(config.victoryPoints) : 3,
  };
}

function formatStandingPoints(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return '0';
  return Math.abs(numeric - Math.round(numeric)) < 1e-9
    ? String(Math.round(numeric))
    : numeric.toFixed(1);
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
  const ordered = [];
  if (championId && participantByUserId.has(championId)) {
    ordered.push(participantByUserId.get(championId));
  }
  if (runnerUpId && participantByUserId.has(runnerUpId) && runnerUpId !== championId) {
    ordered.push(participantByUserId.get(runnerUpId));
  }

  const remaining = allParticipants
    .filter((entry) => {
      const userId = String(entry.userId || '');
      return userId && userId !== championId && userId !== runnerUpId;
    })
    .sort((left, right) => {
      const leftProgress = ensureProgress(left?.userId);
      const rightProgress = ensureProgress(right?.userId);
      if (leftProgress.maxFinalsRound !== rightProgress.maxFinalsRound) {
        return rightProgress.maxFinalsRound - leftProgress.maxFinalsRound;
      }
      if (leftProgress.maxLosersRound !== rightProgress.maxLosersRound) {
        return rightProgress.maxLosersRound - leftProgress.maxLosersRound;
      }
      if (leftProgress.maxWinnersRound !== rightProgress.maxWinnersRound) {
        return rightProgress.maxWinnersRound - leftProgress.maxWinnersRound;
      }
      const leftSeed = Number.isFinite(Number(left?.seed)) ? Number(left.seed) : Number.MAX_SAFE_INTEGER;
      const rightSeed = Number.isFinite(Number(right?.seed)) ? Number(right.seed) : Number.MAX_SAFE_INTEGER;
      if (leftSeed !== rightSeed) return leftSeed - rightSeed;
      return String(left?.username || '').localeCompare(String(right?.username || ''));
    });

  return ordered.concat(remaining).map((participant, index) => ({
    position: index + 1,
    label: getOrdinalLabel(index + 1),
    participant,
  }));
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
  const hostTransferOverlay = createOverlay(createOverlayOptions('Choose a new host', 'Close host transfer prompt'));
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
  let isInTournamentGame = false;
  let selectingNewHost = false;
  let messageDraft = '';
  let messageDirty = false;
  let settingsDraft = normalizeTournamentConfig();
  let settingsDirty = false;
  let lastTournamentId = null;
  let pollHandle = null;
  let roundRobinTimerHandle = null;
  let roundRobinTimerEl = null;
  let tournamentServerClockOffsetMs = 0;

  const panelRoot = el('div', { className: 'tournament-panel', hidden: 'hidden' });
  const panelLayout = el('div', { className: 'tournament-panel__layout' });
  const hostColumn = el('aside', { className: 'tournament-panel__column tournament-panel__column--host' });
  const centerColumn = el('section', { className: 'tournament-panel__column tournament-panel__column--center' });
  const sideColumn = el('aside', { className: 'tournament-panel__column tournament-panel__column--side' });
  const stageFrame = el('div', { className: 'tournament-panel__stage-frame' });
  const stagePlaceholder = el('div', { className: 'tournament-panel__stage-placeholder' });
  const stagePlaceholderTitle = el('div', { className: 'tournament-panel__stage-title' }, 'Current Game');
  const stagePlaceholderBody = el('div', { className: 'tournament-panel__stage-body' }, 'Waiting for your next tournament game.');
  const stageSurface = el('div', { className: 'tournament-panel__stage-surface' });
  stagePlaceholder.appendChild(stagePlaceholderTitle);
  stagePlaceholder.appendChild(stagePlaceholderBody);
  stageFrame.appendChild(stagePlaceholder);
  stageFrame.appendChild(stageSurface);
  centerColumn.appendChild(stageFrame);
  panelLayout.appendChild(hostColumn);
  panelLayout.appendChild(centerColumn);
  panelLayout.appendChild(sideColumn);
  panelRoot.appendChild(panelLayout);
  document.body.appendChild(panelRoot);

  function notifyPanelState() {
    if (typeof onParticipantStateChange === 'function') {
      onParticipantStateChange(Boolean(currentRole && currentTournament));
    }
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
    const roundRobinTimer = getRoundRobinTimeRemaining(currentTournament, getTournamentServerNowMs());
    if (!roundRobinTimer) {
      roundRobinTimerEl.textContent = '';
      return;
    }
    roundRobinTimerEl.textContent = `Time remaining: ${roundRobinTimer}`;
  }

  function scheduleRoundRobinTimerTick() {
    if (!currentTournament || currentTournament.phase !== 'round_robin' || !roundRobinTimerEl || !roundRobinTimerEl.isConnected) {
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
    if (!currentTournament || currentTournament.phase !== 'round_robin' || !roundRobinTimerEl || !roundRobinTimerEl.isConnected) {
      return;
    }
    scheduleRoundRobinTimerTick();
  }

  function startPolling() {
    stopPolling();
    if (!currentRole || !currentTournament) return;
    pollHandle = window.setInterval(() => {
      refreshCurrentTournament({ silent: true }).catch(() => null);
    }, 10000);
  }

  function syncPanelVisibility() {
    const visible = Boolean(currentRole && currentTournament);
    panelRoot.hidden = !visible;
    panelRoot.classList.toggle('tournament-panel--visible', visible);
    if (visible) {
      startPolling();
    } else {
      stopPolling();
      stopRoundRobinTimer();
      selectingNewHost = false;
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

  function setCurrentTournamentState(payload) {
    syncTournamentServerClock(payload);
    currentTournament = payload?.tournament || null;
    currentRole = payload?.role || null;
    if (!currentTournament) {
      currentRole = null;
      messageDraft = '';
      messageDirty = false;
      settingsDraft = normalizeTournamentConfig();
      settingsDirty = false;
      lastTournamentId = null;
      syncPanelVisibility();
      renderPanel();
      return;
    }
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
    syncPanelVisibility();
    renderPanel();
  }

  async function refreshCurrentTournament({ silent = false, tournamentId = null } = {}) {
    try {
      const payload = tournamentId
        ? await apiGetTournamentDetails({ tournamentId })
        : await apiGetCurrentTournament();
      if (!payload?.tournament) {
        setCurrentTournamentState(null);
        return null;
      }
      setCurrentTournamentState(payload);
      return payload;
    } catch (err) {
      if (!silent) {
        try {
          window.alert(err.message || 'Unable to load tournament.');
        } catch (_) {}
      }
      return null;
    }
  }

  async function leaveCurrentTournament({ reopenBrowser = true } = {}) {
    if (!currentTournament?.id) return;
    await apiLeaveTournament({ tournamentId: currentTournament.id });
    setCurrentTournamentState(null);
    confirmOverlay.hide({ restoreFocus: false });
    hostTransferOverlay.hide({ restoreFocus: false });
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

  function openHostTransferPrompt() {
    hostTransferOverlay.content.innerHTML = '';
    const title = el('h2', { className: 'tournament-modal__title' }, 'Who will be the new host?');
    const body = el('div', { className: 'menu-message tournament-modal__status' }, 'Choose a player from the list on the right.');
    const actions = el('div', { className: 'tournament-modal__actions' });
    const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Cancel'), {
      variant: 'neutral',
      position: 'relative',
    });
    actions.appendChild(cancelBtn);
    hostTransferOverlay.content.appendChild(title);
    hostTransferOverlay.content.appendChild(body);
    hostTransferOverlay.content.appendChild(actions);
    cancelBtn.addEventListener('click', () => {
      selectingNewHost = false;
      hostTransferOverlay.hide({ restoreFocus: false });
      renderPanel();
    });
    hostTransferOverlay.show();
  }

  async function handleLeaveRequest() {
    if (!currentTournament?.id) return;
    const roleFlags = buildRoleFlags(currentRole);
    const isCompletedTournament = currentTournament.phase === 'completed' || currentTournament.state === 'completed';

    if (roleFlags.isHost && !isCompletedTournament) {
      const hostCandidates = (Array.isArray(currentTournament.participants) ? currentTournament.participants : [])
        .filter((entry) => String(entry?.userId || '') !== String(currentTournament.host?.userId || ''));
      if (hostCandidates.length > 0) {
        selectingNewHost = true;
        renderPanel();
        openHostTransferPrompt();
        return;
      }
    }

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

  async function assignNewHostAndLeave(nextHostUserId) {
    if (!currentTournament?.id) return;
    await apiTransferTournamentHost({
      tournamentId: currentTournament.id,
      userId: nextHostUserId,
    });
    selectingNewHost = false;
    await leaveCurrentTournament();
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

    const bracket = currentTournament.bracket || {};
    const normalizedBracket = {
      winnersRounds: Array.isArray(bracket?.winnersRounds)
        ? bracket.winnersRounds
        : (Array.isArray(bracket?.rounds) ? bracket.rounds : []),
      losersRounds: Array.isArray(bracket?.losersRounds) ? bracket.losersRounds : [],
      finalsRounds: Array.isArray(bracket?.finalsRounds)
        ? bracket.finalsRounds.filter((round) => round?.active !== false || (Array.isArray(round?.matches) && round.matches.some((match) => match?.winner || match?.playerA || match?.playerB)))
        : [],
    };

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
      if (player?.username) {
        return {
          label: player.username,
          className: 'tournament-bracket__slot-name',
        };
      }
      const other = slotKey === 'A' ? match?.playerB : match?.playerA;
      if (String(match?.status || '').toLowerCase() === 'bye' && other?.userId) {
        return {
          label: 'BYE',
          className: 'tournament-bracket__slot-name tournament-bracket__slot-name--bye',
        };
      }
      return {
        label: '_________',
        className: 'tournament-bracket__slot-name tournament-bracket__slot-name--placeholder',
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
      const matchWrap = el('div', {
        className: `tournament-bracket__match-wrap tournament-bracket__match-wrap--${side}`,
      });
      const position = matchPositions.get(matchKey);
      if (position) {
        matchWrap.style.top = `${position.top}px`;
      }

      const matchCard = el('button', {
        type: 'button',
        className: `tournament-bracket__match tournament-bracket__match--${side} tournament-bracket__match--status-${statusClass}${isClickable ? ' tournament-bracket__match--clickable' : ''}`,
      });
      if (!isClickable) {
        matchCard.disabled = true;
      }

      const buildSlotScore = (wins, target, name) => {
        const total = Math.max(0, Number(target) || 0);
        if (total <= 0) return null;
        const scoreWrap = el('div', { className: 'tournament-bracket__slot-score' });
        const filled = Math.max(0, Math.min(total, Number(wins) || 0));
        for (let index = 0; index < filled; index += 1) {
          const icon = createThroneIcon({
            size: 14,
            alt: `${name || 'Player'} win`,
            title: `${name || 'Player'} win ${index + 1}`,
          });
          icon.classList.add('tournament-bracket__score-token');
          scoreWrap.appendChild(icon);
        }
        for (let index = filled; index < total; index += 1) {
          const icon = createThroneIcon({
            size: 14,
            alt: `${name || 'Player'} pending win`,
            title: `${name || 'Player'} pending win ${index + 1}`,
          });
          icon.classList.add('tournament-bracket__score-token', 'tournament-bracket__score-token--empty');
          scoreWrap.appendChild(icon);
        }
        return scoreWrap;
      };

      const buildSlot = (player, slotKey, slotClass, wins = 0, target = 0) => {
        const slot = el('div', { className: `tournament-bracket__slot ${slotClass}` });
        const presentation = getSlotPresentation(match, slotKey, player);
        const slotName = el('span', { className: presentation.className }, presentation.label);
        slot.appendChild(slotName);
        const score = buildSlotScore(wins, target, presentation.label);
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
        const roundColumn = el('div', { className: 'tournament-bracket__round' });
        const showRoundLabel = side !== 'losers';
        if (showRoundLabel) {
          roundColumn.appendChild(el('div', { className: 'tournament-bracket__round-label' }, round.label || 'Round'));
        } else {
          roundColumn.appendChild(el('div', { className: 'tournament-bracket__round-label tournament-bracket__round-label--hidden' }, ''));
        }
        const roundBody = el('div', { className: 'tournament-bracket__round-body' });
        roundBody.style.height = `${sectionHeight}px`;
        (Array.isArray(round?.matches) ? round.matches : []).forEach((match, matchIndex) => {
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
    clearNode(stageSurface);
    stageSurface.hidden = true;
    stagePlaceholder.hidden = false;
    stagePlaceholder.removeAttribute('hidden');
    stagePlaceholderTitle.textContent = isInTournamentGame ? 'Current Game' : 'Tournament';

    if (!currentTournament || !currentRole) {
      stagePlaceholderBody.textContent = 'Create, join, or view a tournament to keep it here.';
      return;
    }

    const roleFlags = buildRoleFlags(currentRole);
    const currentUserGame = currentTournament.currentUserGame || null;
    const currentConfig = normalizeTournamentConfig(currentTournament.config);
    const editableConfig = settingsDirty ? settingsDraft : currentConfig;
    const participants = Array.isArray(currentTournament.participants) ? currentTournament.participants : [];
    const roundRobinTimer = currentTournament.phase === 'round_robin'
      ? getRoundRobinTimeRemaining(currentTournament, getTournamentServerNowMs())
      : null;

    if (currentTournament.phase === 'completed') {
      stagePlaceholderTitle.textContent = '';
      stagePlaceholderBody.textContent = '';
      stagePlaceholder.hidden = true;
      stagePlaceholder.setAttribute('hidden', 'hidden');
      const placements = buildCompletedPlacements(participants, currentTournament.bracket);
      const resultsWrap = el('div', { className: 'tournament-panel__results' });
      const resultsCard = el('div', { className: 'tournament-panel__results-card' });
      resultsCard.appendChild(el('div', { className: 'tournament-panel__results-title' }, 'Final Results'));
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
        row.appendChild(el('div', { className: 'tournament-panel__results-name' }, entry.participant?.username || 'Player'));
        resultsList.appendChild(row);
      });
      resultsCard.appendChild(resultsList);
      resultsWrap.appendChild(resultsCard);
      stageSurface.appendChild(resultsWrap);
      stageSurface.hidden = false;
    } else if (isInTournamentGame && currentUserGame) {
      stagePlaceholderBody.textContent = 'Your tournament game is live in the center panel.';
    } else if (currentUserGame) {
      stagePlaceholderBody.textContent = `Your next tournament board is against ${currentUserGame.opponentUsername || 'your opponent'}.`;
    } else if (currentTournament.phase === 'elimination') {
      stagePlaceholderBody.textContent = 'Watch an active elimination match or wait for your next board.';
    } else {
      stagePlaceholderBody.textContent = 'Waiting for the next tournament pairing.';
    }

    const hostCard = el('div', { className: 'tournament-panel__card tournament-panel__card--host' });
    hostCard.appendChild(el('div', { className: 'tournament-panel__card-title' }, 'Host Controls'));
    hostCard.appendChild(el('div', { className: 'tournament-panel__host-name' }, currentTournament.host?.username || 'Tournament Host'));
    const statsRow = el('div', { className: 'tournament-panel__stats' });
    statsRow.appendChild(el('div', { className: 'tournament-panel__stat' }, `Viewers: ${Number(currentTournament.viewerCount || 0)}`));
    hostCard.appendChild(statsRow);

    const settingsList = el('div', { className: 'tournament-panel__settings' });
    const hostCanEditSettings = roleFlags.isHost && currentTournament.state === 'starting';
    if (hostCanEditSettings) {
      const minutesField = el('label', { className: 'tournament-panel__setting-field' });
      minutesField.appendChild(el('span', { className: 'tournament-panel__setting-label' }, 'Round robin'));
      const minutesInput = el('input', {
        className: 'tournament-panel__setting-input',
        type: 'number',
        min: '1',
        max: '30',
        value: String(editableConfig.roundRobinMinutes),
      });
      minutesField.appendChild(minutesInput);
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
          roundRobinMinutes: minutesInput.value,
          eliminationStyle: styleSelect.value,
          victoryPoints: victorySelect.value,
        });
        settingsDirty = settingsDraft.roundRobinMinutes !== currentConfig.roundRobinMinutes
          || settingsDraft.eliminationStyle !== currentConfig.eliminationStyle
          || settingsDraft.victoryPoints !== currentConfig.victoryPoints;
        saveSettingsBtn.disabled = !settingsDirty;
      };
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
    } else {
      settingsList.appendChild(el('div', { className: 'tournament-panel__setting' }, `Round robin: ${currentConfig.roundRobinMinutes} min`));
      settingsList.appendChild(el('div', { className: 'tournament-panel__setting' }, `Elimination: ${currentConfig.eliminationStyle === 'double' ? 'Double' : 'Single'}`));
      settingsList.appendChild(el('div', { className: 'tournament-panel__setting' }, `Victory target: ${currentConfig.victoryPoints}`));
    }
    hostCard.appendChild(settingsList);

    const controls = el('div', { className: 'tournament-panel__actions' });
    const alreadyPlayer = participants.some((entry) => String(entry?.userId || '') === String(getSessionInfo?.()?.userId || ''));

    if (currentTournament.state === 'starting' && !alreadyPlayer) {
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

    if (roleFlags.isHost && currentTournament.state === 'starting') {
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

    if (roleFlags.isHost && currentTournament.canStartElimination) {
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
    messageWrap.appendChild(el('div', { className: 'tournament-panel__subheading' }, 'Host Message'));
    const messageInput = el('textarea', {
      className: 'tournament-panel__message-input',
      rows: '4',
      placeholder: roleFlags.isHost ? 'Share a message with the tournament.' : 'No host message yet.',
    });
    messageInput.value = roleFlags.isHost ? messageDraft : asText(currentTournament.message, '');
    messageInput.readOnly = !roleFlags.isHost;
    messageWrap.appendChild(messageInput);
    if (roleFlags.isHost) {
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
    if (roundRobinTimer) {
      roundRobinTimerEl = el('div', { className: 'tournament-panel__status-line' }, `Time remaining: ${roundRobinTimer}`);
      sideTop.appendChild(roundRobinTimerEl);
    }

    const sideActions = el('div', { className: 'tournament-panel__actions tournament-panel__actions--summary' });
    const leaveBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--danger' }, 'Leave Tournament'), {
      variant: 'danger',
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
        nameCell.appendChild(el('div', { className: 'tournament-panel__participant-name' }, participant.username || 'Player'));
        row.appendChild(nameCell);

        const pointsCell = el('td', { className: 'tournament-panel__participant-points-cell' });
        pointsCell.appendChild(el('div', { className: 'tournament-panel__participant-points' }, formatStandingPoints(participant.points)));
        row.appendChild(pointsCell);

        const actionCell = el('td', { className: 'tournament-panel__participant-action-cell' });
        if (selectingNewHost && roleFlags.isHost && String(participant.userId || '') !== String(currentTournament.host?.userId || '')) {
          const setHostBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Set Host'), {
            variant: 'neutral',
            position: 'relative',
          });
          setHostBtn.addEventListener('click', () => {
            assignNewHostAndLeave(participant.userId).catch((err) => {
              try {
                window.alert(err.message || 'Unable to transfer host.');
              } catch (_) {}
            });
          });
          actionCell.appendChild(setHostBtn);
        } else if (roleFlags.isHost && currentTournament.state === 'starting' && String(participant.userId || '') !== String(currentTournament.host?.userId || '')) {
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
    sideColumn.appendChild(rosterCard);
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
    if (!document.hidden && currentRole && currentTournament) {
      refreshCurrentTournament({ silent: true }).catch(() => null);
    }
  });

  triggerButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof onSessionRefresh === 'function') {
      await onSessionRefresh().catch(() => null);
    }
    if (currentRole && currentTournament) {
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
    handleTournamentUpdated: (payload = {}) => {
      const tournamentId = String(payload?.tournamentId || '');
      if (!currentTournament?.id || tournamentId !== String(currentTournament.id)) {
        return;
      }
      refreshCurrentTournament({ silent: true, tournamentId: currentTournament.id }).catch(() => null);
    },
    openHomeIfParticipant: () => {
      renderPanel();
    },
    setTournamentGameActive: (inGame) => {
      isInTournamentGame = Boolean(inGame);
      renderPanel();
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
