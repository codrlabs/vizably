/**
 * Composition root. The ONE place we instantiate concrete classes and
 * wire them together. Everything else takes its dependencies via
 * arguments — that's what makes the layers unit-testable without a DI
 * framework. See docs/plans/architecture-map.md §6.5.
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const ScanController = require('./controllers/scanController');
const mountRoutes = require('./routes');
const ssrfGuard = require('./services/ssrfGuard');
const mockScanResults = require('./data/mockScanResults');
const ScanRunner = require('./services/scanRunner');
const AuthService = require('./services/authService');
const StorageService = require('./services/storageService');

const scanRunner = new ScanRunner();

/**
 * Build a fully-wired Express app. Exported separately from `index.js`
 * so tests can `request(buildApp())` without binding a port.
 *
 * @param {object} [overrides]  optional dep overrides for testing
 * @returns {import('express').Express}
 */
function buildApp(overrides = {}) {
  const app = express();

  // Vercel (and any reverse proxy) terminates TLS at the edge and forwards
  // plain http, so req.protocol is 'http' unless we honour X-Forwarded-Proto.
  // The cookie layer *throws* rather than send a Secure cookie over what it
  // believes is an unencrypted connection, which would break every
  // authenticated request in production while working fine locally.
  // 1 = trust exactly one proxy hop, rather than any client-supplied header.
  app.set('trust proxy', 1);

  const frontendOrigin =
    process.env.FRONTEND_ORIGIN || 'http://localhost:5173';
  app.use(cors({ origin: frontendOrigin, credentials: true }));
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'okay', message: 'Server is running!' });
  });

  const authService = overrides.authService || new AuthService();
  const storageService = overrides.storageService || new StorageService();

  const scanController =
    overrides.scanController ||
    new ScanController({
      mockScanResults: overrides.mockScanResults || mockScanResults,
      ssrfGuard: overrides.ssrfGuard || ssrfGuard,
      scanRunner: overrides.scanRunner || scanRunner,
      authService,
      storageService,
    });

  mountRoutes(app, { scanController, authService, storageService });

  return app;
}

// A named export rather than `module.exports = buildApp`. A bare function
// export has no single agreed shape once anything tries to bridge CommonJS and
// ESM — it becomes `.default` in some toolchains and the function itself in
// others. Naming it removes that ambiguity for every consumer.
exports.buildApp = buildApp;
