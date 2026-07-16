# StatsEdge coverage execution plan

Goal: cover the broad investable global equity market for Weinstein/Minervini screening, while excluding low-value noise such as malformed tickers, funds, warrants, debt, preferreds, SPAC units, microcaps and illiquid shares.

## Phase 0 - now

Implemented:

- Universe Engine snapshot API: `/api/universe-engine`.
- Compatibility universe API: `/api/universe`.
- Coverage report API: `/api/coverage`, now split into inventory candidates, scanned-fresh coverage and ranking-eligible coverage so broad universe counts are not confused with fully materialized screener coverage.
- Universe Quality Gate for instrument hygiene.
- Scanner Quality Gate for hydrated rows before ranking.
- Supabase schema for universe snapshots, daily bars, fundamentals snapshots, shadow universe candidates, symbol resolutions and provider run logs.
- Protected refresh job: `/api/jobs/universe-refresh`.
- HKEX official universe adapter for Hong Kong using the public Full List of Securities workbook, filtered to HKD equities and REITs.
- TWSE official universe adapter for Taiwan using the public ISIN listed-equities page, filtered to TWSE common-equity rows for `.TW` symbols.
- Curated core universes for Canada, Singapore and South Africa, avoiding free bulk ingestion from TMX/SGX/JSE while licensing remains unclear. India/Israel remain deferred/manual curated cores.
- Expanded curated Nordic cores for Sweden, Denmark and Norway.
- ESMA FIRDS opt-in adapter for Europe/EEA reference universe: downloads weekly FIRDS files, filters ordinary-equity ISIN/MIC/CFI rows and resolves capped ISIN batches through OpenFIGI before adding scannable Yahoo-style symbols.
- FCA FIRDS opt-in adapter for UK reference universe: downloads FCA `FULINS_E`, filters ordinary-equity GB reference rows and resolves capped ISIN batches through OpenFIGI before `.L` symbols can pass the price gate.
- J-Quants universe adapter for Japan, active when `JQUANTS_API_KEY` or legacy `JQUANTS_REFRESH_TOKEN` is configured.
- J-Quants cache adapter and protected refresh job: `/api/jobs/jquants-refresh` stores Japan OHLCV/fundamentals into Supabase in bounded batches.
- Derived Leaderboards API: `/api/leaderboards` builds top lists by country, sector, industry or theme from saved scan results without exposing full raw universes.
- Protected leaderboards refresh job: `/api/jobs/leaderboards-refresh` materializes default derived lists into Supabase.
- Daily OHLCV cache layer for `/api/chart`: fresh `daily_bars` rows are served before live provider calls, and live daily responses write back to Supabase.
- Normalized fundamentals/profile cache for `/api/profile` and Company Brief using `fundamental_snapshots` with `period_type=profile`.
- Protected materialized scan refresh job: `/api/jobs/scan-refresh` hydrates bounded market batches, stores derived `scan_results`, and optionally refreshes leaderboards.
- Scan coverage endpoint: `/api/scan-coverage` reports aggregate scan coverage, freshness, quality, leaderboards, provider runs and batch cursor state.
- Coverage semantics:
  - `inventoryCandidates` are symbols available to the internal queue after the Universe Quality Gate. They are not necessarily fresh, ranked or usable in leaderboards yet.
  - `scannedSymbols` are symbols materialized in `scan_results` during the recent scan window.
  - `rankingEligibleSymbols` are scanned symbols that pass price freshness, minimum data coverage and score gates. `actionableSymbols` remains a legacy alias only.
  - Public product claims should use scanned/ranking-eligible coverage, not raw inventory size.
  - `backfillPlan` suggests small cursorized jobs to convert inventory into fresh scan rows without a global live scan.
- Shadow Universe endpoint: `/api/shadow-universe` reports aggregate hidden-universe readiness so broad legal/reference universes can stay internal while users only see filtered candidates.
- Protected Shadow FIRDS batch job: `/api/jobs/shadow-firds-refresh` measures ESMA/FCA reference coverage, persists non-dry ESMA/FCA candidates into `shadow_instruments`, persists capped OpenFIGI mappings into `symbol_resolutions` and never exposes complete directories.
- Protected Shadow Symbol Resolve job: `/api/jobs/shadow-symbol-resolve` converts persisted reference ISINs into capped ticker mappings through OpenFIGI without redownloading FIRDS.
- Protected Shadow Price Freshness job: `/api/jobs/shadow-price-freshness` validates resolved tickers against daily OHLCV freshness before they are considered scan-ready.
- Protected Shadow Europe cron: `/api/cron/shadow-europe-refresh` rotates small Europe/UK batches through ISIN resolution, OHLCV freshness validation and derived scan materialization.
- Europe market aliases: `EU1` covers priority Europe (`GB,DE,FR,NL,CH,SE,IT,ES`), `EU2` covers the secondary wave (`DK,NO,FI,BE,PT,AT,IE`), and `EU`/`EUROPE` covers both.
- Vercel cron automation: `/api/cron/universe-refresh` refreshes the current operational universe once per day, and `/api/cron/scan-refresh` runs one bounded rotating scan cohort per day.

Operational blocker:

- Apply `supabase/schema.sql` in Supabase. Until then, cache writes fall back to memory and report `supabase-skip`.
- Add `SUPABASE_ACCESS_TOKEN` if we want the repo script to apply schema automatically.
- `npm run supabase:status` now checks every required cache/provider table, including `shadow_instruments` and `symbol_resolutions`, not only the legacy scan table.

## Phase 1 - cache foundation

Acceptance criteria:

- `/api/coverage` reports `cache.status=supabase` for the global market set.
- Universe snapshots persist by market set.
- `daily_bars` can store OHLCV by symbol/date/provider.
- `leaderboard_snapshots` and `leaderboard_items` store derived top lists, not provider raw datasets.
- Scans read cached bars first, then provider live only on cache miss/stale data.
- Price Freshness Gate blocks ranking-eligible output when the latest daily bar is older than the configured threshold.
- Profile/fundamental hydration reads cached normalized snapshots first, then provider live only on cache miss/stale data.
- Scan materialization writes only derived rows that pass base quality/freshness gates; full raw universes remain internal.
- Shadow universes remain aggregate/internal and are not exposed as complete exchange directories.
- Batch cursors are stored in `app_settings` so repeated `/api/jobs/scan-refresh` runs move forward by market instead of rescanning the same first symbols.
- Backfill jobs skip symbols already present in recent `scan_results` by default, so cursorized batches prioritize net-new coverage. Use `skipRecent=0` or `rescanRecent=1` when a deliberate refresh is needed.
- Shadow reference rows are stored separately from scannable symbols: `shadow_instruments -> symbol_resolutions -> daily_bars/profile cache -> scan_results`.
- Shadow resolution is stateful: each attempted reference moves from `reference` to `resolved` or `unresolved`, so repeated small jobs advance through the universe instead of rechecking the same ISINs.
- Shadow price validation is stateful too: resolved tickers become `priced`, `stale` or `price-unavailable` based on daily bars, freshness and minimum history.
- Shadow-priced scan refresh is now supported: `/api/jobs/scan-refresh?shadowPriced=1` reads only internally priced ticker mappings and writes derived `scan_results`, never a full public exchange directory.

Implementation:

1. Apply schema.
2. Schedule `/api/cron/universe-refresh` daily after market close windows. Done via `vercel.json`.
3. Add OHLCV writer around the existing chart provider chain. Done for `/api/chart`.
4. Change scanner hydration to prefer cached `daily_bars`. Done through the chart API used by scanner hydration.
5. Add normalized profile/fundamentals cache around the existing profile provider chain. Done for `/api/profile` and Company Brief.
6. Add `/api/jobs/scan-refresh` for small materialized batches. Done.
7. Add `/api/scan-coverage` and cursorized market batches. Done.
8. Schedule leaderboards after scan snapshots are saved. Done inside `/api/cron/scan-refresh`.
9. After `JQUANTS_API_KEY` is configured, schedule `/api/jobs/jquants-refresh?limit=50&days=390` for Japan batches.
10. Persist Europe/EEA Shadow FIRDS runs into `shadow_instruments` and `symbol_resolutions`. Done for `/api/jobs/shadow-firds-refresh` non-dry runs.
11. Persist UK Shadow FCA FIRDS runs into `shadow_instruments` under provider `fca-firds`. Done for `/api/jobs/shadow-firds-refresh?source=fca`.
12. Resolve persisted Europe/EEA/UK ISINs by capped OpenFIGI batches. Done through `/api/jobs/shadow-symbol-resolve`.
13. Validate resolved tickers against OHLCV freshness. Done through `/api/jobs/shadow-price-freshness`.
14. Scan validated Shadow tickers directly into derived scan results. Done through `/api/jobs/scan-refresh?shadowPriced=1`.
15. Automate the Europe/UK Shadow pipeline in small rotating cohorts. Done through `/api/cron/shadow-europe-refresh`.

## Price Freshness Gate

Default rule: a row can enter current rankings only when its latest daily OHLCV bar is no older than 5 calendar days. This protects Japan and other free-source markets from stale-price false positives.

Fields added to scan rows and exports:

- `priceFreshnessDays`
- `priceFreshnessLabel`
- `priceFreshnessOk`
- `priceFreshnessIssue`

Behavior:

- Fresh OHLCV passes the normal technical/fundamental filters.
- Old or missing OHLCV is rejected under the coverage gate before momentum/stage/ranking decisions.
- Fundamental data remains a soft coverage input; stale fundamentals lower confidence but do not invalidate a technically fresh row.
- Leaderboards apply the same freshness threshold before ranking saved scan results.

## Derived leaderboards

Leaderboards are product output, not a market-data feed. They read `scan_results`, de-duplicate symbols, apply minimum coverage/quality gates and expose only top candidates plus StatsEdge-derived metrics.

Publication contract for cron-materialized rows: see `docs/adr-discovery-global-curated.md` (accepted 2026-07-16). Materialized scans become publishable as "Descubrimiento global curado" only — mandatory gates, declared strategy, ordering by absolute per-symbol signals (never `objectiveScore` nor batch `rsGlobalPct`), and explicit non-global-ranking disclosure. Global-comparable rankings/RS require a versioned canonical universe, never daily cursor batches.

Examples:

- `/api/leaderboards?type=momentum&country=HK&limit=25`
- `/api/leaderboards?type=stage2&country=JP&limit=25`
- `/api/leaderboards?type=return6m&sector=Technology&limit=25`
- `/api/leaderboards?type=momentum&groupBy=country&limit=10&groupsLimit=20`
- `/api/leaderboards?type=rs&groupBy=sector&limit=10&groupsLimit=20`
- `/api/leaderboards?type=momentum&country=JP&maxPriceFreshnessDays=5&limit=25`

Materialized scan examples:

- `/api/jobs/scan-refresh?markets=US,HK,AU,EU1&perMarket=4&limit=44`
- `/api/jobs/scan-refresh?market=HK&limit=50&perMarket=0&offset=0`
- `/api/jobs/scan-refresh?symbols=NVDA,AVGO,0700.HK&leaderboards=1`
- `/api/jobs/scan-refresh?markets=US,HK,AU&perMarket=25&limit=75&cursor=1&skipRecent=1&recentScanDays=45`
- `/api/jobs/scan-refresh?markets=US,HK,AU&perMarket=25&resetCursor=1`
- `/api/jobs/scan-refresh?markets=EU1&perMarket=4&limit=32&leaderboards=1`
- `/api/jobs/scan-refresh?markets=EU2&perMarket=3&limit=21&leaderboards=1`
- `/api/jobs/scan-refresh?shadowPriced=1&markets=FI,DK,NO,NL,ES&perMarket=10&limit=40&leaderboards=1`
- `/api/jobs/shadow-firds-refresh?source=fca&markets=GB&referenceOffset=50&referenceLimit=50&resolve=1&resolveLimit=10&includeSymbols=1`
- `/api/jobs/scan-refresh?shadowPriced=1&markets=GB&perMarket=10&limit=20&leaderboards=1`
- `/api/jobs/scan-refresh?markets=US,HK,AU,EU1&perMarket=8&limit=40&filterPreset=balanced&leaderboards=1`
- `/api/leaderboards?type=momentum&country=GB&filterPreset=nearPivot&minRsRating=70&limit=25`
- `/api/scan-coverage?sinceDays=45&maxPriceFreshnessDays=5`
- `/api/scan-coverage?sinceDays=45&includeTop=1` exposes limited top samples for diagnostics; default coverage output stays aggregate-only.

Cron examples:

- `/api/cron/universe-refresh?dryRun=1`
- `/api/cron/scan-refresh?dryRun=1`
- `/api/cron/scan-refresh?group=europe-priority&dryRun=1`
- `/api/cron/shadow-europe-refresh?dryRun=1`
- `/api/cron/shadow-europe-refresh?group=shadow-europe-uk&resolvePerMarket=3&pricePerMarket=6&scanPerMarket=6`
- `/api/cron/shadow-europe-refresh?group=shadow-europe-west&resolvePerMarket=3&pricePerMarket=6&scanPerMarket=6`

Cron schedule in `vercel.json`:

- `10 21 * * *` UTC: refresh current operational universes.
- `20 22 * * *` UTC: run the next rotating scan cohort and refresh default leaderboards.
- `50 22 * * *` UTC: advance one Shadow Europe cohort through reference resolution, price freshness and derived scan refresh.

The scan cron rotates through `core-us-hk-au`, `europe-priority`, `europe-secondary`, `asia-japan`, `asia-taiwan`, `north-america-canada` and `asia-singapore-africa` using `app_settings`, so it stays within a small daily budget instead of attempting a global scan in one function invocation. India/Israel are deferred and manual-only unless demand changes.
The Shadow Europe cron separately rotates through `shadow-europe-uk`, `shadow-europe-nordics`, `shadow-europe-west` and `shadow-europe-south`, and it stores only internal references/resolutions plus derived scan rows.
Materialized scans and leaderboards can now receive the web screener's core filter fields server-side, so cached/background output can be narrowed by the same thresholds users set in the UI instead of relying only on the base liquidity/freshness gate.

Default materialized lists:

- `global-momentum`
- `global-stage2`
- `global-near-pivot`
- `global-rs`
- `global-growth-quality`

## Phase 2 - official/free universe sources

Priority order:

1. Japan: configure J-Quants V2, refresh the JP snapshot, then cache `/equities/bars/daily` and `/fins/summary` in batches. The `asia-japan` cron cohort is ready.
2. Hong Kong: HKEX securities list is integrated; keep monitoring file availability and terms.
3. Taiwan: TWSE listed-equities universe is integrated; add TPEx only after `.TWO` pricing/mapping is verified.
4. Canada: expand curated `.TO` core by liquidity/market cap; TSX/TSXV complete only with license or low-cost provider.
5. Singapore/South Africa: keep curated `.SI`/`.JO` cores for useful coverage; SGX/JSE complete only with license or low-cost provider.
6. India/Israel: deferred. Keep curated `.NS`/`.TA` core available for manual use, but do not spend default scan/legal budget there until real user demand appears.
7. Europe core: ESMA FIRDS first for Europe/EEA reference universe plus OpenFIGI symbol resolution; FCA FIRDS covers UK as a separate source. Euronext, LSE, Xetra/Boerse Frankfurt, SIX, Nasdaq Nordic and BME feeds only if licensing is explicit.
8. Australia: ASX master list if license permits; keep ASIC only as short-interest source.

Acceptance criteria:

- Japan >= 1,500 useful ordinary equities.
- Hong Kong >= 700 useful ordinary equities.
- Australia >= 1,200 useful ordinary equities.
- Taiwan >= 900 useful ordinary equities.
- Canada curated core >= 200 useful equities now; complete CA >= 800 only with licensed source.
- Singapore curated core >= 40 useful equities now; complete SG >= 250 only with licensed source.
- South Africa curated core >= 50 useful equities now; complete ZA >= 180 only with licensed source.
- India/Israel deferred: useful curated core exists for manual use, but they are outside the default western-market target until demand changes.
- Europe core >= 2,500 useful equities across major exchanges.
- UK target >= 650 useful equities via FCA FIRDS shadow reference plus validated `.L` price coverage.
- Sweden/Denmark/Norway curated core >= 90 useful equities now; official Nordic reference universe via ESMA FIRDS is implemented opt-in, with broad scannable expansion dependent on ISIN-to-ticker resolution and OHLCV freshness.
- Coverage report shows every priority-1 market at `grade=util` or better.

## Phase 3 - fundamentals and short interest

Free-first:

- US: SEC EDGAR companyfacts.
- Europe: ESEF/XBRL annual filings, annual only first.
- Japan: J-Quants statements if plan allows.
- Australia: ASIC short position reports, already integrated.
- Hong Kong: SFC/HKEX short datasets; keep methodology separate from US short float.

Premium-later:

- Ownership global.
- Corporate actions-adjusted history at scale.
- Fully normalized global fundamentals.
- Commercial/display redistribution rights.

## Phase 4 - reliability controls

Add these checks before calling the screener complete:

- Per-market provider freshness.
- Percent of symbols with 252+ daily bars.
- Percent with market cap and liquidity metrics.
- Percent with sector/industry.
- Percent with basic fundamentals.
- Error rate by provider and market.
- Duplicate listing/ADR detection.

The coverage target is intentionally "maximum reasonable", not "every listed security". The product should prefer a clean investable universe over a gigantic noisy one.
