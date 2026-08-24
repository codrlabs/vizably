/**
 * Unit tests for StorageService — fit-check matrix, reconcile, init guard, save.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const StorageService = require('../services/storageService');

const STORAGE_REF = {
  id: 'R_kgDOA123',
  full_name: 'sam/site-audits',
  html_url: 'https://github.com/sam/site-audits',
};

function manifest(overrides = {}) {
  return {
    vizably: true,
    kind: 'account-store',
    schemaVersion: 1,
    minReaderSchemaVersion: 1,
    account: {
      id: '11111111-1111-1111-1111-111111111111',
      createdAt: '2026-06-30T18:04:00Z',
      updatedAt: '2026-06-30T18:04:00Z',
    },
    storage: {
      provider: 'github',
      providerStorageId: STORAGE_REF.id,
      ownerId: '42',
      ownerDisplay: 'sam',
      repo: STORAGE_REF.full_name,
      branch: 'main',
    },
    settings: { autoDelete90d: true },
    summary: { scanCount: 0, lastScanAt: null },
    features: [],
    ...overrides,
  };
}

function createMockGitHubClient(initial = {}) {
  /** @type {Record<string, { content: string, sha: string }>} */
  const files = { ...initial.files };
  /** @type {Record<string, string>} */
  const blobs = {};
  /** @type {Record<string, object[]>} */
  const pendingTrees = {};
  /** @type {Record<string, { parents: string[], tree: object[] }>} */
  const pendingCommits = {};
  let headSha = initial.headSha || 'commit-base';
  let blobCounter = 0;
  let commitCounter = 0;
  let treeCounter = 0;

  const repoMeta = {
    default_branch: 'main',
    permissions: { pull: true, push: true, admin: false },
    ...initial.repoMeta,
  };
  const installationProbe = initial.installationProbe ?? null;

  let updateRefFailures = initial.updateRefFailures ?? 0;
  let createOrUpdateFailures = initial.createOrUpdateFailures ?? 0;
  const emptyRepo = initial.emptyRepo ?? false;
  const state = { refCreated: !emptyRepo };
  let fileCounter = 0;

  return {
    files,
    get refCreated() {
      return state.refCreated;
    },
    rest: {
      users: {
        getAuthenticated: async () => ({
          data: { login: initial.login || 'sam' },
        }),
      },
      repos: {
        listForAuthenticatedUser: async ({ page = 1, per_page = 100 } = {}) => {
          const all = initial.listedRepos ?? [
            {
              node_id: STORAGE_REF.id,
              full_name: STORAGE_REF.full_name,
              private: true,
              html_url: STORAGE_REF.html_url,
            },
          ];
          const start = (page - 1) * per_page;
          return { data: all.slice(start, start + per_page) };
        },
        get: async (args) => {
          if (typeof initial.repoGet === 'function') {
            return initial.repoGet(args);
          }
          return { data: repoMeta };
        },
        createForAuthenticatedUser: async ({ name, private: isPrivate, auto_init }) => {
          if (typeof initial.createRepo === 'function') {
            return initial.createRepo({ name, private: isPrivate, auto_init });
          }
          if (initial.createRepoError) {
            throw initial.createRepoError;
          }
          const created = initial.createdRepo ?? {
            node_id: 'R_kgNew',
            name,
            full_name: `sam/${name}`,
            private: isPrivate !== false,
            html_url: `https://github.com/sam/${name}`,
            auto_init,
          };
          return { data: created };
        },
        deleteFile: async ({ path, sha }) => {
          if (!files[path]) {
            const err = new Error('Not Found');
            err.status = 404;
            throw err;
          }
          if (sha && files[path].sha !== sha) {
            const err = new Error('Reference update failed');
            err.status = 422;
            throw err;
          }
          delete files[path];
          return { data: { commit: { sha: `delete-${path}` } } };
        },
        createOrUpdateFileContents: async ({ path, content, sha }) => {
          if (createOrUpdateFailures > 0) {
            createOrUpdateFailures -= 1;
            const err = new Error('Reference update failed');
            err.status = 422;
            throw err;
          }

          if (files[path] && !sha) {
            const err = new Error('"sha" wasn\'t supplied.');
            err.status = 422;
            throw err;
          }

          if (sha && files[path]?.sha && files[path].sha !== sha) {
            const err = new Error('Reference update failed');
            err.status = 422;
            throw err;
          }

          fileCounter += 1;
          const decoded = Buffer.from(content, 'base64').toString('utf8');
          const newSha = `sha-${fileCounter}`;
          files[path] = { content: decoded, sha: newSha };
          state.refCreated = true;
          headSha = `commit-${fileCounter}`;
          return {
            data: {
              content: { sha: newSha },
              commit: { sha: headSha },
            },
          };
        },
        getContent: async ({ path }) => {
          if (path === '') {
            const rootFiles = Object.keys(files).filter((p) => !p.includes('/'));
            if (rootFiles.length === 0) {
              const err = new Error('Not Found');
              err.status = 404;
              throw err;
            }
            return {
              data: rootFiles.map((name) => ({ name, type: 'file', path: name })),
            };
          }

          if (path === 'scans') {
            const scanFiles = Object.keys(files)
              .filter((p) => p.startsWith('scans/'))
              .map((p) => ({
                name: p.replace('scans/', ''),
                type: 'file',
                path: p,
                sha: files[p].sha,
              }));
            if (scanFiles.length === 0) {
              const err = new Error('Not Found');
              err.status = 404;
              throw err;
            }
            return { data: scanFiles };
          }

          const file = files[path];
          if (!file) {
            const err = new Error('Not Found');
            err.status = 404;
            throw err;
          }
          return {
            data: {
              type: 'file',
              content: Buffer.from(file.content, 'utf8').toString('base64'),
              encoding: 'base64',
              sha: file.sha,
            },
          };
        },
      },
      git: {
        getRef: async () => {
          if (!state.refCreated) {
            const err = new Error('Git Repository is empty.');
            err.status = 409;
            err.response = { data: { message: 'Git Repository is empty.' } };
            throw err;
          }
          return { data: { object: { sha: headSha } } };
        },
        getCommit: async ({ commit_sha }) => ({
          data: { sha: commit_sha, tree: { sha: `tree-for-${commit_sha}` } },
        }),
        createBlob: async ({ content }) => {
          blobCounter += 1;
          const sha = `blob-${blobCounter}`;
          blobs[sha] = Buffer.from(content, 'base64').toString('utf8');
          return { data: { sha } };
        },
        createTree: async ({ tree }) => {
          treeCounter += 1;
          const sha = `tree-${treeCounter}`;
          pendingTrees[sha] = tree;
          return { data: { sha } };
        },
        createCommit: async ({ parents, tree }) => {
          commitCounter += 1;
          const sha = `commit-git-${commitCounter}`;
          pendingCommits[sha] = {
            parents: parents || [],
            tree: pendingTrees[tree] || [],
          };
          delete pendingTrees[tree];
          return { data: { sha } };
        },
        createRef: async ({ sha }) => {
          state.refCreated = true;
          headSha = sha;
        },
        updateRef: async ({ sha }) => {
          if (updateRefFailures > 0) {
            updateRefFailures -= 1;
            const err = new Error('Reference update failed');
            err.status = 422;
            throw err;
          }

          const pending = pendingCommits[sha];
          if (pending?.parents[0] && pending.parents[0] !== headSha) {
            const err = new Error('Reference update failed');
            err.status = 422;
            throw err;
          }

          if (pending) {
            for (const entry of pending.tree || []) {
              if (entry.path && entry.sha && blobs[entry.sha]) {
                files[entry.path] = {
                  content: blobs[entry.sha],
                  sha: entry.sha,
                };
              }
            }
            delete pendingCommits[sha];
          }

          state.refCreated = true;
          headSha = sha;
        },
      },
      apps: installationProbe || initial.installationProbeError
        ? {
            listInstallationsForAuthenticatedUser: async ({ page = 1, per_page = 100 } = {}) => {
              if (initial.installationProbeError) {
                throw initial.installationProbeError;
              }
              const all = (installationProbe ?? []).map((entry) => ({
                id: entry.id,
                permissions: { contents: entry.contents },
                repository_selection: entry.repository_selection || 'selected',
              }));
              const start = (page - 1) * per_page;
              return {
                data: {
                  installations: all.slice(start, start + per_page),
                },
              };
            },
            listInstallationReposForAuthenticatedUser: async ({
              installation_id,
              page = 1,
              per_page = 100,
            }) => {
              if (initial.installationReposError) {
                throw initial.installationReposError;
              }
              const entry = (installationProbe ?? []).find((item) => item.id === installation_id);
              const all = (entry?.repos ?? []).map((full_name) => ({ full_name }));
              const start = (page - 1) * per_page;
              return {
                data: {
                  repositories: all.slice(start, start + per_page),
                },
              };
            },
          }
        : undefined,
    },
  };
}

test('listGitHubRepos maps node id and repo metadata', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient();
  const repos = await storageService.listGitHubRepos(client);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].id, STORAGE_REF.id);
  assert.equal(repos[0].full_name, STORAGE_REF.full_name);
});

test('listGitHubRepos paginates beyond the first 100 repos', async () => {
  const storageService = new StorageService();
  const listedRepos = Array.from({ length: 105 }, (_, i) => ({
    node_id: `R_${i}`,
    full_name: `sam/repo-${i}`,
    private: true,
    html_url: `https://github.com/sam/repo-${i}`,
  }));
  const client = createMockGitHubClient({ listedRepos });
  const repos = await storageService.listGitHubRepos(client);
  assert.equal(repos.length, 105);
  assert.equal(repos[0].full_name, 'sam/repo-0');
  assert.equal(repos[104].full_name, 'sam/repo-104');
  assert.equal(repos[104].id, 'R_104');
});

test('checkGitHubRepoNameAvailability returns available on 404', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    repoGet: async () => {
      const err = new Error('Not Found');
      err.status = 404;
      throw err;
    },
  });
  const result = await storageService.checkGitHubRepoNameAvailability('fresh-repo', {
    githubUserClient: client,
  });
  assert.equal(result.status, 'available');
  assert.equal(result.normalizedName, 'viz_fresh-repo');
  assert.equal(result.full_name, 'sam/viz_fresh-repo');
});

test('checkGitHubRepoNameAvailability returns taken when repo exists', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    repoGet: async ({ repo }) => ({
      data: { name: repo, full_name: `sam/${repo}` },
    }),
  });
  const result = await storageService.checkGitHubRepoNameAvailability('site-audits', {
    githubUserClient: client,
  });
  assert.equal(result.status, 'taken');
  assert.equal(result.normalizedName, 'viz_site-audits');
  assert.match(result.message, /viz_site-audits/);
});

test('checkGitHubRepoNameAvailability returns invalid for bad names', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient();
  const result = await storageService.checkGitHubRepoNameAvailability('bad name!', {
    githubUserClient: client,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.normalizedName, null);
});

test('createGitHubRepository creates a private empty repo and returns storageRef', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repos: ['sam/viz_scans'],
      },
    ],
  });
  const result = await storageService.createGitHubRepository('scans', {
    githubUserClient: client,
  });
  assert.equal(result.storageRef.full_name, 'sam/viz_scans');
  assert.equal(result.storageRef.name, 'viz_scans');
  assert.equal(result.storageRef.id, 'R_kgNew');
  assert.equal(result.needsInstall, false);
  assert.equal(result.installUrl, null);
});

test('createGitHubRepository sets needsInstall when App cannot write yet', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repos: ['sam/other-repo'],
      },
    ],
  });
  const result = await storageService.createGitHubRepository(
    'scans',
    { githubUserClient: client },
    { installUrl: 'https://github.com/apps/vizably/installations/new' },
  );
  assert.equal(result.needsInstall, true);
  assert.equal(result.storageRef.name, 'viz_scans');
  assert.equal(
    result.installUrl,
    'https://github.com/apps/vizably/installations/new',
  );
});

test('createGitHubRepository skips install hop when installation covers all repos', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repository_selection: 'all',
        repos: [],
      },
    ],
  });
  const result = await storageService.createGitHubRepository('scans', {
    githubUserClient: client,
  });
  assert.equal(result.needsInstall, false);
  assert.equal(result.storageRef.name, 'viz_scans');
});

test('createGitHubRepository finds writable install when repo is past first page', async () => {
  const storageService = new StorageService();
  const repos = Array.from({ length: 101 }, (_, i) =>
    i === 100 ? 'sam/viz_paged' : `sam/other-${i}`,
  );
  const client = createMockGitHubClient({
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repos,
      },
    ],
  });
  const result = await storageService.createGitHubRepository('paged', {
    githubUserClient: client,
  });
  assert.equal(result.needsInstall, false);
  assert.equal(result.storageRef.full_name, 'sam/viz_paged');
});

test('createGitHubRepository finds writable install when installation is past first page', async () => {
  const storageService = new StorageService();
  const installationProbe = Array.from({ length: 101 }, (_, i) => ({
    id: i + 1,
    contents: 'write',
    repos: i === 100 ? ['sam/viz_paged'] : [`sam/other-${i}`],
  }));
  const client = createMockGitHubClient({ installationProbe });
  const result = await storageService.createGitHubRepository('paged', {
    githubUserClient: client,
  });
  assert.equal(result.needsInstall, false);
  assert.equal(result.storageRef.full_name, 'sam/viz_paged');
});

test('createGitHubRepository surfaces rate limits instead of needsInstall', async () => {
  const storageService = new StorageService();
  const probeErr = new Error('API rate limit exceeded');
  probeErr.status = 403;
  probeErr.response = {
    data: { message: 'API rate limit exceeded' },
    headers: { 'x-ratelimit-remaining': '0' },
  };
  const client = createMockGitHubClient({ installationProbeError: probeErr });
  await assert.rejects(
    () => storageService.createGitHubRepository('scans', { githubUserClient: client }),
    (err) => {
      assert.equal(err.code, 'GITHUB_RATE_LIMITED');
      assert.equal(err.status, 429);
      assert.match(err.message, /rate-limited/i);
      assert.match(err.message, /do not reinstall/i);
      assert.equal(err.storageRef?.full_name, 'sam/viz_scans');
      return true;
    },
  );
});

test('createGitHubRepository surfaces network failures instead of needsInstall', async () => {
  const storageService = new StorageService();
  const probeErr = new Error('getaddrinfo ENOTFOUND api.github.com');
  probeErr.code = 'ENOTFOUND';
  const client = createMockGitHubClient({ installationProbeError: probeErr });
  await assert.rejects(
    () => storageService.createGitHubRepository('scans', { githubUserClient: client }),
    (err) => {
      assert.equal(err.code, 'GITHUB_NETWORK_ERROR');
      assert.equal(err.status, 503);
      assert.match(err.message, /network/i);
      assert.equal(err.storageRef?.name, 'viz_scans');
      return true;
    },
  );
});

test('createGitHubRepository surfaces auth failures instead of needsInstall', async () => {
  const storageService = new StorageService();
  const probeErr = new Error('Bad credentials');
  probeErr.status = 401;
  probeErr.response = { data: { message: 'Bad credentials' }, headers: {} };
  const client = createMockGitHubClient({ installationProbeError: probeErr });
  await assert.rejects(
    () => storageService.createGitHubRepository('scans', { githubUserClient: client }),
    (err) => {
      assert.equal(err.code, 'GITHUB_AUTH_FAILED');
      assert.equal(err.status, 401);
      assert.match(err.message, /authentication failed/i);
      return true;
    },
  );
});

test('createGitHubRepository surfaces GitHub outages instead of needsInstall', async () => {
  const storageService = new StorageService();
  const probeErr = new Error('Server Error');
  probeErr.status = 502;
  probeErr.response = { data: { message: 'Server Error' }, headers: {} };
  const client = createMockGitHubClient({ installationProbeError: probeErr });
  await assert.rejects(
    () => storageService.createGitHubRepository('scans', { githubUserClient: client }),
    (err) => {
      assert.equal(err.code, 'GITHUB_UNAVAILABLE');
      assert.equal(err.status, 503);
      assert.match(err.message, /temporarily unavailable/i);
      return true;
    },
  );
});

test('createGitHubRepository rejects invalid names', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient();
  await assert.rejects(
    () => storageService.createGitHubRepository('sam/scans', { githubUserClient: client }),
    /name only/,
  );
  await assert.rejects(
    () => storageService.createGitHubRepository('bad name!', { githubUserClient: client }),
    /letters, numbers/,
  );
  await assert.rejects(
    () => storageService.createGitHubRepository('   ', { githubUserClient: client }),
    /required/,
  );
});

test('createGitHubRepository prefixes and normalizes whitespace before create', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repos: ['sam/viz_accessibility-results'],
      },
    ],
  });
  const result = await storageService.createGitHubRepository('  accessibility   results  ', {
    githubUserClient: client,
  });
  assert.equal(result.storageRef.full_name, 'sam/viz_accessibility-results');
  assert.equal(result.storageRef.name, 'viz_accessibility-results');
});

test('createGitHubRepository does not double-prefix an existing viz_ name', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repository_selection: 'all',
        repos: [],
      },
    ],
  });
  const result = await storageService.createGitHubRepository('viz_reports', {
    githubUserClient: client,
  });
  assert.equal(result.storageRef.name, 'viz_reports');
});

test('createGitHubRepository maps name-taken conflicts', async () => {
  const storageService = new StorageService();
  const conflict = new Error('Repository creation failed.');
  conflict.status = 422;
  conflict.response = {
    data: {
      message: 'Repository creation failed.',
      errors: [{ message: 'name already exists on this account' }],
    },
  };
  const client = createMockGitHubClient({ createRepoError: conflict });
  await assert.rejects(
    () => storageService.createGitHubRepository('taken', { githubUserClient: client }),
    /viz_taken/,
  );
});

test('createGitHubRepository maps Administration permission 403 to REPO_CREATE_FORBIDDEN', async () => {
  const storageService = new StorageService();
  const forbidden = new Error('Resource not accessible by integration');
  forbidden.status = 403;
  forbidden.response = {
    data: { message: 'Resource not accessible by integration' },
  };
  const client = createMockGitHubClient({ createRepoError: forbidden });
  await assert.rejects(
    () => storageService.createGitHubRepository('vizably-new', { githubUserClient: client }),
    (err) => {
      assert.equal(err.code, 'REPO_CREATE_FORBIDDEN');
      assert.equal(err.status, 403);
      assert.match(err.message, /Administration:\s*Read and write/i);
      assert.match(err.message, /permission upgrade/i);
      return true;
    },
  );
});

test('createGitHubRepository maps generic create 403 to REPO_CREATE_FORBIDDEN', async () => {
  const storageService = new StorageService();
  const forbidden = new Error('Forbidden');
  forbidden.status = 403;
  forbidden.response = {
    data: { message: 'Although you appear to have the correct authorization credentials, organization policy prevents creating repositories.' },
  };
  const client = createMockGitHubClient({ createRepoError: forbidden });
  await assert.rejects(
    () => storageService.createGitHubRepository('vizably-new', { githubUserClient: client }),
    (err) => {
      assert.equal(err.code, 'REPO_CREATE_FORBIDDEN');
      assert.equal(err.status, 403);
      assert.match(err.message, /organization policy prevents creating repositories/i);
      assert.doesNotMatch(err.message, /Administration/);
      return true;
    },
  );
});

test('validateStorage returns initializable for empty repo', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient();
  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: client,
  });
  assert.equal(result.status, 'initializable');
  assert.equal(result.capabilities.canWrite, true);
});

test('validateStorage probes write access with user client when IO uses installation token', async () => {
  const storageService = new StorageService();
  const installationClient = createMockGitHubClient({
    repoMeta: { permissions: { pull: true, push: false, admin: false } },
  });
  const userClient = createMockGitHubClient({
    repoMeta: { permissions: { pull: true, push: false, admin: false } },
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repos: [STORAGE_REF.full_name],
      },
    ],
  });
  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: installationClient,
    githubUserClient: userClient,
  });
  assert.equal(result.status, 'initializable');
  assert.equal(result.capabilities.canWrite, true);
});

test('validateStorage finds App write access when repo is past first install page', async () => {
  const storageService = new StorageService();
  const repos = Array.from({ length: 101 }, (_, i) =>
    i === 100 ? STORAGE_REF.full_name : `sam/other-${i}`,
  );
  const client = createMockGitHubClient({
    repoMeta: { permissions: { pull: true, push: false, admin: false } },
    installationProbe: [
      {
        id: 1,
        contents: 'write',
        repos,
      },
    ],
  });
  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: client,
    githubUserClient: client,
  });
  assert.equal(result.status, 'initializable');
  assert.equal(result.capabilities.canRead, true);
  assert.equal(result.capabilities.canWrite, true);
});

test('validateStorage returns unrelated when root has other files', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'README.md': { content: '# hi', sha: 'sha-readme' },
    },
  });
  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: client,
  });
  assert.equal(result.status, 'unrelated');
});

test('validateStorage returns loadable with manifest summary', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });
  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: client,
  });
  assert.equal(result.status, 'loadable');
  assert.equal(result.manifestSummary.accountId, manifest().account.id);
});

test('validateStorage accepts legacy equalview.json manifests', async () => {
  const storageService = new StorageService();
  const legacyManifest = {
    ...manifest(),
    equalview: true,
  };
  delete legacyManifest.vizably;

  const client = createMockGitHubClient({
    files: {
      'equalview.json': {
        content: JSON.stringify(legacyManifest),
        sha: 'sha-legacy',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: client,
  });

  assert.equal(result.status, 'loadable');
  assert.equal(result.reason, 'migration_required');
  assert.equal(result.manifestSummary.accountId, legacyManifest.account.id);
});

test('validateStorage returns incompatible for newer schema', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': {
        content: JSON.stringify(manifest({ schemaVersion: 99 })),
        sha: 'sha-manifest',
      },
    },
  });
  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: client,
  });
  assert.equal(result.status, 'incompatible');
  assert.equal(result.reason, 'too_new');
});

test('validateStorage returns invalid for malformed manifest', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': { content: '{not json', sha: 'sha-manifest' },
    },
  });
  const result = await storageService.validateStorage('github', STORAGE_REF, {
    githubClient: client,
  });
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'malformed_manifest');
});

test('validateStorage stubs google provider until Phase 3', async () => {
  const storageService = new StorageService();
  const result = await storageService.validateStorage('google', { id: 'folder' }, {});
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'provider_not_available');
});

test('initStorage writes manifest and index skeleton', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient();
  const result = await storageService.initStorage(
    'github',
    STORAGE_REF,
    { id: '42', username: 'sam' },
    { githubClient: client },
  );

  assert.ok(client.files['vizably.json']);
  assert.ok(client.files['scans/index.json']);
  assert.equal(result.scanCount, 0);
  assert.equal(result.settings.autoDelete90d, true);
});

test('initStorage bootstraps a repo with no commits yet', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({ emptyRepo: true });
  const result = await storageService.initStorage(
    'github',
    STORAGE_REF,
    { id: '42', username: 'sam' },
    { githubClient: client },
  );

  assert.equal(client.refCreated, true);
  assert.ok(client.files['vizably.json']);
  assert.ok(client.files['scans/index.json']);
  assert.equal(result.scanCount, 0);
});

test('initStorage rejects when manifest already exists (race guard)', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
    },
  });

  await assert.rejects(
    () =>
      storageService.initStorage(
        'github',
        STORAGE_REF,
        { id: '42', username: 'sam' },
        { githubClient: client },
      ),
    /already contains a Vizably account|initialized by another session/,
  );
});

test('loadAccount migrates legacy equalview.json to vizably.json', async () => {
  const storageService = new StorageService();
  const legacyManifest = {
    ...manifest(),
    equalview: true,
  };
  delete legacyManifest.vizably;

  const client = createMockGitHubClient({
    files: {
      'equalview.json': {
        content: JSON.stringify(legacyManifest),
        sha: 'sha-legacy',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  const result = await storageService.loadAccount('github', STORAGE_REF, {
    githubClient: client,
  });

  assert.equal(result.accountId, legacyManifest.account.id);
  assert.equal(result.reason, 'migration_required');
  assert.ok(client.files['vizably.json'], 'writes vizably.json');
  const migrated = JSON.parse(client.files['vizably.json'].content);
  assert.equal(migrated.vizably, true);
  assert.equal(migrated.equalview, undefined);
  assert.equal(migrated.account.id, legacyManifest.account.id);
});

test('loadAccount reconciles index from scan files', async () => {
  const storageService = new StorageService();
  const scanPayload = {
    id: '22222222-2222-2222-2222-222222222222',
    schemaVersion: 1,
    url: 'https://codrlabs.com',
    scannedAt: '2026-06-30T18:03:10Z',
    result: {
      problems: { visualAccessibility: [], structureAndSemantics: [], multimedia: [] },
      whatsGood: [],
    },
  };
  const client = createMockGitHubClient({
    files: {
      'vizably.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
      'scans/22222222-2222-2222-2222-222222222222_codrlabs.com.json': {
        content: JSON.stringify(scanPayload),
        sha: 'sha-scan',
      },
    },
  });

  const result = await storageService.loadAccount('github', STORAGE_REF, {
    githubClient: client,
  });

  assert.equal(result.scanCount, 1);
  assert.equal(result.reason, 'repairable');
});

test('saveScanResults writes scan file, index, and manifest in one commit', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  const scanResult = {
    problems: {
      visualAccessibility: [{ id: 'p1', impact: 'serious', count: 2 }],
      structureAndSemantics: [],
      multimedia: [],
    },
    whatsGood: ['Headings'],
  };

  const saved = await storageService.saveScanResults(
    {
      storage: { ...STORAGE_REF, provider: 'github', branch: 'main' },
    },
    scanResult,
    'https://codrlabs.com',
    { githubClient: client },
  );

  assert.ok(saved.scanId);
  const scanFileKey = Object.keys(client.files).find((k) => k.startsWith('scans/') && k.includes('_codrlabs.com.json'));
  assert.ok(scanFileKey);
  assert.equal(saved.scanCount, 1);

  const updatedManifest = JSON.parse(client.files['vizably.json'].content);
  assert.equal(updatedManifest.summary.scanCount, 1);
});

test('saveScanResults rejects google storage until Phase 3', async () => {
  const storageService = new StorageService();
  await assert.rejects(
    () =>
      storageService.saveScanResults(
        { storage: { provider: 'google' } },
        { problems: {}, whatsGood: [] },
        'https://example.com',
        {},
      ),
    /not available until Phase 3/,
  );
});

test('_writeGitHubFiles retries when branch head moves during save', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    updateRefFailures: 1,
    files: {
      'vizably.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  const saved = await storageService.saveScanResults(
    {
      storage: { ...STORAGE_REF, provider: 'github', branch: 'main' },
    },
    {
      problems: { visualAccessibility: [], structureAndSemantics: [], multimedia: [] },
      whatsGood: [],
    },
    'https://codrlabs.com',
    { githubClient: client },
  );

  assert.ok(saved.scanId);
});

test('concurrent saveScanResults keeps both writers\' scans', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'equalview.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  const emptyResult = {
    problems: { visualAccessibility: [], structureAndSemantics: [], multimedia: [] },
    whatsGood: [],
  };
  const account = {
    storage: { ...STORAGE_REF, provider: 'github', branch: 'main' },
  };

  const [savedA, savedB] = await Promise.all([
    storageService.saveScanResults(account, emptyResult, 'https://a.example', {
      githubClient: client,
    }),
    storageService.saveScanResults(account, emptyResult, 'https://b.example', {
      githubClient: client,
    }),
  ]);

  assert.notEqual(savedA.scanId, savedB.scanId);
  const index = JSON.parse(client.files['scans/index.json'].content);
  assert.equal(index.scans.length, 2);
  const ids = new Set(index.scans.map((s) => s.id));
  assert.ok(ids.has(savedA.scanId));
  assert.ok(ids.has(savedB.scanId));

  const scanFiles = Object.keys(client.files).filter(
    (p) => p.startsWith('scans/') && !p.endsWith('index.json'),
  );
  assert.equal(scanFiles.length, 2);
});

test('saveScanResults reuses scan id when index conflicts after scan file write', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'equalview.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  // Force Contents API (sequential writes) so scan can succeed before index fails.
  client.rest.git.getRef = async () => {
    const err = new Error('Resource not accessible by integration');
    err.status = 403;
    throw err;
  };

  let indexAttempts = 0;
  const originalCreate = client.rest.repos.createOrUpdateFileContents.bind(
    client.rest.repos,
  );
  client.rest.repos.createOrUpdateFileContents = async (args) => {
    if (args.path === 'scans/index.json') {
      indexAttempts += 1;
      if (indexAttempts === 1) {
        const err = new Error('Reference update failed');
        err.status = 422;
        throw err;
      }
    }
    return originalCreate(args);
  };

  const saved = await storageService.saveScanResults(
    {
      storage: { ...STORAGE_REF, provider: 'github', branch: 'main' },
    },
    {
      problems: { visualAccessibility: [], structureAndSemantics: [], multimedia: [] },
      whatsGood: [],
    },
    'https://codrlabs.com',
    { githubClient: client },
  );

  assert.equal(indexAttempts, 2);
  assert.ok(saved.scanId);

  const scanFiles = Object.keys(client.files).filter(
    (p) => p.startsWith('scans/') && !p.endsWith('index.json'),
  );
  assert.equal(scanFiles.length, 1);
  assert.equal(scanFiles[0], `scans/${saved.scanId}_codrlabs.com.json`);

  const index = JSON.parse(client.files['scans/index.json'].content);
  assert.equal(index.scans.length, 1);
  assert.equal(index.scans[0].id, saved.scanId);
});

test('saveScanResults conflict retry merges against current scan truth', async () => {
  const storageService = new StorageService();
  const peerId = '11111111-2222-3333-4444-555555555555';
  const peerPath = `scans/${peerId}_peer.com.json`;
  const peerPayload = {
    id: peerId,
    schemaVersion: 1,
    url: 'https://peer.com',
    scannedAt: '2026-07-01T00:00:00.000Z',
    result: {
      problems: { visualAccessibility: [], structureAndSemantics: [], multimedia: [] },
      whatsGood: [],
    },
  };

  const client = createMockGitHubClient({
    files: {
      'equalview.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  let attempts = 0;
  const originalWrite = storageService._writeGitHubFiles.bind(storageService);
  storageService._writeGitHubFiles = async (...args) => {
    attempts += 1;
    if (attempts === 1) {
      client.files[peerPath] = {
        content: `${JSON.stringify(peerPayload, null, 2)}\n`,
        sha: 'sha-peer',
      };
      const err = new Error('Reference update failed');
      err.status = 422;
      throw err;
    }
    return originalWrite(...args);
  };

  const saved = await storageService.saveScanResults(
    {
      storage: { ...STORAGE_REF, provider: 'github', branch: 'main' },
    },
    {
      problems: { visualAccessibility: [], structureAndSemantics: [], multimedia: [] },
      whatsGood: [],
    },
    'https://codrlabs.com',
    { githubClient: client },
  );

  assert.equal(attempts, 2);
  assert.equal(saved.scanCount, 2);
  assert.ok(saved.scans.some((s) => s.id === peerId));
  assert.ok(saved.scans.some((s) => s.id === saved.scanId));
});

test('getScanById returns the immutable saved report', async () => {
  const storageService = new StorageService();
  const scanId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const scanPath = `scans/${scanId}_codrlabs.com.json`;
  const payload = {
    id: scanId,
    schemaVersion: 1,
    url: 'https://codrlabs.com',
    scannedAt: '2026-07-10T12:00:00.000Z',
    result: {
      problems: {
        visualAccessibility: [{ id: 'p1', impact: 'serious', count: 1 }],
        structureAndSemantics: [],
        multimedia: [],
      },
      whatsGood: ['Landmarks'],
    },
  };

  const client = createMockGitHubClient({
    files: {
      'equalview.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
      [scanPath]: {
        content: `${JSON.stringify(payload, null, 2)}\n`,
        sha: 'sha-scan',
      },
    },
  });

  const loaded = await storageService.getScanById(
    { storage: { ...STORAGE_REF, provider: 'github', branch: 'main' } },
    scanId,
    { githubClient: client },
  );

  assert.equal(loaded.id, scanId);
  assert.equal(loaded.url, 'https://codrlabs.com');
  assert.equal(loaded.result.whatsGood[0], 'Landmarks');
});

test('getScanById returns not found for unknown id', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'equalview.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  await assert.rejects(
    () =>
      storageService.getScanById(
        { storage: { ...STORAGE_REF, provider: 'github', branch: 'main' } },
        'missing-id',
        { githubClient: client },
      ),
    (err) => err.code === 'SCAN_NOT_FOUND' && err.status === 404,
  );
});

test('deleteScanById removes one scan file and leaves the others', async () => {
  const storageService = new StorageService();
  const keepId = 'keep-id';
  const dropId = 'drop-id';
  const account = {
    storage: { ...STORAGE_REF, provider: 'github', branch: 'main' },
  };
  const client = createMockGitHubClient({
    files: {
      'vizably.json': {
        content: JSON.stringify(
          manifest({ summary: { scanCount: 2, lastScanAt: '2026-07-11T12:00:00Z' } }),
        ),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({
          schemaVersion: 1,
          scans: [
            {
              id: dropId,
              url: 'https://drop.example',
              host: 'drop.example',
              scannedAt: '2026-07-11T12:00:00Z',
              file: `scans/${dropId}_drop.example.json`,
            },
            {
              id: keepId,
              url: 'https://keep.example',
              host: 'keep.example',
              scannedAt: '2026-07-10T12:00:00Z',
              file: `scans/${keepId}_keep.example.json`,
            },
          ],
        }),
        sha: 'sha-index',
      },
      [`scans/${dropId}_drop.example.json`]: {
        content: JSON.stringify({
          id: dropId,
          url: 'https://drop.example',
          scannedAt: '2026-07-11T12:00:00Z',
          result: { problems: {} },
        }),
        sha: 'sha-drop',
      },
      [`scans/${keepId}_keep.example.json`]: {
        content: JSON.stringify({
          id: keepId,
          url: 'https://keep.example',
          scannedAt: '2026-07-10T12:00:00Z',
          result: { problems: {} },
        }),
        sha: 'sha-keep',
      },
      'README.md': { content: '# keep\n', sha: 'sha-readme' },
    },
  });

  const result = await storageService.deleteScanById(account, dropId, {
    githubClient: client,
  });

  assert.equal(result.deletedId, dropId);
  assert.equal(result.scanCount, 1);
  assert.equal(result.scans.length, 1);
  assert.equal(result.scans[0].id, keepId);
  assert.equal(client.files[`scans/${dropId}_drop.example.json`], undefined);
  assert.ok(client.files[`scans/${keepId}_keep.example.json`]);
  assert.equal(client.files['README.md'].content, '# keep\n');

  const index = JSON.parse(client.files['scans/index.json'].content);
  assert.equal(index.scans.length, 1);
  assert.equal(index.scans[0].id, keepId);

  const updatedManifest = JSON.parse(client.files['vizably.json'].content);
  assert.equal(updatedManifest.summary.scanCount, 1);
});

test('deleteScanById returns not found for unknown id', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': {
        content: JSON.stringify(manifest()),
        sha: 'sha-manifest',
      },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });

  await assert.rejects(
    () =>
      storageService.deleteScanById(
        { storage: { ...STORAGE_REF, provider: 'github', branch: 'main' } },
        'missing-id',
        { githubClient: client },
      ),
    (err) => err.code === 'SCAN_NOT_FOUND' && err.status === 404,
  );
});

test('deleteScanById stubs google until Phase 3', async () => {
  const storageService = new StorageService();
  await assert.rejects(
    () =>
      storageService.deleteScanById(
        { storage: { provider: 'google', id: 'folder' } },
        'scan-1',
        { githubClient: {} },
      ),
    (err) => err.status === 501 && err.code === 'PROVIDER_NOT_AVAILABLE',
  );
});

test('discoverAccountStores returns the session store first', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': { content: JSON.stringify(manifest()), sha: 'sha-manifest' },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
  });
  const result = await storageService.discoverAccountStores(
    'github',
    { githubClient: client, githubUserClient: client },
    { sessionStorageRef: STORAGE_REF },
  );
  assert.equal(result.source, 'session');
  assert.equal(result.stores.length, 1);
  assert.equal(result.stores[0].storageRef.full_name, STORAGE_REF.full_name);
  assert.equal(result.stores[0].validation.status, 'loadable');
});

test('discoverAccountStores uses GET viz_scans before listing', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': { content: JSON.stringify(manifest()), sha: 'sha-manifest' },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
    listedRepos: [],
    repoGet: async ({ repo }) => {
      if (repo !== 'viz_scans') {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      return {
        data: {
          node_id: 'R_kgScans',
          name: 'viz_scans',
          full_name: 'sam/viz_scans',
          html_url: 'https://github.com/sam/viz_scans',
          default_branch: 'main',
          permissions: { pull: true, push: true, admin: false },
        },
      };
    },
  });
  const result = await storageService.discoverAccountStores('github', {
    githubClient: client,
    githubUserClient: client,
  });
  assert.equal(result.source, 'expected-name');
  assert.equal(result.stores.length, 1);
  assert.equal(result.stores[0].storageRef.full_name, 'sam/viz_scans');
});

test('discoverAccountStores lists repos when expected name is not a store', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': { content: JSON.stringify(manifest()), sha: 'sha-manifest' },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
    listedRepos: [
      {
        node_id: STORAGE_REF.id,
        full_name: STORAGE_REF.full_name,
        private: true,
        html_url: STORAGE_REF.html_url,
      },
    ],
    repoGet: async ({ repo }) => {
      if (repo === 'viz_scans') {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      return {
        data: {
          default_branch: 'main',
          permissions: { pull: true, push: true, admin: false },
          name: repo,
          full_name: `sam/${repo}`,
        },
      };
    },
  });
  const result = await storageService.discoverAccountStores('github', {
    githubClient: client,
    githubUserClient: client,
  });
  assert.equal(result.source, 'list');
  assert.equal(result.stores.length, 1);
  assert.equal(result.stores[0].storageRef.id, STORAGE_REF.id);
});

test('discoverAccountStores ignores listed repos that have no manifest', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {},
    listedRepos: [
      {
        node_id: STORAGE_REF.id,
        full_name: STORAGE_REF.full_name,
        private: true,
        html_url: STORAGE_REF.html_url,
      },
    ],
    repoGet: async ({ repo }) => {
      if (repo === 'viz_scans') {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      return {
        data: {
          default_branch: 'main',
          permissions: { pull: true, push: true, admin: false },
          name: repo,
          full_name: `sam/${repo}`,
        },
      };
    },
  });
  const result = await storageService.discoverAccountStores('github', {
    githubClient: client,
    githubUserClient: client,
  });
  assert.equal(result.source, 'list');
  assert.equal(result.stores.length, 0);
});

test('discoverAccountStores returns every listed store with a manifest', async () => {
  const storageService = new StorageService();
  const client = createMockGitHubClient({
    files: {
      'vizably.json': { content: JSON.stringify(manifest()), sha: 'sha-manifest' },
      'scans/index.json': {
        content: JSON.stringify({ schemaVersion: 1, scans: [] }),
        sha: 'sha-index',
      },
    },
    listedRepos: [
      {
        node_id: 'R_one',
        full_name: 'sam/vizably-scans',
        private: true,
        html_url: 'https://github.com/sam/vizably-scans',
      },
      {
        node_id: 'R_two',
        full_name: 'sam/viz_scans-2',
        private: true,
        html_url: 'https://github.com/sam/viz_scans-2',
      },
    ],
    repoGet: async ({ repo }) => {
      if (repo === 'viz_scans') {
        const err = new Error('Not Found');
        err.status = 404;
        throw err;
      }
      return {
        data: {
          default_branch: 'main',
          permissions: { pull: true, push: true, admin: false },
          name: repo,
          full_name: `sam/${repo}`,
        },
      };
    },
  });
  const result = await storageService.discoverAccountStores('github', {
    githubClient: client,
    githubUserClient: client,
  });
  assert.equal(result.source, 'list');
  assert.equal(result.stores.length, 2);
});

test('createNextVizablyGitHubRepository falls back to viz_scans-2 when taken', async () => {
  const storageService = new StorageService();
  const created = [];
  const client = createMockGitHubClient({
    installationProbe: [
      { id: 1, contents: 'write', repository_selection: 'all', repos: [] },
    ],
    createRepo: async ({ name, private: isPrivate }) => {
      created.push(name);
      if (name === 'viz_scans') {
        const err = new Error('Repository creation failed.');
        err.status = 422;
        err.response = {
          data: {
            message: 'Repository creation failed.',
            errors: [{ message: 'name already exists on this account' }],
          },
        };
        throw err;
      }
      return {
        data: {
          node_id: 'R_kg2',
          name,
          full_name: `sam/${name}`,
          private: isPrivate !== false,
          html_url: `https://github.com/sam/${name}`,
        },
      };
    },
  });
  const result = await storageService.createNextVizablyGitHubRepository({
    githubUserClient: client,
  });
  assert.deepEqual(created, ['viz_scans', 'viz_scans-2']);
  assert.equal(result.storageRef.name, 'viz_scans-2');
  assert.equal(result.needsInstall, false);
});
