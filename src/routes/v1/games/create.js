const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const Match = require('../../../models/Match');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const { matchId, ...gameData } = req.body;

    if (!matchId) {
      return res.status(400).json({ message: 'matchId is required' });
    }

    const match = await Match.findById(matchId);
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    const game = await Game.create({ ...gameData, match: matchId });

    match.games.push(game._id);
    await match.save();

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
    });

    res.status(201).json(game);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
