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

const initSocket = require('../src/socket');
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
  maybeAdvanceTournamentEliminationBreak,
  startElimination,
  transferTournamentHost,
  updateTournamentMessage,
  getCurrentTournamentForSession,
  getTournamentClientState,
  listTournamentGames,
  listLiveTournaments,
  listCompletedTournamentsForUser,
  consumeTournamentAlerts,
} = require('../src/services/tournaments/liveTournaments');
const eventBus = require('../src/eventBus');
const Game = require('../src/models/Game');
const Match = require('../src/models/Match');
const { enforceTournamentAcceptTimeoutForGame } = initSocket._private;
const {
  winReasons: WIN_REASONS,
  gameModeSettings,
} = require('../shared/constants');

describe('live tournaments service', () => {
  async function flushAsyncEvents() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  }

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

  test('host can update all tournament settings in lobby, then only break time during round robin', async () => {
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
        breakMinutes: 7,
        eliminationStyle: 'double',
        victoryPoints: 5,
      },
    });

    expect(updated.config).toEqual({
      roundRobinMinutes: 22,
      breakMinutes: 7,
      eliminationStyle: 'double',
      victoryPoints: 5,
    });

    await startTournament({ tournamentId: created.id, session: host });

    const breakOnlyUpdated = await updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: {
        roundRobinMinutes: 10,
        breakMinutes: 3,
        eliminationStyle: 'single',
        victoryPoints: 3,
      },
    });

    expect(breakOnlyUpdated.config).toEqual({
      roundRobinMinutes: 22,
      breakMinutes: 3,
      eliminationStyle: 'double',
      victoryPoints: 5,
    });
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

  test('round robin accept timeout re-pairs players before the deadline', async () => {
    const host = { userId: '000000000000000000000243', username: 'AcceptLoopHost', isGuest: false };
    const opponent = { userId: '000000000000000000000244', username: 'AcceptLoopOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Accept Loop Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });
    const firstWave = await listTournamentGames(created.id);
    expect(firstWave.filter((entry) => entry.phase === 'round_robin')).toHaveLength(1);

    const liveGame = await Game.findById(firstWave[0].gameId);
    liveGame.playersReady = [true, false];
    await liveGame.save();

    await enforceTournamentAcceptTimeoutForGame(firstWave[0].gameId, {
      eventBusRef: eventBus,
    });
    await flushAsyncEvents();

    const secondWave = await listTournamentGames(created.id);
    expect(secondWave.filter((entry) => entry.phase === 'round_robin')).toHaveLength(2);
    expect(secondWave.some((entry) => entry.phase === 'round_robin' && entry.status === 'pending_accept')).toBe(true);

    const currentState = await getTournamentClientState(created.id, { session: host });
    expect(currentState.tournament.phase).toBe('round_robin');
  });

  test('round robin accept timeout starts break once the deadline has passed', async () => {
    const host = { userId: '000000000000000000000245', username: 'AcceptBreakHost', isGuest: false };
    const opponent = { userId: '000000000000000000000246', username: 'AcceptBreakOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Accept Break Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const currentGames = await listTournamentGames(created.id);
    const liveGame = await Game.findById(currentGames[0].gameId);
    liveGame.playersReady = [true, false];
    await liveGame.save();

    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await enforceTournamentAcceptTimeoutForGame(currentGames[0].gameId, {
      eventBusRef: eventBus,
      now: Date.now(),
    });
    await flushAsyncEvents();

    const currentState = await getTournamentClientState(created.id, { session: host });
    deadlineSpy.mockRestore();

    expect(currentState.tournament.phase).toBe('round_robin_complete');
    expect(currentState.tournament.currentRoundLabel).toBe('Break');
    expect(currentState.tournament.eliminationStartsAt).toBeTruthy();
  });

  test('reading tournament state re-pairs round robin players when a game finished before the deadline', async () => {
    const host = { userId: '000000000000000000000247', username: 'ReadLoopHost', isGuest: false };
    const opponent = { userId: '000000000000000000000248', username: 'ReadLoopOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Read Loop Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });
    const firstWave = await listTournamentGames(created.id);
    const liveGame = await Game.findById(firstWave[0].gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);

    const currentState = await getTournamentClientState(created.id, { session: host });
    const refreshedGames = await listTournamentGames(created.id);

    expect(currentState.tournament.phase).toBe('round_robin');
    expect(refreshedGames.filter((entry) => entry.phase === 'round_robin')).toHaveLength(2);
    expect(refreshedGames.some((entry) => entry.phase === 'round_robin' && entry.status === 'pending_accept')).toBe(true);
  });

  test('reading tournament state starts break when the round robin deadline has already passed', async () => {
    const host = { userId: '000000000000000000000249', username: 'ReadBreakHost', isGuest: false };
    const opponent = { userId: '000000000000000000000250', username: 'ReadBreakOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Read Break Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const currentGames = await listTournamentGames(created.id);
    const liveGame = await Game.findById(currentGames[0].gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);

    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    const currentState = await getTournamentClientState(created.id, { session: host });
    deadlineSpy.mockRestore();

    expect(currentState.tournament.phase).toBe('round_robin_complete');
    expect(currentState.tournament.currentRoundLabel).toBe('Break');
    expect(currentState.tournament.eliminationStartsAt).toBeTruthy();
  });

  test('host leaving puts an active tournament into hostless autopilot', async () => {
    const host = { userId: '000000000000000000000301', username: 'Host3', isGuest: false };
    const successor = { userId: '000000000000000000000302', username: 'Successor', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Host Leave Cup' });
    await joinTournamentAsPlayer({
      tournamentId: created.id,
      session: host,
    });
    await joinTournamentAsPlayer({
      tournamentId: created.id,
      session: successor,
    });
    await startTournament({ tournamentId: created.id, session: host });

    const afterLeave = await leaveTournament({ tournamentId: created.id, session: host });
    expect(afterLeave.state).toBe('active');
    expect(afterLeave.phase).toBe('round_robin');
    expect(afterLeave.host).toBeNull();

    const currentForSuccessor = await getCurrentTournamentForSession({ session: successor });
    expect(currentForSuccessor.tournament.id).toBe(created.id);
    expect(currentForSuccessor.role).toBe('player');
    expect(currentForSuccessor.tournament.host).toBeNull();

    await expect(updateTournamentConfig({
      tournamentId: created.id,
      session: successor,
      config: { breakMinutes: 9 },
    })).rejects.toThrow(/only host can update/i);

    await expect(updateTournamentMessage({
      tournamentId: created.id,
      session: successor,
      message: 'Can anyone hear me?',
    })).rejects.toThrow(/only host can update/i);
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

  test('break time remains editable during round robin but locks once break countdown starts', async () => {
    const host = { userId: '000000000000000000000511', username: 'HostBreakEdit', isGuest: false };
    const opponent = { userId: '000000000000000000000512', username: 'OpponentBreakEdit', isGuest: false };
    const created = await createTournament({
      hostSession: host,
      label: 'Break Edit Cup',
      config: { breakMinutes: 2 },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });
    const updatedDuringRoundRobin = await updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: { breakMinutes: 9 },
    });
    expect(updatedDuringRoundRobin.config.breakMinutes).toBe(9);
    expect(updatedDuringRoundRobin.config.roundRobinMinutes).toBe(15);

    const roundRobinGames = await listTournamentGames(created.id);
    const liveGame = await Game.findById(roundRobinGames[0].gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);
    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(updatedDuringRoundRobin.startedAt || new Date().toISOString()) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    await expect(updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: { breakMinutes: 5 },
    })).rejects.toThrow(/can no longer be changed/i);
  });

  test('elimination auto-starts when the break timer expires', async () => {
    const host = { userId: '000000000000000000000513', username: 'HostBreakAuto', isGuest: false };
    const opponent = { userId: '000000000000000000000514', username: 'OpponentBreakAuto', isGuest: false };
    const created = await createTournament({
      hostSession: host,
      label: 'Break Auto Cup',
      config: { breakMinutes: 2 },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const roundRobinGames = await listTournamentGames(created.id);
    const liveGame = await Game.findById(roundRobinGames[0].gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);
    const completionSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    completionSpy.mockRestore();

    const duringBreak = await getTournamentClientState(created.id, { session: host });
    expect(duringBreak.tournament.phase).toBe('round_robin_complete');
    expect(duringBreak.tournament.eliminationStartsAt).toBeTruthy();

    const justBeforeBreakEnds = Date.parse(duringBreak.tournament.eliminationStartsAt) - 1000;
    const beforeSpy = jest.spyOn(Date, 'now').mockReturnValue(justBeforeBreakEnds);
    await maybeAdvanceTournamentEliminationBreak(created.id);
    beforeSpy.mockRestore();

    const stillWaiting = await getTournamentClientState(created.id, { session: host });
    expect(stillWaiting.tournament.phase).toBe('round_robin_complete');

    const afterBreakSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(duringBreak.tournament.eliminationStartsAt) + 1000,
    );
    await maybeAdvanceTournamentEliminationBreak(created.id);
    afterBreakSpy.mockRestore();

    const afterBreak = await getTournamentClientState(created.id, { session: host });
    expect(afterBreak.tournament.phase).toBe('elimination');
    expect(afterBreak.tournament.bracket).toBeTruthy();
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

  test('round robin client state flags waiting for games after timer expires', async () => {
    const host = { userId: '000000000000000000000523', username: 'HostWaiting', isGuest: false };
    const opponent = { userId: '000000000000000000000524', username: 'OpponentWaiting', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Waiting Games Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const pastDeadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    const clientState = await getTournamentClientState(created.id, { session: host });
    pastDeadlineSpy.mockRestore();

    expect(clientState.tournament.phase).toBe('round_robin');
    expect(clientState.tournament.roundRobinWaitingForGames).toBe(true);
  });

  test('current tournament game exposes accept state for the player panel', async () => {
    const host = { userId: '000000000000000000000531', username: 'HostAccept', isGuest: false };
    const opponent = { userId: '000000000000000000000532', username: 'OpponentAccept', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Accept State Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });
    const currentState = await getTournamentClientState(created.id, { session: host });
    expect(currentState.tournament.currentUserGame).toMatchObject({
      phase: 'round_robin',
      requiresAccept: true,
    });
    expect(Number.isInteger(currentState.tournament.currentUserGame.color)).toBe(true);
    expect(currentState.tournament.currentUserGame.gameId).toBeTruthy();
  });

  test('elimination rematch games do not require accept after game one', async () => {
    const host = { userId: '000000000000000000000533', username: 'HostAcceptElim', isGuest: false };
    const opponent = { userId: '000000000000000000000534', username: 'OpponentAcceptElim', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Elim Accept Scope Cup' });
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
    const eliminationGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'elimination');
    expect(eliminationGames[0].requiresAccept).toBe(true);

    const eliminationGame = await Game.findById(eliminationGames[0].gameId);
    eliminationGame.playersReady = [true, true];
    eliminationGame.startTime = new Date();
    await eliminationGame.endGame(0, WIN_REASONS.RESIGN);

    const followUpGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'elimination' && entry.status !== 'completed');
    expect(followUpGames).toHaveLength(1);
    expect(followUpGames[0].requiresAccept).toBe(false);

    const currentState = await getTournamentClientState(created.id, { session: host });
    expect(currentState.tournament.currentUserGame).toMatchObject({
      phase: 'elimination',
      requiresAccept: false,
    });
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

  test('double elimination activates grand finals reset when the lower-bracket finalist wins the first grand final', async () => {
    const host = { userId: '000000000000000000000571', username: 'HostReset', isGuest: false };
    const a = { userId: '000000000000000000000572', username: 'A', isGuest: false };
    const b = { userId: '000000000000000000000573', username: 'B', isGuest: false };
    const c = { userId: '000000000000000000000574', username: 'C', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Reset Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: a });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: b });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: c });
    await updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: { eliminationStyle: 'double' },
    });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const finishEliminationMatch = async (matchId, winnerId) => {
      const match = await Match.findById(matchId);
      match.eloEligible = false;
      await match.endMatch(winnerId);
    };
    const waitForBracketMatch = async (selectMatch, message) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const state = await getTournamentClientState(created.id, { session: host });
        const match = selectMatch(state.tournament.bracket);
        if (match?.matchId) {
          return { state, match };
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(message);
    };
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

    let eliminationState = await getTournamentClientState(created.id, { session: host });
    const openingSemis = eliminationState.tournament.bracket.winnersRounds[0].matches;
    await finishEliminationMatch(openingSemis[0].matchId, openingSemis[0].playerA.userId);
    await finishEliminationMatch(openingSemis[1].matchId, openingSemis[1].playerA.userId);

    ({ state: eliminationState } = await waitForBracketMatch(
      (bracket) => bracket?.winnersRounds?.[1]?.matches?.[0],
      'Timed out waiting for winners final',
    ));
    const winnersFinal = eliminationState.tournament.bracket.winnersRounds[1].matches[0];
    const losersSemifinal = eliminationState.tournament.bracket.losersRounds[0].matches[0];
    await finishEliminationMatch(losersSemifinal.matchId, losersSemifinal.playerA.userId);
    await finishEliminationMatch(winnersFinal.matchId, winnersFinal.playerA.userId);

    ({ state: eliminationState } = await waitForBracketMatch(
      (bracket) => bracket?.losersRounds?.[1]?.matches?.[0],
      'Timed out waiting for losers final',
    ));
    const losersFinal = eliminationState.tournament.bracket.losersRounds[1].matches[0];
    await finishEliminationMatch(losersFinal.matchId, losersFinal.playerB.userId);

    ({ state: eliminationState } = await waitForBracketMatch(
      (bracket) => bracket?.finalsRounds?.[0]?.matches?.[0],
      'Timed out waiting for grand finals',
    ));
    const grandFinal = eliminationState.tournament.bracket.finalsRounds[0].matches[0];
    await finishEliminationMatch(grandFinal.matchId, grandFinal.playerB.userId);

    const { state: resetState } = await waitForBracketMatch(
      (bracket) => bracket?.finalsRounds?.[1]?.matches?.[0],
      'Timed out waiting for grand finals reset',
    );
    expect(resetState.tournament.phase).toBe('elimination');
    expect(resetState.tournament.currentRoundLabel).toBe('Grand Finals Reset');
    expect(resetState.tournament.bracket.finalsRounds).toHaveLength(2);
    expect(resetState.tournament.bracket.finalsRounds[1].label).toBe('Grand Finals Reset');
    expect(resetState.tournament.bracket.finalsRounds[1].active).toBe(true);
    expect(resetState.tournament.bracket.finalsRounds[1].matches[0].matchId).toBeTruthy();
  }, 15000);

  test('two-player double elimination feeds the winners final loser directly into grand finals and reset', async () => {
    const host = { userId: '000000000000000000000575', username: 'HostReset2', isGuest: false };
    const opponent = { userId: '000000000000000000000576', username: 'OpponentReset2', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Heads Up Reset Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });
    await updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: { eliminationStyle: 'double' },
    });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const finishEliminationMatch = async (matchId, winnerId) => {
      const match = await Match.findById(matchId);
      match.eloEligible = false;
      await match.endMatch(winnerId);
    };
    const waitForBracketMatch = async (selectMatch, message) => {
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const state = await getTournamentClientState(created.id, { session: host });
        const match = selectMatch(state.tournament.bracket);
        if (match?.matchId) {
          return { state, match };
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      throw new Error(message);
    };
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

    let eliminationState = await getTournamentClientState(created.id, { session: host });
    const winnersFinal = eliminationState.tournament.bracket.winnersRounds[0].matches[0];
    expect(eliminationState.tournament.bracket.losersRounds).toHaveLength(0);
    await finishEliminationMatch(winnersFinal.matchId, winnersFinal.playerA.userId);

    ({ state: eliminationState } = await waitForBracketMatch(
      (bracket) => bracket?.finalsRounds?.[0]?.matches?.[0],
      'Timed out waiting for two-player grand finals',
    ));
    const grandFinal = eliminationState.tournament.bracket.finalsRounds[0].matches[0];
    expect(grandFinal.playerA?.userId).toBe(winnersFinal.playerA.userId);
    expect(grandFinal.playerB?.userId).toBe(winnersFinal.playerB.userId);
    expect(grandFinal.matchId).toBeTruthy();

    await finishEliminationMatch(grandFinal.matchId, grandFinal.playerB.userId);

    const { state: resetState } = await waitForBracketMatch(
      (bracket) => bracket?.finalsRounds?.[1]?.matches?.[0],
      'Timed out waiting for two-player grand finals reset',
    );
    const resetMatch = resetState.tournament.bracket.finalsRounds[1].matches[0];
    expect(resetState.tournament.currentRoundLabel).toBe('Grand Finals Reset');
    expect(resetState.tournament.bracket.finalsRounds[1].active).toBe(true);
    expect(resetMatch.playerA?.userId).toBe(winnersFinal.playerA.userId);
    expect(resetMatch.playerB?.userId).toBe(winnersFinal.playerB.userId);
    expect(resetMatch.matchId).toBeTruthy();
  }, 15000);

  test('completed tournament history includes player placement summaries', async () => {
    const host = { userId: '000000000000000000000581', username: 'HistoryHost', isGuest: false };
    const opponent = { userId: '000000000000000000000582', username: 'HistoryOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'History Placement Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

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
    const finalMatch = await Match.findById(eliminationGames[0].matchId);
    finalMatch.eloEligible = false;
    await finalMatch.endMatch(host.userId);
    await flushAsyncEvents();
    await leaveTournament({ tournamentId: created.id, session: host });
    await leaveTournament({ tournamentId: created.id, session: opponent });

    const hostHistory = await listCompletedTournamentsForUser({ session: host });
    const opponentHistory = await listCompletedTournamentsForUser({ session: opponent });

    expect(hostHistory[0]).toMatchObject({
      id: created.id,
      placement: 1,
      placementLabel: '1st',
      hosted: true,
      competed: true,
    });
    expect(opponentHistory[0]).toMatchObject({
      id: created.id,
      placement: 2,
      placementLabel: '2nd',
      hosted: false,
      competed: true,
    });
  });

  test('completed tournament history includes tournaments a user only hosted', async () => {
    const host = { userId: '000000000000000000000583', username: 'HistoryOnlyHost', isGuest: false };
    const playerA = { userId: '000000000000000000000584', username: 'HistoryA', isGuest: false };
    const playerB = { userId: '000000000000000000000585', username: 'HistoryB', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Hosted Only Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: playerA });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: playerB });

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
    const finalMatch = await Match.findById(eliminationGames[0].matchId);
    finalMatch.eloEligible = false;
    await finalMatch.endMatch(playerA.userId);
    await flushAsyncEvents();
    await leaveTournament({ tournamentId: created.id, session: host });

    const hostHistory = await listCompletedTournamentsForUser({ session: host });
    expect(hostHistory[0]).toMatchObject({
      id: created.id,
      placement: null,
      placementLabel: 'Hosted',
      hosted: true,
      competed: false,
    });

    const hostedDetails = await getTournamentClientState(created.id, {
      session: host,
      accessMode: 'history',
    });
    expect(hostedDetails.tournament.phase).toBe('completed');
    expect(hostedDetails.tournament.id).toBe(created.id);
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
