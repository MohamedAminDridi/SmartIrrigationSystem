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

  // ── Irrigation schedules: open/close valves at their window each minute ──
  cron.schedule('* * * * *', async () => {
    const Schedule = require('../models/Schedule.model');
    const { publish }  = require('../mqtt/mqttClient');
    const topics       = require('../utils/mqttTopics');
    const { reconcileFarmPump } = require('../controllers/irrigation.controller');

    const now  = new Date();
    const day  = now.getDay();                       // 0=Sun … 6=Sat (server local time)
    const mins = now.getHours() * 60 + now.getMinutes();
    const schedules = await Schedule.find({ enabled: true, days: day });

    for (const sch of schedules) {
      const [sh, sm] = String(sch.startTime || '00:00').split(':').map(Number);
      const start = sh * 60 + sm;
      const end   = start + (sch.durationMin || 0);
      const isStart = mins === start;
      const isEnd   = mins === end;
      if (!isStart && !isEnd) continue;

      const nodes = sch.node ? await Node.find({ _id: sch.node })
                  : sch.zone ? await Node.find({ farm: sch.farm, zone: sch.zone })
                  :            await Node.find({ farm: sch.farm });
      if (!nodes.length) continue;

      for (const node of nodes) {
        if (isStart) {
          publish(topics.command(node.farm.toString(), node.device_id),
            { id: node.device_id, type: 'valve_open', payload: { percent: sch.valvePercent || 100 }, ts: Date.now() });
          node.valve_state = 'open'; node.valve_pct = sch.valvePercent || 100;
        } else {
          publish(topics.command(node.farm.toString(), node.device_id),
            { id: node.device_id, type: 'valve_close', payload: {}, ts: Date.now() });
          node.valve_state = 'closed'; node.valve_pct = 0;
        }
        await node.save();
      }
      try { await reconcileFarmPump(sch.farm); } catch (e) { logger.warn(`Schedule pump reconcile failed: ${e.message}`); }
      if (isStart) { sch.lastRun = now; await sch.save().catch(() => {}); }
      logger.info(`Schedule "${sch.name || sch._id}" ${isStart ? 'opened' : 'closed'} ${nodes.length} valve(s)`);
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
