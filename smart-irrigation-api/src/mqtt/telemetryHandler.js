const SensorReading  = require('../models/SensorReading.model');
const Node           = require('../models/Node.model');
const Alert          = require('../models/Alert.model');
const alertService   = require('../services/alert.service');
const { emitToFarm } = require('../socket/socketServer');
const logger         = require('../utils/logger');

/**
 * Handles: farms/{farmId}/nodes/{nodeId}/telemetry
 *
 * ESP32 payload: { id, soil, temp, hum, bat, seq }
 * Gateway adds:  { lora_rssi, lora_snr, gw, ts }
 */
module.exports = async function handleTelemetry(farmId, nodeDeviceId, payload) {
  try {
    const node = await Node.findOne({ device_id: nodeDeviceId });
    if (!node) {
      logger.warn(`⚠️  Unknown node "${nodeDeviceId}" — register it in the dashboard`);
      return;
    }

    // Map ESP32 short field names → meaningful names
    const soil = payload.soil ?? null;
    const temp = payload.temp ?? null;
    const hum  = payload.hum  ?? null;
    const bat  = payload.bat  ?? null;
    const rssi = payload.lora_rssi ?? payload.rssi ?? null;

    // Update node live state
    await Node.findByIdAndUpdate(node._id, {
      status:      'online',
      last_seen:   new Date(),
      battery_pct: bat,
    });

    // Save to time-series collection — match schema exactly:
    //   ts          = timeField  (required Date)
    //   meta        = metaField  (nodeId, farmId, deviceId)
    //   soil_moisture_pct, temperature_c, humidity_pct, battery_pct, rssi
    await SensorReading.create({
      ts: payload.ts ? new Date(payload.ts) : new Date(),
      meta: {
        nodeId:   node._id,
        farmId:   node.farm,
        deviceId: node.device_id,
      },
      soil_moisture_pct: soil,
      temperature_c:     temp,
      humidity_pct:      hum,
      battery_pct:       bat,
      rssi,
    });

    // Push real-time to dashboard
    emitToFarm(farmId, 'sensor:data', {
      nodeId:            node._id,
      deviceId:          node.device_id,
      name:              node.name,
      soil_moisture_pct: soil,
      temperature_c:     temp,
      humidity_pct:      hum,
      battery_pct:       bat,
      rssi,
      seq: payload.seq ?? null,
      ts:  new Date(),
    });

    logger.info(`📊 [${nodeDeviceId}] soil=${soil}% temp=${temp}°C hum=${hum}% bat=${bat}% rssi=${rssi}`);

    // ── Battery low alert (< 30%) — 30-minute cooldown ───────────────
    if (bat !== null && bat < 30) {
      const recentBatAlert = await Alert.findOne({
        node:         node._id,
        type:         'low_battery',
        acknowledged: false,
        createdAt:    { $gt: new Date(Date.now() - 30 * 60 * 1000) },
      });
      if (!recentBatAlert) {
        const alert = await Alert.create({
          farm:      node.farm,
          node:      node._id,
          type:      'low_battery',
          severity:  bat < 15 ? 'critical' : 'warning',
          message:   `Node "${nodeDeviceId}" battery low: ${bat}%`,
          metric:    'battery_pct',
          value:     bat,
          threshold: 30,
        });
        emitToFarm(farmId, 'alert:new', alert.toObject());
        logger.warn(`🔋 Low battery alert: ${nodeDeviceId} = ${bat}%`);
      }
    }

    // ── Evaluate user-defined AlertRules ─────────────────────────────
    await alertService.checkAlertRules(node._id, node.farm, {
      soil_moisture_pct: soil,
      temperature_c:     temp,
      humidity_pct:      hum,
      battery_pct:       bat,
    });

  } catch (err) {
    logger.error(`Telemetry handler error [${nodeDeviceId}]: ${err.message}`);
  }
};