# SCREENER-PARTIAL-MARKETS-LOOP-1

**Estado:** hecho (ACCEPT · 2026-09-13)  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P0  
**MODE:** IMPLEMENTACIÓN + fix-up settled key  
**Cierre:** `marketsSelectionSettledKey` tras éxito de load; auto-load no bucléa en partial; US→Global sí carga 1×. Smoke `:3300` markets=1 · 668/4237 · AVAH OK.

## PROBLEM

Con Global + API `partial-markets`, `marketsStale` permanente disparaba auto-reload (~29 fetches) y loading eterno.

## APPROACH

- `marketsSelectionLoadSettled(selectedKey, settledKey)`  
- Marcar settled tras éxito de `loadScanForMarketSelection` (incl. merge parcial)  
- Clear settled al cambiar selección  
- Notice «Cobertura parcial» solo con settled; sin settled → loading + auto-load (US→Global)

## PASS (smoke orquestador)

- Global: **1** `anchor=markets`, Fusión/Cobertura parcial, `668 de 4237`, tickers (AVAH…)  
- EE. UU.: `560 de 3576`, AVAH/ATAI  
- Vitest 72 PASS
