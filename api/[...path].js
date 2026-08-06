/**
 * Vercel serverless entry — one catch-all function for the whole API.
 *
 * A file at `api/[...path].js` claims every `/api/*` path, and Vercel checks
 * functions before rewrites, so the SPA fallback in vercel.json cannot shadow
 * it. Express already mounts its routes under `/api`, and Vercel passes the
 * original path through, so requests arrive exactly as they do in local dev.
 *
 * No `serverless-http` wrapper: Vercel's Node runtime invokes the export as
 * `(req, res)`, which is precisely an Express app's signature.
 */
const buildApp = require('../backend/app');

// app.js exports the buildApp *factory*, not an assembled app — it takes an
// overrides object so tests can inject fakes. index.js, which holds these
// guards and the listen call, is only used by local dev and never loads here.
if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is required');
}
if (!process.env.ENCRYPTION_KEY) {
  throw new Error('ENCRYPTION_KEY is required');
}

// Built once at module scope so warm invocations reuse it.
module.exports = buildApp();
