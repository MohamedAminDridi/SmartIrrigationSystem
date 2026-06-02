const { Server } = require('socket.io');
const { verifyAccess } = require('../utils/jwtHelper');
const logger = require('../utils/logger');

let io;

exports.initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CORS_ORIGIN
        ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
        : '*',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout:  60000,
    pingInterval: 25000,
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      socket.user = verifyAccess(token);
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    logger.debug(`Socket connected: ${socket.id}`);

    socket.on('join:farm', (farmId) => {
      const room = `farm:${farmId}`;
      socket.join(room);
      console.log(`🔍 [SOCKET] ${socket.id} joined room "${room}"`);
      console.log(`🔍 [SOCKET] all rooms:`, [...socket.rooms]);
      // Send the last-known weather immediately so the scene isn't blank until
      // the next 15-min broadcast (lazy require avoids a circular dependency).
      try {
        const cached = require('../services/weather.service').getCached(farmId);
        if (cached) socket.emit('weather:update', cached);
      } catch { /* weather service not ready */ }
    });

    socket.on('leave:farm', (farmId) => {
      socket.leave(`farm:${farmId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.debug(`Socket disconnected: ${socket.id} reason="${reason}"`);
    });
  });

  logger.info('Socket.IO initialised');
};

exports.emitToFarm = (farmId, event, data) => {
  if (!io) return;
  const room    = `farm:${farmId}`;
  const sockets = io.sockets.adapter.rooms.get(room);
  console.log(`🔍 [EMIT] room="${room}" event="${event}" clients=${sockets ? sockets.size : 0}`);
  io.to(room).emit(event, data);
};

exports.getIO = () => io;