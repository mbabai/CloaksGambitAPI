import { renderBoard } from '../render/board.js';

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
} = {}) {
  if (!container) {
    throw new Error('createBoardView requires a container element');
  }

  let lastState = {};
  let lastSizes = null;
  let lastFileLetters = defaultFileLetters;
  let lastLabelFont = defaultLabelFont;
  let showDeploymentLines = defaultShowDeploymentLines;
  let disableInteractions = false;
  let attachHandlers = null;
  let attachGameHandlers = null;

  function updateInteractivity() {
    if (disableInteractions) {
      container.style.pointerEvents = 'none';
      container.setAttribute('aria-disabled', 'true');
    } else {
      container.style.pointerEvents = 'auto';
      container.removeAttribute('aria-disabled');
    }
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
  } = {}) {
    lastState = { ...lastState, ...state };
    if (sizes) {
      lastSizes = sizes;
    }
    lastFileLetters = fileLetters;
    lastLabelFont = labelFont;
    showDeploymentLines = deploymentLines;
    disableInteractions = readOnly;
    updateInteractivity();
    attachHandlers = onAttachHandlers || null;
    attachGameHandlers = onAttachGameHandlers || null;

    if (!lastSizes) return;

    const shouldAttachGameHandlers = disableInteractions ? alwaysAttachGameRefs : true;

    renderBoard({
      container,
      sizes: lastSizes,
      state: lastState,
      refs,
      identityMap,
      onAttachHandlers: disableInteractions ? null : attachHandlers,
      onAttachGameHandlers: shouldAttachGameHandlers ? attachGameHandlers : null,
      labelFont: lastLabelFont,
      fileLetters: lastFileLetters,
      options: {
        showDeploymentLines,
      },
    });
  }

  function setReadOnly(value = true) {
    disableInteractions = Boolean(value);
    updateInteractivity();
  }

  function getState() {
    return { ...lastState };
  }

  function getSizes() {
    return lastSizes ? { ...lastSizes } : null;
  }

  function destroy() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  return {
    render,
    setReadOnly,
    getState,
    getSizes,
    destroy,
  };
}
