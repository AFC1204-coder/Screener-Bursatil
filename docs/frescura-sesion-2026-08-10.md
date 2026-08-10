# ¿Se sostiene el criterio de "última sesión de mercado"? — verificación de supuestos

<!-- fecha interna: 2026-08-10 · BASE_SHA: c896b20 · rama: codex/statsedge-ui-polish -->

Documento de **solo verificación**. No se modificó ningún archivo de código,
no se escribió en Supabase, no se ejecutó el script ni el workflow.

---

## Resumen para el dueño (sin jerga)

**El diagnóstico es correcto, pero se queda corto: arregla los lunes y no
arregla los martes.**

Lo que sí se confirma: las barras son del viernes 7 de agosto, hoy es lunes
10, y el criterio actual cuenta días de calendario, así que da todo por
caducado aunque esté perfectamente al día.

Lo que el diagnóstico no ve: **el problema no ocurre solo los lunes,
ocurre todas las noches.** El criterio actual da por caducado lo que tiene
un solo día de antigüedad. Un martes por la noche, con los datos del lunes
recién guardados, el guardián volvería a contar 5.605 de 5.605 y volvería a
abortar. El fin de semana solo lo hace más evidente.

Y hay algo más grave, que es la razón por la que el diseño propuesto **no
resuelve el problema de fondo**: la tarea del refresco nocturno es,
precisamente, traerse la sesión que todavía no está en la base. Así que
cualquier criterio que identifique bien "le falta la última sesión" va a
marcar el universo entero todas las noches laborables — porque es verdad,
le falta. El guardián está midiendo la cosa equivocada: no debería contar
"cuántos símbolos necesitan actualizarse" (que son todos, por diseño), sino
"cuántos necesitan una descarga completa desde cero", que es lo que tumbó la
instancia.

Sobre el ancla para saber cuál fue la última sesión: **usar SPY es
peligroso y está demostrado**. SPY no forma parte del universo que el script
refresca, y sus dos compañeros de benchmark (QQQ y ACWI) llevan dos sesiones
atrasados ahora mismo. Si el ancla se atrasa, el sistema decide que todo
está fresco y deja de refrescar para siempre, en silencio.

Además apareció un dato inesperado: **hay barras con fecha de sábado en la
base** (SPY y FTNT tienen una fechada el sábado 1 de agosto, con el cierre
copiado del viernes). Eso envenena la alternativa de "coger la fecha máxima
de la tabla".

---

## SUPUESTO 1 — El diagnóstico es correcto

### Veredicto: **CONFIRMADO, PERO INCOMPLETO**

#### 1.1 · Las fechas de una muestra de 10 símbolos líquidos

Consulta exacta (MCP `supabase_query`):

```
table:  daily_bars
select: symbol,trade_date
filter: symbol=in.(AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,JPM,XOM,JNJ)&trade_date=gte.2026-08-05
order:  trade_date.desc
limit:  100
```

Los 10 símbolos tienen barra del **2026-08-07**, y ninguno tiene nada
posterior. La respuesta trae exactamente las mismas 10 empresas para
2026-08-07, 2026-08-06 y 2026-08-05 — series continuas, sin huecos.

**No hay variedad: los 10 coinciden en el 7 de agosto.**

#### 1.2 · Y no hay nada más reciente en toda la tabla

```
table:  daily_bars
select: symbol,trade_date,close,updated_at
filter: trade_date=gte.2026-08-08
limit:  200
```

Resultado: **`[]`** — cero filas. No existe ninguna barra posterior al 7 de
agosto, de ningún símbolo ni de ningún mercado.

#### 1.3 · Los días de la semana

```bash
for d in 2026-08-06 2026-08-07 2026-08-08 2026-08-09 2026-08-10; do
  date -j -f "%Y-%m-%d" "$d" "+%A"; done
```

```
2026-08-06 Thursday
2026-08-07 Friday
2026-08-08 Saturday
2026-08-09 Sunday
2026-08-10 Monday
```

Confirmado: el 7 fue viernes, el 8 y 9 fin de semana, hoy lunes 10.

#### 1.4 · Por qué el diagnóstico se queda corto

El criterio actual, cita literal de
[`scripts/refresh-bars.mjs:292`](../scripts/refresh-bars.mjs#L292):

```js
  return withAge.filter((row) => row.ageDays >= args.staleDays);
```

Y la antigüedad, cita literal de
[`scripts/refresh-bars.mjs:251-256`](../scripts/refresh-bars.mjs#L251):

```js
function ageDaysFrom(dateStr) {
  if (!dateStr) return Infinity; // nunca descargado: el caso más urgente.
  const ms = Date.parse(`${dateStr}T00:00:00Z`);
  if (!Number.isFinite(ms)) return Infinity;
  return Math.max(0, Math.floor((Date.now() - ms) / 86400000));
}
```

Con `--stale-days=1`, **una barra de ayer ya cuenta como caducada**
(`ageDays = 1`, y `1 >= 1` es verdadero). El fin de semana no es la causa
raíz: solo eleva la antigüedad de 1 a 3 días. Un martes cualquiera, con los
datos del lunes recién guardados, el guardián contaría igualmente 5.605 de
5.605 y abortaría.

**Además, ese `>=` contradice al resto del sistema.** La caché usa el
criterio opuesto en el límite, cita literal de
[`lib/dailyBarsCache.js:285`](../lib/dailyBarsCache.js#L285):

```js
    const fresh = enough && age !== null && age <= maxAgeDays;
```

Con el mismo umbral de 1 día: para la caché una barra de 1 día es **fresca**
(`1 <= 1`); para el guardián es **caducada** (`1 >= 1`). El guardián aborta
por símbolos que el camino de escritura habría saltado sin descargar nada.

**Implicación**: hay dos defectos, no uno. El de calendario (que el diseño
propuesto sí arregla) y este error de límite `>=` / `<=` (que el diseño
propuesto no toca).

---

## SUPUESTO 2 — Se puede saber cuál fue la última sesión

### Veredicto: **REFUTADO** (para la vía de SPY) · **VIABLE CON RESERVAS** (para el máximo de la tabla)

#### 2.1 · ¿Está SPY en `daily_bars`? Sí, y persiste

```
table:  daily_bars
select: symbol,trade_date,close,provider,updated_at
filter: symbol=in.(SPY,QQQ,ACWI)&trade_date=gte.2026-07-25
order:  trade_date.desc
limit:  60
```

SPY sí está persistido, con barra del **2026-08-07** (`close` 773,26,
`updated_at` 2026-08-09T14:05:16Z). La persistencia es esperable: los
benchmarks pasan por la misma caché que escribe. Cita literal de
[`lib/materializedScanner.js:539-550`](../lib/materializedScanner.js#L539):

```js
async function hydrateBenchmarks(options = {}) {
  const symbols = ["SPY", "QQQ", "ACWI"];
  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      const chart = await fetchChartForScan(symbol, options);
```

`fetchChartForScan` usa `withDailyBarsCache`, que escribe al descargar.

#### 2.2 · Pero sus compañeros están atrasados — la prueba de que el ancla puede congelarse

De la **misma** consulta, las fechas más recientes de cada uno:

| Símbolo | Última barra | `updated_at` |
|---|---|---|
| SPY | **2026-08-07** | 2026-08-09T14:05:16Z |
| QQQ | **2026-08-05** | 2026-08-05T22:41:20Z |
| ACWI | **2026-08-05** | 2026-08-05T22:41:20Z |

QQQ y ACWI llevan **dos sesiones de retraso** (les faltan el 6 y el 7), y no
se han tocado desde el 5 de agosto. Se hidratan en el mismo trío que SPY, con
el mismo código. Que SPY esté más fresco es un accidente: algo lo refrescó el
día 9 a las 14:05 UTC, fuera de esa hidratación.

#### 2.3 · Y SPY no está en el universo que el script refresca

```
table:  universe_snapshot_symbols
select: symbol,name,market,instrument_type,passed
filter: snapshot_id=eq.df7e3961-f044-4bf3-9a1a-8a66f0baae5a&symbol=in.(SPY,QQQ,ACWI,FTNT)
limit:  10
```

Resultado: **una sola fila, FTNT**. SPY, QQQ y ACWI **no están** en la
instantánea de universo.

`refresh-bars.mjs` construye su población desde esa instantánea, así que
**nunca refresca SPY**. Su frescura depende de que la hidratación de
benchmarks del cron decida bajarlo, y esa hidratación solo baja cuando la
barra tiene más de 5 días (`maxPriceFreshnessDays: 5` en el cron).

#### 2.4 · El riesgo del punto 6 es real y está demostrado

Si el ancla fuera SPY y SPY se quedara atrasado como QQQ y ACWI:

- el ancla diría "la última sesión fue el 5 de agosto";
- todos los símbolos tienen barra del 5 de agosto (o posterior), así que
  **ninguno se consideraría caducado**;
- no se refrescaría nada, incluido SPY, que no está en la población;
- el ancla nunca avanzaría. **Bloqueo permanente y silencioso.**

Es la dirección de fallo peligrosa: no "refresca de más" sino "deja de
refrescar y nadie se entera". QQQ y ACWI son la prueba de que ese estado
ocurre de verdad en este sistema, no es teórico.

**Conclusión: anclar en SPY queda REFUTADO.**

#### 2.5 · La alternativa del máximo de la tabla: funciona hoy, pero es envenenable

La consulta funciona y no da timeout:

```
table:  daily_bars
select: trade_date,symbol
order:  trade_date.desc
limit:  3
```

```json
[{"trade_date":"2026-08-07","symbol":"SHBI"},
 {"trade_date":"2026-08-07","symbol":"GROY"},
 {"trade_date":"2026-08-07","symbol":"XMTR"}]
```

Máximo = 2026-08-07, correcto. **Pero la tabla contiene barras con fecha de
fin de semana:**

```
table:  daily_bars
select: symbol,trade_date,close,updated_at
filter: trade_date=eq.2026-08-01
limit:  200
```

```json
[{"symbol":"SPY","trade_date":"2026-08-01","close":773.260009765625,
  "updated_at":"2026-08-09T14:05:16.659+00:00"},
 {"symbol":"FTNT","trade_date":"2026-08-01","close":159.63999938964844,
  "updated_at":"2026-08-08T23:58:51.457+00:00"}]
```

El **1 de agosto de 2026 es sábado** (verificado con `date` arriba). Y el
cierre de esas barras de sábado es **idéntico al del viernes 7**:

- SPY: sábado 1 = 773,26 · viernes 7 = 773,26
- FTNT: sábado 1 = 159,64 · viernes 7 = 159,64 (consulta
  `symbol=eq.FTNT&trade_date=gte.2026-07-29`, orden `trade_date.desc`)

Las dos se escribieron **durante un fin de semana** (sábado 8 a las 23:58
UTC y domingo 9 a las 14:05 UTC). Es decir: cuando alguien pide datos en fin
de semana, en algún caso se guarda el último cierre real con una fecha de
sábado equivocada.

No es sistemático — otros fines de semana están limpios:

```
table:  daily_bars
select: symbol,trade_date,updated_at
filter: trade_date=in.(2026-07-18,2026-07-19,2026-07-25,2026-07-26,2026-08-08,2026-08-09)
limit:  200
```

Resultado: **`[]`**, cero filas.

**Pero el mecanismo existe.** Si una de esas barras espurias cayera alguna
vez en una fecha *posterior* a la última sesión real (un sábado 8, por
ejemplo), el máximo de la tabla sería esa fecha, ningún símbolo tendría barra
de ella, y el resultado sería exactamente el aborto de 5.605 de 5.605 que se
quiere arreglar — el mismo fallo, movido de sitio.

---

## SUPUESTO 3 — La consulta agrupada es viable

### Veredicto: **CONFIRMADO, CON UNA CORRECCIÓN AL DISEÑO**

#### 3.1 · Sí se puede pedir los símbolos de una fecha en una consulta

```
table:  daily_bars
select: symbol
filter: trade_date=eq.2026-08-07
order:  symbol.asc
limit:  200
```

Funciona, responde rápido y devuelve 200 filas (topadas por mi herramienta).
Empieza en índices (`^AEX`, `^GSPC`, `^N225`…) y sigue por símbolos de todos
los mercados (`4063.T`, `AGAT.CO`, `ABI.BR`, `ACE.ST`) además de los
estadounidenses.

#### 3.2 · Cuántas filas: 5.822 exactas, en 352 ms

El tope de 200 es de **mi servidor MCP**, no de la base ni del script. Para
obtener la cifra real hice una petición GET de solo lectura con
`Prefer: count=exact` y `Range: 0-0`, que devuelve el conteo sin transferir
las filas:

```bash
node --env-file=.env.local -e '
  const res = await fetch(
    `${url}/rest/v1/daily_bars?owner_id=eq.personal&trade_date=eq.2026-08-07&select=symbol`,
    { headers: { apikey: key, Authorization: `Bearer ${key}`,
                 Prefer: "count=exact", Range: "0-0" } });
  console.log(res.headers.get("content-range"));
'
```

```
Barras del 2026-08-07 (todas): HTTP 206 | content-range=0-0/5822 | 352 ms
```

**5.822 filas, 352 ms.**

#### 3.3 · Pero NO cabe en una sola consulta: PostgREST tope 1.000

```bash
# sin paginar
HTTP 200 | filas devueltas en UNA peticion sin paginar: 1000 | 486 ms
content-range: 0-999/*
# forzando limit=10000
Con limit=10000 explicito: 1000 filas | 170 ms
```

PostgREST corta en **1.000 filas por petición** y `limit=10000` no lo
levanta. Así que el diseño necesita **6 peticiones paginadas** (5.822 ÷ 1.000
= 5,8), no una. A 170-490 ms cada una, son unos **2-3 segundos en total**.

El script ya sabe paginar así — cita literal de
[`scripts/refresh-bars.mjs:200`](../scripts/refresh-bars.mjs#L200), en
`fetchUniverseRows`:

```js
  const pageSize = 1000;
```

**Comparación**: hoy son 5.605 consultas individuales que tardan unos cuatro
minutos. Con la vía agrupada son 6 consultas y unos 3 segundos — unas **80
veces menos tiempo**. La mejora es real; solo hay que decir "seis consultas",
no "una".

---

## SUPUESTO 4 — No hay nada más que se me escape

### Veredicto: **CONFIRMADO** — el caso existe, está medido, y es pequeño

#### 4.1 · Método: un tramo alfabético completo, sin extrapolar a ojo

Comparé el universo estadounidense contra las barras del 7 de agosto en el
tramo alfabético `[A, AGN)`, que la consulta de §3.1 cubre **entera** (los
200 resultados llegaron hasta `AGN.AS`, así que todo lo anterior está
incluido).

Universo:

```
table:  universe_snapshot_symbols
select: symbol,name,instrument_type
filter: snapshot_id=eq.df7e3961-f044-4bf3-9a1a-8a66f0baae5a&market=eq.US&passed=eq.true&symbol=gte.A&symbol=lt.AGN
order:  symbol.asc
limit:  200
```

(La instantánea vigente se obtuvo con `universe_snapshot_symbols`,
`market=eq.US`, `order=created_at.desc`, `limit=1` →
`df7e3961-f044-4bf3-9a1a-8a66f0baae5a`, creada 2026-08-09T21:56:26Z.)

Al diff le apliqué el mismo filtro de fondos cerrados que usa el script
(`CLOSED_END_FUND_NAME_PATTERN`):

```
Universo US bruto en tramo [A, AGN): 153
Excluidos por patron de fondo cerrado: 5 -> ACP, ADX, AEF, AFB, AGD
Poblacion que refresh-bars procesaria: 148
Con barra del 2026-08-07: 146
SIN barra del 2026-08-07: 2 ( 1.4 % )

Los que faltan:
  - ADIG | ADI Global Distribution Inc. Common Stock
  - AEHL | Antelope Enterprise Holdings Limited - Class A Ordinary Shares

En daily_bars@2026-08-07 pero NO en la poblacion limpia: 0
```

#### 4.2 · Los dos casos, y son de naturaleza distinta

```
table:  daily_bars
select: symbol,trade_date,close,updated_at
filter: symbol=in.(ADIG,AEHL)
order:  trade_date.desc
limit:  12
```

- **AEHL**: última barra **2026-07-17**, `updated_at` 2026-08-09T11:16:32Z.
  Es decir: el refresco del día 9 **sí lo intentó** y el proveedor no
  devolvió nada posterior al 17 de julio. Cotización suspendida, excluida o
  desaparecida. Con el criterio nuevo quedaría marcado como caducado
  **para siempre**, y se reintentaría en vano todas las noches.
- **ADIG**: consulta `symbol=eq.ADIG`, `order=trade_date.desc`, `limit=5` →
  **`[]`**. Nunca se ha descargado. Este sí *debe* refrescarse: el criterio
  nuevo acierta con él.

#### 4.3 · Cuántos serían

De 148 símbolos, **1 se reintentaría en vano** (AEHL) — un **0,7%**.
Extrapolado a los 5.605 del universo, **unos 38 símbolos**.

Es un desperdicio pequeño y asumible: 38 descargas fallidas por noche, no
5.605. **No invalida el diseño**, pero conviene que quede contado y con un
tope, para que un día no crezca sin que nadie lo note.

⚠️ Extrapolación declarada: medí un solo tramo alfabético (`A`), no una
muestra aleatoria del universo. Los símbolos suspendidos podrían no
distribuirse de forma uniforme por letra.

#### 4.4 · ¿Hay ya algo en el código que resuelva esto? NO

Busqué en `lib/`, `scripts/` y `app/`:

```bash
grep -rniE "marketCalendar|tradingCalendar|lastTradingDay|lastSession|sesionMercado|exchangeCalendar|businessDay|diaHabil|día hábil|weekday" lib scripts app
grep -rniE "01-01|07-04|12-25|thanksgiving|christmas|new year|labor day|juneteenth" lib scripts
```

**No existe ninguna noción de calendario bursátil, festivos ni "última
sesión" en el repositorio.** Todo lo que mide frescura lo hace en días de
calendario contra `Date.now()`: `ageDaysFrom` en el script,
`freshnessDays` en [`lib/dailyBarsCache.js:73`](../lib/dailyBarsCache.js#L73)
y `priceFreshnessForDate` en
[`lib/dataCoverageShared.js:81`](../lib/dataCoverageShared.js#L81).

Lo único adyacente es un comentario en
[`lib/indicators.js:116`](../lib/indicators.js#L116), que dice justo lo
contrario para su propio problema — cita literal:

```js
// Compara SOLO barras consecutivas en el array (b[i] vs b[i+1]), nunca
// fechas de calendario — un hueco de fin de semana largo o una suspensión
// de cotización de varias semanas no es, por sí solo, un salto de precio;
```

O sea: el detector de splits ya renunció a las fechas de calendario por este
mismo motivo, y resolvió mirando barras consecutivas. **Ese es el precedente
del repo, y apunta en la misma dirección que el diseño propuesto** — pero no
hay función reutilizable, habría que escribirla.

---

## HALLAZGO NO PREVISTO — el diseño propuesto no resuelve el problema de fondo

Esto no estaba entre los cuatro supuestos, pero cambia la conclusión, así
que lo separo.

### El guardián volvería a abortar todos los días laborables

El refresco nocturno existe **para traerse la sesión que todavía no está en
la base**. Veamos qué pasa cada noche con el criterio nuevo:

| Noche (02:00 UTC) | Última sesión real | Máximo en la base | ¿Caducados? |
|---|---|---|---|
| **Lunes 10** | viernes 7 | viernes 7 | **0** ✅ el aborto de hoy se evita |
| **Martes 11** | lunes 10 | viernes 7 | **5.605** ❌ vuelve a abortar |
| Miércoles 12 | martes 11 | lunes 10 | **5.605** ❌ |

El criterio nuevo arregla **el lunes y los festivos**, que es cuando la base
ya tiene la última sesión y el criterio viejo mentía. Pero **cualquier día
laborable normal el universo entero carece legítimamente de la sesión más
reciente** — porque descargarla es el trabajo. El guardián, que aborta por
encima de 1.000, saltaría igual.

El guardián está midiendo lo que no es. Cita literal de
[`scripts/refresh-bars.mjs:362`](../scripts/refresh-bars.mjs#L362):

```js
    if (massLoadCandidates.length > args.maxMassLoad && !args.permitMassLoad) {
```

Cuenta **símbolos que necesitan actualizarse** (que son todos, por diseño).
Lo que de verdad tumbó la instancia fue el **volumen de filas escritas**, y
eso depende de cuántos símbolos necesitan una descarga **desde cero**.

### Y el volumen de escritura no es el que dice el comentario del workflow

El workflow afirma, cita literal de
[`.github/workflows/refresh-bars.yml:6-9`](../.github/workflows/refresh-bars.yml#L6):

```yaml
# Supabase. Es un refresco INCREMENTAL: con --stale-days=1 (el valor por
# defecto del script), solo descarga y escribe los símbolos cuya última
# barra tiene un día o más de antigüedad — un día normal son unos pocos
# cientos de símbolos, no los ~5.600 de una carga inicial.
```

**Eso es incorrecto en dos frentes.** Ya vimos que no son "unos pocos
cientos" sino todos. Y además, cuando un símbolo se refresca, no se escribe
una barra: se reescribe **la serie entera**. Cita literal de
[`lib/dailyBarsCache.js:343-348`](../lib/dailyBarsCache.js#L343):

```js
  const cappedBars = (chart.bars || []).slice(0, writeCap);

  const rows = cappedBars
    .map((bar) => cleanWriteBar(symbol, bar, chart))
    .filter(Boolean)
    .map((row) => ({ owner_id: config.ownerId, ...row }));
```

Con el tope de
[`lib/dailyBarsCache.js:19-20`](../lib/dailyBarsCache.js#L19):

```js
const WRITE_CAP_DEFAULT = 400;
const WRITE_CAP_REFERENCED = 1260;
```

Y el script pide dos años, cita literal de
[`scripts/refresh-bars.mjs:301`](../scripts/refresh-bars.mjs#L301):

```js
    const result = await withDailyBarsCache(symbol, { range: "2A", interval: "D", maxAgeDays: args.staleDays }, fetchYahooChart);
```

Profundidad real medida (GET con `count=exact`, una petición por símbolo):

```
AAPL: barras=0-0/404 (646 ms)
FTNT: barras=0-0/510 (406 ms)
AGMH: barras=0-0/400 (79 ms)
SPY:  barras=0-0/789 (244 ms)
```

Unas **400 barras por símbolo** — justo el tope. Así que una noche que
refresque los 5.605 símbolos hace del orden de **5.605 × 400 ≈ 2,2 millones
de filas** de escritura (upsert), no 5.600. Es **tres veces más** que las
~700.000 de la carga inicial que dejó la instancia caída cuatro horas.

Con el criterio nuevo eso no cambia: los símbolos siguen bajando dos años
enteros aunque solo les falte una sesión.

---

## RECOMENDACIÓN

**El diseño propuesto es necesario pero no suficiente. Hay que ampliarlo.**

Lo que sí hay que hacer, tal como está propuesto:

1. **Cambiar el criterio a "última sesión de mercado"**. Arregla el falso
   positivo de los lunes y festivos, y hace que reejecutar el trabajo el
   mismo día no vuelva a descargar nada. Correcto y necesario.
2. **Cambiar las 5.605 consultas por la consulta agrupada por fecha**, con
   la corrección de que son **6 peticiones paginadas de 1.000**, no una:
   3 segundos en vez de 4 minutos. Ganancia real y sin riesgo.

Lo que hay que **añadir**, o el problema no se resuelve:

3. **No anclar en SPY.** Está refutado (§2.4). Anclar tampoco en el máximo
   crudo de la tabla, que es envenenable por las barras de sábado (§2.5).
   La opción robusta: **la fecha más reciente que (a) no sea posterior a hoy
   y (b) la compartan al menos K símbolos** (K de unos cientos). Se calcula
   con 5-7 sondeos `count=exact` de ~350 ms sobre las fechas candidatas
   recientes — barato, y ni una barra espuria suelta ni un símbolo atrasado
   pueden moverlo.
4. **Arreglar el error de límite `>=` / `<=`** (§1.4). Es un defecto
   independiente: hoy el guardián da por caducado lo que la caché considera
   fresco.
5. **Replantear qué mide el guardián.** Debe contar lo que provoca la carga
   masiva: **símbolos sin histórico o con histórico muy corto** (los que
   disparan una descarga de dos años completa), no símbolos que van una
   sesión por detrás. Con el criterio actual seguirá abortando cada martes.

Y lo que probablemente sea **la mejora de mayor impacto**, aunque no estaba
en el diseño:

6. **Pedir un rango corto para el relleno incremental.** Un símbolo que ya
   tiene sus ~400 barras no necesita bajar dos años para añadir una sesión.
   La caché ya acepta rangos cortos — cita literal de
   [`lib/dailyBarsCache.js:37-44`](../lib/dailyBarsCache.js#L37):

   ```js
     const map = {
       "1D": 10,
       "5D": 20,
       "1M": 45,
   ```

   Con `"1M"` se escribirían unas 22 filas por símbolo en vez de 400: de
   ~2,2 millones a **~123.000 filas por noche**, unas 18 veces menos carga
   sobre la instancia Micro. Y como el payload quedaría por debajo del tope
   de escritura, la purga oportunista no se activaría, así que no se perdería
   histórico (`purgeBeforeDate` solo se calcula si el payload supera el tope,
   [`lib/dailyBarsCache.js:358-360`](../lib/dailyBarsCache.js#L358)).

   ⚠️ Sin verificar: no he comprobado que Yahoo devuelva de forma fiable la
   última sesión con rango `1mo`, ni cómo se comporta el guardián de
   `minBars` de `readDailyBarsCache` con un rango corto. Habría que medirlo
   antes de implementarlo.

**Orden sugerido**: primero el punto 4 (una línea, y es un defecto claro),
luego el 5 (sin él sigue abortando), luego 1+3 juntos (el criterio y su
ancla), luego 2 (rendimiento) y por último 6 (la mejora grande, previa
medición).

---

## LO QUE NO HE VERIFICADO

1. **La cifra de ~700.000 filas de la carga inicial.** Mi estimación
   (5.605 × 400 ≈ 2,2 millones) no cuadra con ella. No sé cuál es correcta:
   la consulta del total de filas de `daily_bars` **dio timeout** (8,1 s,
   `content-range: null`) y no la reintenté por el aviso de saturación.
2. **La causa de las barras con fecha de sábado.** Documento el hecho (SPY y
   FTNT, 2026-08-01, cierre copiado del viernes, escritas en fin de semana)
   pero no he investigado qué código las produce ni si es un problema de
   zona horaria, del proveedor o de otra cosa.
3. **Por qué SPY se refrescó el 9 de agosto a las 14:05 UTC** y QQQ/ACWI no.
   Algo lo tocó fuera de la hidratación de benchmarks; no he averiguado qué.
4. **La tasa de símbolos suspendidos fuera del tramo alfabético `A`.** El
   0,7% sale de 148 símbolos de una sola letra, no de una muestra aleatoria.
5. **Que la tabla de "qué pasa cada noche"** (§ hallazgo no previsto) se
   cumpla en producción. Está derivada de leer el código y de las fechas
   observadas, no de haber visto correr el workflow un martes — ejecutarlo
   estaba prohibido.
6. **El comportamiento del ancla propuesta (K símbolos)**. Es un diseño que
   propongo, no algo que haya probado.
7. **Si `readDailyBarsCache` aceptaría un rango corto sin romper su
   comprobación de `minBars`** (punto 6 de la recomendación).
8. **El recuento exacto de símbolos con barra del 7 de agosto que además
   pertenecen al universo US.** Sé que hay 5.822 filas para esa fecha en
   total, pero incluyen índices y todos los mercados; solo verifiqué la
   correspondencia con el universo US en el tramo `[A, AGN)`.
