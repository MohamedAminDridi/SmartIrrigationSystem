const AlertRule      = require('../models/AlertRule.model');
const Alert          = require('../models/Alert.model');
const { emitToFarm } = require('../socket/socketServer');
const logger         = require('../utils/logger');

const OPS = { lt:(v,t)=>v<t, gt:(v,t)=>v>t, lte:(v,t)=>v<=t, gte:(v,t)=>v>=t, eq:(v,t)=>v===t };

exports.checkAlertRules = async (nodeId, farmId, metrics) => {
  const rules = await AlertRule.find({ farm:farmId, enabled:true,
    $or:[{ node:nodeId },{ node:null }] });

  for (const rule of rules) {
    const value = metrics[rule.metric];
    if (value === undefined || value === null) continue;
    if (!OPS[rule.condition]?.(value, rule.threshold)) continue;
    if (rule.last_triggered) {
      const elapsed = (Date.now() - rule.last_triggered.getTime()) / 60000;
      if (elapsed < rule.cooldown_min) continue;
    }

    const alert = await Alert.create({
      farm:      farmId,
      node:      nodeId,
      rule:      rule._id,
      severity:  rule.severity,
      message:   `${rule.name}: ${rule.metric} is ${value} (threshold ${rule.condition} ${rule.threshold})`,
      metric:    rule.metric,
      value,
      threshold: rule.threshold,
    });

    // Push to dashboard in real-time
    emitToFarm(farmId.toString(), 'alert:new', alert.toObject());

    rule.last_triggered = new Date();
    await rule.save();
    logger.warn(`🚨 Alert fired: ${rule.name} — ${rule.metric}=${value}`);
  }
};
