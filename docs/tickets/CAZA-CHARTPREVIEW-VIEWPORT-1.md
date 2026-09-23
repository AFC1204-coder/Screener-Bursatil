# CAZA-CHARTPREVIEW-VIEWPORT-1 — hydrate chartPreview solo viewport + buffer

**Estado:** prep · programación en Agent chat aparte  
**Rama base:** `codex/statsedge-ui-polish` @ `6eb6456`  
**Rama trabajo:** `cursor/caza-viewport-cap-a41e`  
**Modelo:** Composer  
**Tamaño:** S (closable)

## Problema

Residual de `SCANS-CHARTPREVIEW-HYDRATE-VISIBLE-1` / backlog: en **Caza**, el hydrate de `chartPreview` (POST `/api/scans/chart-preview`) sigue gastando red/CPU de más respecto a lo que el usuario ve.

Baseline ya en polish (`MAX_HUNT_CHART_PREVIEW_HYDRATE = 80` + `computeHuntChartPreviewHydrateStart` + evento de scroll · CAZA-SPARKS-SCROLL-1): ventana de **hasta 80** filas sobre la cola `filtered`, no la cola entera. Aun así, 80 ≫ viewport real de la cinta (~filas visibles + overscan pequeño) → demasiados símbolos por pasada en colas largas.

## Objetivo

Limitar hydrate / POST chart-preview en Caza a **viewport visible + buffer** (overscan), no a un top-N fijo grande ni a toda la cola filtrada.

## Alcance (S)

| # | Cambio |
|---|---|
| 1 | Ventana de hydrate Caza = filas visibles de la cinta + buffer (overscan); scroll / j·k siguen desplazando la ventana |
| 2 | Reusar `huntRowsForChartPreviewHydrate` / `computeHuntChartPreviewHydrateStart` / evento viewport; bajar o parametrizar el tope para que coincida con viewport+buffer |
| 3 | Mesa / Review / `pagedRows` + `quickReviewRows`: sin cambio de contrato salvo lo mínimo si comparten helper |
| 4 | Tests focalizados (ventana vs cola larga; scroll desplaza start; no pedir símbolos fuera de viewport+buffer) |
| 5 | Nota smoke para orquestador (abajo) |

## Fuera de alcance

- Scoring / ranking / presets Caza  
- Payload cold GET `/api/scans` · transporte deferred (ya hecho)  
- Review hydrate foco · company-brief · nocturno / auth / datos  
- Merge a polish (orquestador tras smoke)

## Archivos probables

- `lib/scansChartPreviewHydrate.js`
- `app/components/screener/HuntTapeView.jsx` (si hace falta clientHeight / visible count)
- `app/page.jsx` (solo wiring de ventana Caza si aplica)
- `tests/cazaChartPreviewScrollHydrate.test.js` · `tests/scansChartPreviewHydrate*.test.js`

## Verify (programación)

```bash
npx vitest run tests/cazaChartPreviewScrollHydrate.test.js \
  tests/scansChartPreviewHydrateVisible.test.js \
  tests/scansChartPreviewHydrateStable.test.js
./vfc   # si toca paths del gate; no ampliar suite
```

Plantilla de retorno. **Sin merge a polish.** Commit+push solo en `cursor/caza-viewport-cap-a41e` + PR draft si el flujo cloud lo pide.

## Smoke (orquestador, Browser Use · `:3300` preferido)

1. Hard-reload · mesa US · vista **Caza** · cola filtrada grande (p.ej. cientos).
2. Primer paint: POSTs `/api/scans/chart-preview` acotados a viewport+buffer (no ~cola ni ráfaga tipo 80 si caben ~20 visibles).
3. Scroll profundo / j·k: POSTs adicionales solo para símbolos nuevos de la ventana; sparks visibles hidratados.
4. Anotar: status/filas, nº aproximado de POST, que scoring/filtros no cambian.

## Criterio done

- Diff solo hydrate Caza viewport+buffer (+ tests).  
- Tests OK.  
- Smoke orch OK → orquestador merge/commit polish + actualizar backlog (quitar residual/aparcado viewport-cap).
