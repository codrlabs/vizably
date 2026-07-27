/**
 * Auth route tests — status, stubs, protected endpoints, logout.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { TEST_ENCRYPTION_KEY, TEST_SESSION_SECRET } = require('./helpers/testEnv');
const buildApp = require('../app');
const AuthService = require('../services/authService');
const StorageService = require('../services/storageService');

function createTestApp(overrides = {}) {
  const authService =
    overrides.authService ||
    new AuthService({
      sessionSecret: TEST_SESSION_SECRET,
      encryptionKey: TEST_ENCRYPTION_KEY,
      githubClientId: 'test-client-id',
      githubClientSecret: 'test-client-secret',
      githubCallbackUrl: 'http://localhost:3000/api/auth/github/callback',
    });

  return buildApp({
    authService,
    storageService: overrides.storageService || new StorageService(),
    scanRunner: overrides.scanRunner,
    ...overrides,
  });
}

test('GET /api/auth/status returns unauthenticated by default', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/auth/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.authenticated, false);
  assert.equal(res.body.user, null);
});

test('GET /api/auth/google returns 503 when Google OAuth is not configured', async () => {
  // Explicitly clear Google creds so a developer .env cannot register the strategy.
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    githubClientId: 'test-client-id',
    githubClientSecret: 'test-client-secret',
    githubCallbackUrl: 'http://localhost:3000/api/auth/github/callback',
    googleClientId: '',
    googleClientSecret: '',
    googleCallbackUrl: '',
  });
  const app = createTestApp({ authService });
  const res = await request(app).get('/api/auth/google');
  assert.equal(res.status, 503);
  assert.match(res.body.error, /not configured/i);
});

test('GET /api/auth/google initiates OAuth redirect when configured', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    githubClientId: 'test-client-id',
    githubClientSecret: 'test-client-secret',
    githubCallbackUrl: 'http://localhost:3000/api/auth/github/callback',
    googleClientId: 'google-client-id.apps.googleusercontent.com',
    googleClientSecret: 'google-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
  });
  const app = createTestApp({ authService });
  const res = await request(app).get('/api/auth/google');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /accounts\.google\.com/);
  assert.match(res.headers.location, /drive\.file/);
});

test('GET /api/auth/config returns Google Picker settings', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    googleClientId: 'google-client-id.apps.googleusercontent.com',
    googleClientSecret: 'google-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
    googlePickerApiKey: 'picker-key-test',
    googleCloudProjectNumber: '1234567890',
  });
  const app = createTestApp({ authService });
  const res = await request(app).get('/api/auth/config');
  assert.equal(res.status, 200);
  assert.equal(res.body.googleClientId, 'google-client-id.apps.googleusercontent.com');
  assert.equal(res.body.googlePickerApiKey, 'picker-key-test');
  assert.equal(res.body.googleCloudProjectNumber, '1234567890');
});

test('GET /api/auth/google/token requires authentication', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/auth/google/token');
  assert.equal(res.status, 401);
});

test('GET /api/auth/storages requires authentication', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/auth/storages?provider=github');
  assert.equal(res.status, 401);
});

test('POST /api/auth/storage/validate requires authentication', async () => {
  const app = createTestApp();
  const res = await request(app)
    .post('/api/auth/storage/validate')
    .send({
      provider: 'github',
      storageRef: { id: 'R_x', full_name: 'sam/repo' },
    });
  assert.equal(res.status, 401);
});

test('POST /api/auth/storage requires authentication', async () => {
  const app = createTestApp();
  const res = await request(app)
    .post('/api/auth/storage')
    .send({
      provider: 'github',
      storageRef: { id: 'R_x', full_name: 'sam/repo' },
      action: 'load',
    });
  assert.equal(res.status, 401);
});

test('GET /api/auth/user requires authentication', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/auth/user');
  assert.equal(res.status, 401);
});

test('POST /api/auth/logout succeeds without an active session', async () => {
  const app = createTestApp();
  const res = await request(app).post('/api/auth/logout');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
});

test('GET /api/auth/github initiates OAuth redirect', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/auth/github');
  assert.equal(res.status, 302);
  assert.match(res.headers.location, /github\.com\/login\/oauth\/authorize/);
});

/**
 * Minimal authed app — stubs passport session so storage route handlers
 * can be exercised without a real OAuth round-trip.
 */
function createAuthedApp({ user, authService, storageService }) {
  const express = require('express');
  const makeAuthRouter = require('../routes/auth');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.isAuthenticated = () => Boolean(user);
    req.user = user;
    req.logout = (cb) => cb();
    req.session = { destroy: (cb) => cb() };
    next();
  });
  // Route registration calls authenticateGitHub() immediately for the callback.
  const wiredAuth = {
    authenticateGitHub: () => (_req, _res, next) => next(),
    ...authService,
  };
  app.use('/api/auth', makeAuthRouter({ authService: wiredAuth, storageService }));
  return app;
}

const AUTHED_USER = {
  id: 'u1',
  username: 'sam',
  displayName: 'Sam',
  provider: 'github',
  tokens: { github: { accessToken: 'encrypted-secret' } },
  storage: null,
};

test('GET /api/auth/user strips tokens from the response', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: {},
    storageService: {},
  });
  const res = await request(app).get('/api/auth/user');
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'sam');
  assert.equal(res.body.tokens, undefined);
});

test('GET /api/auth/storages returns mapped GitHub repos', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: {
      clientsFor: async () => ({ githubClient: { mock: true } }),
    },
    storageService: {
      listGitHubRepos: async () => [
        {
          id: 'R_kg',
          full_name: 'sam/vizably-scans',
          private: true,
          html_url: 'https://github.com/sam/vizably-scans',
        },
      ],
    },
  });
  const res = await request(app).get('/api/auth/storages?provider=github');
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'github');
  assert.equal(res.body.storages[0].name, 'vizably-scans');
  assert.equal(res.body.storages[0].id, 'R_kg');
});

test('POST /api/auth/storage/validate requires provider and storageRef', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: { clientsFor: async () => ({}) },
    storageService: {},
  });
  const res = await request(app).post('/api/auth/storage/validate').send({});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /provider and storageRef/);
});

test('POST /api/auth/storage/validate returns the fit-check result', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: { clientsFor: async () => ({ githubClient: {} }) },
    storageService: {
      validateStorage: async () => ({
        status: 'loadable',
        capabilities: { canRead: true, canWrite: true },
      }),
    },
  });
  const res = await request(app)
    .post('/api/auth/storage/validate')
    .send({
      provider: 'github',
      storageRef: { id: 'R_kg', full_name: 'sam/repo' },
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'loadable');
});

test('POST /api/auth/storage load attaches account to the session user', async () => {
  let persisted = false;
  const user = { ...AUTHED_USER };
  const app = createAuthedApp({
    user,
    authService: {
      clientsFor: async () => ({ githubClient: {} }),
      persistUser: async () => {
        persisted = true;
      },
    },
    storageService: {
      loadAccount: async () => ({
        provider: 'github',
        accountId: 'a1',
        storageRef: { id: 'R_kg', full_name: 'sam/repo' },
        settings: { autoDelete90d: true },
        scanCount: 2,
        index: {
          scans: [{ id: 's1', url: 'https://example.com' }],
        },
      }),
    },
  });
  const res = await request(app)
    .post('/api/auth/storage')
    .send({
      provider: 'github',
      storageRef: { id: 'R_kg', full_name: 'sam/repo' },
      action: 'load',
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.account.scanCount, 2);
  assert.equal(user.storage.full_name, 'sam/repo');
  assert.equal(persisted, true);
});
