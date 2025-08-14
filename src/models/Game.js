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
        required: true,
        default: {}
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
    match: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Match',
        required: true
    },
    playersReady: {
        type: [Boolean],
        default: [false, false],
        validate: {
            validator: function(v) {
                return v.length === 2;
            },
            message: 'Players ready must contain exactly two boolean values'
        }
    },
    playerTurn: {
        type: Number,
        default: null,
        validate: {
            validator: function(v) {
                return v === null || v === 0 || v === 1;
            },
            message: 'Player turn must be null, 0 (white), or 1 (black)'
        }
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
    createdAt: {
        type: Date,
        default: Date.now
    },
    startTime: {
        type: Date
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
        default: function() {
            const createStash = (color) => [
                { color, identity: defaultConfig.identities.get('ROOK') },
                { color, identity: defaultConfig.identities.get('ROOK') },
                { color, identity: defaultConfig.identities.get('BISHOP') },
                { color, identity: defaultConfig.identities.get('BISHOP') },
                { color, identity: defaultConfig.identities.get('KNIGHT') },
                { color, identity: defaultConfig.identities.get('KNIGHT') },
                { color, identity: defaultConfig.identities.get('KING') },
                { color, identity: defaultConfig.identities.get('BOMB') }
            ];
            
            return [
                createStash(defaultConfig.colors.get('WHITE')),
                createStash(defaultConfig.colors.get('BLACK'))
            ];
        },
        validate: {
            validator: function(v) {
                return v.length === 2;
            },
            message: 'Stashes must contain exactly two arrays (white and black)'
        }
    },
    onDecks: {
        type: [mongoose.Schema.Types.Mixed],
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
    movesSinceAction: {
        type: Number,
        default: 0,
        min: 0
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
        default: null,
        validate: {
            validator: function(v) {
                return v === null || v === 0 || v === 1;
            },
            message: 'onDeckingPlayer must be null, 0, or 1'
        }
    }
});

const Match = require('./Match');

// Helper to handle match logic when a game ends
async function handleMatchUpdate(game) {
    const match = await Match.findById(game.match);
    if (!match) return;

    // Update score when there is a winner
    if (game.winner === 0) {
        match.player1Score += 1;
    } else if (game.winner === 1) {
        match.player2Score += 1;
    }

    const config = new ServerConfig();
    const winScore = config.gameModeSettings[match.type]?.WIN_SCORE;

    // If a player reached the win score, end the match
    if (
        (match.player1Score >= winScore) ||
        (match.player2Score >= winScore)
    ) {
        const winnerId =
            match.player1Score >= winScore ? match.player1 : match.player2;
        await match.endMatch(winnerId);
    } else {
        // Otherwise start a new game with players swapped
        const Game = mongoose.model('Game');
        const newGame = await Game.create({
            players: [game.players[1], game.players[0]],
            match: match._id,
            timeControlStart: game.timeControlStart,
            increment: game.increment
        });
        match.games.push(newGame._id);
        await match.save();
    }
}

// Method to end the game
gameSchema.methods.endGame = async function(winner, winReason) {
    if (!this.isActive) {
        throw new Error('Game is already ended');
    }

    if (winner !== null && winner !== 0 && winner !== 1) {
        throw new Error('Winner must be 0 (white), 1 (black) or null for draw');
    }

    // Check if winReason is one of the valid values in the winReasons Map
    const validWinReasons = Array.from(defaultConfig.winReasons.values());
    if (!validWinReasons.includes(winReason)) {
        throw new Error('Invalid win reason');
    }

    this.winner = winner;
    this.winReason = winReason;
    this.endTime = new Date();
    this.isActive = false;
    await this.save();

    await handleMatchUpdate(this);

    return this;
};

// Method to make a move
gameSchema.methods.makeMove = function(from, to, declaration) {
    if (!this.isActive) {
        throw new Error('Game is not active');
    }

    // Add move validation logic here
    const move = {
        from,
        to,
        declaration,
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

    // Validate action type (0-7 are valid action types)
    if (typeof type !== 'number' || type < 0 || type > 7) {
        throw new Error('Invalid action type');
    }

    // Ensure details is always an object
    const actionDetails = details || {};

    const action = {
        type,
        player,
        details: actionDetails,
        timestamp: new Date()
    };

    console.log('Creating action:', action);
    this.actions.push(action);
    return this;
};

module.exports = mongoose.model('Game', gameSchema); 