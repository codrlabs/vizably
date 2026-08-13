# Account Storage Contract — "the data needed to load back the account"

This file is the **source of truth** for what a valid vizably account store
looks like inside a user's GitHub repository or Google Drive folder. The
fit-check (`POST /api/auth/storage/validate`) reads this; load/init write it.
The auth + flow design lives in
[`githubGoogleAuthStorageImplementation.md`](githubGoogleAuthStorageImplementation.md).

The whole point: an account is **portable**. Anything required to reconstruct a
user's vizably account on a fresh device must live *in the store*, described
here — nothing essential lives on an vizably server.

---

## On-disk layout

The store is rooted at the repo root (GitHub) or the selected folder (Drive):

```
<storage root>/
├── vizably.json          # manifest — identity + storage binding + cached summary
└── scans/
    ├── index.json          # cache: lightweight list for the dashboard
    ├── 9f3c…a1_codrlabs.com.json     # one immutable scan, named <scanId>_<host>.json
    └── 2b7e…04_stripe.com.json
```

**Truth vs. cache.** The immutable files in `scans/` are the truth. `index.json`
and `vizably.json → summary.scanCount` are **caches** — always rebuildable by
listing `scans/*.json`. Readers reconcile on load; they never trust a cache over
the files.

---

## Manifest — `vizably.json`

```jsonc
{
  "vizably": true,                 // presence + true ⇒ this is an EV store
  "kind": "account-store",
  "schemaVersion": 1,                // bump on breaking layout changes
  "minReaderSchemaVersion": 1,       // oldest reader that may safely OPEN this

  "account": {
    "id": "uuid-v4",                 // random, stable; NOT email/login
    "createdAt": "2026-06-30T18:04:00Z",
    "updatedAt": "2026-06-30T18:04:00Z"
  },

  "storage": {
    "provider": "github",            // "github" | "google"
    "providerStorageId": "R_kgDOA…", // repo node id / Drive folder id — stable
    "ownerId": "MDQ6VXNlcj…",        // stable provider user/org id (display/binding)
    "ownerDisplay": "samuel",        // login or email — debug/display only
    "repo": "samuel/site-audits",    // GitHub only; display/debug
    "branch": "main"                 // GitHub only
  },

  "settings": {
    "autoDelete90d": true
  },

  "summary": {                       // CACHE — rebuildable from scans/
    "scanCount": 12,
    "lastScanAt": "2026-06-30T18:03:10Z"
  },

  "features": []                     // forward-compat capability flags
}
```

### Field rules

- `account.id` is a **random UUID** minted at init and never changed. It is the
  account identity; the provider login/email are display only.
- `storage.providerStorageId` / `storage.ownerId` are **stable provider ids**
  (repo node id, Drive folder id, user/org id). Names change; ids don't.
- `schemaVersion` is for **breaking** changes; `minReaderSchemaVersion` lets a
  newer writer mark a store unreadable by too-old clients.
- `summary` and `scanCount` are caches. Never block a load because they disagree
  with `scans/` — reconcile instead.
- **Never** store OAuth tokens, refresh tokens, API keys, or any secret here.

---

## Scan index — `scans/index.json`

A cache to render the dashboard without downloading every scan.

```jsonc
{
  "schemaVersion": 1,
  "scans": [
    {
      "id": "9f3c…a1",               // UUID; matches the scan filename prefix
      "url": "https://codrlabs.com",
      "host": "codrlabs.com",
      "scannedAt": "2026-06-30T18:03:10Z",
      "score": 72,
      "issues": 7,
      "topSeverity": "critical",
      "file": "scans/9f3c…a1_codrlabs.com.json",
      "size": 18342,                 // bytes — helps drift/corruption checks
      "sha256": "…"                  // optional integrity check
    }
  ]
}
```

- Entries are keyed by **UUID**, not `host_timestamp` (collisions, re-scans).
- `size`/`sha256` let load-time reconcile detect corruption cheaply.

---

## Scan file — `scans/<scanId>_<host>.json`

Immutable. The full `ScanResult` (see
[`../../../shared/types.js`](../../../shared/types.js)) plus a small wrapper:

```jsonc
{
  "id": "9f3c…a1",
  "schemaVersion": 1,
  "url": "https://codrlabs.com",
  "scannedAt": "2026-06-30T18:03:10Z",
  "result": { /* ScanResult: problems, whatsGood, … */ }
}
```

Never rewritten in place. "Delete" removes the file and the index entry (GitHub
history still retains it — disclose this).

---

## Validation rules (the fit-check)

Given a selected storage, the backend decides a `status` (+ optional `reason` +
`capabilities`). This is exactly what ConnectView renders.

```
read <root>/vizably.json
 ├─ not found
 │   ├─ store empty (no other files)            → initializable
 │   └─ store has unrelated files               → unrelated
 ├─ found but unparseable / missing required    → invalid (reason: malformed_manifest)
 ├─ found, duplicate manifest (Drive)           → invalid (reason: duplicate_manifest)
 ├─ found, vizably !== true                   → unrelated
 ├─ found, schemaVersion > server supports       → incompatible (reason: too_new)
 ├─ found, schemaVersion < server, migratable   → loadable (reason: migration_required)
 └─ found, supported schemaVersion              → loadable
                                                   (reason: repairable if index drift)
```

Always attach capabilities probed against the provider:

```ts
capabilities: { canRead: boolean; canWrite: boolean; canCreate: boolean }
```

Example: a read-only fork → `loadable` with `canWrite:false` (UI allows browsing
saved scans but disables new saves and init).

### Load-time reconciliation

On `action: "load"`:

1. List `scans/*.json`.
2. Rebuild the index from the files; drop entries with no file (orphans) and
   files that fail to parse (corrupt).
3. If the rebuilt index differs from `index.json`, rewrite it and set
   `summary.scanCount` / `lastScanAt`. Surface `reason: "repairable"` to the UI.

### Init-time race guard

On `action: "init"`, **revalidate** immediately before writing. Only create
`vizably.json` if it still does not exist (conditional create). Never trust a
stale `validate` result — another device may have initialized in between.

---

## Write atomicity

All multi-file account mutations (new scan = scan file + index + manifest
summary) must be atomic or partial-write tolerant:

- **GitHub**: prefer a **single commit** carrying all changed files; write
  against the expected branch HEAD / blob `sha` (optimistic concurrency). On a
  `409`/stale-sha, refetch and retry.
- **Google Drive**: no multi-file transaction — write the **immutable scan file
  first** (so truth is never lost), then update `index.json` and the manifest
  using ETag/generation preconditions; rely on load-time reconcile to heal any
  gap.

### Deleting a scan

`DELETE /api/scans/:id` removes one immutable file `scans/<scanId>_<host>.json`
and refreshes rebuildable caches (`scans/index.json` + manifest `summary`).
Other scan files and account identity stay. GitHub history may still contain
the deleted blob unless history is rewritten — disclose that in the UI if you
talk about permanence. See [`scanDeletion.md`](./scanDeletion.md).

---

## Versioning & migration

- **Patch/additive** changes (new optional field, new `features` flag): no
  `schemaVersion` bump; old readers ignore unknown fields.
- **Breaking** changes (renamed/removed fields, layout move): bump
  `schemaVersion`; set `minReaderSchemaVersion` so older clients report
  `incompatible` instead of corrupting the store.
- **Migration** (`reason: "migration_required"`): back up or be retry-safe,
  transform, then bump `schemaVersion` — only on a writable store.

---

## Quick checklist for implementers

- [ ] `vizably.json` written with random `account.id` + stable provider ids.
- [ ] Scan files immutable, named `<scanId>_<host>.json`, scanId is a UUID.
- [ ] `index.json` + `summary` treated as caches; rebuilt on load.
- [ ] Fit-check returns `status` + `reason` + `capabilities`.
- [ ] `init` revalidates and conditionally creates the manifest.
- [ ] GitHub writes use blob `sha`; Drive writes use generation/ETag.
- [ ] No tokens/secrets ever written into the store.
