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
    socket.on('initialState', function(payload) {
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

          // Render board immediately if present
          try {
            if (Array.isArray(latest?.board)) {
              currentRows = latest.board.length || 6;
              currentCols = latest.board[0]?.length || 5;
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

        // If the server provided a board, render it
        if (Array.isArray(payload.board)) {
          currentRows = payload.board.length || 6;
          currentCols = payload.board[0]?.length || 5;
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
    socket.on('players:bothReady', function(payload) {
      console.log('[socket] players:bothReady', payload);
      showPlayArea();
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
    document.body.appendChild(playAreaRoot);

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
    const widthLimit = playAreaRoot.clientWidth / (currentCols + 1);
    const heightLimit = (0.6 * playAreaRoot.clientHeight) / currentRows;
    const s = Math.max(1, Math.floor(Math.min(widthLimit, heightLimit)));
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
    for (let r = 0; r < currentRows; r++) {
      for (let c = 0; c < currentCols; c++) {
        const light = currentIsWhite ? ((r + c) % 2 === 1) : ((r + c) % 2 === 0);
        const cell = document.createElement('div');
        cell.style.width = s + 'px';
        cell.style.height = s + 'px';
        cell.style.boxSizing = 'border-box';
        cell.style.border = '1px solid #9ca3af';
        cell.style.background = light ? '#f7f7f7' : '#6b7280';
        boardRoot.appendChild(cell);
      }
    }

    renderBars(s, bW, bH, leftPx, topPx);
    renderStash(s, bW, bH, leftPx, topPx);
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

    function makeDaggers() {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.gap = '6px';
      for (let i = 0; i < 2; i++) {
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

    function makeCaptured(oppColor) {
      const strip = document.createElement('div');
      strip.style.display = 'flex';
      strip.style.alignItems = 'center';
      strip.style.gap = '4px';
      const ids = [1,3,4,5];
      ids.forEach(id => {
        const sq = document.createElement('div');
        const cap = Math.floor(0.405 * s * 0.9); // ~36.45% of square edge
        sq.style.width = cap + 'px';
        sq.style.height = cap + 'px';
        sq.style.border = '1px solid #000';
        sq.style.display = 'flex';
        sq.style.alignItems = 'center';
        sq.style.justifyContent = 'center';
        sq.style.fontSize = Math.floor(cap * 0.7) + 'px';
        sq.style.background = oppColor === 1 ? '#000' : '#fff';
        sq.style.color = oppColor === 1 ? '#fff' : '#000';
        sq.textContent = id === 1 ? '♔' : id === 3 ? '♗' : id === 4 ? '♖' : '♘';
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
        row.appendChild(makeCaptured(currentIsWhite ? 0 : 1));
        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.alignItems = 'center';
        right.style.gap = '6px';
        right.appendChild(makeDaggers());
        right.appendChild(makeClock(!currentIsWhite));
        row.appendChild(right);
        // Top: name first, then row
        barEl.appendChild(nameRow);
        barEl.appendChild(row);
      } else {
        const left = document.createElement('div');
        left.style.display = 'flex';
        left.style.alignItems = 'center';
        left.style.gap = '6px';
        left.appendChild(makeClock(currentIsWhite));
        left.appendChild(makeDaggers());
        row.appendChild(left);
        row.appendChild(makeCaptured(currentIsWhite ? 1 : 0));
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

    const yStart = bottomBarTop + contH + 20; // moved stash further down (was +8)

    // Slot sizing: 80% of board square size
    const slot = Math.floor(0.8 * s);
    const space = Math.max(4, Math.floor(0.12 * slot));

    // rows: top has 5, bottom has 4; bottom is offset by half the (slot + spacing)
    const topCols = 5;
    const bottomCols = 4;

    // Clear render
    while (stashRoot.firstChild) stashRoot.removeChild(stashRoot.firstChild);

    function makeSlot(x, y, isOnDeck) {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      // on-deck uses full board-square size s; others use reduced slot size
      const w = isOnDeck ? s : slot;
      const h = isOnDeck ? s : slot;
      const leftAdj = isOnDeck ? Math.round(x - (w - slot) / 2) : x; // center horizontally
      const topAdj = isOnDeck ? Math.round(y - (h - slot)) : y;      // bottom-align
      el.style.left = leftAdj + 'px';
      el.style.top = topAdj + 'px';
      el.style.width = w + 'px';
      el.style.height = h + 'px';
      el.style.boxSizing = 'border-box';
      el.style.border = '3px solid #DAA520';
      el.style.background = isOnDeck ? '#3d2e88' : 'transparent';
      return el;
    }

    // Compute board center for stable centering
    const blockCenterX = leftPx + Math.floor(bW / 2);

    // Top row content width and left
    const topContentWidth = topCols * slot + (topCols - 1) * space;
    const delta = Math.round((s - slot) / 2); // extra half-width from on-deck to balance gaps
    const topEffectiveWidth = topContentWidth + 2 * delta;
    const topLeft = Math.round(blockCenterX - topEffectiveWidth / 2);

    for (let i = 0; i < topCols; i++) {
      let x = topLeft + i * (slot + space);
      // Maintain uniform edge gaps with larger on-deck by shifting neighbors equally
      if (i === 1) x -= delta; // neighbor on left of on-deck
      if (i === 3) x += delta; // neighbor on right of on-deck
      const y = yStart;
      const isOnDeck = (i === 2);
      stashRoot.appendChild(makeSlot(x, y, isOnDeck));
    }

    // Bottom row content width and left, then apply half-(slot+space) offset
    const bottomContentWidth = bottomCols * slot + (bottomCols - 1) * space;
    const bottomOffset = Math.round((slot + space) / 2);
    const bottomLeft = Math.round(blockCenterX - bottomContentWidth / 2 );

    for (let i = 0; i < bottomCols; i++) {
      const x = bottomLeft + i * (slot + space);
      const y = yStart + slot + space;
      stashRoot.appendChild(makeSlot(x, y, false));
    }
  }
})();


