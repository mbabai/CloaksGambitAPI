const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true
  },
  elo: {
    type: Number,
    default: 1200,
    min: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  googleId: {
    type: String,
    unique: true,
    sparse: true // allow multiple docs with null/undefined
  }
});

module.exports = mongoose.model('User', userSchema); 