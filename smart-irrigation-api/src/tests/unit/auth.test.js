const { signAccess, verifyAccess } = require('../../utils/jwtHelper');
process.env.JWT_SECRET = 'test-secret-that-is-long-enough-for-unit-tests-only';

test('signAccess returns a 3-part JWT string', () => {
  const token = signAccess('abc123');
  expect(typeof token).toBe('string');
  expect(token.split('.')).toHaveLength(3);
});

test('verifyAccess decodes the correct id', () => {
  const token   = signAccess('user999');
  const decoded = verifyAccess(token);
  expect(decoded.id).toBe('user999');
});
