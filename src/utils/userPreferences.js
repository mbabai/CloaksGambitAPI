function resolveTooltipsEnabled(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return true;
  }
  return userLike.tooltipsEnabled !== false;
}

function normalizeBooleanPreferenceInput(value) {
  if (value === undefined) {
    return undefined;
  }
  if (value === true || value === false) {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return null;
}

function normalizeTooltipsEnabledInput(value) {
  return normalizeBooleanPreferenceInput(value);
}

function resolveToastNotificationsEnabled(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return true;
  }
  return userLike.toastNotificationsEnabled !== false;
}

function normalizeToastNotificationsEnabledInput(value) {
  return normalizeBooleanPreferenceInput(value);
}

const ANIMATION_SPEEDS = new Set(['off', 'fast', 'slow']);
const DEFAULT_ANIMATION_SPEED = 'slow';

function normalizeAnimationSpeed(value, fallback = DEFAULT_ANIMATION_SPEED) {
  if (typeof value !== 'string') {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return ANIMATION_SPEEDS.has(normalized) ? normalized : fallback;
}

function resolveAnimationSpeed(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return DEFAULT_ANIMATION_SPEED;
  }
  return normalizeAnimationSpeed(userLike.animationSpeed, DEFAULT_ANIMATION_SPEED);
}

function normalizeAnimationSpeedInput(value) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = normalizeAnimationSpeed(value, null);
  return normalized || null;
}

module.exports = {
  DEFAULT_ANIMATION_SPEED,
  resolveTooltipsEnabled,
  normalizeTooltipsEnabledInput,
  resolveToastNotificationsEnabled,
  normalizeToastNotificationsEnabledInput,
  resolveAnimationSpeed,
  normalizeAnimationSpeedInput,
};
