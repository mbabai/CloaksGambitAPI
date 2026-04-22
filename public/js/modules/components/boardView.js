import { renderBoard } from '../render/board.js';
import { setCellNotation } from '../render/notation.js';
import { buildBoardScene } from '../board/scene.js';
import { createBoardAnnotations } from './boardAnnotations.js';
import { createImageCache } from '../render/imageCache.js';
import { getBubbleAsset } from '../ui/icons.js';
import { getThoughtBubbleTooltipText } from '../ui/tooltipContent.js';
import { applyTooltipAttributes } from '../ui/tooltips.js';

function createBoardLayer(className) {
  const element = document.createElement('div');
  element.className = className;
  element.style.position = 'absolute';
  element.style.left = '0';
  element.style.top = '0';
  element.style.width = '100%';
  element.style.height = '100%';
  element.style.overflow = 'visible';
  return element;
}

function clearChildren(element) {
  if (!element) return;
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createBubbleNode({ type, squareSize, interactive, onBubbleClick, uiR, uiC }) {
  const src = getBubbleAsset(type);
  if (!src) return null;

  const img = document.createElement('img');
  img.dataset.bubble = '1';
  img.dataset.bubbleType = type;
  img.draggable = false;
  img.alt = '';
  img.src = src;
  img.className = 'cg-board-bubble';
  img.style.position = 'absolute';
  img.style.zIndex = '1001';
  img.style.width = `${Math.floor(squareSize * 1.08)}px`;
  img.style.height = 'auto';
  img.style.pointerEvents = interactive ? 'auto' : 'none';
  const tooltipText = getThoughtBubbleTooltipText(type);
  if (tooltipText) {
    applyTooltipAttributes(img, tooltipText);
  }
  if (interactive) {
    img.style.cursor = 'pointer';
    img.addEventListener('click', (event) => {
      try {
        event.preventDefault();
        event.stopPropagation();
      } catch (_) {}
      if (typeof onBubbleClick === 'function') {
        onBubbleClick({ type, uiR, uiC, event });
      }
    });
  }
  return img;
}

/**
 * Factory that wraps the low-level board renderer with a simple stateful API so
 * different surfaces (main game client, admin tools, spectate modals, etc.) can
 * share the same rendering logic without duplicating layout code.
 */
export function createBoardView({
  container,
  identityMap,
  refs = {},
  defaultFileLetters = ['A', 'B', 'C', 'D', 'E'],
  defaultLabelFont = 12,
  defaultShowDeploymentLines = true,
  alwaysAttachGameRefs = false,
  annotationsEnabled = false,
} = {}) {
  if (!container) {
    throw new Error('createBoardView requires a container element');
  }

  let canvas = null;
  let hitLayer = null;
  let bubbleLayer = null;
  let lastState = {};
  let lastSizes = null;
  let lastScene = null;
  let transientState = {};
  let lastFileLetters = defaultFileLetters;
  let lastLabelFont = defaultLabelFont;
  let showDeploymentLines = defaultShowDeploymentLines;
  let disableInteractions = false;
  let attachHandlers = null;
  let attachGameHandlers = null;
  let pieceTransform = null;
  let bubbleOverlays = [];

  const annotationController = createBoardAnnotations({
    container,
    enabled: annotationsEnabled,
  });

  const imageCache = createImageCache({
    onChange: () => {
      if (!lastScene || !canvas) return;
      renderBoard({
        canvas,
        scene: lastScene,
        identityMap,
        imageCache,
        scope: container,
      });
    },
  });

  function ensureLayers() {
    container.classList.add('cg-board-surface');
    container.style.overflow = 'visible';

    if (!canvas || canvas.parentNode !== container) {
      clearChildren(container);
      canvas = document.createElement('canvas');
      canvas.className = 'cg-board-surface__canvas';
      canvas.style.position = 'absolute';
      canvas.style.left = '0';
      canvas.style.top = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';

      hitLayer = createBoardLayer('cg-board-surface__hit-layer');
      bubbleLayer = createBoardLayer('cg-board-surface__bubble-layer');
      bubbleLayer.style.pointerEvents = 'none';

      container.appendChild(canvas);
      container.appendChild(hitLayer);
      container.appendChild(bubbleLayer);
    }
  }

  function updateInteractivity() {
    ensureLayers();
    if (disableInteractions) {
      hitLayer.style.pointerEvents = 'none';
      container.setAttribute('aria-disabled', 'true');
    } else {
      hitLayer.style.pointerEvents = 'auto';
      container.removeAttribute('aria-disabled');
    }
    annotationController.setEnabled(annotationsEnabled);
  }

  function syncContainer(scene) {
    if (!scene) return;
    container.style.left = `${scene.left}px`;
    container.style.top = `${scene.top}px`;
    container.style.width = `${scene.width}px`;
    container.style.height = `${scene.height}px`;
  }

  function buildScene() {
    if (!lastSizes) return null;
    return buildBoardScene({
      sizes: lastSizes,
      state: { ...lastState, ...transientState },
      fileLetters: lastFileLetters,
      labelFont: lastLabelFont,
      options: {
        showDeploymentLines,
        pieceTransform,
      },
    });
  }

  function populateHitLayer(scene) {
    clearChildren(hitLayer);
    refs.bottomCells = [];

    const shouldExposeBoardCells = Boolean(alwaysAttachGameRefs || attachGameHandlers || !scene.isInSetup);
    if (shouldExposeBoardCells) {
      refs.boardCells = Array.from({ length: scene.rows }, () => Array.from({ length: scene.cols }, () => null));
    } else {
      refs.boardCells = [];
    }

    scene.cells.forEach((cellModel) => {
      const hitCell = document.createElement('button');
      hitCell.type = 'button';
      hitCell.className = 'cg-board-hit-cell';
      hitCell.dataset.boardCell = '1';
      hitCell.dataset.uiRow = String(cellModel.uiRow);
      hitCell.dataset.uiCol = String(cellModel.uiCol);
      setCellNotation(hitCell, cellModel.serverRow, cellModel.serverCol);
      hitCell.style.position = 'absolute';
      hitCell.style.left = `${cellModel.x}px`;
      hitCell.style.top = `${cellModel.y}px`;
      hitCell.style.width = `${cellModel.width}px`;
      hitCell.style.height = `${cellModel.height}px`;
      hitCell.style.padding = '0';
      hitCell.style.margin = '0';
      hitCell.style.border = '0';
      hitCell.style.background = 'transparent';
      hitCell.style.touchAction = 'none';
      if (cellModel.legalSourceHighlight) {
        hitCell.classList.add('cg-piece-source-highlight');
      }

      if (cellModel.isBottomSetupCell && typeof attachHandlers === 'function') {
        attachHandlers(hitCell, { type: 'board', index: cellModel.uiCol });
        refs.bottomCells[cellModel.uiCol] = { el: hitCell, col: cellModel.uiCol };
      }

      if (!scene.isInSetup && shouldExposeBoardCells) {
        refs.boardCells[cellModel.uiRow][cellModel.uiCol] = {
          el: hitCell,
          uiR: cellModel.uiRow,
          uiC: cellModel.uiCol,
        };
      }

      if (!scene.isInSetup && typeof attachGameHandlers === 'function') {
        attachGameHandlers(hitCell, cellModel.uiRow, cellModel.uiCol);
      }

      hitLayer.appendChild(hitCell);
    });
  }

  function findCell(uiR, uiC) {
    if (!lastScene || !Array.isArray(lastScene.cells)) return null;
    return lastScene.cells.find((cell) => cell.uiRow === uiR && cell.uiCol === uiC) || null;
  }

  function renderBubbleOverlays() {
    ensureLayers();
    clearChildren(bubbleLayer);
    refs.activeBubbles = [];
    if (!lastScene || !Array.isArray(bubbleOverlays) || !bubbleOverlays.length) {
      return;
    }

    bubbleOverlays.forEach((overlay) => {
      if (!overlay) return;
      const cell = findCell(overlay.uiR, overlay.uiC);
      if (!cell) return;
      const types = Array.isArray(overlay.types) ? overlay.types : [];
      types.forEach((type) => {
        const node = createBubbleNode({
          type,
          squareSize: lastScene.squareSize,
          interactive: Boolean(overlay.interactive),
          onBubbleClick: overlay.onBubbleClick,
          uiR: overlay.uiR,
          uiC: overlay.uiC,
        });
        if (!node) return;

        const width = Math.floor(lastScene.squareSize * 1.08);
        const offsetX = Math.floor(lastScene.squareSize * 0.6);
        const offsetY = Math.floor(lastScene.squareSize * 0.5);
        node.style.left = type.endsWith('Right')
          ? `${cell.x + cell.width - width + offsetX}px`
          : `${cell.x - offsetX}px`;
        node.style.top = `${cell.y - offsetY}px`;
        bubbleLayer.appendChild(node);
        refs.activeBubbles.push(node);
      });
    });
  }

  function renderSurface() {
    lastScene = buildScene();
    if (!lastScene) return;
    ensureLayers();
    syncContainer(lastScene);
    renderBoard({
      canvas,
      scene: lastScene,
      identityMap,
      imageCache,
      scope: container,
    });
    populateHitLayer(lastScene);
    renderBubbleOverlays();
    annotationController.sync({
      rows: lastScene.rows,
      cols: lastScene.cols,
      squareSize: lastScene.squareSize,
    });
  }

  updateInteractivity();

  function render({
    state = {},
    sizes,
    fileLetters = lastFileLetters,
    labelFont = lastLabelFont,
    onAttachHandlers = attachHandlers,
    onAttachGameHandlers = attachGameHandlers,
    readOnly = disableInteractions,
    deploymentLines = showDeploymentLines,
    pieceTransform: nextPieceTransform = pieceTransform,
  } = {}) {
    lastState = { ...lastState, ...state };
    if (sizes) {
      lastSizes = sizes;
    }
    lastFileLetters = fileLetters;
    lastLabelFont = labelFont;
    showDeploymentLines = deploymentLines;
    disableInteractions = readOnly;
    attachHandlers = onAttachHandlers || null;
    attachGameHandlers = onAttachGameHandlers || null;
    pieceTransform = typeof nextPieceTransform === 'function' ? nextPieceTransform : null;
    updateInteractivity();
    renderSurface();
  }

  function setReadOnly(value = true) {
    disableInteractions = Boolean(value);
    updateInteractivity();
  }

  function getState() {
    return { ...lastState, ...transientState };
  }

  function getSizes() {
    return lastSizes ? { ...lastSizes } : null;
  }

  function getScene() {
    return lastScene;
  }

  function hitTestBoard(clientX, clientY) {
    if (!lastScene) return null;
    const bounds = container.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    if (
      !Number.isFinite(localX)
      || !Number.isFinite(localY)
      || localX < 0
      || localY < 0
      || localX > bounds.width
      || localY > bounds.height
    ) {
      return null;
    }
    const uiC = Math.min(lastScene.cols - 1, Math.max(0, Math.floor(localX / lastScene.squareSize)));
    const uiR = Math.min(lastScene.rows - 1, Math.max(0, Math.floor(localY / lastScene.squareSize)));
    return { uiR, uiC };
  }

  function getCellClientRect(uiR, uiC) {
    const cell = findCell(uiR, uiC);
    if (!cell) return null;
    const bounds = container.getBoundingClientRect();
    return {
      left: bounds.left + cell.x,
      top: bounds.top + cell.y,
      right: bounds.left + cell.x + cell.width,
      bottom: bounds.top + cell.y + cell.height,
      width: cell.width,
      height: cell.height,
      x: bounds.left + cell.x,
      y: bounds.top + cell.y,
    };
  }

  function getBoardClientRect() {
    return container.getBoundingClientRect();
  }

  function setBubbleOverlays(nextOverlays = []) {
    bubbleOverlays = Array.isArray(nextOverlays) ? nextOverlays.filter(Boolean) : [];
    renderBubbleOverlays();
  }

  function clearBubbleOverlays() {
    bubbleOverlays = [];
    renderBubbleOverlays();
  }

  function setTransientState(patch = {}) {
    transientState = { ...transientState, ...patch };
    renderSurface();
  }

  function clearTransientState(keys) {
    if (!transientState || !Object.keys(transientState).length) return;
    if (Array.isArray(keys) && keys.length) {
      const next = { ...transientState };
      keys.forEach((key) => {
        delete next[key];
      });
      transientState = next;
    } else {
      transientState = {};
    }
    renderSurface();
  }

  function destroy() {
    lastState = {};
    lastSizes = null;
    lastScene = null;
    transientState = {};
    bubbleOverlays = [];
    clearChildren(hitLayer);
    clearChildren(bubbleLayer);
    if (canvas) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      canvas.width = 1;
      canvas.height = 1;
      canvas.style.width = '0px';
      canvas.style.height = '0px';
    }
    annotationController.clear();
    refs.boardCells = [];
    refs.bottomCells = [];
    refs.activeBubbles = [];
  }

  return {
    render,
    setReadOnly,
    getState,
    getSizes,
    getScene,
    hitTestBoard,
    getCellClientRect,
    getBoardClientRect,
    setBubbleOverlays,
    clearBubbleOverlays,
    setTransientState,
    clearTransientState,
    destroy,
  };
}
