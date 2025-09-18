const mongoose = require('mongoose');
const { GAME_CONSTANTS } = require('../../shared/constants');

const serverConfigSchema = new mongoose.Schema({
  gameModes: {
    type: Map,
    of: String,
    default: () => ({ ...GAME_CONSTANTS.gameModes })
  },
  colors: {
    type: Map,
    of: Number,
    default: () => ({ ...GAME_CONSTANTS.colors })
  },
  identities: {
    type: Map,
    of: Number,
    default: () => ({ ...GAME_CONSTANTS.identities })
  },
  actions: {
    type: Map,
    of: Number,
    default: () => ({ ...GAME_CONSTANTS.actions })
  },
  moveStates: {
    type: Map,
    of: Number,
    default: () => ({ ...GAME_CONSTANTS.moveStates })
  },
  boardDimensions: {
    RANKS: {
      type: Number,
      default: GAME_CONSTANTS.boardDimensions.RANKS
    },
    FILES: {
      type: Number,
      default: GAME_CONSTANTS.boardDimensions.FILES
    }
  },
  gameModeSettings: {
    RANKED: {
      TIME_CONTROL: {
        type: Number,
        default: GAME_CONSTANTS.gameModeSettings.RANKED.TIME_CONTROL
      },
      WIN_SCORE: {
        type: Number,
        default: GAME_CONSTANTS.gameModeSettings.RANKED.WIN_SCORE
      }
    },
    QUICKPLAY: {
      TIME_CONTROL: {
        type: Number,
        default: GAME_CONSTANTS.gameModeSettings.QUICKPLAY.TIME_CONTROL
      },
      WIN_SCORE: {
        type: Number,
        default: GAME_CONSTANTS.gameModeSettings.QUICKPLAY.WIN_SCORE
      }
    },
    INCREMENT: {
      type: Number,
      default: GAME_CONSTANTS.gameModeSettings.INCREMENT
    }
  },
  gameViewStates: {
    type: Map,
    of: Number,
    default: () => ({ ...GAME_CONSTANTS.gameViewStates })
  },
  winReasons: {
    type: Map,
    of: Number,
    default: () => ({ ...GAME_CONSTANTS.winReasons })
  },
  gameActionStates: {
    type: Map,
    of: Number,
    default: () => ({ ...GAME_CONSTANTS.gameActionStates })
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
