# GitHub/Google Authentication and Portable-Storage Integration — Design Doc

## Overview

vizably lets a person sign in with **GitHub** or **Google** and keep their
whole account — profile, settings, and saved accessibility scans — inside
**storage they already own**: one **GitHub repository** or one **Google Drive
folder**. vizably runs **no database of its own**. The user-owned storage is
the source of truth; OAuth is used only to *identify* the user and obtain an API
token to read/write that storage.

This is a **bring-your-own-storage, portable account** model. Because the
account travels with the user's repo/folder, they can sign in from any device,
**pick the same storage**, and vizably **loads the account back** — no
server-side data, no lock-in, no per-user hosting cost. That is what makes it
cheap to offer to as many people as possible.

The defining UX is **browse → select → validate → load-or-init**:

1. The user connects GitHub or Google (OAuth).
2. They **see the repos/folders they already have** and **select one**.
3. vizably **validates** whether that storage *fits the data needed to load
   the account back* (a "fit-check").
4. Depending on the result, vizably **loads** the existing account or
   **initializes** the storage as a new vizably account store.

> The exact on-disk contract that the fit-check reads/writes — the manifest,
> the scans layout, and the validation rules — lives in its own document:
> [`accountStorageContract.md`](accountStorageContract.md). **That file is the
> source of truth for "the data needed to load back the account."** This doc
> covers the auth + flow + API design; that doc covers the bytes.

**Status**: Design phase — implementation tracked in [`TODO.md`](TODO.md).

---

## Architecture

### High-Level Flow

```
User clicks "Sign in with GitHub / Google"
         │
         ▼
Backend initiates OAuth (passport-github2 / passport-google-oauth20)
         │
         ▼
Provider redirects to /api/auth/{provider}/callback with auth code
         │
         ▼
Backend exchanges code for tokens → encrypts tokens → stores in session
         │
         ▼
User lands on ConnectView — the storage picker
         │
         ├─ GitHub: backend lists the user's repos      → user selects one
         └─ Google: Google Picker lists Drive folders    → user selects one
         │
         ▼
Backend VALIDATES the selected storage (fit-check)
  reads <root>/vizably.json → returns a status + capabilities
         │
   ┌─────┴───────────────────────────────────────────────┐
   ▼                 ▼                 ▼                   ▼
loadable        initializable      incompatible        unrelated / invalid
   │                 │                 │                   │
   ▼                 ▼                 ▼                   ▼
"Load my       "Set this up      "Made by a newer    "This isn't an EV
 account"       for vizably"     vizably —          store / it has other
   │                 │              update to use it"    files — init anyway
   ▼                 ▼                 │                   or pick another"
LOAD: read       INIT: write          ▼                   │
manifest +       manifest +        (blocked)              ▼
scans/index      scans/ dir                            (init or cancel)
   └─────────────────┴───────────────────────────────────┘
                     │
                     ▼
        Account attached to session → Dashboard
                     │
                     ▼
   On scan: results appended to the user's storage (atomic write)
```

The user can also choose **"Create a new repo/folder"** instead of selecting an
existing one — that is just the `initializable` path against a freshly created
store. For GitHub, Vizably always creates the repository as `viz_<name>`
(for example `viz_scans`, `viz_reports`) so Vizably-managed storage is easy to
recognize and harder to confuse with unrelated repos. The prefix is applied on
create and name-availability checks; selecting an existing repo is unchanged.

### Identity model — read this first

This model is **possession-based by default**: whoever can read/write the
selected repo/folder can load and modify that vizably account. This is a
deliberate tradeoff for portability and zero-server-state, but it has sharp
edges the implementation must respect:

- A **collaborator** on a shared GitHub repo, or a member of a shared Drive
  folder, can load/modify the account. Treat the storage ACL as the account ACL.
- The manifest records a **stable provider owner id** (`storage.ownerId`) for
  *display and optional binding*, never the email/login as the only identity.
- If you later want **subject-bound** accounts (reject load when the OAuth
  subject ≠ `storage.ownerId`), it is a one-field policy change — but it hurts
  copy/share/recovery, so it is opt-in, not the default.

### Security Model

- **Session-based auth**: `express-session` with secure, httpOnly cookies;
  the frontend uses `credentials: 'include'` and never sees a token.
- **Token handling**: OAuth access/refresh tokens are encrypted at rest
  (AES-256-GCM via `ENCRYPTION_KEY`) and held in the session store. **Tokens are
  never written into the user's repo/folder.**
- **Token refresh**: Google access tokens are refreshed via the refresh token;
  GitHub OAuth tokens are long-lived.
- **Scope minimization vs. "browse existing storage"**: listing storage the
  user *already has* fundamentally needs broader read than `drive.file` /
  app-only access grants. See [Scopes & Browsing Reality](#scopes--browsing-reality)
  — this is the single most important constraint in the whole design.
- **Privacy of the storage itself**:
  - A **public** GitHub repo makes scans + settings public.
  - A **private** repo is still visible to repo collaborators, and Git history
    retains deleted scans unless history is rewritten.
  - A **shared** Drive folder exposes data to folder collaborators.
  - Surface these facts in the picker so the user chooses knowingly.

---

## Scopes & Browsing Reality

> The naive "list every folder/repo the user owns" requires more access than the
> minimal write scope. The design must be explicit about the tradeoff per
> provider, and the picker must explain it to the user.

### Google Drive — `drive.file` cannot browse existing folders

`drive.file` only grants access to files/folders the **app created** or the user
**explicitly opened/shared** with the app. It **cannot** list the folders a user
already has. Two valid strategies:

1. **Google Picker (recommended, privacy-preserving).**
   - Scopes: `openid email profile` + `https://www.googleapis.com/auth/drive.file`.
   - The user browses in Google's own Picker UI and hands vizably exactly the
     one folder they chose (or a new one). vizably gets access to *only* that
     folder.
   - Consequence: for Google, the picker is **client-side (Google Picker)**, not
     a backend `GET /api/auth/storages` listing. The selected folder id is then
     POSTed to validate/attach.

2. **App-rendered browse (heavier).**
   - Scopes: `https://www.googleapis.com/auth/drive.metadata.readonly` (to list
     folder metadata) + `drive.file` (to write the chosen store).
   - Tradeoff: vizably can read metadata for *all* of the user's Drive, which
     is a real privacy cost to disclose.

   **Avoid** the full `https://www.googleapis.com/auth/drive` scope — broad
   read/write/delete over all of Drive, plus a heavier Google verification
   burden.

### GitHub — OAuth scope is all-or-nothing

Classic GitHub **OAuth Apps** have coarse scopes:

| Need | Scope | Tradeoff |
| --- | --- | --- |
| List/read/write **public** repos only | `public_repo` | No private repos |
| List/read/write **private** repos | `repo` | Grants read/write to **all** repos the user can access |
| Identity | `read:user` (+ `user:email` only if a verified email is required) | — |

There is **no per-repo or read-only-source scope** for classic OAuth Apps.

**Recommended for least privilege:** ship a **GitHub App** instead, where the
user installs vizably on selected repositories with `Contents: read/write` +
`Metadata: read`. The UX becomes GitHub's install/repo-select flow rather than
"list all repos from a token." Document both; pick one before implementation.

---

## Backend Design

### 1. Auth Service (`backend/services/authService.js`)

**Responsibilities**
- Configure Passport strategies (GitHub, Google) and the session middleware.
- Encrypt/decrypt OAuth tokens (AES-256-GCM).
- Build authenticated API clients on demand and hand them to the storage service.
- Refresh Google access tokens.

**Key methods**
- `middleware()` → `[session(), passport.initialize(), passport.session()]`
- `getGitHubClient(user)` → authenticated Octokit
- `getGoogleDriveClient(user)` → authenticated Google Drive client (OAuth2 +
  `setCredentials({ access_token })`)
- `refreshGoogleToken(user)` → refreshes an expired Google access token

> `deserializeUser` is a **stub** returning `{ id, ...session fields }`. There is
> no user DB; the "user" is the session payload (identity + encrypted tokens +
> attached `storage`). `// TODO: load full user from DB` only applies if a future
> phase adds server-side persistence.

### 2. Storage Service (`backend/services/storageService.js`)

The storage service is where the **portable-account contract** is read and
written. It speaks the layout in
[`accountStorageContract.md`](accountStorageContract.md). It receives
**pre-built authenticated clients** as arguments (no direct `AuthService` calls →
no circular dependency).

**Browsing**
- `listGitHubRepos(githubClient)` → repos the user can write, each with stable
  `id` (node id), `full_name`, `private`, `html_url`.
- *(Google folders are chosen client-side via Google Picker; the backend does
  not list them when using `drive.file`.)*

**Fit-check (the core of the UX)**
- `validateStorage(provider, storageRef, githubClient, driveClient)` →
  `{ status, reason?, capabilities, manifestSummary? }`. Reads
  `<root>/vizably.json`, checks `schemaVersion`, cross-checks `scans/index.json`
  vs. actual files, and probes write capability. See
  [Fit-check status](#fit-check-status) for the enum.

**Load / initialize**
- `loadAccount(provider, storageRef, clients)` → reads manifest + `scans/index.json`,
  reconciles drift, returns the rehydrated account (settings + scan index).
- `initStorage(provider, storageRef, owner, clients)` → **revalidates**, then
  atomically writes `vizably.json` + `scans/` skeleton. Returns the new account.

**Saving scans**
- `saveScanResults(account, scanResult, url, clients)` → writes one immutable
  `scans/<host>_<ts>.json`, then updates `scans/index.json` + manifest `summary`
  **in a single atomic commit** (GitHub) or with generation/ETag preconditions
  (Drive). Scan files are the truth; `index.json`/`scanCount` are caches.

**Design rules baked in**
- Scan files are **immutable** and the index is **rebuildable** from them.
- Every multi-file update is **atomic or revalidated** to survive partial writes.
- `getOrCreateStorage` / `saveScanResults` **accept pre-built clients**.
- **No `repos.getForAuthenticatedUser`** for existence checks — use
  `repos.get({ owner, repo })`. **No** `GoogleAuth({ credentials: { access_token }})`
  — use `OAuth2 + setCredentials`.

### 3. Auth Routes (`backend/routes/auth.js`)

Factory `makeAuthRouter()` returning an Express Router (matching
`makeScanRouter` / `makeProblemsRouter`). `authService.middleware()` is applied
at router level. **No frontend imports** (`PROVIDERS` lives in the frontend only).

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/auth/github` | Initiate GitHub OAuth |
| GET | `/api/auth/google` | Initiate Google OAuth |
| GET | `/api/auth/github/callback` | GitHub callback → redirect `/connect?provider=github` |
| GET | `/api/auth/google/callback` | Google callback → redirect `/connect?provider=google` |
| GET | `/api/auth/storages?provider=github` | List the user's repos (GitHub only; Google uses Picker) |
| POST | `/api/auth/storage/validate` | **Fit-check** a selected storage |
| POST | `/api/auth/storage` | `action: "load" \| "init"` → rehydrate or initialize, attach to session |
| GET | `/api/auth/user` | Current user profile (+ `storage` if attached). No tokens. |
| GET | `/api/auth/status` | `{ authenticated, user }` |
| POST | `/api/auth/logout` | `req.logout()`, destroy session, clear cookie |

**Mounting** — exactly once, in `backend/routes/index.js`:

```js
const makeAuthRouter = require('./auth');
function mountRoutes(app, { scanController }) {
  app.use('/api/auth', makeAuthRouter());
  app.use('/api', makeScanRouter(scanController));
  app.use('/problems', makeProblemsRouter(scanController));
}
```

No dual mounting.

### 4. Scan Controller Integration

`ScanController` receives `storageService` (and, to build clients,
`authService`) as deps. In `postScan`, after a successful scan:

```js
if (req.isAuthenticated() && req.user?.storage) {
  const clients = await authService.clientsFor(req.user);
  await storageService.saveScanResults(req.user, result, url, clients);
}
```

Saving must **never** break the scan response — a storage failure is logged and
surfaced as a non-fatal warning, not a 500 on the scan itself.

---

## Fit-check status

`POST /api/auth/storage/validate` returns a `status` + optional `reason` +
`capabilities`. The status drives the ConnectView copy and which action button
is offered.

| status | meaning | UI offers |
| --- | --- | --- |
| `loadable` | Valid `vizably.json`, supported `schemaVersion` | **Load my account** (shows scan count) |
| `initializable` | Storage is empty / has no vizably files | **Set up for vizably** |
| `unrelated` | Non-empty, no manifest, has other files | Init anyway / pick another (warn) |
| `incompatible` | `schemaVersion` newer than this server supports | Blocked — update vizably |
| `invalid` | Manifest present but malformed / missing fields / duplicate manifest | Blocked — pick another or repair |

Optional refinements (model as `reason`, not new top-level states, to keep the
client simple):

- `reason: "migration_required"` (older supported schema → migrate before write)
- `reason: "repairable"` (manifest OK but `index.json` drifted → rebuild on load)
- `reason: "duplicate_manifest"` (Drive can hold two `vizably.json` → ambiguous)
- `reason: "access_denied" | "not_writable" | "not_found" | "temporarily_unavailable"`

Every result also carries:

```ts
capabilities: { canRead: boolean; canWrite: boolean; canCreate: boolean }
```

so the UI can, e.g., allow **load** but disable **init** on a read-only fork.

---

## Concurrency, partial writes & drift

Because the store is a plain repo/folder the user (and their collaborators, and
other devices) can touch, the design **must** assume concurrent and partial
writes:

- **Optimistic concurrency.**
  - GitHub: write against the expected branch HEAD / blob SHA; prefer **one
    atomic commit** containing the new scan file + updated index + updated
    manifest.
  - Drive: use ETag/generation preconditions where available; expect retries.
- **Partial-write tolerance.** A scan file may land without the index updating
  (or vice versa). Therefore: scan files are immutable truth; `index.json` and
  `manifest.summary.scanCount` are **caches**, reconciled on load.
- **Drift repair.** On load, if the index disagrees with the actual
  `scans/*.json`, rebuild the index from disk, drop orphan/corrupt entries, and
  surface `reason: "repairable"`.
- **Validate→init race.** A `validate` result can go stale before `init`.
  `POST /api/auth/storage { action: "init" }` must **revalidate and
  conditionally create** `vizably.json`; never trust a stale validate result.
- **Object identity.** Persist the **repo node id / Drive folder id**, not the
  name — repos get renamed/transferred and Drive folder names are not unique.

---

## Frontend Design

### API Client (`frontend/src/lib/apiClient.js`)

Session cookies, not Bearer tokens. All calls use `credentials: 'include'`; no
`localStorage` token.

- `githubLogin()` → `window.location.href = '/api/auth/github'`
- `googleLogin()` → `window.location.href = '/api/auth/google'`
- `getAuthStatus()` → `GET /api/auth/status`
- `getUser()` → `GET /api/auth/user`
- `listStorages(provider)` → `GET /api/auth/storages?provider=…` (GitHub)
- `validateStorage(provider, storageRef)` → `POST /api/auth/storage/validate`
- `setupStorage(provider, storageRef, action)` → `POST /api/auth/storage`
- `logout()` → `POST /api/auth/logout`
- `listScans()` → `GET /api/scans`
- `getSavedScan(id)` → `GET /api/scans/:id`
- `deleteScan(id)` → `DELETE /api/scans/:id`
- `runScan`, `getScanResults`, `getProblem` unchanged.

For Google, selection is done with the **Google Picker** client library; the
chosen folder id flows into `validateStorage` / `setupStorage`.

### ConnectView — the picker (`frontend/src/views/ConnectView.jsx`)

Today this is a placeholder with hard-coded `existing` lists in
`frontend/src/data/placeholders.js`. The real ConnectView:

1. **Lists real storage.** GitHub → `listStorages('github')`. Google → launch
   Google Picker. Plus a persistent **"Create new"** option.
2. **Validates on select.** On pick, call `validateStorage` and render the
   fit-check result (status copy + scan count when `loadable`).
3. **Offers the right action.** Button text follows status:
   `loadable` → "Load my account", `initializable`/new → "Set up & continue",
   `incompatible`/`invalid` → blocked with guidance.
4. **Confirms.** `setupStorage(provider, storageRef, action)` → on success the
   account (with `storage`) is attached; navigate to the dashboard.

### App routes (`frontend/src/App.jsx`)

State: `user` (from `/api/auth/user`, includes `storage` once attached),
`provider`, and storage selection. On mount: `getAuthStatus()` → if
authenticated, `getUser()`. `auth(provider)` does a full OAuth redirect.
`connectDone()` calls `setupStorage` then navigates to the dashboard.
`signOut()` calls `logout()` and clears state. Remove the `setAuthed` /
placeholder-only wiring.

---

## API Contracts

### `GET /api/auth/storages?provider=github`
```json
{
  "provider": "github",
  "storages": [
    { "id": "R_kgDOA…", "name": "site-audits", "full_name": "sam/site-audits",
      "private": true, "html_url": "https://github.com/sam/site-audits" }
  ]
}
```
*(Google omitted — folders are selected via Google Picker, which returns the
folder id directly to the client.)*

### `POST /api/auth/storage/validate`
**Request**
```json
{ "provider": "github", "storageRef": { "id": "R_kgDOA…", "full_name": "sam/site-audits" } }
```
**Response (200)**
```json
{
  "status": "loadable",
  "reason": null,
  "capabilities": { "canRead": true, "canWrite": true, "canCreate": false },
  "manifestSummary": { "accountId": "…", "schemaVersion": 1, "scanCount": 12, "updatedAt": "…" }
}
```

### `POST /api/auth/storage`
**Request**
```json
{ "provider": "github",
  "storageRef": { "id": "R_kgDOA…", "full_name": "sam/site-audits" },
  "action": "load" }
```
`action` is `"load"` (rehydrate an existing store) or `"init"` (write a fresh
manifest + `scans/`). The server **revalidates** before acting.

**Response (200)**
```json
{
  "success": true,
  "provider": "github",
  "storage": { "type": "github", "id": "R_kgDOA…", "full_name": "sam/site-audits",
               "html_url": "https://github.com/sam/site-audits" },
  "account": { "accountId": "…", "settings": { "autoDelete90d": true }, "scanCount": 12 }
}
```

### `GET /api/auth/user`
```json
{
  "id": "12345", "username": "samuel", "email": "sam@example.com",
  "displayName": "Samuel", "provider": "github", "avatarUrl": "https://…",
  "storage": { "type": "github", "full_name": "sam/site-audits" }
}
```

### `GET /api/auth/status`
```json
{ "authenticated": true, "user": { "id": "12345", "username": "samuel" } }
```

---

## Environment Variables

```env
# Sessions
SESSION_SECRET=your_super_secret_session_key_min_32_chars

# GitHub App (Phase 0 choice — OAuth credentials from the app settings page)
GITHUB_APP_CLIENT_ID=your_github_app_oauth_client_id
GITHUB_APP_CLIENT_SECRET=your_github_app_oauth_client_secret
GITHUB_REDIRECT_URI=http://localhost:3000/api/auth/github/callback

# Google OAuth (+ Picker API key for client-side folder selection)
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
GOOGLE_PICKER_API_KEY=your_google_picker_browser_api_key

# Token encryption at rest (generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your_32_byte_base64_encoded_encryption_key
```

---

## OAuth App Configuration

### GitHub

Phase 0 choice: **GitHub App** (per-repo least privilege), not a classic OAuth App.

#### Local development — personal GitHub App

Each developer creates **their own** GitHub App for Phase 1 testing:

1. GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**
2. **Callback URL:** `http://localhost:3000/api/auth/github/callback`
3. **Permissions:** `Contents: Read & write`, `Metadata: Read`, and
   `Administration: Read & write` (needed to create a repo for the signed-in
   user via the App user access token — `POST /user/repos` is UAT-only; do
   **not** expand classic OAuth to `repo` for this).
4. After creation, copy **OAuth Client ID** + **Client secret** into
   `backend/.env` as `GITHUB_APP_CLIENT_ID` and `GITHUB_APP_CLIENT_SECRET`
   (use the OAuth Client ID, not the numeric App ID)
5. Install the app on your account when testing; pick repos during the install
   flow. Prefer **All repositories** if you want in-app create to skip a second
   install hop; with **Selected repositories**, Connect returns `needsInstall`
   so the user can add the new repo once on GitHub.

Personal apps stay in each developer's `.env` only — never commit credentials.

#### Production — project GitHub App (TBD)

Before vizably ships on a real domain, finalize a **codrlabs-owned GitHub App**
with production callback URL(s) on the deployed backend, the same permissions
(`Contents: rw`, `Metadata: r`, `Administration: rw`), and secrets in deployment
config. Local personal apps are not used in production. Explain Administration on
the app homepage / Connect UI: it exists so Vizably can create an empty private
repo without asking the user to leave and create one manually.

#### Reference (classic OAuth App — not chosen)

- **OAuth App**: callback `http://localhost:3000/api/auth/github/callback`;
  scopes `repo` (private) **or** `public_repo` (public-only), plus `read:user`.
  Broader scope than GitHub App; documented for comparison only.

### Google
1. Cloud Console → APIs & Services → enable **Drive API** and **Picker API**.
2. OAuth 2.0 Client ID (Web): redirect
   `http://localhost:3000/api/auth/google/callback`.
3. Scopes: `openid email profile` + `https://www.googleapis.com/auth/drive.file`
   (Picker flow). Only add `drive.metadata.readonly` if doing app-rendered
   browsing.
4. Create a browser API key for the Picker (`GOOGLE_PICKER_API_KEY`).

---

## Library Usage Notes (Verified)

### GitHub (Octokit)
```js
// List repos the user can write (for the picker)
await octokit.repos.listForAuthenticatedUser({ visibility: 'all', per_page: 100 });

// Existence / fit-check read — get the manifest blob
await octokit.repos.getContent({ owner, repo, path: 'vizably.json' }); // 404 ⇒ no manifest

// Create a repo for the "new" path — name is always `viz_<normalized>`
await octokit.repos.createForAuthenticatedUser({ name: 'viz_scans', private: true });

// Atomic-ish write (pass sha to update; omit to create)
await octokit.repos.createOrUpdateFileContents({ owner, repo, path, message, content, branch, sha });
```

### Google Drive (googleapis)
```js
// OAuth2 client with the decrypted access token
const oauth2 = new google.auth.OAuth2();
oauth2.setCredentials({ access_token: decryptedToken });
const drive = google.drive({ version: 'v3', auth: oauth2 });

// Read the manifest inside the picked folder (fit-check)
await drive.files.list({ q: `'${folderId}' in parents and name = 'vizably.json' and trashed = false`,
                         fields: 'files(id,name,modifiedTime)' });

// Create a folder (the "new" path)
await drive.files.create({ resource: { name, mimeType: 'application/vnd.google-apps.folder' },
                           fields: 'id,name,webViewLink' });

// Upload / update a file (use generation preconditions on update)
await drive.files.create({ resource: { name, parents: [folderId] },
                           media: { mimeType, body: content }, fields: 'id,name,webViewLink' });
```

---

## Acceptance Criteria

- ✅ Sign in with GitHub and Google (OAuth, encrypted tokens, secure session).
- ✅ After OAuth, the user **sees real storage** they can use — GitHub repos via
  the API, Drive folders via Google Picker — plus a "create new" option.
- ✅ Selecting a storage runs a **fit-check** that returns `loadable` /
  `initializable` / `unrelated` / `incompatible` / `invalid` with capabilities.
- ✅ `loadable` storage **rehydrates the full account** (settings + scan index),
  reconciling any index drift.
- ✅ `initializable` / new storage is **set up** atomically (manifest + `scans/`).
- ✅ New scans by an authenticated user are **appended atomically** to their
  storage; a storage failure never fails the scan response.
- ✅ Scan files are immutable; the index/`scanCount` are caches rebuildable from
  disk.
- ⚠️ **Frontend changes ARE required** (real ConnectView picker + validation).
- ⚠️ Scope tradeoffs (GitHub `repo` breadth; Google browsing) are **disclosed in
  the UI**, not just the docs.

---

## Troubleshooting

| Issue | Cause | Solution |
| --- | --- | --- |
| `redirect_uri_mismatch` | Callback URL mismatch | Make `.env` redirect URIs match the OAuth console exactly |
| Can't list Drive folders | Using `drive.file` (app-only) | Use Google Picker, or add `drive.metadata.readonly` |
| GitHub picker missing private repos | `public_repo` scope | Use `repo` scope or a GitHub App with selected repos |
| `InvalidKey` / `BadPadding` | Bad `ENCRYPTION_KEY` | 32-byte base64 (`openssl rand -base64 32`) |
| Fit-check says `invalid` on a real store | Malformed/duplicate `vizably.json` | Inspect manifest; on Drive remove duplicate manifest files |
| Scans appear/disappear across devices | Index drift / concurrent writes | Load-time reconcile rebuilds index from `scans/*.json` |
| Lost scan after a failed write | Partial multi-file write | Expected — scan files are truth; re-run reconcile |
| `403 Rate Limit` | API limits | Backoff; cache the manifest within a session |
| Session not persisting | Missing `credentials: 'include'` | Ensure every fetch includes credentials |

---

## Relationship to the roadmap

This supersedes the **Postgres + JWT** sketch in
[`../../plans/project-roadmap.md`](../../plans/project-roadmap.md) Phase 5: there
is **no project database**. The placeholder UI already assumes user-owned
storage; this design makes it real. If a future phase needs server-side
persistence (e.g. team features), it is additive — the portable store stays the
user's source of truth.

## Future Enhancements

1. **Subject-bound mode** — optional policy to reject load when OAuth subject ≠
   `storage.ownerId`.
2. **Auto token refresh** before expiry (Google).
3. **More providers** — GitLab, Bitbucket, Dropbox (same contract).
4. **Conflict UI** — when two devices diverge, show a merge/repair screen.
5. **Export/import** — move an account between providers by copying the store.
