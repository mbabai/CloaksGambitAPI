const {
  getTournamentAcceptWindowSeconds,
  shouldRequireTournamentMatchAccept,
} = require('../src/utils/tournamentAccept');

describe('tournament accept window helpers', () => {
  test('keeps round robin accept windows at thirty seconds', () => {
    const match = { type: 'TOURNAMENT_ROUND_ROBIN' };

    expect(shouldRequireTournamentMatchAccept(match)).toBe(true);
    expect(getTournamentAcceptWindowSeconds(match, true)).toBe(30);
  });

  test('uses one hundred twenty seconds for the first elimination game', () => {
    const match = {
      type: 'TOURNAMENT_ELIMINATION',
      player1Score: 0,
      player2Score: 0,
      drawCount: 0,
    };

    expect(shouldRequireTournamentMatchAccept(match)).toBe(true);
    expect(getTournamentAcceptWindowSeconds(match, true)).toBe(120);
  });

  test('uses a match-specific accept window when provided', () => {
    const match = {
      type: 'TOURNAMENT_ROUND_ROBIN',
      acceptWindowSeconds: 45,
    };

    expect(getTournamentAcceptWindowSeconds(match, true)).toBe(45);
  });

  test('does not require accept after an elimination series has started', () => {
    const match = {
      type: 'TOURNAMENT_ELIMINATION',
      player1Score: 1,
      player2Score: 0,
      drawCount: 0,
    };

    expect(shouldRequireTournamentMatchAccept(match)).toBe(false);
    expect(getTournamentAcceptWindowSeconds(match, false)).toBe(0);
  });
});
