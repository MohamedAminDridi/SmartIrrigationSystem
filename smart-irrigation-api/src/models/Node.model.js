const mongoose = require('mongoose');

const nodeSchema = new mongoose.Schema({
  gateway:             { type: mongoose.Schema.Types.ObjectId, ref: 'Gateway', required: true },
  farm:                { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
  device_id:           { type: String, required: true, unique: true, trim: true },
  name:                { type: String, required: true, trim: true },
  location:            { lat: Number, lng: Number },
  // Saved 3D-twin layout + plot customization. x/z = ground position (metres);
  // size = plot side length; rot = degrees; color = custom tint (null=status); label = crop name.
  twin:                { x: Number, z: Number, size: Number, rot: Number, color: String, label: String },
  // Irrigation zone name (groups plots that share a schedule / can be toggled together).
  zone:                { type: String, default: null, trim: true },
  sensor_types:        [{ type: String }],
  report_interval_sec: { type: Number, default: 60, min: 30, max: 3600 },
  battery_pct:         { type: Number, default: null },
  firmware_version:    { type: String, default: '0.0.0' },
  status:              { type: String, enum: ['online','offline','unknown'], default: 'unknown' },
  last_seen:           { type: Date, default: null },
  valve_state:         { type: String, enum: ['open','closed','unknown'], default: 'unknown' },
  valve_pct:           { type: Number, default: 0, min: 0, max: 100 },  // servo position 0–100% (100% = 90°)
  pump_state:          { type: String, enum: ['on','off','unknown'], default: 'unknown' },
}, { timestamps: true });

module.exports = mongoose.model('Node', nodeSchema);
