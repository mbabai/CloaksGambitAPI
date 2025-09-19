import { computeHistorySummary, describeMatch, buildMatchDetailGrid, normalizeId } from '/js/modules/history/dashboard.js';
import { createDaggerCounter } from '/js/modules/ui/banners.js';

(function () {
  const origin = window.location.origin.replace(/\/$/, '');
  const socket = io(origin + '/admin');
  const params = new URLSearchParams(window.location.search);
  const adminIdParam = params.get('adminId');
  const adminUserId = adminIdParam || localStorage.getItem('cg_userId') || null;

  const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

  const connectedUsersEl = document.getElementById('connectedUsers');
  const quickplayQueueEl = document.getElementById('quickplayQueue');
  const rankedQueueEl = document.getElementById('rankedQueue');
  const quickplayQueueListEl = document.getElementById('quickplayQueueList');
  const rankedQueueListEl = document.getElementById('rankedQueueList');
  const usersListEl = document.getElementById('usersList');
  const gamesListEl = document.getElementById('gamesList');
  const matchesListEl = document.getElementById('matchesList');
  const purgeActiveMatchesBtn = document.getElementById('purgeActiveMatchesBtn');
  const purgeMatchesBtn = document.getElementById('purgeMatchesBtn');
  const purgeUsersBtn = document.getElementById('purgeUsersBtn');

  const historyMatchesListEl = document.getElementById('historyMatchesList');
  const historyFilterButtons = Array.from(document.querySelectorAll('[data-history-filter]'));
  const historySummaryEls = {
    totalGames: document.getElementById('historyTotalGames'),
    totalGamesBreakdown: document.getElementById('historyTotalGamesBreakdown'),
    totalMatches: document.getElementById('historyTotalMatches'),
    totalMatchesBreakdown: document.getElementById('historyTotalMatchesBreakdown'),
    quickplayGames: document.getElementById('historyQuickplayGames'),
    quickplayGamesBreakdown: document.getElementById('historyQuickplayGamesBreakdown'),
    rankedMatches: document.getElementById('historyRankedMatches'),
    rankedMatchesBreakdown: document.getElementById('historyRankedMatchesBreakdown')
  };

  const usernameMap = {};
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
    const matchCells = [];
    const connCells = [];
    const header = document.createElement('div');
    header.className = 'row headerRow';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'flex-start';
    header.style.gap = '12px';
    const hName = document.createElement('span');
    hName.textContent = 'Username';
    hName.style.flex = '1 1 auto';
    hName.style.minWidth = '0';
    const hMatch = document.createElement('span');
    hMatch.textContent = 'In Match';
    hMatch.style.display = 'inline-flex';
    hMatch.style.justifyContent = 'center';
    hMatch.style.alignItems = 'center';
    hMatch.style.whiteSpace = 'nowrap';
    hMatch.style.wordBreak = 'keep-all';
    const hConn = document.createElement('span');
    hConn.textContent = 'Connected';
    hConn.style.display = 'inline-flex';
    hConn.style.justifyContent = 'center';
    hConn.style.alignItems = 'center';
    hConn.style.whiteSpace = 'nowrap';
    hConn.style.wordBreak = 'keep-all';
    header.appendChild(hName);
    header.appendChild(hMatch);
    header.appendChild(hConn);
    matchCells.push(hMatch);
    connCells.push(hConn);
    frag.appendChild(header);

    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'flex-start';
      row.style.gap = '12px';
      const nameEl = document.createElement(adminUserId && u.id === adminUserId ? 'strong' : 'span');
      nameEl.textContent = u.username || 'Unknown';
      nameEl.title = u.id;
      nameEl.style.flex = '1 1 auto';
      nameEl.style.minWidth = '0';
      const matchEl = document.createElement('span');
      matchEl.style.display = 'inline-flex';
      matchEl.style.justifyContent = 'center';
      matchEl.style.alignItems = 'center';
      matchEl.style.whiteSpace = 'nowrap';
      matchEl.style.wordBreak = 'keep-all';
      matchEl.style.padding = '0 2px';
      if (inMatchSet.has(u.id)) {
        const daggers = createDaggerCounter({ count: 1, size: 18, gap: 0, alt: 'In active match' });
        matchEl.appendChild(daggers);
        matchEl.title = 'Player is in an active match';
        matchEl.setAttribute('aria-label', 'In active match');
      } else {
        matchEl.setAttribute('aria-label', 'Not in active match');
      }
      const connEl = document.createElement('span');
      connEl.style.display = 'inline-flex';
      connEl.style.justifyContent = 'center';
      connEl.style.alignItems = 'center';
      connEl.style.whiteSpace = 'nowrap';
      connEl.style.wordBreak = 'keep-all';
      connEl.style.padding = '0 2px';
      if (connectedSet.has(u.id)) {
        const img = document.createElement('img');
        img.src = 'assets/images/GoldThrone.svg';
        img.alt = '';
        img.style.width = '16px';
        img.style.height = '16px';
        connEl.appendChild(img);
      }
      row.appendChild(nameEl);
      row.appendChild(matchEl);
      row.appendChild(connEl);
      matchCells.push(matchEl);
      connCells.push(connEl);
      frag.appendChild(row);
    });
    targetEl.appendChild(frag);
    let matchWidth = 0;
    let connWidth = 0;
    matchCells.forEach(cell => {
      matchWidth = Math.max(matchWidth, Math.ceil(cell.getBoundingClientRect().width));
    });
    connCells.forEach(cell => {
      connWidth = Math.max(connWidth, Math.ceil(cell.getBoundingClientRect().width));
    });
    const setColumnWidth = (cells, width) => {
      if (!width) return;
      cells.forEach(cell => {
        cell.style.flex = `0 0 ${width}px`;
        cell.style.maxWidth = `${width}px`;
        cell.style.minWidth = `${width}px`;
      });
    };
    setColumnWidth(matchCells, matchWidth);
    setColumnWidth(connCells, connWidth);
  }

  async function fetchAllUsers() {
    if (!usersListEl) return;
    try {
      const res = await fetch('/api/v1/users/getList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
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
          usernameMap[id] = username;
          users.push({ id, username });
        });
      }
      renderUsersList(
        usersListEl,
        users,
        latestMetrics ? latestMetrics.connectedUserIds : [],
        latestMetrics ? latestMetrics.matches : []
      );
      if (latestMetrics) {
        renderList(quickplayQueueListEl, latestMetrics.quickplayQueueUserIds);
        renderList(rankedQueueListEl, latestMetrics.rankedQueueUserIds);
        renderGameOrMatchList(gamesListEl, latestMetrics.games);
        renderGameOrMatchList(matchesListEl, latestMetrics.matches);
      }
      if (historyLoaded) {
        renderHistoryList();
      }
    } catch (err) {
      console.error('Error fetching user accounts:', err);
    }
  }

  function renderGameOrMatchList(targetEl, items) {
    if (!targetEl) return;
    targetEl.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) return;
    const frag = document.createDocumentFragment();
    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'row';
      const idSpan = document.createElement('span');
      idSpan.textContent = item.id;
      idSpan.style.opacity = '0.9';
      idSpan.style.marginRight = '12px';
      row.appendChild(idSpan);
      (item.players || []).forEach(pid => {
        const nameEl = document.createElement(adminUserId && pid === adminUserId ? 'strong' : 'span');
        nameEl.textContent = getUsername(pid);
        nameEl.title = pid;
        nameEl.style.marginRight = '10px';
        row.appendChild(nameEl);
      });
      frag.appendChild(row);
    });
    targetEl.appendChild(frag);
  }

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
      const [matchesRes, gamesRes] = await Promise.all([
        fetch('/api/v1/matches/getList', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }),
        fetch('/api/v1/games/getList', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
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

  function updateHistorySummary() {
    if (!historySummaryEls.totalGames) return;
    const summary = computeHistorySummary(historyMatches, historyGames);
    const games = summary.games;
    const matches = summary.matches;
    const quickplay = summary.quickplayGames;
    const ranked = summary.rankedMatches;

    historySummaryEls.totalGames.textContent = games.total;
    if (historySummaryEls.totalGamesBreakdown) {
      historySummaryEls.totalGamesBreakdown.textContent = '';
    }

    historySummaryEls.totalMatches.textContent = matches.total;
    if (historySummaryEls.totalMatchesBreakdown) {
      historySummaryEls.totalMatchesBreakdown.textContent = '';
    }

    historySummaryEls.quickplayGames.textContent = quickplay.total;
    if (historySummaryEls.quickplayGamesBreakdown) {
      historySummaryEls.quickplayGamesBreakdown.textContent = '';
    }

    historySummaryEls.rankedMatches.textContent = ranked.total;
    if (historySummaryEls.rankedMatchesBreakdown) {
      historySummaryEls.rankedMatchesBreakdown.textContent = '';
    }
  }

  function formatMatchType(type) {
    if (!type) return 'Match';
    const upper = type.toUpperCase();
    if (upper === 'RANKED') return 'Ranked Match';
    if (upper === 'QUICKPLAY') return 'Quickplay Match';
    return `${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()} Match`;
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
      return { match, descriptor, games };
    });

    const maxGameCount = Math.max(1, historyMaxGameCount);

    matchEntries.forEach(({ match, descriptor, games }) => {
      const row = document.createElement('div');
      row.className = 'history-row';
      const meta = document.createElement('div');
      meta.className = 'history-row-top';
      const pill = document.createElement('span');
      pill.className = 'history-pill';
      pill.textContent = formatMatchType(descriptor.type);
      meta.appendChild(pill);
      const date = document.createElement('span');
      date.className = 'history-date';
      date.textContent = formatMatchDate(descriptor);
      meta.appendChild(date);
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
    renderGameOrMatchList(gamesListEl, payload.games);
    renderGameOrMatchList(matchesListEl, payload.matches);
    fetchAllUsers();
    if (historyLoaded) {
      fetchHistoryData();
    }
  });

  if (purgeActiveMatchesBtn) {
    purgeActiveMatchesBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to purge all ACTIVE matches from the database? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/v1/matches/purge-active', {
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
        if (historyLoaded) fetchHistoryData();
      } catch (err) {
        console.error(err);
        alert('Error purging active matches. Check console.');
      }
    });
  }

  if (purgeMatchesBtn) {
    purgeMatchesBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to purge ALL matches from the database? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/v1/matches/purge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
          }
        });
        if (!res.ok) {
          alert('Failed to purge matches: ' + res.status);
          return;
        }
        const data = await res.json();
        alert('Purged matches: ' + (data.deleted || 0));
        if (historyLoaded) fetchHistoryData();
      } catch (err) {
        console.error(err);
        alert('Error purging matches. Check console.');
      }
    });
  }

  if (purgeUsersBtn) {
    purgeUsersBtn.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to purge ALL user accounts from the database? This cannot be undone.')) return;
      try {
        const res = await fetch('/api/v1/users/purge', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
          }
        });
        if (!res.ok) {
          alert('Failed to purge users: ' + res.status);
          return;
        }
        const data = await res.json();
        alert('Purged users: ' + (data.deleted || 0));
        if (historyLoaded) fetchHistoryData();
      } catch (err) {
        console.error(err);
        alert('Error purging users. Check console.');
      }
    });
  }
})();
