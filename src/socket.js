const { Server } = require('socket.io');
const Lobby = require('./models/Lobby');
const Game = require('./models/Game');
const maskGameForColor = require('./utils/gameView');
const eventBus = require('./eventBus');

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

  eventBus.on('queueChanged', (change) => {
    if (!change.fullDocument) return;

    const { quickplayQueue = [], rankedQueue = [] } = change.fullDocument;
    const newQuick = quickplayQueue.map(id => id.toString());
    const newRanked = rankedQueue.map(id => id.toString());

    const added = new Set();
    const removed = new Set();

    newQuick.forEach(id => { if (!lobbyState.quickplayQueue.includes(id)) added.add(id); });
    lobbyState.quickplayQueue.forEach(id => { if (!newQuick.includes(id)) removed.add(id); });
    newRanked.forEach(id => { if (!lobbyState.rankedQueue.includes(id)) added.add(id); });
    lobbyState.rankedQueue.forEach(id => { if (!newRanked.includes(id)) removed.add(id); });

    const affected = new Set([...added, ...removed]);
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

  eventBus.on('gameChanged', async (change) => {
    const gameId = change?.documentKey?._id;
    if (!gameId) return;

    let game;
    try {
      game = await Game.findById(gameId).lean();
    } catch (err) {
      console.error('Error fetching game for update:', err);
      return;
    }
    if (!game) return;

    const matchId = game.match?.toString();
    const gameIdStr = game._id.toString();

    game.players.forEach((playerId, idx) => {
      const socket = clients.get(playerId.toString());
      if (!socket) return;
      const masked = maskGameForColor(JSON.parse(JSON.stringify(game)), idx);
      socket.emit('game:update', {
        matchId,
        gameId: gameIdStr,
        board: masked.board,
        actions: masked.actions,
      });
    });
  });

  // Setup change streams to broadcast high-level events
  try {
    const lobbyChangeStream = Lobby.watch([], { fullDocument: 'updateLookup' });
    lobbyChangeStream.on('change', (change) => {
      eventBus.emit('queueChanged', change);
    });
  } catch (err) {
    console.error('Error watching Lobby:', err);
  }

  try {
    const gameChangeStream = Game.watch();
    gameChangeStream.on('change', (change) => {
      eventBus.emit('gameChanged', change);
    });
  } catch (err) {
    console.error('Error watching Game:', err);
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
