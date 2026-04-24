const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const { requireGamePlayerContext } = require('../../../utils/gameAccess');
const { emitGameChanged } = require('../../../utils/gameRouteEvents');
const { isTutorialGame } = require('../../../services/tutorials/runtime');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const context = await requireGamePlayerContext(req, res, { gameId, color });
    if (!context) return;
    const { game, color: normalizedColor } = context;

    if (isTutorialGame(game)) {
      return res.status(400).json({ message: 'Resign is not available during the tutorial.' });
    }

    // Check if game is still active
    if (!game.isActive) {
      return res.status(400).json({ message: 'Game is already ended' });
    }

    const config = await getServerConfig();
    
    // Set winner as the other color
    const winner = normalizedColor === 0 ? 1 : 0;
    
    // Record the resign action before ending the game
    game.addAction(
      config.actions.get('RESIGN'),
      normalizedColor,
      {}
    );

    // End the game with resign reason and persist changes
    await game.endGame(winner, config.winReasons.get('RESIGN'));

    emitGameChanged(game);

    res.json({ message: 'Game resigned successfully' });
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    res.status(statusCode).json({ message: err.message });
  }
});

module.exports = router; 
