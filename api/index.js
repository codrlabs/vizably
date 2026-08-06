/**
 * Vercel serverless entry — one function for the whole API.
 *
 * By itself this file only answers `/api` exactly; Vercel's `api/` directory
 * maps file paths to URL paths and supports a single dynamic segment, not
 * arbitrary depth. Catch-all filenames like `[...path].js` are a Next.js
 * convention and do not apply here. The `/api/(.*)` rewrite in vercel.json is
 * what routes every nested path to this function, which is the pattern
 * Vercel's own Express guide uses.
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
