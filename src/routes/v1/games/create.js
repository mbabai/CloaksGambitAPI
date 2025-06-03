const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');

router.post('/', async (req, res) => {
  try {
    const game = await Game.create(req.body);
    res.status(201).json(game);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
