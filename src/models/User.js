const mongoose = require('mongoose');

const statsSchema = new mongoose.Schema({
  matchesPlayed: {
    type: Number,
    default: 0,
    min: 0,
  },
  matchesWon: {
    type: Number,
    default: 0,
    min: 0,
  },
  matchesLost: {
    type: Number,
    default: 0,
    min: 0,
  },
  matchesDrawn: {
    type: Number,
    default: 0,
    min: 0,
  },
  lastEloDelta: {
    type: Number,
    default: 0,
  },
  totalEloDelta: {
    type: Number,
    default: 0,
  },
}, { _id: false });

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3,
    maxlength: 18
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  photoUrl: {
    type: String,
    trim: true
  },
  elo: {
    type: Number,
    default: 800,
    min: 0
  },
  stats: {
    type: statsSchema,
    default: () => ({}),
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('User', userSchema); 