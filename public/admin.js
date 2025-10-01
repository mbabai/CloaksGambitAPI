import { computeHistorySummary, describeMatch, buildMatchDetailGrid, normalizeId } from '/js/modules/history/dashboard.js';
import { createDaggerCounter } from '/js/modules/ui/banners.js';
import { createEloBadge } from '/js/modules/render/eloBadge.js';
import { renderBars } from '/js/modules/render/bars.js';
import { createBoardView } from '/js/modules/components/boardView.js';
import { computeBoardMetrics } from '/js/modules/layout.js';
import { PIECE_IMAGES, ACTIONS } from '/js/modules/constants.js';
import { formatClock, describeTimeControl } from '/js/modules/utils/timeControl.js';
import { computeGameClockState } from '/js/modules/utils/clockState.js';
import { getCookie } from '/js/modules/utils/cookies.js';
import { preloadAssets } from '/js/modules/utils/assetPreloader.js';
import { getBubbleAsset } from '/js/modules/ui/icons.js';
import { deriveSpectateView } from '/js/modules/spectate/viewModel.js';

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

  const spectateOverlay = document.getElementById('spectateOverlay');
  const spectatePlayArea = document.getElementById('spectatePlayArea');
  const spectateBoardEl = document.getElementById('spectateBoard');
  const spectateTopBar = document.getElementById('spectateTopBar');
  const spectateBottomBar = document.getElementById('spectateBottomBar');
  const spectateStatusEl = document.getElementById('spectateStatus');
  const spectateScoreEl = document.getElementById('spectateScore');
  const spectateBannerEl = document.getElementById('spectateBanner');
  const spectateMetaEl = document.getElementById('spectateMeta');
  const spectateCloseBtn = document.getElementById('spectateCloseBtn');

  const spectateRefs = { boardCells: [], activeBubbles: [] };
  const spectateBoardView = spectateBoardEl
    ? createBoardView({
        container: spectateBoardEl,
        identityMap: PIECE_IMAGES,
        refs: spectateRefs,
        alwaysAttachGameRefs: true
      })
    : null;
  if (spectateBoardView) {
    spectateBoardView.setReadOnly(true);
  }

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

  const spectateState = {
    matchId: null,
    data: null,
    loading: false,
    resizeHandler: null,
    clockTimer: null,
    clockBase: null,
    clockDisplay: { whiteMs: 0, blackMs: 0, label: null },
    clockRefs: { top: null, bottom: null }
  };

  const confirmModal = createConfirmationModal();

  function stopSpectateClockTimer() {
    if (spectateState.clockTimer) {
      clearInterval(spectateState.clockTimer);
      spectateState.clockTimer = null;
    }
  }

  function updateSpectateClockElements() {
    const topEl = spectateState.clockRefs?.top;
    const bottomEl = spectateState.clockRefs?.bottom;
    const display = spectateState.clockDisplay || { whiteMs: 0, blackMs: 0 };
    if (topEl) {
      topEl.textContent = formatClock(display.blackMs || 0);
    }
    if (bottomEl) {
      bottomEl.textContent = formatClock(display.whiteMs || 0);
    }
  }

  function updateSpectateClockDisplay() {
    const base = spectateState.clockBase;
    if (!base) {
      spectateState.clockDisplay = { whiteMs: 0, blackMs: 0, label: null };
      updateSpectateClockElements();
      return;
    }
    const now = Date.now();
    const elapsed = Math.max(0, now - base.receivedAt);
    let white = base.whiteMs;
    let black = base.blackMs;
    if (base.tickingWhite) {
      white -= elapsed;
    }
    if (base.tickingBlack) {
      black -= elapsed;
    }
    spectateState.clockDisplay = {
      whiteMs: Math.max(0, Math.round(white)),
      blackMs: Math.max(0, Math.round(black)),
      label: base.label || null,
    };
    updateSpectateClockElements();
  }

  function resetSpectateClockState() {
    stopSpectateClockTimer();
    spectateState.clockBase = null;
    spectateState.clockDisplay = { whiteMs: 0, blackMs: 0, label: null };
    updateSpectateClockElements();
  }

  function syncSpectateClocks(snapshot) {
    const game = snapshot?.game || null;
    if (!game) {
      resetSpectateClockState();
      return;
    }

    const baseTime = Number(game.timeControlStart);
    if (!Number.isFinite(baseTime) || baseTime <= 0) {
      resetSpectateClockState();
      return;
    }

    const matchActive = snapshot?.match?.isActive !== false;
    const now = Date.now();
    const computed = computeGameClockState({
      baseTime,
      increment: game.increment,
      startTime: game.startTime,
      endTime: game.endTime,
      actions: game.actions,
      setupComplete: game.setupComplete,
      playerTurn: game.playerTurn ?? snapshot?.clocks?.activeColor,
      isActive: Boolean(game.isActive && matchActive),
      now,
    });

    const setupFlags = Array.isArray(computed.setupComplete)
      ? computed.setupComplete
      : [false, false];
    const whiteSetupComplete = setupFlags[0] ?? false;
    const blackSetupComplete = setupFlags[1] ?? false;
    const bothSetupComplete = whiteSetupComplete && blackSetupComplete;
    const clocksActive = Boolean(game.isActive && matchActive);
    const tickWhite = clocksActive && (bothSetupComplete ? computed.activeColor === 0 : !whiteSetupComplete);
    const tickBlack = clocksActive && (bothSetupComplete ? computed.activeColor === 1 : !blackSetupComplete);

    const whiteMs = Number.isFinite(computed.whiteMs) ? computed.whiteMs : 0;
    const blackMs = Number.isFinite(computed.blackMs) ? computed.blackMs : 0;
    const label = snapshot?.clocks?.label
      || describeTimeControl(game.timeControlStart, game.increment)
      || null;

    spectateState.clockBase = {
      whiteMs,
      blackMs,
      activeColor: computed.activeColor,
      label,
      receivedAt: now,
      tickingWhite: tickWhite,
      tickingBlack: tickBlack,
    };
    updateSpectateClockDisplay();
    stopSpectateClockTimer();
    if (tickWhite || tickBlack) {
      spectateState.clockTimer = setInterval(updateSpectateClockDisplay, 200);
    }
  }

  function clearSpectateBubbles() {
    if (!Array.isArray(spectateRefs.activeBubbles)) {
      spectateRefs.activeBubbles = [];
      return;
    }
    spectateRefs.activeBubbles.forEach((img) => {
      try {
        if (img && img.parentNode) {
          img.parentNode.removeChild(img);
        }
      } catch (_) {}
    });
    spectateRefs.activeBubbles = [];
  }

  function makeSpectateBubbleImg(type, squareSize) {
    const src = getBubbleAsset(type);
    if (!src) return null;
    const img = document.createElement('img');
    img.dataset.bubble = '1';
    img.dataset.bubbleType = type;
    img.draggable = false;
    img.style.position = 'absolute';
    img.style.pointerEvents = 'none';
    img.style.zIndex = '1001';
    const size = Math.max(0, Math.floor(squareSize * 1.08));
    img.style.width = `${size}px`;
    img.style.height = 'auto';
    const offsetX = Math.floor(squareSize * 0.6);
    const offsetY = Math.floor(squareSize * 0.5);
    if (typeof type === 'string' && type.endsWith('Right')) {
      img.style.right = `${-offsetX}px`;
      img.style.left = 'auto';
    } else {
      img.style.left = `${-offsetX}px`;
      img.style.right = 'auto';
    }
    img.style.top = `${-offsetY}px`;
    img.src = src;
    img.alt = '';
    return img;
  }

  function applySpectateMoveOverlay(squareSize, overlay) {
    if (!spectateRefs.boardCells) return;
    clearSpectateBubbles();
    if (!overlay) return;
    const cellRef = spectateRefs.boardCells?.[overlay.uiR]?.[overlay.uiC];
    if (!cellRef || !cellRef.el) return;
    overlay.types.forEach((type) => {
      const img = makeSpectateBubbleImg(type, squareSize);
      if (!img) return;
      try { cellRef.el.style.position = 'relative'; } catch (_) {}
      cellRef.el.appendChild(img);
      spectateRefs.activeBubbles.push(img);
    });
  }

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
    const eloCells = [];
    const matchCells = [];
    const connCells = [];
    const actionCells = [];
    const columnGap = '20px';

    const header = document.createElement('div');
    header.className = 'row headerRow';
    header.style.display = 'flex';
    header.style.alignItems = 'center';
    header.style.justifyContent = 'flex-start';
    header.style.gap = columnGap;
    const hName = document.createElement('span');
    hName.textContent = 'Username';
    hName.style.flex = '1 1 auto';
    hName.style.minWidth = '0';
    const hElo = document.createElement('span');
    hElo.textContent = 'ELO';
    hElo.style.display = 'inline-grid';
    hElo.style.placeItems = 'center';
    hElo.style.whiteSpace = 'nowrap';
    hElo.style.wordBreak = 'keep-all';
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
    const hAction = document.createElement('span');
    hAction.textContent = 'Delete';
    hAction.style.display = 'inline-flex';
    hAction.style.justifyContent = 'center';
    hAction.style.alignItems = 'center';
    hAction.style.whiteSpace = 'nowrap';
    hAction.style.wordBreak = 'keep-all';

    header.appendChild(hName);
    header.appendChild(hElo);
    header.appendChild(hMatch);
    header.appendChild(hConn);
    header.appendChild(hAction);
    eloCells.push(hElo);
    matchCells.push(hMatch);
    connCells.push(hConn);
    actionCells.push(hAction);
    frag.appendChild(header);

    users.forEach(u => {
      const row = document.createElement('div');
      row.className = 'row';
      row.style.display = 'flex';
      row.style.alignItems = 'center';
      row.style.justifyContent = 'flex-start';
      row.style.gap = columnGap;
      const username = u.username || 'Unknown';
      const nameEl = document.createElement(adminUserId && u.id === adminUserId ? 'strong' : 'span');
      nameEl.textContent = username;
      nameEl.title = u.id;
      nameEl.style.flex = '1 1 auto';
      nameEl.style.minWidth = '0';
      const eloEl = document.createElement('span');
      eloEl.style.display = 'inline-grid';
      eloEl.style.placeItems = 'center';
      eloEl.style.whiteSpace = 'nowrap';
      eloEl.style.wordBreak = 'keep-all';
      eloEl.style.padding = '0 2px';
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
      const actionEl = document.createElement('span');
      actionEl.className = 'userActionCell';
      actionEl.style.display = 'inline-flex';
      actionEl.style.justifyContent = 'center';
      actionEl.style.alignItems = 'center';
      actionEl.style.whiteSpace = 'nowrap';
      actionEl.style.wordBreak = 'keep-all';
      actionEl.style.padding = '0 2px';

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'user-delete-btn';
      deleteBtn.setAttribute('aria-label', `Delete ${username}`);
      deleteBtn.title = `Delete ${username}`;
      deleteBtn.textContent = '🗑';
      deleteBtn.addEventListener('click', () => {
        requestUserDeletion({ id: u.id, username });
      });

      actionEl.appendChild(deleteBtn);

      row.appendChild(nameEl);
      row.appendChild(eloEl);
      row.appendChild(matchEl);
      row.appendChild(connEl);
      row.appendChild(actionEl);
      eloCells.push(eloEl);
      matchCells.push(matchEl);
      connCells.push(connEl);
      actionCells.push(actionEl);
      frag.appendChild(row);
    });
    targetEl.appendChild(frag);
    let eloWidth = 0;
    let matchWidth = 0;
    let connWidth = 0;
    let actionWidth = 0;
    eloCells.forEach(cell => {
      eloWidth = Math.max(eloWidth, Math.ceil(cell.getBoundingClientRect().width));
    });
    matchCells.forEach(cell => {
      matchWidth = Math.max(matchWidth, Math.ceil(cell.getBoundingClientRect().width));
    });
    connCells.forEach(cell => {
      connWidth = Math.max(connWidth, Math.ceil(cell.getBoundingClientRect().width));
    });
    actionCells.forEach(cell => {
      actionWidth = Math.max(actionWidth, Math.ceil(cell.getBoundingClientRect().width));
    });
    const setColumnWidth = (cells, width) => {
      if (!width) return;
      cells.forEach(cell => {
        cell.style.flex = `0 0 ${width}px`;
        cell.style.maxWidth = `${width}px`;
        cell.style.minWidth = `${width}px`;
      });
    };
    setColumnWidth(eloCells, eloWidth);
    setColumnWidth(matchCells, matchWidth);
    setColumnWidth(connCells, connWidth);
    setColumnWidth(actionCells, actionWidth);
  }

  async function requestUserDeletion(user) {
    if (!user) return;
    const normalizedId = normalizeId(user.id || user.userId || user);
    if (!normalizedId) {
      alert('Unable to delete user: missing identifier.');
      return;
    }

    const username = typeof user.username === 'string' && user.username.trim()
      ? user.username.trim()
      : getUsername(normalizedId);

    const confirmed = await confirmModal.show({
      title: 'Delete Account',
      message: `Delete account "${username}"? This cannot be undone.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
    });

    if (!confirmed) return;

    try {
      const res = await authFetch('/api/v1/users/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': (localStorage.getItem('ADMIN_SECRET') || '')
        },
        body: JSON.stringify({ userId: normalizedId })
      });

      if (!res.ok) {
        let errorMessage = 'Failed to delete user account.';
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

      alert(`Account for "${username}" deleted successfully.`);
    } catch (err) {
      console.error('Error deleting user account:', err);
      alert('Error deleting user account. Check console for details.');
    } finally {
      fetchAllUsers();
    }
  }

  function createConfirmationModal() {
    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');

    const dialog = document.createElement('div');
    dialog.className = 'admin-modal';

    const titleEl = document.createElement('h3');
    titleEl.className = 'admin-modal-title';
    titleEl.textContent = 'Confirm Action';

    const messageEl = document.createElement('p');
    messageEl.className = 'admin-modal-message';
    messageEl.textContent = '';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'admin-modal-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'admin-modal-button';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = 'admin-modal-button admin-modal-button--danger';
    confirmBtn.textContent = 'Confirm';

    actionsEl.appendChild(cancelBtn);
    actionsEl.appendChild(confirmBtn);

    dialog.appendChild(titleEl);
    dialog.appendChild(messageEl);
    dialog.appendChild(actionsEl);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    let resolver = null;
    let lastActiveElement = null;

    function close(result) {
      if (overlay.hidden) return;
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      document.removeEventListener('keydown', handleKeyDown, true);
      if (typeof resolver === 'function') {
        resolver(result);
      }
      resolver = null;
      if (lastActiveElement && typeof lastActiveElement.focus === 'function') {
        lastActiveElement.focus();
      }
      lastActiveElement = null;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
    }

    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', event => {
      if (event.target === overlay) {
        close(false);
      }
    });

    return {
      show(options = {}) {
        const { title, message, confirmText, cancelText } = options;
        if (typeof title === 'string' && title.trim()) {
          titleEl.textContent = title.trim();
        } else {
          titleEl.textContent = 'Confirm Action';
        }
        if (typeof message === 'string' && message.trim()) {
          messageEl.textContent = message.trim();
        } else {
          messageEl.textContent = 'Are you sure?';
        }
        if (typeof confirmText === 'string' && confirmText.trim()) {
          confirmBtn.textContent = confirmText.trim();
        } else {
          confirmBtn.textContent = 'Confirm';
        }
        if (typeof cancelText === 'string' && cancelText.trim()) {
          cancelBtn.textContent = cancelText.trim();
        } else {
          cancelBtn.textContent = 'Cancel';
        }

        overlay.hidden = false;
        overlay.removeAttribute('aria-hidden');
        lastActiveElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        document.addEventListener('keydown', handleKeyDown, true);

        setTimeout(() => {
          confirmBtn.focus();
        }, 0);

        return new Promise(resolve => {
          resolver = resolve;
        });
      }
    };
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

  function resolveMatchType(source) {
    if (!source) return null;
    const candidates = [
      source.type,
      source.matchType,
      source.mode,
      source.matchMode,
      source.gameMode,
      source?.settings?.type,
      source?.settings?.mode,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate.trim().toUpperCase();
      }
    }
    return null;
  }

  function resolveScoreValue(...values) {
    const candidates = [];
    values.forEach(value => {
      if (value === undefined || value === null) return;
      if (typeof value === 'object') {
        if ('wins' in value) {
          const parsed = normalizeScoreValue(value.wins);
          if (Number.isFinite(parsed)) candidates.push(parsed);
        }
        if ('count' in value) {
          const parsed = normalizeScoreValue(value.count);
          if (Number.isFinite(parsed)) candidates.push(parsed);
        }
        if ('value' in value) {
          const parsed = normalizeScoreValue(value.value);
          if (Number.isFinite(parsed)) candidates.push(parsed);
        }
      }
      const parsed = normalizeScoreValue(value);
      if (Number.isFinite(parsed)) candidates.push(parsed);
    });
    if (candidates.length === 0) return null;
    return Math.max(...candidates);
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
    const normalized = {
      id,
      type: resolveMatchType(match),
      players,
      player1Score: resolveScoreValue(
        match.player1Score,
        match.player1_score,
        match.scores?.[0],
        match.scores?.player1,
        match.results?.player1?.wins,
      ),
      player2Score: resolveScoreValue(
        match.player2Score,
        match.player2_score,
        match.scores?.[1],
        match.scores?.player2,
        match.results?.player2?.wins,
      ),
      drawCount: resolveScoreValue(
        match.drawCount,
        match.draws,
        match.scores?.[2],
        match.scores?.draws,
        match.results?.draws,
      ),
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
    const upper = String(type).trim().toUpperCase();
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
        if (item?.id) {
          openSpectateModal(item.id);
        }
      });
      row.appendChild(spectateBtn);

      frag.appendChild(row);
    });

    targetEl.appendChild(frag);
  }

  function clearSpectateVisuals() {
    if (spectateStatusEl) spectateStatusEl.textContent = '';
    if (spectateScoreEl) spectateScoreEl.textContent = '';
    if (spectateBannerEl) {
      spectateBannerEl.textContent = '';
      spectateBannerEl.hidden = true;
      spectateBannerEl.className = 'spectate-banner';
    }
    if (spectateMetaEl) spectateMetaEl.textContent = '';
    if (spectateTopBar) spectateTopBar.innerHTML = '';
    if (spectateBottomBar) spectateBottomBar.innerHTML = '';
    if (spectateBoardView) spectateBoardView.destroy();
    spectateRefs.boardCells = [];
    clearSpectateBubbles();
    resetSpectateClockState();
    spectateState.clockRefs = { top: null, bottom: null };
  }

  function resolveSpectatePlayer(snapshot, id, fallbackLabel) {
    if (!id) return { name: fallbackLabel, elo: null };
    const key = String(id);
    const playersMap = snapshot?.players || {};
    const entry = playersMap[key] || playersMap[id] || null;
    const username = entry?.username || getUsername(key) || fallbackLabel;
    const elo = Number.isFinite(entry?.elo) ? entry.elo : null;
    return { name: username, elo };
  }

  function renderSpectateMeta(snapshot) {
    if (!spectateMetaEl) return;
    spectateMetaEl.textContent = '';
    const match = snapshot?.match || {};
    const pieces = [];
    if (match.type) pieces.push(`Type: ${formatMatchTypeLabel(match.type)}`);
    if (snapshot?.game?.id) pieces.push(`Game ID: ${snapshot.game.id}`);
    if (match.isActive === false) {
      pieces.push('Match complete');
    } else if (snapshot?.game && snapshot.game.isActive === false) {
      pieces.push('Game complete');
    }
    spectateMetaEl.textContent = pieces.join(' • ');
  }

  function renderSpectateScore(snapshot) {
    if (!spectateScoreEl) return;
    spectateScoreEl.innerHTML = '';
    const match = snapshot?.match;
    if (!match) return;
    const player1Id = match.player1Id || match.player1?.id;
    const player2Id = match.player2Id || match.player2?.id;
    const player1 = resolveSpectatePlayer(snapshot, player1Id, 'Player 1');
    const player2 = resolveSpectatePlayer(snapshot, player2Id, 'Player 2');
    const scoreWrap = document.createDocumentFragment();
    const span1 = document.createElement('span');
    span1.textContent = player1.name;
    span1.style.fontWeight = '700';
    const scoreSpan = document.createElement('span');
    scoreSpan.textContent = `${Number(match.player1Score || 0)} - ${Number(match.player2Score || 0)}`;
    const span2 = document.createElement('span');
    span2.textContent = player2.name;
    span2.style.fontWeight = '700';
    scoreWrap.appendChild(span1);
    scoreWrap.appendChild(scoreSpan);
    scoreWrap.appendChild(span2);
    const draws = Number(match.drawCount || 0);
    if (draws > 0) {
      const drawSpan = document.createElement('span');
      drawSpan.textContent = `Draws: ${draws}`;
      scoreWrap.appendChild(drawSpan);
    }
    spectateScoreEl.appendChild(scoreWrap);
  }

  function renderSpectateBanner(snapshot) {
    if (!spectateBannerEl) return;
    spectateBannerEl.hidden = true;
    spectateBannerEl.textContent = '';
    spectateBannerEl.className = 'spectate-banner';
    const match = snapshot?.match;
    if (!match) return;
    if (match.isActive === false) {
      const winnerId = match.winnerId || match.winner || match.winner?._id;
      const winner = resolveSpectatePlayer(snapshot, winnerId, 'Winner');
      const p1Score = Number(match.player1Score || 0);
      const p2Score = Number(match.player2Score || 0);
      const draws = Number(match.drawCount || 0);
      const parts = [`${winner.name} wins the match ${p1Score}-${p2Score}`];
      if (draws > 0) {
        parts.push(`with ${draws} draw${draws === 1 ? '' : 's'}`);
      }
      spectateBannerEl.textContent = parts.join(' ');
      spectateBannerEl.classList.add('spectate-banner--success');
      spectateBannerEl.hidden = false;
    } else if (snapshot?.game && snapshot.game.isActive === false) {
      spectateBannerEl.textContent = 'Awaiting the next game in this match…';
      spectateBannerEl.classList.add('spectate-banner--info');
      spectateBannerEl.hidden = false;
    }
  }

  function renderSpectateBarsForSnapshot(snapshot, baseSizes) {
    if (!spectateBoardView || !spectateTopBar || !spectateBottomBar) return;
    spectateTopBar.innerHTML = '';
    spectateBottomBar.innerHTML = '';
    if (!snapshot) return;
    const game = snapshot.game;
    if (!game) return;
    const match = snapshot.match || {};
    const players = Array.isArray(game.players) ? game.players.map(id => id && id.toString()) : [];
    const whiteId = players[0] || match.player1Id || match.player1?.id;
    const blackId = players[1] || match.player2Id || match.player2?.id;
    const white = resolveSpectatePlayer(snapshot, whiteId, 'White');
    const black = resolveSpectatePlayer(snapshot, blackId, 'Black');
    const isRankedMatch = String(match.type || '').toUpperCase() === 'RANKED';
    const p1Score = Number(match.player1Score || 0);
    const p2Score = Number(match.player2Score || 0);
    const daggers = Array.isArray(game.daggers) ? game.daggers : [0, 0];
    const captured = Array.isArray(game.captured) ? game.captured : [[], []];
    const lastAction = Array.isArray(game.actions) ? game.actions[game.actions.length - 1] : null;
    const challengeOutcome = lastAction?.details?.outcome;
    const challengeActive = lastAction?.type === ACTIONS.CHALLENGE
      && (!challengeOutcome || String(challengeOutcome).toUpperCase() === 'PENDING');
    const showChallengeTop = challengeActive && lastAction.player === 1;
    const showChallengeBottom = challengeActive && lastAction.player === 0;
    const displayClocks = spectateState.clockDisplay || {};
    const clockLabel = displayClocks.label
      || snapshot?.clocks?.label
      || describeTimeControl(game.timeControlStart, game.increment);
    const whiteMs = Number.isFinite(displayClocks.whiteMs) ? displayClocks.whiteMs : 0;
    const blackMs = Number.isFinite(displayClocks.blackMs) ? displayClocks.blackMs : 0;

    const bars = renderBars({
      topBar: spectateTopBar,
      bottomBar: spectateBottomBar,
      sizes: {
        squareSize: baseSizes.squareSize,
        boardWidth: baseSizes.boardWidth,
        boardHeight: baseSizes.boardHeight,
        boardLeft: baseSizes.boardLeft,
        boardTop: baseSizes.boardTop,
        playAreaHeight: spectatePlayArea?.clientHeight || (baseSizes.boardHeight * 2)
      },
      state: {
        currentIsWhite: true,
        currentCaptured: captured,
        currentDaggers: daggers,
        showChallengeTop,
        showChallengeBottom,
        clockTop: formatClock(blackMs),
        clockBottom: formatClock(whiteMs),
        clockLabel,
        nameTop: black.name,
        nameBottom: white.name,
        winsTop: p2Score,
        winsBottom: p1Score,
        connectionTop: null,
        connectionBottom: null,
        isRankedMatch,
        eloTop: black.elo,
        eloBottom: white.elo
      },
      identityMap: PIECE_IMAGES
    });
    spectateState.clockRefs = {
      top: bars?.topClockEl || null,
      bottom: bars?.bottomClockEl || null,
    };
    updateSpectateClockElements();
  }

  function renderSpectateBoard(snapshot) {
    if (!spectateBoardView || !spectatePlayArea) return;
    const game = snapshot?.game;
    if (!game || !Array.isArray(game.board) || !game.board.length) {
      spectateBoardView.destroy();
      spectateRefs.boardCells = [];
      if (spectateTopBar) spectateTopBar.innerHTML = '';
      if (spectateBottomBar) spectateBottomBar.innerHTML = '';
      return;
    }
    const viewState = deriveSpectateView(game);
    const rows = viewState.rows;
    const cols = viewState.cols;
    if (!rows || !cols) return;
    const boardForRender = viewState.board;
    const pendingMoveFrom = viewState.pendingMoveFrom;
    const pendingCapture = viewState.pendingCapture;
    const challengeRemoved = viewState.challengeRemoved;
    const overlay = viewState.overlay;
    const metrics = computeBoardMetrics(
      spectatePlayArea.clientWidth,
      spectatePlayArea.clientHeight,
      cols,
      rows
    );
    spectateRefs.boardCells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
    spectateBoardView.render({
      sizes: {
        rows,
        cols,
        squareSize: metrics.squareSize,
        boardLeft: metrics.boardLeft,
        boardTop: metrics.boardTop
      },
      state: {
        currentBoard: boardForRender,
        currentIsWhite: true,
        selected: null,
        isInSetup: false,
        workingRank: new Array(cols).fill(null),
        pendingCapture,
        pendingMoveFrom,
        challengeRemoved
      },
      onAttachGameHandlers: (cell, uiR, uiC) => {
        if (!spectateRefs.boardCells[uiR]) {
          spectateRefs.boardCells[uiR] = [];
        }
        spectateRefs.boardCells[uiR][uiC] = { el: cell, uiR, uiC };
      },
      labelFont: Math.max(10, Math.floor(0.024 * spectatePlayArea.clientHeight)),
      fileLetters: ['A', 'B', 'C', 'D', 'E'],
      readOnly: true,
        deploymentLines: true
    });
    renderSpectateBarsForSnapshot(snapshot, {
      squareSize: metrics.squareSize,
      boardWidth: metrics.boardWidth,
      boardHeight: metrics.boardHeight,
      boardLeft: metrics.boardLeft,
      boardTop: metrics.boardTop
    });
    applySpectateMoveOverlay(metrics.squareSize, overlay);
  }

  function renderSpectateContent(snapshot) {
    if (!spectateOverlay || spectateOverlay.hidden) return;
    spectateState.data = snapshot;
    syncSpectateClocks(snapshot);
    renderSpectateMeta(snapshot);
    renderSpectateScore(snapshot);
    renderSpectateBanner(snapshot);
    if (spectateStatusEl) {
      const match = snapshot?.match;
      const game = snapshot?.game;
      if (!game) {
        spectateStatusEl.textContent = match?.isActive ? 'No active game for this match.' : 'Match complete.';
      } else if (game.isActive) {
        spectateStatusEl.textContent = 'Live game in progress';
      } else {
        spectateStatusEl.textContent = match?.isActive ? 'Game finished. Awaiting next game.' : 'Final game complete.';
      }
    }
    renderSpectateBoard(snapshot);
  }

  function openSpectateModal(matchId) {
    if (!spectateOverlay || !spectateBoardView) return;
    const normalizedId = normalizeId(matchId);
    if (!normalizedId) return;
    if (spectateState.matchId && spectateState.matchId !== normalizedId) {
      socket.emit('spectate:leave', { matchId: spectateState.matchId });
    }
    spectateState.matchId = normalizedId;
    spectateState.loading = true;
    spectateState.data = null;
    clearSpectateVisuals();
    spectateOverlay.hidden = false;
    if (spectateStatusEl) spectateStatusEl.textContent = 'Loading live game state…';
    socket.emit('spectate:join', { matchId: normalizedId });
    if (spectateState.resizeHandler) {
      window.removeEventListener('resize', spectateState.resizeHandler);
    }
    spectateState.resizeHandler = () => {
      if (!spectateOverlay.hidden && spectateState.data) {
        renderSpectateBoard(spectateState.data);
      }
    };
    window.addEventListener('resize', spectateState.resizeHandler);
  }

  function closeSpectateModal() {
    if (!spectateOverlay || spectateOverlay.hidden) return;
    const currentId = spectateState.matchId;
    if (currentId) {
      socket.emit('spectate:leave', { matchId: currentId });
    }
    spectateOverlay.hidden = true;
    spectateState.matchId = null;
    spectateState.data = null;
    spectateState.loading = false;
    clearSpectateVisuals();
    if (spectateState.resizeHandler) {
      window.removeEventListener('resize', spectateState.resizeHandler);
      spectateState.resizeHandler = null;
    }
  }

  if (spectateOverlay) {
    spectateOverlay.addEventListener('mousedown', (event) => {
      if (event.target === spectateOverlay) {
        closeSpectateModal();
      }
    });
  }
  if (spectateCloseBtn) {
    spectateCloseBtn.addEventListener('click', () => closeSpectateModal());
  }
  document.addEventListener('keydown', (event) => {
    if ((event.key === 'Escape' || event.key === 'Esc') && spectateOverlay && !spectateOverlay.hidden) {
      closeSpectateModal();
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

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'history-delete-btn';
      deleteBtn.setAttribute('aria-label', 'Delete match');
      deleteBtn.title = 'Delete this match';
      deleteBtn.textContent = '🗑';
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

  socket.on('spectate:snapshot', (payload) => {
    const payloadId = normalizeId(payload?.matchId);
    if (!payloadId || payloadId !== spectateState.matchId) return;
    spectateState.loading = false;
    renderSpectateContent({ ...payload, matchId: payloadId });
  });

  socket.on('spectate:update', (payload) => {
    const payloadId = normalizeId(payload?.matchId);
    if (!payloadId || payloadId !== spectateState.matchId) return;
    spectateState.loading = false;
    renderSpectateContent({ ...payload, matchId: payloadId });
  });

  socket.on('spectate:error', (payload) => {
    const payloadId = normalizeId(payload?.matchId);
    if (!payloadId || payloadId !== spectateState.matchId) return;
    spectateState.loading = false;
    resetSpectateClockState();
    clearSpectateBubbles();
    if (spectateStatusEl) {
      spectateStatusEl.textContent = payload?.message || 'Unable to spectate match.';
    }
    if (spectateBannerEl) {
      spectateBannerEl.textContent = payload?.message || 'Unable to spectate match.';
      spectateBannerEl.className = 'spectate-banner spectate-banner--info';
      spectateBannerEl.hidden = false;
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

})();


