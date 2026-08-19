/**
 * Unit tests for AuthService — encryption, client builders, Phase 3 stubs.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { TEST_ENCRYPTION_KEY, TEST_SESSION_SECRET } = require('./helpers/testEnv');
const AuthService = require('../services/authService');

test('encrypt/decrypt round-trip with AES-256-GCM', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const token = 'gho_test_access_token_12345';
  const encrypted = authService.encrypt(token);

  assert.notEqual(encrypted, token);
  assert.equal(authService.decrypt(encrypted), token);
});

test('encrypt produces distinct ciphertext for the same plaintext', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const a = authService.encrypt('same-token');
  const b = authService.encrypt('same-token');

  assert.notEqual(a, b);
  assert.equal(authService.decrypt(a), 'same-token');
  assert.equal(authService.decrypt(b), 'same-token');
});

test('middleware returns session + passport handlers', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const stack = authService.middleware();
  assert.ok(stack.length >= 3);
  for (const handler of stack) {
    assert.equal(typeof handler, 'function');
  }
});

test('middleware shims regenerate/save so passport works on cookie-session', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  // cookie-session provides neither method; passport calls both. Without the
  // shim, req.login() throws and every OAuth callback 500s.
  const req = { session: {} };
  const shim = authService.middleware()[1];

  let nexted = false;
  shim(req, {}, () => {
    nexted = true;
  });

  assert.equal(nexted, true);
  assert.equal(typeof req.session.regenerate, 'function');
  assert.equal(typeof req.session.save, 'function');

  let regenerated = false;
  req.session.regenerate(() => {
    regenerated = true;
  });
  assert.equal(regenerated, true);
});

test('getGitHubClient returns authenticated Octokit', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const user = {
    id: '1',
    provider: 'github',
    tokens: {
      github: {
        accessToken: authService.encrypt('gho_live_token'),
      },
    },
  };

  const client = authService.getGitHubClient(user);
  assert.ok(client);
  assert.equal(typeof client.rest.repos.listForAuthenticatedUser, 'function');
});

test('createGitHubOctokit sends X-GitHub-Api-Version on requests', async () => {
  const { createGitHubOctokit, GITHUB_API_VERSION } = require('../services/authService');
  /** @type {Headers | Record<string, string> | undefined} */
  let capturedHeaders;

  const client = createGitHubOctokit({
    auth: 'gho_test_token',
    request: {
      fetch: async (_url, options = {}) => {
        capturedHeaders = options.headers;
        return new Response(JSON.stringify({ login: 'sam' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });

  await client.rest.users.getAuthenticated();

  assert.ok(capturedHeaders);
  const headers =
    typeof capturedHeaders.get === 'function'
      ? capturedHeaders
      : new Headers(capturedHeaders);
  assert.equal(headers.get('X-GitHub-Api-Version'), GITHUB_API_VERSION);
  assert.equal(GITHUB_API_VERSION, '2026-03-10');
});

test('getGoogleDriveClient returns null until Phase 3', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  assert.equal(authService.getGoogleDriveClient({}), null);
});

test('refreshGoogleToken rejects until Phase 3', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  await assert.rejects(
    () => authService.refreshGoogleToken({}),
    /not available until Phase 3/,
  );
});

test('clientsFor builds githubClient only when token present', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const empty = await authService.clientsFor({});
  assert.deepEqual(Object.keys(empty), []);

  const withGitHub = await authService.clientsFor({
    tokens: {
      github: { accessToken: authService.encrypt('gho_token') },
    },
  });

  assert.ok(withGitHub.githubClient);
  assert.ok(withGitHub.githubUserClient);
  assert.equal('driveClient' in withGitHub, false);
});

test('getInstallationClientForRepo rejects when user cannot access the repo', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    githubAppId: '12345',
    githubAppPrivateKey:
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZGFwodaQ=\n-----END RSA PRIVATE KEY-----',
  });

  authService.getGitHubClient = () => ({
    rest: {
      repos: {
        get: async () => {
          const err = new Error('Not Found');
          err.status = 404;
          throw err;
        },
      },
    },
  });

  await assert.rejects(
    () =>
      authService.getInstallationClientForRepo(
        {
          tokens: {
            github: { accessToken: authService.encrypt('gho_token') },
          },
        },
        { id: 'R_kgDOA123', full_name: 'other/secret-repo' },
      ),
    (err) => err.code === 'STORAGE_ACCESS_DENIED' && err.status === 403,
  );
});

test('getInstallationClientForRepo rejects node id mismatch', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    githubAppId: '12345',
    githubAppPrivateKey:
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZGFwodaQ=\n-----END RSA PRIVATE KEY-----',
  });

  authService.getGitHubClient = () => ({
    rest: {
      repos: {
        get: async () => ({
          data: {
            node_id: 'R_kgDODifferent',
            full_name: 'sam/site-audits',
          },
        }),
      },
    },
  });

  await assert.rejects(
    () =>
      authService.getInstallationClientForRepo(
        {
          tokens: {
            github: { accessToken: authService.encrypt('gho_token') },
          },
        },
        { id: 'R_kgDOA123', full_name: 'sam/site-audits' },
      ),
    (err) => err.code === 'STORAGE_IDENTITY_MISMATCH' && err.status === 403,
  );
});

test('getInstallationClientForRepo requires storageRef.id', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    githubAppId: '12345',
    githubAppPrivateKey:
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3VS5JJcds3xfn/ygWyF6PZGFwodaQ=\n-----END RSA PRIVATE KEY-----',
  });

  let reposGetCalled = false;
  authService.getGitHubClient = () => ({
    rest: {
      repos: {
        get: async () => {
          reposGetCalled = true;
          return {
            data: {
              node_id: 'R_kgDOA123',
              full_name: 'sam/site-audits',
            },
          };
        },
      },
    },
  });

  await assert.rejects(
    () =>
      authService.getInstallationClientForRepo(
        {
          tokens: {
            github: { accessToken: authService.encrypt('gho_token') },
          },
        },
        { full_name: 'sam/site-audits' },
      ),
    /storageRef requires id/,
  );
  assert.equal(reposGetCalled, false);
});

test('_findInstallationIdForRepo paginates user installations and repos', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
  });

  const installations = Array.from({ length: 101 }, (_, i) => ({ id: i + 1 }));
  const reposForTarget = Array.from({ length: 101 }, (_, i) => ({
    full_name: i === 100 ? 'sam/site-audits' : `sam/other-${i}`,
  }));
  const calls = { installations: [], repos: [] };

  const userOctokit = {
    rest: {
      apps: {
        listInstallationsForAuthenticatedUser: async ({ page = 1, per_page = 100 } = {}) => {
          calls.installations.push({ page, per_page });
          const start = (page - 1) * per_page;
          return {
            data: { installations: installations.slice(start, start + per_page) },
          };
        },
        listInstallationReposForAuthenticatedUser: async ({
          installation_id,
          page = 1,
          per_page = 100,
        }) => {
          calls.repos.push({ installation_id, page, per_page });
          if (installation_id !== 101) {
            return { data: { repositories: [] } };
          }
          const start = (page - 1) * per_page;
          return {
            data: { repositories: reposForTarget.slice(start, start + per_page) },
          };
        },
      },
    },
  };

  const id = await authService._findInstallationIdForRepo(userOctokit, 'sam/site-audits');
  assert.equal(id, 101);
  assert.equal(calls.installations.length, 2);
  assert.ok(calls.repos.some((c) => c.installation_id === 101 && c.page === 2));
});
