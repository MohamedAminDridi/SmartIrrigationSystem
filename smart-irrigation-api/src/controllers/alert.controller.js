const Alert       = require('../models/Alert.model');
const AlertRule   = require('../models/AlertRule.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created, paginated } = require('../utils/apiResponse');

exports.listAlerts = asyncHandler(async (req, res) => {
  const { farm, severity, acknowledged, page = 1, limit = 20 } = req.query;
  const filter = {};
  if (farm)         filter.farm = farm;
  if (severity)     filter.severity = severity;
  if (acknowledged !== undefined) filter.acknowledged = acknowledged === 'true';
  const total  = await Alert.countDocuments(filter);
  const alerts = await Alert.find(filter)
    .populate('node', 'name device_id')
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit).limit(parseInt(limit));
  paginated(res, alerts, +page, +limit, total);
});

exports.getAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findById(req.params.id)
    .populate('node', 'name device_id').populate('acknowledged_by', 'name');
  if (!alert) return res.status(404).json({ success: false, message: 'Alert not found' });
  success(res, { alert });
});

exports.acknowledgeAlert = asyncHandler(async (req, res) => {
  const alert = await Alert.findByIdAndUpdate(req.params.id, {
    acknowledged: true, acknowledged_by: req.user._id, acknowledged_at: new Date(),
  }, { new: true });
  success(res, { alert }, 'Alert acknowledged');
});

/* Alert rules */
exports.listRules = asyncHandler(async (req, res) => {
  const rules = await AlertRule.find({ farm: req.params.farmId }).populate('node','name');
  success(res, { rules });
});

exports.createRule = asyncHandler(async (req, res) => {
  const rule = await AlertRule.create({ ...req.body, farm: req.params.farmId });
  created(res, { rule }, 'Alert rule created');
});

exports.updateRule = asyncHandler(async (req, res) => {
  const rule = await AlertRule.findByIdAndUpdate(req.params.ruleId, req.body, { new: true });
  success(res, { rule });
});

exports.deleteRule = asyncHandler(async (req, res) => {
  await AlertRule.findByIdAndDelete(req.params.ruleId);
  res.status(204).send();
});
