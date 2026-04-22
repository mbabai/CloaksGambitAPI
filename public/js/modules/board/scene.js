import { ASSET_MANIFEST } from '/js/shared/assetManifest.js';
import { serverCoordsForCell } from '../render/notation.js';

function getCellPiece({
  uiRow,
  uiCol,
  rows,
  cols,
  currentBoard,
  currentIsWhite,
  isInSetup,
  workingRank,
}) {
  const isUiBottom = uiRow === rows - 1;
  if (isInSetup && isUiBottom) {
    return (workingRank && workingRank[uiCol]) || null;
  }
  if (!currentBoard) {
    return null;
  }
  const srcR = currentIsWhite ? (rows - 1 - uiRow) : uiRow;
  const srcC = currentIsWhite ? uiCol : (cols - 1 - uiCol);
  return currentBoard?.[srcR]?.[srcC] || null;
}

function toHighlightKey(uiR, uiC) {
  return `${uiR}:${uiC}`;
}

export function buildBoardScene({
  sizes,
  state,
  fileLetters = ['A', 'B', 'C', 'D', 'E'],
  labelFont = 12,
  options = {},
} = {}) {
  const { rows, cols, squareSize, boardLeft, boardTop } = sizes || {};
  const {
    currentBoard,
    currentIsWhite,
    selected,
    isInSetup,
    workingRank,
    pendingCapture,
    pendingMoveFrom,
    challengeRemoved,
    draggingOrigin,
    highlightedSourceCells,
  } = state || {};
  const {
    showDeploymentLines = true,
    pieceTransform = null,
  } = options;

  const transformPiece = typeof pieceTransform === 'function'
    ? pieceTransform
    : (piece) => piece;

  const boardTextureSrc = (ASSET_MANIFEST?.textures && ASSET_MANIFEST.textures.boardMarble)
    || '/assets/images/MarbleTexture.svg';
  const legalSourceKeys = new Set(
    Array.isArray(highlightedSourceCells)
      ? highlightedSourceCells
          .filter((cell) => Number.isInteger(cell?.uiR) && Number.isInteger(cell?.uiC))
          .map((cell) => toHighlightKey(cell.uiR, cell.uiC))
      : [],
  );

  const cells = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const light = currentIsWhite ? ((r + c) % 2 === 1) : ((r + c) % 2 === 0);
      const { serverRow, serverCol } = serverCoordsForCell(r, c, rows, cols, currentIsWhite);
      const isPendingCaptureSquare = pendingCapture
        && pendingCapture.row === serverRow
        && pendingCapture.col === serverCol;
      const basePiece = getCellPiece({
        uiRow: r,
        uiCol: c,
        rows,
        cols,
        currentBoard,
        currentIsWhite,
        isInSetup,
        workingRank,
      });
      const isDraggedBoardOrigin = Boolean(
        draggingOrigin
        && (
          (draggingOrigin.type === 'boardAny' && draggingOrigin.uiR === r && draggingOrigin.uiC === c)
          || (draggingOrigin.type === 'board' && isInSetup && r === rows - 1 && draggingOrigin.index === c)
        )
      );
      cells.push({
        uiRow: r,
        uiCol: c,
        x: c * squareSize,
        y: r * squareSize,
        width: squareSize,
        height: squareSize,
        centerX: (c + 0.5) * squareSize,
        centerY: (r + 0.5) * squareSize,
        serverRow,
        serverCol,
        light,
        piece: transformPiece(basePiece, {
          uiRow: r,
          uiCol: c,
          serverRow,
          serverCol,
          state,
          isCaptured: false,
        }),
        pieceOpacity: isDraggedBoardOrigin ? 0.45 : 1,
        capturedPiece: isPendingCaptureSquare
          ? transformPiece(pendingCapture.piece, {
              uiRow: r,
              uiCol: c,
              serverRow,
              serverCol,
              state,
              isCaptured: true,
            })
          : null,
        fileLabel: r === rows - 1
          ? ((fileLetters && fileLetters[currentIsWhite ? c : (cols - 1 - c)]) || '')
          : '',
        rankLabel: c === 0
          ? String(currentIsWhite ? (rows - r) : (r + 1))
          : '',
        highlight: pendingMoveFrom && pendingMoveFrom.row === serverRow && pendingMoveFrom.col === serverCol
          ? 'pending-move'
          : (challengeRemoved && challengeRemoved.row === serverRow && challengeRemoved.col === serverCol
            ? 'challenge-removed'
            : null),
        selectedBottomPiece: Boolean(selected && selected.type === 'board' && selected.index === c && r === rows - 1),
        selectedBoardCell: Boolean(selected && selected.type === 'boardAny' && selected.uiR === r && selected.uiC === c),
        isBottomSetupCell: Boolean(isInSetup && r === rows - 1),
        legalSourceHighlight: legalSourceKeys.has(toHighlightKey(r, c)),
      });
    }
  }

  const deploymentLines = showDeploymentLines
    ? [
        { key: 'top', top: squareSize - 2 },
        { key: 'bottom', top: (squareSize * (rows - 1)) - 2 },
      ]
    : [];

  return {
    boardTextureSrc,
    width: squareSize * cols,
    height: squareSize * rows,
    left: boardLeft,
    top: boardTop,
    rows,
    cols,
    squareSize,
    labelFont,
    cells,
    deploymentLines,
    isInSetup: Boolean(isInSetup),
  };
}
