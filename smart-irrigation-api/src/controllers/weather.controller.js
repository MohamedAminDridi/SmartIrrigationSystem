const weatherService   = require('../services/weather.service');
const Farm             = require('../models/Farm.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

async function getFarm(id) {
  const farm = await Farm.findById(id);
  if (!farm) throw Object.assign(new Error('Farm not found'), { statusCode: 404 });
  return farm;
}

exports.getCurrent = asyncHandler(async (req, res) => {
  const farm = await getFarm(req.params.farmId);
  const data = await weatherService.getForecast(farm.location.lat, farm.location.lng, 1);
  const i    = data.hourly;
  success(res, {
    temperature_c:  i.temperature_2m?.[0],
    humidity_pct:   i.relative_humidity_2m?.[0],
    precipitation_probability: i.precipitation_probability?.[0],
    fetched_at: new Date(),
  });
});

// Full live conditions for the 3D weather system. Serves the cached value if
// fresh (< 15 min), otherwise fetches Open-Meteo and caches it.
exports.getLive = asyncHandler(async (req, res) => {
  const farm = await getFarm(req.params.farmId);
  if (farm.location?.lat == null || farm.location?.lng == null) {
    return success(res, { weather: null, message: 'Farm has no coordinates' });
  }
  let w = weatherService.getCached(farm._id);
  if (!w || Date.now() - w.fetchedAt > 15 * 60 * 1000) {
    w = await weatherService.getCurrent(farm.location.lat, farm.location.lng);
    weatherService.setCached(farm._id, w);
  }
  success(res, { weather: w });
});

exports.getForecast = asyncHandler(async (req, res) => {
  const farm = await getFarm(req.params.farmId);
  const data = await weatherService.getForecast(farm.location.lat, farm.location.lng, 3);
  success(res, { forecast: data.hourly });
});

exports.getHistory = asyncHandler(async (req, res) => {
  success(res, { history: [], message: 'Historical weather stored per-farm after station registration' });
});

exports.getET0 = asyncHandler(async (req, res) => {
  const farm = await getFarm(req.params.farmId);
  const data = await weatherService.getForecast(farm.location.lat, farm.location.lng, 1);
  const et0  = data.hourly?.et0_fao_evapotranspiration?.reduce((a, b) => a + b, 0) || 0;
  success(res, { et0_mm_day: +et0.toFixed(2), date: new Date().toISOString().slice(0,10) });
});

exports.registerStation = asyncHandler(async (req, res) => {
  created(res, { station_id: `ws-${Date.now()}` }, 'Weather station registered');
});
