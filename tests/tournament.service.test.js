jest.mock('../src/utils/ensureUser', () => jest.fn(async (userId) => ({
  userId: userId || '000000000000000000000111',
  username: 'EnsuredUser',
  isGuest: true,
})));

jest.mock('../src/services/bots/registry', () => ({
  ensureBotUserInstance: jest.fn(async (options = {}) => {
    const difficulty = typeof options === 'string' ? options : (options?.difficulty || 'easy');
    const instanceKey = typeof options === 'object' ? String(options?.instanceKey || 'instance') : 'instance';
    return {
      user: {
        _id: `${difficulty}-${instanceKey}`,
        username: `${difficulty}-bot-${instanceKey.slice(-4)}`,
      },
      token: `token-${difficulty}-${instanceKey}`,
    };
  }),
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
  updateTournamentConfig,
  joinTournamentAsPlayer,
  joinTournamentAsViewer,
  removeTournamentViewerOnDisconnect,
  leaveTournament,
  addBotToTournament,
  kickTournamentPlayer,
  reallowTournamentPlayer,
  startTournament,
  maybeAdvanceTournamentRoundRobin,
  startElimination,
  transferTournamentHost,
  updateTournamentMessage,
  getCurrentTournamentForSession,
  getTournamentClientState,
  listTournamentGames,
  listLiveTournaments,
  consumeTournamentAlerts,
} = require('../src/services/tournaments/liveTournaments');
const eventBus = require('../src/eventBus');
const Game = require('../src/models/Game');
const {
  winReasons: WIN_REASONS,
  gameModeSettings,
} = require('../shared/constants');

describe('live tournaments service', () => {
  beforeEach(() => {
    resetForTests();
  });

  afterEach(() => {
    jest.restoreAllMocks();
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

  test('host can update tournament settings while lobby is filling but not after start', async () => {
    const host = { userId: '000000000000000000000111', username: 'HostEdit', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Editable Cup' });

    await joinTournamentAsPlayer({
      tournamentId: created.id,
      session: { userId: '000000000000000000000112', username: 'Player One', isGuest: false },
    });

    await addBotToTournament({
      tournamentId: created.id,
      session: host,
      botName: 'Bot One',
      difficulty: 'easy',
    });

    const updated = await updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: {
        roundRobinMinutes: 22,
        eliminationStyle: 'double',
        victoryPoints: 5,
      },
    });

    expect(updated.config).toEqual({
      roundRobinMinutes: 22,
      eliminationStyle: 'double',
      victoryPoints: 5,
    });

    await startTournament({ tournamentId: created.id, session: host });

    await expect(updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: {
        roundRobinMinutes: 10,
        eliminationStyle: 'single',
        victoryPoints: 3,
      },
    })).rejects.toThrow(/only available while tournament is starting/i);
  });

  test('same-difficulty tournament bots get distinct bot instances', async () => {
    const host = { userId: '000000000000000000000181', username: 'HostDistinct', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Distinct Bot Cup' });

    const afterFirstBot = await addBotToTournament({
      tournamentId: created.id,
      session: host,
      botName: 'Bot Alpha',
      difficulty: 'medium',
    });
    const afterSecondBot = await addBotToTournament({
      tournamentId: created.id,
      session: host,
      botName: 'Bot Beta',
      difficulty: 'medium',
    });

    expect(afterSecondBot.players).toHaveLength(2);
    expect(afterSecondBot.players[0].difficulty).toBe('medium');
    expect(afterSecondBot.players[1].difficulty).toBe('medium');
    expect(afterSecondBot.players[0].userId).not.toBe(afterSecondBot.players[1].userId);
    expect(afterSecondBot.players.map((entry) => entry.username)).toEqual(['Bot Alpha', 'Bot Beta']);
    expect(afterFirstBot.players[0].userId).not.toBe(afterSecondBot.players[1].userId);
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

  test('round robin keeps scheduling fresh games until the timer cutoff is reached', async () => {
    const host = { userId: '000000000000000000000241', username: 'HostLoop', isGuest: false };
    const opponent = { userId: '000000000000000000000242', username: 'LoopOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Loop Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    expect(started.phase).toBe('round_robin');

    const firstWave = await listTournamentGames(created.id);
    expect(firstWave.filter((entry) => entry.phase === 'round_robin')).toHaveLength(1);

    const liveGame = await Game.findById(firstWave[0].gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);
    await maybeAdvanceTournamentRoundRobin(created.id);

    const secondWave = await listTournamentGames(created.id);
    expect(secondWave.filter((entry) => entry.phase === 'round_robin')).toHaveLength(2);

    const currentState = await getTournamentClientState(created.id, { session: host });
    expect(currentState.tournament.phase).toBe('round_robin');
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

  test('viewer disconnect removes viewer membership and emits a tournament update', async () => {
    const host = { userId: '000000000000000000000305', username: 'HostViewer', isGuest: false };
    const viewer = { userId: '000000000000000000000306', username: 'ViewerGone', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Viewer Exit Cup' });
    const emitSpy = jest.spyOn(eventBus, 'emit');

    await joinTournamentAsViewer({
      tournamentId: created.id,
      session: viewer,
    });

    const removedIds = await removeTournamentViewerOnDisconnect({ userId: viewer.userId });
    const current = await getTournamentClientState(created.id, { session: host });

    expect(removedIds).toEqual([created.id]);
    expect(current.tournament.viewerCount).toBe(0);
    expect(emitSpy).toHaveBeenCalledWith('tournament:updated', expect.objectContaining({
      tournamentId: created.id,
    }));
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

  test('round robin completion waits for host to manually start elimination', async () => {
    const host = { userId: '000000000000000000000501', username: 'Host6', isGuest: false };
    const opponent = { userId: '000000000000000000000502', username: 'Opponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Manual Elim Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const roundRobinGames = await listTournamentGames(created.id);
    expect(roundRobinGames).toHaveLength(1);

    const liveGame = await Game.findById(roundRobinGames[0].gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);
    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    const afterRoundRobin = await getTournamentClientState(created.id, { session: host });
    expect(afterRoundRobin.tournament.phase).toBe('round_robin_complete');
    expect(afterRoundRobin.tournament.canStartElimination).toBe(true);

    await startElimination({ tournamentId: created.id, session: host });
    const eliminationState = await getTournamentClientState(created.id, { session: host });
    expect(eliminationState.tournament.phase).toBe('elimination');
    expect(eliminationState.tournament.bracket).toBeTruthy();
    expect(eliminationState.tournament.participants.map((entry) => entry.seed)).toEqual([1, 2]);
    expect((eliminationState.games || []).some((entry) => entry.phase === 'elimination')).toBe(true);
  });

  test('round robin participant seeds use live standings before elimination is started', async () => {
    const host = { userId: '000000000000000000000521', username: 'HostSeed', isGuest: false };
    const opponent = { userId: '000000000000000000000522', username: 'OpponentSeed', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Seed Preview Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const roundRobinGames = await listTournamentGames(created.id);
    const liveGame = await Game.findById(roundRobinGames[0].gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);
    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    const roundRobinCompleteState = await getTournamentClientState(created.id, { session: host });
    expect(roundRobinCompleteState.tournament.phase).toBe('round_robin_complete');
    expect(roundRobinCompleteState.tournament.participants.map((entry) => entry.seed)).toEqual([1, 2]);
  });

  test('tournament games use ranked time controls in round robin and elimination', async () => {
    const host = { userId: '000000000000000000000541', username: 'HostClock', isGuest: false };
    const opponent = { userId: '000000000000000000000542', username: 'OpponentClock', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Clock Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const roundRobinGames = await listTournamentGames(created.id);
    const roundRobinGame = await Game.findById(roundRobinGames[0].gameId);
    expect(roundRobinGame.timeControlStart).toBe(gameModeSettings.RANKED.TIME_CONTROL);
    expect(roundRobinGame.increment).toBe(gameModeSettings.INCREMENT);

    await roundRobinGame.endGame(0, WIN_REASONS.RESIGN);
    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    await startElimination({ tournamentId: created.id, session: host });
    const eliminationGames = (await listTournamentGames(created.id))
      .filter((entry) => entry.phase === 'elimination');
    const eliminationGame = await Game.findById(eliminationGames[0].gameId);
    expect(eliminationGame.timeControlStart).toBe(gameModeSettings.RANKED.TIME_CONTROL);
    expect(eliminationGame.increment).toBe(gameModeSettings.INCREMENT);
  });

  test('elimination bracket view includes series progress fields', async () => {
    const host = { userId: '000000000000000000000551', username: 'HostBracket', isGuest: false };
    const opponent = { userId: '000000000000000000000552', username: 'OpponentBracket', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Bracket Progress Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const roundRobinGames = await listTournamentGames(created.id);
    const roundRobinGame = await Game.findById(roundRobinGames[0].gameId);
    await roundRobinGame.endGame(0, WIN_REASONS.RESIGN);
    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    await startElimination({ tournamentId: created.id, session: host });
    const eliminationState = await getTournamentClientState(created.id, { session: host });
    const round = eliminationState.tournament.bracket.rounds[0];
    const match = round.matches[0];
    expect(match.playerAScore).toBe(0);
    expect(match.playerBScore).toBe(0);
    expect(match.winScoreTarget).toBe(3);
  });

  test('tournament does not complete after only one semifinal finishes', async () => {
    const host = { userId: '000000000000000000000561', username: 'HostSemis', isGuest: false };
    const a = { userId: '000000000000000000000562', username: 'A', isGuest: false };
    const b = { userId: '000000000000000000000563', username: 'B', isGuest: false };
    const c = { userId: '000000000000000000000564', username: 'C', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Semis Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: a });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: b });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: c });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    const roundRobinGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    for (const entry of roundRobinGames) {
      const rrGame = await Game.findById(entry.gameId);
      await rrGame.endGame(0, WIN_REASONS.RESIGN);
    }
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    await startElimination({ tournamentId: created.id, session: host });
    const eliminationGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'elimination');
    expect(eliminationGames).toHaveLength(2);

    const firstSemi = await Game.findById(eliminationGames[0].gameId);
    await firstSemi.endGame(0, WIN_REASONS.RESIGN);

    const stateAfterOneSemi = await getTournamentClientState(created.id, { session: host });
    expect(stateAfterOneSemi.tournament.phase).toBe('elimination');
    expect(stateAfterOneSemi.tournament.currentRoundLabel).toBe('Semifinals');
    expect(stateAfterOneSemi.tournament.bracket).toBeTruthy();
    const finalMatch = stateAfterOneSemi.tournament.bracket.rounds[1].matches[0];
    expect(finalMatch.winner).toBeNull();
    expect(finalMatch.status).toBe('waiting');
  });

  test('host transfer preserves the tournament for the new host after the old host leaves', async () => {
    const host = { userId: '000000000000000000000601', username: 'Host7', isGuest: false };
    const player = { userId: '000000000000000000000602', username: 'Successor', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Host Transfer Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: player });

    await transferTournamentHost({
      tournamentId: created.id,
      session: host,
      targetUserId: player.userId,
    });
    await leaveTournament({ tournamentId: created.id, session: host });

    const currentForSuccessor = await getCurrentTournamentForSession({ session: player });
    expect(currentForSuccessor.tournament.id).toBe(created.id);
    expect(currentForSuccessor.role).toBe('host_player');
    expect(currentForSuccessor.tournament.host.userId).toBe(player.userId);
  });

  test('host message updates are reflected in tournament client state', async () => {
    const host = { userId: '000000000000000000000701', username: 'Host8', isGuest: false };
    const viewer = { userId: '000000000000000000000702', username: 'Viewer', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Message Cup' });
    await joinTournamentAsViewer({ tournamentId: created.id, session: viewer });

    await updateTournamentMessage({
      tournamentId: created.id,
      session: host,
      message: 'Round one starts soon.',
    });

    const clientState = await getTournamentClientState(created.id, { session: viewer });
    expect(clientState.tournament.message).toBe('Round one starts soon.');
  });

  test('tournament client state includes a server clock timestamp for live countdown sync', async () => {
    const host = { userId: '000000000000000000000721', username: 'HostClockSync', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Clock Sync Cup' });

    const clientState = await getTournamentClientState(created.id, { session: host });
    expect(Number.isFinite(clientState.serverNowMs)).toBe(true);
    expect(clientState.serverNowMs).toBeGreaterThan(0);
  });
});
