const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const { requireGamePlayerContext } = require('../../../utils/gameAccess');
const lobbyStore = require('../../../state/lobby');
const { isTutorialGame } = require('../../../services/tutorials/runtime');

router.post('/', async (req, res) => {
  try {
    const { gameId } = req.body || {};
    const context = await requireGamePlayerContext(req, res, { gameId });
    if (!context) return;

    const { game, session } = context;
    if (!isTutorialGame(game)) {
      return res.status(400).json({ message: 'This game is not a tutorial game.' });
    }

    if (game.isActive) {
      game.isActive = false;
      game.endTime = new Date();
      await game.save();
    }

    if (game.match) {
      const match = await Match.findById(game.match);
      if (match?.isActive && match.isTutorial) {
        await match.endMatch(null);
      }
    }

    const userId = session?.userId;
    if (userId) {
      const { removed } = lobbyStore.removeInGame([userId]);
      if (removed) {
        lobbyStore.emitQueueChanged([userId]);
      }
    }

    return res.json({ status: 'tutorial-left', gameId });
  } catch (err) {
    const statusCode = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
    return res.status(statusCode).json({ message: err.message || 'Failed to leave tutorial' });
  }
});

module.exports = router;
