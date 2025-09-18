const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const { GAME_CONSTANTS } = require('../../../../shared/constants');

const DEFAULTS = {
  quickplayMs: GAME_CONSTANTS.gameModeSettings.QUICKPLAY.TIME_CONTROL,
  rankedMs: GAME_CONSTANTS.gameModeSettings.RANKED.TIME_CONTROL,
  incrementMs: GAME_CONSTANTS.gameModeSettings.INCREMENT,
};

function toMilliseconds(value, fallback, { allowZero = false } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (!allowZero && num <= 0) return fallback;
  if (allowZero && num < 0) return fallback;
  if (num > 0 && num < 1000) {
    return num * 1000;
  }
  return num;
}

router.get('/', async (req, res) => {
  try {
    const config = await getServerConfig();

    const quickplaySettings = config?.gameModeSettings?.get
      ? config.gameModeSettings.get('QUICKPLAY')
      : config?.gameModeSettings?.QUICKPLAY;
    const rankedSettings = config?.gameModeSettings?.get
      ? config.gameModeSettings.get('RANKED')
      : config?.gameModeSettings?.RANKED;

    const quickplayMs = toMilliseconds(
      quickplaySettings?.TIME_CONTROL,
      DEFAULTS.quickplayMs
    );
    const rankedMs = toMilliseconds(
      rankedSettings?.TIME_CONTROL,
      DEFAULTS.rankedMs
    );
    const incrementMs = toMilliseconds(
      (config?.gameModeSettings?.get
        ? config.gameModeSettings.get('INCREMENT')
        : config?.gameModeSettings?.INCREMENT),
      DEFAULTS.incrementMs,
      { allowZero: true }
    );

    res.json({ quickplayMs, rankedMs, incrementMs });
  } catch (err) {
    console.error('Error serving time settings:', err);
    res.status(500).json({ message: 'Failed to load time settings' });
  }
});

module.exports = router;
