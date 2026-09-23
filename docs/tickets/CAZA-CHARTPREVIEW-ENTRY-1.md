# CAZA-CHARTPREVIEW-ENTRY-1 — hydrate Caza entry sin batch 80

**Estado:** cerrado (orquestador 2026-09-23) · squash `dadcba1` · [#52](https://github.com/AFC1204-coder/Screener-Bursatil/pull/52)  
**Verify:** 31 tests · CI SUCCESS · smoke cold entry PASS (primer POST **25**, no 80)

## Entregado

En Caza, `chartPreviewHydratePlan` solo ventana hunt (no une mesa/pagedRows). Cold entry ~25; scroll sigue viewport+buffer.

## Cola

→ SCANS-HYDRATERS-COLD-1 (fricción #2 · residual hydrateRs ~+9 s).

## No tocado

Scoring, cold payload, Review brief, auth, FIRDS.
