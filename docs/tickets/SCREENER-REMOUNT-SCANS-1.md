# SCREENER-REMOUNT-SCANS-1

**Estado:** hecho (ACCEPT · 2026-09-13)  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P1  
**MODE:** Approach A (guards)  
**Cierre:** skip cloud restore si sesión+filas locales; settled key persistida; align no vacía mesa parcial settled.

## Smoke orquestador (`:3300` next dev)

- **Global bounce** `/`→`/review`→`/`: `returnMarkets=0`, `returnNightly=2` (Strict Mode; 1 lógico). Settled key restaurada.  
- **EE. UU.:** igual patrón nightly; 0 markets.  
- Residual nightly: copia local en `statsedge.scans.v1` llega con `rows: []` / muestreada (cuota) → guard no puede saltar cloud; **aceptable** per ticket (≤1 lógico).  
- Review: 0 `/api/scans`.

## Tests

78 PASS (`reviewSession` + `screenerReviewLaunch` + `marketAvailability` + `screenerRemountGuards`).
