const express = require('express');
const router = express.Router();

const Match = require('../../../models/Match');
const User = require('../../../models/User');

function toIdString(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value.toString === 'function') return value.toString();
  return String(value);
}

function collectPlayerIds(matches, target) {
  matches.forEach((match) => {
    const player1 = toIdString(match?.player1);
    const player2 = toIdString(match?.player2);
    if (player1) target.add(player1);
    if (player2) target.add(player2);
  });
}

router.get('/', async (req, res) => {
  try {
    const [activeRankedMatches, completedRankedMatches] = await Promise.all([
      Match.find({ type: 'RANKED' }).select('player1 player2').lean(),
      Match.find({ type: 'RANKED', isActive: false }).select('player1 player2').lean(),
    ]);

    const rankedPlayerIds = new Set();
    collectPlayerIds(activeRankedMatches || [], rankedPlayerIds);
    collectPlayerIds(completedRankedMatches || [], rankedPlayerIds);

    if (rankedPlayerIds.size === 0) {
      res.json([]);
      return;
    }

    const users = await User.find({ _id: { $in: Array.from(rankedPlayerIds) } })
      .select('_id username elo isBot isGuest')
      .lean();

    const leaderboard = (users || [])
      .filter((user) => user && !user.isBot && !user.isGuest)
      .map((user) => ({
        userId: toIdString(user._id),
        username: user.username || 'Unknown',
        elo: Number.isFinite(Number(user.elo)) ? Math.round(Number(user.elo)) : 800,
      }))
      .sort((a, b) => {
        if (b.elo !== a.elo) return b.elo - a.elo;
        return a.username.localeCompare(b.username);
      });

    res.json(leaderboard);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
