import { createOverlay } from '../ui/overlays.js';
import { upgradeButton } from '../ui/buttons.js';
import { renderActiveMatchesList } from '../spectate/activeMatches.js';
import {
  apiGetTournaments,
  apiCreateTournament,
  apiJoinTournament,
  apiLeaveTournament,
  apiCancelTournament,
  apiAddTournamentBot,
  apiStartTournament,
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

function createTournamentOverlay(options = {}) {
  return createOverlay({
    baseClass: 'cg-overlay tournament-overlay',
    dialogClass: 'history-modal tournament-modal',
    contentClass: 'history-modal-content tournament-modal__content',
    backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
    closeButtonClass: 'history-close-btn',
    closeText: '×',
    ...options,
  });
}

export function initTournamentUi({
  triggerButton,
  getSessionInfo,
  onSessionRefresh,
  onSpectateMatch,
  registerSpectateUsername,
}) {
  if (!triggerButton) return null;

  const browserOverlay = createTournamentOverlay({
    ariaLabel: 'Tournament browser',
    closeLabel: 'Close tournament browser',
  });
  const createOverlayModal = createTournamentOverlay({ ariaLabel: 'Create tournament' });
  const lobbyOverlay = createTournamentOverlay({ ariaLabel: 'Tournament lobby' });
  const addBotOverlay = createTournamentOverlay({ ariaLabel: 'Add bot to tournament' });
  const activeOverlay = createTournamentOverlay({
    ariaLabel: 'Active tournament games',
    dialogClass: 'history-modal tournament-modal tournament-modal--wide',
  });

  let browserStatusEl = null;
  let browserListEl = null;
  let joinBtn = null;
  let viewBtn = null;
  let createBtn = null;
  let selectedTournamentId = null;
  let cachedRows = [];
  let botDifficultyOptions = [];

  function getSelectedTournament() {
    return cachedRows.find((row) => row.id === selectedTournamentId) || null;
  }

  function updateBrowserButtons() {
    const session = getSessionInfo ? getSessionInfo() : null;
    const selected = getSelectedTournament();
    const loggedInForParticipation = Boolean(session?.authenticated) || Boolean(session?.isGuest);
    if (joinBtn) {
      const canJoin = Boolean(selected && selected.state === 'starting' && loggedInForParticipation);
      joinBtn.disabled = !canJoin;
      joinBtn.title = canJoin
        ? ''
        : (selected ? 'Join is only available for starting tournaments.' : 'Select a tournament first.');
    }
    if (viewBtn) {
      viewBtn.disabled = !Boolean(selected && (selected.state === 'starting' || selected.state === 'active'));
    }
    if (createBtn) {
      createBtn.disabled = false;
    }
  }

  function renderTournamentRows(rows = []) {
    if (!browserListEl) return;
    browserListEl.innerHTML = '';

    if (!rows.length) {
      browserListEl.appendChild(el('div', { className: 'menu-message' }, 'No live tournaments yet.'));
      return;
    }

    rows.forEach((row) => {
      const rowBtn = el('button', { type: 'button', className: 'menu-button tournament-browser__row' });
      if (selectedTournamentId === row.id) {
        rowBtn.classList.add('tournament-browser__row--active');
      }
      rowBtn.innerHTML = `
        <strong class="tournament-browser__label">${row.label}</strong>
        <span class="tournament-browser__meta">🏁 ${row.state}</span>
        <span class="tournament-browser__meta">👑 ${row.hostUsername}</span>
        <span class="tournament-browser__meta">🧑 ${row.playerCount} · 👀 ${row.viewerCount}</span>
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
    if (browserStatusEl) {
      browserStatusEl.textContent = 'Loading tournaments...';
    }
    try {
      const payload = await apiGetTournaments();
      cachedRows = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
      botDifficultyOptions = Array.isArray(payload?.botDifficultyOptions) ? payload.botDifficultyOptions : [];
      if (selectedTournamentId && !cachedRows.some((entry) => entry.id === selectedTournamentId)) {
        selectedTournamentId = null;
      }
      renderTournamentRows(cachedRows);
      if (browserStatusEl) {
        browserStatusEl.textContent = payload?.testModeEnabled
          ? 'Dev test-mode is ON: guest users may participate.'
          : 'Login required for participation.';
      }
      updateBrowserButtons();
    } catch (err) {
      if (browserStatusEl) {
        browserStatusEl.textContent = err.message || 'Failed to load tournaments.';
      }
    }
  }

  function buildBrowserModal() {
    const title = el('h2', { className: 'tournament-modal__title' }, '🏆 Tournament Browser');
    const topRow = el('div', { className: 'tournament-modal__actions' });

    createBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Create'), {
      variant: 'neutral',
      position: 'relative',
    });
    joinBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Join'), {
      variant: 'neutral',
      position: 'relative',
    });
    viewBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'View'), {
      variant: 'neutral',
      position: 'relative',
    });

    topRow.appendChild(createBtn);
    topRow.appendChild(joinBtn);
    topRow.appendChild(viewBtn);

    browserStatusEl = el('div', { className: 'menu-message tournament-modal__status' }, 'Loading tournaments...');
    browserListEl = el('div', { className: 'tournament-browser__list' });

    browserOverlay.content.appendChild(title);
    browserOverlay.content.appendChild(topRow);
    browserOverlay.content.appendChild(browserStatusEl);
    browserOverlay.content.appendChild(browserListEl);

    createBtn.addEventListener('click', () => {
      browserOverlay.hide({ restoreFocus: false });
      openCreateModal();
    });

    joinBtn.addEventListener('click', async () => {
      if (!selectedTournamentId) return;
      try {
        const result = await apiJoinTournament({ tournamentId: selectedTournamentId, role: 'player' });
        browserOverlay.hide({ restoreFocus: false });
        openLobbyModal(result?.tournament || getSelectedTournament());
      } catch (err) {
        if (browserStatusEl) browserStatusEl.textContent = err.message || 'Failed to join tournament.';
      }
    });

    viewBtn.addEventListener('click', async () => {
      if (!selectedTournamentId) return;
      try {
        await apiJoinTournament({ tournamentId: selectedTournamentId, role: 'viewer' });
        const details = await apiGetTournamentDetails({ tournamentId: selectedTournamentId });
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
    const title = el('h2', { className: 'tournament-modal__title' }, '✨ Create Tournament');
    const labelInput = el('input', { type: 'text', placeholder: 'Tournament label', maxlength: '60' });
    const minutesInput = el('input', { type: 'number', min: '1', max: '30', value: '15' });
    const styleSelect = el('select');
    styleSelect.innerHTML = '<option value="single">Single Elimination</option><option value="double">Double Elimination</option>';
    const victorySelect = el('select');
    victorySelect.innerHTML = '<option value="3">3</option><option value="4">4</option><option value="5">5</option>';
    const status = el('div', { className: 'menu-message tournament-modal__status' }, '');

    const saveBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Create Tournament'), {
      variant: 'neutral',
      position: 'relative',
    });

    const row = (label, control) => {
      const wrap = el('label', { className: 'tournament-modal__field' });
      wrap.appendChild(el('span', { className: 'tournament-modal__field-label' }, label));
      wrap.appendChild(control);
      return wrap;
    };

    createOverlayModal.content.appendChild(title);
    createOverlayModal.content.appendChild(row('Label', labelInput));
    createOverlayModal.content.appendChild(row('Round robin minutes', minutesInput));
    createOverlayModal.content.appendChild(row('Elimination style', styleSelect));
    createOverlayModal.content.appendChild(row('Victory points', victorySelect));
    createOverlayModal.content.appendChild(saveBtn);
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
        openLobbyModal(result?.tournament || null);
      } catch (err) {
        status.textContent = err.message || 'Failed to create tournament.';
      }
    });

    createOverlayModal.show();
  }

  function openAddBotModal(tournament) {
    addBotOverlay.content.innerHTML = '';
    const title = el('h2', { className: 'tournament-modal__title' }, '🤖 Add Bot');
    const nameInput = el('input', { type: 'text', placeholder: 'Bot display name', maxlength: '40' });
    const difficulty = el('select');
    const options = botDifficultyOptions.length
      ? botDifficultyOptions
      : [{ id: 'easy', label: 'Easy' }, { id: 'medium', label: 'Medium' }];
    options.forEach((entry) => {
      difficulty.appendChild(el('option', { value: entry.id }, entry.label));
    });

    const addBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Add Bot Player'), {
      variant: 'neutral',
      position: 'relative',
    });
    const status = el('div', { className: 'menu-message tournament-modal__status' }, '');

    const nameField = el('label', { className: 'tournament-modal__field' });
    nameField.appendChild(el('span', { className: 'tournament-modal__field-label' }, 'Display name'));
    nameField.appendChild(nameInput);
    const diffField = el('label', { className: 'tournament-modal__field' });
    diffField.appendChild(el('span', { className: 'tournament-modal__field-label' }, 'Difficulty'));
    diffField.appendChild(difficulty);

    addBotOverlay.content.appendChild(title);
    addBotOverlay.content.appendChild(nameField);
    addBotOverlay.content.appendChild(diffField);
    addBotOverlay.content.appendChild(addBtn);
    addBotOverlay.content.appendChild(status);

    addBtn.addEventListener('click', async () => {
      status.textContent = 'Adding bot...';
      try {
        const result = await apiAddTournamentBot({
          tournamentId: tournament.id,
          name: nameInput.value,
          difficulty: difficulty.value,
        });
        addBotOverlay.hide({ restoreFocus: false });
        openLobbyModal(result?.tournament || tournament);
      } catch (err) {
        status.textContent = err.message || 'Failed to add bot.';
      }
    });

    addBotOverlay.show();
  }

  function openLobbyModal(tournamentLike) {
    if (!tournamentLike?.id) return;
    const tournament = tournamentLike;
    lobbyOverlay.content.innerHTML = '';
    const title = el('h2', { className: 'tournament-modal__title' }, `🏟️ ${asText(tournament.label, 'Tournament')} Lobby`);

    const status = el('div', { className: 'menu-message tournament-modal__status' }, `State: ${tournament.state} · Phase: ${tournament.phase}`);
    const playersList = el('div', { className: 'tournament-player-list' });

    const players = Array.isArray(tournament.players) ? tournament.players : [];
    if (!players.length) {
      playersList.appendChild(el('div', { className: 'menu-message' }, 'No players joined yet.'));
    } else {
      players.forEach((player) => {
        const suffix = player.type === 'bot' ? ` (Bot: ${player.difficulty || 'easy'})` : '';
        playersList.appendChild(el('div', { className: 'menu-message tournament-player-list__item' }, `${player.username}${suffix}`));
      });
    }

    const btnRow = el('div', { className: 'tournament-modal__actions tournament-modal__actions--split' });

    const startBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Start Tournament'), {
      variant: 'neutral',
      position: 'relative',
    });
    const addBotBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Add Bot'), {
      variant: 'neutral',
      position: 'relative',
    });
    const leaveBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Leave Tournament'), {
      variant: 'neutral',
      position: 'relative',
    });
    const cancelBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Cancel Tournament'), {
      variant: 'neutral',
      position: 'relative',
    });

    const session = getSessionInfo ? getSessionInfo() : null;
    const isHost = String(session?.userId || '') === String(tournament.host?.userId || '');
    const isStarting = tournament.state === 'starting';
    if (!isHost || !isStarting) {
      startBtn.disabled = true;
      addBotBtn.disabled = true;
      cancelBtn.disabled = true;
    }

    btnRow.appendChild(startBtn);
    btnRow.appendChild(addBotBtn);
    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(leaveBtn);

    lobbyOverlay.content.appendChild(title);
    lobbyOverlay.content.appendChild(status);
    lobbyOverlay.content.appendChild(el('h3', { className: 'tournament-modal__subtitle' }, 'Players'));
    lobbyOverlay.content.appendChild(playersList);
    lobbyOverlay.content.appendChild(btnRow);

    startBtn.addEventListener('click', async () => {
      status.textContent = 'Starting tournament...';
      try {
        const result = await apiStartTournament({ tournamentId: tournament.id });
        const details = await apiGetTournamentDetails({ tournamentId: tournament.id });
        lobbyOverlay.hide({ restoreFocus: false });
        openActiveModal(result?.tournament || details?.tournament || tournament, details?.games || []);
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
      status.textContent = 'Leaving tournament...';
      try {
        await apiLeaveTournament({ tournamentId: tournament.id });
        lobbyOverlay.hide({ restoreFocus: false });
        browserOverlay.show();
        await refreshBrowser();
      } catch (err) {
        status.textContent = err.message || 'Failed to leave tournament.';
      }
    });

    lobbyOverlay.show();
  }

  function openActiveModal(tournament, games = []) {
    if (!tournament) return;
    activeOverlay.content.innerHTML = '';
    const title = el('h2', { className: 'tournament-modal__title' }, `🎯 ${asText(tournament.label, 'Tournament')} · Active`);
    const info = el('div', { className: 'menu-message tournament-modal__status' }, 'Round-robin games are live now. Elimination begins only after round-robin concludes.');
    const gameList = el('div', { className: 'tournament-active-list' });
    const gameStatus = el('div', { className: 'menu-message tournament-modal__status' }, '');

    const listItems = (Array.isArray(games) ? games : []).map((game, index) => {
      const p1 = game?.players?.[0] || {};
      const p2 = game?.players?.[1] || {};
      return {
        id: game?.matchId || game?.gameId || `tournament-match-${index}`,
        type: String(game?.phase || 'round_robin').toUpperCase() === 'ELIMINATION'
          ? 'TOURNAMENT_ELIMINATION'
          : 'TOURNAMENT_ROUND_ROBIN',
        player1Score: 0,
        player2Score: 0,
        drawCount: 0,
        players: [
          p1.userId || p1.entryId || `slot-a-${index}`,
          p2.userId || p2.entryId || `slot-b-${index}`,
        ],
        _usernames: {
          [p1.userId || p1.entryId || `slot-a-${index}`]: p1.username || 'Player 1',
          [p2.userId || p2.entryId || `slot-b-${index}`]: p2.username || 'Player 2',
        },
        _source: game,
      };
    });

    if (!listItems.length) {
      gameList.appendChild(el('div', { className: 'menu-message' }, 'No active games yet.'));
    } else {
      renderActiveMatchesList(gameList, listItems, {
        getUsername: (id) => {
          const item = listItems.find((entry) => Object.prototype.hasOwnProperty.call(entry._usernames, String(id || '')));
          return item?._usernames?.[String(id || '')] || id || 'Unknown';
        },
        onSpectate: (item) => {
          if (typeof onSpectateMatch !== 'function') {
            gameStatus.textContent = 'Spectate is unavailable right now.';
            return;
          }
          const source = item?._source || null;
          if (!source?.matchId) {
            gameStatus.textContent = 'Tournament match is not ready for spectating yet.';
            return;
          }
          (source.players || []).forEach((player) => {
            if (typeof registerSpectateUsername === 'function' && player?.userId && player?.username) {
              registerSpectateUsername(player.userId, player.username);
            }
          });
          activeOverlay.hide({ restoreFocus: false });
          onSpectateMatch(source.matchId);
        },
      });
    }

    const refreshBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Refresh Games'), {
      variant: 'neutral',
      position: 'relative',
    });
    const doneBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Back to Browser'), {
      variant: 'neutral',
      position: 'relative',
    });
    const controls = el('div', { className: 'tournament-modal__actions' });
    controls.appendChild(refreshBtn);
    controls.appendChild(doneBtn);

    activeOverlay.content.appendChild(title);
    activeOverlay.content.appendChild(info);
    activeOverlay.content.appendChild(gameList);
    activeOverlay.content.appendChild(gameStatus);
    activeOverlay.content.appendChild(controls);

    refreshBtn.addEventListener('click', async () => {
      try {
        const details = await apiGetTournamentDetails({ tournamentId: tournament.id });
        openActiveModal(details?.tournament || tournament, details?.games || []);
      } catch (err) {
        gameStatus.textContent = err?.message || 'Failed to refresh tournament games.';
      }
    });

    doneBtn.addEventListener('click', async () => {
      activeOverlay.hide({ restoreFocus: false });
      browserOverlay.show();
      await refreshBrowser();
    });

    activeOverlay.show();
  }

  buildBrowserModal();

  triggerButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (typeof onSessionRefresh === 'function') {
      await onSessionRefresh().catch(() => null);
    }
    browserOverlay.show();
    await refreshBrowser();
  });

  return {
    openBrowser: async () => {
      browserOverlay.show();
      await refreshBrowser();
    }
  };
}
