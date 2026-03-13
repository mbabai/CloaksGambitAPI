const mongoose = require('mongoose');

const mlRunCheckpointSchema = new mongoose.Schema({
  runId: {
    type: String,
    required: true,
    index: true,
  },
  checkpointId: {
    type: String,
    required: true,
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
  bestGeneration: {
    type: Number,
    default: 0,
  },
  workerGeneration: {
    type: Number,
    default: 0,
  },
  checkpointIndex: {
    type: Number,
    default: 0,
  },
  totalTrainingSteps: {
    type: Number,
    default: 0,
  },
  totalSelfPlayGames: {
    type: Number,
    default: 0,
  },
  totalEvaluationGames: {
    type: Number,
    default: 0,
  },
  replayBuffer: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  paths: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
}, {
  timestamps: true,
  minimize: false,
});

mlRunCheckpointSchema.index({ runId: 1, checkpointId: 1 }, { unique: true });
mlRunCheckpointSchema.index({ runId: 1, updatedAt: -1 });

const MlRunCheckpointModel = mongoose.models.MlRunCheckpoint
  || mongoose.model('MlRunCheckpoint', mlRunCheckpointSchema);

module.exports = MlRunCheckpointModel;
