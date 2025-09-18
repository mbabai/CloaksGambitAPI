import { ASSET_MANIFEST } from '/js/shared/assetManifest.js';

const manifest = ASSET_MANIFEST || {};
const icons = manifest.icons || {};
const avatars = manifest.avatars || {};
const ui = manifest.ui || {};
const bubbles = manifest.bubbles || {};

const challengeBubbles = ui.challengeBubbles || {};

function applySquareSize(element, size) {
  if (!element || !Number.isFinite(size)) return;
  const clamped = Math.max(0, Number(size));
  element.style.width = `${clamped}px`;
  element.style.height = `${clamped}px`;
}

export function getIconAsset(key) {
  return icons && Object.prototype.hasOwnProperty.call(icons, key) ? icons[key] : null;
}

export function getAvatarAsset(key) {
  return avatars && Object.prototype.hasOwnProperty.call(avatars, key) ? avatars[key] : null;
}

export function getChallengeBubbleAsset(position) {
  return challengeBubbles && Object.prototype.hasOwnProperty.call(challengeBubbles, position)
    ? challengeBubbles[position]
    : null;
}

export function getBubbleAsset(type) {
  return bubbles && Object.prototype.hasOwnProperty.call(bubbles, type) ? bubbles[type] : null;
}

export function createEloBadgeIcon({ size, alt = 'Ranked Elo' } = {}) {
  const img = document.createElement('img');
  img.classList.add('cg-icon');
  const src = getIconAsset('rank');
  if (src) {
    img.src = src;
  }
  img.alt = alt;
  if (Number.isFinite(size)) {
    applySquareSize(img, size);
  }
  return img;
}

export function createThroneIcon({ size = 24, alt = 'Match winner', title } = {}) {
  const img = document.createElement('img');
  img.classList.add('cg-icon');
  const src = getIconAsset('throne');
  if (src) {
    img.src = src;
  }
  img.alt = alt;
  if (title) {
    img.title = title;
  }
  applySquareSize(img, size);
  return img;
}

export function createDaggerToken({ size = 24, label = '⚔', alt = 'Loss', title } = {}) {
  const token = document.createElement('div');
  token.classList.add('cg-token');
  applySquareSize(token, size);
  token.style.fontSize = Number.isFinite(size) ? `${Math.max(10, Math.floor(size * 0.45))}px` : '12px';
  token.textContent = label;
  if (alt) {
    token.setAttribute('aria-label', alt);
  }
  if (title) {
    token.title = title;
  }
  return token;
}

export function createReconnectSpinner({ size = 16, alt = 'Opponent reconnecting', title } = {}) {
  const img = document.createElement('img');
  img.classList.add('cg-icon');
  const src = getIconAsset('loading');
  if (src) {
    img.src = src;
  }
  img.alt = alt;
  if (title) {
    img.title = title;
  }
  applySquareSize(img, size);
  return img;
}

export function createChallengeBubble({ position, size, alt } = {}) {
  const src = position ? getChallengeBubbleAsset(position) : null;
  if (!src) return null;
  const img = document.createElement('img');
  img.classList.add('cg-icon');
  img.src = src;
  img.alt = alt || 'Challenge available';
  applySquareSize(img, size);
  return img;
}

export { ASSET_MANIFEST };
