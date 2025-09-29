const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const { matches: memoryMatches } = require('../../../state');

function cloneMatch(match) {
  if (!match) return null;
  if (typeof match.toObject === 'function') {
    return match.toObject({ depopulate: false });
  }
  try {
    return JSON.parse(JSON.stringify(match));
  } catch (err) {
    return { ...match };
  }
}

function matchIncludesUser(match, userId) {
  if (!userId) return true;
  const normalized = userId.toString();
  const players = [match?.player1, match?.player2];
  return players.some((player) => player?.toString?.() === normalized || player === normalized);
}

function sortByStartTimeDesc(a, b) {
  const first = new Date(a.startTime || a.createdAt || 0).getTime();
  const second = new Date(b.startTime || b.createdAt || 0).getTime();
  return second - first;
}

router.post('/', async (req, res) => {
  try {
    const { userId, status } = req.body;

    if (String(status).toLowerCase() === 'active') {
      const activeMatches = Array.from(memoryMatches.values())
        .filter((match) => match && match.isActive)
        .map((match) => cloneMatch(match))
        .filter((match) => match && matchIncludesUser(match, userId))
        .sort(sortByStartTimeDesc)
        .slice(0, 50);

      return res.json(activeMatches);
    }

    const query = {};
    if (userId) {
      query.$or = [
        { player1: userId },
        { player2: userId }
      ];
    }

    if (status) {
      query.isActive = status === 'active';
    }

    const historicalMatches = await Match.find(query)
      .sort({ startTime: -1 })
      .limit(50)
      .lean();

    res.json(historicalMatches);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 
