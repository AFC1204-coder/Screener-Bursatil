# CAZA-CHARTPREVIEW-ENTRY-1 — no batch 80 al entrar a Caza

**Estado:** prep · programación en Agent chat aparte  
**Rama base:** `codex/statsedge-ui-polish` @ `ae1438a`  
**Rama trabajo:** `cursor/caza-entry-batch-a41e`  
**Modelo:** Composer  
**Tamaño:** S (closable)

## Problema

Residual de CAZA-CHARTPREVIEW-VIEWPORT-1 / smoke [#51](https://github.com/AFC1204-coder/Screener-Bursatil/pull/51):

- **Scroll** en Caza ya acota POST `/api/scans/chart-preview` a viewport+buffer (~38).
- Al **entrar** a Caza aún puede salir un POST de **80** símbolos (techo `MAX_SYMBOLS_PER_REQUEST` / `MAX_HUNT_CHART_PREVIEW_HYDRATE`).

Causa probable: `chartPreviewHydratePlan` en `app/page.jsx` llama `collectSymbolsForChartPreviewHydrate({ pagedRows, quickReviewRows, huntRows })` también en modo Caza → une mesa/pagedRows con la ventana hunt (o carrera antes de que `HuntTapeView` mida y emita `{ start, limit }`).

## Objetivo

En **modo Caza**, el plan de hydrate **no** debe unir mesa/`pagedRows` (ni quickReview) de forma que dispare el techo 80 en cold entry. Primera pasada = **viewport+buffer** (o default ~25 sin medida), igual que el scroll.

## Alcance (S)

| # | Cambio |
|---|---|
| 1 | En `isCazaResultView`: símbolos del plan = solo ventana hunt (`huntRowsForChartPreviewHydrate` / limit medido o default); **no** concatenar `pagedRows` + `quickReviewRows` al set de missing |
| 2 | Antes de viewport medido: default limit ~25 (mismo helper `computeHuntChartPreviewHydrateLimit` / default ya usado en VIEWPORT-1), no caer al techo 80 por unión |
| 3 | Mesa / Review fuera de Caza: sin cambio de contrato |
| 4 | Tests: entry Caza no pide > viewport+buffer (ni 80 por unión mesa); scroll sigue OK |
| 5 | Nota smoke para orquestador (abajo) |

## Fuera de alcance

- Scoring / ranking / presets Caza  
- Payload cold GET `/api/scans` · transporte deferred  
- Review hydrate foco · company-brief · nocturno / auth / FIRDS / datos  
- Merge a polish (orquestador tras smoke)

## Archivos probables

- `app/page.jsx` (`chartPreviewHydratePlan` / `collectSymbolsForChartPreviewHydrate`)
- `lib/scansChartPreviewHydrate.js` (si hace falta helper hunt-only)
- `app/components/screener/HuntTapeView.jsx` (solo si el default sin medida aún no se emite a tiempo)
- `tests/cazaChartPreviewScrollHydrate.test.js` · `tests/scansChartPreviewHydrate*.test.js`

## Verify (programación)

```bash
npx vitest run tests/cazaChartPreviewScrollHydrate.test.js \
  tests/scansChartPreviewHydrateVisible.test.js \
  tests/scansChartPreviewHydrateStable.test.js
./vfc   # si toca paths del gate; no ampliar suite
```

Plantilla de retorno. **Sin merge a polish.** Commit+push solo en `cursor/caza-entry-batch-a41e` + PR draft si el flujo cloud lo pide.

## Smoke (orquestador, Browser Use · `:3300` preferido)

1. Hard-reload · mesa US · **entrar** a vista Caza (cold entry, no solo scroll).
2. Primer POST chart-preview: tamaño ≈ viewport+buffer o default ~25 — **no 80**.
3. Scroll 1×: sigue ~38 (o ventana medida); sparks OK.
4. Anotar: status/filas, tamaño del batch de entrada, que scoring/filtros no cambian.

## Criterio done

- Diff solo plan hydrate Caza entry (+ tests).  
- Tests OK.  
- Smoke orch OK → orquestador merge/commit polish + quitar residual batch-80 entry del backlog.
