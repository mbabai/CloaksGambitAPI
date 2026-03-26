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

export function initTournamentUi({
  triggerButton,
  getSessionInfo,
  onSessionRefresh,
}) {
  if (!triggerButton) return null;

  const browserOverlay = createOverlay({
    ariaLabel: 'Tournament browser',
    closeText: '×',
    closeLabel: 'Close tournament browser',
  });
  const createOverlayModal = createOverlay({
    ariaLabel: 'Create tournament',
    closeText: '×',
  });
  const lobbyOverlay = createOverlay({
    ariaLabel: 'Tournament lobby',
    closeText: '×',
  });
  const addBotOverlay = createOverlay({
    ariaLabel: 'Add bot to tournament',
    closeText: '×',
  });
  const activeOverlay = createOverlay({
    ariaLabel: 'Active tournament games',
    closeText: '×',
  });

  let browserStatusEl = null;
  let browserListEl = null;
  let joinBtn = null;
  let viewBtn = null;
  let createBtn = null;
  let selectedTournamentId = null;
  let selectedTournamentState = null;
  let cachedRows = [];
  let botDifficultyOptions = [];
  let currentTournament = null;

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
      const canView = Boolean(selected && (selected.state === 'starting' || selected.state === 'active'));
      viewBtn.disabled = !canView;
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
      const rowBtn = el('button', { type: 'button', className: 'menu-button' });
      rowBtn.style.display = 'flex';
      rowBtn.style.flexDirection = 'column';
      rowBtn.style.alignItems = 'flex-start';
      rowBtn.style.gap = '4px';
      rowBtn.style.padding = '10px 12px';
      rowBtn.style.textAlign = 'left';
      if (selectedTournamentId === row.id) {
        rowBtn.classList.add('active');
      }
      rowBtn.innerHTML = `
        <strong>${row.label}</strong>
        <span>State: ${row.state}</span>
        <span>Host: ${row.hostUsername}</span>
        <span>Players: ${row.playerCount} · Viewers: ${row.viewerCount}</span>
      `;
      upgradeButton(rowBtn, { variant: 'neutral', position: 'relative' });
      rowBtn.addEventListener('click', () => {
        selectedTournamentId = row.id;
        selectedTournamentState = row.state;
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
        selectedTournamentState = null;
      }
      renderTournamentRows(cachedRows);
      if (browserStatusEl) {
        const note = payload?.testModeEnabled
          ? 'Dev test-mode is ON: guest users may participate.'
          : 'Login required for participation.';
        browserStatusEl.textContent = note;
      }
      updateBrowserButtons();
    } catch (err) {
      if (browserStatusEl) {
        browserStatusEl.textContent = err.message || 'Failed to load tournaments.';
      }
    }
  }

  function buildBrowserModal() {
    const title = el('h2', {}, 'Tournament Browser');
    title.style.margin = '0';
    const topRow = el('div');
    topRow.style.display = 'flex';
    topRow.style.gap = '8px';
    topRow.style.flexWrap = 'wrap';

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

    browserStatusEl = el('div', { className: 'menu-message' }, 'Loading tournaments...');
    browserListEl = el('div');
    browserListEl.style.display = 'flex';
    browserListEl.style.flexDirection = 'column';
    browserListEl.style.gap = '8px';
    browserListEl.style.maxHeight = '420px';
    browserListEl.style.overflowY = 'auto';

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
        currentTournament = result?.tournament || null;
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
    const title = el('h2', {}, 'Create Tournament');
    title.style.margin = '0';
    const labelInput = el('input', { type: 'text', placeholder: 'Tournament label', maxlength: '60' });
    const minutesInput = el('input', { type: 'number', min: '1', max: '30', value: '15' });
    const styleSelect = el('select');
    styleSelect.innerHTML = '<option value="single">Single Elimination</option><option value="double">Double Elimination</option>';
    const victorySelect = el('select');
    victorySelect.innerHTML = '<option value="3">3</option><option value="4">4</option><option value="5">5</option>';
    const status = el('div', { className: 'menu-message' }, '');

    const saveBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Create Tournament'), {
      variant: 'neutral',
      position: 'relative',
    });

    const row = (label, control) => {
      const wrap = el('label');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.gap = '4px';
      wrap.appendChild(el('span', {}, label));
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
        currentTournament = result?.tournament || null;
        createOverlayModal.hide({ restoreFocus: false });
        openLobbyModal(currentTournament);
      } catch (err) {
        status.textContent = err.message || 'Failed to create tournament.';
      }
    });

    createOverlayModal.show();
  }

  function openAddBotModal(tournament) {
    addBotOverlay.content.innerHTML = '';
    const title = el('h2', {}, 'Add Bot');
    title.style.margin = '0';
    const nameInput = el('input', { type: 'text', placeholder: 'Bot display name', maxlength: '40' });
    const difficulty = el('select');
    const options = botDifficultyOptions.length
      ? botDifficultyOptions
      : [{ id: 'easy', label: 'Easy' }, { id: 'medium', label: 'Medium' }];
    options.forEach((entry) => {
      const option = el('option', { value: entry.id }, entry.label);
      difficulty.appendChild(option);
    });

    const addBtn = upgradeButton(el('button', { type: 'button', className: 'menu-button' }, 'Add Bot Player'), {
      variant: 'neutral',
      position: 'relative',
    });
    const status = el('div', { className: 'menu-message' }, '');

    addBotOverlay.content.appendChild(title);
    addBotOverlay.content.appendChild(nameInput);
    addBotOverlay.content.appendChild(difficulty);
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
        currentTournament = result?.tournament || tournament;
        addBotOverlay.hide({ restoreFocus: false });
        openLobbyModal(currentTournament);
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
    const title = el('h2', {}, `${asText(tournament.label, 'Tournament')} Lobby`);
    title.style.margin = '0';

    const status = el('div', { className: 'menu-message' }, `State: ${tournament.state} · Phase: ${tournament.phase}`);
    const playersList = el('div');
    playersList.style.display = 'flex';
    playersList.style.flexDirection = 'column';
    playersList.style.gap = '6px';

    const players = Array.isArray(tournament.players) ? tournament.players : [];
    if (!players.length) {
      playersList.appendChild(el('div', { className: 'menu-message' }, 'No players joined yet.'));
    } else {
      players.forEach((player) => {
        const suffix = player.type === 'bot' ? ` (Bot: ${player.difficulty || 'easy'})` : '';
        playersList.appendChild(el('div', { className: 'menu-message' }, `${player.username}${suffix}`));
      });
    }

    const btnRow = el('div');
    btnRow.style.display = 'flex';
    btnRow.style.flexWrap = 'wrap';
    btnRow.style.gap = '8px';

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
    lobbyOverlay.content.appendChild(el('h3', {}, 'Players'));
    lobbyOverlay.content.appendChild(playersList);
    lobbyOverlay.content.appendChild(btnRow);

    startBtn.addEventListener('click', async () => {
      status.textContent = 'Starting tournament...';
      try {
        const result = await apiStartTournament({ tournamentId: tournament.id });
        const details = await apiGetTournamentDetails({ tournamentId: tournament.id });
        currentTournament = result?.tournament || details?.tournament;
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
    const title = el('h2', {}, `${asText(tournament.label, 'Tournament')} · Active`);
    title.style.margin = '0';
    const info = el('div', { className: 'menu-message' }, 'Round-robin games are listed first. Elimination sample shows ELO rules.');
    const gameList = el('div');
    gameList.style.display = 'flex';
    gameList.style.flexDirection = 'column';
    gameList.style.gap = '8px';

    if (!games.length) {
      gameList.appendChild(el('div', { className: 'menu-message' }, 'No active games yet.'));
    } else {
      games.forEach((game) => {
        const wrap = el('div', { className: 'menu-message' });
        const p1 = game.players?.[0]?.username || 'Player 1';
        const p2 = game.players?.[1]?.username || 'Player 2';
        wrap.textContent = `${game.phase.toUpperCase()} · ${p1} vs ${p2} · ${game.status} · ELO: ${game.eloImpact ? 'Yes' : 'No'} (${game.reason})`;
        gameList.appendChild(wrap);
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

    activeOverlay.content.appendChild(title);
    activeOverlay.content.appendChild(info);
    activeOverlay.content.appendChild(gameList);
    activeOverlay.content.appendChild(refreshBtn);
    activeOverlay.content.appendChild(doneBtn);

    refreshBtn.addEventListener('click', async () => {
      try {
        const details = await apiGetTournamentDetails({ tournamentId: tournament.id });
        openActiveModal(details?.tournament || tournament, details?.games || []);
      } catch (_) {}
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
