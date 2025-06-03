const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');

router.post('/', async (req, res) => {
  try {
    const match = await Match.create(req.body);
    res.status(201).json(match);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
