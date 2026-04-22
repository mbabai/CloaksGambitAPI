const DEFAULT_TOAST_MS = 2000;
const DEFAULT_PULSE_MS = 1500;

function normalizeDuration(value, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeToast(toast) {
  if (!toast || typeof toast !== 'object') {
    return null;
  }
  const text = typeof toast.text === 'string' ? toast.text.trim() : '';
  if (!text) {
    return null;
  }
  const tone = typeof toast.tone === 'string' && toast.tone.trim()
    ? toast.tone.trim().toLowerCase()
    : 'light';
  const placement = typeof toast.placement === 'string' && toast.placement.trim()
    ? toast.placement.trim().toLowerCase()
    : 'corner';
  const appearance = typeof toast.appearance === 'string' && toast.appearance.trim()
    ? toast.appearance.trim().toLowerCase()
    : 'default';
  return {
    text,
    tone,
    placement,
    appearance,
    durationMs: normalizeDuration(toast.durationMs, DEFAULT_TOAST_MS),
  };
}

function createToastHost() {
  const host = document.createElement('div');
  host.className = 'cg-toast-host';
  host.hidden = true;
  host.setAttribute('aria-live', 'polite');
  host.setAttribute('aria-atomic', 'true');
  return host;
}

function createToastElement(toast) {
  const node = document.createElement('div');
  node.className = `cg-toast cg-toast--${toast.tone}`;
  node.classList.add(`cg-toast--appearance-${toast.appearance}`);
  node.textContent = toast.text;
  return node;
}

function sameToast(left, right) {
  if (!left || !right) {
    return false;
  }
  return (
    left.text === right.text
    && left.tone === right.tone
    && left.placement === right.placement
    && left.appearance === right.appearance
    && left.durationMs === right.durationMs
  );
}

function createPulseMaps() {
  return {
    dagger: new Map(),
    captured: new Map(),
  };
}

export function createToastSystem({ container = null, onPulseChange = null, isToastStillValid = null } = {}) {
  let host = null;
  let parent = container || null;
  let queue = [];
  let activeToast = null;
  let activeToastTimer = null;
  let pulseTimer = null;
  const pulses = createPulseMaps();

  function emitPulseChange() {
    if (typeof onPulseChange === 'function') {
      try {
        onPulseChange(getPulseState());
      } catch (_) {}
    }
  }

  function ensureHost() {
    if (!host) {
      host = createToastHost();
    }
    return host;
  }

  function attach(nextContainer = parent) {
    parent = nextContainer || parent;
    if (!parent) {
      return null;
    }
    const node = ensureHost();
    if (node.parentNode !== parent) {
      try {
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      } catch (_) {}
      parent.appendChild(node);
    }
    return node;
  }

  function hideActiveToast() {
    if (activeToastTimer) {
      clearTimeout(activeToastTimer);
      activeToastTimer = null;
    }
    activeToast = null;
    if (host) {
      host.hidden = true;
      host.textContent = '';
    }
  }

  function showNextToast() {
    if (activeToast || queue.length === 0) {
      return;
    }
    let toast = null;
    while (queue.length > 0 && !toast) {
      const candidate = queue.shift();
      let isValid = true;
      if (typeof isToastStillValid === 'function') {
        try {
          isValid = isToastStillValid(candidate) !== false;
        } catch (_) {
          isValid = true;
        }
      }
      if (isValid) {
        toast = candidate;
      }
    }
    if (!toast) {
      return;
    }
    const node = attach(parent);
    if (!node) {
      return;
    }
    activeToast = toast;
    node.hidden = false;
    node.className = `cg-toast-host cg-toast-host--${toast.placement}`;
    node.textContent = '';
    node.appendChild(createToastElement(toast));
    activeToastTimer = setTimeout(() => {
      hideActiveToast();
      showNextToast();
    }, toast.durationMs);
  }

  function schedulePulseExpiry() {
    if (pulseTimer) {
      clearTimeout(pulseTimer);
      pulseTimer = null;
    }

    let nextExpiry = null;
    Object.values(pulses).forEach((map) => {
      map.forEach((expiresAt) => {
        if (!Number.isFinite(expiresAt)) {
          return;
        }
        if (nextExpiry === null || expiresAt < nextExpiry) {
          nextExpiry = expiresAt;
        }
      });
    });

    if (nextExpiry === null) {
      return;
    }

    const waitMs = Math.max(0, nextExpiry - Date.now());
    pulseTimer = setTimeout(() => {
      pulseTimer = null;
      pruneExpiredPulses();
    }, waitMs);
  }

  function pruneExpiredPulses() {
    const now = Date.now();
    let changed = false;
    Object.values(pulses).forEach((map) => {
      Array.from(map.entries()).forEach(([key, expiresAt]) => {
        if (!Number.isFinite(expiresAt) || expiresAt <= now) {
          map.delete(key);
          changed = true;
        }
      });
    });
    if (changed) {
      emitPulseChange();
    }
    schedulePulseExpiry();
  }

  function getPulseState() {
    return {
      daggerKeys: Array.from(pulses.dagger.keys()),
      capturedKeys: Array.from(pulses.captured.keys()),
    };
  }

  function setPulseEntries(entries) {
    const now = Date.now();
    let changed = false;
    entries.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const channel = typeof entry.channel === 'string' ? entry.channel.trim().toLowerCase() : '';
      const map = pulses[channel];
      if (!map) {
        return;
      }
      const key = entry.key === null || entry.key === undefined ? '' : String(entry.key);
      if (!key) {
        return;
      }
      const durationMs = normalizeDuration(entry.durationMs, DEFAULT_PULSE_MS);
      const expiresAt = now + durationMs;
      const previousExpiry = map.get(key) || 0;
      if (expiresAt > previousExpiry) {
        map.set(key, expiresAt);
        changed = true;
      }
    });
    if (changed) {
      emitPulseChange();
      schedulePulseExpiry();
    }
  }

  function enqueue(toast) {
    const normalized = normalizeToast(toast);
    if (!normalized) {
      return;
    }
    if (sameToast(activeToast, normalized) || queue.some((queued) => sameToast(queued, normalized))) {
      return;
    }
    queue.push(normalized);
    showNextToast();
  }

  function enqueueAll(toasts = []) {
    if (!Array.isArray(toasts)) {
      return;
    }
    toasts.forEach((toast) => enqueue(toast));
  }

  function dismissWhere(predicate) {
    if (typeof predicate !== 'function') {
      return false;
    }
    let removed = false;
    queue = queue.filter((toast) => {
      let shouldRemove = false;
      try {
        shouldRemove = Boolean(predicate(toast));
      } catch (_) {
        shouldRemove = false;
      }
      if (shouldRemove) {
        removed = true;
        return false;
      }
      return true;
    });

    let activeRemoved = false;
    if (activeToast) {
      try {
        activeRemoved = Boolean(predicate(activeToast));
      } catch (_) {
        activeRemoved = false;
      }
    }

    if (activeRemoved) {
      removed = true;
      hideActiveToast();
      showNextToast();
    }

    return removed;
  }

  function triggerPulse(channel, key, options = {}) {
    setPulseEntries([{
      channel,
      key,
      durationMs: options.durationMs,
    }]);
  }

  function triggerPulses(items = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return;
    }
    setPulseEntries(items);
  }

  function clear() {
    queue = [];
    hideActiveToast();
    if (pulseTimer) {
      clearTimeout(pulseTimer);
      pulseTimer = null;
    }
    const hadPulses = Object.values(pulses).some((map) => map.size > 0);
    Object.values(pulses).forEach((map) => map.clear());
    if (hadPulses) {
      emitPulseChange();
    }
  }

  function destroy() {
    clear();
    try {
      if (host && host.parentNode) {
        host.parentNode.removeChild(host);
      }
    } catch (_) {}
    host = null;
    parent = null;
  }

  if (parent) {
    attach(parent);
  }

  return {
    attach,
    enqueue,
    enqueueAll,
    dismissWhere,
    triggerPulse,
    triggerPulses,
    getPulseState,
    clear,
    destroy,
  };
}
