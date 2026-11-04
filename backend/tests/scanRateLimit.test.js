/**
 * Rate limiting on the live-scan routes — per IP when anonymous, per user
 * when signed in.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');

require('./helpers/testEnv');
const { buildApp } = require('../app');
const mockScanResults = require('../data/mockScanResults');
const makeScanRateLimit = require('../middleware/scanRateLimit');

test('POST /api/scan returns 429 once an IP is over the limit, without scanning', async () => {
  let scans = 0;
  const app = buildApp({
    scanRunner: { run: async () => { scans += 1; return mockScanResults; } },
    scanRateLimit: makeScanRateLimit({ anonLimit: 2 }),
  });
  const scan = () => request(app).post('/api/scan').send({ url: 'https://example.com' });

  assert.equal((await scan()).status, 200);
  assert.equal((await scan()).status, 200);
  const blocked = await scan();

  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.match(blocked.body.error, /too many scans/i);
  assert.ok(blocked.headers['retry-after']);
  assert.equal(scans, 2);
});

test('GET /api/scan-results shares the same budget as POST /api/scan', async () => {
  let scans = 0;
  const run = async () => { scans += 1; return mockScanResults; };
  const app = buildApp({
    scanRunner: { run, getResults: run },
    scanRateLimit: makeScanRateLimit({ anonLimit: 2 }),
  });

  assert.equal((await request(app).post('/api/scan').send({ url: 'https://example.com' })).status, 200);
  assert.equal((await request(app).get('/api/scan-results').query({ url: 'https://example.com' })).status, 200);
  const blocked = await request(app).get('/api/scan-results').query({ url: 'https://example.com' });

  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.code, 'RATE_LIMITED');
  assert.equal(scans, 2);
});

test('signed-in users are limited per user, not by the shared IP', async () => {
  const app = express();
  // Stand-in for passport: the header plays the role of the session user.
  app.use((req, _res, next) => {
    const id = req.get('x-test-user');
    if (id) req.user = { id };
    next();
  });
  app.post('/scan', ...makeScanRateLimit({ anonLimit: 1, userLimit: 2 }), (_req, res) => {
    res.json({ ok: true });
  });
  const scan = (user) => {
    const req = request(app).post('/scan');
    return user ? req.set('x-test-user', user) : req;
  };

  assert.equal((await scan('alice')).status, 200);
  assert.equal((await scan('alice')).status, 200);
  assert.equal((await scan('alice')).status, 429);

  // Same IP, different account: its own budget.
  assert.equal((await scan('bob')).status, 200);

  // Signed-in traffic didn't use up the anonymous budget for this IP.
  assert.equal((await scan()).status, 200);
  const anonBlocked = await scan();
  assert.equal(anonBlocked.status, 429);
  assert.match(anonBlocked.body.error, /from this network/);
});
