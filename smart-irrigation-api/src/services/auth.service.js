const User = require('../models/User.model');
const { signAccess, signRefresh } = require('../utils/jwtHelper');

exports.registerUser = async ({ name, email, password, phone, role }) => {
  const user      = await User.create({ name, email, password, phone, role });
  const access    = signAccess(user._id);
  const refresh   = signRefresh(user._id);
  user.refreshTokens.push({ token:refresh, expiresAt: new Date(Date.now()+7*86400000) });
  await user.save({ validateBeforeSave:false });
  return { user, access, refresh };
};

exports.loginUser = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+password');
  if (!user || !(await user.comparePassword(password)))
    throw Object.assign(new Error('Invalid credentials'), { statusCode:401 });
  if (!user.isActive)
    throw Object.assign(new Error('Account suspended'), { statusCode:403 });
  const access  = signAccess(user._id);
  const refresh = signRefresh(user._id);
  user.refreshTokens = user.refreshTokens.filter(t => t.expiresAt > new Date());
  user.refreshTokens.push({ token:refresh, expiresAt: new Date(Date.now()+7*86400000) });
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave:false });
  return { user, access, refresh };
};
