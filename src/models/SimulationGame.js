const mongoose = require('mongoose');

const simulationGameSchema = new mongoose.Schema({
  simulationId: {
    type: String,
    required: true,
    index: true,
  },
  id: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  seed: {
    type: Number,
    default: null,
  },
  setupMode: {
    type: String,
    default: 'random',
  },
  whiteParticipantId: {
    type: String,
    default: null,
  },
  blackParticipantId: {
    type: String,
    default: null,
  },
  whiteParticipantLabel: {
    type: String,
    default: null,
  },
  blackParticipantLabel: {
    type: String,
    default: null,
  },
  winner: {
    type: Number,
    default: null,
  },
  winReason: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  plies: {
    type: Number,
    default: 0,
  },
  decisionCount: {
    type: Number,
    default: 0,
  },
  replayFrameCount: {
    type: Number,
    default: 0,
  },
  replay: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  decisions: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  actionHistory: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  moveHistory: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  training: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  result: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
  minimize: false,
});

simulationGameSchema.index({ simulationId: 1, id: 1 }, { unique: true });
simulationGameSchema.index({ simulationId: 1, createdAt: 1 });

const SimulationGameModel = mongoose.models.SimulationGame
  || mongoose.model('SimulationGame', simulationGameSchema);

module.exports = SimulationGameModel;
