/**
 * Smoke test for the /health endpoint. Drives the composition root
 * via supertest so we never bind a real port in tests.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

require('./helpers/testEnv');
const { buildApp } = require('../app');

test('GET /health returns 200 with status payload', async () => {
  const app = buildApp();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    status: 'okay',
    message: 'Server is running!',
  });
});
