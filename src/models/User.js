const mongoose = require('mongoose');

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
    unique: true,
    sparse: true,
    trim: true,
    lowercase: true,
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
  isBot: {
    type: Boolean,
    default: false
  },
  botDifficulty: {
    type: String,
    enum: ['easy', 'medium', 'hard'],
    default: null
  },
  isGuest: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastDisconnectedAt: {
    type: Date,
    default: null
  }
});

module.exports = mongoose.model('User', userSchema); 