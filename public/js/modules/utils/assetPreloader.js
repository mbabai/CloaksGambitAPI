import { ASSET_MANIFEST } from '/js/shared/assetManifest.js';
import { PIECE_IMAGES } from '/js/modules/constants.js';

const preloadedSources = new Set();
const retainedImages = [];
let baseAssetsPreloaded = false;
let deferredManifestQueued = false;

const CRITICAL_STATIC_ASSETS = [
  '/assets/images/UI/menuButton.svg',
  '/assets/images/account.png',
  '/assets/images/cloakHood.jpg',
  '/assets/images/google-icon.png',
  '/assets/images/Background.png',
];

function normalizeAssetUrl(src) {
  if (typeof src !== 'string') return null;
  const trimmed = src.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;
  try {
    const origin = typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';
    const url = new URL(trimmed, origin);
    return url.href;
  } catch (err) {
    return trimmed;
  }
}

function queueImage(src, { eager = false } = {}) {
  const normalized = normalizeAssetUrl(src);
  if (!normalized || preloadedSources.has(normalized)) return;
  const img = new Image();
  img.loading = eager ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.src = normalized;
  retainedImages.push(img);
  preloadedSources.add(normalized);
}

function extractAssetPaths(value, results) {
  if (!value) return;
  if (typeof value === 'string') {
    results.add(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(item => extractAssetPaths(item, results));
    return;
  }
  if (typeof value === 'object') {
    Object.values(value).forEach(item => extractAssetPaths(item, results));
  }
}

function queueSources(sources, options) {
  sources.forEach((src) => queueImage(src, options));
}

function preloadManifestAssetsDeferred() {
  const manifestSources = new Set();
  extractAssetPaths(ASSET_MANIFEST, manifestSources);
  extractAssetPaths(PIECE_IMAGES, manifestSources);
  queueSources(Array.from(manifestSources), { eager: false });
}

function queueDeferredManifestPreload() {
  if (deferredManifestQueued) return;
  deferredManifestQueued = true;

  const run = () => preloadManifestAssetsDeferred();

  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 2000 });
    return;
  }

  setTimeout(run, 250);
}

export function preloadAssets({ additional = [] } = {}) {
  if (!baseAssetsPreloaded) {
    queueSources(CRITICAL_STATIC_ASSETS, { eager: true });
    queueDeferredManifestPreload();
    baseAssetsPreloaded = true;
  }
  if (Array.isArray(additional) && additional.length > 0) {
    queueSources(additional, { eager: false });
  }
}

export function isAssetPreloaded(src) {
  const normalized = normalizeAssetUrl(src);
  return normalized ? preloadedSources.has(normalized) : false;
}
