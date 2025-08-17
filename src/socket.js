const { Server } = require('socket.io');
const Lobby = require('./models/Lobby');
const Game = require('./models/Game');
const maskGameForColor = require('./utils/gameView');
const eventBus = require('./eventBus');
const ChangeStreamToken = require('./models/ChangeStreamToken');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });
  const clients = new Map();
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
        isActive: masked.isActive,
        winner: masked.winner,
        winReason: masked.winReason,
        playersReady: game.playersReady,
        startTime: game.startTime,
      });
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
    const { userId } = socket.handshake.auth;
    if (userId) {
      clients.set(userId, socket);
    }
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
      const maskedGames = games.map((game) => {
        const color = game.players.findIndex(p => p.toString() === userId);
        const masked = maskGameForColor(game, color);
        return {
          ...masked,
          _id: game._id,
          players: game.players.map(p => p.toString()),
          playersReady: game.playersReady,
          startTime: game.startTime,
        };
      });

      socket.emit('initialState', { queued, games: maskedGames });
    } catch (err) {
      console.error('Error fetching initial state:', err);
    }

    socket.on('disconnect', async () => {
      console.log('Client disconnected', socket.id);
      if (userId) {
        // Grace period: remove mapping now, but defer queue cleanup
        clients.delete(userId);
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
      });
    } catch (err) {
      console.error('Error emitting admin metrics:', err);
    }
  }

  return io;
}

module.exports = initSocket;
