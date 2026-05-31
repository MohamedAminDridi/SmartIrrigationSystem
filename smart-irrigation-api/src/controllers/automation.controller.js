const AutomationRule = require('../models/AutomationRule.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

exports.listRules = asyncHandler(async (req, res) => {
  const farms = req.user.role === 'admin' ? {} : { farm: { $in: req.query.farms?.split(',') || [] } };
  const rules = await AutomationRule.find(farms).populate('action.node', 'name device_id');
  success(res, { rules });
});

exports.createRule = asyncHandler(async (req, res) => {
  const rule = await AutomationRule.create({ ...req.body, farm: req.body.farm });
  created(res, { rule }, 'Automation rule created');
});

exports.getRule = asyncHandler(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.ruleId).populate('action.node', 'name');
  if (!rule) return res.status(404).json({ success: false, message: 'Rule not found' });
  success(res, { rule });
});

exports.updateRule = asyncHandler(async (req, res) => {
  const rule = await AutomationRule.findByIdAndUpdate(req.params.ruleId, req.body, { new: true });
  success(res, { rule });
});

exports.deleteRule = asyncHandler(async (req, res) => {
  await AutomationRule.findByIdAndDelete(req.params.ruleId);
  res.status(204).send();
});

exports.dryRun = asyncHandler(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.ruleId);
  if (!rule) return res.status(404).json({ success: false, message: 'Rule not found' });
  success(res, {
    would_trigger: true,
    action: rule.action,
    reason: 'Dry-run: no command issued',
    evaluated_at: new Date(),
  }, 'Dry-run complete');
});

exports.getTriggerLog = asyncHandler(async (req, res) => {
  const rule = await AutomationRule.findById(req.params.ruleId);
  if (!rule) return res.status(404).json({ success: false, message: 'Rule not found' });
  success(res, { log: rule.trigger_log.slice(-50).reverse() });
});
