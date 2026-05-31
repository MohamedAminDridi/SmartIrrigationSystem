const router  = require('express').Router();
const ctrl    = require('../controllers/automation.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);
router.route('/')                      .get(ctrl.listRules).post(ctrl.createRule);
router.route('/:ruleId')              .get(ctrl.getRule).put(ctrl.updateRule).delete(ctrl.deleteRule);
router.post ('/:ruleId/dry-run',      ctrl.dryRun);
router.get  ('/:ruleId/log',          ctrl.getTriggerLog);

module.exports = router;