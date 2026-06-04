const mongoose = require('mongoose');

// A recurring irrigation window. Targets either one node, a zone, or the whole
// farm. The cron evaluator opens the valve(s) at startTime on the selected days
// and closes them durationMin later.
const scheduleSchema = new mongoose.Schema({
  farm:         { type: mongoose.Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  name:         { type: String, default: 'Watering', trim: true },
  // target: a specific node, OR a zone name, OR neither (= whole farm)
  node:         { type: mongoose.Schema.Types.ObjectId, ref: 'Node', default: null },
  zone:         { type: String, default: null, trim: true },
  days:         { type: [Number], default: [] },          // 0=Sun … 6=Sat
  startTime:    { type: String, default: '06:00' },        // "HH:MM" (server local time)
  durationMin:  { type: Number, default: 15, min: 1, max: 1440 },
  valvePercent: { type: Number, default: 100, min: 1, max: 100 },
  enabled:      { type: Boolean, default: true },
  createdBy:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastRun:      { type: Date, default: null },
}, { timestamps: true });

module.exports = mongoose.model('Schedule', scheduleSchema);
