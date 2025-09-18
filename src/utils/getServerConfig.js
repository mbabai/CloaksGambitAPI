const ServerConfig = require('../models/ServerConfig');
const { GAME_CONSTANTS } = require('../../shared/constants');

const DEFAULT_CONFIG = GAME_CONSTANTS;

const buildLegacySet = (values = []) => {
  const entries = [];
  values.forEach((value) => {
    entries.push(value);
    if (typeof value === 'number' && Number.isFinite(value)) {
      entries.push(String(value));
    } else if (typeof value === 'string') {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        entries.push(numeric);
      }
    }
  });
  return new Set(entries);
};

const LEGACY_RANKED_TIME_CONTROLS = buildLegacySet(
  DEFAULT_CONFIG.gameModeSettings?.RANKED?.LEGACY_TIME_CONTROLS
);
const LEGACY_RANKED_WIN_SCORE = buildLegacySet(
  DEFAULT_CONFIG.gameModeSettings?.RANKED?.LEGACY_WIN_SCORES
);

function toNumber(value) {
  if (value === null || value === undefined) return NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

async function getServerConfig() {
  try {
    let config = await ServerConfig.findOne();
    if (!config) {
      config = await ServerConfig.create(JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
    }

    let settings = config.gameModeSettings;
    let mutated = false;
    if (settings?.get && typeof settings.get === 'function') {
      settings = settings.toObject ? settings.toObject() : Object.fromEntries(settings);
      config.gameModeSettings = settings;
      mutated = true;
    } else if (!settings) {
      settings = {};
      config.gameModeSettings = settings;
      mutated = true;
    }
    if (!settings.RANKED) {
      settings.RANKED = { ...DEFAULT_CONFIG.gameModeSettings.RANKED };
      mutated = true;
    }

    const ranked = settings.RANKED;
    const rawTime = ranked.TIME_CONTROL;
    let rankedTime = toNumber(rawTime);
    if (!(rankedTime > 0)) {
      rankedTime = DEFAULT_CONFIG.gameModeSettings.RANKED.TIME_CONTROL;
    } else if (rankedTime < 1000) {
      rankedTime *= 1000;
    }
    if (LEGACY_RANKED_TIME_CONTROLS.has(rawTime) || LEGACY_RANKED_TIME_CONTROLS.has(rankedTime)) {
      rankedTime = DEFAULT_CONFIG.gameModeSettings.RANKED.TIME_CONTROL;
    }
    if (toNumber(rawTime) !== rankedTime || typeof rawTime !== 'number') {
      ranked.TIME_CONTROL = rankedTime;
      mutated = true;
    }

    const rawWins = ranked.WIN_SCORE;
    let rankedWins = toNumber(rawWins);
    if (!(rankedWins > 0)) {
      rankedWins = DEFAULT_CONFIG.gameModeSettings.RANKED.WIN_SCORE;
    }
    if (LEGACY_RANKED_WIN_SCORE.has(rawWins) || LEGACY_RANKED_WIN_SCORE.has(rankedWins)) {
      rankedWins = DEFAULT_CONFIG.gameModeSettings.RANKED.WIN_SCORE;
    }
    if (toNumber(rawWins) !== rankedWins || typeof rawWins !== 'number') {
      ranked.WIN_SCORE = rankedWins;
      mutated = true;
    }

    if (mutated) {
      config.markModified('gameModeSettings');
      await config.save();
    }

    return config;
  } catch (err) {
    console.error('Error in getServerConfig:', err);
    throw err;
  }
}

module.exports = getServerConfig;
