# Vizably — Backend

Express API that runs real accessibility scans: `services/scanRunner.js`
drives a headless Chromium via Puppeteer, injects axe-core into the
target page, and returns results transformed into the shared
`ScanResult` shape. The mock fixture in `backend/data/mockScanResults.js`
remains only as the data source for the legacy `/problems/:id` lookup
and for tests.

## Layout

```
backend/
├── index.js                    # Bootstrap: builds app, listens on $PORT
├── app.js                      # Composition root (DI wiring)
├── routes/
│   ├── index.js                # Mount /api/auth, /api, and /problems routers
│   ├── auth.js                 # OAuth + storage picker API
│   ├── scan.js                 # POST /api/scan, GET /api/scan-results
│   └── problems.js             # GET /problems/:id
├── controllers/
│   └── scanController.js       # Request/response only — class with bound methods
├── services/
│   ├── authService.js          # Passport, sessions, token encryption
│   ├── storageService.js       # Portable-account GitHub adapter
│   ├── scanRunner.js           # Puppeteer + axe-core scan lifecycle
│   ├── axeTransformer.js       # Pure: axe results → API ScanResult shape
│   └── ssrfGuard.js            # Pure: URL allow/deny rules
├── data/
│   └── mockScanResults.js      # Legacy fixture (problems route + tests)
├── tests/                      # node:test + supertest
│   ├── health.test.js
│   ├── scan.test.js
│   ├── ssrfGuard.test.js
│   └── axeTransformer.test.js
├── .env.example
├── Dockerfile
└── package.json
```

## Run

```bash
cd backend
npm install
npm run dev      # nodemon
npm start        # plain node
npm test         # node --test
```

API is on `http://localhost:3000` by default.

## Environment

Copy [`.env.example`](.env.example) to `.env` and fill in values before running
auth (Phase 1).

| Var                      | Default                  | Meaning                                      |
| ------------------------ | ------------------------ | -------------------------------------------- |
| `PORT`                   | `3000`                   | Port the API listens on                      |
| `FRONTEND_ORIGIN`        | `http://localhost:5173`  | CORS allow-origin for the SPA                |
| `SESSION_SECRET`         | —                        | Session cookie signing key (min 32 chars)    |
| `GITHUB_APP_CLIENT_ID`   | —                        | GitHub App OAuth **Client ID**               |
| `GITHUB_APP_CLIENT_SECRET` | —                      | GitHub App OAuth **Client secret**           |
| `GITHUB_REDIRECT_URI`    | `http://localhost:3000/api/auth/github/callback` | GitHub OAuth callback URL |
| `ENCRYPTION_KEY`         | —                        | AES-256-GCM key for tokens at rest (base64)  |

Generate secrets (required — the server refuses to start without both):

```bash
openssl rand -base64 32   # SESSION_SECRET and/or ENCRYPTION_KEY
```

`index.js` throws on startup if either is missing. Tests inject their own values
via `tests/helpers/testEnv.js`; never commit real secrets to the repo.

**Sessions are a signed cookie, not a server-side store.** `cookie-session`
keeps the whole payload in a signed `httpOnly` cookie, so there is no MemoryStore
to lose on restart and no Redis to run — which is what lets the API work on
serverless, where every request gets a fresh, isolated instance.

The tradeoff is a hard **4KB budget**. The payload is currently ~900 bytes and
stays flat no matter how many scans an account has, because the scan list is
fetched from the user's own store via `GET /api/scans` rather than carried on the
session. Anything new added to the session user needs a size check —
`tests/auth.test.js` pins the limit. Browsers drop an oversized cookie silently,
so overflowing it looks like a random intermittent logout, not an error.

Google OAuth and `GOOGLE_PICKER_API_KEY` are deferred to Phase 3 — not read by
the server yet. Phase 5 placeholders (`JWT_SECRET`, `DATABASE_URL`) remain in
[`.env.example`](.env.example) comments only.

### GitHub App setup (Phase 1)

Phase 0 locked **GitHub App** (not a classic OAuth App) for least-privilege,
per-repo access. For local development, **each developer creates their own
personal GitHub App** and puts the credentials in `backend/.env` — nothing is
shared via the repo.

**Local dev (do this now)**

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Set **Callback URL** to `http://localhost:3000/api/auth/github/callback`.
3. Under **Permissions**, grant at least:
   - **Contents: Read & write**
   - **Metadata: Read**
   - **Administration: Read & write** — required so Vizably can create a private
     empty repo during Connect onboarding via the user access token
     (`POST /user/repos`). GitHub documents this as UAT-only; installation
     tokens cannot create user-owned repos.
   Optionally add **Account → Email addresses: Read-only** if you want the
   dashboard to show your GitHub email; sign-in works without it. Vizably writes
   files via a **single Git commit** when the installation token can use the Git
   Database API, and falls back to the **Contents API** when needed (empty repos
   / restricted tokens).

   After adding **Administration**, open
   [Installed GitHub Apps](https://github.com/settings/installations), accept the
   permission upgrade, then sign out and sign in again so the user access token
   picks up the new permission.
4. Create the app, then open **OAuth credentials** and copy the **Client ID**
   and generate a **Client secret**.
5. Add to `backend/.env`:
   - `GITHUB_APP_CLIENT_ID` — the OAuth Client ID (not the numeric App ID)
   - `GITHUB_APP_CLIENT_SECRET`
   - `GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/github/callback`
   - `GITHUB_APP_ID` — numeric **App ID** from the app **General** settings page
   - `GITHUB_APP_PRIVATE_KEY` — PEM from **Private keys** (Generate a private key).
     Repo writes use **installation tokens** signed with this key; OAuth client
     credentials alone are not enough for Contents writes.
   - `SESSION_SECRET` and `ENCRYPTION_KEY` (see above)

**Install the app on the account that will own the scans repo**, which is the
account you sign in as — not only on an organisation. Repository *creation* goes
through your user access token, and that token can only act where an
installation exists, so with the app installed on an org alone the Connect
screen reports "GitHub App cannot create repositories" even though
Administration is granted. The permission is on the app; the missing piece is
the installation.

Creating a repo and writing into it also use **different credentials**, which is
worth knowing because they fail at different moments:

| Step | Credential | Needs |
|---|---|---|
| Create the scans repo | user access token | an installation on that account |
| Write scan files | installation token | that repo selected in the installation |

So the order is: install on your own account (selecting any repo, since the
scans repo does not exist yet), sign out and back in so the token sees the new
installation, let Connect create the repo, then add that repo to the
installation's selected repositories. Choosing **All repositories** collapses
those steps at the cost of granting access to everything you own.

If setup fails with **Resource not accessible by integration**, the installation
likely still has **Contents: Read** only:

1. GitHub App → **Permissions** → **Repository permissions** → **Contents:
   Read and write** → **Save changes**
2. Open [Installed GitHub Apps](https://github.com/settings/installations) →
   **Configure** your Vizably app → **Accept** the permission upgrade if prompted
3. Confirm `vizably-scans` (or your target repo) is checked under repository access
4. Sign out of Vizably and sign in again (fresh OAuth token)

**Production**

The personal apps above are for **local testing only**. Production uses a
separate, org-owned GitHub App registered under **codrlabs**, so the team owns
it rather than an individual.

| Setting | Value |
|---|---|
| Callback URL | `https://vizably.vercel.app/api/auth/github/callback` |
| Homepage URL | `https://vizably.vercel.app` |
| Permissions | `Contents: rw`, `Metadata: r`, `Administration: rw` |
| Where can this app be installed? | **Any account** |
| Expire user authorization tokens | **Off** |
| Webhook | **Inactive** |

Three of those are easy to get wrong, and each fails in a way that does not
point at itself:

- **"Any account"**, not "Only on this account". Vizably's whole model is users
  connecting storage they own, so restricting installation to the org locks out
  every external user. It only surfaces when someone outside codrlabs tries.
- **Token expiry off.** GitHub defaults it *on*, which issues 8-hour user tokens
  plus a `refresh_token`. Vizably discards the refresh token — see the
  `_refreshToken` parameter in `authService.registerStrategies` — so expiring
  tokens would break every signed-in user's storage roughly 8 hours after
  sign-in, with no error naming the cause.
- **Webhook inactive.** There is no webhook endpoint, and GitHub makes the
  webhook URL a required field while it is active.

Credentials live in Vercel project settings (Production), never in git:
`GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_ID`,
`GITHUB_APP_PRIVATE_KEY`, `GITHUB_REDIRECT_URI`.

The private key is the App proving it is *itself*, which is separate from a user
authorizing it: the OAuth client credentials produce a user token, while the key
signs the RS256 JWT that is exchanged for the **installation token** used to
write scan files. A user token alone cannot write Contents. GitHub shows the PEM
once, so keep a copy in the team password manager; an App can hold several keys,
so a lost or leaked one is replaced by generating a new key and deleting the old,
without touching the Client ID.

See also [`docs/guides/auth_storage_guide/githubGoogleAuthStorageImplementation.md`](../docs/guides/auth_storage_guide/githubGoogleAuthStorageImplementation.md) § OAuth App Configuration.

## Endpoints

| Method | Path                      | Notes                                          |
| ------ | ------------------------- | ---------------------------------------------- |
| GET    | `/health`                 | liveness probe                                 |
| GET    | `/api/auth/github`        | start GitHub OAuth                             |
| GET    | `/api/auth/github/callback` | GitHub OAuth callback                        |
| GET    | `/api/auth/google`        | stub (501) until Phase 3                       |
| GET    | `/api/auth/storages`      | list GitHub repos (`?provider=github`)         |
| GET    | `/api/auth/storage/name-availability` | check repo name (`?name=&provider=github`) |
| POST   | `/api/auth/storage/create` | create a private empty GitHub repo (UAT)     |
| POST   | `/api/auth/storage/validate` | fit-check selected storage                  |
| POST   | `/api/auth/storage`       | load or init account storage                   |
| GET    | `/api/auth/user`          | current user profile (no tokens)               |
| GET    | `/api/auth/status`        | `{ authenticated, user }`                      |
| POST   | `/api/auth/logout`        | end session                                    |
| POST   | `/api/scan`               | run a live Puppeteer + axe-core scan           |
| GET    | `/api/scan-results?url=`  | re-run a scan for a URL (used by deep links)   |
| GET    | `/api/scans`              | list saved scans from the user's store         |
| GET    | `/api/scans/:id`          | load one saved report from the user's store    |
| GET    | `/api/problems/:id`       | look up a single problem (legacy mock lookup)  |

Every backend path lives under `/api` so one serverless function can claim the
prefix; anything outside it is answered by the static SPA instead.

## Deploying to Vercel

The frontend builds to a static bundle and the whole Express app runs as one
function at [`api/index.js`](../api/index.js), built by `@vercel/node`.

```
request -> filesystem (real static assets win)
        -> /api/*  -> the function   (Express, via the /api rewrite)
        -> /*      -> index.html     (SPA fallback)
```

**Do not switch this to Vercel's `services` model**, even though the CLI
detects `frontend/` as Vite and `backend/` as Express and will offer to. That
path builds the backend by *bundling* it with rolldown, which wrapped
`app.js` in a lazy CommonJS shim and handed the entry an empty object — every
route returned 500 with `buildApp is not a function`, and no export shape fixed
it. `@vercel/node` **traces and copies** files instead, so the code that runs is
the code you wrote. The tell, if it ever regresses: local modules fail to
resolve inside the function while npm packages resolve fine.

`framework: null` in `vercel.json` is load-bearing — it overrides the project's
framework preset, which Vercel pins to `services` the moment you link with
services declared.

Set these in the Vercel dashboard for **Production and Preview** — never in
`vercel.json`, which is public config and holds no values:

`SESSION_SECRET`, `ENCRYPTION_KEY`, `GITHUB_APP_CLIENT_ID`,
`GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`,
`GITHUB_REDIRECT_URI`, `FRONTEND_ORIGIN`.

Point the GitHub App callback at
`https://<your-domain>/api/auth/github/callback`. Preview deploys get random
URLs that will not pass OAuth unless each is added to the App, so test auth on
the production URL.

`PUPPETEER_SKIP_DOWNLOAD=true` is set there too. It skips the ~170MB browser
download during the build. It is not a secret and not needed for correctness —
it lives in project settings rather than in `installCommand` because the
`VAR=value cmd` prefix is POSIX-only and breaks `vercel build` on Windows.

### Deploys are gated on tests

`git.deploymentEnabled` is `false`, so Vercel never deploys on its own. The
only route to production is [`deploy.yml`](../.github/workflows/deploy.yml),
which runs the full suite and only then does `vercel pull` / `build` /
`deploy --prebuilt`. Without that flag both Vercel and the workflow would
deploy the same commit and the ungated one could land first.

Run it locally the way production does:

```bash
vercel build    # builds both services exactly as the platform would
vercel dev      # serves them together
```

`vercel env pull` writes `.env.local`, which `.gitignore` already covers.

### Verified against a real build

Confirmed on a preview deployment and by inspecting `.vercel/output`, not
assumed:

- `/health`, `/api/auth/status` and `/api/problems/:id` return 200,
  `/api/scans` 401s while unauthenticated, `/dashboard` falls through to the
  SPA, and `POST /api/scan` completes a real Chromium scan returning axe-core
  results.
- The function's `backend/` directory contains `app.js` — plain traced source.
  If it ever contains `app.cjs` instead, something has switched it back to a
  bundled build and the API will break.
- **`@octokit/rest` is pinned to 20.1.1, the last CommonJS release.** v21+ are
  ESM-only, and Vercel precompiles functions to bytecode, a path that cannot
  `require()` an ES module even on Node 24, where plain `node` can. Locally the
  same `require` works, so an upgrade here passes every test and then fails
  only in production. Every endpoint used (repos, git, apps, users) is
  unchanged in 20.x.
- `maxDuration: 60` reaches the built function config; the `functions` key is a
  **glob**, and an earlier bracketed filename matched nothing and silently left
  the function on the plan default of 300s.
- Runtime resolves to `nodejs24.x`. `@sparticuz/chromium` requires
  **Node ≥ 22.17**, so this matters; `frontend/` and `backend/` stay separate
  packages with their own lockfiles.
- `memory` cannot be set in `vercel.json` once Fluid compute is on (dashboard
  only), and Hobby's default is already its 2GB maximum.
- `app.set('trust proxy', 1)` in `app.js` is required, not cosmetic. Vercel
  terminates TLS at the edge and forwards plain http; without it `req.protocol`
  stays `http`, and the cookie layer throws rather than send a `Secure` cookie,
  breaking every authenticated request in production while passing locally.
- `app.set('trust proxy', 1)` in `app.js` is required, not cosmetic. Vercel
  terminates TLS at the edge and forwards plain http; without it `req.protocol`
  stays `http` and the cookie layer throws rather than send a `Secure` cookie,
  breaking every authenticated request in production while passing locally.
- The scanner picks its browser by **probing, not by platform flag**. It uses
  the full `puppeteer` when `executablePath()` points at a binary that exists —
  true for local dev and for Docker via `PUPPETEER_EXECUTABLE_PATH` — and falls
  back to `puppeteer-core` with `@sparticuz/chromium` otherwise. Keying off
  `VERCEL` would break silently if a project ever disabled system environment
  variables. Measured weight is 13 MB + 66 MB against a 250 MB limit;
  `node_modules/puppeteer` is only ~155 KB, because the browser lives in
  `~/.cache/puppeteer`, outside the traced tree.

### Security notes

- **The session cookie is signed, not encrypted.** `cookie-session` base64
  encodes the payload, so a user can read their own profile out of it. That is
  their own data, the cookie is `httpOnly`, and the GitHub token inside stays
  AES-256-GCM encrypted under `ENCRYPTION_KEY`. Do note the posture change from
  a server-side store: the token *ciphertext* now travels to the browser, so
  treat `ENCRYPTION_KEY` as the thing that protects it, and rotating that key
  invalidates every session.
- **The Passport `regenerate`/`save` shims do not reintroduce session
  fixation.** Passport calls `regenerate()` so a pre-set session id cannot
  survive login. There is no server-side id here — the cookie's *contents* are
  the session, and they are re-signed on login, so an attacker who planted a
  pre-login cookie learns nothing and holds a value that no longer
  authenticates. Nothing written before login is read after it either: the one
  pre-login key, `authProvider`, is never read back.
- **Fluid compute shares one instance across concurrent invocations**, and it
  is on by default. Each scan holds a Chromium process, so a burst of
  simultaneous scans is the realistic memory ceiling on a 2 GB instance. The
  browser is always closed in a `finally`, which bounds it per request; if
  bursts ever cause trouble, set `"fluid": false` in `vercel.json` for
  one-request-per-instance isolation.

## See also

- [`docs/plans/architecture-map.md`](../docs/plans/architecture-map.md) §6 — code architecture
- [`docs/guides/axecore-integration.md`](../docs/guides/axecore-integration.md) — `this`-binding bug pattern
