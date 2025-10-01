export function coerceMilliseconds(value, { allowZero = false } = {}) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (!allowZero && num <= 0) return null;
  if (allowZero && num < 0) return null;
  return num;
}

export function describeTimeControl(baseMs, incMs) {
  const parts = [];
  if (Number.isFinite(baseMs) && baseMs > 0) {
    const minutes = Math.floor(baseMs / 60000);
    const seconds = Math.round((baseMs % 60000) / 1000);
    if (minutes > 0 && seconds > 0) {
      parts.push(`${minutes}m ${seconds}s`);
    } else if (minutes > 0) {
      parts.push(`${minutes}m`);
    } else if (seconds > 0) {
      parts.push(`${seconds}s`);
    }
  }
  if (Number.isFinite(incMs) && incMs > 0) {
    const incSeconds = incMs / 1000;
    const formatted = Number.isInteger(incSeconds) ? String(incSeconds) : incSeconds.toFixed(1);
    parts.push(`+ ${formatted}s`);
  }
  if (parts.length === 0) return null;
  return parts.join(' ');
}

export function formatClock(ms) {
  ms = Math.max(0, ms);
  if (ms >= 60000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
  const seconds = Math.floor(ms / 1000);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${seconds}:${String(hundredths).padStart(2, '0')}`;
}
