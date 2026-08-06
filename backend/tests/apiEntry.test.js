/**
 * Tests for the Vercel serverless entry at `api/index.js`.
 *
 * The entry is deployment glue, but it is the single point every request goes
 * through in production, so its path handling is worth pinning down.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

require('./helpers/testEnv');
const handler = require('../../api/index.js');

test('the entry exports a (req, res) handler, not a factory', () => {
  // Vercel invokes the export directly; exporting buildApp itself would mean
  // the platform calls the factory with (req, res) and nothing ever routes.
  assert.equal(typeof handler, 'function');
});

test('routes when the rewrite preserves the original path', async () => {
  const res = await request(handler).get('/api/problems/contrast-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'contrast-1');
});

test('routes when the rewrite flattens the path onto /api', async () => {
  // vercel.json carries the real path in __vzpath precisely so this works.
  const res = await request(handler).get('/api?__vzpath=problems/contrast-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'contrast-1');
});

test('routes when the path is preserved and the marker is also present', async () => {
  const res = await request(handler).get(
    '/api/problems/contrast-1?__vzpath=problems/contrast-1',
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'contrast-1');
});

test('keeps real query parameters when restoring a flattened path', async () => {
  const res = await request(handler).get(
    '/api?__vzpath=scan-results&url=https%3A%2F%2Fexample.com',
  );
  assert.equal(res.status, 200);
  assert.ok(res.body.problems, 'expected the scan-results payload');
});

test('the path marker never reaches handlers', async () => {
  const res = await request(handler).get('/api?__vzpath=auth/status');
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ['authenticated', 'user']);
});

test('health check is reachable outside the /api prefix', async () => {
  const res = await request(handler).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'okay');
});
