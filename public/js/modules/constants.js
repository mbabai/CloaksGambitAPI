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
const FOX_COLORS = Object.freeze({
  orange: '#d3340b',
  purple: '#7968d9',
  orangeText: '#1f1206',
  purpleText: '#f3e8ff',
  symbol: '#000000',
  boardGreen: '#6FAE68',
  boardDarkGreen: '#2D5A4F',
  boardBack: '#5A4632'
});

export const VISUAL_THEMES = Object.freeze({
  DEFAULT: 'default',
  FOX: 'fox'
});

function proceduralPiece(identitySrc, color) {
  const isWhite = Number(color) === 0;
  return {
    kind: 'procedural',
    cloak: `${PROCEDURAL_PIECE_BASE}/${isWhite ? 'WhiteCloak.svg' : 'BlackCloak.svg'}`,
    identity: `${PROCEDURAL_PIECE_BASE}/${identitySrc}`,
    identityColor: isWhite ? PROCEDURAL_IDENTITY_COLORS.dark : PROCEDURAL_IDENTITY_COLORS.light
  };
}

function foxProceduralPiece(identitySrc, color) {
  const isWhite = Number(color) === 0;
  return {
    kind: 'procedural',
    cloak: `${PROCEDURAL_PIECE_BASE}/WhitePiece.svg`,
    cloakColor: isWhite ? FOX_COLORS.orange : FOX_COLORS.purple,
    identity: `${PROCEDURAL_PIECE_BASE}/${identitySrc}`,
    identityColor: FOX_COLORS.symbol
  };
}

function foxUnknownPiece(color) {
  const isWhite = Number(color) === 0;
  return {
    kind: 'proceduralSingle',
    src: `${PROCEDURAL_PIECE_BASE}/WhiteUnknownFox.svg`,
    tintColor: isWhite ? FOX_COLORS.orange : FOX_COLORS.purple
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

export const FOX_PIECE_IMAGES = {
  0: {
    0: foxUnknownPiece(0),
    1: foxUnknownPiece(1)
  },
  1: {
    0: foxProceduralPiece('FoxIdentity.svg', 0),
    1: foxProceduralPiece('FoxIdentity.svg', 1)
  },
  2: {
    0: foxProceduralPiece('MushroomIdentity.svg', 0),
    1: foxProceduralPiece('MushroomIdentity.svg', 1)
  },
  3: {
    0: foxProceduralPiece('HawkIdentity.svg', 0),
    1: foxProceduralPiece('HawkIdentity.svg', 1)
  },
  4: {
    0: foxProceduralPiece('BearIdentity.svg', 0),
    1: foxProceduralPiece('BearIdentity.svg', 1)
  },
  5: {
    0: foxProceduralPiece('ViperIdentity.svg', 0),
    1: foxProceduralPiece('ViperIdentity.svg', 1)
  }
};

export const PIECE_IMAGES_BY_VISUAL_THEME = Object.freeze({
  [VISUAL_THEMES.DEFAULT]: PIECE_IMAGES,
  [VISUAL_THEMES.FOX]: FOX_PIECE_IMAGES
});

export const DEFAULT_IDENTITY_LABELS = Object.freeze({
  [IDENTITIES.UNKNOWN]: 'Unknown',
  [IDENTITIES.KING]: 'Heart',
  [IDENTITIES.ROOK]: 'Sword',
  [IDENTITIES.BISHOP]: 'Spear',
  [IDENTITIES.KNIGHT]: 'Scythe',
  [IDENTITIES.BOMB]: 'Poison'
});

export const FOX_IDENTITY_LABELS = Object.freeze({
  [IDENTITIES.UNKNOWN]: 'Unknown',
  [IDENTITIES.KING]: 'Fox',
  [IDENTITIES.ROOK]: 'Bear',
  [IDENTITIES.BISHOP]: 'Hawk',
  [IDENTITIES.KNIGHT]: 'Viper',
  [IDENTITIES.BOMB]: 'Poison Mushroom'
});

export const IDENTITY_LABELS_BY_VISUAL_THEME = Object.freeze({
  [VISUAL_THEMES.DEFAULT]: DEFAULT_IDENTITY_LABELS,
  [VISUAL_THEMES.FOX]: FOX_IDENTITY_LABELS
});

export const DEFAULT_TERMINOLOGY = Object.freeze({
  challengeAction: 'Challenge',
  challengeAvailableAlt: 'Challenge available',
  challengeSuccess: 'Challenge Successful!',
  challengeFailed: 'Challenge Failed',
  challengeVerb: 'challenge',
  challengeGerund: 'challenging',
  challengePast: 'challenged',
  daggerTokenName: 'dagger token',
  daggerTokenPlural: 'dagger tokens',
  daggerTokenAlt: 'Dagger token'
});

export const FOX_TERMINOLOGY = Object.freeze({
  challengeAction: 'Investigate',
  challengeAvailableAlt: 'Investigate available',
  challengeSuccess: 'Investigation Successful!',
  challengeFailed: 'Investigation Failed',
  challengeVerb: 'investigate',
  challengeGerund: 'investigating',
  challengePast: 'investigated',
  daggerTokenName: 'strike',
  daggerTokenPlural: 'strikes',
  daggerTokenAlt: 'Strike'
});

export const TERMINOLOGY_BY_VISUAL_THEME = Object.freeze({
  [VISUAL_THEMES.DEFAULT]: DEFAULT_TERMINOLOGY,
  [VISUAL_THEMES.FOX]: FOX_TERMINOLOGY
});

export function normalizeVisualTheme(value) {
  if (typeof value !== 'string') return VISUAL_THEMES.DEFAULT;
  const normalized = value.trim().toLowerCase();
  return normalized === VISUAL_THEMES.FOX ? VISUAL_THEMES.FOX : VISUAL_THEMES.DEFAULT;
}

export function getPieceImagesForVisualTheme(value) {
  return PIECE_IMAGES_BY_VISUAL_THEME[normalizeVisualTheme(value)] || PIECE_IMAGES;
}

export function getIdentityLabelsForVisualTheme(value) {
  return IDENTITY_LABELS_BY_VISUAL_THEME[normalizeVisualTheme(value)] || DEFAULT_IDENTITY_LABELS;
}

export function getTerminologyForVisualTheme(value) {
  return TERMINOLOGY_BY_VISUAL_THEME[normalizeVisualTheme(value)] || DEFAULT_TERMINOLOGY;
}

export function getVisualThemeConfig(value) {
  const theme = normalizeVisualTheme(value);
  if (theme !== VISUAL_THEMES.FOX) {
    return {
      theme,
      pieceImages: PIECE_IMAGES,
      identityLabels: DEFAULT_IDENTITY_LABELS,
      terminology: DEFAULT_TERMINOLOGY,
      boardPalette: null,
      daggerTokenLabel: '\u2694',
      playerColors: null,
      playerTextColors: null
    };
  }

  return {
    theme,
    pieceImages: FOX_PIECE_IMAGES,
    identityLabels: FOX_IDENTITY_LABELS,
    terminology: FOX_TERMINOLOGY,
    boardPalette: {
      lightSquare: FOX_COLORS.boardGreen,
      darkSquare: FOX_COLORS.boardDarkGreen,
      label: '#f4f8e7',
      border: 'rgba(58, 36, 20, 0)',
      boardBackColor: FOX_COLORS.boardBack,
      boardBorder: FOX_COLORS.boardBack,
      textureAlpha: 0.16,
      squareBackColor: FOX_COLORS.boardBack,
      squareInset: 3,
      squareRadius: 10,
      gridLineWidth: 0,
      backRankBorders: true,
      backRankBorderWidth: 3,
      playerColors: [FOX_COLORS.orange, FOX_COLORS.purple]
    },
    daggerTokenLabel: 'X',
    playerColors: [FOX_COLORS.orange, FOX_COLORS.purple],
    playerTextColors: [FOX_COLORS.orangeText, FOX_COLORS.purpleText]
  };
}

export const KING_ID = IDENTITIES.KING;
