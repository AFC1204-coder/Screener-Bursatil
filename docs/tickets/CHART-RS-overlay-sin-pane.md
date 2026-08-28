# CHART-RS — Línea RS solo en gráfico (sin panel duplicado)

**Estado:** Pendiente · tras cerrar **UX-REVIEW** (tanda actual)  
**Rama:** `codex/statsedge-ui-polish`  
**Evidencia:** capturas dueño 2026-08-28 (`/stock/OKTA`) — línea azul «RS 94» en panel precio **y** panel inferior.

## Problema

Hoy la línea RS (percentil semanal 1–99, `rsRatingSeries` → `projectRsRatingSeries`) se dibuja en **panel propio** (`RS_PANE_INDEX = 1`, `app/chartNativeAdapter.js`). En ficha se percibe **duplicidad**: la misma línea RS aparece superpuesta al precio y otra vez abajo en panel separado.

**Decisión dueño (2026-08-28):** la línea RS debe verse **solo en el gráfico principal** (overlay), no en panel aparte.

## Alcance v1 (este ticket)

1. **Quitar el panel inferior RS** — una sola representación visual de la línea RS rating.
2. **Overlay en panel precio** con escala independiente invisible (`priceScaleId` dedicado), banda inferior (~25% del panel), rango fijo 1–99 vía `autoscaleInfoProvider` (patrón ya probado en `docs/analisis-grafico-2026-08-14.md` B2/B3).
3. Mantener toggle **RS** en preferencias (`indicators.rsLine`) y badge **RS global N** en cabecera (no sustituye la línea).
4. **No romper** la línea benchmark ratio (`projectBenchmarkLineSeries`, `benchmark-ratio`) si sigue activa — distinguir visualmente (grosor/color) de la línea RS rating.
5. Actualizar tests en `tests/chartNativeAdapterTokens.test.js` / `tests/chartController.test.js` si asumen `rsPane.rendered` + pane 1.
6. Smoke Browser Use: `/stock/OKTA` (o similar) — hard-reload, RS ON, confirmar **una** línea RS en lienzo precio, **sin** franja inferior RS; volumen y MAs intactos.

## Alcance v2 (opcional mismo ticket si cabe; si no → CHART-RS-2)

Líneas adicionales en overlay, **otro color claro** cada una:

| Serie | Fuente datos | Color sugerido |
|---|---|---|
| RS global (ranking universo) | `rsRatingSeries` / motor pinneado | `--traza` (actual) |
| RS sector | `relativeStrength` o campos sector del brief | `--soft` o token claro nuevo |
| RS país | cuando exista serie (MET-2) | tercer tono claro |

Toggle por línea o leyenda mínima; sin paneles extra.

## Referencias código

- `app/chartNativeAdapter.js` — `RS_PANE_INDEX`, creación `rsSeries`, `benchmark-ratio` overlay
- `lib/chartSeriesModel.js` — `projectRsRatingSeries`, `projectBenchmarkLineSeries`, `snapPointsToRows`
- `app/useChartController.js` — `rsLineState`, `rsLegend`
- `docs/analisis-grafico-2026-08-14.md` — B1/B2/B3 (overlay vs pane; ratio vs percentil)

## Fuera de alcance

- Cambiar motor RS / MET-1b / scoring
- MET-2/MET-3 specs
- Rediseño completo identidad ficha

## Verificación

- `npm test -- chartNativeAdapter chartController chartSeriesModel` (subset relevante)
- Browser Use ficha con RS ON/OFF
- `./vfc` si toca JSX/CSS estructural

## Modelo sugerido

Composer o MiniMax M3 · effort **MED/HIGH** (decisión overlay + posible multi-línea).

Sin commit ni push desde programación.
