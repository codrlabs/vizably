# Axe-Core Integration Roadmap

**Status:** Phase 1 complete — the real Puppeteer + axe-core scanner
shipped in PR #50 (`services/scanRunner.js`, transformer implemented,
Alpine Chromium in the Dockerfile). Phase 2 (reliability) is next; the
Phase 3 UX items landed with the design-system frontend.
**Owner:** Eli Iguer
**Reference guide:** [Scanning](https://open.codrlabs.com/vizably/scanning/) on Codrlabs Open

## Goal

Replace the hardcoded mock scan response in
`backend/data/mockScanResults.js` with a real Puppeteer + axe-core
scanner, end-to-end, behind the existing API surface
(`POST /api/scan`, `GET /api/scan-results`, `GET /problems/:id`).

## Non-goals (for the first iteration)

- Authentication / accounts
- Persistent storage of scan results
- Queueing, multi-tenant rate limiting
- PDF report generation

These are tracked as later phases below.

## Constraints / decisions

The full list of resolved + still-open decisions lives in the parent
[`project-roadmap.md`](project-roadmap.md#decisions). Phase 2 is
specifically blocked on the **scan response shape** and **sync vs
async** decisions there. Routing, SSRF policy, and the backend test
runner are resolved.

## File layout (current)

This is what's on disk after PR #38 — Phase 2 fills in the bodies, it
doesn't add new top-level files apart from `services/scanRunner.js`:

```
backend/
├── index.js                    # bootstrap (load .env, listen)
├── app.js                      # composition root (DI wiring)
├── controllers/
│   └── scanController.js       # request/response, bound handlers;
│                               #   Phase 2 swaps mockScanResults for
│                               #   a ScanRunner injection
├── services/
│   ├── axeTransformer.js       # stub today; Phase 2 fills the body
│   ├── ssrfGuard.js            # blocks non-http(s), localhost, RFC1918
│   └── scanRunner.js           # [planned, Phase 2] Puppeteer driver
├── routes/
│   ├── index.js                # mounts /api and /problems
│   ├── scan.js                 # POST /api/scan, GET /api/scan-results
│   └── problems.js             # GET /problems/:id
├── data/
│   └── mockScanResults.js      # fixture; only consumer in Phase 2 is tests
├── tests/                      # node:test + supertest
│   ├── health.test.js
│   ├── scan.test.js
│   ├── ssrfGuard.test.js
│   └── axeTransformer.test.js
├── Dockerfile
├── README.md
└── .env.example                # committed; .env stays gitignored
```

## Phases

### Phase 1 — Wire up a real scanner (MVP)

Scaffolding shipped in PR #38. The remaining unchecked items are the
ones that actually swap the mock for real scans (Phase 2 in the parent
project-roadmap):

- [x] Add `puppeteer` and `axe-core` to `backend/package.json`; pin
      versions. (PR #50.)
- [x] Create `backend/controllers/scanController.js` with URL validation
      and an SSRF guard (reject non-http(s), private IPs, localhost).
      (URL validation lives in `services/ssrfGuard.js` and is wired
      into the controller; PR #38.)
- [x] Create `backend/services/axeTransformer.js`; cover the mapping in
      `backend/tests/`. (Implemented in PR #50; emits per-violation
      `count` for the report UI.)
- [x] Extract routes into `backend/routes/scan.js`; mount from
      `index.js`. (Done via `routes/index.js` + `app.js` composition
      root; PR #38.)
- [x] Add `backend/Dockerfile` (must include the system libs Puppeteer's
      bundled Chromium needs). (Minimal `node:22-alpine` Dockerfile
      shipped in PR #38; Chromium system deps will be added when
      Puppeteer actually lands.)
- [x] Add `backend/.env.example` documenting `PORT`,
      `FRONTEND_ORIGIN`, etc. (PR #38.)
- [x] Update `docker-compose.yml` with the backend service. (PR #38.)
- [x] Frontend: keep using the existing endpoints; no shape change if
      possible. (Frontend now consumes them via `lib/apiClient.js` +
      `useScan` / `useProblem` hooks, same shape; PR #40.)
- [ ] Smoke-test against a known-bad page (e.g. a page with missing
      alts and low contrast) and a known-clean page.

**Done when:** `POST /api/scan { url }` returns real axe-core results
in the existing shape, and `mockScanResults.js` is only referenced from
tests.

### Phase 2 — Reliability

- [ ] Per-request timeout for `page.goto` and overall scan budget
- [ ] Concurrency cap on Puppeteer instances
- [ ] Structured logging (URL, duration, violation counts, error class)
- [ ] Friendly error responses for the most common failures
      (DNS failure, navigation timeout, HTTP error status)
- [ ] Backend test suite wired into CI (Jest or Vitest + supertest)

### Phase 3 — UX upgrades

- [x] Decide router question above; if yes, migrate `App.jsx`
      (react-router v7; design-system frontend.)
- [x] Loading + progress UI on the scan page — the landing spinner
      now runs for the real `POST /api/scan` duration.
- [ ] Surface axe-core `incomplete` results as a "needs manual review"
      bucket
- [x] Link each problem to its `helpUrl` ("WCAG reference" button in
      `views/ProblemView.jsx`.)

### Phase 4 — Productionization

- [ ] Caching of scan results by URL (with TTL)
- [ ] Rate limiting per IP
- [ ] Background job queue (e.g. BullMQ) for slow sites
- [ ] Persistence (Postgres) for scan history
- [ ] Authentication (JWT) for scan endpoints
- [ ] PDF report generation

## Risks / things that have bitten us before

- **Puppeteer in Docker**: Alpine images frequently miss Chromium
  dependencies. Either install them or use a Debian-based base image.
  The current `backend/Dockerfile` is `node:22-alpine` and works for
  the mock — Phase 2 will need to revisit this when Chromium lands.
- **CORS**: ~~backend currently only allows `http://localhost:5173`~~
  Now config-driven via `FRONTEND_ORIGIN` in `backend/app.js` (PR #38),
  defaulting to `http://localhost:5173`.
- **`this` binding in controller**: the integration guide previously
  shipped a bug where `req.body` destructuring lost `this` on
  `scanWebsite`. The shipped `ScanController` binds its methods in the
  constructor (`this.postScan = this.postScan.bind(this)`), which
  sidesteps the trap — keep that pattern when adding new handlers.
