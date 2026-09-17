<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **vizably** (1677 symbols, 3451 relationships, 66 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/vizably/context` | Codebase overview, check index freshness |
| `gitnexus://repo/vizably/clusters` | All functional areas |
| `gitnexus://repo/vizably/processes` | All execution flows |
| `gitnexus://repo/vizably/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

# vizably — Architecture & Conventions

vizably is an accessibility scanner: paste a URL, get a categorized,
human-readable accessibility report. Two halves, one wire contract.

- **Backend** (`backend/`, Node + Express) is dumb about presentation. Layers,
  outer→inner: `routes/` (URLs + verbs) → `controllers/` (HTTP req/res, classes
  with constructor-bound methods) → `services/` (the brain). `app.js` is the
  **composition root** — the one place concrete classes are constructed and wired;
  everything else takes deps as arguments so layers are unit-testable without a DI
  framework. Pure modules (`axeTransformer`, `ssrfGuard`) take input → return
  output, no side effects. Stateful things are classes (`ScanRunner`, future
  `BrowserPool`).
- **Frontend** (`frontend/`, React + Vite) is dumb about scanning. Pages =
  functional components in `views/`; side effects live in `hooks/`;
  `lib/apiClient.js` is the **only** file that imports `fetch`; `utils/urlValidator.js`
  validates input. Talks to the backend through `/api/*` (Vite proxies in dev).
- **Shared contract**: `shared/types.js` holds JSDoc `@typedef`s (`ScanResult`,
  `Violation`, …) imported by both sides — the wire format is the only contract
  that matters.
- Deeper detail: [`docs/plans/architecture-map.md`](docs/plans/architecture-map.md)
  (§6 code architecture) and [`README.md`](README.md) (current layout).

## Accounts & storage — bring-your-own-storage (portable account)

vizably keeps **no database of its own**. A signed-in user's entire account
(profile, settings, saved scans) lives in **storage they already own**: one
**GitHub repository** or one **Google Drive folder**. GitHub/Google OAuth is used
only to *identify* the user and get an API token; the user-owned store is the
source of truth. This is what makes the product cheap to offer to everyone — no
per-user hosting, no lock-in; the account is portable across devices.

The connection UX is **browse → select → validate → load-or-init**:

1. User connects GitHub or Google (OAuth).
2. They **see the repos/folders they already have** and **select one**
   (GitHub: backend lists repos; Google: client-side **Google Picker**, because
   `drive.file` cannot browse existing folders).
3. vizably runs a **fit-check** (`POST /api/auth/storage/validate`) — does this
   storage hold a valid vizably account store? → `loadable` / `initializable` /
   `unrelated` / `incompatible` / `invalid` (+ capabilities).
4. vizably **loads** the existing account back, or **initializes** the store.

On-disk contract (the "data needed to load back the account"): a root
`vizably.json` manifest + a `scans/` folder (`index.json` cache + one immutable
`<scanId>_<host>.json` per scan). Scan files are truth; `index.json` and
`scanCount` are rebuildable caches.

When working on auth/storage, treat these as the source of truth and keep them in
sync with the code:

- [`docs/guides/auth_storage_guide/githubGoogleAuthStorageImplementation.md`](docs/guides/auth_storage_guide/githubGoogleAuthStorageImplementation.md)
  — auth flow, endpoints, scopes, frontend design.
- [`docs/guides/auth_storage_guide/accountStorageContract.md`](docs/guides/auth_storage_guide/accountStorageContract.md)
  — manifest + scans layout + fit-check + concurrency rules.
- [`docs/guides/auth_storage_guide/TODO.md`](docs/guides/auth_storage_guide/TODO.md)
  — implementation checklist.

Non-negotiables for this subsystem:

- **No tokens/secrets in the store.** OAuth tokens are encrypted at rest in the
  session (AES-256-GCM), never written to the repo/folder.
- **Possession-based identity by default** — whoever can read/write the store can
  load the account; treat the storage ACL as the account ACL. Record stable
  provider ids (repo node id / Drive folder id / owner id), not names.
- **Concurrency & partial writes are expected** — multiple devices and
  collaborators touch the store. Scan files are immutable; caches reconcile on
  load; GitHub writes use blob `sha`, Drive writes use generation/ETag.
- **Scope tradeoffs are real and must be disclosed in the UI**, not just docs
  (GitHub OAuth `repo` is all-or-nothing; Google browsing needs Picker or
  `drive.metadata.readonly`).
- This **supersedes** the Postgres + JWT sketch in the Phase 5 roadmap — there is
  no project DB.
