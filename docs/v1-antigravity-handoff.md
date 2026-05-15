# V1 handoff for Google Antigravity

## Current readiness

StatsEdge V1 is usable as a local/cloud-backed research app.

Verified on 2026-05-14:

- `npm test` passes.
- `npm run build` passes.
- `/api/supabase/status` returns `configured: true`, `ok: true`.
- Supabase schema is applied.
- Insert/delete smoke checks for scans and favorites passed.

## Product goal

Make StatsEdge feel like a focused professional research terminal for a Spanish/global investor using Weinstein/Minervini-inspired workflows.

Do not turn it into an advice app. Prefer objective labels and evidence:

- `Distancia a maximos`
- `Extension SMA50`
- `RS vs benchmark`
- `Volumen relativo`
- `Rendimiento / volatilidad`
- `Sector/industria`
- `Cobertura de datos`

Avoid subjective labels like:

- `Compra`
- `Vende`
- `Riesgo elevado`
- `Oportunidad segura`

## Differentiator

The main strategic edge is global coverage, not just US stocks:

- US
- Europe
- Japan
- Hong Kong
- Singapore
- Australia

Design and feature work should reinforce this global workflow: countries, exchanges, currencies, market cap in local currency and USD, local benchmarks and sector strength by region.

## Core screens

- `/`: screener and filters.
- `/review`: rapid review mode with embedded TradingView.
- `/lists`: leaders/setup buckets from scans and favorites.
- `/sectors`: sector/theme/industry map.
- `/research-desk`: favorites, notes and tracking.
- `/market-health`: market regime, news tone and sector health.
- `/stock/[symbol]`: company profile, chart, relative strength, financial metrics, peers, news and links.

## Design direction

The next design pass should make the app lighter, denser and calmer:

- Reduce heavy bordered cards.
- Prefer section bands, tables, compact panels and sticky tools.
- Keep gold/black identity but reduce visual noise.
- Collapse advanced controls by default.
- Use icon buttons for repeated actions.
- Make mobile the first-class layout.
- Preserve data density on desktop.

The desired feel is closer to a premium research terminal than a generated dashboard.

## High-priority UX improvements

1. Screener first screen

   - Make the active workflow obvious: market, preset, core filters, run button, results.
   - Keep advanced filters reachable but collapsed.
   - Make enabled/disabled filter chips compact and readable.

2. Results table

   - Improve scanning density.
   - Keep ticker, company, country, sector, RS, total score and key setup state visible.
   - Make row actions fast: favorite, review, chart, stock page.

3. Fast review

   - This is one of the strongest V1 features.
   - Improve keyboard/mobile controls and chart/sidebar balance.
   - Keep labels objective and short.

4. Stock page

   - Reduce explanatory prose.
   - Use tooltips/info icons for methodology context.
   - Keep company identity, chart, relative strength, financial metrics and links above the fold when possible.

5. Market and sectors

   - Make global/sector state easier to compare.
   - Add visual sorting for strong/weak regions and sectors.
   - Keep daily/weekly/monthly context where data supports it.

## Technical guardrails

- Do not remove the localStorage fallback.
- Do not expose service role keys client-side.
- Do not add heavy dependencies without a clear reason.
- Keep Vercel compatibility.
- Preserve `npm test` and `npm run build` as acceptance checks.
- Keep Yahoo/provider failures visible instead of hiding them.
- Use TradingView only as an embed, not as a data API.

## Supabase status

Supabase is connected for V1 persistence.

Project ref:

```bash
dzovggfbcoymjgikkbno
```

Schema file:

```bash
supabase/schema.sql
```

Runtime env:

```bash
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
STATSEDGE_OWNER_ID=personal
```

Admin connector docs:

```bash
docs/supabase-connector.md
```

## Known V1 limitations

- Data coverage varies by provider and exchange.
- Financial metrics can be partial.
- News/social sentiment is approximate and should be presented as context, not prediction.
- Some TradingView symbol mappings may need manual refinement for non-US markets.
- No production auth yet. `STATSEDGE_OWNER_ID=personal` is enough for V1.

## Acceptance checklist before a design pass

Run:

```bash
npm test
npm run build
```

Check:

- `/api/supabase/status`
- `/`
- `/review`
- `/stock/NVDA`
- `/sectors`
- `/research-desk`

V1 is ready for Antigravity when all pass.
