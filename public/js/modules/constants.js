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
} from '/js/shared/gameConstants.js';

import { IDENTITIES } from '/js/shared/gameConstants.js';

// Map piece identity and color to SVG assets served from /assets/images/Pieces
export const PIECE_IMAGES = {
  0: {
    0: '/assets/images/Pieces/PawnWhiteUnknown.svg',
    1: '/assets/images/Pieces/PawnBlackUnknown.svg'
  },
  1: {
    0: '/assets/images/Pieces/PawnWhiteKing.svg',
    1: '/assets/images/Pieces/PawnBlackKing.svg'
  },
  2: {
    0: '/assets/images/Pieces/PawnWhiteBomb.svg',
    1: '/assets/images/Pieces/PawnBlackBomb.svg'
  },
  3: {
    0: '/assets/images/Pieces/PawnWhiteBishop.svg',
    1: '/assets/images/Pieces/PawnBlackBishop.svg'
  },
  4: {
    0: '/assets/images/Pieces/PawnWhiteRook.svg',
    1: '/assets/images/Pieces/PawnBlackRook.svg'
  },
  5: {
    0: '/assets/images/Pieces/PawnWhiteKnight.svg',
    1: '/assets/images/Pieces/PawnBlackKnight.svg'
  }
};

export const KING_ID = IDENTITIES.KING;
