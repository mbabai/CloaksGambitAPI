import { IDENTITIES } from '../constants.js';

export const GAME_VIEW_MODES = Object.freeze({
  PLAYER: 'player',
  SPECTATOR: 'spectator',
  GOD: 'god',
});

export function normalizeGameViewMode(mode) {
  if (typeof mode !== 'string') {
    return GAME_VIEW_MODES.PLAYER;
  }
  const normalized = mode.trim().toLowerCase();
  if (normalized === GAME_VIEW_MODES.SPECTATOR) {
    return GAME_VIEW_MODES.SPECTATOR;
  }
  if (normalized === GAME_VIEW_MODES.GOD || normalized === 'admin') {
    return GAME_VIEW_MODES.GOD;
  }
  return GAME_VIEW_MODES.PLAYER;
}

export function createPieceVisibilityTransform({
  mode = GAME_VIEW_MODES.PLAYER,
  viewerColor = null,
  unknownIdentity = IDENTITIES.UNKNOWN,
} = {}) {
  const normalizedMode = normalizeGameViewMode(mode);
  const resolvedViewerColor = Number.isFinite(viewerColor) ? Number(viewerColor) : null;

  return function transformPiece(piece) {
    if (!piece || typeof piece !== 'object') {
      return piece;
    }

    if (normalizedMode === GAME_VIEW_MODES.GOD) {
      return piece;
    }

    if (normalizedMode === GAME_VIEW_MODES.SPECTATOR) {
      return { ...piece, identity: unknownIdentity };
    }

    if (resolvedViewerColor === null || piece.color === resolvedViewerColor) {
      return piece;
    }

    return { ...piece, identity: unknownIdentity };
  };
}
