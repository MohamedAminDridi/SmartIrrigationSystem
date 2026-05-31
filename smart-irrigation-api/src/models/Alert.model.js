const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  farm:            { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
  node:            { type: mongoose.Schema.Types.ObjectId, ref: 'Node' },
  rule:            { type: mongoose.Schema.Types.ObjectId, ref: 'AlertRule' },
  type:            { type: String, default: 'threshold_breach' },
  severity:        { type: String, enum: ['info','warning','critical'], default: 'warning' },
  message:         { type: String, required: true },
  metric:          { type: String },
  value:           { type: Number },
  threshold:       { type: Number },
  acknowledged:    { type: Boolean, default: false },
  acknowledged_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  acknowledged_at: { type: Date, default: null },
}, { timestamps: true });

alertSchema.index({ farm: 1, createdAt: -1 });
alertSchema.index({ acknowledged: 1 });

module.exports = mongoose.model('Alert', alertSchema);
