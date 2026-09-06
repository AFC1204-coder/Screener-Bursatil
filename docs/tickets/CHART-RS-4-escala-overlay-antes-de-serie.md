# CHART-RS-4 — Escala `rs-rating` antes de la serie (líneas país/tema invisibles)

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Cerrado `91c63ff` (orquestador 2026-09-06) · smoke `/stock/ATRC` `:3000` OK  
**Prioridad:** P1 (regresión chart; datos OK)  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer  
**Origen:** reporte dueño 2026-09-06 · ficha ATRC · Browser Use orquestador  
**Tipo:** bug chart adapter — **no scoring / no motor RS**

## Problema

Con **RS país** / **RS tema** (y también **RS** global) activados, las líneas no aparecen en el lienzo. En DOM queda un `dataNote` / `renderError`:

`Trying to apply price scale options with incorrect ID: rs-rating`

Las series llegan al cliente (p. ej. ATRC: global ~27, país ~27, tema ~8 semanas vía `/api/company-brief`). El fallo es de **orden de API** en lightweight-charts v5:

En `app/chartNativeAdapter.js`, `ensureRsOverlayScale(chart)` hace `chart.priceScale("rs-rating").applyOptions(...)` **antes** de `addSeries` con `priceScaleId: "rs-rating"`. LWC solo registra escalas custom cuando una serie las usa; si no existe → throw. El adaptador aborta → no se añaden líneas RS; el mensaje queda en `renderError`.

Referencia correcta en el mismo archivo: **benchmark-ratio** (añade serie → luego `priceScale(...).applyOptions`).

Persistencia: si el usuario dejó «RS país» ON, el error aparece al cargar la ficha sin tocar toggles.

## Alcance (hacer)

1. En `ensureRsOverlayScale` / bloque RS: **crear al menos una serie** con `priceScaleId: "rs-rating"` y **después** aplicar opciones de escala (mismo patrón que `benchmark-ratio`). Una sola llamada a `ensureRsOverlayScale` tras la primera serie RS del attachment.
2. Opcional menor: en `useChartController.js`, limpiar `renderError` al completar `render()` con éxito (hoy el catch setea y el éxito no limpia).
3. Endurecer el mock de `tests/chartNativeAdapterTokens.test.js` (`rsAdapterHarness`): `priceScale(id).applyOptions` debe fallar si aún no hay `addSeries` con ese `priceScaleId` — así el orden incorrecto rompe el test.
4. Tests existentes de overlay RS (global / país / tema / las tres) deben seguir verdes; añadir aserción de orden si hace falta.
5. Sin commit / sin push. `./vfc` si aplica.

## Fuera de alcance

- Motor / cron / snapshots RS (datos ya OK)
- Tokens de color `--soft` / `--rs-theme` (contraste aparte; no es la causa)
- Cambiar defaults de toggles en `lib/chartSettings.js`
- Panel inferior RS (CHART-RS ya cerrado: overlay-only)

## Criterios de aceptación

1. Con RS / RS país / RS tema ON (uno o varios) y serie suficiente (≥8 semanas), las líneas se dibujan; **no** aparece el error `incorrect ID: rs-rating`.
2. Escala compartida `rs-rating`, panel 0, márgenes/rango 1–99 intactos (tests).
3. Vitest `chartNativeAdapterTokens` (bloque overlay RS) verde; mock no permite applyOptions prematuro.
4. Smoke orquestador: `/stock/ATRC` (o AAPL) hard-reload, toggles ON, sin `renderError`, líneas visibles.

## Archivos probables

- `app/chartNativeAdapter.js` (`ensureRsOverlayScale` + orden del bloque RS)
- `app/useChartController.js` (clear `renderError` on success — opcional)
- `tests/chartNativeAdapterTokens.test.js`

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
