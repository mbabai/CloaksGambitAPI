import { ASSET_MANIFEST } from '/js/shared/assetManifest.js';
import { PIECE_IMAGES } from '/js/modules/constants.js';

const preloadedSources = new Set();
const retainedImages = [];
let baseAssetsPreloaded = false;

const BASE_STATIC_ASSETS = [
  '/assets/images/Background.png',
  '/assets/images/UI/menuButton.svg',
  '/assets/images/account.png',
  '/assets/images/book.png',
  '/assets/images/youtube-icon.png',
  '/assets/images/feedback.png',
  '/assets/images/byMarcell.webp',
  '/assets/images/CloakHood.jpg',
  '/assets/images/google-icon.png',
  '/assets/images/GoldThrone.svg'
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

function queueImage(src) {
  const normalized = normalizeAssetUrl(src);
  if (!normalized || preloadedSources.has(normalized)) return;
  const img = new Image();
  img.loading = 'eager';
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

function queueSources(sources) {
  sources.forEach(src => queueImage(src));
}

function preloadBaseManifestAssets() {
  const manifestSources = new Set();
  extractAssetPaths(ASSET_MANIFEST, manifestSources);
  extractAssetPaths(PIECE_IMAGES, manifestSources);
  BASE_STATIC_ASSETS.forEach(src => manifestSources.add(src));
  queueSources(Array.from(manifestSources));
}

export function preloadAssets({ additional = [] } = {}) {
  if (!baseAssetsPreloaded) {
    preloadBaseManifestAssets();
    baseAssetsPreloaded = true;
  }
  if (Array.isArray(additional) && additional.length > 0) {
    queueSources(additional);
  }
}

export function isAssetPreloaded(src) {
  const normalized = normalizeAssetUrl(src);
  return normalized ? preloadedSources.has(normalized) : false;
}
