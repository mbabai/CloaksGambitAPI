const eventBus = require('../eventBus');

function buildAffectedUsers(game, fallback = []) {
  if (Array.isArray(fallback) && fallback.length) {
    return fallback.map((value) => value.toString());
  }
  return Array.isArray(game?.players)
    ? game.players.map((player) => player.toString())
    : [];
}

function emitGameChanged(game, extra = {}) {
  return eventBus.emit('gameChanged', {
    game: typeof game?.toObject === 'function' ? game.toObject() : game,
    affectedUsers: buildAffectedUsers(game, extra.affectedUsers),
    ...extra,
  });
}

function emitPlayersBothReady(gameId, affectedUsers = []) {
  return eventBus.emit('players:bothReady', {
    gameId,
    affectedUsers: affectedUsers.map((value) => value.toString()),
  });
}

module.exports = {
  emitGameChanged,
  emitPlayersBothReady,
};
