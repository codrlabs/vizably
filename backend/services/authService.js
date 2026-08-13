/**
 * AuthService — Passport strategies, session middleware, token encryption,
 * and authenticated provider clients for the storage service.
 *
 * No user DB: the session payload (identity + encrypted tokens + attached
 * `storage`) is the user. Google auth/Drive clients are stubbed until Phase 3.
 *
 * The session is a signed cookie, not a server-side store. Serverless gives
 * every request a fresh, isolated instance, so anything held in process memory
 * is gone by the next request and OAuth never completes. The cookie is the
 * store, which also means the payload must stay under the 4KB browser limit —
 * see the scan list, which is fetched from the user's store instead.
 */
const crypto = require('crypto');
const cookieSession = require('cookie-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const { Octokit } = require('@octokit/rest');

const GOOGLE_NOT_AVAILABLE = 'Google auth is not available until Phase 3';

class AuthService {
  /**
   * @param {object} [deps]
   * @param {string} [deps.sessionSecret]
   * @param {string} [deps.encryptionKey] base64-encoded 32-byte key
   * @param {string} [deps.githubClientId] GitHub App OAuth client id
   * @param {string} [deps.githubClientSecret]
   * @param {string} [deps.githubCallbackUrl]
   * @param {string} [deps.githubAppId] numeric GitHub App id (for installation tokens)
   * @param {string} [deps.githubAppPrivateKey] PEM private key for the GitHub App
   */
  constructor(deps = {}) {
    this.sessionSecret = deps.sessionSecret ?? process.env.SESSION_SECRET;
    this.encryptionKeyB64 = deps.encryptionKey ?? process.env.ENCRYPTION_KEY;
    this.githubClientId =
      deps.githubClientId ??
      process.env.GITHUB_APP_CLIENT_ID ??
      process.env.GITHUB_CLIENT_ID;
    this.githubClientSecret =
      deps.githubClientSecret ??
      process.env.GITHUB_APP_CLIENT_SECRET ??
      process.env.GITHUB_CLIENT_SECRET;
    this.githubCallbackUrl =
      deps.githubCallbackUrl ?? process.env.GITHUB_REDIRECT_URI;
    this.githubAppId = deps.githubAppId ?? process.env.GITHUB_APP_ID;
    this.githubAppPrivateKey = this._loadGitHubAppPrivateKey(
      deps.githubAppPrivateKey,
    );

    this._encryptionKey = this._parseEncryptionKey(this.encryptionKeyB64);
    this._passportConfigured = false;
    this._configurePassport();
  }

  /** @param {string | undefined} inlineKey */
  _loadGitHubAppPrivateKey(inlineKey) {
    const raw =
      inlineKey ??
      process.env.GITHUB_APP_PRIVATE_KEY ??
      (process.env.GITHUB_APP_PRIVATE_KEY_PATH
        ? require('fs').readFileSync(process.env.GITHUB_APP_PRIVATE_KEY_PATH, 'utf8')
        : null);
    if (!raw) {
      return null;
    }
    return String(raw).replace(/\\n/g, '\n').trim();
  }

  _hasGitHubAppSigningCredentials() {
    if (!this.githubAppId || !this.githubAppPrivateKey) {
      return false;
    }
    if (!/^\d+$/.test(String(this.githubAppId))) {
      throw new Error(
        'GITHUB_APP_ID must be the numeric App ID from your GitHub App General settings, not the OAuth Client ID (GITHUB_APP_CLIENT_ID).',
      );
    }
    return true;
  }

  /** @private */
  _createAppJwt() {
    if (!this._hasGitHubAppSigningCredentials()) {
      throw new Error('GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required');
    }

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        iat: now - 60,
        exp: now + 600,
        iss: this.githubAppId,
      }),
    ).toString('base64url');
    const body = `${header}.${payload}`;
    const signature = crypto
      .sign('RSA-SHA256', Buffer.from(body), this.githubAppPrivateKey)
      .toString('base64url');
    return `${body}.${signature}`;
  }

  /**
   * Resolve installation id for owner/repo via the GitHub App API (preferred),
   * then fall back to the authenticated user's installation list.
   * @param {import('@octokit/rest').Octokit} userOctokit
   * @param {string} fullName owner/repo
   * @returns {Promise<number | null>}
   */
  async _findInstallationIdForRepo(userOctokit, fullName) {
    const [owner, repo] = String(fullName).split('/');
    if (!owner || !repo) {
      return null;
    }

    if (this._hasGitHubAppSigningCredentials()) {
      try {
        const appOctokit = new Octokit({ auth: this._createAppJwt() });
        const { data } = await appOctokit.rest.apps.getRepoInstallation({
          owner,
          repo,
        });
        if (data?.id) {
          return data.id;
        }
      } catch (err) {
        if (err?.status !== 404) {
          throw err;
        }
      }
    }

    const { data } = await userOctokit.rest.apps.listInstallationsForAuthenticatedUser({
      per_page: 100,
    });

    for (const installation of data.installations ?? []) {
      const { data: reposData } =
        await userOctokit.rest.apps.listInstallationReposForAuthenticatedUser({
          installation_id: installation.id,
          per_page: 100,
        });

      if (reposData.repositories?.some((entry) => entry.full_name === fullName)) {
        return installation.id;
      }
    }

    return null;
  }

  /**
   * Public install / configure URL for the Vizably GitHub App.
   * Used when a newly created repo is not yet on a selected-repos installation.
   */
  async getInstallationSetupUrl() {
    let installUrl = 'https://github.com/settings/installations';
    try {
      if (!this._hasGitHubAppSigningCredentials()) {
        return installUrl;
      }
      const appOctokit = new Octokit({ auth: this._createAppJwt() });
      const { data } = await appOctokit.rest.apps.getAuthenticated();
      if (data?.slug) {
        installUrl = `https://github.com/apps/${data.slug}/installations/new`;
      }
    } catch {
      // keep generic installations URL
    }
    return installUrl;
  }

  /** @param {string} fullName owner/repo */
  async _installationSetupMessage(fullName) {
    const installUrl = await this.getInstallationSetupUrl();
    return (
      `Vizably is not installed on ${fullName}. Install the app at ${installUrl}, ` +
      'grant access to this repository, then sign out and sign in again.'
    );
  }

  /**
   * Confirm the signed-in user can access the repo and that its node id matches
   * `storageRef.id` before minting an installation token (installation tokens
   * are otherwise usable on any repo where the app is installed).
   * @param {import('@octokit/rest').Octokit} userOctokit
   * @param {object} storageRef
   * @private
   */
  async _assertUserCanAccessStorageRepo(userOctokit, storageRef) {
    const fullName = storageRef?.full_name || storageRef?.repo;
    const [owner, repo] = String(fullName || '').split('/');
    if (!owner || !repo) {
      throw new Error('GitHub storageRef requires full_name (owner/repo)');
    }
    if (!storageRef?.id) {
      throw new Error('GitHub storageRef requires id (repository node id)');
    }

    let data;
    try {
      ({ data } = await userOctokit.rest.repos.get({ owner, repo }));
    } catch (err) {
      if (err?.status === 404 || err?.status === 403) {
        const accessErr = new Error(
          `You do not have access to ${fullName}, or it does not exist.`,
        );
        accessErr.status = 403;
        accessErr.code = 'STORAGE_ACCESS_DENIED';
        throw accessErr;
      }
      throw err;
    }

    if (data.node_id !== storageRef.id) {
      const mismatch = new Error(
        `Repository identity mismatch for ${fullName}: storageRef.id does not match the GitHub node id.`,
      );
      mismatch.status = 403;
      mismatch.code = 'STORAGE_IDENTITY_MISMATCH';
      throw mismatch;
    }

    return data;
  }

  /**
   * Installation tokens carry the app's Contents permission on installed repos —
   * required for reliable writes with GitHub Apps (user OAuth tokens often 403).
   * @param {object} user session payload
   * @param {object} storageRef `{ id, full_name }` (or `repo`)
   */
  async getInstallationClientForRepo(user, storageRef) {
    if (!this._hasGitHubAppSigningCredentials()) {
      return null;
    }

    const fullName = storageRef?.full_name || storageRef?.repo;
    if (!fullName) {
      throw new Error('GitHub storageRef requires full_name (owner/repo)');
    }

    const userOctokit = this.getGitHubClient(user);
    await this._assertUserCanAccessStorageRepo(userOctokit, storageRef);

    const installationId = await this._findInstallationIdForRepo(userOctokit, fullName);
    if (!installationId) {
      throw new Error(await this._installationSetupMessage(fullName));
    }

    const appOctokit = new Octokit({ auth: this._createAppJwt() });
    const { data } = await appOctokit.rest.apps.createInstallationAccessToken({
      installation_id: installationId,
    });

    return new Octokit({ auth: data.token });
  }

  /** @param {string | undefined} b64 */
  _parseEncryptionKey(b64) {
    if (!b64) {
      return null;
    }
    const key = Buffer.from(b64, 'base64');
    if (key.length !== 32) {
      throw new Error(
        'ENCRYPTION_KEY must decode to 32 bytes (openssl rand -base64 32)',
      );
    }
    return key;
  }

  _configurePassport() {
    if (this._passportConfigured) {
      return;
    }

    passport.serializeUser((user, done) => done(null, user));
    passport.deserializeUser((user, done) => done(null, user));

    if (
      this.githubClientId &&
      this.githubClientSecret &&
      this.githubCallbackUrl
    ) {
      passport.use(
        'github',
        new GitHubStrategy(
          {
            clientID: this.githubClientId,
            clientSecret: this.githubClientSecret,
            callbackURL: this.githubCallbackUrl,
            scope: ['read:user'],
          },
          (accessToken, _refreshToken, profile, done) => {
            try {
              done(null, this._buildGitHubUser(accessToken, profile));
            } catch (err) {
              done(err);
            }
          },
        ),
      );
    }

    // Google strategy: Phase 3 — intentionally not registered here.

    this._passportConfigured = true;
  }

  /**
   * @param {string} accessToken
   * @param {import('passport-github2').Profile} profile
   */
  _buildGitHubUser(accessToken, profile) {
    const primaryEmail =
      profile.emails?.find((entry) => entry.primary)?.value ??
      profile.emails?.[0]?.value ??
      profile._json?.email ??
      null;

    return {
      id: String(profile.id),
      provider: 'github',
      username: profile.username,
      displayName: profile.displayName || profile.username,
      email: primaryEmail,
      avatarUrl: profile.photos?.[0]?.value ?? null,
      tokens: {
        github: {
          accessToken: this.encrypt(accessToken),
        },
      },
      storage: null,
    };
  }

  /**
   * AES-256-GCM encrypt. Returns `iv.authTag.ciphertext` (base64 segments).
   * @param {string} plaintext
   */
  encrypt(plaintext) {
    if (!this._encryptionKey) {
      throw new Error('ENCRYPTION_KEY is not configured');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._encryptionKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plaintext), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join('.');
  }

  /** @param {string} ciphertext */
  decrypt(ciphertext) {
    if (!this._encryptionKey) {
      throw new Error('ENCRYPTION_KEY is not configured');
    }

    const [ivB64, tagB64, dataB64] = ciphertext.split('.');
    if (!ivB64 || !tagB64 || !dataB64) {
      throw new Error('Invalid encrypted token format');
    }

    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(dataB64, 'base64');
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this._encryptionKey,
      iv,
    );
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }

  /** @returns {import('express').RequestHandler[]} */
  middleware() {
    if (!this.sessionSecret) {
      throw new Error('SESSION_SECRET is not configured');
    }

    const sessionMiddleware = cookieSession({
      name: 'vizably.sid',
      keys: [this.sessionSecret],
      httpOnly: true,
      // Must stay conditional: over plain http (docker-compose, `vercel dev`)
      // a secure cookie is never set and every auth flow fails silently.
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // Passport calls session.regenerate and session.save, which cookie-session
    // does not implement because the cookie *is* the store — there is nothing
    // to regenerate and the write happens when the response is sent. No-op
    // shims satisfy the contract without changing behaviour.
    const passportSessionShims = (req, _res, next) => {
      if (req.session && !req.session.regenerate) {
        req.session.regenerate = (cb) => cb();
      }
      if (req.session && !req.session.save) {
        req.session.save = (cb) => cb();
      }
      next();
    };

    return [
      sessionMiddleware,
      passportSessionShims,
      passport.initialize(),
      passport.session(),
    ];
  }

  /**
   * @param {object} user session payload
   * @returns {import('@octokit/rest').Octokit}
   */
  getGitHubClient(user) {
    const encrypted = user?.tokens?.github?.accessToken;
    if (!encrypted) {
      throw new Error('GitHub access token is not available for this user');
    }

    const accessToken = this.decrypt(encrypted);
    return new Octokit({ auth: accessToken });
  }

  /**
   * Phase 3 stub — returns null until Google Drive adapter lands.
   * @param {object} _user
   * @returns {null}
   */
  getGoogleDriveClient(_user) {
    return null;
  }

  /**
   * Phase 3 stub.
   * @param {object} _user
   */
  async refreshGoogleToken(_user) {
    const err = new Error(GOOGLE_NOT_AVAILABLE);
    err.code = 'GOOGLE_NOT_AVAILABLE';
    throw err;
  }

  /**
   * Build provider clients for routes/controller → storage service.
   * When `storageRef` is provided and app signing credentials exist, prefer an
   * installation access token for repo-scoped reads/writes.
   * @param {object} user session payload
   * @param {object} [options]
   * @param {object} [options.storageRef]
   * @returns {Promise<{ githubClient?: import('@octokit/rest').Octokit, githubUserClient?: import('@octokit/rest').Octokit, driveClient?: null }>}
   */
  async clientsFor(user, options = {}) {
    /** @type {{ githubClient?: import('@octokit/rest').Octokit, githubUserClient?: import('@octokit/rest').Octokit, driveClient?: null }} */
    const clients = {};
    const storageRef = options.storageRef;
    const fullName = storageRef?.full_name || storageRef?.repo;

    if (user?.tokens?.github?.accessToken) {
      clients.githubUserClient = this.getGitHubClient(user);
    }

    if (clients.githubUserClient && storageRef && fullName) {
      if (!this._hasGitHubAppSigningCredentials()) {
        throw new Error(
          'GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required to write to GitHub repositories. See backend/README.md § GitHub App setup.',
        );
      }

      try {
        const installationClient = await this.getInstallationClientForRepo(
          user,
          storageRef,
        );
        if (installationClient) {
          clients.githubClient = installationClient;
        }
      } catch (err) {
        console.warn('GitHub installation token unavailable:', err.message);
        throw err;
      }
    }

    if (!clients.githubClient && clients.githubUserClient) {
      clients.githubClient = clients.githubUserClient;
    }

    const driveClient = this.getGoogleDriveClient(user);
    if (driveClient) {
      clients.driveClient = driveClient;
    }

    return clients;
  }

  /**
   * Passport authenticate helper for auth routes.
   * @param {object} [options]
   */
  authenticateGitHub(options = {}) {
    return passport.authenticate('github', { session: true, ...options });
  }

  /**
   * Re-serialize the session user after in-memory mutations (e.g. storage attach,
   * scan index update).
   * @param {import('express').Request} req
   */
  persistUser(req) {
    return new Promise((resolve, reject) => {
      req.login(req.user, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      });
    });
  }
}

module.exports = AuthService;
