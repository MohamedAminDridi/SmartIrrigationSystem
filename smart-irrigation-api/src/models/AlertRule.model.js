const mongoose = require('mongoose');

const alertRuleSchema = new mongoose.Schema({
  farm:         { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
  node:         { type: mongoose.Schema.Types.ObjectId, ref: 'Node', default: null }, // null = all nodes on farm
  name:         { type: String, required: true },
  metric:       { type: String, required: true },   // e.g. 'soil_moisture_pct'
  condition:    { type: String, enum: ['lt','gt','lte','gte','eq'], required: true },
  threshold:    { type: Number, required: true },
  severity:     { type: String, enum: ['info','warning','critical'], default: 'warning' },
  cooldown_min: { type: Number, default: 30 },
  enabled:      { type: Boolean, default: true },
  last_triggered: { type: Date, default: null },
  notify_channels: [{ type: String, enum: ['push','sms','email','whatsapp'] }],
}, { timestamps: true });

module.exports = mongoose.model('AlertRule', alertRuleSchema);
