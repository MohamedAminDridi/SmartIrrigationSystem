const router  = require('express').Router();
const ctrl    = require('../controllers/irrigation.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);
router.post('/nodes/:nodeId/valve/open',        ctrl.openValve);
router.post('/nodes/:nodeId/valve/close',       ctrl.closeValve);
router.post('/nodes/:nodeId/valve/toggle',      ctrl.toggleValve);
router.post('/nodes/:nodeId/pump/start',        ctrl.startPump);
router.post('/nodes/:nodeId/pump/stop',         ctrl.stopPump);
router.get ('/nodes/:nodeId/commands',          ctrl.getCommands);
router.get ('/nodes/:nodeId/commands/:cmdId',   ctrl.getCommandStatus);

module.exports = router;
