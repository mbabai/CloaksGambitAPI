const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');

const DEFAULTS = {
  quickplayMs: 300000,
  rankedMs: 180000,
  incrementMs: 3000,
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

    const quickplayMs = toMilliseconds(
      config?.gameModeSettings?.QUICKPLAY?.TIME_CONTROL,
      DEFAULTS.quickplayMs
    );
    const rankedMs = toMilliseconds(
      config?.gameModeSettings?.RANKED?.TIME_CONTROL,
      DEFAULTS.rankedMs
    );
    const incrementMs = toMilliseconds(
      config?.gameModeSettings?.INCREMENT,
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
