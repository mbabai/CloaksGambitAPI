const express = require('express');
const router = express.Router();
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');
const { ensureAdminRequest } = require('../../../utils/adminAccess');

router.post('/', async (req, res) => {
  try {
    const adminSession = await ensureAdminRequest(req, res);
    if (!adminSession) return;

    const result = await User.deleteMany({});

    eventBus.emit('adminRefresh');

    return res.json({ deleted: result?.deletedCount || 0 });
  } catch (err) {
    console.error('Error purging users:', err);
    return res.status(500).json({ message: 'Error purging users' });
  }
});

module.exports = router;
