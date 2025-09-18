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
  row.style.height = `${resolvedHeight}px`;
  row.style.display = 'flex';
  row.style.alignItems = 'center';
  row.style.justifyContent = orientation === 'top' ? 'flex-end' : 'flex-start';
  row.style.position = 'relative';
  row.style.width = '100%';

  const nameWrap = doc.createElement('div');
  nameWrap.style.display = 'inline-block';
  nameWrap.style.color = textColor;
  nameWrap.style.fontSize = `${clampNumber(fontSize, 14)}px`;
  nameWrap.style.fontWeight = fontWeight;
  nameWrap.style.zIndex = '0';
  nameWrap.style.whiteSpace = 'nowrap';
  nameWrap.textContent = name;

  const nameContent = doc.createElement('div');
  nameContent.style.display = 'flex';
  nameContent.style.alignItems = 'center';
  nameContent.style.gap = `${clampNumber(gap, 6)}px`;

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
    indicator.style.display = 'flex';
    indicator.style.alignItems = 'center';
    indicator.style.gap = '4px';

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
    countdown.style.fontFamily = connection.fontFamily || 'Courier New, monospace';
    countdown.style.fontWeight = connection.fontWeight || 'bold';
    countdown.style.fontSize = `${clampNumber(connection.fontSize, Math.max(12, Math.floor(fontSize * 0.9)))}`;
    countdown.style.color = connection.color || textColor;
    indicator.appendChild(countdown);

    nameContent.appendChild(indicator);
  }

  const winsCount = Math.max(0, Number(wins.count || 0));
  if (winsCount > 0 && typeof bannerAssets.createThroneIcon === 'function') {
    const winsWrap = doc.createElement('div');
    winsWrap.style.display = 'flex';
    winsWrap.style.alignItems = 'center';
    winsWrap.style.gap = `${clampNumber(wins.gap, 2)}px`;
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
  panel.style.width = `${resolvedWidth}px`;
  panel.style.height = `${resolvedHeight}px`;
  panel.style.display = 'flex';
  panel.style.alignItems = 'center';
  panel.style.justifyContent = 'center';
  panel.style.fontFamily = 'Courier New, monospace';
  panel.style.fontWeight = 'bold';
  panel.style.fontSize = `${resolvedFontSize}px`;
  panel.style.background = isLight ? lightBackground : darkBackground;
  panel.style.color = isLight ? lightText : darkText;
  panel.style.border = `2px solid ${borderColor}`;
  panel.style.borderRadius = '0';
  panel.style.boxSizing = 'border-box';
  panel.style.pointerEvents = 'none';
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
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.style.gap = `${clampNumber(gap, 6)}px`;

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
  bubble.style.position = 'absolute';
  bubble.style.left = '50%';
  bubble.style.top = '50%';
  const translate = offsetY ? ` translateY(${offsetY})` : '';
  bubble.style.transform = `translate(-50%, -50%)${translate}`;
  bubble.style.zIndex = String(zIndex);
  bubble.style.pointerEvents = 'none';
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
