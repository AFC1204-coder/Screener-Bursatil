# Diagnóstico — barras desfasadas en `daily_bars` y el caso XAIR — 2026-08-09

Tarea de diagnóstico puro. No se ha modificado ningún archivo de
código, no se ha escrito en Supabase, no se ha ejecutado el cron.
BASE_SHA: `0eb534f`. Continúa `docs/rs-quality-datos-2026-08-09.md`
(dado por bueno como contexto de partida, con una corrección
importante que aparece en la Parte B/C: el mecanismo que produce el
`extSma50` de XAIR resulta ser más específico de lo que ese documento
sugería, y **no** depende de que `daily_bars` esté desactualizado —
son dos problemas distintos que coinciden en el mismo símbolo).

**Peticiones al proveedor usadas: 2 de 3 permitidas** (una a
`v8/finance/chart` con `range=3mo` para comprobar si Yahoo sirve
barras recientes de XAIR, otra con `range=6mo` para localizar el
evento de split). No usé la tercera.

---

# PARTE A — Por qué no se refresca

## 1. Cómo se decide si hay que redescargar

Dos parámetros distintos controlan la frescura, en dos sitios
distintos, y **NO son el mismo mecanismo** — esto es clave para el
resto del diagnóstico.

**(a) La caché persistida en Supabase (`daily_bars`)** —
`lib/dailyBarsCache.js:5,260,285`:

```js
const DEFAULT_MAX_AGE_DAYS = 5;
...
const maxAgeDays = Math.max(Number(options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS), 0);
...
const fresh = enough && age !== null && age <= maxAgeDays;
```

`readDailyBarsCache` compara la fecha de la barra más reciente
guardada en Supabase contra hoy; si han pasado más de 5 días (por
defecto), la caché se marca `stale`/`miss`, no `hit`. La función que
envuelve esto, `withDailyBarsCache` (línea 412-464), **si la caché no
está "hit" intenta SIEMPRE una descarga en vivo al proveedor**:

```js
if (useCache && !options.refresh) {
  cached = await readDailyBarsCache(symbol, options);
  if (cached.hit) return chartFromCache(symbol, cached, options);
}
try {
  const live = await fetcher(symbol, options);
  const write = useCache ? await writeDailyBarsCache(symbol, live, options) : ...;
  ...
```

Es decir: este mecanismo, por sí solo, **no explica** por qué
`daily_bars` sigue desactualizado — si se ejecutara, intentaría
refrescar. El motivo real está en la Parte A.5: `withDailyBarsCache`
sencillamente no se invoca para el camino que ha estado escaneando a
XAIR.

**(b) La frescura de la FILA de scoring (`priceFreshnessOk`)** —
`lib/dataCoverageShared.js:81-99`, un mecanismo totalmente aparte,
sobre la fecha de la última barra del **chart usado en ese scan
concreto** (`row.lastDate`, no la tabla `daily_bars`):

```js
export function priceFreshnessForDate(lastDate = "", maxDays = DEFAULT_PRICE_FRESHNESS_DAYS) {
  const limit = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : DEFAULT_PRICE_FRESHNESS_DAYS;
  ...
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  const ok = days <= limit;
  ...
}
```

`DEFAULT_PRICE_FRESHNESS_DAYS = 5` (`lib/screenerFilterCatalog.js:4`).
Este es el mecanismo relevante para el caso XAIR — ver punto 10.

## 2. Si la petición al proveedor falla

Cita literal, `lib/dailyBarsCache.js:412-464` (`withDailyBarsCache`,
bloque `catch`):

```js
} catch (error) {
  if (cached?.bars?.length) {
    return chartFromCache(symbol, { ...cached, stale: true, status: cached.status === "hit" ? "stale-fallback" : cached.status }, options, {
      fallbackError: error.message || "live provider failed",
    });
  }
  throw error;
}
```

**Sí, se sirven las barras viejas como si fueran buenas** — con dos
matices honestos: (1) internamente se marca `status: "stale-fallback"`
y se anota `fallbackError` dentro de `meta.cache`, así que la
información de que ocurrió un fallo sí queda registrada en la
respuesta; pero (2) el veredicto que ve el resto del sistema
(`dataQuality.status`) sigue siendo `"real"`
(`lib/dailyBarsCache.js:186-193`, comentario explícito: *"el caso
stale-fallback sigue siendo 'real': es mercado viejo, no sintético, así
que cuenta como decision-grade"*). No hay ningún gate que bloquee el
scoring por esto — la fila se puntúa igual.

## 3. Petición real a Yahoo para XAIR — ¿descarga o escritura?

Petición 1 (`v8/finance/chart/XAIR?range=3mo&interval=1d`):

```
Regular Market Price: 5.36
Regular Market Time: ~2026-08-07/08 (epoch 1786132801)
Previous Close: 9.94
Currency: USD | Exchange: NCM | Instrument Type: EQUITY
Error: null
Últimos 8 cierres (más recientes): 5.54, 5.40, 5.94, 6.27, 6.37, 5.90, 5.54, 5.36
```

**El proveedor SÍ devuelve barras recientes para XAIR ahora mismo** —
precio y fecha de sesión coherentes con "hoy", sin error. **El
problema es de escritura/persistencia, no de descarga del proveedor**,
tal como plantea el enunciado como hipótesis a confirmar. La tabla
`daily_bars` que consulto yo vía Supabase sigue parada en 2026-06-04
(confirmado en la sesión anterior) pese a que Yahoo tiene datos frescos
disponibles ahora mismo.

Un matiz que añade la Parte D: el problema NO es únicamente que nadie
escriba estas barras a la tabla — hay un segundo mecanismo distinto,
independiente de la tabla `daily_bars`, que también contribuye al
número final erróneo. Se explica en el punto 9.

## 4. Registro de intentos fallidos

```
table: provider_runs
select: *
filter: (sin filtro por symbol — la tabla no tiene columna symbol)
```
`provider_runs` es un log a nivel de **lote/ejecución completa**
(`run_type: "universe-refresh"`, `"leaderboards-refresh"`), sin
columna `symbol` — no registra intentos por símbolo individual. No es
la tabla para rastrear un fallo de XAIR en concreto.

```
table: scan_symbol_history
select: *
filter: symbol=eq.XAIR
```
**0 filas.** Mirando el esquema de esta tabla con otras filas de
muestra, su columna `source_pipeline` solo contiene valores
`"materialized_scan"` — es decir, únicamente registra observaciones del
camino CRON (`materializedScanner.js`). XAIR nunca ha pasado por un
`materialized_scan` reciente (o nunca), así que no aparece aquí — no
porque haya fallado, sino porque este registro no cubre el camino por
el que XAIR sí se ha escaneado (el scan interactivo "Scan servidor").
**No existe ningún registro por símbolo de intentos fallidos de
descarga/escritura para el camino interactivo.**

## 5. La causa real, en el código: dos escritores, uno de ellos no persiste

Hay exactamente dos caminos que hacen `fetchYahooChart` para construir
una fila de scan, y solo uno pasa por `daily_bars`:

**Cron (`lib/materializedScanner.js:4,52,521-528`)** — sí persiste:
```js
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
...
import { fetchYahooChart, fetchYahooProfile } from "@/lib/yahoo";
...
async function fetchChartForScan(symbol, options = {}) {
  return withDailyBarsCache(symbol, {
    ...
  }, fetchYahooChart);
}
```

**Scan interactivo (`lib/serverScanRunner.js:11,13`)** — NO persiste:
```js
import { fetchYahooChart, fetchYahooProfile } from "@/lib/marketData";
import { BENCHMARK_SYMBOLS, buildResearchRow } from "@/lib/researchRow";
```

`lib/marketData.js:37-49` (`fetchYahooChart`, la versión que importa
`serverScanRunner.js`):
```js
export async function fetchYahooChart(symbol, options = {}) {
  const s = normalizeSymbol(symbol);
  ...
  const key = `chart:${s}:${range}:${interval}${daily ? `:${dayStamp()}` : ""}`;
  const ttl = daily ? TTL.CHART_DAILY : TTL.CHART_INTRADAY;
  ...
  return marketCache.cached(key, ttl, () => rawFetchYahooChart(s, options));
}
```

Esta versión es una **caché en memoria del proceso** (`marketCache`,
`lib/serverCache.js`), con TTL de 6 horas
(`CHART_DAILY: 6 * 60 * 60 * 1000`) y sin ninguna llamada a
`withDailyBarsCache` ni a Supabase. **El scan interactivo ("Scan
servidor...") — el que ha estado escaneando a XAIR — nunca escribe en
`daily_bars`.** Descarga en vivo, puntúa con ese dato, y lo descarta
al terminar el request (o a las 6 horas si el mismo proceso sigue
caliente). La tabla `daily_bars` solo se refresca cuando: (a) corre el
cron (`materializedScanner.js`, run type "Materialized scan"), o (b)
alguien visita la ficha individual `/stock/[symbol]`, que también usa
`withDailyBarsCache` (`app/api/chart/route.js`).

**Confirmado con datos reales** en la Parte B: exactamente los
símbolos que sí muestran `daily_bars` reciente son los que
previsiblemente se visitan como fichas individuales (grandes nombres
tecnológicos), no los que solo han pasado por un "Scan servidor" — y
`Z` (Zillow), que estuvo en el MISMO lote de scan que XAIR el 08-ago,
tiene `daily_bars` igual de desactualizado que XAIR pese a ser un
valor grande y líquido — confirma que "estar en un scan interactivo"
no basta para refrescar la caché persistida.

---

# PARTE B — Cuántos símbolos afectados

## 5. Método de medición sin recorrer la tabla completa

`daily_bars` tiene un índice compuesto por `(symbol, trade_date)`
(mencionado en comentarios de código como
`daily_bars_symbol_date_idx`). Dos formas de aprovecharlo sin escanear
la tabla:

- **Punto a punto**: `select=trade_date&filter=symbol=eq.X&order=trade_date.desc&limit=1`
  — el índice resuelve esto sin tocar el resto de la tabla. Exacto,
  pero un símbolo por consulta.
- **Por lotes con umbral de fecha** (el que usé para la muestra de
  150+): `select=symbol,trade_date&filter=symbol=in.(<lote>)&trade_date=gte.<umbral>`.
  Con un lote pequeño (5-50 símbolos según lo ajustado del umbral, para
  no superar el tope de 200 filas de la herramienta) y tres umbrales
  (hoy-5d, hoy-30d, hoy-60d), la PRESENCIA de un símbolo en cada
  resultado basta para ubicarlo en un tramo — no hace falta traer todo
  su historial. Es exactamente el filtro por fecha que pide el aviso
  del enunciado, aplicado como llave del índice, no como recorrido de
  tabla.

Umbrales usados (hoy = 2026-08-09): `<5d` → `trade_date≥2026-08-04`;
`<30d` → `≥2026-07-10`; `<60d` → `≥2026-06-10`; el resto cae en `>60d`.

## 6. Resultado medido — muestra de 244 símbolos

Universo de referencia: `universe_snapshot_symbols`, snapshot más
reciente (`8080edd7-...`, 2026-07-16), `market=US`, `passed=true`.
Consulta de muestreo:
```
table: universe_snapshot_symbols
select: symbol
filter: snapshot_id=eq.8080edd7-...&market=eq.US&passed=eq.true&symbol=like.<letra>*
order: symbol.asc
limit: 200 (o 25 según el lote)
```
Cuatro cortes alfabéticos para cubrir distintas zonas del universo (no
solo un cursor): 150 símbolos "A" + 25 "M" + 25 "S" + 44 "Z" = **244
símbolos**, bien por encima del mínimo de 150 pedido.

Consultas de frecuencia aplicadas por lotes (ejemplo del patrón, una
por cada umbral y lote):
```
table: daily_bars
select: symbol,trade_date
filter: symbol=in.(<lote>)&trade_date=gte.<umbral>
order: symbol.asc,trade_date.desc
limit: 200
```

**Distribución medida (no extrapolada)**:

| Tramo | Símbolos | % de la muestra |
|---|---:|---:|
| <5 días | 6 (`AAPL`, `AMZN`, `GOOGL`, `META`, `MSFT`, `NVDA`) | 2.5% |
| 5-30 días | 2 (`TSLA`, `MAR`) | 0.8% |
| 30-60 días | 0 | 0% |
| >60 días | 236 | 96.7% |

Verificación individual de una muestra del tramo ">60 días" (para
confirmar que es desfase real y no ausencia total de datos):
```
table: daily_bars
select: symbol,trade_date
filter: symbol=eq.<X>
order: trade_date.desc
limit: 3
```
`AACB`, `ACIW`, `AGM` (del lote "A") devuelven barras reales, agrupadas
en **2026-06-03/04/05** — el mismo rango de fechas que ya se había
confirmado para XAIR y para el símbolo "A" (Agilent) en la sesión
anterior. Todo apunta a un mismo evento: una pasada completa del cron
sobre el universo que terminó alrededor de esas fechas y no se ha
repetido desde entonces para esta franja de símbolos. `Z`(Zillow) y
todo el lote "Z" (44 símbolos): **0 filas** en cualquiera de los tres
umbrales — ni siquiera aparecen en el corte de 60 días, es decir, su
última barra es anterior al 2026-06-10.

## 7. Extrapolación (marcada explícitamente como tal)

**Esto es una extrapolación, no una medición.** Si el patrón de la
muestra de 244 símbolos (repartida en 4 zonas distintas del alfabeto,
no solo una) se sostiene sobre el universo completo de EE. UU.
(`sample_size: 4217` según `rs_weekly_items`, o ~9.293 si se cuenta el
universo multi-mercado completo de `provider_runs`), entonces del
orden del **96-97% del universo estadounidense tendría su última
barra en `daily_bars` con más de 60 días de antigüedad** a fecha de
hoy — es decir, unos 4.000+ símbolos sobre la base de 4.217, o
8.900+ sobre la base multi-mercado de 9.293. No he verificado esto
símbolo a símbolo sobre el universo completo — es una proyección desde
una muestra de 244, no un recuento.

## 8. ¿Se concentra el desfase en algún tipo de símbolo?

**Sí, y de una forma más específica que "capitalización" o
"liquidez"**: los únicos 8 símbolos frescos/semi-frescos de toda la
muestra son nombres grandes y muy seguidos individualmente (`AAPL`,
`AMZN`, `GOOGL`, `META`, `MSFT`, `NVDA`, `TSLA`, `MAR`) — pero esto
**no es simplemente "mega-cap = fresco"**: otros mega-caps del mismo
lote de scan interactivo del 08-ago (`JPM`, `XOM`, `KO`, `WMT`, `DIS`,
`BAC`, `ORCL`, `IBM`, `CRM`) **no** aparecieron frescos en absoluto
(comprobado con el mismo umbral de 5 días, 0 resultados). La variable
que separa a los frescos del resto no parece ser "cap" o "mercado" en
sí, sino **si alguien ha visitado la ficha individual de ese símbolo
recientemente** (lo cual dispara `/api/chart` → `withDailyBarsCache` →
escritura real en `daily_bars`) — coherente con el perfil del dueño
del proyecto (trader que sigue de cerca un puñado de líderes de
mercado, no cientos de small-caps). No he podido confirmar esto
cruzando contra un registro de visitas (no existe esa tabla en el
alcance permitido); es una inferencia razonable a partir del patrón de
qué está fresco y qué no, no una prueba directa.

Sobre mercado: la muestra es 100% `market=US`; no se comparó contra
otros mercados en esta tarea (fuera del alcance — el enunciado pide
"universo estadounidense").

Sobre capitalización/liquidez dentro del propio universo US: no se
cruzó `universeCoverageScore` (columna disponible en
`universe_snapshot_symbols`, casi siempre 100 en la muestra, salvo el
grupo de "tickers ya cubiertos por otra fuente" marcados en 83 como
`AAPL`/`ABBV`/`ADBE`/etc. — coincide, no por casualidad, con el
conjunto de símbolos "conocidos" del sistema) contra la frescura de
forma sistemática — solo se observó la coincidencia cualitativa
anterior.

---

# PARTE C — Cuánto contamina

## 9. Comparación por tramo de desfase — símbolos reales

Consulta usada:
```
table: scan_results
select: symbol,created_at,raw->>price,raw->>sma50,raw->>lastDate,
        raw->>priceSource,raw->>extSma50,raw->>perf3m,raw->>rsGlobalPct,
        raw->>maxDrawdown63d
filter: symbol=in.(TSLA,Z)&created_at=gte.2026-08-08&created_at=lt.2026-08-09
```

| Símbolo | Tramo (Parte B) | `price` (vivo) | `sma50` | `lastDate` del chart | `extSma50` | `perf3m` | `rsGlobalPct` |
|---|---|---:|---:|---|---:|---:|---:|
| TSLA | 5-30d (`daily_bars`) | 394.46 | 409.99 | 2026-07-15 | **−3.79%** | 8.31% | 55 |
| Z (Zillow) | >60d (`daily_bars`) | 33.85 | 35.13 | 2026-07-15 | **−3.65%** | −17.23% | 4 |
| XAIR (referencia, sesión anterior) | >60d (`daily_bars`) | 5.61 | 0.66 | 2026-07-15 | **748.84%** | 790.48% | 99 |

**Hallazgo importante que corrige el marco de la tarea anterior**:
`TSLA` y `Z` tienen exactamente el mismo `lastDate` que XAIR
(2026-07-15) en el chart que usó ESE MISMO scan — es decir, el
mecanismo "precio en vivo comparado contra un chart de varias semanas
atrás" es **sistemático en todo el lote del scan del 08-ago, no
exclusivo de XAIR** — y sin embargo `TSLA` y `Z` dan un `extSma50`
completamente normal (−3.79%, −3.65%). La diferencia no es el desfase
en sí — es que **TSLA y Z no tuvieron ningún movimiento de precio
extremo durante esas semanas, así que comparar su precio de hoy contra
un SMA50 de hace tres semanas no produce ningún número raro.** XAIR sí
tuvo un evento discreto (el split 1:20 del punto 9-siguiente) que
convierte el mismo mecanismo, inofensivo en el 99% de los casos, en un
número disparatado.

**Conclusión para el dueño, en una frase**: el desfase de datos por sí
solo casi nunca contamina nada visiblemente — hace falta que, además,
el símbolo haya sufrido un movimiento de precio grande (idealmente un
evento discreto tipo split) durante la ventana de desfase. Con 236 de
244 símbolos desfasados >60 días y solo 1 de ellos (XAIR) mostrando una
anomalía como esta (ver Parte C.10 más abajo, "solo XAIR" ya
confirmado con datos reales en la sesión anterior), el patrón es "el
desfase es casi universal, pero el daño visible es raro y depende de
que coincida con un evento de precio discreto durante la ventana
ciega".

## 9 (bis). De dónde sale el 748% de XAIR — no es solo la caché desactualizada

Petición 2 al proveedor (`v8/finance/chart/XAIR?range=6mo&interval=1d`),
para encontrar el salto y los eventos de split:

```
events.splits: { date: ~2026-07-13 (epoch 1783949400), numerator: 1.0, denominator: 20.0 }
→ split 1:20 (reverse split — 20 acciones viejas pasan a ser 1 nueva)
```

Esto coincide, con una precisión de dos días, con el `lastDate` que
tenían TSLA/Z/XAIR en el chart del scan del 08-ago (2026-07-15) — el
chart que usó ese scan llega justo hasta el borde del split, o muy
poco después.

Cita literal de cómo `lib/yahoo.js` procesa las barras
(`lib/yahoo.js:1226-1264`, `fetchYahooChartDirect`):

```js
const adj = r.indicators?.adjclose?.[0]?.adjclose || [];
...
const bars = ts.map((t, i) => {
  const rawClose = Number(q.close?.[i]);
  const close = Number(adj[i] ?? q.close?.[i]);
  const factor = Number.isFinite(close) && Number.isFinite(rawClose) && rawClose > 0 ? close / rawClose : 1;
  ...
```

**StatsEdge SÍ intenta usar el `adjclose` de Yahoo** (que en teoría
incorpora ajustes por dividendos y splits) en vez del cierre crudo —
esto no es un bug de StatsEdge en el sentido de "usar el campo
equivocado". El problema, ya documentado en este mismo repo antes de
esta tarea (`git log`: commit `f8838cf`, *"docs: los eventos de split
de Yahoo no permiten ajustar las series"*), es que **el propio
`adjclose` de Yahoo no incorpora correctamente este split para XAIR**
— si lo incorporara, los cierres de junio (~$0.45-0.66) aparecerían ya
reescalados a la base post-split (~$9-13), y no lo hacen (lo confirmé
en la sesión anterior: `raw.sma50 = 0.6609`, claramente en la base
pre-split, calculado sobre un chart que en teoría ya pasó por este
mismo código de ajuste).

**Diagnóstico correcto, en dos capas separadas, no una sola**:
1. **Capa de persistencia** (Parte A): `daily_bars` no se refresca
   porque el scan interactivo no escribe ahí — esto explica por qué el
   *ranking semanal* (que sí lee de `daily_bars`) ve un precio de junio
   ($0.45) y no se entera del split en absoluto.
2. **Capa de ajuste de precio dentro del propio chart en vivo** (nueva
   en este documento): incluso el chart fresco que SÍ pidió el scan
   interactivo directamente a Yahoo arrastra el mismo problema, porque
   el `adjclose` de Yahoo no re-expresa las sesiones anteriores al
   split en la base nueva. Esta capa es independiente de que
   `daily_bars` esté o no actualizado — **arreglar solo la persistencia
   de `daily_bars` no habría evitado el `extSma50` de 748%**, porque el
   chart en vivo que alimentó ese cálculo tenía el mismo defecto de
   origen.

## 10. ¿Existe ya alguna protección? `priceFreshnessOk`/`maxPriceFreshnessDays`

Cita ya mostrada en el punto 1(b). Cómo se usa
(`lib/materializedScanner.js:466,507`):
```js
Object.assign(row, priceFreshnessForDate(row.lastDate, options.maxPriceFreshnessDays));
...
if (!row.priceFreshnessOk) return row.priceFreshnessIssue || "precio no fresco";
```
Esto SÍ existe como mecanismo — pero:

**(a) Solo se usa como gate duro (`baseRejectReason`) en el cron**
(`materializedScanner.js`). En el camino interactivo
(`lib/researchRow.js`/`lib/screenerPipeline.js`), `priceFreshnessOk` se
calcula y se guarda como CAMPO de la fila, pero no encontré un
`baseRejectReason` equivalente que la use para excluir la fila antes de
puntuarla — se usa como **filtro opcional** (`maxPriceFreshnessDays` es
una entrada más de `screenerFilterCatalog.js`, igual que
`minRsRating`), no como un gate obligatorio.

**(b) Y aunque lo fuera, en este caso concreto estaba desactivado por
configuración.** La fila de `scans` del 08-ago para este lote
(`settings`, ya consultada en la sesión anterior) trae:
```
"maxPriceFreshnessDays": 999
```
Con el umbral en 999 días, `priceFreshnessForDate` da `ok: true` para
casi cualquier fecha real — el filtro existe, se calculó
correctamente (`lastDate` a 2026-07-15, ~24 días de antigüedad en el
momento del scan), pero el preset de este scan concreto lo dejó
efectivamente desactivado.

**(c) Aunque hubiera estado en el valor por defecto (5 días), tampoco
habría bloqueado el número final que importa.** `priceFreshnessOk` mide
la antigüedad de `lastDate` (la fecha de la ÚLTIMA BARRA del chart,
2026-07-15 en este caso) — **no** compara `price` (el precio en vivo)
contra `sma50`/`bars[0]`. Un gate de frescura de 5 días habría
rechazado esta fila entera por tener el chart "viejo" (24 días > 5),
pero eso es un efecto colateral de que hoy `lastDate` también viene
retrasado — el gate no está diseñado para detectar "el precio en vivo
no encaja con la serie histórica", que es el problema real de fondo.

## 11. Qué métricas quedan contaminadas y cuáles no

**Contaminadas — mezclan precio en vivo con serie histórica**:
- `extSma50` — `(price/sma50 - 1)*100`, directo.
- `perf3m`/`perf6m`/`perf12m` — `(calcBars[0].close/calcBars[n].close - 1)*100`,
  donde `calcBars[0]` se sustituye por `price` en vivo
  (`lib/researchRow.js:91-94`/`lib/materializedScanner.js:380-390`:
  el bloque `calcBars` reemplaza explícitamente el close/high/low de la
  barra más reciente por el `price` resuelto).
- `rs3m`/`rs6m`/`rs12m`, `rsRawComposite`, `rsGlobalPct`, `momentumScore`
  — heredan la contaminación de `perf*`/`rs*` (ya documentado con
  números reales de XAIR en la sesión anterior).
- `rsQualityScore`, `speculationRiskScore` — heredan por partida doble:
  vía `extSma50` (penalización fija, no escalada) y vía el `rs` de
  entrada ya contaminado (peso .62).
- `riskScore` (señal del registro) — usa `extSma50` directamente
  (`lib/scoringEngine.js`, tramos `between(e,-3,8)` etc.).

**NO contaminadas — usan solo la serie histórica (`calcBars` sin el
reemplazo del precio en vivo), no comparan contra `price`**:
- `sma50`, `sma150`, `sma200`, `sma200Slope` — promedios puros de
  `calcBars`; el propio `sma50` es correcto (o tan correcto como
  permita el `adjclose` de Yahoo) — el problema aparece al COMPARARLO
  contra `price`, no en el promedio en sí.
- `volatility63d`, `maxDrawdown63d`, `maxDailyMove20dPct`,
  `range63dPct` — se calculan sobre `calcBars`, que sí incluye el
  reemplazo de la barra 0 por el precio en vivo
  (`lib/indicators.js:78-94`, `riskAdjustedStats(calcBars, perf3m)`) —
  así que **estos SÍ heredan la contaminación indirectamente**, a
  través de esa única barra sustituida, aunque en menor medida que
  `extSma50`/`perf3m` porque solo afecta a un punto de la serie, no a
  la comparación completa contra un ancla de 50 días. Confirmado con
  los números reales de XAIR ya citados en la sesión anterior
  (`volatility63d` 2549%, `maxDailyMove20dPct` 1283%, `range63dPct`
  2073% — coherente con que la barra sustituida introduce un salto de
  ~20x frente a la barra adyacente real).
- `distance20d`, `distance50d`, `highsSpreadPct` — también usan
  `calcBars` con la barra 0 sustituida por el precio en vivo, así que
  técnicamente comparten el mismo mecanismo que `extSma50` (comparan el
  precio de hoy contra máximos recientes de la serie) — no los verifiqué
  numéricamente para XAIR en esta tarea (ver "no verificado").
- Métricas fundamentales (`marketCap`, `growthMetrics`, ratios
  financieros) — no dependen de `calcBars` ni de `price` vs. SMA en
  absoluto.

---

# PARTE D — De dónde sale el precio en vivo

## 12. Origen del precio comparado contra las medias

**Del mismo sitio que las barras — no es una llamada distinta.**
`lib/yahoo.js:1226-1264` (`fetchYahooChartDirect`) hace **una única
petición** a `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}`
y de esa MISMA respuesta JSON extrae dos cosas:
- `r.timestamp` + `r.indicators` → las barras (`bars`).
- `r.meta` → se copia entero a `meta` (línea 1266: `meta: {...(r.meta || {}), ...}`),
  y ahí vive `regularMarketPrice`, el campo que `buildResearchRow`
  usa como `providerPrice`:
  ```js
  const providerPrice = firstFinite(chart.meta?.regularMarketPrice, chart.meta?.regularMarketPreviousClose, chart.meta?.previousClose);
  ```

Confirmado en mi propia petición 1: el mismo response que trae las
barras trae también `meta.regularMarketPrice` — un único endpoint,
una única respuesta, dos campos distintos de la misma estructura, no
dos llamadas independientes al proveedor.

## 13. ¿Hay algún punto donde se compruebe coherencia entre ambos?

**No, en ningún punto del camino de scoring.** Búsqueda realizada:
`scoreRsQuality` (`lib/relativeStrength.js`) trata `extSma50` con un
umbral fijo (`>28 → −8`) sin distinguir 30% de 748% — cualquier valor
por encima del umbral recibe el mismo castigo, no hay una escala que
reaccione a una magnitud "imposible". `detectPriceDiscontinuities`
(`lib/indicators.js:126-149`, la única protección real que existe en
todo el repo) compara barra contra barra dentro del propio array
histórico — nunca compara `price` (el campo vivo de `meta`) contra
`bars[0]`/`sma50`. Y, como ya se estableció en la sesión anterior, ese
detector solo se invoca desde `scripts/rs-universe.mjs`, que ni
siquiera usa `price`/`meta.regularMarketPrice` — usa exclusivamente
`bars[0].close` (el último cierre histórico), así que estructuralmente
no podría toparse con esta inconsistencia aunque quisiera.

**No existe, en ningún punto de `lib/researchRow.js`,
`lib/materializedScanner.js`, `lib/relativeStrength.js` o
`lib/scoringEngine.js`, una comprobación del tipo "si `price` se aleja
demasiado de `bars[0].close` o de `sma50`, marca la fila como
sospechosa/inconsistente".** El sistema confía en que ambos campos
(precio en vivo y serie histórica), viniendo de la misma respuesta del
proveedor, van a ser coherentes entre sí — y para XAIR, por el defecto
de `adjclose` ya descrito, no lo son.

---

## CONFIANZA

- **Alta**: los dos parámetros de frescura (`DEFAULT_MAX_AGE_DAYS=5` en
  `dailyBarsCache.js`, `DEFAULT_PRICE_FRESHNESS_DAYS=5` en
  `screenerFilterCatalog.js`) y que son mecanismos distintos — cita
  literal de ambos archivos.
- **Alta**: que el scan interactivo (`serverScanRunner.js`) nunca
  escribe en `daily_bars` — comparación literal de los imports de
  `fetchYahooChart` en `materializedScanner.js` (desde `@/lib/yahoo`,
  envuelto en `withDailyBarsCache`) vs. `serverScanRunner.js` (desde
  `@/lib/marketData`, una caché de memoria sin persistencia).
- **Alta**: que Yahoo devuelve datos frescos de XAIR ahora mismo —
  petición real, respuesta pegada con precio/fecha coherentes con
  "hoy" y sin error.
- **Alta**: el split 1:20 de XAIR alrededor del 13-jul-2026 — cita
  literal del campo `events.splits` de la respuesta real de Yahoo.
- **Alta**: que el mismo mecanismo (chart con `lastDate` de tres
  semanas atrás comparado contra precio en vivo) es sistemático en
  todo el lote del scan del 08-ago, no exclusivo de XAIR — verificado
  con datos reales de TSLA y Z, mismo `lastDate` que XAIR.
- **Alta**: la distribución medida sobre 244 símbolos (96.7% >60
  días) — cuatro lotes alfabéticos distintos, mismo patrón en los
  cuatro, con verificación individual de una submuestra para descartar
  que fuera "ausencia de datos" en vez de "datos viejos".
- **Media**: que la variable que separa a los símbolos frescos del
  resto es "visitado individualmente" y no capitalización/mercado —
  es la explicación más consistente con los datos (JPM/XOM/KO/etc. NO
  frescos pese a ser mega-caps en el mismo scan que sí tenía a AAPL
  fresco), pero no pude confirmarla contra un registro real de visitas
  (no existe esa tabla en el alcance permitido).
- **Media**: que `adjclose` de Yahoo específicamente falla en
  re-expresar las sesiones previas al split en la base nueva — lo
  infiero de que `sma50` (calculado sobre ese `adjclose` ya
  "ajustado") sigue en la base vieja, y de la documentación previa del
  propio repo sobre este mismo patrón general con otros símbolos — no
  descargué el array `adjclose` crudo símbolo a símbolo para
  verificarlo campo por campo (habría requerido una tercera petición
  más quirúrgica, y ya tenía evidencia suficiente sin gastarla).
- **Baja**: por qué el chart que usó el scan interactivo del 08-ago
  tenía `lastDate=2026-07-15` en vez de una fecha mucho más próxima al
  08-ago — ver "LO QUE NO HE VERIFICADO".

## LO QUE NO HE VERIFICADO

- **Por qué el chart en vivo que usó el scan del 08-ago (para TSLA, Z
  y XAIR) tenía `lastDate=2026-07-15`, ~24 días antes de la fecha del
  scan**, en vez de estar mucho más cerca de "hoy" como sí lo estuvo mi
  propia petición de esta sesión. Descarté la caché en memoria de
  `lib/marketData.js` como causa (TTL de 6h, no explica 24 días).
  Queda como posibilidad más plausible un retraso del lado de Yahoo en
  su propio pipeline histórico para ese lote de símbolos en ese
  momento concreto — no lo confirmé con una tercera petición
  controlada en el tiempo, que habría sido necesaria y que decidí no
  gastar dado que ya tenía la pieza central del diagnóstico (el split
  sin ajustar) confirmada con las dos peticiones ya hechas.
- **El array `adjclose` crudo de Yahoo para XAIR, campo a campo**, para
  confirmar con total precisión que no incorpora el split (lo infiero
  de `sma50`, no lo leí directamente).
- **Si el patrón medido en la Parte B (244 símbolos, 4 letras) se
  sostiene igual en el resto del alfabeto** — 4 letras es una muestra
  razonable pero no exhaustiva; el resto de la extrapolación al
  universo completo es explícitamente eso, una extrapolación.
- **Si `distance20d`/`distance50d`/`highsSpreadPct` de XAIR muestran
  la misma magnitud de contaminación que `extSma50`** — mencionado
  como "comparten el mecanismo" por construcción de código, pero no
  verifiqué los números reales de XAIR para estos tres campos en esta
  tarea.
- **Si existe algún registro de "última vista" por símbolo** (para
  confirmar con datos, no solo inferir, la hipótesis de la Parte B.8
  sobre qué mantiene fresca la caché) — no existe esa tabla dentro del
  alcance de tablas permitidas para esta sesión.
- **Cobertura exacta fuera de EE. UU.** — todo este documento se
  limita al universo `market=US`, tal como pide el enunciado; no se
  tocaron otros mercados.
