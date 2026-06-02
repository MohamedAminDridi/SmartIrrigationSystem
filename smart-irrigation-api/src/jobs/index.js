const cron    = require('node-cron');
const logger  = require('../utils/logger');
const Node    = require('../models/Node.model');
const Gateway = require('../models/Gateway.model');
const Alert   = require('../models/Alert.model');
const weather = require('../services/weather.service');
const { emitToFarm } = require('../socket/socketServer');

// 1-hour cooldown: don't spam the same offline alert every cron tick
async function offlineAlertExists(query) {
  return Alert.exists({
    ...query,
    type:         'device_offline',
    acknowledged: false,
    createdAt:    { $gt: new Date(Date.now() - 60 * 60 * 1000) },
  });
}

exports.startJobs = () => {

  // ── Every minute: mark gateways + nodes offline if silent too long ──
  cron.schedule('* * * * *', async () => {
    const now = Date.now();

    // ── Gateways: offline if no heartbeat in 15 s ─────────────────────
    const gwCutoff = new Date(now - 15 * 1000);
    const offlineGWs = await Gateway.find({
      last_heartbeat: { $lt: gwCutoff },
      status: 'online',
    }).select('_id device_id farm');

    for (const gw of offlineGWs) {
      await Gateway.findByIdAndUpdate(gw._id, { status: 'offline' });
      logger.warn(`Gateway offline: ${gw.device_id}`);

      // Create alert once per hour max
      const exists = await offlineAlertExists({ farm: gw.farm });
      if (!exists) {
        const alert = await Alert.create({
          farm:     gw.farm,
          type:     'device_offline',
          severity: 'critical',
          message:  `Gateway "${gw.device_id}" went offline`,
        });
        emitToFarm(gw.farm.toString(), 'alert:new', alert.toObject());
        logger.warn(`🚨 Alert created: gateway ${gw.device_id} offline`);
      }

      emitToFarm(gw.farm.toString(), 'gateway:status', {
        device_id: gw.device_id,
        status:    'offline',
        ts:        new Date(),
      });
    }

    // ── Nodes: offline if no last_seen in 30 s ────────────────────────
    const nodeCutoff = new Date(now - 30 * 1000);
    const offlineNodes = await Node.find({
      last_seen: { $lt: nodeCutoff },
      status:    'online',
    }).select('_id device_id farm');

    for (const node of offlineNodes) {
      await Node.findByIdAndUpdate(node._id, { status: 'offline' });
      logger.warn(`Node offline: ${node.device_id}`);

      const exists = await offlineAlertExists({ farm: node.farm, node: node._id });
      if (!exists) {
        const alert = await Alert.create({
          farm:     node.farm,
          node:     node._id,
          type:     'device_offline',
          severity: 'critical',
          message:  `Node "${node.device_id}" went offline`,
        });
        emitToFarm(node.farm.toString(), 'alert:new', alert.toObject());
        logger.warn(`🚨 Alert created: node ${node.device_id} offline`);
      }

      emitToFarm(node.farm.toString(), 'node:status', {
        device_id: node.device_id,
        status:    'offline',
        ts:        new Date(),
      });
    }
  });

  // ── Live weather: fetch Open-Meteo per farm and broadcast over Socket.IO ──
  // Every 15 min (Open-Meteo updates ~hourly; 15 min keeps clients fresh while
  // staying well within the free rate limit). Plus one run ~5 s after boot.
  cron.schedule('*/15 * * * *', () => {
    weather.refreshAllFarms().catch((e) => logger.warn(`Weather refresh failed: ${e.message}`));
  });
  setTimeout(() => {
    weather.refreshAllFarms().catch((e) => logger.warn(`Weather warm-up failed: ${e.message}`));
  }, 5000);

  // ── Daily summary log ──────────────────────────────────────────────
  cron.schedule('0 0 * * *', () => {
    logger.info('Daily cron: system summary logged');
  });

  logger.info('Cron jobs started');
};
