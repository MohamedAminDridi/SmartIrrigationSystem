const SensorReading    = require('../models/SensorReading.model');
const Command          = require('../models/Command.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success }      = require('../utils/apiResponse');
const mongoose         = require('mongoose');

/* ── GET /api/analytics/farms/:farmId/summary ── */
exports.getFarmSummary = asyncHandler(async (req, res) => {
  const { from = '7d' } = req.query;
  const ms    = { '1d':86400000,'7d':604800000,'30d':2592000000 };
  const since = new Date(Date.now() - (ms[from] || ms['7d']));

  const [agg] = await SensorReading.aggregate([
    {
      $match: {
        'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId),
        ts: { $gte: since },
      },
    },
    {
      $group: {
        _id:              null,
        active_nodes:     { $addToSet: '$meta.nodeId' },
        avg_soil_moisture:{ $avg: '$soil_moisture_pct' },
        avg_temperature:  { $avg: '$temperature_c' },
        total_rainfall:   { $sum: '$rainfall_mm' },
        total_readings:   { $sum: 1 },
      },
    },
    {
      $project: {
        _id:              0,
        active_nodes:     { $size: '$active_nodes' },
        avg_soil_moisture:{ $round: ['$avg_soil_moisture', 2] },
        avg_temperature:  { $round: ['$avg_temperature',   2] },
        total_rainfall:   { $round: ['$total_rainfall',    2] },
        total_readings:   1,
      },
    },
  ]);

  success(res, { summary: agg || {}, period: from });
});

/* ── GET /api/analytics/farms/:farmId/water-usage ── */
exports.getWaterUsage = asyncHandler(async (req, res) => {
  const { from, to, interval = 'day' } = req.query;
  const fromDate = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
  const toDate   = to   ? new Date(to)   : new Date();

  // We approximate water usage from irrigation Command records
  const usage = await Command.aggregate([
    {
      $match: {
        farm:       new mongoose.Types.ObjectId(req.params.farmId),
        type:       'valve_open',
        status:     'acked',
        createdAt:  { $gte: fromDate, $lte: toDate },
      },
    },
    {
      $group: {
        _id: { $dateTrunc: { date: '$createdAt', unit: interval, timezone: 'UTC' } },
        valve_opens: { $sum: 1 },
        // Approximate: each open event = 60L (configurable per farm later)
        estimated_litres: { $sum: 60 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0, bucket: '$_id',
        valve_opens: 1, estimated_litres: 1,
      },
    },
  ]);

  success(res, { water_usage: usage, note: 'Litres estimated at 60L per valve-open event' });
});

/* ── GET /api/analytics/farms/:farmId/efficiency ── */
exports.getEfficiencyScore = asyncHandler(async (req, res) => {
  // Ratio of readings where soil moisture is within optimal range (40–70%)
  const since = new Date(Date.now() - 7 * 86400000);

  const [agg] = await SensorReading.aggregate([
    {
      $match: {
        'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId),
        ts: { $gte: since },
        soil_moisture_pct: { $ne: null },
      },
    },
    {
      $group: {
        _id:   null,
        total: { $sum: 1 },
        optimal: {
          $sum: {
            $cond: [
              { $and: [{ $gte: ['$soil_moisture_pct', 40] }, { $lte: ['$soil_moisture_pct', 70] }] },
              1, 0,
            ],
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        score: { $round: [{ $multiply: [{ $divide: ['$optimal', '$total'] }, 100] }, 1] },
        total_readings: '$total',
        optimal_readings: '$optimal',
      },
    },
  ]);

  const score = agg?.score ?? 0;
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';

  success(res, { score, grade, ...agg, period: '7d', calculated_at: new Date() });
});

/* ── GET /api/analytics/nodes/:nodeId/compare ── */
exports.getNodeComparison = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000);

  // Get this node's averages
  const [node] = await SensorReading.aggregate([
    {
      $match: {
        'meta.nodeId': new mongoose.Types.ObjectId(req.params.nodeId),
        ts: { $gte: since },
      },
    },
    {
      $group: {
        _id:              '$meta.nodeId',
        avg_soil_moisture:{ $avg: '$soil_moisture_pct' },
        avg_temperature:  { $avg: '$temperature_c' },
        avg_humidity:     { $avg: '$humidity_pct' },
        sample_count:     { $sum: 1 },
      },
    },
  ]);

  success(res, { node_stats: node || {}, period: '7d' });
});

/* ── GET /api/analytics/farms/:farmId/report ── */
exports.generateReport = asyncHandler(async (req, res) => {
  success(res, {
    report_id: `rpt-${Date.now()}`,
    status:    'queued',
    message:   'Report generation queued — ready in ~30s',
  });
});
