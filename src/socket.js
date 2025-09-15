const { Server } = require('socket.io');
const Lobby = require('./models/Lobby');
const Game = require('./models/Game');
const Match = require('./models/Match');
const maskGameForColor = require('./utils/gameView');
const eventBus = require('./eventBus');
const ChangeStreamToken = require('./models/ChangeStreamToken');
const ensureUser = require('./utils/ensureUser');
const User = require('./models/User');
const getServerConfig = require('./utils/getServerConfig');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });
  const clients = new Map();
  const matchDisconnectState = new Map();
  const playerMatches = new Map();
  const DISCONNECT_LIMIT_MS = 30000;
  const MIN_DISCONNECT_GRACE_MS = 10000;

  function toId(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value.toString === 'function') return value.toString();
    return null;
  }

  function getMatchState(matchId) {
    const id = toId(matchId);
    if (!id) return null;
    let state = matchDisconnectState.get(id);
    if (!state) {
      state = { players: {} };
      matchDisconnectState.set(id, state);
    }
    return state;
  }

  function addPlayerMatch(playerId, matchId) {
    const pid = toId(playerId);
    const mid = toId(matchId);
    if (!pid || !mid) return;
    let set = playerMatches.get(pid);
    if (!set) {
      set = new Set();
      playerMatches.set(pid, set);
    }
    set.add(mid);
  }

  function removePlayerMatch(playerId, matchId) {
    const pid = toId(playerId);
    const mid = toId(matchId);
    if (!pid || !mid) return;
    const set = playerMatches.get(pid);
    if (!set) return;
    set.delete(mid);
    if (set.size === 0) {
      playerMatches.delete(pid);
    }
  }

  function cleanupMatchTracking(matchId) {
    const mid = toId(matchId);
    if (!mid) return;
    const state = matchDisconnectState.get(mid);
    if (!state) return;
    Object.entries(state.players).forEach(([pid, info]) => {
      if (info.timer) {
        clearInterval(info.timer);
        info.timer = null;
      }
      removePlayerMatch(pid, mid);
    });
    matchDisconnectState.delete(mid);
  }

  function computeElapsed(matchId, playerId) {
    const state = matchDisconnectState.get(matchId);
    if (!state) return null;
    const playerState = state.players[playerId];
    if (!playerState) return null;
    const now = Date.now();
    const disconnectedDuration = playerState.disconnectedSince ? (now - playerState.disconnectedSince) : 0;
    const elapsedMs = Math.min(DISCONNECT_LIMIT_MS, playerState.cumulativeMs + disconnectedDuration);
    const remainingSeconds = Math.max(0, Math.ceil((DISCONNECT_LIMIT_MS - elapsedMs) / 1000));
    const cumulativeSeconds = Math.floor(elapsedMs / 1000);
    return {
      elapsedMs,
      remainingSeconds,
      cumulativeSeconds,
      isDisconnected: Boolean(playerState.disconnectedSince),
    };
  }

  function broadcastStatus(matchId, playerId) {
    const mid = toId(matchId);
    const pid = toId(playerId);
    if (!mid || !pid) return;
    const state = matchDisconnectState.get(mid);
    if (!state) return;
    const status = computeElapsed(mid, pid);
    if (!status) return;
    const payload = {
      matchId: mid,
      playerId: pid,
      isDisconnected: status.isDisconnected,
      remainingSeconds: status.remainingSeconds,
      cumulativeSeconds: status.cumulativeSeconds,
    };
    Object.keys(state.players).forEach((otherId) => {
      const socket = clients.get(otherId);
      if (socket) {
        socket.emit('match:connectionStatus', payload);
      }
    });
  }

  function stopDisconnectTimer(playerState) {
    if (playerState?.timer) {
      clearInterval(playerState.timer);
      playerState.timer = null;
    }
  }

  function markPlayerConnected(playerId, matchId, { broadcast = true } = {}) {
    const mid = toId(matchId);
    const pid = toId(playerId);
    if (!mid || !pid) return;
    const state = matchDisconnectState.get(mid);
    if (!state) return;
    const playerState = state.players[pid];
    if (!playerState) return;
    if (playerState.disconnectedSince) {
      playerState.cumulativeMs = Math.min(
        DISCONNECT_LIMIT_MS,
        playerState.cumulativeMs + (Date.now() - playerState.disconnectedSince)
      );
      playerState.disconnectedSince = null;
    }
    playerState.handled = false;
    stopDisconnectTimer(playerState);
    if (broadcast) {
      broadcastStatus(mid, pid);
    }
  }

  function startDisconnectTimer(matchId, playerId) {
    const state = matchDisconnectState.get(matchId);
    if (!state) return;
    const playerState = state.players[playerId];
    if (!playerState) return;
    if (playerState.timer) return;
    playerState.timer = setInterval(() => {
      checkDisconnectStatus(matchId, playerId).catch((err) => {
        console.error('Error checking disconnect timeout', err);
      });
    }, 1000);
    checkDisconnectStatus(matchId, playerId).catch((err) => {
      console.error('Error checking disconnect timeout', err);
    });
  }

  function markPlayerDisconnected(playerId, matchId, { broadcast = true } = {}) {
    const mid = toId(matchId);
    const pid = toId(playerId);
    if (!mid || !pid) return;
    const state = getMatchState(mid);
    let playerState = state.players[pid];
    if (!playerState) {
      playerState = { cumulativeMs: 0, disconnectedSince: null, timer: null, handled: false };
      state.players[pid] = playerState;
    }
    if (playerState.disconnectedSince) return;
    const minGrace = Math.min(DISCONNECT_LIMIT_MS, MIN_DISCONNECT_GRACE_MS);
    const targetCumulative = DISCONNECT_LIMIT_MS - minGrace;
    if ((DISCONNECT_LIMIT_MS - playerState.cumulativeMs) < minGrace) {
      playerState.cumulativeMs = Math.max(0, targetCumulative);
    }
    playerState.disconnectedSince = Date.now();
    playerState.handled = false;
    startDisconnectTimer(mid, pid);
    if (broadcast) {
      broadcastStatus(mid, pid);
    }
  }

  function markPlayerConnectedToAllMatches(playerId) {
    const pid = toId(playerId);
    if (!pid) return;
    const matches = playerMatches.get(pid);
    if (!matches) return;
    matches.forEach((matchId) => markPlayerConnected(pid, matchId));
  }

  function markPlayerDisconnectedFromAllMatches(playerId) {
    const pid = toId(playerId);
    if (!pid) return;
    const matches = playerMatches.get(pid);
    if (!matches) return;
    matches.forEach((matchId) => markPlayerDisconnected(pid, matchId));
  }

  function registerMatch(matchId, players = []) {
    const mid = toId(matchId);
    if (!mid) return;
    const state = getMatchState(mid);
    players.forEach((player) => {
      const pid = toId(player);
      if (!pid) return;
      if (!state.players[pid]) {
        state.players[pid] = { cumulativeMs: 0, disconnectedSince: null, timer: null, handled: false };
      }
      addPlayerMatch(pid, mid);
      if (clients.has(pid)) {
        markPlayerConnected(pid, mid);
      } else {
        markPlayerDisconnected(pid, mid);
      }
    });
  }

  async function checkDisconnectStatus(matchId, playerId) {
    const status = computeElapsed(matchId, playerId);
    if (!status) return;
    if (status.elapsedMs >= DISCONNECT_LIMIT_MS) {
      await handleDisconnectTimeout(matchId, playerId);
    } else {
      broadcastStatus(matchId, playerId);
    }
  }

  async function handleDisconnectTimeout(matchId, playerId) {
    const state = matchDisconnectState.get(matchId);
    if (!state) return;
    const playerState = state.players[playerId];
    if (!playerState || playerState.handled) return;
    playerState.handled = true;
    stopDisconnectTimer(playerState);
    playerState.cumulativeMs = DISCONNECT_LIMIT_MS;

    const loserId = toId(playerId);

    try {
      const match = await Match.findById(matchId);
      if (!match || !match.isActive) {
        cleanupMatchTracking(matchId);
        return;
      }

      const config = await getServerConfig();
      const winReasonValue = config?.winReasons?.get
        ? config.winReasons.get('DISCONNECT')
        : config?.winReasons?.DISCONNECT ?? 5;
      const settings = config?.gameModeSettings?.get
        ? config.gameModeSettings.get(match.type)
        : config?.gameModeSettings?.[match.type];
      const winScore = settings?.WIN_SCORE ?? 1;

      const player1Id = match.player1?.toString();
      const player2Id = match.player2?.toString();
      const winnerId = player1Id === loserId ? player2Id : player1Id;

      if (!winnerId) {
        cleanupMatchTracking(matchId);
        return;
      }

      if (winnerId === player1Id) {
        match.player1Score = Math.max(match.player1Score || 0, winScore);
      } else if (winnerId === player2Id) {
        match.player2Score = Math.max(match.player2Score || 0, winScore);
      }

      const games = await Game.find({ match: match._id, isActive: true });

      await match.endMatch(winnerId);

      for (const game of games) {
        const winnerIdx = game.players.findIndex(p => p.toString() === winnerId);
        if (winnerIdx === -1) continue;
        await game.endGame(winnerIdx, winReasonValue);
        const updatedGame = await Game.findById(game._id).lean();
        if (updatedGame) {
          eventBus.emit('gameChanged', {
            game: updatedGame,
            affectedUsers: (updatedGame.players || []).map(id => id.toString()),
          });
        }
      }
    } catch (err) {
      console.error('Error handling disconnect timeout', err);
      playerState.handled = false;
      if (!playerState.disconnectedSince) {
        playerState.disconnectedSince = Date.now();
      }
      startDisconnectTimer(matchId, playerId);
      return;
    }

    cleanupMatchTracking(matchId);
  }

  // Admin namespace for dashboard metrics
  const adminNamespace = io.of('/admin');

  const lobbyState = { quickplayQueue: [], rankedQueue: [] };
  Lobby.findOne().lean().then(lobby => {
    if (lobby) {
      lobbyState.quickplayQueue = lobby.quickplayQueue.map(id => id.toString());
      lobbyState.rankedQueue = lobby.rankedQueue.map(id => id.toString());
    }
  }).catch(err => {
    console.error('Error initializing lobby state:', err);
  });

  eventBus.on('queueChanged', (payload) => {
    let newQuick = [];
    let newRanked = [];
    const affected = new Set();

    if (payload.fullDocument) {
      const { quickplayQueue = [], rankedQueue = [] } = payload.fullDocument;
      newQuick = quickplayQueue.map(id => id.toString());
      newRanked = rankedQueue.map(id => id.toString());

      const added = new Set();
      const removed = new Set();

      newQuick.forEach(id => { if (!lobbyState.quickplayQueue.includes(id)) added.add(id); });
      lobbyState.quickplayQueue.forEach(id => { if (!newQuick.includes(id)) removed.add(id); });
      newRanked.forEach(id => { if (!lobbyState.rankedQueue.includes(id)) added.add(id); });
      lobbyState.rankedQueue.forEach(id => { if (!newRanked.includes(id)) removed.add(id); });

      [...added, ...removed].forEach(id => affected.add(id));
    } else {
      newQuick = (payload.quickplayQueue || []).map(id => id.toString());
      newRanked = (payload.rankedQueue || []).map(id => id.toString());
      (payload.affectedUsers || []).forEach(id => affected.add(id.toString()));
    }

    affected.forEach((id) => {
      const socket = clients.get(id);
      if (socket) {
        socket.emit('queue:update', {
          quickplay: newQuick.includes(id),
          ranked: newRanked.includes(id),
        });
      }
    });

      lobbyState.quickplayQueue = newQuick;
      lobbyState.rankedQueue = newRanked;

      // Emit updated metrics to admin dashboard
      emitAdminMetrics();
    });

  eventBus.on('match:created', (payload) => {
    if (!payload) return;
    registerMatch(payload.matchId, payload.players || []);
  });

  eventBus.on('match:ended', (payload) => {
    if (!payload) return;
    cleanupMatchTracking(payload.matchId);
  });

  eventBus.on('gameChanged', async (payload) => {
    let game;
    if (payload.game) {
      game = typeof payload.game.toObject === 'function'
        ? payload.game.toObject()
        : payload.game;
    } else {
      const gameId = payload?.documentKey?._id || payload?.gameId;
      if (!gameId) return;
      try {
        game = await Game.findById(gameId).lean();
      } catch (err) {
        console.error('Error fetching game for update:', err);
        return;
      }
    }

    if (!game) return;

    const matchId = game.match?.toString();
    const gameIdStr = game._id.toString();
    const players = (payload.affectedUsers || game.players || []).map(id => id.toString());

    players.forEach((playerId) => {
      const socket = clients.get(playerId);
      if (!socket) return;
      const idx = game.players.findIndex(p => p.toString() === playerId);
      const masked = maskGameForColor(JSON.parse(JSON.stringify(game)), idx);
      socket.emit('game:update', {
        matchId,
        gameId: gameIdStr,
        board: masked.board,
        actions: masked.actions,
        moves: masked.moves,
        captured: masked.captured,
        stashes: masked.stashes,
        onDecks: masked.onDecks,
        players: masked.players,
        daggers: masked.daggers,
        playerTurn: masked.playerTurn,
        onDeckingPlayer: masked.onDeckingPlayer,
        setupComplete: game.setupComplete,
        isActive: masked.isActive,
        winner: masked.winner,
        winReason: masked.winReason,
        playersReady: game.playersReady,
        setupComplete: game.setupComplete,
        startTime: game.startTime,
        timeControlStart: game.timeControlStart,
        increment: game.increment,
      });
    });

    // If the game has ended, send the full unmasked state to both players
    if (!game.isActive) {
      players.forEach((playerId) => {
        const socket = clients.get(playerId);
        if (!socket) return;
        socket.emit('game:finished', {
          matchId,
          gameId: gameIdStr,
          board: game.board,
          actions: game.actions,
          moves: game.moves,
          captured: game.captured,
          stashes: game.stashes,
          onDecks: game.onDecks,
          players: (game.players || []).map(p => p.toString()),
          daggers: game.daggers,
          playerTurn: game.playerTurn,
          onDeckingPlayer: game.onDeckingPlayer,
          setupComplete: game.setupComplete,
          isActive: game.isActive,
          winner: game.winner,
          winReason: game.winReason,
          playersReady: game.playersReady,
          startTime: game.startTime,
          timeControlStart: game.timeControlStart,
          increment: game.increment,
        });
      });

      // Log final game details for debugging/analytics
      console.log('Game finished:', {
        gameId: gameIdStr,
        winner: game.winner,
        winReason: game.winReason,
        game,
      });
    }
  });

  // Relay explicit both-ready signal to affected users
  eventBus.on('players:bothReady', (payload) => {
    const gameId = payload?.gameId?.toString?.() || payload?.gameId
    const users = (payload?.affectedUsers || []).map(id => id.toString())
    console.log('[server] relaying players:bothReady', { gameId, users })
    users.forEach((playerId) => {
      const socket = clients.get(playerId)
      if (socket) {
        socket.emit('players:bothReady', { gameId })
      } else {
        console.warn('[server] players:bothReady user not connected:', playerId)
      }
    })
  })

  // Notify a single player that opponent clicked Next and countdown started
  eventBus.on('nextCountdown', (payload) => {
    const gameId = payload?.gameId?.toString?.() || payload?.gameId;
    const color = payload?.color;
    const seconds = payload?.seconds;
    (payload?.affectedUsers || []).forEach(id => {
      const socket = clients.get(id.toString());
      if (socket) {
        socket.emit('next:countdown', { gameId, color, seconds });
      }
    });
  });

  // Relay both-next signal to affected users with their color
  eventBus.on('players:bothNext', async (payload) => {
    let game = payload.game;
    if (!game) {
      const gameId = payload?.gameId;
      if (gameId) {
        try {
          game = await Game.findById(gameId).lean();
        } catch (_) {}
      }
    }
    if (!game) return;
    const gameIdStr = game._id.toString();
    (payload?.affectedUsers || game.players || []).forEach((id, idx) => {
      const socket = clients.get(id.toString());
      if (socket) {
        socket.emit('players:bothNext', { gameId: gameIdStr, color: idx });
      }
    });
  });

  async function setupChangeStream(Model, streamName, pipeline, options, handler) {
    let resumeToken = await ChangeStreamToken.getToken(streamName);

    const start = () => {
      const watchOptions = { ...options };
      if (resumeToken) {
        watchOptions.resumeAfter = resumeToken;
      }

      let stream;
      try {
        stream = Model.watch(pipeline, watchOptions);
      } catch (err) {
        console.error(`Error watching ${streamName}:`, err);
        return;
      }

      stream.on('change', async (change) => {
        try {
          handler(change);
        } finally {
          resumeToken = change._id;
          try {
            await ChangeStreamToken.saveToken(streamName, resumeToken);
          } catch (err) {
            console.error(`Error saving resume token for ${streamName}:`, err);
          }
        }
      });

      const restart = () => {
        console.warn(`${streamName} change stream restarting.`);
        start();
      };

      stream.on('error', (err) => {
        console.error(`Error in ${streamName} change stream:`, err);
        restart();
      });

      stream.on('close', restart);
    };

    start();
  }

  // Setup change streams to broadcast high-level events with resume tokens
  // Only enable change streams in production (replica sets)
  if (process.env.NODE_ENV === 'production') {
    setupChangeStream(
      Lobby,
      'Lobby',
      [],
      { fullDocument: 'updateLookup' },
      (change) => eventBus.emit('queueChanged', change)
    );

    setupChangeStream(
      Game,
      'Game',
      [],
      {},
      (change) => eventBus.emit('gameChanged', change)
    );
  } else {
    console.log('Change streams disabled in development mode (requires replica set)');
  }

  // Allow other parts of the app to request an on-demand admin metrics refresh
  eventBus.on('adminRefresh', () => emitAdminMetrics());

  io.on('connection', async (socket) => {
    let { userId } = socket.handshake.auth || {};
    let userInfo;
    try {
      userInfo = await ensureUser(userId);
      userId = userInfo.userId;
    } catch (err) {
      console.error('Failed to ensure user account:', err);
      return socket.disconnect(true);
    }
    // If a user reconnects quickly, keep the most recent socket only
    const prev = clients.get(userId);
    if (prev && prev.id !== socket.id) {
      try { prev.disconnect(true) } catch (_) {}
    }
    clients.set(userId, socket);
    markPlayerConnectedToAllMatches(userId);
    socket.emit('user:init', { userId, username: userInfo.username, guest: userInfo.isGuest });
    console.log('Client connected', socket.id);

    // Emit updated metrics to admin dashboard on new connection
    emitAdminMetrics();

    try {
      const lobby = await Lobby.findOne().lean();
      const queued = {
        quickplay: lobby?.quickplayQueue?.some(id => id.toString() === userId) || false,
        ranked: lobby?.rankedQueue?.some(id => id.toString() === userId) || false,
      };

      const games = await Game.find({ players: userId, isActive: true }).lean();

      const matchPlayers = new Map();
      games.forEach((game) => {
        const matchId = toId(game?.match);
        if (!matchId) return;
        if (!matchPlayers.has(matchId)) {
          matchPlayers.set(matchId, new Set());
        }
        (game.players || []).forEach((p) => {
          const pid = toId(p);
          if (pid) {
            matchPlayers.get(matchId).add(pid);
          }
        });
      });
      matchPlayers.forEach((playersSet, matchId) => {
        registerMatch(matchId, Array.from(playersSet));
      });

      const maskedGames = games.map((game) => {
        const color = game.players.findIndex(p => p.toString() === userId);
        const masked = maskGameForColor(game, color);
        return {
          ...masked,
          _id: game._id,
          players: game.players.map(p => p.toString()),
          playersReady: game.playersReady,
          startTime: game.startTime,
          timeControlStart: game.timeControlStart,
          increment: game.increment,
        };
      });

      socket.emit('initialState', { queued, games: maskedGames });

      // Previously we sent a `game:finished` event for all completed games
      // whenever a user connected. This caused stale victory/defeat banners
      // to appear when the page was refreshed between games. To avoid this
      // confusing behavior, no `game:finished` events are emitted during
      // initial connection. Finished games are only broadcast at the moment
      // they conclude.
    } catch (err) {
      console.error('Error fetching initial state:', err);
    }

    socket.on('disconnect', async () => {
      console.log('Client disconnected', socket.id);
      if (userId) {
        const current = clients.get(userId);
        const isCurrent = !current || current.id === socket.id;
        if (isCurrent) {
          // Grace period: remove mapping now, but defer queue cleanup
          clients.delete(userId);
          markPlayerDisconnectedFromAllMatches(userId);
        }
        setTimeout(async () => {
          // If user reconnected, skip cleanup
          if (clients.has(userId)) return;
          try {
            const Lobby = require('./models/Lobby');
            const lobby = await Lobby.findOne();
            if (!lobby) return;
            const before = lobby.quickplayQueue.length;
            lobby.quickplayQueue = lobby.quickplayQueue.filter(id => id.toString() !== userId);
            if (lobby.quickplayQueue.length !== before) {
              await lobby.save();
              const eventBus = require('./eventBus');
              eventBus.emit('queueChanged', {
                quickplayQueue: lobby.quickplayQueue.map(id => id.toString()),
                rankedQueue: lobby.rankedQueue.map(id => id.toString()),
                affectedUsers: [userId.toString()],
              });
            }
          } catch (err) {
            console.error('Error cleaning up queue after disconnect:', err);
          }
        }, 3000);
      }
      // Emit updated metrics to admin dashboard
      emitAdminMetrics();
    });
  });

  // Admin namespace connections
  adminNamespace.on('connection', (socket) => {
    console.log('Admin connected', socket.id);
    // Send initial metrics snapshot
    emitAdminMetrics();

    socket.on('disconnect', () => {
      console.log('Admin disconnected', socket.id);
    });
  });

  async function emitAdminMetrics() {
    try {
      const connectedIds = Array.from(clients.keys());
      // Build in-game user list from active games
      let inGameIds = [];
      let gamesList = [];
      let matchesList = [];
      try {
        const activeGames = await Game.find({ isActive: true }).select('players _id').lean();
        const set = new Set();
        activeGames.forEach(g => {
          (g.players || []).forEach(p => set.add(p.toString()));
          gamesList.push({ id: g._id.toString(), players: (g.players || []).map(p => p.toString()) });
        });
        inGameIds = Array.from(set);
      } catch (err) {
        console.error('Error fetching active games for admin metrics:', err);
      }

      try {
        const Match = require('./models/Match');
        const activeMatches = await Match.find({ isActive: true }).select('player1 player2 _id').lean();
        matchesList = activeMatches.map(m => ({ id: m._id.toString(), players: [m.player1?.toString(), m.player2?.toString()].filter(Boolean) }));
      } catch (err) {
        console.error('Error fetching active matches for admin metrics:', err);
      }

      const allIds = new Set([
        ...connectedIds,
        ...lobbyState.quickplayQueue,
        ...lobbyState.rankedQueue,
        ...inGameIds,
      ]);
      const users = await User.find({ _id: { $in: Array.from(allIds) } })
        .select('_id username')
        .lean();
      const usernames = {};
      users.forEach(u => {
        usernames[u._id.toString()] = u.username;
      });

      adminNamespace.emit('admin:metrics', {
        connectedUsers: connectedIds.length,
        quickplayQueue: lobbyState.quickplayQueue.length,
        rankedQueue: lobbyState.rankedQueue.length,
        inGameUsers: inGameIds.length,
        connectedUserIds: connectedIds,
        quickplayQueueUserIds: lobbyState.quickplayQueue,
        rankedQueueUserIds: lobbyState.rankedQueue,
        inGameUserIds: inGameIds,
        games: gamesList,
        matches: matchesList,
        usernames,
      });
    } catch (err) {
      console.error('Error emitting admin metrics:', err);
    }
  }

  return io;
}

module.exports = initSocket;
