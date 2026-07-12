# P0 datos estimados en superficie de decisión — cierre y follow-up

**Estado:** CERRADO para el alcance del P0 (`/stock/[symbol]`).

## Commits
- `bae94f4` — bloqueo de barras estimadas del fetch remoto (`/api/chart`) en
  `UniversalPriceChart` (parcial).
- `5fe4bea` — bloqueo de barras estimadas que llegan por la prop `bars` (SSR de
  `company-brief`); cierra el P0. Añade la prop `chartEstimated`.

## Evidencia (este directorio)
- `chart-estimated-BEFORE-prop-fix-leak.png` — antes: velas sintéticas pintadas
  como reales, sin aviso (leak vía prop `bars`).
- `chart-estimated-AFTER-prop-fix-blocked.png` — después: 0 velas + franja
  "Datos estimados — no aptos para decisión".
- `chart-real-aapl-no-regression*.png` — símbolo real, sin regresión visual.

## Causa raíz (para no perderla)
En `/stock/[symbol]` las barras sintéticas NO entran por `/api/chart` sino por
la prop `bars` (SSR de `company-brief`): con ~520 barras locales
`needsRemote=false` y el fetch remoto ni se dispara. Además
`compactChartBars` (`app/api/company-brief/route.js:649`) borra el flag
`estimated` por barra, así que `barsAreCandleGrade` las ve como candle-grade.
La señal canónica sobrevive a nivel de payload:
`data.dataQuality.freshness.chartEstimated` → se reenvía vía prop `chartEstimated`.

## Follow-up pendiente (NO tocado en este P0)

### 1. `app/review/page.jsx` — consumidor sin `chartEstimated`
`app/review/page.jsx` monta `UniversalPriceChart` pasando `bars` pero SIN
`chartEstimated` (queda en `false` por defecto → sin regresión). El riesgo es
MENOR porque esos `bars` ya pasaron por `assertDecisionGrade` río arriba en el
pipeline de scoring antes de persistirse — pero NO es cero. Fuera del alcance de
este P0 (acotado a `/stock/[symbol]`). Anotado para no perderlo.

### 2. `compactChartBars` pierde el flag `estimated` por barra
Descartado en este P0 a propósito: la señal a nivel de payload
(`chartEstimated`) es suficiente y de mínimo riesgo. Preservar el flag por barra
tocaría a todos los consumidores de `chartBars` (el scoring valida el payload,
no las barras compactadas). Reabrir solo si aparece un tercer consumidor que
necesite la calidad por barra.
