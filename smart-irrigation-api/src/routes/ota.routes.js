const router  = require('express').Router();
const ctrl    = require('../controllers/ota.controller');
const upload  = require('../config/multer');
const { protect, authorize } = require('../middleware/auth.middleware');

// Public download — ESP32 fetches binary without auth
router.get('/download/:firmwareId', ctrl.downloadFirmware);

router.use(protect);

// Mounted at /api/ota
router.get   ('/firmware',                ctrl.listFirmware);
router.post  ('/upload',                  authorize('admin','technician'), upload.single('file'), ctrl.uploadFirmware);
router.post  ('/deploy/:nodeId',          ctrl.deployToNode);
router.post  ('/deploy-gateway/:gatewayId', ctrl.deployToGateway);
router.post  ('/deploy-farm/:farmId',     authorize('admin'), ctrl.deployToFarm);
router.get   ('/status/:nodeId',          ctrl.getStatus);
router.post  ('/rollback/:nodeId',        ctrl.rollback);
router.delete('/firmware/:firmwareId',    authorize('admin'), ctrl.deleteFirmware);
router.patch ('/firmware/:firmwareId/stable', authorize('admin'), ctrl.markStable);

module.exports = router;