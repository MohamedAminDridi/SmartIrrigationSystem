const mongoose = require('mongoose');

/**
 * SensorReading — stored in a MongoDB time-series collection.
 * timeField : ts   (Date)
 * metaField : meta (node + farm identifiers)
 * All numeric sensor values are top-level measurement fields.
 */
const sensorReadingSchema = new mongoose.Schema({
  // timeField — required by time-series collection
  ts: { type: Date, required: true },

  // metaField — low-cardinality identifier object
  meta: {
    nodeId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Node', required: true },
    farmId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true },
    deviceId: { type: String },                // human-readable device_id for quick lookup
  },

  // measurement fields
  soil_moisture_pct:  { type: Number, default: null },
  temperature_c:      { type: Number, default: null },
  humidity_pct:       { type: Number, default: null },
  rainfall_mm:        { type: Number, default: null },
  light_lux:          { type: Number, default: null },
  battery_pct:        { type: Number, default: null },
  rssi:               { type: Number, default: null },
}, {
  // Tell Mongoose this document goes into the hand-created time-series collection
  timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
  collection: 'sensor_readings',
  timestamps: false,
  autoCreate: false,   // we create the collection manually in database.js
  autoIndex:  false,
});

module.exports = mongoose.model('SensorReading', sensorReadingSchema);
