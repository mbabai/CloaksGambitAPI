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

  const shouldMaskOwnedAction = (ownerColor) => {
    if (isAdmin) return false;
    if (isSpectator) return true;
    return ownerColor !== viewColor;
  };

  const maskActionDetails = (action) => {
    if (!action || !action.details || typeof action.details !== 'object') {
      return action?.details || {};
    }

    const ownerColor = action.player;
    const maskHiddenIdentity = shouldMaskOwnedAction(ownerColor);
    const details = { ...action.details };
    const setupAction = config.actions.get('SETUP');
    const onDeckAction = config.actions.get('ON_DECK');

    if (action.type === setupAction) {
      if (Array.isArray(details.pieces)) {
        details.pieces = details.pieces.map((piece) => {
          if (!piece || typeof piece !== 'object') return piece;
          return {
            ...piece,
            identity: maskHiddenIdentity ? unknown : piece.identity,
          };
        });
      }
      if (details.onDeck && typeof details.onDeck === 'object') {
        details.onDeck = {
          ...details.onDeck,
          identity: maskHiddenIdentity ? unknown : details.onDeck.identity,
        };
      }
    }

    if (action.type === onDeckAction && Object.prototype.hasOwnProperty.call(details, 'identity')) {
      details.identity = maskHiddenIdentity ? unknown : details.identity;
    }

    return details;
  };

  const maskAction = (action) => {
    if (!action || typeof action !== 'object') return action;
    return {
      ...action,
      details: maskActionDetails(action),
    };
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
  if (Array.isArray(maskedGame.actions)) {
    maskedGame.actions = maskedGame.actions.map(maskAction);
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
