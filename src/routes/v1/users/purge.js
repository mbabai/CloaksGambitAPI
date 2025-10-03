const express = require('express');
const router = express.Router();
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');
const ensureAdminSecret = require('../../../utils/adminSecret');

router.post('/', async (req, res) => {
  try {
    if (!ensureAdminSecret(req, res)) return;

    const result = await User.deleteMany({});

    eventBus.emit('adminRefresh');

    return res.json({ deleted: result?.deletedCount || 0 });
  } catch (err) {
    console.error('Error purging users:', err);
    return res.status(500).json({ message: 'Error purging users' });
  }
});

module.exports = router;
