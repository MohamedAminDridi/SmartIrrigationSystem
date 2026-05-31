const Redis  = require('ioredis');
const logger = require('../utils/logger');
let client;

exports.connectRedis = async () => {
  client = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    lazyConnect: true, maxRetriesPerRequest: 3,
  });
  await client.connect();
  logger.info('Redis connected');
  client.on('error', (e) => logger.error('Redis error:', e));
};

exports.getRedis = () => {
  if (!client) throw new Error('Redis not initialised');
  return client;
};
