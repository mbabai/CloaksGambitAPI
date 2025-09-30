const mongoose = require('mongoose');
const ServerConfig = require('./ServerConfig');
const eventBus = require('../eventBus');
const User = require('./User');

const DEFAULT_ELO = 800;

// Get default config to access the values
const defaultConfig = new ServerConfig();

const matchSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: Array.from(defaultConfig.gameModes.values()),
        required: true,
        set: function(value) {
            return value?.toUpperCase();
        }
    },
    player1: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    player2: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        validate: {
            validator: function(v) {
                return v.toString() !== this.player1.toString();
            },
            message: 'Player 2 must be different from Player 1'
        }
    },
    player1Score: {
        type: Number,
        default: 0
    },
    player2Score: {
        type: Number,
        default: 0
    },
    drawCount: {
        type: Number,
        default: 0
    },
    player1StartElo: {
        type: Number,
        required: function() {
            return this.type === defaultConfig.gameModes.get('RANKED');
        }
    },
    player2StartElo: {
        type: Number,
        required: function() {
            return this.type === defaultConfig.gameModes.get('RANKED');
        }
    },
    player1EndElo: {
        type: Number,
        required: function() {
            return this.type === defaultConfig.gameModes.get('RANKED');
        }
    },
    player2EndElo: {
        type: Number,
        required: function() {
            return this.type === defaultConfig.gameModes.get('RANKED');
        }
    },
    winner: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
        validate: {
            validator: function(v) {
                if (!v) return true;
                return v.toString() === this.player1.toString() ||
                       v.toString() === this.player2.toString();
            },
            message: 'Winner must be either Player 1 or Player 2'
        }
    },
    games: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'Game',
        default: []
    },
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: {
        type: Date,
        validate: {
            validator: function(v) {
                if (!v) return true; // Allow null/undefined for ongoing matches
                return v > this.startTime;
            },
            message: 'End time must be after start time'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

// Virtual for match duration
matchSchema.virtual('duration').get(function() {
    if (!this.endTime) return null;
    return this.endTime - this.startTime;
});

// Method to end the match
matchSchema.methods.endMatch = async function(winnerId = null) {
    if (!this.isActive) {
        throw new Error('Match is already ended');
    }

    const normalizedWinnerId = winnerId ?? null;
    const hasWinner = Boolean(normalizedWinnerId);

    if (hasWinner) {
        const winnerStr = normalizedWinnerId.toString();
        if (winnerStr !== this.player1.toString() &&
            winnerStr !== this.player2.toString()) {
            throw new Error('Winner must be either Player 1 or Player 2');
        }
    }

    this.winner = normalizedWinnerId;
    this.endTime = new Date();
    this.isActive = false;

    const rankedMode = defaultConfig.gameModes.get('RANKED');
    if (this.type === rankedMode) {
        let player1Start = Number.isFinite(this.player1StartElo) ? this.player1StartElo : null;
        let player2Start = Number.isFinite(this.player2StartElo) ? this.player2StartElo : null;

        const [player1User, player2User] = await Promise.all([
            User.findById(this.player1).catch(() => null),
            User.findById(this.player2).catch(() => null)
        ]);

        if (!Number.isFinite(player1Start)) {
            player1Start = Number.isFinite(player1User?.elo) ? player1User.elo : DEFAULT_ELO;
            this.player1StartElo = player1Start;
        }

        if (!Number.isFinite(player2Start)) {
            player2Start = Number.isFinite(player2User?.elo) ? player2User.elo : DEFAULT_ELO;
            this.player2StartElo = player2Start;
        }

        const winnerStr = hasWinner ? normalizedWinnerId.toString() : null;
        let player1Score = 0.5;
        if (winnerStr) {
            if (winnerStr === this.player1.toString()) {
                player1Score = 1;
            } else if (winnerStr === this.player2.toString()) {
                player1Score = 0;
            }
        }
        const player2Score = 1 - player1Score;

        const expected1 = 1 / (1 + Math.pow(10, (player2Start - player1Start) / 400));
        const K_FACTOR = 32;
        const delta1 = Math.round(K_FACTOR * (player1Score - expected1));
        const delta2 = -delta1;
        const player1End = Math.max(0, Math.round(player1Start + delta1));
        const player2End = Math.max(0, Math.round(player2Start + delta2));

        this.player1EndElo = player1End;
        this.player2EndElo = player2End;

        const updates = [];
        if (player1User) {
            player1User.elo = player1End;
            updates.push(player1User.save().catch(err => {
                console.error('Failed to update player1 elo', err);
            }));
        } else {
            updates.push(User.updateOne({ _id: this.player1 }, { $set: { elo: player1End } }).catch(err => {
                console.error('Failed to upsert player1 elo', err);
            }));
        }

        if (player2User) {
            player2User.elo = player2End;
            updates.push(player2User.save().catch(err => {
                console.error('Failed to update player2 elo', err);
            }));
        } else {
            updates.push(User.updateOne({ _id: this.player2 }, { $set: { elo: player2End } }).catch(err => {
                console.error('Failed to upsert player2 elo', err);
            }));
        }

        await Promise.all(updates);
    }

    const saved = await this.save();

    try {
        eventBus.emit('match:ended', {
            matchId: this._id.toString(),
            winner: this.winner ? this.winner.toString() : null,
            players: [this.player1?.toString(), this.player2?.toString()].filter(Boolean),
        });
    } catch (err) {
        console.error('Error emitting match:ended event:', err);
    }

    // Ensure players are removed from lobby.inGame when a match ends
    try {
        const lobbyStore = require('../state/lobby');
        const players = [this.player1?.toString(), this.player2?.toString()].filter(Boolean);
        if (players.length > 0) {
            const { removed } = lobbyStore.removeInGame(players);
            if (removed) {
                lobbyStore.emitQueueChanged(players);
            }
        }
    } catch (err) {
        // Do not crash on cleanup failures; log for investigation
        console.error('Error removing players from lobby.inGame after match end:', err);
    }

    return saved;
};

// Pre-save middleware to ensure endTime is set when match is ended
matchSchema.pre('save', function(next) {
    if (!this.isActive && !this.endTime) {
        this.endTime = new Date();
    }
    next();
});

module.exports = mongoose.model('Match', matchSchema); 