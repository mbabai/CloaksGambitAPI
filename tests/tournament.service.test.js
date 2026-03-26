jest.mock('../src/utils/ensureUser', () => jest.fn(async (userId) => ({
  userId: userId || '000000000000000000000111',
  username: 'EnsuredUser',
  isGuest: true,
})));

jest.mock('../src/services/bots/registry', () => ({
  ensureBotUser: jest.fn(async (difficulty = 'easy') => ({
    user: {
      _id: difficulty === 'medium' ? '000000000000000000000222' : '000000000000000000000221',
      username: `${difficulty}-bot`,
    },
  })),
  listBuiltinBotCatalog: jest.fn(() => [
    { id: 'easy', label: 'Easy', playable: true },
    { id: 'medium', label: 'Medium', playable: true },
  ]),
  getBuiltinBotDefinition: jest.fn((input) => {
    if (String(input).toLowerCase() === 'medium') return { id: 'medium', label: 'Medium', playable: true };
    if (String(input).toLowerCase() === 'easy') return { id: 'easy', label: 'Easy', playable: true };
    return null;
  }),
  normalizeBuiltinBotId: jest.fn((input) => {
    const lowered = String(input || '').toLowerCase();
    return lowered === 'medium' ? 'medium' : lowered === 'easy' ? 'easy' : '';
  }),
}));

const {
  resetForTests,
  createTournament,
  joinTournamentAsPlayer,
  joinTournamentAsViewer,
  leaveTournament,
  addBotToTournament,
  kickTournamentPlayer,
  reallowTournamentPlayer,
  startTournament,
  listTournamentGames,
  listLiveTournaments,
  consumeTournamentAlerts,
} = require('../src/services/tournaments/liveTournaments');

describe('live tournaments service', () => {
  beforeEach(() => {
    resetForTests();
  });

  test('host can add bot only during starting state', async () => {
    const host = { userId: '000000000000000000000101', username: 'Host', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'My Tournament' });

    const afterBot = await addBotToTournament({
      tournamentId: created.id,
      session: host,
      botName: 'Rooky',
      difficulty: 'easy',
    });

    expect(afterBot.players).toHaveLength(1);
    expect(afterBot.players[0]).toMatchObject({
      type: 'bot',
      username: 'Rooky',
      difficulty: 'easy',
    });

    await joinTournamentAsPlayer({
      tournamentId: created.id,
      session: { userId: '000000000000000000000102', username: 'Human Two', isGuest: true },
    });

    await startTournament({ tournamentId: created.id, session: host });

    await expect(addBotToTournament({
      tournamentId: created.id,
      session: host,
      botName: 'Late Bot',
      difficulty: 'medium',
    })).rejects.toThrow('only available while tournament is starting');
  });

  test('start creates only round-robin games (no pre-seeded elimination)', async () => {
    const host = { userId: '000000000000000000000201', username: 'Host2', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Elo Rules Cup' });

    await joinTournamentAsPlayer({
      tournamentId: created.id,
      session: { userId: '000000000000000000000202', username: 'Human Three', isGuest: false },
    });

    await addBotToTournament({
      tournamentId: created.id,
      session: host,
      botName: 'Medium Bot',
      difficulty: 'medium',
    });

    await startTournament({ tournamentId: created.id, session: host });
    const games = await listTournamentGames(created.id);
    expect(games.length).toBeGreaterThan(0);
    expect(games.some((entry) => entry.phase === 'elimination')).toBe(false);
    const firstPlayers = games[0]?.players || [];
    expect(firstPlayers[0]?.userId).toBeTruthy();
    expect(firstPlayers[1]?.userId).toBeTruthy();
  });

  test('host leaving cancels tournament and stamps completion time', async () => {
    const host = { userId: '000000000000000000000301', username: 'Host3', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Host Leave Cup' });
    await joinTournamentAsViewer({
      tournamentId: created.id,
      session: { userId: '000000000000000000000302', username: 'Viewer', isGuest: true },
    });

    const afterLeave = await leaveTournament({ tournamentId: created.id, session: host });
    expect(afterLeave.state).toBe('cancelled');
    expect(afterLeave.phase).toBe('completed');
    expect(afterLeave.completedAt).toBeTruthy();
  });

  test('host cancel before start leaves no tournament trace', async () => {
    const host = { userId: '000000000000000000000311', username: 'HostCancel', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'No Trace Cup' });
    await leaveTournament({ tournamentId: created.id, session: host });
    const liveRows = await listLiveTournaments();
    expect(liveRows.some((row) => row.id === created.id)).toBe(false);
  });

  test('cannot join once tournament is active', async () => {
    const host = { userId: '000000000000000000000351', username: 'Host4', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Join Guard Cup' });
    await joinTournamentAsPlayer({
      tournamentId: created.id,
      session: { userId: '000000000000000000000352', username: 'P1', isGuest: false },
    });
    await addBotToTournament({
      tournamentId: created.id,
      session: host,
      botName: 'Early Bot',
      difficulty: 'easy',
    });
    await startTournament({ tournamentId: created.id, session: host });

    await expect(joinTournamentAsPlayer({
      tournamentId: created.id,
      session: { userId: '000000000000000000000353', username: 'Late Joiner', isGuest: false },
    })).rejects.toThrow(/only available while tournament is starting/i);
  });

  test('host can kick and re-allow a player during starting state', async () => {
    const host = { userId: '000000000000000000000451', username: 'Host5', isGuest: false };
    const player = { userId: '000000000000000000000452', username: 'KickedPlayer', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Kick Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: player });

    const kicked = await kickTournamentPlayer({
      tournamentId: created.id,
      session: host,
      targetUserId: player.userId,
    });
    expect(kicked.players.some((entry) => entry.userId === player.userId)).toBe(false);
    expect(kicked.removedPlayers.some((entry) => entry.userId === player.userId)).toBe(true);

    await expect(joinTournamentAsPlayer({
      tournamentId: created.id,
      session: player,
    })).rejects.toThrow(/removed from this tournament/i);

    const relisted = await listLiveTournaments({ session: player });
    expect(relisted.some((entry) => entry.id === created.id)).toBe(false);

    const reallowed = await reallowTournamentPlayer({
      tournamentId: created.id,
      session: host,
      targetUserId: player.userId,
    });
    expect(reallowed.removedPlayers.some((entry) => entry.userId === player.userId)).toBe(false);

    const visibleAgain = await listLiveTournaments({ session: player });
    expect(visibleAgain.some((entry) => entry.id === created.id)).toBe(true);

    const alerts = consumeTournamentAlerts(player.userId);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0]).toMatch(/removed/i);
  });
});
