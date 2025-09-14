const express = require('express');
const router = express.Router();
const Lobby = require('../../../models/Lobby');
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const User = require('../../../models/User');
const ensureUser = require('../../../utils/ensureUser');

// Function to check and create matches
async function checkAndCreateMatches() {
  try {
    console.log('Starting matchmaking check...');
    
    const lobby = await Lobby.findOne();
    if (!lobby) {
      console.log('No lobby found');
      return;
    }

    // Always use the single config from DB
    const config = await getServerConfig();
    console.log('Got server config:', {
      gameModes: Object.fromEntries(config.gameModes),
      quickplaySettings: config.gameModeSettings.QUICKPLAY
    });

    console.log('Checking queues:', {
      rankedQueue: lobby.rankedQueue.length,
      quickplayQueue: lobby.quickplayQueue.length,
      inGame: lobby.inGame.length
    });

    // Check quickplay queue first (since that's what we're using)
      if (lobby.quickplayQueue.length >= 2) {
        const player1 = lobby.quickplayQueue[0];
        const player2 = lobby.quickplayQueue[1];

        await Promise.all([
          ensureUser(player1),
          ensureUser(player2),
        ]);
      
      // Additional safety check - ensure we have exactly 2 valid players
      if (!player1 || !player2) {
        console.error('Invalid players in queue:', { player1, player2 });
        return;
      }

      console.log('Creating quickplay match for players:', {
        player1: player1.toString(),
        player2: player2.toString()
      });

      try {
        // Create new match
        const match = await Match.create({
          player1,
          player2,
          type: config.gameModes.get('QUICKPLAY'),
          player1Score: 0,
          player2Score: 0,
          games: []
        });

        console.log('Match created:', match._id);

        // Create first game
        const game = await Game.create({
          players: [player1, player2],
          match: match._id,
          timeControlStart: config.gameModeSettings.QUICKPLAY.TIME_CONTROL,
          increment: config.gameModeSettings.INCREMENT
        });

        console.log('Game created:', game._id);

        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: [player1.toString(), player2.toString()],
        });

        eventBus.emit('players:bothNext', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: [player1.toString(), player2.toString()],
        });

        // Update match with game
        match.games.push(game._id);
        await match.save();
        console.log('Match after saving game:', await Match.findById(match._id).lean());

        // Update lobby - use atomic operation to prevent race conditions
        const updateResult = await Lobby.updateOne(
          { _id: lobby._id },
          {
            $pull: { quickplayQueue: { $in: [player1, player2] } },
            $push: { inGame: { $each: [player1, player2] } }
          }
        );

        console.log('Lobby update result:', updateResult);

        if (updateResult.modifiedCount === 0) {
          console.error('Failed to update lobby - no documents modified');
          return;
        }
        
        // Verify the queue was properly updated
        const verifyLobby = await Lobby.findById(lobby._id).lean();
        if (verifyLobby.quickplayQueue.length > 0) {
          console.log('Queue after match creation:', verifyLobby.quickplayQueue.length, 'players remaining');
        }

        const updatedLobby = await Lobby.findById(lobby._id).lean();
        eventBus.emit('queueChanged', {
          quickplayQueue: updatedLobby.quickplayQueue.map(id => id.toString()),
          rankedQueue: updatedLobby.rankedQueue.map(id => id.toString()),
          affectedUsers: [player1.toString(), player2.toString()],
        });

        // Defensive: make sure playersReady is initialized [false, false]
        await Game.updateOne({ _id: game._id, playersReady: { $exists: false } }, { $set: { playersReady: [false, false] } });

        console.log('Quickplay match created successfully');
      } catch (matchErr) {
        console.error('Error creating match:', matchErr);
        throw matchErr;
      }
    }

    // Check ranked queue
      if (lobby.rankedQueue.length >= 2) {
        const player1 = lobby.rankedQueue[0];
        const player2 = lobby.rankedQueue[1];

        await Promise.all([
          ensureUser(player1),
          ensureUser(player2),
        ]);

        const [p1User, p2User] = await Promise.all([
          User.findById(player1).lean().catch(() => null),
          User.findById(player2).lean().catch(() => null)
        ]);

      console.log('Creating ranked match for players:', {
        player1: player1.toString(),
        player2: player2.toString()
      });

      try {
        // Create new match
        const match = await Match.create({
          player1,
          player2,
          type: config.gameModes.get('RANKED'),
          player1Score: 0,
          player2Score: 0,
          games: [],
          player1StartElo: p1User?.elo ?? 1000,
          player2StartElo: p2User?.elo ?? 1000,
          player1EndElo: p1User?.elo ?? 1000,
          player2EndElo: p2User?.elo ?? 1000,
        });

        console.log('Match created:', match._id);

        // Create first game
        const game = await Game.create({
          players: [player1, player2],
          match: match._id,
          timeControlStart: config.gameModeSettings.RANKED.TIME_CONTROL,
          increment: config.gameModeSettings.INCREMENT
        });

        console.log('Game created:', game._id);

        eventBus.emit('gameChanged', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: [player1.toString(), player2.toString()],
        });

        eventBus.emit('players:bothNext', {
          game: typeof game.toObject === 'function' ? game.toObject() : game,
          affectedUsers: [player1.toString(), player2.toString()],
        });

        // Update match with game
        match.games.push(game._id);
        await match.save();
        console.log('Match after saving game:', await Match.findById(match._id).lean());

        // Update lobby - use atomic operation to prevent race conditions
        const updateResult = await Lobby.updateOne(
          { _id: lobby._id },
          {
            $pull: { rankedQueue: { $in: [player1, player2] } },
            $push: { inGame: { $each: [player1, player2] } }
          }
        );

        console.log('Lobby update result:', updateResult);

        if (updateResult.modifiedCount === 0) {
          console.error('Failed to update lobby - no documents modified');
        }

        const updatedLobby = await Lobby.findById(lobby._id).lean();
        eventBus.emit('queueChanged', {
          quickplayQueue: updatedLobby.quickplayQueue.map(id => id.toString()),
          rankedQueue: updatedLobby.rankedQueue.map(id => id.toString()),
          affectedUsers: [player1.toString(), player2.toString()],
        });

        await Game.updateOne({ _id: game._id, playersReady: { $exists: false } }, { $set: { playersReady: [false, false] } });

        console.log('Ranked match created successfully');
      } catch (matchErr) {
        console.error('Error creating match:', matchErr);
        throw matchErr;
      }
    }
  } catch (err) {
    console.error('Error in matchmaking:', err);
    throw err; // Re-throw to ensure the error is properly handled
  }
}

// Endpoint to trigger matchmaking check
router.post('/check', async (req, res) => {
  try {
    console.log('Matchmaking check endpoint called');
    await checkAndCreateMatches();
    res.json({ message: 'Matchmaking check completed' });
  } catch (err) {
    console.error('Error in matchmaking endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = {
  router,
  checkAndCreateMatches,
};
