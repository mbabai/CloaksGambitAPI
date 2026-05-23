const express = require('express');
const router = express.Router();
const User = require('../../../models/User');

const ANONYMOUS_USERNAME_REGEX = /^anonymous\d+$/i;

router.post('/', async (req, res) => {
  try {
    const { username, email } = req.body;

    const query = {
      isGuest: { $ne: true },
      $and: [
        { username: { $not: ANONYMOUS_USERNAME_REGEX } },
      ],
    };
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
