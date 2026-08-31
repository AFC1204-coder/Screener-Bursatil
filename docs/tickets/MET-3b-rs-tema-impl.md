# MET-3b — Implementación RS tema

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Hecho (orquestador 2026-08-31)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Spec:** `docs/spec-rs-tema.md` (aceptado 2026-08-31 + addendum Grok)  
**Autorización dueño:** 2026-08-31

## Objetivo

Lector + motor USD cross-market por las 12 `THEME_RULES` + columna/filtro. Pin global y país intactos. Cron = MET-3c. Overlay = CHART-RS-3.

## Preferencia UNIQUE

Sufijo `engine_version` por theme slug (`statsedge-private-theme-rs-usd-{slug}-v1`) — sin DDL.
