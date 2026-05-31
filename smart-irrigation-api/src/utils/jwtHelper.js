const jwt = require('jsonwebtoken');
const S = () => process.env.JWT_SECRET;
const A = () => process.env.JWT_ACCESS_EXPIRES  || '15m';
const R = () => process.env.JWT_REFRESH_EXPIRES || '7d';

exports.signAccess    = (id) => jwt.sign({ id }, S(), { expiresIn: A() });
exports.signRefresh   = (id) => jwt.sign({ id }, S(), { expiresIn: R() });
exports.verifyAccess  = (t)  => jwt.verify(t, S());
exports.verifyRefresh = (t)  => jwt.verify(t, S());
