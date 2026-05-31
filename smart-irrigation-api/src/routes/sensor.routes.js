const router  = require('express').Router();
const ctrl    = require('../controllers/sensor.controller');
const { protect, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);
router.get('/nodes/:nodeId/data',       ctrl.getData);
router.get('/nodes/:nodeId/latest',     ctrl.getLatest);
router.get('/nodes/:nodeId/history',    ctrl.getHistory);
router.get('/farms/:farmId/live',       farmAccess(), ctrl.getLiveFeed);
router.get('/farms/:farmId/history',    farmAccess(), ctrl.getFarmHistory);
router.get('/farms/:farmId/export',     farmAccess(), ctrl.exportData);

module.exports = router;
