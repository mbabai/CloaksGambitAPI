import { KING_ID } from '../constants.js';
import {
  Declaration,
  isPathClear,
  isWithinPieceRange,
  uiToServerCoords,
} from './moveRules.js';

const MOVE_DECLARATIONS = [
  Declaration.KNIGHT,
  Declaration.KING,
  Declaration.BISHOP,
  Declaration.ROOK,
];
const TRUE_IDENTITY_MOVE_OPACITY = 0.7;
const BLUFF_MOVE_OPACITY = 0.15;

function isPlayerColor(value) {
  return value === 0 || value === 1;
}

function isMoveDeclaration(value) {
  return MOVE_DECLARATIONS.includes(value);
}

function collectIndexes(items, predicate) {
  if (!Array.isArray(items)) return [];
  const matches = [];
  items.forEach((item, index) => {
    if (predicate(item, index)) {
      matches.push(index);
    }
  });
  return matches;
}

function getBoardPieceAtUI({ currentBoard, currentIsWhite, rows, cols, uiR, uiC }) {
  const { serverRow, serverCol } = uiToServerCoords(uiR, uiC, rows, cols, currentIsWhite);
  return {
    piece: currentBoard?.[serverRow]?.[serverCol] || null,
    serverRow,
    serverCol,
  };
}

function getLegalDeclarationsForDestination({
  currentBoard,
  from,
  to,
}) {
  const legal = [];
  for (const declaration of MOVE_DECLARATIONS) {
    if (!isWithinPieceRange(from, to, declaration)) {
      continue;
    }
    if (!isPathClear(currentBoard, from, to, declaration)) {
      continue;
    }
    legal.push(declaration);
  }
  return legal;
}

function pieceHasLegalDestination({
  currentBoard,
  currentIsWhite,
  rows,
  cols,
  playerColor,
  originUI,
  originServer,
}) {
  for (let destUiR = 0; destUiR < rows; destUiR += 1) {
    for (let destUiC = 0; destUiC < cols; destUiC += 1) {
      if (destUiR === originUI.uiR && destUiC === originUI.uiC) {
        continue;
      }
      const { serverRow, serverCol } = uiToServerCoords(
        destUiR,
        destUiC,
        rows,
        cols,
        currentIsWhite,
      );
      const target = currentBoard?.[serverRow]?.[serverCol] || null;
      if (target && target.color === playerColor) {
        continue;
      }
      const from = { row: originServer.row, col: originServer.col };
      const to = { row: serverRow, col: serverCol };
      if (getLegalDeclarationsForDestination({
        currentBoard,
        from,
        to,
      }).length > 0) {
        return true;
      }
    }
  }
  return false;
}

export function canPieceBePlacedOnDeck(piece) {
  return Boolean(piece && piece.identity !== KING_ID);
}

export function getDeckDestinationHighlight({
  origin = null,
  piece = null,
  deckPiece = null,
} = {}) {
  if (
    !origin
    || origin.type === 'deck'
    || !piece
    || !canPieceBePlacedOnDeck(piece)
  ) {
    return null;
  }

  return {
    targetType: 'deck',
    isCapture: Boolean(deckPiece),
    matchesTrueIdentity: true,
    opacity: TRUE_IDENTITY_MOVE_OPACITY,
  };
}

export function getLegalBoardDestinationCells({
  currentBoard,
  currentIsWhite = true,
  rows = 0,
  cols = 0,
  originUI = null,
  piece = null,
} = {}) {
  if (
    !Array.isArray(currentBoard)
    || !Number.isInteger(originUI?.uiR)
    || !Number.isInteger(originUI?.uiC)
    || rows <= 0
    || cols <= 0
  ) {
    return [];
  }

  const originState = getBoardPieceAtUI({
    currentBoard,
    currentIsWhite,
    rows,
    cols,
    uiR: originUI.uiR,
    uiC: originUI.uiC,
  });
  const movingPiece = piece || originState.piece;
  if (!movingPiece) {
    return [];
  }

  const from = { row: originState.serverRow, col: originState.serverCol };
  const trueIdentity = isMoveDeclaration(movingPiece.identity) ? movingPiece.identity : null;
  const destinations = [];

  for (let destUiR = 0; destUiR < rows; destUiR += 1) {
    for (let destUiC = 0; destUiC < cols; destUiC += 1) {
      if (destUiR === originUI.uiR && destUiC === originUI.uiC) {
        continue;
      }

      const { serverRow, serverCol } = uiToServerCoords(
        destUiR,
        destUiC,
        rows,
        cols,
        currentIsWhite,
      );
      const target = currentBoard?.[serverRow]?.[serverCol] || null;
      if (target && target.color === movingPiece.color) {
        continue;
      }

      const to = { row: serverRow, col: serverCol };
      const legalDeclarations = getLegalDeclarationsForDestination({
        currentBoard,
        from,
        to,
      });
      if (!legalDeclarations.length) {
        continue;
      }

      const matchesTrueIdentity = trueIdentity !== null && legalDeclarations.includes(trueIdentity);
      destinations.push({
        uiR: destUiR,
        uiC: destUiC,
        isCapture: Boolean(target),
        matchesTrueIdentity,
        opacity: matchesTrueIdentity ? TRUE_IDENTITY_MOVE_OPACITY : BLUFF_MOVE_OPACITY,
      });
    }
  }

  return destinations;
}

export function resolveActiveTurnColor({
  currentPlayerTurn = null,
  currentOnDeckingPlayer = null,
  isInSetup = false,
  gameFinished = false,
} = {}) {
  if (gameFinished) return null;
  if (isPlayerColor(currentOnDeckingPlayer)) {
    return currentOnDeckingPlayer;
  }
  if (isInSetup) {
    return null;
  }
  return isPlayerColor(currentPlayerTurn) ? currentPlayerTurn : null;
}

export function getSetupLegalSources({
  workingRank = [],
  workingStash = [],
  workingOnDeck = null,
  isSetupCompletable = false,
} = {}) {
  if (isSetupCompletable) {
    return {
      stashIndexes: [],
      highlightDeck: false,
    };
  }

  const boardIsFull = Array.isArray(workingRank) && workingRank.length > 0 && workingRank.every(Boolean);
  const boardHasKing = Array.isArray(workingRank) && workingRank.some((piece) => piece?.identity === KING_ID);

  if (boardIsFull && !boardHasKing) {
    return {
      stashIndexes: collectIndexes(workingStash, (piece) => piece?.identity === KING_ID),
      highlightDeck: workingOnDeck?.identity === KING_ID,
    };
  }

  return {
    stashIndexes: collectIndexes(workingStash, (piece) => Boolean(piece)),
    highlightDeck: false,
  };
}

export function getOnDeckLegalSources({ stash = [] } = {}) {
  return {
    stashIndexes: collectIndexes(stash, canPieceBePlacedOnDeck),
    highlightDeck: false,
  };
}

export function getSetupBoardDestinationIndexes({
  workingRank = [],
  origin = null,
} = {}) {
  if (
    !Array.isArray(workingRank)
    || !workingRank.length
    || !origin
    || (origin.type !== 'board' && origin.type !== 'stash' && origin.type !== 'deck')
  ) {
    return [];
  }

  const destinations = [];
  for (let index = 0; index < workingRank.length; index += 1) {
    if (origin.type === 'board' && origin.index === index) {
      continue;
    }
    destinations.push({
      index,
      isCapture: Boolean(workingRank[index]),
      matchesTrueIdentity: true,
      opacity: TRUE_IDENTITY_MOVE_OPACITY,
    });
  }
  return destinations;
}

export function getLegalBoardSourceCells({
  currentBoard,
  currentIsWhite = true,
  playerColor = null,
  rows = 0,
  cols = 0,
} = {}) {
  if (!Array.isArray(currentBoard) || !isPlayerColor(playerColor) || rows <= 0 || cols <= 0) {
    return [];
  }

  const sources = [];
  for (let uiR = 0; uiR < rows; uiR += 1) {
    for (let uiC = 0; uiC < cols; uiC += 1) {
      const { piece, serverRow, serverCol } = getBoardPieceAtUI({
        currentBoard,
        currentIsWhite,
        rows,
        cols,
        uiR,
        uiC,
      });
      if (!piece || piece.color !== playerColor) {
        continue;
      }
      if (pieceHasLegalDestination({
        currentBoard,
        currentIsWhite,
        rows,
        cols,
        playerColor,
        originUI: { uiR, uiC },
        originServer: { row: serverRow, col: serverCol },
      })) {
        sources.push({ uiR, uiC });
      }
    }
  }

  return sources;
}
