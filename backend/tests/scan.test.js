/**
 * Supertests for the scan endpoints. Uses a mock scan runner so tests
 * do not require a local Chrome/Puppeteer install.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

require('./helpers/testEnv');
const { buildApp } = require('../app');
const mockScanResults = require('../data/mockScanResults');

const mockScanRunner = {
  run: async () => mockScanResults,
  getResults: async () => mockScanResults,
};

function createTestApp(overrides = {}) {
  return buildApp({
    scanRunner: mockScanRunner,
    ...overrides,
  });
}

test('POST /api/scan returns the bucketed mock payload', async () => {
  const app = createTestApp();
  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'https://example.com' });
  assert.equal(res.status, 200);
  assert.ok(res.body.problems);
  assert.ok(Array.isArray(res.body.problems.visualAccessibility));
  assert.ok(Array.isArray(res.body.problems.structureAndSemantics));
  assert.ok(Array.isArray(res.body.problems.multimedia));
  assert.ok(Array.isArray(res.body.whatsGood));
});

test('POST /api/scan rejects a non-http URL', async () => {
  const app = createTestApp();
  const res = await request(app)
    .post('/api/scan')
    .send({ url: 'file:///etc/passwd' });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test('GET /api/scan-results requires ?url=', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/scan-results');
  assert.equal(res.status, 400);
});

test('GET /api/scan-results returns the mock payload', async () => {
  const app = createTestApp();
  const res = await request(app)
    .get('/api/scan-results')
    .query({ url: 'https://example.com' });
  assert.equal(res.status, 200);
  assert.ok(res.body.problems);
});

test('GET /api/problems/:id returns the matching problem', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/problems/contrast-1');
  assert.equal(res.status, 200);
  assert.equal(res.body.id, 'contrast-1');
});

test('GET /api/problems/:id returns 404 for an unknown id', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/problems/does-not-exist');
  assert.equal(res.status, 404);
});

test('POST /api/scan still succeeds when storage save fails', async () => {
  const StorageService = require('../services/storageService');
  const storageService = new StorageService();
  storageService.saveScanResults = async () => {
    throw new Error('storage unavailable');
  };

  const app = createTestApp({ storageService });
  const agent = request.agent(app);

  const loginRes = await agent
    .get('/api/auth/status')
    .expect(200);

  assert.equal(loginRes.body.authenticated, false);

  const res = await agent
    .post('/api/scan')
    .send({ url: 'https://example.com' });

  assert.equal(res.status, 200);
  assert.ok(res.body.problems);
});

test('postScan returns account snapshot when storage save succeeds', async () => {
  const ScanController = require('../controllers/scanController');
  const savedScans = [{
    id: 'scan-1',
    url: 'https://example.com',
    host: 'example.com',
    scannedAt: '2026-07-10T12:00:00Z',
    score: 90,
    issues: 1,
    topSeverity: 'minor',
  }];

  const storageService = {
    saveScanResults: async () => ({
      scans: savedScans,
      scanCount: 1,
    }),
  };
  const authService = {
    clientsFor: async () => ({ githubClient: {} }),
    persistUser: async () => {},
  };

  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService,
    storageService,
  });

  const req = {
    body: { url: 'https://example.com' },
    isAuthenticated: () => true,
    user: {
      storage: { full_name: 'sam/equalview-scans', id: 'R_kg' },
      account: { scanCount: 0 },
    },
  };

  let body;
  const res = {
    json: (payload) => {
      body = payload;
    },
    status() {
      return this;
    },
  };

  await ctrl.postScan(req, res);

  assert.ok(body.problems);
  assert.deepEqual(body.account, {
    scanCount: 1,
    scans: savedScans,
  });
  assert.equal(req.user.account.scanCount, 1);
  // The list goes out over the wire but must never be persisted on the
  // session — it grows without bound and the session must fit in a cookie.
  assert.equal(req.user.account.scans, undefined);
});

test('getSavedScans lists the scans held in the user store', async () => {
  const ScanController = require('../controllers/scanController');
  const scans = [
    { id: 'scan-2', url: 'https://example.com/b', scannedAt: '2026-07-11T12:00:00Z' },
    { id: 'scan-1', url: 'https://example.com/a', scannedAt: '2026-07-10T12:00:00Z' },
  ];

  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: { clientsFor: async () => ({ githubClient: {} }) },
    storageService: {
      loadAccount: async () => ({ scanCount: 2, index: { scans } }),
    },
  });

  let body;
  const res = {
    json: (payload) => {
      body = payload;
    },
    status() {
      return this;
    },
  };

  await ctrl.getSavedScans(
    {
      isAuthenticated: () => true,
      user: { storage: { provider: 'github', full_name: 'sam/repo', id: 'R_kg' } },
    },
    res,
  );

  assert.equal(body.scanCount, 2);
  assert.deepEqual(body.scans, scans);
});

test('getSavedScans requires auth and attached storage', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: {},
    storageService: {},
  });

  let status;
  const res = {
    json: () => {},
    status(code) {
      status = code;
      return this;
    },
  };

  await ctrl.getSavedScans({ isAuthenticated: () => true, user: {} }, res);
  assert.equal(status, 401);
});

test('getSavedScan returns the stored report for an authenticated user', async () => {
  const ScanController = require('../controllers/scanController');
  const stored = {
    id: 'scan-1',
    url: 'https://example.com',
    scannedAt: '2026-07-10T12:00:00Z',
    result: mockScanResults,
  };

  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: {
      clientsFor: async () => ({ githubClient: {} }),
    },
    storageService: {
      getScanById: async () => stored,
    },
  });

  let statusCode = 200;
  let body;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
    },
  };

  await ctrl.getSavedScan(
    {
      params: { id: 'scan-1' },
      isAuthenticated: () => true,
      user: { storage: { id: 'R_kg', full_name: 'sam/equalview-scans' } },
    },
    res,
  );

  assert.equal(statusCode, 200);
  assert.deepEqual(body, stored);
});

test('getSavedScan requires auth and attached storage', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: {},
    storageService: {},
  });

  let statusCode = 200;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json() {},
  };

  await ctrl.getSavedScan(
    {
      params: { id: 'scan-1' },
      isAuthenticated: () => false,
      user: null,
    },
    res,
  );

  assert.equal(statusCode, 401);
});

function mockRes() {
  let statusCode = 200;
  let body;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      body = payload;
    },
  };
  return {
    res,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

test('postScan returns 500 when the runner throws', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: {
      run: async () => {
        throw new Error('browser crashed');
      },
    },
  });
  const out = mockRes();
  await ctrl.postScan({ body: { url: 'https://example.com' } }, out.res);
  assert.equal(out.statusCode, 500);
  assert.equal(out.body.error, 'Internal server error');
});

test('getScanResults returns 404 when runner yields null', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: {
      getResults: async () => null,
    },
  });
  const out = mockRes();
  await ctrl.getScanResults({ query: { url: 'https://example.com' } }, out.res);
  assert.equal(out.statusCode, 404);
  assert.match(out.body.error, /No scan results/);
});

test('getSavedScan returns 404 for SCAN_NOT_FOUND', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: { clientsFor: async () => ({}) },
    storageService: {
      getScanById: async () => {
        const err = new Error('missing');
        err.code = 'SCAN_NOT_FOUND';
        throw err;
      },
    },
  });
  const out = mockRes();
  await ctrl.getSavedScan(
    {
      params: { id: 'missing' },
      isAuthenticated: () => true,
      user: { storage: { id: 'R_kg' } },
    },
    out.res,
  );
  assert.equal(out.statusCode, 404);
});

test('getSavedScan returns 403 for STORAGE_ACCESS_DENIED', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: { clientsFor: async () => ({}) },
    storageService: {
      getScanById: async () => {
        const err = new Error('denied');
        err.code = 'STORAGE_ACCESS_DENIED';
        throw err;
      },
    },
  });
  const out = mockRes();
  await ctrl.getSavedScan(
    {
      params: { id: 'scan-1' },
      isAuthenticated: () => true,
      user: { storage: { id: 'R_kg' } },
    },
    out.res,
  );
  assert.equal(out.statusCode, 403);
});

test('getSavedScan returns 503 when storage services are missing', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
  });
  const out = mockRes();
  await ctrl.getSavedScan(
    {
      params: { id: 'scan-1' },
      isAuthenticated: () => true,
      user: { storage: { id: 'R_kg' } },
    },
    out.res,
  );
  assert.equal(out.statusCode, 503);
});

test('deleteSavedScan removes a scan and updates session scanCount only', async () => {
  const ScanController = require('../controllers/scanController');
  const remaining = [
    {
      id: 'scan-2',
      url: 'https://example.com/b',
      scannedAt: '2026-07-11T12:00:00Z',
    },
  ];
  let persisted = false;
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: {
      clientsFor: async () => ({ githubClient: {} }),
      persistUser: async () => {
        persisted = true;
      },
    },
    storageService: {
      deleteScanById: async () => ({
        deletedId: 'scan-1',
        path: 'scans/scan-1_example.com.json',
        scanCount: 1,
        scans: remaining,
      }),
    },
  });

  const req = {
    params: { id: 'scan-1' },
    isAuthenticated: () => true,
    user: {
      storage: { id: 'R_kg', full_name: 'sam/repo' },
      account: { scanCount: 2 },
    },
  };
  const out = mockRes();
  await ctrl.deleteSavedScan(req, out.res);

  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body, { scanCount: 1, scans: remaining });
  assert.equal(req.user.account.scanCount, 1);
  assert.equal(req.user.account.scans, undefined);
  assert.equal(persisted, true);
});

test('deleteSavedScan requires auth and attached storage', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: {},
    storageService: {},
  });
  const out = mockRes();
  await ctrl.deleteSavedScan(
    {
      params: { id: 'scan-1' },
      isAuthenticated: () => false,
      user: null,
    },
    out.res,
  );
  assert.equal(out.statusCode, 401);
});

test('deleteSavedScan returns 404 for SCAN_NOT_FOUND', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: { clientsFor: async () => ({}) },
    storageService: {
      deleteScanById: async () => {
        const err = new Error('missing');
        err.code = 'SCAN_NOT_FOUND';
        throw err;
      },
    },
  });
  const out = mockRes();
  await ctrl.deleteSavedScan(
    {
      params: { id: 'missing' },
      isAuthenticated: () => true,
      user: { storage: { id: 'R_kg' } },
    },
    out.res,
  );
  assert.equal(out.statusCode, 404);
});

test('deleteAllSavedScans clears every scan and updates session scanCount', async () => {
  const ScanController = require('../controllers/scanController');
  let persisted = false;
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: {
      clientsFor: async () => ({ githubClient: {} }),
      persistUser: async () => {
        persisted = true;
      },
    },
    storageService: {
      deleteAllScans: async () => ({
        deletedCount: 2,
        scanCount: 0,
        scans: [],
      }),
    },
  });

  const req = {
    isAuthenticated: () => true,
    user: {
      storage: { id: 'R_kg', full_name: 'sam/repo' },
      account: { scanCount: 2 },
    },
  };
  const out = mockRes();
  await ctrl.deleteAllSavedScans(req, out.res);

  assert.equal(out.statusCode, 200);
  assert.deepEqual(out.body, { deletedCount: 2, scanCount: 0, scans: [] });
  assert.equal(req.user.account.scanCount, 0);
  assert.equal(persisted, true);
});

test('deleteAllSavedScans requires auth and attached storage', async () => {
  const ScanController = require('../controllers/scanController');
  const ctrl = new ScanController({
    mockScanResults,
    scanRunner: mockScanRunner,
    authService: {},
    storageService: {},
  });
  const out = mockRes();
  await ctrl.deleteAllSavedScans(
    {
      isAuthenticated: () => false,
      user: null,
    },
    out.res,
  );
  assert.equal(out.statusCode, 401);
});
