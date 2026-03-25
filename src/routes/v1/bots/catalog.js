const express = require('express');
const { listBuiltinBotCatalog } = require('../../../services/bots/registry');

const router = express.Router();

router.get('/', (_req, res) => {
  try {
    res.json({ items: listBuiltinBotCatalog() });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load bot catalog' });
  }
});

module.exports = router;
