const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const { getPublicTimeSettings } = require('../../../utils/gameModeClock');

router.get('/', async (req, res) => {
  try {
    const config = await getServerConfig();
    res.json(getPublicTimeSettings(config));
  } catch (err) {
    console.error('Error serving time settings:', err);
    res.status(500).json({ message: 'Failed to load time settings' });
  }
});

module.exports = router;
