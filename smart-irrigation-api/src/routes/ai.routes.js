const router  = require('express').Router();
const ctrl    = require('../controllers/ai.controller');
const { protect, authorize } = require('../middleware/auth.middleware');

router.use(protect);
router.get('/farms/:farmId/soil-forecast', ctrl.getSoilForecast);
router.get('/farms/:farmId/schedule',      ctrl.getScheduleSuggestion);
router.get('/farms/:farmId/anomalies',     ctrl.getAnomalies);
router.get('/farms/:farmId/insights',      ctrl.getFarmInsights);
router.get('/model-status',                authorize('admin'), ctrl.getModelStatus);

module.exports = router;