/**
 * StorageService — provider-neutral portable-account storage.
 *
 * Speaks the on-disk contract in docs/guides/auth_storage_guide/accountStorageContract.md.
 * Accepts pre-built authenticated clients (no AuthService dependency).
 * GitHub adapter implemented; Google/Drive stubbed until Phase 3.
 */
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { normalizeGitHubRepoName } = require('../../shared/githubRepoName');
const { collectAllGitHubPages } = require('./githubPagination');

const MANIFEST_PATH = 'vizably.json';
/** Pre-rename store root — still loadable; rewritten to `MANIFEST_PATH` on load. */
const LEGACY_MANIFEST_PATH = 'equalview.json';
const SCANS_DIR = 'scans';
const INDEX_PATH = `${SCANS_DIR}/index.json`;
const SUPPORTED_SCHEMA_VERSION = 1;
const GOOGLE_NOT_AVAILABLE = 'Google storage is not available until Phase 3';

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
 * @property {object} [driveClient]
 */

class StorageService {
  /**
   * @param {import('@octokit/rest').Octokit} githubClient
   * @returns {Promise<Array<{ id: string, full_name: string, private: boolean, html_url: string }>>}
   */
  async listGitHubRepos(githubClient) {
    const data = await collectAllGitHubPages(async (page, perPage) => {
      const { data: pageData } = await githubClient.rest.repos.listForAuthenticatedUser({
        visibility: 'all',
        affiliation: 'owner,collaborator,organization_member',
        per_page: perPage,
        page,
        sort: 'updated',
      });
      return pageData;
    });

    return data.map((repo) => ({
      id: repo.node_id,
      full_name: repo.full_name,
      private: repo.private,
      html_url: repo.html_url,
    }));
  }

  /**
   * Check whether a repository name is available under the signed-in user.
   * Uses GET /repos/{owner}/{repo}: 404 → available, 200 → taken.
   *
   * @param {string} name
   * @param {StorageClients} clients
   * @returns {Promise<{
   *   name: string,
   *   normalizedName: string | null,
   *   full_name: string | null,
   *   status: 'available' | 'taken' | 'invalid' | 'error',
   *   message: string,
   * }>}
   */
  async checkGitHubRepoNameAvailability(name, clients) {
    const octokit = clients.githubUserClient ?? clients.githubClient;
    if (!octokit) {
      throw new Error('GitHub user client is required to check repository name availability');
    }

    let normalized;
    try {
      normalized = this._normalizeGitHubRepoName(name);
    } catch (err) {
      return {
        name: String(name ?? '').trim(),
        normalizedName: null,
        full_name: null,
        status: 'invalid',
        message: err.message || 'Invalid repository name',
      };
    }

    let owner;
    try {
      const { data: user } = await octokit.rest.users.getAuthenticated();
      owner = user.login;
    } catch (err) {
      return {
        name: normalized,
        normalizedName: normalized,
        full_name: null,
        status: 'error',
        message:
          err?.status === 401
            ? 'GitHub authentication failed. Sign out and sign in again.'
            : 'Could not look up your GitHub username to check availability.',
      };
    }

    const fullName = `${owner}/${normalized}`;
    try {
      await octokit.rest.repos.get({ owner, repo: normalized });
      return {
        name: normalized,
        normalizedName: normalized,
        full_name: fullName,
        status: 'taken',
        message: `A repository named "${normalized}" already exists on your account.`,
      };
    } catch (err) {
      if (err?.status === 404) {
        return {
          name: normalized,
          normalizedName: normalized,
          full_name: fullName,
          status: 'available',
          message: `${fullName} is available.`,
        };
      }

      const message = err?.response?.data?.message ?? err?.message ?? '';
      if (
        err?.status === 429 ||
        (err?.status === 403 && /rate limit/i.test(message))
      ) {
        return {
          name: normalized,
          normalizedName: normalized,
          full_name: fullName,
          status: 'error',
          message: 'GitHub rate-limited the availability check. Try again in a moment.',
        };
      }

      return {
        name: normalized,
        normalizedName: normalized,
        full_name: fullName,
        status: 'error',
        message: 'Could not check repository name availability. Try again.',
      };
    }
  }

  /**
   * Create a private empty GitHub repo for the signed-in user (App UAT).
   * Does not initialize a Vizably store — caller runs fit-check then init.
   *
   * @param {string} name repository name (not owner/name)
   * @param {StorageClients} clients must include githubUserClient (or githubClient as UAT)
   * @param {object} [options]
   * @param {string} [options.installUrl] App install URL when needsInstall
   * @returns {Promise<{
   *   storageRef: { id: string, full_name: string, private: boolean, html_url: string, name: string },
   *   needsInstall: boolean,
   *   installUrl: string | null,
   * }>}
   */
  async createGitHubRepository(name, clients, options = {}) {
    const octokit = clients.githubUserClient ?? clients.githubClient;
    if (!octokit) {
      throw new Error('GitHub user client is required to create a repository');
    }

    const repoName = this._normalizeGitHubRepoName(name);
    let created;
    try {
      ({ data: created } = await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        private: true,
        auto_init: false,
        description: 'Vizably accessibility scan storage',
      }));
    } catch (err) {
      throw this._formatGitHubCreateError(err, repoName);
    }

    const storageRef = {
      id: created.node_id,
      name: created.name,
      full_name: created.full_name,
      private: Boolean(created.private),
      html_url: created.html_url,
    };

    const [owner, repo] = created.full_name.split('/');
    let onInstallation;
    try {
      onInstallation = await this._isRepoOnWritableInstallation(octokit, owner, repo);
    } catch (err) {
      // Repo already exists — attach storageRef so the client can continue without
      // treating a probe failure as "needs install".
      err.storageRef = storageRef;
      throw err;
    }
    const needsInstall = !onInstallation;
    const installUrl = needsInstall
      ? options.installUrl || 'https://github.com/settings/installations'
      : null;

    return { storageRef, needsInstall, installUrl };
  }

  /**
   * True when a Vizably App installation with Contents write includes this repo.
   * Does not fall back to the user's personal push bit — create needs the App.
   * Throws classified errors for API/network failures; returns false only when
   * the installations list was fetched successfully and the repo is absent.
   *
   * @param {import('@octokit/rest').Octokit} octokit user access token client
   * @param {string} owner
   * @param {string} repo
   * @private
   */
  async _isRepoOnWritableInstallation(octokit, owner, repo) {
    const fullName = `${owner}/${repo}`;
    let data;
    try {
      ({ data } = await octokit.rest.apps.listInstallationsForAuthenticatedUser({
        per_page: 100,
      }));
    } catch (err) {
      throw this._formatGitHubInstallationProbeError(err);
    }

    for (const installation of data.installations ?? []) {
      if (installation.permissions?.contents !== 'write') {
        continue;
      }
      if (installation.repository_selection === 'all') {
        return true;
      }

      let reposData;
      try {
        ({ data: reposData } =
          await octokit.rest.apps.listInstallationReposForAuthenticatedUser({
            installation_id: installation.id,
            per_page: 100,
          }));
      } catch (err) {
        throw this._formatGitHubInstallationProbeError(err);
      }

      if (reposData.repositories?.some((r) => r.full_name === fullName)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Map Octokit / network failures during install probing to actionable errors.
   * Never treat these as "repo not installed".
   *
   * @param {unknown} err
   * @private
   */
  _formatGitHubInstallationProbeError(err) {
    const status = err?.status;
    const code = err?.code;
    const message = String(err?.response?.data?.message ?? err?.message ?? '');
    const rateLimitRemaining = err?.response?.headers?.['x-ratelimit-remaining'];
    const isRateLimited =
      status === 429 ||
      (status === 403 &&
        (/rate limit|secondary rate limit/i.test(message) ||
          rateLimitRemaining === '0' ||
          rateLimitRemaining === 0));

    if (isRateLimited) {
      const formatted = new Error(
        'GitHub rate-limited the request while checking App installation access. ' +
          'Wait a moment and refresh — do not reinstall the Vizably GitHub App.',
      );
      formatted.status = 429;
      formatted.code = 'GITHUB_RATE_LIMITED';
      return formatted;
    }

    if (
      status === 401 ||
      (status === 403 &&
        /bad credentials|requires authentication|unauthorized|token/i.test(message))
    ) {
      const formatted = new Error(
        'GitHub authentication failed while checking App installation access. ' +
          'Sign out and sign in again, then retry.',
      );
      formatted.status = 401;
      formatted.code = 'GITHUB_AUTH_FAILED';
      return formatted;
    }

    if (status === 403) {
      const formatted = new Error(
        'GitHub refused the installation check. Confirm the Vizably GitHub App ' +
          'permissions, then sign out and sign in again. This is not the same as ' +
          'adding a repo to the installation.',
      );
      formatted.status = 403;
      formatted.code = 'GITHUB_FORBIDDEN';
      return formatted;
    }

    const networkCodes = new Set([
      'ENOTFOUND',
      'ECONNRESET',
      'ETIMEDOUT',
      'ECONNREFUSED',
      'EAI_AGAIN',
      'EPIPE',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_SOCKET',
    ]);
    if (
      networkCodes.has(code) ||
      /network|fetch failed|socket|timed out|timeout/i.test(message) ||
      err?.name === 'FetchError' ||
      err?.name === 'AbortError'
    ) {
      const formatted = new Error(
        'Could not reach GitHub to verify App installation access. Check your ' +
          'network connection and try again — do not reinstall the Vizably GitHub App.',
      );
      formatted.status = 503;
      formatted.code = 'GITHUB_NETWORK_ERROR';
      return formatted;
    }

    if (typeof status === 'number' && status >= 500) {
      const formatted = new Error(
        'GitHub is temporarily unavailable while checking App installation access. ' +
          'Try again shortly — do not reinstall the Vizably GitHub App.',
      );
      formatted.status = 503;
      formatted.code = 'GITHUB_UNAVAILABLE';
      return formatted;
    }

    const formatted = new Error(
      message ||
        'Could not verify Vizably GitHub App installation access. Try again — ' +
          'do not reinstall the app unless GitHub confirms it is missing.',
    );
    formatted.status = status && status >= 400 ? status : 502;
    formatted.code = 'GITHUB_INSTALL_PROBE_FAILED';
    return formatted;
  }

  /**
   * @param {string} name
   * @returns {string}
   * @private
   */
  _normalizeGitHubRepoName(name) {
    // Reject owner/name before whitespace collapse so "sam / repo" stays invalid.
    if (String(name ?? '').includes('/')) {
      const err = new Error(
        'Enter a repository name only (not owner/name). The repo is created under your GitHub account.',
      );
      err.status = 400;
      err.code = 'INVALID_REPO_NAME';
      throw err;
    }

    const normalized = normalizeGitHubRepoName(name);
    if (!normalized) {
      const err = new Error('Repository name is required');
      err.status = 400;
      err.code = 'INVALID_REPO_NAME';
      throw err;
    }
    if (normalized.length > 100 || !/^[A-Za-z0-9._-]+$/.test(normalized)) {
      const err = new Error(
        'Repository name may only contain letters, numbers, hyphens, underscores, and periods (max 100 characters).',
      );
      err.status = 400;
      err.code = 'INVALID_REPO_NAME';
      throw err;
    }
    return normalized;
  }

  /**
   * @param {unknown} err
   * @param {string} repoName
   * @private
   */
  _formatGitHubCreateError(err, repoName) {
    const status = err?.status;
    const message = err?.response?.data?.message ?? err?.message ?? '';
    const errors = err?.response?.data?.errors;

    if (status === 422) {
      const detail = Array.isArray(errors)
        ? errors.map((e) => e.message || e.code).filter(Boolean).join('; ')
        : '';
      const taken =
        /already exists|name already taken/i.test(message) ||
        /already exists/i.test(detail);
      const formatted = new Error(
        taken
          ? `A repository named "${repoName}" already exists on your account.`
          : detail || message || `Could not create repository "${repoName}".`,
      );
      formatted.status = 422;
      formatted.code = taken ? 'REPO_NAME_TAKEN' : 'REPO_CREATE_FAILED';
      return formatted;
    }

    if (status === 403) {
      const formatted = new Error(
        /not accessible by integration|Resource not accessible/i.test(message)
          ? 'GitHub App cannot create repositories. Add Repository permissions → Administration: Read and write, accept the permission upgrade on your installation, then sign out and sign in again.'
          : message || 'GitHub refused to create this repository.',
      );
      formatted.status = 403;
      formatted.code = 'REPO_CREATE_FORBIDDEN';
      return formatted;
    }

    const formatted = new Error(message || `Could not create repository "${repoName}".`);
    formatted.status = status || 500;
    formatted.code = 'REPO_CREATE_FAILED';
    return formatted;
  }

  /**
   * @param {'github' | 'google'} provider
   * @param {object} storageRef
   * @param {StorageClients} clients
   */
  async validateStorage(provider, storageRef, clients) {
    if (provider === 'google') {
      return this._googleNotAvailableValidation();
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
      throw new Error(GOOGLE_NOT_AVAILABLE);
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
      throw new Error(GOOGLE_NOT_AVAILABLE);
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
    if (account?.storage?.provider === 'google') {
      throw new Error(GOOGLE_NOT_AVAILABLE);
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
    if (account?.storage?.provider === 'google') {
      throw new Error(GOOGLE_NOT_AVAILABLE);
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
  _googleNotAvailableValidation() {
    return {
      status: 'invalid',
      reason: 'provider_not_available',
      capabilities: { canRead: false, canWrite: false, canCreate: false },
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
}

module.exports = StorageService;
