const Schedule = require('../models/Schedule.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');

exports.list = asyncHandler(async (req, res) => {
  const schedules = await Schedule.find({ farm: req.params.farmId })
    .populate('node', 'device_id name')
    .sort('startTime');
  success(res, { schedules });
});

exports.create = asyncHandler(async (req, res) => {
  const sch = await Schedule.create({
    ...req.body,
    farm: req.params.farmId,
    createdBy: req.user?._id,
  });
  created(res, { schedule: sch }, 'Schedule created');
});

exports.update = asyncHandler(async (req, res) => {
  const sch = await Schedule.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!sch) return res.status(404).json({ success: false, message: 'Schedule not found' });
  success(res, { schedule: sch }, 'Schedule updated');
});

exports.remove = asyncHandler(async (req, res) => {
  const sch = await Schedule.findByIdAndDelete(req.params.id);
  if (!sch) return res.status(404).json({ success: false, message: 'Schedule not found' });
  success(res, { id: req.params.id }, 'Schedule deleted');
});
