const Game = require('../src/models/Game');

describe('Game.create startTime scheduling', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    await Game.deleteMany({});
  });

  afterEach(async () => {
    await Game.deleteMany({});
    jest.useRealTimers();
  });

  test('non-accept games start their clock after the match-found countdown', async () => {
    const game = await Game.create({
      players: ['player-1', 'player-2'],
      match: 'match-1',
      timeControlStart: 300000,
      increment: 3000,
    });

    expect(game.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(game.startTime.toISOString()).toBe('2024-01-01T00:00:03.000Z');
  });

  test('accept-required games keep startTime unset until players accept', async () => {
    const game = await Game.create({
      players: ['player-1', 'player-2'],
      match: 'match-2',
      timeControlStart: 300000,
      increment: 3000,
      requiresAccept: true,
      acceptWindowSeconds: 30,
    });

    expect(game.startTime).toBeNull();
  });
});
