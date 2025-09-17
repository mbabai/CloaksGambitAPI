const ServerConfig = require('../models/ServerConfig');

const DEFAULT_CONFIG = {
  gameModes: {
    QUICKPLAY: 'QUICKPLAY',
    RANKED: 'RANKED',
    CUSTOM: 'CUSTOM',
    AI: 'AI'
  },
  colors: {
    WHITE: 0,
    BLACK: 1
  },
  identities: {
    UNKNOWN: 0,
    KING: 1,
    BOMB: 2,
    BISHOP: 3,
    ROOK: 4,
    KNIGHT: 5
  },
  actions: {
    SETUP: 0,
    MOVE: 1,
    CHALLENGE: 2,
    BOMB: 3,
    PASS: 4,
    ON_DECK: 5,
    RESIGN: 6,
    READY: 7
  },
  moveStates: {
    PENDING: 0,
    COMPLETED: 1,
    RESOLVED: 2
  },
  boardDimensions: {
    RANKS: 6,
    FILES: 5
  },
  gameModeSettings: {
    RANKED: { TIME_CONTROL: 180000, WIN_SCORE: 3 },
    QUICKPLAY: { TIME_CONTROL: 300000, WIN_SCORE: 1 },
    INCREMENT: 3000
  },
  gameViewStates: {
    WHITE: 0,
    BLACK: 1,
    SPECTATOR: 2,
    ADMIN: 3
  },
  winReasons: {
    CAPTURED_KING: 0,
    THRONE: 1,
    TRUE_KING: 2,
    DAGGERS: 3,
    TIME_CONTROL: 4,
    DISCONNECT: 5,
    RESIGN: 6,
    DRAW: 7
  },
  gameActionStates: {
    CAN_CHALLENGE: 0,
    CAN_BOMB: 1,
    CAN_PASS: 2,
    CAN_RESIGN: 3
  }
};

async function getServerConfig() {
  try {
    let config = await ServerConfig.findOne();
    if (!config) {
      config = await ServerConfig.create(DEFAULT_CONFIG);
    }
    return config;
  } catch (err) {
    console.error('Error in getServerConfig:', err);
    throw err;
  }
}

module.exports = getServerConfig; 