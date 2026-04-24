const express = require('express');
const router = express.Router();
const getServerConfig = require('../../../utils/getServerConfig');
const { requireGamePlayerContext } = require('../../../utils/gameAccess');
const { emitGameChanged } = require('../../../utils/gameRouteEvents');
const { advanceTutorialStep, isTutorialGame } = require('../../../services/tutorials/runtime');

router.post('/', async (req, res) => {
  try {
    const { gameId, color } = req.body;
    const context = await requireGamePlayerContext(req, res, { gameId, color });
    if (!context) return;
    const { game, color: normalizedColor, requesterDetails } = context;

    if (!isTutorialGame(game)) {
      return res.status(400).json({ message: 'This game is not a tutorial game.' });
    }

    const config = await getServerConfig();
    const tutorial = await advanceTutorialStep(game, {
      color: normalizedColor,
      config,
      now: Date.now(),
    });

    emitGameChanged(game, {
      initiator: {
        action: 'tutorial-advance',
        userId: requesterDetails.userId,
        username: requesterDetails.username,
        isBot: requesterDetails.isBot,
        botDifficulty: requesterDetails.botDifficulty,
      },
    });

    res.json({
      message: 'Tutorial advanced',
      tutorial,
    });
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    res.status(statusCode).json({ message: err.message });
  }
});

module.exports = router;
