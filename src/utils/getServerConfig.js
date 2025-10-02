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

let cachedConfig = null;
let configPromise = null;

const cloneDeep = (value) => JSON.parse(JSON.stringify(value));

function toMap(source) {
  if (!source) {
    return new Map();
  }
  if (source instanceof Map) {
    return new Map(source);
  }
  if (typeof source.entries === 'function') {
    return new Map(Array.from(source.entries()));
  }
  if (typeof source[Symbol.iterator] === 'function' && !Array.isArray(source)) {
    return new Map(source);
  }
  return new Map(Object.entries(source));
}

function toPlainObject(value) {
  if (!value) return {};
  if (typeof value.toObject === 'function') {
    return value.toObject();
  }
  if (value instanceof Map) {
    return Object.fromEntries(value.entries());
  }
  if (typeof value.entries === 'function') {
    return Object.fromEntries(Array.from(value.entries()));
  }
  if (typeof value === 'object') {
    return { ...value };
  }
  return {};
}

function createConfigSnapshot(configLike = DEFAULT_CONFIG) {
  const snapshot = {
    gameModes: toMap(configLike.gameModes || DEFAULT_CONFIG.gameModes),
    colors: toMap(configLike.colors || DEFAULT_CONFIG.colors),
    identities: toMap(configLike.identities || DEFAULT_CONFIG.identities),
    actions: toMap(configLike.actions || DEFAULT_CONFIG.actions),
    moveStates: toMap(configLike.moveStates || DEFAULT_CONFIG.moveStates),
    boardDimensions: {
      ...DEFAULT_CONFIG.boardDimensions,
      ...(configLike.boardDimensions || {})
    },
    gameModeSettings: cloneDeep(
      toPlainObject(configLike.gameModeSettings || DEFAULT_CONFIG.gameModeSettings)
    ),
    gameViewStates: toMap(configLike.gameViewStates || DEFAULT_CONFIG.gameViewStates),
    winReasons: toMap(configLike.winReasons || DEFAULT_CONFIG.winReasons),
    gameActionStates: toMap(configLike.gameActionStates || DEFAULT_CONFIG.gameActionStates),
  };

  if (snapshot.gameModeSettings && typeof snapshot.gameModeSettings === 'object' && !snapshot.gameModeSettings.get) {
    Object.defineProperty(snapshot.gameModeSettings, 'get', {
      value(key) {
        return this[key];
      },
      enumerable: false
    });
  }

  return snapshot;
}

async function loadServerConfigFromDatabase() {
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
    const defaultRankedWins = DEFAULT_CONFIG.gameModeSettings.RANKED.WIN_SCORE;
    if (!(rankedWins > 0)) {
      rankedWins = defaultRankedWins;
    }
    if (LEGACY_RANKED_WIN_SCORE.has(rawWins) || LEGACY_RANKED_WIN_SCORE.has(rankedWins)) {
      rankedWins = defaultRankedWins;
    }
    if (rankedWins !== defaultRankedWins) {
      rankedWins = defaultRankedWins;
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
    console.error('Error loading server config from database:', err);
    throw err;
  }
}

async function initServerConfig(forceReload = false) {
  if (forceReload) {
    cachedConfig = null;
    configPromise = null;
  }

  if (!configPromise) {
    configPromise = loadServerConfigFromDatabase()
      .then((config) => {
        cachedConfig = config;
        return cachedConfig;
      })
      .catch((err) => {
        cachedConfig = null;
        configPromise = null;
        throw err;
      });
  }

  return configPromise;
}

async function getServerConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }

  return initServerConfig();
}

function getServerConfigSync() {
  if (!cachedConfig) {
    throw new Error('Server config has not been initialized');
  }

  return cachedConfig;
}

async function refreshServerConfig() {
  return initServerConfig(true);
}

function getServerConfigSnapshotSync() {
  try {
    return createConfigSnapshot(getServerConfigSync());
  } catch (err) {
    return createConfigSnapshot(DEFAULT_CONFIG);
  }
}

module.exports = getServerConfig;
module.exports.getServerConfig = getServerConfig;
module.exports.initServerConfig = initServerConfig;
module.exports.getServerConfigSync = getServerConfigSync;
module.exports.refreshServerConfig = refreshServerConfig;
module.exports.getServerConfigSnapshotSync = getServerConfigSnapshotSync;
module.exports.createConfigSnapshot = createConfigSnapshot;
