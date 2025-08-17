const express = require('express');
const router = express.Router();
const Game = require('../../../models/Game');
const Lobby = require('../../../models/Lobby');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
	try {
		const adminSecret = process.env.ADMIN_SECRET;
		if (adminSecret && req.header('x-admin-secret') !== adminSecret) {
			return res.status(403).json({ message: 'Forbidden' });
		}

		const result = await Game.deleteMany({});
		const lobby = await Lobby.findOne();
		if (lobby) {
			lobby.inGame = [];
			await lobby.save();
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


