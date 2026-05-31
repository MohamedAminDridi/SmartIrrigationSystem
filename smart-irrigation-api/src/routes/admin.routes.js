const router   = require('express').Router();
const User     = require('../models/User.model');
const { protect, authorize } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../utils/asyncHandler');
const { success } = require('../utils/apiResponse');

// All admin routes require login + admin role
router.use(protect, authorize('admin'));

/* GET /api/admin/users — list all users */
router.get('/users', asyncHandler(async (req, res) => {
  const { role, search, page = 1, limit = 50 } = req.query;
  const filter = {};
  if (role)   filter.role  = role;
  if (search) filter.$or   = [
    { name:  { $regex: search, $options: 'i' } },
    { email: { $regex: search, $options: 'i' } },
  ];
  const total = await User.countDocuments(filter);
  const users = await User.find(filter)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(+limit);
  success(res, { users, total, page: +page, limit: +limit });
}));

/* GET /api/admin/users/:id — single user */
router.get('/users/:id', asyncHandler(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  success(res, { user });
}));

/* PATCH /api/admin/users/:id — update role or suspend */
router.patch('/users/:id', asyncHandler(async (req, res) => {
  const allowed = ['role', 'isActive', 'name', 'phone'];
  const update  = {};
  allowed.forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const user = await User.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!user) return res.status(404).json({ success: false, message: 'User not found' });
  success(res, { user }, 'User updated');
}));

/* DELETE /api/admin/users/:id — delete user */
router.delete('/users/:id', asyncHandler(async (req, res) => {
  if (req.params.id === req.user._id.toString())
    return res.status(400).json({ success: false, message: 'Cannot delete your own account' });
  await User.findByIdAndDelete(req.params.id);
  res.status(204).send();
}));

module.exports = router;
