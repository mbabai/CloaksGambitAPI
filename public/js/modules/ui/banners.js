/**
 * Banner layout primitives used by the board HUD and summary overlays.
 *
 * All helpers are pure: they accept the document instance plus data and asset
 * factories, then return detached DOM nodes. Callers are responsible for
 * positioning and mounting the returned elements.
 */
import { createEloBadge as defaultCreateEloBadge } from '../render/eloBadge.js';
import {
  createThroneIcon as defaultCreateThroneIcon,
  createDaggerToken as defaultCreateDaggerToken,
  createReconnectSpinner as defaultCreateReconnectSpinner,
  createChallengeBubble as defaultCreateChallengeBubble
} from './icons.js';

const DEFAULT_BANNER_ASSETS = Object.freeze({
  createEloBadge: defaultCreateEloBadge,
  createThroneIcon: defaultCreateThroneIcon,
  createDaggerToken: defaultCreateDaggerToken,
  createReconnectSpinner: defaultCreateReconnectSpinner,
  createChallengeBubble: defaultCreateChallengeBubble
});

const BANNER_CLASS = 'cg-banner';
const BANNER_VARIANT_PREFIX = `${BANNER_CLASS}--`;

function resolveBannerAssets(overrides) {
  if (!overrides) return DEFAULT_BANNER_ASSETS;
  return { ...DEFAULT_BANNER_ASSETS, ...overrides };
}

function clampNumber(value, fallback) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function createDocument(documentRef) {
  return documentRef && typeof documentRef.createElement === 'function'
    ? documentRef
    : document;
}

function clearBannerVariants(node) {
  if (!node || !node.classList) return;
  Array.from(node.classList).forEach((className) => {
    if (className.startsWith(BANNER_VARIANT_PREFIX)) {
      node.classList.remove(className);
    }
  });
}

function toVariantList(variant) {
  if (!variant) return [];
  if (Array.isArray(variant)) {
    return variant.flatMap(toVariantList).filter(Boolean);
  }
  return [String(variant).trim()].filter(Boolean);
}

export function applyBannerVariant(node, variant) {
  if (!node) return;
  if (!node.classList.contains(BANNER_CLASS)) {
    node.classList.add(BANNER_CLASS);
  }
  clearBannerVariants(node);
  toVariantList(variant).forEach((name) => {
    node.classList.add(`${BANNER_VARIANT_PREFIX}${name}`);
  });
}

export function createBanner({ documentRef, text = '', variant, icon } = {}) {
  const doc = createDocument(documentRef);
  const banner = doc.createElement('div');
  banner.classList.add(BANNER_CLASS);
  toVariantList(variant).forEach((name) => {
    banner.classList.add(`${BANNER_VARIANT_PREFIX}${name}`);
  });
  if (icon) {
    banner.appendChild(icon);
  }
  if (text) {
    banner.appendChild(doc.createTextNode(text));
  }
  return banner;
}

export function setBannerState(banner, { text, variant, icon, hidden } = {}) {
  if (!banner) return;
  applyBannerVariant(banner, variant);
  while (banner.firstChild) {
    banner.removeChild(banner.firstChild);
  }
  if (icon) {
    banner.appendChild(icon);
  }
  if (text) {
    banner.appendChild(banner.ownerDocument.createTextNode(text));
  }
  if (hidden !== undefined) {
    banner.hidden = Boolean(hidden);
  } else {
    banner.hidden = !text;
  }
}

/**
 * Returns an unmounted name row element containing the player label, Elo badge,
 * reconnect indicator, and optional victory tokens.
 */
export function createNameRow({
  documentRef,
  assets,
  name = '',
  orientation = 'bottom',
  height = 24,
  fontSize = 16,
  textColor = 'var(--CG-white)',
  fontWeight = 'bold',
  gap = 6,
  isRankedMatch = false,
  elo = null,
  wins = {},
  connection = null
} = {}) {
  const doc = createDocument(documentRef);
  const bannerAssets = resolveBannerAssets(assets);

  const row = doc.createElement('div');
  const resolvedHeight = Math.max(0, Math.round(clampNumber(height, 24)));
  row.classList.add('cg-name-row');
  row.classList.add(orientation === 'top' ? 'cg-name-row--top' : 'cg-name-row--bottom');
  row.style.setProperty('--cg-name-row-height', `${resolvedHeight}px`);

  const nameWrap = doc.createElement('div');
  nameWrap.classList.add('cg-name-row__label');
  nameWrap.style.setProperty('--cg-name-row-color', textColor);
  nameWrap.style.setProperty('--cg-name-row-font-size', `${clampNumber(fontSize, 14)}px`);
  nameWrap.style.setProperty('--cg-name-row-font-weight', fontWeight);
  nameWrap.textContent = name;

  const nameContent = doc.createElement('div');
  nameContent.classList.add('cg-name-row__content');
  nameContent.style.setProperty('--cg-name-row-gap', `${clampNumber(gap, 6)}px`);

  let badge = null;
  if (isRankedMatch && typeof bannerAssets.createEloBadge === 'function') {
    const badgeSize = Math.max(16, Math.floor(resolvedHeight * 0.9));
    badge = bannerAssets.createEloBadge({ elo, size: badgeSize });
  }

  if (badge) {
    if (orientation === 'top') {
      nameContent.appendChild(nameWrap);
      nameContent.appendChild(badge);
    } else {
      nameContent.appendChild(badge);
      nameContent.appendChild(nameWrap);
    }
  } else {
    nameContent.appendChild(nameWrap);
  }

  if (connection && Number.isFinite(connection.displaySeconds)) {
    const indicator = doc.createElement('div');
    indicator.classList.add('cg-name-row__connection');

    const indicatorSize = Math.max(12, Math.floor(resolvedHeight * 0.75));
    if (typeof bannerAssets.createReconnectSpinner === 'function') {
      const spinner = bannerAssets.createReconnectSpinner({
        size: connection.size || indicatorSize,
        alt: connection.alt || 'Opponent reconnecting',
        title: connection.title
      });
      indicator.appendChild(spinner);
    }

    const countdown = doc.createElement('span');
    const seconds = Math.max(0, Math.floor(connection.displaySeconds));
    const formatter = typeof connection.formatSeconds === 'function'
      ? connection.formatSeconds
      : value => String(value).padStart(2, '0');
    countdown.textContent = formatter(seconds);
    countdown.classList.add('cg-name-row__countdown');
    countdown.style.setProperty(
      '--cg-name-row-countdown-font-family',
      connection.fontFamily || 'Courier New, monospace'
    );
    countdown.style.setProperty(
      '--cg-name-row-countdown-font-weight',
      connection.fontWeight || 'bold'
    );
    countdown.style.setProperty(
      '--cg-name-row-countdown-font-size',
      `${clampNumber(connection.fontSize, Math.max(12, Math.floor(fontSize * 0.9)))}`
    );
    countdown.style.setProperty('--cg-name-row-countdown-color', connection.color || textColor);
    indicator.appendChild(countdown);

    nameContent.appendChild(indicator);
  }

  const winsCount = Math.max(0, Number(wins.count || 0));
  if (winsCount > 0 && typeof bannerAssets.createThroneIcon === 'function') {
    const winsWrap = doc.createElement('div');
    winsWrap.classList.add('cg-name-row__wins');
    winsWrap.style.setProperty('--cg-name-row-wins-gap', `${clampNumber(wins.gap, 2)}px`);
    const trophySize = Math.max(12, Math.floor(resolvedHeight * 0.9));
    for (let i = 0; i < winsCount; i += 1) {
      const throne = bannerAssets.createThroneIcon({
        size: wins.size || trophySize,
        alt: wins.alt || 'Match victory',
        title: wins.title
      });
      winsWrap.appendChild(throne);
    }
    if (orientation === 'top') {
      if (wins.margin != null) {
        winsWrap.style.marginRight = typeof wins.margin === 'number' ? `${wins.margin}px` : wins.margin;
      }
      row.appendChild(winsWrap);
      row.appendChild(nameContent);
    } else {
      if (wins.margin != null) {
        winsWrap.style.marginLeft = typeof wins.margin === 'number' ? `${wins.margin}px` : wins.margin;
      }
      row.appendChild(nameContent);
      row.appendChild(winsWrap);
    }
  } else {
    row.appendChild(nameContent);
  }

  return row;
}

/**
 * Creates a monospaced clock panel with the provided text value.
 */
export function createClockPanel({
  documentRef,
  text = '0:00',
  width,
  height = 24,
  fontSize,
  isLight = false,
  label,
  borderColor = 'var(--CG-deep-gold)',
  lightBackground = 'var(--CG-white)',
  darkBackground = 'var(--CG-black)',
  lightText = 'var(--CG-black)',
  darkText = 'var(--CG-white)'
} = {}) {
  const doc = createDocument(documentRef);
  const resolvedHeight = Math.max(0, Math.round(clampNumber(height, 24)));
  const resolvedWidth = Number.isFinite(width) ? Math.max(0, Math.round(width)) : Math.round(resolvedHeight * 2.9);
  const resolvedFontSize = clampNumber(fontSize, Math.max(12, Math.floor(resolvedHeight * 0.6)));

  const panel = doc.createElement('div');
  panel.classList.add('cg-clock-panel');
  panel.style.setProperty('--cg-clock-panel-width', `${resolvedWidth}px`);
  panel.style.setProperty('--cg-clock-panel-height', `${resolvedHeight}px`);
  panel.style.setProperty('--cg-clock-panel-font-size', `${resolvedFontSize}px`);
  panel.style.setProperty('--cg-clock-panel-border', borderColor);
  panel.style.setProperty(
    '--cg-clock-panel-background',
    isLight ? lightBackground : darkBackground
  );
  panel.style.setProperty(
    '--cg-clock-panel-color',
    isLight ? lightText : darkText
  );
  panel.textContent = text;
  if (label) {
    panel.title = label;
  }

  return panel;
}

/**
 * Returns a flex wrapper filled with dagger token icons. Count values under 1
 * return an empty wrapper so layout spacing remains consistent.
 */
export function createDaggerCounter({
  documentRef,
  assets,
  count = 0,
  size,
  gap = 6,
  alt = 'Dagger token',
  label = '⚔',
  title
} = {}) {
  const doc = createDocument(documentRef);
  const bannerAssets = resolveBannerAssets(assets);
  const wrapper = doc.createElement('div');
  wrapper.classList.add('cg-dagger-counter');
  wrapper.style.setProperty('--cg-dagger-counter-gap', `${clampNumber(gap, 6)}px`);

  const total = Math.max(0, Number(count));
  if (!total || typeof bannerAssets.createDaggerToken !== 'function') {
    return wrapper;
  }

  const tokenSize = clampNumber(size, 24);
  for (let i = 0; i < total; i += 1) {
    const token = bannerAssets.createDaggerToken({ size: tokenSize, alt, label, title });
    if (token) {
      wrapper.appendChild(token);
    }
  }

  return wrapper;
}

/**
 * Generates a positioned challenge bubble image ready to be layered on top of a
 * banner row.
 */
export function createChallengeBubbleElement({
  documentRef,
  assets,
  position = 'top',
  size,
  alt = 'Challenge available',
  offsetY = '0%',
  zIndex = 10
} = {}) {
  const doc = createDocument(documentRef);
  const bannerAssets = resolveBannerAssets(assets);
  if (typeof bannerAssets.createChallengeBubble !== 'function') {
    return null;
  }
  const bubble = bannerAssets.createChallengeBubble({ position, size, alt });
  if (!bubble) {
    return null;
  }
  bubble.classList.add('cg-challenge-bubble');
  const offsetValue = typeof offsetY === 'number' ? `${offsetY}px` : offsetY || '0';
  bubble.style.setProperty('--cg-challenge-bubble-offset-y', offsetValue);
  bubble.style.setProperty('--cg-challenge-bubble-z-index', String(zIndex));
  if (Number.isFinite(size)) {
    bubble.style.width = `${Math.max(0, Math.round(size))}px`;
    bubble.style.height = `${Math.max(0, Math.round(size))}px`;
  }
  return bubble;
}

/**
 * Utility helper that clones the default banner asset factories and applies any
 * overrides. Useful when callers want a stable reference they can reuse across
 * multiple renders.
 */
export function createBannerAssets(overrides = {}) {
  return resolveBannerAssets(overrides);
}
