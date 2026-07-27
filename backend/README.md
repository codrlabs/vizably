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

**Phase 1 limitation — in-memory sessions:** `express-session` uses the default
MemoryStore. Restarts log everyone out; multiple server instances do not share
sessions. Switch to a persistent store (Redis, etc.) before production deploy.

Phase 5 placeholders (`JWT_SECRET`, `DATABASE_URL`) remain in
[`.env.example`](.env.example) comments only.

### GitHub App setup (Phase 1)

Phase 0 locked **GitHub App** (not a classic OAuth App) for least-privilege,
per-repo access. For local development, **each developer creates their own
personal GitHub App** and puts the credentials in `backend/.env` — nothing is
shared via the repo.

**Local dev (do this now)**

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Set **Callback URL** to `http://localhost:3000/api/auth/github/callback`.
3. Under **Permissions**, grant at least **Contents: Read & write** and
   **Metadata: Read** (per the auth/storage design). Optionally add **Account →
   Email addresses: Read-only** if you want the dashboard to show your GitHub
   email; sign-in works without it. Vizably writes files via a **single Git commit** when the
   installation token can use the Git Database API, and falls back to the
   **Contents API** when needed (empty repos / restricted tokens).
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

Install the app on your account and select the repos you want to test with when
prompted during sign-in. If setup fails with **Resource not accessible by
integration**, your app installation likely still has **Contents: Read** only:

1. GitHub App → **Permissions** → **Repository permissions** → **Contents:
   Read and write** → **Save changes**
2. Open [Installed GitHub Apps](https://github.com/settings/installations) →
   **Configure** your Vizably app → **Accept** the permission upgrade if prompted
3. Confirm `vizably-scans` (or your target repo) is checked under repository access
4. Sign out of Vizably and sign in again (fresh OAuth token)

**Production (TBD — finalize before shipping Vizably)**

The personal apps above are for **testing only**. Before Vizably runs on a
real domain, the team must register a **project-owned GitHub App** (under the
codrlabs/vizably org or equivalent) with:

- Production callback URL(s) on the deployed backend (e.g.
  `https://api.vizably.example/api/auth/github/callback`)
- The same permission model (`Contents: rw`, `Metadata: r`)
- Client ID/secret stored in deployment secrets — **never** committed to git

See also [`docs/guides/auth_storage_guide/githubGoogleAuthStorageImplementation.md`](../docs/guides/auth_storage_guide/githubGoogleAuthStorageImplementation.md) § OAuth App Configuration.

### Google OAuth setup (Phase 3)

Phase 0 locked **`drive.file` only** (no `drive.metadata.readonly`). Users pick
an existing folder with the **Google Picker** (client-side); the backend never
lists Drive folders.

1. [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. **APIs & Services → Library** → enable **Google Drive API** and **Google Picker API**.
3. **APIs & Services → OAuth consent screen** → External (or Internal for Workspace).
   Add scopes: `openid`, `email`, `profile`, and
   `https://www.googleapis.com/auth/drive.file`.
   Choose a **publishing status**:
   - **Testing** — only emails under **Test users** can sign in. Add your own
     Google account there (or use **Internal** for Workspace). Missing yourself
     from Test users causes Google’s **`Error 403: access_denied`**.
   - **In production** — any Google account can start the consent flow. Until
     Google **verifies** the app for `drive.file` (a sensitive scope), users see
     an **unverified app** warning; for local/dev click **Advanced → Go to
     {app} (unsafe)** and continue. Real public traffic needs OAuth verification
     (privacy policy, demo video, scope justification) — submit that before
     shipping Vizably to end users.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID** →
   Application type **Web application**.
   - Authorized JavaScript origins: `http://localhost:5173` (required for
     Picker) and `http://localhost:3000` if needed.
   - Authorized redirect URI:
     `http://localhost:3000/api/auth/google/callback`
5. Copy Client ID + Client secret into `backend/.env`:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback`
6. Create a **Browser API key** for Picker (see below) → `GOOGLE_PICKER_API_KEY`.
7. Copy the **Project number** from **IAM & Admin → Settings** into
   `GOOGLE_CLOUD_PROJECT_NUMBER` (digits only). Picker `setAppId` needs this for
   `drive.file`; a wrong value often shows a **blank white Picker**. The OAuth
   client id prefix is usually the same number — set it explicitly if unsure.

**Troubleshooting Google sign-in**

| Symptom | Likely cause | Fix |
| ------- | ------------ | --- |
| `Error 403: access_denied` while status is **Testing** | Account not a test user | [Consent screen](https://console.cloud.google.com/apis/credentials/consent) → **Test users** → add your Gmail → retry (incognito if Google cached a deny) |
| `Error 403: access_denied` after publish | Cached deny, wrong project, or scope not on consent screen | Confirm scopes include `drive.file`; redirect URI matches `.env`; retry in a fresh browser profile |
| “Google hasn’t verified this app” | Published but unverified (`drive.file`) | Expected for local/dev — use **Advanced → Continue**; submit verification before production launch |
| `redirect_uri_mismatch` | Callback URL not registered | Add exactly `http://localhost:3000/api/auth/google/callback` on the OAuth client |
| Picker opens **blank / white** | Restricted API key, wrong project number, or missing JS origin | Picker no longer sends `GOOGLE_PICKER_API_KEY` by default (session OAuth token is enough). Ensure `GOOGLE_CLOUD_PROJECT_NUMBER` and OAuth **Authorized JavaScript origins** include `http://localhost:5173`. Close DevTools if the iframe stays blank. |
| Picker: **“The API developer key is invalid”** | Key restrictions reject the Vite origin | Leave `GOOGLE_PICKER_API_KEY` unused for Picker (current default). If you force `useDeveloperKey`, fix referrers / enable **Google Picker API**. Create-folder can still work (OAuth-only). |
| `Invalid field selection etag` | Old Drive client requesting `fields=etag` | Fixed in storage service — Drive v3 returns ETag only on HTTP headers |

`GET /api/auth/config` returns
`{ googleClientId, googlePickerApiKey, googleCloudProjectNumber }` for the
frontend Picker. Restrict the API key by HTTP referrer in Cloud Console.

#### Getting `GOOGLE_PICKER_API_KEY`

This is a **browser API key** (Credentials → API key), not the OAuth client
secret. Create-folder does not use it; only Google Picker does.

1. Cloud Console → **APIs & Services → Library** → enable **Google Picker API**
   (and **Google Drive API** if not already on) in the **same project** as your
   OAuth client.
2. **APIs & Services → Credentials → Create credentials → API key**.
3. Open the new key → **Application restrictions → HTTP referrers (web sites)**.
   Add exactly (Vite serves the Picker from the frontend origin):
   - `http://localhost:5173/*`
   - `http://127.0.0.1:5173/*` (if you open the app that way)
   - `http://localhost:3000/*` (optional)
   - your production frontend origin when you deploy (e.g. `https://app.vizably.example/*`)
4. **API restrictions → Restrict key** → include at least **Google Picker API**.
   If the Picker still fails, temporarily set API restrictions to **Don’t
   restrict key** to confirm the key itself is fine, then re-add Picker (+ Drive
   if needed).
5. Save → wait a minute for Google to propagate → copy the key into
   `backend/.env` as `GOOGLE_PICKER_API_KEY` → **restart the backend**.
6. Never commit the key. Treat it as public-ish (it ships to the browser) but
   always keep referrer + API restrictions on for real deploys.

Sign-in flow: `GET /api/auth/google` → Google consent → callback → frontend
`/connect?provider=google`. Folder selection is Picker-only; then
`POST /api/auth/storage/validate` and `POST /api/auth/storage` with
`storageRef: { id: "<folderId>", name: "…" }`.

## Endpoints

| Method | Path                      | Notes                                          |
| ------ | ------------------------- | ---------------------------------------------- |
| GET    | `/health`                 | liveness probe                                 |
| GET    | `/api/auth/github`        | start GitHub OAuth                             |
| GET    | `/api/auth/github/callback` | GitHub OAuth callback                        |
| GET    | `/api/auth/google`        | start Google OAuth (`drive.file`)              |
| GET    | `/api/auth/google/callback` | Google OAuth callback                        |
| GET    | `/api/auth/config`        | `{ googleClientId, googlePickerApiKey, googleCloudProjectNumber }` |
| GET    | `/api/auth/google/token`  | session Google access token (Picker only)      |
| GET    | `/api/auth/storages`      | list GitHub repos (`?provider=github`)         |
| POST   | `/api/auth/storage/validate` | fit-check selected storage                  |
| POST   | `/api/auth/storage`       | load or init account storage                   |
| GET    | `/api/auth/user`          | current user profile (no tokens)               |
| GET    | `/api/auth/status`        | `{ authenticated, user }`                      |
| POST   | `/api/auth/logout`        | end session                                    |
| POST   | `/api/scan`               | run a live Puppeteer + axe-core scan           |
| GET    | `/api/scan-results?url=`  | re-run a scan for a URL (used by deep links)   |
| GET    | `/problems/:id`           | look up a single problem (legacy mock lookup)  |

## See also

- [`docs/plans/architecture-map.md`](../docs/plans/architecture-map.md) §6 — code architecture
- [`docs/guides/axecore-integration.md`](../docs/guides/axecore-integration.md) — `this`-binding bug pattern
