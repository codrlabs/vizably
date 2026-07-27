/**
 * StorageService — provider-neutral portable-account storage.
 *
 * Speaks the on-disk contract in docs/guides/auth_storage_guide/accountStorageContract.md.
 * Accepts pre-built authenticated clients (no AuthService dependency).
 * GitHub + Google Drive adapters (Drive uses generation/ETag preconditions).
 */
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');

const MANIFEST_PATH = 'vizably.json';
/** Pre-rename store root — still loadable; rewritten to `MANIFEST_PATH` on load. */
const LEGACY_MANIFEST_PATH = 'equalview.json';
const SCANS_DIR = 'scans';
const INDEX_PATH = `${SCANS_DIR}/index.json`;
const SUPPORTED_SCHEMA_VERSION = 1;
const DRIVE_FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_JSON_MIME = 'application/json';

/**
 * @typedef {'loadable' | 'initializable' | 'unrelated' | 'incompatible' | 'invalid'} FitCheckStatus
 */

/**
 * @typedef {object} StorageCapabilities
 * @property {boolean} canRead
 * @property {boolean} canWrite
 * @property {boolean} canCreate
 */

/**
 * @typedef {object} StorageClients
 * @property {import('@octokit/rest').Octokit} [githubClient] repo IO (installation token when available)
 * @property {import('@octokit/rest').Octokit} [githubUserClient] user OAuth token for capability probes
 * @property {import('googleapis').drive_v3.Drive} [driveClient]
 */

class StorageService {
  /**
   * @param {import('@octokit/rest').Octokit} githubClient
   * @returns {Promise<Array<{ id: string, full_name: string, private: boolean, html_url: string }>>}
   */
  async listGitHubRepos(githubClient) {
    const { data } = await githubClient.rest.repos.listForAuthenticatedUser({
      visibility: 'all',
      affiliation: 'owner,collaborator,organization_member',
      per_page: 100,
      sort: 'updated',
    });

    return data.map((repo) => ({
      id: repo.node_id,
      full_name: repo.full_name,
      private: repo.private,
      html_url: repo.html_url,
    }));
  }

  /**
   * @param {'github' | 'google'} provider
   * @param {object} storageRef
   * @param {StorageClients} clients
   */
  async validateStorage(provider, storageRef, clients) {
    if (provider === 'google') {
      if (!clients.driveClient) {
        return this._invalidResult('missing_drive_client');
      }
      return this._validateDriveStorage(storageRef, clients.driveClient);
    }
    if (provider !== 'github') {
      return this._invalidResult('unsupported_provider');
    }
    if (!clients.githubClient) {
      return this._invalidResult('missing_github_client');
    }

    return this._validateGitHubStorage(
      storageRef,
      clients.githubClient,
      clients.githubUserClient ?? clients.githubClient,
    );
  }

  /**
   * @param {'github' | 'google'} provider
   * @param {object} storageRef
   * @param {StorageClients} clients
   */
  async loadAccount(provider, storageRef, clients) {
    if (provider === 'google') {
      if (!clients.driveClient) {
        throw new Error('Google Drive client is required to load account storage');
      }
      return this._loadDriveAccount(storageRef, clients.driveClient);
    }
    if (provider !== 'github' || !clients.githubClient) {
      throw new Error('GitHub client is required to load account storage');
    }

    const { owner, repo } = this._parseGitHubRef(storageRef);
    const octokit = clients.githubClient;
    const branch = await this._resolveGitHubBranch(octokit, owner, repo, storageRef.branch);

    const manifestFile = await this._readAccountManifest(octokit, owner, repo, branch);
    if (!manifestFile) {
      throw new Error('Account manifest not found');
    }

    const parsed = this._parseJson(manifestFile.content, 'manifest');
    const manifestCheck = this._assessManifest(parsed);
    if (manifestCheck.status === 'incompatible' || manifestCheck.status === 'invalid') {
      throw new Error(manifestCheck.reason || 'Invalid account manifest');
    }

    const { manifest, migrated: brandMigrated } = this._normalizeManifestBrand(parsed);
    const { index, repaired, scanFiles } = await this._reconcileGitHubIndex(
      octokit,
      owner,
      repo,
      branch,
    );

    let reason = manifestCheck.reason ?? null;
    const needsManifestWrite = repaired || brandMigrated || manifestFile.legacy;
    if (repaired) {
      reason = 'repairable';
    } else if (brandMigrated || manifestFile.legacy) {
      reason = 'migration_required';
    }

    if (needsManifestWrite) {
      const files = [];
      if (repaired) {
        files.push({
          path: INDEX_PATH,
          content: JSON.stringify(index, null, 2) + '\n',
        });
      }
      files.push({
        path: MANIFEST_PATH,
        content: JSON.stringify(this._updateManifestSummary(manifest, index), null, 2) + '\n',
        // Only reuse sha when overwriting the current path; legacy → new file.
        ...(manifestFile.path === MANIFEST_PATH ? { sha: manifestFile.sha } : {}),
      });
      await this._writeGitHubFiles(
        octokit,
        owner,
        repo,
        branch,
        files,
        repaired ? 'Reconcile scan index cache' : 'Migrate account manifest to vizably.json',
      );
    }

    return {
      provider: 'github',
      storageRef: this._normalizeGitHubStorageRef(storageRef, branch),
      accountId: manifest.account.id,
      settings: manifest.settings ?? { autoDelete90d: true },
      scanCount: index.scans.length,
      manifest,
      index,
      scanFiles,
      reason,
    };
  }

  /**
   * @param {'github' | 'google'} provider
   * @param {object} storageRef
   * @param {object} owner signed-in user identity
   * @param {StorageClients} clients
   */
  async initStorage(provider, storageRef, owner, clients) {
    if (provider === 'google') {
      if (!clients.driveClient) {
        throw new Error('Google Drive client is required to initialize account storage');
      }
      return this._initDriveStorage(storageRef, owner, clients.driveClient);
    }
    if (provider !== 'github' || !clients.githubClient) {
      throw new Error('GitHub client is required to initialize account storage');
    }

    const validation = await this.validateStorage(provider, storageRef, clients);
    if (validation.status === 'loadable') {
      throw new Error('Storage already contains a Vizably account');
    }
    if (validation.status === 'incompatible' || validation.status === 'invalid') {
      throw new Error(validation.reason || `Cannot initialize storage (${validation.status})`);
    }
    if (!validation.capabilities.canWrite) {
      throw new Error('Storage is not writable');
    }

    const { owner: repoOwner, repo } = this._parseGitHubRef(storageRef);
    const octokit = clients.githubClient;
    const branch = await this._resolveGitHubBranch(octokit, repoOwner, repo, storageRef.branch);

    const existingManifest = await this._readAccountManifest(
      octokit,
      repoOwner,
      repo,
      branch,
    );
    if (existingManifest) {
      throw new Error('Storage was initialized by another session');
    }

    const now = new Date().toISOString();
    const manifest = {
      vizably: true,
      kind: 'account-store',
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      minReaderSchemaVersion: SUPPORTED_SCHEMA_VERSION,
      account: {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      },
      storage: {
        provider: 'github',
        providerStorageId: storageRef.id,
        ownerId: String(owner.id),
        ownerDisplay: owner.username || owner.displayName || owner.email || 'unknown',
        repo: storageRef.full_name,
        branch,
      },
      settings: {
        autoDelete90d: true,
      },
      summary: {
        scanCount: 0,
        lastScanAt: null,
      },
      features: [],
    };

    const index = {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      scans: [],
    };

    await this._writeGitHubFiles(
      octokit,
      repoOwner,
      repo,
      branch,
      [
        {
          path: MANIFEST_PATH,
          content: JSON.stringify(manifest, null, 2) + '\n',
        },
        {
          path: INDEX_PATH,
          content: JSON.stringify(index, null, 2) + '\n',
        },
      ],
      'Initialize Vizably account store',
    );

    return {
      provider: 'github',
      storageRef: this._normalizeGitHubStorageRef(storageRef, branch),
      accountId: manifest.account.id,
      settings: manifest.settings,
      scanCount: 0,
      manifest,
      index,
    };
  }

  /**
   * @param {object} account loaded account context (manifest + storage binding)
   * @param {import('../../shared/types.js').ScanResult} scanResult
   * @param {string} url scanned URL
   * @param {StorageClients} clients
   */
  async saveScanResults(account, scanResult, url, clients) {
    const provider = account?.storage?.provider ?? account?.storageRef?.provider;
    if (provider === 'google') {
      if (!clients.driveClient) {
        throw new Error('Google Drive client is required to save scan results');
      }
      return this._saveDriveScanResults(account, scanResult, url, clients.driveClient);
    }
    if (!clients.githubClient) {
      throw new Error('GitHub client is required to save scan results');
    }

    // Mint id + immutable payload once. Retries must reuse them — otherwise a
    // partial write (scan file ok, index conflict) duplicates the same scan.
    const prepared = this._prepareScanWrite(scanResult, url);

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this._saveScanResultsOnce(account, prepared, clients);
      } catch (err) {
        const canRetry = this._isRefConflict(err) && attempt < maxAttempts - 1;
        if (!canRetry) {
          throw err;
        }
        // Retry from scratch: re-reconcile against current scan-file truth so a
        // peer writer's index entries are not overwritten by a stale snapshot.
      }
    }

    throw new Error('GitHub write failed after retries');
  }

  /**
   * Build the immutable scan file contents once per saveScanResults call.
   * @private
   */
  _prepareScanWrite(scanResult, url) {
    const scanId = randomUUID();
    const host = this._hostFromUrl(url);
    const scannedAt = new Date().toISOString();
    const scanPath = `${SCANS_DIR}/${scanId}_${host}.json`;
    const scanPayload = {
      id: scanId,
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      url,
      scannedAt,
      result: scanResult,
    };
    const scanContent = JSON.stringify(scanPayload, null, 2) + '\n';
    const { issues, topSeverity } = this._summarizeScanResult(scanResult);

    return {
      scanId,
      host,
      url,
      scannedAt,
      scanPath,
      scanContent,
      scanSize: Buffer.byteLength(scanContent, 'utf8'),
      scanSha256: crypto.createHash('sha256').update(scanContent).digest('hex'),
      issues,
      topSeverity,
    };
  }

  /**
   * Load one immutable saved scan by id from the attached storage.
   * @param {object} account session user (with storage binding)
   * @param {string} scanId
   * @param {StorageClients} clients
   */
  async getScanById(account, scanId, clients) {
    const provider = account?.storage?.provider ?? account?.storageRef?.provider;
    if (provider === 'google') {
      if (!clients.driveClient) {
        throw new Error('Google Drive client is required to load a saved scan');
      }
      return this._getDriveScanById(account, scanId, clients.driveClient);
    }
    if (!clients.githubClient) {
      throw new Error('GitHub client is required to load a saved scan');
    }
    if (!scanId || typeof scanId !== 'string') {
      const err = new Error('Scan id is required');
      err.status = 400;
      err.code = 'SCAN_ID_REQUIRED';
      throw err;
    }

    const storageRef = account.storageRef ?? account.storage;
    const { owner, repo } = this._parseGitHubRef(storageRef);
    const octokit = clients.githubClient;
    const branch = await this._resolveGitHubBranch(octokit, owner, repo, storageRef.branch);

    const scanEntries = await this._listGitHubDirectory(octokit, owner, repo, SCANS_DIR, branch);
    const match = scanEntries.find(
      (entry) =>
        entry.type === 'file' &&
        entry.name.startsWith(`${scanId}_`) &&
        entry.name.endsWith('.json'),
    );

    if (!match) {
      const err = new Error('Scan not found');
      err.status = 404;
      err.code = 'SCAN_NOT_FOUND';
      throw err;
    }

    const fileData = await this._readGitHubFile(
      octokit,
      owner,
      repo,
      `${SCANS_DIR}/${match.name}`,
      branch,
    );
    if (!fileData) {
      const err = new Error('Scan not found');
      err.status = 404;
      err.code = 'SCAN_NOT_FOUND';
      throw err;
    }

    let payload;
    try {
      payload = this._parseJson(fileData.content, 'scan');
    } catch {
      const err = new Error('Scan file is malformed');
      err.status = 500;
      err.code = 'SCAN_MALFORMED';
      throw err;
    }

    if (payload.id !== scanId || !payload.result || !payload.url) {
      const err = new Error('Scan not found');
      err.status = 404;
      err.code = 'SCAN_NOT_FOUND';
      throw err;
    }

    return {
      id: payload.id,
      url: payload.url,
      scannedAt: payload.scannedAt ?? null,
      result: payload.result,
    };
  }

  /**
   * One save attempt: reconcile from scan-file truth, append prepared scan, write.
   * @param {object} account
   * @param {object} prepared from `_prepareScanWrite`
   * @param {StorageClients} clients
   * @private
   */
  async _saveScanResultsOnce(account, prepared, clients) {
    const {
      scanId,
      host,
      url,
      scannedAt,
      scanPath,
      scanContent,
      scanSize,
      scanSha256,
      issues,
      topSeverity,
    } = prepared;

    const storageRef = account.storageRef ?? account.storage;
    const { owner, repo } = this._parseGitHubRef(storageRef);
    const octokit = clients.githubClient;
    const branch = await this._resolveGitHubBranch(octokit, owner, repo, storageRef.branch);

    const manifestFile = await this._readAccountManifest(octokit, owner, repo, branch);
    if (!manifestFile) {
      throw new Error('Account manifest not found');
    }

    const { manifest } = this._normalizeManifestBrand(
      this._parseJson(manifestFile.content, 'manifest'),
    );
    const { index } = await this._reconcileGitHubIndex(octokit, owner, repo, branch);

    // Drop a stale index row if a previous partial write left this id's file
    // without a successful index update (immutable file may already exist).
    index.scans = index.scans.filter((entry) => entry.id !== scanId);
    index.scans.unshift({
      id: scanId,
      url,
      host,
      scannedAt,
      score: this._scoreFromIssues(issues),
      issues,
      topSeverity,
      file: scanPath,
      size: scanSize,
      sha256: scanSha256,
    });

    const updatedManifest = this._updateManifestSummary(manifest, index, scannedAt);
    updatedManifest.account.updatedAt = scannedAt;

    const indexFile = await this._readGitHubFile(octokit, owner, repo, INDEX_PATH, branch);

    await this._writeGitHubFiles(
      octokit,
      owner,
      repo,
      branch,
      [
        { path: scanPath, content: scanContent },
        {
          path: INDEX_PATH,
          content: JSON.stringify(index, null, 2) + '\n',
          sha: indexFile?.sha,
        },
        {
          path: MANIFEST_PATH,
          content: JSON.stringify(updatedManifest, null, 2) + '\n',
          ...(manifestFile.path === MANIFEST_PATH ? { sha: manifestFile.sha } : {}),
        },
      ],
      `Save accessibility scan for ${host}`,
    );

    return {
      scanId,
      path: scanPath,
      scanCount: index.scans.length,
      scans: index.scans,
    };
  }

  /** @private */
  _invalidResult(reason) {
    return {
      status: 'invalid',
      reason,
      capabilities: { canRead: false, canWrite: false, canCreate: false },
    };
  }

  /** @private */
  async _validateGitHubStorage(storageRef, octokit, probeOctokit = octokit) {
    const { owner, repo } = this._parseGitHubRef(storageRef);
    const branch = await this._resolveGitHubBranch(octokit, owner, repo, storageRef.branch);

    let capabilities;
    try {
      capabilities = await this._probeGitHubCapabilities(probeOctokit, owner, repo);
    } catch (err) {
      if (err.status === 404) {
        return this._invalidResult('not_found');
      }
      if (err.status === 403) {
        return {
          status: 'invalid',
          reason: 'access_denied',
          capabilities: { canRead: false, canWrite: false, canCreate: false },
        };
      }
      throw err;
    }

    const manifestFile = await this._readAccountManifest(octokit, owner, repo, branch);
    if (!manifestFile) {
      const rootEntries = await this._listGitHubDirectory(octokit, owner, repo, '', branch);
      const status = rootEntries.length === 0 ? 'initializable' : 'unrelated';
      return {
        status,
        reason: null,
        capabilities,
      };
    }

    let manifest;
    try {
      manifest = this._parseJson(manifestFile.content, 'manifest');
    } catch {
      return {
        status: 'invalid',
        reason: 'malformed_manifest',
        capabilities,
      };
    }

    const manifestCheck = this._assessManifest(manifest);
    if (manifestCheck.status !== 'loadable') {
      return {
        status: manifestCheck.status,
        reason: manifestCheck.reason,
        capabilities,
      };
    }

    const { manifest: normalized } = this._normalizeManifestBrand(manifest);
    const { index, repaired } = await this._reconcileGitHubIndex(
      octokit,
      owner,
      repo,
      branch,
    );

    let reason = repaired ? 'repairable' : manifestCheck.reason;
    if (!repaired && (manifestFile.legacy || manifest.equalview === true)) {
      reason = 'migration_required';
    }

    return {
      status: 'loadable',
      reason,
      capabilities,
      manifestSummary: {
        accountId: normalized.account.id,
        schemaVersion: normalized.schemaVersion,
        scanCount: index.scans.length,
        updatedAt: normalized.account.updatedAt,
      },
    };
  }

  /**
   * Prefer `vizably.json`; fall back to pre-rename `equalview.json`.
   * @private
   */
  async _readAccountManifest(octokit, owner, repo, branch) {
    const current = await this._readGitHubFile(octokit, owner, repo, MANIFEST_PATH, branch);
    if (current) {
      return { ...current, path: MANIFEST_PATH, legacy: false };
    }
    const legacy = await this._readGitHubFile(
      octokit,
      owner,
      repo,
      LEGACY_MANIFEST_PATH,
      branch,
    );
    if (legacy) {
      return { ...legacy, path: LEGACY_MANIFEST_PATH, legacy: true };
    }
    return null;
  }

  /**
   * Accept `equalview: true` stores; normalize to `vizably: true` for writers.
   * @private
   */
  _normalizeManifestBrand(manifest) {
    if (manifest?.vizably === true && manifest.equalview == null) {
      return { manifest, migrated: false };
    }
    if (manifest?.vizably === true || manifest?.equalview === true) {
      const next = { ...manifest, vizably: true };
      delete next.equalview;
      return { manifest: next, migrated: manifest.equalview === true || manifest.vizably !== true };
    }
    return { manifest, migrated: false };
  }

  /** @private */
  _assessManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      return { status: 'invalid', reason: 'malformed_manifest' };
    }
    const isAccountStore =
      (manifest.vizably === true || manifest.equalview === true) &&
      manifest.kind === 'account-store';
    if (!isAccountStore) {
      return { status: 'unrelated', reason: null };
    }
    if (
      typeof manifest.schemaVersion !== 'number' ||
      !manifest.account?.id ||
      !manifest.storage?.providerStorageId
    ) {
      return { status: 'invalid', reason: 'malformed_manifest' };
    }
    if (manifest.schemaVersion > SUPPORTED_SCHEMA_VERSION) {
      return { status: 'incompatible', reason: 'too_new' };
    }
    if (manifest.schemaVersion < SUPPORTED_SCHEMA_VERSION) {
      return { status: 'loadable', reason: 'migration_required' };
    }
    return { status: 'loadable', reason: null };
  }

  /** @private */
  async _probeGitHubCapabilities(octokit, owner, repo) {
    const fullName = `${owner}/${repo}`;
    let resolvedViaInstallations = false;
    let canRead = false;
    let canWrite = false;

    try {
      const { data } = await octokit.rest.apps.listInstallationsForAuthenticatedUser({
        per_page: 100,
      });

      for (const installation of data.installations ?? []) {
        const contents = installation.permissions?.contents;
        if (!contents || contents === 'none') {
          continue;
        }

        const { data: reposData } =
          await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
            installation_id: installation.id,
            per_page: 100,
          });

        const included = reposData.repositories?.some((r) => r.full_name === fullName);
        if (!included) {
          continue;
        }

        resolvedViaInstallations = true;
        if (contents === 'read' || contents === 'write') {
          canRead = true;
        }
        if (contents === 'write') {
          canWrite = true;
        }
      }
    } catch {
      // Classic OAuth tokens or older mocks — fall back to repos.get below.
    }

    if (!resolvedViaInstallations) {
      const { data } = await octokit.rest.repos.get({ owner, repo });
      const permissions = data.permissions ?? {};
      canRead = Boolean(permissions.pull || permissions.push || permissions.admin);
      canWrite = Boolean(permissions.push || permissions.admin);
    }

    return {
      canRead,
      canWrite,
      canCreate: canWrite,
    };
  }

  /**
   * Turn GitHub App permission failures into actionable setup guidance.
   * @param {unknown} err
   * @private
   */
  _formatGitHubStorageError(err) {
    const message = err?.response?.data?.message ?? err?.message ?? '';
    if (err?.status === 403 && /not accessible by integration/i.test(message)) {
      return (
        'GitHub App cannot write to this repository. Add GITHUB_APP_ID and ' +
        'GITHUB_APP_PRIVATE_KEY to backend/.env, set Repository permissions → Contents ' +
        'to "Read and write", then open https://github.com/settings/installations, ' +
        'configure your Vizably app, accept any permission upgrade, and ensure this ' +
        'repo is selected. Sign out and sign in again.'
      );
    }
    return err?.message || 'GitHub storage operation failed';
  }

  /** @private */
  async _resolveGitHubBranch(octokit, owner, repo, branch) {
    if (branch && branch !== 'main') {
      return branch;
    }
    const { data } = await octokit.rest.repos.get({ owner, repo });
    return data.default_branch || branch || 'main';
  }

  /** @private */
  _parseGitHubRef(storageRef) {
    const fullName = storageRef.full_name || storageRef.repo;
    if (!fullName || !fullName.includes('/')) {
      throw new Error('GitHub storageRef requires full_name (owner/repo)');
    }
    const [owner, repo] = fullName.split('/');
    return {
      owner,
      repo,
      branch: storageRef.branch || 'main',
      nodeId: storageRef.id,
    };
  }

  /** @private */
  _normalizeGitHubStorageRef(storageRef, branch) {
    return {
      type: 'github',
      id: storageRef.id,
      full_name: storageRef.full_name,
      html_url: storageRef.html_url,
      branch,
    };
  }

  /** @private */
  async _readGitHubFile(octokit, owner, repo, path, branch) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      if (Array.isArray(data) || data.type !== 'file') {
        return null;
      }
      const content = Buffer.from(data.content, data.encoding || 'base64').toString('utf8');
      return { content, sha: data.sha };
    } catch (err) {
      if (err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /** @private */
  async _listGitHubDirectory(octokit, owner, repo, path, branch) {
    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path,
        ref: branch,
      });
      if (!Array.isArray(data)) {
        return [];
      }
      return data;
    } catch (err) {
      if (err.status === 404) {
        return [];
      }
      throw err;
    }
  }

  /** @private */
  _parseJson(raw, label) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error(`Failed to parse ${label} JSON`);
    }
  }

  /** @private */
  async _reconcileGitHubIndex(octokit, owner, repo, branch) {
    const scanEntries = await this._listGitHubDirectory(octokit, owner, repo, SCANS_DIR, branch);
    const scanFiles = scanEntries.filter(
      (entry) =>
        entry.type === 'file' &&
        entry.name.endsWith('.json') &&
        entry.name !== 'index.json',
    );

    /** @type {Array<object>} */
    const rebuiltScans = [];

    for (const file of scanFiles) {
      const fileData = await this._readGitHubFile(
        octokit,
        owner,
        repo,
        `${SCANS_DIR}/${file.name}`,
        branch,
      );
      if (!fileData) {
        continue;
      }

      try {
        const payload = JSON.parse(fileData.content);
        if (!payload.id || !payload.url || !payload.result) {
          continue;
        }
        const host = this._hostFromUrl(payload.url);
        const content = fileData.content;
        const size = Buffer.byteLength(content, 'utf8');
        const { issues, topSeverity } = this._summarizeScanResult(payload.result);
        rebuiltScans.push({
          id: payload.id,
          url: payload.url,
          host,
          scannedAt: payload.scannedAt || new Date().toISOString(),
          score: this._scoreFromIssues(issues),
          issues,
          topSeverity,
          file: `${SCANS_DIR}/${file.name}`,
          size,
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
        });
      } catch {
        // Skip corrupt scan files during reconcile.
      }
    }

    rebuiltScans.sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));

    const index = {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      scans: rebuiltScans,
    };

    const existingIndexFile = await this._readGitHubFile(octokit, owner, repo, INDEX_PATH, branch);
    let repaired = true;
    if (existingIndexFile) {
      try {
        const existingIndex = JSON.parse(existingIndexFile.content);
        repaired = !this._indexesEqual(existingIndex, index);
      } catch {
        repaired = true;
      }
    }

    return { index, repaired, scanFiles };
  }

  /** @private */
  _indexesEqual(existingIndex, rebuiltIndex) {
    if (!Array.isArray(existingIndex?.scans)) {
      return false;
    }
    if (existingIndex.scans.length !== rebuiltIndex.scans.length) {
      return false;
    }
    for (let i = 0; i < rebuiltIndex.scans.length; i += 1) {
      const a = existingIndex.scans[i];
      const b = rebuiltIndex.scans[i];
      if (a.id !== b.id || a.file !== b.file || a.scannedAt !== b.scannedAt) {
        return false;
      }
    }
    return true;
  }

  /** @private */
  _updateManifestSummary(manifest, index, lastScanAt) {
    const updated = structuredClone(manifest);
    updated.summary = {
      scanCount: index.scans.length,
      lastScanAt: lastScanAt ?? index.scans[0]?.scannedAt ?? updated.summary?.lastScanAt ?? null,
    };
    return updated;
  }

  /** @private */
  _hostFromUrl(url) {
    const parsed = new URL(url);
    return parsed.hostname.replace(/[^a-zA-Z0-9.-]/g, '_');
  }

  /** @private */
  _summarizeScanResult(scanResult) {
    let issues = 0;
    /** @type {string | null} */
    let topSeverity = null;
    const rank = { critical: 4, serious: 3, moderate: 2, minor: 1 };

    for (const bucket of Object.values(scanResult?.problems ?? {})) {
      if (!Array.isArray(bucket)) {
        continue;
      }
      for (const problem of bucket) {
        issues += problem.count ?? 1;
        if (problem.impact && (!topSeverity || rank[problem.impact] > rank[topSeverity])) {
          topSeverity = problem.impact;
        }
      }
    }

    return { issues, topSeverity };
  }

  /** @private */
  _scoreFromIssues(issues) {
    return Math.max(0, 100 - issues * 4);
  }

  /**
   * Prefer a single Git commit (atomic multi-file write). Fall back to the
   * Contents API when the Git Database API is unavailable. Conflicts bubble up
   * so callers (e.g. saveScanResults) can re-reconcile against scan truth —
   * never rewrite caches with a refreshed sha and stale content.
   * @private
   */
  async _writeGitHubFiles(octokit, owner, repo, branch, files, message) {
    try {
      return await this._writeGitHubFilesViaGit(
        octokit,
        owner,
        repo,
        branch,
        files,
        message,
      );
    } catch (err) {
      if (!this._shouldFallbackToContentsApi(err)) {
        throw Object.assign(new Error(this._formatGitHubStorageError(err)), {
          status: err?.status,
          cause: err,
        });
      }
    }

    try {
      return await this._writeGitHubFilesViaContents(
        octokit,
        owner,
        repo,
        branch,
        files,
        message,
      );
    } catch (err) {
      throw Object.assign(new Error(this._formatGitHubStorageError(err)), {
        status: err?.status,
        cause: err,
      });
    }
  }

  /** @private */
  _isRefConflict(err) {
    return err?.status === 409 || err?.status === 422;
  }

  /** @private */
  _shouldFallbackToContentsApi(err) {
    const message = err?.response?.data?.message ?? err?.message ?? '';
    // Brand-new repos have no refs yet — Contents API can create the first commit.
    if (err?.status === 409 && /empty/i.test(message)) {
      return true;
    }
    if (this._isRefConflict(err)) {
      return false;
    }
    return (
      err?.status === 403 ||
      /not accessible by integration/i.test(message) ||
      /Resource not accessible/i.test(message)
    );
  }

  /**
   * Atomic multi-file write via the Git Database API.
   * @private
   */
  async _writeGitHubFilesViaGit(octokit, owner, repo, branch, files, message) {
    const { data: refData } = await octokit.rest.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const baseCommitSha = refData.object.sha;
    const { data: baseCommit } = await octokit.rest.git.getCommit({
      owner,
      repo,
      commit_sha: baseCommitSha,
    });

    const treeEntries = await Promise.all(
      files.map(async (file) => {
        const { data: blob } = await octokit.rest.git.createBlob({
          owner,
          repo,
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          encoding: 'base64',
        });
        return {
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blob.sha,
        };
      }),
    );

    const { data: tree } = await octokit.rest.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.tree.sha,
      tree: treeEntries,
    });

    const { data: commit } = await octokit.rest.git.createCommit({
      owner,
      repo,
      message,
      tree: tree.sha,
      parents: [baseCommitSha],
    });

    await octokit.rest.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: commit.sha,
    });

    return commit;
  }

  /**
   * Sequential Contents API writes. Scan/immutable files first, then caches.
   * On conflict, throw immediately so the caller can merge against truth.
   * @private
   */
  async _writeGitHubFilesViaContents(octokit, owner, repo, branch, files, message) {
    /** @type {object | null} */
    let lastCommit = null;

    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      let sha = file.sha;
      if (!sha) {
        const existing = await this._readGitHubFile(
          octokit,
          owner,
          repo,
          file.path,
          branch,
        );
        if (existing?.sha) {
          sha = existing.sha;
        }
      }

      const fileMessage =
        files.length === 1
          ? message
          : `${message} (${i + 1}/${files.length})`;

      try {
        const { data } = await octokit.rest.repos.createOrUpdateFileContents({
          owner,
          repo,
          path: file.path,
          message: fileMessage,
          content: Buffer.from(file.content, 'utf8').toString('base64'),
          branch,
          ...(sha ? { sha } : {}),
        });

        lastCommit = data.commit;
        if (data.content?.sha) {
          file.sha = data.content.sha;
        }
      } catch (err) {
        if (this._isRefConflict(err)) {
          throw err;
        }
        throw err;
      }
    }

    return lastCommit;
  }

  // ─── Google Drive adapter ─────────────────────────────────────────────

  /**
   * @param {object} storageRef `{ id }` Drive folder id (from Picker)
   * @param {import('googleapis').drive_v3.Drive} drive
   * @private
   */
  async _validateDriveStorage(storageRef, drive) {
    const folderId = storageRef?.id;
    if (!folderId) {
      return this._invalidResult('missing_folder_id');
    }

    let capabilities;
    try {
      capabilities = await this._probeDriveCapabilities(drive, folderId);
    } catch (err) {
      if (err?.code === 404 || err?.status === 404) {
        return this._invalidResult('not_found');
      }
      if (err?.code === 403 || err?.status === 403) {
        return {
          status: 'invalid',
          reason: 'access_denied',
          capabilities: { canRead: false, canWrite: false, canCreate: false },
        };
      }
      throw err;
    }

    const manifests = await this._listDriveNamedFiles(drive, folderId, [
      MANIFEST_PATH,
      LEGACY_MANIFEST_PATH,
    ]);
    const currentManifests = manifests.filter((f) => f.name === MANIFEST_PATH);
    const legacyManifests = manifests.filter((f) => f.name === LEGACY_MANIFEST_PATH);

    if (currentManifests.length > 1 || legacyManifests.length > 1) {
      return {
        status: 'invalid',
        reason: 'duplicate_manifest',
        capabilities,
      };
    }

    const manifestMeta = currentManifests[0] || legacyManifests[0];
    if (!manifestMeta) {
      const children = await this._listDriveChildren(drive, folderId);
      const status = children.length === 0 ? 'initializable' : 'unrelated';
      return { status, reason: null, capabilities };
    }

    let manifest;
    try {
      const raw = await this._readDriveFileContent(drive, manifestMeta.id);
      manifest = this._parseJson(raw, 'manifest');
    } catch {
      return {
        status: 'invalid',
        reason: 'malformed_manifest',
        capabilities,
      };
    }

    const manifestCheck = this._assessManifest(manifest);
    if (manifestCheck.status !== 'loadable') {
      return {
        status: manifestCheck.status,
        reason: manifestCheck.reason,
        capabilities,
      };
    }

    const { manifest: normalized } = this._normalizeManifestBrand(manifest);
    const scansFolderId = await this._findDriveScansFolder(drive, folderId);
    const { index, repaired } = scansFolderId
      ? await this._reconcileDriveIndex(drive, scansFolderId)
      : { index: { schemaVersion: SUPPORTED_SCHEMA_VERSION, scans: [] }, repaired: false };

    let reason = repaired ? 'repairable' : manifestCheck.reason;
    if (!repaired && (manifestMeta.name === LEGACY_MANIFEST_PATH || manifest.equalview === true)) {
      reason = 'migration_required';
    }

    return {
      status: 'loadable',
      reason,
      capabilities,
      manifestSummary: {
        accountId: normalized.account.id,
        schemaVersion: normalized.schemaVersion,
        scanCount: index.scans.length,
        updatedAt: normalized.account.updatedAt,
      },
    };
  }

  /**
   * @private
   */
  async _loadDriveAccount(storageRef, drive) {
    const folderId = storageRef?.id;
    if (!folderId) {
      throw new Error('Google storageRef requires id (Drive folder id)');
    }

    const manifestMeta = await this._readDriveAccountManifest(drive, folderId);
    if (!manifestMeta) {
      throw new Error('Account manifest not found');
    }

    const parsed = this._parseJson(manifestMeta.content, 'manifest');
    const manifestCheck = this._assessManifest(parsed);
    if (manifestCheck.status === 'incompatible' || manifestCheck.status === 'invalid') {
      throw new Error(manifestCheck.reason || 'Invalid account manifest');
    }

    const { manifest, migrated: brandMigrated } = this._normalizeManifestBrand(parsed);
    const scansFolderId = await this._ensureDriveScansFolder(drive, folderId);
    const { index, repaired, scanFiles } = await this._reconcileDriveIndex(drive, scansFolderId);

    let reason = manifestCheck.reason ?? null;
    const needsManifestWrite = repaired || brandMigrated || manifestMeta.legacy;
    if (repaired) {
      reason = 'repairable';
    } else if (brandMigrated || manifestMeta.legacy) {
      reason = 'migration_required';
    }

    if (needsManifestWrite) {
      const updated = this._updateManifestSummary(manifest, index);
      if (repaired) {
        await this._writeDriveJsonFile(
          drive,
          scansFolderId,
          'index.json',
          index,
          await this._findDriveChild(drive, scansFolderId, 'index.json'),
        );
      }
      await this._writeDriveJsonFile(
        drive,
        folderId,
        MANIFEST_PATH,
        updated,
        manifestMeta.legacy ? null : manifestMeta,
      );
    }

    const folderMeta = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,webViewLink',
    });

    return {
      provider: 'google',
      storageRef: this._normalizeDriveStorageRef(storageRef, folderMeta.data),
      accountId: manifest.account.id,
      settings: manifest.settings ?? { autoDelete90d: true },
      scanCount: index.scans.length,
      manifest,
      index,
      scanFiles,
      reason,
    };
  }

  /**
   * @private
   */
  async _initDriveStorage(storageRef, owner, drive) {
    let folderId = storageRef?.id;
    if (!folderId && storageRef?.name) {
      const created = await drive.files.create({
        requestBody: {
          name: storageRef.name,
          mimeType: DRIVE_FOLDER_MIME,
        },
        fields: 'id,name,webViewLink',
      });
      folderId = created.data.id;
      storageRef = {
        ...storageRef,
        id: folderId,
        name: created.data.name,
        webViewLink: created.data.webViewLink,
      };
    }
    if (!folderId) {
      throw new Error('Google storageRef requires id (Drive folder id) or name');
    }

    const validation = await this._validateDriveStorage({ ...storageRef, id: folderId }, drive);
    if (validation.status === 'loadable') {
      throw new Error('Storage already contains a Vizably account');
    }
    if (validation.status === 'incompatible' || validation.status === 'invalid') {
      throw new Error(validation.reason || `Cannot initialize storage (${validation.status})`);
    }
    if (!validation.capabilities.canWrite) {
      throw new Error('Storage is not writable');
    }

    const existingManifest = await this._readDriveAccountManifest(drive, folderId);
    if (existingManifest) {
      throw new Error('Storage was initialized by another session');
    }

    const folderMeta = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,webViewLink',
    });

    const now = new Date().toISOString();
    const manifest = {
      vizably: true,
      kind: 'account-store',
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      minReaderSchemaVersion: SUPPORTED_SCHEMA_VERSION,
      account: {
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      },
      storage: {
        provider: 'google',
        providerStorageId: folderId,
        ownerId: String(owner.id),
        ownerDisplay: owner.username || owner.displayName || owner.email || 'unknown',
        folderName: folderMeta.data.name,
      },
      settings: {
        autoDelete90d: true,
      },
      summary: {
        scanCount: 0,
        lastScanAt: null,
      },
      features: [],
    };

    const index = {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      scans: [],
    };

    const scansFolderId = await this._ensureDriveScansFolder(drive, folderId);
    await this._writeDriveJsonFile(drive, folderId, MANIFEST_PATH, manifest, null);
    await this._writeDriveJsonFile(drive, scansFolderId, 'index.json', index, null);

    return {
      provider: 'google',
      storageRef: this._normalizeDriveStorageRef(
        { ...storageRef, id: folderId },
        folderMeta.data,
      ),
      accountId: manifest.account.id,
      settings: manifest.settings,
      scanCount: 0,
      manifest,
      index,
    };
  }

  /**
   * Scan file first, then index + manifest with ETag preconditions; retry on 412.
   * @private
   */
  async _saveDriveScanResults(account, scanResult, url, drive) {
    const prepared = this._prepareScanWrite(scanResult, url);
    const storageRef = account.storageRef ?? account.storage;
    const folderId = storageRef?.id;
    if (!folderId) {
      throw new Error('Google storageRef requires id (Drive folder id)');
    }

    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        return await this._saveDriveScanResultsOnce(drive, folderId, prepared);
      } catch (err) {
        const canRetry = this._isDriveConflict(err) && attempt < maxAttempts - 1;
        if (!canRetry) {
          throw err;
        }
      }
    }
    throw new Error('Google Drive write failed after retries');
  }

  /** @private */
  async _saveDriveScanResultsOnce(drive, folderId, prepared) {
    const {
      scanId,
      host,
      url,
      scannedAt,
      scanPath,
      scanContent,
      scanSize,
      scanSha256,
      issues,
      topSeverity,
    } = prepared;

    const manifestMeta = await this._readDriveAccountManifest(drive, folderId);
    if (!manifestMeta) {
      throw new Error('Account manifest not found');
    }

    const { manifest } = this._normalizeManifestBrand(
      this._parseJson(manifestMeta.content, 'manifest'),
    );
    const scansFolderId = await this._ensureDriveScansFolder(drive, folderId);
    const { index } = await this._reconcileDriveIndex(drive, scansFolderId);

    index.scans = index.scans.filter((entry) => entry.id !== scanId);
    index.scans.unshift({
      id: scanId,
      url,
      host,
      scannedAt,
      score: this._scoreFromIssues(issues),
      issues,
      topSeverity,
      file: scanPath,
      size: scanSize,
      sha256: scanSha256,
    });

    const updatedManifest = this._updateManifestSummary(manifest, index, scannedAt);
    updatedManifest.account.updatedAt = scannedAt;

    const scanFileName = `${scanId}_${host}.json`;
    // Immutable scan file first — truth survives if later cache writes conflict.
    await this._writeDriveJsonFile(
      drive,
      scansFolderId,
      scanFileName,
      JSON.parse(scanContent),
      null,
    );

    const indexMeta = await this._findDriveChild(drive, scansFolderId, 'index.json');
    await this._writeDriveJsonFile(drive, scansFolderId, 'index.json', index, indexMeta);

    await this._writeDriveJsonFile(
      drive,
      folderId,
      MANIFEST_PATH,
      updatedManifest,
      manifestMeta.legacy ? null : manifestMeta,
    );

    return {
      scanId,
      path: scanPath,
      scanCount: index.scans.length,
      scans: index.scans,
    };
  }

  /** @private */
  async _getDriveScanById(account, scanId, drive) {
    if (!scanId || typeof scanId !== 'string') {
      const err = new Error('Scan id is required');
      err.status = 400;
      err.code = 'SCAN_ID_REQUIRED';
      throw err;
    }

    const storageRef = account.storageRef ?? account.storage;
    const folderId = storageRef?.id;
    if (!folderId) {
      throw new Error('Google storageRef requires id (Drive folder id)');
    }

    const scansFolderId = await this._findDriveScansFolder(drive, folderId);
    if (!scansFolderId) {
      const err = new Error('Scan not found');
      err.status = 404;
      err.code = 'SCAN_NOT_FOUND';
      throw err;
    }

    const children = await this._listDriveChildren(drive, scansFolderId);
    const match = children.find(
      (entry) =>
        entry.mimeType !== DRIVE_FOLDER_MIME &&
        entry.name.startsWith(`${scanId}_`) &&
        entry.name.endsWith('.json'),
    );
    if (!match) {
      const err = new Error('Scan not found');
      err.status = 404;
      err.code = 'SCAN_NOT_FOUND';
      throw err;
    }

    let payload;
    try {
      payload = this._parseJson(await this._readDriveFileContent(drive, match.id), 'scan');
    } catch {
      const err = new Error('Scan file is malformed');
      err.status = 500;
      err.code = 'SCAN_MALFORMED';
      throw err;
    }

    if (payload.id !== scanId || !payload.result || !payload.url) {
      const err = new Error('Scan not found');
      err.status = 404;
      err.code = 'SCAN_NOT_FOUND';
      throw err;
    }

    return {
      id: payload.id,
      url: payload.url,
      scannedAt: payload.scannedAt ?? null,
      result: payload.result,
    };
  }

  /** @private */
  _normalizeDriveStorageRef(storageRef, folderMeta = {}) {
    return {
      provider: 'google',
      id: storageRef.id || folderMeta.id,
      name: storageRef.name || folderMeta.name || null,
      webViewLink: storageRef.webViewLink || folderMeta.webViewLink || null,
    };
  }

  /** @private */
  async _probeDriveCapabilities(drive, folderId) {
    const { data } = await drive.files.get({
      fileId: folderId,
      fields: 'id,name,mimeType,capabilities',
    });
    if (data.mimeType !== DRIVE_FOLDER_MIME) {
      const err = new Error('storageRef.id must be a Drive folder');
      err.status = 400;
      throw err;
    }
    const caps = data.capabilities || {};
    const canWrite = Boolean(caps.canAddChildren ?? caps.canEdit ?? true);
    const canRead = Boolean(caps.canListChildren ?? caps.canDownload ?? true);
    return {
      canRead,
      canWrite,
      canCreate: canWrite,
    };
  }

  /** @private */
  async _listDriveChildren(drive, folderId) {
    /** @type {Array<object>} */
    const files = [];
    let pageToken;
    do {
      const { data } = await drive.files.list({
        q: `'${folderId}' in parents and trashed = false`,
        fields: 'nextPageToken, files(id,name,mimeType,md5Checksum,modifiedTime)',
        pageSize: 100,
        pageToken,
      });
      files.push(...(data.files || []));
      pageToken = data.nextPageToken;
    } while (pageToken);
    return files;
  }

  /** @private */
  async _listDriveNamedFiles(drive, folderId, names) {
    const children = await this._listDriveChildren(drive, folderId);
    const wanted = new Set(names);
    return children.filter((f) => wanted.has(f.name) && f.mimeType !== DRIVE_FOLDER_MIME);
  }

  /** @private */
  async _findDriveChild(drive, folderId, name) {
    const matches = await this._listDriveNamedFiles(drive, folderId, [name]);
    return matches[0] || null;
  }

  /** @private */
  async _findDriveScansFolder(drive, rootFolderId) {
    const children = await this._listDriveChildren(drive, rootFolderId);
    const folders = children.filter(
      (f) => f.name === SCANS_DIR && f.mimeType === DRIVE_FOLDER_MIME,
    );
    if (folders.length > 1) {
      throw new Error('Duplicate scans/ folder in Drive store');
    }
    return folders[0]?.id ?? null;
  }

  /** @private */
  async _ensureDriveScansFolder(drive, rootFolderId) {
    const existing = await this._findDriveScansFolder(drive, rootFolderId);
    if (existing) {
      return existing;
    }
    const { data } = await drive.files.create({
      requestBody: {
        name: SCANS_DIR,
        mimeType: DRIVE_FOLDER_MIME,
        parents: [rootFolderId],
      },
      fields: 'id',
    });
    return data.id;
  }

  /**
   * Drive v3 does not expose `etag` as a fields= selection ("Invalid field
   * selection etag"). Optimistic concurrency uses the HTTP ETag header.
   * @private
   */
  _driveEtagFromResponse(res) {
    if (!res) return undefined;
    const headers = res.headers;
    if (headers) {
      if (typeof headers.get === 'function') {
        return headers.get('etag') || headers.get('ETag') || undefined;
      }
      return headers.etag || headers.ETag || headers['etag'] || undefined;
    }
    return undefined;
  }

  /**
   * @returns {Promise<{ id: string, name: string, etag?: string }>}
   * @private
   */
  async _getDriveFileMeta(drive, fileId) {
    const meta = await drive.files.get({ fileId, fields: 'id,name' });
    return {
      id: meta.data.id,
      name: meta.data.name,
      etag: this._driveEtagFromResponse(meta),
    };
  }

  /**
   * @returns {Promise<{ id: string, name: string, content: string, etag?: string, legacy: boolean } | null>}
   * @private
   */
  async _readDriveAccountManifest(drive, folderId) {
    const current = await this._findDriveChild(drive, folderId, MANIFEST_PATH);
    if (current) {
      const content = await this._readDriveFileContent(drive, current.id);
      const meta = await this._getDriveFileMeta(drive, current.id);
      return {
        id: current.id,
        name: MANIFEST_PATH,
        content,
        etag: meta.etag,
        legacy: false,
      };
    }
    const legacy = await this._findDriveChild(drive, folderId, LEGACY_MANIFEST_PATH);
    if (legacy) {
      const content = await this._readDriveFileContent(drive, legacy.id);
      const meta = await this._getDriveFileMeta(drive, legacy.id);
      return {
        id: legacy.id,
        name: LEGACY_MANIFEST_PATH,
        content,
        etag: meta.etag,
        legacy: true,
      };
    }
    return null;
  }

  /** @private */
  async _readDriveFileContent(drive, fileId) {
    const res = await drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'text' },
    );
    return typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  }

  /**
   * Create or update a JSON file; pass `existing` with id (and optional etag)
   * so updates use If-Match generation/ETag preconditions.
   * @private
   */
  async _writeDriveJsonFile(drive, parentId, name, value, existing) {
    const body = `${JSON.stringify(value, null, 2)}\n`;
    const media = {
      mimeType: DRIVE_JSON_MIME,
      body: Readable.from([body]),
    };

    if (existing?.id) {
      let etag = existing.etag;
      if (!etag) {
        const meta = await this._getDriveFileMeta(drive, existing.id);
        etag = meta.etag;
      }
      await drive.files.update(
        {
          fileId: existing.id,
          media,
          fields: 'id,name',
        },
        etag ? { headers: { 'If-Match': etag } } : undefined,
      );
      return;
    }

    await drive.files.create({
      requestBody: {
        name,
        parents: [parentId],
        mimeType: DRIVE_JSON_MIME,
      },
      media,
      fields: 'id,name',
    });
  }

  /** @private */
  async _reconcileDriveIndex(drive, scansFolderId) {
    const children = await this._listDriveChildren(drive, scansFolderId);
    const scanFiles = children.filter(
      (entry) =>
        entry.mimeType !== DRIVE_FOLDER_MIME &&
        entry.name.endsWith('.json') &&
        entry.name !== 'index.json',
    );

    /** @type {Array<object>} */
    const rebuiltScans = [];

    for (const file of scanFiles) {
      try {
        const content = await this._readDriveFileContent(drive, file.id);
        const payload = JSON.parse(content);
        if (!payload.id || !payload.url || !payload.result) {
          continue;
        }
        const { issues, topSeverity } = this._summarizeScanResult(payload.result);
        const host = this._hostFromUrl(payload.url);
        rebuiltScans.push({
          id: payload.id,
          url: payload.url,
          host,
          scannedAt: payload.scannedAt || new Date().toISOString(),
          score: this._scoreFromIssues(issues),
          issues,
          topSeverity,
          file: `${SCANS_DIR}/${file.name}`,
          size: Buffer.byteLength(content, 'utf8'),
          sha256: crypto.createHash('sha256').update(content).digest('hex'),
        });
      } catch {
        // Skip corrupt scan files during reconcile.
      }
    }

    rebuiltScans.sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));

    const index = {
      schemaVersion: SUPPORTED_SCHEMA_VERSION,
      scans: rebuiltScans,
    };

    const existingIndex = await this._findDriveChild(drive, scansFolderId, 'index.json');
    let repaired = true;
    if (existingIndex) {
      try {
        const raw = await this._readDriveFileContent(drive, existingIndex.id);
        const parsed = JSON.parse(raw);
        repaired = !this._indexesEqual(parsed, index);
      } catch {
        repaired = true;
      }
    }

    return { index, repaired, scanFiles };
  }

  /** @private */
  _isDriveConflict(err) {
    const status = err?.code || err?.status || err?.response?.status;
    return status === 412 || status === 409;
  }
}

module.exports = StorageService;
