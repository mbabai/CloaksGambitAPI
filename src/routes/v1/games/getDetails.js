const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const maskGameForColor = require('../../../utils/gameView');
const { resolveGameViewerContext } = require('../../../utils/gameAccess');
const getServerConfig = require('../../../utils/getServerConfig');
const { buildClockPayload } = require('../../../utils/gameClock');

router.post('/', async (req, res) => {
  try {
    const { gameId } = req.body;

    const game = await Game.findById(gameId).lean();
    if (!game) {
      return res.status(404).json({ message: 'Game not found' });
    }

    const config = await getServerConfig();
    const clocks = buildClockPayload(game, {
      now: Date.now(),
      setupActionType: config.actions.get('SETUP'),
    });
    const viewer = await resolveGameViewerContext(req, game);
    if (viewer.role === 'admin') {
      return res.json({
        ...game,
        clocks,
      });
    }

    const masked = viewer.role === 'player'
      ? maskGameForColor(game, viewer.color)
      : maskGameForColor(game, 'spectator');
    res.json({
      ...masked,
      clocks,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 
