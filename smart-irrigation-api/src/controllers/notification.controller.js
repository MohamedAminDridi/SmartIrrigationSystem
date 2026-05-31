const Notification  = require('../models/Notification.model');
const User          = require('../models/User.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success }   = require('../utils/apiResponse');

exports.getNotifications = asyncHandler(async (req, res) => {
  const { page = 1, limit = 30 } = req.query;
  const notifications = await Notification.find({ user: req.user._id })
    .sort({ createdAt: -1 }).skip((page-1)*limit).limit(+limit);
  success(res, { notifications });
});

exports.getNotification = asyncHandler(async (req, res) => {
  const n = await Notification.findOne({ _id: req.params.id, user: req.user._id });
  if (!n) return res.status(404).json({ success: false, message: 'Not found' });
  success(res, { notification: n });
});

exports.getPreferences = asyncHandler(async (req, res) => {
  success(res, { preferences: req.user.notifications });
});

exports.updatePreferences = asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(
    req.user._id, { notifications: req.body }, { new: true }
  );
  success(res, { preferences: user.notifications }, 'Preferences updated');
});

exports.registerDevice = asyncHandler(async (req, res) => {
  const { token } = req.body;
  await User.findByIdAndUpdate(req.user._id, { $addToSet: { fcmTokens: token } });
  success(res, {}, 'Device registered');
});

exports.unregisterDevice = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $pull: { fcmTokens: req.params.token } });
  res.status(204).send();
});
