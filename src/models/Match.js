const mongoose = require('mongoose');
const ServerConfig = require('./ServerConfig');

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
matchSchema.methods.endMatch = function(winnerId) {
    if (!this.isActive) {
        throw new Error('Match is already ended');
    }
    
    if (winnerId.toString() !== this.player1.toString() && 
        winnerId.toString() !== this.player2.toString()) {
        throw new Error('Winner must be either Player 1 or Player 2');
    }

    this.winner = winnerId;
    this.endTime = new Date();
    this.isActive = false;
    return this.save();
};

// Pre-save middleware to ensure endTime is set when match is ended
matchSchema.pre('save', function(next) {
    if (!this.isActive && !this.endTime) {
        this.endTime = new Date();
    }
    next();
});

module.exports = mongoose.model('Match', matchSchema); 