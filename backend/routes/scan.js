/**
 * Scan-related routes:
 *   - POST /api/scan            (rate limited per IP / per user)
 *   - GET  /api/scan-results    (same limiter — it also runs a live scan)
 *   - GET  /api/scans
 *   - GET  /api/scans/:id
 *   - DELETE /api/scans/:id
 *
 * Only knows about HTTP shape. All logic lives in ScanController.
 *
 * @typedef {import('../controllers/scanController')} ScanController
 */
const { Router } = require('express');

/**
 * @param {ScanController} controller
 * @param {{ scanRateLimit?: import('express').RequestHandler[] }} [options]
 * @returns {import('express').Router}
 */
function makeScanRouter(controller, { scanRateLimit = [] } = {}) {
  const router = Router();
  router.post('/scan', ...scanRateLimit, controller.postScan);
  // Same middleware instances, so both routes draw on one shared budget.
  router.get('/scan-results', ...scanRateLimit, controller.getScanResults);
  router.get('/scans', controller.getSavedScans);
  router.get('/scans/:id', controller.getSavedScan);
  router.delete('/scans/:id', controller.deleteSavedScan);
  return router;
}

module.exports = makeScanRouter;
