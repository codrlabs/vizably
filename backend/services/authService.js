/**
 * AuthService — Passport strategies, session middleware, token encryption,
 * and authenticated provider clients for the storage service.
 *
 * No user DB: the session payload (identity + encrypted tokens + attached
 * `storage`) is the user. Google uses `drive.file` only (Picker selects folders).
 */
const crypto = require('crypto');
const session = require('express-session');
const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { google } = require('googleapis');
const { Octokit } = require('@octokit/rest');

/** Phase 0 choice: openid/email/profile + drive.file (Picker flow). */
const GOOGLE_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/drive.file',
];

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
   * @param {string} [deps.googleClientId]
   * @param {string} [deps.googleClientSecret]
   * @param {string} [deps.googleCallbackUrl]
   * @param {string} [deps.googlePickerApiKey] browser key for Google Picker (frontend)
   * @param {string} [deps.googleCloudProjectNumber] Cloud project number for Picker setAppId
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
    this.googleClientId = deps.googleClientId ?? process.env.GOOGLE_CLIENT_ID;
    this.googleClientSecret =
      deps.googleClientSecret ?? process.env.GOOGLE_CLIENT_SECRET;
    this.googleCallbackUrl =
      deps.googleCallbackUrl ?? process.env.GOOGLE_REDIRECT_URI;
    this.googlePickerApiKey =
      deps.googlePickerApiKey ?? process.env.GOOGLE_PICKER_API_KEY ?? null;
    this.googleCloudProjectNumber =
      deps.googleCloudProjectNumber ??
      process.env.GOOGLE_CLOUD_PROJECT_NUMBER ??
      null;

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

  /** @param {string} fullName owner/repo */
  async _installationSetupMessage(fullName) {
    let installUrl = 'https://github.com/settings/installations';
    try {
      const appOctokit = new Octokit({ auth: this._createAppJwt() });
      const { data } = await appOctokit.rest.apps.getAuthenticated();
      if (data?.slug) {
        installUrl = `https://github.com/apps/${data.slug}/installations/new`;
      }
    } catch {
      // keep generic installations URL
    }

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

    if (
      this.googleClientId &&
      this.googleClientSecret &&
      this.googleCallbackUrl
    ) {
      passport.use(
        'google',
        new GoogleStrategy(
          {
            clientID: this.googleClientId,
            clientSecret: this.googleClientSecret,
            callbackURL: this.googleCallbackUrl,
            scope: GOOGLE_SCOPES,
          },
          (accessToken, refreshToken, profile, done) => {
            try {
              done(null, this._buildGoogleUser(accessToken, refreshToken, profile));
            } catch (err) {
              done(err);
            }
          },
        ),
      );
    }

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
   * @param {string} accessToken
   * @param {string | undefined} refreshToken
   * @param {import('passport-google-oauth20').Profile} profile
   */
  _buildGoogleUser(accessToken, refreshToken, profile) {
    const primaryEmail =
      profile.emails?.find((entry) => entry.verified)?.value ??
      profile.emails?.[0]?.value ??
      null;

    /** @type {{ accessToken: string, refreshToken?: string }} */
    const googleTokens = {
      accessToken: this.encrypt(accessToken),
    };
    if (refreshToken) {
      googleTokens.refreshToken = this.encrypt(refreshToken);
    }

    return {
      id: String(profile.id),
      provider: 'google',
      username: primaryEmail || profile.displayName || String(profile.id),
      displayName: profile.displayName || primaryEmail || String(profile.id),
      email: primaryEmail,
      avatarUrl: profile.photos?.[0]?.value ?? null,
      tokens: {
        google: googleTokens,
      },
      storage: null,
    };
  }

  /** True when Google OAuth env/deps are complete and the Passport strategy is registered. */
  isGoogleConfigured() {
    return Boolean(
      this.googleClientId && this.googleClientSecret && this.googleCallbackUrl,
    );
  }

  /** @private */
  _hasGoogleOAuthCredentials() {
    return this.isGoogleConfigured();
  }

  /** @private */
  _createGoogleOAuth2Client() {
    if (!this._hasGoogleOAuthCredentials()) {
      throw new Error(
        'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI are required',
      );
    }
    return new google.auth.OAuth2(
      this.googleClientId,
      this.googleClientSecret,
      this.googleCallbackUrl,
    );
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

    const sessionMiddleware = session({
      secret: this.sessionSecret,
      resave: false,
      saveUninitialized: false,
      name: 'vizably.sid',
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
      },
    });

    return [sessionMiddleware, passport.initialize(), passport.session()];
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
   * Authenticated Drive v3 client. Uses OAuth2.setCredentials (never GoogleAuth
   * with a raw access_token object).
   * @param {object} user session payload
   * @returns {import('googleapis').drive_v3.Drive | null}
   */
  getGoogleDriveClient(user) {
    const encryptedAccess = user?.tokens?.google?.accessToken;
    if (!encryptedAccess) {
      return null;
    }
    if (!this.googleClientId || !this.googleClientSecret || !this.googleCallbackUrl) {
      return null;
    }

    const oauth2 = this._createGoogleOAuth2Client();
    /** @type {{ access_token: string, refresh_token?: string }} */
    const credentials = {
      access_token: this.decrypt(encryptedAccess),
    };
    if (user.tokens.google.refreshToken) {
      credentials.refresh_token = this.decrypt(user.tokens.google.refreshToken);
    }
    oauth2.setCredentials(credentials);

    return google.drive({ version: 'v3', auth: oauth2 });
  }

  /**
   * Refresh an expired Google access token; updates `user.tokens.google` in place.
   * @param {object} user session payload (mutated)
   */
  async refreshGoogleToken(user) {
    const encryptedRefresh = user?.tokens?.google?.refreshToken;
    if (!encryptedRefresh) {
      const err = new Error('Google refresh token is not available for this user');
      err.code = 'GOOGLE_REFRESH_UNAVAILABLE';
      throw err;
    }

    const oauth2 = this._createGoogleOAuth2Client();
    oauth2.setCredentials({
      refresh_token: this.decrypt(encryptedRefresh),
    });

    const { credentials } = await oauth2.refreshAccessToken();
    if (!credentials.access_token) {
      throw new Error('Google token refresh did not return an access token');
    }

    user.tokens = user.tokens || {};
    user.tokens.google = user.tokens.google || {};
    user.tokens.google.accessToken = this.encrypt(credentials.access_token);
    if (credentials.refresh_token) {
      user.tokens.google.refreshToken = this.encrypt(credentials.refresh_token);
    }

    return user;
  }

  /**
   * Build provider clients for routes/controller → storage service.
   * When `storageRef` is provided and app signing credentials exist, prefer an
   * installation access token for repo-scoped reads/writes.
   * @param {object} user session payload
   * @param {object} [options]
   * @param {object} [options.storageRef]
   * @returns {Promise<{ githubClient?: import('@octokit/rest').Octokit, githubUserClient?: import('@octokit/rest').Octokit, driveClient?: import('googleapis').drive_v3.Drive }>}
   */
  async clientsFor(user, options = {}) {
    /** @type {{ githubClient?: import('@octokit/rest').Octokit, githubUserClient?: import('@octokit/rest').Octokit, driveClient?: import('googleapis').drive_v3.Drive }} */
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

    // Drive client keeps refresh_token on the OAuth2 client so googleapis can
    // refresh on 401; call refreshGoogleToken explicitly after auth errors.
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
   * Google OAuth — request offline access so we store a refresh token.
   * @param {object} [options]
   */
  authenticateGoogle(options = {}) {
    return passport.authenticate('google', {
      session: true,
      accessType: 'offline',
      prompt: 'consent',
      scope: GOOGLE_SCOPES,
      ...options,
    });
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
module.exports.GOOGLE_SCOPES = GOOGLE_SCOPES;
