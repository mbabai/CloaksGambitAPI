const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
}

router.post('/', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && req.header('x-admin-secret') !== adminSecret) {
      return res.status(403).json({ message: 'Forbidden' });
    }

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
