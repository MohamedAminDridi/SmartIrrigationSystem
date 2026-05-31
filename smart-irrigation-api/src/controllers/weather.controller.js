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
