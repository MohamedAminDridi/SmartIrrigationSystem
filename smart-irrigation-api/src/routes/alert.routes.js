const router  = require('express').Router();
const ctrl    = require('../controllers/alert.controller');
const { protect, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/alerts
router.get ('/',                          ctrl.listAlerts);
router.get ('/:id',                       ctrl.getAlert);
router.put ('/:id/acknowledge',           ctrl.acknowledgeAlert);

module.exports = router;