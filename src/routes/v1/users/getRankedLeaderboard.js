const express = require('express');
const router = express.Router();

const User = require('../../../models/User');

const PAGE_SIZE = 100;
const LEADERBOARD_SORT = { elo: -1, username: 1, _id: 1 };

function toIdString(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function normalizePage(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) {
    return 1;
  }
  return Math.floor(numeric);
}

function buildLeaderboardQuery() {
  return {
    isBot: { $ne: true },
    isGuest: { $ne: true },
    elo: { $exists: true, $ne: null },
  };
}

function mapLeaderboardItems(users = []) {
  return (users || []).map((user) => ({
    userId: toIdString(user._id),
    username: user.username || 'Unknown',
    elo: Number.isFinite(Number(user.elo)) ? Math.round(Number(user.elo)) : 800,
  }));
}

function isLegacyLeaderboardRequest(query) {
  if (!query || typeof query !== 'object') {
    return true;
  }
  return !Object.prototype.hasOwnProperty.call(query, 'page')
    && !Object.prototype.hasOwnProperty.call(query, 'userId');
}

async function getCurrentUserLeaderboardPlacement(query, userId) {
  const normalizedUserId = toIdString(userId);
  if (!normalizedUserId) {
    return null;
  }

  const rankedUsers = await User.find(query)
    .sort(LEADERBOARD_SORT)
    .select('_id')
    .lean();

  const rankIndex = Array.isArray(rankedUsers)
    ? rankedUsers.findIndex((user) => toIdString(user?._id) === normalizedUserId)
    : -1;

  if (rankIndex === -1) {
    return null;
  }

  const rank = rankIndex + 1;
  return {
    userId: normalizedUserId,
    rank,
    page: Math.ceil(rank / PAGE_SIZE),
  };
}

router.get('/', async (req, res) => {
  try {
    const query = buildLeaderboardQuery();

    // Keep pre-pagination clients working while cached frontend bundles age out.
    if (isLegacyLeaderboardRequest(req.query)) {
      const users = await User.find(query)
        .sort(LEADERBOARD_SORT)
        .select('_id username elo')
        .lean();

      return res.json(mapLeaderboardItems(users));
    }

    const page = normalizePage(req.query?.page);
    const skip = (page - 1) * PAGE_SIZE;

    const [totalItems, users, currentUser] = await Promise.all([
      User.countDocuments(query),
      User.find(query)
        .sort(LEADERBOARD_SORT)
        .skip(skip)
        .limit(PAGE_SIZE)
        .select('_id username elo')
        .lean(),
      getCurrentUserLeaderboardPlacement(query, req.query?.userId),
    ]);

    const items = mapLeaderboardItems(users);

    const totalPages = totalItems > 0 ? Math.ceil(totalItems / PAGE_SIZE) : 0;

    res.json({
      items,
      pagination: {
        page,
        perPage: PAGE_SIZE,
        totalItems,
        totalPages,
      },
      currentUser,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
