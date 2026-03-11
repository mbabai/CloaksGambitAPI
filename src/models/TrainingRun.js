const mongoose = require('mongoose');

const trainingRunSchema = new mongoose.Schema({
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
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    default: 'completed',
  },
  label: {
    type: String,
    default: '',
  },
  notes: {
    type: String,
    default: '',
  },
  baseSnapshotId: {
    type: String,
    default: null,
  },
  newSnapshotId: {
    type: String,
    default: null,
  },
  epochs: {
    type: Number,
    default: 0,
  },
  learningRate: {
    type: Number,
    default: 0,
  },
  sourceSimulationIds: {
    type: [String],
    default: [],
  },
  sourceGames: {
    type: Number,
    default: 0,
  },
  sourceSimulations: {
    type: Number,
    default: 0,
  },
  sampleCounts: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  history: {
    type: [mongoose.Schema.Types.Mixed],
    default: [],
  },
  finalLoss: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  checkpoint: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
  minimize: false,
});

trainingRunSchema.index({ createdAt: -1 });
trainingRunSchema.index({ status: 1, createdAt: -1 });

const TrainingRunModel = mongoose.models.TrainingRun
  || mongoose.model('TrainingRun', trainingRunSchema);

module.exports = TrainingRunModel;
