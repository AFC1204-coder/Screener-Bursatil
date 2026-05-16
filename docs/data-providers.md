# StatsEdge data providers

Free-first order for V1:

1. Yahoo Finance-style endpoints: primary chart, quote, profile, news and fundamentals source.
2. Stooq CSV: free historical daily chart fallback when `STOOQ_API_KEY` is configured.
3. Alpha Vantage: optional historical daily chart fallback when `ALPHA_VANTAGE_API_KEY` is configured.
4. NasdaqTrader symbol directories: public US universe.
5. SEC EDGAR companyfacts: free US fundamentals fallback.
6. Financial Modeling Prep: optional profile, ratios and financial statements fallback when `FMP_API_KEY` is configured.
7. Finnhub: planned optional news/events/profile fallback.
8. Twelve Data / Marketstack: planned optional EOD/global fallback.
9. OpenFIGI: planned optional symbol normalization layer.

Rules:

- Do not block the app when an optional provider is missing.
- Show provider errors clearly in diagnostics.
- Prefer price/chart reliability before broadening secondary fundamentals.
- Keep paid providers out of the critical path until V1 is stable.

Current chart fallback chain:

`Yahoo Finance chart -> Stooq CSV -> Alpha Vantage daily adjusted`.

Alpha Vantage is only used when configured and only after Yahoo/Stooq fail or Yahoo returns insufficient history. This avoids burning free quota during normal scans.

Current fundamentals fallback chain:

`Yahoo quoteSummary/fundamentals -> SEC EDGAR for US issuers -> Financial Modeling Prep`.

FMP is optional and fills missing fields without replacing useful Yahoo/SEC values. It is useful for profiles, ratios, quarterly/annual statements and non-US coverage when the free tier supports the symbol.
