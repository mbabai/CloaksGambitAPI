export async function apiReady(gameId, color) {
  return fetch('/api/v1/gameAction/ready', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiNext(gameId, color) {
  return fetch('/api/v1/gameAction/next', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiSetup(payload) {
  return fetch('/api/v1/gameAction/setup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export async function apiGetDetails(gameId, color) {
  const res = await fetch('/api/v1/games/getDetails', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

export async function apiEnterQueue(userId) {
  return fetch('/api/v1/lobby/enterQuickplay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
}

export async function apiExitQueue(userId) {
  return fetch('/api/v1/lobby/exitQuickplay', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
}

export async function apiEnterRankedQueue(userId) {
  return fetch('/api/v1/lobby/enterRanked', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
}

export async function apiExitRankedQueue(userId) {
  return fetch('/api/v1/lobby/exitRanked', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
}

export async function apiMove({ gameId, color, from, to, declaration }) {
  return fetch('/api/v1/gameAction/move', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color, from, to, declaration })
  });
}

export async function apiChallenge(gameId, color) {
  return fetch('/api/v1/gameAction/challenge', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiBomb(gameId, color) {
  return fetch('/api/v1/gameAction/bomb', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiPass(gameId, color) {
  return fetch('/api/v1/gameAction/pass', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiResign(gameId, color) {
  return fetch('/api/v1/gameAction/resign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color })
  });
}

export async function apiOnDeck(gameId, color, piece) {
  return fetch('/api/v1/gameAction/onDeck', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId, color, piece })
  });
}

export async function apiCheckTimeControl(gameId) {
  return fetch('/api/v1/gameAction/checkTimeControl', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gameId })
  });
}

export async function apiGetMatchDetails(matchId) {
  const res = await fetch('/api/v1/matches/getDetails', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ matchId })
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}


