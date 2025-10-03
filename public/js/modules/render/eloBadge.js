import { createEloBadgeIcon } from '../ui/icons.js';

export function createEloBadge({
  elo,
  size = 24,
  iconSrc = null,
  alt = 'Ranked Elo'
} = {}) {
  const baseSize = Math.max(10, Number(size) || 24);

  const hasNumericElo = Number.isFinite(elo);
  const displayText = hasNumericElo ? Math.round(elo).toString() : '—';
  const characterCount = Math.max(displayText.length, 1);

  const fontSize = Math.max(10, Math.floor(baseSize * 0.44));
  const estimatedTextWidth = Math.round(fontSize * characterCount * 0.62);
  const horizontalPadding = Math.round(baseSize * 0.48);
  const verticalPadding = Math.round(baseSize * 0.26);

  const badgeWidth = Math.max(Math.round(baseSize * 1.65), estimatedTextWidth + horizontalPadding);
  const badgeHeight = Math.max(Math.round(baseSize * 1.25), fontSize + verticalPadding * 2);
  const iconSize = Math.round(Math.max(badgeWidth, badgeHeight) * 1.05);

  const wrapper = document.createElement('span');
  wrapper.classList.add('cg-elo-badge');
  wrapper.style.setProperty('--cg-elo-badge-width', `${badgeWidth}px`);
  wrapper.style.setProperty('--cg-elo-badge-height', `${badgeHeight}px`);
  wrapper.style.setProperty('--cg-elo-badge-base-size', `${baseSize}px`);
  wrapper.style.setProperty(
    '--cg-elo-badge-padding',
    `${Math.max(0, Math.floor(verticalPadding * 0.25))}px ${Math.round(horizontalPadding * 0.18)}px`
  );

  let icon = null;
  if (iconSrc) {
    icon = document.createElement('img');
    icon.src = iconSrc;
    icon.alt = alt;
  } else {
    icon = createEloBadgeIcon({ alt });
  }
  icon.classList.add('cg-elo-badge__icon');
  icon.style.setProperty('--cg-elo-badge-icon-size', `${iconSize}px`);

  const text = document.createElement('span');
  text.textContent = displayText;
  text.classList.add('cg-elo-badge__value');
  text.style.setProperty('--cg-elo-badge-font-size', `${fontSize}px`);
  text.style.setProperty('--cg-elo-badge-value-padding', `0 ${Math.max(2, Math.round(horizontalPadding * 0.22))}px`);

  wrapper.appendChild(icon);
  wrapper.appendChild(text);
  return wrapper;
}
