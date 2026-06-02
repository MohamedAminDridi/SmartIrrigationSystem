const router  = require('express').Router();
const ctrl    = require('../controllers/weather.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);
router.get ('/:farmId/current',   ctrl.getCurrent);
router.get ('/:farmId/live',      ctrl.getLive);
router.get ('/:farmId/forecast',  ctrl.getForecast);
router.get ('/:farmId/history',   ctrl.getHistory);
router.get ('/:farmId/et0',       ctrl.getET0);
router.post('/stations',          ctrl.registerStation);

module.exports = router;