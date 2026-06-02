import { DEFAULT_IDENTITY_LABELS } from '../constants.js';

export const PIECE_DISPLAY_NAMES = DEFAULT_IDENTITY_LABELS;

export function getPieceDisplayName(piece, identityLabels = PIECE_DISPLAY_NAMES) {
  if (!piece || typeof piece !== 'object') return '';
  return identityLabels?.[Number(piece.identity)] || PIECE_DISPLAY_NAMES[Number(piece.identity)] || '';
}
