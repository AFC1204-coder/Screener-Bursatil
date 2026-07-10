# StatsEdge reliability audit — 2026-07-10

Scope: integration-test isolation, `/api/coverage`, `coverage_scan_summary`,
`scan_coverage_breakdown`, scan finalization RPCs, runtime schema guards,
provider failure handling, and Supabase production deployment parity.

## 1. Integration owner isolation — fixed

**Root cause.** `check-scan-finalize.real.test.mjs` and
`check-signal-contradictions.real.test.mjs` ran in separate Vitest workers with
the same `owner_id=playwright-check-2`. Both suites deleted all `scans` and
`scan_results` for that owner in setup/cleanup.

**Reproduction on parent of `71ec0c5`.** The contradictions suite completed
first and logged cleanup `scans=0 scan_results=0` while the finalization suite
was still inside `runScanChunk`. The latter completed 2.7 seconds later and
failed because `scanState.length` was `0` instead of `1`.

**Fix.** Commit `71ec0c5` assigns a unique owner per suite run using suite name,
timestamp, pid, and random suffix; cleanup remains scoped to that owner.

**Verification.** The two conflicting suites passed together against real
Supabase with distinct owners and post-cleanup `0/0`. Three consecutive full
runs each reported `68 files passed`, `759 passed`, `8 skipped`, `0 failed`.

## 2. Mechanical / low-risk reliability gaps — fixed

### Runtime RPC guards invoked production logic and returned exit code 0

- **Evidence before:** real `npm run supabase:status` reported `10/12 OK`, a
  domain-error warning for `finalize_scan_results`, a real statement timeout
  from `purge_daily_bars_backstop`, and still returned `EXIT_CODE=0`.
- **Severity:** high for deployment detection. CI could accept a missing RPC;
  the guard also executed a destructive maintenance function as a probe.
- **Fix:** discover RPC paths through PostgREST OpenAPI with the service role,
  without invoking them. Both CLI and `/api/supabase/status` now cover all 12
  required RPCs. The CLI exits non-zero when tables/RPC paths are absent.
- **Verification:** production: `19/19` tables, `12/12` RPCs, management API OK,
  `EXIT_CODE=0`. Mock OpenAPI with no RPCs: `0/12`, `EXIT_CODE=1`. Runtime
  diagnostic: `schemaReady=true`, 19 tables + 12 functions, 528 ms.

### Coverage RPC errors were nested while top-level output looked complete

- **Evidence before:** with an unreachable Supabase endpoint,
  `buildCoverageReport` returned `scannedSymbols=0` and
  `scanCoverage.status=error`, but top-level `status` and `degraded` were absent.
- **Severity:** high; consumers and smoke checks could treat error-derived zeroes
  as measured coverage.
- **Fix:** top-level `status=partial-scan-coverage`, `degraded=true`, and a high
  severity blocker. Smoke/RC contracts require a complete Supabase-backed scan
  coverage result.
- **Verification:** controlled missing-RPC test logs
  `status=partial-scan-coverage degraded=true scanStatus=error scanned=0`.

### Coverage query path was not deployed with its declared index

- **Evidence before:** `scan_results` had 12,182 rows / 374 MB. Production had no
  `(owner_id, created_at desc)` index even though `schema.sql` declares it.
  Plan: sequential scan + sort. Direct RPC: timeout at 2,506 ms; with 10 s it
  completed in 5,913 ms.
- **Severity:** medium-high availability; `/api/coverage` degraded on real data.
- **Fix:** production migration
  `20260710142340_scan_results_owner_created_index`, plus aligned 4,000-row
  default and a 7 s inner deadline under the route's 8.5 s total deadline.
- **Verification:** plan now uses `scan_results_owner_created_idx` with startup
  cost 0.29. Three real handler calls: HTTP 200 complete in 2,347 / 2,211 /
  2,198 ms; `rowsRead=4000`, `uniqueSymbols=3699`.

### Secondary `/api/scan-coverage` failures were swallowed

- **Evidence before:** failures reading leaderboards, provider runs, or cursor
  were converted to empty values via `.catch(() => [])` / empty cursor.
- **Severity:** medium; the primary breakdown stayed correct, but operational
  evidence silently disappeared.
- **Fix:** preserve fallbacks while returning
  `status=partial-secondary-dependencies`, `degraded=true`, and named failures.
- **Verification:** controlled leaderboard timeout is returned as
  `failure=leaderboard_snapshots timeout` instead of an unexplained empty list.

### Scan runner could fail before state persistence without any log

- **Evidence:** the initial Supabase read and the fallback error-state patch had
  empty catches.
- **Severity:** medium operational visibility; scan stays at last heartbeat.
- **Fix:** structured error logs include `scanId`, `ownerId`, and error at initial
  read, chunk failure, and failed error-state persistence.
- **Verification:** unit test forces the initial read failure and asserts the
  structured log.

### Migration history drift

- **Evidence:** production migration history used versions `20260710104226`,
  `104227`, `104230`, and `112255`; local filenames used different versions and
  `coverage_scan_summary` was untracked.
- **Severity:** medium deployment reliability.
- **Fix:** local filenames now match production history; the new index migration
  uses its real production version `20260710142340`.

## 3. Structural / high-risk gaps — proposals only

### Terminal `done` can mean zero successful scan rows

- **Evidence:** with all three Yahoo chart calls forced to fail, the real runner
  logic logged `status=done saved=0 completed=3 errors=3`.
- **Severity:** high; terminal state misrepresents completeness and can make an
  empty/partial scan appear successfully finished.
- **Proposal:** define an explicit completeness contract (`complete`, `partial`,
  `failed`) based on saved/completed/error ratios; do not finalize or publish
  leaderboards below the agreed threshold; add retryable vs terminal provider
  error classes. This changes scan semantics and was not implemented.

### Yahoo scan fetches have no deadline

- **Evidence:** replacing `global.fetch` with a never-resolving promise left
  `fetchYahooChart` at `PENDING_AFTER_250MS`; the main chart/profile fetches do
  not receive an AbortSignal or timeout.
- **Severity:** high availability; a provider stall can consume the whole scan
  link lifetime and leave only a stale heartbeat.
- **Proposal:** introduce a shared provider request policy with deadline,
  bounded retry/backoff, and typed errors, then thread it through scan and chart
  callers. This touches the chart path explicitly excluded from this task and
  was not implemented.

### `purge_daily_bars_backstop` cannot complete as one transaction

- **Evidence:** the real RPC returned `canceling statement due to statement
  timeout`. `daily_bars` contains 3,469,296 rows and 9,029 owner/symbol pairs;
  only 1,244 rows across 27 pairs exceed caps, yet the plan performs a global
  window over about 3.8 M rows. The weekly cron is active; no run history exists
  yet in `cron.job_run_details`.
- **Severity:** medium operational/cost risk; it does not directly serve wrong
  data, but maintenance rolls back and table growth is unbounded.
- **Proposal:** split orphan cleanup and cap trimming into bounded batches,
  drive trim from over-cap pairs, persist progress, and expose cron outcome.
  Destructive maintenance SQL was not rewritten in this task.

### `scan_coverage_breakdown(limit=10000)` is not stable on real data

- **Evidence:** production calls completed in 7,522 ms and 7,575 ms, then failed
  at 8,153 ms with PostgreSQL `57014` statement timeout.
- **Severity:** medium availability; the endpoint fails visibly with HTTP 500,
  rather than serving incorrect data.
- **Proposal:** materialize/extract coverage fields or maintain a summary table.
  Reducing the limit without an explicit sampling contract would change report
  meaning, so no workaround was applied.

### Baseline schema does not define the three new aggregation/input RPCs

- **Evidence:** `schema.sql` contains finalization and purge, but not
  `coverage_scan_summary`, `scan_coverage_breakdown`, or `scan_finalize_inputs`;
  they exist only in migrations and in production.
- **Severity:** medium deployment drift; a fresh `supabase:schema` apply is
  incomplete, though the strengthened status guard now fails loudly.
- **Proposal:** choose one canonical deployment model: regenerate the baseline
  from migrations, or make the admin command apply tracked migrations. Copying
  hundreds of SQL lines into the baseline without that decision was avoided.

## 4. Negative findings and final verification

- No Edge Functions are deployed, and the repo contains no `functions/v1` or
  Edge Function dependency in the audited coverage/scan path.
- Real scan finalization succeeded end-to-end: 3/3 rows had
  `percentileScope=final`, `finalizationStatus=succeeded`, cleanup `0/0`.
- Working-tree full suite after fixes: 71 files, 764 passed, 8 skipped.
- Exact staged snapshot: 68 files, 742 passed, 8 skipped; production build
  compiled successfully and generated all 43 static pages.
