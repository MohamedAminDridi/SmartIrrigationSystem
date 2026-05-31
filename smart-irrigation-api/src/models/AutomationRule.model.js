const mongoose = require('mongoose');

const automationRuleSchema = new mongoose.Schema({
  farm:    { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
  name:    { type: String, required: true },
  enabled: { type: Boolean, default: true },
  trigger: {
    type:      { type: String, enum: ['schedule','sensor','weather','manual'], required: true },
    cron:      { type: String },                   // e.g. "0 6 * * *"
    metric:    { type: String },
    condition: { type: String },
    threshold: { type: Number },
  },
  action: {
    type:   { type: String, enum: ['valve_open','valve_close','pump_start','pump_stop'], required: true },
    node:   { type: mongoose.Schema.Types.ObjectId, ref: 'Node' },
    duration_min: { type: Number, default: 0 },
  },
  last_triggered: { type: Date, default: null },
  trigger_log:    [{ ts: Date, result: String }],
}, { timestamps: true });

module.exports = mongoose.model('AutomationRule', automationRuleSchema);
