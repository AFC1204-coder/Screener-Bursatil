# MH-FILL-2 — Dist/Acc honestos en Mercado

**Estado:** Hecho  
**Prioridad:** P1  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer  
**Origen:** `docs/analisis-criterio-libros-etapas-mercado-2026-09-08.md` G3 / MH-FILL-2  
**Tipo:** market-health · honestidad de nombre · dato ya existe  
**Cierre:** smoke labels Dist/Acc 20d (SPY) + Presión sectorial; tests 6/6 (fix timebomb cacheWritten)

## Problema

El KPI hero de `/market-health` muestra **«Dist/Acc 20d»** con `weinsteinTape.distributionDays20Avg` / `accumulationDays20Avg` — el **promedio de los 11 SPDR**, no días de distribución sobre el índice. O'Neil / el criterio de libros hablan del conteo **sobre el índice**. Ese conteo **ya existe** por índice (`volumeTape` → `distributionDays20` / `accumulationDays20` en la fila SPY u otros) y se pinta en la tabla de auditoría; el hero usa otro número con el mismo nombre.

Es un proxy defendible de presión interna, pero **no es el indicador que el rótulo sugiere**.

## Alcance

1. **KPI hero** — «Dist/Acc» pasa a mostrar el conteo del **índice de referencia** (SPY, o el primario ya usado en régimen), con ventana **declarada** en el rótulo/hint (hoy `volumeTape` = 20 sesiones; no inventar 25 sin cambiar la función).
2. **Promedio sectorial** — conservar el dato (`distributionDays20Avg` / `accumulationDays20Avg`) con **nombre honesto**: p. ej. «Presión sectorial Dist/Acc» en N1/N3 o tape secundario; **no** bajo el mismo rótulo que el índice.
3. **API** — si hace falta, exponer en `weinsteinTape` campos explícitos (`indexDistributionDays20`, `indexAccumulationDays20`, símbolo fuente) además de los avg sectoriales; no romper consumidores sin migrar copy.
4. **Divergencias / labels** de `weinsteinTape` que usen el avg sectorial: pueden seguir usándolo, pero el copy de divergencia ya dice «en sectores» — no mezclar en UI hero.
5. **Tests** del route/page tocados + `./vfc`. Sin commit/push.

## Fuera de alcance (NO)

| Tema | Motivo |
|---|---|
| MH-FILL-5 régimen regional | Ticket aparte + decisión |
| MH-FILL-4 NH/NL / fugas fallidas | Ticket aparte |
| MH-FILL-6 serie temporal | Ticket aparte |
| Reescribir `volumeTape` a definición O'Neil exacta (25d, solo vs día anterior) | Fuera; declarar ventana actual basta |
| STAGE / weeklyStage / scoring | Congelado |
| Mini ops / RPC | Residual aparte |

## Criterios

1. En `/market-health`, el KPI hero Dist/Acc coincide con la celda Dist/Acc del **mismo índice** en la tabla (SPY u el elegido).  
2. El promedio sectorial sigue visible **con otro nombre**, o ausente del hero.  
3. Vitest + lint OK. Smoke orquestador: hard-reload Mercado.

Sin commit/push.
