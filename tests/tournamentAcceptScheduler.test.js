const path = require('path');
const { pathToFileURL } = require('url');

describe('tournament accept scheduler', () => {
  let createTournamentAcceptScheduler;

  beforeAll(async () => {
    ({ createTournamentAcceptScheduler } = await import(
      pathToFileURL(path.resolve(__dirname, '../public/js/modules/tournaments/acceptScheduler.js')).href
    ));
  });

  function createTimerHarness() {
    let nextId = 1;
    const timers = new Map();
    return {
      setTimeoutFn(handler, delayMs) {
        const id = nextId++;
        timers.set(id, { handler, delayMs });
        return id;
      },
      clearTimeoutFn(id) {
        timers.delete(id);
      },
      getSingleTimer() {
        const entries = Array.from(timers.entries());
        expect(entries).toHaveLength(1);
        return {
          id: entries[0][0],
          ...entries[0][1],
        };
      },
      run(id) {
        const timer = timers.get(id);
        if (!timer) return;
        timers.delete(id);
        timer.handler();
      },
      size() {
        return timers.size;
      },
    };
  }

  test('queues the banner during grace and shows the honest remaining countdown after grace expires', () => {
    let nowMs = 1000;
    const shown = [];
    const timers = createTimerHarness();
    const scheduler = createTournamentAcceptScheduler({
      showAcceptBanner: (payload) => shown.push(payload),
      now: () => nowMs,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    scheduler.setGrace();
    scheduler.queue({ gameId: 'game-1', color: 1, startSeconds: 30 });

    expect(shown).toEqual([]);
    const timer = timers.getSingleTimer();
    expect(timer.delayMs).toBe(5000);

    nowMs = 6000;
    timers.run(timer.id);

    expect(shown).toEqual([
      { gameId: 'game-1', color: 1, startSeconds: 25 },
    ]);
  });

  test('forceImmediate flush bypasses the remaining grace period', () => {
    let nowMs = 1000;
    const shown = [];
    const timers = createTimerHarness();
    const scheduler = createTournamentAcceptScheduler({
      showAcceptBanner: (payload) => shown.push(payload),
      now: () => nowMs,
      setTimeoutFn: timers.setTimeoutFn,
      clearTimeoutFn: timers.clearTimeoutFn,
    });

    scheduler.setGrace();
    scheduler.queue({ gameId: 'game-2', color: 0, startSeconds: 30 });

    nowMs = 2500;
    expect(scheduler.flushPending({ forceImmediate: true })).toBe(true);
    expect(shown).toEqual([
      { gameId: 'game-2', color: 0, startSeconds: 29 },
    ]);
    expect(timers.size()).toBe(0);
  });

  test('does not queue a banner for games already accepted locally', () => {
    const shown = [];
    const scheduler = createTournamentAcceptScheduler({
      showAcceptBanner: (payload) => shown.push(payload),
      isLocallyAccepted: (gameId) => gameId === 'game-3',
    });

    expect(scheduler.queue({ gameId: 'game-3', color: 0, startSeconds: 30 })).toBe(false);
    expect(shown).toEqual([]);
  });

  test('keeps the earliest known deadline for a game across repeated updates', () => {
    let nowMs = 0;
    const shown = [];
    const scheduler = createTournamentAcceptScheduler({
      showAcceptBanner: (payload) => shown.push(payload),
      now: () => nowMs,
    });

    scheduler.rememberDeadline('game-4', 30);
    nowMs = 2000;
    scheduler.rememberDeadline('game-4', 30);

    expect(scheduler.getRemainingSeconds('game-4', 30)).toBe(28);
    expect(shown).toEqual([]);
  });

  test('replaces the deadline when the server sends an explicit extension', () => {
    let nowMs = 1000;
    const shown = [];
    const scheduler = createTournamentAcceptScheduler({
      showAcceptBanner: (payload) => shown.push(payload),
      now: () => nowMs,
    });

    scheduler.queue({ gameId: 'game-5', color: 0, startSeconds: 30 });
    nowMs = 11000;
    scheduler.queue({
      gameId: 'game-5',
      color: 0,
      startSeconds: 50,
      acceptDeadlineAt: new Date(nowMs + 50000).toISOString(),
    });

    expect(scheduler.getRemainingSeconds('game-5', 30)).toBe(50);
    expect(shown[shown.length - 1]).toEqual({ gameId: 'game-5', color: 0, startSeconds: 50 });
  });

  test('does not reshow an already visible banner for the same deadline', () => {
    let nowMs = 1000;
    let showing = false;
    const shown = [];
    const debugEvents = [];
    const deadlineAt = new Date(nowMs + 30000).toISOString();
    const scheduler = createTournamentAcceptScheduler({
      showAcceptBanner: (payload) => {
        showing = true;
        shown.push(payload);
      },
      isAcceptBannerShowing: ({ gameId }) => showing && gameId === 'game-6',
      onDebug: (event) => debugEvents.push(event),
      now: () => nowMs,
    });

    scheduler.queue({
      gameId: 'game-6',
      color: 1,
      startSeconds: 30,
      acceptDeadlineAt: deadlineAt,
    });
    nowMs = 1500;
    scheduler.queue({
      gameId: 'game-6',
      color: 1,
      startSeconds: 30,
      acceptDeadlineAt: deadlineAt,
    });

    expect(shown).toEqual([
      { gameId: 'game-6', color: 1, startSeconds: 30 },
    ]);
    expect(debugEvents.filter((event) => event === 'client-tournament-accept-immediate')).toHaveLength(1);
  });

  test('reshows an already visible banner when the deadline changes', () => {
    let nowMs = 1000;
    let showing = false;
    const shown = [];
    const scheduler = createTournamentAcceptScheduler({
      showAcceptBanner: (payload) => {
        showing = true;
        shown.push(payload);
      },
      isAcceptBannerShowing: ({ gameId }) => showing && gameId === 'game-7',
      now: () => nowMs,
    });

    scheduler.queue({
      gameId: 'game-7',
      color: 0,
      startSeconds: 30,
      acceptDeadlineAt: new Date(nowMs + 30000).toISOString(),
    });
    nowMs = 2000;
    scheduler.queue({
      gameId: 'game-7',
      color: 0,
      startSeconds: 60,
      acceptDeadlineAt: new Date(nowMs + 60000).toISOString(),
    });

    expect(shown).toEqual([
      { gameId: 'game-7', color: 0, startSeconds: 30 },
      { gameId: 'game-7', color: 0, startSeconds: 60 },
    ]);
  });
});
