# Capa de histórico largo — diseño, coste, muestreo y pendientes

Fecha: 2026-11-08. Estado: **código y migración escritos, nada ejecutado contra la base del Mini, nada desplegado, ninguna interfaz tocada.**
Marcas: **[V]** verificado en esta sesión · **[S]** supuesto / estimado · **[N]** no verificado.

## 1. Qué se ha comprobado del punto de partida

- **[V]** `distanceATH` no es máximo histórico: `highDist(calcBars, calcBars.length)` en `lib/researchRow.js:163` y `lib/materializedScanner.js` (misma línea de proyección) mide sobre las barras de cálculo (~2 años).
- **[V]** Ya existía la fuente correcta: `fetchYahooFullHistoryChart` (`lib/yahoo.js`), `period1=0&interval=1wk`, que falla si Yahoo declara otra granularidad. La usa `/api/chart?range=MAX`. No hacía falta tocar las guardas de cadencia de `dailyBarsCache`: este lote **no pasa por ella** y no escribe en `daily_bars`.
- **[V]** Las barras vienen **ajustadas por splits y dividendos** (`adjclose`), igual que el gráfico «Max»: los rendimientos son de retorno total y coinciden con lo que ve el usuario en el gráfico.
- **[N]** No he podido leer `daily_bars`/universo del Mini: el permiso de Bash denegó el `psql` por SSH (lectura de producción). No lo rodeé. Las cifras de universo son las del encargo.

## 2. Diseño

### Fuente y cadencia
Yahoo `interval=1wk`, histórico entero, **una petición por símbolo**. Semanal basta para todas las métricas; mensual (`1mo`) perdería precisión en el máximo y el rendimiento a 1 año. Cadencia: **semanal** (el histórico largo no cambia de un día para otro). Con `--write` se salta cualquier símbolo cuya estadística utilizable tenga menos de 6 días (`--min-age-days`), salvo `--force`.

### Métricas (todas en %, null si no medibles, nunca 0)
| Campo (tabla) | Definición |
|---|---|
| `ath_value`, `ath_date` | mayor *high* semanal de TODA la serie (o el precio vivo si lo supera) |
| `ath_distance_pct` (≤ 0), `ath_years_ago` | cierre actual contra ese máximo; años desde él |
| `ret_1y/3y/5y/10y` | por **fecha de calendario** (mismo día N años antes), no por nº de barras |
| `ret_since_ipo` | solo si la serie arranca en la primera cotización (ver calidad) |
| `max_drawdown_5y` | pico→valle sobre cierres de los últimos 5 años (exige ≥ 3 años de historia) |
| `down_years_10`, `covered_years_10` | bloques de 52 semanas hacia atrás con retorno < 0, y cuántos bloques cubre la serie |
| `sma200w_pos_pct`, `sma200w_slope_pct` | posición sobre la media de 200 semanas y su variación a 26 semanas |
| `trend_slope_ann_pct_5y`, `trend_r2_5y` | regresión de ln(precio) a 5 años: crecimiento anual y R² (0–1) |

**Regularidad = R² con el signo de la pendiente.** Medido en la muestra: NKE tiene R² 0,86 *cayendo* un 20 %/año y SPCE 0,93 *cayendo* un 66 %/año. El R² solo no distingue tendencia alcista de bajista: el filtro debe combinarlo con `trend_slope_ann_pct_5y > 0`.

### Calidad de datos (hallazgos reales del muestreo)
1. **Splits sin ajustar antiguos.** SHEL.L (1997) y ASML.AS (1999) traen un salto semanal (×0,30 y ×2,68) sin evento de split cercano. Regla: salto fuera de [0,4; 2,5] sin split a ±14 días → si es **más antiguo de 12 años** se descarta la historia previa (`detail.truncatedAt`); si es reciente se conserva y se cuenta (`detail.recentJumps`), porque casi siempre es un hundimiento real y descartar lo anterior falsearía el máximo. **[S]** El umbral de 12 años es heurístico; solo se ha visto en 2 símbolos.
2. **Barras con `high` sin ajustar** (SHEL.L 1997 daba un máximo de 6.322 con un precio de 3.700). Se descarta un `high` > 2,5× el cierre.
3. **Series que Yahoo arranca el 1970-01-01** (BA y GE: 2.968 barras «desde 1970» con primera cotización en 1962). Se marca `startClamped` y `ret_since_ipo` queda null.
4. **Deslistados/suspendidos**: última barra > ~4 semanas → `status='stale'`, no se proyecta, y la vista `long_history_latest` conserva la última estadística buena.
5. IPO reciente (< 1 año) → `status='short'`: solo máximo y desde-IPO; los horizontes quedan null.

### Dónde viven
Tabla nueva `long_history_stats` (una fila por símbolo y fecha, clave `owner_id,symbol,as_of`) y vista `long_history_latest` (última estadística utilizable por símbolo). Migración propuesta, **sin aplicar**: `supabase/migrations/20261108120000_long_history_stats.sql`. Crecimiento ~8.000 filas/semana (~416.000/año, < 100 MB); retención a demanda con el `DELETE` comentado.

### Cómo se une a la fila del escaneo
`projectLongHistoryFields` (única función, en `lib/longHistory.js`) añade **11 campos** `lh*`: `lhAthDistPct, lhAthYearsAgo, lhRet3y, lhRet5y, lhRet10y, lhRetSinceIpo, lhMaxDd5y, lhDownYears10, lhSma200wPos, lhTrendR2, lhTrendSlopeAnn`. `researchRow` y `materializedScanner` llaman al mismo `longHistoryRowPatch(options, symbol)` (un test lo comprueba en los dos archivos). Sin estadística para el símbolo los campos **se omiten** (no viajan como null). El resto de la tabla (ret 1a, pendiente de la SMA, fecha del máximo…) se queda en base de datos, no en el payload.

## 3. Coste

| | Estimación | Base |
|---|---|---|
| Peticiones por ejecución | ≈ 5.600 US + ≈ 760 HK + Europa (**sin cifra**; supongo ~1.500) ≈ **8.000** | [S] universos del encargo; Europa sin medir |
| Tiempo por petición | 0,15–0,30 s | [V] 8 llamadas: AAPL 0,30 s, RDDT 0,16 s, 0700.HK 0,26 s, SHEL.L 0,29 s |
| Tiempo total | ≈ 13 min a concurrencia 3 sin pausa; **≈ 25 min** con los 250 ms de pausa por defecto | [S] |
| Datos descargados | AAPL 1wk 89 KB (45 años), 0700.HK 48 KB, SHEL.L 41 KB, RDDT 4 KB → mediana ~30 KB → **~250 MB por ejecución** | [V] 4 puntos, [S] mediana |
| Filas escritas | ≈ 8.000/semana (tope del script: 10.000) | |
| Muestreo real | 20 símbolos en **3,0 s** (concurrencia 3), 0 fallos | [V] |

Riesgo: Yahoo no documenta límites. El script se detiene con código 4 tras 5 respuestas HTTP 429 seguidas. **[N]** No se ha probado una tirada de miles de peticiones.

## 4. Payload de `/api/scans`

Base medida el 2026-09-13 (`research/scans-payload-1`) y en móvil (`research/movil-2026-11/propuesta.md`, M6): 3.287 filas × 152 campos = 14,2 MB, 2,3 MB gzip.
Añadir los 11 campos **rellenos en todas las filas**, con valores de la muestra y jitter: **+774 KB brutos con 12 campos; con los 11 definitivos ≈ +0,70 MB (+4,9 %)**, y gzip como mucho **+0,12 MB (+5 %)** (cota alta: comprimido en aislado). **[S]** Es una cota: la cobertura real de filas con estadística será < 100 %. **Recomendación:** que `scanLightProjection` NO incluya `lh*` (la lista móvil usa ~20 campos); que solo vayan en la proyección completa o por parche, como `rs-patch`.

## 5. Muestreo de 20 símbolos

Tabla completa: `muestra-20.md` (datos: `muestra-20.json`).

**Verificación independiente [V]:** recalculé en Python, desde el JSON crudo de Yahoo, máximo histórico + fecha, distancia y rendimientos a 1/3/5/10 años para los 20. **Coinciden los 20** (máximo y distancia a la centésima; rendimientos dentro del 0,2 %), con una excepción deliberada: SHEL.L, donde Python usa el *high* sin ajustar de 1997 (6.322; −41 %) y la capa lo descarta (4.110 del 2026-10-26; −9,4 %).

**Comparación con el gráfico MAX de la web [N]:** no la hice. `/api/chart?range=MAX` en :3320 devuelve 401 (requiere sesión) y no quise fabricar una. Por construcción la web usa la misma función `fetchYahooFullHistoryChart`, así que mis barras *son* las del gráfico; lo que falta es contrastar a ojo el máximo y la forma en pantalla. Propongo que el usuario compruebe 3–4: NKE (−76 % del máximo, hace 5 años), SPCE, INTC, PLTR.

Casos del encargo («sube mucho pero viene de años bajistas»), con lo que dicen las métricas:

| Símbolo | Lo que ve la miniatura | Lo que dice el largo plazo |
|---|---|---|
| INTC | +48 % a 1 año, +47 % a 3 | R² 0,09, 3 años bajistas de 10, a −60 % del máximo |
| SMCI | +517 % a 5 años | pero −28 % a 1 año, −77 % del máximo, caída máx. −84 % |
| CVNA | +1.160 % a 3 años | caída máx. 5 años −98,6 %, 5 años +23 % |
| F, BA | repuntes a 1–3 años | 5 de 10 años bajistas, R² 0,04 y 0,11 |
| PLTR | +715 % a 3 años | a −25 % del máximo hace 0,1 años: tendencia fuerte, sin años bajistas recientes (2 de 6) |
| NVDA, GE, AAPL | alcistas | R² 0,84–0,94 con pendiente +17 % a +84 %/año: el patrón «sostenido» |

El patrón que el usuario quiere separar **sí se distingue** con `R² × pendiente > 0`, `down_years_10` y `ath_distance`/`ath_years_ago`. Umbrales concretos: pendiente de diseño de filtros, no los fijo aquí.

Sesgo: la muestra la elegí yo con casos extremos; **no es representativa** de la cobertura. 7 de 20 no tienen 10 años de historia (IPO recientes), por eso `ret_10y` queda null en ellos.

## 6. Tests

`tests/longHistory.test.js`: **34 tests** (series sintéticas) — máximo histórico (pico de hace 8 años, en máximos, precio vivo), horizontes por fecha con huecos, serie de 2 años y IPO reciente sin ceros, años bajistas, caída máxima, media de 200 semanas, R² (limpia vs sucia), el caso estrella sostenido vs sucio, deslistados/vacíos, split no ajustado antiguo vs con evento vs hundimiento real reciente, inicio 1970, `high` absurdo, orden/duplicados, proyección, ida y vuelta a base de datos, coherencia `researchRow`/`materializedScanner`, y el script (dry-run por defecto, exclusión `--write`/`--fetch-only`, cadencia, tope de filas, parada por 429).
**[V]** `npx vitest run` de ese archivo + `researchRow*`, `materializedScan*` + `yahooFullHistoryChart`: **todo en verde** (97 y 67 tests en las dos corridas). **[N]** No he corrido la suite completa del repo ni `npm run test:filters`.

## 7. Archivos

Nuevos: `lib/longHistory.js`, `lib/longHistoryStore.js`, `scripts/long-history.mjs`, `tests/longHistory.test.js`, `supabase/migrations/20261108120000_long_history_stats.sql`, esta carpeta.
Modificados (2 líneas cada uno, sobre un árbol que ya tenía cambios de otros): `lib/researchRow.js` (import + `...longHistoryRowPatch(options, symbol)`), `lib/materializedScanner.js` (ídem).

## 8. Lo que NO está hecho / sin verificar

1. **La fila aún no recibe datos**: nadie rellena `options.longHistoryBySymbol` en `serverScanRunner.js:353` ni en `materializedScanner.js` (~línea 1464). Hace falta leer la tabla (`readLatestLongHistoryMap`) una vez por escaneo y pasarla en `options`. Hasta entonces `lh*` no aparece en ninguna fila.
2. `lib/longHistoryStore.js` no se ha ejecutado: la lectura usa la vista `long_history_latest` con `offset` y `select=*`; **[N]** no he comprobado que `lib/pgPostgrestAdapter.js` (modo pg del Mini) las soporte.
3. `--universe-us` (lee `universe_snapshot_symbols`) y `--write` no se han probado. Para Europa no hay todavía fuente de lista; valen `--list` o `--symbols`.
4. La migración no está aplicada ni probada en una base efímera.
5. `ret_since_ipo` en valores antiguos (AAPL +348.821 %) no es útil para filtrar; si se quiere, añadir CAGR desde la salida a bolsa.
6. Umbral de 12 años para descartar saltos antiguos: heurístico.
7. Aviso ajeno al encargo: hay un directorio basura en la raíz del repo, `cristisedge-sn@100.104.42.10aging/` (copia de `app/`, `lib/`, `tests/`…), probablemente un `scp` mal escrito. No lo he tocado.

## 9. Siguientes pasos que requieren tu OK (no los doy por hechos)

1. Aplicar la migración en el Mini.
2. Un piloto real: `--write --symbols=…` (20–50 símbolos) y luego el lote completo semanal (~25 min, ~8.000 peticiones a Yahoo).
3. Cablear la lectura de la tabla en los dos pipelines y decidir en qué proyección viajan los `lh*`.
4. Interfaz de filtros (la maqueta) — fuera de este encargo.

Comando de prueba sin tocar la base (ya ejecutado para la muestra):

```bash
node --env-file=.env.local --loader ./scripts/loader.mjs scripts/long-history.mjs --fetch-only --symbols=AAPL,NKE,INTC --out=/tmp/lh.json
```
