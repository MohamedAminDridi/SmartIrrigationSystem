const mqtt      = require('mqtt');
const logger    = require('../utils/logger');
const handleTelemetry = require('./telemetryHandler');
const { emitToFarm }  = require('../socket/socketServer');

let client;

const initMQTT = () => {
  const brokerUrl = process.env.MQTT_BROKER_URL || 'mqtt://127.0.0.1:1883';
  const opts = {
    clientId:        process.env.MQTT_CLIENT_ID || `irrigation-backend-${Date.now()}`,
    reconnectPeriod: 5000,
    connectTimeout:  10000,
    keepalive:       60,
  };
  if (process.env.MQTT_USERNAME) opts.username = process.env.MQTT_USERNAME;
  if (process.env.MQTT_PASSWORD) opts.password = process.env.MQTT_PASSWORD;

  client = mqtt.connect(brokerUrl, opts);

  client.on('connect', () => {
    logger.info(`✅ MQTT connected → ${brokerUrl}`);
    const subs = [
      'farms/+/nodes/+/telemetry',
      'farms/+/nodes/+/status',
      'farms/+/nodes/+/alerts',
      'farms/+/gateways/+/heartbeat',
    ];
    client.subscribe(subs, { qos: 1 }, (err, granted) => {
      if (err) logger.error('MQTT subscribe error:', err.message);
      else granted.forEach(g => logger.info(`  📡 ${g.topic}`));
    });
  });

  client.on('message', async (topic, buffer) => {
     console.log('📨 MQTT RAW:', topic);
    let payload;
    try { payload = JSON.parse(buffer.toString()); }
    catch { logger.warn(`Invalid JSON on ${topic}`); return; }

    const parts    = topic.split('/');
    const farmId   = parts[1];
    const category = parts[2];
    const deviceId = parts[3];
    const msgType  = parts[4];

    if (!farmId || !category || !deviceId || !msgType) return;

    try {
      if (category === 'nodes' && msgType === 'telemetry') {
        await handleTelemetry(farmId, deviceId, payload);

      } else if (category === 'nodes' && msgType === 'status') {
        const Node = require('../models/Node.model');
        await Node.findOneAndUpdate(
          { device_id: deviceId },
          {
            $set: {
              status:      payload.status ?? (payload.online ? 'online' : 'offline'),
              valve_state: payload.valve  ?? 'unknown',
              pump_state:  payload.pump   ?? 'unknown',
              last_seen:   new Date(),
              ...(payload.fw ? { firmware_version: payload.fw } : {}),
            },
          }
        );
        emitToFarm(farmId, 'node:status', { device_id: deviceId, ...payload });

      } else if (category === 'nodes' && msgType === 'alerts') {
        emitToFarm(farmId, 'alert:new', { device_id: deviceId, ...payload });

      } else if (category === 'gateways' && msgType === 'heartbeat') {
        await handleGatewayHeartbeat(farmId, deviceId, payload);
      }
    } catch (e) {
      logger.error(`MQTT handler [${topic}]: ${e.message}`);
    }
  });

  client.on('error',     e  => logger.error('MQTT error:', e.message));
  client.on('offline',   () => logger.warn('MQTT offline'));
  client.on('reconnect', () => logger.info('MQTT reconnecting…'));
};

async function handleGatewayHeartbeat(farmId, deviceId, payload) {
  const Gateway = require('../models/Gateway.model');

  logger.info(`🔍 [HB DEBUG] farmId="${farmId}" deviceId="${deviceId}"`);
  logger.info(`🔍 [HB DEBUG] raw payload: ${JSON.stringify(payload)}`);

  const rssi     = payload.wifi_rssi ?? payload.rssi   ?? null;
  const uptime_s = payload.uptime_s  ?? payload.uptime ?? null;
  const ip       = payload.ip ?? null;

  logger.info(`🔍 [HB DEBUG] extracted → ip=${ip} rssi=${rssi} uptime_s=${uptime_s}`);

  // Step 1: check gateway exists
  const existing = await Gateway.findOne({ device_id: deviceId });
  logger.info(`🔍 [HB DEBUG] findOne: ${existing
    ? JSON.stringify({ _id: existing._id, device_id: existing.device_id, status: existing.status })
    : 'NULL — NOT FOUND'
  }`);

  if (!existing) {
    logger.warn(`💥 Gateway "${deviceId}" not in DB — all gateways:`);
    const all = await Gateway.find({}, { device_id: 1, farm: 1, status: 1 });
    logger.warn(`💥 ${JSON.stringify(all)}`);
    return;
  }

  // Step 2: update
  const gw = await Gateway.findOneAndUpdate(
    { device_id: deviceId },
    {
      $set: {
        status:           'online',
        last_heartbeat:   new Date(),
        ip,
        ...(payload.fw ? { firmware_version: payload.fw } : {}),
      },
      $push: {
        heartbeat_log: {
          $each:  [{ receivedAt: new Date(), ip, rssi, uptime_s }],
          $slice: -100,
        },
      },
    },
    { new: true }
  );

  logger.info(`🔍 [HB DEBUG] after update → status="${gw.status}" last_heartbeat="${gw.last_heartbeat}" ip="${gw.ip}"`);

  // Step 3: emit
  logger.info(`🔍 [HB DEBUG] emitting gateway:status to room "farm:${farmId}"`);

  emitToFarm(farmId, 'gateway:status', {
    device_id:        deviceId,
    status:           'online',
    ip,
    rssi,
    uptime_s,
    fw:               payload.fw   ?? null,
    pkts_ok:          payload.pkts_ok ?? null,
    ts:               new Date(),
  });

  logger.info(`🔍 [HB DEBUG] emit done`);
  logger.info(`💓 GW [${deviceId}] ip=${ip} uptime=${uptime_s}s rssi=${rssi}`);
}

const publish = (topic, payload, opts = { qos: 1 }) => {
  if (!client?.connected) { logger.warn(`MQTT not connected — dropped: ${topic}`); return false; }
  client.publish(topic, JSON.stringify(payload), opts);
  return true;
};

const isConnected = () => !!client?.connected;
module.exports = { initMQTT, publish, isConnected };