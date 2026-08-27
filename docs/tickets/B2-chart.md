# B2-chart — Gráfico en vista rápida / review que no termina de cargar

**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer (o thinking si hace falta seguir el fetch)  
**Origen:** `docs/analisis-vista-rapida-2026-08-24.md` (B2), feedback dueño 2026-08-26 (modal vista rápida, gráfico no carga)

## Problema (reproducido)

- Vista rápida (`QuickReviewModal` → `RowPreviewChart` → `RowPriceChart` → `UniversalPriceChart`): el chart se queda en **«Cargando histórico…»** sin pasar a `ready` ni mostrar velas/badge RS.
- `/review` (`ReviewChartPanel` → `RowPriceChart`): mismo síntoma en smoke orquestador (poll 18s, sin canvas).
- Commit previo `219e075` cableó `emptyFallback` para estados no-`ready`; el texto de loading **sí sale**, pero **no hay transición a gráfico usable**.

## Causas documentadas (verificar cuál aplica hoy)

1. **Preview close-only descartado en velas** — `RowPriceChart.localBarsForRow` devuelve `[]` si el preview no es candle-grade; el chart **siempre** pide `/api/chart` (`app/RowPriceChart.jsx`, comentario líneas 16-24).
2. **Fetch remoto no llega a `ready`** — `useChartDataModel` + `lib/chartDataModel.js` (`history-loading`, availability blocked/empty). Investigar: abort por cambio de símbolo, error silencioso, respuesta vacía, StrictMode doble mount, token/sesión en `:3000`.
3. **Comentario obsoleto** en `QuickReviewModal.jsx:39-43` dice que `emptyFallback` no se consume; **sí se consume** en `UniversalPriceChart.jsx:71-82` — actualizar o borrar al cerrar.

## Objetivo

En **vista rápida** y **`/review`**, al abrir un valor de la tabla:

1. **Algo visible al instante** — mínimo preview en **línea** con `row.chartPreview` mientras llega OHLC (aunque el estilo preferido sea velas), **o** transición clara loading → ready en &lt;5s en dev con sesión normal.
2. **Estado honesto** — si falla `/api/chart`, mensaje de error vía `emptyFallback`, no loading infinito.
3. **Badge RS global** visible cuando `status === "ready"` (`canonicalRsValue` ya cableado en `RowPriceChart`).

## Alcance

### Dentro

- Diagnosticar y corregir por qué el fetch no completa (o por qué `availability` no pasa a `ready`) desde filas del screener.
- Preview instantáneo: opciones aceptables (elige la mínima que funcione):
  - pintar preview en línea en paralelo al fetch de velas;
  - default de estilo **línea** en modal/review hasta tener OHLC;
  - o mostrar preview línea solo en overlay de loading.
- Tests: ampliar `tests/chartController.test.js` / `tests/chartUniversalPriceChartBehavior.test.js` si aplica; test de `localBarsForRow` + loading→ready si hay lógica nueva.
- Limpiar comentarios PENDIENTE obsoletos en `QuickReviewModal.jsx` / `review/page.jsx` si B2 queda resuelto.
- Sin commit ni push.

### Fuera

- Refactor chart-controller (rama aparte).
- VCP/contracciones en producto (`research/contracciones/` — track investigación).
- Fusionar dos colas modal/`/review`.
- Resoluciones en nube (dueño: no relevante).

## Archivos probables

- `app/RowPriceChart.jsx`, `lib/screenerMarket.jsx` (`RowPreviewChart`)
- `app/useChartDataModel.js`, `lib/chartDataModel.js`
- `app/UniversalPriceChart.jsx`, `app/useChartController.js`
- `app/components/screener/QuickReviewModal.jsx`, `app/review/page.jsx`
- `app/api/chart/` (solo si el bug está en la ruta)

## Verificación (orquestador, Browser Use)

1. Tests chart pertinentes (`npm test -- chart`).
2. `http://localhost:3000`: preset cualquiera → dblclick fila → vista rápida: en ≤10s canvas visible **o** error explícito (no loading eterno); badge «RS global» con número si ready.
3. `/review`: mismo criterio en fila activa.

## Plantilla de retorno

```
## Resumen
(1–4 bullets)

## Archivos
(lista real)

## Tests
(comando + resultado)

## LO QUE NO VERIFIQUÉ
(…)

Sin commit ni push.
```
