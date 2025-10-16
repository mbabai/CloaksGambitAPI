import { computeHistorySummary, describeMatch, buildMatchDetailGrid, normalizeId } from '/js/modules/history/dashboard.js';
import { createDaggerCounter } from '/js/modules/ui/banners.js';
import { createEloBadge } from '/js/modules/render/eloBadge.js';
import { getCookie } from '/js/modules/utils/cookies.js';
import { preloadAssets } from '/js/modules/utils/assetPreloader.js';
import { createSpectateController } from '/js/modules/spectate/controller.js';
import { renderActiveMatchesList, createActiveMatchesStore } from '/js/modules/spectate/activeMatches.js';
import { upgradeButton, createButton } from '/js/modules/ui/buttons.js';

(function () {
  preloadAssets();

  const origin = window.location.origin.replace(/\/$/, '');
  const socket = io(origin + '/admin');
  const params = new URLSearchParams(window.location.search);
  const adminIdParam = params.get('adminId');
  const adminUserId = adminIdParam || localStorage.getItem('cg_userId') || null;

  const TOKEN_STORAGE_KEY = 'cg_token';
  const TOKEN_COOKIE_NAME = 'cgToken';

  function getStoredAuthToken() {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch (err) {
      console.warn('Unable to read auth token from localStorage', err);
      return null;
    }
  }

  function setStoredAuthToken(token) {
    try {
      if (token) {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } else {
        localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch (err) {
      console.warn('Unable to persist auth token to localStorage', err);
    }
  }

  function ensureAuthToken() {
    const cookieToken = getCookie(TOKEN_COOKIE_NAME) || null;
    const stored = getStoredAuthToken();

    if (cookieToken) {
      if (stored !== cookieToken) {
        setStoredAuthToken(cookieToken);
      }
      return cookieToken;
    }

    if (stored) {
      setStoredAuthToken(null);
    }

    return null;
  }

  function authFetch(input, init = {}) {
    const headers = { ...(init && init.headers ? init.headers : {}) };
    const token = ensureAuthToken();
    if (token && !headers.Authorization) {
      headers.Authorization = `Bearer ${token}`;
    }
    return fetch(input, { ...init, headers });
  }

  const tabButtons = Array.from(document.querySelectorAll('.tab-button'))
    .map((btn) => upgradeButton(btn, { variant: 'neutral', position: 'relative' }))
    .filter(Boolean);
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

  const connectedUsersEl = document.getElementById('connectedUsers');
  const quickplayQueueEl = document.getElementById('quickplayQueue');
  const rankedQueueEl = document.getElementById('rankedQueue');
  const quickplayQueueListEl = document.getElementById('quickplayQueueList');
  const rankedQueueListEl = document.getElementById('rankedQueueList');
  const usersListEl = document.getElementById('usersList');
  const matchesListEl = document.getElementById('matchesList');
  const purgeActiveMatchesBtn = upgradeButton(document.getElementById('purgeActiveMatchesBtn'), {
    variant: 'danger',
    position: 'relative'
  });

  const spectateOverlay = document.getElementById('spectateOverlay');
  const spectatePlayArea = document.getElementById('spectatePlayArea');
  const spectateBoardEl = document.getElementById('spectateBoard');
  const spectateTopBar = document.getElementById('spectateTopBar');
  const spectateBottomBar = document.getElementById('spectateBottomBar');
  const spectateStatusEl = document.getElementById('spectateStatus');
  const spectateScoreEl = document.getElementById('spectateScore');
  const spectateBannerEl = document.getElementById('spectateBanner');
  const spectateMetaEl = document.getElementById('spectateMeta');
  const spectateCloseBtn = upgradeButton(document.getElementById('spectateCloseBtn'), {
    variant: 'dark',
    position: 'relative'
  });

  const historyMatchesListEl = document.getElementById('historyMatchesList');
  const historyFilterButtons = Array.from(document.querySelectorAll('[data-history-filter]'))
    .map((btn) => upgradeButton(btn, { variant: 'neutral', position: 'relative' }))
    .filter(Boolean);
  const historySummaryEls = {
    totalGames: document.getElementById('historyTotalGames'),
    totalGamesWins: document.getElementById('historyTotalGamesWins'),
    totalGamesDraws: document.getElementById('historyTotalGamesDraws'),
    totalGamesLosses: document.getElementById('historyTotalGamesLosses'),
    quickplayMatches: document.getElementById('historyQuickplayMatches'),
    quickplayWins: document.getElementById('historyQuickplayWins'),
    quickplayDraws: document.getElementById('historyQuickplayDraws'),
    quickplayLosses: document.getElementById('historyQuickplayLosses'),
    botMatches: document.getElementById('historyBotMatches'),
    botWins: document.getElementById('historyBotWins'),
    botDraws: document.getElementById('historyBotDraws'),
    botLosses: document.getElementById('historyBotLosses'),
    rankedMatches: document.getElementById('historyRankedMatches'),
    rankedWins: document.getElementById('historyRankedWins'),
    rankedDraws: document.getElementById('historyRankedDraws'),
    rankedLosses: document.getElementById('historyRankedLosses'),
    customMatches: document.getElementById('historyCustomMatches'),
    customWins: document.getElementById('historyCustomWins'),
    customDraws: document.getElementById('historyCustomDraws'),
    customLosses: document.getElementById('historyCustomLosses')
  };

  const usernameMap = {};
  const activeMatchesStore = createActiveMatchesStore();
  activeMatchesStore.subscribe(handleActiveMatchesChange);
  let latestMetrics = null;
  let historyMatches = [];
  let historyGames = [];
  let historyMaxGameCount = 1;
  let historyFilter = 'all';
  let historyLoaded = false;
  let isFetchingHistory = false;
  const historyGamesByMatch = new Map();

  function getUsername(id) {
    if (!id) return 'Unknown';
    return usernameMap[id] || id;
  }

  function isAnonymousUsername(username) {
    if (typeof username !== 'string') return false;
    return /^anonymous\d+$/i.test(username.trim());
  }

  function renderList(targetEl, ids) {
    if (!targetEl) return;
    targetEl.innerHTML = '';
    if (!Array.isArray(ids) || ids.length === 0) return;
    const frag = document.createDocumentFragment();
    ids.forEach(id => {
      const row = document.createElement('div');
      row.className = 'row';
      const nameEl = document.createElement(adminUserId && id === adminUserId ? 'strong' : 'span');
      nameEl.textContent = getUsername(id);
      nameEl.title = id;
      row.appendChild(nameEl);
      frag.appendChild(row);
    });
    targetEl.appendChild(frag);
  }

  function renderUsersList(targetEl, users, connectedIds, matches) {
    if (!targetEl) return;
    targetEl.innerHTML = '';
    if (!Array.isArray(users) || users.length === 0) return;
    const connectedSet = new Set(connectedIds || []);
    const inMatchSet = new Set();
    if (Array.isArray(matches)) {
      matches.forEach(match => {
        (match && Array.isArray(match.players) ? match.players : []).forEach(pid => {
          if (pid) inMatchSet.add(pid);
        });
      });
    }
    users.sort((a, b) => {
      return (connectedSet.has(b.id) - connectedSet.has(a.id)) || (a.username || '').localeCompare(b.username || '');
    });
    const frag = document.createDocumentFragment();
    const table = document.createElement('table');
    table.className = 'userTable';

    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = [
      { label: 'Username', className: 'userTable__name' },
      { label: 'ELO' },
      { label: 'In Match' },
      { label: 'Connected' },
      { label: 'Delete', className: 'userTable__actions' },
    ];

    headers.forEach(({ label, className }) => {
      const th = document.createElement('th');
      th.textContent = label;
      if (className) th.classList.add(className);
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');

    users.forEach(u => {
      const row = document.createElement('tr');
      const username = u.username || 'Unknown';
      const nameEl = document.createElement(adminUserId && u.id === adminUserId ? 'strong' : 'span');
      nameEl.textContent = username;
      nameEl.title = u.id;
      nameEl.classList.add('userTable__name');
      const eloEl = document.createElement('span');
      eloEl.classList.add('userTable__inline');
      if (!isAnonymousUsername(username)) {
        const eloValue = Number.isFinite(u.elo) ? u.elo : null;
        const badge = createEloBadge({ elo: eloValue, size: 24, alt: `${username} Elo` });
        if (badge) {
          eloEl.appendChild(badge);
          if (Number.isFinite(eloValue)) {
            const roundedElo = Math.round(eloValue);
            eloEl.title = `${roundedElo} Elo`;
            eloEl.setAttribute('aria-label', `${roundedElo} Elo`);
          } else {
            eloEl.title = 'Elo unavailable';
            eloEl.setAttribute('aria-label', 'Elo unavailable');
          }
        }
      }
      const matchEl = document.createElement('span');
      matchEl.classList.add('userTable__inline');
      if (inMatchSet.has(u.id)) {
        const daggers = createDaggerCounter({ count: 1, size: 18, gap: 0, alt: 'In active match' });
        matchEl.appendChild(daggers);
        matchEl.title = 'Player is in an active match';
        matchEl.setAttribute('aria-label', 'In active match');
      } else {
        matchEl.setAttribute('aria-label', 'Not in active match');
      }
      const connEl = document.createElement('span');
      connEl.classList.add('userTable__inline');
      if (connectedSet.has(u.id)) {
        const img = document.createElement('img');
        img.src = 'assets/images/GoldThrone.svg';
        img.alt = '';
        img.style.width = '16px';
        img.style.height = '16px';
        connEl.appendChild(img);
      }
      const actionEl = document.createElement('span');
      actionEl.className = 'userTable__inline userTable__actions';

      const deleteBtn = createButton({
        label: '🗑',
        variant: 'danger',
        position: 'relative'
      });
      deleteBtn.classList.add('user-delete-btn');
      deleteBtn.setAttribute('aria-label', `Delete ${username}`);
      deleteBtn.title = `Delete ${username}`;
      deleteBtn.addEventListener('click', () => {
        requestUserDeletion({ id: u.id, username });
      });

      actionEl.appendChild(deleteBtn);

      const nameCell = document.createElement('td');
      nameCell.appendChild(nameEl);
      const eloCell = document.createElement('td');
      eloCell.appendChild(eloEl);
      const matchCell = document.createElement('td');
      matchCell.appendChild(matchEl);
      const connCell = document.createElement('td');
      connCell.appendChild(connEl);
      const actionCell = document.createElement('td');
      actionCell.appendChild(actionEl);

      row.appendChild(nameCell);
      row.appendChild(eloCell);
      row.appendChild(matchCell);
      row.appendChild(connCell);
      row.appendChild(actionCell);
      tbody.appendChild(row);
    });

    table.appendChild(tbody);
    frag.appendChild(table);

    targetEl.appendChild(frag);
  }

  const spectateController = createSpectateController({
    overlayEl: spectateOverlay,
    playAreaEl: spectatePlayArea,
    boardEl: spectateBoardEl,
    topBarEl: spectateTopBar,
    bottomBarEl: spectateBottomBar,
    statusEl: spectateStatusEl,
    scoreEl: spectateScoreEl,
    bannerEl: spectateBannerEl,
    metaEl: spectateMetaEl,
    closeButtonEl: spectateCloseBtn,
    socket,
    getUsername,
    setUsername: (id, username) => {
      if (!id) return;
      if (typeof username === 'string' && username.trim()) {
        usernameMap[id] = username.trim();
      }
    },
  });

  function renderActiveMatchesFromState(items) {
    const list = Array.isArray(items) ? items : activeMatchesStore.getItems();
    renderActiveMatchesList(matchesListEl, list, {
      getUsername,
      onSpectate: (item) => {
        if (item?.id && spectateController) {
          spectateController.open(item.id);
        }
      },
    });
  }

  function updateLatestMetricsMatches(items) {
    if (!latestMetrics) return;
    const list = Array.isArray(items) ? items : activeMatchesStore.getItems();
    latestMetrics.matches = list.slice();
  }

  function handleActiveMatchesChange(items) {
    updateLatestMetricsMatches(items);
    renderActiveMatchesFromState(items);
  }

  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Escape' || event.key === 'Esc') && spectateController && spectateController.isOpen && spectateController.isOpen()) {
      spectateController.close();
    }
  });

  let activeTab = 'live';
  function setActiveTab(tab) {
    if (!tab || tab === activeTab) return;
    activeTab = tab;
    tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    tabPanels.forEach(panel => {
      panel.classList.toggle('active', panel.dataset.tabPanel === tab);
    });
    if (tab === 'history') {
      ensureHistoryLoaded();
    }
  }

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.tab);
    });
  });

  historyFilterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const filter = btn.dataset.historyFilter || 'all';
      if (filter === historyFilter) return;
      historyFilter = filter;
      historyFilterButtons.forEach(b => b.classList.toggle('active', b === btn));
      renderHistoryList();
    });
  });

  async function fetchAllUsers() {
    if (!usersListEl) return;
    try {
      const res = await authFetch('/api/v1/users/getList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        console.error('Failed to fetch user accounts:', res.status);
        return;
      }
      const data = await res.json();
      const users = [];
      if (Array.isArray(data)) {
        data.forEach(u => {
          const id = u._id ? u._id.toString() : '';
          if (!id) return;
          const username = u.username || 'Unknown';
          const numericElo = Number(u.elo);
          const elo = Number.isFinite(numericElo) ? numericElo : null;
          usernameMap[id] = username;
          users.push({ id, username, elo });
        });
      }
      renderUsersList(
        usersListEl,
        users,
        latestMetrics ? latestMetrics.connectedUserIds : [],
        latestMetrics ? latestMetrics.matches : [],
      );
      if (latestMetrics) {
        renderList(quickplayQueueListEl, latestMetrics.quickplayQueueUserIds);
        renderList(rankedQueueListEl, latestMetrics.rankedQueueUserIds);
      }
      renderActiveMatchesFromState();
      if (historyLoaded) {
        renderHistoryList();
      }
    } catch (err) {
      console.error('Error fetching user accounts:', err);
    }
  }

  async function requestUserDeletion({ id, username }) {
    const userId = id ? String(id) : '';
    if (!userId) {
      alert('Unable to delete user: missing identifier.');
      return;
    }

    const displayName = username || 'this user';
    if (!confirm(`Are you sure you want to permanently delete ${displayName}? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await authFetch('/api/v1/users/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': localStorage.getItem('ADMIN_SECRET') || ''
        },
        body: JSON.stringify({ userId })
      });

      if (!res.ok) {
        const message = res.status === 404
          ? 'User not found.'
          : `Failed to delete user. (${res.status})`;
        alert(message);
        return;
      }

      await res.json().catch(() => null);
      alert(`${displayName} has been deleted.`);
      fetchAllUsers();
      if (historyLoaded) fetchHistoryData();
    } catch (err) {
      console.error('Error deleting user:', err);
      alert('An error occurred while deleting the user. Check console for details.');
    }
  }

  async function ensureHistoryLoaded() {
    if (historyLoaded || isFetchingHistory) return;
    isFetchingHistory = true;
    try {
      await fetchHistoryData();
      historyLoaded = true;
    } finally {
      isFetchingHistory = false;
    }
  }

  async function fetchHistoryData() {
    try {
      const requestBody = JSON.stringify({ status: 'completed' });
      const [matchesRes, gamesRes] = await Promise.all([
        authFetch('/api/v1/matches/getList', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        }),
        authFetch('/api/v1/games/getList', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBody
        })
      ]);

      historyMatches = matchesRes && matchesRes.ok ? await matchesRes.json().catch(() => []) : [];
      historyGames = gamesRes && gamesRes.ok ? await gamesRes.json().catch(() => []) : [];
      historyMaxGameCount = 1;

      historyGamesByMatch.clear();
      if (Array.isArray(historyGames)) {
        historyGames.forEach(game => {
          const matchId = normalizeId(game?.match);
          if (!matchId) return;
          if (!historyGamesByMatch.has(matchId)) {
            historyGamesByMatch.set(matchId, []);
          }
          historyGamesByMatch.get(matchId).push(game);
        });
        historyGamesByMatch.forEach(list => {
          list.sort((a, b) => {
            const aTime = new Date(a?.endTime || a?.startTime || a?.createdAt || 0).getTime();
            const bTime = new Date(b?.endTime || b?.startTime || b?.createdAt || 0).getTime();
            return aTime - bTime;
          });
          const count = Array.isArray(list) ? list.length : 0;
          if (count > historyMaxGameCount) {
            historyMaxGameCount = count;
          }
        });
      }

      if (Array.isArray(historyMatches)) {
        historyMatches.forEach(match => {
          const inlineGames = Array.isArray(match?.games) ? match.games.length : 0;
          if (inlineGames > historyMaxGameCount) {
            historyMaxGameCount = inlineGames;
          }
        });
      }

      historyMaxGameCount = Math.max(1, Math.round(historyMaxGameCount));
    } catch (err) {
      console.error('Failed to fetch history data', err);
      historyMatches = [];
      historyGames = [];
      historyMaxGameCount = 1;
      historyGamesByMatch.clear();
    }
    updateHistorySummary();
    renderHistoryList();
  }

  async function requestMatchDeletion(matchId) {
    const id = matchId ? String(matchId) : '';
    if (!id) {
      alert('Unable to delete match: missing identifier.');
      return;
    }

    if (!confirm('Are you sure you want to delete this match? This will also remove associated games.')) {
      return;
    }

    try {
      const res = await authFetch('/api/v1/matches/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': localStorage.getItem('ADMIN_SECRET') || ''
        },
        body: JSON.stringify({ matchId: id })
      });

      if (!res.ok) {
        const message = res.status === 404
          ? 'Match not found.'
          : `Failed to delete match. (${res.status})`;
        alert(message);
        return;
      }

      const data = await res.json().catch(() => null);
      const deletedGames = data && typeof data.deletedGames === 'number' ? data.deletedGames : 0;
      const adjustments = Array.isArray(data?.eloAdjustments) ? data.eloAdjustments.length : 0;
      const summaryParts = ['Match deleted.'];
      if (deletedGames > 0) {
        summaryParts.push(`${deletedGames} game${deletedGames === 1 ? '' : 's'} removed.`);
      }
      if (adjustments > 0) {
        summaryParts.push(`${adjustments} Elo adjustment${adjustments === 1 ? '' : 's'} applied.`);
      }
      alert(summaryParts.join(' '));

      fetchAllUsers();
      fetchHistoryData();
    } catch (err) {
      console.error('Error deleting match:', err);
      alert('An error occurred while deleting the match. Check console for details.');
    }
  }

  function updateHistorySummary() {
    if (!historySummaryEls.totalGames) return;
    const summary = computeHistorySummary(historyMatches, historyGames);
    const games = summary.games;
    const quickplay = summary.quickplayGames;
    const ranked = summary.rankedMatches;
    const custom = summary.customMatches;
    const bots = summary.botMatches;

    historySummaryEls.totalGames.textContent = games.total;
    if (historySummaryEls.totalGamesWins) {
      historySummaryEls.totalGamesWins.textContent = games.wins;
    }
    if (historySummaryEls.totalGamesDraws) {
      historySummaryEls.totalGamesDraws.textContent = games.draws;
    }
    if (historySummaryEls.totalGamesLosses) {
      historySummaryEls.totalGamesLosses.textContent = games.losses;
    }

    historySummaryEls.quickplayMatches.textContent = quickplay.total;
    if (historySummaryEls.quickplayWins) {
      historySummaryEls.quickplayWins.textContent = quickplay.wins;
    }
    if (historySummaryEls.quickplayDraws) {
      historySummaryEls.quickplayDraws.textContent = quickplay.draws;
    }
    if (historySummaryEls.quickplayLosses) {
      historySummaryEls.quickplayLosses.textContent = quickplay.losses;
    }
    if (historySummaryEls.botMatches) {
      historySummaryEls.botMatches.textContent = bots.total;
    }
    if (historySummaryEls.botWins) {
      historySummaryEls.botWins.textContent = bots.wins;
    }
    if (historySummaryEls.botDraws) {
      historySummaryEls.botDraws.textContent = bots.draws;
    }
    if (historySummaryEls.botLosses) {
      historySummaryEls.botLosses.textContent = bots.losses;
    }

    historySummaryEls.rankedMatches.textContent = ranked.total;
    if (historySummaryEls.rankedWins) {
      historySummaryEls.rankedWins.textContent = ranked.wins;
    }
    if (historySummaryEls.rankedDraws) {
      historySummaryEls.rankedDraws.textContent = ranked.draws;
    }
    if (historySummaryEls.rankedLosses) {
      historySummaryEls.rankedLosses.textContent = ranked.losses;
    }

    if (historySummaryEls.customMatches) {
      historySummaryEls.customMatches.textContent = custom.total;
    }
    if (historySummaryEls.customWins) {
      historySummaryEls.customWins.textContent = custom.wins;
    }
    if (historySummaryEls.customDraws) {
      historySummaryEls.customDraws.textContent = custom.draws;
    }
    if (historySummaryEls.customLosses) {
      historySummaryEls.customLosses.textContent = custom.losses;
    }
  }

  function formatMatchTypeLabel(type) {
    if (!type) return 'Match';
    const upper = String(type).trim().toUpperCase();
    if (upper === 'RANKED') return 'Ranked';
    if (upper === 'QUICKPLAY') return 'Quickplay';
    if (upper === 'CUSTOM') return 'Custom';
    const typeString = String(type);
    return `${typeString.charAt(0).toUpperCase()}${typeString.slice(1).toLowerCase()}`;
  }

  function formatMatchType(type) {
    const baseLabel = formatMatchTypeLabel(type);
    if (!baseLabel || baseLabel === 'Match') return 'Match';
    const upper = typeof type === 'string' ? type.toUpperCase() : '';
    if (upper === 'CUSTOM') return 'Custom Match';
    return `${baseLabel} Match`;
  }

  function formatMatchDate(match) {
    const end = match?.endedAt instanceof Date ? match.endedAt : (match?.endTime ? new Date(match.endTime) : null);
    const start = match?.startTime ? new Date(match.startTime) : null;
    const date = end || start;
    if (!date) return 'Unknown date';
    try {
      return date.toLocaleString();
    } catch (err) {
      return date.toISOString();
    }
  }

  async function requestMatchDeletion(matchId) {
    const normalizedId = normalizeId(matchId);
    if (!normalizedId) {
      alert('Unable to delete match: missing identifier.');
      return;
    }

    const confirmation = confirm('Delete this match and all related games? This will also undo ranked ELO changes.');
    if (!confirmation) return;

    try {
      const res = await authFetch('/api/v1/matches/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
        },
        body: JSON.stringify({ matchId: normalizedId })
      });

      if (!res.ok) {
        let errorMessage = 'Failed to delete match.';
        try {
          const errorData = await res.json();
          if (errorData && typeof errorData.message === 'string') {
            errorMessage = errorData.message;
          }
        } catch (err) {
          // ignore JSON parse errors
        }
        alert(`${errorMessage} (status ${res.status})`);
        return;
      }

      let data = null;
      try {
        data = await res.json();
      } catch (err) {
        data = null;
      }

      const messageParts = ['Match deleted successfully.'];
      const deletedGames = data && typeof data.deletedGames === 'number' ? data.deletedGames : null;
      if (typeof deletedGames === 'number') {
        messageParts.push(`Games removed: ${deletedGames}`);
      }
      const eloAdjustments = Array.isArray(data?.eloAdjustments) ? data.eloAdjustments : [];
      if (eloAdjustments.length > 0) {
        const adjustmentsText = eloAdjustments
          .map(adj => {
            const name = getUsername(adj.userId) || adj.userId || 'Unknown player';
            const adjValue = typeof adj.adjustment === 'number' ? adj.adjustment : 0;
            const formatted = adjValue > 0 ? `+${adjValue}` : String(adjValue);
            return `${name}: ${formatted}`;
          })
          .join(', ');
        if (adjustmentsText) {
          messageParts.push(`ELO adjustments: ${adjustmentsText}`);
        }
      }

      alert(messageParts.join('\n'));
    } catch (err) {
      console.error(err);
      alert('Error deleting match. Check console for details.');
    } finally {
      fetchHistoryData();
    }
  }

  function renderHistoryList() {
    if (!historyMatchesListEl) return;
    historyMatchesListEl.innerHTML = '';
    const matches = Array.isArray(historyMatches) ? historyMatches.slice() : [];
    matches.sort((a, b) => {
      const aTime = new Date(a?.endTime || a?.startTime || 0).getTime();
      const bTime = new Date(b?.endTime || b?.startTime || 0).getTime();
      return bTime - aTime;
    });
    const filtered = matches.filter(match => {
      if (!match || match.isActive) return false;
      const type = typeof match?.type === 'string' ? match.type.toUpperCase() : '';
      if (historyFilter === 'quickplay') return type === 'QUICKPLAY';
      if (historyFilter === 'bot') return type === 'AI';
      if (historyFilter === 'custom') return type === 'CUSTOM';
      if (historyFilter === 'ranked') return type === 'RANKED';
      return true;
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'No matches recorded yet.';
      empty.style.padding = '12px 0';
      empty.style.opacity = '0.8';
      historyMatchesListEl.appendChild(empty);
      return;
    }

    const matchEntries = filtered.map(match => {
      const descriptor = describeMatch(match, { usernameLookup: getUsername });
      const matchId = normalizeId(match?._id || match?.id || descriptor.id);
      const games = matchId ? (historyGamesByMatch.get(matchId) || []) : [];
      return { match, descriptor, games, matchId };
    });

    const maxGameCount = Math.max(1, historyMaxGameCount);

    matchEntries.forEach(({ match, descriptor, games, matchId }) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      const meta = document.createElement('div');
      meta.className = 'history-row-top';
      const header = document.createElement('div');
      header.className = 'history-row-header';
      const pill = document.createElement('span');
      pill.className = 'history-pill';
      pill.textContent = formatMatchType(descriptor.type);
      header.appendChild(pill);
      const date = document.createElement('span');
      date.className = 'history-date';
      date.textContent = formatMatchDate(descriptor);
      header.appendChild(date);
      meta.appendChild(header);

      const deleteBtn = createButton({
        label: '🗑',
        variant: 'danger',
        position: 'relative'
      });
      deleteBtn.classList.add('history-delete-btn');
      deleteBtn.setAttribute('aria-label', 'Delete match');
      deleteBtn.title = 'Delete this match';
      if (matchId) {
        deleteBtn.addEventListener('click', () => {
          requestMatchDeletion(matchId);
        });
      } else {
        deleteBtn.disabled = true;
        deleteBtn.title = 'Unable to delete match: missing identifier';
      }
      meta.appendChild(deleteBtn);
      row.appendChild(meta);

      const matchForGrid = Object.assign({}, match, { games });
      const table = buildMatchDetailGrid(matchForGrid, { usernameLookup: getUsername, maxGameCount });
      row.appendChild(table);

      historyMatchesListEl.appendChild(row);
    });
  }

  socket.on('connect', () => {
    fetchAllUsers();
  });

  socket.on('admin:metrics', payload => {
    if (!payload) return;
    latestMetrics = payload;
    if (payload.usernames) {
      Object.keys(payload.usernames).forEach(k => {
        usernameMap[k] = payload.usernames[k];
      });
    }
    if (connectedUsersEl) connectedUsersEl.textContent = payload.connectedUsers ?? 0;
    if (quickplayQueueEl) quickplayQueueEl.textContent = payload.quickplayQueue ?? 0;
    if (rankedQueueEl) rankedQueueEl.textContent = payload.rankedQueue ?? 0;
    renderList(quickplayQueueListEl, payload.quickplayQueueUserIds);
    renderList(rankedQueueListEl, payload.rankedQueueUserIds);
    activeMatchesStore.replaceAll(payload.matches);
    fetchAllUsers();
    if (historyLoaded) {
      fetchHistoryData();
    }
  });

  socket.on('admin:matchUpdated', payload => {
    activeMatchesStore.applyUpdate(payload);
  });

  socket.on('spectate:snapshot', (payload) => {
    if (spectateController) {
      spectateController.handleSnapshot(payload);
    }
  });

  socket.on('spectate:update', (payload) => {
    if (spectateController) {
      spectateController.handleUpdate(payload);
    }
  });

  socket.on('spectate:error', (payload) => {
    if (spectateController) {
      spectateController.handleError(payload);
    }
  });

  socket.on('user:nameUpdated', payload => {
    try {
      const id = payload?.userId ? String(payload.userId) : null;
      const name = typeof payload === 'string' ? payload : payload?.username;
      if (!id || typeof name !== 'string' || !name.trim()) return;
      const trimmed = name.trim();
      usernameMap[id] = trimmed;
      if (latestMetrics && latestMetrics.usernames) {
        latestMetrics.usernames[id] = trimmed;
      }
      fetchAllUsers();
      renderActiveMatchesFromState();
      if (latestMetrics) {
        renderList(quickplayQueueListEl, latestMetrics.quickplayQueueUserIds);
        renderList(rankedQueueListEl, latestMetrics.rankedQueueUserIds);
      }
    } catch (err) {
      console.error('Error handling user:nameUpdated event:', err);
    }
  });

  if (purgeActiveMatchesBtn) {
    purgeActiveMatchesBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to purge all ACTIVE matches from the database? This cannot be undone.')) return;
      try {
        const res = await authFetch('/api/v1/matches/purge-active', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
          }
        });
        if (!res.ok) {
          alert('Failed to purge active matches: ' + res.status);
          return;
        }
        const data = await res.json();
        const matchCount = data && typeof data.deletedMatches === 'number' ? data.deletedMatches : (data && data.deleted) || 0;
        const gameCount = data && typeof data.deletedGames === 'number' ? data.deletedGames : 0;
        alert('Purged active matches: ' + matchCount + ' (games removed: ' + gameCount + ')');
        activeMatchesStore.replaceAll([]);
        if (spectateController && spectateController.isOpen && spectateController.isOpen()) {
          spectateController.close();
        }
        if (historyLoaded) fetchHistoryData();
      } catch (err) {
        console.error(err);
        alert('Error purging active matches. Check console.');
      }
    });
  }

})();


