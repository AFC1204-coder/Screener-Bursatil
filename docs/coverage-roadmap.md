# StatsEdge coverage execution plan

Goal: cover the broad investable global equity market for Weinstein/Minervini screening, while excluding low-value noise such as malformed tickers, funds, warrants, debt, preferreds, SPAC units, microcaps and illiquid shares.

## Phase 0 - now

Implemented:

- Universe Engine snapshot API: `/api/universe-engine`.
- Compatibility universe API: `/api/universe`.
- Coverage report API: `/api/coverage`.
- Universe Quality Gate for instrument hygiene.
- Scanner Quality Gate for hydrated rows before ranking.
- Supabase schema for universe snapshots, daily bars, fundamentals snapshots and provider run logs.
- Protected refresh job: `/api/jobs/universe-refresh`.
- HKEX official universe adapter for Hong Kong using the public Full List of Securities workbook, filtered to HKD equities and REITs.
- J-Quants universe adapter for Japan, active when `JQUANTS_API_KEY` or legacy `JQUANTS_REFRESH_TOKEN` is configured.

Operational blocker:

- Apply `supabase/schema.sql` in Supabase. Until then, cache writes fall back to memory and report `supabase-skip`.
- Add `SUPABASE_ACCESS_TOKEN` if we want the repo script to apply schema automatically.
- `npm run supabase:status` now checks every required cache/provider table, not only the legacy scan table.

## Phase 1 - cache foundation

Acceptance criteria:

- `/api/coverage` reports `cache.status=supabase` for the global market set.
- Universe snapshots persist by market set.
- `daily_bars` can store OHLCV by symbol/date/provider.
- Scans read cached bars first, then provider live only on cache miss/stale data.

Implementation:

1. Apply schema.
2. Schedule `/api/jobs/universe-refresh` daily after market close windows.
3. Add OHLCV writer around the existing chart provider chain.
4. Change scanner hydration to prefer cached `daily_bars`.

## Phase 2 - official/free universe sources

Priority order:

1. Japan: configure J-Quants V2 `equities/master` and refresh the JP snapshot.
2. Hong Kong: HKEX securities list is integrated; keep monitoring file availability and terms.
3. Europe core: Euronext, LSE, Xetra/Boerse Frankfurt, SIX, Nasdaq Nordic, BME.
4. Australia: ASX master list if license permits; keep ASIC only as short-interest source.
5. Canada: TSX/TSXV listed issuers or low-cost provider if official bulk terms are awkward.

Acceptance criteria:

- Japan >= 1,500 useful ordinary equities.
- Hong Kong >= 700 useful ordinary equities.
- Australia >= 1,200 useful ordinary equities.
- Europe core >= 2,500 useful equities across major exchanges.
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
