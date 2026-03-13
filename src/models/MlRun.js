const mongoose = require('mongoose');

const mlRunSchema = new mongoose.Schema({
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
  stopReason: {
    type: String,
    default: null,
  },
  label: {
    type: String,
    default: '',
  },
  config: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  stats: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  replayBuffer: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  latestLoss: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  latestEvaluation: {
    type: mongoose.Schema.Types.Mixed,
    default: null,
  },
  persistence: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
  minimize: false,
});

mlRunSchema.index({ status: 1, updatedAt: -1 });
mlRunSchema.index({ createdAt: -1 });

const MlRunModel = mongoose.models.MlRun || mongoose.model('MlRun', mlRunSchema);

module.exports = MlRunModel;
