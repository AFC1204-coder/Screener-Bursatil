# IPO-UX-E2 — Pasar `ipoAnchor*` al company-brief de ficha

**Estado:** Cerrado · smoke ANDG +121,5% = mesa 2026-09-07  
**Prioridad:** P1 residual (cierra gap smoke IPO-UX-E)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Tipo:** datos / API ficha — **no scoring · no RS IPO · no nocturno · no UI nueva**

## Problema

`/stock/ANDG` muestra **Desde salida +139,4%** (ancla desde `chartBars` del brief). La mesa IPO, con ancla persistida del scan, muestra **+121,5%**. `buildStockIpoSalidaContext` ya prefiere `ipoAnchorClose`/`ipoAnchorDate`, pero `app/api/company-brief` no los emite.

## Alcance

1. En el payload de `/api/company-brief` (y cualquier merge de fila de scan hacia el brief), incluir **`ipoAnchorClose`** y **`ipoAnchorDate`** cuando existan en la fila materializada / metrics del scan vigente del símbolo.
2. Si el brief ya calcula o hidrata desde scan metrics, reutilizar ese camino; no inventar segunda fuente.
3. Si no hay ancla en scan: omitir campos (la ficha sigue con fallback `chartBars` como hoy).
4. Tests del contrato brief / proyección. `./vfc` en tocados.
5. Sin commit/push. Sin ampliar UI (E ya pinta).

## Fuera

- IPO-UX-F  
- Recalcular ancla en el brief si el scan no la tiene (eso es D2/nocturno)  
- Cambiar fórmula de `%`  
- Backfill Mini

## Criterios

1. Brief de un símbolo con ancla en scan (ANDG tras D2 write) incluye `ipoAnchorClose` / `ipoAnchorDate` numéricos/fecha.
2. Con esos campos, `buildStockIpoSalidaContext(brief)` produce % alineado con mesa (± redondeo de `formatPct`).
3. Sin ancla en scan → brief sin campos (o null) y ficha no rompe.
4. Vitest OK.
