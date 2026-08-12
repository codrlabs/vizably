# Delete individual scans — implementation guide (closes [#112](https://github.com/codrlabs/vizably/issues/112))

Step-by-step plan so you can implement **per-scan delete** yourself: remove one
saved report from the user’s store without wiping the account or other scans.

Related sources of truth:

- [`accountStorageContract.md`](./accountStorageContract.md) — on-disk layout,
  truth vs cache, concurrency
- [`githubGoogleAuthStorageImplementation.md`](./githubGoogleAuthStorageImplementation.md)
  — auth/storage API conventions
- [`TODO.md`](./TODO.md) — phase checklist (add a scan-delete checkbox when you ship)
- Architecture intent: [`docs/plans/architecture-map.md`](../../plans/architecture-map.md)
  (per-row “Delete this scan?” → `DELETE /api/scans/:id`)
- Issue: [codrlabs/vizably#112](https://github.com/codrlabs/vizably/issues/112)

---

## 0. What “delete this scan” means

Vizably has **no scan database**. Saved reports live in storage the user owns
(GitHub repo today; Google Drive later). Deleting one scan means:

1. Remove that scan’s immutable file: `scans/<scanId>_<host>.json`.
2. Update rebuildable caches so the dashboard no longer lists it:
   - drop the row from `scans/index.json`
   - refresh `vizably.json` → `summary.scanCount` / `lastScanAt`
3. Leave every other scan file, the account manifest identity, and the repo itself alone.

**Not in scope for #112**

- Whole-account wipe / optional repo delete (that’s [#82](https://github.com/codrlabs/vizably/issues/82) / account deletion).
- Bulk “delete all” on Account settings (still a later phase).
- Rewriting Git history — after delete, GitHub history may still contain the blob;
  disclose that lightly in UI copy if you mention permanence.

---

## 1. Investigate the current tree (baseline)

Confirm these facts before coding (re-check if the branch has drifted):

| Location | Today’s behaviour |
|----------|-------------------|
| `backend/routes/scan.js` | `GET /scans`, `GET /scans/:id` only — **no DELETE**. |
| `backend/controllers/scanController.js` | `getSavedScans` / `getSavedScan`; no delete handler. |
| `StorageService` | `saveScanResults`, `getScanById`, `loadAccount`, `_reconcileGitHubIndex`. **No `deleteScanById`.** |
| `_writeGitHubFiles` / ViaGit / ViaContents | Create/update only. **No `file.delete` / `repos.deleteFile` yet** on `main`-based branches (unless you already merged #82 wipe helpers). |
| `frontend/src/lib/apiClient.js` | `listScans()`, `getSavedScan(id)` — **no `deleteScan`.** |
| `frontend/src/views/DashboardView.jsx` | Rows open on click; footer copy says “export, or delete” but **there is no delete control.** |
| `frontend/src/App.jsx` | `openSaved` → `getSavedScan`; list via `listScans` + `mergeAccountUpdate`. |

**GitNexus:** before editing a symbol, run impact analysis
(`impact({ target, direction: "upstream" })`) and warn on HIGH/CRITICAL. Before
commit, run `detect_changes`.

---

## 2. Product sequence

```
Dashboard row → user clicks Delete (not the row open target)
        │
        ▼
Confirm: “Delete this scan?” (irreversible for the Vizably store)
        │
        ▼
DELETE /api/scans/:id
        │
        ▼
StorageService.deleteScanById
  → delete scans/<id>_<host>.json
  → rewrite scans/index.json (without that id)
  → rewrite vizably.json summary caches
        │
        ▼
Response { scanCount, scans }
        │
        ▼
App merges into client profile → row disappears
```

UX notes:

- Confirm before calling the API (inline confirm or small dialog — match existing
  Account danger-zone style if you can).
- Delete control must **not** trigger `onOpen` (stop propagation on the button).
- On failure: keep the row, show a clear error; do not pretend it succeeded.
- Optional: if the user is viewing `/results?scanId=<deletedId>`, navigate away
  after a successful delete (nice-to-have, not required for MVP).
- Keyboard: delete control should be focusable; row remains activatable with Enter/Space.

---

## 3. On-disk contract (what you mutate)

From [`accountStorageContract.md`](./accountStorageContract.md):

```
<root>/
├── vizably.json                 # identity + settings + summary CACHE
└── scans/
    ├── index.json               # dashboard list CACHE
    └── <scanId>_<host>.json     # immutable truth — DELETE this one file
```

**Truth:** the scan file.  
**Caches:** `index.json` and `summary.scanCount` / `lastScanAt`.  
If a delete updates the file but fails to update the index, the next
`loadAccount` / `_reconcileGitHubIndex` drops orphan index rows (and can drop a
missing file’s row). Prefer **one atomic commit** with all three changes when
possible.

Finding the file (same rule as `getScanById`):

1. List `scans/` via `_listGitHubDirectory`.
2. Match `entry.name.startsWith(\`${scanId}_\`) && entry.name.endsWith('.json')`
   and `entry.name !== 'index.json'`.
3. Path = `scans/${entry.name}`; keep `entry.sha` for Contents API deletes.

---

## 4. Prerequisite — teach `_writeGitHubFiles` how to delete

On a stock `main` tree, writes only **create/update**. Single-scan delete needs
a way to remove a blob in the same batch as index/manifest updates.

### 4.1 Recommended shape

Support file descriptors like:

```js
{ path: 'scans/…json', delete: true, sha: '<blob-sha>' }
```

alongside the existing `{ path, content, sha? }` updates.

### 4.2 ViaContents (`_writeGitHubFilesViaContents`)

When `file.delete`:

```js
await octokit.rest.repos.deleteFile({
  owner, repo, path: file.path, message, sha, branch,
});
```

Skip if the file is already gone (idempotent delete). You already resolve `sha`
from `_readGitHubFile` / the directory listing when missing.

### 4.3 ViaGit (`_writeGitHubFilesViaGit`)

Do **not** rely on `createTree` + `sha: null` alone — real GitHub often returns
**404** for that. Prefer one of:

- **A (simple for #112):** for delete-only or mixed batches that include deletes,
  fall through to Contents API (`_shouldFallbackToContentsApi` or skip Git when
  any `file.delete`).
- **B (atomic, harder):** recursive `git.getTree`, filter out deleted paths,
  `createTree` **without** `base_tree` for the remaining blobs, then commit.
  Never send `{"tree":[]}` — GitHub rejects empty trees with **422 Invalid tree
  info**. If the rebuild would be empty for some other feature, Contents fallback.

For #112 you almost always leave other files (`index.json` rewrite + other
scans), so empty-tree is unlikely; Contents delete + two updates is enough.

### 4.4 If #82 (account wipe) already landed

Reuse its `delete: true` / `deleteFile` / fallback behaviour. Do **not**
re-invent a second delete path. Cherry-pick or merge that plumbing first, then
add `deleteScanById` on top.

### 4.5 Tests for the prerequisite

In `backend/tests/storageService.test.js` mock (`createMockGitHubClient`):

- Implement `repos.deleteFile` if missing.
- Cover: one file deleted, sibling files untouched; missing file is ok.

---

## 5. StorageService — `deleteScanById`

### 5.1 Signature

```js
/**
 * @param {object} account  session-shaped: { storage } (same as getScanById)
 * @param {string} scanId
 * @param {{ githubClient?: object, githubUserClient?: object }} clients
 * @returns {Promise<{ scanCount: number, scans: object[], deletedId: string, path: string }>}
 */
async deleteScanById(account, scanId, clients)
```

### 5.2 Algorithm (mirror `saveScanResults` / `getScanById`)

1. **Google stub** — same as other storage methods:
   ```js
   if (provider === 'google') {
     const err = new Error('Google storage is not available until Phase 3');
     err.status = 501;
     err.code = 'PROVIDER_NOT_AVAILABLE';
     throw err;
   }
   ```
2. Validate `scanId` (non-empty string) → 400 `SCAN_ID_REQUIRED` if bad.
3. Resolve `owner` / `repo` / `branch` / `octokit` like `getScanById`.
4. List `scans/`; find the matching `<scanId>_*.json` file. If none → 404
   `SCAN_NOT_FOUND` (same codes as get).
5. Read manifest (`_readAccountManifest`); parse + `_normalizeManifestBrand`.
6. Reconcile index (`_reconcileGitHubIndex`) so you start from scan-file truth.
7. Filter: `index.scans = index.scans.filter((e) => e.id !== scanId)`.
8. `_updateManifestSummary(manifest, index, /* lastScanAt from new head or null */)`.
9. Build write batch:
   ```js
   [
     { path: scanPath, delete: true, sha: match.sha /* or fileData.sha */ },
     {
       path: INDEX_PATH, // 'scans/index.json'
       content: JSON.stringify(index, null, 2) + '\n',
       sha: existingIndexSha,
     },
     {
       path: MANIFEST_PATH, // or legacy path if that’s what you read
       content: JSON.stringify(updatedManifest, null, 2) + '\n',
       sha: manifestFile.sha,
     },
   ]
   ```
10. `_writeGitHubFiles(..., 'Delete accessibility scan …')`.
11. On `_isRefConflict` (409/422 stale sha): **retry** like `saveScanResults`
    (re-list, re-reconcile, rewrite). Cap retries (e.g. 3).
12. Return `{ deletedId: scanId, path: scanPath, scanCount: index.scans.length, scans: index.scans }`.

**Idempotency:** if the file is already gone but an index row remains, treat as
success after repairing caches (filter index + write). If both are already gone,
return 404 **or** success with current list — pick one and test it; prefer
**404** for a missing id so the UI can say “already gone”, or **200** with
current list for gentler UX. Document your choice in the route tests.

### 5.3 Unit tests (`backend/tests/storageService.test.js`)

Add cases next to `getScanById` / `saveScanResults`:

- Deletes the target file; leaves other scan files and unrelated root files.
- Index no longer contains that `id`; `scanCount` matches.
- Unknown id → `SCAN_NOT_FOUND` / 404.
- Google → 501 stub.
- Conflict retry: first write 422, second succeeds (optional but valuable).

Run: `node --test tests/storageService.test.js`

---

## 6. HTTP layer

### 6.1 Route (`backend/routes/scan.js`)

```js
router.delete('/scans/:id', controller.deleteSavedScan);
```

Keep it next to the existing `GET /scans/:id` registration.

### 6.2 Controller (`backend/controllers/scanController.js`)

Add `deleteSavedScan`, bind in the constructor (same pattern as other methods).

Auth / storage gate — **copy from `getSavedScan`**:

- Not authenticated or no `req.user.storage` → **401**
- Missing services → **503**
- Missing `id` param → **400**

Happy path:

```js
const clients = await this.authService.clientsFor(req.user, {
  storageRef: req.user.storage,
});
const result = await this.storageService.deleteScanById(req.user, id, clients);

if (!req.user.account) {
  req.user.account = { settings: { autoDelete90d: true }, scanCount: 0 };
}
req.user.account.scanCount = result.scanCount;
// Do NOT put result.scans on the session cookie — same rule as postScan.
await this.authService.persistUser(req);

return res.json({
  scanCount: result.scanCount,
  scans: result.scans,
});
```

Error mapping (mirror `getSavedScan`):

| Condition | Status |
|-----------|--------|
| `SCAN_NOT_FOUND` / `err.status === 404` | 404 `{ error: 'Scan not found' }` |
| `STORAGE_ACCESS_DENIED` / 403 | 403 |
| `PROVIDER_NOT_AVAILABLE` / 501 | 501 |
| Other | 500 (log) |

**Delete is not best-effort** (unlike save-on-scan). If storage fails, return
the error — the user asked to delete.

### 6.3 Route tests (`backend/tests/scan.test.js`)

- Unauthenticated → 401
- Happy path: mock `deleteScanById` → 200 `{ scanCount, scans }`; session
  `scanCount` updated, **no** `scans` array on session user
- Unknown id → 404
- Optional: 403 / 501 passthrough

### 6.4 Docs table

Add a row to the API table in
`githubGoogleAuthStorageImplementation.md` (and `backend/README.md` if it lists
scan routes):

| Method | Path | Notes |
|--------|------|--------|
| `DELETE` | `/api/scans/:id` | Auth + attached storage; remove one scan file + refresh index/manifest caches; returns `{ scanCount, scans }` |

---

## 7. Frontend

### 7.1 `apiClient.deleteScan(scanId)`

```js
deleteScan(scanId) {
  return this._request(`/api/scans/${encodeURIComponent(scanId)}`, {
    method: 'DELETE',
  })
}
```

Returns `Promise<{ scanCount: number, scans: object[] }>`.

Cover in `frontend/src/__tests__/apiClient.test.js` (same style as `listScans` /
`getSavedScan`).

### 7.2 `App.jsx` handler

```js
const deleteSaved = async (s) => {
  if (!s?.id) return
  const result = await apiClient.deleteScan(s.id)
  setUser((prev) => mergeAccountUpdate(prev, {
    scanCount: result.scanCount,
    scans: result.scans,
  }))
  // optional: if viewing that scan, clear scan state / navigate to dashboard
}
```

Pass `onDelete={deleteSaved}` into `DashboardView` next to `onOpen={openSaved}`.

`mergeAccountUpdate` / `toSavedScans` in `accountAdapter.js` already understand
`{ scanCount, scans }` — no adapter change required unless you want a tiny helper
`withoutScan(account, id)` for optimistic UI.

### 7.3 `DashboardView.jsx`

- Add a delete control per row (icon button).
- `onClick={(e) => { e.stopPropagation(); … }}` so the row doesn’t open.
- Flow: idle → confirm (“Delete this scan? This removes it from your storage.”)
  → busy → call `onDelete(s)` → parent updates `saved`.
- Show per-row or banner error on failure; re-enable the button.
- Keep empty-state UX unchanged when `saved.length === 0` after the last delete.

### 7.4 Frontend tests

`frontend/src/__tests__/dashboardView.test.jsx`:

- Delete confirm does **not** call `onOpen`.
- Confirm calls `onDelete` with the scan.
- Cancel leaves the list alone.

---

## 8. Suggested commit sequence

Keep the PR reviewable:

1. `_writeGitHubFiles` delete support (`delete: true` + Contents `deleteFile`) + unit tests  
   *(skip if already present from #82)*
2. `StorageService.deleteScanById` + storage tests  
3. `DELETE /api/scans/:id` controller/route + `scan.test.js`  
4. `apiClient.deleteScan` + Dashboard/App UX + frontend tests  
5. Docs: this guide checklist, contract one-liner, API table, `TODO.md`

Run GitNexus `detect_changes` before committing. Omit Cursor co-author trailers
if the team asks to omit them.

---

## 9. Docs to keep in sync

When the code lands:

- [ ] This guide — mark the acceptance checklist below.
- [ ] [`accountStorageContract.md`](./accountStorageContract.md) — short note under
      write atomicity or a “Deleting a scan” bullet: remove file + index entry;
      caches rebuildable; Git history may retain blobs.
- [ ] [`githubGoogleAuthStorageImplementation.md`](./githubGoogleAuthStorageImplementation.md)
      — API table row for `DELETE /api/scans/:id`.
- [ ] [`TODO.md`](./TODO.md) — checkbox under scan/storage follow-ups.
- [ ] `backend/README.md` route table if it lists scan endpoints.

---

## 10. Manual test plan

1. Sign in, connect a repo, run 2+ scans so the dashboard has multiple rows.
2. Delete one scan → confirm → that row disappears; the other remains.
3. Refresh / re-open dashboard → still gone (`GET /api/scans`).
4. Open the GitHub repo → that `scans/<id>_*.json` file is gone; `index.json`
   no longer lists it; unrelated files untouched.
5. Delete the last scan → empty dashboard state.
6. Delete an unknown id (curl) → 404.
7. Signed out → 401.

---

## 11. Acceptance checklist (closes #112)

- [ ] Dashboard has a Delete action per scan (with confirm).
- [ ] Delete removes only that scan’s file from attached storage.
- [ ] Other scans, account identity, and the repository remain.
- [ ] `index.json` / `scanCount` update (or heal on next load).
- [ ] `DELETE /api/scans/:id` auth-gated; returns updated `{ scanCount, scans }`.
- [ ] Session stores `scanCount` only (not the full scans array).
- [ ] Google remains explicitly stubbed (501) until Phase 3.
- [ ] Backend + frontend tests cover happy path, 404, and “delete doesn’t open”.
- [ ] Docs/API table updated.

When the checklist is green and the PR is merged, close
[#112](https://github.com/codrlabs/vizably/issues/112).

---

## Quick file checklist

| Layer | File |
|-------|------|
| Storage | `backend/services/storageService.js` |
| Tests | `backend/tests/storageService.test.js` |
| Controller | `backend/controllers/scanController.js` |
| Routes | `backend/routes/scan.js` |
| Route tests | `backend/tests/scan.test.js` |
| Client | `frontend/src/lib/apiClient.js` |
| UI | `frontend/src/views/DashboardView.jsx` |
| Wiring | `frontend/src/App.jsx` |
| FE tests | `frontend/src/__tests__/dashboardView.test.jsx`, `apiClient.test.js` |
| Docs | this file + contract + implementation guide + TODO |
