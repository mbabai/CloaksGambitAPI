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
const DEFAULT_AUDIO_VOLUME = 0.5;
const DEFAULT_GAME_START_ALERT_VOLUME = 0.5;

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

function normalizeAudioVolume(value, fallback = DEFAULT_AUDIO_VOLUME) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, normalized));
}

function resolveAudioVolume(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return DEFAULT_AUDIO_VOLUME;
  }
  return normalizeAudioVolume(userLike.audioVolume, DEFAULT_AUDIO_VOLUME);
}

function resolveGameStartAlertVolume(userLike) {
  if (!userLike || typeof userLike !== 'object') {
    return DEFAULT_GAME_START_ALERT_VOLUME;
  }
  return normalizeAudioVolume(userLike.gameStartAlertVolume, DEFAULT_GAME_START_ALERT_VOLUME);
}

function normalizeAudioVolumeInput(value) {
  if (value === undefined) {
    return undefined;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0 || normalized > 1) {
    return null;
  }
  return normalized;
}

module.exports = {
  DEFAULT_AUDIO_VOLUME,
  DEFAULT_GAME_START_ALERT_VOLUME,
  DEFAULT_ANIMATION_SPEED,
  resolveTooltipsEnabled,
  normalizeTooltipsEnabledInput,
  resolveToastNotificationsEnabled,
  normalizeToastNotificationsEnabledInput,
  resolveAnimationSpeed,
  normalizeAnimationSpeedInput,
  resolveAudioVolume,
  resolveGameStartAlertVolume,
  normalizeAudioVolume,
  normalizeAudioVolumeInput,
};
