import { createRequire } from 'module';
import { ASSET_MANIFEST, avatars, icons, ui, textures, bubbles } from './assets.mjs';

const require = createRequire(import.meta.url);
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

const { gameModes, colors, identities, actions, moveStates, boardDimensions, gameModeSettings, gameViewStates, winReasons, gameActionStates } = GAME_CONSTANTS;

export {
  GAME_CONSTANTS,
  gameModes,
  colors,
  identities,
  actions,
  moveStates,
  boardDimensions,
  gameModeSettings,
  gameViewStates,
  winReasons,
  gameActionStates,
  ASSET_MANIFEST,
  avatars,
  icons,
  ui,
  textures,
  bubbles
};

export default GAME_CONSTANTS;
