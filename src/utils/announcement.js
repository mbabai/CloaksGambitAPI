const MAX_ANNOUNCEMENT_MARKDOWN_LENGTH = 5000;
const DEFAULT_ANNOUNCEMENT_FONT_SIZE = 16;
const DEFAULT_ANNOUNCEMENT_HEADING_FONT_SIZES = Object.freeze({
  h1: 22,
  h2: 18,
  h3: 16,
});
const MIN_ANNOUNCEMENT_FONT_SIZE = 12;
const MAX_ANNOUNCEMENT_FONT_SIZE = 32;
const ANNOUNCEMENT_HEADING_FONT_SIZE_KEYS = Object.freeze(['h1', 'h2', 'h3']);

function normalizeAnnouncementMarkdown(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value !== 'string') {
    return null;
  }
  return value.replace(/\r\n?/g, '\n').replace(/^\s*\n|\n\s*$/g, '');
}

function normalizeAnnouncementFontSize(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  if (numeric < MIN_ANNOUNCEMENT_FONT_SIZE || numeric > MAX_ANNOUNCEMENT_FONT_SIZE) {
    return null;
  }
  return Math.round(numeric);
}

function resolveAnnouncementFontSize(value) {
  return normalizeAnnouncementFontSize(value) || DEFAULT_ANNOUNCEMENT_FONT_SIZE;
}

function normalizeAnnouncementHeadingFontSizes(value, fallback = DEFAULT_ANNOUNCEMENT_HEADING_FONT_SIZES) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const normalized = {};
  for (const key of ANNOUNCEMENT_HEADING_FONT_SIZE_KEYS) {
    const rawSize = Object.prototype.hasOwnProperty.call(value, key)
      ? value[key]
      : fallback[key];
    const fontSize = normalizeAnnouncementFontSize(rawSize);
    if (!fontSize) {
      return null;
    }
    normalized[key] = fontSize;
  }
  return normalized;
}

function resolveAnnouncementHeadingFontSizes(value) {
  return normalizeAnnouncementHeadingFontSizes(value) || { ...DEFAULT_ANNOUNCEMENT_HEADING_FONT_SIZES };
}

function buildAnnouncementPayload(configLike = {}) {
  return {
    markdown: normalizeAnnouncementMarkdown(configLike.announcementMarkdown) || '',
    fontSize: resolveAnnouncementFontSize(configLike.announcementFontSize),
    headingFontSizes: resolveAnnouncementHeadingFontSizes(configLike.announcementHeadingFontSizes),
    minFontSize: MIN_ANNOUNCEMENT_FONT_SIZE,
    maxFontSize: MAX_ANNOUNCEMENT_FONT_SIZE,
    maxLength: MAX_ANNOUNCEMENT_MARKDOWN_LENGTH,
    updatedAt: configLike.updatedAt || null,
  };
}

module.exports = {
  MAX_ANNOUNCEMENT_MARKDOWN_LENGTH,
  DEFAULT_ANNOUNCEMENT_FONT_SIZE,
  DEFAULT_ANNOUNCEMENT_HEADING_FONT_SIZES,
  MIN_ANNOUNCEMENT_FONT_SIZE,
  MAX_ANNOUNCEMENT_FONT_SIZE,
  ANNOUNCEMENT_HEADING_FONT_SIZE_KEYS,
  normalizeAnnouncementMarkdown,
  normalizeAnnouncementFontSize,
  normalizeAnnouncementHeadingFontSizes,
  resolveAnnouncementFontSize,
  resolveAnnouncementHeadingFontSizes,
  buildAnnouncementPayload,
};
