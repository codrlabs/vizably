# Implementation TODO — GitHub/Google Auth & Portable Storage

> Checklist for the design in
> [`githubGoogleAuthStorageImplementation.md`](githubGoogleAuthStorageImplementation.md)
> and the on-disk contract in
> [`accountStorageContract.md`](accountStorageContract.md).
> Verify each item against the actual code before ticking it.
>
> **Model in one line:** the user's GitHub repo / Drive folder *is* the account.
> Flow is **browse → select → validate (fit-check) → load or init**. No project DB.

---

## Phase 0: Decisions to lock before coding

- [x] **GitHub**: classic OAuth App (`repo` = broad) **or** GitHub App
      (per-repo `Contents:rw` + `Metadata:r`)? Pick one; it changes the picker UX.
  - **Choice:** GitHub App
- [x] **Google**: Google Picker (`drive.file`, recommended) **or** app-rendered
      browse (`drive.metadata.readonly`)? Pick one; document the privacy cost.
  - **Choice:** Google Picker
- [x] **Identity**: possession-based (default) vs. subject-bound load. Default =
      possession-based; record `storage.ownerId` regardless.
  - **Choice:** Possession-based

---

## Implementation sequencing

Ship **GitHub first**, **Google second** — not both providers in one PR. Phase 0
choices for both providers still stand; Google is deferred, not dropped.

- **Phase 1–2:** auth + storage abstraction with **GitHub adapter only**.
- **Routes, controller, and frontend** stay provider-neutral; Google surfaces as
  a stub behind the same interface.
- **Phase 3:** Google backend adapter + Google Picker (one adapter, not a rewrite).
- **GitHub App** means GitHub's OAuth registration type (per-repo least privilege),
  not the vizably storage app. Storage stays provider-agnostic.

---

## Phase 1: Backend — Auth & Storage (GitHub)

### Dependencies

- [x] `npm install express-session passport passport-github2 @octokit/rest dotenv` (in `backend/`)
- [x] `npm install --save-dev @types/express-session @types/passport @types/passport-github2`
- [x] Defer Google deps (`passport-google-oauth20`, `googleapis`) to Phase 3

### Environment

- [x] Add vars to `.env.example` (`SESSION_SECRET`, GitHub App id+secret, redirect
      URIs, `ENCRYPTION_KEY`) and document in `backend/README.md`
- [x] Generate `ENCRYPTION_KEY` with `openssl rand -base64 32`
- [x] Defer `GOOGLE_PICKER_API_KEY` and Google OAuth vars to Phase 3
- [ ] **Dev:** each developer creates a **personal GitHub App** for local testing
      (callback `http://localhost:3000/api/auth/github/callback`; Client ID +
      secret in local `backend/.env` only). See `backend/README.md` § GitHub App setup.
- [ ] **Production (TBD):** finalize a **project-owned** codrlabs/vizably GitHub App
      with production callback URL(s) on the deployed domain before shipping.

### Auth Service (`backend/services/authService.js`)

- [x] Passport GitHub strategy + session middleware (Google strategy stubbed)
- [x] AES-256-GCM encrypt/decrypt using `ENCRYPTION_KEY`
- [x] `middleware()` → `[session(), passport.initialize(), passport.session()]`
- [x] `getGitHubClient(user)` → authenticated Octokit
- [x] `getGoogleDriveClient(user)` → stub (throws or returns `null` until Phase 3)
- [x] `refreshGoogleToken(user)` → stub until Phase 3
- [x] `clientsFor(user)` helper → `{ githubClient?, driveClient? }` for routes/controller
- [x] `deserializeUser` returns the session payload (identity + encrypted tokens +
      attached `storage`); **no user DB** in this model

### Storage Service (`backend/services/storageService.js`) — speaks the contract

Provider-neutral interface; **GitHub adapter implemented**, Google adapter stubbed.

- [x] **Browse**: `listGitHubRepos(githubClient)` → `{ id(nodeId), full_name, private, html_url }[]`
      (Google folders come from the client-side Picker in Phase 3, not the backend)
- [x] **Fit-check**: `validateStorage(provider, storageRef, clients)` →
      `{ status, reason?, capabilities, manifestSummary? }` per
      [accountStorageContract.md → Validation rules](accountStorageContract.md#validation-rules-the-fit-check)
- [x] **Load**: `loadAccount(provider, storageRef, clients)` — read manifest +
      `scans/index.json`, **reconcile drift** by rebuilding from `scans/*.json`
- [x] **Init**: `initStorage(provider, storageRef, owner, clients)` — **revalidate**,
      then conditionally create `vizably.json` + `scans/` skeleton
- [x] **Save**: `saveScanResults(account, scanResult, url, clients)` — write immutable
      `scans/<scanId>_<host>.json`, then update index + manifest summary
- [x] GitHub writes pass blob `sha` (optimistic concurrency); prefer a single commit
- [x] Drive writes stubbed until Phase 3 (generation/ETag preconditions; scan file first)
- [x] **Accepts pre-built clients** — no direct `AuthService` calls
- [x] Scan files immutable; `index.json` + `scanCount` treated as caches
- [x] **No** `repos.getForAuthenticatedUser` for existence (use `repos.getContent`/`repos.get`)
- [x] **No** `GoogleAuth({ credentials:{access_token} })` (use `OAuth2` + `setCredentials` when Drive lands)
- [x] **Never** write tokens/secrets into the store

### Auth Routes (`backend/routes/auth.js`)

Provider-neutral routes; Google OAuth endpoints stubbed until Phase 3.

- [x] Factory `makeAuthRouter()`; apply `authService.middleware()` at router level
- [x] `GET /github` — initiate OAuth (store provider in session)
- [x] `GET /github/callback` — redirect `/connect?provider=github`
- [x] `GET /google`, `GET /google/callback` — stub (501 or redirect with "coming soon")
- [x] `GET /storages?provider=github` — list repos (GitHub only)
- [x] `POST /storage/validate` — fit-check the selected storage
- [x] `POST /storage` — `action: "load" | "init"`; **revalidate** then act; attach `req.user.storage`
- [x] `GET /user` — safe profile (+ `storage`), **no tokens**
- [x] `GET /status` — `{ authenticated, user }`
- [x] `POST /logout` — `req.logout()`, destroy session, clear cookie
- [x] **No frontend import** (`PROVIDERS` not used here)
- [x] `module.exports = makeAuthRouter`

### Routes Index (`backend/routes/index.js`)

- [x] `const makeAuthRouter = require('./auth')`
- [x] Mount once: `app.use('/api/auth', makeAuthRouter())`
- [x] Keep existing `/api` (scan) and `/problems` mounts
- [x] **No dual mounting**

### App.js (`backend/app.js`)

- [x] Construct `authService` + `storageService`; pass both to `ScanController` deps
- [x] Import path `require('./services/storageService')` (not `../services`)

### Scan Controller (`backend/controllers/scanController.js`)

- [x] Accept `storageService` + `authService` in deps
- [x] In `postScan`: if authenticated and `req.user.storage`, build clients and
      `saveScanResults(...)` — a storage failure logs a warning, **never** fails the scan
- [x] `DELETE /api/scans/:id` — `deleteSavedScan` → `storageService.deleteScanById`
- [x] `DELETE /api/scans` — `deleteAllSavedScans` → `storageService.deleteAllScans` (#110)
      (see [`scanDeletion.md`](./scanDeletion.md))

### Phase 1 follow-ups (post-merge)

- [ ] **Save path:** trust `index.json` on `saveScanResults`; full reconcile only on
      load (or when drift is detected). Today every save re-downloads all scan files.
- [ ] **Session store:** replace in-memory `express-session` MemoryStore with Redis
      (or equivalent) before production deploy — restarts and multi-instance break today.

---

## Phase 2: Frontend — Auth + GitHub Connect

Provider-neutral API shape; **GitHub picker wired**, Google deferred to Phase 3.

### API Client (`frontend/src/lib/apiClient.js`)

- [x] `credentials: 'include'` on all calls; **remove** any Bearer/localStorage token
- [x] `githubLogin()` → full redirect to `/api/auth/github`
- [x] `googleLogin()` → stub or disabled until Phase 3
- [x] `getAuthStatus()`, `getUser()`, `logout()`
- [x] `listStorages(provider)` → `GET /api/auth/storages?provider=…`
- [x] `validateStorage(provider, storageRef)` → `POST /api/auth/storage/validate`
- [x] `setupStorage(provider, storageRef, action)` → `POST /api/auth/storage`
- [x] Keep `runScan`, `getScanResults`, `getProblem`
- [x] `deleteScan(id)` → `DELETE /api/scans/:id`
- [x] `deleteAllScans()` → `DELETE /api/scans`

### ConnectView (`frontend/src/views/ConnectView.jsx`) — the picker

- [x] GitHub: list repos via `listStorages('github')`
- [x] Google Picker deferred to Phase 3 (hide or disable Google connect path)
- [x] Persistent **"Create new"** option (the `init` path on a fresh store)
- [x] On select → `validateStorage` → render fit-check status + scan count
- [x] Action button follows status: `loadable`→"Load my account",
      `initializable`/new→"Set up & continue", `incompatible`/`invalid`→blocked + guidance
- [x] Disable init when `capabilities.canWrite === false`
- [x] On confirm → `setupStorage(provider, storageRef, action)` → dashboard
- [x] Replace hard-coded `existing` lists in `frontend/src/data/placeholders.js`
- [x] `ConnectView` — accept a `storageError` prop for failures

### App Routes (`frontend/src/App.jsx`)

- [x] State: `user` (from `/api/auth/user`, includes `storage`), `provider`, selection
- [x] On mount: `getAuthStatus()` → if authed, `getUser()`
- [x] `auth(provider)` → full OAuth redirect (GitHub only for now)
- [x] `connectDone()` → `setupStorage(...)` → dashboard (handled in ConnectView; App navigates on `onDone`)
- [x] `signOut()` → `logout()` → clear state → landing
- [x] Remove `setAuthed` / placeholder-only wiring

### Views

- [x] `AccountView` — real `user` + `storage` (not `PLACEHOLDER_USER`); "saved scans" from index
- [x] `DashboardView` — saved scans from the loaded index (not `PLACEHOLDER_SAVED_SCANS`)

---

## Phase 3: Google — Backend adapter + Picker

One adapter behind the existing provider-neutral interface; no rewrite of Phases 1–2.

### Backend

- [ ] `npm install passport-google-oauth20 googleapis` (+ dev types)
- [ ] Add Google OAuth vars + `GOOGLE_PICKER_API_KEY` to `.env.example` and `backend/README.md`
- [ ] Passport Google strategy; wire `GET /google` + `GET /google/callback`
- [ ] `getGoogleDriveClient(user)` + `refreshGoogleToken(user)` — real implementations
- [ ] Drive adapter in `storageService`: fit-check, load, init, save with generation/ETag
- [ ] Backend scopes: `drive.file` only (per Phase 0 choice)

### Frontend

- [ ] `googleLogin()` → full redirect to `/api/auth/google`
- [ ] ConnectView: launch **Google Picker** for folder selection
- [ ] Enable Google connect path in `App.jsx` / landing

---

## Phase 4: Testing & Documentation

### Tests

- [x] `backend/tests/auth.test.js` — OAuth redirects, callbacks, status/logout
- [x] `backend/tests/storageService.test.js` — fit-check matrix (loadable / initializable /
      unrelated / incompatible / invalid), load-time reconcile, init race guard,
      atomic save (mock authenticated user + mock clients)
- [x] `frontend/tests/apiClient.test.js` — auth + storage methods
- [x] `frontend/tests/connectView.test.jsx` — picker + fit-check rendering per status

### Documentation

- [x] `backend/README.md`: auth/storage endpoints table, env setup, OAuth/Picker
      config, scopes, testing
- [ ] Keep this TODO and the design/contract docs in sync if implementation diverges

---

## Verification checklist (run before marking complete)

- [ ] `grep -r "makeAuthRouter" backend/routes/` — factory used, mounted once
- [ ] `grep -r "mountAuthRoutes" backend/` — **zero** (no dual mount)
- [ ] `grep -r "credentials: 'include'" frontend/src/lib/apiClient.js` — present
- [ ] `grep -rn "validateStorage\|listStorages\|setupStorage" frontend/src/lib/apiClient.js` — all present
- [ ] `grep -r "getForAuthenticatedUser" backend/` — **zero** (use `repos.get`/`getContent`)
- [ ] `grep -r "credentials.*access_token" backend/` — **zero** (use `setCredentials`)
- [ ] `grep -r "PROVIDERS" backend/routes/auth.js` — **zero** (no frontend import)
- [ ] `grep -rn "drive.file\|drive.metadata.readonly" backend/` — scope matches the locked decision
- [ ] `grep -rn "sha" backend/services/storageService.js` — GitHub writes pass a blob sha
- [ ] No tokens written to the store: review `initStorage` / `saveScanResults` payloads

---

## Notes

- Each checkbox is a verifiable claim. If you can't verify it in real code, it's not done.
- Prefer small, testable PRs.
- [`githubGoogleAuthStorageImplementation.md`](githubGoogleAuthStorageImplementation.md)
  (flow/API) and [`accountStorageContract.md`](accountStorageContract.md) (bytes)
  are the source of truth — update them if the implementation diverges.
