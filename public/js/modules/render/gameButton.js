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
  onClick
}) {
  const existing = document.getElementById(id);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  if (!visible) return;

  const btn = document.createElement('button');
  btn.id = id;
  btn.textContent = text;
  btn.style.position = 'absolute';
  btn.style.left = Math.floor(boardLeft + (boardWidth / 2) - 80) + 'px';
  btn.style.top = Math.floor(boardTop + (boardHeight / 2) - 48) + 'px';
  btn.style.width = '160px';
  btn.style.height = '96px';
  btn.style.background = background;
  btn.style.border = '3px solid #DAA520';
  btn.style.color = '#fff';
  btn.style.fontWeight = '800';
  btn.style.fontSize = '20px';
  btn.style.cursor = 'pointer';
  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  root.appendChild(btn);
}


