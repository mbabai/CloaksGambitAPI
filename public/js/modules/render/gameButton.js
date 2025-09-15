const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export function renderGameButton({
  id,
  root,
  boardLeft,
  boardTop,
  boardWidth,
  boardHeight,
  text,
  background,
  visible,
  onClick,
  width,
  height,
  fontSize
}) {
  const existing = document.getElementById(id);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  if (!visible) return;

  let resolvedWidth;
  if (typeof width === 'number' && !Number.isNaN(width)) {
    resolvedWidth = width;
  } else {
    const dims = [];
    if (typeof boardWidth === 'number' && boardWidth > 0) dims.push(boardWidth);
    if (typeof boardHeight === 'number' && boardHeight > 0) dims.push(boardHeight);
    let baseRef = dims.length ? Math.max(...dims) : 0;
    if (!baseRef && root) {
      const rootWidth = root.clientWidth || 0;
      const rootHeight = root.clientHeight || 0;
      baseRef = Math.max(rootWidth, rootHeight);
    }
    if (!baseRef) baseRef = 320;
    const computedWidth = clamp(Math.round(baseRef * 0.32), 80, 160);
    resolvedWidth = computedWidth;
  }

  let resolvedHeight;
  if (typeof height === 'number' && !Number.isNaN(height)) {
    resolvedHeight = height;
  } else {
    const computedHeight = clamp(Math.round(resolvedWidth * 0.6), 48, 96);
    resolvedHeight = computedHeight;
  }

  let resolvedFontSize;
  if (typeof fontSize === 'number' && !Number.isNaN(fontSize)) {
    resolvedFontSize = fontSize;
  } else {
    const computedFont = clamp(Math.round(resolvedHeight * 0.28), 13, 20);
    resolvedFontSize = computedFont;
  }

  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = text;
  btn.style.position = 'absolute';
  btn.style.left = Math.floor(boardLeft + (boardWidth / 2) - (resolvedWidth / 2)) + 'px';
  btn.style.top = Math.floor(boardTop + (boardHeight / 2) - (resolvedHeight / 2)) + 'px';
  btn.style.width = resolvedWidth + 'px';
  btn.style.height = resolvedHeight + 'px';
  btn.style.background = background;
  btn.style.border = '3px solid var(--CG-deep-gold)';
  btn.style.color = 'var(--CG-white)';
  btn.style.fontWeight = '800';
  btn.style.fontSize = resolvedFontSize + 'px';
  btn.style.cursor = 'pointer';
  btn.style.zIndex = '5';
  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  root.appendChild(btn);
}


