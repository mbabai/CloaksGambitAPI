const express = require('express');
const router = express.Router();
const Match = require('../../../models/Match');
const Game = require('../../../models/Game');
const Lobby = require('../../../models/Lobby');
const eventBus = require('../../../eventBus');

router.post('/', async (req, res) => {
        try {
                const adminSecret = process.env.ADMIN_SECRET;
                if (adminSecret && req.header('x-admin-secret') !== adminSecret) {
                        return res.status(403).json({ message: 'Forbidden' });
                }

                const activeMatches = await Match.find({ isActive: true }).select('_id player1 player2');

                if (!activeMatches.length) {
                        eventBus.emit('adminRefresh');
                        return res.json({ deletedMatches: 0, deletedGames: 0 });
                }

                const matchIds = activeMatches.map(match => match._id);
                const playerIdMap = new Map();

                activeMatches.forEach(match => {
                        if (match.player1) {
                                playerIdMap.set(match.player1.toString(), match.player1);
                        }
                        if (match.player2) {
                                playerIdMap.set(match.player2.toString(), match.player2);
                        }
                });

                const playerObjectIds = Array.from(playerIdMap.values());
                const affectedUserIds = Array.from(playerIdMap.keys());

                const gameResult = await Game.deleteMany({ match: { $in: matchIds } });
                const matchResult = await Match.deleteMany({ _id: { $in: matchIds } });

                if (playerObjectIds.length) {
                        try {
                                const updateResult = await Lobby.updateOne({}, {
                                        $pull: { inGame: { $in: playerObjectIds } }
                                });

                                if (updateResult.modifiedCount > 0) {
                                        const lobby = await Lobby.findOne().lean();
                                        if (lobby) {
                                                eventBus.emit('queueChanged', {
                                                        quickplayQueue: (lobby.quickplayQueue || []).map(id => id.toString()),
                                                        rankedQueue: (lobby.rankedQueue || []).map(id => id.toString()),
                                                        affectedUsers: affectedUserIds
                                                });
                                        }
                                }
                        } catch (lobbyErr) {
                                console.error('Error cleaning lobby while purging active matches:', lobbyErr);
                        }
                }

                eventBus.emit('adminRefresh');

                return res.json({
                        deletedMatches: matchResult?.deletedCount || 0,
                        deletedGames: gameResult?.deletedCount || 0
                });
        } catch (err) {
                console.error('Error purging active matches:', err);
                return res.status(500).json({ message: 'Error purging active matches' });
        }
});

module.exports = router;
