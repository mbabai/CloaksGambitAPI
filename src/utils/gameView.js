const getServerConfig = require('./getServerConfig');

function maskGameForColor(game, color) {
  const normalized = String(color).toLowerCase();
  const isAdmin = normalized === 'admin';
  const isSpectator = normalized === 'spectator';
  const viewColor = !isAdmin && !isSpectator ? parseInt(normalized, 10) : undefined;

  if (isAdmin) {
    return game;
  }

  const config = getServerConfig.getServerConfigSnapshotSync();
  const unknown = config.identities.get('UNKNOWN');

  const maskPiece = (piece) => {
    if (!piece) return piece;
    if (isSpectator || piece.color !== viewColor) {
      return { ...piece, identity: unknown };
    }
    return piece;
  };

  // Create a copy of the game to avoid modifying the original
  const maskedGame = { ...game };

  if (Array.isArray(maskedGame.board)) {
    maskedGame.board = maskedGame.board.map((row) => row.map(maskPiece));
  }
  if (Array.isArray(maskedGame.stashes)) {
    maskedGame.stashes = maskedGame.stashes.map((stash) => stash.map(maskPiece));
  }
  if (Array.isArray(maskedGame.onDecks)) {
    maskedGame.onDecks = maskedGame.onDecks.map(maskPiece);
  }

  // Ensure game state fields are preserved
  // These fields are important for win condition detection
  maskedGame.isActive = game.isActive;
  maskedGame.winner = game.winner;
  maskedGame.winReason = game.winReason;
  maskedGame.onDeckingPlayer = game.onDeckingPlayer;
  maskedGame.playerTurn = game.playerTurn;

  return maskedGame;
}

module.exports = maskGameForColor;
