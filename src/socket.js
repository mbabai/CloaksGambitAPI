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
        stashes: masked.stashes,
        onDecks: masked.onDecks,
        players: masked.players
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

  io.on('connection', async (socket) => {
    const { userId } = socket.handshake.auth;
    clients.set(userId, socket);
    console.log('Client connected', socket.id);

    try {
      const lobby = await Lobby.findOne().lean();
      const queued = {
        quickplay: lobby?.quickplayQueue?.some(id => id.toString() === userId) || false,
        ranked: lobby?.rankedQueue?.some(id => id.toString() === userId) || false,
      };

      const games = await Game.find({ players: userId, isActive: true }).lean();
      const maskedGames = games.map((game) => {
        const color = game.players.findIndex(p => p.toString() === userId);
        return maskGameForColor(game, color);
      });

      socket.emit('initialState', { queued, games: maskedGames });
    } catch (err) {
      console.error('Error fetching initial state:', err);
    }

    socket.on('disconnect', () => {
      console.log('Client disconnected', socket.id);
      clients.delete(userId);
    });
  });

  return io;
}

module.exports = initSocket;
