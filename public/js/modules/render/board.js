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
  onAttachGameHandlers,
  labelFont,
  fileLetters
}) {
  const { rows, cols, squareSize, boardLeft, boardTop } = sizes;
  const { currentBoard, currentIsWhite, selected, isInSetup, workingRank, pendingCapture } = state;

  // Clear container and build grid
  container.style.width = (squareSize * cols) + 'px';
  container.style.height = (squareSize * rows) + 'px';
  container.style.left = boardLeft + 'px';
  container.style.top = boardTop + 'px';
  container.style.display = 'grid';
  container.style.gridTemplateColumns = `repeat(${cols}, ${squareSize}px)`;
  container.style.gridTemplateRows = `repeat(${rows}, ${squareSize}px)`;
  while (container.firstChild) container.removeChild(container.firstChild);
  // Prepare matrix for in-game hit-testing when not in setup
  if (!state.isInSetup) {
    refs.boardCells = Array.from({ length: rows }, () => Array.from({ length: cols }, () => null));
  }

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
      const isPendingCaptureSquare = pendingCapture && pendingCapture.row === serverRow && pendingCapture.col === serverCol;
      const capturedPiece = isPendingCaptureSquare ? pendingCapture.piece : null;
      if (piece || capturedPiece) {
        const myColorIdx = currentIsWhite ? 0 : 1;
        let movingImg = null;
        let capturedImg = null;
        if (piece) {
          movingImg = makePieceGlyph(piece, squareSize, identityMap);
          if (movingImg) {
            movingImg.style.position = 'absolute';
            movingImg.style.left = '50%';
            movingImg.style.top = '50%';
            movingImg.style.transform = 'translate(-50%, -50%)';
            if (selected && selected.type === 'board' && selected.index === c && isUiBottom) {
              movingImg.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
            }
            if (!isInSetup && selected && selected.type === 'boardAny' && selected.uiR === r && selected.uiC === c) {
              movingImg.style.filter = 'drop-shadow(0 0 15px rgba(255, 200, 0, 0.9))';
            }
          }
        }
        if (capturedPiece) {
          capturedImg = makePieceGlyph(capturedPiece, squareSize, identityMap);
          if (capturedImg) {
            capturedImg.style.position = 'absolute';
            capturedImg.style.left = '50%';
            capturedImg.style.top = '50%';
            capturedImg.style.transformOrigin = '100% 100%';
            // Tilt the captured piece 30° clockwise and drop it slightly for depth
            capturedImg.style.transform = 'translate(-50%, -30%) rotate(30deg)';
          }
        }
        if (movingImg && capturedImg) {
          if (capturedPiece.color === myColorIdx) {
            capturedImg.style.zIndex = '2';
            movingImg.style.zIndex = '1';
          } else {
            movingImg.style.zIndex = '2';
            capturedImg.style.zIndex = '1';
          }
        }
        if (capturedImg) cell.appendChild(capturedImg);
        if (movingImg) cell.appendChild(movingImg);
      }

      // Attach setup interactions and expose bottom cells for hit-testing
      if (isInSetup && isUiBottom && onAttachHandlers) {
        onAttachHandlers(cell, { type: 'board', index: c });
        if (Array.isArray(refs.bottomCells)) refs.bottomCells[c] = { el: cell, col: c };
      }
      // Attach in-game handlers for all cells when not in setup
      if (!isInSetup && onAttachGameHandlers) {
        onAttachGameHandlers(cell, r, c);
        if (refs.boardCells) refs.boardCells[r][c] = { el: cell, uiR: r, uiC: c };
      }

      container.appendChild(cell);
    }
  }

}
