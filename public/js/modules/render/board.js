import { IDENTITIES } from '../constants.js';

function resolveCssColor(scope, name, fallback) {
  try {
    const root = scope || document.documentElement;
    const value = getComputedStyle(root).getPropertyValue(name);
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  } catch (_) {}
  return fallback;
}

function getBoardPalette(scope) {
  return {
    lightSquare: resolveCssColor(scope, '--CG-white', '#f7efe1'),
    darkSquare: resolveCssColor(scope, '--CG-black', '#1a1026'),
    border: resolveCssColor(scope, '--CG-gray', '#65536f'),
    boardBorder: resolveCssColor(scope, '--CG-gray-light', '#9ca3af'),
    label: resolveCssColor(scope, '--CG-black', '#0c0612'),
    deploymentLine: resolveCssColor(scope, '--CG-deep-gold', '#cba135'),
    pendingMove: 'rgba(16, 185, 129, 0.30)',
    challengeRemoved: 'rgba(239, 68, 68, 0.40)',
    textureAlpha: 0.45,
    textureFallback: 'rgba(224, 224, 224, 0.16)',
    selectionGlow: 'rgba(255, 200, 0, 0.92)',
    sourceHighlight: 'rgba(255, 214, 102, 0.98)',
    sourceHighlightGlow: 'rgba(255, 215, 0, 0.42)',
    sourceHighlightShine: 'rgba(255, 255, 255, 0.95)',
  };
}

function getLoadedImage(imageCache, src) {
  if (!imageCache || !src) return null;
  try {
    return imageCache.getLoadedImage(src);
  } catch (_) {
    return null;
  }
}

function ensureImageLoaded(imageCache, src) {
  if (!imageCache || !src) return;
  try {
    imageCache.get(src);
  } catch (_) {}
}

function configureCanvas(canvas, width, height) {
  const cssWidth = Math.max(0, Math.round(width || 0));
  const cssHeight = Math.max(0, Math.round(height || 0));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const targetWidth = Math.max(1, Math.round(cssWidth * dpr));
  const targetHeight = Math.max(1, Math.round(cssHeight * dpr));

  if (canvas.width !== targetWidth) {
    canvas.width = targetWidth;
  }
  if (canvas.height !== targetHeight) {
    canvas.height = targetHeight;
  }

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  return dpr;
}

function drawTexture(ctx, imageCache, src, width, height, palette) {
  if (!src) return;
  ensureImageLoaded(imageCache, src);
  const texture = getLoadedImage(imageCache, src);
  ctx.save();
  ctx.globalAlpha = palette.textureAlpha;
  if (texture) {
    ctx.drawImage(texture, 0, 0, width, height);
  } else {
    ctx.fillStyle = palette.textureFallback;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

function drawSquareLabel(ctx, cell, labelFont, palette) {
  const fileLabel = cell.fileLabel || '';
  const rankLabel = cell.rankLabel || '';
  if (!fileLabel && !rankLabel) return;

  ctx.save();
  ctx.fillStyle = palette.label;
  ctx.font = `400 ${labelFont}px serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  if (rankLabel) {
    ctx.fillText(rankLabel, cell.x + 3, cell.y + 2);
  }
  if (fileLabel) {
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(fileLabel, cell.x + cell.width - 3, cell.y + cell.height - 3);
  }
  ctx.restore();
}

function drawPieceFallback(ctx, piece, x, y, size) {
  ctx.save();
  ctx.fillStyle = piece.color === 0 ? '#f9f5ea' : '#0f1117';
  ctx.beginPath();
  ctx.arc(x + (size / 2), y + (size / 2), size * 0.34, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = piece.color === 0 ? '#111827' : '#f9f5ea';
  ctx.lineWidth = Math.max(2, size * 0.05);
  ctx.stroke();
  ctx.restore();
}

function drawPieceImage(ctx, imageCache, identityMap, piece, x, y, size) {
  const src = identityMap?.[piece.identity]?.[piece.color];
  if (!src) {
    drawPieceFallback(ctx, piece, x, y, size);
    return;
  }
  ensureImageLoaded(imageCache, src);
  const image = getLoadedImage(imageCache, src);
  if (image) {
    ctx.drawImage(image, x, y, size, size);
    return;
  }
  drawPieceFallback(ctx, piece, x, y, size);
}

function drawMainPiece(ctx, imageCache, identityMap, cell, palette) {
  if (!cell.piece) return;
  const size = Math.floor(cell.width * 0.9);
  const x = cell.x + ((cell.width - size) / 2);
  const y = cell.y + ((cell.height - size) / 2);

  ctx.save();
  ctx.globalAlpha = Number.isFinite(cell.pieceOpacity) ? cell.pieceOpacity : 1;
  if (cell.selectedBottomPiece || cell.selectedBoardCell) {
    ctx.shadowColor = palette.selectionGlow;
    ctx.shadowBlur = Math.max(10, Math.floor(cell.width * 0.2));
  }
  drawPieceImage(ctx, imageCache, identityMap, cell.piece, x, y, size);
  ctx.restore();
}

function drawCapturedPiece(ctx, imageCache, identityMap, cell) {
  if (!cell.capturedPiece) return;
  const size = Math.floor(cell.width * 0.9);
  const rightOffset = cell.width * 0.15;
  const preserveVisibleIdentity = Number(cell.capturedPiece.identity) !== IDENTITIES.UNKNOWN;
  const clipBottom = preserveVisibleIdentity ? size * 0.52 : size * 0.32;

  ctx.save();
  ctx.translate(cell.centerX + rightOffset, cell.centerY - (cell.height * 0.04));
  ctx.rotate(Math.PI / 6);
  ctx.beginPath();
  ctx.rect(-size * 0.42, -size * 0.52, size * 0.84, clipBottom + (size * 0.52));
  ctx.clip();
  drawPieceImage(ctx, imageCache, identityMap, cell.capturedPiece, -size / 2, -size / 2, size);
  ctx.restore();
}

function drawCellBase(ctx, cell, palette) {
  ctx.save();
  ctx.fillStyle = cell.light ? palette.lightSquare : palette.darkSquare;
  ctx.fillRect(cell.x, cell.y, cell.width, cell.height);

  if (cell.highlight === 'pending-move') {
    ctx.fillStyle = palette.pendingMove;
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
  } else if (cell.highlight === 'challenge-removed') {
    ctx.fillStyle = palette.challengeRemoved;
    ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
  }
  ctx.restore();
}

function drawCellGrid(ctx, cell, palette) {
  ctx.save();
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(cell.x + 0.5, cell.y + 0.5, cell.width - 1, cell.height - 1);
  ctx.restore();
}

function drawLegalSourceUnderline(ctx, cell, palette) {
  if (!cell.legalSourceHighlight) return;

  const underlineWidth = cell.width * 0.68;
  const underlineHeight = Math.max(3, cell.height * 0.045);
  const underlineX = cell.centerX - (underlineWidth / 2);
  const underlineY = cell.y + (cell.height * 0.79);
  const shineWidth = underlineWidth * 0.36;
  const shineHeight = Math.max(6, underlineHeight * 2.2);
  const shineX = underlineX + (underlineWidth * 0.08);
  const shineY = underlineY - ((shineHeight - underlineHeight) / 2);

  ctx.save();
  ctx.fillStyle = palette.sourceHighlight;
  ctx.shadowColor = palette.sourceHighlightGlow;
  ctx.shadowBlur = Math.max(8, cell.width * 0.12);
  ctx.fillRect(underlineX, underlineY, underlineWidth, underlineHeight);
  ctx.restore();

  const shineGradient = ctx.createLinearGradient(shineX, 0, shineX + shineWidth, 0);
  shineGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
  shineGradient.addColorStop(0.5, palette.sourceHighlightShine);
  shineGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

  ctx.save();
  ctx.fillStyle = shineGradient;
  ctx.filter = 'blur(1px)';
  ctx.fillRect(shineX, shineY, shineWidth, shineHeight);
  ctx.restore();
}

function drawCellForeground(ctx, imageCache, identityMap, cell, labelFont, palette) {
  ctx.save();
  drawSquareLabel(ctx, cell, labelFont, palette);
  drawLegalSourceUnderline(ctx, cell, palette);
  if (cell.capturedPieceLayer !== 'front') {
    drawCapturedPiece(ctx, imageCache, identityMap, cell);
  }
  drawMainPiece(ctx, imageCache, identityMap, cell, palette);
  if (cell.capturedPieceLayer === 'front') {
    drawCapturedPiece(ctx, imageCache, identityMap, cell);
  }
  ctx.restore();
}

function drawBoardBorder(ctx, scene, palette) {
  ctx.save();
  ctx.strokeStyle = palette.boardBorder;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, scene.width - 1, scene.height - 1);
  ctx.restore();
}

function drawDeploymentLines(ctx, scene, palette) {
  if (!Array.isArray(scene.deploymentLines) || !scene.deploymentLines.length) {
    return;
  }
  const lineThickness = 4;
  ctx.save();
  ctx.fillStyle = palette.deploymentLine;
  scene.deploymentLines.forEach((lineModel) => {
    ctx.fillRect(0, lineModel.top, scene.width, lineThickness);
  });
  ctx.restore();
}

export function renderBoard({
  canvas,
  scene,
  identityMap,
  imageCache,
  scope,
} = {}) {
  if (!canvas || !scene) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = configureCanvas(canvas, scene.width, scene.height);
  const palette = getBoardPalette(scope || canvas);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  scene.cells.forEach((cell) => drawCellBase(ctx, cell, palette));
  drawTexture(ctx, imageCache, scene.boardTextureSrc, scene.width, scene.height, palette);
  scene.cells.forEach((cell) => drawCellGrid(ctx, cell, palette));
  drawBoardBorder(ctx, scene, palette);
  scene.cells.forEach((cell) => drawCellForeground(ctx, imageCache, identityMap, cell, scene.labelFont || 12, palette));
  drawDeploymentLines(ctx, scene, palette);
}
