import {
  getIdentityRenderBox,
  getProceduralIdentityPlacement,
  getSinglePieceSrc,
  isProceduralPieceAsset,
  resolvePieceAsset
} from './pieceAssets.js';
import { getPieceDisplayName } from './pieceLabels.js';

function appendPieceLabel(wrap, piece, showLabel) {
  const label = showLabel ? getPieceDisplayName(piece) : '';
  if (!label) return;
  const labelEl = document.createElement('span');
  labelEl.className = 'cg-piece-name-label';
  labelEl.textContent = label;
  labelEl.setAttribute('aria-hidden', 'true');
  wrap.appendChild(labelEl);
}

function shouldUseLightIdentityFilter(color) {
  return typeof color === 'string' && color.toLowerCase() !== '#292929ff' && color.toLowerCase() !== '#292929';
}

export function pieceGlyph(piece, targetSize, identityMap, options = {}) {
  if (!piece) return null;
  const size = Math.floor(targetSize * 0.9);
  const asset = resolvePieceAsset(piece, identityMap);
  const src = getSinglePieceSrc(asset);
  const showLabel = options.showLabel !== false;
  if (src) {
    const wrap = document.createElement('span');
    wrap.className = 'cg-piece-glyph';
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
    const wrap = document.createElement('span');
    wrap.className = 'cg-piece-glyph';
    const placement = getProceduralIdentityPlacement(asset);
    const identityBox = getIdentityRenderBox(size, placement.scale);
    const identityLeft = Math.round((size * placement.x) - (identityBox.width / 2));
    const identityTop = Math.round((size * placement.y) - (identityBox.height / 2));

    wrap.style.position = 'relative';
    wrap.style.display = 'inline-block';
    wrap.style.width = size + 'px';
    wrap.style.height = size + 'px';
    wrap.style.flex = '0 0 auto';
    wrap.style.setProperty('--cg-piece-label-font-size', Math.max(8, Math.floor(size * 0.105)) + 'px');

    const cloak = document.createElement('img');
    cloak.src = asset.cloak;
    cloak.alt = '';
    cloak.draggable = false;
    cloak.style.position = 'absolute';
    cloak.style.inset = '0';
    cloak.style.width = '100%';
    cloak.style.height = '100%';
    cloak.style.objectFit = 'contain';

    const identity = document.createElement('img');
    identity.src = asset.identity;
    identity.alt = '';
    identity.draggable = false;
    identity.style.position = 'absolute';
    identity.style.left = identityLeft + 'px';
    identity.style.top = identityTop + 'px';
    identity.style.width = identityBox.width + 'px';
    identity.style.height = identityBox.height + 'px';
    identity.style.objectFit = 'contain';
    if (shouldUseLightIdentityFilter(asset.identityColor)) {
      identity.style.filter = 'brightness(0) saturate(100%) invert(85%)';
    }

    wrap.appendChild(cloak);
    wrap.appendChild(identity);
    appendPieceLabel(wrap, piece, showLabel);
    return wrap;
  }

  if (!src) return null;
  return null;
}
