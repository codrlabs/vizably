# Account deletion — implementation guide (closes [#82](https://github.com/codrlabs/vizably/issues/82))

Step-by-step plan to make **Delete my account** permanently remove the Vizably
account store — not just sign the user out.

Related sources of truth:

- [`accountStorageContract.md`](./accountStorageContract.md) — on-disk layout
- [`githubGoogleAuthStorageImplementation.md`](./githubGoogleAuthStorageImplementation.md) — auth/storage flow
- Issue: [codrlabs/vizably#82](https://github.com/codrlabs/vizably/issues/82)

---

## 0. What “delete account” means in Vizably

Vizably has **no user database**. The account lives in storage the user owns
(GitHub repo or, later, Google Drive folder). Deleting an account therefore means:

1. Remove Vizably’s data from that store (`vizably.json` + `scans/`).
2. Optionally delete the GitHub repository itself (user chooses).
3. End the session (sign out / clear cookie).

The user’s GitHub/Google **identity** is never deleted — only Vizably’s use of
their storage and our session.

---

## 1. Investigate the current delete flow (done baseline)

Confirm these facts before coding (re-check if the tree has drifted):

| Location | Today’s behaviour |
|----------|-------------------|
| `frontend/src/views/AccountView.jsx` | Danger zone → confirm → **`onSignOut` only**. Copy even says storage deletion “is not wired yet”. |
| `frontend/src/App.jsx` → `signOut` | `POST /api/auth/logout`, clear local user, navigate to landing. |
| `backend/routes/auth.js` → `POST /logout` | Passport logout + session clear. No storage writes. |
| `StorageService` | No wipe / delete-repo helpers yet. |
| `frontend/src/lib/apiClient.js` | No delete-account API method. |

**Bug to fix:** Confirm button label is “Yes, sign out” and it only logs out.

---

## 2. Agree the product sequence (matches #82)

Implement this UX, in order:

```
User clicks “Delete my account”
        │
        ▼
Confirm: wipe Vizably data in the connected store
  (vizably.json + scans/ — irreversible)
        │
        ▼
Backend wipes store contents (account store removed; repo may still exist)
        │
        ▼
Ask: “Also delete the GitHub repository <owner/repo>?”
        │
   ┌────┴────┐
   Yes       No
   │         │
   ▼         ▼
Delete     Leave empty / non-Vizably repo
repo via   on GitHub
GitHub API
   │         │
   └────┬────┘
        ▼
Sign out + clear session
        ▼
Landing + short success message
```

Notes:

- **Step A (wipe files) is mandatory** for “account deleted.”
- **Step B (delete repo) is optional** and must be an explicit second confirmation.
- If the connected store was not a Vizably-created repo (user picked an existing
  repo that also holds other files), prefer **wipe Vizably paths only**, never
  `git rm` unrelated content. Prefer deleting known paths
  (`vizably.json`, `equalview.json` legacy, `scans/**`) in one commit.
- Google Drive: stub with a clear “not available until Phase 3” until Drive
  adapter exists (same pattern as other storage stubs).

---

## 3. Backend — StorageService

Add methods on `backend/services/storageService.js` (pure storage brain; no HTTP):

### 3.1 `wipeAccountStore(provider, storageRef, clients)`

1. Resolve owner/repo/branch from `storageRef` + clients (same helpers as load/save).
2. List files under the store root that belong to Vizably:
   - `vizably.json` (and legacy `equalview.json` if present)
   - everything under `scans/`
3. Delete them in **one atomic GitHub commit** (reuse the existing tree/commit/ref
   write path used by `saveScanResults` / init — do not leave a half-wiped store).
4. Return a summary: `{ wiped: true, pathsRemoved: [...], storageRef }`.
5. Errors: map permission failures to actionable codes (e.g. `STORAGE_WRITE_FORBIDDEN`).

### 3.2 `deleteGitHubRepository(storageRef, clients)`

1. Require `githubUserClient` (user access token / App UAT) — installation token
   alone may not delete the repo depending on permissions.
2. Call GitHub delete repo (`octokit.rest.repos.delete({ owner, repo })`).
3. Requires **Administration** on the App installation (same permission class as
   create). Surface `REPO_DELETE_FORBIDDEN` on 403 with the same upgrade guidance
   style as `REPO_CREATE_FORBIDDEN`.
4. Return `{ deleted: true, full_name }` or a structured error.

### 3.3 Unit tests (`backend/tests/storageService.test.js`)

- Wipe removes manifest + scan files; unrelated root files stay.
- Wipe on empty / already-wiped store is idempotent (or clear 404 handling).
- Delete repo success + 403 → `REPO_DELETE_FORBIDDEN`.
- Google provider returns Phase-3 stub error.

Run impact analysis on any method you edit (`wipe` / delete helpers and callers)
per project GitNexus rules before changing symbols.

---

## 4. Backend — Auth routes

Add authenticated endpoints in `backend/routes/auth.js` (thin; call
`storageService` + `authService.clientsFor`):

| Method | Path | Body | Behaviour |
|--------|------|------|-----------|
| `POST` | `/api/auth/account/wipe` | (optional provider) | Wipe Vizably files in the session user’s attached `storage`. |
| `POST` | `/api/auth/account/delete-repository` | `{ confirm: true }` | Delete the GitHub repo for attached `storage`. Require explicit `confirm`. |
| `POST` | `/api/auth/account/delete` | `{ deleteRepository: boolean }` | **Orchestrated** endpoint: wipe → optional delete repo → logout. Prefer this for a single round-trip if the UI collects both answers first. |

Recommended for #82 UX (two questions):

1. `POST /api/auth/account/wipe` after first confirm.
2. If user says yes to repo delete → `POST /api/auth/account/delete-repository`.
3. Always finish with existing `POST /api/auth/logout` (or include logout in a
   final `POST /api/auth/account/delete` that accepts `{ deleteRepository }`).

**Session rules:**

- Require auth + attached `user.storage` (same as load/save paths).
- After wipe/delete, clear `user.storage` / account payload from the session
  before or as part of logout so a stale cookie cannot reload a deleted store.
- Never write OAuth tokens into the store (existing non-negotiable).

**Route tests** (`backend/tests/auth.test.js`):

- Unauthenticated → 401.
- Wipe returns success and does not leave session claiming a loadable store.
- Delete-repository without `confirm` → 400.
- Happy path wipe + optional delete + logout.

---

## 5. Frontend — API client

In `frontend/src/lib/apiClient.js` (only file that may `fetch`):

- `wipeAccount()` → `POST /api/auth/account/wipe`
- `deleteAccountRepository()` → `POST /api/auth/account/delete-repository`
- or `deleteAccount({ deleteRepository })` → orchestrated endpoint

Mirror error `code` / `message` to the UI.

---

## 6. Frontend — AccountView UX

Replace the logout-only danger zone in `frontend/src/views/AccountView.jsx`:

1. **Step 1 — Wipe confirm**  
   - Copy: deletes Vizably data in `{storageLabel}` (`vizably.json` + scans).  
   - Primary: “Delete my Vizably data”.  
   - Call wipe API; show progress / disable double-submit.

2. **Step 2 — Repo delete prompt** (GitHub only, after wipe succeeds)  
   - “Also delete the repository `{full_name}` on GitHub?”  
   - Yes → delete-repository API.  
   - No → skip.  
   - Disclose Administration permission if delete fails with forbidden.

3. **Step 3 — Sign out**  
   - Call `onSignOut` / `logout` always after a successful wipe (whether or not
     the repo was deleted).  
   - Change button copy from “Yes, sign out” to match the real action.  
   - Remove the “storage deletion is not wired yet” disclaimer.

4. **Success**  
   - Landing (or sign-in) with a one-time banner: “Your Vizably account data was
     removed” (+ “repository deleted” if applicable). Pass via navigate state or
     query flag; do not persist it in storage.

Wire `App.jsx` so AccountView receives the new handlers (or a single
`onDeleteAccount`) instead of reusing `onSignOut` for delete confirm.

Update `frontend/src/__tests__/accountView.test.jsx`:

- Confirm no longer calls logout-only path without wipe.
- Two-step flow: wipe then optional repo delete then sign-out.
- Error states for wipe / repo-delete failures.

---

## 7. Permissions & copy (GitHub App)

Deleting a repository needs **Administration: Read and write** on the Vizably
GitHub App (same family as in-app create). In the UI:

- Mention that optional repo deletion uses Administration.
- On 403, reuse the upgrade / re-auth messaging pattern from create-forbidden.

Wiping files only needs **Contents: write** on the installed repo.

---

## 8. Docs to update when implementing

Keep these in sync with the code (same rule as other auth/storage work):

- This guide (mark steps done in the checklist below).
- [`githubGoogleAuthStorageImplementation.md`](./githubGoogleAuthStorageImplementation.md) — add wipe / delete endpoints to the API table.
- [`accountStorageContract.md`](./accountStorageContract.md) — short “Deleting a store” section (wipe paths; optional repo delete).
- [`TODO.md`](./TODO.md) — check off account-deletion items.
- Legal/privacy blurbs in `LegalView` if they still imply disconnect alone removes scans (align with real behaviour).

---

## 9. Suggested commit sequence

Keep PRs reviewable (~4–6 commits):

1. `StorageService.wipeAccountStore` + unit tests  
2. `StorageService.deleteGitHubRepository` + unit tests  
3. Auth routes + auth tests  
4. `apiClient` + AccountView two-step UX + frontend tests  
5. Docs + legal/copy alignment  

Run `detect_changes` before committing (GitNexus project rule). Do not add
Cursor co-author trailers if the team asks to omit them.

---

## 10. Acceptance checklist (closes #82)

- [ ] “Delete my account” no longer only signs the user out.
- [ ] Vizably files (`vizably.json` / legacy manifest + `scans/`) are removed from
      the connected store.
- [ ] User is asked whether to delete the GitHub repository; Yes deletes it, No leaves it.
- [ ] Session is cleared afterward; user cannot load the old account without
      reconnecting / re-init.
- [ ] Failures (permissions, network) show clear errors and do not silently
      pretend deletion succeeded.
- [ ] Backend + frontend tests cover wipe, optional repo delete, and logout.
- [ ] Docs updated; Google remains explicitly stubbed until Phase 3.

When the checklist is green and the PR is merged, close
[#82](https://github.com/codrlabs/vizably/issues/82).
