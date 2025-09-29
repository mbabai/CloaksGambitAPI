const TOKEN_STORAGE_KEY = 'cg_token';

function getStoredAuthToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch (err) {
    console.warn('Unable to access localStorage for auth token', err);
    return null;
  }
}

function buildAuthHeaders(base = {}) {
  const headers = { ...base };
  const token = getStoredAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function authFetch(url, options = {}) {
  const headers = buildAuthHeaders(options.headers || {});
  return fetch(url, { ...options, headers });
}

export async function apiReady(gameId, color) {
  return authFetch('/api/v1/gameAction/ready', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiNext(gameId, color) {
  const res = await authFetch('/api/v1/gameAction/next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    const error = new Error((data && data.message) || 'Next request failed');
    error.response = res;
    error.data = data;
    throw error;
  }

  return data;
}

export async function apiSetup(payload) {
  return authFetch('/api/v1/gameAction/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function apiGetDetails(gameId, color) {
  const res = await authFetch('/api/v1/games/getDetails', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

function getStoredUserId() {
  try {
    return localStorage.getItem('cg_userId');
  } catch (err) {
    console.warn('Unable to access localStorage for cg_userId', err);
    return null;
  }
}

function persistIdentity({ userId, username }) {
  if (userId) {
    try {
      localStorage.setItem('cg_userId', userId);
    } catch (err) {
      console.warn('Failed to persist cg_userId to localStorage', err);
    }
  }

  if (username) {
    try {
      localStorage.setItem('cg_username', username);
    } catch (err) {
      console.warn('Failed to persist cg_username to localStorage', err);
    }
  }
}

async function sendQueueRequest(path, payload = {}) {
  const body = { ...payload };
  if (!body.userId) {
    const stored = getStoredUserId();
    if (stored) {
      body.userId = stored;
    }
  }

  const res = await authFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    data = null;
  }

  if (!res.ok) {
    const error = new Error((data && data.message) || 'Queue request failed');
    error.response = res;
    error.data = data;
    throw error;
  }

  if (data && (data.userId || data.username)) {
    persistIdentity({ userId: data.userId, username: data.username });
  }

  return data;
}

export async function apiEnterQueue(payload = {}) {
  return sendQueueRequest('/api/v1/lobby/enterQuickplay', payload);
}

export async function apiExitQueue(payload = {}) {
  return sendQueueRequest('/api/v1/lobby/exitQuickplay', payload);
}

export async function apiEnterRankedQueue(payload = {}) {
  return sendQueueRequest('/api/v1/lobby/enterRanked', payload);
}

export async function apiExitRankedQueue(payload = {}) {
  return sendQueueRequest('/api/v1/lobby/exitRanked', payload);
}

export async function apiMove({ gameId, color, from, to, declaration }) {
  return authFetch('/api/v1/gameAction/move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color, from, to, declaration })
  });
}

export async function apiChallenge(gameId, color) {
  return authFetch('/api/v1/gameAction/challenge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiBomb(gameId, color) {
  return authFetch('/api/v1/gameAction/bomb', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiPass(gameId, color) {
  return authFetch('/api/v1/gameAction/pass', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiResign(gameId, color) {
  return authFetch('/api/v1/gameAction/resign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiDraw(gameId, color, action) {
  return authFetch('/api/v1/gameAction/draw', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color, action })
  });
}

export async function apiOnDeck(gameId, color, piece) {
  return authFetch('/api/v1/gameAction/onDeck', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color, piece })
  });
}

export async function apiCheckTimeControl(gameId) {
  return authFetch('/api/v1/gameAction/checkTimeControl', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId })
  });
}

export async function apiGetMatchDetails(matchId) {
  const res = await authFetch('/api/v1/matches/getDetails', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId })
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function apiGetTimeSettings() {
  const res = await authFetch('/api/v1/config/timeSettings');
  if (!res.ok) return null;
  return res.json().catch(() => null);
}


