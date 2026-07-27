/**
 * Auth routes — OAuth entrypoints, storage picker API, session profile.
 *
 * Mounted at `/api/auth` by `routes/index.js`. Session + passport middleware
 * are applied in `mountRoutes` so `/api/scan` can read `req.user` too.
 */
const { Router } = require('express');

/**
 * @param {object} deps
 * @param {import('../services/authService')} deps.authService
 * @param {import('../services/storageService')} deps.storageService
 * @returns {import('express').Router}
 */
function makeAuthRouter({ authService, storageService }) {
  const router = Router();
  const frontendOrigin =
    process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

  router.get('/github', (req, res, next) => {
    req.session.authProvider = 'github';
    authService.authenticateGitHub()(req, res, next);
  });

  router.get(
    '/github/callback',
    authService.authenticateGitHub({
      failureRedirect: `${frontendOrigin}/connect?provider=github&error=auth_failed`,
    }),
    (req, res) => {
      res.redirect(`${frontendOrigin}/connect?provider=github`);
    },
  );

  router.get('/google', (req, res, next) => {
    if (!authService.isGoogleConfigured()) {
      return res.status(503).json({
        error:
          'Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REDIRECT_URI.',
      });
    }
    req.session.authProvider = 'google';
    return authService.authenticateGoogle()(req, res, next);
  });

  router.get(
    '/google/callback',
    (req, res, next) => {
      if (!authService.isGoogleConfigured()) {
        return res.status(503).json({
          error: 'Google sign-in is not configured.',
        });
      }
      return authService.authenticateGoogle({
        failureRedirect: `${frontendOrigin}/connect?provider=google&error=auth_failed`,
      })(req, res, next);
    },
    (req, res) => {
      res.redirect(`${frontendOrigin}/connect?provider=google`);
    },
  );

  /**
   * Public config for client-side Google Picker (browser API key + OAuth client id).
   * Restrict the key by HTTP referrer in Cloud Console.
   */
  router.get('/config', (_req, res) => {
    return res.json({
      googleClientId: authService.googleClientId || null,
      googlePickerApiKey: authService.googlePickerApiKey || null,
      googleCloudProjectNumber: authService.googleCloudProjectNumber || null,
    });
  });

  /**
   * Short-lived Google access token for the Picker (session cookie auth).
   * Never logged; only returned to the signed-in browser.
   */
  router.get('/google/token', requireAuth, async (req, res) => {
    try {
      if (req.user?.provider !== 'google') {
        return res.status(400).json({ error: 'Not a Google session' });
      }
      if (!req.user?.tokens?.google?.accessToken) {
        return res.status(400).json({ error: 'Google access token unavailable' });
      }
      if (req.user.tokens.google.refreshToken) {
        try {
          await authService.refreshGoogleToken(req.user);
          await authService.persistUser(req);
        } catch {
          // Use the existing access token if refresh fails.
        }
      }
      return res.json({
        accessToken: authService.decrypt(req.user.tokens.google.accessToken),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to issue Google access token' });
    }
  });

  router.get('/storages', requireAuth, async (req, res) => {
    try {
      const provider = req.query.provider;
      if (provider === 'google') {
        return res.status(400).json({
          error:
            'Google folders are selected via Google Picker; listStorages is GitHub-only',
        });
      }
      if (provider !== 'github') {
        return res.status(400).json({
          error: 'Only provider=github is supported for listStorages',
        });
      }

      const clients = await authService.clientsFor(req.user);
      if (!clients.githubClient) {
        return res.status(400).json({ error: 'GitHub client is not available' });
      }

      const repos = await storageService.listGitHubRepos(clients.githubClient);
      return res.json({
        provider: 'github',
        storages: repos.map((repo) => ({
          id: repo.id,
          name: repo.full_name.split('/')[1],
          full_name: repo.full_name,
          private: repo.private,
          html_url: repo.html_url,
        })),
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Failed to list storages' });
    }
  });

  router.post('/storage/validate', requireAuth, async (req, res) => {
    try {
      const { provider, storageRef } = req.body || {};
      if (!provider || !storageRef) {
        return res.status(400).json({ error: 'provider and storageRef are required' });
      }

      const clients = await authService.clientsFor(req.user, {
        storageRef: req.body?.storageRef,
      });
      const result = await storageService.validateStorage(provider, storageRef, clients);
      return res.json(result);
    } catch (err) {
      console.error(err);
      return res.status(400).json({
        error: err.message || 'Failed to validate storage',
      });
    }
  });

  router.post('/storage', requireAuth, async (req, res) => {
    try {
      const { provider, storageRef, action } = req.body || {};
      if (!provider || !storageRef || !action) {
        return res.status(400).json({
          error: 'provider, storageRef, and action are required',
        });
      }
      if (action !== 'load' && action !== 'init') {
        return res.status(400).json({ error: 'action must be "load" or "init"' });
      }

      const clients = await authService.clientsFor(req.user, {
        storageRef: req.body?.storageRef,
      });
      let account;

      if (action === 'load') {
        account = await storageService.loadAccount(provider, storageRef, clients);
      } else {
        account = await storageService.initStorage(
          provider,
          storageRef,
          req.user,
          clients,
        );
      }

      req.user.storage = account.storageRef;
      req.user.account = {
        accountId: account.accountId,
        settings: account.settings,
        scanCount: account.scanCount,
        scans: account.index?.scans ?? [],
      };

      await authService.persistUser(req);

      return res.json({
        success: true,
        provider: account.provider,
        storage: account.storageRef,
        account: req.user.account,
      });
    } catch (err) {
      console.error(err);
      return res.status(400).json({ error: err.message || 'Failed to set up storage' });
    }
  });

  router.get('/user', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ error: 'Not authenticated' });
    }
    return res.json(sanitizeUser(req.user));
  });

  router.get('/status', (req, res) => {
    return res.json({
      authenticated: req.isAuthenticated(),
      user: req.isAuthenticated() ? sanitizeStatusUser(req.user) : null,
    });
  });

  router.post('/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) {
        return next(err);
      }
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          return next(destroyErr);
        }
        res.clearCookie('vizably.sid');
        return res.json({ success: true });
      });
    });
  });

  return router;
}

/** @param {import('express').Request} req */
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: 'Not authenticated' });
}

/** Strip tokens from the session user before responding. */
function sanitizeUser(user) {
  if (!user) {
    return null;
  }
  const { tokens: _tokens, ...safe } = user;
  return safe;
}

function sanitizeStatusUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    provider: user.provider,
    storage: user.storage ?? null,
  };
}

module.exports = makeAuthRouter;
