(function() {
  const queueBtn = document.getElementById('queueBtn');
  const modeSelect = document.getElementById('modeSelect');
  const selectWrap = document.getElementById('selectWrap');

  // Cookie helpers
  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? decodeURIComponent(match[2]) : null;
  }
  function setCookie(name, value, maxAgeSeconds) {
    const parts = [name + '=' + encodeURIComponent(value), 'Path=/', 'SameSite=Lax'];
    if (maxAgeSeconds) parts.push('Max-Age=' + maxAgeSeconds);
    document.cookie = parts.join('; ');
  }

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
  const PIECE_IDENTITIES = {
    0: '?',   // UNKNOWN
    1: '♔',   // KING
    2: '💣',  // BOMB
    3: '♗',   // BISHOP
    4: '♖',   // ROOK
    5: '♘'    // KNIGHT
  };
  const KING_ID = 1;
  let currentBoard = null;        // 2D array of cells
  let currentStashes = [[], []];  // [white[], black[]]
  let currentOnDecks = [null, null];
  let currentCaptured = [[], []]; // pieces captured by [white, black]
  let currentDaggers = [0, 0];
  let currentSquareSize = 0; // last computed board square size

  // Pointer interaction thresholds
  const DRAG_PX_THRESHOLD = 6;
  const CLICK_TIME_MAX_MS = 300;
  let suppressMouseUntil = 0; // timestamp to ignore mouse after touch

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
    socket.on('connect', function() { console.log('[socket] connected'); });
    socket.on('initialState', async function(payload) {
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
              fetch('/api/v1/gameAction/ready', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId: latest._id, color: colorIdx })
              }).catch(function(err){ console.error('READY on reconnect failed', err); });
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
                  const res = await fetch('/api/v1/games/getDetails', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ gameId: latest._id, color: myColor })
                  });
                  const view = await res.json().catch(() => latest);
                  bootstrapWorkingStateFromServer(view || latest);
                  isInSetup = true;
                  console.log('[setup] entering setup mode on initialState');
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
    });
    socket.on('queue:update', function(payload) {
      console.log('[socket] queue:update', payload);
      if (!payload) return;
      isQueuedServer = Boolean(payload.quickplay);
      pendingAction = null;
      updateFindButton();
    });
    // Show a one-time "match found" banner and auto-send READY
    socket.on('game:update', function(payload) {
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
              await fetch('/api/v1/gameAction/ready', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId, color })
              });
            } catch (e) {
              console.error('Failed to send READY', e);
            }
          }
        });
      } catch (e) {
        console.error('Error handling game:update', e);
      }
    });
    socket.on('disconnect', function() { /* keep UI; server handles grace */ });

    // New explicit signal when both players are ready
    socket.on('players:bothReady', async function(payload) {
      try {
      console.log('[socket] players:bothReady', payload);
      showPlayArea();
        const gameId = payload?.gameId || lastGameId;
        if (!gameId) return;
        const colorIdx = currentIsWhite ? 0 : 1;
        const res = await fetch('/api/v1/games/getDetails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, color: colorIdx })
        });
        if (!res.ok) return;
        const view = await res.json();
        setStateFromServer(view);
        // Enter setup mode if our setup is not complete
        myColor = currentIsWhite ? 0 : 1;
        const serverSetup = Array.isArray(view?.setupComplete) ? view.setupComplete : setupComplete;
        const myDone = Boolean(serverSetup?.[myColor]);
        console.log('[setup] getDetails setupComplete=', serverSetup, 'myColor=', myColor, 'myDone=', myDone);
        if (!myDone) {
          bootstrapWorkingStateFromServer(view);
          isInSetup = true;
          console.log('[setup] entering setup mode');
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
    });
  }

  async function enterQueue() {
    console.log('[action] enterQueue', { userId });
    const res = await fetch('/api/v1/lobby/enterQuickplay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
    console.log('[action] enterQueue response', res.status);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || 'Failed to enter queue');
    }
  }

  async function exitQueue() {
    console.log('[action] exitQueue', { userId });
    const res = await fetch('/api/v1/lobby/exitQuickplay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId })
    });
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
    document.body.appendChild(playAreaRoot);

    // Global click/tap outside interactive zones should clear selection
    const clearSelectionIfAny = () => {
      if (!isInSetup) return;
      if (selected) { selected = null; renderBoardAndBars(); }
    };
    playAreaRoot.addEventListener('mousedown', clearSelectionIfAny, false);
    playAreaRoot.addEventListener('touchstart', clearSelectionIfAny, { passive: true });

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
    const target = 1.618; // height / width
    const parentRatio = vh / vw;
    let width, height;
    if (parentRatio < target) {
      height = vh;
      width = Math.floor(height / target);
    } else {
      width = vw;
      height = Math.floor(width * target);
    }
    const left = Math.floor((vw - width) / 2);
    const top = Math.floor((vh - height) / 2);
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
    const widthLimit = playAreaRoot.clientWidth / (currentCols + 1);
    const heightLimit = (0.6 * playAreaRoot.clientHeight) / currentRows;
    const s = Math.max(1, Math.floor(Math.min(widthLimit, heightLimit)));
    currentSquareSize = s;
    const bW = s * currentCols;
    const bH = s * currentRows;
    const leftPx = Math.floor((playAreaRoot.clientWidth - bW) / 2);
    // Center at 40% of play area height
    const desiredCenterY = playAreaRoot.clientHeight * 0.40;
    let topPx = Math.floor(desiredCenterY - (bH / 2));
    if (topPx < 0) topPx = 0;
    if (topPx > playAreaRoot.clientHeight - bH) topPx = playAreaRoot.clientHeight - bH;

    // Layout board grid
    boardRoot.style.width = bW + 'px';
    boardRoot.style.height = bH + 'px';
    boardRoot.style.left = leftPx + 'px';
    boardRoot.style.top = topPx + 'px';
    boardRoot.style.display = 'grid';
    boardRoot.style.gridTemplateColumns = `repeat(${currentCols}, ${s}px)`;
    boardRoot.style.gridTemplateRows = `repeat(${currentRows}, ${s}px)`;
    while (boardRoot.firstChild) boardRoot.removeChild(boardRoot.firstChild);
    // Label font scales with play area height for consistency
    const labelFont = Math.max(10, Math.floor(0.024 * playAreaRoot.clientHeight));
    const fileLetters = ['A','B','C','D','E'];
    for (let r = 0; r < currentRows; r++) {
      for (let c = 0; c < currentCols; c++) {
        const light = ((r + c) % 2 === 1);
        const cell = document.createElement('div');
        cell.style.width = s + 'px';
        cell.style.height = s + 'px';
        cell.style.boxSizing = 'border-box';
        cell.style.position = 'relative';
        cell.style.border = '1px solid #9ca3af';
        cell.style.background = light ? '#f7f7f7' : '#6b7280';
        // Add server-oriented coordinates and algebraic notation
        const serverRowForCell = currentIsWhite ? (currentRows - 1 - r) : r;
        const serverColForCell = currentIsWhite ? c : (currentCols - 1 - c);
        cell.dataset.serverRow = String(serverRowForCell);
        cell.dataset.serverCol = String(serverColForCell);
        const fileCharMeta = String.fromCharCode('A'.charCodeAt(0) + serverColForCell);
        cell.dataset.square = `${fileCharMeta}${serverRowForCell + 1}`;
        // Bottom row file labels
        if (r === currentRows - 1) {
          const fileIdx = currentIsWhite ? c : (currentCols - 1 - c);
          const file = fileLetters[fileIdx] || '';
          const fileSpan = document.createElement('span');
          fileSpan.textContent = file;
          fileSpan.style.position = 'absolute';
          fileSpan.style.right = '3px';
          fileSpan.style.bottom = '2px';
          fileSpan.style.color = '#000';
          fileSpan.style.fontWeight = '400';
          fileSpan.style.fontSize = labelFont + 'px';
          fileSpan.style.lineHeight = '1';
          fileSpan.style.userSelect = 'none';
          fileSpan.style.pointerEvents = 'none';
          cell.appendChild(fileSpan);
        }
        // Left column rank labels
        if (c === 0) {
          const rank = currentIsWhite ? (currentRows - r) : (r + 1);
          const rankSpan = document.createElement('span');
          rankSpan.textContent = String(rank);
          rankSpan.style.position = 'absolute';
          rankSpan.style.left = '3px';
          rankSpan.style.top = '2px';
          rankSpan.style.color = '#000';
          rankSpan.style.fontWeight = '400';
          rankSpan.style.fontSize = labelFont + 'px';
          rankSpan.style.lineHeight = '1';
          rankSpan.style.userSelect = 'none';
          rankSpan.style.pointerEvents = 'none';
          cell.appendChild(rankSpan);
        }

        // Render piece if present at this board coordinate
        try {
          // If in setup, overlay our bottom rank with working state; else use server board
          const uiBottomRow = currentRows - 1;
          const uiCol = c;
          const isBottomRankCell = (r === uiBottomRow);
          let piece = null;
          if (isInSetup && isBottomRankCell) {
            piece = workingRank[uiCol] || null;
          } else if (currentBoard) {
            // Orientation mapping:
            // - White perspective: flip rows only so UI bottom maps to server row 0; columns unchanged
            // - Black perspective: keep rows, flip columns so UI bottom maps to server row rows-1
            const srcR = currentIsWhite ? (currentRows - 1 - r) : r;
            const srcC = currentIsWhite ? c : (currentCols - 1 - c);
            piece = currentBoard?.[srcR]?.[srcC];
          }
          if (piece) {
            const p = document.createElement('div');
            // Center the piece absolutely so it overlays square labels when needed
            const psz = Math.floor(s * 0.8);
            p.style.position = 'absolute';
            p.style.left = '50%';
            p.style.top = '50%';
            p.style.transform = 'translate(-50%, -50%)';
            p.style.width = psz + 'px';
            p.style.height = psz + 'px';
            p.style.display = 'flex';
            p.style.alignItems = 'center';
            p.style.justifyContent = 'center';
            p.style.fontSize = Math.floor(s * 0.7) + 'px';
            p.style.background = piece.color === 1 ? '#000' : '#fff';
            p.style.color = piece.color === 1 ? '#fff' : '#000';
            if (dragging && dragging.origin && dragging.origin.type === 'board' && dragging.origin.index === uiCol && isBottomRankCell) {
              p.style.opacity = '0.5';
            }
            if (selected && selected.type === 'board' && selected.index === uiCol && isBottomRankCell) {
              p.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
            }
            p.textContent = PIECE_IDENTITIES[piece.identity] || '?';
            cell.appendChild(p);
          }
        } catch (_) {}

        // Attach setup interactions to bottom-rank cells when in setup mode
        const isUiBottom = (r === (currentRows - 1));
        if (isInSetup && isUiBottom) {
          const uiCol = c;
          attachInteractiveHandlers(cell, { type: 'board', index: uiCol });
          refs.bottomCells[uiCol] = { el: cell, col: uiCol };
        }
        boardRoot.appendChild(cell);
      }
    }

    renderBars(s, bW, bH, leftPx, topPx);
    renderStash(s, bW, bH, leftPx, topPx);

    // Ready button overlay when setup is completable
    // Always clear any existing button first so it disappears when not completable
    const existingBtn = document.getElementById('setupReadyBtn');
    if (existingBtn && existingBtn.parentNode) existingBtn.parentNode.removeChild(existingBtn);
    if (isInSetup && isSetupCompletable()) {
      const btn = document.createElement('button');
      btn.id = 'setupReadyBtn';
      btn.textContent = 'Ready!';
      btn.style.position = 'absolute';
      btn.style.left = Math.floor(leftPx + (bW / 2) - 80) + 'px';
      btn.style.top = Math.floor(topPx + (bH / 2) - 24) + 'px';
      btn.style.width = '160px';
      btn.style.height = '48px';
      btn.style.background = '#7c3aed'; // lavender/purple
      btn.style.border = '3px solid #DAA520';
      btn.style.color = '#fff';
      btn.style.fontWeight = '800';
      btn.style.fontSize = '20px';
      btn.style.cursor = 'pointer';
      btn.addEventListener('click', async () => {
        try {
          const payload = buildSetupPayload();
          console.log('[client] POST /api/v1/gameAction/setup ->', payload);
          const res = await fetch('/api/v1/gameAction/setup', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          const json = await res.json().catch(() => ({}));
          console.log('[client] setup response', res.status, json);
          if (!res.ok) return alert(json?.message || 'Setup failed');
          // Lock interactions; server will broadcast update
          isInSetup = false;
          selected = null; dragging = null;
          renderBoardAndBars();
        } catch (e) { console.error('setup error', e); }
      });
      playAreaRoot.appendChild(btn);
    }
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
        const sq = document.createElement('div');
        const cap = Math.floor(0.365 * s); // ~36.5% of square
        sq.style.width = cap + 'px';
        sq.style.height = cap + 'px';
        sq.style.border = '1px solid #000';
        sq.style.display = 'flex';
        sq.style.alignItems = 'center';
        sq.style.justifyContent = 'center';
        sq.style.fontSize = Math.floor(cap * 0.7) + 'px';
        const isBlack = piece.color === 1;
        sq.style.background = isBlack ? '#000' : '#fff';
        sq.style.color = isBlack ? '#fff' : '#000';
        sq.textContent = PIECE_IDENTITIES[piece.identity] || '?';
        strip.appendChild(sq);
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
      let content = null;
      if (isOnDeck) {
        const deck = isInSetup ? (workingOnDeck || null) : (currentOnDecks?.[bottomColor] || null);
        if (deck) content = pieceGlyph(deck, isOnDeck ? s : slot);
      } else {
        const ord = uiToOrdinal[i];
        if (ord !== undefined && stash[ord]) content = pieceGlyph(stash[ord], isOnDeck ? s : slot);
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
      if (!piece) return null;
      const el = document.createElement('div');
      const size = Math.floor(target * 0.8);
      el.style.width = size + 'px';
      el.style.height = size + 'px';
      el.style.display = 'flex';
      el.style.alignItems = 'center';
      el.style.justifyContent = 'center';
      el.style.position = 'relative';
      el.style.zIndex = '1';
      el.style.fontSize = Math.floor(size * 0.8) + 'px';
      const isBlack = piece.color === 1;
      el.style.background = isBlack ? '#000' : '#fff';
      el.style.color = isBlack ? '#fff' : '#000';
      // Selection halo for stash/deck selections
      if (selected && ((selected.type === 'stash' && selected.index !== undefined) || (selected.type === 'deck'))) {
        // The caller wraps which slot is being rendered; we can’t know here, so the halo is applied in render if needed.
      }
      el.textContent = PIECE_IDENTITIES[piece.identity] || '?';
      return el;
    } catch (_) { return null; }
  }

  function setStateFromServer(u) {
    try {
      if (Array.isArray(u.board)) currentBoard = u.board; else if (u.board === null) currentBoard = null;
      if (Array.isArray(u.stashes)) currentStashes = u.stashes;
      if (Array.isArray(u.onDecks)) currentOnDecks = u.onDecks;
      if (Array.isArray(u.captured)) currentCaptured = u.captured;
      if (Array.isArray(u.daggers)) currentDaggers = u.daggers;
      if (Array.isArray(u.setupComplete)) setupComplete = u.setupComplete;
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
        if ((dx > DRAG_PX_THRESHOLD || dy > DRAG_PX_THRESHOLD) && originPiece) {
          dragStarted = true;
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
    document.body.appendChild(ghost);
    dragging = { piece, origin, ghostEl: ghost };
    const move = (ev) => {
      if (!dragging) return;
      const x = ev.clientX !== undefined ? ev.clientX : (ev.touches && ev.touches[0] && ev.touches[0].clientX);
      const y = ev.clientY !== undefined ? ev.clientY : (ev.touches && ev.touches[0] && ev.touches[0].clientY);
      if (x !== undefined) ghost.style.left = x + 'px';
      if (y !== undefined) ghost.style.top = y + 'px';
    };
    const up = (ev) => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', up);
      if (!dragging) return;
      const cx = ev.clientX !== undefined ? ev.clientX : (ev.changedTouches && ev.changedTouches[0] && ev.changedTouches[0].clientX);
      const cy = ev.clientY !== undefined ? ev.clientY : (ev.changedTouches && ev.changedTouches[0] && ev.changedTouches[0].clientY);
      const dest = hitTestDrop(cx, cy);
      if (dest) {
        const moved = performMove(dragging.origin, dest);
        console.log('[setup] drop', { from: dragging.origin, to: dest, moved });
      }
      try { document.body.removeChild(ghost); } catch (_) {}
      dragging = null; selected = null; renderBoardAndBars();
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
    document.addEventListener('touchmove', move, { passive: false });
    document.addEventListener('touchend', up);
    document.addEventListener('touchcancel', up);
  }

  function hitTestDrop(x, y) {
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

  function getPieceAt(target) {
    if (!target) return null;
    if (target.type === 'board') return workingRank[target.index] || null;
    if (target.type === 'deck') return workingOnDeck || null;
    if (target.type === 'stash') return workingStash[target.index] || null;
    return null;
  }

  function setPieceAt(target, piece) {
    if (target.type === 'board') { workingRank[target.index] = piece; return; }
    if (target.type === 'deck') { workingOnDeck = piece; return; }
    if (target.type === 'stash') { workingStash[target.index] = piece; return; }
  }

  function performMove(origin, dest) {
    // Enforce legal bottom-rank placement and center snapping is handled by CSS box model
    const pieceFrom = getPieceAt(origin);
    if (!pieceFrom) return false;
    const pieceTo = getPieceAt(dest);
    // Only allow board destinations on bottom rank squares (we only expose those in refs)
    setPieceAt(origin, pieceTo || null);
    setPieceAt(dest, pieceFrom);
    // After any move, re-render to update Ready button visibility
    // (isSetupCompletable checks for king presence and full rank)
    try { if (playAreaRoot) renderBoardAndBars(); } catch (_) {}
    return true;
  }
})();


