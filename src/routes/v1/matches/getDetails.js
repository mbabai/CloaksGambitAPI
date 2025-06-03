const express = require('express');
const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { matchId } = req.body;
    // TODO: Implement match details retrieval
    res.status(501).json({ message: 'Not implemented yet' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 