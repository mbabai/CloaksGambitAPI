const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');

// Function to check and create matches
async function checkAndCreateMatches() {
  try {
    const lobby = await Lobby.findOne();
    if (!lobby) return;

    const config = new ServerConfig();

    // Check ranked queue
    if (lobby.rankedQueue.length >= 2) {
      const player1 = lobby.rankedQueue[0];
      const player2 = lobby.rankedQueue[1];

      // Create new match
      const match = await Match.create({
        player1,
        player2,
        type: config.gameModes.get('RANKED'),
        player1Score: 0,
        player2Score: 0,
        games: []
      });

      // Create first game
      const game = await Game.create({
        players: [player1, player2],
        match: match._id,
        timeControlStart: config.gameModeSettings.RANKED.TIME_CONTROL,
        increment: config.gameModeSettings.INCREMENT
      });

      // Update match with game
      match.games.push(game._id);
      await match.save();

      // Update lobby
      lobby.rankedQueue = lobby.rankedQueue.slice(2); // Remove first two players
      lobby.inGame.push(player1, player2);
      await lobby.save();
    }

    // Check quickplay queue
    if (lobby.quickplayQueue.length >= 2) {
      const player1 = lobby.quickplayQueue[0];
      const player2 = lobby.quickplayQueue[1];

      // Create new match
      const match = await Match.create({
        player1,
        player2,
        type: config.gameModes.get('QUICKPLAY'),
        player1Score: 0,
        player2Score: 0,
        games: []
      });

      // Create first game
      const game = await Game.create({
        players: [player1, player2],
        match: match._id,
        timeControlStart: config.gameModeSettings.QUICKPLAY.TIME_CONTROL,
        increment: config.gameModeSettings.INCREMENT
      });

      // Update match with game
      match.games.push(game._id);
      await match.save();

      // Update lobby
      lobby.quickplayQueue = lobby.quickplayQueue.slice(2); // Remove first two players
      lobby.inGame.push(player1, player2);
      await lobby.save();
    }
  } catch (err) {
    console.error('Error in matchmaking:', err);
  }
}

// Endpoint to trigger matchmaking check
router.post('/check', async (req, res) => {
  try {
    await checkAndCreateMatches();
    res.json({ message: 'Matchmaking check completed' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 