const express = require('express');
const { listBuiltinBotCatalog } = require('../../../services/bots/registry');
const { isMlWorkflowEnabled } = require('../../../utils/mlFeatureGate');
const { getMlRuntime } = require('../../../services/ml/runtime');

const router = express.Router();

router.get('/', async (_req, res) => {
  try {
    const items = listBuiltinBotCatalog();
    if (isMlWorkflowEnabled()) {
      const mlRuntime = getMlRuntime();
      const promotedItems = await mlRuntime.listEnabledPromotedBotCatalog();
      const baseOrder = items.length;
      promotedItems.forEach((item, index) => {
        items.push({
          ...item,
          order: baseOrder + index,
        });
      });
    }
    res.json({ items });
  } catch (err) {
    res.status(500).json({ message: err.message || 'Failed to load bot catalog' });
  }
});

module.exports = router;
