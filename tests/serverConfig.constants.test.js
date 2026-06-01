const ServerConfig = require('../src/models/ServerConfig');
const { GAME_CONSTANTS } = require('../shared/constants');

describe('ServerConfig constants alignment', () => {
  it('matches the shared GAME_CONSTANTS dataset', () => {
    const config = ServerConfig.getDefaultConfig();
    const configObject = config.toObject({
      versionKey: false,
      flattenMaps: true,
      transform: (_, ret) => {
        delete ret._id;
        delete ret.createdAt;
        delete ret.updatedAt;
        return ret;
      }
    });

    expect(configObject.announcementMarkdown).toBe('');
    expect(configObject.announcementFontSize).toBe(16);
    expect(configObject.announcementHeadingFontSizes).toEqual({ h1: 22, h2: 18, h3: 16 });
    delete configObject.announcementMarkdown;
    delete configObject.announcementFontSize;
    delete configObject.announcementHeadingFontSizes;
    expect(configObject).toEqual(GAME_CONSTANTS);
  });
});
