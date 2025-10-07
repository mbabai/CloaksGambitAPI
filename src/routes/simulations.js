const express = require('express');
const simulationQueue = require('../state/simulationQueue');

const router = express.Router();

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

router.post('/', (req, res) => {
  const { model_ids: rawModelIds, num_games: rawNumGames, concurrency: rawConcurrency, options } = req.body || {};
  const errors = [];

  const modelIds = Array.isArray(rawModelIds)
    ? rawModelIds.filter((id) => typeof id === 'string').map((id) => id.trim()).filter(Boolean)
    : [];

  if (!Array.isArray(rawModelIds)) {
    errors.push('model_ids must be an array of strings');
  } else if (modelIds.length === 0) {
    errors.push('model_ids must contain at least one non-empty string');
  }

  const numGames = Number.isInteger(rawNumGames) ? rawNumGames : null;
  if (numGames === null || numGames <= 0) {
    errors.push('num_games must be a positive integer');
  }

  const concurrency = rawConcurrency == null ? 1 : rawConcurrency;
  const parsedConcurrency = Number.isInteger(concurrency) ? concurrency : null;
  if (parsedConcurrency === null || parsedConcurrency <= 0) {
    errors.push('concurrency must be a positive integer');
  }

  if (options !== undefined && !isPlainObject(options)) {
    errors.push('options must be an object when provided');
  }

  if (errors.length > 0) {
    return res.status(400).json({ status: 'error', errors });
  }

  const job = simulationQueue.enqueue({
    modelIds,
    numGames,
    concurrency: parsedConcurrency,
    options: options || {}
  });

  return res.status(202).json({
    status: 'queued',
    simulation: {
      id: job.id,
      status: job.status,
      queuePosition: job.queuePosition,
      receivedAt: job.receivedAt,
      payload: job.payload
    }
  });
});

module.exports = router;
