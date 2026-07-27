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

  router.get('/google', (_req, res) => {
    res.status(501).json({
      error: 'Google sign-in is not available until Phase 3',
    });
  });

  router.get('/google/callback', (_req, res) => {
    res.status(501).json({
      error: 'Google sign-in is not available until Phase 3',
    });
  });

  router.get('/storages', requireAuth, async (req, res) => {
    try {
      const provider = req.query.provider;
      if (provider !== 'github') {
        return res.status(400).json({
          error: 'Only provider=github is supported in Phase 1',
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
