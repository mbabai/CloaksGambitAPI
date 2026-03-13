const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const DEBUG_GAME_ACTIONS = process.env.DEBUG_GAME_ACTIONS === 'true';
const debugLog = (...args) => { if (DEBUG_GAME_ACTIONS) console.log(...args); };
const { requireGamePlayerContext } = require('../../../utils/gameAccess');
const { emitGameChanged, emitPlayersBothReady } = require('../../../utils/gameRouteEvents');
const {
  ensureStoredClockState,
  transitionStoredClockState,
  summarizeClockState,
} = require('../../../utils/gameClock');
const { appendLocalDebugLog } = require('../../../utils/localDebugLogger');

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
    const now = Date.now();

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

    const startsNow = !updated.startTime && updated.playersReady[0] && updated.playersReady[1];
    if (startsNow) {
      updated.startTime = new Date(now);
    }

    ensureStoredClockState(updated, {
      now,
      setupActionType: config.actions.get('SETUP'),
    });
    appendLocalDebugLog('clock-route-entry', {
      route: 'ready',
      gameId,
      color: normalizedColor,
      playerTurn: updated.playerTurn,
      setupComplete: updated.setupComplete,
      clockState: summarizeClockState(updated.clockState),
    });

    debugLog('Game saved successfully (ready):', {
      gameId: updated._id.toString(),
      playersReady: updated.playersReady
    });

    transitionStoredClockState(updated, {
      actingColor: normalizedColor,
      now,
      setupActionType: config.actions.get('SETUP'),
      applyIncrement: false,
      reason: 'ready',
    });

    await updated.save();

    const finalGame = await Game.findById(updated._id).lean();

    emitGameChanged(finalGame, {
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
        emitPlayersBothReady(
          finalGame._id.toString(),
          (finalGame.players || []).map((player) => player.toString()),
        );
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
