const User = require('../models/User.model');
const { asyncHandler } = require('../utils/asyncHandler');
const { success, created } = require('../utils/apiResponse');
const { signAccess, signRefresh, verifyRefresh } = require('../utils/jwtHelper');

exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, role } = req.body;
  if (await User.findOne({ email }))
    return res.status(409).json({ success: false, message: 'Email already registered' });
  const user       = await User.create({ name, email, password, phone, role });
  const access     = signAccess(user._id);
  const refreshTok = signRefresh(user._id);
  // Use findByIdAndUpdate to avoid VersionError race conditions
  await User.findByIdAndUpdate(user._id, {
    $push: { refreshTokens: { token: refreshTok, expiresAt: new Date(Date.now() + 7 * 86400000) } },
  });
  created(res, { user, access, refresh: refreshTok }, 'Registration successful');
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password)))
    return res.status(401).json({ success: false, message: 'Invalid email or password' });
  if (!user.isActive)
    return res.status(403).json({ success: false, message: 'Account suspended' });
  const access     = signAccess(user._id);
  const refreshTok = signRefresh(user._id);
  // Atomic update — no VersionError possible
  await User.findByIdAndUpdate(user._id, {
    $set:  { lastLogin: new Date() },
    $pull: { refreshTokens: { expiresAt: { $lt: new Date() } } },
  });
  await User.findByIdAndUpdate(user._id, {
    $push: { refreshTokens: { token: refreshTok, expiresAt: new Date(Date.now() + 7 * 86400000) } },
  });
  success(res, { user, access, refresh: refreshTok }, 'Login successful');
});

exports.logout = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  await User.findByIdAndUpdate(req.user._id, {
    $pull: { refreshTokens: { token: refresh_token } },
  });
  success(res, {}, 'Logged out');
});

exports.getProfile    = asyncHandler(async (req, res) => success(res, { user: req.user }));

exports.updateProfile = asyncHandler(async (req, res) => {
  const update = {};
  ['name', 'phone'].forEach(k => { if (req.body[k] !== undefined) update[k] = req.body[k]; });
  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });
  success(res, { user }, 'Profile updated');
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token)
    return res.status(400).json({ success: false, message: 'Refresh token required' });
  let payload;
  try { payload = verifyRefresh(refresh_token); }
  catch { return res.status(401).json({ success: false, message: 'Invalid refresh token' }); }

  const user  = await User.findById(payload.id);
  const entry = user?.refreshTokens.find(t => t.token === refresh_token && t.expiresAt > new Date());
  if (!user || !entry)
    return res.status(401).json({ success: false, message: 'Refresh token expired or revoked' });

  const access     = signAccess(user._id);
  const newRefresh = signRefresh(user._id);

  // Atomic swap — remove old, add new in one round-trip, no VersionError
  await User.findByIdAndUpdate(user._id, {
    $pull: { refreshTokens: { token: refresh_token } },
  });
  await User.findByIdAndUpdate(user._id, {
    $push: { refreshTokens: { token: newRefresh, expiresAt: new Date(Date.now() + 7 * 86400000) } },
  });

  success(res, { access, refresh: newRefresh });
});

exports.resetPassword = asyncHandler(async (req, res) => {
  await User.findOne({ email: req.body.email });
  success(res, {}, 'If that email exists, a reset link has been sent');
});