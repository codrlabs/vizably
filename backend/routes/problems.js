/**
 * Problem-detail routes:
 *   - GET /api/problems/:id
 *
 * Everything the backend serves lives under /api so a single serverless
 * function can claim that prefix; a bare /problems would be taken by the
 * static SPA fallback and never reach the server.
 *
 * May gain a richer per-violation payload from axe-core later.
 */
const { Router } = require('express');

/**
 * @param {import('../controllers/scanController')} controller
 * @returns {import('express').Router}
 */
function makeProblemsRouter(controller) {
  const router = Router();
  router.get('/:id', controller.getProblem);
  return router;
}

module.exports = makeProblemsRouter;
