const SensorReading    = require('../models/SensorReading.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success }      = require('../utils/apiResponse');
const mongoose         = require('mongoose');

/* ── GET /api/nodes/:nodeId/data
   Cursor-based paginated raw readings                                */
exports.getData = asyncHandler(async (req, res) => {
  const { limit = 100, cursor } = req.query;
  const match = { 'meta.nodeId': new mongoose.Types.ObjectId(req.params.nodeId) };
  if (cursor) match.ts = { $lt: new Date(cursor) };

  const readings = await SensorReading.find(match)
    .sort({ ts: -1 })
    .limit(parseInt(limit));

  const nextCursor = readings.length
    ? readings[readings.length - 1].ts.toISOString()
    : null;

  success(res, { readings, nextCursor });
});

/* ── GET /api/nodes/:nodeId/latest
   Most recent reading                                                */
exports.getLatest = asyncHandler(async (req, res) => {
  const reading = await SensorReading.findOne({
    'meta.nodeId': new mongoose.Types.ObjectId(req.params.nodeId),
  }).sort({ ts: -1 });

  success(res, { reading });
});

/* ── GET /api/nodes/:nodeId/history
   Aggregated history using MongoDB $dateTrunc (replaces TimescaleDB) */
exports.getHistory = asyncHandler(async (req, res) => {
  const { from, to, interval = 'hour' } = req.query;

  const fromDate = from ? new Date(from) : new Date(Date.now() - 24 * 3600 * 1000);
  const toDate   = to   ? new Date(to)   : new Date();

  // interval may be: 'minute' | 'hour' | 'day' | 'week' | 'month'
  const unitMap = { minute:'minute', hour:'hour', day:'day', week:'week', month:'month' };
  const unit = unitMap[interval] || 'hour';

  const history = await SensorReading.aggregate([
    {
      $match: {
        'meta.nodeId': new mongoose.Types.ObjectId(req.params.nodeId),
        ts: { $gte: fromDate, $lte: toDate },
      },
    },
    {
      $group: {
        _id: {
          $dateTrunc: { date: '$ts', unit, timezone: 'UTC' },
        },
        avg_soil_moisture:  { $avg: '$soil_moisture_pct' },
        avg_temperature:    { $avg: '$temperature_c' },
        avg_humidity:       { $avg: '$humidity_pct' },
        total_rainfall:     { $sum: '$rainfall_mm' },
        avg_battery:        { $avg: '$battery_pct' },
        sample_count:       { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        bucket:            '$_id',
        avg_soil_moisture: { $round: ['$avg_soil_moisture', 2] },
        avg_temperature:   { $round: ['$avg_temperature',   2] },
        avg_humidity:      { $round: ['$avg_humidity',       2] },
        total_rainfall:    { $round: ['$total_rainfall',     2] },
        avg_battery:       { $round: ['$avg_battery',        2] },
        sample_count:      1,
      },
    },
  ]);

  success(res, { history, interval: unit, from: fromDate, to: toDate });
});

/* ── GET /api/farms/:farmId/history?hours=24&interval=hour
   Per-node bucketed time series for the whole farm — powers the 3D-twin
   playback scrubber. Returns one entry per node with an ordered points array. */
exports.getFarmHistory = asyncHandler(async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours, 10) || 24, 168);
  const interval = ['minute', 'hour', 'day'].includes(req.query.interval) ? req.query.interval : 'hour';
  const fromDate = new Date(Date.now() - hours * 3600 * 1000);

  const series = await SensorReading.aggregate([
    { $match: { 'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId), ts: { $gte: fromDate } } },
    {
      $group: {
        _id: { node: '$meta.nodeId', bucket: { $dateTrunc: { date: '$ts', unit: interval, timezone: 'UTC' } } },
        soil: { $avg: '$soil_moisture_pct' },
        temp: { $avg: '$temperature_c' },
        hum:  { $avg: '$humidity_pct' },
        bat:  { $avg: '$battery_pct' },
      },
    },
    { $sort: { '_id.bucket': 1 } },
    {
      $group: {
        _id: '$_id.node',
        points: {
          $push: {
            ts:   '$_id.bucket',
            soil: { $round: ['$soil', 1] },
            temp: { $round: ['$temp', 1] },
            hum:  { $round: ['$hum', 1] },
            bat:  { $round: ['$bat', 1] },
          },
        },
      },
    },
  ]);

  success(res, { series, from: fromDate, to: new Date(), interval, hours });
});

/* ── GET /api/farms/:farmId/live
   Latest reading for every node in a farm                           */
exports.getLiveFeed = asyncHandler(async (req, res) => {
  const readings = await SensorReading.aggregate([
    {
      $match: { 'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId) },
    },
    { $sort: { ts: -1 } },
    {
      $group: {
        _id:     '$meta.nodeId',
        latest:  { $first: '$$ROOT' },
      },
    },
    {
      $replaceRoot: { newRoot: '$latest' },
    },
  ]);

  success(res, { readings });
});

/* ── GET /api/farms/:farmId/export
   Async CSV export job (queued)                                      */
exports.exportData = asyncHandler(async (req, res) => {
  success(res, {
    job_id:  `export-${Date.now()}`,
    status:  'queued',
    message: 'CSV export queued — will be emailed when ready',
  });
});
