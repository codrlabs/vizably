/**
 * Auth route tests — status, stubs, protected endpoints, logout.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

const { TEST_ENCRYPTION_KEY, TEST_SESSION_SECRET } = require('./helpers/testEnv');
const { buildApp } = require('../app');
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

test('session survives a fresh app instance because the cookie is the store', async () => {
  const express = require('express');
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  // Two independent instances share no process memory — the same situation as
  // two serverless invocations. Only a cookie-borne session bridges them, so
  // this fails against any in-memory store.
  const makeInstance = () => {
    const app = express();
    app.use(...authService.middleware());
    app.get('/write', (req, res) => {
      req.session.marker = 'kept';
      return res.json({ ok: true });
    });
    app.get('/read', (req, res) => res.json({ marker: req.session.marker ?? null }));
    return app;
  };

  const written = await request(makeInstance()).get('/write');
  const cookie = written.headers['set-cookie'];
  assert.ok(cookie, 'expected a session cookie to be set');

  const read = await request(makeInstance()).get('/read').set('Cookie', cookie);
  assert.equal(read.body.marker, 'kept');
});

test('a failed OAuth token exchange redirects and logs the provider reason', async () => {
  const express = require('express');
  const makeAuthRouter = require('../routes/auth');

  // What passport-oauth2 actually throws when GitHub rejects the exchange:
  // a generic message, with the useful part buried on `oauthError`.
  const oauthFailure = Object.assign(new Error('Failed to obtain access token'), {
    oauthError: { data: '{"error":"incorrect_client_credentials"}' },
  });

  const app = express();
  app.use(
    '/api/auth',
    makeAuthRouter({
      authService: { authenticateGitHub: () => (_req, _res, next) => next(oauthFailure) },
      storageService: {},
    }),
  );

  const logged = [];
  const originalError = console.error;
  console.error = (...args) => logged.push(args.join(' '));

  try {
    const res = await request(app).get('/api/auth/github/callback');

    // Not a 500 with a stack trace — the user lands back on Connect.
    assert.equal(res.status, 302);
    assert.match(res.headers.location, /error=auth_failed/);
  } finally {
    console.error = originalError;
  }

  // And the reason we could not see before is now in the logs.
  assert.ok(
    logged.some((line) => line.includes('incorrect_client_credentials')),
    `expected the provider reason to be logged, got: ${JSON.stringify(logged)}`,
  );
});

test('a Secure cookie is set behind a TLS-terminating proxy', async () => {
  // Vercel terminates TLS at the edge and forwards plain http with
  // X-Forwarded-Proto: https. Without `trust proxy` the cookie layer throws
  // "Cannot send secure cookie over unencrypted connection" and every
  // authenticated request 500s — in production only, since locally
  // NODE_ENV is not 'production' and the cookie is not marked Secure.
  const previousEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';

  try {
    const authService = new AuthService({
      sessionSecret: TEST_SESSION_SECRET,
      encryptionKey: TEST_ENCRYPTION_KEY,
    });
    const app = buildApp({ authService, storageService: new StorageService() });
    app.get('/__probe', (req, res) => {
      req.session.marker = 'kept';
      return res.json({ protocol: req.protocol, secure: req.secure });
    });

    const res = await request(app)
      .get('/__probe')
      .set('X-Forwarded-Proto', 'https');

    assert.equal(res.status, 200);
    assert.equal(res.body.protocol, 'https');
    assert.equal(res.body.secure, true);

    const cookie = String(res.headers['set-cookie'] || '');
    assert.match(cookie, /vizably\.sid=/);
    assert.match(cookie, /secure/i);
  } finally {
    process.env.NODE_ENV = previousEnv;
  }
});

test('session payload stays well under the 4KB cookie limit', async () => {
  const express = require('express');
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const app = express();
  app.use(...authService.middleware());
  app.get('/write', (req, res) => {
    req.session.passport = {
      user: {
        id: '12345678',
        provider: 'github',
        username: 'devolabode',
        displayName: 'Dev Olabode',
        email: 'dev@example.com',
        avatarUrl: 'https://avatars.githubusercontent.com/u/12345678?v=4',
        tokens: { github: { accessToken: authService.encrypt('a'.repeat(40)) } },
        storage: {
          provider: 'github',
          id: 'R_kgDOMxxxxx',
          full_name: 'devolabode/vizably-account',
          branch: 'main',
        },
        account: { accountId: 'acc-1', settings: { autoDelete90d: true }, scanCount: 42 },
      },
    };
    return res.json({ ok: true });
  });

  const res = await request(app).get('/write');
  const cookie = String(res.headers['set-cookie']);

  // Browsers silently drop an oversized cookie, so this guards the whole auth
  // flow: note scanCount is 42 while the size stays flat, because the scan
  // list is fetched from storage rather than carried here.
  assert.ok(
    cookie.length < 4096,
    `session cookie must stay under 4096 bytes, got ${cookie.length}`,
  );
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
    // Plain object, matching cookie-session: no destroy(), cleared by nulling.
    req.session = {};
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

test('POST /api/auth/account/wipe requires authentication', async () => {
  const app = createTestApp();
  const res = await request(app).post('/api/auth/account/wipe');
  assert.equal(res.status, 401);
});

test('POST /api/auth/account/wipe clears session storage after wipe', async () => {
  const user = {
    ...AUTHED_USER,
    storage: { id: 'R_kg', full_name: 'sam/site-audits', provider: 'github' },
    account: { accountId: 'a1', scanCount: 2 },
  };
  let persisted = false;
  const app = createAuthedApp({
    user,
    authService: {
      clientsFor: async () => ({ githubClient: {} }),
      persistUser: async () => {
        persisted = true;
      },
    },
    storageService: {
      wipeAccountStore: async () => ({
        wiped: true,
        pathsRemoved: ['vizably.json', 'scans/index.json'],
        storageRef: { id: 'R_kg', full_name: 'sam/site-audits', branch: 'main' },
      }),
    },
  });
  const res = await request(app).post('/api/auth/account/wipe').send({});
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.wiped, true);
  assert.equal(user.storage, undefined);
  assert.equal(user.account, undefined);
  assert.equal(persisted, true);
});

test('POST /api/auth/account/delete-repository requires confirm true', async () => {
  const app = createAuthedApp({
    user: {
      ...AUTHED_USER,
      storage: { id: 'R_kg', full_name: 'sam/site-audits' },
    },
    authService: {
      clientsFor: async () => ({ githubUserClient: {} }),
      persistUser: async () => {},
    },
    storageService: {
      deleteGitHubRepository: async () => {
        throw new Error('should not be called');
      },
    },
  });
  const res = await request(app)
    .post('/api/auth/account/delete-repository')
    .send({ confirm: false });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /confirm/);
});

test('POST /api/auth/account/delete-repository deletes when confirmed', async () => {
  const user = {
    ...AUTHED_USER,
    storage: { id: 'R_kg', full_name: 'sam/site-audits' },
  };
  const app = createAuthedApp({
    user,
    authService: {
      clientsFor: async () => ({ githubUserClient: {} }),
      persistUser: async () => {},
    },
    storageService: {
      deleteGitHubRepository: async (ref) => ({
        deleted: true,
        full_name: ref.full_name,
      }),
    },
  });
  const res = await request(app)
    .post('/api/auth/account/delete-repository')
    .send({
      confirm: true,
      storageRef: { id: 'R_kg', full_name: 'sam/site-audits' },
    });
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);
  assert.equal(res.body.full_name, 'sam/site-audits');
});
