# vizably — Codebase Reorganization (post-mortem)

**Status:** Complete · Phase 1 + Phase 3 router shipped 2026-04-28
(PRs #38, #39, #40)
**Companions:** [`project-roadmap.md`](project-roadmap.md),
[`architecture-map.md`](architecture-map.md),
[`axecore-integration-roadmap.md`](axecore-integration-roadmap.md)

This document is the historical record of the Phase 1 + Phase 3 reorg.
It explains **what changed and why**. For:

- **the current repo layout** → see the top-level
  [`README.md`](../../README.md).
- **the target architecture** → see
  [`architecture-map.md`](architecture-map.md) §6.
- **what's still to land** → see
  [`architecture-map.md`](architecture-map.md) §6.6 and
  [`project-roadmap.md`](project-roadmap.md).

The original brainstorm lives at
[`.kilo/plans/1777290694097-nimble-star.md`](../../.kilo/plans/1777290694097-nimble-star.md).

---

## 1. Goals (from when the work started)

1. Each layer (route ⇄ controller ⇄ service ⇄ data) is a separate
   file with a single responsibility, so the real Puppeteer + axe-core
   scanner can drop into `services/` in Phase 2 without touching
   routing or the response shape.
2. Frontend pages own layout, hooks own loading/error/data state, and
   `ApiClient` is the only place `fetch` is called. This matches
   [`architecture-map.md`](architecture-map.md) §6.4.
3. The frontend has a real router so a results URL is shareable, which
   was an open Phase 3 decision in
   [`project-roadmap.md`](project-roadmap.md).
4. All four `npm test` / `npm run lint` / `npm run build` /
   `node --test` invocations are green at every milestone.

## 2. What changed (and why)

### 2.1 Backend (Phase 1 of [`project-roadmap.md`](project-roadmap.md))

| Before                                   | After                                                         | Why                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `backend/index.js` — 50-line god file    | `backend/index.js` (12 lines) + `app.js` + `routes/` + `controllers/` + `services/` | One responsibility per file; Phase 2 swaps the controller's `mockScanResults` for a `ScanRunner` without touching routing. |
| Routes inline in `index.js`              | `routes/scan.js`, `routes/problems.js`, mounted by `routes/index.js` | Routers know URLs and HTTP verbs; nothing else.                                                                    |
| Handler closures                         | `ScanController` class, methods bound in constructor          | Avoids the `this`-binding bug documented in [Scanning](https://open.codrlabs.com/vizably/scanning/).          |
| No URL validation                        | `services/ssrfGuard.js` (rejects non-http schemes, loopback, RFC1918) | Locks in the SSRF policy from `project-roadmap.md` "Open decisions" before Phase 2 wires Puppeteer.                |
| No transformer                           | `services/axeTransformer.js` stub with `transform()`/`bucketFor()`, unit-tested | The "right shape" lives in code; Phase 2 fills in the body without renaming the export.                            |
| Hard-coded `http://localhost:5173` CORS  | `process.env.FRONTEND_ORIGIN` (default `http://localhost:5173`) | One config knob; documented in `.env.example`.                                                                     |
| `npm test` is a no-op                    | `node --test tests/` runs `node:test` + `supertest`           | "Backend test runner" decision from `project-roadmap.md` resolved: stdlib runner, no extra dep beyond supertest.    |
| No `Dockerfile`                          | Minimal `backend/Dockerfile` + backend service in `docker-compose.yml` | Phase 1 deliverable from the roadmap.                                                                              |

#### Composition root

`app.js` is the **only** file that constructs concrete classes:

```js
const scanController = new ScanController({ mockScanResults, ssrfGuard });
mountRoutes(app, { scanController });
```

Tests get a fully-wired app via `buildApp()` and never bind a real
port (see `backend/tests/scan.test.js`).

### 2.2 Frontend (Phase 3 of [`project-roadmap.md`](project-roadmap.md))

| Before                                      | After                                                | Why                                                                                                  |
| ------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `App.jsx` switches on `window.location.pathname` | `App.jsx` uses `BrowserRouter` + `Routes`          | Phase-3 routing decision: `react-router-dom` (already in `package.json`).                            |
| `landingPage.jsx`, `ScanResults.jsx` at top of `src/` | `src/pages/LandingPage.jsx`, `src/pages/ScanResultsPage.jsx` | Match the "page = screen" convention from [`architecture-map.md`](architecture-map.md) §6.4.        |
| `fetch(...)` inline in `ScanResults.jsx`    | `lib/apiClient.js` + `hooks/useScan.js`              | Single place that imports `fetch`; tests stub the singleton. See `architecture-map.md` §6.4.         |
| `window.location.href = …` redirect         | `useNavigate()` + `<Link>`                           | Real client-side navigation, no full page reload.                                                    |
| `ProblemCategoryBox` defined inside `ScanResults.jsx` | Extracted to `components/ProblemCategoryBox.jsx`   | Reusable; pages own layout, components own UI primitives.                                             |
| "What's Good" inline                        | `components/WhatsGood.jsx`                           | Same reason.                                                                                         |
| Inline URL parsing                          | `utils/urlValidator.js`                              | One pure function; unit-tested.                                                                      |
| `alert('Please enter a valid URL…')`        | Inline `role="alert"` validation message             | Phase 3 wireframe goal (architecture-map §1.5.2).                                                    |
| `window.location.search` parsing            | `useSearchParams()` and `useParams()`                | Idiomatic with the new router.                                                                       |
| No `/problems/:id` route                    | `pages/ProblemPage.jsx` + `hooks/useProblem.js`      | Survives refresh and is shareable; `ScanResultsPage` still keeps the in-page detail view too.        |

#### Hook state-machine pattern

Both `useScan` and `useProblem` derive validation errors **outside**
the effect and only call `setState` inside async resolutions, to
satisfy React 19's `react-hooks/set-state-in-effect` rule. The
returned shape is always `{ data, loading, error }`.

### 2.3 Shared

`shared/types.js` holds JSDoc typedefs (`Problem`, `ScanResult`,
`Impact`, planned `User`/`StoredScan`). Backend and frontend reference
the same definitions via `@typedef {import(...)}` so the wire shape
is documented once.

## 3. Verification

| Command                              | Result   |
| ------------------------------------ | -------- |
| `cd backend && npm test`             | 17 / 17  |
| `cd frontend && npm test -- --run`   | 19 / 19  |
| `cd frontend && npm run lint`        | clean    |
| `cd frontend && npm run build`       | ok       |
| `docker compose config`              | valid    |

## 4. What's next

Tracked in [`project-roadmap.md`](project-roadmap.md); the slot each
piece lands in is captured in
[`architecture-map.md`](architecture-map.md) §6.6.
