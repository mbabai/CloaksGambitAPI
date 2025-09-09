import { pieceGlyph as modulePieceGlyph } from '/js/modules/render/pieceGlyph.js';
import { renderBoard } from '/js/modules/render/board.js';
import { renderStash as renderStashModule } from '/js/modules/render/stash.js';
import { renderBars as renderBarsModule } from '/js/modules/render/bars.js';
import { dimOriginEl, restoreOriginEl } from '/js/modules/dragOpacity.js';
import { PIECE_IMAGES, KING_ID, MOVE_STATES } from '/js/modules/constants.js';
import { getCookie, setCookie } from '/js/modules/utils/cookies.js';
import { apiReady, apiSetup, apiGetDetails, apiEnterQueue, apiExitQueue, apiMove } from '/js/modules/api/game.js';
import { computePlayAreaBounds, computeBoardMetrics } from '/js/modules/layout.js';
import { renderReadyButton } from '/js/modules/render/readyButton.js';
import { renderGameButton } from '/js/modules/render/gameButton.js';
import { randomizeSetup } from '/js/modules/setup/randomize.js';
import { DRAG_PX_THRESHOLD as DRAG_PX_THRESHOLD_CFG, DRAG_PX_THRESHOLD_TOUCH as DRAG_PX_THRESHOLD_TOUCH_CFG, CLICK_TIME_MAX_MS as CLICK_TIME_MAX_MS_CFG } from '/js/modules/interactions/config.js';
import { getPieceAt as getPieceAtM, setPieceAt as setPieceAtM, performMove as performMoveM } from '/js/modules/state/moves.js';
import { Declaration, uiToServerCoords, isWithinPieceRange, isPathClear } from '/js/modules/interactions/moveRules.js';
import { wireSocket as bindSocket } from '/js/modules/socket.js';

(function() {
  const queueBtn = document.getElementById('queueBtn');
  const modeSelect = document.getElementById('modeSelect');
  const selectWrap = document.getElementById('selectWrap');

  // Cookie helpers moved to modules/utils/cookies.js

  // Ensure a valid Mongo user exists and get its _id
  async function ensureUserId() {
    let id = getCookie('userId');
    if (id) return id;

    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const username = 'guest_' + nonce;
    const email = nonce + '@guest.local';
    const res = await fetch('/api/v1/users/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email })
    });
    if (!res.ok) {
      throw new Error('Failed to create guest user');
    }
    const user = await res.json();
    id = user && user._id;
    if (!id) throw new Error('Invalid user response');
    setCookie('userId', id, 60 * 60 * 24 * 365); // 1 year
    return id;
  }

  let socket;
  let userId;
  let lastGameId = null;
  let bannerInterval = null;
  let bannerEl = null;
  let playAreaRoot = null;
  let isPlayAreaVisible = false;
  let queuerHidden = false;

  // Simple board + bars state (plain page)
  let boardRoot = null;
  let topBar = null;
  let bottomBar = null;
  let stashRoot = null;
  let currentRows = 0;
  let currentCols = 0;
  let currentIsWhite = true;

  // Live game state (masked per player)
  let currentBoard = null;        // 2D array of cells
  let currentStashes = [[], []];  // [white[], black[]]
  let currentOnDecks = [null, null];
  let currentCaptured = [[], []]; // pieces captured by [white, black]
  let currentDaggers = [0, 0];
  let currentSquareSize = 0; // last computed board square size
  let currentPlayerTurn = null; // 0 or 1
  let postMoveOverlay = null; // { uiR, uiC, types: string[] }
  const BUBBLE_PRELOAD = {}; // type -> HTMLImageElement
  let dragPreviewImgs = []; // active floating preview images
  let lastChoiceOrigin = null; // remember origin for two-option choice

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
  let isQueuedServer = false;
  let pendingAction = null; // 'join' | 'leave' | null

  function updateFindButton() {
    const showSearching = pendingAction === 'join' || isQueuedServer;
    console.log('[UI] updateFindButton', { showSearching, pendingAction, isQueuedServer });
    if (showSearching) {
      queueBtn.textContent = 'Searching...';
      queueBtn.classList.add('searching');
      modeSelect.disabled = true;
      selectWrap.classList.add('disabled');
    } else {
      queueBtn.textContent = 'Find Game';
      queueBtn.classList.remove('searching');
      modeSelect.disabled = false;
      selectWrap.classList.remove('disabled');
    }
  }

  function wireSocket() {
    bindSocket(socket, {
      onConnect() { console.log('[socket] connected'); },
      async onInitialState(payload) {
      console.log('[socket] initialState', payload);
      const queued = payload && payload.queued && !!payload.queued.quickplay;
      isQueuedServer = Boolean(queued);
      pendingAction = null;
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

          // If this player is not marked ready yet, send READY immediately
          try {
            const colorIdx = Array.isArray(latest?.players)
              ? latest.players.findIndex(function(p){ return p === userId; })
              : -1;
            const isReady = Array.isArray(latest?.playersReady) && colorIdx > -1
              ? Boolean(latest.playersReady[colorIdx])
              : false;
            if (colorIdx > -1 && !isReady) {
              console.log('[client] reconnect sending READY immediately', { gameId: latest._id, color: colorIdx });
                apiReady(latest._id, colorIdx).catch(function(err){ console.error('READY on reconnect failed', err); });
            }
            currentIsWhite = (colorIdx === 0);
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
      isQueuedServer = Boolean(payload.quickplay);
      pendingAction = null;
      updateFindButton();
      },
      async onGameUpdate(payload) {
      try {
        if (!payload || !payload.gameId || !Array.isArray(payload.players)) return;
        const gameId = payload.gameId;
        const color = payload.players.findIndex(p => p === userId);
        if (color !== 0 && color !== 1) return;

        // As soon as we are in a game, hide the Find Game UI
        hideQueuer();
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

        if (lastGameId === gameId) return; // already handled for this game (banner + auto ready)
        lastGameId = gameId;

        showMatchFoundBanner(3, async function onTick(remaining) {
          if (remaining === 0) {
            try {
              console.log('[game] sending READY at 0s', { gameId, color })
                await apiReady(gameId, color);
            } catch (e) {
              console.error('Failed to send READY', e);
            }
          }
        });
      } catch (e) {
        console.error('Error handling game:update', e);
      }
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
      onDisconnect() { /* keep UI; server handles grace */ }
    });
  }

  async function enterQueue() {
    console.log('[action] enterQueue', { userId });
    const res = await apiEnterQueue(userId);
    console.log('[action] enterQueue response', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to enter queue');
    }
  }

  async function exitQueue() {
    console.log('[action] exitQueue', { userId });
    const res = await apiExitQueue(userId);
    console.log('[action] exitQueue response', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to exit queue');
    }
  }

  queueBtn.addEventListener('click', async function() {
    const mode = modeSelect.value;
    console.log('[ui] click queueBtn', { mode, pendingAction, isQueuedServer });
    if (!(pendingAction === 'join' || isQueuedServer) && mode !== 'quickplay') {
      alert('This queue is still under construction!');
      return;
    }
    try {
      if (!(pendingAction === 'join' || isQueuedServer)) {
        pendingAction = 'join';
        updateFindButton();
        await enterQueue();
      } else {
        pendingAction = 'leave';
        updateFindButton();
        await exitQueue();
      }
    } catch (e) {
      console.error(e);
      pendingAction = null;
      updateFindButton();
    }
  });

  // Fallback UI state
  updateFindButton();

  (async function init() {
    try {
      userId = await ensureUserId();
      console.log('[init] userId', userId);
      preloadBubbleImages();
      socket = io('/', { auth: { userId } });
      wireSocket();
    } catch (e) {
      console.error(e);
    }
  })();

  // ------- Match Found Banner helpers -------
  function ensureBannerEl() {
    if (bannerEl) return bannerEl;
    bannerEl = document.createElement('div');
    bannerEl.style.position = 'fixed';
    bannerEl.style.inset = '0';
    bannerEl.style.display = 'none';
    bannerEl.style.alignItems = 'center';
    bannerEl.style.justifyContent = 'center';
    bannerEl.style.background = 'rgba(0,0,0,0.55)';
    bannerEl.style.zIndex = '9999';

    const card = document.createElement('div');
    card.style.width = '100%';
    card.style.maxWidth = '100%';
    card.style.height = '160px';
    card.style.padding = '18px 26px';
    card.style.borderRadius = '0';
    card.style.borderTop = '2px solid #fbbf24';
    card.style.borderBottom = '2px solid #fbbf24';
    card.style.background = '#4c1d95';
    card.style.color = '#ffffff';
    card.style.boxShadow = '0 10px 30px rgba(0,0,0,0.35)';
    card.style.textAlign = 'center';

    const title = document.createElement('div');
    title.textContent = 'Match Found';
    title.style.fontSize = '32px';
    title.style.fontWeight = '800';
    title.style.marginBottom = '10px';

    const count = document.createElement('div');
    count.style.fontSize = '80px';
    count.style.fontWeight = '900';
    count.style.lineHeight = '1';
    count.id = 'matchFoundCount';

    card.appendChild(title);
    card.appendChild(count);
    bannerEl.appendChild(card);
    document.body.appendChild(bannerEl);
    return bannerEl;
  }

  function showMatchFoundBanner(startSeconds, onTick) {
    const el = ensureBannerEl();
    const countEl = el.querySelector('#matchFoundCount');
    let remaining = startSeconds;
    countEl.textContent = String(remaining);
    el.style.display = 'flex';

    if (bannerInterval) clearInterval(bannerInterval);
    bannerInterval = setInterval(() => {
      remaining -= 1;
      if (typeof onTick === 'function') {
        try { onTick(remaining); } catch (_) {}
      }
      if (remaining < 0) {
        clearInterval(bannerInterval);
        bannerInterval = null;
        el.style.display = 'none';
        return;
      }
      countEl.textContent = remaining === 0 ? 'Go!' : String(remaining);
    }, 1000);
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
        workingRank
      },
      refs,
      identityMap: PIECE_IMAGES,
      onAttachHandlers: (cell, target) => attachInteractiveHandlers(cell, target),
      onAttachGameHandlers: (cell, r, c) => attachGameHandlers(cell, r, c),
      labelFont,
      fileLetters
    });

    // Use modular bars and stash renderers
    renderBarsModule({
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
        currentDaggers
      },
      identityMap: PIECE_IMAGES
    });

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
        selected,
        dragging
      },
      refs,
      identityMap: PIECE_IMAGES,
      onAttachHandlers: (el, target) => attachInteractiveHandlers(el, target)
    });

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
      background: '#7f1d1d',
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
      row.style.color = '#fff';
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
      box.style.background = colorIsWhite ? '#fff' : '#000';
      box.style.color = colorIsWhite ? '#000' : '#fff';
      box.style.border = '2px solid #DAA520';
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
        token.style.border = '2px solid #fff';
        token.style.borderRadius = '50%';
        token.style.background = '#dc2626';
        token.style.color = '#fff';
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
      const nameRow = makeNameRow(isTopBar ? 'Opponent Name' : 'My Name', isTopBar);
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

    fillBar(topBar, true);
    fillBar(bottomBar, false);
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

    // Make stash slots the same size as board squares so pieces (80% of slot) match board piece size
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
      el.style.border = isOnDeck ? '3px solid #DAA520' : '0px solid transparent';
      el.style.background = isOnDeck ? '#3d2e88' : 'transparent';
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
      const size = Math.floor(target * 0.8);
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
      const map = {
        knightSpeechLeft: 'BubbleSpeechLeftKnight.svg',
        rookSpeechLeft: 'BubbleSpeechLeftRook.svg',
        bishopSpeechLeft: 'BubbleSpeechLeftBishop.svg',
        kingSpeechLeft: 'BubbleSpeechLeftKing.svg',
        kingThoughtRight: 'BubbleThoughtRightKing.svg',
        bishopThoughtLeft: 'BubbleThoughtLeftBishop.svg',
        rookThoughtLeft: 'BubbleThoughtLeftRook.svg',
        knightThoughtLeft: 'BubbleThoughtLeftKnight.svg'
      };
      const srcName = map[type];
      if (!srcName) return null;
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
      img.src = (BUBBLE_PRELOAD[type] && BUBBLE_PRELOAD[type].src) || ('/assets/images/UI/' + srcName);
      return img;
    } catch (_) { return null; }
  }

  function preloadBubbleImages() {
    const files = {
      knightSpeechLeft: 'BubbleSpeechLeftKnight.svg',
      rookSpeechLeft: 'BubbleSpeechLeftRook.svg',
      bishopSpeechLeft: 'BubbleSpeechLeftBishop.svg',
      kingThoughtRight: 'BubbleThoughtRightKing.svg',
      bishopThoughtLeft: 'BubbleThoughtLeftBishop.svg',
      rookThoughtLeft: 'BubbleThoughtLeftRook.svg',
      knightThoughtLeft: 'BubbleThoughtLeftKnight.svg'
    };
    Object.keys(files).forEach(function(k){
      const img = new Image();
      img.draggable = false; img.decoding = 'async';
      img.src = '/assets/images/UI/' + files[k];
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
      if (Array.isArray(u.moves)) {
        const last = u.moves[u.moves.length - 1];
        if (last && last.state === MOVE_STATES.PENDING) {
          const from = last.from || {};
          const to = last.to || {};
          try {
            const piece = currentBoard?.[from.row]?.[from.col] || currentBoard?.[to.row]?.[to.col];
            if (piece) {
              currentBoard = currentBoard.map(row => row.slice());
              currentBoard[to.row] = currentBoard[to.row].slice();
              currentBoard[from.row] = currentBoard[from.row].slice();
              currentBoard[to.row][to.col] = piece;
              currentBoard[from.row][from.col] = null;
            }
          } catch (_) {}
          try {
            const originUI = serverToUICoords(from.row, from.col);
            const destUI = serverToUICoords(to.row, to.col);
            const types = bubbleTypesForMove(originUI, destUI, last.declaration);
            postMoveOverlay = { uiR: destUI.uiR, uiC: destUI.uiC, types };
          } catch (_) {}
        } else {
          postMoveOverlay = null;
        }
      }
    } catch (_) {}
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
      // Derive server column from labeled bottom-row cell for robustness
      // Find the bottom UI cell DIV corresponding to this uiCol and read its serverCol mapping
      let colServer = null;
      try {
        const bottomRowIndex = currentRows - 1;
        const boardChildrenIndex = bottomRowIndex * currentCols + uiCol; // grid order
        const cellEl = boardRoot?.children?.[boardChildrenIndex];
        const parsed = cellEl ? parseInt(cellEl?.dataset?.serverCol, 10) : NaN;
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
      if (Date.now() < suppressMouseUntil) return; // ignore synthetic mouse after touch
      if (!isInSetup) return;
      const originPiece = getPieceAt(target); // may be null for empty dest; still allow click path
      if (DRAG_DEBUG) console.log('[drag] mousedown', { suppressMouseUntil, now: Date.now(), originHasPiece: !!originPiece });
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
          if (DRAG_DEBUG) console.log('[drag] start mouse', { target, x: ev.clientX, y: ev.clientY });
          startDrag(ev, target, originPiece);
          document.removeEventListener('mousemove', move);
        }
      };
      const up = (ev) => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        if (!dragStarted) {
          ev.preventDefault();
          ev.stopPropagation();
          handleClickTarget(target);
        }
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
    // Touch: mirror behavior with slightly higher jitter tolerance
    el.addEventListener('touchstart', (e) => {
      if (!isInSetup) return;
      const originPiece = getPieceAt(target); // may be null
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
          // stop listening to threshold moves once promoted to drag
          document.removeEventListener('touchmove', move);
          if (DRAG_DEBUG) console.log('[drag] start touch', { target, x: tt.clientX, y: tt.clientY });
          startDrag({ clientX: tt.clientX, clientY: tt.clientY }, target, originPiece);
        }
      };
      const end = (ev) => {
        document.removeEventListener('touchmove', move);
        document.removeEventListener('touchend', end);
        document.removeEventListener('touchcancel', end);
        try { ev.preventDefault(); ev.stopPropagation(); } catch(_) {}
        if (!dragStarted) {
          handleClickTarget(target);
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
      if (Date.now() < suppressMouseUntil) return;
      if (isInSetup) return; // not in setup
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
      if (isInSetup) return;
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
      if (!currentBoard) return false;
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
        await apiMove({ gameId: lastGameId, color: myColorIdx, from, to, declaration });
      } catch (e) { console.error('apiMove failed', e); }
      renderBoardAndBars();
    } catch (_) {}
  }

  function handleClickTarget(target) {
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
    console.log('[setup] click move', { from: selected, to: target, moved });
    selected = null;
    renderBoardAndBars();
  }

  function startDrag(e, origin, piece) {
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
    if (DRAG_DEBUG) console.log('[drag] ghost init', { x: startCX, y: startCY, origin });
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
        if (now - debugDragMoveLast > 80) { console.log('[drag] move', { x, y, type: ev.type, hasTouches: !!ev.touches }); debugDragMoveLast = now; }
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
      if (DRAG_DEBUG) console.log('[drag] end', { x: cx, y: cy, dest });
      // Clear preview overlays
      clearDragPreviewImgs();
      if (dest) {
        if (isInSetup) {
          const moved = performMove(dragging.origin, dest);
          console.log('[setup] drop', { from: dragging.origin, to: dest, moved });
        } else if (dragging.origin && dragging.origin.type === 'boardAny' && dest.type === 'boardAny') {
          attemptInGameMove(dragging.origin, dest);
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


