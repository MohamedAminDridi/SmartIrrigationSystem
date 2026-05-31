const Farm          = require('../models/Farm.model');
const User          = require('../models/User.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created, paginated } = require('../utils/apiResponse');

/* GET /api/farms */
exports.listFarms = asyncHandler(async (req, res) => {
  const farms = await Farm.find({
    $or: [{ owner: req.user._id }, { 'members.user': req.user._id }],
  }).populate('owner', 'name email');
  success(res, { farms });
});

/* POST /api/farms */
exports.createFarm = asyncHandler(async (req, res) => {
  const farm = await Farm.create({ ...req.body, owner: req.user._id });
  created(res, { farm }, 'Farm created');
});

/* GET /api/farms/:farmId */
exports.getFarm = asyncHandler(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId)
    .populate('owner', 'name email')
    .populate('members.user', 'name email role');
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  success(res, { farm });
});

/* PUT /api/farms/:farmId */
exports.updateFarm = asyncHandler(async (req, res) => {
  const farm = await Farm.findByIdAndUpdate(req.params.farmId, req.body, { new: true, runValidators: true });
  success(res, { farm });
});

/* DELETE /api/farms/:farmId */
exports.deleteFarm = asyncHandler(async (req, res) => {
  await Farm.findByIdAndDelete(req.params.farmId);
  res.status(204).send();
});

/* POST /api/farms/:farmId/members */
exports.inviteMember = asyncHandler(async (req, res) => {
  const { email, role = 'farmer' } = req.body;
  const user = await User.findOne({ email });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  const farm = await Farm.findById(req.params.farmId);
  if (farm.hasMember(user._id)) return res.status(409).json({ success: false, message: 'Already a member' });
  farm.members.push({ user: user._id, role });
  await farm.save();
  success(res, { farm }, 'Member added');
});

/* DELETE /api/farms/:farmId/members/:userId */
exports.removeMember = asyncHandler(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId);
  farm.members = farm.members.filter(m => !m.user.equals(req.params.userId));
  await farm.save();
  success(res, { farm }, 'Member removed');
});
