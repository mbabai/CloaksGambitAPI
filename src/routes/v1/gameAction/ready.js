const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const ServerConfig = require('../../../models/ServerConfig');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    
    console.log('Ready endpoint called with:', { gameId, color });

    const game = await Game.findById(gameId);
    if (!game) {
      console.log('Game not found for ID:', gameId);
      return res.status(404).json({ message: 'Game not found' });
    }

    const normalizedColor = parseInt(color, 10);
    if (normalizedColor !== 0 && normalizedColor !== 1) {
      console.log('Invalid color:', color);
      return res.status(400).json({ message: 'Invalid color' });
    }

    console.log('Current playersReady state:', game.playersReady);
    console.log('Checking if player', normalizedColor, 'is already ready');

    if (game.playersReady[normalizedColor]) {
      console.log('Player already ready');
      return res.status(400).json({ message: 'Player already ready' });
    }

    const config = new ServerConfig();
    console.log('Adding READY action for player', normalizedColor);
    console.log('READY action type value:', config.actions.get('READY'));

    game.playersReady[normalizedColor] = true;
    game.addAction(config.actions.get('READY'), normalizedColor, { ready: true });
    
    console.log('Action added, current actions count:', game.actions.length);
    console.log('Latest action:', game.actions[game.actions.length - 1]);

    if (game.playersReady[0] && game.playersReady[1] && !game.startTime) {
      game.startTime = new Date();
      console.log('Both players ready, setting start time');
    }

    console.log('About to save game with actions:', game.actions);
    console.log('Actions validation check:');
    game.actions.forEach((action, index) => {
      console.log(`Action ${index}:`, {
        type: action.type,
        player: action.player,
        details: action.details,
        hasDetails: action.details !== undefined && action.details !== null
      });
    });
    
    await game.save();
    console.log('Game saved successfully (ready):', {
      gameId: game._id.toString(),
      playersReady: game.playersReady
    });

    eventBus.emit('gameChanged', {
      game: typeof game.toObject === 'function' ? game.toObject() : game,
      affectedUsers: (game.players || []).map(p => p.toString()),
    });

    // If both players are now ready, emit an explicit signal
    try {
      if (game.playersReady[0] && game.playersReady[1]) {
        console.log('[server] both players READY – emitting players:bothReady', {
          gameId: game._id.toString(),
          players: (game.players || []).map(p => p.toString())
        });
        eventBus.emit('players:bothReady', {
          gameId: game._id.toString(),
          affectedUsers: (game.players || []).map(p => p.toString()),
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
