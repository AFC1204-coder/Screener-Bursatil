# REVIEW-CHART-PARALLEL-1

**Estado:** hecho (ACCEPT parcial · 2026-09-13)  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P1 (post REVIEW-HYDRATE-DEFER-1)  
**MODE:** evidencia + candado tests · **sin diff de producto** (RowPriceChart post-DEFER ya cumple)  
**Cierre:** 1 chart + 1 rs-weekly por ticker; 0 brief; error OHLC explícito. Tests `reviewChartParallel.test.js`. Residual: sin caché cross-symbol al revisitar.

## PROBLEM

Tras DEFER, el brief ya no bloquea. Queda asegurar que al cambiar de símbolo en Rapid Review el camino T1 (`/api/chart` + `/api/rs-weekly` si hace falta overlay) arranca **en paralelo con el shell**, con error explícito si OHLC falla (Astra **A2-CHART**), sin segundo fetch innecesario y sin reintroducir brief.

## EVIDENCE

- DEFER ACCEPT `f6eae85`: `ReviewChartPanel` → `RowPriceChart`; smoke vio `/api/chart` al navegar AAA→BBB.
- Diseño BRIEF-CRITICAL: a veces doble `/api/chart`; series RS pueden ir por brief (ya cortado) o `/api/rs-weekly`.
- Astra: banner/stable = OHLC T1; error de chart ≠ stable.

## SCOPE

1. Medir en `/review` (sesión válida): al cambiar símbolo, timing y número de `/api/chart` y `/api/rs-weekly`.
2. Si `RowPriceChart` ya dispara chart al montar/cambiar `row.symbol` de forma correcta → documentar PASS parcial y solo fijar gaps (doble fetch, rs-weekly tardío, empty/error copy).
3. Si hay gap: disparar T1 al cambio de símbolo sin gate de brief/hidratación; paralelizar rs-weekly cuando el overlay lo necesite y la fila no traiga serie.
4. Estado de error OHLC visible y explícito (no silencioso; no fingir stable).
5. Tests de contrato (source/candado) + smoke breve si hay cambio de producto.

## MUST NOT TOUCH

- `lib/reviewSession.js` contrato  
- Reintroducir `company-brief` / `hydrateReviewRow`  
- Recalc métricas desde barras (A1-S)  
- `persistReviewQueue` / strip preview (ticket siguiente)  
- Scoring / RS writers / nocturno  
- Prefetch N+1 masivo (futuro)

## PASS CRITERIA

- Cambio de ticker: ≥1 `/api/chart` útil sin esperar brief; **0** `company-brief`.
- Sin doble fetch idéntico documentado como bug (si hay 2, justificar o eliminar).
- Overlay RS: si hace falta serie y no está en fila → `/api/rs-weekly` sin bloquear shell.
- Fallo chart → UI de error explícita.
- Tests DEFER existentes siguen PASS; + tests del gap tocado.
- Browser smoke orquestador si hay diff de producto.

## TESTS

```bash
npx vitest run tests/reviewHydrateDefer.test.js tests/reviewSession.test.js
# + nuevos del ticket
```

## STOP CONDITION

- Refactor grande de `UniversalPriceChart` / chart controller → STOP.  
- Volver a meter brief o métricas derivadas de barras → STOP.  
- Si ya está OK y solo falta documentación → devolver evidencia, sin diff cosmético.

## DEPENDENCIES

- REVIEW-HYDRATE-DEFER-1 ACCEPT (`f6eae85`).  
- Astra A2-CHART.

## SIGUIENTE (no este)

- `REVIEW-PERSIST-PREVIEW-1`
