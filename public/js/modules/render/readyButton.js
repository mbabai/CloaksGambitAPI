export function renderReadyButton({
  root,
  boardLeft,
  boardTop,
  boardWidth,
  boardHeight,
  isVisible,
  onClick
}) {
  // Remove existing
  const existing = document.getElementById('setupReadyBtn');
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  if (!isVisible) return;

  const btn = document.createElement('button');
  btn.id = 'setupReadyBtn';
  btn.textContent = 'Ready!';
  btn.style.position = 'absolute';
  btn.style.left = Math.floor(boardLeft + (boardWidth / 2) - 80) + 'px';
  btn.style.top = Math.floor(boardTop + (boardHeight / 2) - 48) + 'px';
  btn.style.width = '160px';
  btn.style.height = '96px';
  btn.style.background = '#7c3aed';
  btn.style.border = '3px solid #DAA520';
  btn.style.color = '#fff';
  btn.style.fontWeight = '800';
  btn.style.fontSize = '20px';
  btn.style.cursor = 'pointer';
  btn.style.zIndex = '5';
  if (typeof onClick === 'function') btn.addEventListener('click', onClick);
  root.appendChild(btn);
}


