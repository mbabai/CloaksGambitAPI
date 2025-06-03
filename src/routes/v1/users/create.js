const express = require('express');
const router = express.Router();
const User = require('../../../models/User');

router.post('/', async (req, res) => {
  try {
    const { username, email } = req.body;
    if (!username || !email) {
      return res.status(400).json({ message: 'username and email are required' });
    }

    const user = await User.create({ username, email });
    res.status(201).json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
