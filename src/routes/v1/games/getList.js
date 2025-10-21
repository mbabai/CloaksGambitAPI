const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Game = require('../../../models/Game');

function normalizeStatus(value) {
  if (typeof value !== 'string') return 'completed';
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return 'completed';
  if (trimmed === 'active' || trimmed === 'live' || trimmed === 'current') return 'active';
  if (trimmed === 'all') return 'all';
  if (trimmed === 'history' || trimmed === 'finished' || trimmed === 'complete') return 'completed';
  return trimmed;
}

function normalizeArrayValue(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function buildMatchIdFilter(matchIds) {
  const ids = new Set();
  normalizeArrayValue(matchIds).forEach((raw) => {
    if (!raw) return;
    const stringValue = typeof raw === 'string' ? raw.trim() : String(raw);
    if (!stringValue) return;
    if (mongoose.Types.ObjectId.isValid(stringValue)) {
      ids.add(new mongoose.Types.ObjectId(stringValue));
    }
    ids.add(stringValue);
  });
  if (ids.size === 0) {
    return null;
  }
  return { $in: Array.from(ids) };
}

function buildPlayerFilter(userId) {
  if (!userId) return null;
  const trimmed = typeof userId === 'string' ? userId.trim() : userId;
  if (!trimmed) return null;

  const values = [trimmed];
  if (mongoose.Types.ObjectId.isValid(trimmed)) {
    values.push(new mongoose.Types.ObjectId(trimmed));
  }
  return { $in: values };
}

function getSort(normalizedStatus) {
  if (normalizedStatus === 'active') {
    return { createdAt: -1 };
  }
  return { endTime: -1, startTime: -1, createdAt: -1 };
}

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const {
      status,
      userId,
      limit,
      page,
      matchIds,
    } = payload;

    const normalizedStatus = normalizeStatus(status);
    const query = {};

    if (normalizedStatus === 'active') {
      query.isActive = true;
    } else if (normalizedStatus === 'all') {
      // include both active and completed games
    } else {
      query.isActive = false;
    }

    const playerFilter = buildPlayerFilter(userId);
    if (playerFilter) {
      query.players = playerFilter;
    }

    const matchFilter = buildMatchIdFilter(matchIds);
    if (matchFilter) {
      query.match = matchFilter;
    }

    const numericLimit = Number(limit);
    const hasExplicitLimit = Number.isFinite(numericLimit) && numericLimit > 0;
    const safeLimit = hasExplicitLimit
      ? Math.min(Math.floor(numericLimit), 200)
      : (matchFilter ? 0 : 50);

    const numericPage = Number(page);
    const safePage = Number.isFinite(numericPage) && numericPage > 0
      ? Math.floor(numericPage)
      : 1;

    const skip = safeLimit > 0 ? (safePage - 1) * safeLimit : 0;
    const sort = getSort(normalizedStatus);

    let totalItems = 0;
    let items = [];

    if (normalizedStatus === 'active') {
      const activeGames = await Game.find(query)
        .sort(sort)
        .lean();
      totalItems = Array.isArray(activeGames) ? activeGames.length : 0;
      items = Array.isArray(activeGames)
        ? (safeLimit > 0 ? activeGames.slice(skip, skip + safeLimit) : activeGames)
        : [];
    } else {
      const historyQuery = Game.historyModel.find(query)
        .sort(sort);

      if (safeLimit > 0) {
        historyQuery.skip(skip).limit(safeLimit);
      }

      const [historyGames, count] = await Promise.all([
        historyQuery.lean(),
        Game.historyModel.countDocuments(query),
      ]);

      items = Array.isArray(historyGames) ? historyGames : [];
      totalItems = Number.isFinite(count) ? count : 0;
    }

    const perPage = safeLimit > 0 ? safeLimit : totalItems;
    const totalPages = safeLimit > 0
      ? Math.ceil(totalItems / safeLimit) || (totalItems > 0 ? 1 : 0)
      : 1;

    res.json({
      items,
      pagination: {
        page: safeLimit > 0 ? safePage : 1,
        perPage: perPage || 0,
        totalItems,
        totalPages,
      },
    });
  } catch (err) {
    console.error('Failed to fetch game list:', err);
    res.status(500).json({ message: err?.message || 'Failed to load games' });
  }
});

module.exports = router;
