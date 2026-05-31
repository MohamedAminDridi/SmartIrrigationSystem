const router  = require('express').Router({ mergeParams: true });
const ctrl    = require('../controllers/gateway.controller');
const { protect, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/farms/:farmId/gateways
router.route('/')          .get(farmAccess(), ctrl.listGateways).post(farmAccess(), ctrl.createGateway);
router.route('/:gwId')     .get(ctrl.getGateway).put(ctrl.updateGateway).delete(ctrl.deleteGateway);
router.get  ('/:gwId/heartbeats', ctrl.getHeartbeats);

module.exports = router;