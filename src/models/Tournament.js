const mongoose = require('mongoose');

const tournamentSchema = new mongoose.Schema({
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 120,
  },
  state: {
    type: String,
    enum: ['starting', 'active', 'completed', 'cancelled'],
    default: 'starting',
  },
  phase: {
    type: String,
    enum: ['lobby', 'round_robin', 'round_robin_complete', 'elimination', 'completed'],
    default: 'lobby',
  },
  host: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, default: null },
    username: { type: String, required: false, default: null },
    isGuest: { type: Boolean, default: false },
  },
  createdBy: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false, default: null },
    username: { type: String, required: false, default: null },
    isGuest: { type: Boolean, default: false },
  },
  config: {
    roundRobinMinutes: { type: Number, min: 1, max: 30, default: 15 },
    breakMinutes: { type: Number, min: 0, max: 30, default: 5 },
    eliminationStyle: { type: String, enum: ['single', 'double'], default: 'single' },
    victoryPoints: { type: Number, enum: [3, 4, 5], default: 3 },
  },
  players: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  historicalPlayers: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  viewers: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  removedPlayers: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  message: {
    type: String,
    default: '',
  },
  roundRobinRounds: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  currentRoundRobinRound: {
    type: Number,
    default: 0,
  },
  roundRobinRoundsStartedAt: {
    type: Date,
    default: null,
  },
  roundRobinCompletedAt: {
    type: Date,
    default: null,
  },
  eliminationStartsAt: {
    type: Date,
    default: null,
  },
  eliminationBracket: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  matchIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Match',
    default: [],
  },
  gameIds: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'Game',
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  startedAt: {
    type: Date,
    default: null,
  },
  completedAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.models.Tournament || mongoose.model('Tournament', tournamentSchema);
