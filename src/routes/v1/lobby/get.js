const express = require('express');
const router = express.Router();
const { lobbies, quickplayQueue, rankedQueue } = require('../../../state');

function toIdStrings(values) {
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value.toString === 'function') return value.toString();
    return null;
  }).filter(Boolean);
}

router.post('/', async (req, res) => {
  try {
    const lobby = lobbies.default || {};
    res.json({
      quickplayQueue: toIdStrings(lobby.quickplayQueue || quickplayQueue),
      rankedQueue: toIdStrings(lobby.rankedQueue || rankedQueue),
      inGame: toIdStrings(lobby.inGame),
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
