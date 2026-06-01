const express = require('express');
const router = express.Router();

const ServerConfig = require('../../../models/ServerConfig');
const eventBus = require('../../../eventBus');
const getServerConfig = require('../../../utils/getServerConfig');
const { ensureAdminRequest } = require('../../../utils/adminAccess');
const {
  MAX_ANNOUNCEMENT_MARKDOWN_LENGTH,
  MIN_ANNOUNCEMENT_FONT_SIZE,
  MAX_ANNOUNCEMENT_FONT_SIZE,
  buildAnnouncementPayload,
  normalizeAnnouncementFontSize,
  normalizeAnnouncementHeadingFontSizes,
  normalizeAnnouncementMarkdown,
  resolveAnnouncementFontSize,
  resolveAnnouncementHeadingFontSizes,
} = require('../../../utils/announcement');

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

router.get('/', async (req, res) => {
  try {
    const config = await getServerConfig();
    res.json(buildAnnouncementPayload(config));
  } catch (err) {
    console.error('Error serving announcement config:', err);
    res.status(500).json({ message: 'Failed to load announcement' });
  }
});

router.post('/', async (req, res) => {
  try {
    const adminSession = await ensureAdminRequest(req, res);
    if (!adminSession) return;

    const markdown = normalizeAnnouncementMarkdown(req.body?.markdown);
    if (markdown === null) {
      res.status(400).json({ message: 'markdown must be a string' });
      return;
    }
    if (markdown.length > MAX_ANNOUNCEMENT_MARKDOWN_LENGTH) {
      res.status(400).json({
        message: `markdown must be ${MAX_ANNOUNCEMENT_MARKDOWN_LENGTH} characters or fewer`,
        maxLength: MAX_ANNOUNCEMENT_MARKDOWN_LENGTH,
      });
      return;
    }

    const hasFontSize = hasOwn(req.body, 'fontSize');
    const providedFontSize = hasFontSize
      ? normalizeAnnouncementFontSize(req.body.fontSize)
      : null;
    if (hasFontSize && !providedFontSize) {
      res.status(400).json({
        message: `fontSize must be a number between ${MIN_ANNOUNCEMENT_FONT_SIZE} and ${MAX_ANNOUNCEMENT_FONT_SIZE}`,
        minFontSize: MIN_ANNOUNCEMENT_FONT_SIZE,
        maxFontSize: MAX_ANNOUNCEMENT_FONT_SIZE,
      });
      return;
    }

    const hasHeadingFontSizes = hasOwn(req.body, 'headingFontSizes');
    const providedHeadingFontSizes = hasHeadingFontSizes
      ? normalizeAnnouncementHeadingFontSizes(req.body.headingFontSizes)
      : null;
    if (hasHeadingFontSizes && !providedHeadingFontSizes) {
      res.status(400).json({
        message: `headingFontSizes must contain h1, h2, and h3 numbers between ${MIN_ANNOUNCEMENT_FONT_SIZE} and ${MAX_ANNOUNCEMENT_FONT_SIZE}`,
        minFontSize: MIN_ANNOUNCEMENT_FONT_SIZE,
        maxFontSize: MAX_ANNOUNCEMENT_FONT_SIZE,
      });
      return;
    }

    const config = await ServerConfig.getSingleton();
    config.announcementMarkdown = markdown;
    config.announcementFontSize = hasFontSize
      ? providedFontSize
      : resolveAnnouncementFontSize(config.announcementFontSize);
    config.announcementHeadingFontSizes = hasHeadingFontSizes
      ? providedHeadingFontSizes
      : resolveAnnouncementHeadingFontSizes(config.announcementHeadingFontSizes);
    await config.save();

    const refreshedConfig = await getServerConfig.refreshServerConfig();
    const payload = buildAnnouncementPayload(refreshedConfig);
    eventBus.emit('announcementChanged', payload);
    res.json(payload);
  } catch (err) {
    console.error('Error updating announcement config:', err);
    res.status(500).json({ message: 'Failed to update announcement' });
  }
});

module.exports = router;
