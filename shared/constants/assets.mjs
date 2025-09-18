import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const assetsManifest = require('./assets.json');

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

const ASSET_MANIFEST = deepFreeze(assetsManifest);
const { avatars, icons, ui, textures, bubbles } = ASSET_MANIFEST;

export { ASSET_MANIFEST, avatars, icons, ui, textures, bubbles };

export default ASSET_MANIFEST;
