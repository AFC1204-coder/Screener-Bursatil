# FIRDS-CURATED-AVISO-1 — aviso cuando Europa cae a curated-fallback

**Estado:** cerrado (orquestador 2026-09-21) · squash local → polish `1404309` · PR [#44](https://github.com/AFC1204-coder/Screener-Bursatil/pull/44)  
**Rama:** `codex/statsedge-ui-polish`  
**Verify:** 115 tests OK · CI Vercel SUCCESS · smoke :3300 PASS (copy Europa + ausencia US; sin Mini live)

## Entrega

- `lib/firdsCuratedPopulation.js` — detección FIRDS off / curated-fallback
- truth line + notice P9 soft «Población parcial»
- Señales vía `/api/data-providers` + universe cache

## Smoke

`internal/smoke-firds-curated-aviso.md` — PASS. Caveat: mesa seeded localStorage (sin Mini).

Cola restante: B YIELD-EU-1 (#43, gate cron OK dueño) · D Twelve Data / 1B aparcado.
