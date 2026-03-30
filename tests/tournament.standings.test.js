const { buildRoundRobinStandings, computeArenaPoints } = require('../src/services/tournaments/standings');

describe('tournament standings helpers', () => {
  test('seed ordering uses arena points first and Buchholz as the first tie-break', () => {
    const players = [
      { userId: 'p1', username: 'One', preTournamentElo: 900, joinedAt: '2026-03-28T00:00:00.000Z' },
      { userId: 'p2', username: 'Two', preTournamentElo: 1000, joinedAt: '2026-03-28T00:00:01.000Z' },
      { userId: 'p3', username: 'Three', preTournamentElo: 850, joinedAt: '2026-03-28T00:00:02.000Z' },
      { userId: 'p4', username: 'Four', preTournamentElo: 800, joinedAt: '2026-03-28T00:00:03.000Z' },
    ];

    const games = [
      {
        phase: 'round_robin',
        status: 'completed',
        winner: 0,
        players: [{ userId: 'p1' }, { userId: 'p3' }],
      },
      {
        phase: 'round_robin',
        status: 'completed',
        winner: 0,
        players: [{ userId: 'p2' }, { userId: 'p4' }],
      },
      {
        phase: 'round_robin',
        status: 'completed',
        winner: null,
        players: [{ userId: 'p1' }, { userId: 'p2' }],
      },
      {
        phase: 'round_robin',
        status: 'completed',
        winner: 0,
        players: [{ userId: 'p3' }, { userId: 'p4' }],
      },
    ];

    const standings = buildRoundRobinStandings(players, games);
    expect(standings.ranked.map((entry) => entry.userId)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(standings.ranked.map((entry) => entry.computedSeed)).toEqual([1, 2, 3, 4]);
    expect(standings.byUserId.get('p1').points).toBe(1.5);
    expect(standings.byUserId.get('p2').points).toBe(1.5);
    expect(standings.byUserId.get('p1').buchholz).toBeGreaterThan(standings.byUserId.get('p2').buchholz);
  });

  test('arena points score wins as 1, draws as 0.5, and losses as 0', () => {
    expect(computeArenaPoints({ wins: 2, draws: 1, losses: 0 })).toBe(2.5);
    expect(computeArenaPoints({ wins: 0, draws: 2, losses: 3 })).toBe(1);
    expect(computeArenaPoints({ wins: 0, draws: 0, losses: 4 })).toBe(0);
  });

  test('unset stored seeds do not override computed standings seeds', () => {
    const standings = buildRoundRobinStandings(
      [
        { userId: 'p1', username: 'One', seed: null, preTournamentElo: 900 },
        { userId: 'p2', username: 'Two', seed: null, preTournamentElo: 800 },
      ],
      [
        {
          phase: 'round_robin',
          status: 'completed',
          winner: 0,
          players: [{ userId: 'p1' }, { userId: 'p2' }],
        },
      ],
    );

    expect(standings.byUserId.get('p1').storedSeed).toBeNull();
    expect(standings.ranked.map((entry) => entry.computedSeed)).toEqual([1, 2]);
  });
});
