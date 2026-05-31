const jwt  = require('jsonwebtoken');
const User = require('../models/User.model');

/* protect — verify access token */
exports.protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer '))
      return res.status(401).json({ success: false, message: 'No token provided' });

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id);
    if (!user || !user.isActive)
      return res.status(401).json({ success: false, message: 'User not found or inactive' });

    // Atomic update — avoids VersionError from concurrent saves
    await User.findByIdAndUpdate(user._id, { lastLogin: new Date() });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
};

/* authorize — role guard */
exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role))
    return res.status(403).json({ success: false, message: `Role '${req.user.role}' is not allowed here` });
  next();
};

/* farmAccess — checks user is owner or member of req.params.farmId */
exports.farmAccess = (minRole) => async (req, res, next) => {
  const Farm = require('../models/Farm.model');
  const farm = await Farm.findById(req.params.farmId);
  if (!farm) return res.status(404).json({ success: false, message: 'Farm not found' });
  if (req.user.role === 'admin') { req.farm = farm; return next(); }
  if (!farm.hasMember(req.user._id))
    return res.status(403).json({ success: false, message: 'Not a member of this farm' });
  req.farm = farm;
  next();
};