const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const getServerConfig = require('../../../utils/getServerConfig');
const eventBus = require('../../../eventBus');
const { resolveUserFromRequest } = require('../../../utils/authTokens');
const User = require('../../../models/User');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const requester = await resolveUserFromRequest(req).catch(() => null);
    let requesterRecord = null;
    if (requester?.userId) {
      requesterRecord = await User.findById(requester.userId).lean().catch(() => null);
    }
    const requesterDetails = {
      userId: requester?.userId || null,
      username: requester?.username || requesterRecord?.username || null,
      isBot: requesterRecord?.isBot || false,
      botDifficulty: requesterRecord?.botDifficulty || null,
    };
    console.log('Ready endpoint called with:', {
      gameId,
      color,
      ...requesterDetails,
    });

    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      console.log('Invalid color:', color);
      return res.status(400).json({ message: 'Invalid color' });
    }

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
      console.log('Game not found for ID:', gameId);
      return res.status(404).json({ message: 'Game not found' });
    }

    console.log('Game saved successfully (ready):', {
      gameId: updated._id.toString(),
      playersReady: updated.playersReady
    });

    // If both players ready, set startTime once (idempotent)
    if (!updated.startTime && updated.playersReady[0] && updated.playersReady[1]) {
      await Game.updateOne(
        { _id: updated._id, startTime: { $exists: false } },
        { $set: { startTime: new Date() } }
      );
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
        console.log('[server] both players READY – emitting players:bothReady', {
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
