const { lobbies, rankedQueue, quickplayQueue, matches, games } = require('../state');

function toId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return null;
}

function ensureLobby() {
  if (!lobbies.default) {
    lobbies.default = { quickplayQueue, rankedQueue, inGame: [] };
  }
  const lobby = lobbies.default;
  if (!Array.isArray(lobby.inGame)) {
    lobby.inGame = [];
  }
  lobby.quickplayQueue = quickplayQueue;
  lobby.rankedQueue = rankedQueue;
  return lobby;
}

function normalizeUserId(userId) {
  const id = toId(userId);
  return id ? id.toString() : null;
}

function isUserInQueue(queue, userId) {
  const id = normalizeUserId(userId);
  if (!id) return false;
  return queue.some((entry) => normalizeUserId(entry) === id);
}

function addUserToQueue(queue, userId) {
  const id = normalizeUserId(userId);
  if (!id) return false;
  if (isUserInQueue(queue, id)) return false;
  queue.push(id);
  return true;
}

function removeUserFromQueue(queue, userId) {
  const id = normalizeUserId(userId);
  if (!id) return false;
  let removed = false;
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (normalizeUserId(queue[i]) === id) {
      queue.splice(i, 1);
      removed = true;
    }
  }
  return removed;
}

function ensureUserInGame(userId) {
  const lobby = ensureLobby();
  const id = normalizeUserId(userId);
  if (!id) return lobby;
  if (!lobby.inGame.includes(id)) {
    lobby.inGame.push(id);
  }
  return lobby;
}

function removeUserFromInGame(userId) {
  const lobby = ensureLobby();
  const id = normalizeUserId(userId);
  if (!id) return lobby;
  lobby.inGame = lobby.inGame.filter((value) => normalizeUserId(value) !== id);
  return lobby;
}

function clearInGame() {
  const lobby = ensureLobby();
  lobby.inGame = [];
  return lobby;
}

function isUserInActiveMatch(userId) {
  const id = normalizeUserId(userId);
  if (!id) return false;
  for (const match of matches.values()) {
    if (!match?.isActive) continue;
    const players = Array.isArray(match.players)
      ? match.players.map(normalizeUserId)
      : [normalizeUserId(match.player1), normalizeUserId(match.player2)];
    if (players.includes(id)) {
      return true;
    }
    if (Array.isArray(match.games)) {
      for (const gameId of match.games) {
        const game = games.get(normalizeUserId(gameId));
        if (!game?.isActive) continue;
        const gamePlayers = Array.isArray(game.players)
          ? game.players.map(normalizeUserId)
          : [];
        if (gamePlayers.includes(id)) {
          return true;
        }
      }
    }
  }
  return false;
}

function findActiveMatchForPlayer(userId) {
  const id = normalizeUserId(userId);
  if (!id) return null;
  for (const [matchId, match] of matches.entries()) {
    if (!match?.isActive) continue;
    const players = Array.isArray(match.players)
      ? match.players.map(normalizeUserId)
      : [normalizeUserId(match.player1), normalizeUserId(match.player2)];
    if (!players.includes(id)) continue;
    const gameIds = Array.isArray(match.games) ? match.games : [];
    const activeGames = gameIds
      .map((gid) => games.get(normalizeUserId(gid)))
      .filter((game) => game && game.isActive !== false);
    return {
      matchId,
      match,
      games: activeGames,
    };
  }
  return null;
}

function snapshotQueues() {
  return {
    quickplayQueue: [...quickplayQueue].map(normalizeUserId).filter(Boolean),
    rankedQueue: [...rankedQueue].map(normalizeUserId).filter(Boolean),
  };
}

module.exports = {
  ensureLobby,
  addUserToQueue,
  removeUserFromQueue,
  removeUserFromInGame,
  clearInGame,
  ensureUserInGame,
  isUserInQueue,
  isUserInActiveMatch,
  findActiveMatchForPlayer,
  snapshotQueues,
};
