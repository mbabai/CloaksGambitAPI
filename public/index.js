import { pieceGlyph as modulePieceGlyph } from '/js/modules/render/pieceGlyph.js';
import { renderBoard } from '/js/modules/render/board.js';
import { renderStash as renderStashModule } from '/js/modules/render/stash.js';
import { renderBars as renderBarsModule } from '/js/modules/render/bars.js';
import { createEloBadge } from '/js/modules/render/eloBadge.js';
import { dimOriginEl, restoreOriginEl } from '/js/modules/dragOpacity.js';
import { PIECE_IMAGES, KING_ID, MOVE_STATES, WIN_REASONS } from '/js/modules/constants.js';
import { getCookie, setCookie } from '/js/modules/utils/cookies.js';
import { apiReady, apiNext, apiSetup, apiGetDetails, apiEnterQueue, apiExitQueue, apiEnterRankedQueue, apiExitRankedQueue, apiMove, apiChallenge, apiBomb, apiOnDeck, apiPass, apiResign, apiDraw, apiCheckTimeControl, apiGetMatchDetails, apiGetTimeSettings } from '/js/modules/api/game.js';
import { computePlayAreaBounds, computeBoardMetrics } from '/js/modules/layout.js';
import { renderReadyButton } from '/js/modules/render/readyButton.js';
import { renderGameButton } from '/js/modules/render/gameButton.js';
import { randomizeSetup } from '/js/modules/setup/randomize.js';
import { DRAG_PX_THRESHOLD as DRAG_PX_THRESHOLD_CFG, DRAG_PX_THRESHOLD_TOUCH as DRAG_PX_THRESHOLD_TOUCH_CFG, CLICK_TIME_MAX_MS as CLICK_TIME_MAX_MS_CFG } from '/js/modules/interactions/config.js';
import { getPieceAt as getPieceAtM, setPieceAt as setPieceAtM, performMove as performMoveM } from '/js/modules/state/moves.js';
import { Declaration, uiToServerCoords, isWithinPieceRange, isPathClear } from '/js/modules/interactions/moveRules.js';
import { wireSocket as bindSocket } from '/js/modules/socket.js';
import { computeHistorySummary, describeMatch, buildMatchDetailGrid, normalizeId } from '/js/modules/history/dashboard.js';
import {
  ASSET_MANIFEST,
  getIconAsset,
  getAvatarAsset,
  getBubbleAsset,
  createThroneIcon
} from '/js/modules/ui/icons.js';
import { createDaggerCounter } from '/js/modules/ui/banners.js';
import { createOverlay } from '/js/modules/ui/overlays.js';

(function() {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const queueBtn = document.getElementById('queueBtn');
  const modeSelect = document.getElementById('modeSelect');
  const selectWrap = document.getElementById('selectWrap');

  const menuToggle = document.getElementById('menuToggle');
  const menuContainer = document.getElementById('menuContainer');
  const menuMain = document.getElementById('menuMain');
  const accountBtn = document.getElementById('accountBtn');
  const accountPanel = document.getElementById('menuAccountPanel');
  const usernameDisplay = document.getElementById('usernameDisplay');
  const accountPanelContent = document.getElementById('accountPanelContent');
  const accountBtnImg = accountBtn.querySelector('img');

  const ACCOUNT_ICON_SRC = getAvatarAsset('account') || '/assets/images/account.png';
  const LOGGED_IN_AVATAR_SRC = getAvatarAsset('loggedInDefault') || '/assets/images/cloakHood.jpg';
  const GOOGLE_ICON_SRC = getIconAsset('google') || '/assets/images/google-icon.png';

  let menuOpen = false;
  const PANEL_WIDTH = 180;
  const PANEL_MARGIN = 16; // keep gap from Find Game button

  const QUEUE_START_TIME_KEY = 'cg_queueStartTime';
  const QUEUE_START_MODE_KEY = 'cg_queueStartMode';
  let queueStartTime = Number(localStorage.getItem(QUEUE_START_TIME_KEY)) || null;
  let queueStartMode = localStorage.getItem(QUEUE_START_MODE_KEY);
  if (queueStartMode !== 'quickplay' && queueStartMode !== 'ranked') {
    queueStartMode = null;
    localStorage.removeItem(QUEUE_START_MODE_KEY);
  }
  let queueTimerInterval = null;
  let queueTimerEl = null;
  let queueStatusKnown = false;

  let statsUserId = null;
  let statsUserElo = null;
  let statsHistoryMatches = [];
  let statsHistoryGames = [];
  let statsHistoryFilter = 'all';
  let statsHistoryLoaded = false;
  let statsOverlayFetching = false;
  const statsHistoryGamesByMatch = new Map();
  let statsUsernameMap = {};
  let statsOverlay = null;
  let statsOverlayMatchesEl = null;
  let statsOverlaySummaryEls = null;
  let statsOverlayFilterButtons = [];
  let statsOverlayEloValueEl = null;

  function persistQueueMode(mode) {
    if (mode === 'quickplay' || mode === 'ranked') {
      queueStartMode = mode;
      localStorage.setItem(QUEUE_START_MODE_KEY, queueStartMode);
    } else {
      queueStartMode = null;
      localStorage.removeItem(QUEUE_START_MODE_KEY);
    }
  }

  function updateQueueTimer() {
    if (!queueStartTime || !queueTimerEl) return;
    const elapsed = Date.now() - queueStartTime;
    const totalSeconds = Math.floor(elapsed / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    queueTimerEl.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function startQueueTimer(startTime = Date.now(), mode = queueStartMode || modeSelect.value) {
    queueStartTime = startTime;
    localStorage.setItem(QUEUE_START_TIME_KEY, String(queueStartTime));
    persistQueueMode(mode);
    updateQueueTimer();
    queueTimerInterval = setInterval(updateQueueTimer, 1000);
  }

  function stopQueueTimer() {
    if (queueTimerInterval) {
      clearInterval(queueTimerInterval);
      queueTimerInterval = null;
    }
    queueStartTime = null;
    localStorage.removeItem(QUEUE_START_TIME_KEY);
    persistQueueMode(null);
  }

  function adjustMenuBounds() {
    // Default panel width if queue button isn't visible (e.g., during a game)
    let mainWidth = PANEL_WIDTH;

    if (queueBtn && queueBtn.offsetParent !== null) {
      const queueRect = queueBtn.getBoundingClientRect();
      const availableWidth = Math.max(queueRect.left - PANEL_MARGIN, 0);
      mainWidth = Math.min(PANEL_WIDTH, availableWidth);
    }

    menuMain.style.width = mainWidth + 'px';

    let totalWidth = mainWidth;

    if (accountPanel.style.display === 'block') {
      accountPanel.style.left = mainWidth + 'px';
      accountPanel.style.width = PANEL_WIDTH + 'px';

      let maxHeight;
      if (selectWrap && selectWrap.offsetParent !== null) {
        const selectRect = selectWrap.getBoundingClientRect();
        maxHeight = Math.max(window.innerHeight - selectRect.bottom - PANEL_MARGIN, 0);
      } else {
        maxHeight = Math.max(window.innerHeight - PANEL_MARGIN * 2, 0);
      }

      const desiredHeight = Math.min(window.innerHeight * 0.75, maxHeight);
      accountPanel.style.height = desiredHeight + 'px';
      totalWidth += PANEL_WIDTH;
    }

    menuContainer.style.width = totalWidth + 'px';
  }

  function closeAccountPanel() {
    accountPanel.style.display = 'none';
    accountBtn.classList.remove('active');
    adjustMenuBounds();
  }

  function openAccountPanel() {
    accountPanel.style.display = 'block';
    accountBtn.classList.add('active');
    adjustMenuBounds();
  }

  function openMenu() {
    menuContainer.classList.add('open');
    menuOpen = true;
    adjustMenuBounds();
  }

  function closeMenu() {
    menuOpen = false;
    menuContainer.classList.remove('open');
    closeAccountPanel();
  }

  function ensureStatsOverlay() {
    if (statsOverlay) return statsOverlay;

    statsOverlay = createOverlay({
      baseClass: 'cg-overlay history-overlay',
      dialogClass: 'history-modal',
      contentClass: 'history-modal-content',
      backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
      closeButtonClass: 'history-close-btn',
      closeLabel: 'Close history',
      closeText: '✕',
      openClass: 'open cg-overlay--open',
      bodyOpenClass: 'history-overlay-open cg-overlay-open'
    });

    const { content, closeButton } = statsOverlay;
    if (closeButton) {
      closeButton.setAttribute('aria-label', 'Close history');
    }

    const heading = document.createElement('h2');
    heading.textContent = 'Match History';
    heading.id = 'historyOverlayTitle';
    statsOverlay.setLabelledBy(heading.id);
    content.appendChild(heading);

    const eloRow = document.createElement('div');
    eloRow.className = 'history-current-elo';
    eloRow.innerHTML = 'Current ELO: <span id="historyCurrentEloValue">—</span>';
    content.appendChild(eloRow);

    const summary = document.createElement('div');
    summary.className = 'history-summary';
    summary.innerHTML = `
      <div class="history-card">
        <div class="history-card-label">Total Games Played</div>
        <div id="playerHistoryTotalGames" class="history-card-value">0</div>
        <div id="playerHistoryTotalGamesBreakdown" class="history-card-sub">Wins 0 • Draws 0 • Losses 0</div>
      </div>
      <div class="history-card">
        <div class="history-card-label">Total Matches Played</div>
        <div id="playerHistoryTotalMatches" class="history-card-value">0</div>
        <div id="playerHistoryTotalMatchesBreakdown" class="history-card-sub">Wins 0 • Draws 0 • Losses 0 (0% win)</div>
      </div>
      <div class="history-card">
        <div class="history-card-label">Quickplay Games</div>
        <div id="playerHistoryQuickplayGames" class="history-card-value">0</div>
        <div id="playerHistoryQuickplayGamesBreakdown" class="history-card-sub">Wins 0 • Draws 0 • Losses 0</div>
      </div>
      <div class="history-card">
        <div class="history-card-label">Ranked Matches</div>
        <div id="playerHistoryRankedMatches" class="history-card-value">0</div>
        <div id="playerHistoryRankedMatchesBreakdown" class="history-card-sub">Wins 0 • Draws 0 • Losses 0 (0% win)</div>
      </div>`;
    content.appendChild(summary);

    const filters = document.createElement('div');
    filters.className = 'history-filters';
    filters.innerHTML = `
      <button class="history-filter-btn active" data-history-filter="all">All</button>
      <button class="history-filter-btn" data-history-filter="quickplay">Quickplay</button>
      <button class="history-filter-btn" data-history-filter="ranked">Ranked</button>`;
    content.appendChild(filters);

    const contentScroll = document.createElement('div');
    contentScroll.className = 'history-overlay-content';
    contentScroll.id = 'historyOverlayContent';
    const matches = document.createElement('div');
    matches.className = 'history-matches';
    matches.id = 'playerHistoryMatches';
    contentScroll.appendChild(matches);
    content.appendChild(contentScroll);

    statsOverlayMatchesEl = matches;
    statsOverlayFilterButtons = Array.from(filters.querySelectorAll('[data-history-filter]'));
    statsOverlayEloValueEl = eloRow.querySelector('#historyCurrentEloValue');
    statsOverlaySummaryEls = {
      totalGames: summary.querySelector('#playerHistoryTotalGames'),
      totalGamesBreakdown: summary.querySelector('#playerHistoryTotalGamesBreakdown'),
      totalMatches: summary.querySelector('#playerHistoryTotalMatches'),
      totalMatchesBreakdown: summary.querySelector('#playerHistoryTotalMatchesBreakdown'),
      quickplayGames: summary.querySelector('#playerHistoryQuickplayGames'),
      quickplayGamesBreakdown: summary.querySelector('#playerHistoryQuickplayGamesBreakdown'),
      rankedMatches: summary.querySelector('#playerHistoryRankedMatches'),
      rankedMatchesBreakdown: summary.querySelector('#playerHistoryRankedMatchesBreakdown')
    };

    statsOverlayFilterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.historyFilter || 'all';
        if (filter === statsHistoryFilter) return;
        statsHistoryFilter = filter;
        statsOverlayFilterButtons.forEach(b => b.classList.toggle('active', b === btn));
        renderStatsHistoryMatches();
      });
    });

    return statsOverlay;
  }

  function isStatsOverlayOpen() {
    return Boolean(statsOverlay && statsOverlay.isOpen());
  }

  function openStatsOverlay() {
    if (!statsUserId) return;
    const overlay = ensureStatsOverlay();
    if (!overlay) return;
    if (statsOverlayEloValueEl) {
      statsOverlayEloValueEl.textContent = Number.isFinite(statsUserElo) ? String(statsUserElo) : '—';
    }
    statsOverlayFilterButtons.forEach(btn => {
      btn.classList.toggle('active', (btn.dataset.historyFilter || 'all') === statsHistoryFilter);
    });
    overlay.show({ initialFocus: overlay.closeButton });
    fetchStatsHistory();
  }

  function closeStatsOverlay() {
    if (!statsOverlay) return;
    statsOverlay.hide();
  }

  function showStatsOverlayMessage(message) {
    if (!statsOverlayMatchesEl) return;
    statsOverlayMatchesEl.innerHTML = '';
    const msg = document.createElement('div');
    msg.textContent = message;
    msg.style.padding = '12px 0';
    msg.style.opacity = '0.85';
    statsOverlayMatchesEl.appendChild(msg);
  }

  function updateStatsOverlaySummary() {
    if (!statsOverlaySummaryEls) return;
    const summary = computeHistorySummary(statsHistoryMatches, statsHistoryGames, { userId: statsUserId });
    const games = summary.games;
    const matches = summary.matches;
    const quickplay = summary.quickplayGames;
    const ranked = summary.rankedMatches;

    statsOverlaySummaryEls.totalGames.textContent = games.total;
    statsOverlaySummaryEls.totalGamesBreakdown.textContent = `Wins ${games.wins} • Draws ${games.draws} • Losses ${games.losses}`;
    statsOverlaySummaryEls.totalMatches.textContent = matches.total;
    statsOverlaySummaryEls.totalMatchesBreakdown.textContent = `Wins ${matches.wins} • Draws ${matches.draws} • Losses ${matches.losses} (${matches.winPct}% win)`;
    statsOverlaySummaryEls.quickplayGames.textContent = quickplay.total;
    statsOverlaySummaryEls.quickplayGamesBreakdown.textContent = `Wins ${quickplay.wins} • Draws ${quickplay.draws} • Losses ${quickplay.losses}`;
    statsOverlaySummaryEls.rankedMatches.textContent = ranked.total;
    statsOverlaySummaryEls.rankedMatchesBreakdown.textContent = `Wins ${ranked.wins} • Draws ${ranked.draws} • Losses ${ranked.losses} (${ranked.winPct}% win)`;
  }

  function formatMatchTypeLabel(type) {
    if (!type) return 'Match';
    const upper = type.toUpperCase();
    if (upper === 'RANKED') return 'Ranked Match';
    if (upper === 'QUICKPLAY') return 'Quickplay Match';
    return `${type.charAt(0).toUpperCase()}${type.slice(1).toLowerCase()} Match`;
  }

  function formatMatchDateLabel(match) {
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

  function renderStatsHistoryMatches() {
    if (!statsOverlayMatchesEl) return;
    statsOverlayMatchesEl.innerHTML = '';
    const matches = Array.isArray(statsHistoryMatches) ? statsHistoryMatches.slice() : [];
    matches.sort((a, b) => {
      const aTime = new Date(a?.endTime || a?.startTime || 0).getTime();
      const bTime = new Date(b?.endTime || b?.startTime || 0).getTime();
      return bTime - aTime;
    });
    const filtered = matches.filter(match => {
      if (!match || match.isActive) return false;
      const type = typeof match?.type === 'string' ? match.type.toUpperCase() : '';
      if (statsHistoryFilter === 'quickplay') return type === 'QUICKPLAY';
      if (statsHistoryFilter === 'ranked') return type === 'RANKED';
      return true;
    });

    if (filtered.length === 0) {
      showStatsOverlayMessage('No matches recorded yet. Play some games to see your history.');
      return;
    }

    const normalizedUserId = normalizeId(statsUserId);

    filtered.forEach(match => {
      const descriptor = describeMatch(match, {
        usernameLookup: id => statsUsernameMap[id] || id,
        userId: statsUserId
      });

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

      const matchId = normalizeId(match?._id || match?.id || descriptor.id);
      const games = matchId ? (statsHistoryGamesByMatch.get(matchId) || []) : [];
      const matchForGrid = Object.assign({}, match, { games });
      const table = buildMatchDetailGrid(matchForGrid, {
        usernameLookup: id => {
          const normalized = normalizeId(id);
          const base = statsUsernameMap[id] || statsUsernameMap[normalized] || normalized || 'Unknown';
          if (normalizedUserId && normalized && normalized === normalizedUserId) {
            return `${base} (You)`;
          }
          return base;
        }
      });
      row.appendChild(table);

      statsOverlayMatchesEl.appendChild(row);
    });
  }

  async function fetchStatsUsernames(ids) {
    const unique = Array.from(new Set((ids || []).filter(Boolean)));
    const missing = unique.filter(id => !statsUsernameMap[id]);
    if (missing.length === 0) return;
    await Promise.all(missing.map(async id => {
      try {
        const res = await fetch('/api/v1/users/getDetails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id })
        });
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (data && data.username) {
            statsUsernameMap[id] = data.username;
          }
        }
      } catch (err) {
        console.error('Failed to fetch username for history overlay', err);
      }
    }));
  }

  async function fetchStatsHistory() {
    if (!statsUserId) return;
    ensureStatsOverlay();
    if (!statsOverlayMatchesEl) return;
    if (statsOverlayFetching) return;
    statsOverlayFetching = true;
    showStatsOverlayMessage('Loading match history…');
    try {
      const [matchesRes, gamesRes] = await Promise.all([
        fetch('/api/v1/matches/getList', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: statsUserId })
        }),
        fetch('/api/v1/games/getList', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: statsUserId })
        })
      ]);

      statsHistoryMatches = matchesRes && matchesRes.ok ? await matchesRes.json().catch(() => []) : [];
      statsHistoryGames = gamesRes && gamesRes.ok ? await gamesRes.json().catch(() => []) : [];

      statsHistoryGamesByMatch.clear();
      if (Array.isArray(statsHistoryGames)) {
        statsHistoryGames.forEach(game => {
          const matchId = normalizeId(game?.match);
          if (!matchId) return;
          if (!statsHistoryGamesByMatch.has(matchId)) {
            statsHistoryGamesByMatch.set(matchId, []);
          }
          statsHistoryGamesByMatch.get(matchId).push(game);
        });
        statsHistoryGamesByMatch.forEach(list => {
          list.sort((a, b) => {
            const aTime = new Date(a?.endTime || a?.startTime || a?.createdAt || 0).getTime();
            const bTime = new Date(b?.endTime || b?.startTime || b?.createdAt || 0).getTime();
            return aTime - bTime;
          });
        });
      }

      const idsToFetch = [];
      statsHistoryMatches.forEach(match => {
        idsToFetch.push(normalizeId(match?.player1));
        idsToFetch.push(normalizeId(match?.player2));
        idsToFetch.push(normalizeId(match?.winner));
      });
      statsHistoryGames.forEach(game => {
        if (Array.isArray(game?.players)) {
          game.players.forEach(pid => idsToFetch.push(normalizeId(pid)));
        }
      });
      await fetchStatsUsernames(idsToFetch);

      statsHistoryLoaded = true;
      updateStatsOverlaySummary();
      renderStatsHistoryMatches();
    } catch (err) {
      console.error('Failed to load player history', err);
      statsHistoryMatches = [];
      statsHistoryGames = [];
      statsHistoryGamesByMatch.clear();
      showStatsOverlayMessage('Unable to load history right now. Please try again later.');
    } finally {
      statsOverlayFetching = false;
    }
  }

  menuToggle.addEventListener('click', ev => {
    ev.stopPropagation();
    if (menuOpen) closeMenu(); else openMenu();
  });

  accountBtn.addEventListener('click', ev => {
    ev.stopPropagation();
    if (accountPanel.style.display === 'block') {
      closeAccountPanel();
    } else {
      openAccountPanel();
    }
  });

  document.addEventListener('click', ev => {
    if (!menuOpen) return;
    const target = ev.target;
    if (!menuContainer.contains(target) && target !== menuToggle) {
      closeMenu();
    } else if (
      accountPanel.style.display === 'block' &&
      !accountPanel.contains(target) &&
      target !== accountBtn
    ) {
      closeAccountPanel();
    }
  });

  window.addEventListener('resize', () => {
    if (menuOpen) adjustMenuBounds();
  });

  document.addEventListener('keydown', handleGlobalKeyDown);

  function handleGlobalKeyDown(ev) {
    if (isStatsOverlayOpen()) {
      return;
    }

    if (typeof bannerKeyListener === 'function') {
      const handled = bannerKeyListener(ev);
      if (handled === true) return;
      if (isBannerVisible()) return;
    } else if (isBannerVisible()) {
      return;
    }

    if (ev.defaultPrevented) return;
    if (ev.repeat) return;

    const activeEl = document.activeElement;
    if (shouldIgnoreShortcutTarget(ev.target) || shouldIgnoreShortcutTarget(activeEl)) return;

    const key = ev.key;
    if (!key) return;

    if (key === 'c' || key === 'C') {
      if (clickButtonIfVisible('challengeBtn')) {
        ev.preventDefault();
      }
    } else if (key === 'b' || key === 'B') {
      if (clickButtonIfVisible('bombBtn')) {
        ev.preventDefault();
      }
    } else if (key === 'v' || key === 'V') {
      if (clickButtonIfVisible('passBtn')) {
        ev.preventDefault();
      }
    } else if (key === 'f' || key === 'F') {
      if (clickButtonIfVisible('queueBtn')) {
        ev.preventDefault();
      }
    }
  }

  function isBannerVisible() {
    return Boolean(bannerOverlay && bannerOverlay.isOpen());
  }

  function shouldIgnoreShortcutTarget(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    if (tag === 'textarea' || tag === 'select') return true;
    if (tag === 'input') {
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (!type || type === 'text' || type === 'search' || type === 'email' || type === 'password' || type === 'number') {
        return true;
      }
    }
    return false;
  }

  function clickButtonIfVisible(id) {
    const btn = document.getElementById(id);
    if (!btn) return false;
    if (btn.disabled) return false;
    const style = window.getComputedStyle(btn);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    btn.click();
    return true;
  }

  function setUsernameDisplay() {
    const name = getCookie('username') || localStorage.getItem('cg_username');
    if (usernameDisplay) {
      usernameDisplay.textContent = name || '';
    }
  }

  async function updateAccountPanel() {
    const name = getCookie('username');
    if (name) {
      const userIdCookie = getCookie('userId');
      let userDetails = null;
      if (userIdCookie) {
        try {
          const res = await fetch('/api/v1/users/getDetails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: userIdCookie })
          });
          if (res.ok) {
            userDetails = await res.json().catch(() => null);
          }
        } catch (err) {
          console.error('Failed to fetch user details', err);
        }
      }

      const displayName = userDetails?.username || name;
      const eloValue = Number.isFinite(userDetails?.elo) ? userDetails.elo : null;

      statsUserId = userIdCookie || null;
      statsUserElo = eloValue;
      statsUsernameMap = {};
      if (statsUserId) {
        statsUsernameMap[statsUserId] = displayName;
      }
      statsHistoryMatches = [];
      statsHistoryGames = [];
      statsHistoryFilter = 'all';
      statsHistoryLoaded = false;
      statsHistoryGamesByMatch.clear();
      ensureStatsOverlay();
      if (statsOverlayFilterButtons.length) {
        statsOverlayFilterButtons.forEach(btn => {
          btn.classList.toggle('active', (btn.dataset.historyFilter || 'all') === statsHistoryFilter);
        });
      }
      if (statsOverlayEloValueEl) {
        statsOverlayEloValueEl.textContent = Number.isFinite(statsUserElo) ? String(statsUserElo) : '—';
      }

      accountPanelContent.innerHTML = '';
      accountPanelContent.style.alignItems = 'stretch';
      accountPanelContent.style.gap = '6px';

      const usernameRow = document.createElement('div');
      usernameRow.className = 'menu-button';
      usernameRow.style.display = 'flex';
      usernameRow.style.alignItems = 'center';
      usernameRow.style.justifyContent = 'flex-start';
      usernameRow.style.gap = '8px';
      usernameRow.style.padding = '8px 4px 8px 16px';
      usernameRow.style.boxSizing = 'border-box';
      usernameRow.style.width = '100%';
      usernameRow.style.cursor = 'default';

      const usernameSpan = document.createElement('span');
      usernameSpan.id = 'accountUsername';
      usernameSpan.textContent = displayName;
      usernameSpan.title = displayName;
      usernameSpan.style.flex = '1 1 auto';
      usernameSpan.style.minWidth = '0';
      usernameSpan.style.textAlign = 'left';
      usernameSpan.style.fontWeight = '600';
      usernameSpan.style.fontSize = '20px';
      usernameSpan.style.whiteSpace = 'nowrap';
      usernameSpan.style.overflow = 'hidden';
      usernameSpan.style.textOverflow = 'ellipsis';
      const editBtn = document.createElement('button');
      editBtn.id = 'editUsername';
      editBtn.type = 'button';
      editBtn.setAttribute('aria-label', 'Edit username');
      editBtn.setAttribute('title', 'Edit username');
      editBtn.innerHTML = `
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          width="18"
          height="18"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="m16.862 4.487 1.651-1.652a1.875 1.875 0 0 1 2.652 2.652l-1.652 1.651m-2.651-2.651 2.651 2.651m-2.651-2.651-8.955 8.955a1.5 1.5 0 0 0-.383.65l-.547 2.188 2.188-.547a1.5 1.5 0 0 0 .65-.383l8.955-8.955m-2.651-2.651 2.651 2.651"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      `.trim();
      editBtn.style.background = 'none';
      editBtn.style.border = 'none';
      editBtn.style.color = 'var(--CG-white)';
      editBtn.style.cursor = 'pointer';
      editBtn.style.padding = '2px';
      editBtn.style.marginLeft = 'auto';
      editBtn.style.marginRight = '0';
      editBtn.style.borderRadius = '4px';
      editBtn.style.transition = 'background-color 120ms ease-in-out';
      editBtn.style.display = 'inline-flex';
      editBtn.style.alignItems = 'center';
      editBtn.style.justifyContent = 'center';
      editBtn.style.flexShrink = '0';
      editBtn.style.flexGrow = '0';
      editBtn.style.flexBasis = 'auto';
      editBtn.addEventListener('focusin', () => {
        editBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
      });
      editBtn.addEventListener('focusout', () => {
        editBtn.style.backgroundColor = 'transparent';
      });
      editBtn.addEventListener('mouseenter', () => {
        editBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.12)';
      });
      editBtn.addEventListener('mouseleave', () => {
        editBtn.style.backgroundColor = 'transparent';
      });
      usernameRow.appendChild(usernameSpan);
      usernameRow.appendChild(editBtn);

      const statsBtn = document.createElement('button');
      statsBtn.id = 'statsBtn';
      statsBtn.className = 'menu-button';
      statsBtn.style.display = 'flex';
      statsBtn.style.alignItems = 'center';
      statsBtn.style.justifyContent = 'space-between';
      statsBtn.style.width = '100%';
      statsBtn.style.gap = '12px';
      const statsLabel = document.createElement('span');
      statsLabel.textContent = 'Stats';
      statsLabel.style.flex = '1';
      statsLabel.style.textAlign = 'left';
      const statsBadge = createEloBadge({ elo: eloValue, size: 32, alt: 'Player Elo' });
      statsBadge.style.pointerEvents = 'none';
      statsBtn.appendChild(statsLabel);
      statsBtn.appendChild(statsBadge);

      const logoutBtn = document.createElement('button');
      logoutBtn.id = 'logoutBtn';
      logoutBtn.className = 'menu-button';
      logoutBtn.style.display = 'flex';
      logoutBtn.style.alignItems = 'center';
      logoutBtn.style.justifyContent = 'space-between';
      logoutBtn.style.width = '100%';
      logoutBtn.style.gap = '12px';
      const googleImg = document.createElement('img');
      googleImg.src = GOOGLE_ICON_SRC;
      googleImg.alt = 'Google';
      googleImg.style.width = '18px';
      googleImg.style.height = '18px';
      googleImg.style.objectFit = 'contain';
      const logoutLabel = document.createElement('span');
      logoutLabel.textContent = 'Logout';
      logoutLabel.style.flex = '1';
      logoutLabel.style.textAlign = 'left';
      googleImg.style.marginLeft = 'auto';
      logoutBtn.appendChild(logoutLabel);
      logoutBtn.appendChild(googleImg);

      accountPanelContent.appendChild(usernameRow);
      accountPanelContent.appendChild(statsBtn);
      accountPanelContent.appendChild(logoutBtn);

      accountBtnImg.src = LOGGED_IN_AVATAR_SRC;
      setCookie('photo', LOGGED_IN_AVATAR_SRC, 60 * 60 * 24 * 365);
      usernameDisplay.textContent = displayName;

      statsBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        openStatsOverlay();
      });
      editBtn.addEventListener('click', async ev => {
        ev.stopPropagation();
        const currentUserId = getCookie('userId');
        if (!currentUserId) {
          alert('Unable to update username: user session not found.');
          return;
        }
        const newName = prompt('Enter new username', displayName);
        if (!newName) return;
        const trimmed = newName.trim();
        if (trimmed.length < 3 || trimmed.length > 18) {
          alert('Username must be between 3 and 18 characters.');
          return;
        }
        try {
          const res = await fetch('/api/v1/users/update', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: currentUserId, username: trimmed })
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.message || 'Failed to update username.');
            return;
          }
          const updated = await res.json();
          const updatedName = updated?.username || trimmed;
          setCookie('username', updatedName, 60 * 60 * 24 * 365);
          localStorage.setItem('cg_username', updatedName);
          const playerIdx = currentPlayerIds.findIndex(id => id && id.toString() === currentUserId);
          if (playerIdx !== -1) {
            playerNames[playerIdx] = updatedName;
            renderBoardAndBars();
          }
          setUsernameDisplay();
          updateAccountPanel();
        } catch (error) {
          console.error('Failed to update username', error);
          alert('Failed to update username. Please try again.');
        }
      });
      logoutBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        setCookie('username', '', 0);
        setCookie('photo', '', 0);
        setCookie('userId', '', 0);
        localStorage.removeItem('cg_username');
        window.location.reload();
      });
    } else {
      statsUserId = null;
      statsUserElo = null;
      statsHistoryMatches = [];
      statsHistoryGames = [];
      statsHistoryLoaded = false;
      statsHistoryGamesByMatch.clear();
      statsUsernameMap = {};
      if (isStatsOverlayOpen()) {
        closeStatsOverlay();
      }
      accountPanelContent.style.alignItems = 'flex-end';
      accountPanelContent.style.gap = '';
      accountPanelContent.innerHTML = `
        <button id="googleLoginBtn" class="menu-button"><img src="${GOOGLE_ICON_SRC}" alt="Google" /> Sign in with Google</button>
        <div class="menu-message">Log in to see account history, statistics, elo, and participate in ranked matches.</div>
      `;
      accountBtnImg.src = ACCOUNT_ICON_SRC;
      usernameDisplay.textContent = '';
      const loginBtn = document.getElementById('googleLoginBtn');
      if (loginBtn) {
        loginBtn.addEventListener('click', () => {
          window.location.href = '/api/auth/google';
        });
      }
    }
  }

  updateAccountPanel();

  // Cookie helpers moved to modules/utils/cookies.js

  const ACTIONS = { SETUP: 0, MOVE: 1, CHALLENGE: 2, BOMB: 3, PASS: 4 };

  // Retrieve stored user ID if present; server assigns one if missing
  async function ensureUserId() {
    const id = getCookie('userId');
    return id || null;
  }

  let socket;
  let userId;
  let lastGameId = null;
  let bannerInterval = null;
  let bannerOverlay = null;
  let bannerKeyListener = null;
  let playAreaRoot = null;
  let isPlayAreaVisible = false;
  let queuerHidden = false;
  let currentMatch = null;
  let activeMatchId = null;

  // Simple board + bars state (plain page)
  let boardRoot = null;
  let topBar = null;
  let bottomBar = null;
  let stashRoot = null;
  let currentRows = 0;
  let currentCols = 0;
  let currentIsWhite = true;

  // Player identity state
  let playerNames = ['Anonymous0', 'Anonymous1'];
  let playerElos = [null, null];
  let currentPlayerIds = [];
  const connectionStatusByPlayer = new Map();

  // Live game state (masked per player)
  let currentBoard = null;        // 2D array of cells
  let currentStashes = [[], []];  // [white[], black[]]
  let currentOnDecks = [null, null];
  let currentCaptured = [[], []]; // pieces captured by [white, black]
  let currentDaggers = [0, 0];
  let currentSquareSize = 0; // last computed board square size
  let currentPlayerTurn = null; // 0 or 1
  let currentOnDeckingPlayer = null; // player index currently selecting on-deck piece
  let postMoveOverlay = null; // { uiR, uiC, types: string[] }
  let pendingCapture = null; // { row, col, piece }
  let lastAction = null; // last action from server
  let lastMove = null;   // last move from server
  let pendingMoveFrom = null; // server coords of last move origin when pending
  let challengeRemoved = null; // server coords of last piece removed by successful challenge
  const BUBBLE_PRELOAD = {}; // type -> HTMLImageElement
  const PIECE_PRELOAD = {}; // identity -> { color -> HTMLImageElement }
  let dragPreviewImgs = []; // active floating preview images
  let lastChoiceOrigin = null; // remember origin for two-option choice
  let gameFinished = false; // true when the current game has concluded
  let currentDrawOffer = null; // { player, createdAt }
  let drawOfferCooldowns = [null, null]; // ms timestamps when players may re-offer
  let drawCooldownTimeout = null;

  const DEFAULT_TIME_SETTINGS = {
    quickplayMs: 300000,
    rankedMs: 180000,
    incrementMs: 3000,
  };
  let timeSettings = { ...DEFAULT_TIME_SETTINGS };
  let expectedTimeControl = null;
  let expectedIncrement = DEFAULT_TIME_SETTINGS.incrementMs;

  // Clock state
  let timeControl = 0;
  let increment = 0;
  let gameStartTime = null; // ms timestamp
  let actionHistory = [];
  let whiteTimeMs = 0;
  let blackTimeMs = 0;
  let activeColor = null; // 0 white, 1 black
  let lastClockUpdate = 0;
  let clockInterval = null;
  let topClockEl = null;
  let bottomClockEl = null;
  let timeExpiredSent = false;

  // Pointer interaction thresholds
  const DRAG_PX_THRESHOLD = DRAG_PX_THRESHOLD_CFG; // from config import (kept names for legacy usage)
  const CLICK_TIME_MAX_MS = CLICK_TIME_MAX_MS_CFG;  // from config import
  let suppressMouseUntil = 0; // timestamp to ignore mouse after touch
  const DRAG_DEBUG = true;
  let debugDragMoveLast = 0;
  const DRAG_PX_THRESHOLD_TOUCH = DRAG_PX_THRESHOLD_TOUCH_CFG;

  // Setup interaction state
  let isInSetup = false;         // true when local player is arranging pieces
  let myColor = 0;               // 0 white, 1 black (derived when entering setup)
  let workingRank = new Array(5).fill(null);   // UI bottom-row columns 0..4 -> piece or null
  let workingOnDeck = null;                     // piece or null
  let workingStash = new Array(8).fill(null);   // 8 stash slots (top 4 + bottom 4)
  let setupComplete = [false, false];

  // Selection/drag state
  let selected = null; // { type: 'stash'|'board'|'deck', index: number }
  let dragging = null; // { piece, origin, ghostEl }

  // Element refs for hit-testing during drag
  const refs = {
    deckEl: null,
    stashSlots: [], // [{el, ordinal}] length 8
    bottomCells: [] // [{el, col}] length 5
  }

  // Track server truth and optimistic intent to avoid flicker
  const queuedState = { quickplay: false, ranked: false };
  let pendingAction = null; // 'join' | 'leave' | null

  function isBombActive() {
    return lastAction && lastAction.type === ACTIONS.BOMB;
  }

  function formatPlayerName(username, idx) {
    if (!username) {
      return 'Anonymous' + idx;
    }
    return username;
  }

  async function loadPlayerNames(ids) {
    if (!Array.isArray(ids)) return;
    currentPlayerIds = ids.slice(0, 2);
    playerNames = currentPlayerIds.map((_, idx) => 'Anonymous' + idx);
    playerElos = currentPlayerIds.map(() => null);
    renderBoardAndBars();
    await Promise.all(currentPlayerIds.map(async (id, idx) => {
      try {
        const res = await fetch('/api/v1/users/getDetails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id })
        });
        if (res.ok) {
          const user = await res.json().catch(() => null);
          playerNames[idx] = formatPlayerName(user?.username, idx);
          playerElos[idx] = Number.isFinite(user?.elo) ? user.elo : null;
        }
      } catch (_) {}
    }));
    renderBoardAndBars();
  }

  function syncPlayerElosFromMatch(match) {
    if (!match || typeof match !== 'object') return false;
    const matchType = typeof match.type === 'string' ? match.type.toUpperCase() : '';
    if (matchType !== 'RANKED') return false;

    const toIdString = (value) => {
      if (!value) return '';
      if (typeof value === 'string' || typeof value === 'number') {
        return String(value);
      }
      if (typeof value === 'object') {
        if (value._id !== undefined) {
          return toIdString(value._id);
        }
        if (typeof value.toHexString === 'function') {
          return value.toHexString();
        }
        if (typeof value.toString === 'function') {
          const str = value.toString();
          return str === '[object Object]' ? '' : str;
        }
      }
      return '';
    };

    const matchIds = [match.player1, match.player2].map(toIdString);
    const endElos = [match.player1EndElo, match.player2EndElo];
    let updated = false;

    matchIds.forEach((idStr, idx) => {
      if (!idStr) return;
      const newElo = endElos[idx];
      if (!Number.isFinite(newElo)) return;
      const targetIdx = currentPlayerIds.findIndex(playerId => toIdString(playerId) === idStr);
      if (targetIdx === -1) return;
      if (!Number.isFinite(playerElos[targetIdx]) || playerElos[targetIdx] !== newElo) {
        playerElos[targetIdx] = newElo;
        updated = true;
      }
    });

    return updated;
  }

  function updateConnectionStatus(payload) {
    if (!payload) return;
    const playerId = payload.playerId ? String(payload.playerId) : null;
    if (!playerId) return;
    if (!payload.isDisconnected) {
      connectionStatusByPlayer.delete(playerId);
      return;
    }
    const matchId = payload.matchId ? String(payload.matchId) : null;
    const rawRemaining = Number(payload.remainingSeconds);
    const rawCumulative = Number(payload.cumulativeSeconds);
    connectionStatusByPlayer.set(playerId, {
      matchId,
      isDisconnected: true,
      remainingSeconds: Number.isFinite(rawRemaining) ? rawRemaining : null,
      cumulativeSeconds: Number.isFinite(rawCumulative) ? rawCumulative : null,
      lastUpdated: Date.now(),
    });
  }

  function getActiveMatchId() {
    return activeMatchId ? String(activeMatchId) : null;
  }

  function getConnectionDisplayForPlayer(playerId, shouldShow = true) {
    const pid = playerId ? String(playerId) : null;
    if (!pid || !shouldShow) return null;
    const status = connectionStatusByPlayer.get(pid);
    if (!status || !status.isDisconnected) return null;
    const currentMatchId = getActiveMatchId();
    if (currentMatchId && status.matchId && status.matchId !== currentMatchId) {
      return null;
    }
    const base = status.remainingSeconds;
    if (!Number.isFinite(base)) return null;
    const elapsed = (Date.now() - (status.lastUpdated || 0)) / 1000;
    const displaySeconds = Math.max(0, Math.ceil(base - elapsed));
    return {
      displaySeconds,
      remainingSeconds: base,
      cumulativeSeconds: status.cumulativeSeconds,
    };
  }

  function clearDrawCooldownTimeout() {
    if (drawCooldownTimeout) {
      clearTimeout(drawCooldownTimeout);
      drawCooldownTimeout = null;
    }
  }

  function scheduleDrawCooldownCheck() {
    clearDrawCooldownTimeout();
    if (!Array.isArray(drawOfferCooldowns)) return;
    const now = Date.now();
    const future = drawOfferCooldowns
      .map((ts) => {
        if (typeof ts === 'number') return ts;
        if (!ts) return null;
        const parsed = typeof ts === 'string' ? Date.parse(ts) : (ts instanceof Date ? ts.getTime() : Number(ts));
        return Number.isFinite(parsed) ? parsed : null;
      })
      .filter((ts) => Number.isFinite(ts) && ts > now);
    if (future.length === 0) return;
    const next = Math.min(...future);
    drawCooldownTimeout = setTimeout(() => {
      drawCooldownTimeout = null;
      renderBoardAndBars();
    }, Math.max(0, next - now));
  }

  // Clock helpers
  function formatClock(ms) {
    ms = Math.max(0, ms);
    if (ms >= 60000) {
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      return m + ':' + String(s).padStart(2, '0');
    } else {
      const s = Math.floor(ms / 1000);
      const h = Math.floor((ms % 1000) / 10);
      return s + ':' + String(h).padStart(2, '0');
    }
  }

  function coerceMilliseconds(value, { allowZero = false } = {}) {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    if (!allowZero && num <= 0) return null;
    if (allowZero && num < 0) return null;
    return num;
  }

  function describeTimeControl(baseMs, incMs) {
    const parts = [];
    if (Number.isFinite(baseMs) && baseMs > 0) {
      const minutes = Math.floor(baseMs / 60000);
      const seconds = Math.round((baseMs % 60000) / 1000);
      if (minutes > 0 && seconds > 0) {
        parts.push(`${minutes}m ${seconds}s`);
      } else if (minutes > 0) {
        parts.push(`${minutes}m`);
      } else if (seconds > 0) {
        parts.push(`${seconds}s`);
      }
    }
    if (Number.isFinite(incMs) && incMs > 0) {
      const incSeconds = incMs / 1000;
      const formatted = Number.isInteger(incSeconds) ? String(incSeconds) : incSeconds.toFixed(1);
      parts.push(`+ ${formatted}s`);
    }
    if (parts.length === 0) return null;
    return parts.join(' ');
  }

  function getClockLabel() {
    const base = Number.isFinite(expectedTimeControl) && expectedTimeControl > 0
      ? expectedTimeControl
      : (Number.isFinite(timeControl) && timeControl > 0 ? timeControl : null);
    const inc = Number.isFinite(expectedIncrement) && expectedIncrement >= 0
      ? expectedIncrement
      : (Number.isFinite(increment) && increment >= 0 ? increment : null);
    return describeTimeControl(base, inc);
  }

  function getDisplayClockMsForColor(colorIdx) {
    if (!gameStartTime && Number.isFinite(expectedTimeControl) && expectedTimeControl > 0) {
      return expectedTimeControl;
    }
    if (colorIdx === 0) return whiteTimeMs;
    if (colorIdx === 1) return blackTimeMs;
    return 0;
  }

  function applyExpectedTimeSettingsForMatch(match) {
    if (!match || typeof match !== 'object') {
      expectedTimeControl = null;
      expectedIncrement = timeSettings.incrementMs;
      renderBoardAndBars();
      updateClockDisplay();
      return;
    }

    const type = typeof match.type === 'string' ? match.type.toUpperCase() : '';
    if (type === 'QUICKPLAY') {
      expectedTimeControl = timeSettings.quickplayMs;
    } else if (type === 'RANKED') {
      expectedTimeControl = timeSettings.rankedMs;
    } else {
      expectedTimeControl = null;
    }
    expectedIncrement = timeSettings.incrementMs;
    renderBoardAndBars();
    updateClockDisplay();
  }

  function updateTimeSettings(settings) {
    if (!settings || typeof settings !== 'object') return;
    const quick = coerceMilliseconds(settings.quickplayMs);
    if (quick !== null) timeSettings.quickplayMs = quick;
    const ranked = coerceMilliseconds(settings.rankedMs);
    if (ranked !== null) timeSettings.rankedMs = ranked;
    const inc = coerceMilliseconds(settings.incrementMs, { allowZero: true });
    if (inc !== null) {
      timeSettings.incrementMs = inc;
      expectedIncrement = inc;
    }
    applyExpectedTimeSettingsForMatch(currentMatch);
  }

  function updateClockDisplay() {
    const topColor = currentIsWhite ? 1 : 0;
    const bottomColor = currentIsWhite ? 0 : 1;
    if (topClockEl) {
      const ms = getDisplayClockMsForColor(topColor);
      topClockEl.textContent = formatClock(ms);
    }
    if (bottomClockEl) {
      const ms = getDisplayClockMsForColor(bottomColor);
      bottomClockEl.textContent = formatClock(ms);
    }
  }

  function tickClock() {
    const now = Date.now();
    const diff = now - lastClockUpdate;
    lastClockUpdate = now;
    if (!setupComplete[0] || !setupComplete[1]) {
      if (!setupComplete[0]) whiteTimeMs -= diff;
      if (!setupComplete[1]) blackTimeMs -= diff;
    } else if (activeColor === 0) {
      whiteTimeMs -= diff;
    } else if (activeColor === 1) {
      blackTimeMs -= diff;
    }
    updateClockDisplay();
    if (!timeExpiredSent && (whiteTimeMs <= 0 || blackTimeMs <= 0) && lastGameId) {
      timeExpiredSent = true;
      apiCheckTimeControl(lastGameId).catch(err => console.error('checkTimeControl failed', err));
    }
  }

  function startClockInterval() {
    if (gameFinished) return;
    if (clockInterval) clearInterval(clockInterval);
    lastClockUpdate = Date.now();
    clockInterval = setInterval(tickClock, 100);
  }

  function stopClockInterval() {
    if (clockInterval) clearInterval(clockInterval);
    clockInterval = null;
  }

  function recomputeClocksFromServer() {
    const baseTime = Number.isFinite(timeControl) && timeControl > 0
      ? timeControl
      : (Number.isFinite(expectedTimeControl) && expectedTimeControl > 0 ? expectedTimeControl : null);
    if (!baseTime) {
      updateClockDisplay();
      return;
    }

    const incValue = Number.isFinite(increment) && increment >= 0
      ? increment
      : (Number.isFinite(expectedIncrement) && expectedIncrement >= 0 ? expectedIncrement : 0);
    if (!Number.isFinite(increment) || increment < 0) {
      increment = incValue;
    }

    if (!gameStartTime) {
      whiteTimeMs = baseTime;
      blackTimeMs = baseTime;
      activeColor = null;
      stopClockInterval();
      updateClockDisplay();
      return;
    }

    let white = baseTime;
    let black = baseTime;
    let lastTs = gameStartTime;
    const actions = (actionHistory || []).filter(a => new Date(a.timestamp).getTime() >= gameStartTime);
    const setupFlags = [false, false];
    let turn = null;
    for (const act of actions) {
      const ts = new Date(act.timestamp).getTime();
      const delta = ts - lastTs;
      if (!setupFlags[0] || !setupFlags[1]) {
        if (!setupFlags[0]) white -= delta;
        if (!setupFlags[1]) black -= delta;
      } else if (turn === 0) {
        white -= delta;
      } else if (turn === 1) {
        black -= delta;
      }
      lastTs = ts;
      if (act.type === ACTIONS.SETUP) {
        setupFlags[act.player] = true;
        if (setupFlags[0] && setupFlags[1]) {
          turn = 0; // white to move after both setups
        }
      } else {
        if (turn === null) turn = 0;
        if (act.player === 0) {
          white += incValue;
          turn = 1;
        } else {
          black += incValue;
          turn = 0;
        }
      }
    }
    const now = Date.now();
    const delta = now - lastTs;
    if (!setupFlags[0] || !setupFlags[1]) {
      if (!setupFlags[0]) white -= delta;
      if (!setupFlags[1]) black -= delta;
    } else if (turn === 0) {
      white -= delta;
    } else if (turn === 1) {
      black -= delta;
    }
    whiteTimeMs = white;
    blackTimeMs = black;
    activeColor = (setupFlags[0] && setupFlags[1]) ? turn : null;
    updateClockDisplay();
    const expired = whiteTimeMs <= 0 || blackTimeMs <= 0;
    if (expired && lastGameId && !timeExpiredSent) {
      timeExpiredSent = true;
      apiCheckTimeControl(lastGameId).catch(err => console.error('checkTimeControl failed', err));
    } else if (!expired) {
      timeExpiredSent = false;
    }
    startClockInterval();
  }

  function applyLocalMoveClock() {
    if (activeColor === null) return;
    const now = Date.now();
    const diff = now - lastClockUpdate;
    if (activeColor === 0) {
      whiteTimeMs -= diff;
      whiteTimeMs += increment;
      activeColor = 1;
    } else {
      blackTimeMs -= diff;
      blackTimeMs += increment;
      activeColor = 0;
    }
    lastClockUpdate = now;
    updateClockDisplay();
  }

  function updateFindButton() {
    const awaitingServerQueueState = !queueStatusKnown && queueStartTime != null;
    const anyQueued = queuedState.quickplay || queuedState.ranked;
    let mode = modeSelect.value;
    const activeMode = queueStatusKnown
      ? (queuedState.quickplay ? 'quickplay' : queuedState.ranked ? 'ranked' : null)
      : null;
    const preferredMode = activeMode || queueStartMode;

    if ((awaitingServerQueueState || anyQueued) && preferredMode && mode !== preferredMode) {
      mode = preferredMode;
      modeSelect.value = preferredMode;
    }

    if (activeMode && queueStartMode !== activeMode) {
      persistQueueMode(activeMode);
    }

    const isQueued = queuedState[mode];
    const showSearching =
      pendingAction === 'join' ||
      isQueued ||
      awaitingServerQueueState ||
      (queueStatusKnown && anyQueued);

    console.log('[UI] updateFindButton', {
      showSearching,
      pendingAction,
      isQueued,
      queueStatusKnown,
      anyQueued,
      mode,
      activeMode
    });

    if (showSearching) {
      queueBtn.classList.add('searching');
      modeSelect.disabled = true;
      selectWrap.classList.add('disabled');
      if (!queueTimerEl) {
        queueBtn.innerHTML = 'Searching...<div class="queue-timer" id="queueTimer"></div>';
        queueTimerEl = document.getElementById('queueTimer');
      }
      if (!queueTimerInterval) {
        const timerMode =
          pendingAction === 'join'
            ? mode
            : (activeMode || queueStartMode || mode);
        startQueueTimer(queueStartTime != null ? queueStartTime : Date.now(), timerMode);
      }
    } else {
      queueBtn.textContent = 'Find Game';
      queueBtn.classList.remove('searching');
      modeSelect.disabled = false;
      selectWrap.classList.remove('disabled');
      if (queueStatusKnown) {
        stopQueueTimer();
      }
      queueTimerEl = null;
    }
  }

  function wireSocket() {
    bindSocket(socket, {
      onConnect() { console.log('[socket] connected'); },
      async onInitialState(payload) {
      console.log('[socket] initialState', payload);
      queuedState.quickplay = Boolean(payload?.queued?.quickplay);
      queuedState.ranked = Boolean(payload?.queued?.ranked);
      queueStatusKnown = true;
      pendingAction = null;
      if (!(queuedState.quickplay || queuedState.ranked)) {
        stopQueueTimer();
      }
      updateFindButton();

      // Reconnect flow: if server says we already have an active game, show play area now
      try {
        const games = Array.isArray(payload?.games) ? payload.games : [];
        if (games.length > 0) {
          const latest = games[0];
          if (latest?._id) {
            lastGameId = latest._id; // treat as already handled
          }
          hideQueuer();
          showPlayArea();

          if (latest?.match) {
            activeMatchId = String(latest.match);
            try {
              currentMatch = await apiGetMatchDetails(latest.match);
              if (currentMatch?._id) {
                activeMatchId = String(currentMatch._id);
              }
              applyExpectedTimeSettingsForMatch(currentMatch);
              syncPlayerElosFromMatch(currentMatch);
            } catch (e) {
              console.error('Failed to fetch match details', e);
              currentMatch = null;
              applyExpectedTimeSettingsForMatch(null);
            }
          }

          if (Array.isArray(latest?.players)) {
            loadPlayerNames(latest.players);
          }

          // If this player refreshed between games, treat it as pressing Next.
          // Otherwise, auto-send READY if they had already pressed Next previously.
          try {
            const colorIdx = Array.isArray(latest?.players)
              ? latest.players.findIndex(function(p){ return p === userId; })
              : -1;
            const isReady = Array.isArray(latest?.playersReady) && colorIdx > -1
              ? Boolean(latest.playersReady[colorIdx])
              : false;
            const isNext = Array.isArray(latest?.playersNext) && colorIdx > -1
              ? Boolean(latest.playersNext[colorIdx])
              : false;
            currentIsWhite = (colorIdx === 0);

            if (colorIdx > -1 && !isNext) {
              try {
                const match = await apiGetMatchDetails(latest.match);
                if (match?._id) {
                  activeMatchId = String(match._id);
                }
                const prevGames = Array.isArray(match?.games)
                  ? match.games.filter(function(g){ return !g.isActive && g._id?.toString() !== latest._id; })
                  : [];
                const prevGame = prevGames.length > 0 ? prevGames[prevGames.length - 1] : null;
                if (prevGame) {
                  const winnerIdx = prevGame.winner;
                  const loserIdx = winnerIdx === 0 ? 1 : 0;
                  const winnerName = playerNames[winnerIdx] || formatPlayerName(null, winnerIdx);
                  const loserName = playerNames[loserIdx] || formatPlayerName(null, loserIdx);
                  const prevColorIdx = Array.isArray(prevGame.players)
                    ? prevGame.players.findIndex(function(p){ return p === userId; })
                    : -1;
                  showGameFinishedBanner({
                    winnerName,
                    loserName,
                    winnerColor: winnerIdx,
                    didWin: winnerIdx === prevColorIdx,
                    match,
                    winReason: prevGame.winReason
                  });
                }
              } catch (err) {
                console.error('Error showing banner on reconnect', err);
              }
              try {
                await apiNext(latest._id, colorIdx);
              } catch (err) {
                console.error('NEXT on reconnect failed', err);
              }
              const desc = document.getElementById('gameOverDesc');
              const btn = document.getElementById('gameOverNextBtn');
              if (desc) desc.textContent = 'Waiting for other player...';
              if (btn) btn.style.display = 'none';
            } else if (colorIdx > -1 && !isReady) {
              console.log('[client] reconnect sending READY immediately', { gameId: latest._id, color: colorIdx });
              apiReady(latest._id, colorIdx).catch(function(err){ console.error('READY on reconnect failed', err); });
            }
          } catch (e) { console.error('Error evaluating reconnect ready state', e); }

            // Adopt masked state immediately if present, and enter setup if needed
          try {
            if (Array.isArray(latest?.board)) {
              currentRows = latest.board.length || 6;
              currentCols = latest.board[0]?.length || 5;
                setStateFromServer(latest);
                myColor = currentIsWhite ? 0 : 1;
                const setupArr = Array.isArray(latest?.setupComplete) ? latest.setupComplete : setupComplete;
                const mineDone = Boolean(setupArr?.[myColor]);
                if (!mineDone) {
                  // Fetch a fresh masked view to seed working state
                  try {
                    const view = await apiGetDetails(latest._id, myColor) || latest;
                    bootstrapWorkingStateFromServer(view || latest);
                    isInSetup = true;
                    
                  } catch (_) {
                    bootstrapWorkingStateFromServer(latest);
                    isInSetup = true;
                  }
                } else {
                  isInSetup = false;
                }
              ensurePlayAreaRoot();
              layoutPlayArea();
              renderBoardAndBars();
            }
          } catch (_) {}
        }
      } catch (_) {}
      },
      onQueueUpdate(payload) {

      if (!payload) return;
      queuedState.quickplay = Boolean(payload.quickplay);
      queuedState.ranked = Boolean(payload.ranked);
      queueStatusKnown = true;
      pendingAction = null;
      updateFindButton();
      },
      async onGameUpdate(payload) {
      try {
        if (!payload || !payload.gameId || !Array.isArray(payload.players)) return;
        const gameId = payload.gameId;
        const color = payload.players.findIndex(p => p === userId);
        if (color !== 0 && color !== 1) return;

        if (payload.matchId) {
          activeMatchId = String(payload.matchId);
        }

        if (!currentMatch && payload.matchId) {
          try {
            currentMatch = await apiGetMatchDetails(payload.matchId);
            if (currentMatch?._id) {
              activeMatchId = String(currentMatch._id);
            }
            applyExpectedTimeSettingsForMatch(currentMatch);
          } catch (e) {
            console.error('Failed to fetch match details', e);
            applyExpectedTimeSettingsForMatch(null);
          }
        }

        gameFinished = payload.winReason !== undefined && payload.winReason !== null;
        if (gameFinished) {
          stopClockInterval();
          selected = null;
          dragging = null;
        }

        // As soon as we are in a game, hide the Find Game UI
        hideQueuer();
        loadPlayerNames(payload.players);
        currentIsWhite = (color === 0);

          // If the server provided a board/state, adopt and render
        if (Array.isArray(payload.board)) {
          currentRows = payload.board.length || 6;
          currentCols = payload.board[0]?.length || 5;
            setStateFromServer(payload);
            // Keep setup mode consistent after refresh or reconnect
            myColor = currentIsWhite ? 0 : 1;
            const setupArr = Array.isArray(payload?.setupComplete) ? payload.setupComplete : setupComplete;
            const mineDone = Boolean(setupArr?.[myColor]);
            if (!mineDone) {
              if (!isInSetup) {
                // bootstrap if just entering
                bootstrapWorkingStateFromServer(payload);
              }
              isInSetup = true;
            } else {
              isInSetup = false;
            }
          ensurePlayAreaRoot();
          layoutPlayArea();
          renderBoardAndBars();
        }

        lastGameId = gameId;
      } catch (e) {
        console.error('Error handling game:update', e);
      }
      },
      onGameFinished(payload) {
        console.log('[socket] game:finished', payload);
        gameFinished = payload?.winReason !== undefined && payload?.winReason !== null;
        stopClockInterval();
        selected = null;
        dragging = null;
        currentDrawOffer = null;
        drawOfferCooldowns = [null, null];
        clearDrawCooldownTimeout();
        renderBoardAndBars();
        (async () => {
          try {
            const winnerIdx = payload?.winner;
            const ids = Array.isArray(payload?.players) ? payload.players : [];
            if (payload?.matchId) {
              activeMatchId = String(payload.matchId);
            }
            let match = await apiGetMatchDetails(payload.matchId);
            if (match?._id) {
              activeMatchId = String(match._id);
            }
            const isDraw = winnerIdx !== 0 && winnerIdx !== 1;
            if (isDraw) {
              showGameFinishedBanner({
                winnerName: null,
                loserName: null,
                winnerColor: null,
                didWin: false,
                match,
                winReason: payload.winReason,
                players: ids
              });
              return;
            }

            const winnerId = ids[winnerIdx];
            let winnerName = playerNames[winnerIdx] || formatPlayerName(null, winnerIdx);
            if (winnerId) {
              try {
                const res = await fetch('/api/v1/users/getDetails', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ userId: winnerId })
                });
                if (res.ok) {
                  const user = await res.json();
                  winnerName = formatPlayerName(user?.username, winnerIdx);
                } else {
                  winnerName = formatPlayerName(null, winnerIdx);
                }
              } catch (e) {
                console.error('Failed to fetch winner details', e);
                winnerName = formatPlayerName(null, winnerIdx);
              }
            }
            if (payload?.matchId) {
              activeMatchId = String(payload.matchId);
            }
            match = await apiGetMatchDetails(payload.matchId);
            if (match?._id) {
              activeMatchId = String(match._id);
            }
            const updatedElos = syncPlayerElosFromMatch(match);
            if (updatedElos) {
              renderBoardAndBars();
            }
            const loserIdx = winnerIdx === 0 ? 1 : 0;
            const loserName = playerNames[loserIdx] || formatPlayerName(null, loserIdx);
            showGameFinishedBanner({
              winnerName,
              loserName,
              winnerColor: winnerIdx,
              didWin: winnerIdx === myColor,
              match,
              winReason: payload.winReason,
              players: ids
            });
            await updateAccountPanel();
          } catch (e) {
            console.error('Error handling game:finished', e);
          }
        })();
      },
      async onNextCountdown(payload) {
        try {
          const { gameId, color, seconds } = payload || {};
          const desc = document.getElementById('gameOverDesc');
          const btn = document.getElementById('gameOverNextBtn');
          if (!desc) return;
          let remaining = seconds || 5;
          desc.textContent = `Opponent ready. Continuing in ${remaining}...`;
          if (bannerInterval) clearInterval(bannerInterval);
          bannerInterval = setInterval(async () => {
            remaining -= 1;
            if (remaining <= 0) {
              clearInterval(bannerInterval);
              bannerInterval = null;
              try { await apiNext(gameId, color); } catch (e) { console.error('auto next failed', e); }
              desc.textContent = 'Waiting for other player...';
              if (btn) btn.style.display = 'none';
            } else {
              desc.textContent = `Opponent ready. Continuing in ${remaining}...`;
            }
          }, 1000);
        } catch (e) { console.error('next countdown handler failed', e); }
      },
      async onBothNext(payload) {
        try {
          const { gameId, color } = payload || {};
          if (!gameId) return;

          const nextGameId = typeof gameId === 'string' ? gameId : String(gameId);
          const hasLiveBoard = Array.isArray(currentBoard) && currentBoard.length > 0;
          const isCurrentActiveGame =
            nextGameId === (typeof lastGameId === 'string' ? lastGameId : String(lastGameId || '')) &&
            hasLiveBoard &&
            !gameFinished;

          if (isCurrentActiveGame) {
            // Suppress countdown banner if this is simply a reconnect to the current live game.
            return;
          }

          lastGameId = nextGameId;
          showMatchFoundBanner(3, async function(remaining) {
            if (remaining === 0) {
              try { await apiReady(nextGameId, color); } catch (e) { console.error('Failed to ready after next', e); }
            }
          });
        } catch (e) { console.error('players:bothNext handler failed', e); }
      },
      async onBothReady(payload) {
        try {
          showPlayArea();
          const gameId = payload?.gameId || lastGameId;
          if (!gameId) return;
          const colorIdx = currentIsWhite ? 0 : 1;
          const view = await apiGetDetails(gameId, colorIdx);
          if (!view) return;
          setStateFromServer(view);
          if (Array.isArray(view.players)) {
            loadPlayerNames(view.players);
          }
          // Enter setup mode if our setup is not complete
          myColor = currentIsWhite ? 0 : 1;
          const serverSetup = Array.isArray(view?.setupComplete) ? view.setupComplete : setupComplete;
          const myDone = Boolean(serverSetup?.[myColor]);

          if (!myDone) {
            bootstrapWorkingStateFromServer(view);
            isInSetup = true;
          } else {
            isInSetup = false;
          }
          // If opponent has completed setup, render their back rank as unknown pieces (already masked by server)
          ensurePlayAreaRoot();
          layoutPlayArea();
          renderBoardAndBars();
        } catch (e) {
          console.error('players:bothReady handler failed', e);
        }
      },
      onConnectionStatus(payload) {
        if (payload?.matchId) {
          activeMatchId = String(payload.matchId);
        }
        updateConnectionStatus(payload);
        renderBoardAndBars();
      },
      onDisconnect() { /* keep UI; server handles grace */ }
    });
    socket.on('user:init', (payload) => {
      const newId = payload && payload.userId;
      if (newId) {
        userId = newId;
        setCookie('userId', newId, 60 * 60 * 24 * 365);
      }
      if (payload && payload.username && !payload.guest) {
        localStorage.setItem('cg_username', payload.username);
        setCookie('username', payload.username, 60 * 60 * 24 * 365);
        setCookie('photo', LOGGED_IN_AVATAR_SRC, 60 * 60 * 24 * 365);
      } else {
        localStorage.removeItem('cg_username');
        setCookie('username', '', 0);
        setCookie('photo', '', 0);
      }
      updateAccountPanel();
    });
  }

  async function enterQueue(mode) {
    console.log('[action] enterQueue', { userId, mode });
    const res = mode === 'ranked' ? await apiEnterRankedQueue(userId) : await apiEnterQueue(userId);
    console.log('[action] enterQueue response', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to enter queue');
    }
  }

  async function exitQueue(mode) {
    console.log('[action] exitQueue', { userId, mode });
    const res = mode === 'ranked' ? await apiExitRankedQueue(userId) : await apiExitQueue(userId);
    console.log('[action] exitQueue response', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to exit queue');
    }
  }

  queueBtn.addEventListener('click', async function() {
    let mode = modeSelect.value;
    const awaitingServerQueueState = !queueStatusKnown && queueStartTime != null;
    if (awaitingServerQueueState && queueStartMode && mode !== queueStartMode) {
      mode = queueStartMode;
      modeSelect.value = queueStartMode;
    }
    const isQueued = queuedState[mode];
    const currentlyQueued = isQueued || (awaitingServerQueueState && (!queueStartMode || queueStartMode === mode));
    const actionMode = currentlyQueued && queueStartMode ? queueStartMode : mode;
    console.log('[ui] click queueBtn', { mode, pendingAction, isQueued, awaitingServerQueueState, currentlyQueued, actionMode });
    try {
      if (!(pendingAction === 'join' || currentlyQueued)) {
        pendingAction = 'join';
        updateFindButton();
        await enterQueue(actionMode);
      } else {
        pendingAction = 'leave';
        updateFindButton();
        await exitQueue(actionMode);
      }
    } catch (e) {
      console.error(e);
      const failedAction = pendingAction;
      pendingAction = null;
      if (failedAction === 'join') {
        queueStatusKnown = true;
        stopQueueTimer();
      }
      updateFindButton();
    }
  });

  // Fallback UI state
  updateFindButton();

  (async function init() {
    try {
      userId = await ensureUserId();
      console.log('[init] userId', userId);
      try {
        const settings = await apiGetTimeSettings();
        if (settings) updateTimeSettings(settings);
      } catch (cfgErr) {
        console.warn('Failed to load time settings', cfgErr);
      }
      preloadPieceImages();
      preloadBubbleImages();
      socket = io('/', { auth: { userId } });
      wireSocket();
    } catch (e) {
      console.error(e);
    }
  })();

  // ------- Match Found Banner helpers -------
  function ensureBannerOverlay() {
    if (bannerOverlay) return bannerOverlay;
    bannerOverlay = createOverlay({
      baseClass: 'cg-overlay banner-overlay',
      dialogClass: 'banner-overlay__dialog',
      contentClass: 'banner-overlay__content',
      backdropClass: 'cg-overlay__backdrop banner-overlay-backdrop',
      closeButtonClass: 'banner-overlay__close',
      closeLabel: 'Close banner',
      closeText: '✕',
      closeOnBackdrop: false,
      openClass: 'cg-overlay--open banner-overlay--open',
      bodyOpenClass: 'cg-overlay-open',
      trapFocus: true
    });
    if (bannerOverlay.closeButton) {
      bannerOverlay.closeButton.setAttribute('aria-label', 'Close banner');
    }
    return bannerOverlay;
  }

  function setBannerKeyListener(listener) {
    bannerKeyListener = typeof listener === 'function' ? listener : null;
  }

  function showResignConfirm() {
    if (!lastGameId || gameFinished) return;
    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    setBannerKeyListener(null);
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    content.innerHTML = '';
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';
    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => { closeBanner(); };
    }

    const viewportBasis = Math.min(window.innerWidth || 0, window.innerHeight || 0) || 0;
    const modalScale = clamp(viewportBasis ? viewportBasis / 720 : 1, 0.6, 1);
    const cardPadY = clamp(Math.round(22 * modalScale), 14, 22);
    const cardPadX = clamp(Math.round(28 * modalScale), 18, 28);
    const cardGap = clamp(Math.round(18 * modalScale), 12, 18);

    const card = document.createElement('div');
    card.style.padding = `${cardPadY}px ${cardPadX}px`;
    card.style.border = '2px solid var(--CG-deep-gold)';
    card.style.background = 'var(--CG-deep-purple)';
    card.style.color = 'var(--CG-white)';
    card.style.textAlign = 'center';
    card.style.boxShadow = '0 12px 32px rgba(0,0,0,0.45)';
    card.style.maxWidth = '360px';
    card.style.width = '90%';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = cardGap + 'px';

    const message = document.createElement('div');
    message.textContent = 'Are you sure you wish to resign this game?';
    message.style.fontSize = '20px';
    message.style.fontWeight = '600';
    message.style.lineHeight = '1.4';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = '12px';
    buttons.style.justifyContent = 'center';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.flex = '1';
    cancelBtn.style.minWidth = '0';
    cancelBtn.style.background = 'var(--CG-forest)';
    cancelBtn.style.color = 'var(--CG-white)';
    cancelBtn.style.border = '2px solid var(--CG-deep-gold)';
    cancelBtn.style.padding = '10px 16px';
    cancelBtn.style.fontSize = '18px';
    cancelBtn.style.fontWeight = '700';
    cancelBtn.style.cursor = 'pointer';

    const resignBtn = document.createElement('button');
    resignBtn.textContent = 'Resign';
    resignBtn.style.flex = '1';
    resignBtn.style.minWidth = '0';
    resignBtn.style.background = 'var(--CG-dark-red)';
    resignBtn.style.color = 'var(--CG-white)';
    resignBtn.style.border = '2px solid var(--CG-deep-gold)';
    resignBtn.style.padding = '10px 16px';
    resignBtn.style.fontSize = '18px';
    resignBtn.style.fontWeight = '700';
    resignBtn.style.cursor = 'pointer';

    buttons.appendChild(cancelBtn);
    buttons.appendChild(resignBtn);
    card.appendChild(message);
    card.appendChild(buttons);
    content.appendChild(card);
    overlay.show({ initialFocus: cancelBtn });

    function closeBanner() {
      if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
      content.innerHTML = '';
      overlay.hide();
      setBannerKeyListener(null);
    }

    cancelBtn.addEventListener('click', () => {
      closeBanner();
    });

    resignBtn.addEventListener('click', async () => {
      if (!lastGameId) return;
      cancelBtn.disabled = true;
      resignBtn.disabled = true;
      cancelBtn.style.opacity = '0.7';
      resignBtn.style.opacity = '0.7';
      resignBtn.textContent = 'Resigning…';
      try {
        await apiResign(lastGameId, myColor);
        closeBanner();
      } catch (err) {
        console.error('Resign failed', err);
        cancelBtn.disabled = false;
        resignBtn.disabled = false;
        cancelBtn.style.opacity = '1';
        resignBtn.style.opacity = '1';
        resignBtn.textContent = 'Resign';
      }
    });
  }

  function showDrawConfirm() {
    if (!lastGameId || gameFinished) return;
    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    setBannerKeyListener(null);
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    content.innerHTML = '';
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';
    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => { closeBanner(); };
    }

    const viewportBasis = Math.min(window.innerWidth || 0, window.innerHeight || 0) || 0;
    const modalScale = clamp(viewportBasis ? viewportBasis / 720 : 1, 0.6, 1);
    const cardPadY = clamp(Math.round(22 * modalScale), 14, 22);
    const cardPadX = clamp(Math.round(28 * modalScale), 18, 28);
    const cardGap = clamp(Math.round(18 * modalScale), 12, 18);

    const card = document.createElement('div');
    card.style.padding = `${cardPadY}px ${cardPadX}px`;
    card.style.border = '2px solid var(--CG-deep-gold)';
    card.style.background = 'var(--CG-deep-purple)';
    card.style.color = 'var(--CG-white)';
    card.style.textAlign = 'center';
    card.style.boxShadow = '0 12px 32px rgba(0,0,0,0.45)';
    card.style.maxWidth = '360px';
    card.style.width = '90%';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = cardGap + 'px';

    const message = document.createElement('div');
    message.textContent = 'Confirm offer draw?';
    message.style.fontSize = clamp(Math.round(20 * modalScale), 14, 20) + 'px';
    message.style.fontWeight = '600';
    message.style.lineHeight = '1.4';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = clamp(Math.round(12 * modalScale), 8, 12) + 'px';
    buttons.style.justifyContent = 'center';

    const btnPadY = clamp(Math.round(10 * modalScale), 6, 10);
    const btnPadX = clamp(Math.round(16 * modalScale), 10, 16);
    const btnFontSize = clamp(Math.round(18 * modalScale), 12, 18);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.flex = '1';
    cancelBtn.style.minWidth = '0';
    cancelBtn.style.background = 'var(--CG-forest)';
    cancelBtn.style.color = 'var(--CG-white)';
    cancelBtn.style.border = '2px solid var(--CG-deep-gold)';
    cancelBtn.style.padding = `${btnPadY}px ${btnPadX}px`;
    cancelBtn.style.fontSize = btnFontSize + 'px';
    cancelBtn.style.fontWeight = '700';
    cancelBtn.style.cursor = 'pointer';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Yes';
    confirmBtn.style.flex = '1';
    confirmBtn.style.minWidth = '0';
    confirmBtn.style.background = 'var(--CG-gray)';
    confirmBtn.style.color = 'var(--CG-white)';
    confirmBtn.style.border = '2px solid var(--CG-deep-gold)';
    confirmBtn.style.padding = `${btnPadY}px ${btnPadX}px`;
    confirmBtn.style.fontSize = btnFontSize + 'px';
    confirmBtn.style.fontWeight = '700';
    confirmBtn.style.cursor = 'pointer';

    buttons.appendChild(cancelBtn);
    buttons.appendChild(confirmBtn);
    card.appendChild(message);
    card.appendChild(buttons);
    content.appendChild(card);
    overlay.show({ initialFocus: cancelBtn });

    function closeBanner() {
      if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
      content.innerHTML = '';
      overlay.hide();
      setBannerKeyListener(null);
    }

    cancelBtn.addEventListener('click', () => {
      closeBanner();
    });

    confirmBtn.addEventListener('click', async () => {
      if (!lastGameId) return;
      cancelBtn.disabled = true;
      confirmBtn.disabled = true;
      cancelBtn.style.opacity = '0.7';
      confirmBtn.style.opacity = '0.7';
      confirmBtn.textContent = 'Sending…';
      try {
        const res = await apiDraw(lastGameId, myColor, 'offer');
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.message || 'Failed to offer draw');
        }
        closeBanner();
      } catch (err) {
        console.error('Draw offer failed', err);
        alert(err?.message || 'Failed to offer draw');
        cancelBtn.disabled = false;
        confirmBtn.disabled = false;
        cancelBtn.style.opacity = '1';
        confirmBtn.style.opacity = '1';
        confirmBtn.textContent = 'Yes';
      }
    });
  }

  function showMatchFoundBanner(startSeconds, onTick) {
    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';
    content.innerHTML = '';
    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => { closeBanner(); };
    }

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '100%';
    card.style.height = '160px';
    card.style.padding = '18px 26px';
    card.style.borderRadius = '0';
    card.style.borderTop = '2px solid var(--CG-deep-gold)';
    card.style.borderBottom = '2px solid var(--CG-deep-gold)';
    card.style.background = 'var(--CG-deep-purple)';
    card.style.color = 'var(--CG-white)';
    card.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    card.style.textAlign = 'center';

    const title = document.createElement('div');
    let titleText = 'Match Found';
    if (currentMatch) {
      const finishedGames = Array.isArray(currentMatch?.games)
        ? currentMatch.games.filter(g => !g.isActive).length
        : 0;
      if (finishedGames > 0) {
        titleText = `Game ${finishedGames + 1}`;
      }
    }
    title.textContent = titleText;
    title.style.fontSize = '32px';
    title.style.fontWeight = '800';
    title.style.marginBottom = '10px';

    const countEl = document.createElement('div');
    countEl.style.fontSize = '80px';
    countEl.style.fontWeight = '900';
    countEl.style.lineHeight = '1';
    countEl.id = 'matchFoundCount';

    card.appendChild(title);
    card.appendChild(countEl);
    content.appendChild(card);

    function closeBanner() {
      if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
      content.innerHTML = '';
      overlay.hide();
    }

    let remaining = startSeconds;
    countEl.textContent = String(remaining);
    overlay.show({ initialFocus: closeButton && !closeButton.hidden ? closeButton : null });

    if (bannerInterval) clearInterval(bannerInterval);
    bannerInterval = setInterval(() => {
      remaining -= 1;
      if (typeof onTick === 'function') {
        try { onTick(remaining); } catch (_) {}
      }
      if (remaining < 0) {
        clearInterval(bannerInterval);
        bannerInterval = null;
        closeBanner();
        return;
      }
      countEl.textContent = remaining === 0 ? 'Go!' : String(remaining);
    }, 1000);
  }

  function createScoreboard(match) {
    const formatId = (value) => {
      if (!value) return null;
      if (typeof value === 'string') return value;
      if (typeof value === 'object') {
        if (typeof value.toString === 'function') {
          const str = value.toString();
          if (str !== '[object Object]') return str;
        }
        if (value._id) return formatId(value._id);
      }
      return null;
    };

    const p1Name = formatPlayerName(match?.player1?.username, 0);
    const p2Name = formatPlayerName(match?.player2?.username, 1);
    const p1Score = Number(match?.player1Score || 0);
    const p2Score = Number(match?.player2Score || 0);
    const finishedGames = Array.isArray(match?.games)
      ? match.games.filter(g => !g.isActive).length
      : 0;
    const draws = Math.max(0, finishedGames - p1Score - p2Score);
    const isRanked = match?.type === 'RANKED';

    const player1Id = formatId(match?.player1);
    const player2Id = formatId(match?.player2);
    const winnerId = formatId(match?.winner);

    const player1StartElo = isRanked && Number.isFinite(match?.player1StartElo) ? match.player1StartElo : null;
    const player2StartElo = isRanked && Number.isFinite(match?.player2StartElo) ? match.player2StartElo : null;
    const player1EndElo = isRanked && Number.isFinite(match?.player1EndElo) ? match.player1EndElo : player1StartElo;
    const player2EndElo = isRanked && Number.isFinite(match?.player2EndElo) ? match.player2EndElo : player2StartElo;
    const player1Delta = (player1StartElo !== null && player1EndElo !== null)
      ? Math.round(player1EndElo - player1StartElo)
      : null;
    const player2Delta = (player2StartElo !== null && player2EndElo !== null)
      ? Math.round(player2EndElo - player2StartElo)
      : null;

    let player1Status = 'draw';
    let player2Status = 'draw';
    if (winnerId && player1Id && player2Id) {
      if (winnerId === player1Id) {
        player1Status = 'winner';
        player2Status = 'loser';
      } else if (winnerId === player2Id) {
        player1Status = 'loser';
        player2Status = 'winner';
      }
    } else if (p1Score !== p2Score) {
      if (p1Score > p2Score) {
        player1Status = 'winner';
        player2Status = 'loser';
      } else {
        player1Status = 'loser';
        player2Status = 'winner';
      }
    }

    const createScoreCell = ({ score, status, delta }) => {
      const cell = document.createElement('div');
      cell.style.display = 'flex';
      cell.style.alignItems = 'center';
      cell.style.justifyContent = 'center';
      cell.style.gap = '6px';

      const iconSize = 26;
      if (status === 'winner') {
        const icon = createThroneIcon({ size: iconSize, alt: 'Match winner' });
        cell.appendChild(icon);
      } else if (status === 'loser') {
        const daggerGroup = createDaggerCounter({
          count: 1,
          size: iconSize,
          gap: 0,
          alt: 'Match loss'
        });
        cell.appendChild(daggerGroup);
      }

      const scoreSpan = document.createElement('span');
      scoreSpan.textContent = String(score);
      scoreSpan.style.fontWeight = '700';
      cell.appendChild(scoreSpan);

      if (isRanked && delta !== null) {
        const change = document.createElement('span');
        const sign = delta >= 0 ? '+' : '';
        change.textContent = `(${sign}${delta})`;
        change.style.fontWeight = '700';
        change.style.marginLeft = '2px';
        if (status === 'winner') {
          change.style.color = '#34d399';
        } else if (status === 'loser') {
          change.style.color = '#f87171';
        } else {
          change.style.color = 'var(--CG-white)';
        }
        cell.appendChild(change);
      }

      return cell;
    };

    const container = document.createElement('div');
    container.style.display = 'grid';
    container.style.gridTemplateColumns = '1fr 80px 1fr';
    container.style.gap = '4px 0';
    container.style.marginTop = '10px';

    const name1 = document.createElement('div');
    name1.textContent = p1Name;
    name1.style.textAlign = 'center';
    const drawsLabel = document.createElement('div');
    drawsLabel.textContent = 'Draws';
    drawsLabel.style.textAlign = 'center';
    const name2 = document.createElement('div');
    name2.textContent = p2Name;
    name2.style.textAlign = 'center';

    const score1 = createScoreCell({ score: p1Score, status: player1Status, delta: player1Delta });
    const drawCount = document.createElement('div');
    drawCount.textContent = draws;
    drawCount.style.textAlign = 'center';
    const score2 = createScoreCell({ score: p2Score, status: player2Status, delta: player2Delta });

    container.append(name1, drawsLabel, name2, score1, drawCount, score2);
    return container;
  }

  function showGameFinishedBanner({ winnerName, loserName, winnerColor, didWin, match, winReason, players = [] }) {
    currentMatch = match;
    if (match?._id) {
      activeMatchId = String(match._id);
    }
    applyExpectedTimeSettingsForMatch(currentMatch);
    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    dialog.style.alignItems = 'flex-end';
    dialog.style.justifyContent = 'center';
    content.innerHTML = '';
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    let summaryTimeout = null;
    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => {
        if (summaryTimeout) { clearTimeout(summaryTimeout); summaryTimeout = null; }
        content.innerHTML = '';
        overlay.hide();
        setBannerKeyListener(null);
      };
    }
    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '100%';
    card.style.height = '160px';
    card.style.transform = 'translateY(-15%)';
    card.style.padding = '18px 26px';
    card.style.borderRadius = '0';
    card.style.borderTop = '2px solid var(--CG-deep-gold)';
    card.style.borderBottom = '2px solid var(--CG-deep-gold)';
    const isDraw = winnerColor !== 0 && winnerColor !== 1;
    card.style.background = isDraw ? 'var(--CG-gray)' : (didWin ? 'var(--CG-dark-red)' : 'var(--CG-black)');
    card.style.color = 'var(--CG-white)';
    card.style.boxShadow = '0 10px 30px var(--CG-black)';
    card.style.textAlign = 'center';
    card.style.position = 'relative';

    const title = document.createElement('div');
    title.textContent = isDraw ? 'Draw' : (didWin ? 'Victory' : 'Defeat');
    title.style.fontSize = '32px';
    title.style.fontWeight = '800';
    title.style.marginBottom = '10px';

    const desc = document.createElement('div');
    const colorStr = winnerColor === 0 ? 'White' : 'Black';
    const reason = Number(winReason);
    const hasNextGame = Array.isArray(match?.games)
      ? match.games.some(g => g && g.isActive)
      : false;
    let descText;
    if (isDraw || reason === WIN_REASONS.DRAW) {
      const whiteName = playerNames[0] || formatPlayerName(null, 0);
      const blackName = playerNames[1] || formatPlayerName(null, 1);
      descText = `${whiteName} and ${blackName} agreed to a draw.`;
    } else {
      switch (reason) {
        case 0:
          descText = `${winnerName} (${colorStr}) won by capturing ${loserName}'s king.`;
          break;
        case 1:
          descText = `${winnerName} (${colorStr}) won by advancing their king to the final rank.`;
          break;
        case 2:
          descText = `${winnerName} (${colorStr}) won because ${loserName} challenged the true king.`;
          break;
        case 3:
          descText = `${winnerName} (${colorStr}) won because ${loserName} accumulated 3 dagger tokens.`;
          break;
        case 4:
          descText = `${winnerName} (${colorStr}) won because ${loserName} ran out of time.`;
          break;
        case 5:
          descText = `${winnerName} (${colorStr}) won because ${loserName} disconnected.`;
          break;
        case 6:
          descText = `${winnerName} (${colorStr}) won by resignation.`;
          break;
        default:
          descText = `${winnerName} (${colorStr}) won.`;
      }
    }
    desc.textContent = descText;
    desc.style.fontSize = '20px';
    desc.style.fontWeight = '500';
    desc.id = 'gameOverDesc';

    const btn = document.createElement('button');
    btn.textContent = 'Next';
    btn.style.position = 'absolute';
    btn.style.bottom = '10px';
    btn.style.left = '50%';
    btn.style.transform = 'translateX(-50%)';
    btn.style.background = 'var(--CG-purple)';
    btn.style.color = 'var(--CG-white)';
    btn.style.border = '2px solid #fbbf24';
    btn.style.borderRadius = '6px';
    btn.style.padding = '10px 22px';
    btn.style.fontSize = '18px';
    btn.style.cursor = 'pointer';
    btn.id = 'gameOverNextBtn';
    btn.addEventListener('click', async () => {
      if (summaryTimeout) {
        clearTimeout(summaryTimeout);
        summaryTimeout = null;
      }
      const nextGame = Array.isArray(match?.games) ? match.games.find(g => g && g.isActive) : null;
      if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
      if (nextGame) {
        try {
          await apiNext(nextGame._id, 1 - myColor);
          desc.textContent = 'Waiting for other player...';
          btn.style.display = 'none';
        } catch (e) { console.error('Failed to queue next game', e); }
      } else {
        showMatchSummary(match);
      }
    });

    if (!hasNextGame) {
      summaryTimeout = setTimeout(() => {
        try {
          const currentId = currentMatch?._id ? String(currentMatch._id) : null;
          const incomingId = match?._id ? String(match._id) : null;
          if (incomingId && currentId && incomingId !== currentId) {
            return;
          }
          showMatchSummary(match);
        } catch (err) {
          console.error('Failed to auto show match summary', err);
        }
      }, 4000);
    }

    setBannerKeyListener(ev => {
      const key = ev.key;
      if (key === 'Enter' || key === ' ' || key === 'Space' || key === 'Spacebar' || ev.code === 'Space') {
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || btn.disabled) return false;
        ev.preventDefault();
        btn.click();
        return true;
      }
      return false;
    });

    card.appendChild(title);
    card.appendChild(desc);
    card.appendChild(btn);
    content.appendChild(card);
    overlay.show({ initialFocus: btn });
  }

  function showMatchSummary(match) {
    currentMatch = match;
    if (match?._id) {
      activeMatchId = String(match._id);
    }
    applyExpectedTimeSettingsForMatch(currentMatch);
    const refreshedElos = syncPlayerElosFromMatch(match);
    if (refreshedElos) {
      renderBoardAndBars();
    }
    connectionStatusByPlayer.clear();
    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';
    content.innerHTML = '';
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => {
        content.innerHTML = '';
        overlay.hide();
        setBannerKeyListener(null);
        returnToLobby();
      };
    }
    const card = document.createElement('div');
    card.style.padding = '20px 30px';
    card.style.border = '2px solid var(--CG-deep-gold)';
    card.style.borderRadius = '0';
    card.style.background = 'var(--CG-deep-purple)';
    card.style.color = 'var(--CG-white)';
    card.style.textAlign = 'center';
    card.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';

    const title = document.createElement('div');
    title.textContent = 'Match Complete';
    title.style.fontSize = '32px';
    title.style.fontWeight = '800';
    title.style.marginBottom = '10px';

    const score = createScoreboard(match);

    const btn = document.createElement('button');
    btn.textContent = 'Back to Lobby';
    btn.style.marginTop = '15px';
    btn.style.background = 'var(--CG-dark-red)';
    btn.style.color = 'var(--CG-white)';
    btn.style.fontWeight = '700';
    btn.style.border = '2px solid var(--CG-deep-gold)';
    btn.style.borderRadius = '0';
    btn.style.padding = '6px 12px';
    btn.style.fontSize = '16px';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => { returnToLobby(); });

    setBannerKeyListener(ev => {
      const key = ev.key;
      if (key === 'Enter' || key === ' ' || key === 'Space' || key === 'Spacebar' || ev.code === 'Space') {
        const style = window.getComputedStyle(btn);
        if (style.display === 'none' || btn.disabled) return false;
        ev.preventDefault();
        btn.click();
        return true;
      }
      return false;
    });

    card.appendChild(title);
    card.appendChild(score);
    card.appendChild(btn);
    content.appendChild(card);
    overlay.show({ initialFocus: btn });
  }

  // ------- PlayArea & Board & Bars -------
  function ensurePlayAreaRoot() {
    if (playAreaRoot) return playAreaRoot;
    playAreaRoot = document.createElement('div');
    playAreaRoot.id = 'playAreaRoot';
    playAreaRoot.style.position = 'fixed';
    playAreaRoot.style.display = 'none';
    playAreaRoot.style.zIndex = '1000';
    // Prevent text selection/highlighting inside the play area
    playAreaRoot.style.userSelect = 'none';
    // Prevent browser gestures/scroll during touch interactions in the play area
    playAreaRoot.style.touchAction = 'none';
    try {
      document.body.style.touchAction = 'none';
      document.body.style.overscrollBehavior = 'contain';
    } catch (_) {}
    document.body.appendChild(playAreaRoot);

    // Global click/tap outside interactive zones should clear selection (setup and in-game)
    const clearSelectionIfAny = (ev) => {
      try {
        if (dragging) return;
        const t = ev && ev.target;
        // If the click/tap is inside any interactive zone, don't clear; handlers there manage selection
        if ((boardRoot && boardRoot.contains(t)) || (stashRoot && stashRoot.contains(t)) ||
            (topBar && topBar.contains(t)) || (bottomBar && bottomBar.contains(t))) {
          return;
        }
        if (selected) { selected = null; renderBoardAndBars(); }
      } catch (_) {
        if (selected) { selected = null; renderBoardAndBars(); }
      }
    };
    playAreaRoot.addEventListener('mousedown', clearSelectionIfAny, false);
    playAreaRoot.addEventListener('touchstart', clearSelectionIfAny, { passive: true });
    // Suppress synthetic clicks after touch/drag
    document.addEventListener('click', (ev) => {
      const now = Date.now();
      const suppress = (now < suppressMouseUntil) || !!dragging;
      // Do NOT suppress clicks on non-preview bubble overlays (choice or post-move)
      const t = ev.target;
      const isBubbleOverlay = t && t.closest && t.closest('img[data-bubble]:not([data-preview])');
      if (suppress && !isBubbleOverlay) { try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {} }
    }, true);

    // Removed global diagnostic click logger now that bubble click handling works

    boardRoot = document.createElement('div');
    boardRoot.id = 'playAreaBoard';
    boardRoot.style.position = 'absolute';
    playAreaRoot.appendChild(boardRoot);

    topBar = document.createElement('div');
    topBar.id = 'playAreaTopBar';
    topBar.style.position = 'absolute';
    playAreaRoot.appendChild(topBar);

    bottomBar = document.createElement('div');
    bottomBar.id = 'playAreaBottomBar';
    bottomBar.style.position = 'absolute';
    playAreaRoot.appendChild(bottomBar);

    // Stash area container
    stashRoot = document.createElement('div');
    stashRoot.id = 'playAreaStash';
    stashRoot.style.position = 'absolute';
    playAreaRoot.appendChild(stashRoot);

    window.addEventListener('resize', layoutPlayArea);
    return playAreaRoot;
  }

  function layoutPlayArea() {
    if (!playAreaRoot) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { left, top, width, height } = computePlayAreaBounds(vw, vh);
    Object.assign(playAreaRoot.style, {
      left: left + 'px',
      top: top + 'px',
      width: width + 'px',
      height: height + 'px',
      border: 'none',
      background: 'transparent',
      boxSizing: 'border-box'
    });
    renderBoardAndBars();
  }

  function showPlayArea() {
    ensurePlayAreaRoot();
    layoutPlayArea();
    if (isPlayAreaVisible) return;
    isPlayAreaVisible = true;
    playAreaRoot.style.display = 'block';
  }

  function hideQueuer() {
    if (queuerHidden) return;
    const queuer = document.querySelector('.queuer');
    if (queuer) {
      queuer.style.display = 'none';
      queuerHidden = true;
    }
  }

  function showQueuer() {
    if (!queuerHidden) return;
    const queuer = document.querySelector('.queuer');
    if (queuer) {
      queuer.style.display = 'flex';
      queuerHidden = false;
    }
  }

  function hidePlayArea() {
    if (!isPlayAreaVisible) return;
    if (playAreaRoot) playAreaRoot.style.display = 'none';
    isPlayAreaVisible = false;
  }

  function returnToLobby() {
    hidePlayArea();
    showQueuer();
    setBannerKeyListener(null);
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    if (bannerOverlay) {
      bannerOverlay.content.innerHTML = '';
      bannerOverlay.hide({ restoreFocus: false });
    }
    queuedState.quickplay = false;
    queuedState.ranked = false;
    pendingAction = null;
    queueStatusKnown = true;
    stopClockInterval();
    gameFinished = false;
    updateFindButton();
    currentMatch = null;
    applyExpectedTimeSettingsForMatch(null);
    activeMatchId = null;
    connectionStatusByPlayer.clear();
    currentDrawOffer = null;
    drawOfferCooldowns = [null, null];
    clearDrawCooldownTimeout();
  }

  function renderBoardAndBars() {
    if (!playAreaRoot || !boardRoot || !currentRows || !currentCols) return;
    // Reset interactive refs each render
    refs.bottomCells = [];
    refs.stashSlots = [];
    refs.deckEl = null;
    const { squareSize: s, boardWidth: bW, boardHeight: bH, boardLeft: leftPx, boardTop: topPx } = computeBoardMetrics(
      playAreaRoot.clientWidth,
      playAreaRoot.clientHeight,
      currentCols,
      currentRows
    );
    currentSquareSize = s;
    // Label font scales with play area height for consistency
    const labelFont = Math.max(10, Math.floor(0.024 * playAreaRoot.clientHeight));
    const fileLetters = ['A','B','C','D','E'];

    // Use modular board renderer
    renderBoard({
      container: boardRoot,
      sizes: {
        rows: currentRows,
        cols: currentCols,
        squareSize: s,
        boardLeft: leftPx,
        boardTop: topPx
      },
      state: {
        currentBoard,
        currentIsWhite,
        selected,
        isInSetup,
        workingRank,
        pendingCapture,
        pendingMoveFrom,
        challengeRemoved
      },
      refs,
      identityMap: PIECE_IMAGES,
      onAttachHandlers: (cell, target) => attachInteractiveHandlers(cell, target),
      onAttachGameHandlers: (cell, r, c) => attachGameHandlers(cell, r, c),
      labelFont,
      fileLetters
    });

    // Determine whether to show challenge bubbles on player bars
    const topColor = currentIsWhite ? 1 : 0;
    const bottomColor = currentIsWhite ? 0 : 1;
    let showChallengeTop = false;
    let showChallengeBottom = false;
    if (lastAction && lastAction.type === ACTIONS.CHALLENGE) {
      if (lastAction.player === topColor) showChallengeTop = true;
      if (lastAction.player === bottomColor) showChallengeBottom = true;
    }

    // Use modular bars and stash renderers
    const topClr = currentIsWhite ? 1 : 0;
    const bottomClr = currentIsWhite ? 0 : 1;
    const topMs = getDisplayClockMsForColor(topClr);
    const bottomMs = getDisplayClockMsForColor(bottomClr);
    const clockLabel = getClockLabel();
    const topIdx = currentIsWhite ? 1 : 0;
    const bottomIdx = currentIsWhite ? 0 : 1;
    const isRankedMatch = currentMatch && currentMatch.type === 'RANKED';
    const p1Score = currentMatch?.player1Score || 0;
    const p2Score = currentMatch?.player2Score || 0;
    let winsTop = 0;
    let winsBottom = 0;
    if (isRankedMatch) {
      const toIdString = (value) => {
        if (!value) return '';
        if (typeof value === 'string' || typeof value === 'number') {
          return String(value);
        }
        if (typeof value === 'object') {
          if (value._id !== undefined) {
            return toIdString(value._id);
          }
          if (typeof value.toHexString === 'function') {
            return value.toHexString();
          }
          if (typeof value.toString === 'function') {
            const str = value.toString();
            return str === '[object Object]' ? '' : str;
          }
        }
        return '';
      };

      const matchPlayer1IdStr = toIdString(currentMatch?.player1?._id ?? currentMatch?.player1);
      const matchPlayer2IdStr = toIdString(currentMatch?.player2?._id ?? currentMatch?.player2);
      const resolveWins = (playerId) => {
        const idStr = toIdString(playerId);
        if (!idStr) return 0;
        if (matchPlayer1IdStr && idStr === matchPlayer1IdStr) return p1Score;
        if (matchPlayer2IdStr && idStr === matchPlayer2IdStr) return p2Score;
        return 0;
      };

      winsTop = resolveWins(currentPlayerIds?.[topIdx]);
      winsBottom = resolveWins(currentPlayerIds?.[bottomIdx]);
    }
    const topPlayerId = currentPlayerIds[topIdx];
    const bottomPlayerId = currentPlayerIds[bottomIdx];
    const connectionTop = getConnectionDisplayForPlayer(topPlayerId, topPlayerId && topPlayerId !== userId);
    const connectionBottom = getConnectionDisplayForPlayer(bottomPlayerId, bottomPlayerId && bottomPlayerId !== userId);
    const eloTop = playerElos[topIdx];
    const eloBottom = playerElos[bottomIdx];
    const bars = renderBarsModule({
      topBar,
      bottomBar,
      sizes: {
        squareSize: s,
        boardWidth: bW,
        boardHeight: bH,
        boardLeft: leftPx,
        boardTop: topPx,
        playAreaHeight: playAreaRoot.clientHeight
      },
      state: {
        currentIsWhite,
        currentCaptured,
        currentDaggers,
        showChallengeTop,
        showChallengeBottom,
        clockTop: formatClock(topMs),
        clockBottom: formatClock(bottomMs),
        clockLabel,
        nameTop: playerNames[topIdx] || ('Anonymous' + topIdx),
        nameBottom: playerNames[bottomIdx] || ('Anonymous' + bottomIdx),
        winsTop,
        winsBottom,
        connectionTop,
        connectionBottom,
        isRankedMatch,
        eloTop,
        eloBottom
      },
      identityMap: PIECE_IMAGES
    });
    topClockEl = bars.topClockEl;
    bottomClockEl = bars.bottomClockEl;
    updateClockDisplay();

    renderDrawOfferPrompt();

    renderStashModule({
      container: stashRoot,
      sizes: {
        squareSize: s,
        boardWidth: bW,
        boardHeight: bH,
        boardLeft: leftPx,
        boardTop: topPx,
        playAreaHeight: playAreaRoot.clientHeight
      },
      state: {
        currentIsWhite,
        isInSetup,
        workingStash,
        workingOnDeck,
        currentStashes,
        currentOnDecks,
        currentOnDeckingPlayer,
        selected,
        dragging,
        gameFinished
      },
      refs,
      identityMap: PIECE_IMAGES,
      onAttachHandlers: (el, target) => attachInteractiveHandlers(el, target)
    });

    // Challenge and Bomb buttons anchored to the stash area
    (function renderStashButtons() {
      const children = Array.from(stashRoot.children || []);
      if (children.length === 0) {
        renderGameButton({ id: 'challengeBtn', visible: false });
        renderGameButton({ id: 'bombBtn', visible: false });
        renderGameButton({ id: 'passBtn', visible: false });
        renderGameButton({ id: 'resignBtn', visible: false });
        renderGameButton({ id: 'drawBtn', visible: false });
        return;
      }

      let minLeft = Infinity;
      let minTop = Infinity;
      let maxRight = 0;
      let maxBottom = 0;
      children.forEach(function(child) {
        const l = parseInt(child.style.left, 10) || 0;
        const t = parseInt(child.style.top, 10) || 0;
        const w = (parseInt(child.style.width, 10) || child.offsetWidth || 0);
        const h = (parseInt(child.style.height, 10) || child.offsetHeight || 0);
        if (l < minLeft) minLeft = l;
        if (t < minTop) minTop = t;
        if (l + w > maxRight) maxRight = l + w;
        if (t + h > maxBottom) maxBottom = t + h;
      });

      const stashLeft = minLeft;
      const stashTop = minTop;
      const stashWidth = maxRight - minLeft;
      const stashBottom = maxBottom;
      const maxBtnW = Math.floor(stashWidth * 0.4);
      const btnW = Math.min(160, maxBtnW);
      const btnH = Math.floor(btnW * 0.6);
      const isMyTurn = currentPlayerTurn === myColor && !isInSetup;
      let canChallenge = false;
      let canBomb = false;
      let canPass = false;
      const bothSetupDone = setupComplete && setupComplete.length >= 2 && Boolean(setupComplete[0]) && Boolean(setupComplete[1]);
      const selfIdx = currentIsWhite ? 0 : 1;
      const now = Date.now();
      const cooldownUntil = Array.isArray(drawOfferCooldowns) ? drawOfferCooldowns[selfIdx] : null;
      const cooldownActive = Number.isFinite(cooldownUntil) && cooldownUntil > now;
      const hasPendingDrawOffer = Boolean(currentDrawOffer && currentDrawOffer.player !== undefined && currentDrawOffer.player !== null);
      if (isMyTurn && lastAction) {
        if (lastAction.type === ACTIONS.MOVE) {
          if (lastMove && lastMove.state === MOVE_STATES.PENDING && lastMove.player !== myColor) {
            canChallenge = true;
            if (
              pendingCapture &&
              pendingCapture.piece &&
              pendingCapture.piece.color === myColor &&
              lastMove.declaration !== Declaration.KING
            ) {
              canBomb = true;
            }
          }
        } else if (lastAction.type === ACTIONS.BOMB) {
          if (lastAction.player !== myColor && lastMove && lastMove.state === MOVE_STATES.PENDING) {
            canChallenge = true;
            canPass = true;
          }
        }
      }

      // Bomb button (upper left)
      renderGameButton({
        id: 'bombBtn',
        root: playAreaRoot,
        boardLeft: stashLeft + btnW / 2,
        boardTop: stashTop + btnH / 2,
        boardWidth: 0,
        boardHeight: 0,
        text: 'Bomb!',
        variant: 'danger',
        visible: canBomb,
        onClick: () => {
          if (!lastGameId) return;
          applyLocalMoveClock();
          apiBomb(lastGameId, myColor).catch(err => console.error('Bomb failed', err));
        },
        width: btnW,
        height: btnH
      });

      // Pass button (uses challenge styling, upper left)
      renderGameButton({
        id: 'passBtn',
        root: playAreaRoot,
        boardLeft: stashLeft + btnW / 2,
        boardTop: stashTop + btnH / 2,
        boardWidth: 0,
        boardHeight: 0,
        text: 'Pass',
        variant: 'primary',
        visible: canPass,
        onClick: () => {
          if (!lastGameId) return;
          applyLocalMoveClock();
          apiPass(lastGameId, myColor).catch(err => console.error('Pass failed', err));
        },
        width: btnW,
        height: btnH
      });

      // Challenge button (upper right)
      renderGameButton({
        id: 'challengeBtn',
        root: playAreaRoot,
        boardLeft: stashLeft + stashWidth - btnW / 2,
        boardTop: stashTop + btnH / 2,
        boardWidth: 0,
        boardHeight: 0,
        text: 'Challenge',
        variant: 'primary',
        visible: canChallenge,
        onClick: () => {
          if (!lastGameId) return;
          applyLocalMoveClock();
          apiChallenge(lastGameId, myColor).catch(err => console.error('Challenge failed', err));
        },
        width: btnW,
        height: btnH
      });

      const deckEl = refs.deckEl;
      const fallbackDeckSize = Math.max(1, currentSquareSize || btnW);
      const deckWidth = deckEl ? (parseInt(deckEl.style.width, 10) || deckEl.offsetWidth || fallbackDeckSize) : fallbackDeckSize;
      const deckHeight = deckEl ? (parseInt(deckEl.style.height, 10) || deckEl.offsetHeight || fallbackDeckSize) : fallbackDeckSize;
      const deckLeft = deckEl
        ? (parseInt(deckEl.style.left, 10) || deckEl.offsetLeft || (stashLeft + stashWidth / 2 - deckWidth / 2))
        : (stashLeft + stashWidth / 2 - deckWidth / 2);
      const deckTop = deckEl ? (parseInt(deckEl.style.top, 10) || deckEl.offsetTop || stashTop) : stashTop;
      const deckCenterX = deckLeft + deckWidth / 2;
      const deckBottom = deckTop + deckHeight;
      const gapBelowDeck = Math.max(6, Math.round(deckHeight * 0.1));
      const resignTop = deckBottom + gapBelowDeck;
      const resignW = Math.max(1, Math.round(btnW * 0.65));
      const resignH = Math.max(1, Math.round(btnH * 0.5));
      const canResign = bothSetupDone && !isInSetup && !gameFinished && Boolean(lastGameId);
      const canOfferDraw = bothSetupDone && !isInSetup && !gameFinished && Boolean(lastGameId) && !hasPendingDrawOffer && !cooldownActive;

      renderGameButton({
        id: 'resignBtn',
        root: playAreaRoot,
        boardLeft: deckCenterX,
        boardTop: resignTop + resignH / 2,
        boardWidth: 0,
        boardHeight: 0,
        text: 'Resign',
        variant: 'dark',
        visible: canResign,
        onClick: () => {
          if (!canResign) return;
          showResignConfirm();
        },
        width: resignW,
        height: resignH
      });

      const drawGap = Math.max(4, Math.round(resignH * 0.25));
      const drawTop = resignTop + resignH + drawGap;

      renderGameButton({
        id: 'drawBtn',
        root: playAreaRoot,
        boardLeft: deckCenterX,
        boardTop: drawTop + resignH / 2,
        boardWidth: 0,
        boardHeight: 0,
        text: 'Draw',
        variant: 'neutral',
        visible: canOfferDraw,
        onClick: () => {
          if (!canOfferDraw) return;
          showDrawConfirm();
        },
        width: resignW,
        height: resignH
      });
    })();

    // After board render, apply any pending move overlay bubbles
    if (!isInSetup && postMoveOverlay && refs.boardCells) {
      const cellRef = refs.boardCells?.[postMoveOverlay.uiR]?.[postMoveOverlay.uiC];
      if (cellRef && cellRef.el) {
        Array.from(cellRef.el.querySelectorAll('img[data-bubble]')).forEach(function(n){ try { n.remove(); } catch(_) {} });
        const interactive = !!postMoveOverlay.interactive;
        for (const t of postMoveOverlay.types) {
          const img = makeBubbleImg(t, currentSquareSize);
          if (!img) continue;
          try { cellRef.el.style.position = 'relative'; } catch(_) {}
          img.style.zIndex = '1001';
          if (interactive) {
            img.style.pointerEvents = 'auto';
            img.style.cursor = 'pointer';
            img.addEventListener('click', function(ev){
              try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
              const decl = t.includes('king') ? Declaration.KING : (t.includes('bishop') ? Declaration.BISHOP : (t.includes('rook') ? Declaration.ROOK : Declaration.KNIGHT));
              commitMoveFromOverlay(decl, { originUI: lastChoiceOrigin, destUI: { uiR: postMoveOverlay.uiR, uiC: postMoveOverlay.uiC } });
            });
          } else {
            img.style.pointerEvents = 'none';
          }
          cellRef.el.appendChild(img);
        }
      }
    }

    const readyVisible = (isInSetup && isSetupCompletable());
    const randomVisible = (isInSetup && !readyVisible);

    // Ready button overlay when setup is completable
    renderReadyButton({
      root: playAreaRoot,
      boardLeft: leftPx,
      boardTop: topPx,
      boardWidth: bW,
      boardHeight: bH,
      isVisible: readyVisible,
      onClick: async () => {
        try {
          const payload = buildSetupPayload();
          console.log('[client] POST /api/v1/gameAction/setup ->', payload);
          const res = await apiSetup(payload);
          const json = await res.json().catch(() => ({}));
          console.log('[client] setup response', res.status, json);
          if (!res.ok) return alert(json?.message || 'Setup failed');
          // Lock interactions; server will broadcast update
          setupComplete[myColor] = true;
          isInSetup = false;
          selected = null; dragging = null;
          renderBoardAndBars();
        } catch (e) { console.error('setup error', e); }
      }
    });

    // Random Setup button (deep red) visible when Ready is not
    renderGameButton({
      id: 'randomSetupBtn',
      root: playAreaRoot,
      boardLeft: leftPx,
      boardTop: topPx,
      boardWidth: bW,
      boardHeight: bH,
      text: 'Random Setup',
      variant: 'danger',
      visible: randomVisible,
      onClick: () => {
        const result = randomizeSetup({
          workingRank,
          workingOnDeck,
          workingStash,
          myColor
        });
        // Adopt the returned references (arrays mutated; deck returned as value)
        workingOnDeck = result.workingOnDeck;
        // Render; if illegal (ok=false), button will remain (Ready not visible)
        renderBoardAndBars();
      }
    });
  }

  function renderDrawOfferPrompt() {
    if (!topBar) return;
    if (gameFinished) return;
    const offer = currentDrawOffer;
    if (!offer || offer.player === undefined || offer.player === null) return;
    const selfIdx = currentIsWhite ? 0 : 1;
    if (offer.player === selfIdx) return;
    if (!lastGameId) return;

    const overlay = document.createElement('div');
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100%';
    overlay.style.height = '100%';
    overlay.style.background = 'rgba(0, 0, 0, 0.78)';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '25';
    overlay.style.boxSizing = 'border-box';
    overlay.style.border = '2px solid var(--CG-deep-gold)';

    const barHeight = topBar.clientHeight || parseInt(topBar.style.height, 10) || 0;
    const barWidth = topBar.clientWidth || parseInt(topBar.style.width, 10) || 0;
    const sizeRef = barHeight || Math.min(barWidth, 260) || 0;
    const scale = clamp(sizeRef ? sizeRef / 90 : 1, 0.6, 1);
    const overlayPadding = clamp(Math.round(12 * scale), 6, 12);
    const overlayGap = clamp(Math.round(12 * scale), 6, 12);
    overlay.style.padding = overlayPadding + 'px';
    overlay.style.gap = overlayGap + 'px';

    const text = document.createElement('div');
    text.textContent = 'Accept Draw?';
    text.style.fontSize = clamp(Math.round(20 * scale), 13, 20) + 'px';
    text.style.fontWeight = '700';
    text.style.color = 'var(--CG-white)';

    const buttonRow = document.createElement('div');
    buttonRow.style.display = 'flex';
    const buttonGap = clamp(Math.round(10 * scale), 6, 10);
    buttonRow.style.gap = buttonGap + 'px';
    buttonRow.style.flexWrap = 'wrap';
    buttonRow.style.justifyContent = 'center';

    const acceptBtn = document.createElement('button');
    acceptBtn.textContent = 'Accept';
    acceptBtn.style.background = 'var(--CG-forest)';
    acceptBtn.style.color = 'var(--CG-white)';
    acceptBtn.style.border = '2px solid var(--CG-deep-gold)';
    const btnPadY = clamp(Math.round(8 * scale), 4, 8);
    const btnPadX = clamp(Math.round(18 * scale), 8, 18);
    const btnFontSize = clamp(Math.round(16 * scale), 11, 16);
    acceptBtn.style.padding = `${btnPadY}px ${btnPadX}px`;
    acceptBtn.style.fontSize = btnFontSize + 'px';
    acceptBtn.style.fontWeight = '700';
    acceptBtn.style.cursor = 'pointer';

    const declineBtn = document.createElement('button');
    declineBtn.textContent = 'Decline';
    declineBtn.style.background = 'var(--CG-dark-red)';
    declineBtn.style.color = 'var(--CG-white)';
    declineBtn.style.border = '2px solid var(--CG-deep-gold)';
    declineBtn.style.padding = `${btnPadY}px ${btnPadX}px`;
    declineBtn.style.fontSize = btnFontSize + 'px';
    declineBtn.style.fontWeight = '700';
    declineBtn.style.cursor = 'pointer';

    buttonRow.appendChild(acceptBtn);
    buttonRow.appendChild(declineBtn);
    overlay.appendChild(text);
    overlay.appendChild(buttonRow);
    topBar.appendChild(overlay);

    const handleDecision = async (decision) => {
      if (!lastGameId) return;
      const targetBtn = decision === 'accept' ? acceptBtn : declineBtn;
      const otherBtn = decision === 'accept' ? declineBtn : acceptBtn;
      const originalText = targetBtn.textContent;
      targetBtn.disabled = true;
      otherBtn.disabled = true;
      targetBtn.style.opacity = '0.7';
      otherBtn.style.opacity = '0.7';
      targetBtn.textContent = decision === 'accept' ? 'Accepting…' : 'Declining…';
      try {
        const res = await apiDraw(lastGameId, myColor, decision);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.message || 'Failed to submit draw response');
        }
      } catch (err) {
        console.error('Draw response failed', err);
        alert(err?.message || 'Failed to submit draw response');
        targetBtn.disabled = false;
        otherBtn.disabled = false;
        targetBtn.style.opacity = '1';
        otherBtn.style.opacity = '1';
        targetBtn.textContent = originalText;
      }
    };

    acceptBtn.addEventListener('click', () => handleDecision('accept'));
    declineBtn.addEventListener('click', () => handleDecision('decline'));
  }

  function renderBars(s, bW, bH, leftPx, topPx) {
    if (!topBar || !bottomBar) return;
    const H = playAreaRoot.clientHeight;

    // Tightened vertical gap and proportional sizing
    const gap = 6;
    const topGap = 10;   // pixels between top bar and board
    const bottomGap = 2; // bring the bottom bar closer to the board

    // Size bars as percent of play-area height (consistent across resize)
    const nameBarH = Math.max(18, Math.floor(0.045 * H));
    const rowH = Math.max(16, Math.floor(0.040 * H));
    const contH = nameBarH + rowH + gap;

    // Target anchors as percent, then clamp to avoid overlap with the board
    const desiredTopTop = Math.floor(0.05 * H);
    let topBarTop = Math.min(desiredTopTop, topPx - topGap - contH);
    topBarTop = Math.max(0, topBarTop);

    const boardBottom = topPx + bH;
    let bottomBarTop = boardBottom + bottomGap; // tight to board
    if (bottomBarTop + contH > H) {
      bottomBarTop = Math.max(0, H - contH);
    }

    // Font sizes anchored to play-area height (consistent percent feel)
    const nameFont = Math.max(14, Math.floor(0.030 * H));
    const clockFont = Math.max(12, Math.floor(0.026 * H));
    const iconFont = Math.max(12, Math.floor(0.024 * H));

    // Top (opponent)
    topBar.style.left = leftPx + 'px';
    topBar.style.top = topBarTop + 'px';
    topBar.style.width = bW + 'px';
    topBar.style.height = contH + 'px';
    topBar.style.display = 'flex';
    topBar.style.flexDirection = 'column';
    topBar.style.gap = gap + 'px';

    // Bottom (self)
    bottomBar.style.left = leftPx + 'px';
    bottomBar.style.top = bottomBarTop + 'px';
    bottomBar.style.width = bW + 'px';
    bottomBar.style.height = contH + 'px';
    bottomBar.style.display = 'flex';
    bottomBar.style.flexDirection = 'column';
    bottomBar.style.gap = gap + 'px';

    function makeNameRow(text, alignRight) {
      const row = document.createElement('div');
      row.style.height = nameBarH + 'px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = alignRight ? 'flex-end' : 'flex-start';
      row.style.color = 'var(--CG-white)';
      row.style.fontSize = nameFont + 'px';
      row.style.fontWeight = 'bold';
      row.textContent = text;
      return row;
    }

    function makeClock(colorIsWhite) {
      const box = document.createElement('div');
      // 50% wider again (previous was 1.95 * rowH); now ~2.9 * rowH
      box.style.width = Math.floor(2.9 * rowH) + 'px';
      box.style.height = rowH + 'px';
      box.style.display = 'flex';
      box.style.alignItems = 'center';
      box.style.justifyContent = 'center';
      box.style.fontFamily = 'Courier New, monospace';
      box.style.fontWeight = 'bold';
      box.style.fontSize = clockFont + 'px';
      box.style.background = colorIsWhite ? 'var(--CG-white)' : 'var(--CG-black)';
      box.style.color = colorIsWhite ? 'var(--CG-black)' : 'var(--CG-white)';
      box.style.border = '2px solid var(--CG-deep-gold)';
      // no rounded corners
      box.style.borderRadius = '0px';
      box.textContent = '5:00';
      return box;
    }

    function makeDaggers(count) {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '6px';
      const n = Math.max(0, Number(count || 0));
      for (let i = 0; i < n; i++) {
        const token = document.createElement('div');
        // make tokens as tall as the clock row
        const sz = Math.floor(rowH);
        token.style.width = sz + 'px';
        token.style.height = sz + 'px';
        token.style.border = '2px solid var(--CG-white)';
        token.style.borderRadius = '50%';
        token.style.background = 'var(--CG-dark-red)';
        token.style.color = 'var(--CG-white)';
        token.style.display = 'flex';
        token.style.alignItems = 'center';
        token.style.justifyContent = 'center';
        token.style.fontWeight = 'bold';
        token.style.fontSize = iconFont + 'px';
        token.textContent = '⚔';
        wrap.appendChild(token);
      }
      return wrap;
    }

    function makeCapturedForColor(colorIdx) {
      const strip = document.createElement('div');
      strip.style.display = 'flex';
      strip.style.alignItems = 'center';
      strip.style.gap = '4px';
      const pieces = (currentCaptured?.[colorIdx] || []);
      pieces.forEach(piece => {
        const cap = Math.floor(0.365 * s); // ~36.5% of square
        const img = modulePieceGlyph(piece, cap, PIECE_IMAGES);
        if (img) {
          const wrap = document.createElement('div');
          wrap.style.width = cap + 'px';
          wrap.style.height = cap + 'px';
          wrap.style.display = 'flex';
          wrap.style.alignItems = 'center';
          wrap.style.justifyContent = 'center';
          wrap.appendChild(img);
          strip.appendChild(wrap);
        }
      });
      return strip;
    }

    function fillBar(barEl, isTopBar) {
      while (barEl.firstChild) barEl.removeChild(barEl.firstChild);
      const topIdx = currentIsWhite ? 1 : 0;
      const bottomIdx = currentIsWhite ? 0 : 1;
      const name = isTopBar
        ? (playerNames[topIdx] || ('Anonymous' + topIdx))
        : (playerNames[bottomIdx] || ('Anonymous' + bottomIdx));
      const nameRow = makeNameRow(name, isTopBar);
      const row = document.createElement('div');
      row.style.height = rowH + 'px';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'space-between';

      if (isTopBar) {
        const topColor = currentIsWhite ? 1 : 0;
        row.appendChild(makeCapturedForColor(topColor));
        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.alignItems = 'center';
        right.style.gap = '6px';
        right.appendChild(makeDaggers(currentDaggers?.[topColor] || 0));
        right.appendChild(makeClock(topColor === 0));
        row.appendChild(right);
        // Top: name first, then row
        barEl.appendChild(nameRow);
        barEl.appendChild(row);
      } else {
        const bottomColor = currentIsWhite ? 0 : 1;
        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '6px';
        left.appendChild(makeClock(bottomColor === 0));
        left.appendChild(makeDaggers(currentDaggers?.[bottomColor] || 0));
        row.appendChild(left);
        row.appendChild(makeCapturedForColor(bottomColor));
        // Bottom: lower the stats row slightly without moving the name
        const spacer = Math.max(4, Math.floor(0.012 * H));
        row.style.marginTop = spacer + 'px';
        nameRow.style.marginTop = (-spacer) + 'px';
        // Bottom: row first (tight-ish to board), then name underneath
        barEl.appendChild(row);
        barEl.appendChild(nameRow);
      }
    }

  }

  // Render staggered stash slots + on-deck below the bottom bar
  function renderStash(s, bW, bH, leftPx, topPx) {
    if (!stashRoot) return;
    const H = playAreaRoot.clientHeight;

    // Recompute bar metrics to place stash beneath bottom bar
    const gap = 6;
    const bottomGap = 2;
    const nameBarH = Math.max(18, Math.floor(0.045 * H));
    const rowH = Math.max(16, Math.floor(0.040 * H));
    const contH = nameBarH + rowH + gap;
    const boardBottom = topPx + bH;
    let bottomBarTop = boardBottom + bottomGap;
    if (bottomBarTop + contH > H) bottomBarTop = Math.max(0, H - contH);

    // Place stash block just under the bottom player's name bar
    const yStart = bottomBarTop + contH + 4;
    // Nudges: move top row up slightly; bottom row up twice that amount
    const verticalNudge = Math.max(2, Math.floor(0.04 * s));
    const yTop = yStart - verticalNudge;

    // Make stash slots the same size as board squares so pieces (90% of slot) match board piece size
    const slot = s;
    // Slight horizontal overlap (5%) to tighten spacing
    const overlapRatio = 0.05;
    const topSpace = -Math.round(overlapRatio * slot);
    const bottomSpace = -Math.round(overlapRatio * slot);

    // rows: top has 5, bottom has 4; bottom is offset by half the (slot + spacing)
    const topCols = 5;
    const bottomCols = 4;

    // Clear render
    while (stashRoot.firstChild) stashRoot.removeChild(stashRoot.firstChild);

    function makeSlot(x, y, isOnDeck, exactLeft, content) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      // on-deck uses full board-square size s; others use reduced slot size
      const w = isOnDeck ? s : slot;
      const h = isOnDeck ? s : slot;
      // For on-deck, if exactLeft is true, use x as the exact left edge; otherwise center over nominal slot
      const leftAdj = isOnDeck
        ? (exactLeft ? x : Math.round(x - (w - slot) / 2))
        : x;
      const topAdj = isOnDeck ? Math.round(y - (h - slot)) : y;      // bottom-align
      el.style.left = leftAdj + 'px';
      el.style.top = topAdj + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.boxSizing = 'border-box';
      el.style.border = isOnDeck ? '3px solid var(--CG-deep-gold)' : '0px solid transparent';
      el.style.background = isOnDeck ? 'var(--CG-indigo)' : 'transparent';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      if (content) el.appendChild(content);
      return el;
    }

    // Compute board center for stable centering
    const blockCenterX = leftPx + Math.floor(bW / 2);

    // Top row with exact-width layout to keep all gaps = space
    const widthsTop = [slot, slot, s, slot, slot];
    const topTotal = widthsTop.reduce((a, b) => a + b, 0) + (widthsTop.length - 1) * topSpace;
    let xCursor = Math.round(blockCenterX - topTotal / 2);
    const bottomColor = currentIsWhite ? 0 : 1;
    const stash = isInSetup
      ? workingStash
      : (Array.isArray(currentStashes?.[bottomColor]) ? currentStashes[bottomColor] : []);
    // Map UI slots (excluding center on-deck) to sequential stash pieces
    const uiToOrdinal = { 0: 0, 1: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7 };
    for (let i = 0; i < widthsTop.length; i++) {
      const isOnDeck = (i === 2);
      const ord = uiToOrdinal[i];
      let content = null;
      if (isOnDeck) {
        const deck = isInSetup ? (workingOnDeck || null) : (currentOnDecks?.[bottomColor] || null);
        if (deck) content = pieceGlyph(deck, isOnDeck ? s : slot);
      } else {
        if (ord !== undefined && stash[ord]) content = pieceGlyph(stash[ord], isOnDeck ? s : slot);
      }
      // Fade the origin piece while dragging
      if (content && dragging && dragging.origin) {
        if (isOnDeck && dragging.origin.type === 'deck') {
          content.style.opacity = '0.1';
        } else if (!isOnDeck && dragging.origin.type === 'stash' && dragging.origin.index === ord) {
          content.style.opacity = '0.1';
        }
      }
      const el = makeSlot(xCursor, yTop, isOnDeck, true, content);
      if (isOnDeck) {
        refs.deckEl = el;
        el.style.zIndex = '10'; // ensure on-deck sits above other stash slots/pieces
        if (isInSetup) attachInteractiveHandlers(el, { type: 'deck', index: 0 });
        // Apply selection halo if on-deck is selected
        if (selected && selected.type === 'deck') {
          el.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
        }
      } else {
        const ord = uiToOrdinal[i];
        if (isInSetup) attachInteractiveHandlers(el, { type: 'stash', index: ord });
        refs.stashSlots[ord] = { el, ordinal: ord };
        if (selected && selected.type === 'stash' && selected.index === ord) {
          el.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
        }
      }
      stashRoot.appendChild(el);
      xCursor += widthsTop[i] + topSpace;
    }

    // Bottom row content width and left
    const bottomContentWidth = bottomCols * slot + (bottomCols - 1) * bottomSpace;
    const bottomLeft = Math.round(blockCenterX - bottomContentWidth / 2 );

    for (let i = 0; i < bottomCols; i++) {
      const x = bottomLeft + i * (slot + bottomSpace);
      // Bottom row touches the top row (no gap) and is nudged up twice as much as the top row
      const y = yStart + slot - (verticalNudge * 2);
      const ord = uiToOrdinal[5 + i];
      const piece = (ord !== undefined) ? stash[ord] : null;
      const content = piece ? pieceGlyph(piece, slot) : null;
      if (content && dragging && dragging.origin && dragging.origin.type === 'stash' && dragging.origin.index === ord) {
        content.style.opacity = '0.5';
      }
      const el = makeSlot(x, y, false, false, content);
      if (isInSetup) attachInteractiveHandlers(el, { type: 'stash', index: ord });
      refs.stashSlots[ord] = { el, ordinal: ord };
      if (selected && selected.type === 'stash' && selected.index === ord) {
        el.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
      }
      stashRoot.appendChild(el);
    }
  }

  function pieceGlyph(piece, target) {
    try {
      return modulePieceGlyph(piece, target, PIECE_IMAGES);
    } catch (_) {
      // Fallback to inline image if module import failed
      if (!piece) return null;
      const size = Math.floor(target * 0.9);
      const src = PIECE_IMAGES?.[piece.identity]?.[piece.color];
      if (!src) return null;
      const img = document.createElement('img');
      img.src = src;
      img.alt = '';
      img.style.width = size + 'px';
      img.style.height = size + 'px';
      img.style.objectFit = 'contain';
      return img;
    }
  }

  function makeBubbleImg(type, square, opts) {
    try {
      const src = getBubbleAsset(type);
      if (!src) return null;
      const img = document.createElement('img');
      img.dataset.bubble = '1';
      if (opts && opts.preview) img.dataset.preview = '1';
      img.dataset.bubbleType = type;
      img.draggable = false;
      img.style.position = 'absolute';
      // Default: previews are non-interactive; overlays can be clickable and are enabled by caller
      img.style.pointerEvents = (opts && opts.preview) ? 'none' : 'auto';
      img.style.zIndex = '20';
      // Shrink ~15% from previous size (1.2x -> 1.02x square)
      img.style.width = Math.floor(square * 1.08) + 'px';
      img.style.height = 'auto';
      const offsetX = Math.floor(square * 0.6); // push further to sides
      const offsetY = Math.floor(square * 0.5); // raise above piece
      if (type.endsWith('Right')) { img.style.right = (-offsetX) + 'px'; img.style.left = 'auto'; }
      else { img.style.left = (-offsetX) + 'px'; img.style.right = 'auto'; }
      img.style.top = (-offsetY) + 'px';
      img.src = (BUBBLE_PRELOAD[type] && BUBBLE_PRELOAD[type].src) || src;
      return img;
    } catch (_) { return null; }
  }

  
  function preloadPieceImages() {
    Object.keys(PIECE_IMAGES || {}).forEach(function(id){
      PIECE_PRELOAD[id] = {};
      Object.keys(PIECE_IMAGES[id] || {}).forEach(function(color){
        const src = PIECE_IMAGES[id][color];
        const img = new Image();
        img.draggable = false; img.decoding = 'async';
        img.src = src;
        PIECE_PRELOAD[id][color] = img;
      });
    });
  }

  function preloadBubbleImages() {
    Object.keys(ASSET_MANIFEST?.bubbles || {}).forEach(function(k){
      const src = getBubbleAsset(k);
      if (!src) return;
      const img = new Image();
      img.draggable = false; img.decoding = 'async';
      img.src = src;
      BUBBLE_PRELOAD[k] = img;
    });
  }

  function clearDragPreviewImgs() {
    try { dragPreviewImgs.forEach(function(n){ try { document.body.removeChild(n); } catch(_) {} }); } catch(_) {}
    dragPreviewImgs = [];
  }

  function showDragPreviewAtPointer(types, x, y) {
    clearDragPreviewImgs();
    if (!types || !Array.isArray(types) || types.length === 0) return;
    const square = currentSquareSize || 40;
    const offsetX = Math.floor(square * 0.6);
    const offsetY = Math.floor(square * 0.5);
    types.forEach(function(t){
      const img = makeBubbleImg(t, square, { preview: true });
      if (!img) return;
      img.style.position = 'fixed';
      img.style.zIndex = '100001';
      img.style.willChange = 'transform, left, top';
      const w = parseInt(img.style.width || '0', 10) || (square * 1.08);
      const leftPos = t.endsWith('Right') ? (x + offsetX - w / 2) : (x - offsetX - w / 2);
      const topPos = y - offsetY - w / 2;
      img.style.left = leftPos + 'px';
      img.style.top = topPos + 'px';
      document.body.appendChild(img);
      dragPreviewImgs.push(img);
    });
  }

  function computeBubbleTypesForMove(originUI, destUI) {
    try {
      const myColorIdx = currentIsWhite ? 0 : 1;
      const fromS = uiToServerCoords(originUI.uiR, originUI.uiC, currentRows, currentCols, currentIsWhite);
      const toS = uiToServerCoords(destUI.uiR, destUI.uiC, currentRows, currentCols, currentIsWhite);
      const from = { row: fromS.serverRow, col: fromS.serverCol };
      const to = { row: toS.serverRow, col: toS.serverCol };
      const target = currentBoard?.[to.row]?.[to.col];
      if (target && target.color === myColorIdx) return null;
      const decls = [Declaration.KNIGHT, Declaration.KING, Declaration.BISHOP, Declaration.ROOK];
      for (const d of decls) {
        if (!isWithinPieceRange(from, to, d)) continue;
        if (!isPathClear(currentBoard, from, to, d)) continue;
        const dx = Math.abs(destUI.uiR - originUI.uiR);
        const dy = Math.abs(destUI.uiC - originUI.uiC);
        const movedDistance = Math.max(dx, dy);
        // During drag preview, always show thought bubbles for rook/bishop/knight
        if (d === Declaration.KNIGHT) return ['knightThoughtLeft'];
        if (d === Declaration.ROOK && movedDistance > 1) return ['rookThoughtLeft'];
        if (d === Declaration.BISHOP && movedDistance > 1) return ['bishopThoughtLeft'];
        if (d === Declaration.KING) {
          return ['kingThoughtRight', (dx === dy && dx > 0) ? 'bishopThoughtLeft' : 'rookThoughtLeft'];
        }
      }
      return null;
    } catch (_) { return null; }
  }

  let dragPreview = null; // { uiR, uiC }
  function updateDragPreview(newUIR, newUIC, types) {
    try {
      // Remove previous preview images
      if (dragPreview && refs.boardCells?.[dragPreview.uiR]?.[dragPreview.uiC]?.el) {
        const prevCell = refs.boardCells[dragPreview.uiR][dragPreview.uiC].el;
        Array.from(prevCell.querySelectorAll('img[data-bubble][data-preview]')).forEach(function(n){ try { n.remove(); } catch(_) {} });
      }
      dragPreview = null;
      if (!types || !Array.isArray(types) || types.length === 0) return;
      const cell = refs.boardCells?.[newUIR]?.[newUIC]?.el;
      if (!cell) return;
      types.forEach(function(t){ const img = makeBubbleImg(t, currentSquareSize, { preview: true }); if (img) cell.appendChild(img); });
      dragPreview = { uiR: newUIR, uiC: newUIC };
    } catch (_) {}
  }

  function serverToUICoords(row, col) {
    if (!currentRows || !currentCols) return { uiR: row, uiC: col };
    const uiR = currentIsWhite ? (currentRows - 1 - row) : row;
    const uiC = currentIsWhite ? col : (currentCols - 1 - col);
    return { uiR, uiC };
  }

  function bubbleTypesForMove(originUI, destUI, declaration) {
    // Always show a speech bubble for the declared type so that
    // one-square rook or bishop moves retain their bubble after server updates.
    if (declaration === Declaration.KNIGHT) return ['knightSpeechLeft'];
    if (declaration === Declaration.ROOK) return ['rookSpeechLeft'];
    if (declaration === Declaration.BISHOP) return ['bishopSpeechLeft'];
    if (declaration === Declaration.KING) return ['kingSpeechLeft'];
    return [];
  }

  function setStateFromServer(u) {
    try {
      // Avoid overwriting optimistic in-game moves while a drag or selection is active
      if (!dragging) {
        if (Array.isArray(u.board)) currentBoard = u.board; else if (u.board === null) currentBoard = null;
      }
      if (Array.isArray(u.stashes)) currentStashes = u.stashes;
      if (Array.isArray(u.onDecks)) currentOnDecks = u.onDecks;
      if (Array.isArray(u.captured)) currentCaptured = u.captured;
      if (Array.isArray(u.daggers)) currentDaggers = u.daggers;
      if (Array.isArray(u.setupComplete)) setupComplete = u.setupComplete;
      if (u.playerTurn === 0 || u.playerTurn === 1) currentPlayerTurn = u.playerTurn;
      if (u.onDeckingPlayer !== undefined) {
        currentOnDeckingPlayer = u.onDeckingPlayer;
        if (currentOnDeckingPlayer !== null) selected = null;
      }
      if (Object.prototype.hasOwnProperty.call(u, 'drawOffer')) {
        const offer = u.drawOffer;
        if (offer && typeof offer.player === 'string') {
          offer.player = parseInt(offer.player, 10);
        }
        currentDrawOffer = offer || null;
      }
      if (Object.prototype.hasOwnProperty.call(u, 'drawOfferCooldowns')) {
        if (Array.isArray(u.drawOfferCooldowns)) {
          drawOfferCooldowns = u.drawOfferCooldowns.map((value) => {
            if (!value && value !== 0) return null;
            if (typeof value === 'number') return value;
            if (value instanceof Date) return value.getTime();
            const parsed = Date.parse(value);
            return Number.isNaN(parsed) ? null : parsed;
          });
        } else {
          drawOfferCooldowns = [null, null];
        }
        scheduleDrawCooldownCheck();
      }
      if (u.timeControlStart !== undefined) {
        const parsedTime = coerceMilliseconds(u.timeControlStart);
        if (parsedTime !== null) {
          timeControl = parsedTime;
          expectedTimeControl = parsedTime;
        }
      }
      if (u.increment !== undefined) {
        const parsedInc = coerceMilliseconds(u.increment, { allowZero: true });
        if (parsedInc !== null) {
          increment = parsedInc;
          expectedIncrement = parsedInc;
        }
      }
      if (u.startTime) gameStartTime = new Date(u.startTime).getTime();
      if (Array.isArray(u.actions)) {
        actionHistory = u.actions;
        lastAction = u.actions[u.actions.length - 1] || null;
      }
      if (Array.isArray(u.moves)) {
        lastMove = u.moves[u.moves.length - 1] || null;
        const last = lastMove;
        if (last && last.state === MOVE_STATES.PENDING) {
          const from = last.from || {};
          const to = last.to || {};
          pendingMoveFrom = from;
          try {
            const moving = currentBoard?.[from.row]?.[from.col] || null;
            const target = currentBoard?.[to.row]?.[to.col] || null;
            if (moving || target) {
              currentBoard = currentBoard.map(row => row.slice());
              currentBoard[to.row] = currentBoard[to.row].slice();
              currentBoard[from.row] = currentBoard[from.row].slice();
              if (lastAction && lastAction.type === ACTIONS.BOMB) {
                const attackerPiece = moving || { color: last.player, identity: last.declaration };
                currentBoard[to.row][to.col] = target || moving;
                pendingCapture = attackerPiece ? { row: to.row, col: to.col, piece: attackerPiece } : null;
              } else {
                currentBoard[to.row][to.col] = moving || target;
                pendingCapture = target ? { row: to.row, col: to.col, piece: target } : null;
              }
              currentBoard[from.row][from.col] = null;
            }
          } catch (_) { pendingCapture = null; }
          try {
            const originUI = serverToUICoords(from.row, from.col);
            const destUI = serverToUICoords(to.row, to.col);
            if (lastAction && lastAction.type === ACTIONS.BOMB) {
              postMoveOverlay = { uiR: destUI.uiR, uiC: destUI.uiC, types: ['bombSpeechLeft'] };
            } else {
              const types = bubbleTypesForMove(originUI, destUI, last.declaration);
              postMoveOverlay = { uiR: destUI.uiR, uiC: destUI.uiC, types };
            }
          } catch (_) {}
        } else {
          postMoveOverlay = null;
          pendingCapture = null;
          pendingMoveFrom = null;
        }
      }

      // Determine red tint square for successful challenges
      challengeRemoved = null;
      const prevAction = Array.isArray(u.actions) ? u.actions[u.actions.length - 2] : null;
      if (
        lastAction &&
        lastAction.type === ACTIONS.CHALLENGE &&
        lastAction.details &&
        lastAction.details.outcome === 'SUCCESS' &&
        prevAction &&
        (prevAction.type === ACTIONS.MOVE || prevAction.type === ACTIONS.BOMB)
      ) {
        const to = lastMove && lastMove.to;
        if (to) {
          challengeRemoved = { row: to.row, col: to.col };
        }
      }
    } catch (_) {}
    recomputeClocksFromServer();
  }

  // ---- Setup helpers ----
  function bootstrapWorkingStateFromServer(view) {
    try {
      // Seed working stash from server order; limit to 8
      const base = Array.isArray(view?.stashes?.[myColor]) ? view.stashes[myColor] : [];
      for (let i = 0; i < 8; i++) workingStash[i] = base[i] || null;

      // Seed on-deck if present
      workingOnDeck = (Array.isArray(view?.onDecks) ? view.onDecks[myColor] : null) || null;

      // Remove deck piece from working stash if present
      if (workingOnDeck) {
        const idx = workingStash.findIndex(p => p && p.identity === workingOnDeck.identity && p.color === workingOnDeck.color);
        if (idx !== -1) workingStash[idx] = null;
      }

      // Populate working rank from board row for our color if any
      for (let uiCol = 0; uiCol < 5; uiCol++) workingRank[uiCol] = null;
      if (Array.isArray(view?.board)) {
        // Read server back rank for this color
        const rowServer = myColor === 0 ? 0 : (view.board.length - 1);
        for (let serverCol = 0; serverCol < 5; serverCol++) {
          const piece = view.board?.[rowServer]?.[serverCol];
          if (piece && piece.color === myColor) {
            const uiCol = currentIsWhite ? serverCol : (5 - 1 - serverCol);
            workingRank[uiCol] = piece;
            // Remove from working stash if present
            const idx2 = workingStash.findIndex(p => p && p.identity === piece.identity && p.color === piece.color);
            if (idx2 !== -1) workingStash[idx2] = null;
          }
        }
      }
    } catch (e) { console.error('bootstrapWorkingStateFromServer failed', e); }
  }

  function isSetupCompletable() {
    const allFilled = workingRank.every(p => !!p);
    const hasKing = workingRank.some(p => p && p.identity === KING_ID);
    return Boolean(allFilled && hasKing && workingOnDeck);
  }

  function buildSetupPayload() {
    const pieces = [];
    // Server expects placement on its own back rank for the current color
    const rowServer = myColor === 0 ? 0 : (currentRows - 1);
    for (let uiCol = 0; uiCol < 5; uiCol++) {
      const piece = workingRank[uiCol];
      if (!piece) continue;
      // Derive server column using cached bottom cell references
      let colServer = null;
      try {
        const cellRef = refs.bottomCells?.[uiCol];
        const parsed = cellRef?.el ? parseInt(cellRef.el.dataset?.serverCol, 10) : NaN;
        if (!Number.isNaN(parsed)) colServer = parsed;
      } catch (_) {}
      if (colServer === null) {
        // Fallback to perspective mapping if dataset not available
        colServer = currentIsWhite ? uiCol : (currentCols - 1 - uiCol);
      }
      pieces.push({ identity: piece.identity, color: myColor, row: rowServer, col: colServer });
    }
    return { gameId: lastGameId, color: myColor, pieces, onDeck: workingOnDeck };
  }

  function attachInteractiveHandlers(el, target) {
    try { el.style.cursor = 'pointer'; } catch (_) {}
    // Mouse: threshold promotion to drag, otherwise click-to-move
    el.addEventListener('mousedown', (e) => {
      if (gameFinished) return;
      if (Date.now() < suppressMouseUntil) return; // ignore synthetic mouse after touch
      const myColorIdx = currentIsWhite ? 0 : 1;
      const isOnDeckTurn = (!isInSetup && currentOnDeckingPlayer === myColorIdx);
      if (!isInSetup && !isOnDeckTurn) return;
      let originPiece = null;
      if (isInSetup) {
        originPiece = getPieceAt(target);
      } else if (isOnDeckTurn && target.type === 'stash') {
        originPiece = currentStashes?.[myColorIdx]?.[target.index] || null;
      } else if (isOnDeckTurn && target.type === 'deck') {
        originPiece = currentOnDecks?.[myColorIdx] || null;
      }
      // if (DRAG_DEBUG) console.log('[drag] mousedown', { suppressMouseUntil, now: Date.now(), originHasPiece: !!originPiece, target });
      // Allow clicks on empty targets when a piece is already selected
      if (!originPiece && !selected && !(isOnDeckTurn && target.type === 'deck')) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      let dragStarted = false;
      const move = (ev) => {
        if (dragStarted) return;
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if ((dx > DRAG_PX_THRESHOLD || dy > DRAG_PX_THRESHOLD) && originPiece) {
          dragStarted = true;
          // if (DRAG_DEBUG) console.log('[drag] start mouse', { target, x: ev.clientX, y: ev.clientY });
          startDrag(ev, target, originPiece);
          document.removeEventListener('mousemove', move);
        }
      };
      const up = (ev) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (!dragStarted) {
          if (isInSetup) {
            ev.preventDefault();
            ev.stopPropagation();
            handleClickTarget(target);
          } else if (isOnDeckTurn) {
            ev.preventDefault();
            ev.stopPropagation();
            handleOnDeckClick(target);
          }
        }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // Touch: mirror behavior with slightly higher jitter tolerance
    el.addEventListener('touchstart', (e) => {
      if (gameFinished) return;
      const myColorIdx = currentIsWhite ? 0 : 1;
      const isOnDeckTurn = (!isInSetup && currentOnDeckingPlayer === myColorIdx);
      if (!isInSetup && !isOnDeckTurn) return;
      let originPiece = null;
      if (isInSetup) {
        originPiece = getPieceAt(target);
      } else if (isOnDeckTurn && target.type === 'stash') {
        originPiece = currentStashes?.[myColorIdx]?.[target.index] || null;
      } else if (isOnDeckTurn && target.type === 'deck') {
        originPiece = currentOnDecks?.[myColorIdx] || null;
      }
      if (!originPiece && !selected && !(isOnDeckTurn && target.type === 'deck')) return;
      try { e.preventDefault(); e.stopPropagation(); } catch(_) {}
      suppressMouseUntil = Date.now() + 500;
      const t = e.touches[0];
      const startX = t.clientX, startY = t.clientY;
      let dragStarted = false;
      const move = (ev) => {
        if (dragStarted) return;
        const tt = ev.touches[0];
        const dx = Math.abs(tt.clientX - startX);
        const dy = Math.abs(tt.clientY - startY);
        if ((dx > DRAG_PX_THRESHOLD_TOUCH || dy > DRAG_PX_THRESHOLD_TOUCH) && originPiece) {
          dragStarted = true;
          document.removeEventListener('touchmove', move);
          // if (DRAG_DEBUG) console.log('[drag] start touch', { target, x: tt.clientX, y: tt.clientY });
          startDrag({ clientX: tt.clientX, clientY: tt.clientY }, target, originPiece);
        }
      };
      const end = (ev) => {
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
        if (!dragStarted) {
          if (isInSetup) {
            handleClickTarget(target);
          } else if (isOnDeckTurn) {
            handleOnDeckClick(target);
          }
        }
      };
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', end);
      document.addEventListener('touchcancel', end);
    }, { passive: false });
  }

  // In-game handlers reuse the same control pipeline but only target board cells and call a rules callback
  function attachGameHandlers(cell, uiR, uiC) {
    try { cell.style.cursor = 'pointer'; } catch (_) {}
    const sourceTarget = { type: 'boardAny', uiR, uiC };
    cell.addEventListener('mousedown', (e) => {
      if (gameFinished) return;
      if (Date.now() < suppressMouseUntil) return;
      if (isInSetup) return; // not in setup
      if (currentOnDeckingPlayer !== null) return; // disable board moves during on-deck phase
      if (isBombActive()) return; // lock movement during bomb
      const myColorIdx = currentIsWhite ? 0 : 1;
      const piece = getBoardPieceAtUI(uiR, uiC);
      // If user clicked a bubble overlay inside this cell, let it handle the click
      const t = e.target;
      if (t && t.closest && t.closest('img[data-bubble]:not([data-preview])')) {
        return;
      }
      e.preventDefault(); e.stopPropagation();
      const startX = e.clientX, startY = e.clientY;
      let dragStarted = false;
      const move = (ev) => {
        if (dragStarted) return;
        // Only start a drag if this square has your piece and it's your turn
        if (!piece || piece.color !== myColorIdx || currentPlayerTurn !== myColorIdx) return;
        const dx = Math.abs(ev.clientX - startX);
        const dy = Math.abs(ev.clientY - startY);
        if (dx > DRAG_PX_THRESHOLD || dy > DRAG_PX_THRESHOLD) {
          dragStarted = true;
          startDrag(ev, sourceTarget, piece);
          document.removeEventListener('mousemove', move);
        }
      };
      const up = (ev) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (!dragStarted) { handleGameClick(sourceTarget); }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    cell.addEventListener('touchstart', (e) => {
      if (gameFinished) return;
      if (isInSetup) return;
      if (currentOnDeckingPlayer !== null) return; // disable during on-deck phase
      if (isBombActive()) return; // lock movement during bomb
      const myColorIdx = currentIsWhite ? 0 : 1;
      const piece = getBoardPieceAtUI(uiR, uiC);
      // Allow bubble overlay touches to pass through for tap/click handling
      const tEl = e.target;
      if (tEl && tEl.closest && tEl.closest('img[data-bubble]:not([data-preview])')) {
        return;
      }
      try { e.preventDefault(); e.stopPropagation(); } catch(_) {}
      suppressMouseUntil = Date.now() + 500;
      const t = e.touches[0];
      const startX = t.clientX, startY = t.clientY;
      let dragStarted = false;
      const move = (ev) => {
        if (dragStarted) return;
        // Only start a drag if this square has your piece and it's your turn
        if (!piece || piece.color !== myColorIdx || currentPlayerTurn !== myColorIdx) return;
        const tt = ev.touches[0];
        const dx = Math.abs(tt.clientX - startX);
        const dy = Math.abs(tt.clientY - startY);
        if (dx > DRAG_PX_THRESHOLD_TOUCH || dy > DRAG_PX_THRESHOLD_TOUCH) {
          dragStarted = true; document.removeEventListener('touchmove', move);
          startDrag({ clientX: tt.clientX, clientY: tt.clientY }, sourceTarget, piece);
        }
      };
      const end = (ev) => {
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        if (!dragStarted) { handleGameClick(sourceTarget); }
      };
      document.addEventListener('touchmove', move, { passive: false });
      document.addEventListener('touchend', end);
      document.addEventListener('touchcancel', end);
    }, { passive: false });
  }

  function getBoardPieceAtUI(uiR, uiC) {
    try {
      const sr = currentIsWhite ? (currentRows - 1 - uiR) : uiR;
      const sc = currentIsWhite ? uiC : (currentCols - 1 - uiC);
      return currentBoard?.[sr]?.[sc] || null;
    } catch (_) { return null; }
  }

  function handleGameClick(sourceTarget) {
    if (isBombActive()) { selected = null; renderBoardAndBars(); return; }
    // Select/deselect and wait for second click to choose destination
    if (!selected) {
      const p = getBoardPieceAtUI(sourceTarget.uiR, sourceTarget.uiC);
      const myColorIdx = currentIsWhite ? 0 : 1;
      // Only allow selecting if it's your turn and you tapped your piece
      if (!p || p.color !== myColorIdx || currentPlayerTurn !== myColorIdx) { selected = null; renderBoardAndBars(); return; }
      selected = { ...sourceTarget };
      renderBoardAndBars();
      return;
    }
    // Second click: move attempt to destination
    if (selected.type === 'boardAny' && sourceTarget.type === 'boardAny') {
      const moved = attemptInGameMove(selected, sourceTarget);
      selected = null;
      renderBoardAndBars();
      return;
    }
    // Any other case (e.g., click on non-board) clears selection
    selected = null; renderBoardAndBars();
  }

  function attemptInGameMove(origin, dest) {
    try {
      if (isBombActive()) return false;
      if (!currentBoard) return false;
      if (currentOnDeckingPlayer !== null) return false;
      const myColorIdx = currentIsWhite ? 0 : 1;
      if (!(currentPlayerTurn === 0 || currentPlayerTurn === 1) || currentPlayerTurn !== myColorIdx) return false;
      if (!(origin && origin.type === 'boardAny' && dest && dest.type === 'boardAny')) return false;
      const fromS = uiToServerCoords(origin.uiR, origin.uiC, currentRows, currentCols, currentIsWhite);
      const toS = uiToServerCoords(dest.uiR, dest.uiC, currentRows, currentCols, currentIsWhite);
      const from = { row: fromS.serverRow, col: fromS.serverCol };
      const to = { row: toS.serverRow, col: toS.serverCol };
      const target = currentBoard?.[to.row]?.[to.col];
      if (target && target.color === myColorIdx) return false;
      const decls = [Declaration.KNIGHT, Declaration.KING, Declaration.BISHOP, Declaration.ROOK];
      const legal = [];
      for (const d of decls) {
        if (!isWithinPieceRange(from, to, d)) continue;
        if (!isPathClear(currentBoard, from, to, d)) continue;
        legal.push(d);
      }
      if (legal.length === 0) return false;

      // If single legal declaration or non-king with distance criteria, auto-commit
      const dx = Math.abs(dest.uiR - origin.uiR);
      const dy = Math.abs(dest.uiC - origin.uiC);
      const movedDistance = Math.max(dx, dy);
      const commitMove = async (decl, opts) => {
        let moving = currentBoard[from.row][from.col];
        // If we already optimistically moved for a choice, origin will be empty.
        // In that case, verify the destination has our piece and proceed.
        if (!moving) {
          const already = currentBoard?.[to.row]?.[to.col];
          if (!already || already.color !== myColorIdx) return false;
        } else {
          if (moving.color !== myColorIdx) return false;
          currentBoard = currentBoard.map(row => row.slice());
          currentBoard[to.row] = currentBoard[to.row].slice();
          currentBoard[from.row] = currentBoard[from.row].slice();
          currentBoard[to.row][to.col] = moving;
          currentBoard[from.row][from.col] = null;
        }
        selected = null;
        // Show final left speech bubble only for the declared type
        showFinalSpeechOnly(origin, dest, decl, opts);
        // Send to server
        try {
          console.log('[move] commit', { from, to, declaration: decl });
          const color = myColorIdx;
          applyLocalMoveClock();
          await apiMove({ gameId: lastGameId, color, from, to, declaration: decl });
        } catch (e) { console.error('apiMove failed', e); }
        renderBoardAndBars();
        return true;
      };

      // King can imply two thoughts, but we still must choose at placement per design
      if (legal.length === 1) {
        return commitMove(legal[0]);
      }

      // Choice UI: if KING + (ROOK or BISHOP), or other two-options, show clickable overlays on the destination
      const cellRef = refs.boardCells?.[dest.uiR]?.[dest.uiC];
      if (!cellRef || !cellRef.el) return false;
      // Clear existing previews and overlays
      clearDragPreviewImgs();
      Array.from(cellRef.el.querySelectorAll('img[data-bubble]')).forEach(function(n){ try { n.remove(); } catch(_) {} });
      // Optimistically place the piece at destination so it visually moves with the choice bubbles
      const movingNow = currentBoard[from.row][from.col];
      if (movingNow && movingNow.color === myColorIdx) {
        currentBoard = currentBoard.map(row => row.slice());
        currentBoard[to.row] = currentBoard[to.row].slice();
        currentBoard[from.row] = currentBoard[from.row].slice();
        currentBoard[to.row][to.col] = movingNow;
        currentBoard[from.row][from.col] = null;
      }
      const types = [];
      if (legal.includes(Declaration.KING)) {
        // Always put king thought on the right
        types.push('kingThoughtRight');
        // Pair with bishop or rook on the left depending on direction — use THOUGHT bubbles for the choice UI
        if (dx === dy && dx > 0) types.push('bishopThoughtLeft'); else types.push('rookThoughtLeft');
      } else {
        // Fallback: bishop/rook choice
        if (legal.includes(Declaration.BISHOP)) types.push('bishopSpeechLeft');
        if (legal.includes(Declaration.ROOK)) types.push('rookSpeechLeft');
      }
      // Create clickable images
      types.forEach(function(t){
        const img = makeBubbleImg(t, currentSquareSize, {});
        if (!img) return;
        img.style.cursor = 'pointer';
        img.addEventListener('click', function(ev){
          ev.preventDefault(); ev.stopPropagation();
          const decl = t.includes('king') ? Declaration.KING : (t.includes('bishop') ? Declaration.BISHOP : Declaration.ROOK);
          commitMove(decl, { alwaysShow: true });
        });
        // Ensure overlays remain clickable above the cell content
        try { cellRef.el.style.position = 'relative'; } catch(_) {}
        img.style.pointerEvents = 'auto';
        img.style.zIndex = '1001';
        cellRef.el.appendChild(img);
      });
      // Also set overlay so re-render (if any) keeps them
      postMoveOverlay = { uiR: dest.uiR, uiC: dest.uiC, types, interactive: true };
      // Lock interactions while awaiting choice
      currentPlayerTurn = null;
      // Show the optimistic placement with choice bubbles
      lastChoiceOrigin = { uiR: origin.uiR, uiC: origin.uiC };
      renderBoardAndBars();
      return true;
    } catch (e) { console.error('attemptInGameMove failed', e); return false; }
  }

  function lockInteractionsAfterMove(origin, dest, declaration, opts) {
    try {
      // Disable all game handlers by setting turn to null; server will set next turn on update
      currentPlayerTurn = null;
      // Prepare bubble overlay to attach on next render
      const dx = Math.abs(dest.uiR - origin.uiR);
      const dy = Math.abs(dest.uiC - origin.uiC);
      const movedDistance = Math.max(dx, dy);
      const types = [];
      if (declaration === Declaration.KNIGHT) {
        types.push('knightSpeechLeft');
      } else if (declaration === Declaration.ROOK && movedDistance > 1) {
        types.push('rookSpeechLeft');
      } else if (declaration === Declaration.BISHOP && movedDistance > 1) {
        types.push('bishopSpeechLeft');
      } else if (declaration === Declaration.KING) {
        // For choice confirmation we may want speech; otherwise default to thought
        if (opts && opts.forceSpeechForKing) {
          types.push('kingSpeechLeft');
        } else {
          types.push('kingThoughtRight');
          if (dx === dy && dx > 0) types.push('bishopThoughtLeft'); else types.push('rookThoughtLeft');
        }
      }
      postMoveOverlay = { uiR: dest.uiR, uiC: dest.uiC, types, interactive: false };
    } catch (_) {}
  }

  // After a declaration is chosen, only show the left speech bubble for that type
  function showFinalSpeechOnly(origin, dest, declaration, opts) {
    try {
      currentPlayerTurn = null;
      const dx = Math.abs(dest.uiR - origin.uiR);
      const dy = Math.abs(dest.uiC - origin.uiC);
      const movedDistance = Math.max(dx, dy);
      let types = [];
      if (declaration === Declaration.KNIGHT) types = ['knightSpeechLeft'];
      else if (declaration === Declaration.ROOK) {
        // For rook, show speech if either alwaysShow or moved beyond 1 square
        if ((opts && opts.alwaysShow) || movedDistance > 1) types = ['rookSpeechLeft'];
      }
      else if (declaration === Declaration.BISHOP) {
        if ((opts && opts.alwaysShow) || movedDistance > 1) types = ['bishopSpeechLeft'];
      }
      else if (declaration === Declaration.KING) {
        // Show king speech on the left for king declaration
        types = ['kingSpeechLeft'];
      }
      postMoveOverlay = { uiR: dest.uiR, uiC: dest.uiC, types };
      // Final overlays are visual only; forget lastChoiceOrigin
      lastChoiceOrigin = null;
    } catch (_) {}
  }

  // Commit from a post-move overlay click when we preserved origin/dest for choice UI
  async function commitMoveFromOverlay(declaration, ctx) {
    try {
      if (isBombActive()) return;
      if (!ctx || !ctx.originUI || !ctx.destUI) return;
      const fromS = uiToServerCoords(ctx.originUI.uiR, ctx.originUI.uiC, currentRows, currentCols, currentIsWhite);
      const toS = uiToServerCoords(ctx.destUI.uiR, ctx.destUI.uiC, currentRows, currentCols, currentIsWhite);
      const from = { row: fromS.serverRow, col: fromS.serverCol };
      const to = { row: toS.serverRow, col: toS.serverCol };
      const myColorIdx = currentIsWhite ? 0 : 1;
      // Only show final speech and send to server; piece already optimistically placed
      // Always force the speech bubble so rook/bishop choices mirror king behavior
      showFinalSpeechOnly(ctx.originUI, ctx.destUI, declaration, { alwaysShow: true });
      try {
        console.log('[move] commit', { from, to, declaration });
        applyLocalMoveClock();
        await apiMove({ gameId: lastGameId, color: myColorIdx, from, to, declaration });
      } catch (e) { console.error('apiMove failed', e); }
      renderBoardAndBars();
    } catch (_) {}
  }

  function handleClickTarget(target) {
    if (!isInSetup && currentOnDeckingPlayer !== null) { selected = null; return; }
    const pieceAtTarget = getPieceAt(target);
    if (!selected) {
      // Select anything that has a piece (board/stash/deck). If empty, ignore
      if (!pieceAtTarget) return; // nothing to select
      selected = { ...target };
      renderBoardAndBars();
      return;
    }
    // If clicking the same spot, unselect
    if (selected.type === target.type && selected.index === target.index) {
      selected = null; renderBoardAndBars(); return;
    }
    // Attempt move/swap to any destination (empty or filled) across board/stash/deck
    const moved = performMove(selected, target);
    // console.log('[setup] click move', { from: selected, to: target, moved });
    selected = null;
    renderBoardAndBars();
  }

  function handleOnDeckClick(target) {
    const myColorIdx = currentIsWhite ? 0 : 1;
    if (currentOnDeckingPlayer !== myColorIdx) { selected = null; return; }
    if (!selected) {
      if (target.type !== 'stash') return;
      const piece = currentStashes?.[myColorIdx]?.[target.index] || null;
      if (!piece) return;
      selected = { ...target };
      renderBoardAndBars();
      return;
    }
    if (selected.type === target.type && selected.index === target.index) {
      selected = null; renderBoardAndBars(); return;
    }
    if (selected.type === 'stash' && target.type === 'stash') {
      const piece = currentStashes?.[myColorIdx]?.[target.index] || null;
      if (piece) {
        selected = { ...target };
      } else {
        selected = null;
      }
      renderBoardAndBars();
      return;
    }
    if (selected.type === 'stash' && target.type === 'deck') {
      const ord = selected.index;
      const piece = currentStashes?.[myColorIdx]?.[ord];
      if (piece) {
        currentStashes = currentStashes.map((arr, idx) => {
          if (idx !== myColorIdx) return arr;
          const clone = Array.isArray(arr) ? arr.slice() : [];
          clone[ord] = null;
          return clone;
        });
        currentOnDecks = currentOnDecks.map((p, idx) => (idx === myColorIdx ? piece : p));
        currentOnDeckingPlayer = null;
        selected = null;
        renderBoardAndBars();
        if (lastGameId) {
          apiOnDeck(lastGameId, myColorIdx, { identity: piece.identity }).catch(err => console.error('onDeck failed', err));
        }
        return;
      }
    }
    selected = null; renderBoardAndBars();
  }

  function startDrag(e, origin, piece) {
    if (gameFinished) return;
    try { if (e && typeof e.preventDefault === 'function') e.preventDefault(); } catch (_) {}
    try { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); } catch (_) {}
    selected = { ...origin };
    // Use board-square-sized ghost to avoid shrinking during drag
    const ghost = pieceGlyph(piece, currentSquareSize);
    ghost.style.position = 'fixed';
    ghost.style.pointerEvents = 'none';
    ghost.style.transform = 'translate(-50%, -50%)';
    ghost.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
    ghost.style.zIndex = '99999';
    // Position the ghost at the pointer immediately to avoid top-left flash
    const startCX = (e && e.clientX !== undefined)
      ? e.clientX
      : (e && e.touches && e.touches[0] && e.touches[0].clientX) || (e && e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientX) || 0;
    const startCY = (e && e.clientY !== undefined)
      ? e.clientY
      : (e && e.touches && e.touches[0] && e.touches[0].clientY) || (e && e.changedTouches && e.changedTouches[0] && e.changedTouches[0].clientY) || 0;
    ghost.style.left = startCX + 'px';
    ghost.style.top = startCY + 'px';
    document.body.appendChild(ghost);
    // Dim the origin element directly so we don't need to re-render immediately
    let originEl = dimOriginEl(origin, refs, 0.5);
    dragging = { piece, origin, ghostEl: ghost, originEl };
    suppressMouseUntil = Date.now() + 700; // extend suppression window during drag
    // if (DRAG_DEBUG) console.log('[drag] ghost init', { x: startCX, y: startCY, origin });
    // Do not re-render here; we dim the origin element directly to avoid disrupting touch event streams
    const move = (ev) => {
      if (!dragging) return;
      try { if (ev.cancelable) ev.preventDefault(); } catch (_) {}
      const t = ev.touches ? ev.touches[0] : (ev.changedTouches ? ev.changedTouches[0] : null);
      const x = (t && t.clientX !== undefined) ? t.clientX : ev.clientX;
      const y = (t && t.clientY !== undefined) ? t.clientY : ev.clientY;
      if (typeof x === 'number') ghost.style.left = x + 'px';
      if (typeof y === 'number') ghost.style.top = y + 'px';
      // Drag preview bubbles following the pointer over legal destination squares
      if (!isInSetup && refs.boardCells) {
        let over = null; let overRect = null;
        for (let rIdx = 0; rIdx < refs.boardCells.length; rIdx++) {
          const row = refs.boardCells[rIdx]; if (!row) continue;
          for (let cIdx = 0; cIdx < row.length; cIdx++) {
            const entry = row[cIdx]; if (!entry || !entry.el) continue;
            const b = entry.el.getBoundingClientRect();
            if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) { over = entry; overRect = b; break; }
          }
          if (over) break;
        }
        if (over && dragging.origin && dragging.origin.type === 'boardAny' && (currentPlayerTurn === (currentIsWhite ? 0 : 1))) {
          const types = computeBubbleTypesForMove(dragging.origin, { uiR: over.uiR, uiC: over.uiC });
          if (types) {
            showDragPreviewAtPointer(types, x, y);
          } else {
            clearDragPreviewImgs();
          }
        } else {
          clearDragPreviewImgs();
        }
      }
      if (DRAG_DEBUG) {
        const now = Date.now();
        // if (now - debugDragMoveLast > 80) { console.log('[drag] move', { x, y, type: ev.type, hasTouches: !!ev.touches }); debugDragMoveLast = now; }
      }
    };
    const up = (ev) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move, true);
      try { window.removeEventListener('touchmove', move, true); } catch (_) {}
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', up);
      if (!dragging) return;
      const cx = ev.clientX !== undefined ? ev.clientX : (ev.changedTouches && ev.changedTouches[0] && ev.changedTouches[0].clientX);
      const cy = ev.clientY !== undefined ? ev.clientY : (ev.changedTouches && ev.changedTouches[0] && ev.changedTouches[0].clientY);
      const dest = hitTestDrop(cx, cy);
      // if (DRAG_DEBUG) console.log('[drag] end', { x: cx, y: cy, dest });
      // Clear preview overlays
      clearDragPreviewImgs();
      if (dest) {
        if (isInSetup) {
          const moved = performMove(dragging.origin, dest);
          // console.log('[setup] drop', { from: dragging.origin, to: dest, moved });
        } else if (!isInSetup) {
          const myColorIdx = currentIsWhite ? 0 : 1;
          const isMyOnDeck = currentOnDeckingPlayer === myColorIdx;
          if (isMyOnDeck && dragging.origin && dragging.origin.type === 'stash' && dest.type === 'deck') {
            try {
              const ord = dragging.origin.index;
              const piece = dragging.piece;
              if (piece) {
                currentStashes = currentStashes.map((arr, idx) => {
                  if (idx !== myColorIdx) return arr;
                  const clone = Array.isArray(arr) ? arr.slice() : [];
                  clone[ord] = null;
                  return clone;
                });
                currentOnDecks = currentOnDecks.map((p, idx) => (idx === myColorIdx ? piece : p));
                currentOnDeckingPlayer = null;
                if (lastGameId) {
                  apiOnDeck(lastGameId, myColorIdx, { identity: piece.identity }).catch(err => console.error('onDeck failed', err));
                }
              }
            } catch (err) { console.error('onDeck local update failed', err); }
          } else if (dragging.origin && dragging.origin.type === 'boardAny' && dest.type === 'boardAny') {
            attemptInGameMove(dragging.origin, dest);
          }
        }
      }
      try { document.body.removeChild(ghost); } catch (_) {}
      try { restoreOriginEl(dragging.originEl); } catch(_) {}
      dragging = null; selected = null; renderBoardAndBars();
      suppressMouseUntil = Date.now() + 400; // brief suppression post-drag
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false, capture: true });
    window.addEventListener('touchmove', move, { passive: false, capture: true });
    document.addEventListener('touchend', up);
    document.addEventListener('touchcancel', up);
  }

  function hitTestDrop(x, y) {
    // If not in setup, allow dropping on any board cell
    if (!isInSetup && refs.boardCells) {
      for (let rIdx = 0; rIdx < refs.boardCells.length; rIdx++) {
        const row = refs.boardCells[rIdx];
        if (!row) continue;
        for (let cIdx = 0; cIdx < row.length; cIdx++) {
          const entry = row[cIdx];
          if (!entry || !entry.el) continue;
          const b = entry.el.getBoundingClientRect();
          if (x >= b.left && x <= b.right && y >= b.top && y <= b.bottom) {
            return { type: 'boardAny', uiR: entry.uiR, uiC: entry.uiC };
          }
        }
      }
    }
    // Deck first
    if (refs.deckEl) {
      const r = refs.deckEl.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { type: 'deck', index: 0 };
    }
    // Bottom board cells
    for (const entry of refs.bottomCells) {
      if (!entry || !entry.el) continue;
      const r = entry.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { type: 'board', index: entry.col };
    }
    // Stash slots
    for (const entry of refs.stashSlots) {
      if (!entry || !entry.el) continue;
      const r = entry.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { type: 'stash', index: entry.ordinal };
    }
    return null;
  }

  function getPieceAt(target) { return getPieceAtM(workingRank, workingOnDeck, workingStash, target); }
  function setPieceAt(target, piece) { const ref = { value: workingOnDeck }; setPieceAtM(workingRank, ref, workingStash, target, piece); workingOnDeck = ref.value; }
  function performMove(origin, dest) {
    const ref = { value: workingOnDeck };
    const moved = performMoveM(workingRank, ref, workingStash, origin, dest);
    workingOnDeck = ref.value;
    try { if (moved && playAreaRoot) renderBoardAndBars(); } catch (_) {}
    return moved;
  }
})();


