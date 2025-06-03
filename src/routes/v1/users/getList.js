const express = require('express');
const router = express.Router();
const User = require('../../../models/User');

router.post('/', async (req, res) => {
  try {
    const { username, email } = req.body;

    const query = {};
    if (username) {
      query.username = username;
    }
    if (email) {
      query.email = email;
    }

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 