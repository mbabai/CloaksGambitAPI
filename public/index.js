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
  let isInPlayArea = false;

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
      // Keep only this single log and remove inferred duplicates from game:update
      console.log('[socket] players:bothReady', payload);
      showPlayArea();
    });
  }

  // If we don't receive initialState within 2 seconds, enable UI anyway
  // No backend integration needed for visuals, but socket remains for future use

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
      // Rely on socket events to finalize; keep optimistic UI via pendingAction
    } catch (e) {
      console.error(e);
      pendingAction = null;
      updateFindButton();
    }
  });

  // Fallback UI state
  updateFindButton();

  // Bootstrap: ensure user, then connect socket with auth
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

  // ------- Minimal PlayArea placeholder for the simple queue page -------
  function showPlayArea() {
    if (isInPlayArea) return;
    isInPlayArea = true;
    try {
      const queuer = document.querySelector('.queuer');
      if (queuer) queuer.style.display = 'none';
      const root = document.createElement('div');
      root.id = 'playAreaRoot';
      root.style.position = 'fixed';
      root.style.inset = '0';
      root.style.background = '#2a3f2f';
      root.style.display = 'flex';
      root.style.alignItems = 'center';
      root.style.justifyContent = 'center';
      root.style.color = '#fff';
      root.style.fontSize = '28px';
      root.style.fontWeight = '800';
      root.textContent = 'PlayArea starting...';
      document.body.appendChild(root);
    } catch (e) {
      console.error('Failed to show PlayArea placeholder:', e);
    }
  }
})();


