'use strict';

const gameConstants = require('./game.json');

const deepFreeze = (object) => {
  if (object && typeof object === 'object' && !Object.isFrozen(object)) {
    Object.getOwnPropertyNames(object).forEach((name) => {
      const value = object[name];
      if (value && typeof value === 'object') {
        deepFreeze(value);
      }
    });
    Object.freeze(object);
  }
  return object;
};

const GAME_CONSTANTS = deepFreeze(gameConstants);

const exportsPayload = {
  GAME_CONSTANTS,
  gameModes: GAME_CONSTANTS.gameModes,
  colors: GAME_CONSTANTS.colors,
  identities: GAME_CONSTANTS.identities,
  actions: GAME_CONSTANTS.actions,
  moveStates: GAME_CONSTANTS.moveStates,
  boardDimensions: GAME_CONSTANTS.boardDimensions,
  gameModeSettings: GAME_CONSTANTS.gameModeSettings,
  gameViewStates: GAME_CONSTANTS.gameViewStates,
  winReasons: GAME_CONSTANTS.winReasons,
  gameActionStates: GAME_CONSTANTS.gameActionStates
};

module.exports = Object.freeze(exportsPayload);
