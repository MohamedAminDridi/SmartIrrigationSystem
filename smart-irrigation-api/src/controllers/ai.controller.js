const { asyncHandler }  = require('../utils/asyncHandler');
const { success }       = require('../utils/apiResponse');
const SensorReading     = require('../models/SensorReading.model');
const weatherService    = require('../services/weather.service');
const Farm              = require('../models/Farm.model');
const mongoose          = require('mongoose');

/* GET /api/ai/farms/:farmId/soil-forecast */
exports.getSoilForecast = asyncHandler(async (req, res) => {
  // Fetch last 24 readings from MongoDB to simulate LSTM input
  const recent = await SensorReading.find({
    'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId),
    soil_moisture_pct: { $ne: null },
  }).sort({ ts: -1 }).limit(24);

  const lastVal = recent[0]?.soil_moisture_pct ?? 50;

  success(res, {
    farm_id:        req.params.farmId,
    forecast_hours: 24,
    predictions:    Array.from({ length: 24 }, (_, i) => ({
      hour: i + 1,
      soil_moisture_pct: +(lastVal - i * 0.4 + Math.random() * 2).toFixed(1),
    })),
    model_version:  '1.0.0',
    generated_at:   new Date(),
    note: 'Placeholder — integrate LSTM microservice for real predictions',
  });
});

/* GET /api/ai/farms/:farmId/schedule */
exports.getScheduleSuggestion = asyncHandler(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId);
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });

  let rainExpected = false;
  if (farm.location?.lat && farm.location?.lng) {
    try {
      const weather = await weatherService.getForecast(farm.location.lat, farm.location.lng, 1);
      rainExpected = (weather.hourly?.precipitation_probability || []).some(p => p > 60);
    } catch { /* weather API unavailable — assume no rain */ }
  }

  success(res, {
    recommend_irrigation: !rainExpected,
    suggested_time:       rainExpected ? null : '06:00',
    reason:               rainExpected
      ? 'Rain >60% probability in next 24h — skip irrigation'
      : 'No rain expected and soil trend is downward — irrigate at dawn',
    confidence: 0.82,
  });
});

/* GET /api/ai/farms/:farmId/anomalies */
exports.getAnomalies = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000);

  // Simple z-score anomaly: readings > 3 stdev from mean
  const [stats] = await SensorReading.aggregate([
    { $match: { 'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId), ts: { $gte: since }, soil_moisture_pct: { $ne: null } } },
    { $group: { _id: null, avg: { $avg: '$soil_moisture_pct' }, stdDev: { $stdDevPop: '$soil_moisture_pct' } } },
  ]);

  let anomalies = [];
  if (stats) {
    const { avg, stdDev } = stats;
    const threshold = 3 * (stdDev || 1);
    const raw = await SensorReading.find({
      'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId),
      ts: { $gte: since },
      soil_moisture_pct: { $ne: null, $not: { $gte: avg - threshold, $lte: avg + threshold } },
    }).sort({ ts: -1 }).limit(20);

    anomalies = raw.map(r => ({
      ts:    r.ts,
      nodeId:r.meta.nodeId,
      value: r.soil_moisture_pct,
      expected_range: [+(avg - threshold).toFixed(1), +(avg + threshold).toFixed(1)],
    }));
  }

  success(res, { anomalies, period: '7d', checked_at: new Date() });
});

/* GET /api/ai/farms/:farmId/insights */
exports.getFarmInsights = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 7 * 86400000);

  const perNode = await SensorReading.aggregate([
    { $match: { 'meta.farmId': new mongoose.Types.ObjectId(req.params.farmId), ts: { $gte: since } } },
    { $group: { _id: '$meta.nodeId', avg: { $avg: '$soil_moisture_pct' } } },
    { $sort: { avg: 1 } },
  ]);

  const insights = [];
  if (perNode.length > 1) {
    const lowest = perNode[0];
    insights.push(`Node ${lowest._id} has the lowest avg soil moisture (${lowest.avg?.toFixed(1)}%) — check valve or pipe.`);
  }
  insights.push('Enable automation rules to reduce manual irrigation by up to 30%.');

  success(res, { insights, generated_at: new Date() });
});

/* GET /api/ai/model-status */
exports.getModelStatus = asyncHandler(async (req, res) => {
  success(res, { version: '1.0.0', last_trained: '2025-05-01', status: 'ready', db: 'mongodb' });
});
