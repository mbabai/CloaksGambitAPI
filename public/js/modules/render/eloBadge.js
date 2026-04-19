import { createEloBadgeIcon, getIconAsset } from '../ui/icons.js';

function normalizeBadgeVariant(value) {
  return String(value || 'dark').toLowerCase() === 'light' ? 'light' : 'dark';
}

export function createEloBadge({
  elo,
  size = 24,
  variant = 'dark',
  iconSrc = null,
  alt = 'Ranked Elo',
  title = null,
} = {}) {
  const baseSize = Math.max(10, Number(size) || 24);
  const resolvedVariant = normalizeBadgeVariant(variant);

  const hasNumericElo = Number.isFinite(elo);
  const displayText = hasNumericElo ? Math.round(elo).toString() : '\u2014';
  const characterCount = Math.max(displayText.length, 1);

  const fontSize = Math.max(10, Math.floor(baseSize * 0.44));
  const estimatedTextWidth = Math.round(fontSize * characterCount * 0.62);
  const horizontalPadding = Math.round(baseSize * 0.42);
  const verticalPadding = Math.round(baseSize * 0.22);

  const badgeWidth = Math.max(Math.round(baseSize * 1.55), estimatedTextWidth + horizontalPadding);
  const badgeHeight = Math.max(Math.round(baseSize * 1.18), fontSize + verticalPadding * 2);
  const iconSize = Math.round(Math.max(badgeWidth, badgeHeight) * 1.02);

  const wrapper = document.createElement('span');
  wrapper.classList.add('cg-elo-badge', `cg-elo-badge--${resolvedVariant}`);
  wrapper.style.setProperty('--cg-elo-badge-width', `${badgeWidth}px`);
  wrapper.style.setProperty('--cg-elo-badge-height', `${badgeHeight}px`);
  wrapper.style.setProperty('--cg-elo-badge-base-size', `${baseSize}px`);
  wrapper.style.setProperty(
    '--cg-elo-badge-padding',
    `${Math.max(0, Math.floor(verticalPadding * 0.22))}px ${Math.round(horizontalPadding * 0.16)}px`
  );
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', `${alt}: ${displayText}`);
  if (title) {
    wrapper.title = title;
  }

  const resolvedIconSrc = iconSrc || getIconAsset('rank');
  let icon = null;
  if (resolvedIconSrc) {
    icon = document.createElement('span');
    icon.setAttribute('aria-hidden', 'true');
    icon.style.setProperty('--cg-elo-badge-icon-url', `url("${resolvedIconSrc}")`);
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
