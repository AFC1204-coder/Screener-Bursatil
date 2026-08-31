# PERF-NAC — Latencia cambio de vista multi-mercado

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Cerrado  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Origen:** R-06 · UX-NAC track · 2026-08-31  
**Cierre:** hunt cold (signature prefetch) · scans `core`/`hydrateRs=1` en cloudSync · engines país en paralelo · smoke ms auth-blocked

## Objetivo

Recortar espera percibida cold al cambiar ficha/mercados; hydrate RS sin colgar el primer paint.
