const express   = require('express');
const helmet    = require('helmet');
const cors      = require('cors');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.use(helmet());
// Support comma-separated CORS_ORIGIN list e.g. "http://localhost:5173,https://app.netlify.app"
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(o => o.trim())
  : '*';
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined'));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000, max: 500,
  message: { success: false, message: 'Too many requests' },
}));

// Auth & Admin
app.use('/api/auth',         require('./routes/auth.routes'));
app.use('/api/admin',        require('./routes/admin.routes'));

// Farms (flat)
app.use('/api/farms',        require('./routes/farm.routes'));

// Nested under farms
app.use('/api/farms/:farmId/gateways',    require('./routes/gateway.routes'));
app.use('/api/farms/:farmId/nodes',       require('./routes/node.routes'));
app.use('/api/farms/:farmId/alert-rules', require('./routes/alert-rules.routes'));

// OTA — must be mounted BEFORE the broad "/api" routers below. They each begin
// with a global `router.use(protect)`, so mounting them first would intercept the
// public firmware download (/api/ota/download/:id) and 401 the ESP32 devices.
app.use('/api/ota',          require('./routes/ota.routes'));

// Sensor & irrigation (nested under nodes, mounted at /api)
app.use('/api',              require('./routes/sensor.routes'));
app.use('/api',              require('./routes/irrigation.routes'));
app.use('/api',              require('./routes/schedule.routes'));

// Top-level feature routes
app.use('/api/alerts',       require('./routes/alert.routes'));
app.use('/api/automation',   require('./routes/automation.routes'));
app.use('/api/analytics',    require('./routes/analytics.routes'));
app.use('/api/ai',           require('./routes/ai.routes'));
app.use('/api/weather',      require('./routes/weather.routes'));
app.use('/api/notifications',require('./routes/notification.routes'));

app.get('/health', (_, res) => res.json({ status: 'ok', db: 'mongodb', ts: new Date() }));

app.use(notFound);
app.use(errorHandler);
module.exports = app;