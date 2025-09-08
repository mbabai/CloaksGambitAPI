export function pieceGlyph(piece, targetSize, identityMap) {
  if (!piece) return null;
  const size = Math.floor(targetSize * 0.8);
  const src = identityMap?.[piece.identity]?.[piece.color];
  if (!src) return null;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.style.width = size + 'px';
  img.style.height = size + 'px';
  img.style.objectFit = 'contain';
  return img;
}
