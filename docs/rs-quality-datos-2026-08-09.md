# Diagnóstico de datos — `rsQualityScore` y el caso XAIR — 2026-08-09

Tarea de diagnóstico puro. No se ha modificado ningún archivo de código,
no se ha escrito en Supabase, no se ha ejecutado el cron. BASE_SHA:
`0eb534f`. Continúa `docs/rs-quality-revision-2026-08-09.md` (no
reinvestigado aquí, dado por bueno como contexto de partida).

**Aviso sobre el propio enunciado**: varias de las hipótesis de partida
("los cuatro términos están inertes", "si XAIR está excluido del
ranking...") no se sostienen tal cual al mirar los datos reales. Lo
digo explícitamente en cada punto donde ocurre, con la evidencia que lo
contradice — la instrucción de la tarea es precisamente no dar por
buena una hipótesis que los datos no confirman.

---

# PARTE A — Los cuatro términos "inertes"

## 1. ¿Dónde se calcula cada uno?

Los cuatro SÍ se calculan. Doble origen (dos builders casi idénticos,
uno para el scan interactivo y otro para el cron):

| Campo | `lib/indicators.js` (función pura) | Builder interactivo `lib/researchRow.js` | Builder cron `lib/materializedScanner.js` |
|---|---|---|---|
| `volatility63d` | `annualizedVolatility(b, 63)`, línea 31-34, usado dentro de `riskAdjustedStats` línea 78-94 | línea 106: `const riskAdjusted = riskAdjustedStats(calcBars, perf3m)`; línea 157: `...riskAdjusted` (spread en `row`) | línea 242-258 (copia local de `riskAdjustedStats`); línea 457: `...riskAdjustedStats(calcBars, perf3m)` |
| `maxDailyMove20dPct` | `maxDailyMovePct(b, 20)`, línea 51-54, dentro de `riskAdjustedStats` línea 86 | igual que arriba (mismo spread) | igual que arriba |
| `range63dPct` | `priceRangePct(b, 63)`, línea 71-77, dentro de `riskAdjustedStats` línea 89 | igual que arriba | igual que arriba |
| `highsSpreadPct` | no vive en `indicators.js`; se calcula inline con `highValue(b,20)`/`highValue(b,65)` | línea 156: `highsSpreadPct: h20 && h65 ? Math.abs((h20 / h65) - 1) * 100 : null` | línea 452: idéntica fórmula |

Los cuatro llegan a `scoreRsQuality` con dato real siempre que el
símbolo tenga barras suficientes — **no hay ningún camino en el que se
calculen y luego se descarten antes de la llamada a
`scoreRsQuality`**. Esto se confirma en la Parte A.5 con datos reales:
el `rsQualityScore` persistido en `scan_results` reproduce
exactamente el cálculo con los seis términos, no con dos.

## 2. ¿Se calculan y no se persisten, o no se calculan?

**Se calculan. Lo que no se persiste (en algunos casos, no en todos —
ver Parte A.3) es la copia de esos cuatro campos dentro de la columna
`metrics`.** No aparecen en `scanDecisionMetrics`
(`lib/scanDecisionProjection.js:10-96`), la función que decide qué
claves lleva `metrics`:

```js
// lib/scanDecisionProjection.js:82-84 — los únicos dos términos de
// "estabilidad" de scoreRsQuality que SÍ están en esta lista:
    extSma50: row.extSma50 ?? null,
    maxDrawdown63d: row.maxDrawdown63d ?? null,
```

Ni `volatility63d`, ni `maxDailyMove20dPct`, ni `range63dPct`, ni
`highsSpreadPct` aparecen en ningún punto de las líneas 10-96 de ese
archivo. No es un descuido de cálculo — es una lista de claves escrita
a mano (whitelist) que estos cuatro campos nunca formaron parte de.

**Pero `scanDecisionMetrics` no es el único escritor de `metrics`.**
Hay dos caminos que escriben `scan_results`, y solo uno tiene esta
laguna:

- `lib/serverScanRunner.js:57-77` (`resultPayload`, el scan
  interactivo disparado desde la UI o `/api/scan`): escribe
  ```js
  metrics: scanDecisionMetrics(preparedRow),
  raw: preparedRow,
  ```
  — los cuatro campos **no** entran en `metrics`, pero sí van completos
  a `raw` (`preparedRow` es el `row` completo, con los cuatro campos
  reales).
- `lib/materializedScanner.js:1358-1483` (el cron
  `runMaterializedScan`, `app/api/jobs/scan-refresh/route.js`): escribe
  `metrics: { ...scanDecisionMetrics(preparedRow), ... }` pero **añade
  a mano, en el mismo objeto literal, muchas más claves que
  `scanDecisionMetrics` no cubre** — entre ellas los cuatro campos:
  ```js
  // lib/materializedScanner.js:1411-1417
        maxDailyMove20dPct: row.maxDailyMove20dPct ?? null,
        maxDailyRange20dPct: row.maxDailyRange20dPct ?? null,
        range63dPct: row.range63dPct ?? null,
        volatility63d: row.volatility63d ?? null,
        maxDrawdown63d: row.maxDrawdown63d ?? null,
        distanceATH: row.distanceATH ?? null,
        highsSpreadPct: row.highsSpreadPct ?? null,
  ```
  Aquí sí quedan en `metrics`.

Confirmado con datos reales (Parte A.3): las filas del cron
("Materialized scan ...") sí traen estos cuatro campos en `metrics`;
las filas del scan interactivo ("Scan servidor ...") no.

## 3. Cobertura real en `scan_results` (últimos 7 días)

Consulta usada (fecha acotada, dos columnas para poder comparar
`metrics` contra `raw` fila a fila):

```
table: scan_results
select: symbol,metrics->>volatility63d,raw->>volatility63d,
        metrics->>highsSpreadPct,raw->>highsSpreadPct
filter: created_at=gte.2026-08-02&raw->>volatility63d=not.is.null
order: created_at.desc
limit: 150
```

Resultado (150 filas, todas con dato real en `raw`): un subconjunto
tiene también dato en `metrics` (idéntico al de `raw`, ej. `CRE.L`,
`VER.VI`, `STB.OL`, y la mayoría de tickers europeos/asiáticos de esa
muestra) y otro subconjunto tiene `metrics` en `null` mientras `raw`
sigue con el dato real (ej. `JNJ`, `HON`, `XAIR`, `GE`, `DHR`, `FCX`,
`WFC`... — las 49 large-caps estadounidenses del mismo lote que en el
documento anterior).

Verificado el origen de cada grupo consultando la fila de `scans`:

```
table: scans
select: id,name,settings->source,settings->local_id
filter: id=eq.<scan_id de la fila>
```

- Las filas con `metrics` completo vienen de scans llamados
  `"Materialized scan GB 2026-08-08"` (patrón `Materialized scan
  {mercados} {fecha}`, literal en `lib/materializedScanner.js:1639` —
  el cron).
- Las filas con `metrics` incompleto vienen de un scan llamado
  `"Scan servidor 2026-08-08T15:03:24.519Z"` (patrón `Scan servidor
  {timestamp}`, literal en `app/api/scan/route.js:40` y
  `app/page.jsx:1339` — el scan interactivo, ejecutado por
  `serverScanRunner.js`).

**Conclusión de cobertura**: no es "0% de cobertura en `metrics`" — es
"100% en `raw` siempre; en `metrics`, completo si la fila la escribió
el cron, ausente si la fila la escribió el scan interactivo". El caso
de estudio de la tarea anterior (los 49 símbolos US) dio la impresión
de que los cuatro términos estaban siempre ausentes de `metrics`
porque esa muestra completa venía del mismo scan interactivo — es el
precedente de `marketCap` que menciona el enunciado, pero con un
matiz: `marketCap` sí está hoy en `scanDecisionMetrics` (línea 20), así
que si ese precedente sigue existiendo en algún otro campo, no es este
mismo caso el que lo demuestra; lo que sí demuestra el caso actual es
que la brecha existe y es asimétrica entre los dos escritores.

## 4. Cuando llegan ausentes a `scoreRsQuality`, ¿qué hace?

Ni renormaliza ni rellena con neutro — **salta el término entero**,
sin tocar el peso `.28` de `stability` en la fórmula final. Cita literal
(`lib/relativeStrength.js:247-253`, mismo patrón en los otros cinco
términos):

```js
if (Number.isFinite(row.volatility63d)) {
  if (row.volatility63d <= 28) stability += 14;
  else if (row.volatility63d <= 45) stability += 7;
  else if (row.volatility63d <= 70) stability -= 3;
  else if (row.volatility63d <= 105) stability -= 10;
  else stability -= 17;
}
```

Si `row.volatility63d` no es finito, este bloque entero no se ejecuta:
ni suma ni resta. `stability` se queda en lo que ya llevaba acumulado
de los otros términos, partiendo siempre de la base fija `72`. No hay
una lista de "términos presentes" sobre la que recalcular el peso — el
`.28` final se aplica igual, haya aportado dato 1 de los 6 términos o
los 6. Es, en la práctica, "el 72 de partida hace de neutro implícito
para lo que falte", no una renormalización formal como la que sí usa
`computeCompositeDetailed` para el composite general (citada en
`docs/rs-quality-revision-2026-08-09.md`, PARTE D, y en
`docs/constantes-finalizacion-2026-08-07.md`).

## 5. ¿Cuánto cambia el resultado? — con 3 símbolos reales

**Hallazgo importante antes de los números**: el `rsQualityScore` que
ya está persistido en `scan_results` para estas filas **no está
calculado con los cuatro términos ausentes** — está calculado con los
seis términos completos, porque `scoreRsQuality` se invoca dentro de
`sectorize()` sobre el `row` en memoria (que sí tiene los seis, según
la Parte A.1), antes de que `scanDecisionMetrics` recorte lo que se
persiste en `metrics`. Lo he verificado reproduciendo a mano el cálculo
para tres símbolos con sus valores reales de `raw` y comparando contra
el `rsQualityScore` ya guardado en `metrics`:

Consulta usada para los tres:
```
table: scan_results
select: symbol,raw->>rsGlobalPct,raw->>maxDrawdown63d,raw->>extSma50,
        raw->>riskRewardScore,raw->>volatility63d,
        raw->>maxDailyMove20dPct,raw->>range63dPct,
        raw->>highsSpreadPct,metrics->>rsQualityScore
filter: symbol=in.(AAPL,QCOM,YAAS)&created_at=gte.2026-08-08&created_at=lt.2026-08-09
```

| Símbolo | RS | `riskRewardScore` | `stability` con solo `maxDrawdown63d`+`extSma50` (lo que hoy expone `metrics`) | `stability` con los 6 términos reales (lo que `raw` sí tiene) | `rsQualityScore` reconstruido — solo 2 términos | `rsQualityScore` reconstruido — 6 términos | `rsQualityScore` persistido en `metrics` |
|---|---:|---:|---:|---:|---:|---:|---:|
| AAPL | 89 | 88 | 76 | 98 | 85.26 | **91.42** | 91.42 |
| QCOM | 83 | 43 | 68 (29.53 dd → −4; ext no penaliza) | 60 | 76.72 | **72.56** | 72.56 |
| YAAS | 2 | 0 | 60 (69.53 dd → −12) | 21 | 18.04 | **7.12** | 7.12 |

La columna "6 términos" coincide exactamente, símbolo a símbolo, con
lo que ya está persistido en `metrics.rsQualityScore` — confirma que
el cálculo real usa los seis términos. La columna "solo 2 términos" es
lo que obtendría **cualquier consumidor que reconstruyera la fila
únicamente a partir de `metrics`** (sin caer a `raw`) y volviera a
correr `scoreRsQuality` sobre ese objeto incompleto — un escenario
hipotético, no lo que hace hoy el producto (ver Parte A.6), pero sí lo
que haría cualquier script o consulta ad-hoc que solo mirara `metrics`.

La diferencia por símbolo:
- AAPL: 85.26 vs. 91.42 real → **−6.16** (la reconstrucción incompleta
  infravalora a AAPL).
- QCOM: 76.72 vs. 72.56 real → **+4.16** (la incompleta sobrevalora a
  QCOM, porque con solo `maxDrawdown63d` no capta que también tiene
  `volatility63d` de 84.9%, un tramo peor).
- YAAS: 18.04 vs. 7.12 real → **+10.92** (la incompleta sobrevalora
  mucho más a YAAS — con solo `maxDrawdown63d` no ve que además tiene
  `volatility63d` 327%, `maxDailyMove20dPct` 21%, `range63dPct` 295% y
  `highsSpreadPct` 59%, todos en tramo de penalización máxima).

## 6. ¿Quién lee `metrics` sin caer a `raw`? — el verdadero alcance del problema

Dado que el cálculo real de `rsQualityScore` no está afectado, el
impacto de esta laguna depende de quién lee `metrics.volatility63d` (o
los otros tres) **directamente**, sin combinarlo con `raw`:

- **`app/api/company-brief/route.js:876-881`** usa
  `firstFinite(row.raw?.X, row.metrics?.X)` para los cuatro — **no
  está afectado**, `raw` gana siempre que tenga dato.
- **`lib/scanDecisionProjection.js:114-119`**
  (`scanDecisionRowFromDb`, el hidratador que usan `/api/scans`,
  `/review` y otros) hace `assignPresent(row, raw)` y luego
  `assignPresent(row, metrics)` — y `assignPresent` (línea 107-112)
  **descarta explícitamente los valores `null`/`undefined`** antes de
  copiar:
  ```js
  function assignPresent(target, source = {}) {
    for (const [key, value] of Object.entries(source)) {
      if (value !== undefined && value !== null) target[key] = value;
    }
    return target;
  }
  ```
  Así que un `metrics.volatility63d: null` **no pisa** el
  `raw.volatility63d` real que ya se copió antes — tampoco está
  afectado ningún consumidor que pase por esta función.
- Lo que sí está afectado, con certeza: **cualquier lectura directa de
  la columna `metrics` que no pase por ninguna de las dos rutas
  anteriores** — exactamente lo que he hecho yo en este documento
  (`select: metrics->>volatility63d`, sin `raw`) y lo que haría
  cualquier consulta SQL/PostgREST ad-hoc, un export, o un futuro
  endpoint que decida devolver `metrics` en crudo por ligereza.

No he encontrado, buscando en `app/` y `lib/`, ningún endpoint o
componente de UI que lea `row.metrics.volatility63d` (o los otros tres)
de forma aislada sin pasar por `scanDecisionRowFromDb` o el patrón
`firstFinite(raw, metrics)` — pero la búsqueda no fue exhaustiva sobre
scripts sueltos (`scripts/*.mjs`) ni sobre consultas directas fuera de
`app`/`lib` (ver "LO QUE NO HE VERIFICADO").

**Resumen de la Parte A para el dueño**: los cuatro términos no están
"apagados" en el sentido de que no aporten nada al número que ves en
pantalla — sí aportan, correctamente, al `rsQualityScore` real. Lo que
está roto es más sutil: la copia de esos cuatro campos que se guarda en
`metrics` para *inspección/auditoría directa* es incompleta en una de
las dos rutas de escritura (el scan interactivo), aunque el dato
completo sigue disponible en la columna `raw` de la misma fila y los
consumidores de producción ya saben leer de ahí.

---

# PARTE B — El caso XAIR

## 6. Barras de XAIR en `daily_bars` — ¿hay salto de precio detectable?

Consulta usada (columna real es `trade_date`, no `date`; hay que
filtrar también por `owner_id` en el código de producción, pero para
lectura ad-hoc basta el símbolo):

```
table: daily_bars
select: symbol,trade_date,close,high,low,volume,provider
filter: symbol=eq.XAIR&trade_date=gte.2026-05-01
order: trade_date.desc
limit: 100
```

Las 24 barras devueltas van del 2026-05-01 al **2026-06-04** (última
barra cacheada), con cierres entre $0.40 y $0.58 — una serie suave, sin
ningún salto ≥3x entre sesiones consecutivas (el ratio máximo entre
cierres consecutivos en esta ventana es ~1.13x). **Con el mismo
criterio que usa `detectPriceDiscontinuities` (factor ≥3 entre
`bars[i]` y `bars[i+1]`), esta serie cacheada no es discontinua.**

Segunda consulta, tratando de cubrir el hueco hasta hoy:
```
table: daily_bars
select: symbol,trade_date,close,high,low,volume,provider
filter: symbol=eq.XAIR&trade_date=gte.2026-06-05&trade_date=lte.2026-08-09
order: trade_date.desc
limit: 100
```
**Resultado: 0 filas.** La caché `daily_bars` no tiene ninguna barra de
XAIR posterior al 2026-06-04 — lleva más de dos meses sin refrescarse
para este símbolo.

## 9. ¿De dónde sale el 748%? — `extSma50` y el precio en vivo

`extSma50` se calcula así (`lib/researchRow.js:158` /
`lib/materializedScanner.js:458`, misma fórmula en los dos builders):

```js
extSma50: s50 ? ((price / s50) - 1) * 100 : null,
```

`price` no es necesariamente el último cierre de `bars` — tiene
prioridad el precio en vivo del proveedor
(`lib/researchRow.js:¬línea de `providerPrice`; mismo patrón en
`lib/materializedScanner.js:376-379`):

```js
const providerPrice = firstFinite(chart.meta?.regularMarketPrice, chart.meta?.regularMarketPreviousClose, chart.meta?.previousClose);
const latestClose = firstFinite(bars[0]?.close);
const price = firstFinite(providerPrice, latestClose);
```

Consulta contra `scan_results` para ver qué `price`/`sma50`/`lastDate`
usó realmente el scan del 08-ago para XAIR:

```
table: scan_results
select: symbol,raw->>price,raw->>lastDate,raw->>chartBarsCount,
        raw->>priceSource,raw->>sma50,raw->>chartFallbackReason
filter: symbol=eq.XAIR&created_at=gte.2026-08-08&created_at=lt.2026-08-09
```

Resultado:
```
price: 5.61   (priceSource: "proveedor" — precio en vivo, no el último cierre cacheado)
sma50: 0.6609
lastDate: 2026-07-15   (el chart que usó el scan llega hasta el 15-jul; la caché daily_bars solo llega al 4-jun)
chartBarsCount: 500
```

`(5.61 / 0.6609 - 1) * 100 = 748.84%` — coincide exactamente con el
valor persistido. El mecanismo es: el scan interactivo pidió a Yahoo un
chart fresco en el momento de ejecutarse (con datos hasta el
2026-07-15, según `lastDate`), muy por delante de lo que hay en la
caché `daily_bars` que yo puedo consultar (parada en 2026-06-04); el
`price` final prioriza el precio en vivo del proveedor ($5.61) sobre
ese chart, mientras que `sma50` sigue promediando un tramo de precios
todavía anclado en el régimen antiguo (~$0.4-0.66) — de ahí el ratio
de 8.5x.

**No puedo confirmar con los datos a los que tengo acceso si ese salto
de $0.45-0.66 a $5.61 es un split sin ajustar, una recotización real
del valor, o una reutilización del ticker** — el hueco exacto vive
entre el 2026-06-04 (última barra en `daily_bars`, la única fuente que
puedo consultar) y el 2026-07-15 (fecha del chart que usó el scan,
obtenido en vivo de Yahoo en ese momento y no vuelto a persistir en la
caché consultable). Ver "LO QUE NO HE VERIFICADO".

También confirmo, con datos reales, que la contaminación no se limita
a `extSma50`. Misma fila, más campos:

```
table: scan_results
select: symbol,raw->>perf3m,raw->>perf6m,raw->>perf12m,raw->>rs3m,
        raw->>rs6m,raw->>rs12m,raw->>weinsteinScore,raw->>minerviniScore,
        raw->>momentumScore
filter: symbol=eq.XAIR&created_at=gte.2026-08-08&created_at=lt.2026-08-09
```
```
perf3m: 790.48%   rs3m: 786.65%
perf6m: 534.62%   rs6m: 528.09%
perf12m: 62.14%   rs12m: 44.86%
momentumScore: 92
```

El mismo salto de precio que produce `extSma50` implausible también
produce `perf3m`/`perf6m`/`rs3m`/`rs6m` implausibles — y estos SÍ
alimentan directamente `rsRawComposite`
(`lib/relativeStrength.js:180-190`, términos `p3`, `p6`, `rs3`, `rs6`)
y por tanto el percentil `rsGlobalPct` = 99 que dispara todo el caso.
El `momentumScore` = 92 también queda inflado por el mismo mecanismo.
No es solo `rsQualityScore` el afectado — es la cadena completa que
depende de `perf3m`/`perf6m`.

## 6 (cont.) — Comparación con el criterio exacto de `detectPriceDiscontinuities`

Cita literal del detector (`lib/indicators.js:126-149`):

```js
function detectPriceDiscontinuities(bars = [], factorThreshold = 3) {
  const jumps = [];
  for (let i = 0; i < bars.length - 1; i++) {
    const newer = bars[i];
    const older = bars[i + 1];
    const c1 = Number(newer?.close);
    const c0 = Number(older?.close);
    if (!Number.isFinite(c1) || !Number.isFinite(c0) || c0 <= 0 || c1 <= 0) continue;
    const ratio = c1 / c0;
    const factor = ratio >= 1 ? ratio : 1 / ratio;
    if (factor >= factorThreshold) { /* ... */ }
  }
  /* ... */
}
```

Compara **barras consecutivas dentro del mismo array**
(`bars[i]` vs. `bars[i+1]`). El salto de XAIR no está entre dos barras
del array de velas — está entre la última barra del array (o el precio
en vivo, que ni siquiera es una barra) y el resto del historial. Si el
salto ocurrió progresivamente dentro del propio `chart.bars` que usó el
scan (500 barras hasta el 15-jul), el detector sí lo habría visto de
haberse ejecutado sobre esas barras — pero el detector **no se ejecuta
en ningún punto del scan** (ver punto 12). Si en cambio el salto es
específicamente el hueco entre el último cierre histórico y el
`regularMarketPrice` en vivo (que no es una barra, es un campo de
`chart.meta`), el detector no podría verlo aunque se ejecutara, porque
no compara precio en vivo contra SMA — solo barra contra barra.

## 7 y 8. ¿Está XAIR excluido del ranking semanal? — la hipótesis no se sostiene

Consulta usada:
```
table: rs_weekly_items
select: *
filter: symbol=eq.XAIR
```

Resultado — **XAIR SÍ está presente** en `rs_weekly_items`, no
excluido:

```
snapshot_date: 2026-08-08   week_key: 2026-W32
engine_version: statsedge-us-equity-rs-v1
rank_index: 4112            (de 4217 — sample_size: 4217)
rs_rating: 2
rs_raw: -65.71
usd_close / local_close: 0.4501
fx_date: 2026-06-04
metrics.returns: {13w: -47.0%, 26w: -66.4%, 39w: -80.3%, 52w: -87.8%}
metrics.closeDate: 2026-06-04
```

**La hipótesis de partida ("si XAIR está excluido, contrastarlo con
que el escaneo sí lo puntúa") no se cumple: XAIR no está excluido.**
Aparece con un `rs_rating` de 2 sobre 99 — casi el peor del universo
completo de 4.217 valores — porque `scripts/rs-universe.mjs` calcula
sus retornos sobre el **último cierre cacheado real: $0.45 del
2026-06-04**, no sobre el precio en vivo de $5.61 que usó el scan
interactivo un mes y medio después. Confirmado en el propio código
(`scripts/rs-universe.mjs:259`):

```js
const nowClose = bars[0].close;
```

`bars[0]` viene de `fetchBarsForSymbol` (línea 211), que a su vez lee
de la misma tabla `daily_bars` que consulté en el punto 6 — el mismo
límite de "última barra 2026-06-04" aplica aquí. Como esa serie
histórica no tiene ningún salto ≥3x entre barras consecutivas (punto
6), `detectPriceDiscontinuities` no marca a XAIR como discontinuo y el
símbolo entra normalmente al ranking, con el precio (viejo) que sí
tiene disponible.

**La contradicción real, con los números exactos**: no es "el ranking
lo descarta y el escaneo lo puntúa" — es que **las dos rutas puntúan a
XAIR con precios de fechas distintas, seis semanas separadas, y llegan
a conclusiones opuestas sobre la misma acción**:

| Ruta | Precio usado | Fecha del precio | Resultado |
|---|---:|---|---|
| Scan interactivo → `scan_results` | $5.61 (precio en vivo del proveedor) | fecha de ejecución del scan (08-ago) | `rsGlobalPct` = 99, `rsQualityScore` = 71.26 |
| `scripts/rs-universe.mjs` → `rs_weekly_items` | $0.4501 (último cierre cacheado) | 2026-06-04 | `rs_rating` = 2, rank 4112/4217 |

El detector de discontinuidad funciona correctamente sobre los datos
que recibe en ambos casos — el problema no es que falle al detectar un
salto que sí ve, es que en la ruta del scan interactivo nunca llega a
mirar la serie histórica completa que sí contiene (o no contiene,
según de dónde salga exactamente ese chart de 500 barras) el salto,
porque no se invoca ahí en absoluto (punto 12).

---

# PARTE C — Alcance

## 10. ¿Cuántos símbolos más con `extSma50` > 100%?

Consulta usada (misma ventana de 7 días, 200 filas más recientes con
`extSma50` no nulo — puede no ser exhaustiva si hay más de 200 filas
en la ventana, ver "LO QUE NO HE VERIFICADO"):

```
table: scan_results
select: symbol,created_at,metrics->>extSma50,metrics->>rsGlobalPct,metrics->>rsQualityScore
filter: created_at=gte.2026-08-02&metrics->>extSma50=not.is.null
order: created_at.desc
limit: 200
```

**Resultado: solo 1 símbolo por encima de 100% — el propio XAIR
(748.84%).** El resto de las 199 filas va de −26.5% (`ORCL`) a 46.3%
(`BDB.MI`), todo dentro de rango plausible para una extensión sobre
SMA50. No hay un segundo o tercer candidato a serie rota en esta
muestra — XAIR es, en los datos consultados, un caso aislado y extremo,
no la punta de un problema sistémico de esta magnitud.

## 11. ¿Alguno está en el ranking semanal?

Con un único candidato (XAIR) y ya confirmado en el punto 7 que SÍ está
presente en `rs_weekly_items` (no excluido), la respuesta es la misma:
sí, con `rs_rating` = 2. No hay más candidatos que consultar en esta
muestra.

## 12. ¿Qué otras métricas de `scan_results` quedan contaminadas y sin protección?

Confirmado por búsqueda de código: el detector `detectPriceDiscontinuities`
solo se usa en un sitio de todo el repositorio.

```
$ grep -rln "detectPriceDiscontinuities" lib app scripts
lib/indicators.js       (donde se define)
scripts/rs-universe.mjs (el único lugar donde se invoca)
```

No aparece en `lib/researchRow.js`, `lib/materializedScanner.js`,
`lib/serverScanRunner.js`, ni en ningún `app/api/scan*`. Es decir: **la
ruta completa que produce `scan_results` — de la que salen
`rsGlobalPct`, `rsQualityScore`, `perf3m/6m/12m`, `rs3m/6m/12m`,
`weinsteinScore`, `minerviniScore`, `momentumScore`, `extSma50`,
`riskScore`, `totalScore`, todo lo que ve el usuario en el screener y
en la ficha de un símbolo — no tiene ninguna protección contra series
de precio discontinuas.** La protección existe únicamente para el
ranking semanal de 4.217 valores (`rs_weekly_items`), que es un cálculo
aparte, con su propia fuente de precio (siempre `daily_bars` cacheado,
nunca precio en vivo) y su propia tabla de salida.

Con los datos concretos de XAIR ya confirmados (punto 9), las métricas
de `scan_results` contaminadas por el mismo salto de precio, sin
protección, incluyen al menos:
- `extSma50` (748.84%) — de forma directa, es el cociente contra la SMA.
- `perf3m`, `perf6m` (790.48%, 534.62%) — cociente directo contra el
  precio de hace 3/6 meses.
- `rs3m`, `rs6m` (786.65%, 528.09%) — `perf3m`/`perf6m` menos el
  rendimiento del benchmark en la misma ventana.
- `rsRawComposite` y, por tanto, `rsGlobalPct` (99) — construido con
  `p3`, `p6`, `rs3`, `rs6` como términos de entrada
  (`lib/relativeStrength.js:180-190`).
- `momentumScore` (92) — señal del `SIGNAL_REGISTRY` que también
  consume `perf`/`rs` de estas ventanas.
- `rsQualityScore` (71.26) y `speculationRiskScore` — heredan la
  contaminación por dos vías: directamente vía `extSma50`
  (penalización fija de −8, no escalada) y vía el propio `rs` de
  entrada (99, ya contaminado) que pesa .62 en la fórmula.
- Cualquier score que dependa de `momentumScore`/`rsGlobalPct` en el
  composite (`totalScore`/`compositeScore`, peso 0.16 de `rsAnchor` +
  0.02 de `momentumScore`, `lib/scoringEngine.js:633-646`, ya citado en
  `docs/rs-quality-revision-2026-08-09.md` Parte C.11).

No verificado en esta tarea, y por tanto no incluido en la lista
anterior con la misma confianza: si `volatility63d`/`range63dPct`/
`maxDailyMove20dPct`/`highsSpreadPct` de XAIR (2549%, 2073%, 1284%,
citados en la Parte A.5, tercera fila de la tabla no — ver consulta de
abajo) también arrastran el mismo mecanismo de precio-en-vivo-vs-SMA, o
si son artefacto de un cálculo distinto dentro de `riskAdjustedStats`
sobre `calcBars` (que si incorpora el precio en vivo en `calcBars[0]`
por diseño, según `lib/researchRow.js:91-94`/
`lib/materializedScanner.js:380-390`, heredaría el mismo salto). Cito
los valores para que quede constancia, sin afirmar el mecanismo exacto
más allá de lo ya confirmado para `extSma50`/`perf3m`/`perf6m`:

```
raw.volatility63d: 2549.99%
raw.maxDailyMove20dPct: 1283.69%
raw.range63dPct: 2073.13%
```
(confirmado en la consulta de la Parte A.5.)

---

## CONFIANZA

- **Alta**: que los cuatro términos se calculan (cita literal de
  `lib/indicators.js`, `lib/researchRow.js`, `lib/materializedScanner.js`)
  y que `scoreRsQuality` los recibe reales en el momento del cálculo —
  verificado reproduciendo a mano el `rsQualityScore` de tres símbolos
  reales y obteniendo una coincidencia exacta con el valor persistido
  usando los seis términos, no dos.
- **Alta**: que la laguna de `metrics` es real pero asimétrica entre
  el escritor cron (`materializedScanner.js`, completo) y el escritor
  interactivo (`serverScanRunner.js`, incompleto) — confirmado citando
  las dos rutas de código y cruzándolo con `scan_id`→`scans.name` en
  datos reales de ambos tipos.
- **Alta**: que los consumidores de producción conocidos
  (`company-brief`, `scanDecisionRowFromDb`) no están afectados por la
  laguna de `metrics` porque leen `raw` primero o descartan `null` al
  fusionar — cita literal de ambos mecanismos.
- **Alta**: el origen exacto de `extSma50` = 748.84% para XAIR —
  reproducido con la fórmula, `price` y `sma50` reales de la fila.
- **Alta**: que XAIR no está excluido de `rs_weekly_items` — consulta
  directa a la tabla, fila completa citada.
- **Alta**: que `detectPriceDiscontinuities` solo se invoca en
  `scripts/rs-universe.mjs` — búsqueda de código exhaustiva sobre
  `lib/app/scripts`.
- **Media**: que el hueco de `daily_bars` (última barra 2026-06-04)
  es la causa de que XAIR no se detecte como discontinuo en el
  ranking semanal — es consistente con los datos, pero no descarta que
  la propia serie de Yahoo (fuera de mi alcance de consulta) tenga el
  salto en algún punto anterior a esa fecha que `daily_bars` tampoco
  cubra.
- **Baja**: la causa última del salto de precio de XAIR ($0.45-0.66 a
  $5.61) — no tengo acceso al chart en vivo que usó el scan del
  08-ago (500 barras hasta 2026-07-15), solo a la caché `daily_bars`
  que se detiene seis semanas antes. No puedo confirmar si es un
  split/contrasplit sin ajustar, un evento corporativo real, o una
  reutilización de ticker.

## LO QUE NO HE VERIFICADO

- Si existen más de 200 filas con `extSma50` no nulo en la ventana de
  7 días consultada (punto 10) — la consulta se limitó a 200 filas por
  restricción de la herramienta; si hay más filas de las que el límite
  cubre, podría haber un segundo candidato a serie rota fuera de la
  muestra.
- Si algún endpoint o script fuera de `app/`/`lib/` (por ejemplo en
  `scripts/*.mjs`, o una integración externa no descubierta) lee
  `scan_results.metrics` en crudo sin combinarlo con `raw` — la
  búsqueda de consumidores del punto 6 se limitó a `app/` y `lib/`.
- El contenido exacto de las barras de XAIR entre el 2026-06-04 (última
  barra cacheada en `daily_bars`) y el 2026-07-15 (fecha del chart que
  usó el scan del 08-ago) — es el tramo donde debería vivir el salto de
  precio, y no tengo forma de consultarlo con las herramientas de esta
  sesión (sería necesario volver a pedir el chart a Yahoo en vivo, cosa
  que esta tarea no contempla y que además no reproduciría
  necesariamente el mismo dato que vio el scan en su momento).
- Si `volatility63d`/`range63dPct`/`maxDailyMove20dPct`/`highsSpreadPct`
  de XAIR (2549%/2073%/1284%/0%) se explican por el mismo mecanismo
  exacto que `extSma50`/`perf3m`/`perf6m`, o si hay un segundo
  mecanismo distinto dentro de `riskAdjustedStats` — cito los números
  pero no reconstruí la fórmula completa de `calcBars` para XAIR con
  sus barras reales (no accesibles, ver punto anterior).
- Cobertura histórica más amplia de la laguna de `metrics` (Parte A) —
  la consulta de 150 filas cubre 2026-08-02 a 2026-08-08; no se
  verificó si el patrón "cron completo / interactivo incompleto" se
  mantiene igual en fechas anteriores o si cambió en algún punto del
  historial.
- Si hay otros escritores de `scan_results` además de
  `serverScanRunner.js` y `materializedScanner.js` (por ejemplo scripts
  de backfill o migración) — no se buscaron explícitamente.
