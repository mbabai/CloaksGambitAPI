const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const { buildMatchQuery, normalizeId } = require('../../../services/matches/activeMatches');
const { computeHistorySummary } = require('../../../services/history/summary');

router.post('/', async (req, res) => {
  try {
    const payload = req.body || {};
    const {
      status = 'completed',
      userId = null,
      type = null,
    } = payload;

    const { query, normalizedStatus } = buildMatchQuery({ status, userId, type });

    if (normalizedStatus === 'active') {
      return res.json({ summary: computeHistorySummary([], [], { userId }), totalMatches: 0, totalGames: 0 });
    }

    query.isActive = false;

    const matches = await Match.historyModel.find(query)
      .select('_id player1 player2 winner type matchType mode matchMode gameMode settings startTime endTime player1Score player2Score results isActive')
      .lean();

    const matchIds = matches
      .map((match) => match?._id)
      .filter(Boolean);

    let games = [];
    if (matchIds.length > 0) {
      const gameQuery = {
        match: { $in: matchIds },
        isActive: false,
      };

      const normalizedUserId = normalizeId(userId);
      if (normalizedUserId) {
        const values = [normalizedUserId];
        if (mongoose.Types.ObjectId.isValid(normalizedUserId)) {
          values.push(new mongoose.Types.ObjectId(normalizedUserId));
        }
        gameQuery.players = { $in: values };
      }

      games = await Game.historyModel.find(gameQuery)
        .select('_id players match winner winReason isActive startTime endTime createdAt')
        .lean();
    }

    const summary = computeHistorySummary(matches, games, { userId });

    res.json({
      summary,
      totalMatches: matches.length,
      totalGames: games.length,
    });
  } catch (err) {
    console.error('Failed to generate history summary:', err);
    res.status(500).json({ message: err?.message || 'Failed to load history summary' });
  }
});

module.exports = router;
