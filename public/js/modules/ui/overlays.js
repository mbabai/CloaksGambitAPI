const DEFAULT_FOCUSABLE_SELECTOR = [
  'a[href]','area[href]','button:not([disabled])','input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])','textarea:not([disabled])','[tabindex]:not([tabindex="-1"])'
].join(',');

function resolveDocument(documentRef) {
  if (documentRef && typeof documentRef.createElement === 'function') {
    return documentRef;
  }
  return document;
}

function toClassList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(toClassList).filter(Boolean);
  return String(value).trim().split(/\s+/).filter(Boolean);
}

function addClasses(node, classes) {
  if (!node || !classes || classes.length === 0) return;
  node.classList.add(...classes);
}

function removeClasses(node, classes) {
  if (!node || !classes || classes.length === 0) return;
  node.classList.remove(...classes);
}

function isElementVisible(el) {
  if (!el) return false;
  if (el.hidden) return false;
  const style = el.ownerDocument && el.ownerDocument.defaultView
    ? el.ownerDocument.defaultView.getComputedStyle(el)
    : window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  return true;
}

function resolveFocusTarget(target, { dialog, content, closeButton }) {
  if (!target) return null;
  if (typeof target === 'function') {
    try { return target({ dialog, content, closeButton }); } catch (_) { return null; }
  }
  if (typeof target === 'string') {
    try { return dialog.querySelector(target) || content.querySelector(target); } catch (_) { return null; }
  }
  return target;
}

export function createOverlay({
  documentRef,
  mount,
  baseClass = 'cg-overlay',
  openClass = 'cg-overlay--open',
  bodyOpenClass = 'cg-overlay-open',
  dialogClass = 'cg-overlay__dialog',
  contentClass = 'cg-overlay__content',
  backdropClass = 'cg-overlay__backdrop',
  closeButtonClass = 'cg-overlay__close',
  closeLabel = 'Close dialog',
  closeText = 'Close',
  showCloseButton = true,
  closeOnBackdrop = true,
  closeOnEscape = true,
  trapFocus = true,
  labelledBy = null,
  describedBy = null,
  ariaLabel = null,
  id = null,
  focusableSelector = DEFAULT_FOCUSABLE_SELECTOR,
  onShow,
  onHide,
  onCloseRequest,
} = {}) {
  const doc = resolveDocument(documentRef);
  const root = doc.createElement('div');
  if (id) root.id = id;
  addClasses(root, toClassList(baseClass));
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');

  const backdrop = doc.createElement('div');
  backdrop.className = backdropClass;
  root.appendChild(backdrop);

  const dialog = doc.createElement('div');
  dialog.className = dialogClass;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-hidden', 'true');
  if (ariaLabel) {
    dialog.setAttribute('aria-label', ariaLabel);
  } else if (labelledBy) {
    dialog.setAttribute('aria-labelledby', labelledBy);
  }
  if (describedBy) dialog.setAttribute('aria-describedby', describedBy);
  dialog.tabIndex = -1;

  const content = doc.createElement('div');
  content.className = contentClass;

  let closeButton = null;
  if (showCloseButton) {
    closeButton = doc.createElement('button');
    closeButton.type = 'button';
    closeButton.className = closeButtonClass;
    closeButton.textContent = closeText;
    closeButton.setAttribute('aria-label', closeLabel || closeText || 'Close');
  }

  let focusStart = null;
  let focusEnd = null;
  if (trapFocus) {
    focusStart = doc.createElement('div');
    focusStart.tabIndex = 0;
    focusStart.setAttribute('aria-hidden', 'true');
    focusStart.dataset.overlaySentinel = 'start';
    focusEnd = doc.createElement('div');
    focusEnd.tabIndex = 0;
    focusEnd.setAttribute('aria-hidden', 'true');
    focusEnd.dataset.overlaySentinel = 'end';
  }

  if (focusStart) dialog.appendChild(focusStart);
  if (closeButton) dialog.appendChild(closeButton);
  dialog.appendChild(content);
  if (focusEnd) dialog.appendChild(focusEnd);
  root.appendChild(dialog);

  const mountTarget = mount || doc.body || doc.documentElement || doc;
  if (mountTarget && typeof mountTarget.appendChild === 'function') {
    mountTarget.appendChild(root);
  }

  const openClasses = toClassList(openClass);
  const bodyOpenClasses = toClassList(bodyOpenClass);

  let isOpen = false;
  let lastFocusedElement = null;
  let lastShowOptions = null;

  function getFocusableElements() {
    const nodes = Array.from(dialog.querySelectorAll(focusableSelector));
    return nodes.filter(el => {
      if (el.dataset && el.dataset.overlaySentinel) return false;
      if (el.hasAttribute('disabled')) return false;
      if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
      if (el.tabIndex < 0) return false;
      return isElementVisible(el);
    });
  }

  function focusFirstAvailable(preferred) {
    const target = resolveFocusTarget(preferred, { dialog, content, closeButton })
      || (closeButton && !closeButton.hidden ? closeButton : null);
    const focusables = getFocusableElements();
    const fallback = focusables.length > 0 ? focusables[0] : dialog;
    const el = target && isElementVisible(target) ? target : fallback;
    if (el && typeof el.focus === 'function') {
      try { el.focus({ preventScroll: true }); } catch (_) { try { el.focus(); } catch (_) {} }
    }
  }

  function handleKeyDown(ev) {
    if (!isOpen) return;
    if (closeOnEscape && (ev.key === 'Escape' || ev.key === 'Esc')) {
      ev.preventDefault();
      requestClose({ reason: 'escape', event: ev });
      return;
    }
    if (trapFocus && ev.key === 'Tab') {
      const focusables = getFocusableElements();
      if (focusables.length === 0) {
        ev.preventDefault();
        dialog.focus();
        return;
      }
      const active = doc.activeElement;
      const currentIndex = focusables.indexOf(active);
      if (ev.shiftKey) {
        if (currentIndex <= 0) {
          ev.preventDefault();
          focusables[focusables.length - 1].focus();
        }
      } else if (currentIndex === focusables.length - 1) {
        ev.preventDefault();
        focusables[0].focus();
      }
    }
  }

  function handleSentinelFocus(ev) {
    if (!isOpen || !trapFocus) return;
    const focusables = getFocusableElements();
    if (focusables.length === 0) {
      dialog.focus();
      return;
    }
    if (ev.target === focusStart) {
      focusables[focusables.length - 1].focus();
    } else if (ev.target === focusEnd) {
      focusables[0].focus();
    }
  }

  function handleBackdropPointer(ev) {
    if (!isOpen || !closeOnBackdrop) return;
    if (!dialog.contains(ev.target)) {
      requestClose({ reason: 'backdrop', event: ev });
    }
  }

  function handleCloseClick(ev) {
    requestClose({ reason: 'close-button', event: ev });
  }

  function requestClose(context = {}) {
    if (typeof onCloseRequest === 'function') {
      const shouldClose = onCloseRequest({ ...context, overlay: api });
      if (shouldClose === false) return;
    }
    hide({ restoreFocus: true, reason: context.reason });
  }

  function show(options = {}) {
    if (isOpen) return;
    lastShowOptions = options || {};
    if (!ariaLabel && options.labelledBy) {
      dialog.setAttribute('aria-labelledby', options.labelledBy);
    }
    if (options.describedBy != null) {
      if (options.describedBy) dialog.setAttribute('aria-describedby', options.describedBy);
      else dialog.removeAttribute('aria-describedby');
    }
    if (options.ariaLabel) {
      dialog.setAttribute('aria-label', options.ariaLabel);
    }
    if (options.showCloseButton != null && closeButton) {
      closeButton.hidden = options.showCloseButton === false;
    }
    if (options.closeLabel && closeButton) {
      closeButton.setAttribute('aria-label', options.closeLabel);
    }
    if (options.closeText != null && closeButton) {
      closeButton.textContent = options.closeText;
    }

    lastFocusedElement = doc.activeElement && typeof doc.activeElement.focus === 'function'
      ? doc.activeElement
      : null;

    root.hidden = false;
    root.setAttribute('aria-hidden', 'false');
    dialog.setAttribute('aria-hidden', 'false');
    addClasses(root, openClasses);
    addClasses(doc.body, bodyOpenClasses);
    isOpen = true;
    if (typeof onShow === 'function') {
      try { onShow(api); } catch (_) {}
    }
    if (typeof options.onShow === 'function') {
      try { options.onShow(api); } catch (_) {}
    }

    setTimeout(() => {
      focusFirstAvailable(options.initialFocus);
    }, 0);
  }

  function hide({ restoreFocus = true, reason } = {}) {
    if (!isOpen) return;
    isOpen = false;
    removeClasses(root, openClasses);
    removeClasses(doc.body, bodyOpenClasses);
    root.setAttribute('aria-hidden', 'true');
    dialog.setAttribute('aria-hidden', 'true');
    root.hidden = true;
    if (typeof onHide === 'function') {
      try { onHide({ overlay: api, reason }); } catch (_) {}
    }
    if (lastShowOptions && typeof lastShowOptions.onHide === 'function') {
      try { lastShowOptions.onHide({ overlay: api, reason }); } catch (_) {}
    }
    const shouldRestore = restoreFocus !== false && lastFocusedElement && typeof lastFocusedElement.focus === 'function';
    if (shouldRestore) {
      try { lastFocusedElement.focus({ preventScroll: true }); }
      catch (_) { try { lastFocusedElement.focus(); } catch (_) {} }
    }
    lastFocusedElement = null;
    lastShowOptions = null;
  }

  function destroy() {
    hide({ restoreFocus: false });
    if (focusStart) focusStart.removeEventListener('focus', handleSentinelFocus);
    if (focusEnd) focusEnd.removeEventListener('focus', handleSentinelFocus);
    root.removeEventListener('pointerdown', handleBackdropPointer);
    dialog.removeEventListener('keydown', handleKeyDown);
    if (closeButton) closeButton.removeEventListener('click', handleCloseClick);
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  if (focusStart) focusStart.addEventListener('focus', handleSentinelFocus);
  if (focusEnd) focusEnd.addEventListener('focus', handleSentinelFocus);
  root.addEventListener('pointerdown', handleBackdropPointer);
  dialog.addEventListener('keydown', handleKeyDown);
  if (closeButton) closeButton.addEventListener('click', handleCloseClick);

  const api = {
    element: root,
    backdrop,
    dialog,
    content,
    closeButton,
    show,
    hide,
    destroy,
    isOpen: () => isOpen,
    setLabelledBy(value) {
      if (!value) dialog.removeAttribute('aria-labelledby');
      else dialog.setAttribute('aria-labelledby', value);
    },
    setDescribedBy(value) {
      if (!value) dialog.removeAttribute('aria-describedby');
      else dialog.setAttribute('aria-describedby', value);
    },
    setAriaLabel(value) {
      if (!value) dialog.removeAttribute('aria-label');
      else dialog.setAttribute('aria-label', value);
    },
  };

  return api;
}

export const focusableSelector = DEFAULT_FOCUSABLE_SELECTOR;
