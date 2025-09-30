import { computeHistorySummary, describeMatch, buildMatchDetailGrid, normalizeId } from '/js/modules/history/dashboard.js';
import { createDaggerCounter } from '/js/modules/ui/banners.js';
import { getCookie } from '/js/modules/utils/cookies.js';
import { preloadAssets } from '/js/modules/utils/assetPreloader.js';

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
    const stored = getStoredAuthToken();
    if (stored) return stored;
    const cookieToken = getCookie(TOKEN_COOKIE_NAME);
    if (cookieToken) {
      setStoredAuthToken(cookieToken);
      return cookieToken;
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

  const tabButtons = Array.from(document.querySelectorAll('.tab-button'));
  const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

  const connectedUsersEl = document.getElementById('connectedUsers');
  const quickplayQueueEl = document.getElementById('quickplayQueue');
  const rankedQueueEl = document.getElementById('rankedQueue');
  const quickplayQueueListEl = document.getElementById('quickplayQueueList');
  const rankedQueueListEl = document.getElementById('rankedQueueList');
  const usersListEl = document.getElementById('usersList');
  const matchesListEl = document.getElementById('matchesList');
  const purgeActiveMatchesBtn = document.getElementById('purgeActiveMatchesBtn');
  const purgeMatchesBtn = document.getElementById('purgeMatchesBtn');
  const purgeUsersBtn = document.getElementById('purgeUsersBtn');

  const historyMatchesListEl = document.getElementById('historyMatchesList');
  const historyFilterButtons = Array.from(document.querySelectorAll('[data-history-filter]'));
  const historySummaryEls = {
    totalGames: document.getElementById('historyTotalGames'),
    totalGamesWins: document.getElementById('historyTotalGamesWins'),
    totalGamesDraws: document.getElementById('historyTotalGamesDraws'),
    totalGamesLosses: document.getElementById('historyTotalGamesLosses'),
    quickplayMatches: document.getElementById('historyQuickplayMatches'),
    quickplayWins: document.getElementById('historyQuickplayWins'),
    quickplayDraws: document.getElementById('historyQuickplayDraws'),
    quickplayLosses: document.getElementById('historyQuickplayLosses'),
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
  const activeMatchesState = new Map();
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
      const res = await authFetch('/api/v1/users/getList', {
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
        renderActiveMatchesFromState();
      }
      if (historyLoaded) {
        renderHistoryList();
      }
    } catch (err) {
      console.error('Error fetching user accounts:', err);
    }
  }

  function normalizeScoreValue(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : 0;
  }

  function normalizeActiveMatchRecord(match) {
    if (!match) return null;
    const id = normalizeId(match.id || match._id || match.matchId);
    if (!id) return null;
    const primaryPlayers = Array.isArray(match.players)
      ? match.players.map(playerId => normalizeId(playerId)).filter(Boolean)
      : [];
    const fallbackPlayers = [match.player1, match.player2]
      .map(playerId => normalizeId(playerId))
      .filter(Boolean);
    const players = primaryPlayers.length > 0 ? primaryPlayers : fallbackPlayers;
    const resolveScore = (...values) => {
      for (const value of values) {
        if (value === undefined || value === null) continue;
        const normalizedValue = normalizeScoreValue(value);
        if (Number.isFinite(normalizedValue)) {
          return normalizedValue;
        }
      }
      return null;
    };
    const normalized = {
      id,
      type: typeof match.type === 'string' ? match.type : null,
      players,
      player1Score: resolveScore(match.player1Score, match.player1_score, match.scores?.[0]),
      player2Score: resolveScore(match.player2Score, match.player2_score, match.scores?.[1]),
      drawCount: resolveScore(match.drawCount, match.draws),
    };
    if (match.isActive !== undefined) {
      normalized.isActive = Boolean(match.isActive);
    }
    return normalized;
  }

  function updateLatestMetricsMatches() {
    if (latestMetrics) {
      latestMetrics.matches = Array.from(activeMatchesState.values());
    }
  }

  function replaceActiveMatches(matches) {
    activeMatchesState.clear();
    if (Array.isArray(matches)) {
      matches.forEach(item => {
        const normalized = normalizeActiveMatchRecord(item);
        if (!normalized || normalized.isActive === false) return;
        activeMatchesState.set(normalized.id, {
          id: normalized.id,
          type: normalized.type,
          players: normalized.players,
          player1Score: Number.isFinite(normalized.player1Score) ? normalized.player1Score : 0,
          player2Score: Number.isFinite(normalized.player2Score) ? normalized.player2Score : 0,
          drawCount: Number.isFinite(normalized.drawCount) ? normalized.drawCount : 0,
        });
      });
    }
    updateLatestMetricsMatches();
  }

  function applyActiveMatchUpdate(match) {
    const normalized = normalizeActiveMatchRecord(match);
    if (!normalized) return false;
    const existing = activeMatchesState.get(normalized.id);
    if (normalized.isActive === false) {
      const removed = activeMatchesState.delete(normalized.id);
      if (removed) updateLatestMetricsMatches();
      return removed;
    }
    const next = {
      id: normalized.id,
      type: normalized.type || existing?.type || null,
      players: normalized.players.length > 0 ? normalized.players : (existing?.players || []),
      player1Score: Number.isFinite(normalized.player1Score)
        ? normalized.player1Score
        : (existing?.player1Score ?? 0),
      player2Score: Number.isFinite(normalized.player2Score)
        ? normalized.player2Score
        : (existing?.player2Score ?? 0),
      drawCount: Number.isFinite(normalized.drawCount)
        ? normalized.drawCount
        : (existing?.drawCount ?? 0),
    };
    const changed =
      !existing
      || existing.type !== next.type
      || existing.player1Score !== next.player1Score
      || existing.player2Score !== next.player2Score
      || existing.drawCount !== next.drawCount
      || existing.players.length !== next.players.length
      || existing.players.some((value, idx) => value !== next.players[idx]);
    if (changed || !existing) {
      activeMatchesState.set(next.id, next);
      updateLatestMetricsMatches();
      return true;
    }
    return false;
  }

  function renderActiveMatchesFromState() {
    renderActiveMatchesList(matchesListEl, Array.from(activeMatchesState.values()));
  }

  function formatMatchTypeLabel(type) {
    if (!type) return 'Match';
    const upper = String(type).toUpperCase();
    if (upper === 'RANKED') return 'Ranked';
    if (upper === 'QUICKPLAY') return 'Quickplay';
    if (upper === 'CUSTOM') return 'Custom';
    return `${String(type).charAt(0).toUpperCase()}${String(type).slice(1).toLowerCase()}`;
  }

  function renderActiveMatchesList(targetEl, items) {
    if (!targetEl) return;
    targetEl.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) return;

    const frag = document.createDocumentFragment();

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.gap = '12px';

      const typePill = document.createElement('span');
      typePill.className = 'matchTypePill';
      typePill.textContent = formatMatchTypeLabel(item?.type);
      row.appendChild(typePill);

      const players = Array.isArray(item?.players) ? item.players : [];
      const player1Id = players[0] || null;
      const player2Id = players[1] || null;
      const player1Name = getUsername(player1Id);
      const player2Name = getUsername(player2Id);

      const player1Score = normalizeScoreValue(item?.player1Score);
      const player2Score = normalizeScoreValue(item?.player2Score);
      const drawCount = normalizeScoreValue(item?.drawCount);

      const scoreLine = document.createElement('div');
      scoreLine.className = 'matchScoreLine';
      scoreLine.style.flex = '1 1 auto';
      scoreLine.style.minWidth = '0';
      const opponentLine = [player1Name || player1Id || 'Player 1', 'vs', player2Name || player2Id || 'Player 2']
        .filter(Boolean)
        .join(' ');
      scoreLine.title = opponentLine;

      const player1Label = document.createElement('span');
      player1Label.className = 'matchPlayerName';
      player1Label.textContent = player1Name || player1Id || 'Player 1';
      scoreLine.appendChild(player1Label);

      const player1ScoreEl = document.createElement('span');
      player1ScoreEl.className = 'matchScoreValue';
      player1ScoreEl.textContent = player1Score;
      scoreLine.appendChild(player1ScoreEl);

      const separatorEl = document.createElement('span');
      separatorEl.className = 'matchScoreSeparator';
      separatorEl.textContent = '-';
      scoreLine.appendChild(separatorEl);

      const player2ScoreEl = document.createElement('span');
      player2ScoreEl.className = 'matchScoreValue';
      player2ScoreEl.textContent = player2Score;
      scoreLine.appendChild(player2ScoreEl);

      const player2Label = document.createElement('span');
      player2Label.className = 'matchPlayerName';
      player2Label.textContent = player2Name || player2Id || 'Player 2';
      scoreLine.appendChild(player2Label);

      row.appendChild(scoreLine);

      const drawLine = document.createElement('div');
      drawLine.className = 'matchDrawLine';
      drawLine.title = `Draws: ${drawCount}`;

      const drawIcon = document.createElement('img');
      drawIcon.src = 'assets/images/draw.png';
      drawIcon.alt = 'Draws';
      drawIcon.className = 'matchDrawIcon';
      drawLine.appendChild(drawIcon);

      const drawValue = document.createElement('span');
      drawValue.className = 'matchScoreValue';
      drawValue.textContent = drawCount;
      drawLine.appendChild(drawValue);

      row.appendChild(drawLine);

      const spectateBtn = document.createElement('button');
      spectateBtn.type = 'button';
      spectateBtn.className = 'spectateBtn';
      spectateBtn.textContent = 'Spectate';
      spectateBtn.setAttribute('aria-label', `Spectate match ${item?.id || ''}`.trim());
      spectateBtn.addEventListener('click', () => {
        alert('Spectate coming soon');
      });
      row.appendChild(spectateBtn);

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

  function updateHistorySummary() {
    if (!historySummaryEls.totalGames) return;
    const summary = computeHistorySummary(historyMatches, historyGames);
    const games = summary.games;
    const quickplay = summary.quickplayGames;
    const ranked = summary.rankedMatches;
    const custom = summary.customMatches;

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

  function formatMatchType(type) {
    const baseLabel = formatMatchTypeLabel(type);
    if (!baseLabel || baseLabel === 'Match') return 'Match';
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
    replaceActiveMatches(payload.matches);
    renderActiveMatchesFromState();
    fetchAllUsers();
    if (historyLoaded) {
      fetchHistoryData();
    }
  });

  socket.on('admin:matchUpdated', payload => {
    if (applyActiveMatchUpdate(payload)) {
      renderActiveMatchesFromState();
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
        const res = await authFetch('/api/v1/matches/purge', {
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
        const res = await authFetch('/api/v1/users/purge', {
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
