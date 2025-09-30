const express = require('express');
const router = express.Router();
const eventBus = require('../../../eventBus');
const { matches, games } = require('../../../state');
const {
  removeUserFromInGame,
  snapshotQueues,
} = require('../../../utils/lobbyState');

router.post('/', async (req, res) => {
        try {
                const adminSecret = process.env.ADMIN_SECRET;
                if (adminSecret && req.header('x-admin-secret') !== adminSecret) {
                        return res.status(403).json({ message: 'Forbidden' });
                }

                let deletedMatches = 0;
                let deletedGames = 0;
                const affectedUsers = new Set();

                matches.forEach((match, matchId) => {
                        if (!match?.isActive) {
                                return;
                        }
                        deletedMatches += 1;
                        matches.delete(matchId);

                        const players = [match.player1, match.player2]
                                .map((player) => (player && player.toString ? player.toString() : player))
                                .filter(Boolean);
                        players.forEach((playerId) => {
                                affectedUsers.add(playerId);
                                removeUserFromInGame(playerId);
                        });

                        const gameIds = Array.isArray(match.games) ? match.games : [];
                        gameIds.forEach((gameId) => {
                                const key = gameId && gameId.toString ? gameId.toString() : gameId;
                                if (!key) return;
                                if (games.delete(key)) {
                                        deletedGames += 1;
                                }
                        });
                });

                const snapshot = snapshotQueues();
                if (affectedUsers.size) {
                        eventBus.emit('queueChanged', {
                                ...snapshot,
                                affectedUsers: Array.from(affectedUsers),
                        });
                }

                eventBus.emit('adminRefresh');

                return res.json({
                        deletedMatches,
                        deletedGames,
                });
        } catch (err) {
                console.error('Error purging active matches:', err);
                return res.status(500).json({ message: 'Error purging active matches' });
        }
});

module.exports = router;
