import { createEloBadgeIcon } from '../ui/icons.js';

export function createEloBadge({
  elo,
  size = 24,
  iconSrc = null,
  alt = 'Ranked Elo'
} = {}) {
  const baseSize = Math.max(10, Number(size) || 24);
  const badgeWidth = Math.round(baseSize * 1.3);
  const badgeHeight = Math.round(baseSize * 1.05);

  const wrapper = document.createElement('span');
  wrapper.classList.add('cg-elo-badge');
  wrapper.style.setProperty('--cg-elo-badge-width', `${badgeWidth}px`);
  wrapper.style.setProperty('--cg-elo-badge-height', `${badgeHeight}px`);
  wrapper.style.setProperty('--cg-elo-badge-base-size', `${baseSize}px`);

  let icon = null;
  if (iconSrc) {
    icon = document.createElement('img');
    icon.src = iconSrc;
    icon.alt = alt;
  } else {
    icon = createEloBadgeIcon({ alt });
  }
  icon.classList.add('cg-elo-badge__icon');
  icon.style.setProperty('--cg-elo-badge-icon-size', `${Math.round(baseSize * 1.8)}px`);

  const text = document.createElement('span');
  const hasNumericElo = Number.isFinite(elo);
  text.textContent = hasNumericElo ? Math.round(elo).toString() : '—';
  text.classList.add('cg-elo-badge__value');
  text.style.setProperty('--cg-elo-badge-font-size', `${Math.max(9, Math.floor(baseSize * 0.42))}px`);

  wrapper.appendChild(icon);
  wrapper.appendChild(text);
  return wrapper;
}
