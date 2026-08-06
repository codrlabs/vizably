# vizably on Vercel, free serverless deployment plan

**Status:** in progress on `feat/vercel-deploy` (branched off `fix/scan-wait-strategy`).
**PR base:** open against `fix/scan-wait-strategy`, not `main`, or the diff carries the scan
fix too. Once that merges, rebase with
`git rebase --onto main fix/scan-wait-strategy feat/vercel-deploy` — plain `git rebase main`
conflicts on the squashed duplicate.

## Goal

Ship vizably on Vercel's free Hobby tier, which fits because Codrlabs Open is genuinely
non commercial. One platform, no database, no Redis, no always on server. The frontend is
static, the backend runs as one Vercel serverless function, and a user's account still lives
in their own GitHub repo.

## The one hard problem, read this first

The backend keeps login state in an in memory `express-session` store. That cannot work on
serverless, because every function invocation is a fresh, isolated instance with no shared
memory, so the session vanishes between requests and OAuth never completes.

**The fix is a stateless cookie session.** We stop storing session data on the server and keep
it in a signed, httpOnly cookie instead. The OAuth token is already encrypted at rest by
`authService` (AES 256 GCM), so the cookie carries the encrypted blob plus a small profile and
the storage reference. No Redis, no database.

### But the session does not fit in a cookie today

`req.user.account.scans` holds the full scan index, and the dashboard reads it straight out of
the session (`App.jsx` → `toSavedScans`). In server memory that is free. In a 4KB cookie it is
fatal. Measured against the real index entry shape in `storageService.js`:

```
one scan index entry (JSON):  441 bytes
base session, base64 encoded: 816 bytes
  5 saved scans ->  3,764 bytes
  6 saved scans -> ~4,350 bytes   over the 4,096 byte browser limit
 10 saved scans ->  6,708 bytes
```

**The account breaks on the sixth saved scan.** Browsers drop an oversized cookie silently, so
there is no error on either side. The user just appears logged out, intermittently, and it
reads as a random auth bug.

So the scan list comes out of the session *before* the session becomes a cookie. That is the
right architecture regardless of Vercel: the user's repo is the source of truth and
`index.json` is a rebuildable cache. The session should never have carried it.

## How the pieces map to Vercel

| Piece today | On Vercel |
|-------------|-----------|
| `frontend/` Vite app | Static build, served from `frontend/dist` |
| `backend/` Express app | A Vercel **service** built from `backend/`, entry `index.js` unchanged |
| `express-session` (memory) | Stateless signed cookie session (`cookie-session`) |
| Scan list cached in the session | Fetched from `GET /api/scans`, backed by the user's repo |
| Puppeteer full package | `puppeteer-core` plus `@sparticuz/chromium` in the function |
| `/problems/:id` at the root | Remounted under `/api/problems/:id` |
| GitHub OAuth callback | Points at the Vercel production URL |

One function, not several. Vercel's per function limit is 250MB uncompressed and
`@sparticuz/chromium` is about 50MB, so it fits. If cold starts or bundle size become a
problem later we split the scan into its own function. Not now.

## Vercel Hobby limits, checked

From [the current docs](https://vercel.com/docs/functions/limitations):

- **Max duration: 300s** default and maximum. We cap at 60 deliberately — a runaway scan
  should fail fast rather than burn the free tier budget.
- **Memory: 2GB**, both default and maximum. Do **not** set `memory` in `vercel.json`; any
  value we could write would only lower it.
- **Bundle size: 250MB** uncompressed.

## Prerequisites

1. Vercel account (done).
2. The production GitHub App, or for a first preview, the existing personal GitHub App with
   its callback URL updated to the Vercel URL.
3. Env values ready: `SESSION_SECRET`, `ENCRYPTION_KEY`, `GITHUB_APP_CLIENT_ID`,
   `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `FRONTEND_ORIGIN`.

## Commit sequence

Seven commits in dependency order. Commits 1 and 2 make the session small enough to fit in a
cookie, commit 3 makes it a cookie, 4 to 6 are the Vercel plumbing, 7 is documentation. Each
commit stands on its own and leaves the suite green.

### 1. `refactor(auth): serve saved scans from storage, not the session`

Backend only. Response payloads are unchanged, so the frontend still works after this commit —
that is what makes it independently correct.

- In `routes/auth.js`, drop `scans` from what is assigned to `req.user.account`. Keep
  `accountId`, `settings`, `scanCount`. The HTTP response still returns the full list; it is
  only *persistence* we are removing.
- In `controllers/scanController.js`, stop assigning `saved.scans` onto the session user. Keep
  returning it in the response so the client can merge without a refetch.
- Add `GET /api/scans`, a `getSavedScans` method on `ScanController`. It reuses
  `authService.clientsFor` and `storageService.loadAccount`, which already returns
  `index.scans`. No new storage code.

### 2. `feat(frontend): fetch the saved scan list from the API`

- `listScans()` in `lib/apiClient.js`, following the existing `_request` pattern.
- `App.jsx` fetches the list once auth resolves a user with storage attached, and merges it
  with the existing `mergeAccountUpdate` helper.

`toSavedScans` and `mergeAccountUpdate` do not change — `user.account.scans` stays in client
state, only its source moves.

### 3. `refactor(auth): replace the in-memory session with a signed cookie`

Swap `express-session` for `cookie-session` in `authService.middleware()`. Three details that
are easy to get wrong:

- Keep the `SESSION_SECRET` guard; `authService.test.js` asserts it throws.
- Gate `secure` on `NODE_ENV`, or `vercel dev` over plain http never sets the cookie and every
  local auth test fails for the wrong reason.
- **Logout must change.** `req.session.destroy()` does not exist on `cookie-session`; use
  `req.session = null`. The test stub in `auth.test.js` needs the same update.

Passport 0.7 calls `session.regenerate` and `session.save`, which `cookie-session` has neither
of, because the cookie *is* the store. No op shims before `passport.initialize()` satisfy it.

### 4. `refactor(scan): resolve the browser lazily for serverless`

`require('puppeteer')` at module scope means Vercel's file tracer pulls the whole package plus
its downloaded Chromium into the bundle. Make the default lazy and environment aware, keeping
the constructor injectable so the test mocks are untouched: `puppeteer-core` plus
`@sparticuz/chromium` when `process.env.VERCEL` is set, full `puppeteer` otherwise. Preserve
the `PUPPETEER_EXECUTABLE_PATH` escape hatch the Alpine Dockerfile depends on, and move
`puppeteer` to `devDependencies`.

### 5. `refactor(routes): serve problems under /api`

`/problems` at the root would be swallowed by the SPA fallback and never reach the function. A
rewrite is the wrong tool — it would hand Express a path it does not mount. Remount at
`/api/problems`, which the route file's own comment already anticipates, and update
`apiClient.js` and the Vite proxy.

### 6. `build: deploy as two Vercel services`

The first attempt wrapped Express in an `api/` function and used rewrites to feed it. Running
`vercel link` rejected that outright: the CLI detects `frontend/` as Vite and `backend/` as
Express, and top-level `functions` / `installCommand` / `buildCommand` / `outputDirectory` are
invalid once services exist, because their owner is ambiguous.

Services are the right model and delete three workarounds — no `api/` directory, no wrapper
module, no path-restoration marker.

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "git": { "deploymentEnabled": false },
  "services": {
    "frontend": {
      "root": "frontend/",
      "framework": "vite",
      "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
    },
    "backend": {
      "root": "backend/",
      "framework": "express",
      "functions": { "**": { "maxDuration": 60 } }
    }
  },
  "rewrites": [
    { "source": "/api/(.*)", "destination": { "service": "backend" } },
    { "source": "/(.*)", "destination": { "service": "frontend" } }
  ]
}
```

- **`backend/index.js` is untouched.** Vercel supports the `app.listen()` pattern and wraps it;
  the build logs `Using index.js as the root entrypoint`.
- **A service receives the original path** — `/api/auth/status` arrives as `/api/auth/status`,
  which is why the existing mounts work unchanged. Routing into a service is final: an
  unmatched path returns that service's 404 rather than falling through.
- **`functions` is a glob scoped to the service.** Verified in the built output rather than
  assumed, after a bracketed filename silently matched nothing in the earlier attempt.
- **`PUPPETEER_SKIP_DOWNLOAD=true` lives in project settings, not `installCommand`** — the
  `VAR=value cmd` prefix is POSIX-only and breaks `vercel build` on Windows.
- **`git.deploymentEnabled: false`** so GitHub Actions is the only thing that can deploy.

`engines.node` moves to `backend/package.json`, since each service builds from its own root and
`@sparticuz/chromium` requires Node >= 22.17.

### 7. `docs: document the Vercel deployment`

`backend/.env.example` and `backend/README.md`: required env vars, the GitHub App callback
URL, and the `vercel dev` workflow.

## Keeping secrets out of the history

`.gitignore` already covers `.env`, `.env.*`, `*.pem`, `*.key` and `*-private-key*`, and the
only tracked env file is `backend/.env.example` with every value blank. That baseline is sound.
What this change adds:

- `.vercel/` must be ignored. It is project linkage, not secrets, but it does not belong here.
- `vercel env pull` writes `.env.local`, already matched by `.env.*`. Confirm before running it.
- `GITHUB_APP_PRIVATE_KEY` is a PEM. It goes in the Vercel dashboard only, never in
  `vercel.json`, which is public config and holds no values.
- Read `git diff --cached` on every commit, not just the file list.
- If a secret ever does land in a commit, amending only helps while the branch is unpushed.
  Once pushed the credential is burned and must be rotated — rewriting history does not
  un-leak it.

## Verification

Run after the commit it belongs to, not all at the end.

**After 1 and 2** — `npm test` in `backend/`, `npm run test:run` in `frontend/`. Then locally:
sign in, attach a repo, save a scan, reload the dashboard. The list still renders, now from
`GET /api/scans`.

**After 3, the make or break check** — sign in, then hard reload; the session must survive.
Save **seven or more scans**, reloading after each. That is the exact regression commits 1 and
2 exist to prevent; before them it failed at the sixth. Log out and confirm the cookie is gone
in DevTools and `/api/auth/status` returns `authenticated: false`.

**After 4** — `npm test` in `backend/`. `scanRunner.test.js` must pass untouched; if it needed
editing, the injection seam was broken. A real local scan still runs on full `puppeteer`.

**After 6** — `vercel dev` from the repo root. Landing page serves, a scan returns results, and
a deep link like `/dashboard` resolves through the SPA fallback.

**Deployed preview** — set env vars for Production and Preview, point the GitHub App callback
at `https://<domain>/api/auth/github/callback`. Preview URLs are random and will not pass
OAuth, so test auth on the production URL. Then the full round trip: sign in, pick a repo,
scan, confirm the files land in the GitHub repo, reload the dashboard. Finally scan a heavy
site like Stripe and confirm it completes or fails cleanly inside 60 seconds.

## Known limits, accepted

1. **Cold starts.** The first scan after idle spends a few seconds spinning up Chromium.
   Acceptable for a free tool.
2. **Very heavy pages** can still exceed 60 seconds. They fail with an error, not a crash.
3. **Cookie headroom.** The session measures ~906 bytes against a 4KB limit, and stays flat as
   scans accumulate. Anything added to the session user needs a size check;
   `tests/auth.test.js` pins it.
4. **Preview URLs and OAuth.** Random preview domains will not pass GitHub OAuth unless added
   to the App.
5. **Concurrent scans share one instance.** Fluid compute is on by default and multiplexes
   invocations, so simultaneous scans are the realistic memory ceiling on 2GB. The browser is
   closed in a `finally`, which bounds it per request; `"fluid": false` buys isolation if
   bursts ever bite.

## Why not Netlify

Checked, because there is an existing account with build minutes on the legacy plan. The
blocker is runtime, not build: **Netlify's synchronous functions cap at 10 seconds** on the
free tier (26s on Pro, by request), and a Puppeteer scan is Chromium start plus page load plus
axe injection — the branch this work sits on exists precisely because heavy sites were slow.
Background functions allow 15 minutes but return `202` immediately, which means a polling
architecture rather than a config change. Vercel Hobby allows 300s and we cap at 60.

The build-minutes concern is solved directly on Vercel: `vercel build` locally then
`vercel deploy --prebuilt` skips remote build entirely.

## Explicitly deferred, not in this pass

1. Moving storage fully client side so the browser talks to GitHub directly. The cookie session
   gets us live first; this is the next optimization.
2. Google Drive. Stays frozen on its branch until the GitHub experience is solid.
3. Splitting the scan into its own function. Only if bundle size or cold starts demand it.
4. npm workspaces. The root manifest declares only `engines`; merging lockfiles would disturb
   Docker for no gain here.
5. OAuth `state` for login-CSRF hardening. Pre-existing gap in `passport-github2` setup,
   unrelated to this deployment work, and worth its own change with a real OAuth round trip.
