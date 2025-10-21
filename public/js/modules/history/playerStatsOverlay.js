import { createOverlay } from '../ui/overlays.js';
import {
  computeHistorySummary,
  describeMatch,
  buildMatchDetailGrid,
  normalizeId
} from './dashboard.js';

const DEFAULT_FILTER = 'all';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeFilter(value) {
  if (!value) return DEFAULT_FILTER;
  const normalized = String(value).toLowerCase();
  if (normalized === 'quickplay') return 'quickplay';
  if (normalized === 'bot' || normalized === 'bots' || normalized === 'ai') return 'bot';
  if (normalized === 'custom') return 'custom';
  if (normalized === 'ranked') return 'ranked';
  return DEFAULT_FILTER;
}

function formatMatchTypeLabel(type) {
  if (!type) return 'Match';
  const upper = String(type).toUpperCase();
  if (upper === 'RANKED') return 'Ranked Match';
  if (upper === 'QUICKPLAY') return 'Quickplay Match';
  if (upper === 'CUSTOM') return 'Custom Match';
  if (upper === 'AI') return 'Bot Match';
  return `${String(type).charAt(0).toUpperCase()}${String(type).slice(1).toLowerCase()} Match`;
}

function formatMatchDateLabel(match) {
  const end = match?.endedAt instanceof Date
    ? match.endedAt
    : (match?.endTime ? new Date(match.endTime) : null);
  const start = match?.startTime ? new Date(match.startTime) : null;
  const date = end || start;
  if (!date) return 'Unknown date';
  try {
    return date.toLocaleString();
  } catch (err) {
    return date.toISOString();
  }
}

export function createPlayerStatsOverlay({
  authFetch,
  getPreferredWidth
} = {}) {
  if (typeof authFetch !== 'function') {
    throw new TypeError('createPlayerStatsOverlay requires an authFetch function');
  }

  const preferredWidth = typeof getPreferredWidth === 'function'
    ? () => {
        try {
          const width = getPreferredWidth();
          return Number.isFinite(width) ? Math.max(0, Math.round(width)) : null;
        } catch (err) {
          console.warn('Failed to compute preferred stats overlay width', err);
          return null;
        }
      }
    : () => null;

  let defaultUser = null; // { id, username, elo }
  let currentUser = null; // { id, username, elo, source }
  let usernameMap = {};
  const botIds = new Set();
  let historyMatches = [];
  let historyGames = [];
  let historyMaxGameCount = 1;
  let historyFilter = DEFAULT_FILTER;
  let historyLoaded = false;
  let historyFetching = false;
  const historyGamesByMatch = new Map();

  let overlay = null;
  let overlayMatchesEl = null;
  let overlayFilterButtons = [];
  let overlayEloValueEl = null;
  let overlaySummaryEls = null;
  let overlayHeadingEl = null;
  let overlayNameEl = null;

  function getCurrentUserId() {
    return currentUser?.id || null;
  }

  function getDisplayNameForId(id) {
    if (!id) return '';
    return usernameMap[id] || id;
  }

  function normalizeBotId(id) {
    return normalizeId(id);
  }

  function markBotUser(id, isBot) {
    const normalized = normalizeBotId(id);
    if (!normalized) return;
    if (isBot) {
      botIds.add(normalized);
    } else {
      botIds.delete(normalized);
    }
  }

  function isBotUser(id) {
    const normalized = normalizeBotId(id);
    if (!normalized) return false;
    return botIds.has(normalized);
  }

  function resetHistoryState() {
    historyMatches = [];
    historyGames = [];
    historyMaxGameCount = 1;
    historyLoaded = false;
    historyGamesByMatch.clear();
  }

  function updateFilterButtons() {
    if (!overlayFilterButtons.length) return;
    const active = historyFilter;
    overlayFilterButtons.forEach((btn) => {
      const value = btn?.dataset?.historyFilter || DEFAULT_FILTER;
      btn.classList.toggle('active', value === active);
    });
  }

  function applyOverlayWidth() {
    if (!overlay || !overlay.dialog) return;
    const desired = preferredWidth();
    if (isFiniteNumber(desired) && desired > 0) {
      overlay.dialog.style.width = `${desired}px`;
      overlay.dialog.style.maxWidth = `${desired}px`;
    } else {
      overlay.dialog.style.removeProperty('width');
      overlay.dialog.style.removeProperty('max-width');
    }
  }

  function handleOverlayResize() {
    applyOverlayWidth();
  }

  function ensureOverlay() {
    if (overlay) return overlay;

    overlay = createOverlay({
      baseClass: 'cg-overlay history-overlay',
      dialogClass: 'history-modal',
      contentClass: 'history-modal-content',
      backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
      closeButtonClass: 'history-close-btn',
      closeLabel: 'Close history',
      closeText: '✕',
      openClass: 'open cg-overlay--open',
      bodyOpenClass: 'history-overlay-open cg-overlay-open',
      onShow() {
        applyOverlayWidth();
        window.addEventListener('resize', handleOverlayResize);
      },
      onHide() {
        window.removeEventListener('resize', handleOverlayResize);
      }
    });

    const { content, closeButton } = overlay;
    if (closeButton) {
      closeButton.setAttribute('aria-label', 'Close history');
    }

    const header = document.createElement('div');
    header.className = 'history-overlay-header';

    const heading = document.createElement('h2');
    heading.id = 'historyOverlayTitle';
    heading.textContent = 'Match History';
    overlayHeadingEl = heading;

    overlay.setLabelledBy(heading.id);
    header.appendChild(heading);

    const nameLine = document.createElement('p');
    nameLine.className = 'history-overlay-player';
    nameLine.hidden = true;
    overlayNameEl = nameLine;
    header.appendChild(nameLine);

    content.appendChild(header);

    const eloRow = document.createElement('div');
    eloRow.className = 'history-current-elo';
    eloRow.innerHTML = 'Current ELO: <span id="historyCurrentEloValue">—</span>';
    overlayEloValueEl = eloRow.querySelector('#historyCurrentEloValue');
    content.appendChild(eloRow);

    const summary = document.createElement('div');
    summary.className = 'history-summary';
    summary.innerHTML = `
      <div class="history-card">
        <div class="history-card-label">
          <span class="history-card-label-line">Total</span>
          <span class="history-card-label-line">Games</span>
        </div>
        <div class="history-card-stats">
          <span id="playerHistoryTotalGames" class="history-card-total history-card-value">0</span>
          <div class="history-card-splits">
            <span class="history-card-split history-card-split--wins">W:<span id="playerHistoryTotalGamesWins">0</span></span>
            <span class="history-card-split history-card-split--draws">D:<span id="playerHistoryTotalGamesDraws">0</span></span>
            <span class="history-card-split history-card-split--losses">L:<span id="playerHistoryTotalGamesLosses">0</span></span>
          </div>
        </div>
      </div>
      <div class="history-card">
        <div class="history-card-label">
          <span class="history-card-label-line">Quickplay</span>
          <span class="history-card-label-line">Matches</span>
        </div>
        <div class="history-card-stats">
          <span id="playerHistoryQuickplayMatches" class="history-card-total history-card-value">0</span>
          <div class="history-card-splits">
            <span class="history-card-split history-card-split--wins">W:<span id="playerHistoryQuickplayWins">0</span></span>
            <span class="history-card-split history-card-split--draws">D:<span id="playerHistoryQuickplayDraws">0</span></span>
            <span class="history-card-split history-card-split--losses">L:<span id="playerHistoryQuickplayLosses">0</span></span>
          </div>
        </div>
      </div>
      <div class="history-card">
        <div class="history-card-label">
          <span class="history-card-label-line">Bot</span>
          <span class="history-card-label-line">Matches</span>
        </div>
        <div class="history-card-stats">
          <span id="playerHistoryBotMatches" class="history-card-total history-card-value">0</span>
          <div class="history-card-splits">
            <span class="history-card-split history-card-split--wins">W:<span id="playerHistoryBotWins">0</span></span>
            <span class="history-card-split history-card-split--draws">D:<span id="playerHistoryBotDraws">0</span></span>
            <span class="history-card-split history-card-split--losses">L:<span id="playerHistoryBotLosses">0</span></span>
          </div>
        </div>
      </div>
      <div class="history-card">
        <div class="history-card-label">
          <span class="history-card-label-line">Ranked</span>
          <span class="history-card-label-line">Matches</span>
        </div>
        <div class="history-card-stats">
          <span id="playerHistoryRankedMatches" class="history-card-total history-card-value">0</span>
          <div class="history-card-splits">
            <span class="history-card-split history-card-split--wins">W:<span id="playerHistoryRankedWins">0</span></span>
            <span class="history-card-split history-card-split--draws">D:<span id="playerHistoryRankedDraws">0</span></span>
            <span class="history-card-split history-card-split--losses">L:<span id="playerHistoryRankedLosses">0</span></span>
          </div>
        </div>
      </div>
      <div class="history-card">
        <div class="history-card-label">
          <span class="history-card-label-line">Custom</span>
          <span class="history-card-label-line">Matches</span>
        </div>
        <div class="history-card-stats">
          <span id="playerHistoryCustomMatches" class="history-card-total history-card-value">0</span>
          <div class="history-card-splits">
            <span class="history-card-split history-card-split--wins">W:<span id="playerHistoryCustomWins">0</span></span>
            <span class="history-card-split history-card-split--draws">D:<span id="playerHistoryCustomDraws">0</span></span>
            <span class="history-card-split history-card-split--losses">L:<span id="playerHistoryCustomLosses">0</span></span>
          </div>
        </div>
      </div>`;
    overlaySummaryEls = {
      totalGames: summary.querySelector('#playerHistoryTotalGames'),
      totalGamesWins: summary.querySelector('#playerHistoryTotalGamesWins'),
      totalGamesDraws: summary.querySelector('#playerHistoryTotalGamesDraws'),
      totalGamesLosses: summary.querySelector('#playerHistoryTotalGamesLosses'),
      quickplayMatches: summary.querySelector('#playerHistoryQuickplayMatches'),
      quickplayWins: summary.querySelector('#playerHistoryQuickplayWins'),
      quickplayDraws: summary.querySelector('#playerHistoryQuickplayDraws'),
      quickplayLosses: summary.querySelector('#playerHistoryQuickplayLosses'),
      botMatches: summary.querySelector('#playerHistoryBotMatches'),
      botWins: summary.querySelector('#playerHistoryBotWins'),
      botDraws: summary.querySelector('#playerHistoryBotDraws'),
      botLosses: summary.querySelector('#playerHistoryBotLosses'),
      rankedMatches: summary.querySelector('#playerHistoryRankedMatches'),
      rankedWins: summary.querySelector('#playerHistoryRankedWins'),
      rankedDraws: summary.querySelector('#playerHistoryRankedDraws'),
      rankedLosses: summary.querySelector('#playerHistoryRankedLosses'),
      customMatches: summary.querySelector('#playerHistoryCustomMatches'),
      customWins: summary.querySelector('#playerHistoryCustomWins'),
      customDraws: summary.querySelector('#playerHistoryCustomDraws'),
      customLosses: summary.querySelector('#playerHistoryCustomLosses')
    };
    content.appendChild(summary);

    const filters = document.createElement('div');
    filters.className = 'history-filters';
    filters.innerHTML = `
      <button class="history-filter-btn active" data-history-filter="all">All</button>
      <button class="history-filter-btn" data-history-filter="quickplay">Quickplay</button>
      <button class="history-filter-btn" data-history-filter="bot">Bots</button>
      <button class="history-filter-btn" data-history-filter="custom">Custom</button>
      <button class="history-filter-btn" data-history-filter="ranked">Ranked</button>`;
    overlayFilterButtons = Array.from(filters.querySelectorAll('[data-history-filter]'));
    overlayFilterButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.historyFilter || DEFAULT_FILTER;
        setFilter(target);
      });
    });
    content.appendChild(filters);

    const contentScroll = document.createElement('div');
    contentScroll.className = 'history-overlay-content';
    overlayMatchesEl = document.createElement('div');
    overlayMatchesEl.className = 'history-matches';
    overlayMatchesEl.setAttribute('aria-live', 'polite');
    contentScroll.appendChild(overlayMatchesEl);
    content.appendChild(contentScroll);

    updateFilterButtons();
    updateHeading();
    updateEloDisplay();

    return overlay;
  }

  function updateHeading() {
    if (!overlayNameEl) return;
    const name = currentUser?.username || (currentUser?.id ? getDisplayNameForId(currentUser.id) : '');
    if (name) {
      overlayNameEl.textContent = name;
      overlayNameEl.hidden = false;
    } else {
      overlayNameEl.textContent = '';
      overlayNameEl.hidden = true;
    }
  }

  function updateEloDisplay() {
    if (!overlayEloValueEl) return;
    const elo = currentUser?.elo;
    overlayEloValueEl.textContent = isFiniteNumber(elo) ? String(Math.round(elo)) : '—';
  }

  function showMessage(message) {
    if (!overlayMatchesEl) return;
    overlayMatchesEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.textContent = message;
    msg.style.padding = '12px 0';
    msg.style.opacity = '0.85';
    overlayMatchesEl.appendChild(msg);
  }

  function updateSummary() {
    if (!overlaySummaryEls) return;
    const summary = computeHistorySummary(historyMatches, historyGames, { userId: currentUser?.id });
    const games = summary.games;
    const quickplay = summary.quickplayGames;
    const ranked = summary.rankedMatches;
    const custom = summary.customMatches;
    const bots = summary.botMatches;

    overlaySummaryEls.totalGames.textContent = games.total;
    overlaySummaryEls.totalGamesWins.textContent = games.wins;
    overlaySummaryEls.totalGamesDraws.textContent = games.draws;
    overlaySummaryEls.totalGamesLosses.textContent = games.losses;

    overlaySummaryEls.quickplayMatches.textContent = quickplay.total;
    overlaySummaryEls.quickplayWins.textContent = quickplay.wins;
    overlaySummaryEls.quickplayDraws.textContent = quickplay.draws;
    overlaySummaryEls.quickplayLosses.textContent = quickplay.losses;

    if (overlaySummaryEls.botMatches) overlaySummaryEls.botMatches.textContent = bots.total;
    if (overlaySummaryEls.botWins) overlaySummaryEls.botWins.textContent = bots.wins;
    if (overlaySummaryEls.botDraws) overlaySummaryEls.botDraws.textContent = bots.draws;
    if (overlaySummaryEls.botLosses) overlaySummaryEls.botLosses.textContent = bots.losses;

    overlaySummaryEls.rankedMatches.textContent = ranked.total;
    overlaySummaryEls.rankedWins.textContent = ranked.wins;
    overlaySummaryEls.rankedDraws.textContent = ranked.draws;
    overlaySummaryEls.rankedLosses.textContent = ranked.losses;

    if (overlaySummaryEls.customMatches) overlaySummaryEls.customMatches.textContent = custom.total;
    if (overlaySummaryEls.customWins) overlaySummaryEls.customWins.textContent = custom.wins;
    if (overlaySummaryEls.customDraws) overlaySummaryEls.customDraws.textContent = custom.draws;
    if (overlaySummaryEls.customLosses) overlaySummaryEls.customLosses.textContent = custom.losses;
  }

  function renderMatches() {
    if (!overlayMatchesEl) return;
    overlayMatchesEl.innerHTML = '';
    const matches = Array.isArray(historyMatches) ? historyMatches.slice() : [];
    matches.sort((a, b) => {
      const aTime = new Date(a?.endTime || a?.startTime || 0).getTime();
      const bTime = new Date(b?.endTime || b?.startTime || 0).getTime();
      return bTime - aTime;
    });

    const filtered = matches.filter((match) => {
      if (!match || match.isActive) return false;
      const type = typeof match?.type === 'string' ? match.type.toUpperCase() : '';
      if (historyFilter === 'quickplay') return type === 'QUICKPLAY';
      if (historyFilter === 'bot') return type === 'AI';
      if (historyFilter === 'custom') return type === 'CUSTOM';
      if (historyFilter === 'ranked') return type === 'RANKED';
      return true;
    });

    if (filtered.length === 0) {
      showMessage('No matches recorded yet. Play some games to see your history.');
      return;
    }

    const normalizedUserId = normalizeId(currentUser?.id);
    const matchEntries = filtered.map((match) => {
      const descriptor = describeMatch(match, {
        usernameLookup: (id) => getDisplayNameForId(id),
        userId: currentUser?.id,
      });
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
      pill.textContent = formatMatchTypeLabel(descriptor.type);
      meta.appendChild(pill);
      const date = document.createElement('span');
      date.className = 'history-date';
      date.textContent = formatMatchDateLabel(descriptor);
      meta.appendChild(date);
      row.appendChild(meta);

      const matchForGrid = Object.assign({}, match, { games });
      if (matchForGrid?.type && String(matchForGrid.type).toUpperCase() === 'AI') {
        const p1Id = normalizeId(matchForGrid.player1);
        const p2Id = normalizeId(matchForGrid.player2);
        if (normalizedUserId && p1Id && p1Id === normalizedUserId && p2Id) {
          markBotUser(p2Id, true);
        } else if (normalizedUserId && p2Id && p2Id === normalizedUserId && p1Id) {
          markBotUser(p1Id, true);
        }
      }
      const table = buildMatchDetailGrid(matchForGrid, {
        usernameLookup: (id) => {
          const normalized = normalizeId(id);
          const base = getDisplayNameForId(id) || getDisplayNameForId(normalized) || normalized || 'Unknown';
          if (normalizedUserId && normalized && normalized === normalizedUserId) {
            return `${base} (You)`;
          }
          return base;
        },
        maxGameCount,
        onPlayerClick: (info) => {
          if (!info || !info.id) return;
          const normalized = normalizeId(info.id);
          if (normalizedUserId && normalized && normalized === normalizedUserId) return;
          if (isBotUser(normalized)) return;
          const name = info.name || getDisplayNameForId(normalized);
          const elo = isFiniteNumber(info.elo) ? info.elo : null;
          openForUser({ userId: normalized, username: name, elo });
        },
        currentUserId: currentUser?.id || null,
        shouldAllowPlayerClick: (id) => !isBotUser(id),
      });
      row.appendChild(table);

      overlayMatchesEl.appendChild(row);
    });
  }

  async function fetchUsernames(ids) {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    const missing = unique.filter((id) => !usernameMap[id]);
    if (missing.length === 0) return;
    await Promise.all(missing.map(async (id) => {
      try {
        const res = await authFetch('/api/v1/users/getDetails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id })
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.username) {
            usernameMap[id] = data.username;
            markBotUser(id, Boolean(data?.isBot));
          }
        }
      } catch (err) {
        console.error('Failed to fetch username for history overlay', err);
      }
    }));
  }

  async function fetchHistory() {
    const userId = getCurrentUserId();
    if (!userId || historyFetching) return;
    ensureOverlay();
    if (!overlayMatchesEl) return;
    historyFetching = true;
    showMessage('Loading match history…');
    try {
      const requestBody = JSON.stringify({ userId, status: 'completed' });
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
        historyGames.forEach((game) => {
          const matchId = normalizeId(game?.match);
          if (!matchId) return;
          if (!historyGamesByMatch.has(matchId)) {
            historyGamesByMatch.set(matchId, []);
          }
          historyGamesByMatch.get(matchId).push(game);
        });
        historyGamesByMatch.forEach((list) => {
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
        historyMatches.forEach((match) => {
          const inlineGames = Array.isArray(match?.games) ? match.games.length : 0;
          if (inlineGames > historyMaxGameCount) {
            historyMaxGameCount = inlineGames;
          }
        });
      }

      historyMaxGameCount = Math.max(1, Math.round(historyMaxGameCount));

      const idsToFetch = [];
      historyMatches.forEach((match) => {
        idsToFetch.push(normalizeId(match?.player1));
        idsToFetch.push(normalizeId(match?.player2));
        idsToFetch.push(normalizeId(match?.winner));
      });
      historyGames.forEach((game) => {
        if (Array.isArray(game?.players)) {
          game.players.forEach((pid) => idsToFetch.push(normalizeId(pid)));
        }
      });
      await fetchUsernames(idsToFetch);

      historyLoaded = true;
      updateSummary();
      renderMatches();
    } catch (err) {
      console.error('Failed to load player history', err);
      historyMatches = [];
      historyGames = [];
      historyMaxGameCount = 1;
      historyGamesByMatch.clear();
      showMessage('Unable to load history right now. Please try again later.');
    } finally {
      historyFetching = false;
    }
  }

  function setFilter(filter) {
    const next = sanitizeFilter(filter);
    if (next === historyFilter) return;
    historyFilter = next;
    updateFilterButtons();
    if (historyLoaded) {
      renderMatches();
    }
  }

  function setCurrentUser(user, { source = 'external', preserveFilter = false } = {}) {
    const normalizedId = normalizeId(user?.userId ?? user?.id);
    const username = typeof user?.username === 'string' ? user.username.trim() : '';
    const elo = isFiniteNumber(user?.elo) ? Math.round(user.elo) : null;
    const previousId = currentUser?.id || null;
    const nextId = normalizedId || null;

    if (!nextId) {
      currentUser = null;
      usernameMap = {};
      resetHistoryState();
      updateFilterButtons();
      updateHeading();
      updateEloDisplay();
      return;
    }

    if (!preserveFilter && previousId && previousId !== nextId) {
      historyFilter = DEFAULT_FILTER;
      updateFilterButtons();
    }

    if (previousId !== nextId) {
      resetHistoryState();
    }

    if (username) {
      usernameMap[nextId] = username;
    }

    if (user && Object.prototype.hasOwnProperty.call(user, 'isBot')) {
      markBotUser(nextId, Boolean(user.isBot));
    }

    currentUser = {
      id: nextId,
      username,
      elo,
      source
    };

    updateHeading();
    updateEloDisplay();
  }

  function openCurrentUser() {
    if (!currentUser?.id) return;
    const instance = ensureOverlay();
    applyOverlayWidth();
    updateFilterButtons();
    updateHeading();
    updateEloDisplay();
    instance.show({ initialFocus: instance.closeButton });
    fetchHistory();
  }

  function openDefaultUser() {
    if (!defaultUser?.id) return;
    setCurrentUser(defaultUser, { source: 'default', preserveFilter: false });
    openCurrentUser();
  }

  function openForUser(user) {
    if (!user) return;
    const normalizedId = normalizeId(user.userId ?? user.id);
    if (!normalizedId) return;
    const username = typeof user.username === 'string' ? user.username.trim() : '';
    const elo = isFiniteNumber(user.elo) ? Math.round(user.elo) : null;
    usernameMap[normalizedId] = username || usernameMap[normalizedId] || normalizedId;
    if (Object.prototype.hasOwnProperty.call(user, 'isBot')) {
      markBotUser(normalizedId, Boolean(user.isBot));
    }
    if (isBotUser(normalizedId)) {
      return;
    }
    setCurrentUser({ id: normalizedId, username, elo, isBot: user.isBot }, { source: 'external', preserveFilter: false });
    openCurrentUser();
  }

  function close() {
    if (!overlay) return;
    overlay.hide();
  }

  function isOpen() {
    return Boolean(overlay && typeof overlay.isOpen === 'function' && overlay.isOpen());
  }

  function setDefaultUser(user) {
    const normalizedId = normalizeId(user?.userId ?? user?.id);
    const username = typeof user?.username === 'string' ? user.username.trim() : '';
    const elo = isFiniteNumber(user?.elo) ? Math.round(user.elo) : null;
    const hasBotFlag = user && Object.prototype.hasOwnProperty.call(user, 'isBot');
    const isBot = hasBotFlag ? Boolean(user.isBot) : false;
    if (!normalizedId) {
      defaultUser = null;
      if (currentUser?.source === 'default') {
        setCurrentUser(null);
      }
      return;
    }

    if (hasBotFlag) {
      markBotUser(normalizedId, isBot);
    }

    defaultUser = { id: normalizedId, username, elo, isBot: hasBotFlag ? isBot : undefined };
    if (!currentUser || currentUser.source === 'default' || currentUser.id === normalizedId) {
      setCurrentUser({ id: normalizedId, username, elo, isBot }, { source: 'default', preserveFilter: false });
    } else if (username) {
      usernameMap[normalizedId] = username;
    }
  }

  function clearDefaultUser() {
    defaultUser = null;
    if (currentUser && currentUser.source === 'default') {
      setCurrentUser(null);
      close();
    }
  }

  function handleUsernameUpdate({ userId, username }) {
    const normalizedId = normalizeId(userId);
    if (!normalizedId || typeof username !== 'string' || !username.trim()) return;
    const trimmed = username.trim();
    usernameMap[normalizedId] = trimmed;
    if (defaultUser && defaultUser.id === normalizedId) {
      defaultUser = { ...defaultUser, username: trimmed };
    }
    if (currentUser && currentUser.id === normalizedId) {
      currentUser = { ...currentUser, username: trimmed };
      updateHeading();
      if (historyLoaded) {
        renderMatches();
      }
    } else if (historyLoaded && isOpen()) {
      renderMatches();
    }
  }

  function registerKnownUsername(id, name) {
    const normalizedId = normalizeId(id);
    if (!normalizedId || typeof name !== 'string') return;
    const trimmed = name.trim();
    if (!trimmed) return;
    usernameMap[normalizedId] = trimmed;
    if (currentUser && currentUser.id === normalizedId) {
      currentUser = { ...currentUser, username: trimmed };
      updateHeading();
    }
    if (defaultUser && defaultUser.id === normalizedId) {
      defaultUser = { ...defaultUser, username: trimmed };
    }
  }

  function registerBotUser(id, isBot = true) {
    markBotUser(id, Boolean(isBot));
  }

  return {
    openDefaultUser,
    openForUser,
    close,
    isOpen,
    setDefaultUser,
    clearDefaultUser,
    handleUsernameUpdate,
    registerKnownUsername,
    registerBotUser,
    getDefaultUserId: () => defaultUser?.id || null,
    getCurrentUserId,
    getCurrentUserSource: () => currentUser?.source || null,
  };
}

