require('dotenv').config();
const mongoose = require('mongoose');
const User     = require('../models/User.model');
const Farm     = require('../models/Farm.model');
const Gateway  = require('../models/Gateway.model');
const logger   = require('./logger');

async function seed() {
  const { connectMongo } = require('../config/database');
  await connectMongo();

  /* ── Admin ── */
  const adminEmail    = process.env.SEED_ADMIN_EMAIL    || 'admin@irrigation.io';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';

  await User.deleteOne({ email: adminEmail });
  const admin = await User.create({
    name: 'Platform Admin', email: adminEmail,
    password: adminPassword, role: 'admin',
  });
  logger.info(`✓ Admin created: ${adminEmail} / ${adminPassword}`);

  /* ── Demo Farmer ── */
  const farmerEmail    = 'farmer@irrigation.io';
  const farmerPassword = 'Farmer@1234';
  await User.deleteOne({ email: farmerEmail });
  const farmer = await User.create({
    name: 'Demo Farmer', email: farmerEmail,
    password: farmerPassword, role: 'farmer',
  });
  logger.info(`✓ Farmer created: ${farmerEmail} / ${farmerPassword}`);

  /* ── Demo Farm (owned by farmer, admin as member) ── */
  await Farm.deleteMany({ owner: farmer._id });
  const farm = await Farm.create({
    name:            'Demo Farm – Tunis',
    owner:           farmer._id,
    members:         [{ user: admin._id, role: 'viewer' }],
    location:        { lat: 36.8065, lng: 10.1815, address: 'Tunis, Tunisia', country: 'TN' },
    size_ha:         12.5,
    crop_type:       'tomatoes',
    irrigation_mode: 'auto',
    timezone:        'Africa/Tunis',
  });
  logger.info(`✓ Demo farm created: ${farm._id}`);

  /* ── Demo Gateway (fixes "Unknown node device_id" warning) ── */
  await Gateway.deleteOne({ device_id: 'gw-esp32-01' });
  await Gateway.create({
    device_id: 'gw-esp32-01',
    name:      'ESP32 Gateway 01',
    farm:      farm._id,
    isActive:  true,
  });
  logger.info('✓ Demo gateway created: gw-esp32-01');

  /* ── Sensor reading indexes ── */
  try {
    const db = mongoose.connection.db;
    await db.collection('sensor_readings').createIndex({ 'meta.nodeId': 1, ts: -1 });
    await db.collection('sensor_readings').createIndex({ 'meta.farmId': 1, ts: -1 });
    logger.info('✓ Indexes created');
  } catch (e) {
    logger.warn('Index creation note:', e.message);
  }

  logger.info('\n─────────────────────────────────────');
  logger.info('  Seed complete!');
  logger.info(`  Admin  → ${adminEmail}  /  ${adminPassword}`);
  logger.info(`  Farmer → ${farmerEmail}  /  ${farmerPassword}`);
  logger.info(`  Farm ID: ${farm._id}`);
  logger.info('─────────────────────────────────────\n');

  await mongoose.disconnect();
}

seed().catch(e => { logger.error(e); process.exit(1); });