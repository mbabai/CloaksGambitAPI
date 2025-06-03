const mongoose = require('mongoose');

const lobbySchema = new mongoose.Schema({
  quickplayQueue: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  rankedQueue: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }]
}, { timestamps: true });

module.exports = mongoose.model('Lobby', lobbySchema);
