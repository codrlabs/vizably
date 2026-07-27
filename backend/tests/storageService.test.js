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
      repos: {
        listForAuthenticatedUser: async () => ({
          data: [
            {
              node_id: STORAGE_REF.id,
              full_name: STORAGE_REF.full_name,
              private: true,
              html_url: STORAGE_REF.html_url,
            },
          ],
        }),
        get: async () => ({ data: repoMeta }),
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
              .filter((p) => p.startsWith('scans/') && !p.endsWith('index.json'))
              .map((p) => ({
                name: p.replace('scans/', ''),
                type: 'file',
                path: p,
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
      apps: installationProbe
        ? {
            listInstallationsForAuthenticatedUser: async () => ({
              data: {
                installations: installationProbe.map((entry) => ({
                  id: entry.id,
                  permissions: { contents: entry.contents },
                })),
              },
            }),
            listInstallationReposForAuthenticatedUser: async ({ installation_id }) => {
              const entry = installationProbe.find((item) => item.id === installation_id);
              return {
                data: {
                  repositories: (entry?.repos ?? []).map((full_name) => ({ full_name })),
                },
              };
            },
          }
        : undefined,
    },
  };
}

/**
 * Minimal Drive v3 mock: parentId → children with optional content/etag.
 * @param {{ folderId: string, files?: Record<string, Array<object>> }} initial
 */
function createMockDriveClient(initial = {}) {
  const rootId = initial.folderId || 'folder-1';
  /** @type {Record<string, Array<object>>} */
  const byParent = {
    [rootId]: [...(initial.files?.[rootId] || [])],
    ...(initial.files || {}),
  };
  /** @type {Record<string, object>} */
  const byId = {
    [rootId]: {
      id: rootId,
      name: initial.folderName || 'vizably-scans',
      mimeType: 'application/vnd.google-apps.folder',
      webViewLink: `https://drive.google.com/drive/folders/${rootId}`,
      capabilities: {
        canEdit: true,
        canAddChildren: true,
        canListChildren: true,
        canDownload: true,
      },
    },
  };

  for (const children of Object.values(byParent)) {
    for (const child of children) {
      byId[child.id] = { ...child, parents: undefined };
    }
  }

  let counter = 0;
  const nextId = (prefix) => {
    counter += 1;
    return `${prefix}-${counter}`;
  };

  const list = (parentId) => byParent[parentId] || [];
  const findByName = (parentId, name) =>
    list(parentId).find((f) => f.name === name) || null;

  const readStream = async (body) => {
    if (typeof body === 'string') return body;
    if (Buffer.isBuffer(body)) return body.toString('utf8');
    if (body && typeof body[Symbol.asyncIterator] === 'function') {
      let out = '';
      for await (const chunk of body) {
        out += chunk;
      }
      return out;
    }
    if (body && typeof body.read === 'function') {
      const chunks = [];
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    }
    return String(body ?? '');
  };

  return {
    list,
    findByName,
    files: {
      get: async ({ fileId, alt, fields }, opts) => {
        const file = byId[fileId];
        if (!file) {
          const err = new Error('Not Found');
          err.code = 404;
          err.status = 404;
          throw err;
        }
        if (alt === 'media') {
          return { data: file.content ?? '' };
        }
        // Drive v3: etag is HTTP-header only (fields=etag → 400).
        if (!file.etag) {
          file.etag = `"etag-${fileId}"`;
        }
        const data = { id: file.id, name: file.name, mimeType: file.mimeType };
        if (fields?.includes('capabilities') && file.capabilities) {
          data.capabilities = file.capabilities;
        }
        if (fields?.includes('webViewLink') && file.webViewLink) {
          data.webViewLink = file.webViewLink;
        }
        return { data, headers: { etag: file.etag } };
      },
      list: async ({ q }) => {
        const match = /'([^']+)' in parents/.exec(q || '');
        const parentId = match?.[1];
        return {
          data: {
            files: list(parentId).map(({ content: _c, ...meta }) => meta),
          },
        };
      },
      create: async ({ requestBody, media }) => {
        const id = nextId('file');
        const parentId = requestBody.parents?.[0] || rootId;
        const content = media?.body ? await readStream(media.body) : '';
        const entry = {
          id,
          name: requestBody.name,
          mimeType: requestBody.mimeType || media?.mimeType || 'application/json',
          content,
          etag: `"etag-${id}"`,
          webViewLink: `https://drive.google.com/file/d/${id}`,
        };
        byId[id] = entry;
        if (!byParent[parentId]) byParent[parentId] = [];
        byParent[parentId].push(entry);
        if (entry.mimeType === 'application/vnd.google-apps.folder') {
          byParent[id] = byParent[id] || [];
        }
        return {
          data: { id: entry.id, name: entry.name },
          headers: { etag: entry.etag },
        };
      },
      update: async ({ fileId, media }, options) => {
        const file = byId[fileId];
        if (!file) {
          const err = new Error('Not Found');
          err.code = 404;
          throw err;
        }
        const ifMatch = options?.headers?.['If-Match'];
        if (ifMatch && file.etag && ifMatch !== file.etag) {
          const err = new Error('Precondition Failed');
          err.code = 412;
          err.status = 412;
          throw err;
        }
        if (media?.body) {
          file.content = await readStream(media.body);
        }
        file.etag = `"etag-${fileId}-${Date.now()}"`;
        return {
          data: { id: file.id, name: file.name },
          headers: { etag: file.etag },
        };
      },
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

test('validateStorage returns initializable for empty Drive folder', async () => {
  const storageService = new StorageService();
  const drive = createMockDriveClient({ folderId: 'folder-1' });
  const result = await storageService.validateStorage(
    'google',
    { id: 'folder-1', name: 'vizably-scans' },
    { driveClient: drive },
  );
  assert.equal(result.status, 'initializable');
  assert.equal(result.capabilities.canWrite, true);
});

test('validateStorage returns loadable for Drive folder with vizably.json', async () => {
  const storageService = new StorageService();
  const drive = createMockDriveClient({
    folderId: 'folder-1',
    files: {
      'folder-1': [
        {
          id: 'manifest-1',
          name: 'vizably.json',
          mimeType: 'application/json',
          content: JSON.stringify(manifest({
            storage: {
              provider: 'google',
              providerStorageId: 'folder-1',
              ownerId: '42',
              ownerDisplay: 'sam',
              folderName: 'vizably-scans',
            },
          })),
          etag: '"etag-manifest"',
        },
      ],
    },
  });

  const result = await storageService.validateStorage(
    'google',
    { id: 'folder-1' },
    { driveClient: drive },
  );
  assert.equal(result.status, 'loadable');
  assert.equal(result.manifestSummary.accountId, manifest().account.id);
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

test('initStorage + saveScanResults write Drive store with ETag updates', async () => {
  const storageService = new StorageService();
  const drive = createMockDriveClient({ folderId: 'folder-1' });

  const inited = await storageService.initStorage(
    'google',
    { id: 'folder-1', name: 'vizably-scans' },
    { id: '42', username: 'sam' },
    { driveClient: drive },
  );

  assert.equal(inited.provider, 'google');
  assert.equal(inited.storageRef.id, 'folder-1');
  assert.ok(drive.findByName('folder-1', 'vizably.json'));

  const saved = await storageService.saveScanResults(
    {
      storage: { provider: 'google', id: 'folder-1' },
    },
    {
      problems: { visualAccessibility: [], structureAndSemantics: [], multimedia: [] },
      whatsGood: [],
    },
    'https://codrlabs.com',
    { driveClient: drive },
  );

  assert.ok(saved.scanId);
  assert.equal(saved.scanCount, 1);
  const scansFolder = drive.findByName('folder-1', 'scans');
  assert.ok(scansFolder);
  assert.ok(
    drive.list('folder-1').some((f) => f.name === 'scans') ||
      drive.list(scansFolder.id).some((f) => f.name.endsWith('_codrlabs.com.json')),
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
