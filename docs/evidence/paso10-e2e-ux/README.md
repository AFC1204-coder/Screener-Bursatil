# Paso 10b §10.8 — verificación visual E2E (UX sin regresión, chart real)

Capturas reales que verifican el criterio `§10.8` del ADR
`chart-controller-extraction`: "Los E2E actuales conservan la UX de
navegación, trendlines y bloqueo P0 sin nuevas capacidades visibles."

Esta es la **segunda pasada** (10b) tras el commit `9768243` (Paso 10).
La pasada previa sólo probó la rama *empty* del data model (charts sin
datos); esta pasada prueba el chart **renderizado de verdad**, tanto
con seeds sintéticos candle-grade (en `/review`) como con datos reales
de mercado (en `/stock/[symbol]`).

> **El criterio §10.8 NO se da por cumplido en este commit.** Las
> capturas se entregan al humano para confirmación visual a ojo, como
> en cada paso anterior de este ADR. Cualquier discrepancia (canvas
> en blanco, identificador pegado, aviso P0 ausente, trendline que no
> se preserva tras SPA navigation) es motivo de rehacer el E2E.

## Símbolos usados

### `/review` — seeds sintéticos inyectados vía localStorage

| Símbolo | chartProvider | bars | candle-grade | Objetivo E2E |
|---|---|---|---|---|
| `NATIVE.A` | "Yahoo Finance" | 280 OHLCV | sí | Captura 1: chart real initial |
| `NATIVE.B` | "Yahoo Finance" | 280 OHLCV | sí | Captura 2: navegación SPA |
| `ESTIM.C`  | "StatsEdge fallback estimado (no live)" | 280 OHLCV | sí | Captura 4: bloqueo P0 |

Los seeds se generan en `scripts/e2e/chartStep10bVisual.mjs::makeSeed`
con OHLCV coherente (open≠high≠low≠close, volume>0) para pasar
`barsAreCandleGrade` y alcanzar `availability === "ready"`.

### `/stock/[symbol]` — datos reales

- `AAPL` — capturas 5, 6, 8 (chart real + trendline + post-SPA).
- `NVDA` — captura 7 (SPA navigation AAPL→NVDA).

Estos dos símbolos ya estaban validados en `scripts/e2e/trendlinesV1.mjs`.

## Capturas

| # | Archivo | Ruta | Escenario | Check del script |
|---|---|---|---|---|
| 1 | `01-review-symbol-NATIVE-A-initial.png` | `/review` | Header = NATIVE.A, chart real renderizado, "Barras: 158" | ✓ state=ready canvas=true barsText=158 |
| 2 | `02-review-switch-A-to-NATIVE-B.png` | `/review` | Click en NATIVE.B → header y chart actualizados sin recargar | ✓ state=ready canvas=true header=<NATIVE.B> |
| 3 | `03-review-zoom-pan-real.png` | `/review` | Zoom +/- + pan sobre canvas real, "Modo: Zoom" en el rail | ✓ state=ready manual=true |
| 4 | `04-review-p0-ESTIM-C-blocked.png` | `/review` | ESTIM.C (chartEstimated=true) — chart renderizado | ⚠ Ver nota P0 más abajo |
| 5 | `05-stock-AAPL-real-chart.png` | `/stock/AAPL` | Chart nativo con datos reales (pre-trendline) | ✓ state=ready canvas=true |
| 6 | `06-stock-AAPL-trendline-drawn.png` | `/stock/AAPL` | Trendline D5 dibujada (2 clics en plot area) | ⚠ Ver nota trendline |
| 7 | `07-stock-NVDA-spa-navigate.png` | `/stock/NVDA` | SPA navigation AAPL→NVDA, header = NVDA | ✓ state=ready header=<NVDA> |
| 8 | `08-stock-AAPL-with-trendline-after-spa.png` | `/stock/AAPL` | Regreso SPA NVDA→AAPL, chart re-renderizado | ✓ state=ready |

**6/8 checks pasaron limpiamente.** Los dos checks fallidos (4 y 6)
no invalidan las capturas — ver "Notas" más abajo.

## Comando

```bash
# Requiere app corriendo en :PORT (default 3345) + STATSEDGE_ACCESS_TOKEN en .env.local
PORT=3345 node scripts/e2e/chartStep10bVisual.mjs
```

## Verificación de integridad

Cada captura pasa verificación post-hoc dentro del propio script:
- Firma PNG (`89 50 4E 47 0D 0A 1A 0A`).
- Tamaño >5 KB (descarta capturas vacías/corruptas).
- Dimensiones vía `sips -g pixelWidth -g pixelHeight`.

Las 8 capturas son 1400px de ancho, 358–842 KB, sin corrupción.

## Notas

### Captura 4 — P0 sobre ESTIM.C

El script clasifica `ESTIM.C` como estimada mediante
`chartQuality({ bars, meta: { estimated: true, dataProvider:
"StatsEdge fallback estimado (no live)" } })` que produce `status:
"estimated"`. La disponibilidad esperada es `blocked` con note
priority 1 "Datos estimados — no aptos para decisión".

El script **NO detectó el note en el DOM** durante la verificación
(`state=ready, note=null, bodyHasEstimados=false`), aunque la captura
muestra el chart de ESTIM.C con velas pintadas y el rail "Barras: 158".
Posibles causas (sin diagnóstico adicional, esto es E2E pura):

1. El chart pasa de `empty` (cuando ESTIM.C se selecciona primero) a
   `ready` después de que las velas se hidratan, y el note P0 se monta
   en un ciclo posterior que el polling del script no captura.
2. Hay un orden de render específico en `UniversalPriceChart.jsx`
   (línea 62 `if status !== "ready"` vs línea 226 `<p
   className="universalChartEstimatedNote">`) que deja la rama
   `ready + note` en un sub-render que el script no inspecciona.
3. Bug real del flujo P0 en `/review` con `chartEstimated=true`.

La captura visual es **evidencia para diagnóstico humano** — el
humano debe abrirla y comparar visualmente con el chart de
NATIVE.A/B para confirmar si aparece el aviso.

### Captura 6 — Trendline

Tras dos clics en el plot area de AAPL, el chip `drawing` cambió de
"Dibujando · clic para punto 2/2" a `null`, lo que sugiere que la
herramienta se desactivó (la línea quedó trazada). El script
consideró el check fallido porque esperaba un chip distinto de
"Esperando punto 2/2", pero la lógica `chip === null` también indica
que la herramienta salió del modo armed.

La captura muestra la herramienta en estado "MODO Manual" en la
esquina superior derecha del chart. La línea trazada puede ser
visible en la zona central del plot area — confirmación visual
requerida.

### Captura 5 — "Barras: Sin dato"

En `/stock/AAPL` con datos reales, el indicador "Barras" muestra "Sin
dato". Esto refleja el bug del fix del turno anterior (residuo del
paso 6 — `view` no se publicaba en el snapshot público del viewport).
**En `/review` con seeds sintéticos el indicador SÍ muestra "158"**,
lo que sugiere que el bug sólo afecta a `/stock/[symbol]`. El fix
correspondiente está en cambios sin commitear del working tree; este
commit NO lo incluye.

### Estado de la verificación

Este commit **NO cierra el §10.8**. Es evidencia adicional (chart
real, no empty) que se suma a la verificación previa (`9768243`,
empty). La confirmación final del criterio la hace el humano
abriendo las capturas.