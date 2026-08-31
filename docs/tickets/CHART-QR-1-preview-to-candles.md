# CHART-QR-1 — Vista rápida: preview línea → velas OHLC

**Rama:** `codex/statsedge-ui-polish`  
**Modelo:** Composer 2.5 (thinking si el fetch/controller no cuadra)  
**Origen:** feedback dueño 2026-08-31 (vista rápida AMPL: «Velas» pero línea fina casi siempre)  
**Relacionado:** B2-chart (`5d28d5f`), `docs/tickets/B2-chart.md`  
**Copia activa:** `docs/tickets/activo.md`

## Problema

En **vista rápida** y **`/review`**, con estilo **Velas** guardado:

1. Al abrir un valor se ve **línea blanca** (preview `chartPreview` close-only) — correcto como instantáneo.
2. Tras el fetch `/api/chart` (~≤15 s en dev logueado), **muchas veces no pasa a velas** o no hay señal clara de transición; sensación de «carga a medias» permanente.

Arquitectura actual: `RowPriceChart.resolveRowChartSource` → `preferredStyle` + `useChartController.renderConfig` cuando `requestState === settled`.

## Objetivo

1. Con sesión normal y `/api/chart` OK: en **≤10 s** el chart pasa de preview línea a **velas** si el usuario tiene estilo Velas.
2. Mientras llega OHLC: aviso discreto pero visible («Ampliando histórico…» ya existe en data model; asegurar que se ve en modal).
3. Si el fetch falla: mensaje honesto; **no** loading infinito; preview línea aceptable con aviso de expansión fallida.

## Alcance

- Diagnosticar por qué `preferredStyle` no re-renderiza velas (controller attachment, `renderConfig.style`, serie nativa, StrictMode abort, etc.).
- Corregir la transición mínima que funcione.
- Tests: `resolveRowChartSource` + behavior loading→settled si aplica (`tests/chartUniversalPriceChartBehavior.test.js`, `tests/chartController.test.js`).
- Smoke: orquestador Browser Use — dblclick fila → vista rápida → poll 12 s → velas visibles o error explícito.

## Fuera

- Refactor chart-controller rama aparte.
- RS overlays (CHART-QR-2).
- Panel lateral (CHART-QR-3).
- commit/push.

## Archivos probables

- `app/RowPriceChart.jsx`, `app/useChartController.js`, `app/useChartDataModel.js`
- `lib/chartDataModel.js`, `app/UniversalPriceChart.jsx`
- `app/components/screener/QuickReviewModal.jsx`, `app/review/page.jsx`

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
