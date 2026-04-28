export const PROCEDURAL_IDENTITY_ASPECT = Object.freeze({
  width: 210,
  height: 250
});

export const PROCEDURAL_IDENTITY_PLACEMENT = Object.freeze({
  scale: 0.58,
  x: 0.5,
  y: 0.59
});

export function getIdentityRenderBox(pieceSize, scale) {
  const maxHeight = Math.max(1, Number(pieceSize || 0) * Number(scale || 0));
  const aspectRatio = PROCEDURAL_IDENTITY_ASPECT.width / PROCEDURAL_IDENTITY_ASPECT.height;
  return {
    width: Math.max(1, Math.floor(maxHeight * aspectRatio)),
    height: Math.max(1, Math.floor(maxHeight))
  };
}

export function resolvePieceAsset(piece, identityMap) {
  if (!piece) return null;
  return identityMap?.[piece.identity]?.[piece.color] || null;
}

export function getSinglePieceSrc(asset) {
  if (typeof asset === 'string') return asset;
  if (asset && typeof asset.src === 'string') return asset.src;
  return null;
}

export function isProceduralPieceAsset(asset) {
  return Boolean(
    asset
    && typeof asset === 'object'
    && asset.kind === 'procedural'
    && typeof asset.cloak === 'string'
    && typeof asset.identity === 'string'
  );
}

export function getProceduralIdentityPlacement(asset = {}) {
  const placement = asset.identityPlacement || {};
  const scale = Number.isFinite(Number(placement.scale))
    ? Number(placement.scale)
    : PROCEDURAL_IDENTITY_PLACEMENT.scale;
  const x = Number.isFinite(Number(placement.x))
    ? Number(placement.x)
    : PROCEDURAL_IDENTITY_PLACEMENT.x;
  const y = Number.isFinite(Number(placement.y))
    ? Number(placement.y)
    : PROCEDURAL_IDENTITY_PLACEMENT.y;

  return {
    scale: Math.max(0.1, Math.min(1, scale)),
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y))
  };
}

export function getPieceAssetSources(asset) {
  if (!asset) return [];
  const singleSrc = getSinglePieceSrc(asset);
  if (singleSrc) return [singleSrc];
  if (isProceduralPieceAsset(asset)) {
    return [asset.cloak, asset.identity];
  }
  return [];
}
