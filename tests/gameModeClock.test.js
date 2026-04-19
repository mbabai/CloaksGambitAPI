const {
  getClockSettingsForMatchType,
  getPublicTimeSettings,
  getAllowedTimeControls,
} = require('../src/utils/gameModeClock');

describe('game mode clock settings', () => {
  const config = {
    gameModes: {
      QUICKPLAY: 'QUICKPLAY',
      RANKED: 'RANKED',
      CUSTOM: 'CUSTOM',
      AI: 'AI',
    },
    gameModeSettings: {
      QUICKPLAY: { TIME_CONTROL: 420000 },
      RANKED: { TIME_CONTROL: 185000 },
      CUSTOM: { TIME_CONTROL: 240 },
      INCREMENT: 4500,
    },
  };

  test('maps each match type to the expected base clock and increment', () => {
    expect(getClockSettingsForMatchType(config, 'QUICKPLAY')).toEqual(expect.objectContaining({
      settingsKey: 'QUICKPLAY',
      timeControl: 420000,
      increment: 4500,
    }));

    expect(getClockSettingsForMatchType(config, 'AI')).toEqual(expect.objectContaining({
      settingsKey: 'QUICKPLAY',
      timeControl: 420000,
      increment: 4500,
    }));

    expect(getClockSettingsForMatchType(config, 'RANKED')).toEqual(expect.objectContaining({
      settingsKey: 'RANKED',
      timeControl: 185000,
      increment: 4500,
    }));

    expect(getClockSettingsForMatchType(config, 'TOURNAMENT_ROUND_ROBIN')).toEqual(expect.objectContaining({
      settingsKey: 'RANKED',
      timeControl: 185000,
      increment: 4500,
    }));

    expect(getClockSettingsForMatchType(config, 'TOURNAMENT_ELIMINATION')).toEqual(expect.objectContaining({
      settingsKey: 'RANKED',
      timeControl: 185000,
      increment: 4500,
    }));

    expect(getClockSettingsForMatchType(config, 'CUSTOM')).toEqual(expect.objectContaining({
      settingsKey: 'CUSTOM',
      timeControl: 240000,
      increment: 4500,
    }));
  });

  test('falls back to quickplay when custom settings are absent', () => {
    const noCustom = {
      ...config,
      gameModeSettings: {
        QUICKPLAY: { TIME_CONTROL: 300000 },
        RANKED: { TIME_CONTROL: 180000 },
        INCREMENT: 3000,
      },
    };

    expect(getClockSettingsForMatchType(noCustom, 'CUSTOM')).toEqual(expect.objectContaining({
      settingsKey: 'CUSTOM',
      timeControl: 300000,
      increment: 3000,
    }));
  });

  test('builds normalized public settings and allowed clock bases', () => {
    expect(getPublicTimeSettings(config)).toEqual({
      quickplayMs: 420000,
      rankedMs: 185000,
      customMs: 240000,
      incrementMs: 4500,
    });

    expect(Array.from(getAllowedTimeControls(config)).sort((left, right) => left - right)).toEqual([
      185000,
      240000,
      420000,
    ]);
  });
});
