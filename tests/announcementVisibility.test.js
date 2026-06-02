const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.join(__dirname, '..', 'public', 'index.js');

describe('site announcement visibility', () => {
  test('hides the announcement while the play area board is visible', () => {
    const source = fs.readFileSync(INDEX_PATH, 'utf8');

    expect(source).toContain('function syncSiteAnnouncementVisibility()');
    expect(source).toContain('siteAnnouncementEl.hidden = !hasAnnouncement || Boolean(isPlayAreaVisible);');
    expect(source).toContain('syncSiteAnnouncementVisibility();');
    expect(source).toMatch(/function showPlayArea\(\)[\s\S]*isPlayAreaVisible = true;[\s\S]*syncSiteAnnouncementVisibility\(\);/);
    expect(source).toMatch(/function hidePlayArea\(\)[\s\S]*isPlayAreaVisible = false;[\s\S]*syncSiteAnnouncementVisibility\(\);/);
  });
});
