# Documentation

Most of vizably's documentation now lives on
[**Codrlabs Open**](https://open.codrlabs.com/vizably/overview/), so it stays
in one place across every Codrlabs project. Start there for getting started,
architecture, URL normalization, scanning, and account storage.

This folder holds what's repository-local: guides tied to this repo's own
tooling, and tracked implementation plans.

```
docs/
├── guides/      # Repo-local how-to and reference. Stable, evergreen.
└── plans/       # Tracked roadmaps with phases, deliverables, status.
```

## Guides

- [`guides/workflow.md`](guides/workflow.md) — Git + GitHub workflow,
  branching, recovering from common mistakes.
- [`guides/reviewing.md`](guides/reviewing.md) — what a good review looks
  like in this repo.
- [`guides/auth_storage_guide/TODO.md`](guides/auth_storage_guide/TODO.md)
  — implementation checklist for GitHub/Google auth + portable storage.
  The conceptual design lives at
  [Account storage](https://open.codrlabs.com/vizably/account-storage/) on
  Codrlabs Open; the current API surface is in `backend/README.md`.
- [`guides/auth_storage_guide/scanDeletion.md`](guides/auth_storage_guide/scanDeletion.md)
  — implementation plan for per-scan delete
  ([#112](https://github.com/codrlabs/vizably/issues/112)).

## Plans

Time-bounded, trackable work. Each plan has phases, concrete
deliverables, and a status. When a plan is complete, archive it but
leave it in place for history.

- [`plans/project-roadmap.md`](plans/project-roadmap.md) — Top-level
  map of phases (housekeeping → real scanner → UX → reliability →
  productionization).
- [`plans/architecture-map.md`](plans/architecture-map.md) — Visual
  map: every screen, what it does, what the backend does for it, and
  how frontend/backend code is organized.
- [`plans/axecore-integration-roadmap.md`](plans/axecore-integration-roadmap.md)
  — Replaced mock scan data with a real axe-core scanner (shipped).
- [`plans/codebase-reorganization.md`](plans/codebase-reorganization.md)
  — Post-mortem of the Phase 1 + Phase 3 reorg (PRs #38–#40):
  before/after tables and the rationale for each file move. The
  current layout itself lives in the top-level
  [`README.md`](../README.md).

## When to add what

| Need | Where it goes |
|------|---------------|
| "How does vizably work?" / "How do I get set up?" | [Codrlabs Open](https://open.codrlabs.com/vizably/overview/) |
| "How do I do X specific to this repo's tooling?" | `guides/` here |
| "What work needs to happen, in what order?" | `plans/` here, or a GitHub issue for anything smaller than a multi-issue body of work |

For lightweight task tracking prefer GitHub Issues. Use `plans/` only
when a body of work spans many issues and needs a shared narrative.
