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
  width = 160,
  height = 96,
  fontSize = 20
}) {
  const existing = document.getElementById(id);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  if (!visible) return;

  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = text;
  btn.style.position = 'absolute';
  btn.style.left = Math.floor(boardLeft + (boardWidth / 2) - (width / 2)) + 'px';
  btn.style.top = Math.floor(boardTop + (boardHeight / 2) - (height / 2)) + 'px';
  btn.style.width = width + 'px';
  btn.style.height = height + 'px';
  btn.style.background = background;
  btn.style.border = '3px solid #DAA520';
  btn.style.color = '#fff';
  btn.style.fontWeight = '800';
  btn.style.fontSize = fontSize + 'px';
  btn.style.cursor = 'pointer';
  btn.style.zIndex = '5';
  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  root.appendChild(btn);
}


