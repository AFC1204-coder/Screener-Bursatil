# SCANS-RS-THEME-HTTP-1

**Estado:** hecho (ACCEPT · 2026-09-14)  
**OWNER:** Cursor / Composer 2.5 High  
**PRIORITY:** P1  
**MODE:** INVESTIGAR → impl (chunk/concurrency)  
**Cierre:** chunk 333 + concurrency 6 → **49→16 HTTP** (−67 %). Ms aislado ~plano (601→599); bottleneck = wall-clock 12 engines. Bulk descartado (peor p95).

## Evidence

- before: `research/scans-rs-theme-http-1/probe-summary-before.json`  
- after: `research/scans-rs-theme-http-1/probe-summary-after.json`  
- Tests: `themeRs` + `scansApiRsHydrateDefer` + `themeRsHydrate` · 13 PASS
