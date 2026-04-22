const TOOLTIP_ATTRIBUTE = 'data-cg-tooltip';
const TOOLTIP_PLACEMENT_ATTRIBUTE = 'data-cg-tooltip-placement';
const TOOLTIP_ID = 'cgGlobalTooltip';
const VIEWPORT_MARGIN_PX = 12;
const TOOLTIP_OFFSET_PX = 12;

const tooltipState = {
  activeTrigger: null,
  enabled: true,
  initialized: false,
  tooltipEl: null,
};

function getDocumentRef() {
  return document;
}

function getWindowRef() {
  return window;
}

function getTooltipElement() {
  const doc = getDocumentRef();
  if (tooltipState.tooltipEl && tooltipState.tooltipEl.isConnected) {
    return tooltipState.tooltipEl;
  }

  let tooltipEl = doc.getElementById(TOOLTIP_ID);
  if (!tooltipEl) {
    tooltipEl = doc.createElement('div');
    tooltipEl.id = TOOLTIP_ID;
    tooltipEl.className = 'cg-tooltip';
    tooltipEl.setAttribute('role', 'tooltip');
    tooltipEl.setAttribute('aria-hidden', 'true');
    tooltipEl.hidden = true;
    doc.body.appendChild(tooltipEl);
  }

  tooltipState.tooltipEl = tooltipEl;
  return tooltipEl;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getClosestTooltipTrigger(target) {
  if (!target || typeof target.closest !== 'function') {
    return null;
  }
  return target.closest(`[${TOOLTIP_ATTRIBUTE}]`);
}

function readTooltipText(trigger) {
  if (!trigger || typeof trigger.getAttribute !== 'function') {
    return '';
  }
  return trigger.getAttribute(TOOLTIP_ATTRIBUTE) || '';
}

function hideTooltip() {
  const tooltipEl = getTooltipElement();
  tooltipState.activeTrigger = null;
  tooltipEl.hidden = true;
  tooltipEl.classList.remove('cg-tooltip--visible');
  tooltipEl.textContent = '';
  tooltipEl.style.left = '0px';
  tooltipEl.style.top = '0px';
  tooltipEl.setAttribute('aria-hidden', 'true');
}

function positionTooltip(trigger) {
  const tooltipEl = getTooltipElement();
  if (!trigger || tooltipEl.hidden) {
    return;
  }

  const win = getWindowRef();
  const rect = trigger.getBoundingClientRect();
  const placement = trigger.getAttribute(TOOLTIP_PLACEMENT_ATTRIBUTE) || 'auto';

  tooltipEl.style.left = '0px';
  tooltipEl.style.top = '0px';
  const tooltipRect = tooltipEl.getBoundingClientRect();

  let top = rect.top - tooltipRect.height - TOOLTIP_OFFSET_PX;
  const fallbackTop = rect.bottom + TOOLTIP_OFFSET_PX;
  if (placement === 'bottom' || (placement === 'auto' && top < VIEWPORT_MARGIN_PX)) {
    top = fallbackTop;
  }
  if (top + tooltipRect.height > win.innerHeight - VIEWPORT_MARGIN_PX) {
    top = Math.max(VIEWPORT_MARGIN_PX, rect.top - tooltipRect.height - TOOLTIP_OFFSET_PX);
  }

  const centeredLeft = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
  const left = clamp(
    centeredLeft,
    VIEWPORT_MARGIN_PX,
    Math.max(VIEWPORT_MARGIN_PX, win.innerWidth - tooltipRect.width - VIEWPORT_MARGIN_PX)
  );

  tooltipEl.style.left = `${Math.round(left)}px`;
  tooltipEl.style.top = `${Math.round(top)}px`;
}

function showTooltip(trigger) {
  if (!tooltipState.enabled) {
    hideTooltip();
    return;
  }

  const text = readTooltipText(trigger);
  if (!text) {
    hideTooltip();
    return;
  }

  const tooltipEl = getTooltipElement();
  tooltipState.activeTrigger = trigger;
  tooltipEl.textContent = text;
  tooltipEl.hidden = false;
  tooltipEl.classList.add('cg-tooltip--visible');
  tooltipEl.setAttribute('aria-hidden', 'false');
  positionTooltip(trigger);
}

function updateTooltipFromTarget(target) {
  const trigger = getClosestTooltipTrigger(target);
  if (!trigger) {
    hideTooltip();
    return;
  }
  if (tooltipState.activeTrigger === trigger && !getTooltipElement().hidden) {
    positionTooltip(trigger);
    return;
  }
  showTooltip(trigger);
}

function handlePointerOver(event) {
  updateTooltipFromTarget(event.target);
}

function handlePointerOut(event) {
  const nextTrigger = getClosestTooltipTrigger(event.relatedTarget);
  if (nextTrigger) {
    showTooltip(nextTrigger);
    return;
  }
  hideTooltip();
}

function handleFocusIn(event) {
  updateTooltipFromTarget(event.target);
}

function handleFocusOut(event) {
  const nextTrigger = getClosestTooltipTrigger(event.relatedTarget);
  if (nextTrigger) {
    showTooltip(nextTrigger);
    return;
  }
  hideTooltip();
}

function handleViewportChange() {
  if (!tooltipState.enabled || !tooltipState.activeTrigger) {
    hideTooltip();
    return;
  }
  if (!tooltipState.activeTrigger.isConnected) {
    hideTooltip();
    return;
  }
  positionTooltip(tooltipState.activeTrigger);
}

export function initTooltipSystem({ enabled = true } = {}) {
  tooltipState.enabled = Boolean(enabled);
  if (tooltipState.initialized) {
    if (!tooltipState.enabled) {
      hideTooltip();
    }
    return {
      setEnabled: setTooltipsEnabled,
      hide: hideTooltip,
    };
  }

  const doc = getDocumentRef();
  const win = getWindowRef();
  getTooltipElement();

  doc.addEventListener('pointerover', handlePointerOver, true);
  doc.addEventListener('pointerout', handlePointerOut, true);
  doc.addEventListener('focusin', handleFocusIn, true);
  doc.addEventListener('focusout', handleFocusOut, true);
  doc.addEventListener('pointerdown', hideTooltip, true);
  win.addEventListener('resize', handleViewportChange);
  win.addEventListener('scroll', handleViewportChange, true);

  tooltipState.initialized = true;
  if (!tooltipState.enabled) {
    hideTooltip();
  }

  return {
    setEnabled: setTooltipsEnabled,
    hide: hideTooltip,
  };
}

export function setTooltipsEnabled(enabled) {
  tooltipState.enabled = Boolean(enabled);
  if (!tooltipState.enabled) {
    hideTooltip();
  }
}

export function getTooltipsEnabled() {
  return tooltipState.enabled;
}

export function applyTooltipAttributes(element, text, options = {}) {
  if (!element || typeof element.setAttribute !== 'function') {
    return element;
  }
  if (!text) {
    clearTooltipAttributes(element);
    return element;
  }

  element.setAttribute(TOOLTIP_ATTRIBUTE, text);
  element.setAttribute('aria-describedby', TOOLTIP_ID);
  const placement = typeof options.placement === 'string' ? options.placement.trim() : '';
  if (placement) {
    element.setAttribute(TOOLTIP_PLACEMENT_ATTRIBUTE, placement);
  } else {
    element.removeAttribute(TOOLTIP_PLACEMENT_ATTRIBUTE);
  }
  return element;
}

export function clearTooltipAttributes(element) {
  if (!element || typeof element.removeAttribute !== 'function') {
    return element;
  }
  element.removeAttribute(TOOLTIP_ATTRIBUTE);
  element.removeAttribute(TOOLTIP_PLACEMENT_ATTRIBUTE);
  if (element.getAttribute('aria-describedby') === TOOLTIP_ID) {
    element.removeAttribute('aria-describedby');
  }
  if (tooltipState.activeTrigger === element) {
    hideTooltip();
  }
  return element;
}
