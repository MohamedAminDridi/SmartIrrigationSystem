const router  = require('express').Router({ mergeParams: true });
const ctrl    = require('../controllers/alert.controller');
const { protect, farmAccess } = require('../middleware/auth.middleware');

router.use(protect);

// Mounted at /api/farms/:farmId/alert-rules
router.get ('/',          farmAccess(), ctrl.listRules);
router.post('/',          farmAccess(), ctrl.createRule);
router.put ('/:ruleId',   ctrl.updateRule);
router.delete('/:ruleId', ctrl.deleteRule);

module.exports = router;