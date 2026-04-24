function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  return fetch(url, { credentials: 'include', ...options, headers });
}

export async function apiReady(gameId, color) {
  return authFetch('/api/v1/gameAction/ready', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiNext(gameId, color) {
  const res = await authFetch('/api/v1/gameAction/next', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const error = new Error((data && data.message) || 'Failed to advance to the next game');
    error.response = res;
    error.data = data;
    throw error;
  }
  return data || {};
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

export async function apiEnterBotQueue(payload = {}) {
  return sendQueueRequest('/api/v1/lobby/enterBot', payload);
}

export async function apiEnterTutorial(payload = {}) {
  return sendQueueRequest('/api/v1/lobby/enterTutorial', payload);
}

export async function apiGetBotCatalog() {
  const res = await authFetch('/api/v1/bots/catalog');
  if (!res.ok) return null;
  return res.json().catch(() => null);
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

export async function apiAdvanceTutorial(gameId, color) {
  return authFetch('/api/v1/gameAction/tutorialAdvance', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
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

export async function apiPostLocalDebugLog(payload = {}) {
  return authFetch('/api/v1/debug/localLog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function sendTournamentRequest(path, payload = {}, { method = 'POST' } = {}) {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(payload || {}),
  };
  if (method === 'GET') {
    delete options.headers;
    delete options.body;
  }
  const res = await authFetch(path, options);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  if (!res.ok) {
    const error = new Error((data && data.message) || 'Tournament request failed');
    error.response = res;
    error.data = data;
    throw error;
  }
  return data;
}

export async function apiGetTournaments() {
  return sendTournamentRequest('/api/v1/tournaments', {}, { method: 'GET' });
}

export async function apiGetCurrentTournament() {
  return sendTournamentRequest('/api/v1/tournaments/current', {}, { method: 'GET' });
}

export async function apiCreateTournament(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/create', payload);
}

export async function apiUpdateTournamentConfig(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/config', payload);
}

export async function apiJoinTournament(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/join', payload);
}

export async function apiLeaveTournament(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/leave', payload);
}

export async function apiCancelTournament(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/cancel', payload);
}

export async function apiAddTournamentBot(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/add-bot', payload);
}

export async function apiStartTournament(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/start', payload);
}

export async function apiStartTournamentElimination(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/start-elimination', payload);
}

export async function apiKickTournamentPlayer(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/kick-player', payload);
}

export async function apiReallowTournamentPlayer(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/reallow-player', payload);
}

export async function apiGetTournamentDetails(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/details', payload);
}

export async function apiGetTournamentHistory() {
  return sendTournamentRequest('/api/v1/tournaments/history', {}, { method: 'GET' });
}

export async function apiGetTournamentHistoryDetails(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/history/details', payload);
}

export async function apiGetAdminTournamentDetails(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/admin/details', payload);
}

export async function apiTransferTournamentHost(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/transfer-host', payload);
}

export async function apiUpdateTournamentMessage(payload = {}) {
  return sendTournamentRequest('/api/v1/tournaments/message', payload);
}
