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
11. Official public datasets planned next: ESEF filings for Europe and SFC/HKEX short disclosures for Hong Kong.
12. EODHD / Twelve Data / Marketstack / Finnhub: premium-later candidates.

Rules:

- Do not block the app when an optional provider is missing.
- Show provider errors clearly in diagnostics.
- Prefer price/chart reliability before broadening secondary fundamentals.
- Keep paid providers out of the critical path until V1 is stable.
- Use OpenFIGI only for symbol normalization; it is not a market-data provider.
- Label public short-interest datasets by methodology, lag and threshold. Do not mix them as if they were US short-float equivalents.

Current chart fallback chain:

`Yahoo Finance chart -> Stooq CSV -> Alpha Vantage daily adjusted`.

Alpha Vantage is only used when configured and only after Yahoo/Stooq fail or Yahoo returns insufficient history. This avoids burning free quota during normal scans.

Current fundamentals fallback chain:

`Yahoo quoteSummary/fundamentals -> SEC EDGAR for US issuers -> Financial Modeling Prep`.

FMP is optional and fills missing fields without replacing useful Yahoo/SEC values. It is useful for profiles, ratios, quarterly/annual statements and non-US coverage when the free tier supports the symbol.

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
- Other non-US markets still use curated Yahoo-format universes until their exchange/listing sources are wired.
- `/api/coverage` reports current vs target coverage by market and turns this roadmap into measurable gaps.

Universe Engine, Quality Gate and cache:

- `/api/universe-engine` builds one normalized snapshot for one or many markets, de-duplicates symbols and labels each entry with `qualityGate` and `universeCoverageScore`. Add `summary=1` for counts/coverage without returning every symbol.
- `/api/universe` now reads from the same engine so existing UI code keeps working while the universe source becomes cacheable.
- The universe Quality Gate removes obvious non-equity/noisy instruments before scanning: malformed symbols, ETFs/funds, debt, derivatives and unclassified instruments.
- The scanner Quality Gate rejects hydrated rows before ranking when they fail basic investability/data checks: price, history, market cap, liquidity and minimum coverage.
- Supabase tables `universe_snapshots` and `universe_snapshot_symbols` cache snapshots by market set. If Supabase is missing or the tables are not applied, StatsEdge falls back to memory/build without blocking.
- This cache is for research workflow acceleration, not for redistributing exchange data. Respect source terms, public endpoint rate limits and official dataset methodology labels.
- Leaderboards use saved `scan_results` to expose only top derived candidates by country, sector, industry or theme. They should not return complete exchange universes or raw OHLCV datasets.

Incremental free-source roadmap:

1. Apply Supabase cache schema, then refresh universe snapshots daily.
2. Configure `JQUANTS_API_KEY`, refresh Japan and run `/api/jobs/jquants-refresh?limit=25` to start caching J-Quants OHLCV/fundamentals by batches.
3. Add SFC/HKEX short datasets. Scope: separate short positions from short-selling turnover.
4. Add ESEF annual-report ingestion as a server-side annual fundamentals cache for European issuers. Scope: annual only first; avoid fragile quarter inference.
5. Add exchange-specific Europe universe adapters, then evaluate premium global backbone if maintenance cost is too high.
