/**
 * Route mounting helper. Keeps `app.js` free of `/api/...` strings so
 * each router owns its own URL prefix.
 */
const makeScanRouter = require('./scan');
const makeProblemsRouter = require('./problems');
const makeAuthRouter = require('./auth');

/**
 * @param {import('express').Express} app
 * @param {{
 *   scanController: import('../controllers/scanController'),
 *   authService: import('../services/authService'),
 *   storageService: import('../services/storageService'),
 * }} deps
 */
function mountRoutes(app, { scanController, authService, storageService }) {
  // Session + passport once for all API routes (scan needs req.user too).
  app.use(...authService.middleware());

  app.use('/api/auth', makeAuthRouter({ authService, storageService }));
  app.use('/api', makeScanRouter(scanController));
  app.use('/api/problems', makeProblemsRouter(scanController));
}

module.exports = mountRoutes;
