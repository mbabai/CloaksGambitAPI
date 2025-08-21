import { pieceGlyph as makePieceGlyph } from './pieceGlyph.js';
import { serverCoordsForCell, setCellNotation } from './notation.js';

/**
 * Renders the board grid and pieces. This is a wrapper so we can gradually move code here.
 * To avoid behavior change, we accept callbacks/state from the legacy script.
 */
export function renderBoard({
  container,
  sizes,
  state,
  refs,
  identityMap,
  onAttachHandlers,
  labelFont,
  fileLetters
}) {
  const { rows, cols, squareSize, boardLeft, boardTop } = sizes;
  const { currentBoard, currentIsWhite, selected, isInSetup, workingRank } = state;

  // Clear container and build grid
  container.style.width = (squareSize * cols) + 'px';
  container.style.height = (squareSize * rows) + 'px';
  container.style.left = boardLeft + 'px';
  container.style.top = boardTop + 'px';
  container.style.display = 'grid';
  container.style.gridTemplateColumns = `repeat(${cols}, ${squareSize}px)`;
  container.style.gridTemplateRows = `repeat(${rows}, ${squareSize}px)`;
  while (container.firstChild) container.removeChild(container.firstChild);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const light = ((r + c) % 2 === 1);
      const cell = document.createElement('div');
      cell.style.width = squareSize + 'px';
      cell.style.height = squareSize + 'px';
      cell.style.boxSizing = 'border-box';
      cell.style.position = 'relative';
      cell.style.border = '1px solid #9ca3af';
      cell.style.background = light ? '#f7f7f7' : '#6b7280';

      const { serverRow, serverCol } = serverCoordsForCell(r, c, rows, cols, currentIsWhite);
      // Store server-oriented coordinates for payload building
      setCellNotation(cell, serverRow, serverCol);

      // File label on UI bottom row (letters A..E oriented to player's perspective)
      if (r === rows - 1) {
        const fileIdx = currentIsWhite ? c : (cols - 1 - c);
        const file = (fileLetters && fileLetters[fileIdx]) || '';
        if (file) {
          const fileSpan = document.createElement('span');
          fileSpan.textContent = file;
          fileSpan.style.position = 'absolute';
          fileSpan.style.right = '3px';
          fileSpan.style.bottom = '2px';
          fileSpan.style.color = '#000';
          fileSpan.style.fontWeight = '400';
          fileSpan.style.fontSize = (labelFont || 12) + 'px';
          fileSpan.style.lineHeight = '1';
          fileSpan.style.userSelect = 'none';
          fileSpan.style.pointerEvents = 'none';
          cell.appendChild(fileSpan);
        }
      }

      // Rank label on UI left column (numbers 1..N oriented to player's perspective)
      if (c === 0) {
        const rank = currentIsWhite ? (rows - r) : (r + 1);
        const rankSpan = document.createElement('span');
        rankSpan.textContent = String(rank);
        rankSpan.style.position = 'absolute';
        rankSpan.style.left = '3px';
        rankSpan.style.top = '2px';
        rankSpan.style.color = '#000';
        rankSpan.style.fontWeight = '400';
        rankSpan.style.fontSize = (labelFont || 12) + 'px';
        rankSpan.style.lineHeight = '1';
        rankSpan.style.userSelect = 'none';
        rankSpan.style.pointerEvents = 'none';
        cell.appendChild(rankSpan);
      }

      // Piece mapping: during setup, bottom UI row shows workingRank; otherwise show server board
      let piece = null;
      const isUiBottom = (r === rows - 1);
      if (isInSetup && isUiBottom) {
        piece = (workingRank && workingRank[c]) || null;
      } else if (currentBoard) {
        const srcR = currentIsWhite ? (rows - 1 - r) : r;
        const srcC = currentIsWhite ? c : (cols - 1 - c);
        piece = currentBoard?.[srcR]?.[srcC] || null;
      }
      if (piece) {
        const p = makePieceGlyph(piece, squareSize, identityMap);
        // Center piece absolutely in square (covers labels when needed)
        p.style.position = 'absolute';
        p.style.left = '50%';
        p.style.top = '50%';
        p.style.transform = 'translate(-50%, -50%)';
        if (selected && selected.type === 'board' && selected.index === c && isUiBottom) {
          p.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
        }
        cell.appendChild(p);
      }

      // Attach setup interactions and expose bottom cells for hit-testing
      if (isInSetup && isUiBottom && onAttachHandlers) {
        onAttachHandlers(cell, { type: 'board', index: c });
        if (Array.isArray(refs.bottomCells)) refs.bottomCells[c] = { el: cell, col: c };
      }

      container.appendChild(cell);
    }
  }

}
