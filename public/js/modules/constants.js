export {
  GAME_CONSTANTS,
  GAME_MODES,
  COLORS,
  IDENTITIES,
  ACTIONS,
  MOVE_STATES,
  BOARD_DIMENSIONS,
  GAME_MODE_SETTINGS,
  GAME_VIEW_STATES,
  WIN_REASONS,
  GAME_ACTION_STATES
} from '../shared/gameConstants.js';

import { IDENTITIES } from '../shared/gameConstants.js';

const PROCEDURAL_PIECE_BASE = '/assets/images/Pieces/Procedural';
const PROCEDURAL_IDENTITY_COLORS = {
  light: '#d9d9d9ff',
  dark: '#292929ff'
};

function proceduralPiece(identitySrc, color) {
  const isWhite = Number(color) === 0;
  return {
    kind: 'procedural',
    cloak: `${PROCEDURAL_PIECE_BASE}/${isWhite ? 'WhiteCloak.svg' : 'BlackCloak.svg'}`,
    identity: `${PROCEDURAL_PIECE_BASE}/${identitySrc}`,
    identityColor: isWhite ? PROCEDURAL_IDENTITY_COLORS.dark : PROCEDURAL_IDENTITY_COLORS.light
  };
}

// Map piece identity and color to renderable assets served from /assets/images/Pieces.
// Known identities are layered from a cloak plus an identity mask; unknowns remain
// the dedicated full-piece SVGs.
export const PIECE_IMAGES = {
  0: {
    0: `${PROCEDURAL_PIECE_BASE}/WhiteUnknown.svg`,
    1: `${PROCEDURAL_PIECE_BASE}/BlackUnknown.svg`
  },
  1: {
    0: proceduralPiece('HeartIdentity.svg', 0),
    1: proceduralPiece('HeartIdentity.svg', 1)
  },
  2: {
    0: proceduralPiece('PoisonIdentity.svg', 0),
    1: proceduralPiece('PoisonIdentity.svg', 1)
  },
  3: {
    0: proceduralPiece('SpearIdentity.svg', 0),
    1: proceduralPiece('SpearIdentity.svg', 1)
  },
  4: {
    0: proceduralPiece('SwordIdentity.svg', 0),
    1: proceduralPiece('SwordIdentity.svg', 1)
  },
  5: {
    0: proceduralPiece('ScytheIdentity.svg', 0),
    1: proceduralPiece('ScytheIdentity.svg', 1)
  }
};

export const KING_ID = IDENTITIES.KING;
