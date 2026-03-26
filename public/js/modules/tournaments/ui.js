import { createOverlay } from '../ui/overlays.js';
import { upgradeButton } from '../ui/buttons.js';
import {
  apiGetTournaments,
  apiCreateTournament,
  apiJoinTournament,
  apiLeaveTournament,
  apiCancelTournament,
  apiAddTournamentBot,
  apiStartTournament,
  apiKickTournamentPlayer,
  apiGetTournamentDetails,
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
    node.setAttribute(key, value);
  });
  if (text) node.textContent = text;
  return node;
}

function createModalShell(titleText) {
  const title = el('h2', { className: 'tournament-modal__title' }, titleText);
  const status = el('div', { className: 'menu-message tournament-modal__status' }, '');
  const section = el('div', { className: 'tournament-modal__section' });
  return { title, status, section };
}

function formatPhaseLabel(phase) {
  return phase === 'round_robin'
    ? 'Round robin'
    : phase === 'elimination'
      ? 'Elimination'
      : 'Lobby';
}

function getRoundRobinTimeRemaining(tournament) {
  const startedAt = Date.parse(tournament?.roundRobinRoundsStartedAt || tournament?.startedAt || '');
  const minutes = Number(tournament?.config?.roundRobinMinutes) || 15;
  if (!Number.isFinite(startedAt)) return null;
  const endTs = startedAt + (minutes * 60 * 1000);
  const remainingMs = Math.max(0, endTs - Date.now());
  const totalSeconds = Math.floor(remainingMs / 1000);
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
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

  const createOverlayOptions = (ariaLabel, closeLabel) => ({
    ariaLabel,
    baseClass: 'cg-overlay',
    dialogClass: 'history-modal tournament-modal',
    contentClass: 'history-modal-content tournament-modal__content',
    backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
    closeButtonClass: 'history-close-btn',
    closeLabel,
    closeText: '✕',
    openClass: 'open cg-overlay--open',
    bodyOpenClass: 'history-overlay-open cg-overlay-open',
  });

  const browserOverlay = createOverlay(createOverlayOptions('Tournament browser', 'Close tournament browser'));
  const createOverlayModal = createOverlay({
    ...createOverlayOptions('Create tournament', 'Close create tournament modal'),
    onCloseRequest: () => {
      createOverlayModal.hide({ restoreFocus: false });
      browserOverlay.show();
    },
  });
  const lobbyOverlay = createOverlay({
    ...createOverlayOptions('Tournament lobby', 'Close tournament lobby'),
    onCloseRequest: () => {
      if (currentViewRole === 'participant') return;
      lobbyOverlay.hide({ restoreFocus: false });
    },
  });
  const addBotOverlay = createOverlay({
    ...createOverlayOptions('Add bot to tournament', 'Close add bot modal'),
    onCloseRequest: () => {
      addBotOverlay.hide({ restoreFocus: false });
      if (currentTournament) openLobbyModal(currentTournament);
    },
  });
  const activeOverlay = createOverlay({
    ...createOverlayOptions('Active tournament games', 'Close active tournament games'),
    onCloseRequest: () => {
      if (currentViewRole === 'participant') return;
      activeOverlay.hide({ restoreFocus: false });
    },
  });
  const confirmLeaveOverlay = createOverlay(createOverlayOptions('Leave tournament confirmation', 'Close leave confirmation'));

  let browserStatusEl = null;
  let browserListEl = null;
  let joinBtn = null;
  let viewBtn = null;
  let createBtn = null;
  let selectedTournamentId = null;
  let cachedRows = [];
  let botDifficultyOptions = [];
  let currentTournament = null;
  let currentViewRole = null;
  let isInTournamentGame = false;
  let browserTestModeEnabled = false;

  function notifyParticipantState() {
    if (typeof onParticipantStateChange !== 'function') return;
    onParticipantStateChange(currentViewRole === 'participant');
  }

  function setParticipantRole(role) {
    currentViewRole = role === 'participant' ? 'participant' : (role === 'viewer' ? 'viewer' : null);
    notifyParticipantState();
  }

  function hideAllOverlays() {
    browserOverlay.hide({ restoreFocus: false });
    createOverlayModal.hide({ restoreFocus: false });
    lobbyOverlay.hide({ restoreFocus: false });
    addBotOverlay.hide({ restoreFocus: false });
    activeOverlay.hide({ restoreFocus: false });
    confirmLeaveOverlay.hide({ restoreFocus: false });
  }

  async function showCurrentTournamentHome() {
    if (!currentTournament || currentViewRole !== 'participant' || isInTournamentGame) return;
    try {
      const details = await apiGetTournamentDetails({ tournamentId: currentTournament.id });
      currentTournament = details?.tournament || currentTournament;
      const games = Array.isArray(details?.games) ? details.games : [];
      registerTournamentPlayers(games);
      if (currentTournament.state === 'active') {
        openActiveModal(currentTournament, games);
      } else {
        openLobbyModal(currentTournament);
      }
    } catch (_) {
      if (currentTournament.state === 'active') {
        openActiveModal(currentTournament, []);
      } else {
        openLobbyModal(currentTournament);
      }
    }
  }

  function registerTournamentPlayers(games = []) {
    if (typeof registerSpectateUsername !== 'function') return;
    games.forEach((game) => {
      (Array.isArray(game?.players) ? game.players : []).forEach((player) => {
        if (!player?.userId || !player?.username) return;
        registerSpectateUsername(player.userId, player.username);
      });
    });
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
        joinBtn.title = 'Join is only available for starting tournaments.';
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
    browserListEl.innerHTML = '';

    if (!rows.length) {
      browserListEl.appendChild(el('div', { className: 'menu-message' }, 'No live tournaments yet.'));
      return;
    }

    rows.forEach((row) => {
      const rowBtn = el('button', { type: 'button', className: 'tournament-modal__button tournament-browser-row' });
      if (selectedTournamentId === row.id) rowBtn.classList.add('active');
      rowBtn.innerHTML = `
        <span class="tournament-browser-row__title">${row.label}</span>
        <span class="tournament-browser-row__meta">${row.state.toUpperCase()} · ${row.phase || 'lobby'}</span>
        <span class="tournament-browser-row__meta">Host: ${row.hostUsername}</span>
        <span class="tournament-browser-row__meta">Players: ${row.playerCount} · Viewers: ${row.viewerCount}</span>
      `;
      upgradeButton(rowBtn, { variant: 'neutral', position: 'relative' });
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
      if (Array.isArray(payload?.alerts) && payload.alerts.length > 0) {
        payload.alerts.forEach((message) => {
          if (!message) return;
          try {
            window.alert(message);
          } catch (_) {}
        });
      }
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

  function buildBrowserModal() {
    const { title, status, section } = createModalShell('Tournament Browser');
    const topRow = el('div', { className: 'tournament-modal__actions' });

    createBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Create'), { variant: 'neutral', position: 'relative' });
    joinBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Join'), { variant: 'neutral', position: 'relative' });
    viewBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'View'), { variant: 'neutral', position: 'relative' });

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
        const result = await apiJoinTournament({ tournamentId: selectedTournamentId, role: 'player' });
        currentTournament = result?.tournament || null;
        setParticipantRole('participant');
        browserOverlay.hide({ restoreFocus: false });
        openLobbyModal(currentTournament || getSelectedTournament());
      } catch (err) {
        if (browserStatusEl) browserStatusEl.textContent = err.message || 'Failed to join tournament.';
      }
    });

    viewBtn.addEventListener('click', async () => {
      if (!selectedTournamentId) return;
      try {
        await apiJoinTournament({ tournamentId: selectedTournamentId, role: 'viewer' });
        const details = await apiGetTournamentDetails({ tournamentId: selectedTournamentId });
        setParticipantRole('viewer');
        registerTournamentPlayers(details?.games || []);
        browserOverlay.hide({ restoreFocus: false });
        if (details?.tournament?.state === 'active') {
          openActiveModal(details.tournament, details.games || []);
        } else {
          openLobbyModal(details?.tournament || getSelectedTournament());
        }
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

    const saveBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Create Tournament'), { variant: 'neutral', position: 'relative' });
    const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Cancel'), { variant: 'neutral', position: 'relative' });

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
        currentTournament = result?.tournament || null;
        setParticipantRole('participant');
        createOverlayModal.hide({ restoreFocus: false });
        openLobbyModal(currentTournament);
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

  function openAddBotModal(tournament) {
    addBotOverlay.content.innerHTML = '';
    const { title, status, section } = createModalShell('Add Bot');
    const nameInput = el('input', { type: 'text', placeholder: 'Bot display name', maxlength: '40' });
    const difficulty = el('select');
    const options = botDifficultyOptions.length
      ? botDifficultyOptions
      : [{ id: 'easy', label: 'Easy' }, { id: 'medium', label: 'Medium' }];
    options.forEach((entry) => {
      const option = el('option', { value: entry.id }, entry.label);
      difficulty.appendChild(option);
    });

    const addBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Add Bot Player'), { variant: 'neutral', position: 'relative' });
    const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Cancel'), { variant: 'neutral', position: 'relative' });

    addBotOverlay.content.appendChild(title);
    section.appendChild(nameInput);
    section.appendChild(difficulty);
    section.appendChild(addBtn);
    section.appendChild(cancelBtn);
    addBotOverlay.content.appendChild(section);
    addBotOverlay.content.appendChild(status);

    addBtn.addEventListener('click', async () => {
      status.textContent = 'Adding bot...';
      try {
        const result = await apiAddTournamentBot({
          tournamentId: tournament.id,
          name: nameInput.value,
          difficulty: difficulty.value,
        });
        currentTournament = result?.tournament || tournament;
        addBotOverlay.hide({ restoreFocus: false });
        openLobbyModal(currentTournament);
      } catch (err) {
        status.textContent = err.message || 'Failed to add bot.';
      }
    });

    cancelBtn.addEventListener('click', () => {
      addBotOverlay.hide({ restoreFocus: false });
      openLobbyModal(tournament);
    });

    addBotOverlay.show();
  }

  function openLobbyModal(tournamentLike) {
    if (!tournamentLike?.id) return;
    const tournament = tournamentLike;
    currentTournament = tournament;
    lobbyOverlay.content.innerHTML = '';
    const { title, status, section } = createModalShell(`${asText(tournament.label, 'Tournament')} Lobby`);
    status.textContent = `State: ${tournament.state} · Phase: ${tournament.phase}`;
    const session = getSessionInfo ? getSessionInfo() : null;
    const isHost = String(session?.userId || '') === String(tournament.host?.userId || '');
    const isStarting = tournament.state === 'starting';

    const playersList = el('div', { className: 'tournament-player-list' });
    const players = Array.isArray(tournament.players) ? tournament.players : [];
    const removedPlayers = Array.isArray(tournament.removedPlayers) ? tournament.removedPlayers : [];
    if (!players.length) {
      playersList.appendChild(el('div', { className: 'menu-message' }, 'No players joined yet.'));
    } else {
      players.forEach((player) => {
        const suffix = player.type === 'bot' ? `Bot · ${player.difficulty || 'easy'}` : 'Human';
        const row = el('div', { className: 'tournament-player-row' });
        row.appendChild(el('span', {}, `${player.username} · ${suffix}`));
        if (isHost && isStarting && String(player.userId || '') !== String(tournament.host?.userId || '')) {
          const buttonLabel = player.type === 'bot' ? 'Remove Bot' : 'Kick Player';
          const kickBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--success' }, buttonLabel), { variant: 'neutral', position: 'relative' });
          kickBtn.addEventListener('click', async () => {
            status.textContent = `${player.type === 'bot' ? 'Removing' : 'Kicking'} ${player.username}...`;
            try {
              const result = await apiKickTournamentPlayer({
                tournamentId: tournament.id,
                userId: player.userId,
              });
              currentTournament = result?.tournament || tournament;
              openLobbyModal(currentTournament);
            } catch (err) {
              status.textContent = err.message || (player.type === 'bot' ? 'Failed to remove bot.' : 'Failed to kick player.');
            }
          });
          row.appendChild(kickBtn);
        }
        playersList.appendChild(row);
      });
    }

    const btnRow = el('div', { className: 'tournament-modal__actions' });
    const controlsRow = el('div', { className: 'tournament-modal__controls' });
    const startBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--danger' }, 'Start Tournament'), { variant: 'neutral', position: 'relative' });
    const joinTournamentBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--success' }, 'Join Tournament'), { variant: 'neutral', position: 'relative' });
    const addBotBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--success' }, 'Add Bot'), { variant: 'neutral', position: 'relative' });
    const leaveBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--success' }, 'Leave Tournament'), { variant: 'neutral', position: 'relative' });
    const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--success' }, 'Cancel Tournament'), { variant: 'neutral', position: 'relative' });

    if (!isHost || !isStarting) {
      startBtn.disabled = true;
      addBotBtn.disabled = true;
      cancelBtn.disabled = true;
    }
    if (!isStarting || players.some((entry) => String(entry.userId || '') === String(session?.userId || ''))) {
      joinTournamentBtn.disabled = true;
    }

    controlsRow.appendChild(joinTournamentBtn);
    btnRow.appendChild(startBtn);
    btnRow.appendChild(addBotBtn);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(leaveBtn);

    lobbyOverlay.content.appendChild(title);
    lobbyOverlay.content.appendChild(controlsRow);
    lobbyOverlay.content.appendChild(status);
    section.appendChild(el('h3', {}, 'Players'));
    section.appendChild(playersList);
    section.appendChild(btnRow);
    lobbyOverlay.content.appendChild(section);

    joinTournamentBtn.addEventListener('click', async () => {
      status.textContent = 'Joining tournament...';
      try {
        const result = await apiJoinTournament({ tournamentId: tournament.id, role: 'player' });
        currentTournament = result?.tournament || tournament;
        openLobbyModal(currentTournament);
      } catch (err) {
        status.textContent = err.message || 'Failed to join tournament.';
      }
    });

    startBtn.addEventListener('click', async () => {
      status.textContent = 'Starting tournament...';
      try {
        const result = await apiStartTournament({ tournamentId: tournament.id });
        const details = await apiGetTournamentDetails({ tournamentId: tournament.id });
        currentTournament = result?.tournament || details?.tournament;
        registerTournamentPlayers(details?.games || []);
        lobbyOverlay.hide({ restoreFocus: false });
        openActiveModal(currentTournament, details?.games || []);
      } catch (err) {
        status.textContent = err.message || 'Failed to start tournament.';
      }
    });

    addBotBtn.addEventListener('click', () => {
      if (tournament.state !== 'starting') return;
      lobbyOverlay.hide({ restoreFocus: false });
      openAddBotModal(tournament);
    });

    cancelBtn.addEventListener('click', async () => {
      status.textContent = 'Cancelling tournament...';
      try {
        await apiCancelTournament({ tournamentId: tournament.id });
        lobbyOverlay.hide({ restoreFocus: false });
        browserOverlay.show();
        await refreshBrowser();
      } catch (err) {
        status.textContent = err.message || 'Failed to cancel tournament.';
      }
    });

    leaveBtn.addEventListener('click', async () => {
      openLeaveConfirmModal({
        tournament,
        onConfirm: async () => {
          status.textContent = 'Leaving tournament...';
          const result = await apiLeaveTournament({ tournamentId: tournament.id });
          currentTournament = result?.tournament || null;
          setParticipantRole(null);
          lobbyOverlay.hide({ restoreFocus: false });
          browserOverlay.show();
          await refreshBrowser();
        },
        onError: (message) => {
          status.textContent = message || 'Failed to leave tournament.';
        },
      });
    });

    lobbyOverlay.show();
  }

  function openActiveModal(tournament, games = []) {
    if (!tournament) return;
    currentTournament = tournament;
    activeOverlay.content.innerHTML = '';
    const { title, status, section } = createModalShell(`${asText(tournament.label, 'Tournament')} · Active`);
    const phaseText = formatPhaseLabel(tournament?.phase);
    const timeRemaining = tournament?.phase === 'round_robin'
      ? getRoundRobinTimeRemaining(tournament)
      : null;
    status.textContent = `Phase: ${phaseText}${timeRemaining ? ` · Time remaining: ${timeRemaining}` : ''}`;

    const gameList = el('div', { className: 'tableList tournament-active-list' });
    const rawGames = Array.isArray(games) ? games : [];
    const playerRows = [];
    const records = new Map();
    const players = Array.isArray(tournament?.players) ? tournament.players : [];
    players.forEach((player) => {
      records.set(String(player.userId || ''), { wins: 0, losses: 0, draws: 0 });
    });
    rawGames.forEach((game) => {
      if (game?.phase !== 'round_robin') return;
      const [p1, p2] = Array.isArray(game?.players) ? game.players : [];
      const aId = String(p1?.userId || '');
      const bId = String(p2?.userId || '');
      const a = records.get(aId) || { wins: 0, losses: 0, draws: 0 };
      const b = records.get(bId) || { wins: 0, losses: 0, draws: 0 };
      if (game?.status === 'completed') {
        if (game?.winner === 0) {
          a.wins += 1;
          b.losses += 1;
        } else if (game?.winner === 1) {
          b.wins += 1;
          a.losses += 1;
        } else {
          a.draws += 1;
          b.draws += 1;
        }
      }
      records.set(aId, a);
      records.set(bId, b);
    });
    players.forEach((player) => {
      const userId = String(player.userId || '');
      const stat = records.get(userId) || { wins: 0, losses: 0, draws: 0 };
      const game = rawGames.find((entry) => (entry?.players || []).some((p) => String(p?.userId || '') === userId) && entry?.status !== 'completed');
      const opponent = (game?.players || []).find((entry) => String(entry?.userId || '') !== userId);
      const row = el('div', { className: 'tournament-player-row' });
      row.appendChild(el('span', {}, `${player.username} · W:${stat.wins} L:${stat.losses} D:${stat.draws}`));
      row.appendChild(el('span', {}, game ? `In game against ${opponent?.username || 'Unknown'}` : 'Waiting for next game'));
      if (game?.matchId) {
        const spectateBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button tournament-modal__button--success' }, 'Spectate'), { variant: 'neutral', position: 'relative' });
        spectateBtn.addEventListener('click', () => {
          if (typeof onSpectateMatch !== 'function') return;
          activeOverlay.hide({ restoreFocus: false });
          onSpectateMatch(game.matchId);
        });
        row.appendChild(spectateBtn);
      }
      playerRows.push(row);
    });
    if (!playerRows.length) {
      gameList.appendChild(el('div', { className: 'menu-message' }, 'No tournament players yet.'));
    } else {
      playerRows.forEach((row) => gameList.appendChild(row));
    }

    const controlsRow = el('div', { className: 'tournament-modal__controls' });
    const refreshBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Refresh Games'), { variant: 'neutral', position: 'relative' });
    const leaveBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Leave Tournament'), { variant: 'neutral', position: 'relative' });
    const doneBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Back to Browser'), { variant: 'neutral', position: 'relative' });
    controlsRow.appendChild(refreshBtn);
    if (currentViewRole === 'participant') controlsRow.appendChild(leaveBtn);
    controlsRow.appendChild(doneBtn);

    activeOverlay.content.appendChild(title);
    activeOverlay.content.appendChild(controlsRow);
    activeOverlay.content.appendChild(status);
    section.appendChild(gameList);
    activeOverlay.content.appendChild(section);

    refreshBtn.addEventListener('click', async () => {
      try {
        const details = await apiGetTournamentDetails({ tournamentId: tournament.id });
        registerTournamentPlayers(details?.games || []);
        openActiveModal(details?.tournament || tournament, details?.games || []);
      } catch (_) {}
    });

    doneBtn.addEventListener('click', async () => {
      if (currentViewRole === 'participant') {
        await showCurrentTournamentHome();
        return;
      }
      activeOverlay.hide({ restoreFocus: false });
      browserOverlay.show();
      await refreshBrowser();
    });

    leaveBtn.addEventListener('click', () => {
      openLeaveConfirmModal({
        tournament,
        onConfirm: async () => {
          await apiLeaveTournament({ tournamentId: tournament.id });
          setParticipantRole(null);
          activeOverlay.hide({ restoreFocus: false });
          browserOverlay.show();
          await refreshBrowser();
        },
      });
    });

    activeOverlay.show();
  }

  function openLeaveConfirmModal({ tournament, onConfirm, onError } = {}) {
    confirmLeaveOverlay.content.innerHTML = '';
    const title = el('h2', { className: 'tournament-modal__title' }, 'Leave Tournament?');
    const message = el(
      'div',
      { className: 'menu-message tournament-modal__status' },
      'Are you sure you wish to leave? you will forfeit all subsequent games.'
    );
    const row = el('div', { className: 'tournament-modal__actions' });
    const leaveBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Leave'), { variant: 'danger', position: 'relative' });
    const stayBtn = upgradeButton(el('button', { type: 'button', className: 'tournament-modal__button' }, 'Stay'), { variant: 'neutral', position: 'relative' });
    row.appendChild(leaveBtn);
    row.appendChild(stayBtn);
    confirmLeaveOverlay.content.appendChild(title);
    confirmLeaveOverlay.content.appendChild(message);
    confirmLeaveOverlay.content.appendChild(row);

    leaveBtn.addEventListener('click', async () => {
      try {
        await Promise.resolve(onConfirm && onConfirm(tournament));
        confirmLeaveOverlay.hide({ restoreFocus: false });
      } catch (err) {
        if (typeof onError === 'function') {
          onError(err?.message);
        }
      }
    });

    stayBtn.addEventListener('click', () => {
      confirmLeaveOverlay.hide({ restoreFocus: false });
      if (currentTournament?.state === 'active') {
        openActiveModal(currentTournament, []);
      } else if (currentTournament) {
        openLobbyModal(currentTournament);
      }
    });

    confirmLeaveOverlay.show();
  }

  buildBrowserModal();

  triggerButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof onSessionRefresh === 'function') {
      await onSessionRefresh().catch(() => null);
    }
    if (currentViewRole === 'participant' && currentTournament) {
      await showCurrentTournamentHome();
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
    openHomeIfParticipant: () => {
      showCurrentTournamentHome();
    },
    setTournamentGameActive: (inGame) => {
      isInTournamentGame = Boolean(inGame);
      if (isInTournamentGame) {
        hideAllOverlays();
        return;
      }
      showCurrentTournamentHome();
    },
  };
}
