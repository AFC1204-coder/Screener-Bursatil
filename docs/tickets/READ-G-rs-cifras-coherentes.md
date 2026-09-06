# READ-G — RS: una cifra canónica por superficie (ficha / chart / vista rápida)

Copia de referencia. Ejecutar desde `docs/tickets/activo.md`.

**Estado:** Pendiente  
**Prioridad:** P2  
**Rama:** `codex/statsedge-ui-polish`  
**Modelo sugerido:** Composer (auditoría + UI acotada) o GPT-5.6 Terra si solo alinea lectores existentes  
**Origen:** UX-READ-1 aparcado · `docs/analisis-ux-read-jerarquia-2026-09-05.md` §LO QUE NO VERIFIQUÉ · inventario `docs/inventario-residuales-ux-read-2026-09-06.md`  
**Tipo:** producto/lectura — **no scoring**

## Problema

En AAPL (smoke Fable 2026-09-05) la misma sesión mostró **RS 72** (badge/overlay chart), **64** (tarjeta de identidad) y **57** (vista rápida). READ-E redujo ruido (un overlay por defecto) y READ-F unificó la etiqueta «RS», pero **no garantiza el mismo número** entre tarjeta, head del chart y modal de revisión.

`lib/rsCanonical.js` ya define la regla: ranking semanal (`weeklyRsRating` / pin de ficha), no percentil de lote (`rsGlobalPct`). El residual es de **superficies que aún leen fuentes distintas o pin vs cola de serie**.

## Alcance (hacer)

1. **Auditar** en HEAD las tres superficies con el mismo símbolo (AAPL US + un no-US si aplica):
   - Tarjeta: `buildChartIdentityCard` + `stockRsUniverse`
   - Chart: badges `rsMainScore` / leyenda overlay cuando `rsLine` ON
   - Vista rápida: `QuickReviewModal` / fila compacta del screener
2. **Alinear lectura** al RS canónico de ficha donde el producto dice «RS» (misma semana, mismo pin cuando exista `rs.rating`).
3. Si pin y último punto de `globalRsSeries` divergen: **mostrar el pin** en tarjeta y badge; la línea del chart puede seguir siendo histórica — pero el **número visible** junto a «RS» debe coincidir o llevar leyenda explícita («histórico en gráfico» vs «corte semanal»).
4. Tests: extender `tests/rsSurfaceConsistency.test.js` y/o `tests/fichaRetiradas.test.js` con caso «pin 64, cola 72 → UI enseña 64 en tarjeta y badge».
5. `./vfc` en archivos tocados.

## Fuera de alcance

- Scoring, `rsGlobalPct`, umbrales, motor `rs-universe.mjs`, cron GHA, finalize percentil
- Cambiar qué es el ranking (MET-1/2/3 specs)
- READ-B lente por ficha · mesa columnas · verdad compacta (ya cerrados)
- Mini ops / merge a polish sin smoke orquestador

## Criterios de aceptación

1. `/stock/AAPL` con tarjeta visible: **un solo RS** en tarjeta y en badge del chart (head plegado o equivalente visible) — mismo entero redondeado.
2. Con `rsLine` ON: el badge «RS global N» usa el **mismo N** que la tarjeta (no la cola de serie si hay pin).
3. Vista rápida del mismo símbolo en la misma sesión: celda RS = mismo entero (o ausencia con motivo, nunca lote contradictorio).
4. Tests nuevos/actualizados pasan; sin regresión en `vistaRapidaRetiradas` («no 97» cuando weekly es 61).
5. Smoke orquestador: hard-reload Mini `/stock/AAPL` + abrir Revisar sobre AAPL; anotar los tres números (deben coincidir o documentar excepción explícita en UI).

## Archivos probables

- `app/stock/[symbol]/StockClient.jsx`
- `app/UniversalPriceChart.jsx`
- `app/useChartController.js`
- `lib/chartIdentityCard.js`
- `app/components/screener/QuickReviewModal.jsx`
- `tests/rsSurfaceConsistency.test.js`, `tests/fichaRetiradas.test.js`

## Plantilla de retorno

```
## Resumen
## Archivos
## Tests
## LO QUE NO VERIFIQUÉ
Sin commit ni push.
```
