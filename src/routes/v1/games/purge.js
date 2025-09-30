const express = require('express');
const router = express.Router();
const eventBus = require('../../../eventBus');
const { games, matches } = require('../../../state');
const { ensureLobby, clearInGame, snapshotQueues } = require('../../../utils/lobbyState');

router.post('/', async (req, res) => {
        try {
                const adminSecret = process.env.ADMIN_SECRET;
                if (adminSecret && req.header('x-admin-secret') !== adminSecret) {
                        return res.status(403).json({ message: 'Forbidden' });
                }

                const deleted = games.size;
                games.clear();

                matches.forEach((match) => {
                        if (Array.isArray(match.games) && match.games.length) {
                                match.games = [];
                        }
                });

                const lobbyBefore = ensureLobby();
                const affectedUsers = Array.from(new Set(lobbyBefore.inGame || []));
                clearInGame();
                const snapshot = snapshotQueues();
                eventBus.emit('queueChanged', {
                        ...snapshot,
                        affectedUsers,
                });

                // Notify admin dashboard to refresh
                eventBus.emit('adminRefresh');

                return res.json({ deleted });
        } catch (err) {
                console.error('Error purging games:', err);
                return res.status(500).json({ message: 'Error purging games' });
        }
});

module.exports = router;


