# THEME-SERIES — Serie histórica RS tema ≥8 semanas

**Rama:** `codex/statsedge-ui-polish`  
**Tipo:** inventario + plan de escritura (y write solo si el dueño eligió vía)  
**Modelo:** Composer 2.5 (mecánico) o Claude Code si toca decisión FX  
**Bloqueo:** MET-1 **prohíbe backfill histórico as-of** bajo el motor FX/USD. El motor tema reutiliza el mismo camino FX (`scripts/rs-theme-private.mjs`). **No escribir semanas históricas a ciegas.**

## Meta

Chart overlay / ficha necesitan serie tema con **≥8 `weekKey`** por símbolo (mismo `engine_version` tema), no un solo snapshot W actual.

## Alcance (en orden)

1. **Inventario** (solo lectura DB/código): cuántas semanas tema hay hoy por `engine_version` / theme; ejemplos AAPL/MSFT/NVDA + 1 intl.
2. **Cerrar vía con dueño** (no inventar):
   - **A)** Acumular solo hacia adelante (cron domingo) — ≥8 sem = ~2 meses.
   - **B)** Write histórico con FX `trade_date ≤ sesión` declarado (excepción documentada a MET-1 as-of; OK explícito dueño).
   - **C)** Otra vía que proponga el agente **sin** violar invariante 10 / scoring.
3. Si el dueño ya eligió en el chat orquestador: ejecutar **solo esa vía**, con dry-run → `--write`, tests de dedupe serie (`weekKey`), smoke ficha/chart si aplica.
4. Documentar resultado en backlog.

## Fuera

MET-4b, scoring, MIGRATE, cambiar fórmula tema, commit/push (orquestador).

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
