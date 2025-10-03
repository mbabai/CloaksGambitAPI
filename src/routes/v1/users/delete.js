const express = require('express');
const router = express.Router();
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');
const ensureAdminSecret = require('../../../utils/adminSecret');
const toObjectId = require('../../../utils/toObjectId');

router.post('/', async (req, res) => {
  try {
    if (!ensureAdminSecret(req, res)) return;

    const userId = req.body?.userId;
    if (!userId) {
      return res.status(400).json({ message: 'userId is required' });
    }

    const userObjectId = toObjectId(userId);
    if (!userObjectId) {
      return res.status(400).json({ message: 'Invalid userId' });
    }

    const user = await User.findById(userObjectId).exec();
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    await user.deleteOne();

    eventBus.emit('adminRefresh');

    return res.json({ deletedUserId: user._id.toString() });
  } catch (err) {
    console.error('Error deleting user:', err);
    return res.status(500).json({ message: 'Error deleting user' });
  }
});

module.exports = router;
