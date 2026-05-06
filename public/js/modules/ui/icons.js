import { ASSET_MANIFEST } from '/js/shared/assetManifest.js';

const manifest = ASSET_MANIFEST || {};
const icons = manifest.icons || {};
const avatars = manifest.avatars || {};
const ui = manifest.ui || {};
const bubbles = manifest.bubbles || {};

const challengeBubbles = ui.challengeBubbles || {};
const PROCEDURAL_UI_BASE = '/assets/images/UI/Procedural';
const PROCEDURAL_IDENTITY_BASE = '/assets/images/Pieces/Procedural';
const PROCEDURAL_BUBBLE_BACKGROUNDS = Object.freeze({
  speechLeft: `${PROCEDURAL_UI_BASE}/BubbleSpeechLeft.svg`,
  thoughtLeft: `${PROCEDURAL_UI_BASE}/BubbleThoughtLeft.svg`,
  thoughtRight: `${PROCEDURAL_UI_BASE}/BubbleThoughtRight.svg`
});
const POISON_SPEECH_FILL = '#ac1f1b';
const SPEECH_LEFT_PATH = 'M 163.38224,136.2068 134.27807,93.344301 C 135.64448,80.722731 138.38158,8.8880489 72.630151,7.354716 -7.970939,6.167106 -2.8563787,142.93128 66.544731,145.73179 c 11.37496,0.9296 38.701519,0.4045 60.854169,-22.75416 z';
const DECLARATION_BUBBLE_ICONS = Object.freeze({
  king: `${PROCEDURAL_IDENTITY_BASE}/HeartIdentity.svg`,
  rook: `${PROCEDURAL_IDENTITY_BASE}/SwordIdentity.svg`,
  bishop: `${PROCEDURAL_IDENTITY_BASE}/SpearIdentity.svg`,
  knight: `${PROCEDURAL_IDENTITY_BASE}/ScytheIdentity.svg`,
  bomb: `${PROCEDURAL_IDENTITY_BASE}/PoisonIdentity.svg`
});
const PROCEDURAL_BUBBLE_ICON_PLACEMENTS = Object.freeze({
  speechLeft: {
    left: 43,
    top: 44,
    width: 46,
    height: 51
  },
  thoughtLeft: {
    left: 42,
    top: 46,
    width: 50,
    height: 52
  },
  thoughtRight: {
    left: 58,
    top: 46,
    width: 50,
    height: 52
  }
});
const PROCEDURAL_BUBBLE_ICON_ADJUSTMENTS = Object.freeze({
  king: {
    scale: 0.94
  },
  rook: {
    top: -1
  },
  bishop: {
    left: 1,
    top: -1
  },
  knight: {
    left: -1
  },
  bomb: {
    scale: 0.94
  }
});
const PROCEDURAL_IDENTITY_VIEWBOX = Object.freeze({
  width: 210,
  height: 250
});
const PROCEDURAL_BUBBLE_ICON_BOUNDS = Object.freeze({
  king: {
    x: 4.261,
    y: 36.684,
    width: 201.478,
    height: 176.632
  },
  rook: {
    x: 4.97,
    y: 4.726,
    width: 200.06,
    height: 241.947
  },
  bishop: {
    x: 23.831,
    y: 5.247,
    width: 150.049,
    height: 240.85
  },
  knight: {
    x: 3.99,
    y: 1.486,
    width: 193.428,
    height: 244.487
  },
  bomb: {
    x: 24.392,
    y: 37.114,
    width: 159.716,
    height: 174.272
  }
});
const PROCEDURAL_BUBBLE_IMAGE_CACHE = new Map();

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

function getDeclarationKeyFromBubbleType(type) {
  if (typeof type !== 'string') return null;
  if (type.includes('king')) return 'king';
  if (type.includes('rook')) return 'rook';
  if (type.includes('bishop')) return 'bishop';
  if (type.includes('knight')) return 'knight';
  if (type.includes('bomb')) return 'bomb';
  return null;
}

function getBubbleBackgroundFromType(type) {
  if (typeof type !== 'string') return null;
  if (type.includes('SpeechLeft')) return PROCEDURAL_BUBBLE_BACKGROUNDS.speechLeft;
  if (type.includes('ThoughtRight')) return PROCEDURAL_BUBBLE_BACKGROUNDS.thoughtRight;
  if (type.includes('ThoughtLeft')) return PROCEDURAL_BUBBLE_BACKGROUNDS.thoughtLeft;
  return null;
}

function getBubblePlacementKeyFromType(type) {
  if (typeof type !== 'string') return null;
  if (type.includes('SpeechLeft')) return 'speechLeft';
  if (type.includes('ThoughtRight')) return 'thoughtRight';
  if (type.includes('ThoughtLeft')) return 'thoughtLeft';
  return null;
}

export function getProceduralBubbleAsset(type) {
  const declarationKey = getDeclarationKeyFromBubbleType(type);
  const background = getBubbleBackgroundFromType(type);
  const placementKey = getBubblePlacementKeyFromType(type);
  const icon = declarationKey ? DECLARATION_BUBBLE_ICONS[declarationKey] : null;
  if (!background || !icon) return null;
  return {
    kind: 'proceduralBubble',
    background,
    backgroundFill: declarationKey === 'bomb' && placementKey === 'speechLeft'
      ? POISON_SPEECH_FILL
      : null,
    icon,
    declarationKey,
    placementKey
  };
}

export function getBubbleAssetSources(type) {
  const procedural = getProceduralBubbleAsset(type);
  if (procedural) return [procedural.background, procedural.icon];
  const src = getBubbleAsset(type);
  return src ? [src] : [];
}

function applyBubbleVisualSize(element, size) {
  if (!element || !Number.isFinite(size)) return;
  const clamped = Math.max(0, Number(size));
  element.style.width = `${clamped}px`;
  element.style.height = `${clamped}px`;
}

function applyPercentStyle(element, property, value) {
  element.style[property] = `${Number(value).toFixed(2).replace(/\.00$/, '')}%`;
}

function applyBubbleIconDimension(element, property, valuePercent, size) {
  if (Number.isFinite(size) && size > 0) {
    element.style[property] = `${Math.round((Number(size) * valuePercent) / 100)}px`;
    return;
  }
  applyPercentStyle(element, property, valuePercent);
}

function getBubbleIconFit(placement, bounds, adjustment = {}) {
  const centerX = placement.left + (adjustment.left || 0);
  const centerY = placement.top + (adjustment.top || 0);
  const fitWidth = placement.width + (adjustment.width || 0);
  const fitHeight = placement.height + (adjustment.height || 0);
  const scale = Math.min(fitWidth / bounds.width, fitHeight / bounds.height) * (adjustment.scale || 1);
  const iconWidth = PROCEDURAL_IDENTITY_VIEWBOX.width * scale;
  const iconHeight = PROCEDURAL_IDENTITY_VIEWBOX.height * scale;
  const visibleCenterX = (bounds.x + (bounds.width / 2)) * scale;
  const visibleCenterY = (bounds.y + (bounds.height / 2)) * scale;

  return {
    left: centerX - visibleCenterX,
    top: centerY - visibleCenterY,
    width: iconWidth,
    height: iconHeight
  };
}

function applyBubbleIconFit(element, placement, bounds, adjustment = {}, size = null) {
  const fit = getBubbleIconFit(placement, bounds, adjustment);
  applyBubbleIconDimension(element, 'left', fit.left, size);
  applyBubbleIconDimension(element, 'top', fit.top, size);
  applyBubbleIconDimension(element, 'width', fit.width, size);
  applyBubbleIconDimension(element, 'height', fit.height, size);
}

function getBubbleImage(src, onLoad) {
  if (!src) return null;
  let image = PROCEDURAL_BUBBLE_IMAGE_CACHE.get(src);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.draggable = false;
    image.src = src;
    PROCEDURAL_BUBBLE_IMAGE_CACHE.set(src, image);
  }
  if (!(image.complete && image.naturalWidth > 0) && typeof onLoad === 'function') {
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onLoad, { once: true });
  }
  return image;
}

function applyBubbleCanvasSize(canvas, size) {
  const cssSize = Math.max(1, Number.isFinite(Number(size)) ? Number(size) : 1);
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pixelSize = Math.max(1, Math.round(cssSize * dpr));
  canvas.width = pixelSize;
  canvas.height = pixelSize;
  canvas.style.width = `${Math.round(cssSize)}px`;
  canvas.style.height = `${Math.round(cssSize)}px`;
  return { cssSize, dpr };
}

function drawSpeechLeftPathBackground(ctx, cssSize, fill) {
  if (!ctx || !Number.isFinite(cssSize) || cssSize <= 0 || !fill) return;
  const scale = cssSize / 190;
  const path = new Path2D(SPEECH_LEFT_PATH);

  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 4;
  ctx.fill(path);
  ctx.stroke(path);
  ctx.restore();
}

function drawProceduralBubbleCanvas(canvas, procedural, size, placement, bounds, adjustment) {
  if (!canvas || !procedural) return;
  const { cssSize, dpr } = applyBubbleCanvasSize(canvas, size);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const redraw = () => drawProceduralBubbleCanvas(canvas, procedural, size, placement, bounds, adjustment);
  const background = getBubbleImage(procedural.background, redraw);
  const icon = getBubbleImage(procedural.icon, redraw);
  const fit = getBubbleIconFit(placement, bounds, adjustment);
  const toPx = (value) => Math.round((cssSize * value) / 100);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (procedural.backgroundFill && procedural.placementKey === 'speechLeft') {
    drawSpeechLeftPathBackground(ctx, cssSize, procedural.backgroundFill);
  } else if (background?.complete && background.naturalWidth > 0) {
    ctx.drawImage(background, 0, 0, cssSize, cssSize);
  }
  if (icon?.complete && icon.naturalWidth > 0) {
    ctx.drawImage(
      icon,
      toPx(fit.left),
      toPx(fit.top),
      toPx(fit.width),
      toPx(fit.height)
    );
  }
}

export function createBubbleVisual({ type, size, alt = '' } = {}) {
  const procedural = getProceduralBubbleAsset(type);
  if (procedural) {
    const placement = PROCEDURAL_BUBBLE_ICON_PLACEMENTS[procedural.placementKey]
      || PROCEDURAL_BUBBLE_ICON_PLACEMENTS.thoughtLeft;
    const bounds = PROCEDURAL_BUBBLE_ICON_BOUNDS[procedural.declarationKey]
      || {
        x: 0,
        y: 0,
        width: PROCEDURAL_IDENTITY_VIEWBOX.width,
        height: PROCEDURAL_IDENTITY_VIEWBOX.height
      };
    const adjustment = PROCEDURAL_BUBBLE_ICON_ADJUSTMENTS[procedural.declarationKey] || {};
    const canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', alt);
    canvas.style.display = 'inline-block';
    canvas.style.flex = '0 0 auto';
    canvas.style.pointerEvents = 'none';
    drawProceduralBubbleCanvas(canvas, procedural, Number(size), placement, bounds, adjustment);
    return canvas;
  }

  const src = getBubbleAsset(type);
  if (!src) return null;
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  if (Number.isFinite(size)) {
    img.style.width = `${Math.max(0, Number(size))}px`;
    img.style.height = 'auto';
  }
  return img;
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

export function createBotIcon({ size = 20, alt = 'Bot', title } = {}) {
  const img = document.createElement('img');
  img.classList.add('cg-icon');
  const src = getIconAsset('bot');
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

export function createDrawIcon({ size = 24, alt = 'Draw', title } = {}) {
  const img = document.createElement('img');
  img.classList.add('cg-icon');
  const src = getIconAsset('draw');
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
  const resolvedSize = Number.isFinite(size) ? Number(size) : null;
  const daggerScale = resolvedSize ? Math.max(10, Math.round(resolvedSize * 0.74)) : 12;
  token.style.fontSize = `${daggerScale}px`;
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
