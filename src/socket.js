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

  // Setup change streams to broadcast high-level events
  try {
    const lobbyChangeStream = Lobby.watch();
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
