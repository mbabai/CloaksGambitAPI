const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const eventBus = require('../../../eventBus');
const lobbyStore = require('../../../state/lobby');
const ensureAdminSecret = require('../../../utils/adminSecret');

router.post('/', async (req, res) => {
	try {
                if (!ensureAdminSecret(req, res)) return;

                const result = await Game.deleteMany({});
                const before = lobbyStore.getState();
                const { cleared } = lobbyStore.clearInGame();
                if (cleared) {
                        lobbyStore.emitQueueChanged(before.inGame);
                }

		// Notify admin dashboard to refresh
		eventBus.emit('adminRefresh');

		return res.json({ deleted: result?.deletedCount || 0 });
	} catch (err) {
		console.error('Error purging games:', err);
		return res.status(500).json({ message: 'Error purging games' });
	}
});

module.exports = router;


