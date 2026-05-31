const mongoose = require('mongoose');

const heartbeatSchema = new mongoose.Schema({
  receivedAt: { type: Date, default: Date.now },
  ip:         { type: String },
  rssi:       { type: Number },
  uptime_s:   { type: Number },
}, { _id: false });

const gatewaySchema = new mongoose.Schema({
  farm:             { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
  device_id:        { type: String, required: true, unique: true, trim: true },
  name:             { type: String, required: true, trim: true },
  twin:             { x: Number, z: Number },   // saved 3D-twin layout position (metres on the ground plane)
  ip:               { type: String, default: null },
  firmware_version: { type: String, default: '0.0.0' },
  status:           { type: String, enum: ['online','offline','unknown'], default: 'unknown' },
  last_heartbeat:   { type: Date, default: null },
  heartbeat_log:    { type: [heartbeatSchema], default: [] },
  tls_enabled:      { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Gateway', gatewaySchema);
