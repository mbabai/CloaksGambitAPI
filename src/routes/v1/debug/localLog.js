const express = require('express');
const router = express.Router();

const {
  appendLocalDebugLog,
  isLocalDebugLoggingEnabled,
  getLocalDebugLogPaths,
} = require('../../../utils/localDebugLogger');

router.post('/', async (req, res) => {
  if (!isLocalDebugLoggingEnabled()) {
    return res.status(204).end();
  }

  const {
    source = 'client',
    event = 'client-log',
    gameId = null,
    payload = {},
  } = req.body || {};

  appendLocalDebugLog(event, {
    source,
    gameId,
    payload,
  });

  return res.json({
    ok: true,
    paths: getLocalDebugLogPaths(),
  });
});

module.exports = router;
