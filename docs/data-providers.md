# StatsEdge data providers

Legal/commercial-use notes live in [`docs/data-licensing-audit.md`](./data-licensing-audit.md). Treat free market data as licensed input: cache internally, expose derived screener output, and validate display/redistribution rights before using any provider as a public product backbone.

Free-first order for V1:

1. Yahoo Finance-style endpoints: primary chart, quote, profile, news and fundamentals source.
2. Stooq CSV: free historical daily chart fallback when `STOOQ_API_KEY` is configured.
3. Alpha Vantage: optional historical daily chart fallback when `ALPHA_VANTAGE_API_KEY` is configured.
4. OpenFIGI: optional free symbol/ISIN/FIGI/MIC normalization. It works anonymously with tighter limits and uses `OPENFIGI_API_KEY` when configured.
5. NasdaqTrader symbol directories: public US universe.
6. SEC EDGAR companyfacts: free US fundamentals fallback.
7. Financial Modeling Prep: optional profile, ratios and financial statements fallback when `FMP_API_KEY` is configured.
8. ASIC short positions: official aggregated Australia short-interest proxy for `.AX` symbols.
9. HKEX Full List of Securities: official Hong Kong universe, filtered to HKD equities and REITs.
10. J-Quants: Japan-first universe/OHLCV/fundamentals provider when a free/low-cost account is configured.
11. TWSE ISIN list: official Taiwan listed-equities universe for `.TW` symbols.
12. StatsEdge curated core universes: Canada, Singapore and South Africa high-liquidity ticker seeds without scraping exchange bulk directories. India/Israel stay deferred/manual.
13. ESMA FIRDS: opt-in Europe/EEA reference universe. It provides ISIN/MIC/CFI metadata, not OHLCV and not Yahoo tickers; StatsEdge resolves a capped number of ISINs through OpenFIGI when enabled.
14. FCA FIRDS: opt-in UK reference universe, separate from ESMA. It uses FCA `FULINS_E` files, capped OpenFIGI resolution and the same price freshness gate before UK rows become scannable.
15. StatsEdge Shadow Universe Store: internal Supabase persistence for ESMA/FCA-style reference candidates and ISIN-to-ticker mappings.
16. Official public datasets planned next: ESEF filings for Europe and SFC/HKEX short disclosures for Hong Kong.
17. EODHD / Twelve Data / Marketstack / Finnhub: premium-later candidates.

Rules:

- Do not block the app when an optional provider is missing.
- Show provider errors clearly in diagnostics.
- Prefer price/chart reliability before broadening secondary fundamentals.
- Keep paid providers out of the critical path until V1 is stable.
- Use OpenFIGI only for symbol normalization; it is not a market-data provider.
- Label public short-interest datasets by methodology, lag and threshold. Do not mix them as if they were US short-float equivalents.

Current chart fallback chain:

`Supabase daily_bars cache -> Yahoo Finance chart -> Stooq CSV -> Alpha Vantage daily adjusted`.

Fresh `daily_bars` rows are served first for daily/weekly/monthly chart requests. If the cache is missing or stale, StatsEdge calls the live provider chain and writes normalized daily OHLCV back into Supabase. Alpha Vantage is only used when configured and only after Yahoo/Stooq fail or Yahoo returns insufficient history. This avoids burning free quota during normal scans.

Current fundamentals fallback chain:

`Supabase fundamental_snapshots profile cache -> Yahoo quoteSummary/fundamentals -> SEC EDGAR for US issuers -> Financial Modeling Prep`.

`/api/profile` and Company Brief now read a normalized profile/fundamentals cache first. Cache misses or stale entries call the live provider chain and write normalized fields back with `period_type=profile`; this stores screener-ready fields rather than raw provider dumps. FMP is optional and fills missing fields without replacing useful Yahoo/SEC values. It is useful for profiles, ratios, quarterly/annual statements and non-US coverage when the free tier supports the symbol.

Current symbol resolution:

`Curated universe -> Yahoo search -> OpenFIGI fallback`.

OpenFIGI is queried only when the existing search produces no useful result, or when the query looks like an ISIN. This keeps rate usage low while improving international lookup quality.

Current short-interest fallback:

`Yahoo quoteSummary -> ASIC short position reports for .AX`.

ASIC exposes daily aggregate short positions per stock. StatsEdge maps `% of Total Product in Issue Reported as Short Positions` into the existing short-interest fields only when the base provider has no better value. This is a proxy for filters, not a US-style short-float value.

Current universe expansion:

- US uses NasdaqTrader public symbol directories.
- Australia uses ASIC short position reports plus the curated AU list. This is not the full ASX master list, but it expands practical AU coverage while retaining official short-interest metadata.
- Hong Kong uses HKEX's public Full List of Securities workbook plus the curated list. StatsEdge keeps HKD equities and REITs, and drops ETFs, debt, warrants, CBBCs and non-HKD duplicate counters.
- Japan uses J-Quants V2 `/equities/master` when `JQUANTS_API_KEY` is present, or legacy V1 `/listed/info` when `JQUANTS_REFRESH_TOKEN` is present. Without credentials it stays on the curated list.
- J-Quants cache refresh is implemented via `/api/jobs/jquants-refresh`. It writes daily OHLCV into `daily_bars` and quarterly financial summary rows into `fundamental_snapshots`, capped by `limit` so we do not mass-fetch live data accidentally.
- Taiwan uses TWSE's public ISIN list for listed equities plus the curated list. StatsEdge keeps TWSE listed common-equity CFI rows and drops funds, debt, warrants, preferred-like instruments and other non-equity rows.
- Canada, Singapore and South Africa use curated core lists of large/liquid symbols (`.TO`, `.SI`, `.JO`) rather than scraping TMX, SGX or JSE directories. Canada now has a 200+ symbol legal-safe core; India/Israel remain available only as deferred curated cores (`.NS`, `.TA`) and are no longer part of default refresh/scan rotation.
- Sweden, Denmark and Norway now have expanded curated Nordic cores. ESMA FIRDS is implemented as an opt-in broad legal reference layer for Europe/EEA; it must still resolve ISINs to market tickers before rows become scannable.
- UK now has a separate FCA FIRDS adapter. It should be run as `source=fca`, stored under provider `fca-firds`, and treated as hidden reference data until OpenFIGI + OHLCV freshness validates actual `.L` tickers.
- Other non-US markets still use curated Yahoo-format universes until their exchange/listing sources are wired.
- `/api/coverage` reports current vs target coverage by market and turns this roadmap into measurable gaps. Treat `inventoryCandidates` as internal queue capacity; use `scannedSymbols` and `actionableSymbols` for product/readiness claims.

Universe Engine, Quality Gate and cache:

- `/api/universe-engine` builds one normalized snapshot for one or many markets, de-duplicates symbols and labels each entry with `qualityGate` and `universeCoverageScore`. Add `summary=1` for counts/coverage without returning every symbol.
- `/api/shadow-universe` reports aggregate hidden-universe readiness by market. It is intentionally aggregate-only: wide reference universes can feed internal jobs, but user-facing flows should expose only filtered/derived candidates.
- `/api/coverage?includeShadow=1` joins current scannable coverage with Shadow Universe readiness.
- `/api/jobs/shadow-firds-refresh` runs ESMA/FCA FIRDS as a protected batch job. Use `source=fca&markets=GB` for UK or the default ESMA mode for EEA. Use `dryRun=1`, `resolve=0` for reference-only counts, `referenceOffset=` to advance through later chunks without rereading the same first references, or `resolveLimit=` to test capped OpenFIGI conversion before enabling broader scans. Non-dry runs persist references into `shadow_instruments` and ISIN-to-ticker matches into `symbol_resolutions`.
- `/api/jobs/shadow-symbol-resolve` reads persisted `shadow_instruments` with `status=reference`, resolves capped ISIN batches through OpenFIGI, writes `symbol_resolutions` and marks each attempted ISIN as `resolved` or `unresolved` so batches keep moving forward.
- `/api/jobs/shadow-price-freshness` reads `symbol_resolutions` with `status=resolved`, fetches daily OHLCV through the existing cache/provider chain, writes `daily_bars`, and marks each ticker as `priced`, `stale` or `price-unavailable`.
- `/api/jobs/scan-refresh?shadowPriced=1` turns only `priced` Shadow ticker mappings into derived scan results. If no priced mappings exist for the requested markets/status, it skips safely instead of falling back to a public universe scan.
- `/api/cron/shadow-europe-refresh` automates the same Europe/UK Shadow sequence in small rotating cohorts: resolve a few `reference` ISINs, validate fresh OHLCV for new `resolved` tickers, then scan only `priced` symbols into derived `scan_results`.
- `/api/universe` now reads from the same engine so existing UI code keeps working while the universe source becomes cacheable.
- The universe Quality Gate removes obvious non-equity/noisy instruments before scanning: malformed symbols, ETFs/funds, debt, derivatives and unclassified instruments.
- The scanner Quality Gate rejects hydrated rows before ranking when they fail basic investability/data checks: price, history, market cap, liquidity and minimum coverage.
- Supabase tables `universe_snapshots` and `universe_snapshot_symbols` cache snapshots by market set. If Supabase is missing or the tables are not applied, StatsEdge falls back to memory/build without blocking.
- Supabase table `daily_bars` now backs `/api/chart` for non-intraday requests. `refresh=1` forces a live provider refresh; `cache=0` bypasses cache reads/writes for diagnostics.
- Supabase table `fundamental_snapshots` now backs normalized profile/fundamentals hydration. `maxFundamentalsAgeDays` controls freshness for `/api/profile`; `refresh=1` forces a live refresh.
- Supabase tables `shadow_instruments` and `symbol_resolutions` store internal reference candidates and resolved ticker mappings. They are for jobs and aggregate coverage reports, not public directory APIs.
- `/api/jobs/scan-refresh` turns cached/live hydrated data into derived `scan_results` in bounded batches. Defaults are deliberately small and now include `US,HK,AU` plus priority Europe; use explicit `markets=` for tighter jobs.
- `/api/jobs/scan-refresh` also accepts the same core screener filter fields used by the web UI, including `filterPreset=balanced|strict|broad|nearPivot|ipo|weakness` and individual fields like `minPerf3m`, `minRsRating`, `maxDistance52w`, `minTechnicalCoverageScore`, `minFundamentalCoverageScore`, `minShortFloatPct` and `maxDrawdown63d`. These filters are applied after hydration/sector scoring so saved rows and leaderboard inputs can match the user-facing screener logic.
- `/api/jobs/scan-refresh` uses `app_settings` as a per-market cursor unless `offset` is explicitly provided or `cursor=0` is set. Use `resetCursor=1` to restart a market cycle. For backfills it skips symbols already scanned in the recent window by default (`recentScanDays=45`); pass `skipRecent=0` or `rescanRecent=1` for intentional refresh jobs.
- Europe can now be requested as market aliases: `EU1` for priority Europe, `EU2` for the secondary wave, and `EU`/`EUROPE` for the full current European seed universe. Current Europe is still a curated high-liquidity seed, not an official complete exchange universe.
- `vercel.json` schedules two protected daily cron routes: `/api/cron/universe-refresh` and `/api/cron/scan-refresh`. The scan cron rotates small cohorts through `app_settings`, including bounded Japan, Taiwan, Canada and Singapore/South Africa cohorts, and refreshes leaderboards after saving materialized scan rows. India/Israel are manual/backlog only.
- `vercel.json` also schedules `/api/cron/shadow-europe-refresh`, which rotates `shadow-europe-uk`, `shadow-europe-nordics`, `shadow-europe-west` and `shadow-europe-south` after the normal scan cron.
- `/api/scan-coverage` exposes aggregate derived coverage by default: symbol counts, freshness, quality/ranking-eligible rates, leaderboard population, recent job status and cursor offsets. Use `includeTop=1` only for limited diagnostic top samples; user-facing "best of" lists should come from leaderboards.
- This cache is for research workflow acceleration, not for redistributing exchange data. Respect source terms, public endpoint rate limits and official dataset methodology labels.
- Leaderboards use saved `scan_results` to expose only top derived candidates by country, sector, industry or theme. They should not return complete exchange universes or raw OHLCV datasets.
- Hidden universes are not a licensing workaround. They are allowed only where the source is public/regulatory or properly licensed; exchange/product datasets that require paid permission stay as curated cores or provider-later candidates.
- Price freshness is a hard gate for ranking-eligible output: stale OHLCV can exist in cache/history, but it should not pass screener rankings or leaderboards.

Incremental free-source roadmap:

1. Apply Supabase cache schema, then refresh universe snapshots daily.
2. Configure `JQUANTS_API_KEY`, refresh Japan and run `/api/jobs/jquants-refresh?limit=25` to start caching J-Quants OHLCV/fundamentals by batches. Until fresh Japan pricing is available, JP rows stay exploratory or fail the Price Freshness Gate.
3. Keep Taiwan on TWSE `.TW` first; add TPEx `.TWO` only after verifying price-symbol mapping and legal notes for the specific endpoint.
4. Keep Canada/Singapore/South Africa as curated core until TMX/SGX/JSE permission or a licensed provider is available. Canada is expanded to 200+ curated symbols; keep India/Israel deferred unless actual user demand justifies provider/licensing work.
5. Add SFC/HKEX short datasets. Scope: separate short positions from short-selling turnover.
6. Enable ESMA FIRDS in a controlled job for Europe/EEA universe discovery, starting with Sweden/Denmark/Norway plus DE/FR/NL. Keep `ESMA_FIRDS_MAX_FILES` and `ESMA_FIRDS_RESOLVE_LIMIT_PER_MARKET` capped, then persist non-dry runs into `shadow_instruments`/`symbol_resolutions`.
7. Use FCA FIRDS for UK separately; ESMA FIRDS should not be treated as a complete UK universe source. Start with `/api/jobs/shadow-firds-refresh?source=fca&markets=GB&resolve=1&resolveLimit=10&includeSymbols=1`, continue with `referenceOffset=` batches, then let the shadow cron advance the validated `.L` tickers.
8. Add ESEF annual-report ingestion as a server-side annual fundamentals cache for European issuers. Scope: annual only first; avoid fragile quarter inference.
9. Add exchange-specific Europe universe adapters only where licensing is explicit, then evaluate premium global backbone if maintenance cost is too high.

Resolution examples:

- `/api/jobs/shadow-symbol-resolve?markets=FI&dryRun=1&perMarket=10`
- `/api/jobs/shadow-symbol-resolve?markets=FI,DK,NO&perMarket=10&includeSymbols=1`
- `/api/jobs/shadow-symbol-resolve?markets=DE&perMarket=25`
- `/api/jobs/shadow-firds-refresh?source=fca&markets=GB&referenceOffset=50&referenceLimit=50&resolve=1&resolveLimit=10&includeSymbols=1`
- `/api/jobs/shadow-symbol-resolve?source=fca&markets=GB&perMarket=10&includeSymbols=1`
- `/api/jobs/shadow-price-freshness?markets=FI&dryRun=1&perMarket=5`
- `/api/jobs/shadow-price-freshness?markets=GB&perMarket=5&includeSymbols=1`
- `/api/jobs/shadow-price-freshness?markets=FI&perMarket=5&includeSymbols=1`
- `/api/jobs/scan-refresh?shadowPriced=1&markets=FI,DK,NO,NL,ES&perMarket=10&limit=40&leaderboards=1`
- `/api/jobs/scan-refresh?markets=US,HK,AU,EU1&perMarket=8&limit=40&filterPreset=balanced&skipRecent=1&leaderboards=1`
- `/api/leaderboards?type=momentum&country=GB&filterPreset=nearPivot&minRsRating=70&limit=25`
- `/api/cron/shadow-europe-refresh?dryRun=1`
- `/api/cron/shadow-europe-refresh?group=shadow-europe-uk&resolvePerMarket=3&pricePerMarket=6&scanPerMarket=6&includeSymbols=1`
- `/api/cron/shadow-europe-refresh?group=shadow-europe-west&resolvePerMarket=3&pricePerMarket=6&scanPerMarket=6&includeSymbols=1`
