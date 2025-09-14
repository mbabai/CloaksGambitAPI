const express = require('express');
const router = express.Router();
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && req.header('x-admin-secret') !== adminSecret) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const result = await User.deleteMany({});

    eventBus.emit('adminRefresh');

    return res.json({ deleted: result?.deletedCount || 0 });
  } catch (err) {
    console.error('Error purging users:', err);
    return res.status(500).json({ message: 'Error purging users' });
  }
});

module.exports = router;
