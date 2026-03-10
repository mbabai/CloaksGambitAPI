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

function mapFilterToMatchType(filter) {
  const normalized = sanitizeFilter(filter);
  if (normalized === 'quickplay') return 'QUICKPLAY';
  if (normalized === 'bot') return 'AI';
  if (normalized === 'custom') return 'CUSTOM';
  if (normalized === 'ranked') return 'RANKED';
  return null;
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
  getPreferredWidth,
  getViewerUserId
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
  let historySummaryData = null;
  let historyPagination = { page: 0, totalPages: 0, perPage: 50, totalItems: 0 };
  let historyHasMore = false;
  let historyObserver = null;
  const historyScrollSentinel = document.createElement('div');
  historyScrollSentinel.className = 'history-scroll-sentinel';

  let overlay = null;
  let overlayMatchesEl = null;
  let overlayFilterButtons = [];
  let overlayEloValueEl = null;
  let overlaySummaryEls = null;
  let overlayHeadingEl = null;
  let overlayNameEl = null;
  let overlaySearchInputEl = null;
  let overlaySearchSubmitBtn = null;
  let overlaySearchStatusEl = null;
  let historyRequestToken = 0;
  let searchRequestToken = 0;

  function getCurrentUserId() {
    return currentUser?.id || null;
  }

  function getViewerId() {
    if (typeof getViewerUserId === 'function') {
      try {
        return normalizeId(getViewerUserId());
      } catch (err) {
        console.warn('Failed to resolve history overlay viewer id', err);
      }
    }
    return normalizeId(defaultUser?.id);
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
    historyFetching = false;
    historyGamesByMatch.clear();
    historySummaryData = null;
    historyPagination = { page: 0, totalPages: 0, perPage: 50, totalItems: 0 };
    historyHasMore = false;
    disconnectHistoryObserver();
  }

  function isHistoryRequestCurrent(requestToken, userId = null) {
    if (requestToken !== undefined && requestToken !== null && requestToken !== historyRequestToken) {
      return false;
    }
    const normalizedUserId = normalizeId(userId);
    if (normalizedUserId && normalizedUserId !== getCurrentUserId()) {
      return false;
    }
    return true;
  }

  function setSearchStatus(message = '', tone = 'neutral') {
    if (!overlaySearchStatusEl) return;
    overlaySearchStatusEl.textContent = message || '';
    overlaySearchStatusEl.dataset.state = tone || 'neutral';
  }

  function updateSearchPending(isPending) {
    if (overlaySearchInputEl) {
      overlaySearchInputEl.disabled = Boolean(isPending);
    }
    if (overlaySearchSubmitBtn) {
      overlaySearchSubmitBtn.disabled = Boolean(isPending);
    }
  }

  function syncSearchInput({ preserveQuery = false } = {}) {
    if (!overlaySearchInputEl || preserveQuery) return;
    overlaySearchInputEl.value = currentUser?.username || '';
  }

  function disconnectHistoryObserver() {
    if (historyObserver) {
      historyObserver.disconnect();
      historyObserver = null;
    }
  }

  function ensureHistoryObserver() {
    if (!overlayMatchesEl) return;
    if (!historyScrollSentinel.isConnected) {
      historyScrollSentinel.style.display = historyHasMore ? 'block' : 'none';
      overlayMatchesEl.appendChild(historyScrollSentinel);
    } else {
      historyScrollSentinel.style.display = historyHasMore ? 'block' : 'none';
    }
    if (historyObserver) return;
    historyObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (!historyHasMore || historyFetching) return;
        const nextPage = (historyPagination.page || 0) + 1;
        fetchHistoryPage({
          userId: getCurrentUserId(),
          page: nextPage,
          append: true,
          requestToken: historyRequestToken
        });
      });
    }, { root: overlayMatchesEl, rootMargin: '200px 0px' });
    historyObserver.observe(historyScrollSentinel);
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

    const searchWrap = document.createElement('div');
    searchWrap.className = 'history-overlay-search';

    const searchForm = document.createElement('form');
    searchForm.className = 'history-overlay-search-form';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.className = 'history-overlay-search-input';
    searchInput.placeholder = 'Search username';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.setAttribute('aria-label', 'Search username');
    overlaySearchInputEl = searchInput;

    const searchSubmit = document.createElement('button');
    searchSubmit.type = 'submit';
    searchSubmit.className = 'history-overlay-search-submit';
    searchSubmit.textContent = 'Go';
    overlaySearchSubmitBtn = searchSubmit;

    searchForm.addEventListener('submit', (event) => {
      event.preventDefault();
      searchForUsername(searchInput.value);
    });

    searchForm.appendChild(searchInput);
    searchForm.appendChild(searchSubmit);
    searchWrap.appendChild(searchForm);

    const searchStatus = document.createElement('div');
    searchStatus.className = 'history-overlay-search-status';
    searchStatus.setAttribute('aria-live', 'polite');
    overlaySearchStatusEl = searchStatus;
    searchWrap.appendChild(searchStatus);

    content.appendChild(searchWrap);

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
    syncSearchInput();
    setSearchStatus();

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

  async function searchForUsername(value) {
    ensureOverlay();
    const username = typeof value === 'string' ? value.trim() : '';
    if (!username) {
      setSearchStatus('Enter a username.', 'error');
      if (overlaySearchInputEl) {
        overlaySearchInputEl.focus();
        overlaySearchInputEl.select();
      }
      return false;
    }

    const requestToken = ++searchRequestToken;
    updateSearchPending(true);
    setSearchStatus('Searching...', 'neutral');

    try {
      const res = await authFetch('/api/v1/users/findByUsername', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });

      if (requestToken !== searchRequestToken) {
        return false;
      }

      if (!res || res.status === 404) {
        setSearchStatus('Username not found', 'error');
        return false;
      }

      if (!res.ok) {
        throw new Error(`Username lookup failed (${res.status})`);
      }

      const user = await res.json().catch(() => null);
      const normalizedId = normalizeId(user?.userId ?? user?.id);
      if (!normalizedId || user?.isBot) {
        setSearchStatus('Username not found', 'error');
        return false;
      }

      openForUser(user);
      setSearchStatus();
      return true;
    } catch (err) {
      console.error('Failed to search for player username', err);
      if (requestToken === searchRequestToken) {
        setSearchStatus('Unable to find that username right now.', 'error');
      }
      return false;
    } finally {
      if (requestToken === searchRequestToken) {
        updateSearchPending(false);
      }
    }
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
    const summary = historySummaryData
      || computeHistorySummary(historyMatches, historyGames, { userId: currentUser?.id });
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

    const normalizedCurrentUserId = normalizeId(currentUser?.id);
    const normalizedViewerId = getViewerId();
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
        if (normalizedCurrentUserId && p1Id && p1Id === normalizedCurrentUserId && p2Id) {
          markBotUser(p2Id, true);
        } else if (normalizedCurrentUserId && p2Id && p2Id === normalizedCurrentUserId && p1Id) {
          markBotUser(p1Id, true);
        }
      }
      const table = buildMatchDetailGrid(matchForGrid, {
        usernameLookup: (id) => {
          const normalized = normalizeId(id);
          const base = getDisplayNameForId(id) || getDisplayNameForId(normalized) || normalized || 'Unknown';
          if (normalizedViewerId && normalized && normalized === normalizedViewerId) {
            return `${base} (You)`;
          }
          return base;
        },
        maxGameCount,
        onPlayerClick: (info) => {
          if (!info || !info.id) return;
          const normalized = normalizeId(info.id);
          if (normalizedViewerId && normalized && normalized === normalizedViewerId) return;
          if (isBotUser(normalized)) return;
          const name = info.name || getDisplayNameForId(normalized);
          const elo = isFiniteNumber(info.elo) ? info.elo : null;
          openForUser({ userId: normalized, username: name, elo });
        },
        currentUserId: normalizedViewerId,
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

  async function fetchHistorySummaryForUser(userId, { requestToken } = {}) {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId) {
      historySummaryData = null;
      return;
    }
    try {
      const res = await authFetch('/api/v1/history/getSummary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'completed', userId: normalizedUserId })
      });

      if (!res || !res.ok) {
        if (isHistoryRequestCurrent(requestToken, normalizedUserId)) {
          historySummaryData = null;
        }
        return;
      }

      const data = await res.json().catch(() => null);
      if (!isHistoryRequestCurrent(requestToken, normalizedUserId)) {
        return;
      }
      historySummaryData = data && typeof data === 'object' ? data.summary || null : null;
    } catch (err) {
      console.error('Failed to fetch player history summary', err);
      if (isHistoryRequestCurrent(requestToken, normalizedUserId)) {
        historySummaryData = null;
      }
    }
  }

  async function fetchHistoryPage({ userId, page = 1, append = false, forceReset = false, requestToken } = {}) {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId || historyFetching || !isHistoryRequestCurrent(requestToken, normalizedUserId)) return;
    ensureOverlay();
    if (!overlayMatchesEl) return;

    const numericPage = Number(page);
    const safePage = Number.isFinite(numericPage) && numericPage > 0 ? Math.floor(numericPage) : 1;
    const shouldAppend = append && safePage > 1;
    const shouldReset = forceReset || !shouldAppend;

    historyFetching = true;
    if (shouldReset) {
      historyMatches = [];
      historyGames = [];
      historyMaxGameCount = 1;
      historyGamesByMatch.clear();
      historyPagination = { page: 0, totalPages: 0, perPage: 50, totalItems: 0 };
      historyHasMore = false;
      disconnectHistoryObserver();
      showMessage('Loading match history...');
    }

    try {
      const requestPayload = {
        userId: normalizedUserId,
        status: 'completed',
        page: safePage,
        limit: 50,
      };
      const typeFilter = mapFilterToMatchType(historyFilter);
      if (typeFilter) {
        requestPayload.type = typeFilter;
      }

      const matchesRes = await authFetch('/api/v1/matches/getList', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestPayload)
      });

      let matchesPayload = null;
      if (matchesRes && matchesRes.ok) {
        matchesPayload = await matchesRes.json().catch(() => null);
      }
      if (!isHistoryRequestCurrent(requestToken, normalizedUserId)) {
        return;
      }

      const matchItems = Array.isArray(matchesPayload)
        ? matchesPayload
        : (Array.isArray(matchesPayload?.items) ? matchesPayload.items : []);

      const pagination = matchesPayload && typeof matchesPayload === 'object' ? matchesPayload.pagination : null;
      if (pagination && typeof pagination === 'object') {
        const perPage = Number(pagination.perPage) || 50;
        const totalItems = Number(pagination.totalItems) || matchItems.length;
        const totalPages = Number(pagination.totalPages) || (perPage > 0 ? Math.ceil(totalItems / perPage) : 0);
        const currentPage = Number(pagination.page) || safePage;
        historyPagination = {
          page: currentPage,
          perPage,
          totalItems,
          totalPages,
        };
        historyHasMore = currentPage < totalPages;
      } else {
        const perPage = 50;
        const totalItems = shouldAppend ? historyMatches.length + matchItems.length : matchItems.length;
        const totalPages = perPage > 0 ? Math.ceil(totalItems / perPage) : 0;
        historyPagination = {
          page: safePage,
          perPage,
          totalItems,
          totalPages,
        };
        historyHasMore = safePage < totalPages;
      }

      const matchIdSet = new Set();
      matchItems.forEach((match) => {
        const id = normalizeId(match?._id || match?.id);
        if (id) matchIdSet.add(id);
      });

      let gameItems = [];
      if (matchIdSet.size > 0) {
        try {
          const gamesRes = await authFetch('/api/v1/games/getList', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'completed', matchIds: Array.from(matchIdSet) })
          });
          if (gamesRes && gamesRes.ok) {
            const gamesPayload = await gamesRes.json().catch(() => null);
            if (Array.isArray(gamesPayload)) {
              gameItems = gamesPayload;
            } else if (gamesPayload && typeof gamesPayload === 'object' && Array.isArray(gamesPayload.items)) {
              gameItems = gamesPayload.items;
            }
          }
        } catch (err) {
          console.error('Failed to fetch games for player history', err);
        }
      }
      if (!isHistoryRequestCurrent(requestToken, normalizedUserId)) {
        return;
      }

      if (!shouldAppend) {
        historyMatches = matchItems.slice();
      } else if (matchItems.length > 0) {
        const existingIndex = new Map(historyMatches.map((match, idx) => [normalizeId(match?._id || match?.id), idx]));
        matchItems.forEach((match) => {
          const id = normalizeId(match?._id || match?.id);
          if (!id) return;
          if (existingIndex.has(id)) {
            historyMatches[existingIndex.get(id)] = match;
          } else {
            existingIndex.set(id, historyMatches.length);
            historyMatches.push(match);
          }
        });
      }

      if (!shouldAppend) {
        historyGamesByMatch.clear();
      }

      gameItems.forEach((game) => {
        const matchId = normalizeId(game?.match);
        if (!matchId) return;
        if (!historyGamesByMatch.has(matchId)) {
          historyGamesByMatch.set(matchId, []);
        }
        const gamesForMatch = historyGamesByMatch.get(matchId);
        const gameId = normalizeId(game?._id || game?.id);
        const existingIdx = gamesForMatch.findIndex((item) => normalizeId(item?._id || item?.id) === gameId);
        if (existingIdx >= 0) {
          gamesForMatch[existingIdx] = game;
        } else {
          gamesForMatch.push(game);
        }
        gamesForMatch.sort((a, b) => {
          const aTime = new Date(a?.endTime || a?.startTime || a?.createdAt || 0).getTime();
          const bTime = new Date(b?.endTime || b?.startTime || b?.createdAt || 0).getTime();
          return aTime - bTime;
        });
      });

      historyGames = Array.from(historyGamesByMatch.values()).flat();
      historyMaxGameCount = 1;
      historyGamesByMatch.forEach((list) => {
        const count = Array.isArray(list) ? list.length : 0;
        if (count > historyMaxGameCount) {
          historyMaxGameCount = count;
        }
      });
      historyMatches.forEach((match) => {
        const inlineGames = Array.isArray(match?.games) ? match.games.length : 0;
        if (inlineGames > historyMaxGameCount) {
          historyMaxGameCount = inlineGames;
        }
      });
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
      if (!isHistoryRequestCurrent(requestToken, normalizedUserId)) {
        return;
      }

      historyLoaded = true;
      updateSummary();
      renderMatches();
      ensureHistoryObserver();
    } catch (err) {
      console.error('Failed to load player history', err);
      if (shouldReset && isHistoryRequestCurrent(requestToken, normalizedUserId)) {
        historyMatches = [];
        historyGames = [];
        historyMaxGameCount = 1;
        historyGamesByMatch.clear();
        showMessage('Unable to load history right now. Please try again later.');
      }
    } finally {
      if (isHistoryRequestCurrent(requestToken, normalizedUserId)) {
        historyFetching = false;
      }
    }
  }

  async function fetchHistory({ userId = getCurrentUserId(), requestToken = historyRequestToken } = {}) {
    const normalizedUserId = normalizeId(userId);
    if (!normalizedUserId || !isHistoryRequestCurrent(requestToken, normalizedUserId)) return;
    await fetchHistorySummaryForUser(normalizedUserId, { requestToken });
    if (!isHistoryRequestCurrent(requestToken, normalizedUserId)) return;
    updateSummary();
    await fetchHistoryPage({ userId: normalizedUserId, page: 1, forceReset: true, requestToken });
  }

  async function setFilter(filter) {
    const next = sanitizeFilter(filter);
    if (next === historyFilter) return;
    historyFilter = next;
    updateFilterButtons();
    if (historyLoaded) {
      const userId = getCurrentUserId();
      const requestToken = historyRequestToken;
      if (userId) {
        await fetchHistorySummaryForUser(userId, { requestToken });
        if (!isHistoryRequestCurrent(requestToken, userId)) return;
        updateSummary();
      }
      await fetchHistoryPage({ userId, page: 1, forceReset: true, requestToken });
    } else {
      renderMatches();
    }
  }

  function setCurrentUser(user, { source = 'external', preserveFilter = false, preserveSearchQuery = false } = {}) {
    const normalizedId = normalizeId(user?.userId ?? user?.id);
    const username = typeof user?.username === 'string' ? user.username.trim() : '';
    const elo = isFiniteNumber(user?.elo) ? Math.round(user.elo) : null;
    const previousId = currentUser?.id || null;
    const nextId = normalizedId || null;
    const userChanged = previousId !== nextId;

    if (!nextId) {
      historyRequestToken += 1;
      currentUser = null;
      usernameMap = {};
      resetHistoryState();
      updateFilterButtons();
      updateHeading();
      updateEloDisplay();
      syncSearchInput({ preserveQuery: preserveSearchQuery });
      if (!preserveSearchQuery) {
        setSearchStatus();
      }
      return;
    }

    if (!preserveFilter && previousId && previousId !== nextId) {
      historyFilter = DEFAULT_FILTER;
      updateFilterButtons();
    }

    if (userChanged) {
      historyRequestToken += 1;
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
    syncSearchInput({ preserveQuery: preserveSearchQuery });
    if (!preserveSearchQuery) {
      setSearchStatus();
    }
  }

  function openCurrentUser() {
    if (!currentUser?.id) return;
    const instance = ensureOverlay();
    const requestToken = historyRequestToken;
    applyOverlayWidth();
    updateFilterButtons();
    updateHeading();
    updateEloDisplay();
    syncSearchInput();
    instance.show({ initialFocus: overlaySearchInputEl || instance.closeButton });
    fetchHistory({ userId: currentUser.id, requestToken });
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
    setCurrentUser(
      { id: normalizedId, username, elo, isBot: user.isBot },
      { source: 'external', preserveFilter: false }
    );
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
      syncSearchInput();
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
      syncSearchInput();
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

