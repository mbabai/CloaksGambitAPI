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
    socket.on('disconnect', function() { /* keep UI; server handles grace */ });
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
})();


