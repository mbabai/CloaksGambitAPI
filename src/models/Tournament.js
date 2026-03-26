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
    enum: ['lobby', 'round_robin', 'elimination', 'completed'],
    default: 'lobby',
  },
  host: {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    username: { type: String, required: true },
    isGuest: { type: Boolean, default: false },
  },
  config: {
    roundRobinMinutes: { type: Number, min: 1, max: 30, default: 15 },
    eliminationStyle: { type: String, enum: ['single', 'double'], default: 'single' },
    victoryPoints: { type: Number, enum: [3, 4, 5], default: 3 },
  },
  players: {
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
