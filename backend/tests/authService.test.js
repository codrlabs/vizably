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
  assert.equal(stack.length, 3);
  assert.equal(typeof stack[0], 'function');
  assert.equal(typeof stack[1], 'function');
  assert.equal(typeof stack[2], 'function');
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

test('getGoogleDriveClient returns null without Google tokens', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    googleClientId: 'google-client-id.apps.googleusercontent.com',
    googleClientSecret: 'google-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
  });

  assert.equal(authService.getGoogleDriveClient({}), null);
});

test('getGoogleDriveClient returns Drive client with setCredentials', () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    googleClientId: 'google-client-id.apps.googleusercontent.com',
    googleClientSecret: 'google-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
  });

  const client = authService.getGoogleDriveClient({
    tokens: {
      google: {
        accessToken: authService.encrypt('ya29.access'),
        refreshToken: authService.encrypt('1//refresh'),
      },
    },
  });

  assert.ok(client);
  assert.equal(typeof client.files.list, 'function');
});

test('refreshGoogleToken rejects without a refresh token', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    googleClientId: 'google-client-id.apps.googleusercontent.com',
    googleClientSecret: 'google-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
  });

  await assert.rejects(
    () => authService.refreshGoogleToken({ tokens: { google: { accessToken: 'x' } } }),
    /refresh token is not available/,
  );
});

test('clientsFor builds driveClient when Google token present', async () => {
  const authService = new AuthService({
    sessionSecret: TEST_SESSION_SECRET,
    encryptionKey: TEST_ENCRYPTION_KEY,
    googleClientId: 'google-client-id.apps.googleusercontent.com',
    googleClientSecret: 'google-client-secret',
    googleCallbackUrl: 'http://localhost:3000/api/auth/google/callback',
  });

  const clients = await authService.clientsFor({
    tokens: {
      google: {
        accessToken: authService.encrypt('ya29.access'),
      },
    },
  });

  assert.ok(clients.driveClient);
  assert.equal(typeof clients.driveClient.files.list, 'function');
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
