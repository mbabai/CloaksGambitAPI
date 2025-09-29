const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const { games: memoryGames } = require('../../../state');

function cloneGame(game) {
  if (!game) return null;
  if (typeof game.toObject === 'function') {
    return game.toObject({ depopulate: false });
  }
  try {
    return JSON.parse(JSON.stringify(game));
  } catch (err) {
    return { ...game };
  }
}

function matchesUser(game, userId) {
  if (!userId) return true;
  const normalized = userId.toString();
  if (!Array.isArray(game?.players)) return false;
  return game.players.some((player) => player?.toString?.() === normalized || player === normalized);
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
      const activeGames = Array.from(memoryGames.values())
        .filter((game) => game && game.isActive)
        .map((game) => cloneGame(game))
        .filter((game) => game && matchesUser(game, userId))
        .sort(sortByStartTimeDesc)
        .slice(0, 50);

      return res.json(activeGames);
    }

    const query = {};
    if (userId) {
      query.$or = [
        { 'players.0': userId },
        { 'players.1': userId }
      ];
    }
    if (status) {
      query.isActive = status === 'active';
    }

    const historicalGames = await Game.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.json(historicalGames);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 