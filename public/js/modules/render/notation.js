export function serverCoordsForCell(r, c, rows, cols, isWhite) {
  const serverRow = isWhite ? (rows - 1 - r) : r;
  const serverCol = isWhite ? c : (cols - 1 - c);
  return { serverRow, serverCol };
}

export function setCellNotation(cell, serverRow, serverCol) {
  cell.dataset.serverRow = String(serverRow);
  cell.dataset.serverCol = String(serverCol);
  const fileChar = String.fromCharCode('A'.charCodeAt(0) + serverCol);
  cell.dataset.square = `${fileChar}${serverRow + 1}`;
}
