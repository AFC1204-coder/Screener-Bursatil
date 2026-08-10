# ¿Se puede pedir un mes en vez de dos años? — diagnóstico del volumen de escritura

<!-- fecha interna: 2026-08-10 · BASE_SHA: 047180b · rama: codex/statsedge-ui-polish -->

Documento de **solo diagnóstico**. No se modificó ningún archivo de código,
no se escribió en Supabase, no se ejecutó el script ni el workflow.

⚠️ **El enunciado de la tarea llegó cortado en "PARTE D — La".** Este
documento cubre las partes A, B y C, que estaban completas. La parte D está
pendiente de que me digas qué pedía.

---

## Resumen para el dueño (sin jerga)

**La idea funciona, y el riesgo que más preocupaba no existe.**

Hoy, para añadir la sesión de ayer, el sistema le pide a Yahoo dos años de
historia y vuelve a grabar las 400 barras enteras de ese símbolo. No compara
con lo que ya tiene: regraba todo, aunque sea idéntico.

Medido de verdad contra Yahoo con AAPL: pedir un mes devuelve **23 barras**;
pedir dos años devuelve **501**. Como el sistema recorta a 400 al grabar, el
ahorro sería de 400 filas por símbolo a 23 — unas **17 veces menos**.

**Lo crítico (pregunta 6): pedir un mes NO borra el histórico.** El único
borrado que hace el escritor se dispara solo cuando la respuesta trae *más*
barras que el tope de 400. Con 23 no se dispara nunca. Está verificado línea
a línea, no asumido.

**Y los huecos casi no existen.** De 146 símbolos del universo estadounidense
muestreados a lo largo del alfabeto, **145 están al día** con la última
sesión. Solo 1 estaba sin ninguna barra, y ninguno tenía un retraso que un
mes no cubriera. Es decir: el rango de dos años solo hace falta para el ~0,7%
que nunca se ha descargado.

**Un aviso que sí conviene tener presente**: no existe en todo el repositorio
ninguna comprobación de que las series no tengan agujeros. Si una estrategia
de rango corto llegara a dejar un hueco, nada lo detectaría y los cálculos
saldrían mal en silencio.

---

## PARTE A — Qué se escribe hoy

### A.1 · `writeDailyBarsCache` escribe **todas** las barras que recibe

Cita literal de
[`lib/dailyBarsCache.js:316-360`](../lib/dailyBarsCache.js#L316) — el cuerpo
completo hasta el punto de escritura:

```js
export async function writeDailyBarsCache(symbol, chart = {}, options = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { status: "disabled", written: false, count: 0, error: config.missing.join(", ") };
  if (isIntraday(options)) return { status: "skipped-intraday", written: false, count: 0 };

  // Guard anti-estimados: daily_bars solo persiste mercado real. Si el payload
  // trae señales de "estimated" (dataQuality explícito, meta.estimated, alguna
  // barra con estimated:true, o provider === ESTIMATED_CHART_PROVIDER), se
  // rechaza la escritura COMPLETA sin escribir nada. Esto es lo que sostiene la
  // invariant "lo que sale de la caché es siempre decision-grade": garantiza
  // que chartFromCache pueda emitir status:"real" con seguridad.
  const bars = Array.isArray(chart.bars) ? chart.bars : [];
  const estimatedByDq = chart.dataQuality?.estimated === true;
  const estimatedByMeta = chart.meta?.estimated === true;
  const estimatedByBars = bars.some((bar) => bar && (bar.estimated === true || bar.provider === ESTIMATED_CHART_PROVIDER));
  if (estimatedByDq || estimatedByMeta || estimatedByBars) {
    return { status: "rejected-estimated", written: false, count: 0 };
  }

  // Cap de profundidad: las N barras más recientes por (owner, symbol, provider).
  // Antes de construir filas, recortamos el payload al cap que corresponda.
  // El cap holgado (1260) aplica solo si el símbolo está referenciado por el
  // owner (favorito/nota/alerta activa); si no, 400. chart.bars ya viene
  // ordenado desc (más reciente primero) por convención del fetcher, así que
  // slice(0, cap) retiene exactamente las más recientes.
  const referenced = await isSymbolReferenced(config.ownerId, symbol, config);
  const writeCap = referenced ? WRITE_CAP_REFERENCED : WRITE_CAP_DEFAULT;
  const cappedBars = (chart.bars || []).slice(0, writeCap);

  const rows = cappedBars
    .map((bar) => cleanWriteBar(symbol, bar, chart))
    .filter(Boolean)
    .map((row) => ({ owner_id: config.ownerId, ...row }));

  if (!rows.length) return { status: "empty", written: false, count: 0 };
```

Y la escritura, cita literal de
[`lib/dailyBarsCache.js:362-370`](../lib/dailyBarsCache.js#L362):

```js
  try {
    for (let i = 0; i < rows.length; i += 500) {
      await supabaseRequest("daily_bars", {
        method: "POST",
        query: "on_conflict=owner_id,symbol,trade_date,provider",
        prefer: "resolution=merge-duplicates,return=minimal",
        body: rows.slice(i, i + 500),
      });
    }
```

**Respuesta: escribe todas, no solo las que faltan.** El camino de `chart.bars`
a `rows` es un `slice` (al tope), un `map` y un `filter` que descarta barras
malformadas. En ningún punto se consulta lo que ya está en la base para
excluir lo repetido.

Los topes, cita literal de
[`lib/dailyBarsCache.js:19-20`](../lib/dailyBarsCache.js#L19):

```js
const WRITE_CAP_DEFAULT = 400;
const WRITE_CAP_REFERENCED = 1260;
```

### A.2 · La clave de conflicto: sí, es un upsert que cuesta lo mismo

`query: "on_conflict=owner_id,symbol,trade_date,provider"` con
`prefer: "resolution=merge-duplicates"` → `INSERT … ON CONFLICT DO UPDATE`
sobre la clave `(owner_id, symbol, trade_date, provider)`.

**La sospecha del enunciado es correcta, y hay un motivo extra que la
refuerza.** En PostgreSQL un `DO UPDATE` escribe una versión nueva de la fila
y deja la anterior como tupla muerta, aunque los valores coincidan — el coste
de escritura, de WAL y de trabajo posterior para autovacuum es el mismo que
el de una fila nueva.

Y aquí ni siquiera coinciden los valores. Cita literal de
[`lib/dailyBarsCache.js:236-253`](../lib/dailyBarsCache.js#L236):

```js
function cleanWriteBar(symbol, bar = {}, chart = {}) {
  const tradeDate = toDate(bar.date);
  const close = numberOrNull(bar.close ?? bar.adjClose);
  if (!tradeDate || !Number.isFinite(close) || close <= 0) return null;
  const provider = String(bar.provider || providerFromChart(chart)).trim() || DEFAULT_OWNER_PROVIDER;
  return {
    symbol: canonicalSymbol(bar.symbol || chart.meta?.symbol || symbol),
    trade_date: tradeDate,
    open: numberOrNull(bar.open) ?? close,
    high: numberOrNull(bar.high) ?? close,
    low: numberOrNull(bar.low) ?? close,
    close: numberOrNull(bar.rawClose ?? bar.close) ?? close,
    adj_close: numberOrNull(bar.adjClose ?? bar.close) ?? close,
    volume: numberOrNull(bar.volume),
    currency: String(bar.currency || chart.meta?.currency || "").trim() || null,
    provider,
    updated_at: new Date().toISOString(),
  };
}
```

`updated_at: new Date().toISOString()` — **cada fila reescrita lleva marca de
tiempo nueva**, así que ninguna es un "no-op" que la base pudiera saltarse.
Las 400 filas de un símbolo cambian de verdad en cada refresco, aunque los
precios sean idénticos a los de ayer.

### A.3 · No hay ninguna comprobación previa. Es la otra vía de arreglo

`withDailyBarsCache` **sí** lee la caché antes de descargar, pero solo para
decidir si hace falta la descarga; el resultado de esa lectura no llega al
escritor. Cita literal de
[`lib/dailyBarsCache.js:412-428`](../lib/dailyBarsCache.js#L412):

```js
export async function withDailyBarsCache(symbol, options = {}, fetcher) {
  const cacheable = !isIntraday(options);
  const useCache = options.useCache !== false && cacheable;
  let cached = null;

  if (useCache && !options.refresh) {
    cached = await readDailyBarsCache(symbol, options);
    if (cached.hit) return chartFromCache(symbol, cached, options);
  }

  try {
    const live = await fetcher(symbol, options);
    // La caché SIEMPRE se escribe con la serie COMPLETA (sin recortar por asOf):
    // una consulta de replay no debe empobrecer la caché para consultas
    // posteriores. writeDailyBarsCache recibe el `live` intacto; el recorte por
    // asOf se aplica solo al payload que se devuelve al caller, más abajo.
    const write = useCache ? await writeDailyBarsCache(symbol, live, options) : { status: cacheable ? "skipped-disabled" : "skipped-intraday", written: false, count: 0 };
```

Fíjate en la llamada: `writeDailyBarsCache(symbol, live, options)`. **La
variable `cached` está ahí, ya cargada con las barras que hay en la base, y
no se le pasa.** El escritor no tiene forma de saber qué ya existe.

**Confirmado: no hay comprobación previa, y sería la otra vía de arreglo.**
Comparar `cached.bars` con `live.bars` y escribir solo las fechas nuevas o con
valores distintos daría el mismo ahorro que el rango corto —incluso mayor, y
sin depender del rango— a cambio de tocar la caché compartida, que usan otros
seis sitios (ver §B.4). Las dos vías son independientes y se podrían combinar.

---

## PARTE B — Si el rango corto funciona

### B.4 · Sí, `withDailyBarsCache` acepta rango, y estos son los valores

El rango viaja en `options` y lo consumen tres sitios. En la lectura, cita
literal de [`lib/dailyBarsCache.js:259-261`](../lib/dailyBarsCache.js#L259):

```js
  const limit = Math.min(Math.max(Number(options.limit || cacheLimitForRange(options.range)), 1), 6000);
  const maxAgeDays = Math.max(Number(options.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS), 0);
  const minBars = Math.max(Number(options.minBars ?? minBarsForRange(options.range)), 1);
```

Valores admitidos, cita literal de
[`lib/dailyBarsCache.js:35-49`](../lib/dailyBarsCache.js#L35):

```js
function cacheLimitForRange(range = "") {
  const key = String(range || "2A").trim().toUpperCase();
  const map = {
    "1D": 10,
    "5D": 20,
    "1M": 45,
    "3M": 90,
    "6M": 160,
    "1A": 280,
    "2A": 560,
    "5A": 1350,
    MAX: 6000,
  };
  return map[key] || map["2A"];
}
```

Y el mismo juego de claves se traduce a Yahoo, cita literal de
[`lib/yahoo.js:1194-1204`](../lib/yahoo.js#L1194):

```js
const YAHOO_RANGE_MAP = {
  "1D": "1d",
  "5D": "5d",
  "1M": "1mo",
  "3M": "3mo",
  "6M": "6mo",
  "1A": "1y",
  "2A": "2y",
  "5A": "5y",
  "MAX": "max",
};
```

⚠️ **Aviso de alcance**: `withDailyBarsCache` es compartido. Lo llaman, además
del script, `lib/materializedScanner.js:522`, `lib/serverScanRunner.js:297`,
`app/api/chart/route.js:62`, `app/api/company-brief/route.js:1233` y tres
rutas de jobs/cron. Varios de ellos **sí consumen las barras** para calcular
(el scoring necesita 253). Un cambio de rango tendría que ser del argumento
que pasa `scripts/refresh-bars.mjs`, **nunca** del valor por defecto de la
caché.

Para el script eso es seguro: solo mira el resumen de caché, no las barras.
Cita literal de
[`scripts/refresh-bars.mjs:301-313`](../scripts/refresh-bars.mjs#L301):

```js
    const result = await withDailyBarsCache(symbol, { range: "2A", interval: "D", maxAgeDays: args.staleDays }, fetchYahooChart);
    const cache = result?.meta?.cache || {};
    if (cache.hit === true) {
      // readDailyBarsCache encontró una barra a menos de --stale-days:
      // ni se descargó ni se escribió nada — es el "al día, se salta".
      return { symbol, ok: true, skipped: true };
    }
    if (cache.write) {
      if (cache.write.status === "error") {
        return { symbol, ok: false, reason: cache.write.error || "writeDailyBarsCache devolvió status:error" };
      }
      return { symbol, ok: true, skipped: false, barsWritten: cache.write.count || 0 };
    }
```

### B.5 · Qué devuelve Yahoo de verdad: 23 barras contra 501

Petición real, con el propio `fetchYahooChart` del repositorio (no una URL
inventada):

```bash
node --loader ./scripts/loader.mjs -e '
const { fetchYahooChart } = await import("@/lib/yahoo.js");
for (const range of ["1M", "2A"]) {
  const chart = await fetchYahooChart("AAPL", { range, interval: "D" });
  const bars = chart.bars || [];
  console.log(`AAPL range=${range}: ${bars.length} barras | mas reciente=${bars[0]?.date} | mas antigua=${bars.at(-1)?.date}`);
}'
```

```
AAPL range=1M: 23 barras | 448 ms | mas reciente=2026-08-07 | mas antigua=2026-07-08
AAPL range=2A: 501 barras | 239 ms | mas reciente=2026-08-07 | mas antigua=2024-08-08
```

Las dos traen la misma última sesión (2026-08-07), que es lo único que hace
falta para ponerse al día.

**Cuentas del ahorro**, usando que el escritor recorta a 400:

| | Filas por símbolo | 5.605 símbolos |
|---|---|---|
| Hoy (`2A`, 501 barras recortadas a 400) | **400** | **2.242.000** |
| Con `1M` (23 barras, por debajo del tope) | **23** | **128.915** |

Unas **17 veces menos**, coherente con la estimación de ~123.000 del
enunciado.

### B.6 · Lo CRÍTICO: pedir un mes **no** borra el histórico

**Respuesta: se conserva.** Hay dos borradores posibles en el sistema y
ninguno de los dos se dispara.

#### Borrador 1 — la purga oportunista del propio escritor

Cita literal de
[`lib/dailyBarsCache.js:352-360`](../lib/dailyBarsCache.js#L352):

```js
  // Fecha de corte para la purga oportunista: la trade_date de la barra número
  // `writeCap` más reciente que se va a escribir. Si el payload trajo más de
  // `writeCap` barras, todo lo anterior a esta fecha (para ESE symbol+provider+
  // owner) se borra — mismo patrón que la purga oportunista de scan_results,
  // adaptado al índice daily_bars_symbol_date_idx. Toca SOLO filas de este
  // símbolo, nunca un barrido de tabla completa.
  const purgeBeforeDate = (chart.bars || []).length > writeCap
    ? rows[rows.length - 1]?.trade_date
    : null;
```

Y el borrado, cita literal de
[`lib/dailyBarsCache.js:376-389`](../lib/dailyBarsCache.js#L376):

```js
    if (purgeBeforeDate) {
      const provider = rows[0]?.provider || "";
      const purgeQuery = [
        `owner_id=eq.${config.ownerId}`,
        `symbol=eq.${canonicalSymbol(symbol)}`,
        `trade_date=lt.${purgeBeforeDate}`,
        provider ? `provider=eq.${encodeURIComponent(provider)}` : "",
      ].filter(Boolean).join("&");
      try {
        await supabaseRequest("daily_bars", {
          method: "DELETE",
          query: purgeQuery,
          prefer: "return=minimal",
        });
```

La condición es `(chart.bars || []).length > writeCap`. Con un payload de
1 mes: **23 > 400 es falso** → `purgeBeforeDate` queda en `null` → el bloque
`if (purgeBeforeDate)` **no se ejecuta** y no se emite ningún `DELETE`.

Nota de la dirección contraria: hoy, con `2A`, sí se dispara (501 > 400), y
el escritor borra activamente todo lo anterior a la barra 400. Es decir,
**hoy la serie se recorta a 400 en cada escritura; con `1M` dejaría de
recortarse** y crecería un poco entre limpiezas semanales (ver borrador 2).
Es un efecto acotado, no una pérdida.

#### Borrador 2 — el backstop semanal de pg_cron

Existe un segundo borrador que el enunciado no menciona y que había que
descartar. Cita literal de
[`supabase/schema.sql:1732-1745`](../supabase/schema.sql#L1732), fase 1:

```sql
  delete from public.daily_bars
  where ctid in (
    select d.ctid
    from public.daily_bars d
    join (
      -- Último updated_at por (owner_id, symbol) — agrupa todas las filas
      -- del símbolo para decidir si el conjunto es huérfano.
      select owner_id, symbol, max(updated_at) as last_seen
      from public.daily_bars
      group by owner_id, symbol
    ) latest
      on latest.owner_id = d.owner_id
     and latest.symbol = d.symbol
    where latest.last_seen < now() - interval '90 days'
```

Usa **`max(updated_at)` agrupado por símbolo**. Con un refresco de 1 mes solo
23 filas estrenan `updated_at`, pero basta una para que el máximo del símbolo
sea de hoy. **El símbolo no se considera huérfano y sobrevive entero.**

Y la fase 2, cita literal de
[`supabase/schema.sql:1782-1812`](../supabase/schema.sql#L1782):

```sql
      row_number() over (
        partition by d.owner_id, d.symbol
        order by d.trade_date desc
      ) as rn
...
    where r.rn > case
      when ref.owner_id is not null then 1260
      else 400
    end
```

Recorta por **`trade_date` descendente**, no por `updated_at`: retiene las 400
barras más recientes por fecha. Las viejas que el refresco de 1 mes no tocó
siguen contando entre esas 400 y se quedan.

Se programa los domingos, cita literal de
[`supabase/schema.sql:1843-1845`](../supabase/schema.sql#L1843):

```sql
select cron.schedule(
  'statsedge-daily-bars-purge-weekly',
  '0 3 * * 0',  -- domingos 03:00 UTC (fuera de horas pico, semanal)
```

### B.7 · Resumen de la evidencia de B.6

| Borrador | ¿Se dispara con `1M`? | Por qué |
|---|---|---|
| Purga del escritor (`purgeBeforeDate`) | **No** | requiere `payload > 400`; el payload son 23 |
| pg_cron fase 1 (huérfanos) | **No** | mira `max(updated_at)` del símbolo, que se renueva |
| pg_cron fase 2 (recorte) | Sí, pero inofensivo | recorta por `trade_date`, retiene las 400 más recientes |

**Ninguno destruye los dos años ya guardados.**

---

## PARTE C — Los huecos

### C.8 · Cómo se detectaría un hueco: **hoy no se detectaría**

Busqué cualquier comprobación de continuidad de fechas:

```bash
grep -rniE "gap|hueco|continuit|contigu|missingBar|barrasFaltantes|expectedSessions|consecutiv" \
  lib/dailyBarsCache.js lib/dataCoverageShared.js scripts/refresh-bars.mjs lib/indicators.js
```

Los únicos aciertos son comentarios en prosa y `detectPriceDiscontinuities`,
que mira saltos de **precio**, no de fecha — y que renuncia explícitamente a
las fechas. Cita literal de
[`lib/indicators.js:115-118`](../lib/indicators.js#L115):

```js
// Compara SOLO barras consecutivas en el array (b[i] vs b[i+1]), nunca
// fechas de calendario — un hueco de fin de semana largo o una suspensión
// de cotización de varias semanas no es, por sí solo, un salto de precio;
```

**No existe ninguna validación de que una serie esté completa.** Lo único que
se comprueba al leer es un **recuento**, cita literal de
[`lib/dailyBarsCache.js:284-285`](../lib/dailyBarsCache.js#L284):

```js
    const enough = asOfBars.length >= minBars;
    const fresh = enough && age !== null && age <= maxAgeDays;
```

Un símbolo con 400 barras a las que les faltan 20 en medio sigue cumpliendo
`enough` y sigue siendo `fresh`. **El hueco es invisible**, y como los
indicadores recorren el array por posición sin mirar fechas, medias móviles y
rendimientos a 12 meses saldrían desplazados sin que nada avisara.

**Qué haría falta** (no lo implemento): la lectura ya devuelve `latestDate` y
`freshnessDays`; bastaría comparar la fecha de la última barra guardada con la
barra más antigua que traería el rango elegido (para `1M`, unos 30 días de
calendario — medido: la respuesta de AAPL llegaba hasta 2026-07-08). Si la
guardada es anterior, hay hueco y toca pedir un rango mayor.

### C.9 · Cuántos símbolos están hoy en esa situación

#### Medición controlada sobre el universo que el script procesa

Muestra de 146 símbolos del universo estadounidense (`passed=true`, sin
fondos cerrados), tomada en cinco tramos repartidos por el alfabeto
(`offset` 0, 1.200, 2.400, 3.600 y 4.800 sobre `symbol.asc`) de la
instantánea vigente `df7e3961-f044-4bf3-9a1a-8a66f0baae5a`. Consultas por
GET de solo lectura:

```
GET /rest/v1/universe_snapshot_symbols?owner_id=eq.personal
    &snapshot_id=eq.df7e3961-f044-4bf3-9a1a-8a66f0baae5a
    &market=eq.US&passed=eq.true&select=symbol,name
    &order=symbol.asc&limit=30&offset=<0|1200|2400|3600|4800>

GET /rest/v1/daily_bars?owner_id=eq.personal
    &symbol=in.(<los 146>)&trade_date=eq.2026-08-07&select=symbol
```

(La última sesión guardada es 2026-08-07, confirmada con `daily_bars`,
`order=trade_date.desc`, `limit=2` → `SHBI` y `GROY`, ambas del 2026-08-07.
Hoy es lunes 2026-08-10.)

```
Muestra: 146 | con barra de la ultima sesion (2026-08-07): 145 | sin ella: 1

  NCO      SIN NINGUNA BARRA -> necesita descarga completa

Sin ninguna barra: 1 | hueco cubierto por 1M: 0 | hueco NO cubierto por 1M: 0
Tasa de riesgo (sin barras + hueco no cubierto): 0.7% de la muestra
```

**El 99,3% de la muestra está al día con la última sesión. Ni un solo símbolo
tenía un retraso que el rango de 1 mes no cubriera.** El único caso
problemático (`NCO`) no tiene ninguna barra: no es un hueco, es una descarga
inicial.

Extrapolado a los 5.605 del universo: **unos 38 símbolos** necesitarían el
rango largo, y **cero** por huecos intermedios.

⚠️ Extrapolación declarada: 146 símbolos de 5.605 (2,6%), muestreados por
posición alfabética, no al azar.

#### Contraste con el total de la tabla, que es peor y no contradice lo anterior

```bash
GET /rest/v1/daily_bars?owner_id=eq.personal&trade_date=eq.<fecha>&select=symbol
    (Prefer: count=exact, Range: 0-0)
```

| Fecha | Símbolos con barra ese día | ms |
|---|---|---|
| 2026-08-07 | **5.822** | 405 |
| 2026-07-08 | **6.722** | 252 |
| 2026-06-08 | **6.651** | 153 |
| 2026-05-08 | **9.893** | 154 |

Hay unos **900 símbolos** con barra del 8 de julio y sin barra del 7 de
agosto, y unos 3.000 más que estaban vivos en mayo y ya no aparecen en julio.

**Eso no contradice el 99,3% de arriba: son poblaciones distintas.** La tabla
contiene todos los mercados e índices, y los mercados no estadounidenses solo
los refresca el cron de Vercel a razón de una o dos docenas de símbolos por
noche — su atraso es esperable. `refresh-bars.mjs` solo toca el universo
estadounidense, y ese está al día.

⚠️ No he verificado que los ~900 sean efectivamente no estadounidenses; es la
explicación más plausible dado el 99,3% medido, pero no la he comprobado
símbolo a símbolo. Además, las fechas concretas que elegí pueden ser festivo
en algún mercado, lo que infla artificialmente las diferencias.

### C.10 · ¿Elegir el rango según la antigüedad? Sí, y el criterio es simple

**Evaluación: es la forma correcta de hacerlo, y sale barata.**

El dato que decide ya está disponible sin ninguna consulta extra: la lectura
de caché que `withDailyBarsCache` hace *antes* de descargar devuelve
`latestDate`, `freshnessDays` y `rows` (cita en §B.4 y
[`lib/dailyBarsCache.js:286-300`](../lib/dailyBarsCache.js#L286)).

Los tres casos, con su peso medido:

| Caso | Cómo se reconoce | Rango que toca | Peso medido |
|---|---|---|---|
| Nunca descargado o histórico corto | `rows` = 0, o por debajo de las 253 barras del scoring | `2A` | 1 de 146 (**0,7%**) |
| Al día, solo le falta la última sesión | última barra a menos de ~30 días | `1M` | 145 de 146 (**99,3%**) |
| Retrasado más de un mes | última barra anterior a ~30 días | `2A`, o un rango intermedio | 0 de 146 (**0%**) |

Con esos pesos, el ahorro real sería casi el máximo teórico: el 99,3% de los
símbolos escribiría 23 filas en vez de 400.

Tres cautelas que habría que resolver antes de implementarlo:

1. **El umbral es de días de calendario, y el rango de Yahoo también.** La
   respuesta de `1M` para AAPL llegó hasta 2026-07-08, exactamente 30 días
   naturales atrás. Conviene un margen (usar `3M`, que trae ~90 días, cuando
   el retraso pase de dos semanas) en vez de apurar el límite.
2. **El cambio debe ir en el argumento del script, no en el valor por
   defecto de la caché** (§B.4): otros consumidores necesitan 253 barras.
3. **Con `1M` la serie deja de recortarse a 400 en cada escritura** (§B.6) y
   crecería hasta la limpieza del domingo. Es acotado, pero conviene medirlo
   en vez de suponerlo.

---

## PARTE D — pendiente

**El enunciado se cortó en "PARTE D — La".** No he inventado su contenido.
Dime qué pedía y la completo.

---

## LO QUE NO HE VERIFICADO

1. **Que el ahorro real sea de 400→23 filas en producción.** Está calculado
   desde el código y desde una medición real contra Yahoo, pero ejecutar el
   script con `--write` estaba fuera de esta tarea.
2. **El comportamiento de `readDailyBarsCache` con `range: "1M"`.** Por
   código, usaría `limit = 45` y `minBars = 10`, así que devolvería como
   mucho 45 barras en un acierto de caché. Para `refresh-bars.mjs` da igual
   (solo lee `meta.cache`), pero no lo he probado.
3. **Que el backstop de pg_cron esté realmente activo en producción.** El
   propio `schema.sql` avisa de que su sintaxis está *"PENDIENTE DE
   VALIDACIÓN EN RUNTIME"*. Leí la definición; no comprobé
   `cron.job_run_details`.
4. **Cuánto crecería la tabla entre limpiezas semanales** si se dejara de
   recortar a 400 en cada escritura.
5. **Si los ~900 símbolos atrasados de la tabla son no estadounidenses.** Es
   la explicación plausible, no comprobada.
6. **El comportamiento de `1M` en símbolos poco líquidos o de mercados no
   estadounidenses.** La única medición contra Yahoo fue con AAPL.
7. **Si existen ya huecos intermedios en las series guardadas.** Medí la
   fecha de la última barra, no la continuidad interna — y como señala §C.8,
   no hay nada en el sistema que lo compruebe.
