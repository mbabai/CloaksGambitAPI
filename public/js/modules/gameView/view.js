import { createBoardView } from '../components/boardView.js';
import { renderBars } from '../render/bars.js';
import { createPieceVisibilityTransform, normalizeGameViewMode } from './modes.js';

function ensureSurfaceElement(existing, className) {
  const element = existing || document.createElement('div');
  element.classList.add(className);
  element.style.position = 'absolute';
  return element;
}

export function createGameView({
  container,
  boardEl = null,
  topBarEl = null,
  bottomBarEl = null,
  identityMap,
  refs = {},
  annotationsEnabled = false,
  alwaysAttachGameRefs = false,
} = {}) {
  if (!container) {
    throw new Error('createGameView requires a container');
  }

  const elements = {
    topBar: ensureSurfaceElement(topBarEl, 'cg-game-view__top-bar'),
    board: ensureSurfaceElement(boardEl, 'cg-game-view__board'),
    bottomBar: ensureSurfaceElement(bottomBarEl, 'cg-game-view__bottom-bar'),
  };

  elements.topBar.style.zIndex = '2';
  elements.board.style.zIndex = '1';
  elements.bottomBar.style.zIndex = '2';

  if (!elements.topBar.parentNode) {
    container.appendChild(elements.topBar);
  }
  if (!elements.board.parentNode) {
    container.appendChild(elements.board);
  }
  if (!elements.bottomBar.parentNode) {
    container.appendChild(elements.bottomBar);
  }

  const boardView = createBoardView({
    container: elements.board,
    identityMap,
    refs,
    alwaysAttachGameRefs,
    annotationsEnabled,
  });

  function render({
    sizes,
    boardState = {},
    barsState = null,
    viewMode = 'player',
    viewerColor = null,
    fileLetters,
    labelFont,
    readOnly = false,
    deploymentLines = true,
    onAttachHandlers,
    onAttachGameHandlers,
    onNameClick,
    shouldAllowPlayerClick,
  } = {}) {
    if (!sizes) return;

    const normalizedMode = normalizeGameViewMode(viewMode);
    const pieceTransform = createPieceVisibilityTransform({
      mode: normalizedMode,
      viewerColor,
    });

    boardView.render({
      sizes,
      state: { ...boardState, viewerColor },
      fileLetters,
      labelFont,
      onAttachHandlers,
      onAttachGameHandlers,
      readOnly,
      deploymentLines,
      pieceTransform,
    });

    if (!barsState) {
      elements.topBar.innerHTML = '';
      elements.bottomBar.innerHTML = '';
      return null;
    }

    return renderBars({
      topBar: elements.topBar,
      bottomBar: elements.bottomBar,
      sizes: {
        squareSize: sizes.squareSize,
        boardWidth: sizes.squareSize * sizes.cols,
        boardHeight: sizes.squareSize * sizes.rows,
        boardLeft: sizes.boardLeft,
        boardTop: sizes.boardTop,
        playAreaHeight: container.clientHeight,
      },
      state: barsState,
      identityMap,
      onNameClick,
      shouldAllowPlayerClick,
    });
  }

  function destroy() {
    boardView.destroy();
    elements.topBar.innerHTML = '';
    elements.bottomBar.innerHTML = '';
  }

  return {
    elements,
    boardView,
    render,
    setBubbleOverlays: (overlays) => boardView.setBubbleOverlays(overlays),
    clearBubbleOverlays: () => boardView.clearBubbleOverlays(),
    hitTestBoard: (clientX, clientY) => boardView.hitTestBoard(clientX, clientY),
    getCellClientRect: (uiR, uiC) => boardView.getCellClientRect(uiR, uiC),
    getBoardClientRect: () => boardView.getBoardClientRect(),
    setBoardTransientState: (patch) => boardView.setTransientState(patch),
    clearBoardTransientState: (keys) => boardView.clearTransientState(keys),
    destroy,
  };
}
