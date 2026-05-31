const router  = require('express').Router();
const ctrl    = require('../controllers/notification.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/notifications
router.get   ('/',                ctrl.getNotifications);
router.get   ('/preferences',     ctrl.getPreferences);
router.put   ('/preferences',     ctrl.updatePreferences);
router.post  ('/devices',         ctrl.registerDevice);
router.delete('/devices/:token',  ctrl.unregisterDevice);
router.get   ('/:id',             ctrl.getNotification);

module.exports = router;