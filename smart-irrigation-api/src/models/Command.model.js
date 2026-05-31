const mongoose = require('mongoose');

const commandSchema = new mongoose.Schema({
  node:     { type: mongoose.Schema.Types.ObjectId, ref: 'Node', required: true },
  farm:     { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
  type:     { type: String, enum: ['valve_open','valve_close','valve_toggle','pump_start','pump_stop'], required: true },
  payload:  { type: mongoose.Schema.Types.Mixed, default: {} },
  status:   { type: String, enum: ['pending','sent','acked','failed'], default: 'pending' },
  source:   { type: String, enum: ['manual','automation','schedule','ai'], default: 'manual' },
  issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  acked_at: { type: Date, default: null },
  error:    { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Command', commandSchema);
