const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const Match = require('../../../models/Match');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      return res.status(400).json({ message: 'Invalid color' });
    }

    const game = await Game.findById(gameId).lean();
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    // If this player is already marked next, acknowledge without re-emitting events
    if (game.playersNext?.[normalizedColor]) {
      return res.json({ message: 'Player already marked next' });
    }

    const updated = await Game.findByIdAndUpdate(
      gameId,
      { $set: { [`playersNext.${normalizedColor}`]: true } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const other = 1 - normalizedColor;

    if (!updated.playersNext?.[other]) {
      const otherUser = updated.players?.[other]?.toString();
      if (otherUser) {
        eventBus.emit('nextCountdown', {
          gameId: updated._id.toString(),
          color: other,
          seconds: 5,
          affectedUsers: [otherUser]
        });
      }

      setTimeout(async () => {
        try {
          const check = await Game.findById(gameId).lean();
          if (check && !check.playersNext?.[other]) {
            const auto = await Game.findByIdAndUpdate(
              gameId,
              { $set: { [`playersNext.${other}`]: true } },
              { new: true }
            ).lean();
            if (auto && auto.players?.length === 2) {
              eventBus.emit('players:bothNext', {
                game: auto,
                affectedUsers: auto.players.map(p => p.toString())
              });
            }
          }
        } catch (err) {
          console.error('Auto-next error:', err);
        }
      }, 5000);
    }

    if (updated.playersNext?.[0] && updated.playersNext?.[1]) {
      let nextGame = null;
      try {
        const match = await Match.findById(updated.match).populate('games');
        nextGame = match?.games?.find(g => g.isActive) || null;
      } catch (err) {
        console.error('Error loading next game for players:bothNext:', err);
      }

      const gameForEvent = nextGame && typeof nextGame.toObject === 'function'
        ? nextGame.toObject()
        : nextGame || updated;
      const affected = nextGame
        ? nextGame.players.map(p => p.toString())
        : (updated.players || []).map(p => p.toString());

      eventBus.emit('players:bothNext', {
        game: gameForEvent,
        affectedUsers: affected,
      });
    }

    res.json({ message: 'Player marked next' });
  } catch (err) {
    console.error('Error in next endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
