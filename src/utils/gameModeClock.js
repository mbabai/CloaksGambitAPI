const { GAME_CONSTANTS } = require('../../shared/constants');

const TOURNAMENT_MATCH_TYPES = new Set([
  'TOURNAMENT_ROUND_ROBIN',
  'TOURNAMENT_ELIMINATION',
]);

function normalizeMatchType(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

function coerceMilliseconds(value, fallback, { allowZero = false } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (!allowZero && num <= 0) return fallback;
  if (allowZero && num < 0) return fallback;
  if (num > 0 && num < 1000) {
    return num * 1000;
  }
  return num;
}

function getGameModeType(config, modeKey, fallback = modeKey) {
  const resolved = config?.gameModes?.get
    ? config.gameModes.get(modeKey)
    : config?.gameModes?.[modeKey];
  const normalized = normalizeMatchType(resolved);
  if (normalized) return normalized;
  return normalizeMatchType(fallback);
}

function getGameModeSettings(config, settingsKey, fallbackKey = settingsKey) {
  const primary = config?.gameModeSettings?.get
    ? config.gameModeSettings.get(settingsKey)
    : config?.gameModeSettings?.[settingsKey];
  if (primary && typeof primary === 'object') {
    return primary;
  }

  const fallback = config?.gameModeSettings?.get
    ? config.gameModeSettings.get(fallbackKey)
    : config?.gameModeSettings?.[fallbackKey];
  if (fallback && typeof fallback === 'object') {
    return fallback;
  }

  return GAME_CONSTANTS.gameModeSettings[settingsKey]
    || GAME_CONSTANTS.gameModeSettings[fallbackKey]
    || {};
}

function getIncrementMs(config) {
  return coerceMilliseconds(
    config?.gameModeSettings?.get
      ? config.gameModeSettings.get('INCREMENT')
      : config?.gameModeSettings?.INCREMENT,
    GAME_CONSTANTS.gameModeSettings.INCREMENT,
    { allowZero: true },
  );
}

function getBaseTimeMs(config, settingsKey, fallbackKey = settingsKey) {
  const settings = getGameModeSettings(config, settingsKey, fallbackKey);
  const defaultPrimary = GAME_CONSTANTS.gameModeSettings[settingsKey];
  const defaultFallback = GAME_CONSTANTS.gameModeSettings[fallbackKey];
  const fallback = coerceMilliseconds(
    defaultPrimary?.TIME_CONTROL,
    coerceMilliseconds(defaultFallback?.TIME_CONTROL, null),
  );
  return coerceMilliseconds(settings?.TIME_CONTROL, fallback);
}

function getClockSettingsForMatchType(config, matchType) {
  const normalizedType = normalizeMatchType(matchType) || getGameModeType(config, 'QUICKPLAY', 'QUICKPLAY');
  const quickplayType = getGameModeType(config, 'QUICKPLAY', 'QUICKPLAY');
  const rankedType = getGameModeType(config, 'RANKED', 'RANKED');
  const customType = getGameModeType(config, 'CUSTOM', 'CUSTOM');
  const aiType = getGameModeType(config, 'AI', 'AI');

  let settingsKey = 'QUICKPLAY';
  if (normalizedType === rankedType || TOURNAMENT_MATCH_TYPES.has(normalizedType)) {
    settingsKey = 'RANKED';
  } else if (normalizedType === customType) {
    settingsKey = 'CUSTOM';
  } else if (normalizedType === aiType || normalizedType === quickplayType) {
    settingsKey = 'QUICKPLAY';
  }

  return {
    matchType: normalizedType,
    settingsKey,
    timeControl: getBaseTimeMs(config, settingsKey, settingsKey === 'CUSTOM' ? 'QUICKPLAY' : settingsKey),
    increment: getIncrementMs(config),
  };
}

function getPublicTimeSettings(config) {
  return {
    quickplayMs: getBaseTimeMs(config, 'QUICKPLAY'),
    rankedMs: getBaseTimeMs(config, 'RANKED'),
    customMs: getBaseTimeMs(config, 'CUSTOM', 'QUICKPLAY'),
    incrementMs: getIncrementMs(config),
  };
}

function getAllowedTimeControls(config) {
  const values = new Set();
  values.add(getBaseTimeMs(config, 'QUICKPLAY'));
  values.add(getBaseTimeMs(config, 'RANKED'));
  values.add(getBaseTimeMs(config, 'CUSTOM', 'QUICKPLAY'));
  values.delete(null);
  values.delete(undefined);
  return values;
}

module.exports = {
  TOURNAMENT_MATCH_TYPES,
  normalizeMatchType,
  coerceMilliseconds,
  getGameModeType,
  getGameModeSettings,
  getIncrementMs,
  getBaseTimeMs,
  getClockSettingsForMatchType,
  getPublicTimeSettings,
  getAllowedTimeControls,
};
