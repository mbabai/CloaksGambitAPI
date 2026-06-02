import {
  getIdentityRenderBox,
  getProceduralIdentityPlacement,
  getSinglePieceSrc,
  isProceduralPieceAsset,
  isProceduralSinglePieceAsset,
  resolvePieceAsset
} from './pieceAssets.js';
import { getPieceDisplayName } from './pieceLabels.js';

const GLYPH_IMAGE_CACHE = new Map();

function appendPieceLabel(wrap, piece, showLabel) {
  const label = showLabel ? getPieceDisplayName(piece, wrap.__identityLabels) : '';
  if (!label) return;
  const labelEl = document.createElement('span');
  labelEl.className = 'cg-piece-name-label';
  labelEl.textContent = label;
  labelEl.setAttribute('aria-hidden', 'true');
  wrap.appendChild(labelEl);
}

function getGlyphImage(src, onLoad) {
  if (!src) return null;
  let image = GLYPH_IMAGE_CACHE.get(src);
  if (!image) {
    image = new Image();
    image.decoding = 'async';
    image.draggable = false;
    image.src = src;
    GLYPH_IMAGE_CACHE.set(src, image);
  }
  if (!(image.complete && image.naturalWidth > 0) && typeof onLoad === 'function') {
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onLoad, { once: true });
  }
  return image;
}

function createScratchCanvas(width, height) {
  if (typeof OffscreenCanvas === 'function') {
    return new OffscreenCanvas(width, height);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawTintedImage(ctx, image, x, y, width, height, color) {
  if (!ctx || !image || !color) return;
  const scratchWidth = Math.max(1, Math.round(width));
  const scratchHeight = Math.max(1, Math.round(height));
  const scratch = createScratchCanvas(scratchWidth, scratchHeight);
  const scratchCtx = scratch.getContext('2d');
  if (!scratchCtx) return;

  scratchCtx.clearRect(0, 0, scratchWidth, scratchHeight);
  scratchCtx.drawImage(image, 0, 0, scratchWidth, scratchHeight);
  scratchCtx.globalCompositeOperation = 'source-in';
  scratchCtx.fillStyle = color;
  scratchCtx.fillRect(0, 0, scratchWidth, scratchHeight);
  ctx.drawImage(scratch, x, y, width, height);
}

function drawColorizedImage(ctx, image, x, y, width, height, color) {
  if (!ctx || !image) return;
  if (!color) {
    ctx.drawImage(image, x, y, width, height);
    return;
  }

  const scratchWidth = Math.max(1, Math.round(width));
  const scratchHeight = Math.max(1, Math.round(height));
  const scratch = createScratchCanvas(scratchWidth, scratchHeight);
  const scratchCtx = scratch.getContext('2d');
  if (!scratchCtx) return;

  scratchCtx.clearRect(0, 0, scratchWidth, scratchHeight);
  scratchCtx.drawImage(image, 0, 0, scratchWidth, scratchHeight);
  scratchCtx.globalCompositeOperation = 'multiply';
  scratchCtx.fillStyle = color;
  scratchCtx.fillRect(0, 0, scratchWidth, scratchHeight);
  scratchCtx.globalCompositeOperation = 'destination-in';
  scratchCtx.drawImage(image, 0, 0, scratchWidth, scratchHeight);
  ctx.drawImage(scratch, x, y, width, height);
}

function createCanvasGlyphWrapper(size, piece, showLabel, identityLabels) {
  const wrap = document.createElement('span');
  wrap.className = 'cg-piece-glyph';
  wrap.__identityLabels = identityLabels;
  wrap.style.position = 'relative';
  wrap.style.display = 'inline-block';
  wrap.style.width = size + 'px';
  wrap.style.height = size + 'px';
  wrap.style.flex = '0 0 auto';
  wrap.style.setProperty('--cg-piece-label-font-size', Math.max(8, Math.floor(size * 0.105)) + 'px');

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, size);
  canvas.height = Math.max(1, size);
  canvas.style.position = 'absolute';
  canvas.style.inset = '0';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.setAttribute('aria-hidden', 'true');
  wrap.appendChild(canvas);
  appendPieceLabel(wrap, piece, showLabel);
  return { wrap, canvas };
}

function drawProceduralPieceGlyph(canvas, asset, size) {
  if (!canvas || !asset) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const redraw = () => drawProceduralPieceGlyph(canvas, asset, size);
  const cloak = getGlyphImage(asset.cloak, redraw);
  const identity = getGlyphImage(asset.identity, redraw);
  ctx.clearRect(0, 0, size, size);
  if (cloak?.complete && cloak.naturalWidth > 0) {
    drawColorizedImage(ctx, cloak, 0, 0, size, size, asset.cloakColor || null);
  }
  if (identity?.complete && identity.naturalWidth > 0) {
    const placement = getProceduralIdentityPlacement(asset);
    const identityBox = getIdentityRenderBox(size, placement.scale);
    const identityLeft = Math.round((size * placement.x) - (identityBox.width / 2));
    const identityTop = Math.round((size * placement.y) - (identityBox.height / 2));
    drawTintedImage(
      ctx,
      identity,
      identityLeft,
      identityTop,
      identityBox.width,
      identityBox.height,
      asset.identityColor || '#292929ff'
    );
  }
}

function drawProceduralSingleGlyph(canvas, asset, size) {
  if (!canvas || !asset) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const redraw = () => drawProceduralSingleGlyph(canvas, asset, size);
  const image = getGlyphImage(asset.src, redraw);
  ctx.clearRect(0, 0, size, size);
  if (image?.complete && image.naturalWidth > 0) {
    drawColorizedImage(ctx, image, 0, 0, size, size, asset.tintColor || null);
  }
}

export function pieceGlyph(piece, targetSize, identityMap, options = {}) {
  if (!piece) return null;
  const size = Math.floor(targetSize * 0.9);
  const asset = resolvePieceAsset(piece, identityMap);
  const src = getSinglePieceSrc(asset);
  const showLabel = options.showLabel !== false;
  const identityLabels = options.identityLabels || null;
  if (src) {
    const wrap = document.createElement('span');
    wrap.className = 'cg-piece-glyph';
    wrap.__identityLabels = identityLabels;
    wrap.style.width = size + 'px';
    wrap.style.height = size + 'px';
    wrap.style.flex = '0 0 auto';
    wrap.style.setProperty('--cg-piece-label-font-size', Math.max(8, Math.floor(size * 0.105)) + 'px');

    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.draggable = false;
    img.style.width = size + 'px';
    img.style.height = size + 'px';
    img.style.objectFit = 'contain';

    wrap.appendChild(img);
    appendPieceLabel(wrap, piece, showLabel);
    return wrap;
  }

  if (isProceduralPieceAsset(asset)) {
    const { wrap, canvas } = createCanvasGlyphWrapper(size, piece, showLabel, identityLabels);
    drawProceduralPieceGlyph(canvas, asset, size);
    return wrap;
  }

  if (isProceduralSinglePieceAsset(asset)) {
    const { wrap, canvas } = createCanvasGlyphWrapper(size, piece, showLabel, identityLabels);
    drawProceduralSingleGlyph(canvas, asset, size);
    return wrap;
  }

  if (!src) return null;
  return null;
}
