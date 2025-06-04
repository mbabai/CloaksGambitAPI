const mongoose = require('mongoose');

const serverConfigSchema = new mongoose.Schema({
  gameModes: {
    type: Map,
    of: String,
    default: {
      QUICKPLAY: "QUICKPLAY",
      RANKED: "RANKED",
      CUSTOM: "CUSTOM",
      AI: "AI"
    }
  },
  colors: {
    type: Map,
    of: Number,
    default: {
      WHITE: 0,
      BLACK: 1
    }
  },
  identities: {
    type: Map,
    of: Number,
    default: {
      UNKNOWN: 0,
      KING: 1,
      BOMB: 2,
      BISHOP: 3,
      ROOK: 4,
      KNIGHT: 5
    }
  },
  actions: {
    type: Map,
    of: Number,
    default: {
      SETUP: 0,
      MOVE: 1,
      CHALLENGE: 2,
      BOMB: 3,
      PASS: 4,
      ON_DECK: 5,
      RESIGN: 6,
      READY: 7
    }
  },
  moveStates: {
    type: Map,
    of: Number,
    default: {
      PENDING: 0,
      COMPLETED: 1,
      RESOLVED: 2
    }
  },
  boardDimensions: {
    RANKS: {
      type: Number,
      default: 6
    },
    FILES: {
      type: Number,
      default: 5
    }
  },
  gameModeSettings: {
    RANKED: {
      TIME_CONTROL: {
        type: Number,
        default: 120000
      },
      WIN_SCORE: {
        type: Number,
        default: 5
      }
    },
    QUICKPLAY: {
      TIME_CONTROL: {
        type: Number,
        default: 300000
      },
      WIN_SCORE: {
        type: Number,
        default: 1
      }
    },
    INCREMENT: {
      type: Number,
      default: 3000
    }
  },
  gameViewStates: {
    type: Map,
    of: Number,
    default: {
      WHITE: 0,
      BLACK: 1,
      SPECTATOR: 2,
      ADMIN: 3
    }
  },
  winReasons: {
    type: Map,
    of: Number,
    default: {
      CAPTURED_KING: 0,
      THRONE: 1,
      TRUE_KING: 2,
      DAGGERS: 3,
      TIME_CONTROL: 4,
      DISCONNECT: 5,
      RESIGN: 6,
      DRAW: 7
    }
  },
  gameActionStates: {
    type: Map,
    of: Number,
    default: {
      CAN_CHALLENGE: 0,
      CAN_BOMB: 1,
      CAN_PASS: 2,
      CAN_RESIGN: 3
    }
  }
}, { 
  timestamps: true,
  collection: 'serverconfig'
});

// Static method to get default configuration
serverConfigSchema.statics.getDefaultConfig = function() {
  return new this();
};

// Ensure only one config document exists
serverConfigSchema.statics.getSingleton = async function() {
  let config = await this.findOne();
  if (!config) {
    config = await this.create({});
  }
  return config;
};

module.exports = mongoose.model('ServerConfig', serverConfigSchema); 