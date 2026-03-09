const mongoose = require('mongoose');

const simulationSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  label: {
    type: String,
    default: '',
  },
  participantAId: {
    type: String,
    default: null,
  },
  participantBId: {
    type: String,
    default: null,
  },
  participantALabel: {
    type: String,
    default: null,
  },
  participantBLabel: {
    type: String,
    default: null,
  },
  whiteSnapshotId: {
    type: String,
    default: null,
  },
  blackSnapshotId: {
    type: String,
    default: null,
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  stats: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  status: {
    type: String,
    default: 'completed',
  },
  gameCount: {
    type: Number,
    default: 0,
  },
  gamesStoredExternally: {
    type: Boolean,
    default: false,
  },
  persistence: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  games: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
}, {
  timestamps: true,
  minimize: false,
});

simulationSchema.index({ createdAt: -1 });

const SimulationModel = mongoose.models.Simulation || mongoose.model('Simulation', simulationSchema);

module.exports = SimulationModel;
