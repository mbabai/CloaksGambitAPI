const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const DEBUG_GAME_ACTIONS = process.env.DEBUG_GAME_ACTIONS === 'true';
const debugLog = (...args) => { if (DEBUG_GAME_ACTIONS) console.log(...args); };
const { requireGamePlayerContext } = require('../../../utils/gameAccess');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const context = await requireGamePlayerContext(req, res, { gameId, color });
    if (!context) return;
    const { requesterDetails, color: normalizedColor } = context;
    debugLog('Ready endpoint called with:', {
      gameId,
      color: normalizedColor,
      ...requesterDetails,
    });

    const config = await getServerConfig();

    // Atomic update: set the one playersReady index to true and push READY action
    const actionDoc = {
      type: config.actions.get('READY'),
      player: normalizedColor,
      details: { ready: true },
      timestamp: new Date()
    };

    const updated = await Game.findByIdAndUpdate(
      gameId,
      {
        $set: { [`playersReady.${normalizedColor}`]: true },
        $push: { actions: actionDoc }
      },
      { new: true }
    );

    if (!updated) {
      debugLog('Game not found for ID:', gameId);
      return res.status(404).json({ message: 'Game not found' });
    }

    debugLog('Game saved successfully (ready):', {
      gameId: updated._id.toString(),
      playersReady: updated.playersReady
    });

    // If both players are ready, start the clock once.
    // Use direct mutation+save so this works for both Mongoose docs
    // and the in-memory active-game model (where startTime starts as null).
    if (!updated.startTime && updated.playersReady[0] && updated.playersReady[1]) {
      updated.startTime = new Date();
      await updated.save();
    }

    const finalGame = await Game.findById(updated._id).lean();

    eventBus.emit('gameChanged', {
      game: finalGame,
      affectedUsers: (finalGame.players || []).map(p => p.toString()),
      initiator: {
        action: 'ready',
        userId: requesterDetails.userId,
        username: requesterDetails.username,
        isBot: requesterDetails.isBot,
        botDifficulty: requesterDetails.botDifficulty,
      },
    });

    // If both players are now ready, emit explicit signal (once)
    try {
      if (finalGame.playersReady?.[0] && finalGame.playersReady?.[1]) {
        debugLog('[server] both players READY – emitting players:bothReady', {
          gameId: finalGame._id.toString(),
          players: (finalGame.players || []).map(p => p.toString())
        });
        eventBus.emit('players:bothReady', {
          gameId: finalGame._id.toString(),
          affectedUsers: (finalGame.players || []).map(p => p.toString()),
        });
      }
    } catch (emitErr) {
      console.error('Error emitting players:bothReady:', emitErr);
    }

    res.json({ message: 'Player marked ready' });
  } catch (err) {
    console.error('Error in ready endpoint:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
