const { Server } = require('socket.io');

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
    },
  });
  const clients = new Map();

  io.on('connection', (socket) => {
    const { userId } = socket.handshake.auth;
    clients.set(userId, socket);
    console.log('Client connected', socket.id);

    socket.on('disconnect', () => {
      console.log('Client disconnected', socket.id);
      clients.delete(userId);
    });
  });

  return io;
}

module.exports = initSocket;
