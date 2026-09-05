# Ticket activo — RS en el gráfico (overlay series)

**Estado:** Cerrado · verify tests · **commit pendiente orquestador**  
**Rama:** `cursor/chart-rs-series-d8d3` → PR contra `codex/statsedge-ui-polish`  
**Modelo:** Composer

## Problema

- Vista rápida y `/review` mostraban badge RS pero **no la línea** (RowPriceChart no pasaba `rsRatingSeries` / país / tema).
- La línea benchmark ratio se ocultaba al apagar el toggle RS global (`projectBenchmarkLineSeries` atado a `rsLine`).

## Hecho

- `RowPriceChart` hidrata series vía `/api/rs-weekly` (ampliado: global + país + tema) o desde fila (`globalRsSeries`… del brief en review).
- `hydrateReviewRow` propaga series y scores país/tema del company-brief.
- Benchmark ratio independiente del toggle RS ranking.
- Tests: `chartRsRowProps`, `chartSeriesModel`, `rsSurfaceConsistency`.

## LO QUE NO VERIFIQUÉ

- Smoke Browser Use en ficha / vista rápida / review (hard-reload, toggles RS, línea visible).

## Siguiente

Orquestador: `./vfc` subset chart + smoke visual si aplica.
