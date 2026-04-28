import { IDENTITIES } from '../constants.js';

export const PIECE_DISPLAY_NAMES = {
  [IDENTITIES.UNKNOWN]: 'Unknown',
  [IDENTITIES.KING]: 'Heart',
  [IDENTITIES.ROOK]: 'Sword',
  [IDENTITIES.BISHOP]: 'Spear',
  [IDENTITIES.KNIGHT]: 'Scythe',
  [IDENTITIES.BOMB]: 'Poison'
};

export function getPieceDisplayName(piece) {
  if (!piece || typeof piece !== 'object') return '';
  return PIECE_DISPLAY_NAMES[Number(piece.identity)] || '';
}
