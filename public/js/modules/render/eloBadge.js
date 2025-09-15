export function createEloBadge({
  elo,
  size = 24,
  iconSrc = '/assets/images/rankIcon.png',
  alt = 'Ranked Elo'
} = {}) {
  const baseSize = Math.max(10, Number(size) || 24);
  const badgeWidth = Math.round(baseSize * 1.3);
  const badgeHeight = Math.round(baseSize * 1.05);

  const wrapper = document.createElement('span');
  wrapper.className = 'elo-badge';
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.justifyContent = 'center';
  wrapper.style.width = `${badgeWidth}px`;
  wrapper.style.height = `${badgeHeight}px`;
  wrapper.style.boxSizing = 'border-box';
  wrapper.style.padding = '0 4px';
  wrapper.style.flexShrink = '0';
  wrapper.style.overflow = 'visible';

  const img = document.createElement('img');
  img.src = iconSrc;
  img.alt = alt;
  img.style.position = 'absolute';
  img.style.width = `${Math.round(baseSize * 1.8)}px`;
  img.style.height = `${Math.round(baseSize * 1.8)}px`;
  img.style.display = 'block';
  img.style.top = '50%';
  img.style.left = '50%';
  img.style.transform = 'translate(-50%, -50%)';
  img.style.pointerEvents = 'none';

  const text = document.createElement('span');
  const hasNumericElo = Number.isFinite(elo);
  text.textContent = hasNumericElo ? Math.round(elo).toString() : '—';
  text.style.position = 'relative';
  text.style.zIndex = '1';
  text.style.color = '#ffd700';
  text.style.fontWeight = '400';
  text.style.fontSize = `${Math.max(9, Math.floor(baseSize * 0.42))}px`;
  text.style.lineHeight = '1';
  text.style.letterSpacing = '-0.25px';
  text.style.textAlign = 'center';
  text.style.padding = '0 2px';
  text.style.textShadow = '0 0 4px rgba(0, 0, 0, 0.85)';
  text.style.userSelect = 'none';
  text.style.pointerEvents = 'none';

  wrapper.appendChild(img);
  wrapper.appendChild(text);
  return wrapper;
}
