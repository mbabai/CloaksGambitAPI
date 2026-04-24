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
  maskedGame.setupComplete = Array.isArray(game.setupComplete) ? [...game.setupComplete] : [false, false];
  maskedGame.playersReady = Array.isArray(game.playersReady) ? [...game.playersReady] : [false, false];
  maskedGame.startTime = game.startTime || null;
  maskedGame.timeControlStart = game.timeControlStart ?? null;
  maskedGame.increment = game.increment ?? 0;
  maskedGame.requiresAccept = Boolean(game.requiresAccept);
  maskedGame.acceptWindowSeconds = Number.isFinite(Number(game.acceptWindowSeconds))
    ? Math.max(0, Number(game.acceptWindowSeconds))
    : 0;
  maskedGame.isTutorial = Boolean(game.isTutorial);
  maskedGame.tutorialState = game.tutorialState ? { ...game.tutorialState } : null;

  return maskedGame;
}

module.exports = maskGameForColor;
