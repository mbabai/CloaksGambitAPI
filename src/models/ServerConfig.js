const mongoose = require('mongoose');
const { GAME_CONSTANTS } = require('../../shared/constants');
const {
  DEFAULT_ANNOUNCEMENT_FONT_SIZE,
  DEFAULT_ANNOUNCEMENT_HEADING_FONT_SIZES,
} = require('../utils/announcement');

const toMapDefault = (source) => () => new Map(Object.entries(source));
const cloneDeep = (value) => JSON.parse(JSON.stringify(value));

const serverConfigSchema = new mongoose.Schema({
  gameModes: {
    type: Map,
    of: String,
    default: toMapDefault(GAME_CONSTANTS.gameModes)
  },
  colors: {
    type: Map,
    of: Number,
    default: toMapDefault(GAME_CONSTANTS.colors)
  },
  identities: {
    type: Map,
    of: Number,
    default: toMapDefault(GAME_CONSTANTS.identities)
  },
  actions: {
    type: Map,
    of: Number,
    default: toMapDefault(GAME_CONSTANTS.actions)
  },
  moveStates: {
    type: Map,
    of: Number,
    default: toMapDefault(GAME_CONSTANTS.moveStates)
  },
  boardDimensions: {
    type: Object,
    default: () => ({ ...GAME_CONSTANTS.boardDimensions })
  },
  gameModeSettings: {
    type: Object,
    default: () => cloneDeep(GAME_CONSTANTS.gameModeSettings)
  },
  gameViewStates: {
    type: Map,
    of: Number,
    default: toMapDefault(GAME_CONSTANTS.gameViewStates)
  },
  winReasons: {
    type: Map,
    of: Number,
    default: toMapDefault(GAME_CONSTANTS.winReasons)
  },
  gameActionStates: {
    type: Map,
    of: Number,
    default: toMapDefault(GAME_CONSTANTS.gameActionStates)
  },
  announcementMarkdown: {
    type: String,
    default: ''
  },
  announcementFontSize: {
    type: Number,
    default: DEFAULT_ANNOUNCEMENT_FONT_SIZE
  },
  announcementHeadingFontSizes: {
    type: Object,
    default: () => ({ ...DEFAULT_ANNOUNCEMENT_HEADING_FONT_SIZES })
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
