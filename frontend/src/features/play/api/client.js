export function getApiOrigin() {
  return (import.meta.env?.VITE_API_ORIGIN) || (window.location.origin.includes(':5173') ? 'http://localhost:3000' : window.location.origin)
}

function post(path, body) {
  return fetch(`${getApiOrigin()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export const Game = {
  ready: (id, color) => post('/api/v1/gameAction/ready', { gameId: id, color }),
  challenge: (id, color) => post('/api/v1/gameAction/challenge', { gameId: id, color }),
  bomb: (id, color) => post('/api/v1/gameAction/bomb', { gameId: id, color }),
  getDetails: (id, color) => post('/api/v1/games/getDetails', { gameId: id, color })
}

export const Lobby = {
  enterQuickplay: (userId) => post('/api/v1/lobby/enterQuickplay', { userId }),
  exitQuickplay: (userId) => post('/api/v1/lobby/exitQuickplay', { userId })
}

export const Users = {
  createGuest: (username, email) => post('/api/v1/users/create', { username, email })
}
