const axios = require('axios');
const BASE  = 'https://api.open-meteo.com/v1/forecast';

// ── Hourly forecast (kept for ET0 / dashboard) ───────────────────────────────
exports.getForecast = async (lat, lng, days = 1) => {
  const { data } = await axios.get(BASE, {
    params: {
      latitude: lat, longitude: lng, forecast_days: days,
      hourly: ['temperature_2m', 'relative_humidity_2m',
               'precipitation_probability', 'precipitation',
               'et0_fao_evapotranspiration'].join(','),
      timezone: 'auto',
    },
    timeout: 8000,
  });
  return data;
};

// ── WMO weather code → simple condition the 3D scene can switch onn ───────────
function codeToCondition(code) {
  if (code == null) return 'clear';
  if (code === 0) return 'clear';
  if (code <= 2)  return 'partly_cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code >= 61 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code >= 85 && code <= 86) return 'snow';
  if (code >= 95) return 'thunderstorm';
  return 'cloudy';
}
exports.codeToCondition = codeToCondition;

// ── Live current conditions (what the 3D weather system consumes) ────────────
const CURRENT = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
  'precipitation', 'rain', 'weather_code', 'cloud_cover',
  'wind_speed_10m', 'wind_direction_10m', 'is_day',
];

exports.getCurrent = async (lat, lng) => {
  const { data } = await axios.get(BASE, {
    params: {
      latitude: lat, longitude: lng,
      current: CURRENT.join(','),
      daily: ['sunrise', 'sunset'].join(','),
      timezone: 'auto',
    },
    timeout: 8000,
  });
  const c = data.current || {};
  const d = data.daily   || {};
  return {
    temperature:         c.temperature_2m,
    apparentTemperature: c.apparent_temperature,
    humidity:            c.relative_humidity_2m,
    precipitation:       c.precipitation,
    rain:                c.rain,
    cloudCover:          c.cloud_cover,
    windSpeed:           c.wind_speed_10m,
    windDirection:       c.wind_direction_10m,
    isDay:               c.is_day === 1,
    weatherCode:         c.weather_code,
    condition:           codeToCondition(c.weather_code),
    sunrise:             d.sunrise?.[0] || null,
    sunset:              d.sunset?.[0]  || null,
    timezone:            data.timezone,
    units:               { temp: '°C', wind: 'km/h', precip: 'mm' },
    observedAt:          c.time || new Date().toISOString(),
    fetchedAt:           Date.now(),
    lat, lng,
  };
};

// ── In-memory cache (farmId → live weather) ──────────────────────────────────
const cache = new Map();
exports.getCached = (farmId) => cache.get(String(farmId)) || null;
exports.setCached = (farmId, w) => cache.set(String(farmId), w);

// ── Periodic broadcaster: fetch every active farm's weather, cache, emit ─────
// Lazy-requires avoid a circular dependency with the socket server.
exports.refreshAllFarms = async () => {
  const Farm   = require('../models/Farm.model');
  const logger = require('../utils/logger');
  let emitToFarm = () => {};
  try { ({ emitToFarm } = require('../socket/socketServer')); } catch { /* socket not ready */ }

  const farms = await Farm.find({
    isActive: true,
    'location.lat': { $ne: null },
    'location.lng': { $ne: null },
  }).select('_id location');

  let ok = 0;
  for (const farm of farms) {
    try {
      const w = await exports.getCurrent(farm.location.lat, farm.location.lng);
      exports.setCached(farm._id, w);
      emitToFarm(farm._id.toString(), 'weather:update', w);
      ok++;
    } catch (e) {
      logger.warn?.(`Weather fetch failed for farm ${farm._id}: ${e.message}`);
    }
  }
  if (ok) logger.info?.(`Weather refreshed for ${ok}/${farms.length} farm(s)`);
  return ok;
};
