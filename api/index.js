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
const app = buildApp();

/** Query key the vercel.json rewrite uses to carry the real path through. */
const PATH_PARAM = '__vzpath';

/**
 * Restore the pre-rewrite request path.
 *
 * Express routes on `req.url`, so it has to see `/api/auth/status` rather than
 * the rewrite destination. Reports differ on whether Vercel forwards the
 * original path or the rewritten one, and `vercel dev` is known to differ from
 * production here — so rather than depend on that, the rewrite carries the
 * path explicitly and this puts it back. Both behaviours end up identical, and
 * the marker is stripped so handlers never see it.
 *
 * @param {string} url raw `req.url`
 * @returns {string} the URL Express should route on
 */
function restorePath(url) {
  const parsed = new URL(url, 'http://localhost');
  const carried = parsed.searchParams.get(PATH_PARAM);

  // Only a request flattened onto /api can have lost its path, so the marker
  // is read there and nowhere else. A client may send the same parameter, but
  // on any other path it is stripped and ignored rather than allowed to steer
  // routing. (Even when honoured it only aliases a path the caller could have
  // requested directly — every route authenticates on its own.)
  const wasFlattened = parsed.pathname === '/api' && carried !== null;

  parsed.searchParams.delete(PATH_PARAM);
  const query = parsed.searchParams.toString();
  const pathname = wasFlattened ? `/api/${carried}` : parsed.pathname;

  return `${pathname}${query ? `?${query}` : ''}`;
}

module.exports = (req, res) => {
  req.url = restorePath(req.url);
  return app(req, res);
};
