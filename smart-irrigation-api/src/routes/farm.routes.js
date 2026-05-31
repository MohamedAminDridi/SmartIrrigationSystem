const router  = require('express').Router();
const ctrl    = require('../controllers/farm.controller');
const { protect, authorize, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);
router.route('/')                                .get(ctrl.listFarms).post(ctrl.createFarm);
router.route('/:farmId')                         .get(farmAccess(), ctrl.getFarm)
                                                 .put(farmAccess(), ctrl.updateFarm)
                                                 .delete(authorize('admin'), ctrl.deleteFarm);
router.post('/:farmId/members',                  farmAccess(), ctrl.inviteMember);
router.delete('/:farmId/members/:userId',        farmAccess(), ctrl.removeMember);

module.exports = router;
