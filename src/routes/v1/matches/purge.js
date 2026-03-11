const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const eventBus = require('../../../eventBus');
const { ensureAdminRequest } = require('../../../utils/adminAccess');

router.post('/', async (req, res) => {
        try {
		const adminSession = await ensureAdminRequest(req, res);
		if (!adminSession) return;

		// Delete all games linked to matches first to avoid orphans
		await Game.deleteMany({});
		const result = await Match.deleteMany({});

		// Notify admin dashboard to refresh
		eventBus.emit('adminRefresh');

		return res.json({ deleted: result?.deletedCount || 0 });
	} catch (err) {
		console.error('Error purging matches:', err);
		return res.status(500).json({ message: 'Error purging matches' });
	}
});

module.exports = router;


