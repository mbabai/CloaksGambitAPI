const {
  getSpectateGameEndFreezeRemainingMs,
  isSpectateGameEndFreezeMatch,
  selectSpectateGame,
  SPECTATE_GAME_END_FREEZE_MS,
} = require('../src/utils/spectatorSnapshot');

describe('spectator snapshot game-end freeze', () => {
  test('keeps ranked spectators on the just-finished game during the freeze window', () => {
    const now = Date.parse('2026-05-24T12:00:05.000Z');
    const activeGame = { _id: 'next-game', isActive: true };
    const finishedGame = {
      _id: 'finished-game',
      isActive: false,
      endTime: new Date(now - 2000),
    };

    expect(isSpectateGameEndFreezeMatch({ type: 'RANKED' })).toBe(true);
    expect(getSpectateGameEndFreezeRemainingMs(finishedGame, { type: 'RANKED' }, now)).toBe(3000);
    expect(selectSpectateGame({
      match: { type: 'RANKED' },
      activeGame,
      finishedGame,
      now,
    })).toBe(finishedGame);
  });

  test('moves spectators to the active game after the freeze window expires', () => {
    const now = Date.parse('2026-05-24T12:00:05.001Z');
    const activeGame = { _id: 'next-game', isActive: true };
    const finishedGame = {
      _id: 'finished-game',
      isActive: false,
      endTime: new Date(now - SPECTATE_GAME_END_FREEZE_MS - 1),
    };

    expect(getSpectateGameEndFreezeRemainingMs(finishedGame, { type: 'TOURNAMENT_ELIMINATION' }, now)).toBe(0);
    expect(selectSpectateGame({
      match: { type: 'TOURNAMENT_ELIMINATION' },
      activeGame,
      finishedGame,
      now,
    })).toBe(activeGame);
  });

  test('does not freeze quickplay spectator snapshots', () => {
    const now = Date.parse('2026-05-24T12:00:01.000Z');
    const activeGame = { _id: 'quickplay-next', isActive: true };
    const finishedGame = {
      _id: 'quickplay-finished',
      isActive: false,
      endTime: new Date(now - 1000),
    };

    expect(isSpectateGameEndFreezeMatch({ type: 'QUICKPLAY' })).toBe(false);
    expect(selectSpectateGame({
      match: { type: 'QUICKPLAY' },
      activeGame,
      finishedGame,
      now,
    })).toBe(activeGame);
  });
});
