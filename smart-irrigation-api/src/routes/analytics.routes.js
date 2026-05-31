const router  = require('express').Router();
const ctrl    = require('../controllers/analytics.controller');
const { protect, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);
router.get('/farms/:farmId/summary',  farmAccess(), ctrl.getFarmSummary);
router.get('/farms/:farmId/water-usage', farmAccess(), ctrl.getWaterUsage);
router.get('/farms/:farmId/efficiency',  farmAccess(), ctrl.getEfficiencyScore);
router.get('/nodes/:nodeId/compare',  ctrl.getNodeComparison);
router.get('/farms/:farmId/report',   farmAccess(), ctrl.generateReport);

module.exports = router;