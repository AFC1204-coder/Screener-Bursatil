# StatsEdge data providers

Free-first order for V1:

1. Yahoo Finance-style endpoints: primary chart, quote, profile, news and fundamentals source.
2. Stooq CSV: free historical daily chart fallback when `STOOQ_API_KEY` is configured.
3. NasdaqTrader symbol directories: public US universe.
4. SEC EDGAR companyfacts: free US fundamentals fallback.
5. Alpha Vantage: planned optional free-key fallback.
6. Financial Modeling Prep: planned optional free-key fundamentals fallback.

Rules:

- Do not block the app when an optional provider is missing.
- Show provider errors clearly in diagnostics.
- Prefer price/chart reliability before broadening secondary fundamentals.
- Keep paid providers out of the critical path until V1 is stable.
