# MET-4e — Backfill + verify persistencia (paso 1)

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 (o orquestador)  
**Contexto:** MET-4c/4d listos en código; el nocturno **actual** no tiene `weeksAboveSma*` en `metrics`/`raw` (probe 0/200).  
**MIGRATE:** fuera

## Objetivo

1. **Backfill** en el scan US publishable: escribir en `metrics` (y `raw` si no vacío) los campos MET-4b  
   `weeksAboveSma30w`, `weeksAboveSma30wAbove`, `weeksAboveSma10w`, `weeksAboveSma10wAbove`,  
   `advanceRecentPct`, `advancePriorPct` — calculados con `trendSupportFieldsFromBars` + `daily_bars` (mismo contrato que el scan).  
2. **Smoke** Browser Use (orquestador):  
   - Vista rápida: «Sostén» con semanas reales (no Sin dato en persistencia).  
   - Filtro Tendencia ≥8: pasa **>0** filas (no toda la mesa a 0 por sin dato).

## Script

`scripts/patch-scan-trend-support.mjs`  
- Default **dry-run**.  
- `--write` solo con OK explícito del dueño (escribe `scan_results`).  
- Concurrencia acotada; resume/log de cobertura (`withField`, `above8`).

## Fuera

Nuevos filtros, salud en modal, MIGRATE, cambiar fórmula de persistencia, commit/push sin gate de datos.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
