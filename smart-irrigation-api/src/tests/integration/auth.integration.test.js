const request  = require('supertest');
const mongoose = require('mongoose');
const app      = require('../../app');

process.env.JWT_SECRET  = 'test-secret-long-enough-for-integration';
process.env.NODE_ENV    = 'test';

afterAll(() => mongoose.disconnect());

test('POST /api/auth/login rejects bad credentials with 401', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email:'nobody@x.com', password:'wrongpass' });
  expect(res.statusCode).toBe(401);
  expect(res.body.success).toBe(false);
});
