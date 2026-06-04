const router  = require('express').Router();
const ctrl    = require('../controllers/schedule.controller');
const { protect, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);
router.get   ('/farms/:farmId/schedules', farmAccess(), ctrl.list);
router.post  ('/farms/:farmId/schedules', farmAccess(), ctrl.create);
router.patch ('/schedules/:id',           ctrl.update);
router.delete('/schedules/:id',           ctrl.remove);

module.exports = router;
