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

test('GET /api/auth/google returns 501 until Phase 3', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/auth/google');
  assert.equal(res.status, 501);
  assert.match(res.body.error, /Phase 3/);
});

test('GET /api/auth/google/callback returns 501 until Phase 3', async () => {
  const app = createTestApp();
  const res = await request(app).get('/api/auth/google/callback');
  assert.equal(res.status, 501);
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

test('GET /api/auth/storage/name-availability returns availability result', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: {
      clientsFor: async () => ({ githubUserClient: { mock: true } }),
    },
    storageService: {
      checkGitHubRepoNameAvailability: async (name) => ({
        name,
        normalizedName: name,
        full_name: `sam/${name}`,
        status: 'available',
        message: `sam/${name} is available.`,
      }),
    },
  });
  const res = await request(app).get(
    '/api/auth/storage/name-availability?provider=github&name=fresh-repo',
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'available');
  assert.equal(res.body.full_name, 'sam/fresh-repo');
});

test('GET /api/auth/storage/name-availability requires name', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: {
      clientsFor: async () => ({ githubUserClient: {} }),
    },
    storageService: {},
  });
  const res = await request(app).get(
    '/api/auth/storage/name-availability?provider=github',
  );
  assert.equal(res.status, 400);
  assert.match(res.body.error, /name is required/);
});

test('POST /api/auth/storage/create returns storageRef and needsInstall', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: {
      clientsFor: async () => ({ githubUserClient: { mock: true } }),
      getInstallationSetupUrl: async () =>
        'https://github.com/apps/vizably/installations/new',
    },
    storageService: {
      createGitHubRepository: async (name, _clients, options) => ({
        storageRef: {
          id: 'R_kgNew',
          name,
          full_name: `sam/${name}`,
          private: true,
          html_url: `https://github.com/sam/${name}`,
        },
        needsInstall: true,
        installUrl: options.installUrl,
      }),
    },
  });
  const res = await request(app)
    .post('/api/auth/storage/create')
    .send({ name: 'vizably-new' });
  assert.equal(res.status, 201);
  assert.equal(res.body.storageRef.full_name, 'sam/vizably-new');
  assert.equal(res.body.needsInstall, true);
  assert.match(res.body.installUrl, /installations\/new/);
});

test('POST /api/auth/storage/create requires name', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: {
      clientsFor: async () => ({ githubUserClient: {} }),
      getInstallationSetupUrl: async () => 'https://github.com/settings/installations',
    },
    storageService: {},
  });
  const res = await request(app).post('/api/auth/storage/create').send({});
  assert.equal(res.status, 400);
  assert.match(res.body.error, /name is required/);
});

test('POST /api/auth/storage/create returns probe failures without needsInstall', async () => {
  const app = createAuthedApp({
    user: AUTHED_USER,
    authService: {
      clientsFor: async () => ({ githubUserClient: { mock: true } }),
      getInstallationSetupUrl: async () =>
        'https://github.com/apps/vizably/installations/new',
    },
    storageService: {
      createGitHubRepository: async () => {
        const err = new Error(
          'GitHub rate-limited the request while checking App installation access. ' +
            'Wait a moment and refresh — do not reinstall the Vizably GitHub App.',
        );
        err.status = 429;
        err.code = 'GITHUB_RATE_LIMITED';
        err.storageRef = {
          id: 'R_kgNew',
          name: 'vizably-new',
          full_name: 'sam/vizably-new',
          private: true,
          html_url: 'https://github.com/sam/vizably-new',
        };
        throw err;
      },
    },
  });
  const res = await request(app)
    .post('/api/auth/storage/create')
    .send({ name: 'vizably-new' });
  assert.equal(res.status, 429);
  assert.equal(res.body.code, 'GITHUB_RATE_LIMITED');
  assert.equal(res.body.needsInstall, undefined);
  assert.equal(res.body.storageRef.full_name, 'sam/vizably-new');
  assert.match(res.body.error, /do not reinstall/i);
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
  // The response still carries the list so the client can render immediately…
  assert.equal(res.body.account.scans.length, 1);
  // …but it is never persisted on the session, which must fit in a cookie.
  assert.equal(user.account.scans, undefined);
  assert.equal(user.storage.full_name, 'sam/repo');
  assert.equal(persisted, true);
});
