const ServerConfig = require('../models/ServerConfig');

function maskGameForColor(game, color) {
  const normalized = String(color).toLowerCase();
  const isAdmin = normalized === 'admin';
  const isSpectator = normalized === 'spectator';
  const viewColor = !isAdmin && !isSpectator ? parseInt(normalized, 10) : undefined;

  if (isAdmin) {
    return game;
  }

  const config = new ServerConfig();
  const unknown = config.identities.get('UNKNOWN');

  const maskPiece = (piece) => {
    if (!piece) return piece;
    if (isSpectator || piece.color !== viewColor) {
      return { ...piece, identity: unknown };
    }
    return piece;
  };

  if (Array.isArray(game.board)) {
    game.board = game.board.map((row) => row.map(maskPiece));
  }
  if (Array.isArray(game.stashes)) {
    game.stashes = game.stashes.map((stash) => stash.map(maskPiece));
  }
  if (Array.isArray(game.onDecks)) {
    game.onDecks = game.onDecks.map(maskPiece);
  }

  return game;
}

module.exports = maskGameForColor;
