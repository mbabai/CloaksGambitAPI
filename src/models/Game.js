const mongoose = require('mongoose');
const ServerConfig = require('./ServerConfig');

// Get default config to access the values
const defaultConfig = new ServerConfig();

// Piece Schema
const pieceSchema = new mongoose.Schema({
    color: {
        type: Number,
        enum: Array.from(defaultConfig.colors.values()),
        required: true
    },
    identity: {
        type: Number,
        enum: Array.from(defaultConfig.identities.values()),
        required: true
    }
}, { _id: false });

// Action Schema
const actionSchema = new mongoose.Schema({
    type: {
        type: Number,
        enum: Array.from(defaultConfig.actions.values()),
        required: true
    },
    player: {
        type: Number,
        enum: [0, 1], // 0 for white, 1 for black
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    },
    details: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    }
}, { _id: false });

// Move Schema
const moveSchema = new mongoose.Schema({
    player: {
        type: Number,
        enum: [0, 1], // 0 for white, 1 for black
        required: true
    },
    from: {
        row: { type: Number, required: true },
        col: { type: Number, required: true }
    },
    to: {
        row: { type: Number, required: true },
        col: { type: Number, required: true }
    },
    declaration: {
        type: Number,
        enum: Array.from(defaultConfig.identities.values()),
        required: true
    },
    state: {
        type: Number,
        enum: Array.from(defaultConfig.moveStates.values()),
        default: defaultConfig.moveStates.get('PENDING')
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { _id: false });

// Game Schema
const gameSchema = new mongoose.Schema({
    players: {
        type: [mongoose.Schema.Types.ObjectId],
        ref: 'User',
        validate: {
            validator: function(v) {
                return v.length === 2 && v[0] !== v[1];
            },
            message: 'Game must have exactly two different players'
        },
        required: true
    },
    playerTurn: {
        type: Number,
        enum: [null, 0, 1],
        default: null
    },
    winner: {
        type: Number,
        enum: [0, 1],
        validate: {
            validator: function(v) {
                return !this.isActive || v === 0 || v === 1;
            },
            message: 'Winner must be 0 (white) or 1 (black) when game is ended'
        }
    },
    winReason: {
        type: Number,
        enum: Array.from(defaultConfig.winReasons.values()),
        validate: {
            validator: function(v) {
                return !this.isActive || v !== undefined;
            },
            message: 'Win reason must be specified when game is ended'
        }
    },
    startTime: {
        type: Date,
        default: Date.now
    },
    endTime: {
        type: Date,
        validate: {
            validator: function(v) {
                if (!v) return true; // Allow null for active games
                return v > this.startTime;
            },
            message: 'End time must be after start time'
        }
    },
    isActive: {
        type: Boolean,
        default: true
    },
    timeControlStart: {
        type: Number,
        required: true,
        validate: {
            validator: function(v) {
                // Check if the time control matches either RANKED or QUICKPLAY settings
                const rankedTime = defaultConfig.gameModeSettings.RANKED.TIME_CONTROL;
                const quickplayTime = defaultConfig.gameModeSettings.QUICKPLAY.TIME_CONTROL;
                return v === rankedTime || v === quickplayTime;
            },
            message: 'Time control must match either RANKED or QUICKPLAY settings from server config'
        }
    },
    increment: {
        type: Number,
        required: true,
        validate: {
            validator: function(v) {
                return v === defaultConfig.gameModeSettings.INCREMENT;
            },
            message: 'Increment must match the server config INCREMENT value'
        }
    },
    board: {
        type: [[pieceSchema]],
        default: function() {
            return Array(defaultConfig.boardDimensions.RANKS).fill(null)
                .map(() => Array(defaultConfig.boardDimensions.FILES).fill(null));
        },
        validate: {
            validator: function(v) {
                return v.length === defaultConfig.boardDimensions.RANKS &&
                       v.every(row => row.length === defaultConfig.boardDimensions.FILES);
            },
            message: 'Board dimensions must match server configuration'
        }
    },
    stashes: {
        type: [[pieceSchema]],
        default: [[], []],
        validate: {
            validator: function(v) {
                return v.length === 2;
            },
            message: 'Stashes must contain exactly two arrays (white and black)'
        }
    },
    onDecks: {
        type: [pieceSchema],
        default: [null, null],
        validate: {
            validator: function(v) {
                return v.length === 2;
            },
            message: 'On deck pieces must contain exactly two slots (white and black)'
        }
    },
    captured: {
        type: [[pieceSchema]],
        default: [[], []],
        validate: {
            validator: function(v) {
                return v.length === 2;
            },
            message: 'Captured pieces must contain exactly two arrays (white and black)'
        }
    },
    actions: {
        type: [actionSchema],
        default: []
    },
    moves: {
        type: [moveSchema],
        default: []
    },
    daggers: {
        type: [Number],
        default: [0, 0],
        validate: {
            validator: function(v) {
                return v.length === 2 && v.every(count => count >= 0);
            },
            message: 'Daggers must contain exactly two non-negative numbers'
        }
    },
    setupComplete: {
        type: [Boolean],
        default: [false, false],
        validate: {
            validator: function(v) {
                return v.length === 2;
            },
            message: 'Setup complete must contain exactly two boolean values'
        }
    },
    onDeckingPlayer: {
        type: Number,
        enum: [null, 0, 1],
        default: null
    }
});

// Method to end the game
gameSchema.methods.endGame = function(winner, winReason) {
    if (!this.isActive) {
        throw new Error('Game is already ended');
    }
    
    if (winner !== 0 && winner !== 1) {
        throw new Error('Winner must be 0 (white) or 1 (black)');
    }

    if (!defaultConfig.winReasons.has(winReason)) {
        throw new Error('Invalid win reason');
    }

    this.winner = winner;
    this.winReason = winReason;
    this.endTime = new Date();
    this.isActive = false;
    return this.save();
};

// Method to make a move
gameSchema.methods.makeMove = function(from, to, piece) {
    if (!this.isActive) {
        throw new Error('Game is not active');
    }

    // Add move validation logic here
    const move = {
        from,
        to,
        piece,
        state: defaultConfig.moveStates.get('PENDING'),
        timestamp: new Date()
    };

    this.moves.push(move);
    return this.save();
};

// Method to add an action
gameSchema.methods.addAction = function(type, player, details) {
    if (!this.isActive) {
        throw new Error('Game is not active');
    }

    if (!defaultConfig.actions.has(type)) {
        throw new Error('Invalid action type');
    }

    const action = {
        type,
        player,
        details,
        timestamp: new Date()
    };

    this.actions.push(action);
    return this.save();
};

module.exports = mongoose.model('Game', gameSchema); 