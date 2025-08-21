export function pieceGlyph(piece, targetSize, identityMap) {
  if (!piece) return null;
  const el = document.createElement('div');
  const size = Math.floor(targetSize * 0.8);
  el.style.width = size + 'px';
  el.style.height = size + 'px';
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'center';
  el.style.position = 'relative';
  el.style.zIndex = '1';
  el.style.fontSize = Math.floor(size * 0.8) + 'px';
  const isBlack = piece.color === 1;
  el.style.background = isBlack ? '#000' : '#fff';
  el.style.color = isBlack ? '#fff' : '#000';
  el.textContent = identityMap?.[piece.identity] ?? '?';
  return el;
}
