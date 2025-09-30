const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const User = require('../../../models/User');
const eventBus = require('../../../eventBus');

function toObjectId(value) {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
}

function computeEloAdjustment(startElo, endElo) {
  const start = Number.isFinite(startElo) ? startElo : null;
  const end = Number.isFinite(endElo) ? endElo : null;
  if (start === null || end === null) return null;
  const delta = end - start;
  if (!Number.isFinite(delta) || delta === 0) return 0;
  return -delta;
}

router.post('/', async (req, res) => {
  try {
    const adminSecret = process.env.ADMIN_SECRET;
    if (adminSecret && req.header('x-admin-secret') !== adminSecret) {
      return res.status(403).json({ message: 'Forbidden' });
    }

    const matchId = req.body?.matchId;
    if (!matchId) {
      return res.status(400).json({ message: 'matchId is required' });
    }

    const matchObjectId = toObjectId(matchId);
    if (!matchObjectId) {
      return res.status(400).json({ message: 'Invalid matchId' });
    }

    const match = await Match.findById(matchObjectId).exec();
    if (!match) {
      return res.status(404).json({ message: 'Match not found' });
    }

    const eloAdjustments = [];
    const matchType = typeof match.type === 'string' ? match.type.toUpperCase() : '';
    const isRanked = matchType === 'RANKED';

    if (isRanked) {
      const playerConfigs = [
        {
          userId: match.player1,
          startElo: match.player1StartElo,
          endElo: match.player1EndElo,
        },
        {
          userId: match.player2,
          startElo: match.player2StartElo,
          endElo: match.player2EndElo,
        },
      ];

      for (const config of playerConfigs) {
        const adjustment = computeEloAdjustment(config.startElo, config.endElo);
        if (adjustment === null) continue;

        const user = await User.findById(config.userId).exec().catch(() => null);
        if (!user) continue;

        const currentElo = Number.isFinite(user.elo) ? user.elo : 0;
        const updatedElo = Math.max(0, currentElo + adjustment);

        user.elo = updatedElo;
        await user.save();

        eloAdjustments.push({
          userId: user._id.toString(),
          previousElo: currentElo,
          adjustment,
          updatedElo,
        });
      }
    }

    const deletedGamesResult = await Game.deleteMany({ match: match._id });
    await match.deleteOne();

    eventBus.emit('adminRefresh');

    return res.json({
      deletedMatchId: match._id.toString(),
      deletedGames: deletedGamesResult?.deletedCount || 0,
      eloAdjustments,
    });
  } catch (err) {
    console.error('Error deleting match:', err);
    return res.status(500).json({ message: 'Error deleting match' });
  }
});

module.exports = router;
