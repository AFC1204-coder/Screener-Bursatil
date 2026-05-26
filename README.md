# StatsEdge V1

Mobile-first investment research terminal for global equities, focused on Weinstein/Minervini-style technical screening, market health, watchlists, sector maps, company pages and research workflows.

This is a research tool, not financial advice. The app should expose evidence, rankings, filters and context without telling the investor what to buy or sell.

## Run

```bash
npm install
npm run dev
```

Open:

```bash
http://127.0.0.1:3000
```

## Verify

```bash
npm test
npm run build
```

The smoke test checks the main pages, core APIs, Yahoo-backed data endpoints and Supabase status.
It also checks the Universe Engine snapshot path used for cached global universes.

## Environment

Local secrets live in `.env.local`, which is intentionally ignored by git.

Required for cloud persistence:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
STATSEDGE_OWNER_ID=personal
STATSEDGE_API_TOKEN=
```

`STATSEDGE_API_TOKEN` is optional. When set, `/api/scans`, `/api/favorites`, `/api/alerts`, and `/api/settings` require the same value through `x-statsedge-token` or a bearer token. The client reads it from `localStorage["statsedge.persistenceToken.v1"]`.

Optional admin connector:

```bash
SUPABASE_ACCESS_TOKEN=
SUPABASE_PROJECT_REF=
CRON_SECRET=
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ACCESS_TOKEN` in browser code or with a `NEXT_PUBLIC_` prefix.

`CRON_SECRET` protects the Vercel cron endpoints. Vercel calls them with `Authorization: Bearer $CRON_SECRET`; local development allows them without the secret.

## Supabase

Schema:

```bash
supabase/schema.sql
```

Tables:

- `scans`
- `scan_results`
- `favorites`
- `favorite_snapshots`
- `notes`
- `alerts`
- `company_profiles`
- `universe_snapshots`
- `universe_snapshot_symbols`
- `app_settings`

Connector helpers:

```bash
npm run supabase:status
npm run supabase:schema
```

## Main Routes

- `/` screener
- `/review` fast stock review
- `/lists` leaders and setup lists
- `/sectors` sector/theme map
- `/research-desk` favorites and tracking
- `/market-health` market regime dashboard
- `/stock/[symbol]` company page
- `/api/coverage` current vs target market coverage report
- `/api/scan-coverage` materialized scan coverage/freshness report
- `/api/cron/universe-refresh` protected daily universe refresh
- `/api/cron/scan-refresh` protected rotating materialized scan refresh

## Current Data Providers

- Yahoo Finance-style endpoints for charts, profiles, financial briefs and market data.
- Stooq CSV as optional free historical chart fallback when `STOOQ_API_KEY` is configured.
- Alpha Vantage as optional daily chart fallback when `ALPHA_VANTAGE_API_KEY` is configured.
- OpenFIGI as optional free symbol/ISIN/FIGI resolver when `OPENFIGI_API_KEY` is configured; it also works anonymously with tighter limits.
- Financial Modeling Prep as optional profile, ratios and statements fallback when `FMP_API_KEY` is configured.
- NasdaqTrader public symbol directories for the US universe.
- HKEX Full List of Securities for the Hong Kong universe, filtered to investable HKD equities/REITs.
- TWSE ISIN listed equities for the Taiwan universe, filtered to investable `.TW` common equities.
- Curated core universes for Canada, India, Israel, Singapore and South Africa while full exchange bulk data remains license-sensitive.
- Expanded curated Nordic cores for Sweden, Denmark and Norway; ESMA FIRDS is available as an opt-in Europe/EEA reference-universe adapter with capped OpenFIGI ISIN resolution.
- J-Quants for Japan universe data when `JQUANTS_API_KEY` or `JQUANTS_REFRESH_TOKEN` is configured.
- SEC EDGAR companyfacts as a free US fundamentals fallback.
- ASIC short position reports as a free official Australia short-interest proxy for `.AX` symbols.
- Universe Engine snapshots with Quality Gate and coverage scoring, cached in Supabase when configured.
- Coverage report API for measuring global coverage gaps before adding each provider.
- TradingView official embed for charts.
- Supabase for V1 persistence.
- localStorage fallback remains available for resilience.
- `/api/data-providers` exposes configured/free/planned provider status.

## V1 Philosophy

StatsEdge should prioritize:

- Global stock coverage beyond US-only tools.
- Objective evidence over advice.
- Mobile-first usability.
- Fast scanning and review.
- Clear data gaps: `Sin dato`, `Proveedor no disponible`, `Historico insuficiente`.
- Premium research-app feel, not casino/trading meme aesthetics.
