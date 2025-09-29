const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const { matches: memoryMatches, games: memoryGames } = require('../../../state');

function clone(value) {
  if (!value) return null;
  if (typeof value.toObject === 'function') {
    return value.toObject({ depopulate: false });
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    return { ...value };
  }
}

function inflateActiveMatch(match) {
  if (!match) return null;
  const cloned = clone(match);
  if (!cloned) return null;

  if (Array.isArray(cloned.games)) {
    cloned.games = cloned.games
      .map((id) => {
        const key = id?.toString?.() || id;
        const memoryGame = key ? memoryGames.get(key) : null;
        return clone(memoryGame) || id;
      });
  }

  return cloned;
}

router.post('/', async (req, res) => {
  try {
    const { matchId } = req.body;

    if (!matchId) {
      return res.status(400).json({ message: 'matchId is required' });
    }

    const memoryMatch = memoryMatches.get(matchId?.toString?.() || matchId);
    if (memoryMatch?.isActive) {
      const activeMatch = inflateActiveMatch(memoryMatch);
      if (activeMatch) {
        return res.json(activeMatch);
      }
    }

    const match = await Match.findById(matchId)
      .populate('games')
      .populate('player1')
      .populate('player2')
      .populate('winner')
      .lean();

    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    res.json(match);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 