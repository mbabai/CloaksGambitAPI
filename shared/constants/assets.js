'use strict';

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

const exportsPayload = {
  ASSET_MANIFEST,
  assetManifest: ASSET_MANIFEST,
  avatars: ASSET_MANIFEST.avatars,
  icons: ASSET_MANIFEST.icons,
  ui: ASSET_MANIFEST.ui,
  textures: ASSET_MANIFEST.textures,
  bubbles: ASSET_MANIFEST.bubbles
};

module.exports = Object.freeze(exportsPayload);
