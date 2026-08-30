# RS-SERIES-1 — Dedupe weekKey en series RS de ficha

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Activo  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Origen:** smoke CHART-RS-2 · AAPL serie país W32 duplicada (80 y 70) antes de W35=64

## Objetivo

`readGlobalRsSeriesForSymbol` y `readCountryRsSeriesForSymbol` emiten como máximo un punto por `weekKey` (el de `snapshot_date` más reciente).
