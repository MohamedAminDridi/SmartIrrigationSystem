const mongoose = require('mongoose');
const logger   = require('../utils/logger');

exports.connectMongo = async () => {
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
  });
  logger.info('MongoDB connected');
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));
  mongoose.connection.on('error', (e) => logger.error('MongoDB error:', e));

  // Create MongoDB time-series collection for sensor readings (once)
  await ensureTimeSeriesCollection();
};

async function ensureTimeSeriesCollection() {
  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: 'sensor_readings' }).toArray();
  if (!collections.length) {
    await db.createCollection('sensor_readings', {
      timeseries: {
        timeField:   'ts',
        metaField:   'meta',
        granularity: 'seconds',
      },
      expireAfterSeconds: 60 * 60 * 24 * 365, // auto-delete after 1 year
    });
    logger.info('MongoDB time-series collection "sensor_readings" created');
  }
}
