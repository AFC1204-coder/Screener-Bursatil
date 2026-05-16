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

## Environment

Local secrets live in `.env.local`, which is intentionally ignored by git.

Required for cloud persistence:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
STATSEDGE_OWNER_ID=personal
```

Optional admin connector:

```bash
SUPABASE_ACCESS_TOKEN=
SUPABASE_PROJECT_REF=
```

Never expose `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_ACCESS_TOKEN` in browser code or with a `NEXT_PUBLIC_` prefix.

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

## Current Data Providers

- Yahoo Finance-style endpoints for charts, profiles, financial briefs and market data.
- Stooq CSV as optional free historical chart fallback when `STOOQ_API_KEY` is configured.
- Alpha Vantage as optional daily chart fallback when `ALPHA_VANTAGE_API_KEY` is configured.
- Financial Modeling Prep as optional profile, ratios and statements fallback when `FMP_API_KEY` is configured.
- NasdaqTrader public symbol directories for the US universe.
- SEC EDGAR companyfacts as a free US fundamentals fallback.
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
