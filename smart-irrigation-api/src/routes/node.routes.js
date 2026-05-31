const router  = require('express').Router({ mergeParams: true });
const ctrl    = require('../controllers/node.controller');
const { protect, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/farms/:farmId/nodes
router.route('/')           .get(farmAccess(), ctrl.listNodes).post(farmAccess(), ctrl.createNode);
router.route('/:nodeId')    .get(ctrl.getNode).put(ctrl.updateNode).delete(ctrl.deleteNode);
router.get  ('/:nodeId/status', ctrl.getLiveStatus);

module.exports = router;