# THEME-SERIES — Serie histórica RS tema ≥8 semanas (vía B)

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5  
**Decisión dueño (2026-08-31):** vía **B estricta** — backfill con FX **por fecha de cada barra/semana** (no FX spot de hoy para todo el histórico). Excepción documentada a la prohibición MET-1 de `--as-of` en el motor **global**; **no** reabrir `--as-of` en `rs-global-private.mjs`.

## Inventario (ya hecho)

12/12 engines · 1 `week_key` (`2026-W36`) · déficit 7 semanas.

## Qué construir / ejecutar

1. **Flag solo-tema** (p. ej. `--backfill-weeks=7` o lista de `week_key` / fechas fin de semana ISO), **sin** habilitar `--as-of` en el motor global.
2. Por cada semana objetivo (las 7 anteriores a W36, o hasta completar ≥8 puntos totales):
   - `targetDate` = último día de esa semana ISO (o viernes de sesión acordado).
   - Truncar `daily_bars` a `trade_date ≤ targetDate` **antes** de `computeSymbol` (hoy `bars[0]` es “ahora”).
   - FX: seguir `pickFxObservation` por fecha de barra (ya en `computeSymbol`) — **prohibido** aplicar una sola tasa FX de hoy a toda la serie.
   - Escribir snapshot + items con ese `week_key` / `engine_version` tema (12 themes).
3. Subir `limit` de barras si 320 no alcanza lookback+atraso (p. ej. ≥400).
4. Flujo: dry-run **1 theme × 1 semana** → dry-run acotado → `--write` completo deficitario.
5. Verificar lectura: `readThemeRsSeriesForSymbol` AAPL/MSFT/NVDA/0981.HK → **≥8** `weekKey` dedupe.
6. Documentar en cabecera del script + nota backlog: excepción dueño B + limitación Yahoo `fxPublishedAt`.

## Guardrails

- No tocar scoring / pin global / motor país.
- No escribir W36 de nuevo si ya existe (idempotente / skip).
- Respetar guard cobertura perfiles (&lt;75% abort) si aplica al write.
- Sin commit/push (orquestador).

## Fuera

MET-4b, MIGRATE, overlay UI nuevo, vía A/C.

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
