import { preloadAssets } from '/js/modules/utils/assetPreloader.js';
import { pieceGlyph as modulePieceGlyph } from '/js/modules/render/pieceGlyph.js';
import { createGameView } from '/js/modules/gameView/view.js';
import { renderStash as renderStashModule } from '/js/modules/render/stash.js';
import { createEloBadge } from '/js/modules/render/eloBadge.js';
import { PIECE_IMAGES, KING_ID, MOVE_STATES, WIN_REASONS } from '/js/modules/constants.js';
import { getCookie, setCookie } from '/js/modules/utils/cookies.js';
import { groupCapturedPiecesByColor } from '/js/modules/utils/captured.js';
import { apiReady, apiNext, apiSetup, apiGetDetails, apiEnterQueue, apiExitQueue, apiEnterRankedQueue, apiExitRankedQueue, apiEnterBotQueue, apiGetBotCatalog, apiMove, apiChallenge, apiBomb, apiOnDeck, apiPass, apiResign, apiDraw, apiCheckTimeControl, apiGetMatchDetails, apiGetTimeSettings, apiPostLocalDebugLog, apiGetTournamentHistory } from '/js/modules/api/game.js';
import { createLocalGameLogger } from '/js/modules/debug/localGameLogger.js';
import { computePlayAreaBounds, computeBoardMetrics } from '/js/modules/layout.js';
import { renderReadyButton } from '/js/modules/render/readyButton.js';
import { renderGameButton } from '/js/modules/render/gameButton.js';
import { upgradeButton, createButton } from '/js/modules/ui/buttons.js';
import { randomizeSetup } from '/js/modules/setup/randomize.js';
import { DRAG_PX_THRESHOLD as DRAG_PX_THRESHOLD_CFG, DRAG_PX_THRESHOLD_TOUCH as DRAG_PX_THRESHOLD_TOUCH_CFG, CLICK_TIME_MAX_MS as CLICK_TIME_MAX_MS_CFG } from '/js/modules/interactions/config.js';
import { getPieceAt as getPieceAtM, setPieceAt as setPieceAtM, performMove as performMoveM } from '/js/modules/state/moves.js';
import { Declaration, uiToServerCoords, isWithinPieceRange, isPathClear } from '/js/modules/interactions/moveRules.js';
import {
  canPieceBePlacedOnDeck,
  getDeckDestinationHighlight,
  getLegalBoardDestinationCells,
  getLegalBoardSourceCells,
  getSetupBoardDestinationIndexes,
  resolveActiveTurnColor,
} from '/js/modules/interactions/legalSourceHighlights.js';
import { wireSocket as bindSocket } from '/js/modules/socket.js';
import { computeHistorySummary, describeMatch, buildMatchDetailGrid, normalizeId, getMatchResult } from '/js/modules/history/dashboard.js';
import { createPlayerStatsOverlay } from '/js/modules/history/playerStatsOverlay.js';
import {
  ASSET_MANIFEST,
  getIconAsset,
  getAvatarAsset,
  getBubbleAsset,
  createThroneIcon
} from '/js/modules/ui/icons.js';
import { createDaggerCounter } from '/js/modules/ui/banners.js';
import { TOOLTIP_TEXT } from '/js/modules/ui/tooltipContent.js';
import { getMatchCountdownBannerTitle, shouldPreserveMatchCountdownBanner } from '/js/modules/ui/matchCountdown.js';
import { createOverlay } from '/js/modules/ui/overlays.js';
import { createToastSystem } from '/js/modules/ui/toasts.js';
import { createGameToastSnapshot, deriveGameToastFeedback } from '/js/modules/ui/gameToastEvents.js';
import { applyTooltipAttributes, initTooltipSystem, setTooltipsEnabled } from '/js/modules/ui/tooltips.js';
import { initTournamentUi } from '/js/modules/tournaments/ui.js';
import { createTournamentAcceptScheduler } from '/js/modules/tournaments/acceptScheduler.js';
import { coerceMilliseconds, describeTimeControl, formatClock } from '/js/modules/utils/timeControl.js';
import {
  computeGameClockState,
  normalizeClockSnapshot,
  advanceClockSnapshot,
  resolveDisplayedClockMs,
} from '/js/modules/utils/clockState.js';
import { shouldPreserveClockSnapshot } from '/js/modules/utils/clockSyncPolicy.js';
import { renderActiveMatchesList, createActiveMatchesStore, fetchActiveMatchesList } from '/js/modules/spectate/activeMatches.js';
import { createSpectateController } from '/js/modules/spectate/controller.js';
import { getLatestMoveContext } from '/js/shared/latestMoveContext.js';
import { getResponseWindowState } from '/js/shared/responseWindow.js';
import { logBootConstantsOnce, logGameSnapshot } from '/js/shared/debugLog.js';

preloadAssets();

logBootConstantsOnce();

(function() {
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const queueBtn = upgradeButton(document.getElementById('queueBtn'), {
    variant: 'primary',
    position: 'relative'
  });
  const modeSelect = document.getElementById('modeSelect');

  const isLocalDevelopmentHost = (() => {
    const { hostname = '', protocol = '' } = window.location || {};
    if (!hostname) {
      return protocol === 'file:';
    }

    const normalizedHost = hostname.trim().toLowerCase();
    const explicitlyLocalHosts = new Set([
      'localhost',
      '127.0.0.1',
      '0.0.0.0',
      '::1',
      '[::1]',
      'host.docker.internal'
    ]);

    if (explicitlyLocalHosts.has(normalizedHost)) {
      return true;
    }

    if (normalizedHost.endsWith('.local')) {
      return true;
    }

    if (/^192\.168\.(?:\d{1,3})\.(?:\d{1,3})$/.test(normalizedHost)) {
      return true;
    }

    if (/^10\.(?:\d{1,3})\.(?:\d{1,3})\.(?:\d{1,3})$/.test(normalizedHost)) {
      return true;
    }

    if (/^172\.(?:1[6-9]|2\d|3[0-1])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(normalizedHost)) {
      return true;
    }

    return false;
  })();

  const logLocalGameEvent = createLocalGameLogger({
    enabled: isLocalDevelopmentHost,
    source: 'player-client',
    sender: apiPostLocalDebugLog,
  });

  function summarizeClockSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
      return null;
    }
    return {
      whiteMs: Number.isFinite(Number(snapshot.whiteMs)) ? Number(snapshot.whiteMs) : 0,
      blackMs: Number.isFinite(Number(snapshot.blackMs)) ? Number(snapshot.blackMs) : 0,
      activeColor: snapshot.activeColor === 0 || snapshot.activeColor === 1
        ? snapshot.activeColor
        : null,
      tickingWhite: Boolean(snapshot.tickingWhite),
      tickingBlack: Boolean(snapshot.tickingBlack),
      label: snapshot.label || null,
      receivedAt: Number.isFinite(Number(snapshot.receivedAt)) ? Number(snapshot.receivedAt) : null,
    };
  }

  function emitLocalClockDebug(event, payload = {}) {
    try {
      logLocalGameEvent(event, {
        gameId: payload?.gameId || lastGameId || null,
        userId: userId || null,
        myColor,
        currentIsWhite,
        currentPlayerTurn,
        clockBase: summarizeClockSnapshot(clockBaseSnapshot),
        displayedClock: {
          whiteMs: whiteTimeMs,
          blackMs: blackTimeMs,
          activeColor,
        },
        ...payload,
      });
    } catch (_) {}
  }

  const allowGuestRankedQueue = isLocalDevelopmentHost;
  const selectWrap = document.getElementById('selectWrap');

  const menuToggle = upgradeButton(document.getElementById('menuToggle'), {
    variant: 'dark'
  });
  const menuContainer = document.getElementById('menuContainer');
  const menuMain = document.getElementById('menuMain');
  const accountBtn = upgradeButton(document.getElementById('accountBtn'), {
    variant: 'neutral',
    position: 'relative'
  });
  const rankedLeaderboardBtn = upgradeButton(document.getElementById('rankedLeaderboardBtn'), {
    variant: 'neutral',
    position: 'relative'
  });
  const tournamentBtn = upgradeButton(document.getElementById('tournamentBtn'), {
    variant: 'neutral',
    position: 'relative'
  });
  let tournamentUiController = null;
  let tournamentParticipantMode = false;
  const accountPanel = document.getElementById('menuAccountPanel');
  const usernameDisplay = document.getElementById('usernameDisplay');
  const accountPanelContent = document.getElementById('accountPanelContent');
  const accountBtnImg = accountBtn.querySelector('img');

  const spectateOverlay = document.getElementById('spectateOverlay');
  const spectatePlayArea = document.getElementById('spectatePlayArea');
  const spectateBoardEl = document.getElementById('spectateBoard');
  const spectateTopBar = document.getElementById('spectateTopBar');
  const spectateBottomBar = document.getElementById('spectateBottomBar');
  const spectateStatusEl = document.getElementById('spectateStatus');
  const spectateScoreEl = document.getElementById('spectateScore');
  const spectateBannerEl = document.getElementById('spectateBanner');
  const spectateMetaEl = document.getElementById('spectateMeta');
  const spectateTitleEl = document.getElementById('spectateTitle');
  const spectateCloseBtn = upgradeButton(document.getElementById('spectateCloseBtn'), {
    variant: 'dark',
    position: 'relative'
  });

  const ACCOUNT_ICON_SRC = getAvatarAsset('account') || '/assets/images/account.png';
  const LOGGED_IN_AVATAR_SRC = getAvatarAsset('loggedInDefault') || '/assets/images/cloakHood.jpg';
  const GOOGLE_ICON_SRC = getIconAsset('google') || '/assets/images/google-icon.png';
  const TOOLTIP_COOKIE_NAME = 'cgTooltipsEnabled';
  const TOAST_NOTIFICATIONS_COOKIE_NAME = 'cgToastNotificationsEnabled';
  const TOOLTIP_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

  function normalizeTooltipPreference(value, fallback = true) {
    if (value === true || value === false) {
      return value;
    }
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true' || normalized === '1' || normalized === 'on' || normalized === 'yes') {
        return true;
      }
      if (normalized === 'false' || normalized === '0' || normalized === 'off' || normalized === 'no') {
        return false;
      }
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value !== 0;
    }
    return fallback;
  }

  function readTooltipPreferenceCookie() {
    return normalizeTooltipPreference(getCookie(TOOLTIP_COOKIE_NAME), true);
  }

  function persistTooltipPreferenceCookie(enabled) {
    setCookie(TOOLTIP_COOKIE_NAME, enabled ? 'true' : 'false', TOOLTIP_COOKIE_MAX_AGE_SECONDS);
  }

  function readToastNotificationsPreferenceCookie() {
    return normalizeTooltipPreference(getCookie(TOAST_NOTIFICATIONS_COOKIE_NAME), true);
  }

  function persistToastNotificationsPreferenceCookie(enabled) {
    setCookie(TOAST_NOTIFICATIONS_COOKIE_NAME, enabled ? 'true' : 'false', TOOLTIP_COOKIE_MAX_AGE_SECONDS);
  }

  initTooltipSystem({ enabled: readTooltipPreferenceCookie() });

  upgradeButton(document.getElementById('googleLoginBtn'), {
    variant: 'neutral',
    position: 'relative'
  });

  let spectateController = null;
  const spectateUsernameMap = {};
  const spectateUsernamePriority = {};
  let spectatePickerOverlay = null;
  let spectatePickerStatusEl = null;
  let spectateMatchListEl = null;
  const spectateMatchesStore = createActiveMatchesStore();
  let spectateMatchesLoading = false;
  let spectateMatchesStatusMessage = '';
  const botUserIds = new Set();
  const botStatusCache = new Map();
  const botStatusRequests = new Map();
  spectateMatchesStore.subscribe((items) => {
    renderSpectateMatchList(items);
    updateSpectatePickerStatus(items);
  });

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

  let statsOverlayController = null;
  let rankedLeaderboardOverlay = null;
  let rankedLeaderboardStatusEl = null;
  let rankedLeaderboardListEl = null;
  let rankedLeaderboardContentScrollEl = null;
  let rankedLeaderboardFindBtn = null;
  let rankedLeaderboardPrevBtn = null;
  let rankedLeaderboardNextBtn = null;
  let rankedLeaderboardPageInfoEl = null;
  let rankedLeaderboardEntries = [];
  let rankedLeaderboardCurrentUser = null;
  let rankedLeaderboardLoading = false;
  let rankedLeaderboardRequestToken = 0;
  let accountTournamentHistoryOverlay = null;
  let accountTournamentHistoryStatusEl = null;
  let accountTournamentHistoryListEl = null;
  let rankedLeaderboardPagination = {
    page: 1,
    perPage: 100,
    totalItems: 0,
    totalPages: 0,
  };

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

  function getDesiredHistoryOverlayWidth() {
    if (playAreaRoot && playAreaRoot.clientWidth > 0) {
      return playAreaRoot.clientWidth;
    }
    const bounds = computePlayAreaBounds(window.innerWidth, window.innerHeight);
    return Math.max(0, Math.floor(bounds?.width || 0));
  }

  function isStatsOverlayOpen() {
    return Boolean(statsOverlayController && statsOverlayController.isOpen());
  }

  function openStatsOverlay() {
    if (!statsOverlayController) return;
    statsOverlayController.openDefaultUser();
  }

  function closeStatsOverlay() {
    if (!statsOverlayController) return;
    statsOverlayController.close();
  }

  function getCurrentLeaderboardUserId() {
    return sessionInfo && sessionInfo.userId ? String(sessionInfo.userId) : null;
  }

  function updateRankedLeaderboardFindButton() {
    if (!rankedLeaderboardFindBtn) return;
    rankedLeaderboardFindBtn.disabled = rankedLeaderboardLoading || !getCurrentLeaderboardUserId();
  }

  function updateRankedLeaderboardPaginationControls() {
    if (rankedLeaderboardPageInfoEl) {
      const { page, totalPages, totalItems } = rankedLeaderboardPagination;
      if (!totalItems) {
        rankedLeaderboardPageInfoEl.textContent = '0 players';
      } else if (totalPages > 1) {
        rankedLeaderboardPageInfoEl.textContent = `Page ${page} of ${totalPages} - ${totalItems} players`;
      } else {
        rankedLeaderboardPageInfoEl.textContent = `${totalItems} players`;
      }
    }

    if (rankedLeaderboardPrevBtn) {
      rankedLeaderboardPrevBtn.disabled = rankedLeaderboardLoading || rankedLeaderboardPagination.page <= 1;
    }
    if (rankedLeaderboardNextBtn) {
      rankedLeaderboardNextBtn.disabled = rankedLeaderboardLoading
        || rankedLeaderboardPagination.totalPages <= 1
        || rankedLeaderboardPagination.page >= rankedLeaderboardPagination.totalPages;
    }
  }

  function normalizeRankedLeaderboardPagination(pagination, entryCount) {
    const numericPerPage = Number(pagination?.perPage);
    const perPage = Number.isFinite(numericPerPage) && numericPerPage > 0
      ? Math.floor(numericPerPage)
      : 100;
    const numericTotalItems = Number(pagination?.totalItems);
    const totalItems = Number.isFinite(numericTotalItems) && numericTotalItems >= 0
      ? Math.floor(numericTotalItems)
      : entryCount;
    const numericTotalPages = Number(pagination?.totalPages);
    const totalPages = Number.isFinite(numericTotalPages) && numericTotalPages >= 0
      ? Math.floor(numericTotalPages)
      : (perPage > 0 ? Math.ceil(totalItems / perPage) : 0);
    const numericPage = Number(pagination?.page);
    const page = Number.isFinite(numericPage) && numericPage > 0
      ? Math.floor(numericPage)
      : 1;

    return {
      page,
      perPage,
      totalItems,
      totalPages,
    };
  }

  function findRankedLeaderboardRow(userId) {
    if (!rankedLeaderboardListEl || !userId) return null;
    return Array.from(rankedLeaderboardListEl.children).find((node) => (
      node
      && node.dataset
      && node.dataset.userId === String(userId)
    )) || null;
  }

  function scrollToRankedLeaderboardUser(userId, successMessage = '') {
    const row = findRankedLeaderboardRow(userId);
    if (!row) {
      return false;
    }
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (rankedLeaderboardStatusEl) {
      rankedLeaderboardStatusEl.textContent = successMessage || '';
    }
    return true;
  }

  function renderRankedLeaderboard(entries = [], { pagination, currentUser } = {}) {
    rankedLeaderboardEntries = Array.isArray(entries) ? entries : [];
    rankedLeaderboardCurrentUser = currentUser && typeof currentUser === 'object' ? currentUser : null;
    rankedLeaderboardPagination = normalizeRankedLeaderboardPagination(
      pagination,
      rankedLeaderboardEntries.length
    );
    updateRankedLeaderboardFindButton();
    updateRankedLeaderboardPaginationControls();
    if (!rankedLeaderboardListEl) return;
    rankedLeaderboardListEl.innerHTML = '';

    if (rankedLeaderboardEntries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'leaderboard-empty';
      empty.textContent = 'No ranked players found yet.';
      rankedLeaderboardListEl.appendChild(empty);
      return;
    }

    const currentUserId = getCurrentLeaderboardUserId();
    const startingRank = ((rankedLeaderboardPagination.page || 1) - 1) * (rankedLeaderboardPagination.perPage || 100);
    rankedLeaderboardEntries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'leaderboard-row';
      row.dataset.userId = entry.userId;
      if (currentUserId && entry.userId === currentUserId) {
        row.classList.add('leaderboard-row--current');
      }

      const main = document.createElement('div');
      main.className = 'leaderboard-row__main';

      const rank = document.createElement('span');
      rank.className = 'leaderboard-row__rank';
      rank.textContent = `${startingRank + index + 1}.`;

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'leaderboard-row__name leaderboard-row__name--interactive';
      name.textContent = entry.username || 'Unknown';
      name.title = entry.username || 'Unknown';
      name.addEventListener('click', (event) => {
        event.stopPropagation();
        if (rankedLeaderboardOverlay) {
          rankedLeaderboardOverlay.hide({ restoreFocus: false });
        }
        viewPlayerStats({
          userId: entry.userId,
          username: entry.username,
          elo: entry.elo
        });
      });

      const badge = createEloBadge({
        elo: entry.elo,
        size: 34,
        alt: `${entry.username || 'Player'} Elo`
      });

      main.appendChild(rank);
      main.appendChild(name);
      row.appendChild(main);
      row.appendChild(badge);
      rankedLeaderboardListEl.appendChild(row);
    });
  }

  async function loadRankedLeaderboardPage(page = 1, { focusUserId = null, successMessage } = {}) {
    const numericPage = Number(page);
    const safePage = Number.isFinite(numericPage) && numericPage > 0 ? Math.floor(numericPage) : 1;
    const requestToken = ++rankedLeaderboardRequestToken;
    const currentUserId = getCurrentLeaderboardUserId();

    rankedLeaderboardLoading = true;
    updateRankedLeaderboardFindButton();
    updateRankedLeaderboardPaginationControls();

    try {
      const params = new URLSearchParams();
      params.set('page', String(safePage));
      if (currentUserId) {
        params.set('userId', currentUserId);
      }

      const res = await authFetch(`/api/v1/users/rankedLeaderboard?${params.toString()}`, {
        method: 'GET',
        headers: { Accept: 'application/json' }
      });
      if (!res.ok) {
        throw new Error(`Leaderboard request failed (${res.status})`);
      }

      const payload = await res.json().catch(() => null);
      if (requestToken !== rankedLeaderboardRequestToken) {
        return;
      }

      const items = Array.isArray(payload)
        ? payload
        : (Array.isArray(payload?.items) ? payload.items : []);

      renderRankedLeaderboard(items, {
        pagination: payload?.pagination,
        currentUser: payload?.currentUser,
      });

      if (rankedLeaderboardContentScrollEl) {
        rankedLeaderboardContentScrollEl.scrollTop = 0;
      }

      if (focusUserId) {
        const didScroll = scrollToRankedLeaderboardUser(focusUserId, successMessage);
        if (!didScroll && rankedLeaderboardStatusEl) {
          rankedLeaderboardStatusEl.textContent = 'Your account is not on the ranked leaderboard yet.';
        }
      } else if (rankedLeaderboardStatusEl) {
        rankedLeaderboardStatusEl.textContent = '';
      }
    } catch (err) {
      if (requestToken !== rankedLeaderboardRequestToken) {
        return;
      }
      console.error('Failed to load ranked leaderboard', err);
      renderRankedLeaderboard([]);
      if (rankedLeaderboardStatusEl) {
        rankedLeaderboardStatusEl.textContent = 'Failed to load leaderboard.';
      }
    } finally {
      if (requestToken === rankedLeaderboardRequestToken) {
        rankedLeaderboardLoading = false;
        updateRankedLeaderboardFindButton();
        updateRankedLeaderboardPaginationControls();
      }
    }
  }

  function ensureRankedLeaderboardOverlay() {
    if (rankedLeaderboardOverlay) return rankedLeaderboardOverlay;

    rankedLeaderboardOverlay = createOverlay({
      baseClass: 'cg-overlay history-overlay',
      dialogClass: 'history-modal leaderboard-modal',
      contentClass: 'history-modal-content',
      backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
      closeButtonClass: 'history-close-btn',
      closeButtonVariant: 'danger',
      closeLabel: 'Close ranked list',
      closeText: '×',
      openClass: 'open cg-overlay--open',
      bodyOpenClass: 'history-overlay-open cg-overlay-open',
    });

    const { content } = rankedLeaderboardOverlay;
    content.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'history-overlay-header';

    const heading = document.createElement('h2');
    heading.id = 'rankedLeaderboardTitle';
    heading.className = 'spectate-picker-title';
    heading.textContent = 'Ranked';
    header.appendChild(heading);
    rankedLeaderboardOverlay.setLabelledBy(heading.id);

    rankedLeaderboardStatusEl = document.createElement('div');
    rankedLeaderboardStatusEl.className = 'leaderboard-overlay-status';

    const actions = document.createElement('div');
    actions.className = 'leaderboard-overlay-actions';

    const statusGroup = document.createElement('div');
    statusGroup.className = 'leaderboard-status-group';

    rankedLeaderboardFindBtn = createButton({
      id: 'rankedLeaderboardFindBtn',
      label: 'Find me',
      variant: 'neutral',
      position: 'relative'
    });
    rankedLeaderboardFindBtn.classList.add('leaderboard-find-btn');
    rankedLeaderboardFindBtn.addEventListener('click', async () => {
      const currentUserId = getCurrentLeaderboardUserId();
      if (!currentUserId || rankedLeaderboardLoading) return;
      if (scrollToRankedLeaderboardUser(currentUserId)) {
        return;
      }

      if (rankedLeaderboardCurrentUser && rankedLeaderboardCurrentUser.page > 0) {
        if (rankedLeaderboardStatusEl) {
          rankedLeaderboardStatusEl.textContent = 'Loading your ranking...';
        }
        await loadRankedLeaderboardPage(rankedLeaderboardCurrentUser.page, {
          focusUserId: currentUserId,
          successMessage: '',
        });
        return;
      }

      if (rankedLeaderboardStatusEl) {
        rankedLeaderboardStatusEl.textContent = 'Your account is not on the ranked leaderboard yet.';
      }
    });

    statusGroup.appendChild(rankedLeaderboardStatusEl);
    statusGroup.appendChild(rankedLeaderboardFindBtn);

    const paginationGroup = document.createElement('div');
    paginationGroup.className = 'leaderboard-pagination';

    rankedLeaderboardPrevBtn = createButton({
      id: 'rankedLeaderboardPrevBtn',
      label: 'Prev',
      variant: 'neutral',
      position: 'relative'
    });
    rankedLeaderboardPrevBtn.classList.add('leaderboard-page-btn');
    rankedLeaderboardPrevBtn.addEventListener('click', () => {
      if (rankedLeaderboardLoading || rankedLeaderboardPagination.page <= 1) return;
      if (rankedLeaderboardStatusEl) {
        rankedLeaderboardStatusEl.textContent = 'Loading leaderboard...';
      }
      loadRankedLeaderboardPage(rankedLeaderboardPagination.page - 1);
    });

    rankedLeaderboardPageInfoEl = document.createElement('div');
    rankedLeaderboardPageInfoEl.className = 'leaderboard-page-info';

    rankedLeaderboardNextBtn = createButton({
      id: 'rankedLeaderboardNextBtn',
      label: 'Next',
      variant: 'neutral',
      position: 'relative'
    });
    rankedLeaderboardNextBtn.classList.add('leaderboard-page-btn');
    rankedLeaderboardNextBtn.addEventListener('click', () => {
      if (
        rankedLeaderboardLoading
        || rankedLeaderboardPagination.totalPages <= 1
        || rankedLeaderboardPagination.page >= rankedLeaderboardPagination.totalPages
      ) {
        return;
      }
      if (rankedLeaderboardStatusEl) {
        rankedLeaderboardStatusEl.textContent = 'Loading leaderboard...';
      }
      loadRankedLeaderboardPage(rankedLeaderboardPagination.page + 1);
    });

    paginationGroup.appendChild(rankedLeaderboardPrevBtn);
    paginationGroup.appendChild(rankedLeaderboardPageInfoEl);
    paginationGroup.appendChild(rankedLeaderboardNextBtn);

    actions.appendChild(statusGroup);
    actions.appendChild(paginationGroup);

    rankedLeaderboardContentScrollEl = document.createElement('div');
    rankedLeaderboardContentScrollEl.className = 'history-overlay-content';

    rankedLeaderboardListEl = document.createElement('div');
    rankedLeaderboardListEl.className = 'leaderboard-list';
    rankedLeaderboardContentScrollEl.appendChild(rankedLeaderboardListEl);

    content.appendChild(header);
    content.appendChild(actions);
    content.appendChild(rankedLeaderboardContentScrollEl);

    updateRankedLeaderboardFindButton();
    updateRankedLeaderboardPaginationControls();
    return rankedLeaderboardOverlay;
  }

  async function openRankedLeaderboard() {
    const overlay = ensureRankedLeaderboardOverlay();
    rankedLeaderboardPagination = {
      page: 1,
      perPage: 100,
      totalItems: 0,
      totalPages: 0,
    };
    rankedLeaderboardCurrentUser = null;
    updateRankedLeaderboardFindButton();
    updateRankedLeaderboardPaginationControls();
    renderRankedLeaderboard([], {
      pagination: rankedLeaderboardPagination,
      currentUser: null,
    });
    if (rankedLeaderboardStatusEl) {
      rankedLeaderboardStatusEl.textContent = 'Loading leaderboard...';
    }
    overlay.show({ initialFocus: rankedLeaderboardFindBtn });
    await loadRankedLeaderboardPage(1);
  }

  function ensureAccountTournamentHistoryOverlay() {
    if (accountTournamentHistoryOverlay) return accountTournamentHistoryOverlay;

    accountTournamentHistoryOverlay = createOverlay({
      baseClass: 'cg-overlay history-overlay',
      dialogClass: 'history-modal tournament-modal',
      contentClass: 'history-modal-content tournament-modal__content',
      backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
      closeButtonClass: 'history-close-btn',
      closeButtonVariant: 'danger',
      closeLabel: 'Close tournament history',
      closeText: '×',
      openClass: 'open cg-overlay--open',
      bodyOpenClass: 'history-overlay-open cg-overlay-open',
    });

    const { content } = accountTournamentHistoryOverlay;
    content.innerHTML = '';

    const title = document.createElement('h2');
    title.id = 'accountTournamentHistoryTitle';
    title.className = 'tournament-modal__title';
    title.textContent = 'Completed Tournaments';
    accountTournamentHistoryOverlay.setLabelledBy(title.id);

    accountTournamentHistoryStatusEl = document.createElement('div');
    accountTournamentHistoryStatusEl.className = 'menu-message tournament-modal__status';

    accountTournamentHistoryListEl = document.createElement('div');
    accountTournamentHistoryListEl.className = 'tournament-browser-list';

    content.appendChild(title);
    content.appendChild(accountTournamentHistoryStatusEl);
    content.appendChild(accountTournamentHistoryListEl);
    return accountTournamentHistoryOverlay;
  }

  function renderAccountTournamentHistoryRows(tournaments = []) {
    if (!accountTournamentHistoryListEl) return;
    accountTournamentHistoryListEl.innerHTML = '';
    if (!Array.isArray(tournaments) || tournaments.length === 0) {
      return;
    }

    tournaments.forEach((row) => {
      const rowBtn = upgradeButton(document.createElement('button'), {
        variant: 'neutral',
        position: 'relative',
      });
      rowBtn.type = 'button';
      rowBtn.className = 'tournament-modal__button tournament-browser-row';
      const placementText = row.competed
        ? (row.placementLabel || 'Completed')
        : 'Hosted';
      const completedText = row.completedAt
        ? new Date(row.completedAt).toLocaleString()
        : 'Complete';
      rowBtn.innerHTML = `
        <span class="tournament-browser-row__title">${row.label || 'Tournament'}</span>
        <span class="tournament-browser-row__meta">${placementText}${row.hosted && row.competed ? ' · Hosted' : ''}</span>
        <span class="tournament-browser-row__meta">${completedText}</span>
      `;
      rowBtn.addEventListener('click', async () => {
        try {
          await tournamentUiController?.openHistoricalTournament?.(row.id);
          accountTournamentHistoryOverlay?.hide({ restoreFocus: false });
          closeMenu();
        } catch (err) {
          window.alert(err?.message || 'Unable to open tournament.');
        }
      });
      accountTournamentHistoryListEl.appendChild(rowBtn);
    });
  }

  async function openAccountTournamentHistory() {
    const overlay = ensureAccountTournamentHistoryOverlay();
    if (accountTournamentHistoryStatusEl) {
      accountTournamentHistoryStatusEl.textContent = 'Loading tournaments...';
    }
    renderAccountTournamentHistoryRows([]);
    overlay.show();
    try {
      const payload = await apiGetTournamentHistory();
      const tournaments = Array.isArray(payload?.tournaments) ? payload.tournaments : [];
      if (accountTournamentHistoryStatusEl) {
        accountTournamentHistoryStatusEl.textContent = tournaments.length
          ? `${tournaments.length} completed tournament(s)`
          : 'No completed tournaments yet.';
      }
      renderAccountTournamentHistoryRows(tournaments);
    } catch (err) {
      if (accountTournamentHistoryStatusEl) {
        accountTournamentHistoryStatusEl.textContent = err?.message || 'Unable to load tournaments.';
      }
      renderAccountTournamentHistoryRows([]);
    }
  }

  function normalizeBotId(id) {
    const normalized = normalizeId(id);
    return normalized ? String(normalized) : null;
  }

  function markBotStatus(id, isBot) {
    const normalized = normalizeBotId(id);
    if (!normalized) return;
    if (isBot) {
      botUserIds.add(normalized);
      botStatusCache.set(normalized, 'bot');
    } else {
      botUserIds.delete(normalized);
      botStatusCache.set(normalized, 'human');
    }
    if (statsOverlayController && typeof statsOverlayController.registerBotUser === 'function') {
      statsOverlayController.registerBotUser(normalized, Boolean(isBot));
    }
  }

  function isKnownBotId(id) {
    const normalized = normalizeBotId(id);
    if (!normalized) return false;
    return botUserIds.has(normalized);
  }

  function normalizeGuestId(id) {
    const normalized = normalizeId(id);
    return normalized ? String(normalized) : null;
  }

  function markGuestStatus(id, isGuest) {
    const normalized = normalizeGuestId(id);
    if (!normalized) return;
    if (isGuest) {
      guestUserIds.add(normalized);
    } else {
      guestUserIds.delete(normalized);
    }
  }

  function isKnownGuestId(id) {
    const normalized = normalizeGuestId(id);
    if (!normalized) return false;
    return guestUserIds.has(normalized);
  }

  function isLikelyBotName(name) {
    if (typeof name !== 'string') return false;
    return /bot$/i.test(name.trim());
  }

  async function ensureBotStatus(normalizedId) {
    if (!normalizedId) return false;
    const cached = botStatusCache.get(normalizedId);
    if (cached === 'bot') return true;
    if (cached === 'human') return false;
    if (botStatusRequests.has(normalizedId)) {
      return botStatusRequests.get(normalizedId);
    }
    const promise = (async () => {
      try {
        const res = await authFetch('/api/v1/users/getDetails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: normalizedId })
        });
        if (res && res.ok) {
          const data = await res.json().catch(() => null);
          const detectedBot = Boolean(data?.isBot);
          markBotStatus(normalizedId, detectedBot);
          return detectedBot;
        }
      } catch (err) {
        console.warn('Failed to determine bot status for user', normalizedId, err);
      }
      markBotStatus(normalizedId, false);
      return false;
    })();
    botStatusRequests.set(normalizedId, promise);
    const result = await promise;
    botStatusRequests.delete(normalizedId);
    return result;
  }

  async function shouldBlockStatsForUser(normalizedId, username) {
    if (!normalizedId) return true;
    if (botUserIds.has(normalizedId)) return true;
    const cached = botStatusCache.get(normalizedId);
    if (cached === 'bot') return true;
    if (cached === 'human') return false;
    if (isLikelyBotName(username)) {
      markBotStatus(normalizedId, true);
      return true;
    }
    return ensureBotStatus(normalizedId);
  }

  async function viewPlayerStats({ userId, username, elo, preventSelf = false } = {}) {
    if (!statsOverlayController) return;
    const normalizedId = normalizeId(userId);
    if (!normalizedId) return;
    const defaultId = typeof statsOverlayController.getDefaultUserId === 'function'
      ? statsOverlayController.getDefaultUserId()
      : null;
    if (preventSelf && defaultId && normalizedId === String(defaultId)) {
      return;
    }
    if (await shouldBlockStatsForUser(normalizedId, username)) {
      return;
    }
    statsOverlayController.openForUser({ userId: normalizedId, username, elo });
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

  if (rankedLeaderboardBtn) {
    rankedLeaderboardBtn.addEventListener('click', ev => {
      ev.stopPropagation();
      openRankedLeaderboard();
    });
  }

  if (tournamentBtn) {
    tournamentUiController = initTournamentUi({
      triggerButton: tournamentBtn,
      getSessionInfo: () => sessionInfo,
      onSessionRefresh: refreshSession,
      onSpectateMatch: (matchId) => {
        if (!matchId || !spectateController) return;
        spectateController.open(matchId);
      },
      registerSpectateUsername: setSpectateUsername,
      onParticipantStateChange: (isParticipant) => {
        tournamentParticipantMode = Boolean(isParticipant);
        updateFindButton();
      },
      onTournamentAcceptStateChange: ({ requiresAccept = false, currentUserGame = null } = {}) => {
        const gameId = currentUserGame?.gameId ? String(currentUserGame.gameId) : null;
        const color = Number.isInteger(currentUserGame?.color) ? currentUserGame.color : null;
        if (gameId && locallyAcceptedTournamentGames.has(gameId)) {
          return;
        }
        if (requiresAccept && gameId && color !== null) {
          stopClockInterval();
          gameFinished = false;
          isInSetup = false;
          selected = null;
          dragging = null;
          purgeDanglingDragArtifacts();
          currentDrawOffer = null;
          clearDrawCooldownTimeout();
          lastGameId = gameId;
          currentIsWhite = color === 0;
          tournamentAcceptScheduler.queue({
            gameId,
            color,
            startSeconds: Math.max(1, Number(currentUserGame?.acceptWindowSeconds) || 30),
          });
          return;
        }
        tournamentAcceptScheduler.clearPending({ preserveDeadline: false });
        tournamentAcceptScheduler.releaseGrace();
        if (activeBannerKind === 'tournament-accept') {
          clearBannerOverlay({ restoreFocus: false });
        } else if (isBannerVisible() && !shouldPreserveTournamentFinishedView()) {
          clearBannerOverlay({ restoreFocus: false });
        }
      },
    });
  }

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

  async function saveTooltipPreference(enabled) {
    const previousEnabled = normalizeTooltipPreference(sessionInfo.tooltipsEnabled, true);
    const nextEnabled = normalizeTooltipPreference(enabled, true);
    updateSessionInfo({ tooltipsEnabled: nextEnabled });

    if (!(sessionInfo.authenticated && sessionInfo.userId)) {
      return nextEnabled;
    }

    try {
      const res = await authFetch('/api/v1/users/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: sessionInfo.userId,
          tooltipsEnabled: nextEnabled,
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to update tooltip setting.');
      }
      const updated = await res.json().catch(() => null);
      const resolvedEnabled = normalizeTooltipPreference(updated?.tooltipsEnabled, nextEnabled);
      updateSessionInfo({ tooltipsEnabled: resolvedEnabled });
      return resolvedEnabled;
    } catch (error) {
      updateSessionInfo({ tooltipsEnabled: previousEnabled });
      throw error;
    }
  }

  async function saveToastNotificationsPreference(enabled) {
    const nextEnabled = normalizeTooltipPreference(enabled, true);
    updateSessionInfo({ toastNotificationsEnabled: nextEnabled });
    return nextEnabled;
  }

  function createAccountToggleRow({
    id,
    label,
    description = '',
    checked = true,
    onChange,
  }) {
    const row = document.createElement('div');
    row.className = 'menu-button menu-button--split account-setting-row';
    row.addEventListener('click', (event) => {
      event.stopPropagation();
    });

    const textWrap = document.createElement('div');
    textWrap.className = 'account-setting-row__text';

    const labelEl = document.createElement('span');
    labelEl.className = 'account-setting-row__label';
    labelEl.textContent = label;
    textWrap.appendChild(labelEl);

    if (description) {
      const descriptionEl = document.createElement('span');
      descriptionEl.className = 'account-setting-row__description';
      descriptionEl.textContent = description;
      textWrap.appendChild(descriptionEl);
    }

    const control = document.createElement('button');
    control.type = 'button';
    control.id = id;
    control.className = 'account-setting-row__toggle';
    control.setAttribute('aria-label', label);

    const thumb = document.createElement('span');
    thumb.className = 'account-setting-row__toggle-thumb';
    control.appendChild(thumb);

    row.appendChild(textWrap);
    row.appendChild(control);

    let lastCommittedValue = Boolean(checked);

    function applyToggleState(value) {
      const normalizedValue = Boolean(value);
      control.classList.toggle('account-setting-row__toggle--checked', normalizedValue);
      control.setAttribute('aria-pressed', normalizedValue ? 'true' : 'false');
    }

    applyToggleState(lastCommittedValue);

    async function commitToggle(nextValue) {
      control.disabled = true;
      row.classList.add('account-setting-row--pending');
      try {
        const committedValue = typeof onChange === 'function'
          ? await onChange(nextValue)
          : nextValue;
        lastCommittedValue = normalizeTooltipPreference(committedValue, nextValue);
        applyToggleState(lastCommittedValue);
      } catch (error) {
        console.error('Failed to update tooltip setting', error);
        applyToggleState(lastCommittedValue);
        alert(error?.message || 'Failed to update tooltip setting. Please try again.');
      } finally {
        control.disabled = false;
        row.classList.remove('account-setting-row--pending');
      }
    }

    if (typeof onChange === 'function') {
      control.addEventListener('click', async (event) => {
        event.stopPropagation();
        await commitToggle(!lastCommittedValue);
      });
      row.addEventListener('click', async (event) => {
        if (event.target && event.target.closest && event.target.closest('.account-setting-row__toggle')) {
          return;
        }
        await commitToggle(!lastCommittedValue);
      });
    }

    return { row, control };
  }

  function updateSessionInfo(partial = {}, { syncCookies = false } = {}) {
    if (partial.userId !== undefined) {
      sessionInfo.userId = partial.userId ? String(partial.userId) : null;
    }
    if (partial.username !== undefined) {
      sessionInfo.username = typeof partial.username === 'string' ? partial.username : '';
    }
    if (partial.tooltipsEnabled !== undefined) {
      sessionInfo.tooltipsEnabled = normalizeTooltipPreference(partial.tooltipsEnabled, true);
      persistTooltipPreferenceCookie(sessionInfo.tooltipsEnabled);
      setTooltipsEnabled(sessionInfo.tooltipsEnabled);
    }
    if (partial.toastNotificationsEnabled !== undefined) {
      sessionInfo.toastNotificationsEnabled = normalizeTooltipPreference(partial.toastNotificationsEnabled, true);
      persistToastNotificationsPreferenceCookie(sessionInfo.toastNotificationsEnabled);
    }

    let recomputeAuth = false;
    if (partial.isGuest !== undefined) {
      sessionInfo.isGuest = Boolean(partial.isGuest);
      recomputeAuth = partial.authenticated === undefined;
    }

    if (partial.authenticated !== undefined) {
      sessionInfo.authenticated = Boolean(partial.authenticated);
      if (partial.isGuest === undefined) {
        sessionInfo.isGuest = !sessionInfo.authenticated;
      }
    } else if (recomputeAuth) {
      sessionInfo.authenticated = !sessionInfo.isGuest;
    }

    setStoredUserId(sessionInfo.userId);
    if (sessionInfo.username) {
      setStoredUsername(sessionInfo.username);
    } else {
      setStoredUsername(null);
    }

    if (syncCookies) {
      if (sessionInfo.userId) {
        setCookie('userId', sessionInfo.userId, 60 * 60 * 24 * 365);
      } else {
        setCookie('userId', '', 0);
      }

      if (sessionInfo.username) {
        setCookie('username', sessionInfo.username, 60 * 60 * 24 * 365);
      } else {
        setCookie('username', '', 0);
      }

      if (sessionInfo.authenticated) {
        setCookie('photo', LOGGED_IN_AVATAR_SRC, 60 * 60 * 24 * 365);
      } else {
        setCookie('photo', '', 0);
      }
    }

    setUsernameDisplay();
    updateRankedLeaderboardFindButton();
  }

  function setUsernameDisplay() {
    let name = sessionInfo.username || '';
    if (!name) {
      try {
        name = localStorage.getItem('cg_username') || '';
      } catch (err) {
        console.warn('Unable to read cg_username from localStorage', err);
        name = '';
      }
    }
    if (!name) {
      name = getCookie('username') || '';
    }
    if (usernameDisplay) {
      usernameDisplay.textContent = name || '';
    }
  }

  async function updateAccountPanel() {
    let storedName = '';
    try {
      storedName = localStorage.getItem('cg_username') || '';
    } catch (err) {
      console.warn('Unable to read cg_username from localStorage', err);
      storedName = '';
    }

    const isAuthenticated = Boolean(sessionInfo.authenticated && sessionInfo.userId);

    if (isAuthenticated) {
      const sessionUserId = sessionInfo.userId;
      let userDetails = null;
      if (sessionUserId) {
        try {
          const res = await authFetch('/api/v1/users/getDetails', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: sessionUserId })
          });
          if (res.ok) {
            userDetails = await res.json().catch(() => null);
          }
        } catch (err) {
          console.error('Failed to fetch user details', err);
        }
      }

      const displayName = userDetails?.username || sessionInfo.username || storedName || '';
      const eloValue = Number.isFinite(userDetails?.elo) ? userDetails.elo : 800;
      const tooltipsEnabled = normalizeTooltipPreference(
        userDetails?.tooltipsEnabled,
        sessionInfo.tooltipsEnabled
      );

      if (displayName && displayName !== sessionInfo.username) {
        updateSessionInfo({ username: displayName });
      }
      if (tooltipsEnabled !== sessionInfo.tooltipsEnabled) {
        updateSessionInfo({ tooltipsEnabled });
      }

      if (statsOverlayController) {
        statsOverlayController.setDefaultUser({
          userId: sessionUserId,
          username: displayName,
          elo: eloValue
        });
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
      const editBtn = createButton({
        id: 'editUsername',
        label: 'Edit',
        variant: 'neutral',
        position: 'relative'
      });
      editBtn.classList.add('account__edit-button');

      usernameRow.appendChild(usernameSpan);
      usernameRow.appendChild(editBtn);

      const statsBtn = createButton({
        id: 'statsBtn',
        variant: 'neutral',
        position: 'relative'
      });
      statsBtn.classList.add('menu-button', 'menu-button--split');
      statsBtn.innerHTML = '';
      const statsLabel = document.createElement('span');
      statsLabel.textContent = 'Stats';
      statsLabel.style.flex = '1';
      statsLabel.style.textAlign = 'left';
      const statsBadge = createEloBadge({ elo: eloValue, size: 32, alt: 'Player Elo' });
      statsBadge.style.pointerEvents = 'none';
      statsBtn.appendChild(statsLabel);
      statsBtn.appendChild(statsBadge);

      const tournamentsBtn = createButton({
        id: 'tournamentsBtn',
        variant: 'neutral',
        position: 'relative'
      });
      tournamentsBtn.classList.add('menu-button', 'menu-button--split');
      tournamentsBtn.innerHTML = '';
      const tournamentsLabel = document.createElement('span');
      tournamentsLabel.textContent = 'Tournaments';
      tournamentsLabel.style.flex = '1';
      tournamentsLabel.style.textAlign = 'left';
      const tournamentsMeta = document.createElement('img');
      tournamentsMeta.src = '/assets/images/Tournament.png';
      tournamentsMeta.alt = 'Tournament';
      tournamentsMeta.style.width = '20px';
      tournamentsMeta.style.height = '20px';
      tournamentsMeta.style.objectFit = 'contain';
      tournamentsMeta.style.pointerEvents = 'none';
      tournamentsBtn.appendChild(tournamentsLabel);
      tournamentsBtn.appendChild(tournamentsMeta);

      const logoutBtn = createButton({
        id: 'logoutBtn',
        variant: 'danger',
        position: 'relative'
      });
      logoutBtn.classList.add('menu-button', 'menu-button--split');
      logoutBtn.innerHTML = '';
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
      logoutBtn.appendChild(logoutLabel);
      logoutBtn.appendChild(googleImg);
      logoutBtn.style.marginTop = 'auto';

      const tooltipToggle = createAccountToggleRow({
        id: 'accountTooltipsToggle',
        label: 'Tooltips',
        checked: tooltipsEnabled,
        onChange: saveTooltipPreference,
      });
      const toastNotificationsToggle = createAccountToggleRow({
        id: 'accountToastNotificationsToggle',
        label: 'Toast Notifications',
        checked: normalizeTooltipPreference(sessionInfo.toastNotificationsEnabled, true),
        onChange: saveToastNotificationsPreference,
      });

      accountPanelContent.appendChild(usernameRow);
      accountPanelContent.appendChild(statsBtn);
      accountPanelContent.appendChild(tournamentsBtn);
      accountPanelContent.appendChild(tooltipToggle.row);
      accountPanelContent.appendChild(toastNotificationsToggle.row);
      accountPanelContent.appendChild(logoutBtn);

      accountBtnImg.src = LOGGED_IN_AVATAR_SRC;
      setCookie('photo', LOGGED_IN_AVATAR_SRC, 60 * 60 * 24 * 365);
      if (usernameDisplay) {
        usernameDisplay.textContent = displayName;
      }

      statsBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        openStatsOverlay();
      });
      tournamentsBtn.addEventListener('click', async ev => {
        ev.stopPropagation();
        await openAccountTournamentHistory();
      });
      editBtn.addEventListener('click', async ev => {
        ev.stopPropagation();
        const currentUserId = sessionInfo.userId;
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
          const res = await authFetch('/api/v1/users/update', {
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
          updateSessionInfo({ username: updatedName }, { syncCookies: true });
          const playerIdx = currentPlayerIds.findIndex(id => id && id.toString() === currentUserId);
          if (playerIdx !== -1) {
            playerNames[playerIdx] = updatedName;
            renderBoardAndBars();
          }
          setUsernameDisplay();
          updateAccountPanel();
          if (socket && socket.connected) {
            try { socket.emit('user:updateName', { username: updatedName }); } catch (_) {}
          }
        } catch (error) {
          console.error('Failed to update username', error);
          alert('Failed to update username. Please try again.');
        }
      });
      logoutBtn.addEventListener('click', async ev => {
        ev.stopPropagation();
        try {
          const res = await fetch('/api/auth/logout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include'
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert(err.message || 'Failed to log out.');
            return;
          }
        } catch (error) {
          console.error('Failed to log out', error);
          alert('Failed to log out. Please try again.');
          return;
        }
        setStoredAuthToken(null);
        setStoredUserId(null);
        setStoredUsername(null);
        window.location.reload();
      });
    } else {
      if (statsOverlayController) {
        statsOverlayController.clearDefaultUser();
      }
      if (isStatsOverlayOpen()) {
        closeStatsOverlay();
      }
      const guestName = sessionInfo.username || storedName || '';
      accountPanelContent.style.alignItems = 'stretch';
      accountPanelContent.style.gap = '8px';
      accountPanelContent.innerHTML = '';

      const loginBtn = createButton({
        id: 'googleLoginBtn',
        variant: 'neutral',
        position: 'relative'
      });
      loginBtn.classList.add('menu-button');
      loginBtn.innerHTML = '';
      const loginImg = document.createElement('img');
      loginImg.src = GOOGLE_ICON_SRC;
      loginImg.alt = 'Google';
      const loginLabel = document.createElement('span');
      loginLabel.textContent = 'Sign in';
      loginBtn.appendChild(loginImg);
      loginBtn.appendChild(loginLabel);
      accountPanelContent.appendChild(loginBtn);

      if (guestName) {
        const guestMessage = document.createElement('div');
        guestMessage.className = 'menu-message';
        guestMessage.textContent = `Playing as ${guestName}`;
        accountPanelContent.appendChild(guestMessage);
      }

      const loginMessage = document.createElement('div');
      loginMessage.className = 'menu-message';
      loginMessage.textContent = 'Log in to see account history, statistics, elo, and participate in ranked matches.';
      accountPanelContent.appendChild(loginMessage);

      const tooltipToggle = createAccountToggleRow({
        id: 'guestTooltipsToggle',
        label: 'Tooltips',
        checked: normalizeTooltipPreference(sessionInfo.tooltipsEnabled, true),
        onChange: saveTooltipPreference,
      });
      const toastNotificationsToggle = createAccountToggleRow({
        id: 'guestToastNotificationsToggle',
        label: 'Toast Notifications',
        checked: normalizeTooltipPreference(sessionInfo.toastNotificationsEnabled, true),
        onChange: saveToastNotificationsPreference,
      });
      accountPanelContent.appendChild(tooltipToggle.row);
      accountPanelContent.appendChild(toastNotificationsToggle.row);

      accountBtnImg.src = ACCOUNT_ICON_SRC;
      setCookie('photo', '', 0);
      if (usernameDisplay) {
        usernameDisplay.textContent = guestName;
      }
      loginBtn.addEventListener('click', () => {
        const returnTo = encodeURIComponent(`${window.location.pathname || '/'}${window.location.search || ''}`);
        window.location.href = `/api/auth/google?returnTo=${returnTo}`;
      });
    }
  }

  async function refreshSession() {
    let sessionData = null;
    try {
      const res = await authFetch('/api/auth/session', {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) {
        throw new Error(`Session request failed (${res.status})`);
      }
      sessionData = await res.json().catch(() => null);

      if (sessionData) {
        const updates = {};
        if (sessionData.userId !== undefined) updates.userId = sessionData.userId;
        if (sessionData.username !== undefined) updates.username = sessionData.username;
        if (sessionData.isGuest !== undefined) updates.isGuest = Boolean(sessionData.isGuest);
        if (sessionData.authenticated !== undefined) updates.authenticated = Boolean(sessionData.authenticated);
        if (sessionData.tooltipsEnabled !== undefined) {
          updates.tooltipsEnabled = sessionData.tooltipsEnabled;
        } else if (sessionData.isGuest || sessionData.authenticated === false) {
          updates.tooltipsEnabled = readTooltipPreferenceCookie();
        }
        updates.toastNotificationsEnabled = readToastNotificationsPreferenceCookie();
        updateSessionInfo(updates, { syncCookies: Boolean(sessionData.isGuest) });
      }
    } catch (err) {
      console.warn('Failed to refresh session', err);
      let fallbackId = null;
      try {
        fallbackId = getCookie('userId') || getStoredUserId();
      } catch (idErr) {
        console.warn('Unable to read userId from storage', idErr);
      }
      let fallbackName = '';
      try {
        fallbackName = localStorage.getItem('cg_username') || '';
      } catch (nameErr) {
        console.warn('Unable to read cg_username from localStorage', nameErr);
      }
      if (!fallbackName) {
        fallbackName = getCookie('username') || '';
      }
      updateSessionInfo({
        userId: fallbackId || null,
        username: fallbackName || '',
        authenticated: false,
        isGuest: true,
        tooltipsEnabled: readTooltipPreferenceCookie(),
        toastNotificationsEnabled: readToastNotificationsPreferenceCookie(),
      });
    }

    await updateAccountPanel();
    return sessionInfo;
  }
  // Cookie helpers moved to modules/utils/cookies.js

  const ACTIONS = { SETUP: 0, MOVE: 1, CHALLENGE: 2, BOMB: 3, PASS: 4 };

  function getStoredUserId() {
    try {
      return localStorage.getItem('cg_userId');
    } catch (err) {
      console.warn('Unable to read cg_userId from localStorage', err);
      return null;
    }
  }

  function setStoredUserId(id) {
    try {
      if (id) {
        localStorage.setItem('cg_userId', id);
      } else {
        localStorage.removeItem('cg_userId');
      }
    } catch (err) {
      console.warn('Unable to persist cg_userId to localStorage', err);
    }
  }

  function setStoredUsername(name) {
    try {
      if (name) {
        localStorage.setItem('cg_username', name);
      } else {
        localStorage.removeItem('cg_username');
      }
    } catch (err) {
      console.warn('Unable to persist cg_username to localStorage', err);
    }
  }

  const TOKEN_STORAGE_KEY = 'cg_token';
  const TOKEN_COOKIE_NAME = 'cgToken';

  function getStoredAuthToken() {
    try {
      return localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch (err) {
      console.warn('Unable to read cg_token from localStorage', err);
      return null;
    }
  }

  function setStoredAuthToken(token) {
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (err) {
      console.warn('Unable to persist cg_token to localStorage', err);
    }
  }

  function ensureAuthToken() {
    const stored = getStoredAuthToken();
    if (stored) {
      setStoredAuthToken(null);
    }
    return null;
  }

  function authFetch(input, init = {}) {
    const headers = { ...(init && init.headers ? init.headers : {}) };
    return fetch(input, { credentials: 'include', ...init, headers });
  }

  if (!statsOverlayController) {
    statsOverlayController = createPlayerStatsOverlay({
      authFetch,
      getPreferredWidth: getDesiredHistoryOverlayWidth,
      getViewerUserId: () => sessionInfo?.userId || null
    });
  }

  // Retrieve stored user ID if present; server assigns one if missing
  async function ensureUserId() {
    if (sessionInfo.userId) {
      return sessionInfo.userId;
    }
    const refreshed = await refreshSession().catch(() => sessionInfo);
    if (refreshed && refreshed.userId) {
      return refreshed.userId;
    }
    return sessionInfo.userId;
  }

  let socket;
  let userId;
  let lastGameId = null;
  let bannerInterval = null;
  let bannerOverlay = null;
  let bannerKeyListener = null;
  let activeBannerKind = null;
  let activeBannerGameId = null;
  const locallyAcceptedTournamentGames = new Set();
  // Tournament accept timing is client-owned but server-authoritative:
  // the scheduler only decides when to surface the banner, while the server
  // still controls whether accept is required and when the accept window expires.
  const tournamentAcceptScheduler = createTournamentAcceptScheduler({
    showAcceptBanner: ({ gameId, color, startSeconds }) => {
      exitTournamentGameViewToPanel();
      showTournamentAcceptBanner({ gameId, color, startSeconds });
    },
    isLocallyAccepted: (gameId) => locallyAcceptedTournamentGames.has(String(gameId || '')),
    onDebug: emitLocalClockDebug,
  });
  let tournamentGameHydrationHandle = null;
  let tournamentGameHydrationGameId = null;
  let playAreaRoot = null;
  let isPlayAreaVisible = false;
  let queuerHidden = false;
  let currentMatch = null;
  let activeMatchId = null;

  // Simple board + bars state (plain page)
  let boardRoot = null;
  let boardView = null;
  let gameView = null;
  let topBar = null;
  let bottomBar = null;
  let stashRoot = null;
  let currentRows = 0;
  let currentCols = 0;
  let currentIsWhite = true;

  // Player identity state
  let sessionInfo = {
    userId: null,
    username: '',
    isGuest: true,
    authenticated: false,
    tooltipsEnabled: readTooltipPreferenceCookie(),
    toastNotificationsEnabled: readToastNotificationsPreferenceCookie(),
  };

  let playerNames = ['Anonymous0', 'Anonymous1'];
  let playerElos = [null, null];
  let currentPlayerIds = [];
  const playerProfileCache = new Map();
  const guestUserIds = new Set();
  const connectionStatusByPlayer = new Map();
  let customInvitePrompt = null;
  let botMatchPrompt = null;
  let activeIncomingInvite = null;
  const pendingOutgoingInvites = new Map();
  let lastInviteTargetName = null;

  // Live game state (masked per player)
  let currentBoard = null;        // 2D array of cells
  let currentStashes = [[], []];  // [white[], black[]]
  let currentOnDecks = [null, null];
  let currentCaptured = [[], []]; // pieces grouped by color index [white, black]
  let currentDaggers = [0, 0];
  let currentSquareSize = 0; // last computed board square size
  let currentPlayerTurn = null; // 0 or 1
  let currentOnDeckingPlayer = null; // player index currently selecting on-deck piece
  let postMoveOverlay = null; // { uiR, uiC, types: string[] }
  let lastPostMoveKey = null; // fingerprint of the last move we attached overlays for
  let pendingCapture = null; // { row, col, piece }
  let lastAction = null; // last action from server
  let lastMoveAction = null; // most recent MOVE or BOMB action from server
  let lastMove = null;   // last move from server
  let latestMoveContext = null; // canonical move context from actions/moves
  let moveHistory = [];  // cached normalized moves from server
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
  let gameToastSystem = null;
  let lastGameToastSnapshot = null;

  const DEFAULT_TIME_SETTINGS = {
    quickplayMs: 300000,
    rankedMs: 180000,
    customMs: 300000,
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
  let clockBaseSnapshot = null;
  let clockBaseGameId = null;
  let topClockEl = null;
  let bottomClockEl = null;
  let timeExpiredSent = false;

  const CLOCK_ACTIVE_CLASS = 'cg-clock-panel--active';

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
  const queuedState = { quickplay: false, ranked: false, bots: false };
  let pendingAction = null; // 'join' | 'leave' | null

  function ensureGameToastSystem() {
    if (!playAreaRoot) return null;
    if (!gameToastSystem) {
      gameToastSystem = createToastSystem({
        container: playAreaRoot,
        onPulseChange: () => {
          if (isPlayAreaVisible) {
            renderBoardAndBars();
          }
        },
        isToastStillValid: (toast) => {
          if (toast?.appearance !== 'board-turn') {
            return true;
          }
          if (currentPlayerTurn !== 0 && currentPlayerTurn !== 1) {
            return false;
          }
          const viewerColor = currentIsWhite ? 0 : 1;
          const expectedText = currentPlayerTurn === viewerColor ? 'Your turn!' : 'Opponent\'s turn';
          return toast.text === expectedText;
        },
      });
    } else {
      gameToastSystem.attach(playAreaRoot);
    }
    return gameToastSystem;
  }

  function getGameToastPulseRenderState() {
    const pulseState = gameToastSystem?.getPulseState?.() || { daggerKeys: [], capturedKeys: [] };
    const pulsingDaggerColors = (Array.isArray(pulseState.daggerKeys) ? pulseState.daggerKeys : [])
      .map((key) => Number.parseInt(String(key), 10))
      .filter((color) => color === 0 || color === 1);
    const pulsingCapturedByColor = [[], []];

    (Array.isArray(pulseState.capturedKeys) ? pulseState.capturedKeys : []).forEach((key) => {
      const [colorText, indexText] = String(key).split(':');
      const color = Number.parseInt(colorText, 10);
      const index = Number.parseInt(indexText, 10);
      if ((color === 0 || color === 1) && Number.isInteger(index) && index >= 0) {
        pulsingCapturedByColor[color].push(index);
      }
    });

    return {
      pulsingDaggerColors,
      pulsingCapturedByColor,
    };
  }

  function queueGameToastFeedback(feedback) {
    const system = ensureGameToastSystem();
    if (!system || !feedback) return;

    if (normalizeTooltipPreference(sessionInfo.toastNotificationsEnabled, true)) {
      system.enqueueAll(feedback.toasts);
    }

    const pulseEntries = [];
    (feedback.pulses?.daggerColors || []).forEach((entry) => {
      if (!entry || (entry.color !== 0 && entry.color !== 1)) return;
      pulseEntries.push({
        channel: 'dagger',
        key: String(entry.color),
        durationMs: entry.durationMs,
      });
    });
    (feedback.pulses?.captured || []).forEach((entry) => {
      if (!entry || (entry.color !== 0 && entry.color !== 1)) return;
      if (!Number.isInteger(entry.index) || entry.index < 0) return;
      pulseEntries.push({
        channel: 'captured',
        key: `${entry.color}:${entry.index}`,
        durationMs: entry.durationMs,
      });
    });
    system.triggerPulses(pulseEntries);
  }

  function syncVisibleTurnAnnouncement(gameLike) {
    const system = ensureGameToastSystem();
    if (!system) return;
    const currentTurn = gameLike?.playerTurn;
    const viewerColor = currentIsWhite ? 0 : 1;
    const expectedText = (currentTurn === 0 || currentTurn === 1)
      ? (currentTurn === viewerColor ? 'Your turn!' : 'Opponent\'s turn')
      : null;

    system.dismissWhere((toast) => (
      toast?.appearance === 'board-turn'
      && toast.text !== expectedText
    ));
  }

  function syncGameToastSnapshot(gameLike, options = {}) {
    const nextSnapshot = createGameToastSnapshot(gameLike);
    if (!nextSnapshot) {
      if (options.reset !== false) {
        lastGameToastSnapshot = null;
      }
      return;
    }

    syncVisibleTurnAnnouncement(gameLike);

    if (!options.silent) {
      const feedback = deriveGameToastFeedback({
        previous: lastGameToastSnapshot,
        current: nextSnapshot,
        viewerColor: currentIsWhite ? 0 : 1,
        viewMode: 'player',
      });
      queueGameToastFeedback(feedback);
    }

    lastGameToastSnapshot = nextSnapshot;
  }

  function clearGameToastFeedback({ resetSnapshot = false } = {}) {
    if (gameToastSystem) {
      gameToastSystem.clear();
    }
    if (resetSnapshot) {
      lastGameToastSnapshot = null;
    }
  }

  function showIllegalMoveToast() {
    const system = ensureGameToastSystem();
    if (!system) return;
    system.enqueue({
      text: 'Illegal move!',
      tone: 'danger',
      durationMs: 1000,
    });
  }

  function isBombActive() {
    return lastAction && lastAction.type === ACTIONS.BOMB;
  }

  function formatPlayerName(username, idx) {
    if (!username) {
      return 'Anonymous' + idx;
    }
    return username;
  }

  function resolveDisplayedPlayerName(userId, fallbackUsername, idx) {
    const normalizedId = userId != null ? String(userId) : '';
    const tournamentAlias = normalizedId ? spectateUsernameMap[normalizedId] : '';
    return formatPlayerName(tournamentAlias || fallbackUsername, idx);
  }

  async function loadPlayerNames(ids) {
    if (!Array.isArray(ids)) return;
    currentPlayerIds = ids.slice(0, 2);
    playerNames = currentPlayerIds.map((id, idx) => {
      const normalizedId = String(id || '');
      const tournamentAlias = normalizedId ? spectateUsernameMap[normalizedId] : '';
      if (tournamentAlias) {
        return formatPlayerName(tournamentAlias, idx);
      }
      const cached = playerProfileCache.get(String(id));
      return formatPlayerName(cached?.username, idx);
    });
    playerElos = currentPlayerIds.map((id) => {
      const cached = playerProfileCache.get(String(id));
      return Number.isFinite(cached?.elo) ? cached.elo : 800;
    });
    renderBoardAndBars();
    await Promise.all(currentPlayerIds.map(async (id, idx) => {
      try {
        const cacheKey = String(id);
        const tournamentAlias = spectateUsernameMap[cacheKey];
        const cached = playerProfileCache.get(cacheKey);
        if (cached && typeof cached.username === 'string') {
          playerNames[idx] = resolveDisplayedPlayerName(id, cached.username, idx);
          if (Number.isFinite(cached.elo)) {
            playerElos[idx] = cached.elo;
          }
          markBotStatus(id, Boolean(cached.isBot));
          markGuestStatus(id, Boolean(cached.isGuest));
          return;
        }

        const res = await authFetch('/api/v1/users/getDetails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: id })
        });
        if (res.ok) {
          const user = await res.json().catch(() => null);
          const normalizedUsername = resolveDisplayedPlayerName(id, user?.username, idx);
          const normalizedElo = Number.isFinite(user?.elo) ? user.elo : 800;
          playerNames[idx] = normalizedUsername;
          playerElos[idx] = normalizedElo;
          playerProfileCache.set(cacheKey, {
            username: tournamentAlias || formatPlayerName(user?.username, idx),
            elo: normalizedElo,
            isBot: Boolean(user?.isBot),
            isGuest: Boolean(user?.isGuest),
          });
          if (statsOverlayController) {
            const normalized = normalizeId(id);
            if (normalized) {
              statsOverlayController.registerKnownUsername(normalized, playerNames[idx]);
            }
          }
          markBotStatus(id, Boolean(user?.isBot));
          markGuestStatus(id, Boolean(user?.isGuest));
        }
      } catch (_) {}
    }));
    renderBoardAndBars();
  }

  function handleUserNameUpdated(payload) {
    if (!payload) return;
    const updatedName = typeof payload === 'string' ? payload : payload?.username;
    if (typeof updatedName !== 'string' || !updatedName.trim()) return;
    const normalizedName = updatedName.trim();
    const targetId = payload?.userId ? String(payload.userId) : null;
    const activeUserId = getStoredUserId() || userId;

    if (targetId) {
      const displayName = resolveDisplayedPlayerName(targetId, normalizedName, 0);
      const cached = playerProfileCache.get(targetId) || {};
      playerProfileCache.set(targetId, {
        ...cached,
        username: displayName,
      });
      const idx = currentPlayerIds.findIndex((id) => id && id.toString() === targetId);
      if (idx !== -1) {
        playerNames[idx] = resolveDisplayedPlayerName(targetId, normalizedName, idx);
        renderBoardAndBars();
      }
      if (statsOverlayController) {
        const statsName = idx !== -1
          ? playerNames[idx]
          : resolveDisplayedPlayerName(targetId, normalizedName, 0);
        statsOverlayController.registerKnownUsername(targetId, statsName);
        statsOverlayController.handleUsernameUpdate({ userId: targetId, username: statsName });
      }
    }

    const isSelfUpdate = !targetId || (activeUserId && String(activeUserId) === targetId);
    if (isSelfUpdate) {
      updateSessionInfo({ username: normalizedName }, { syncCookies: true });
      updateAccountPanel();
      if (activeUserId && statsOverlayController) {
        statsOverlayController.registerKnownUsername(activeUserId, normalizedName);
        statsOverlayController.handleUsernameUpdate({ userId: activeUserId, username: normalizedName });
      }
    }
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
    return resolveDisplayedClockMs({
      colorIdx,
      whiteTimeMs,
      blackTimeMs,
      expectedTimeControl,
      gameStartTime,
      hasAuthoritativeClock: Boolean(clockBaseSnapshot),
    });
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
    if (type === 'QUICKPLAY' || type === 'AI') {
      expectedTimeControl = timeSettings.quickplayMs;
    } else if (
      type === 'RANKED'
      || type === 'TOURNAMENT_ROUND_ROBIN'
      || type === 'TOURNAMENT_ELIMINATION'
    ) {
      expectedTimeControl = timeSettings.rankedMs;
    } else if (type === 'CUSTOM') {
      expectedTimeControl = timeSettings.customMs || timeSettings.quickplayMs;
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
    const custom = coerceMilliseconds(settings.customMs);
    if (custom !== null) timeSettings.customMs = custom;
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

    updateClockGlow();
  }

  function updateClockGlow() {
    if (topClockEl) topClockEl.classList.remove(CLOCK_ACTIVE_CLASS);
    if (bottomClockEl) bottomClockEl.classList.remove(CLOCK_ACTIVE_CLASS);

    const isPlayersClock = Boolean(
      Array.isArray(currentPlayerIds)
        && currentPlayerIds.length > myColor
        && currentPlayerIds[myColor]
        && userId
        && currentPlayerIds[myColor] === userId
    );

    if (!isPlayersClock || isInSetup || gameFinished) {
      return;
    }

    if (!(currentPlayerTurn === 0 || currentPlayerTurn === 1) || currentPlayerTurn !== myColor) {
      return;
    }

    const topColor = currentIsWhite ? 1 : 0;
    const bottomColor = currentIsWhite ? 0 : 1;

    if (myColor === topColor && topClockEl) {
      topClockEl.classList.add(CLOCK_ACTIVE_CLASS);
      return;
    }

    if (myColor === bottomColor && bottomClockEl) {
      bottomClockEl.classList.add(CLOCK_ACTIVE_CLASS);
    }
  }

  function syncClockBase(base, {
    gameId = null,
    debugEvent = 'client-clock-base-synced',
    debugPayload = null,
  } = {}) {
    clockBaseSnapshot = base || null;
    if (clockBaseSnapshot) {
      clockBaseGameId = gameId != null ? String(gameId) : clockBaseGameId;
    } else if (gameId != null) {
      clockBaseGameId = String(gameId);
    } else {
      clockBaseGameId = null;
    }
    if (clockBaseSnapshot) {
      const display = advanceClockSnapshot(clockBaseSnapshot, Date.now(), {
        startsAt: gameStartTime,
      });
      whiteTimeMs = display.whiteMs;
      blackTimeMs = display.blackMs;
      activeColor = display.activeColor;
    }
    updateClockDisplay();
    emitLocalClockDebug(debugEvent, {
      clockBaseGameId,
      serverClock: summarizeClockSnapshot(base),
      ...(debugPayload || {}),
    });
    const expired = whiteTimeMs <= 0 || blackTimeMs <= 0;
    if (expired && lastGameId && !timeExpiredSent) {
      timeExpiredSent = true;
      apiCheckTimeControl(lastGameId).catch(err => console.error('checkTimeControl failed', err));
    } else if (!expired) {
      timeExpiredSent = false;
    }
    if (gameFinished || !clockBaseSnapshot || (!clockBaseSnapshot.tickingWhite && !clockBaseSnapshot.tickingBlack)) {
      stopClockInterval();
      return false;
    }
    startClockInterval();
    return true;
  }

  function tickClock() {
    const now = Date.now();
    if (clockBaseSnapshot) {
      const display = advanceClockSnapshot(clockBaseSnapshot, now, {
        startsAt: gameStartTime,
      });
      whiteTimeMs = display.whiteMs;
      blackTimeMs = display.blackMs;
      activeColor = display.activeColor;
      updateClockDisplay();
      if (!timeExpiredSent && (whiteTimeMs <= 0 || blackTimeMs <= 0) && lastGameId) {
        timeExpiredSent = true;
        apiCheckTimeControl(lastGameId).catch(err => console.error('checkTimeControl failed', err));
      }
      return;
    }
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

  function recomputeClocksFromServer(serverClockSnapshot = null, { gameId = null } = {}) {
    const fallbackLabel = getClockLabel();
    const normalizedServerClock = normalizeClockSnapshot(serverClockSnapshot, {
      receivedAt: Date.now(),
      fallbackLabel,
    });
    if (normalizedServerClock) {
      syncClockBase(normalizedServerClock, { gameId });
      return;
    }

    if (shouldPreserveClockSnapshot({
      incomingClockSnapshot: serverClockSnapshot,
      currentClockSnapshot: clockBaseSnapshot,
      currentClockGameId: clockBaseGameId,
      incomingGameId: gameId,
      gameFinished,
      setupComplete,
      actionCount: Array.isArray(actionHistory) ? actionHistory.length : 0,
      moveCount: Array.isArray(moveHistory) ? moveHistory.length : 0,
      playerTurn: currentPlayerTurn,
    })) {
      syncClockBase(clockBaseSnapshot, {
        gameId,
        debugEvent: 'client-clock-base-preserved',
        debugPayload: { incomingClock: null },
      });
      return;
    }

    const baseTime = Number.isFinite(timeControl) && timeControl > 0
      ? timeControl
      : (Number.isFinite(expectedTimeControl) && expectedTimeControl > 0 ? expectedTimeControl : null);
    if (!baseTime) {
      clockBaseSnapshot = null;
      clockBaseGameId = null;
      updateClockDisplay();
      return;
    }

    const incValue = Number.isFinite(increment) && increment >= 0
      ? increment
      : (Number.isFinite(expectedIncrement) && expectedIncrement >= 0 ? expectedIncrement : 0);
    if (!Number.isFinite(increment) || increment < 0) {
      increment = incValue;
    }

    const actionStartCandidates = Array.isArray(actionHistory)
      ? actionHistory
          .map((action) => Date.parse(action?.timestamp))
          .filter((value) => Number.isFinite(value))
      : [];
    const inferredStartTime = actionStartCandidates.length > 0
      ? Math.min(...actionStartCandidates)
      : null;
    const effectiveStartTime = Number.isFinite(gameStartTime) ? gameStartTime : inferredStartTime;

    if (!effectiveStartTime) {
      whiteTimeMs = baseTime;
      blackTimeMs = baseTime;
      activeColor = null;
      clockBaseSnapshot = null;
      clockBaseGameId = null;
      stopClockInterval();
      updateClockDisplay();
      return;
    }

    const now = Date.now();
    const computed = computeGameClockState({
      baseTime,
      increment: incValue,
      startTime: effectiveStartTime,
      actions: actionHistory,
      setupComplete,
      playerTurn: currentPlayerTurn,
      isActive: !gameFinished,
      now,
    });

    syncClockBase(normalizeClockSnapshot({
      ...computed,
      label: fallbackLabel,
    }, {
      receivedAt: now,
      fallbackLabel,
    }), {
      gameId,
    });
  }

  function applyLocalMoveClock() {
    return false;
  }

  function updateFindButton() {
    if (tournamentParticipantMode) {
      hideQueuer();
      stopQueueTimer();
      queueTimerEl = null;
      return;
    }
    if (!isPlayAreaVisible) {
      showQueuer();
    }
    queueBtn.disabled = false;
    const awaitingServerQueueState = !queueStatusKnown && queueStartTime != null;
    const anyQueued = queuedState.quickplay || queuedState.ranked || queuedState.bots;
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

    const isQueued = Boolean(queuedState[mode]);
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
      onConnect() {
        console.log('[socket] connected');
      },
      async onInitialState(payload) {
        console.log('[socket] initialState', payload);
        queuedState.quickplay = Boolean(payload?.queued?.quickplay);
        queuedState.ranked = Boolean(payload?.queued?.ranked);
        queuedState.bots = Boolean(payload?.queued?.bots);
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
          // Otherwise, resolve whether this game still needs accept or should auto-ready.
          let colorIdx = -1;
          let isReady = false;
          try {
            colorIdx = Array.isArray(latest?.players)
              ? latest.players.findIndex(function(p){ return p === userId; })
              : -1;
            isReady = Array.isArray(latest?.playersReady) && colorIdx > -1
              ? Boolean(latest.playersReady[colorIdx])
              : false;
            const requiresTournamentAccept = resolveTournamentGameRequiresAccept(latest, currentMatch);
            currentIsWhite = (colorIdx === 0);

            if (colorIdx > -1 && !isReady) {
              if (tournamentParticipantMode) {
                if (requiresTournamentAccept) {
                  if (tournamentUiController) {
                    tournamentUiController.setTournamentGameActive(false);
                  }
                  tournamentAcceptScheduler.queue({
                    gameId: latest._id?.toString?.() || latest._id || null,
                    color: colorIdx,
                    startSeconds: Math.max(1, Number(latest?.acceptWindowSeconds) || 30),
                  });
                } else {
                  apiReady(latest._id, colorIdx).catch(function(err){ console.error('READY on reconnect failed', err); });
                }
              } else {
                console.log('[client] reconnect sending READY immediately', { gameId: latest._id, color: colorIdx });
                apiReady(latest._id, colorIdx).catch(function(err){ console.error('READY on reconnect failed', err); });
              }
            }
          } catch (e) { console.error('Error evaluating reconnect ready state', e); }

            // Adopt masked state immediately if present, and enter setup if needed
          try {
            if (Array.isArray(latest?.board)) {
              if (colorIdx > -1 && !isReady) {
                return;
              }
              if (tournamentParticipantMode && tournamentUiController) {
                tournamentUiController.setTournamentGameActive(true);
              }
              showPlayArea();
              currentRows = latest.board.length || 6;
              currentCols = latest.board[0]?.length || 5;
                setStateFromServer(latest, 'initialState');
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
              syncGameToastSnapshot(latest, { silent: true });
            }
          } catch (_) {}
        }
      } catch (_) {}
      },
      onQueueUpdate(payload) {

      if (!payload) return;
      queuedState.quickplay = Boolean(payload.quickplay);
      queuedState.ranked = Boolean(payload.ranked);
      queuedState.bots = Boolean(payload.bots);
      queueStatusKnown = true;
      pendingAction = null;
      updateFindButton();
      },
      async onGameUpdate(payload) {
        const snapshot = payload && payload.game ? payload.game : payload;
        logGameSnapshot('game:update', snapshot);
        try {
          if (!payload || !payload.gameId || !Array.isArray(payload.players)) return;
          const gameId = payload.gameId;
          const color = payload.players.findIndex(p => p === userId);
          if (color !== 0 && color !== 1) return;
          const wasShowingFinishedTournamentView = shouldPreserveTournamentFinishedView();

          if (payload.matchId) {
            activeMatchId = String(payload.matchId);
          }

          if (payload.matchId && (!currentMatch || String(currentMatch._id || '') !== String(payload.matchId))) {
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

          const incomingGameFinished = payload.winReason !== undefined && payload.winReason !== null;
          if (incomingGameFinished || !wasShowingFinishedTournamentView) {
            gameFinished = incomingGameFinished;
          }
          if (gameFinished) {
            stopClockInterval();
            selected = null;
            dragging = null;
            purgeDanglingDragArtifacts();
          }

          const playersReady = Array.isArray(payload.playersReady) ? payload.playersReady : [false, false];
          const myReady = Boolean(playersReady[color]);
          const bothPlayersReady = playersReady[0] === true && playersReady[1] === true;
          const shouldPreserveCountdownBanner = shouldPreserveMatchCountdownBanner({
            activeBannerKind,
            activeBannerGameId,
            incomingGameId: gameId,
            playersReady,
          });
          const requiresTournamentAccept = resolveTournamentGameRequiresAccept(payload, currentMatch);
          const awaitingTournamentAccept = Boolean(
            requiresTournamentAccept
            && !bothPlayersReady
          );

          hideQueuer();
          loadPlayerNames(payload.players);
          currentIsWhite = (color === 0);
          lastGameId = gameId;

          if (awaitingTournamentAccept) {
            stopClockInterval();
            if (!wasShowingFinishedTournamentView) {
              gameFinished = false;
              isInSetup = false;
              selected = null;
              dragging = null;
              purgeDanglingDragArtifacts();
            }
            if (tournamentUiController) {
              tournamentUiController.setTournamentGameActive(false);
            }
            if (!wasShowingFinishedTournamentView) {
              hidePlayArea();
            }
            if (!myReady && !locallyAcceptedTournamentGames.has(String(gameId))) {
              tournamentAcceptScheduler.queue({
                gameId: typeof gameId === 'string' ? gameId : String(gameId),
                color,
                startSeconds: Math.max(1, Number(payload?.acceptWindowSeconds) || 30),
              });
            } else {
              tournamentAcceptScheduler.clearPending({ preserveDeadline: true });
              if (!wasShowingFinishedTournamentView && activeBannerKind === 'tournament-accept') {
                clearBannerOverlay({ restoreFocus: false });
              }
            }
            return;
          }

          if (tournamentParticipantMode && !bothPlayersReady) {
            stopClockInterval();
            if (!wasShowingFinishedTournamentView) {
              gameFinished = false;
              isInSetup = false;
              selected = null;
              dragging = null;
              purgeDanglingDragArtifacts();
            }
            tournamentAcceptScheduler.clearPending({ preserveDeadline: false });
            tournamentAcceptScheduler.releaseGrace();
            tournamentAcceptScheduler.forgetDeadline(gameId);
            if (tournamentUiController) {
              tournamentUiController.setTournamentGameActive(false);
            }
            if (!wasShowingFinishedTournamentView) {
              hidePlayArea();
            }
            if (activeBannerKind === 'tournament-accept') {
              clearBannerOverlay({ restoreFocus: false });
            }
            return;
          }

          clearTournamentGameHydration();
          locallyAcceptedTournamentGames.delete(String(gameId));
          tournamentAcceptScheduler.clearPending({ preserveDeadline: false });
          tournamentAcceptScheduler.releaseGrace();
          tournamentAcceptScheduler.forgetDeadline(gameId);

          if (!shouldPreserveCountdownBanner) {
            clearBannerOverlay({ restoreFocus: false });
          }
          if (tournamentParticipantMode && tournamentUiController) {
            tournamentUiController.setTournamentGameActive(true);
          }
          showPlayArea();

          // If the server provided a board/state, adopt and render
          if (Array.isArray(payload.board)) {
            currentRows = payload.board.length || 6;
            currentCols = payload.board[0]?.length || 5;
            setStateFromServer(payload, 'game:update');
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
            syncGameToastSnapshot(payload);
          }
        } catch (e) {
          console.error('Error handling game:update', e);
        }
      },
      onGameFinished(payload) {
        console.log('[socket] game:finished', payload);
        const finishSnapshot = payload && payload.game ? payload.game : payload;
        logGameSnapshot('game:finished', finishSnapshot);
        clearTournamentGameHydration();
        emitLocalClockDebug('client-game-finished-received', {
          gameId: payload?.gameId || finishSnapshot?._id || finishSnapshot?.id || lastGameId || null,
          incomingClock: summarizeClockSnapshot(finishSnapshot?.clocks || null),
          winner: payload?.winner,
          winReason: payload?.winReason,
        });
        gameFinished = payload?.winReason !== undefined && payload?.winReason !== null;
        if (tournamentParticipantMode && tournamentUiController) {
          tournamentUiController.setTournamentGameActive(false);
        }
        stopClockInterval();
        selected = null;
        dragging = null;
        purgeDanglingDragArtifacts();
        currentDrawOffer = null;
        drawOfferCooldowns = [null, null];
        clearDrawCooldownTimeout();
        renderBoardAndBars();
        (async () => {
          try {
            const winnerIdx = payload?.winner;
            const finishedPlayerIds = Array.isArray(payload?.players)
              ? payload.players.map((id) => String(id))
              : (Array.isArray(finishSnapshot?.players) ? finishSnapshot.players.map((id) => String(id)) : []);
            const finishedColorIdx = finishedPlayerIds.findIndex((id) => id === String(userId || ''));
            const frozenPlayerNames = Array.isArray(playerNames) ? playerNames.slice(0, 2) : [];
            const winnerName = winnerIdx === 0 || winnerIdx === 1
              ? (frozenPlayerNames[winnerIdx] || formatPlayerName(null, winnerIdx))
              : null;
            const loserIdx = winnerIdx === 0 ? 1 : winnerIdx === 1 ? 0 : null;
            const loserName = loserIdx === 0 || loserIdx === 1
              ? (frozenPlayerNames[loserIdx] || formatPlayerName(null, loserIdx))
              : null;
            if (payload?.matchId) {
              activeMatchId = String(payload.matchId);
            }
            const match = await apiGetMatchDetails(payload.matchId);
            if (match?._id) {
              activeMatchId = String(match._id);
            }
            const updatedElos = syncPlayerElosFromMatch(match);
            if (updatedElos) {
              renderBoardAndBars();
            }
            showGameFinishedBanner({
              gameId: payload?.gameId || finishSnapshot?._id || lastGameId || null,
              winnerName,
              loserName,
              winnerColor: winnerIdx,
              didWin: winnerIdx === finishedColorIdx,
              match,
              matchIsActive: Boolean(payload?.matchIsActive),
              winReason: payload.winReason
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
              try {
                const nextResult = await apiNext(gameId, color);
                if (nextResult?.hasNextGame === false) {
                  const resolved = await resolveSettledPostGameMatch(currentMatch, {
                    finishedGameId: gameId || null,
                    fallbackActive: false,
                    attempts: 1,
                    delayMs: 0,
                  });
                  const latestMatch = resolved?.match || currentMatch || null;
                  clearBannerOverlay({ restoreFocus: false });
                  if (tournamentParticipantMode) {
                    exitTournamentGameViewToPanel();
                  }
                  showMatchSummary(latestMatch, { finishedGameId: gameId || null, force: true });
                  return;
                }
              } catch (e) {
                console.error('auto next failed', e);
              }
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
          console.log('[socket] players:bothNext received', payload);
          const { gameId, color, requiresAccept, acceptWindowSeconds } = payload || {};
          if (!gameId) return;

          const nextGameId = typeof gameId === 'string' ? gameId : String(gameId);
          const currentGameNumber = Number.isFinite(Number(payload?.currentGameNumber))
            ? Number(payload.currentGameNumber)
            : 1;
          const isCurrentActiveGame =
            nextGameId === (typeof lastGameId === 'string' ? lastGameId : String(lastGameId || '')) &&
            !gameFinished;

          if (isCurrentActiveGame) {
            // Suppress countdown banner if this is simply a reconnect to the current live game.
            return;
          }

          lastGameId = nextGameId;
          if (requiresAccept) {
            tournamentAcceptScheduler.queue({
              gameId: nextGameId,
              color,
              startSeconds: Number(acceptWindowSeconds) || 30,
            });
            return;
          }
          clearBannerOverlay({ restoreFocus: false });
          showMatchFoundBanner(3, async function(remaining) {
            if (remaining === 0) {
              try { await apiReady(nextGameId, color); } catch (e) { console.error('Failed to ready after next', e); }
            }
          }, {
            gameId: nextGameId,
            currentGameNumber,
            countdownEndsAt: payload?.startTime || null,
          });
        } catch (e) { console.error('players:bothNext handler failed', e); }
      },
      async onBothReady(payload) {
        try {
          clearTournamentGameHydration();
          tournamentAcceptScheduler.clearPending({ preserveDeadline: false });
          tournamentAcceptScheduler.releaseGrace();
          tournamentAcceptScheduler.forgetDeadline(payload?.gameId || lastGameId);
          clearBannerOverlay({ restoreFocus: false });
          const gameId = payload?.gameId || lastGameId;
          if (!gameId) return;
          const view = await apiGetDetails(gameId, null);
          if (!view) return;
          await activateLiveGameViewFromState(view, 'players:bothReady');
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
      onInviteRequest(payload) {
        handleCustomInviteRequest(payload);
      },
      onInviteResult(payload) {
        handleCustomInviteResult(payload);
      },
      onInviteCancel(payload) {
        handleCustomInviteCancel(payload);
      },
      onUserNameUpdated(payload) {
        handleUserNameUpdated(payload);
      },
      onTournamentUpdated(payload) {
        if (tournamentUiController && typeof tournamentUiController.handleTournamentUpdated === 'function') {
          tournamentUiController.handleTournamentUpdated(payload);
        }
      },
      onDisconnect() { /* keep UI; server handles grace */ }
    });
    socket.on('spectate:snapshot', (payload) => {
      logGameSnapshot('spectate:snapshot', payload && payload.game ? payload.game : payload);
      if (spectateController) {
        spectateController.handleSnapshot(payload);
      }
    });

    socket.on('spectate:update', (payload) => {
      logGameSnapshot('spectate:update', payload && payload.game ? payload.game : payload);
      if (spectateController) {
        spectateController.handleUpdate(payload);
      }
    });

    socket.on('spectate:error', (payload) => {
      if (spectateController) {
        spectateController.handleError(payload);
      }
    });

    socket.on('user:init', (payload) => {
      const payloadUserId = payload?.userId ? String(payload.userId) : null;
      const payloadUsername = typeof payload?.username === 'string' ? payload.username : undefined;
      const isGuest = Boolean(payload?.guest);
      const hasAuthenticatedSession = Boolean(sessionInfo?.authenticated && sessionInfo?.userId);
      const shouldIgnoreGuestDowngrade = Boolean(isGuest && hasAuthenticatedSession);

      if (shouldIgnoreGuestDowngrade) {
        // Socket handshakes can race the auth refresh path. Keep the current
        // authenticated identity and let /session remain source of truth.
        refreshSession().catch(() => null);
        updateAccountPanel();
        return;
      }

      const updates = {
        isGuest,
        authenticated: !isGuest,
      };
      if (payloadUserId) {
        updates.userId = payloadUserId;
      }
      if (payloadUsername !== undefined) {
        updates.username = payloadUsername;
      }

      updateSessionInfo(updates, { syncCookies: isGuest });
      if (!isGuest) {
        setCookie('photo', LOGGED_IN_AVATAR_SRC, 60 * 60 * 24 * 365);
      } else {
        setCookie('photo', '', 0);
      }

      userId = sessionInfo.userId || userId;
      updateAccountPanel();
    });
  }

  async function enterQueue(mode) {
    const activeUserId = sessionInfo.userId || getStoredUserId() || userId;
    console.log('[action] enterQueue', { userId: activeUserId, mode });
    const result = mode === 'ranked' ? await apiEnterRankedQueue() : await apiEnterQueue();
    console.log('[action] enterQueue response', result);

    if (result && (result.userId || result.username)) {
      updateSessionInfo({
        ...(result.userId ? { userId: result.userId } : {}),
        ...(result.username ? { username: result.username } : {}),
      });
      userId = sessionInfo.userId || userId;
    }

    return result;
  }

  async function exitQueue(mode) {
    const activeUserId = sessionInfo.userId || getStoredUserId() || userId;
    console.log('[action] exitQueue', { userId: activeUserId, mode });
    const result = mode === 'ranked' ? await apiExitRankedQueue() : await apiExitQueue();
    console.log('[action] exitQueue response', result);

    if (result && (result.userId || result.username)) {
      updateSessionInfo({
        ...(result.userId ? { userId: result.userId } : {}),
        ...(result.username ? { username: result.username } : {}),
      });
      userId = sessionInfo.userId || userId;
    }

    return result;
  }

  queueBtn.addEventListener('click', async function() {
    let mode = modeSelect.value;

    if (mode === 'spectate') {
      openSpectatePicker();
      return;
    }

    if (mode === 'bots') {
      showDynamicBotMatchPrompt();
      return;
    }

    if (mode === 'custom') {
      showCustomInvitePrompt();
      return;
    }

    const awaitingServerQueueState = !queueStatusKnown && queueStartTime != null;
    if (awaitingServerQueueState && queueStartMode && mode !== queueStartMode) {
      mode = queueStartMode;
      modeSelect.value = queueStartMode;
    }
    const isQueued = queuedState[mode];
    const currentlyQueued = isQueued || (awaitingServerQueueState && (!queueStartMode || queueStartMode === mode));
    const actionMode = currentlyQueued && queueStartMode ? queueStartMode : mode;
    console.log('[ui] click queueBtn', { mode, pendingAction, isQueued, awaitingServerQueueState, currentlyQueued, actionMode });
    const RANKED_LOGIN_REQUIRED_MESSAGE = 'Please log in to play ranked.';
    if (actionMode === 'ranked') {
      const hasAuthenticatedSession = Boolean(sessionInfo?.authenticated && sessionInfo?.userId);
      if (!hasAuthenticatedSession && !allowGuestRankedQueue) {
        window.alert(RANKED_LOGIN_REQUIRED_MESSAGE);
        return;
      }
    }

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

      const alertMessage = (e && e.data && e.data.message) || e?.message;
      if (
        alertMessage &&
        (actionMode === 'ranked' || alertMessage === RANKED_LOGIN_REQUIRED_MESSAGE)
      ) {
        window.alert(alertMessage);
      }
    }
  });

  // Fallback UI state
  updateFindButton();

  (async function init() {
    try {
      await refreshSession();
      userId = sessionInfo.userId || null;
      if (!userId) {
        userId = await ensureUserId();
      }
      if (tournamentUiController) {
        await tournamentUiController.restoreCurrentTournament();
        const params = new URLSearchParams(window.location.search || '');
        const adminTournamentId = params.get('adminTournamentId');
        const archiveTournamentId = params.get('archiveTournamentId');
        if (!tournamentUiController.hasPersistentTournament()) {
          if (adminTournamentId) {
            await tournamentUiController.openHistoricalTournament(adminTournamentId, { admin: true });
          } else if (archiveTournamentId) {
            await tournamentUiController.openHistoricalTournament(archiveTournamentId);
          }
        }
      }
      console.log('[init] userId', userId);
      try {
        const settings = await apiGetTimeSettings();
        if (settings) updateTimeSettings(settings);
      } catch (cfgErr) {
        console.warn('Failed to load time settings', cfgErr);
      }
      preloadPieceImages();
      preloadBubbleImages();
      socket = io('/', { withCredentials: true, autoConnect: false });
      spectateController = createSpectateController({
        overlayEl: spectateOverlay,
        playAreaEl: spectatePlayArea,
        boardEl: spectateBoardEl,
        topBarEl: spectateTopBar,
        bottomBarEl: spectateBottomBar,
        statusEl: spectateStatusEl,
        scoreEl: spectateScoreEl,
        bannerEl: spectateBannerEl,
        metaEl: spectateMetaEl,
        titleEl: spectateTitleEl,
        closeButtonEl: spectateCloseBtn,
        socket,
        getUsername: getSpectateUsername,
        setUsername: setSpectateUsername,
        shouldAllowPlayerClick: (id) => !isKnownBotId(id),
        onPlayerClick: (info) => {
          if (!info || !info.userId) return;
          if (isKnownBotId(info.userId)) return;
          viewPlayerStats({
            userId: info.userId,
            username: info.username || info.name,
            elo: info.elo
          });
        },
      });
      wireSocket();
      socket.connect();
    } catch (e) {
      console.error(e);
    }
  })();


  // ------- Spectate helpers -------
  function getSpectateUsername(id) {
    if (!id) return 'Unknown';
    const key = String(id);
    if (!key) return 'Unknown';
    return spectateUsernameMap[key] || key;
  }

  function setSpectateUsername(id, username, options = {}) {
    if (!id) return;
    const key = String(id);
    if (!key) return;
    if (typeof username === 'string' && username.trim()) {
      const trimmed = username.trim();
      const nextPriority = Number.isFinite(Number(options?.priority)) ? Number(options.priority) : 0;
      const currentPriority = Number.isFinite(Number(spectateUsernamePriority[key]))
        ? Number(spectateUsernamePriority[key])
        : Number.NEGATIVE_INFINITY;
      if (currentPriority > nextPriority && spectateUsernameMap[key]) {
        return;
      }
      spectateUsernameMap[key] = trimmed;
      spectateUsernamePriority[key] = nextPriority;
      const activeIndex = currentPlayerIds.findIndex((playerId) => String(playerId || '') === key);
      if (activeIndex !== -1) {
        playerNames[activeIndex] = resolveDisplayedPlayerName(key, trimmed, activeIndex);
        renderBoardAndBars();
      }
      if (statsOverlayController) {
        statsOverlayController.registerKnownUsername(key, trimmed);
      }
    }
  }

  function ensureSpectatePickerOverlay() {
    if (spectatePickerOverlay) return spectatePickerOverlay;
    spectatePickerOverlay = createOverlay({
      baseClass: 'cg-overlay spectate-picker-overlay',
      dialogClass: 'history-modal',
      contentClass: 'history-modal-content',
      backdropClass: 'cg-overlay__backdrop history-overlay-backdrop',
      closeButtonClass: 'history-close-btn',
      closeLabel: 'Close spectate browser',
      closeText: '✕',
      openClass: 'open cg-overlay--open',
      bodyOpenClass: 'history-overlay-open cg-overlay-open',
    });
    const { content } = spectatePickerOverlay;
    if (content) {
      content.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'spectate-picker-header';
      const title = document.createElement('h2');
      title.id = 'spectatePickerTitle';
      title.className = 'spectate-picker-title';
      title.textContent = 'Active Matches';
      header.appendChild(title);
      const status = document.createElement('div');
      status.id = 'spectatePickerStatus';
      status.className = 'spectate-picker-status';
      header.appendChild(status);
      content.appendChild(header);
      const list = document.createElement('div');
      list.id = 'spectateMatchList';
      list.className = 'tableList';
      content.appendChild(list);
      spectatePickerStatusEl = status;
      spectateMatchListEl = list;
      if (typeof spectatePickerOverlay.setLabelledBy === 'function') {
        spectatePickerOverlay.setLabelledBy(title.id);
      }
    }
    return spectatePickerOverlay;
  }

  function renderSpectateMatchList(items) {
    if (!spectateMatchListEl) return;
    const list = Array.isArray(items) ? items : spectateMatchesStore.getItems();
    renderActiveMatchesList(spectateMatchListEl, list, {
      getUsername: getSpectateUsername,
      onSpectate: (item) => {
        if (spectatePickerOverlay) spectatePickerOverlay.hide();
        if (item?.id && spectateController) {
          spectateController.open(item.id);
        }
      },
      onPlayerClick: (info) => {
        if (!info || !info.userId) return;
        if (isKnownBotId(info.userId)) return;
        viewPlayerStats({
          userId: info.userId,
          username: info.username || info.userId,
          elo: info.elo
        });
      },
      shouldAllowPlayerClick: (id) => !isKnownBotId(id),
    });
  }

  function updateSpectatePickerStatus(items) {
    if (!spectatePickerStatusEl) return;
    const list = Array.isArray(items) ? items : spectateMatchesStore.getItems();
    if (spectateMatchesStatusMessage) {
      spectatePickerStatusEl.textContent = spectateMatchesStatusMessage;
      return;
    }
    if (spectateMatchesLoading) {
      spectatePickerStatusEl.textContent = 'Loading matches…';
      return;
    }
    spectatePickerStatusEl.textContent = list.length ? '' : 'No active matches available right now.';
  }

  async function fetchSpectateMatches() {
    spectateMatchesLoading = true;
    spectateMatchesStatusMessage = 'Loading matches…';
    updateSpectatePickerStatus();
    try {
      const data = await fetchActiveMatchesList({ includeUsers: true });
      if (Array.isArray(data)) {
        data.forEach((match) => {
          const details = match?.playerDetails || {};
          const p1 = details.player1;
          const p2 = details.player2;
          if (p1?.id) {
            setSpectateUsername(p1.id, p1.username || p1.id);
            markBotStatus(p1.id, Boolean(p1?.isBot));
          }
          if (p2?.id) {
            setSpectateUsername(p2.id, p2.username || p2.id);
            markBotStatus(p2.id, Boolean(p2?.isBot));
          }
        });
      }
      spectateMatchesLoading = false;
      spectateMatchesStatusMessage = '';
      spectateMatchesStore.replaceAll(Array.isArray(data) ? data : []);
      updateSpectatePickerStatus();
    } catch (err) {
      console.error('Failed to load active matches for spectating', err);
      spectateMatchesLoading = false;
      spectateMatchesStatusMessage = 'Unable to load active matches.';
      spectateMatchesStore.clear();
      updateSpectatePickerStatus();
    }
  }

  function openSpectatePicker() {
    const overlay = ensureSpectatePickerOverlay();
    if (!overlay) return;
    overlay.show();
    spectateMatchesLoading = true;
    spectateMatchesStatusMessage = 'Loading matches…';
    renderSpectateMatchList();
    updateSpectatePickerStatus();
    fetchSpectateMatches();
  }

  // ------- Match Found Banner helpers -------
  function ensureBannerOverlay() {
    if (bannerOverlay) return bannerOverlay;
    bannerOverlay = createOverlay({
      baseClass: 'cg-overlay cg-overlay--banner',
      dialogClass: 'cg-overlay__dialog cg-overlay__dialog--banner',
      contentClass: 'cg-overlay__content cg-overlay__content--banner',
      backdropClass: 'cg-overlay__backdrop cg-overlay__backdrop--banner',
      closeButtonClass: 'cg-overlay__close cg-overlay__close--banner',
      closeLabel: 'Close banner',
      closeText: '✕',
      showCloseButton: false,
      closeOnBackdrop: false,
      openClass: 'cg-overlay--open cg-overlay--banner-open',
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

  function setActiveBanner(kind = null, gameId = null) {
    activeBannerKind = kind || null;
    activeBannerGameId = gameId !== null && gameId !== undefined ? String(gameId) : null;
  }

  function clearBannerOverlay({ restoreFocus = false } = {}) {
    if (bannerInterval) {
      clearInterval(bannerInterval);
      bannerInterval = null;
    }
    setBannerKeyListener(null);
    setActiveBanner(null, null);
    if (bannerOverlay) {
      try {
        if (bannerOverlay.content) {
          bannerOverlay.content.innerHTML = '';
        }
        bannerOverlay.hide({ restoreFocus });
      } catch (err) {
        console.warn('Failed to hide banner overlay', err);
      }
    }
  }

  function showInviteDeclinedBanner(name, status = 'declined') {
    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    setBannerKeyListener(null);
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    content.innerHTML = '';
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';

    function closeBanner() {
      content.innerHTML = '';
      overlay.hide();
      setBannerKeyListener(null);
    }

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

    const safeName = name ? String(name) : 'opponent';
    const message = document.createElement('div');
    message.textContent = status === 'cancelled'
      ? `Invite to ${safeName} cancelled.`
      : `Invite to ${safeName} declined.`;
    message.style.fontSize = clamp(Math.round(20 * modalScale), 14, 20) + 'px';
    message.style.fontWeight = '600';
    message.style.lineHeight = '1.4';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.justifyContent = 'center';
    buttons.style.marginTop = clamp(Math.round(12 * modalScale), 8, 12) + 'px';

    const okBtn = createButton({
      label: 'OK',
      variant: 'primary',
      position: 'relative'
    });
    okBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(18 * modalScale), 12, 18)}px`);
    okBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    okBtn.style.setProperty('--cg-button-font-weight', '700');
    okBtn.style.minWidth = '120px';

    buttons.appendChild(okBtn);
    card.appendChild(message);
    card.appendChild(buttons);
    content.appendChild(card);

    okBtn.addEventListener('click', () => { closeBanner(); });

    overlay.show({ initialFocus: okBtn });
  }

  function showCustomInvitePrompt() {
    if (!socket) {
      window.alert('Unable to send invite right now. Please try again shortly.');
      return;
    }

    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    setBannerKeyListener(null);
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    content.innerHTML = '';
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';

    const prompt = {};

    function closeBanner() {
      content.innerHTML = '';
      overlay.hide();
      setBannerKeyListener(null);
      if (customInvitePrompt === prompt) {
        customInvitePrompt = null;
      }
    }

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
    card.style.maxWidth = '400px';
    card.style.width = '90%';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = cardGap + 'px';

    const title = document.createElement('div');
    title.textContent = 'Custom Game Invite';
    title.style.fontSize = clamp(Math.round(24 * modalScale), 16, 24) + 'px';
    title.style.fontWeight = '700';

    const description = document.createElement('div');
    description.textContent = 'Enter a username to send an invite.';
    description.style.fontSize = clamp(Math.round(16 * modalScale), 12, 16) + 'px';
    description.style.lineHeight = '1.4';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Username';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.style.padding = `${clamp(Math.round(10 * modalScale), 8, 12)}px ${clamp(Math.round(12 * modalScale), 10, 16)}px`;
    input.style.border = '2px solid var(--CG-deep-gold)';
    input.style.borderRadius = '4px';
    input.style.fontSize = clamp(Math.round(18 * modalScale), 14, 18) + 'px';
    input.style.fontWeight = '600';
    input.style.background = 'var(--CG-white)';
    input.style.color = 'var(--CG-black)';
    input.value = lastInviteTargetName || '';

    const statusEl = document.createElement('div');
    statusEl.style.minHeight = clamp(Math.round(18 * modalScale), 14, 18) + 'px';
    statusEl.style.fontSize = clamp(Math.round(14 * modalScale), 12, 14) + 'px';
    statusEl.style.fontWeight = '600';
    statusEl.style.color = 'var(--CG-light-gold)';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = clamp(Math.round(12 * modalScale), 8, 12) + 'px';
    buttons.style.justifyContent = 'center';

    const cancelBtn = createButton({
      label: 'Cancel',
      variant: 'danger',
      position: 'relative'
    });
    cancelBtn.style.flex = '1';
    cancelBtn.style.minWidth = '0';
    cancelBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    cancelBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    cancelBtn.style.setProperty('--cg-button-font-weight', '700');

    const sendBtn = createButton({
      label: 'Send invite',
      variant: 'primary',
      position: 'relative'
    });
    sendBtn.style.flex = '1';
    sendBtn.style.minWidth = '0';
    sendBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    sendBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    sendBtn.style.setProperty('--cg-button-font-weight', '700');

    function resetButtons() {
      sendBtn.disabled = false;
      cancelBtn.disabled = false;
      sendBtn.textContent = 'Send invite';
    }

    function handleFailure(message) {
      statusEl.textContent = message;
      resetButtons();
      if (input) {
        input.focus();
        input.select();
      }
    }

    function sendInvite() {
      const target = input.value.trim();
      if (!target) {
        statusEl.textContent = 'Please enter a username.';
        input.focus();
        return;
      }
      if (!socket || !socket.connected) {
        window.alert('Unable to send invite right now. Please try again shortly.');
        return;
      }
      sendBtn.disabled = true;
      cancelBtn.disabled = true;
      sendBtn.textContent = 'Sending…';
      statusEl.textContent = 'Sending invite…';
      statusEl.style.color = 'var(--CG-light-gold)';
      prompt.pendingName = target;
      lastInviteTargetName = target;
      try {
        socket.emit('custom:invite', { username: target });
      } catch (err) {
        console.error('Failed to emit custom invite', err);
        handleFailure('Failed to send invite.');
      }
    }

    cancelBtn.addEventListener('click', () => { closeBanner(); });
    sendBtn.addEventListener('click', () => { sendInvite(); });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        sendInvite();
      }
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(sendBtn);

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(input);
    card.appendChild(statusEl);
    card.appendChild(buttons);
    content.appendChild(card);

    prompt.overlay = overlay;
    prompt.close = closeBanner;
    prompt.input = input;
    prompt.sendBtn = sendBtn;
    prompt.cancelBtn = cancelBtn;
    prompt.statusEl = statusEl;
    prompt.pendingName = input.value.trim();
    customInvitePrompt = prompt;

    overlay.show({ initialFocus: input });
    input.focus();
    if (input.value) {
      input.setSelectionRange(0, input.value.length);
    }
  }

  function showBotMatchPrompt() {
    if (botMatchPrompt && botMatchPrompt.overlay && botMatchPrompt.overlay.isOpen()) {
      try {
        botMatchPrompt.select?.focus();
      } catch (_) {}
      return;
    }

    const prompt = {};
    const overlay = createOverlay({
      baseClass: 'cg-overlay cg-overlay--banner bot-overlay',
      dialogClass: 'cg-overlay__dialog cg-overlay__dialog--banner bot-overlay__dialog',
      contentClass: 'cg-overlay__content cg-overlay__content--banner bot-overlay__content',
      backdropClass: 'cg-overlay__backdrop cg-overlay__backdrop--banner bot-overlay__backdrop',
      closeButtonClass: 'cg-overlay__close cg-overlay__close--banner bot-overlay__close',
      closeLabel: 'Close bot selection',
      closeText: '✕',
      openClass: 'cg-overlay--open cg-overlay--banner-open bot-overlay--open',
      bodyOpenClass: 'cg-overlay-open bot-overlay-open',
      closeOnBackdrop: true,
      trapFocus: true,
      onHide() {
        if (botMatchPrompt === prompt) {
          botMatchPrompt = null;
        }
      }
    });

    botMatchPrompt = prompt;
    prompt.overlay = overlay;

    const { content, dialog, closeButton } = overlay;
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';

    function closePrompt({ restoreFocus = true } = {}) {
      try {
        overlay.hide({ restoreFocus });
      } catch (_) {
        overlay.hide();
      }
    }

    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => closePrompt({ restoreFocus: true });
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

    const title = document.createElement('div');
    title.textContent = 'Play vs Bot';
    title.style.fontSize = clamp(Math.round(24 * modalScale), 16, 24) + 'px';
    title.style.fontWeight = '700';

    const description = document.createElement('div');
    description.textContent = 'Choose a bot opponent to start a match.';
    description.style.fontSize = clamp(Math.round(16 * modalScale), 12, 16) + 'px';
    description.style.lineHeight = '1.4';

    const select = document.createElement('select');
    select.style.padding = `${clamp(Math.round(10 * modalScale), 8, 12)}px ${clamp(Math.round(12 * modalScale), 10, 16)}px`;
    select.style.border = '2px solid var(--CG-deep-gold)';
    select.style.borderRadius = '6px';
    select.style.fontSize = clamp(Math.round(18 * modalScale), 14, 18) + 'px';
    select.style.fontWeight = '600';
    select.style.background = 'var(--CG-white)';
    select.style.color = 'var(--CG-black)';
    select.style.textAlign = 'center';
    select.style.cursor = 'pointer';
    select.disabled = true;

    const statusEl = document.createElement('div');
    statusEl.style.minHeight = clamp(Math.round(18 * modalScale), 14, 18) + 'px';
    statusEl.style.fontSize = clamp(Math.round(14 * modalScale), 12, 14) + 'px';
    statusEl.style.fontWeight = '600';
    statusEl.style.color = 'var(--CG-light-gold)';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = clamp(Math.round(12 * modalScale), 8, 12) + 'px';
    buttons.style.justifyContent = 'center';

    const cancelBtn = createButton({
      label: 'Cancel',
      variant: 'danger',
      position: 'relative'
    });
    cancelBtn.style.flex = '1';
    cancelBtn.style.minWidth = '0';
    cancelBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    cancelBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    cancelBtn.style.setProperty('--cg-button-font-weight', '700');

    const goBtn = createButton({
      label: 'Go',
      variant: 'primary',
      position: 'relative'
    });
    goBtn.style.flex = '1';
    goBtn.style.minWidth = '0';
    goBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    goBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    goBtn.style.setProperty('--cg-button-font-weight', '700');

    function setStatus(message, tone = 'info') {
      statusEl.textContent = message || '';
      if (!message) return;
      if (tone === 'error') {
        statusEl.style.color = 'var(--CG-scarlet, #ff6b6b)';
      } else {
        statusEl.style.color = 'var(--CG-light-gold)';
      }
    }

    function setLoading(loading) {
      goBtn.disabled = loading;
      cancelBtn.disabled = loading;
      goBtn.textContent = loading ? 'Starting…' : 'Go';
    }

    async function handleStart() {
      const difficulty = select.value || 'easy';
      if (difficulty === 'hard') {
        const label = difficulty.charAt(0).toUpperCase() + difficulty.slice(1);
        window.alert(`${label} bot still under construction`);
        return;
      }

      setStatus('Starting match…');
      setLoading(true);
      try {
        await startBotMatch(difficulty, {
          close: () => closePrompt({ restoreFocus: true }),
          setStatus,
        });
      } catch (err) {
        const message = (err && err.data && err.data.message) || err?.message || 'Failed to start bot match.';
        setStatus(message, 'error');
        setLoading(false);
        return;
      }
    }

    cancelBtn.addEventListener('click', () => closePrompt({ restoreFocus: true }));
    goBtn.addEventListener('click', () => { handleStart(); });
    select.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        handleStart();
      }
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(goBtn);

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(select);
    card.appendChild(statusEl);
    card.appendChild(buttons);
    content.innerHTML = '';
    content.appendChild(card);

    prompt.overlay = overlay;
    prompt.close = closePrompt;
    prompt.setStatus = setStatus;
    prompt.setLoading = setLoading;
    prompt.select = select;

    overlay.show({ initialFocus: select });
    select.focus();
  }

  async function startBotMatch(difficulty, promptHandle) {
    try {
      const result = await apiEnterBotQueue({ difficulty });
      if (result && (result.userId || result.username)) {
        updateSessionInfo({
          ...(result.userId ? { userId: result.userId } : {}),
          ...(result.username ? { username: result.username } : {}),
        }, { syncCookies: Boolean(result?.userId) });
        userId = sessionInfo.userId || result.userId || userId;
      }
      if (promptHandle && typeof promptHandle.close === 'function') {
        promptHandle.close();
      }
    } catch (err) {
      if (promptHandle && typeof promptHandle.setStatus === 'function') {
        const message = (err && err.data && err.data.message) || err?.message || 'Failed to start bot match.';
        promptHandle.setStatus(message, 'error');
      }
      throw err;
    }
  }

  function showDynamicBotMatchPrompt() {
    if (botMatchPrompt && botMatchPrompt.overlay && botMatchPrompt.overlay.isOpen()) {
      try {
        botMatchPrompt.select?.focus();
      } catch (_) {}
      return;
    }

    const prompt = {};
    const overlay = createOverlay({
      baseClass: 'cg-overlay cg-overlay--banner bot-overlay',
      dialogClass: 'cg-overlay__dialog cg-overlay__dialog--banner bot-overlay__dialog',
      contentClass: 'cg-overlay__content cg-overlay__content--banner bot-overlay__content',
      backdropClass: 'cg-overlay__backdrop cg-overlay__backdrop--banner bot-overlay__backdrop',
      closeButtonClass: 'cg-overlay__close cg-overlay__close--banner bot-overlay__close',
      closeLabel: 'Close bot selection',
      closeText: 'âœ•',
      openClass: 'cg-overlay--open cg-overlay--banner-open bot-overlay--open',
      bodyOpenClass: 'cg-overlay-open bot-overlay-open',
      closeOnBackdrop: true,
      trapFocus: true,
      onHide() {
        if (botMatchPrompt === prompt) {
          botMatchPrompt = null;
        }
      }
    });

    botMatchPrompt = prompt;
    prompt.overlay = overlay;

    const { content, dialog, closeButton } = overlay;
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';

    function closePrompt({ restoreFocus = true } = {}) {
      try {
        overlay.hide({ restoreFocus });
      } catch (_) {
        overlay.hide();
      }
    }

    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => closePrompt({ restoreFocus: true });
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

    const title = document.createElement('div');
    title.textContent = 'Play vs Bot';
    title.style.fontSize = clamp(Math.round(24 * modalScale), 16, 24) + 'px';
    title.style.fontWeight = '700';

    const description = document.createElement('div');
    description.textContent = 'Choose a bot opponent to start a match.';
    description.style.fontSize = clamp(Math.round(16 * modalScale), 12, 16) + 'px';
    description.style.lineHeight = '1.4';

    const select = document.createElement('select');
    select.style.padding = `${clamp(Math.round(10 * modalScale), 8, 12)}px ${clamp(Math.round(12 * modalScale), 10, 16)}px`;
    select.style.border = '2px solid var(--CG-deep-gold)';
    select.style.borderRadius = '6px';
    select.style.fontSize = clamp(Math.round(18 * modalScale), 14, 18) + 'px';
    select.style.fontWeight = '600';
    select.style.background = 'var(--CG-white)';
    select.style.color = 'var(--CG-black)';
    select.style.textAlign = 'center';
    select.style.cursor = 'pointer';
    select.disabled = true;

    const statusEl = document.createElement('div');
    statusEl.style.minHeight = clamp(Math.round(18 * modalScale), 14, 18) + 'px';
    statusEl.style.fontSize = clamp(Math.round(14 * modalScale), 12, 14) + 'px';
    statusEl.style.fontWeight = '600';
    statusEl.style.color = 'var(--CG-light-gold)';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = clamp(Math.round(12 * modalScale), 8, 12) + 'px';
    buttons.style.justifyContent = 'center';

    const cancelBtn = createButton({
      label: 'Cancel',
      variant: 'danger',
      position: 'relative'
    });
    cancelBtn.style.flex = '1';
    cancelBtn.style.minWidth = '0';
    cancelBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    cancelBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    cancelBtn.style.setProperty('--cg-button-font-weight', '700');

    const goBtn = createButton({
      label: 'Go',
      variant: 'primary',
      position: 'relative'
    });
    goBtn.style.flex = '1';
    goBtn.style.minWidth = '0';
    goBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    goBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    goBtn.style.setProperty('--cg-button-font-weight', '700');

    function setStatus(message, tone = 'info') {
      statusEl.textContent = message || '';
      if (!message) return;
      if (tone === 'error') {
        statusEl.style.color = 'var(--CG-scarlet, #ff6b6b)';
      } else {
        statusEl.style.color = 'var(--CG-light-gold)';
      }
    }

    function getFallbackBotCatalogItems() {
      return [
        { id: 'easy', label: 'Easy', playable: true },
        { id: 'medium', label: 'Medium', playable: true },
        { id: 'hard', label: 'Hard', playable: false, unavailableMessage: 'Hard bot still under construction.' },
      ];
    }

    function fillBotOptions(items = []) {
      const normalized = Array.isArray(items) && items.length ? items : getFallbackBotCatalogItems();
      prompt.botItems = normalized
        .map((item) => ({
          id: String(item?.id || ''),
          label: String(item?.label || item?.id || 'Bot'),
          playable: item?.playable !== false,
          unavailableMessage: item?.unavailableMessage || null,
        }))
        .filter((item) => item.id);
      select.innerHTML = '';
      prompt.botItems.forEach((item) => {
        const option = document.createElement('option');
        option.value = item.id;
        option.textContent = item.label;
        select.appendChild(option);
      });
      if (prompt.botItems.length) {
        select.value = prompt.botItems[0].id;
      }
    }

    let catalogLoading = true;
    let matchStarting = false;
    prompt.botItems = [];

    function syncButtonState() {
      const hasItems = Array.isArray(prompt.botItems) && prompt.botItems.length > 0;
      select.disabled = catalogLoading || !hasItems;
      goBtn.disabled = catalogLoading || matchStarting || !hasItems;
      cancelBtn.disabled = matchStarting;
      if (matchStarting) {
        goBtn.textContent = 'Starting...';
      } else if (catalogLoading) {
        goBtn.textContent = 'Loading...';
      } else {
        goBtn.textContent = 'Go';
      }
    }

    function getSelectedBotItem() {
      const selectedId = select.value || '';
      return (prompt.botItems || []).find((item) => item.id === selectedId) || prompt.botItems[0] || null;
    }

    async function handleStart() {
      const selectedBot = getSelectedBotItem();
      if (!selectedBot) {
        setStatus('No bot options are available right now.', 'error');
        return;
      }
      if (selectedBot.playable === false) {
        window.alert(selectedBot.unavailableMessage || `${selectedBot.label} bot is not available yet.`);
        return;
      }

      setStatus(`Starting match vs ${selectedBot.label}...`);
      matchStarting = true;
      syncButtonState();
      try {
        await startBotMatchById(selectedBot.id, {
          close: () => closePrompt({ restoreFocus: true }),
          setStatus,
        });
      } catch (err) {
        const message = (err && err.data && err.data.message) || err?.message || 'Failed to start bot match.';
        setStatus(message, 'error');
        matchStarting = false;
        syncButtonState();
        return;
      }
    }

    cancelBtn.addEventListener('click', () => closePrompt({ restoreFocus: true }));
    goBtn.addEventListener('click', () => { handleStart(); });
    select.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        handleStart();
      }
    });

    buttons.appendChild(cancelBtn);
    buttons.appendChild(goBtn);

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(select);
    card.appendChild(statusEl);
    card.appendChild(buttons);
    content.innerHTML = '';
    content.appendChild(card);

    prompt.overlay = overlay;
    prompt.close = closePrompt;
    prompt.setStatus = setStatus;
    prompt.select = select;

    overlay.show({ initialFocus: select });
    syncButtonState();
    setStatus('Loading bot list...');

    (async () => {
      let items = [];
      let usedFallback = false;
      try {
        const payload = await apiGetBotCatalog();
        if (Array.isArray(payload?.items) && payload.items.length) {
          items = payload.items;
        } else {
          items = getFallbackBotCatalogItems();
          usedFallback = true;
        }
      } catch (err) {
        console.warn('Failed to load bot catalog, falling back to built-in bots', err);
        items = getFallbackBotCatalogItems();
        usedFallback = true;
      }

      if (botMatchPrompt !== prompt) return;

      fillBotOptions(items);
      catalogLoading = false;
      syncButtonState();
      setStatus(usedFallback ? 'Showing the built-in bot list.' : '');
      try {
        select.focus();
      } catch (_) {}
    })();
  }

  async function startBotMatchById(botId, promptHandle) {
    try {
      const result = await apiEnterBotQueue({ botId });
      if (result && (result.userId || result.username)) {
        updateSessionInfo({
          ...(result.userId ? { userId: result.userId } : {}),
          ...(result.username ? { username: result.username } : {}),
        }, { syncCookies: Boolean(result?.userId) });
        userId = sessionInfo.userId || result.userId || userId;
      }
      if (promptHandle && typeof promptHandle.close === 'function') {
        promptHandle.close();
      }
    } catch (err) {
      if (promptHandle && typeof promptHandle.setStatus === 'function') {
        const message = (err && err.data && err.data.message) || err?.message || 'Failed to start bot match.';
        promptHandle.setStatus(message, 'error');
      }
      throw err;
    }
  }

  function handleCustomInviteResult(payload) {
    if (!payload) return;
    const status = payload.status;
    const inviteId = payload.inviteId;
    const entry = inviteId ? pendingOutgoingInvites.get(inviteId) : null;
    if (status === 'offline') {
      if (customInvitePrompt) {
        const { sendBtn, cancelBtn, statusEl, input } = customInvitePrompt;
        if (statusEl) {
          statusEl.textContent = 'User not online';
          statusEl.style.color = 'var(--CG-light-gold)';
        }
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send invite';
        }
        if (cancelBtn) {
          cancelBtn.disabled = false;
        }
        if (input) {
          input.focus();
          input.select();
        }
      }
      window.alert('user not online');
      return;
    }

    if (status === 'error') {
      const message = payload.message || 'Failed to send invite.';
      if (customInvitePrompt) {
        const { statusEl, sendBtn, cancelBtn, input } = customInvitePrompt;
        if (statusEl) {
          statusEl.textContent = message;
          statusEl.style.color = 'var(--CG-light-gold)';
        }
        if (sendBtn) {
          sendBtn.disabled = false;
          sendBtn.textContent = 'Send invite';
        }
        if (cancelBtn) {
          cancelBtn.disabled = false;
        }
        if (input) {
          input.focus();
          input.select();
        }
      } else {
        window.alert(message);
      }
      if (inviteId && entry) {
        pendingOutgoingInvites.delete(inviteId);
      }
      return;
    }

    if (status === 'pending') {
      const resolvedName = payload.username || customInvitePrompt?.pendingName || entry?.username || lastInviteTargetName || '';
      if (inviteId) {
        pendingOutgoingInvites.set(inviteId, { username: resolvedName });
      }
      lastInviteTargetName = resolvedName || lastInviteTargetName;
      if (customInvitePrompt && typeof customInvitePrompt.close === 'function') {
        customInvitePrompt.close();
      }
      return;
    }

    if (status === 'accepted') {
      if (inviteId) {
        pendingOutgoingInvites.delete(inviteId);
      }
      return;
    }

    if (status === 'declined' || status === 'cancelled') {
      const name = payload.username || entry?.username || lastInviteTargetName || 'opponent';
      if (inviteId) {
        pendingOutgoingInvites.delete(inviteId);
      }
      showInviteDeclinedBanner(name, status);
      return;
    }
  }

  function handleCustomInviteRequest(payload) {
    if (!payload || !payload.inviteId) return;
    const inviteId = payload.inviteId;
    const fromUsername = payload.fromUsername || 'A player';
    if (activeIncomingInvite && typeof activeIncomingInvite.close === 'function') {
      activeIncomingInvite.close();
    }

    const overlay = ensureBannerOverlay();
    const { content, dialog, closeButton } = overlay;
    setBannerKeyListener(null);
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    content.innerHTML = '';
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';

    let responded = false;

    function closeBanner() {
      content.innerHTML = '';
      overlay.hide();
      setBannerKeyListener(null);
      if (activeIncomingInvite && activeIncomingInvite.inviteId === inviteId) {
        activeIncomingInvite = null;
      }
    }

    function emitResponse(accepted) {
      if (responded) return;
      responded = true;
      if (socket && socket.connected) {
        try { socket.emit('custom:inviteResponse', { inviteId, accepted }); } catch (err) { console.error('Failed to emit invite response', err); }
      } else {
        console.warn('Socket not ready to send invite response');
      }
    }

    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => {
        emitResponse(false);
        closeBanner();
      };
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
    card.style.maxWidth = '400px';
    card.style.width = '90%';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.gap = cardGap + 'px';

    const message = document.createElement('div');
    message.textContent = `${fromUsername} has invited to play with you…`;
    message.style.fontSize = clamp(Math.round(20 * modalScale), 14, 20) + 'px';
    message.style.fontWeight = '600';
    message.style.lineHeight = '1.4';

    const buttons = document.createElement('div');
    buttons.style.display = 'flex';
    buttons.style.gap = clamp(Math.round(12 * modalScale), 8, 12) + 'px';
    buttons.style.justifyContent = 'center';

    const declineBtn = createButton({
      label: 'Decline',
      variant: 'danger',
      position: 'relative'
    });
    declineBtn.style.flex = '1';
    declineBtn.style.minWidth = '0';
    declineBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    declineBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    declineBtn.style.setProperty('--cg-button-font-weight', '700');

    const acceptBtn = createButton({
      label: 'Accept',
      variant: 'primary',
      position: 'relative'
    });
    acceptBtn.style.flex = '1';
    acceptBtn.style.minWidth = '0';
    acceptBtn.style.setProperty('--cg-button-padding', `${clamp(Math.round(10 * modalScale), 6, 10)}px ${clamp(Math.round(16 * modalScale), 10, 16)}px`);
    acceptBtn.style.fontSize = clamp(Math.round(18 * modalScale), 12, 18) + 'px';
    acceptBtn.style.setProperty('--cg-button-font-weight', '700');

    acceptBtn.addEventListener('click', () => {
      acceptBtn.disabled = true;
      declineBtn.disabled = true;
      acceptBtn.textContent = 'Accepting…';
      emitResponse(true);
      closeBanner();
    });

    declineBtn.addEventListener('click', () => {
      declineBtn.disabled = true;
      acceptBtn.disabled = true;
      declineBtn.textContent = 'Declining…';
      emitResponse(false);
      closeBanner();
    });

    buttons.appendChild(declineBtn);
    buttons.appendChild(acceptBtn);

    card.appendChild(message);
    card.appendChild(buttons);
    content.appendChild(card);

    activeIncomingInvite = { inviteId, close: closeBanner };

    overlay.show({ initialFocus: acceptBtn });
  }

  function handleCustomInviteCancel(payload) {
    const inviteId = payload?.inviteId;
    if (!inviteId) return;
    const current = activeIncomingInvite;
    if (current && current.inviteId === inviteId) {
      const close = current.close;
      activeIncomingInvite = null;
      if (typeof close === 'function') {
        close();
      }
    }
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

    const cancelBtn = createButton({
      label: 'Cancel',
      variant: 'primary',
      position: 'relative'
    });
    cancelBtn.style.flex = '1';
    cancelBtn.style.minWidth = '0';
    cancelBtn.style.setProperty('--cg-button-padding', '10px 16px');
    cancelBtn.style.fontSize = '18px';
    cancelBtn.style.setProperty('--cg-button-font-weight', '700');
    cancelBtn.style.setProperty('--cg-button-background', 'var(--CG-forest)');

    const resignBtn = createButton({
      label: 'Resign',
      variant: 'danger',
      position: 'relative'
    });
    resignBtn.style.flex = '1';
    resignBtn.style.minWidth = '0';
    resignBtn.style.setProperty('--cg-button-padding', '10px 16px');
    resignBtn.style.fontSize = '18px';
    resignBtn.style.setProperty('--cg-button-font-weight', '700');

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

    const cancelBtn = createButton({
      label: 'Cancel',
      variant: 'primary',
      position: 'relative'
    });
    cancelBtn.style.flex = '1';
    cancelBtn.style.minWidth = '0';
    cancelBtn.style.setProperty('--cg-button-padding', `${btnPadY}px ${btnPadX}px`);
    cancelBtn.style.fontSize = btnFontSize + 'px';
    cancelBtn.style.setProperty('--cg-button-font-weight', '700');
    cancelBtn.style.setProperty('--cg-button-background', 'var(--CG-forest)');

    const confirmBtn = createButton({
      label: 'Yes',
      variant: 'neutral',
      position: 'relative'
    });
    confirmBtn.style.flex = '1';
    confirmBtn.style.minWidth = '0';
    confirmBtn.style.setProperty('--cg-button-padding', `${btnPadY}px ${btnPadX}px`);
    confirmBtn.style.fontSize = btnFontSize + 'px';
    confirmBtn.style.setProperty('--cg-button-font-weight', '700');

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

  function doesTournamentMatchRequireAccept(match) {
    const matchType = typeof match?.type === 'string'
      ? match.type.toUpperCase()
      : '';
    if (matchType === 'TOURNAMENT_ROUND_ROBIN') {
      return true;
    }
    if (matchType !== 'TOURNAMENT_ELIMINATION') {
      return false;
    }
    const player1Score = Number(match?.player1Score || 0);
    const player2Score = Number(match?.player2Score || 0);
    const drawCount = Number(match?.drawCount || 0);
    return (player1Score + player2Score + drawCount) === 0;
  }

  function resolveTournamentGameRequiresAccept(gameLike, matchLike) {
    if (!tournamentParticipantMode) {
      return false;
    }
    if (typeof gameLike?.requiresAccept === 'boolean') {
      return Boolean(gameLike.requiresAccept);
    }
    return doesTournamentMatchRequireAccept(matchLike);
  }

  function clearTournamentGameHydration() {
    if (tournamentGameHydrationHandle) {
      clearTimeout(tournamentGameHydrationHandle);
      tournamentGameHydrationHandle = null;
    }
    tournamentGameHydrationGameId = null;
  }

  function shouldPreserveTournamentFinishedView() {
    if (!tournamentParticipantMode) {
      return false;
    }
    return activeBannerKind === 'game-finished' || activeBannerKind === 'match-summary';
  }

  async function activateLiveGameViewFromState(view, source = 'game:view') {
    if (!view || !Array.isArray(view.board)) {
      return false;
    }
    if (Array.isArray(view.players)) {
      const resolvedColorIdx = view.players.findIndex((playerId) => String(playerId) === String(userId || ''));
      if (resolvedColorIdx === 0 || resolvedColorIdx === 1) {
        currentIsWhite = (resolvedColorIdx === 0);
      }
      loadPlayerNames(view.players);
    }
    if (tournamentParticipantMode && tournamentUiController) {
      tournamentUiController.setTournamentGameActive(true);
    }
    showPlayArea();
    currentRows = view.board.length || 6;
    currentCols = view.board[0]?.length || 5;
    setStateFromServer(view, source);
    myColor = currentIsWhite ? 0 : 1;
    const serverSetup = Array.isArray(view?.setupComplete) ? view.setupComplete : setupComplete;
    const myDone = Boolean(serverSetup?.[myColor]);
    if (!myDone) {
      bootstrapWorkingStateFromServer(view);
      isInSetup = true;
    } else {
      isInSetup = false;
    }
    ensurePlayAreaRoot();
    layoutPlayArea();
    renderBoardAndBars();
    return true;
  }

  function scheduleTournamentGameHydration(gameId, color = null, { attempts = 12, delayMs = 750 } = {}) {
    const normalizedGameId = gameId ? String(gameId) : null;
    if (!normalizedGameId) {
      return;
    }
    clearTournamentGameHydration();
    tournamentGameHydrationGameId = normalizedGameId;

    const runAttempt = async (remainingAttempts) => {
      if (tournamentGameHydrationGameId !== normalizedGameId) {
        return;
      }
      try {
        const view = await apiGetDetails(normalizedGameId, null);
        if (tournamentGameHydrationGameId !== normalizedGameId || !view) {
          return;
        }
        const viewPlayersReady = Array.isArray(view?.playersReady) ? view.playersReady : [false, false];
        const bothPlayersReady = viewPlayersReady[0] === true && viewPlayersReady[1] === true;
        const requiresTournamentAccept = resolveTournamentGameRequiresAccept(view, currentMatch);
        if (bothPlayersReady && !requiresTournamentAccept) {
          locallyAcceptedTournamentGames.delete(normalizedGameId);
          tournamentAcceptScheduler.clearPending({ preserveDeadline: false });
          tournamentAcceptScheduler.releaseGrace();
          tournamentAcceptScheduler.forgetDeadline(normalizedGameId);
          clearBannerOverlay({ restoreFocus: false });
          gameFinished = false;
          clearTournamentGameHydration();
          await activateLiveGameViewFromState(view, 'tournament-accept-hydrate');
          return;
        }
      } catch (err) {
        console.error('Tournament game hydration failed', err);
      }

      if (remainingAttempts <= 1 || tournamentGameHydrationGameId !== normalizedGameId) {
        clearTournamentGameHydration();
        return;
      }
      tournamentGameHydrationHandle = setTimeout(() => {
        tournamentGameHydrationHandle = null;
        runAttempt(remainingAttempts - 1);
      }, delayMs);
    };

    runAttempt(attempts);
  }

  function showMatchFoundBanner(
    startSeconds,
    onTick,
    {
      gameId = null,
      currentGameNumber = 1,
      countdownEndsAt = null,
    } = {},
  ) {
    const overlay = ensureBannerOverlay();
    setActiveBanner('match-found', gameId || null);
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
    title.textContent = getMatchCountdownBannerTitle(currentGameNumber);
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
      setActiveBanner(null, null);
      overlay.hide();
    }

    const resolvedCountdownEndMs = (() => {
      const parsed = Date.parse(countdownEndsAt);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      return Date.now() + (Math.max(1, Number(startSeconds) || 3) * 1000);
    })();
    let remaining = Math.max(0, Math.ceil((resolvedCountdownEndMs - Date.now()) / 1000));
    let lastRenderedRemaining = null;
    countEl.textContent = String(Math.max(1, remaining));
    overlay.show({ initialFocus: closeButton && !closeButton.hidden ? closeButton : null });

    if (remaining <= 0) {
      if (typeof onTick === 'function') {
        try { onTick(0); } catch (_) {}
      }
      closeBanner();
      return;
    }

    if (bannerInterval) clearInterval(bannerInterval);
    bannerInterval = setInterval(() => {
      remaining = Math.max(0, Math.ceil((resolvedCountdownEndMs - Date.now()) / 1000));
      if (remaining !== lastRenderedRemaining) {
        lastRenderedRemaining = remaining;
        if (typeof onTick === 'function') {
          try { onTick(remaining); } catch (_) {}
        }
      }
      if (remaining <= 0) {
        clearInterval(bannerInterval);
        bannerInterval = null;
        closeBanner();
        return;
      }
      countEl.textContent = String(remaining);
    }, 100);
  }

  function showTournamentAcceptBanner({ gameId, color, startSeconds = 30 } = {}) {
    const normalizedGameId = gameId ? String(gameId) : null;
    if (normalizedGameId && locallyAcceptedTournamentGames.has(normalizedGameId)) {
      return;
    }
    tournamentAcceptScheduler.clearPending({ preserveDeadline: true });
    tournamentAcceptScheduler.rememberDeadline(normalizedGameId, startSeconds);
    if (
      normalizedGameId
      && activeBannerKind === 'tournament-accept'
      && activeBannerGameId === normalizedGameId
      && isBannerVisible()
    ) {
      return;
    }
    const overlay = ensureBannerOverlay();
    setActiveBanner('tournament-accept', normalizedGameId);
    const { content, dialog, closeButton } = overlay;
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'center';
    content.innerHTML = '';
    if (closeButton) closeButton.hidden = true;

    const stack = document.createElement('div');
    stack.style.display = 'flex';
    stack.style.flexDirection = 'column';
    stack.style.alignItems = 'center';
    stack.style.justifyContent = 'center';
    stack.style.gap = '12px';
    stack.style.width = 'min(560px, 92vw)';
    stack.style.padding = '22px 28px';
    stack.style.color = 'var(--CG-white)';
    stack.style.textAlign = 'center';
    stack.style.background = 'var(--CG-deep-purple)';
    stack.style.border = '2px solid var(--CG-deep-gold)';
    stack.style.boxShadow = '0 14px 34px rgba(0, 0, 0, 0.38)';

    const title = document.createElement('div');
    title.textContent = 'Tournament Match Ready';
    title.style.fontSize = '28px';
    title.style.fontWeight = '800';

    const message = document.createElement('div');
    message.textContent = `Accept within ${Math.max(1, Number(startSeconds) || 30)} seconds to start this game.`;
    message.style.fontSize = '18px';
    message.style.lineHeight = '1.35';
    message.style.maxWidth = '320px';

    const timerEl = document.createElement('div');
    timerEl.style.fontSize = '48px';
    timerEl.style.fontWeight = '900';

    const acceptBtn = createButton({
      label: 'Accept',
      variant: 'primary',
      position: 'relative'
    });
    acceptBtn.style.setProperty('--cg-button-padding', '12px 24px');
    acceptBtn.style.setProperty('--cg-button-border', '2px solid var(--CG-deep-gold)');
    acceptBtn.style.minWidth = '180px';
    acceptBtn.style.minHeight = '52px';
    acceptBtn.style.borderRadius = '12px';
    acceptBtn.style.fontSize = '20px';
    acceptBtn.style.setProperty('--cg-button-font-weight', '700');
    acceptBtn.style.boxShadow = '0 12px 30px rgba(0, 0, 0, 0.28)';
    acceptBtn.style.margin = '0 auto';

    stack.appendChild(title);
    stack.appendChild(message);
    stack.appendChild(timerEl);
    stack.appendChild(acceptBtn);
    content.appendChild(stack);

    function closeBanner() {
      if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
      content.innerHTML = '';
      setActiveBanner(null, null);
      overlay.hide();
    }

    let remaining = Math.max(1, Number(startSeconds) || 30);
    timerEl.textContent = String(remaining);
    overlay.show({ initialFocus: acceptBtn });

    acceptBtn.addEventListener('click', async () => {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Accepting…';
      if (normalizedGameId) {
        locallyAcceptedTournamentGames.add(normalizedGameId);
      }
      try {
        await apiReady(normalizedGameId, color);
        closeBanner();
        scheduleTournamentGameHydration(normalizedGameId, color);
      } catch (err) {
        if (normalizedGameId) {
          locallyAcceptedTournamentGames.delete(normalizedGameId);
        }
        clearTournamentGameHydration();
        console.error('Failed to accept tournament match', err);
        acceptBtn.disabled = false;
        acceptBtn.textContent = 'Accept';
      }
    });

    if (bannerInterval) clearInterval(bannerInterval);
    bannerInterval = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(bannerInterval);
        bannerInterval = null;
        closeBanner();
        return;
      }
      timerEl.textContent = String(remaining);
    }, 1000);
  }

  function createScoreboard(match) {
    const hasSeriesGameStarted = (game) => {
      if (!game || typeof game !== 'object') return false;
      if (game.startTime || game.endTime) return true;
      if (game.winner !== undefined && game.winner !== null) return true;
      if (game.winReason !== undefined && game.winReason !== null) return true;
      if (Array.isArray(game.actions) && game.actions.length > 0) return true;
      if (Array.isArray(game.moves) && game.moves.length > 0) return true;
      return game.isActive === false;
    };

    const p1Name = formatPlayerName(match?.player1?.username, 0);
    const p2Name = formatPlayerName(match?.player2?.username, 1);
    const p1Score = Number(match?.player1Score || 0);
    const p2Score = Number(match?.player2Score || 0);
    const finishedGames = Array.isArray(match?.games)
      ? match.games.filter(g => hasSeriesGameStarted(g) && !g.isActive).length
      : 0;
    const draws = Number.isFinite(match?.drawCount)
      ? match.drawCount
      : Math.max(0, finishedGames - p1Score - p2Score);
    const isRanked = match?.type === 'RANKED';
    const result = getMatchResult(match);

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
    if (result?.player1Result === 'win') player1Status = 'winner';
    else if (result?.player1Result === 'loss') player1Status = 'loser';
    if (result?.player2Result === 'win') player2Status = 'winner';
    else if (result?.player2Result === 'loss') player2Status = 'loser';

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
        change.style.color = delta > 0
          ? '#34d399'
          : (delta < 0 ? '#f87171' : 'var(--CG-white)');
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

  function hasMatchContinuation(match, finishedGameId = null, fallbackActive = false) {
    const normalizedFinishedGameId = finishedGameId ? String(finishedGameId) : null;
    const activeNextGame = Array.isArray(match?.games)
      ? match.games.some((game) => {
          if (!game?.isActive) return false;
          const gameId = game?._id?.toString?.() || game?._id || game?.id || null;
          if (!gameId) return false;
          return String(gameId) !== normalizedFinishedGameId;
        })
      : false;
    if (activeNextGame) {
      return true;
    }

    // If the match record already says it ended, do not let a stale
    // matchIsActive socket flag force the client down the "waiting for next
    // game" path. That stale path is what leaves the finished board up with
    // the dark overlay and no summary.
    if (match?.winner || match?.endTime || match?.isActive === false) {
      return false;
    }

    const winScoreTarget = Number(match?.winScoreTarget);
    const player1Score = Number(match?.player1Score || 0);
    const player2Score = Number(match?.player2Score || 0);
    const drawCount = Number(match?.drawCount || 0);
    const isTournamentElimination = String(match?.type || '').toUpperCase() === 'TOURNAMENT_ELIMINATION';
    if (Number.isFinite(winScoreTarget) && winScoreTarget > 0) {
      if (player1Score >= winScoreTarget || player2Score >= winScoreTarget) {
        return false;
      }
      if (!isTournamentElimination && drawCount >= winScoreTarget) {
        return false;
      }
    }

    return Boolean(fallbackActive);
  }

  function isMatchDefinitelyComplete(match) {
    if (!match || typeof match !== 'object') {
      return false;
    }
    if (match.winner || match.endTime || match.isActive === false) {
      return true;
    }
    const winScoreTarget = Number(match?.winScoreTarget);
    const player1Score = Number(match?.player1Score || 0);
    const player2Score = Number(match?.player2Score || 0);
    const drawCount = Number(match?.drawCount || 0);
    const isTournamentElimination = String(match?.type || '').toUpperCase() === 'TOURNAMENT_ELIMINATION';
    if (Number.isFinite(winScoreTarget) && winScoreTarget > 0) {
      if (player1Score >= winScoreTarget || player2Score >= winScoreTarget) {
        return true;
      }
      if (!isTournamentElimination && drawCount >= winScoreTarget) {
        return true;
      }
    }
    return false;
  }

  async function refreshMatchForPostGame(match) {
    const matchId = match?._id ? String(match._id) : null;
    if (!matchId) {
      return match || null;
    }
    try {
      const refreshed = await apiGetMatchDetails(matchId);
      return refreshed || match || null;
    } catch (err) {
      console.error('Failed to refresh match details for post-game flow', err);
      return match || null;
    }
  }

  async function resolveSettledPostGameMatch(match, {
    finishedGameId = null,
    fallbackActive = false,
    attempts = 6,
    delayMs = 250,
  } = {}) {
    let latestMatch = match || null;
    let latestContinuation = hasMatchContinuation(latestMatch, finishedGameId, fallbackActive);
    if (!latestContinuation || isMatchDefinitelyComplete(latestMatch)) {
      return {
        match: latestMatch,
        hasNextGame: latestContinuation,
      };
    }

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      latestMatch = await refreshMatchForPostGame(latestMatch);
      latestContinuation = hasMatchContinuation(latestMatch, finishedGameId, fallbackActive);
      if (!latestContinuation || isMatchDefinitelyComplete(latestMatch)) {
        break;
      }
    }

    return {
      match: latestMatch,
      hasNextGame: latestContinuation,
    };
  }

  function canShowMatchSummary(match, finishedGameId = null) {
    const incomingMatchId = match?._id ? String(match._id) : null;
    const currentMatchId = currentMatch?._id ? String(currentMatch._id) : null;
    const liveMatchId = activeMatchId ? String(activeMatchId) : null;
    const normalizedFinishedGameId = finishedGameId ? String(finishedGameId) : null;
    const currentGameId = lastGameId ? String(lastGameId) : null;

    if (
      normalizedFinishedGameId
      && currentGameId
      && normalizedFinishedGameId !== currentGameId
      && !gameFinished
    ) {
      return false;
    }

    if (incomingMatchId && liveMatchId && incomingMatchId !== liveMatchId && !gameFinished) {
      return false;
    }

    if (incomingMatchId && currentMatchId && incomingMatchId !== currentMatchId && !gameFinished) {
      return false;
    }

    return true;
  }

  function showGameFinishedBanner({ gameId, winnerName, loserName, winnerColor, didWin, match, matchIsActive, winReason }) {
    currentMatch = match;
    if (match?._id) {
      activeMatchId = String(match._id);
    }
    applyExpectedTimeSettingsForMatch(currentMatch);
    const overlay = ensureBannerOverlay();
    setActiveBanner('game-finished', gameId || null);
    const { content, dialog, closeButton } = overlay;
    dialog.style.alignItems = 'center';
    dialog.style.justifyContent = 'flex-end';
    content.innerHTML = '';
    if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
    let summaryTimeout = null;
    if (closeButton) {
      closeButton.hidden = false;
      closeButton.onclick = () => {
        if (summaryTimeout) { clearTimeout(summaryTimeout); summaryTimeout = null; }
        content.innerHTML = '';
        setActiveBanner(null, null);
        overlay.hide();
        setBannerKeyListener(null);
      };
    }
    const card = document.createElement('div');
    const compactHeight = Math.round(160 * 0.7);
    card.style.width = '100%';
    card.style.maxWidth = '100%';
    card.style.height = `${compactHeight}px`;
    card.style.padding = '12px 24px 16px';
    card.style.borderRadius = '0';
    card.style.borderTop = '2px solid var(--CG-deep-gold)';
    card.style.borderBottom = '2px solid var(--CG-deep-gold)';
    card.style.marginTop = 'auto';
    card.style.marginBottom = 'clamp(12px, 2vh, 40px)';
    card.style.marginLeft = 'auto';
    card.style.marginRight = 'auto';
    card.style.display = 'flex';
    card.style.flexDirection = 'column';
    card.style.alignItems = 'center';
    card.style.justifyContent = 'flex-start';
    card.style.gap = '4px';
    const isDraw = winnerColor !== 0 && winnerColor !== 1;
    card.style.background = isDraw ? 'var(--CG-gray)' : (didWin ? 'var(--CG-dark-red)' : 'var(--CG-black)');
    card.style.color = 'var(--CG-white)';
    card.style.boxShadow = '0 10px 30px var(--CG-black)';
    card.style.textAlign = 'center';
    card.style.position = 'relative';

    const title = document.createElement('div');
    title.textContent = isDraw ? 'Draw' : (didWin ? 'Victory' : 'Defeat');
    title.style.fontSize = '28px';
    title.style.fontWeight = '800';
    title.style.marginBottom = '6px';

    const desc = document.createElement('div');
    const colorStr = winnerColor === 0 ? 'White' : 'Black';
    const reason = Number(winReason);
    const initialHasNextGame = hasMatchContinuation(match, gameId || null, Boolean(matchIsActive || match?.isActive));
    if (!initialHasNextGame && tournamentParticipantMode) {
      tournamentAcceptScheduler.setGrace();
    }
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
    desc.style.fontSize = '18px';
    desc.style.fontWeight = '500';
    desc.style.lineHeight = '1.3';
    desc.style.margin = '0 auto';
    desc.style.maxWidth = 'min(520px, 90%)';
    desc.style.textAlign = 'center';
    desc.style.padding = '0 8px';
    desc.id = 'gameOverDesc';

    const btn = createButton({
      id: 'gameOverNextBtn',
      label: 'Next',
      variant: 'primary',
      position: 'relative'
    });
    btn.style.setProperty('--cg-button-background', 'var(--CG-purple)');
    btn.style.setProperty('--cg-button-border', '2px solid #fbbf24');
    btn.style.setProperty('--cg-button-padding', '8px 20px');
    btn.style.fontSize = '17px';
    btn.style.marginTop = 'auto';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      if (summaryTimeout) {
        clearTimeout(summaryTimeout);
        summaryTimeout = null;
      }
      if (bannerInterval) { clearInterval(bannerInterval); bannerInterval = null; }
      try {
        if (initialHasNextGame && gameId) {
          desc.textContent = 'Waiting for the next game...';
          btn.style.display = 'none';
          const nextResult = await apiNext(gameId, myColor);
          if (nextResult?.hasNextGame === false) {
            const resolved = await resolveSettledPostGameMatch(match, {
              finishedGameId: gameId || null,
              fallbackActive: false,
              attempts: 1,
              delayMs: 0,
            });
            const latestMatch = resolved.match || match;
            clearBannerOverlay({ restoreFocus: false });
            if (tournamentParticipantMode) {
              exitTournamentGameViewToPanel();
            }
            showMatchSummary(latestMatch || match, { finishedGameId: gameId || null, force: true });
            return;
          }
          return;
        }

        const resolved = await resolveSettledPostGameMatch(match, {
          finishedGameId: gameId || null,
          fallbackActive: Boolean(matchIsActive || match?.isActive),
        });
        const latestMatch = resolved.match || match;

        clearBannerOverlay({ restoreFocus: false });
        if (tournamentParticipantMode) {
          exitTournamentGameViewToPanel();
        }
        showMatchSummary(latestMatch || match, { finishedGameId: gameId || null, force: true });
      } catch (e) {
        console.error('Failed to advance post-game flow', e);
        btn.disabled = false;
        btn.style.display = '';
        clearBannerOverlay({ restoreFocus: false });
      }
    });

    if (!initialHasNextGame && !tournamentParticipantMode) {
      summaryTimeout = setTimeout(() => {
        try {
          Promise.resolve(resolveSettledPostGameMatch(match, {
            finishedGameId: gameId || null,
            fallbackActive: Boolean(matchIsActive || match?.isActive),
          }))
            .then((resolved) => {
              const latestMatch = resolved?.match || match;
              clearBannerOverlay({ restoreFocus: false });
              showMatchSummary(latestMatch || match, { finishedGameId: gameId || null, force: true });
            })
            .catch((err) => {
              console.error('Failed to auto show match summary', err);
              clearBannerOverlay({ restoreFocus: false });
            });
        } catch (err) {
          console.error('Failed to auto show match summary', err);
          clearBannerOverlay({ restoreFocus: false });
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

  function showMatchSummary(match, { finishedGameId = null, force = false } = {}) {
    if (!force && !canShowMatchSummary(match, finishedGameId)) {
      emitLocalClockDebug('client-match-summary-aborted', {
        finishedGameId: finishedGameId || null,
        incomingMatchId: match?._id ? String(match._id) : null,
        currentMatchId: currentMatch?._id ? String(currentMatch._id) : null,
        activeMatchId: activeMatchId ? String(activeMatchId) : null,
        lastGameId: lastGameId ? String(lastGameId) : null,
        gameFinished,
      });
      clearBannerOverlay({ restoreFocus: false });
      return;
    }
    currentMatch = match;
    if (match?._id) {
      activeMatchId = String(match._id);
    }
    applyExpectedTimeSettingsForMatch(currentMatch);
    setActiveBanner('match-summary', match?._id || null);
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
        if (canShowMatchSummary(match, finishedGameId)) {
          returnToLobby();
          return;
        }
        emitLocalClockDebug('client-match-summary-close-ignored', {
          finishedGameId: finishedGameId || null,
          incomingMatchId: match?._id ? String(match._id) : null,
          activeMatchId: activeMatchId ? String(activeMatchId) : null,
          lastGameId: lastGameId ? String(lastGameId) : null,
          gameFinished,
        });
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

    const btn = createButton({
      label: 'Back to Lobby',
      variant: 'danger',
      position: 'relative'
    });
    btn.id = 'gameOverNextBtn';
    btn.style.margin = '15px auto 0';
    btn.style.setProperty('--cg-button-background', 'var(--CG-dark-red)');
    btn.style.setProperty('--cg-button-border', '2px solid var(--CG-deep-gold)');
    btn.style.setProperty('--cg-button-padding', '6px 12px');
    btn.style.setProperty('--cg-button-font-weight', '700');
    btn.style.fontSize = '16px';
    btn.style.borderRadius = '0';
    btn.addEventListener('click', () => {
      if (canShowMatchSummary(match, finishedGameId)) {
        returnToLobby();
        return;
      }
      clearBannerOverlay({ restoreFocus: false });
      emitLocalClockDebug('client-match-summary-button-ignored', {
        finishedGameId: finishedGameId || null,
        incomingMatchId: match?._id ? String(match._id) : null,
        activeMatchId: activeMatchId ? String(activeMatchId) : null,
        lastGameId: lastGameId ? String(lastGameId) : null,
        gameFinished,
      });
    });

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

    topBar = document.createElement('div');
    topBar.id = 'playAreaTopBar';
    topBar.style.position = 'absolute';
    playAreaRoot.appendChild(topBar);

    boardRoot = document.createElement('div');
    boardRoot.id = 'playAreaBoard';
    boardRoot.style.position = 'absolute';
    playAreaRoot.appendChild(boardRoot);

    bottomBar = document.createElement('div');
    bottomBar.id = 'playAreaBottomBar';
    bottomBar.style.position = 'absolute';
    playAreaRoot.appendChild(bottomBar);

    gameView = createGameView({
      container: playAreaRoot,
      boardEl: boardRoot,
      topBarEl: topBar,
      bottomBarEl: bottomBar,
      identityMap: PIECE_IMAGES,
      refs,
      annotationsEnabled: true,
    });
    boardView = gameView.boardView;

    // Stash area container
    stashRoot = document.createElement('div');
    stashRoot.id = 'playAreaStash';
    stashRoot.style.position = 'absolute';
    playAreaRoot.appendChild(stashRoot);

    ensureGameToastSystem();
    window.addEventListener('resize', layoutPlayArea);
    return playAreaRoot;
  }

  function layoutPlayArea() {
    if (!playAreaRoot) return;
    const overrideBounds = tournamentUiController && typeof tournamentUiController.getPlayAreaBounds === 'function'
      ? tournamentUiController.getPlayAreaBounds()
      : null;
    const vw = overrideBounds?.width || window.innerWidth;
    const vh = overrideBounds?.height || window.innerHeight;
    const computed = computePlayAreaBounds(vw, vh);
    const left = Math.floor((overrideBounds?.left || 0) + computed.left);
    const top = Math.floor((overrideBounds?.top || 0) + computed.top);
    const width = computed.width;
    const height = computed.height;
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
    clearGameToastFeedback();
  }

  // Tournament accept and tournament match-complete flows should transition the
  // player back to the tournament shell before the next prompt takes over.
  function exitTournamentGameViewToPanel() {
    hidePlayArea();
    if (!(tournamentParticipantMode && tournamentUiController)) {
      return;
    }
    Promise.resolve(
      typeof tournamentUiController.exitTournamentGameToPanel === 'function'
        ? tournamentUiController.exitTournamentGameToPanel()
        : (tournamentUiController.setTournamentGameActive(false), tournamentUiController.openHomeIfParticipant(), null)
    ).catch((err) => {
      console.error('Failed to exit tournament game view to panel', err);
    });
  }

  function returnToLobby() {
    clearTournamentGameHydration();
    hidePlayArea();
    if (!tournamentParticipantMode) {
      showQueuer();
    }
    clearBannerOverlay({ restoreFocus: false });
    queuedState.quickplay = false;
    queuedState.ranked = false;
    queuedState.bots = false;
    pendingAction = null;
    queueStatusKnown = true;
    stopClockInterval();
    clockBaseSnapshot = null;
    clockBaseGameId = null;
    gameFinished = false;
    updateFindButton();
    currentMatch = null;
    applyExpectedTimeSettingsForMatch(null);
    activeMatchId = null;
    connectionStatusByPlayer.clear();
    currentDrawOffer = null;
    drawOfferCooldowns = [null, null];
    clearDrawCooldownTimeout();
    locallyAcceptedTournamentGames.clear();
    clearGameToastFeedback({ resetSnapshot: true });
    if (tournamentParticipantMode && tournamentUiController) {
      tournamentAcceptScheduler.releaseGrace();
      Promise.resolve(
        typeof tournamentUiController.exitTournamentGameToPanel === 'function'
          ? tournamentUiController.exitTournamentGameToPanel()
          : (tournamentUiController.setTournamentGameActive(false), tournamentUiController.openHomeIfParticipant(), null)
      )
        .catch((err) => {
          console.error('Failed to refresh tournament panel after returning to lobby', err);
        })
        .finally(() => {
          tournamentAcceptScheduler.flushPending({ forceImmediate: true });
        });
      return;
    }
    tournamentAcceptScheduler.releaseGrace();
    tournamentAcceptScheduler.flushPending({ forceImmediate: true });
  }

  function renderBoardAndBars() {
    if (!playAreaRoot || !boardRoot || !gameView || !boardView || !currentRows || !currentCols) return;
    purgeDanglingDragArtifacts();
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

    // Determine whether to show challenge bubbles on player bars
    const topColor = currentIsWhite ? 1 : 0;
    const bottomColor = currentIsWhite ? 0 : 1;
    let showChallengeTop = false;
    let showChallengeBottom = false;
    if (lastAction && lastAction.type === ACTIONS.CHALLENGE) {
      if (lastAction.player === topColor) showChallengeTop = true;
      if (lastAction.player === bottomColor) showChallengeBottom = true;
    }

    const viewerColor = currentIsWhite ? 0 : 1;
    const responseContext = latestMoveContext || getLatestMoveContext({
      actions: actionHistory,
      moves: moveHistory,
    });
    const {
      responseWindowOpen,
    } = getResponseWindowState({
      isMyTurn: currentPlayerTurn === viewerColor && !isInSetup,
      isInSetup,
      currentOnDeckingPlayer,
      myColor: viewerColor,
      lastMove,
      lastAction,
      lastMoveAction,
      latestMoveContext: responseContext,
    });
    const activeTurnColor = resolveActiveTurnColor({
      currentPlayerTurn,
      currentOnDeckingPlayer,
      isInSetup,
      gameFinished,
    });
    const highlightedBoardSources = (
      !gameFinished
      && !isInSetup
      && currentOnDeckingPlayer === null
      && !responseWindowOpen
      && !isBombActive()
      && currentPlayerTurn === viewerColor
    )
      ? getLegalBoardSourceCells({
          currentBoard,
          currentIsWhite,
          playerColor: viewerColor,
          rows: currentRows,
          cols: currentCols,
        })
      : [];

    // Use modular bars and stash renderers
    const topClr = currentIsWhite ? 1 : 0;
    const bottomClr = currentIsWhite ? 0 : 1;
    const topMs = getDisplayClockMsForColor(topClr);
    const bottomMs = getDisplayClockMsForColor(bottomClr);
    const clockLabel = getClockLabel();
    const topIdx = currentIsWhite ? 1 : 0;
    const bottomIdx = currentIsWhite ? 0 : 1;
    const matchType = typeof currentMatch?.type === 'string'
      ? currentMatch.type.toUpperCase()
      : '';
    const isRankedMatch = matchType === 'RANKED';
    const hasSeriesWins = isRankedMatch || matchType === 'TOURNAMENT_ELIMINATION';
    const p1Score = currentMatch?.player1Score || 0;
    const p2Score = currentMatch?.player2Score || 0;
    let winsTop = 0;
    let winsBottom = 0;
    if (hasSeriesWins) {
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
    const showEloTop = Boolean(topPlayerId) && !isKnownBotId(topPlayerId) && !isKnownGuestId(topPlayerId);
    const showEloBottom = Boolean(bottomPlayerId) && !isKnownBotId(bottomPlayerId) && !isKnownGuestId(bottomPlayerId);
    const toastPulseState = getGameToastPulseRenderState();
    const bars = gameView.render({
      sizes: {
        rows: currentRows,
        cols: currentCols,
        squareSize: s,
        boardLeft: leftPx,
        boardTop: topPx,
      },
      boardState: {
        currentBoard,
        currentIsWhite,
        selected,
        isInSetup,
        workingRank,
        pendingCapture,
        pendingMoveFrom,
        challengeRemoved,
        draggingOrigin: dragging?.origin || null,
        highlightedSourceCells: highlightedBoardSources,
      },
      barsState: {
        currentIsWhite,
        currentCaptured,
        currentDaggers,
        activeColor: activeTurnColor,
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
        eloBottom,
        showEloTop,
        showEloBottom,
        playerIdTop: topPlayerId,
        playerIdBottom: bottomPlayerId,
        pulsingDaggerColors: toastPulseState.pulsingDaggerColors,
        pulsingCapturedByColor: toastPulseState.pulsingCapturedByColor,
      },
      viewMode: 'player',
      viewerColor,
      labelFont,
      fileLetters,
      readOnly: false,
      deploymentLines: true,
      onAttachHandlers: (cell, target) => attachInteractiveHandlers(cell, target),
      onAttachGameHandlers: (cell, r, c) => attachGameHandlers(cell, r, c),
      onNameClick: (info) => {
        if (!info || !info.userId) return;
        if (isKnownBotId(info.userId)) return;
        viewPlayerStats({
          userId: info.userId,
          username: info.name,
          elo: info.elo
        });
      },
      shouldAllowPlayerClick: (id) => !isKnownBotId(id)
    });
    topClockEl = bars?.topClockEl || null;
    bottomClockEl = bars?.bottomClockEl || null;
    updateClockDisplay();

    renderDrawOfferPrompt();

    const readyVisible = (isInSetup && isSetupCompletable());
    const randomVisible = (isInSetup && !readyVisible);

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
        workingRank,
        workingStash,
        workingOnDeck,
        setupIsCompletable: readyVisible,
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
    syncBoardMoveTargetHighlights(getCurrentMoveTargetHighlights());

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
      const responseContext = latestMoveContext || getLatestMoveContext({
        actions: actionHistory,
        moves: moveHistory,
      });
      const {
        responseAction,
        responseWindowOpen,
      } = getResponseWindowState({
        isMyTurn,
        isInSetup,
        currentOnDeckingPlayer,
        myColor,
        lastMove,
        lastAction,
        lastMoveAction,
        latestMoveContext: responseContext,
      });
      if (responseWindowOpen) {
        canChallenge = true;
        if (responseAction?.type === ACTIONS.BOMB) {
          canPass = true;
        } else if (
          responseAction?.type === ACTIONS.MOVE
          && pendingCapture
          && pendingCapture.piece
          && pendingCapture.piece.color === myColor
          && lastMove.declaration !== Declaration.KING
        ) {
          canBomb = true;
        }
      }

      // Bomb button (upper left)
      const bombBtn = renderGameButton({
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
          emitLocalClockDebug('client-action-submit', {
            action: 'bomb',
            color: myColor,
          });
          applyLocalMoveClock();
          apiBomb(lastGameId, myColor).catch(err => console.error('Bomb failed', err));
        },
        width: btnW,
        height: btnH
      });
      applyTooltipAttributes(bombBtn, TOOLTIP_TEXT.bombButton);

      // Pass button (uses challenge styling, upper left)
      const passBtn = renderGameButton({
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
          emitLocalClockDebug('client-action-submit', {
            action: 'pass',
            color: myColor,
          });
          applyLocalMoveClock();
          apiPass(lastGameId, myColor).catch(err => console.error('Pass failed', err));
        },
        width: btnW,
        height: btnH
      });
      applyTooltipAttributes(passBtn, TOOLTIP_TEXT.passButton);

      // Challenge button (upper right)
      const challengeBtn = renderGameButton({
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
          emitLocalClockDebug('client-action-submit', {
            action: 'challenge',
            color: myColor,
          });
          applyLocalMoveClock();
          apiChallenge(lastGameId, myColor).catch(err => console.error('Challenge failed', err));
        },
        width: btnW,
        height: btnH
      });
      applyTooltipAttributes(challengeBtn, TOOLTIP_TEXT.challengeButton);

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
      const gapBelowDeck = Math.max(2, Math.round(deckHeight * 0.02));
      const resignTop = deckBottom + gapBelowDeck;
      const resignW = Math.max(1, Math.round(btnW * 0.65));
      const resignH = Math.max(1, Math.round(btnH * 0.5));
      const canResign = bothSetupDone && !isInSetup && !gameFinished && Boolean(lastGameId);
      const canOfferDraw = bothSetupDone && !isInSetup && !gameFinished && Boolean(lastGameId) && !hasPendingDrawOffer && !cooldownActive;

      const resignBtn = renderGameButton({
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
      applyTooltipAttributes(resignBtn, TOOLTIP_TEXT.resignButton);

      const drawGap = Math.max(2, Math.round(resignH * 0.05));
      const drawTop = resignTop + resignH + drawGap;

      const drawBtn = renderGameButton({
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
      applyTooltipAttributes(drawBtn, TOOLTIP_TEXT.drawButton);
    })();

    // After board render, apply any pending move overlay bubbles
    if (!isInSetup && postMoveOverlay) {
      gameView.setBubbleOverlays([{
        uiR: postMoveOverlay.uiR,
        uiC: postMoveOverlay.uiC,
        types: postMoveOverlay.types,
        interactive: Boolean(postMoveOverlay.interactive),
        onBubbleClick: ({ type }) => {
          const decl = type.includes('king')
            ? Declaration.KING
            : (type.includes('bishop')
              ? Declaration.BISHOP
              : (type.includes('rook') ? Declaration.ROOK : Declaration.KNIGHT));
          commitMoveFromOverlay(decl, {
            originUI: lastChoiceOrigin,
            destUI: { uiR: postMoveOverlay.uiR, uiC: postMoveOverlay.uiC }
          });
        }
      }]);
    } else {
      gameView.clearBubbleOverlays();
    }

    // Ready button overlay when setup is completable
    renderReadyButton({
      root: playAreaRoot,
      boardLeft: leftPx,
      boardTop: topPx,
      boardWidth: bW,
      boardHeight: bH,
      isVisible: readyVisible,
      isHighlighted: readyVisible,
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
          purgeDanglingDragArtifacts();
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

    const btnPadY = clamp(Math.round(8 * scale), 4, 8);
    const btnPadX = clamp(Math.round(18 * scale), 8, 18);
    const btnFontSize = clamp(Math.round(16 * scale), 11, 16);

    const acceptBtn = createButton({
      label: 'Accept',
      variant: 'primary',
      position: 'relative'
    });
    acceptBtn.style.setProperty('--cg-button-background', 'var(--CG-forest)');
    acceptBtn.style.setProperty('--cg-button-border', '2px solid var(--CG-deep-gold)');
    acceptBtn.style.setProperty('--cg-button-padding', `${btnPadY}px ${btnPadX}px`);
    acceptBtn.style.fontSize = btnFontSize + 'px';
    acceptBtn.style.setProperty('--cg-button-font-weight', '700');

    const declineBtn = createButton({
      label: 'Decline',
      variant: 'danger',
      position: 'relative'
    });
    declineBtn.style.setProperty('--cg-button-background', 'var(--CG-dark-red)');
    declineBtn.style.setProperty('--cg-button-border', '2px solid var(--CG-deep-gold)');
    declineBtn.style.setProperty('--cg-button-padding', `${btnPadY}px ${btnPadX}px`);
    declineBtn.style.fontSize = btnFontSize + 'px';
    declineBtn.style.setProperty('--cg-button-font-weight', '700');

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

    const capturedByColor = groupCapturedPiecesByColor(currentCaptured);

    function makeCapturedForColor(colorIdx) {
      const strip = document.createElement('div');
      strip.style.display = 'flex';
      strip.style.alignItems = 'center';
      strip.style.gap = '4px';
      const pieces = capturedByColor?.[colorIdx] || [];
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

  function safeRemoveNode(node) {
    if (!node) return;
    try {
      if (typeof node.remove === 'function') {
        node.remove();
        return;
      }
    } catch (_) {}
    try {
      if (node.parentNode) {
        node.parentNode.removeChild(node);
      }
    } catch (_) {}
  }

  function purgeDanglingDragArtifacts(options) {
    const force = Boolean(options && options.force);
    if (!force && dragging) return;
    try { clearDragPreviewImgs(); } catch (_) {}
    try {
      const ghosts = Array.from(document.querySelectorAll('[data-drag-ghost]'));
      ghosts.forEach(function(node) { safeRemoveNode(node); });
    } catch (_) {}
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
    if (declaration === Declaration.BOMB) return ['bombSpeechLeft'];
    return [];
  }

  function makeMoveKey(move) {
    if (!move) return null;
    const from = move.from || {};
    const to = move.to || {};
    const parts = [
      typeof move.player === 'number' ? move.player : 'x',
      Number.isFinite(from.row) ? from.row : 'x',
      Number.isFinite(from.col) ? from.col : 'x',
      Number.isFinite(to.row) ? to.row : 'x',
      Number.isFinite(to.col) ? to.col : 'x',
      typeof move.declaration === 'number' ? move.declaration : 'x',
    ];
    return parts.join(':');
  }

  function buildCanonicalMoveFromContext(ctx) {
    if (!ctx) return null;
    const canonical = ctx.move ? { ...ctx.move } : {};
    if (ctx.from) {
      canonical.from = { row: ctx.from.row, col: ctx.from.col };
    }
    if (ctx.to) {
      canonical.to = { row: ctx.to.row, col: ctx.to.col };
    }
    if (ctx.declaration !== undefined && ctx.declaration !== null) {
      canonical.declaration = ctx.declaration;
    }
    if (ctx.isPending) {
      canonical.state = MOVE_STATES.PENDING;
    } else if (
      canonical.state === undefined &&
      ctx.move &&
      typeof ctx.move.state === 'number'
    ) {
      canonical.state = ctx.move.state;
    }
    if (typeof canonical.player !== 'number') {
      if (typeof ctx.action?.player === 'number') {
        canonical.player = ctx.action.player;
      } else if (typeof ctx.move?.player === 'number') {
        canonical.player = ctx.move.player;
      } else if (typeof ctx.actor === 'number') {
        canonical.player = ctx.actor;
      }
    }
    return canonical;
  }

  function findLatestMoveAction(actions) {
    if (!Array.isArray(actions)) return null;
    for (let idx = actions.length - 1; idx >= 0; idx -= 1) {
      const candidate = actions[idx];
      if (!candidate || typeof candidate !== 'object') continue;
      if (candidate.type === ACTIONS.MOVE || candidate.type === ACTIONS.BOMB) {
        return candidate;
      }
    }
    return null;
  }

  function buildPostMoveOverlayForMove(move, action) {
    if (!move || !move.to) return null;
    try {
      const from = move.from || {};
      const to = move.to || {};
      const hasOrigin = Number.isFinite(from.row) && Number.isFinite(from.col);
      const originUI = hasOrigin
        ? serverToUICoords(from.row, from.col, currentRows, currentCols, currentIsWhite)
        : null;
      const destUI = serverToUICoords(to.row, to.col, currentRows, currentCols, currentIsWhite);
      if (!destUI) return null;
      if (action && action.type === ACTIONS.BOMB) {
        return { uiR: destUI.uiR, uiC: destUI.uiC, types: ['bombSpeechLeft'] };
      }
      const declaration = typeof move.declaration === 'number'
        ? move.declaration
        : (typeof action?.details?.declaration === 'number' ? action.details.declaration : null);
      const types = declaration ? bubbleTypesForMove(originUI || destUI, destUI, declaration) : [];
      if (!types || types.length === 0) return null;
      return { uiR: destUI.uiR, uiC: destUI.uiC, types };
    } catch (_) {
      return null;
    }
  }

  function setStateFromServer(u, source = 'unknown') {
    try {
      emitLocalClockDebug('client-game-state-received', {
        stateSource: source,
        gameId: u?.gameId || u?._id || lastGameId || null,
        incomingClock: summarizeClockSnapshot(u?.clocks || null),
        incomingPlayerTurn: u?.playerTurn,
        incomingSetupComplete: Array.isArray(u?.setupComplete) ? u.setupComplete.slice(0, 2) : null,
        actionCount: Array.isArray(u?.actions) ? u.actions.length : null,
        moveCount: Array.isArray(u?.moves) ? u.moves.length : null,
      });
      // Avoid overwriting optimistic in-game moves while a drag or selection is active
      if (!dragging) {
        if (Array.isArray(u.board)) currentBoard = u.board; else if (u.board === null) currentBoard = null;
      }
      if (Array.isArray(u.stashes)) currentStashes = u.stashes;
      if (Array.isArray(u.onDecks)) currentOnDecks = u.onDecks;
      if (Array.isArray(u.captured)) {
        currentCaptured = groupCapturedPiecesByColor(u.captured);
      } else if (u.captured === null) {
        currentCaptured = [[], []];
      }
      if (Array.isArray(u.daggers)) currentDaggers = u.daggers;
      if (Object.prototype.hasOwnProperty.call(u, 'setupComplete')) {
        if (Array.isArray(u.setupComplete)) {
          setupComplete = u.setupComplete;
        } else {
          setupComplete = [false, false];
        }
      }
      if (Object.prototype.hasOwnProperty.call(u, 'playerTurn')) {
        currentPlayerTurn = (u.playerTurn === 0 || u.playerTurn === 1) ? u.playerTurn : null;
      }
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
      if (Object.prototype.hasOwnProperty.call(u, 'startTime')) {
        const parsedStart = Date.parse(u.startTime);
        gameStartTime = Number.isFinite(parsedStart) ? parsedStart : null;
      }
      if (Array.isArray(u.actions)) {
        actionHistory = u.actions.map((action) => {
          if (!action || typeof action !== 'object') return action;
          const normalized = { ...action };
          if (typeof normalized.player === 'string') {
            const parsedPlayer = parseInt(normalized.player, 10);
            if (!Number.isNaN(parsedPlayer)) normalized.player = parsedPlayer;
          }
          if (normalized.details && typeof normalized.details === 'object') {
            const details = { ...normalized.details };
            if (typeof details.declaration === 'string') {
              const parsedDecl = parseInt(details.declaration, 10);
              if (!Number.isNaN(parsedDecl)) details.declaration = parsedDecl;
            }
            normalized.details = details;
          }
          return normalized;
        });
        lastAction = actionHistory[actionHistory.length - 1] || null;
        lastMoveAction = findLatestMoveAction(actionHistory);
      } else if (Object.prototype.hasOwnProperty.call(u, 'actions')) {
        actionHistory = [];
        lastAction = null;
        lastMoveAction = null;
      }
      if (Array.isArray(u.moves)) {
        moveHistory = u.moves.map((move) => {
          if (!move || typeof move !== 'object') return move;
          const normalized = { ...move };
          if (typeof normalized.player === 'string') {
            const parsedPlayer = parseInt(normalized.player, 10);
            if (!Number.isNaN(parsedPlayer)) normalized.player = parsedPlayer;
          }
          if (typeof normalized.declaration === 'string') {
            const parsedDecl = parseInt(normalized.declaration, 10);
            if (!Number.isNaN(parsedDecl)) normalized.declaration = parsedDecl;
          }
          return normalized;
        });
      } else if (Object.prototype.hasOwnProperty.call(u, 'moves')) {
        moveHistory = [];
      }
      if (!Array.isArray(moveHistory)) {
        moveHistory = [];
      }

      latestMoveContext = getLatestMoveContext({ actions: actionHistory, moves: moveHistory }) || null;
      if (latestMoveContext) {
        lastMove = buildCanonicalMoveFromContext(latestMoveContext) || null;
      } else if (moveHistory.length) {
        lastMove = moveHistory[moveHistory.length - 1] || null;
      } else {
        lastMove = null;
      }

      const last = lastMove;
      const overlayAction = lastMoveAction || lastAction;
      if (
        last &&
        (last.declaration === undefined || last.declaration === null) &&
        overlayAction &&
        overlayAction.type === ACTIONS.MOVE &&
        overlayAction.details &&
        typeof overlayAction.details.declaration === 'number'
      ) {
        last.declaration = overlayAction.details.declaration;
      }
      const lastMoveKey = makeMoveKey(last);
      if (last && last.state === MOVE_STATES.PENDING) {
        const from = last.from || {};
        const to = last.to || {};
        const hasFromCoords = Number.isFinite(from.row) && Number.isFinite(from.col);
        const hasToCoords = Number.isFinite(to.row) && Number.isFinite(to.col);
        pendingMoveFrom = hasFromCoords ? { row: from.row, col: from.col } : null;
        try {
          if (hasFromCoords && hasToCoords) {
            const moving = currentBoard?.[from.row]?.[from.col] || null;
            const target = currentBoard?.[to.row]?.[to.col] || null;
            if (moving || target) {
              currentBoard = currentBoard.map((row) => row.slice());
              currentBoard[to.row] = currentBoard[to.row].slice();
              currentBoard[from.row] = currentBoard[from.row].slice();
              if (overlayAction && overlayAction.type === ACTIONS.BOMB) {
                const attackerPiece = moving || (last ? { color: last.player, identity: last.declaration } : null);
                const occupant = target || moving || attackerPiece;
                currentBoard[to.row][to.col] = occupant;
                pendingCapture = attackerPiece ? { row: to.row, col: to.col, piece: attackerPiece } : null;
              } else {
                currentBoard[to.row][to.col] = moving || target;
                pendingCapture = target ? { row: to.row, col: to.col, piece: target } : null;
              }
              currentBoard[from.row][from.col] = null;
            }
          }
        } catch (_) { pendingCapture = null; }
        try {
          const overlay = buildPostMoveOverlayForMove(last, overlayAction);
          postMoveOverlay = overlay ? { ...overlay, interactive: false } : null;
          lastPostMoveKey = lastMoveKey;
        } catch (_) {}
      } else {
        pendingCapture = null;
        pendingMoveFrom = null;
        if (!lastMoveKey) {
          postMoveOverlay = null;
          lastPostMoveKey = null;
        } else if (lastMoveKey !== lastPostMoveKey) {
          const overlay = buildPostMoveOverlayForMove(last, overlayAction);
          postMoveOverlay = overlay;
          lastPostMoveKey = lastMoveKey;
        }
      }

      // Determine red tint square for successful challenges
      challengeRemoved = null;
      const prevAction = Array.isArray(actionHistory) ? actionHistory[actionHistory.length - 2] : null;
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
    recomputeClocksFromServer(u?.clocks || null, {
      gameId: u?.gameId || u?._id || lastGameId || null,
    });
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
      if (e.button !== 0) return;
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
      const touchId = Number.isInteger(t?.identifier) ? t.identifier : null;
      const startX = t.clientX, startY = t.clientY;
      let dragStarted = false;
      const move = (ev) => {
        if (dragStarted) return;
        const tt = getTouchFromEventById(ev, touchId);
        if (!tt) return;
        const dx = Math.abs(tt.clientX - startX);
        const dy = Math.abs(tt.clientY - startY);
        if ((dx > DRAG_PX_THRESHOLD_TOUCH || dy > DRAG_PX_THRESHOLD_TOUCH) && originPiece) {
          dragStarted = true;
          document.removeEventListener('touchmove', move);
          // if (DRAG_DEBUG) console.log('[drag] start touch', { target, x: tt.clientX, y: tt.clientY });
          startDrag({ clientX: tt.clientX, clientY: tt.clientY }, target, originPiece, { touchId });
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
      if (e.button !== 0) return;
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
      const touchId = Number.isInteger(t?.identifier) ? t.identifier : null;
      const startX = t.clientX, startY = t.clientY;
      let dragStarted = false;
      const move = (ev) => {
        if (dragStarted) return;
        // Only start a drag if this square has your piece and it's your turn
        if (!piece || piece.color !== myColorIdx || currentPlayerTurn !== myColorIdx) return;
        const tt = getTouchFromEventById(ev, touchId);
        if (!tt) return;
        const dx = Math.abs(tt.clientX - startX);
        const dy = Math.abs(tt.clientY - startY);
        if (dx > DRAG_PX_THRESHOLD_TOUCH || dy > DRAG_PX_THRESHOLD_TOUCH) {
          dragStarted = true; document.removeEventListener('touchmove', move);
          startDrag({ clientX: tt.clientX, clientY: tt.clientY }, sourceTarget, piece, { touchId });
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

  function getCurrentMoveTargetHighlights() {
    if (gameFinished || !currentRows || !currentCols) {
      return [];
    }

    const origin = dragging?.origin || selected;
    if (!origin) {
      return [];
    }

    if (isInSetup) {
      const piece = getPieceAt(origin);
      if (!piece) {
        return [];
      }
      const highlights = getSetupBoardDestinationIndexes({
        workingRank,
        origin,
      }).map((destination) => ({
        targetType: 'board',
        uiR: currentRows - 1,
        uiC: destination.index,
        isCapture: destination.isCapture,
        matchesTrueIdentity: destination.matchesTrueIdentity,
        opacity: destination.opacity,
      }));
      const deckHighlight = getDeckDestinationHighlight({
        origin,
        piece,
        deckPiece: workingOnDeck,
      });
      if (deckHighlight) {
        highlights.push(deckHighlight);
      }
      return highlights;
    }

    const myColorIdx = currentIsWhite ? 0 : 1;
    if (currentOnDeckingPlayer !== null) {
      if (currentOnDeckingPlayer !== myColorIdx || origin.type !== 'stash') {
        return [];
      }
      const piece = currentStashes?.[myColorIdx]?.[origin.index] || dragging?.piece || null;
      const deckHighlight = getDeckDestinationHighlight({
        origin,
        piece,
        deckPiece: currentOnDecks?.[myColorIdx] || null,
      });
      return deckHighlight ? [deckHighlight] : [];
    }

    if (isBombActive() || origin.type !== 'boardAny') {
      return [];
    }

    const piece = getBoardPieceAtUI(origin.uiR, origin.uiC);
    if (!piece || piece.color !== myColorIdx || currentPlayerTurn !== myColorIdx) {
      return [];
    }

    return getLegalBoardDestinationCells({
      currentBoard,
      currentIsWhite,
      rows: currentRows,
      cols: currentCols,
      originUI: { uiR: origin.uiR, uiC: origin.uiC },
      piece,
    });
  }

  function clearBoardMoveTargetMarker(cellEl) {
    if (!cellEl) return;
    try {
      const markers = cellEl.querySelectorAll('[data-move-target-marker="1"]');
      markers.forEach((marker) => {
        try {
          marker.remove();
        } catch (_) {}
      });
    } catch (_) {}
  }

  function setBoardMoveTargetMarker(cellEl, highlight) {
    if (!cellEl || !highlight) return;
    clearBoardMoveTargetMarker(cellEl);

    const marker = document.createElement('span');
    marker.dataset.moveTargetMarker = '1';
    marker.className = highlight.isCapture
      ? 'cg-move-target-marker cg-move-target-marker--capture'
      : 'cg-move-target-marker';
    marker.style.setProperty(
      '--cg-move-target-opacity',
      String(Number.isFinite(Number(highlight.opacity)) ? Number(highlight.opacity) : 0.4),
    );
    cellEl.appendChild(marker);
  }

  function syncBoardMoveTargetHighlights(highlights = []) {
    const boardCellEntries = [];
    try {
      if (Array.isArray(refs.boardCells)) {
        refs.boardCells.forEach((row) => {
          if (!Array.isArray(row)) return;
          row.forEach((entry) => {
            if (entry?.el) boardCellEntries.push(entry.el);
          });
        });
      }
      if (Array.isArray(refs.bottomCells)) {
        refs.bottomCells.forEach((entry) => {
          if (entry?.el) boardCellEntries.push(entry.el);
        });
      }
      if (refs.deckEl) {
        boardCellEntries.push(refs.deckEl);
      }
    } catch (_) {}

    boardCellEntries.forEach((cellEl) => clearBoardMoveTargetMarker(cellEl));

    if (!Array.isArray(highlights) || highlights.length === 0) {
      return;
    }

    highlights.forEach((highlight) => {
      if (!highlight) return;
      const cellEl = highlight.targetType === 'deck'
        ? refs.deckEl || null
        : (isInSetup
          ? refs.bottomCells?.[highlight.uiC]?.el || null
          : refs.boardCells?.[highlight.uiR]?.[highlight.uiC]?.el || null);
      if (!cellEl) return;
      setBoardMoveTargetMarker(cellEl, highlight);
    });
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
      if (selected.uiR === sourceTarget.uiR && selected.uiC === sourceTarget.uiC) {
        selected = null;
        renderBoardAndBars();
        return;
      }
      const targetPiece = getBoardPieceAtUI(sourceTarget.uiR, sourceTarget.uiC);
      const myColorIdx = currentIsWhite ? 0 : 1;
      if (targetPiece && targetPiece.color === myColorIdx && currentPlayerTurn === myColorIdx) {
        selected = { ...sourceTarget };
        renderBoardAndBars();
        return;
      }
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
      if (origin.uiR === dest.uiR && origin.uiC === dest.uiC) return false;
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
      if (legal.length === 0) {
        showIllegalMoveToast();
        return false;
      }

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
          emitLocalClockDebug('client-action-submit', {
            action: 'move',
            color,
            from,
            to,
            declaration: decl,
          });
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
      clearDragPreviewImgs();
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
      let types = [];
      if (declaration === Declaration.KNIGHT) types = ['knightSpeechLeft'];
      else if (declaration === Declaration.ROOK) {
        // Always show the rook declaration speech bubble once a move is final
        types = ['rookSpeechLeft'];
      }
      else if (declaration === Declaration.BISHOP) {
        // Always show the bishop declaration speech bubble once a move is final
        types = ['bishopSpeechLeft'];
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
        emitLocalClockDebug('client-action-submit', {
          action: 'move',
          color: myColorIdx,
          from,
          to,
          declaration,
        });
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
      if (piece && canPieceBePlacedOnDeck(piece)) {
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
          emitLocalClockDebug('client-action-submit', {
            action: 'onDeck',
            color: myColorIdx,
            identity: piece.identity,
          });
          apiOnDeck(lastGameId, myColorIdx, { identity: piece.identity }).catch(err => console.error('onDeck failed', err));
        }
        return;
      }
    }
    selected = null; renderBoardAndBars();
  }

  function getTouchFromEventById(ev, touchId) {
    try {
      const hasTouchId = Number.isInteger(touchId);
      if (hasTouchId) {
        const touches = Array.from(ev?.touches || []);
        const changed = Array.from(ev?.changedTouches || []);
        const foundActive = touches.find((entry) => entry && entry.identifier === touchId);
        if (foundActive) return foundActive;
        const foundChanged = changed.find((entry) => entry && entry.identifier === touchId);
        if (foundChanged) return foundChanged;
      }
      return (ev?.touches && ev.touches[0]) || (ev?.changedTouches && ev.changedTouches[0]) || null;
    } catch (_) {
      return (ev?.touches && ev.touches[0]) || (ev?.changedTouches && ev.changedTouches[0]) || null;
    }
  }

  function setBoardDragOriginOverlay(origin, active) {
    if (!origin) return null;
    let cellEl = null;
    try {
      if (origin.type === 'boardAny') {
        cellEl = refs.boardCells?.[origin.uiR]?.[origin.uiC]?.el || null;
      } else if (origin.type === 'board') {
        cellEl = refs.bottomCells?.[origin.index]?.el || null;
      }
      if (!cellEl) return null;
      if (active) {
        cellEl.style.background = 'rgba(0, 0, 0, 0.32)';
      } else {
        cellEl.style.background = 'transparent';
      }
    } catch (_) {}
    return cellEl;
  }

  function startDrag(e, origin, piece, opts = null) {
    if (gameFinished) return;
    purgeDanglingDragArtifacts({ force: true });
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
    try { ghost.setAttribute('data-drag-ghost', '1'); } catch (_) {}
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
    let originEl = null;
    if (origin && (origin.type === 'boardAny' || origin.type === 'board')) {
      try {
        originEl = setBoardDragOriginOverlay(origin, true);
      } catch (_) {}
    } else {
      if (origin.type === 'stash') originEl = refs.stashSlots?.[origin.index]?.el || null;
      else if (origin.type === 'deck') originEl = refs.deckEl || null;
      try {
        if (originEl) originEl.style.opacity = '0.5';
      } catch (_) {}
    }
    const touchId = Number.isInteger(opts?.touchId) ? opts.touchId : null;
    dragging = {
      piece,
      origin,
      ghostEl: ghost,
      originEl,
      touchId,
      lastClientX: startCX,
      lastClientY: startCY,
    };
    syncBoardMoveTargetHighlights(getCurrentMoveTargetHighlights());
    suppressMouseUntil = Date.now() + 700; // extend suppression window during drag
    // if (DRAG_DEBUG) console.log('[drag] ghost init', { x: startCX, y: startCY, origin });
    // Do not re-render here; we dim the origin element directly to avoid disrupting touch event streams
    const move = (ev) => {
      if (!dragging) return;
      try { if (ev.cancelable) ev.preventDefault(); } catch (_) {}
      const t = getTouchFromEventById(ev, dragging.touchId);
      const x = (t && t.clientX !== undefined) ? t.clientX : ev.clientX;
      const y = (t && t.clientY !== undefined) ? t.clientY : ev.clientY;
      if (typeof x === 'number') {
        ghost.style.left = x + 'px';
        dragging.lastClientX = x;
      }
      if (typeof y === 'number') {
        ghost.style.top = y + 'px';
        dragging.lastClientY = y;
      }
      // Drag preview bubbles following the pointer over legal destination squares
      if (!isInSetup && boardView) {
        const over = boardView.hitTestBoard(x, y);
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
      try { window.removeEventListener('touchend', up, true); } catch (_) {}
      try { window.removeEventListener('touchcancel', up, true); } catch (_) {}
      if (!dragging) return;
      const endTouch = getTouchFromEventById(ev, dragging.touchId);
      const cx = ev.clientX !== undefined
        ? ev.clientX
        : ((endTouch && endTouch.clientX !== undefined) ? endTouch.clientX : dragging.lastClientX);
      const cy = ev.clientY !== undefined
        ? ev.clientY
        : ((endTouch && endTouch.clientY !== undefined) ? endTouch.clientY : dragging.lastClientY);
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
              if (piece && canPieceBePlacedOnDeck(piece)) {
                currentStashes = currentStashes.map((arr, idx) => {
                  if (idx !== myColorIdx) return arr;
                  const clone = Array.isArray(arr) ? arr.slice() : [];
                  clone[ord] = null;
                  return clone;
                });
                currentOnDecks = currentOnDecks.map((p, idx) => (idx === myColorIdx ? piece : p));
                currentOnDeckingPlayer = null;
                if (lastGameId) {
                  emitLocalClockDebug('client-action-submit', {
                    action: 'onDeck',
                    color: myColorIdx,
                    identity: piece.identity,
                  });
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
      try {
        if (dragging.origin && (dragging.origin.type === 'boardAny' || dragging.origin.type === 'board')) {
          setBoardDragOriginOverlay(dragging.origin, false);
        } else if (dragging.originEl) {
          dragging.originEl.style.opacity = '';
        }
      } catch(_) {}
      dragging = null; selected = null; renderBoardAndBars();
      purgeDanglingDragArtifacts();
      suppressMouseUntil = Date.now() + 400; // brief suppression post-drag
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false, capture: true });
    window.addEventListener('touchmove', move, { passive: false, capture: true });
    document.addEventListener('touchend', up);
    document.addEventListener('touchcancel', up);
    window.addEventListener('touchend', up, true);
    window.addEventListener('touchcancel', up, true);
  }

  function hitTestDrop(x, y) {
    // If not in setup, allow dropping on any board cell
    if (!isInSetup && boardView) {
      const hit = boardView.hitTestBoard(x, y);
      if (hit) {
        return { type: 'boardAny', uiR: hit.uiR, uiC: hit.uiC };
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
