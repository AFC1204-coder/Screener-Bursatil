# BUG-HUNT-1 / 1b — Crash al clic ficha hunt

**Estado:** Cerrado  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  

## Dolor

Clic en rail hunt tumbaba la página (~2,5–4 s → «This page couldn’t load»). Bloqueaba R-06 y uso diario.

## Causa (1b)

Bucle infinito `Maximum update depth exceeded`: `ScreenerShell` `useLayoutEffect` dependía de `onHuntTruthLinePaint` inline → `recordTruthLinePaint` devolvía ms cada pasada → `setScanPerf` → re-render.  
Contribuyentes: `flushSync` + re-anotar lote diferido grande al cambiar `setupMode`.

## Fix

- `recordTruthLinePaint` una vez por gesto; callback vía ref + `useCallback`
- Sin `flushSync`; mesa acotada antes de `setPreset` cuando hay caché; annotate sobre `rows` si defer stale

## Smoke orquestador (2026-08-31)

Mesa **1715** Global · ciclo Deterioro / E2 / pivot / intl / IPO / Deterioro · **sin crash**.  
R-06 (gesto→truth, Browser Use): Deterioro ~1030 · E2 ~333 · pivot ~249 · intl ~1544 · IPO ~435.
