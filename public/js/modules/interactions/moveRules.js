export const Declaration = {
  KING: 1,
  BOMB: 2,
  BISHOP: 3,
  ROOK: 4,
  KNIGHT: 5
};

export function uiToServerCoords(uiR, uiC, rows, cols, isWhite) {
  const serverRow = isWhite ? (rows - 1 - uiR) : uiR;
  const serverCol = isWhite ? uiC : (cols - 1 - uiC);
  return { serverRow, serverCol };
}

export function isWithinPieceRange(from, to, dec) {
  const dr = Math.abs(to.row - from.row);
  const dc = Math.abs(to.col - from.col);
  switch (dec) {
    case Declaration.KNIGHT:
      return (dr === 2 && dc === 1) || (dr === 1 && dc === 2);
    case Declaration.KING:
      return (dr <= 1 && dc <= 1) && (dr + dc > 0);
    case Declaration.BISHOP:
      return dr === dc && dr > 0 && dr <= 3;
    case Declaration.ROOK:
      return (dr === 0 || dc === 0) && (dr + dc > 0) && dr <= 3 && dc <= 3;
    default:
      return false;
  }
}

export function isPathClear(board, from, to, dec) {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  const absDr = Math.abs(dr), absDc = Math.abs(dc);
  if (dec === Declaration.KNIGHT) return true;
  if (dec === Declaration.KING) return true;
  if (dec === Declaration.BISHOP && absDr === absDc) {
    const stepR = dr > 0 ? 1 : -1;
    const stepC = dc > 0 ? 1 : -1;
    for (let i = 1; i < absDr; i++) {
      if (board[from.row + i * stepR][from.col + i * stepC]) return false;
    }
    return true;
  }
  if (dec === Declaration.ROOK && (dr === 0 || dc === 0)) {
    const stepR = dr === 0 ? 0 : (dr > 0 ? 1 : -1);
    const stepC = dc === 0 ? 0 : (dc > 0 ? 1 : -1);
    const distance = Math.max(absDr, absDc);
    for (let i = 1; i < distance; i++) {
      if (board[from.row + i * stepR][from.col + i * stepC]) return false;
    }
    return true;
  }
  return false;
}


