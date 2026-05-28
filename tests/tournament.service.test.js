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
  endTournamentRoundRobin,
  maybeAdvanceTournamentRoundRobin,
  maybeAdvanceTournamentEliminationBreak,
  startElimination,
  transferTournamentHost,
  updateTournamentMessage,
  extendTournamentAcceptWindow,
  getCurrentTournamentForSession,
  getTournamentClientState,
  listTournamentGames,
  listLiveTournaments,
  listCompletedTournamentsForUser,
  consumeTournamentAlerts,
} = require('../src/services/tournaments/liveTournaments');
const eventBus = require('../src/eventBus');
const mongoose = require('mongoose');
const Game = require('../src/models/Game');
const Match = require('../src/models/Match');
const User = require('../src/models/User');
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

  async function startTwoPlayerElimination(created, started, hostSession) {
    const roundRobinGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    for (const entry of roundRobinGames) {
      const roundRobinGame = await Game.findById(entry.gameId);
      await roundRobinGame.endGame(0, WIN_REASONS.RESIGN);
    }

    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    await startElimination({ tournamentId: created.id, session: hostSession });
    const eliminationGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'elimination');
    const match = await Match.findById(eliminationGames[0].matchId);
    match.eloEligible = false;
    await match.save();
    return eliminationGames[0].matchId;
  }

  async function getActiveGameForMatch(matchId) {
    const match = await Match.findById(matchId);
    for (const gameId of (Array.isArray(match?.games) ? match.games : [])) {
      const game = await Game.findById(gameId);
      if (game?.isActive) {
        return { match, game };
      }
    }
    return { match, game: null };
  }

  async function endActiveGameForMatch(matchId, winner, reason) {
    const { game } = await getActiveGameForMatch(matchId);
    expect(game).toBeTruthy();
    const players = Array.isArray(game.players) ? game.players.map((id) => String(id)) : [];
    await game.endGame(winner, reason);
    await flushAsyncEvents();
    return {
      game,
      match: await Match.findById(matchId),
      players,
    };
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
        timeControlMinutes: 4,
        incrementSeconds: 5,
        roundRobinAcceptSeconds: 45,
        eliminationAcceptSeconds: 150,
        breakMinutes: 7,
        eliminationStyle: 'double',
        victoryPoints: 5,
      },
    });

    expect(updated.config).toEqual({
      roundRobinMinutes: 22,
      timeControlMinutes: 4,
      incrementSeconds: 5,
      roundRobinAcceptSeconds: 45,
      eliminationAcceptSeconds: 150,
      breakMinutes: 7,
      eliminationStyle: 'double',
      victoryPoints: 5,
      lateJoinRoundRobin: false,
    });

    await startTournament({ tournamentId: created.id, session: host });

    const breakOnlyUpdated = await updateTournamentConfig({
      tournamentId: created.id,
      session: host,
      config: {
        roundRobinMinutes: 10,
        timeControlMinutes: 8,
        incrementSeconds: 9,
        roundRobinAcceptSeconds: 60,
        eliminationAcceptSeconds: 180,
        breakMinutes: 3,
        eliminationStyle: 'single',
        victoryPoints: 3,
      },
    });

    expect(breakOnlyUpdated.config).toEqual({
      roundRobinMinutes: 22,
      timeControlMinutes: 4,
      incrementSeconds: 5,
      roundRobinAcceptSeconds: 45,
      eliminationAcceptSeconds: 150,
      breakMinutes: 3,
      eliminationStyle: 'double',
      victoryPoints: 5,
      lateJoinRoundRobin: false,
    });
  });

  test('players cannot late join round robin when the setting is off', async () => {
    const host = { userId: '000000000000000000000251', username: 'NoLateHost', isGuest: false };
    const opponent = { userId: '000000000000000000000252', username: 'NoLateOpponent', isGuest: false };
    const latePlayer = { userId: '000000000000000000000253', username: 'NoLatePlayer', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'No Late Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });

    await expect(joinTournamentAsPlayer({
      tournamentId: created.id,
      session: latePlayer,
    })).rejects.toThrow(/late joining is enabled/i);
  });

  test('late round-robin joiners enter the rolling pairing pool when enabled', async () => {
    const host = { userId: '000000000000000000000254', username: 'LateHost', isGuest: false };
    const first = { userId: '000000000000000000000255', username: 'LateFirst', isGuest: false };
    const idle = { userId: '000000000000000000000256', username: 'LateIdle', isGuest: false };
    const latePlayer = { userId: '000000000000000000000257', username: 'LateArrival', isGuest: false };
    const created = await createTournament({
      hostSession: host,
      label: 'Late Join Cup',
      config: { lateJoinRoundRobin: true },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: first });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: idle });

    await startTournament({ tournamentId: created.id, session: host });
    const firstWave = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    expect(firstWave).toHaveLength(1);

    const afterLateJoin = await joinTournamentAsPlayer({
      tournamentId: created.id,
      session: latePlayer,
    });
    expect(afterLateJoin.players.some((entry) => entry.userId === latePlayer.userId)).toBe(true);

    const games = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    expect(games).toHaveLength(2);
    expect(games.some((entry) => (
      entry.players.some((player) => player.userId === idle.userId)
      && entry.players.some((player) => player.userId === latePlayer.userId)
    ))).toBe(true);
  });

  test('break-time late joiners use normal seed rules with zero round-robin score', async () => {
    const originalReadyState = mongoose.connection.readyState;
    const host = { userId: '000000000000000000000258', username: 'BreakHost', isGuest: false };
    const opponent = { userId: '000000000000000000000259', username: 'BreakOpponent', isGuest: false };
    const lateOne = { userId: '000000000000000000000260', username: 'BreakLateOne', isGuest: false };
    const lateTwo = { userId: '000000000000000000000261', username: 'BreakLateTwo', isGuest: false };
    mongoose.connection.readyState = 1;
    jest.spyOn(User, 'findById').mockImplementation((id) => ({
      lean: jest.fn(async () => ({
        _id: id,
        elo: {
          [host.userId]: 900,
          [opponent.userId]: 700,
          [lateOne.userId]: 1000,
          [lateTwo.userId]: 600,
        }[String(id)] || 800,
      })),
    }));
    jest.spyOn(Game, '_persistDocument').mockResolvedValue(undefined);
    jest.spyOn(Match, '_persistDocument').mockResolvedValue(undefined);
    const created = await createTournament({
      hostSession: host,
      label: 'Break Late Cup',
      config: { lateJoinRoundRobin: true },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const roundRobinGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    const roundRobinWinnerId = roundRobinGames[0].players[0].userId;
    const roundRobinLoserId = roundRobinGames[0].players[1].userId;
    const rrGame = await Game.findById(roundRobinGames[0].gameId);
    await rrGame.endGame(0, WIN_REASONS.RESIGN);

    const breakNow = Date.parse(started.startedAt) + (16 * 60 * 1000);
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(breakNow);
    await maybeAdvanceTournamentRoundRobin(created.id);
    dateSpy.mockReturnValue(breakNow + 1000);
    await joinTournamentAsPlayer({ tournamentId: created.id, session: lateOne });
    dateSpy.mockReturnValue(breakNow + 2000);
    await joinTournamentAsPlayer({ tournamentId: created.id, session: lateTwo });
    mongoose.connection.readyState = originalReadyState;

    const breakState = await getTournamentClientState(created.id, { session: host });
    const seedByUserId = new Map(breakState.tournament.participants.map((entry) => [entry.userId, entry.seed]));
    expect(breakState.tournament.phase).toBe('round_robin_complete');
    expect(seedByUserId.get(roundRobinWinnerId)).toBe(1);
    expect(seedByUserId.get(lateOne.userId)).toBe(2);
    expect(seedByUserId.get(lateTwo.userId)).toBe(seedByUserId.get(lateOne.userId) + 1);
    expect(seedByUserId.get(roundRobinLoserId)).toBeGreaterThan(seedByUserId.get(lateTwo.userId));

    await startElimination({ tournamentId: created.id, session: host });
    const eliminationState = await getTournamentClientState(created.id, { session: host });
    const eliminationSeedByUserId = new Map(eliminationState.tournament.participants.map((entry) => [entry.userId, entry.seed]));
    dateSpy.mockRestore();
    mongoose.connection.readyState = originalReadyState;

    expect(eliminationState.tournament.phase).toBe('elimination');
    expect(eliminationSeedByUserId.get(roundRobinWinnerId)).toBe(1);
    expect(eliminationSeedByUserId.get(lateOne.userId)).toBe(2);
    expect(eliminationSeedByUserId.get(lateTwo.userId)).toBe(eliminationSeedByUserId.get(lateOne.userId) + 1);
    expect(eliminationSeedByUserId.get(roundRobinLoserId)).toBeGreaterThan(eliminationSeedByUserId.get(lateTwo.userId));
  });

  test('late joins after the round-robin timer closes still use normal seed rules', async () => {
    const originalReadyState = mongoose.connection.readyState;
    const host = { userId: '000000000000000000000262', username: 'ClosedHost', isGuest: false };
    const activeOpponent = { userId: '000000000000000000000263', username: 'ClosedActive', isGuest: false };
    const idleOpponent = { userId: '000000000000000000000264', username: 'ClosedIdle', isGuest: false };
    const latePlayer = { userId: '000000000000000000000265', username: 'ClosedLate', isGuest: false };
    mongoose.connection.readyState = 1;
    jest.spyOn(User, 'findById').mockImplementation((id) => ({
      lean: jest.fn(async () => ({
        _id: id,
        elo: {
          [host.userId]: 900,
          [activeOpponent.userId]: 700,
          [idleOpponent.userId]: 600,
          [latePlayer.userId]: 1000,
        }[String(id)] || 800,
      })),
    }));
    jest.spyOn(Game, '_persistDocument').mockResolvedValue(undefined);
    jest.spyOn(Match, '_persistDocument').mockResolvedValue(undefined);
    const created = await createTournament({
      hostSession: host,
      label: 'Closed Window Cup',
      config: { lateJoinRoundRobin: true },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: activeOpponent });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: idleOpponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const firstWave = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    expect(firstWave).toHaveLength(1);
    const roundRobinWinnerId = firstWave[0].players[0].userId;

    const afterDeadline = Date.parse(started.startedAt) + (16 * 60 * 1000);
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(afterDeadline);
    const afterJoin = await joinTournamentAsPlayer({ tournamentId: created.id, session: latePlayer });
    const lateEntry = afterJoin.players.find((entry) => entry.userId === latePlayer.userId);
    expect(lateEntry?.lateJoinPhase).toBe('break');
    expect((await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin')).toHaveLength(1);
    mongoose.connection.readyState = originalReadyState;

    const activeGame = await Game.findById(firstWave[0].gameId);
    await activeGame.endGame(0, WIN_REASONS.RESIGN);
    await maybeAdvanceTournamentRoundRobin(created.id);

    const breakState = await getTournamentClientState(created.id, { session: host });
    const seedByUserId = new Map(breakState.tournament.participants.map((entry) => [entry.userId, entry.seed]));
    dateSpy.mockRestore();

    expect(breakState.tournament.phase).toBe('round_robin_complete');
    expect(seedByUserId.get(roundRobinWinnerId)).toBe(1);
    expect(seedByUserId.get(latePlayer.userId)).toBe(2);
    expect(seedByUserId.get(latePlayer.userId)).toBeLessThan(seedByUserId.get(idleOpponent.userId));
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

  test('start applies tournament clock and accept settings to round-robin games', async () => {
    const host = { userId: '000000000000000000000211', username: 'ClockHost', isGuest: false };
    const opponent = { userId: '000000000000000000000212', username: 'ClockOpponent', isGuest: false };
    const created = await createTournament({
      hostSession: host,
      label: 'Clock Settings Cup',
      config: {
        timeControlMinutes: 6,
        incrementSeconds: 4,
        roundRobinAcceptSeconds: 45,
      },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });
    const [roundRobinGame] = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    const game = await Game.findById(roundRobinGame.gameId);
    const match = await Match.findById(roundRobinGame.matchId);

    expect(game.timeControlStart).toBe(6 * 60 * 1000);
    expect(game.increment).toBe(4 * 1000);
    expect(game.acceptWindowSeconds).toBe(45);
    expect(game.acceptDeadlineAt).toBeTruthy();
    expect(match.acceptWindowSeconds).toBe(45);
    expect(roundRobinGame.acceptWindowSeconds).toBe(45);
    expect(roundRobinGame.acceptDeadlineAt).toBeTruthy();
  });

  test('host can extend a pending tournament accept deadline by thirty seconds', async () => {
    const host = { userId: '000000000000000000000213', username: 'ExtendHost', isGuest: false };
    const opponent = { userId: '000000000000000000000214', username: 'ExtendOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Extend Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });
    await startTournament({ tournamentId: created.id, session: host });

    const [roundRobinGame] = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    const game = await Game.findById(roundRobinGame.gameId);
    const originalDeadlineMs = Date.parse(game.acceptDeadlineAt);
    const emitSpy = jest.spyOn(eventBus, 'emit');

    const extended = await extendTournamentAcceptWindow({
      tournamentId: created.id,
      session: host,
      gameId: roundRobinGame.gameId,
      seconds: 30,
    });
    const refreshedGame = await Game.findById(roundRobinGame.gameId);

    expect(Date.parse(refreshedGame.acceptDeadlineAt)).toBe(originalDeadlineMs + 30000);
    expect(extended.acceptSecondsRemaining).toBeGreaterThanOrEqual(30);
    expect(emitSpy).toHaveBeenCalledWith('players:bothNext', expect.objectContaining({
      game: expect.objectContaining({ _id: roundRobinGame.gameId }),
      requiresAccept: true,
      acceptWindowSeconds: expect.any(Number),
      acceptDeadlineAt: expect.any(String),
    }));
  });

  test('round robin waits instead of immediately rematching the only available pair', async () => {
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
    expect(secondWave.filter((entry) => entry.phase === 'round_robin')).toHaveLength(1);

    const currentState = await getTournamentClientState(created.id, { session: host });
    expect(currentState.tournament.phase).toBe('round_robin');
  });

  test('round robin accept timeout waits instead of immediately rematching the same pair', async () => {
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
    liveGame.acceptDeadlineAt = new Date(Date.now() - 1000);
    await liveGame.save();

    await enforceTournamentAcceptTimeoutForGame(firstWave[0].gameId, {
      eventBusRef: eventBus,
    });
    await flushAsyncEvents();

    const secondWave = await listTournamentGames(created.id);
    expect(secondWave.filter((entry) => entry.phase === 'round_robin')).toHaveLength(1);
    expect(secondWave.some((entry) => entry.phase === 'round_robin' && entry.status === 'pending_accept')).toBe(false);

    const currentState = await getTournamentClientState(created.id, { session: host });
    expect(currentState.tournament.phase).toBe('round_robin');
  });

  test('round robin pairs a player with someone else after their last opponent becomes available', async () => {
    const host = { userId: '000000000000000000000251', username: 'AvoidRepeatHost', isGuest: false };
    const firstOpponent = { userId: '000000000000000000000252', username: 'AvoidRepeatA', isGuest: false };
    const waitingOpponent = { userId: '000000000000000000000253', username: 'AvoidRepeatB', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Avoid Repeat Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: firstOpponent });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: waitingOpponent });

    await startTournament({ tournamentId: created.id, session: host });
    const firstWave = await listTournamentGames(created.id);
    const firstGame = firstWave.find((entry) => entry.phase === 'round_robin');
    const firstPlayerIds = firstGame.players.map((player) => player.userId);
    const idlePlayerId = [host.userId, firstOpponent.userId, waitingOpponent.userId]
      .find((userId) => !firstPlayerIds.includes(userId));
    expect(idlePlayerId).toBeTruthy();

    const liveGame = await Game.findById(firstGame.gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);
    await maybeAdvanceTournamentRoundRobin(created.id);

    const roundRobinGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    expect(roundRobinGames).toHaveLength(2);
    const nextPendingGame = roundRobinGames.find((entry) => entry.status === 'pending_accept');
    const nextPlayerIds = nextPendingGame.players.map((player) => player.userId);
    expect(nextPlayerIds).toContain(idlePlayerId);
    expect(nextPlayerIds.sort()).not.toEqual(firstPlayerIds.sort());
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

  test('reading tournament state does not immediately rematch the only available round robin pair', async () => {
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
    expect(refreshedGames.filter((entry) => entry.phase === 'round_robin')).toHaveLength(1);
    expect(refreshedGames.some((entry) => entry.phase === 'round_robin' && entry.status === 'pending_accept')).toBe(false);
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

  test('pre-start host leaving closes the tournament and alerts attached users', async () => {
    const host = { userId: '000000000000000000000303', username: 'HostPreLeave', isGuest: false };
    const player = { userId: '000000000000000000000304', username: 'PlayerPreLeave', isGuest: false };
    const viewer = { userId: '000000000000000000000307', username: 'ViewerPreLeave', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Host Left Early Cup' });

    await joinTournamentAsPlayer({ tournamentId: created.id, session: player });
    await joinTournamentAsViewer({ tournamentId: created.id, session: viewer });

    const afterLeave = await leaveTournament({ tournamentId: created.id, session: host });
    expect(afterLeave.state).toBe('cancelled');
    expect(afterLeave.players).toHaveLength(0);
    expect(afterLeave.viewers).toHaveLength(0);

    const liveRows = await listLiveTournaments();
    expect(liveRows.some((row) => row.id === created.id)).toBe(false);
    await expect(getTournamentClientState(created.id, { session: player })).rejects.toThrow(/not found/i);
    expect(await getCurrentTournamentForSession({ session: player })).toEqual({
      tournament: null,
      games: [],
      role: null,
    });
    expect(consumeTournamentAlerts(player.userId).join(' ')).toMatch(/host has left/i);
    expect(consumeTournamentAlerts(viewer.userId).join(' ')).toMatch(/host has left/i);
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

  test('cannot join once tournament is active without late joining enabled', async () => {
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
    })).rejects.toThrow(/late joining is enabled/i);
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

  test('host can end round robin early while active games finish normally', async () => {
    const host = { userId: '000000000000000000000503', username: 'EarlyEndHost', isGuest: false };
    const opponent = { userId: '000000000000000000000504', username: 'EarlyEndOpponent', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Early End Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });
    const closed = await endTournamentRoundRobin({ tournamentId: created.id, session: host });
    expect(closed.roundRobinClosedAt).toBeTruthy();
    expect(closed.phase).toBe('round_robin');

    const waitingState = await getTournamentClientState(created.id, { session: host });
    expect(waitingState.tournament.roundRobinWaitingForGames).toBe(true);
    expect(waitingState.tournament.canEndRoundRobin).toBe(false);
    expect(waitingState.tournament.canStartElimination).toBe(false);

    const [roundRobinGame] = await listTournamentGames(created.id);
    const liveGame = await Game.findById(roundRobinGame.gameId);
    await liveGame.endGame(0, WIN_REASONS.RESIGN);
    await maybeAdvanceTournamentRoundRobin(created.id);

    const completeState = await getTournamentClientState(created.id, { session: host });
    expect(completeState.tournament.phase).toBe('round_robin_complete');
    expect(completeState.tournament.canStartElimination).toBe(true);
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
      acceptWindowSeconds: 30,
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
    expect(eliminationGames[0].acceptWindowSeconds).toBe(120);

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

  test('elimination accept double no-show advances the higher seed even when higher seed is black', async () => {
    const host = { userId: '000000000000000000000631', username: 'HostSeedTimeout', isGuest: false };
    const opponent = { userId: '000000000000000000000632', username: 'OpponentSeedTimeout', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Seed Timeout Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const matchId = await startTwoPlayerElimination(created, started, host);
    const eliminationState = await getTournamentClientState(created.id, { session: host });
    const higherSeed = eliminationState.tournament.participants.find((entry) => entry.seed === 1);
    const lowerSeed = eliminationState.tournament.participants.find((entry) => entry.seed === 2);
    expect(higherSeed).toBeTruthy();
    expect(lowerSeed).toBeTruthy();

    const [eliminationGameEntry] = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'elimination');
    const eliminationGame = await Game.findById(eliminationGameEntry.gameId);
    eliminationGame.players = [lowerSeed.userId, higherSeed.userId];
    eliminationGame.playersReady = [false, false];
    eliminationGame.acceptDeadlineAt = new Date(Date.now() - 1000);
    await eliminationGame.save();

    const result = await enforceTournamentAcceptTimeoutForGame(eliminationGame._id);
    await flushAsyncEvents();

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      winnerColor: 1,
    }));
    const finalMatch = await Match.findById(matchId);
    expect(String(finalMatch.winner)).toBe(higherSeed.userId);
    const finalState = await getTournamentClientState(created.id, { session: host });
    expect(finalState.tournament.phase).toBe('completed');
  });

  test('withdrawn players remain as no-show placeholders for elimination', async () => {
    const host = { userId: '000000000000000000000633', username: 'HostNoShow', isGuest: false };
    const opponent = { userId: '000000000000000000000634', username: 'OpponentNoShow', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'No Show Placeholder Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const [roundRobinEntry] = await listTournamentGames(created.id);
    const roundRobinGame = await Game.findById(roundRobinEntry.gameId);
    const hostColor = roundRobinGame.players.map((id) => String(id)).findIndex((id) => id === host.userId);
    expect(hostColor).toBeGreaterThanOrEqual(0);
    await roundRobinGame.endGame(hostColor, WIN_REASONS.RESIGN);

    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    await leaveTournament({ tournamentId: created.id, session: opponent });
    expect(await getCurrentTournamentForSession({ session: opponent })).toEqual({
      tournament: null,
      games: [],
      role: null,
    });

    await startElimination({ tournamentId: created.id, session: host });
    const finalState = await getTournamentClientState(created.id, { session: host });
    const finalMatch = finalState.tournament.bracket.rounds[0].matches[0];
    expect(finalState.tournament.phase).toBe('completed');
    expect(finalState.tournament.participants.some((entry) => entry.userId === opponent.userId)).toBe(true);
    expect(finalMatch.playerA?.userId === opponent.userId || finalMatch.playerB?.userId === opponent.userId).toBe(true);
    expect(finalMatch.winner.userId).toBe(host.userId);
  });

  test('player leaving during an active round robin game gives the opponent the match win', async () => {
    const host = { userId: '000000000000000000000635', username: 'HostRoundRobinForfeit', isGuest: false };
    const opponent = { userId: '000000000000000000000636', username: 'OpponentRoundRobinForfeit', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Round Robin Forfeit Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    await startTournament({ tournamentId: created.id, session: host });
    const [roundRobinEntry] = await listTournamentGames(created.id);
    const activeGame = await Game.findById(roundRobinEntry.gameId);
    const hostColor = activeGame.players.map((id) => String(id)).findIndex((id) => id === host.userId);
    expect(hostColor).toBeGreaterThanOrEqual(0);

    await leaveTournament({ tournamentId: created.id, session: opponent });
    await flushAsyncEvents();

    const completedGame = await Game.findById(roundRobinEntry.gameId);
    const completedMatch = await Match.findById(roundRobinEntry.matchId);
    const hostScore = String(completedMatch.player1) === host.userId
      ? completedMatch.player1Score
      : completedMatch.player2Score;

    expect(completedGame.isActive).toBe(false);
    expect(completedGame.winner).toBe(hostColor);
    expect(completedMatch.isActive).toBe(false);
    expect(String(completedMatch.winner)).toBe(host.userId);
    expect(hostScore).toBe(1);
  });

  test('player leaving during an active elimination game gives the opponent the match win', async () => {
    const host = { userId: '000000000000000000000637', username: 'HostElimForfeit', isGuest: false };
    const opponent = { userId: '000000000000000000000638', username: 'OpponentElimForfeit', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Elimination Forfeit Cup' });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const matchId = await startTwoPlayerElimination(created, started, host);
    const { game: activeGame } = await getActiveGameForMatch(matchId);
    const hostColor = activeGame.players.map((id) => String(id)).findIndex((id) => id === host.userId);
    expect(hostColor).toBeGreaterThanOrEqual(0);

    await leaveTournament({ tournamentId: created.id, session: opponent });
    await flushAsyncEvents();

    const completedGame = await Game.findById(activeGame._id);
    const completedMatch = await Match.findById(matchId);
    const hostScore = String(completedMatch.player1) === host.userId
      ? completedMatch.player1Score
      : completedMatch.player2Score;
    const activeGames = await Game.find({ match: matchId, isActive: true });
    const finalState = await getTournamentClientState(created.id, { session: host });
    const finalMatch = finalState.tournament.bracket.rounds[0].matches[0];

    expect(completedGame.isActive).toBe(false);
    expect(completedGame.winner).toBe(hostColor);
    expect(completedMatch.isActive).toBe(false);
    expect(String(completedMatch.winner)).toBe(host.userId);
    expect(hostScore).toBe(completedMatch.winScoreTarget);
    expect(activeGames).toHaveLength(0);
    expect(finalState.tournament.phase).toBe('completed');
    expect(finalMatch.winner.userId).toBe(host.userId);
  });

  test('elimination draw cap advances the player with more game wins', async () => {
    const host = { userId: '000000000000000000000535', username: 'HostDrawLeader', isGuest: false };
    const opponent = { userId: '000000000000000000000536', username: 'OpponentDrawLeader', isGuest: false };
    const created = await createTournament({
      hostSession: host,
      label: 'Draw Leader Cup',
      config: { victoryPoints: 3 },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const matchId = await startTwoPlayerElimination(created, started, host);

    const openingWin = await endActiveGameForMatch(matchId, 0, WIN_REASONS.RESIGN);
    const leaderUserId = openingWin.players[0];

    await endActiveGameForMatch(matchId, null, WIN_REASONS.DRAW);
    await endActiveGameForMatch(matchId, null, WIN_REASONS.DRAW);
    await endActiveGameForMatch(matchId, null, WIN_REASONS.DRAW);

    const completedMatch = await Match.findById(matchId);
    expect(completedMatch.isActive).toBe(false);
    expect(String(completedMatch.winner)).toBe(leaderUserId);
    expect(completedMatch.drawCount).toBe(3);

    const finalState = await getTournamentClientState(created.id, { session: host });
    const finalMatch = finalState.tournament.bracket.rounds[0].matches[0];
    expect(finalState.tournament.phase).toBe('completed');
    expect(finalMatch.winner.userId).toBe(leaderUserId);
  });

  test('tied elimination draw cap keeps playing until the next game win', async () => {
    const host = { userId: '000000000000000000000537', username: 'HostSuddenDeath', isGuest: false };
    const opponent = { userId: '000000000000000000000538', username: 'OpponentSuddenDeath', isGuest: false };
    const created = await createTournament({
      hostSession: host,
      label: 'Sudden Death Cup',
      config: { victoryPoints: 3 },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: opponent });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const matchId = await startTwoPlayerElimination(created, started, host);

    await endActiveGameForMatch(matchId, null, WIN_REASONS.DRAW);
    await endActiveGameForMatch(matchId, null, WIN_REASONS.DRAW);
    await endActiveGameForMatch(matchId, null, WIN_REASONS.DRAW);

    const tiedCapMatch = await Match.findById(matchId);
    const suddenDeathGame = await getActiveGameForMatch(matchId);
    expect(tiedCapMatch.isActive).toBe(true);
    expect(tiedCapMatch.winner).toBeNull();
    expect(tiedCapMatch.drawCount).toBe(3);
    expect(suddenDeathGame.game).toBeTruthy();

    const suddenDeathWin = await endActiveGameForMatch(matchId, 0, WIN_REASONS.RESIGN);
    const winnerUserId = suddenDeathWin.players[0];
    const completedMatch = await Match.findById(matchId);

    expect(completedMatch.isActive).toBe(false);
    expect(String(completedMatch.winner)).toBe(winnerUserId);
    expect((completedMatch.player1Score || 0) + (completedMatch.player2Score || 0)).toBe(1);
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

  test('double elimination labels the active opening round instead of waiting grand finals', async () => {
    const host = { userId: '000000000000000000000555', username: 'HostDoubleLabel', isGuest: false };
    const a = { userId: '000000000000000000000556', username: 'LabelA', isGuest: false };
    const b = { userId: '000000000000000000000557', username: 'LabelB', isGuest: false };
    const c = { userId: '000000000000000000000558', username: 'LabelC', isGuest: false };
    const created = await createTournament({
      hostSession: host,
      label: 'Double Label Cup',
      config: { eliminationStyle: 'double' },
    });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: a });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: b });
    await joinTournamentAsPlayer({ tournamentId: created.id, session: c });

    const started = await startTournament({ tournamentId: created.id, session: host });
    const roundRobinGames = (await listTournamentGames(created.id)).filter((entry) => entry.phase === 'round_robin');
    for (const entry of roundRobinGames) {
      const rrGame = await Game.findById(entry.gameId);
      await rrGame.endGame(0, WIN_REASONS.RESIGN);
    }
    const deadlineSpy = jest.spyOn(Date, 'now').mockReturnValue(
      Date.parse(started.startedAt) + (16 * 60 * 1000),
    );
    await maybeAdvanceTournamentRoundRobin(created.id);
    deadlineSpy.mockRestore();

    await startElimination({ tournamentId: created.id, session: host });
    const eliminationState = await getTournamentClientState(created.id, { session: host });
    expect(eliminationState.tournament.phase).toBe('elimination');
    expect(eliminationState.tournament.currentRoundLabel).toBe('Semifinals');
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

  test('tournament client state includes current ELO without changing pre-tournament ELO', async () => {
    const originalReadyState = mongoose.connection.readyState;
    mongoose.connection.readyState = 1;

    const host = { userId: '000000000000000000000731', username: 'HostElo', isGuest: false };
    const player = { userId: '000000000000000000000732', username: 'PlayerElo', isGuest: false };

    jest.spyOn(User, 'findById').mockImplementation((id) => ({
      lean: jest.fn(async () => ({
        _id: id,
        elo: String(id) === host.userId ? 800 : 785,
      })),
    }));

    const select = jest.fn().mockReturnThis();
    const lean = jest.fn(async () => [
      { _id: host.userId, elo: 846 },
      { _id: player.userId, elo: 787 },
    ]);
    jest.spyOn(User, 'find').mockReturnValue({ select, lean });

    try {
      const created = await createTournament({ hostSession: host, label: 'Live Elo Cup' });
      await joinTournamentAsPlayer({ tournamentId: created.id, session: host });
      await joinTournamentAsPlayer({ tournamentId: created.id, session: player });

      const clientState = await getTournamentClientState(created.id, { session: host });
      const byUserId = new Map(clientState.tournament.participants.map((entry) => [entry.userId, entry]));

      expect(byUserId.get(host.userId)).toMatchObject({
        preTournamentElo: 800,
        elo: 846,
      });
      expect(byUserId.get(player.userId)).toMatchObject({
        preTournamentElo: 785,
        elo: 787,
      });
      expect(select).toHaveBeenCalledWith('_id elo');
    } finally {
      mongoose.connection.readyState = originalReadyState;
    }
  });

  test('tournament client state includes a server clock timestamp for live countdown sync', async () => {
    const host = { userId: '000000000000000000000721', username: 'HostClockSync', isGuest: false };
    const created = await createTournament({ hostSession: host, label: 'Clock Sync Cup' });

    const clientState = await getTournamentClientState(created.id, { session: host });
    expect(Number.isFinite(clientState.serverNowMs)).toBe(true);
    expect(clientState.serverNowMs).toBeGreaterThan(0);
  });
});
