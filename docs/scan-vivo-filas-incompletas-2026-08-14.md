# Filas incompletas en el escaneo en vivo — diagnóstico, 2026-08-14

BASE_SHA: `cbf3396` (rama `codex/statsedge-ui-polish`).
Tarea de diagnóstico: no se ha modificado código, no se ha escrito en
Supabase, no se ha ejecutado ningún escaneo nuevo. Se ha leído el código, se
han hecho consultas de solo lectura contra producción, y se ha llamado a
`GET /api/leaderboards` en el servidor de desarrollo local (una lectura,
ningún efecto secundario) para confirmar en vivo la forma exacta de la
respuesta.

## El veredicto en cuatro frases

1. **`GET /api/scan` no es el culpable.** Traza completa hecha: las filas que
   guarda y devuelve esa ruta llevan `chartPreview`, `weeklyStageState` y los
   campos de RS semanal enteros. Verificado leyendo el código y con una fila
   real de `scan_results`.
2. **El culpable es otra ruta que corre ANTES de que el escaneo en vivo
   empiece a devolver nada**: `loadCachedScreenerPreview()` en
   `app/page.jsx`, que llama a `GET /api/leaderboards` y pinta sus resultados
   directamente en la tabla. Esa ruta usa una proyección deliberadamente
   recortada (`publicItem()`, pensada para un endpoint público de solo
   señales derivadas) que **nunca ha incluido miniatura ni etapa** — no es
   una regresión, es una pieza pensada para otro propósito, conectada donde
   no encaja.
3. **"0 analizadas" tiene una causa de estado, no de datos**: `analyzedRows`
   se resetea a `[]` al principio de cada escaneo y solo se rellena al
   final del escaneo en vivo. La vista previa cacheada escribe en `rows`
   pero nunca en `analyzedRows`, así que ese contador se queda en cero
   mientras la previa esté en pantalla.
4. **Hallazgo adicional, en vivo, no buscado**: la RPC que filtra qué filas
   son "publicables" para leaderboards (`leaderboard_publishable_rows`)
   tiene un bug de orden de operaciones que, ahora mismo, hace que
   `/api/leaderboards` devuelva **0 resultados** para cualquier consulta
   como la que usa la vista previa. Lo causa un escaneo interactivo que
   falló hace unas horas (1.194 filas con estado `error`, las más recientes
   de toda la tabla). Es un bug real, verificado en vivo, distinto del que
   pidió esta tarea — se documenta aparte.

---

# PARTE 1 — Traza de `GET /api/scan` durante un escaneo en vivo

## 1.1 Qué hace la ruta

```js
// app/api/scan/route.js:113-133
const [scan] = await supabaseRequest("scans", {
  query: `id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&select=id,local_id,name,preset,progress:settings->progress,row_count,created_at,updated_at&limit=1`,
});
if (!scan) return Response.json({ ok: false, error: "Scan no encontrado" }, { status: 404 });
const progress = scan.progress || { status: "unknown" };
let rows = [];
let nextOffset = offset;
if (includeRows) {
  const results = await supabaseRequest("scan_results", {
    query: `scan_id=eq.${encodeURIComponent(id)}&owner_id=eq.${encodeURIComponent(config.ownerId)}&rank_index=gt.${offset}&select=rank_index,raw&order=rank_index.asc&limit=${limit}`,
  });
  rows = await hydrateRowsWithWeeklyRs(results.map((item) => item.raw).filter(Boolean));
  nextOffset = results.length ? results.at(-1).rank_index : offset;
}
```

Lee **solo la columna `raw`** de `scan_results` (no `metrics`), toma
`item.raw` de cada fila tal cual, y le pasa el lote entero a
`hydrateRowsWithWeeklyRs`. Esa función (`lib/globalRs.js:188-194`) hace
`list.map((row) => attachWeeklyRs(row, weekly.bySymbol))`, y `attachWeeklyRs`
(`lib/globalRs.js:152-180`) **solo añade** campos `weeklyRs*` encima de
`{...row}` — nunca quita nada.

Conclusión de esta parte: **`raw` viaja completo, sin recortar, desde
`scan_results` hasta la respuesta JSON de `GET /api/scan`.**

## 1.2 Verificación con una fila real

```
table: scan_results
select: symbol,rank_index,raw
filter: scan_id=eq.dd54b3fc-20fe-4c22-a93a-1c834167b955&rank_index=eq.1
limit: 1
```

Esa fila (`8035.T`, de un escaneo en servidor real de 9.918 símbolos)
trae en `raw`, entre otros:

- `"chartPreview": [{"date": "2026-06-02", "close": 53710, "sma50": 45446.83, "sma200": 35388.12, "volume": 2681900}, ...]` — 47 puntos, con `close` y `volume` en todos, y `sma50`/`sma200` nulos solo en los primeros puntos de la serie (normal: hace falta más historial del que cubre esa ventana de 47 días para tener SMA200 en los primeros puntos — no significa que falte el dato en la base, solo que esos días concretos aún no tenían suficiente histórico por detrás dentro de la ventana mostrada).
- `"weeklyStageState": "base"`, `"weeklyStageLabel": "Base / transicion"`, y el objeto completo `"weeklyStage": {...}`.
- `"rsGlobalPct": 75`, `"rsSectorPct": 66`, `"rsCountryPct": null` (el percentil del lote, no el canónico).

`weeklyRsAvailable`/`weeklyRsRating` **no** están en `raw` — eso es
correcto y esperado: esos campos los añade `attachWeeklyRs` **al leer**, no
al escribir (comentario explícito en `lib/globalRs.js:140-151`, y
confirmado en la tarea anterior del 13 de agosto).

---

# PARTE 2 — ¿Está `raw` compactado o recortado por el camino?

**Al escribir, sí, pero de forma controlada y documentada — no pierde los
campos que preocupan aquí.**

```js
// lib/scanDecisionProjection.js:26-32
export function scanDecisionRaw(row = {}) {
  if (!row || typeof row !== "object") return {};
  const { objectiveMetricAudit, decisionTrace, ...rest } = row;
  if (Array.isArray(rest.chartPreview)) rest.chartPreview = compactChartPreview(rest.chartPreview);
  return rest;
}
```

Esto se llama desde el runner del escaneo en servidor:

```js
// lib/serverScanRunner.js:103-127 (resultPayload)
raw: scanDecisionRaw(preparedRow),
```

`scanDecisionRaw` quita solo dos campos (`objectiveMetricAudit`,
`decisionTrace` — porque ya van en `metrics`, ver el comentario de
`lib/scanDecisionProjection.js:14-24`) y comprime `chartPreview` a 48 puntos
redondeados vía `compactChartPreview` (`lib/researchRowContract.js:64-73`).
Ninguna de las dos podas afecta a `weeklyStageState`, `weeklyStageLabel` ni
a `chartPreview` en sí — solo lo hace más ligero.

**Al leer**, `GET /api/scan` no aplica ninguna poda adicional: hace
`results.map((item) => item.raw)` sin tocar nada más (Parte 1.1).

Conclusión: la ruta de escritura del escaneo en vivo (`lib/serverScanRunner.js`)
**sí guarda** `chartPreview`, `weeklyStageState` y el RS del lote en `raw`.
La ruta de lectura (`GET /api/scan`) **sí los devuelve**. El problema no
está aquí.

---

# PARTE 3 y 4 — Por qué faltan miniatura, etapa y RS si están en la base

## 3.1 La pista: qué campos SÍ llegan y cuáles no

El aviso dice literalmente:

```js
// lib/screenerColumns.jsx:126-131
{Array.isArray(row.chartPreview) && row.chartPreview.filter((bar) => Number.isFinite(bar?.close)).length > 1
  ? <MiniSparkline bars={row.chartPreview} className="rowSparkline" />
  : <span className="rowSparkline rowSparklineMissing">
    <MissingValue reason="Sin miniatura: no hay serie de precios suficiente para dibujarla." />
  </span>}
```

```js
// lib/screenerColumns.jsx:163-176 (columna "Etapa")
cell: (row) => {
  const stage = stageWord(row);
  if (!stage) {
    return <MissingValue reason={STAGE_MISSING_REASON} />;
  }
  ...
```
```js
// lib/stageDisplay.js:37-44
export function stageWordForState(state = "", label = "") {
  if (STAGE_WORDS[state]) return STAGE_WORDS[state];
  if (state === "insufficient_history") return null;
  const derived = stateFromLabel(label);
  return derived ? STAGE_WORDS[derived] : null;
}
```
`stageWord(row)` (`lib/screenerColumns.jsx:75-77`) llama a
`stageWordForState(row.weeklyStageState || "", row.weeklyStageLabel || "")`
— si ambos vienen vacíos, no hay palabra, y sale el guion.

```js
// lib/screenerColumns.jsx:150-161 (columna "RS")
cell: (row) => {
  const rs = canonicalRs(row);
  if (!rs.available) return <MissingValue reason={rs.reason} />;
  ...
```
`canonicalRs` (`lib/rsCanonical.js:78-102`) exige que `row.weeklyRsAvailable`
sea `true` y `row.weeklyRsRating` sea un número. Si `weeklyRsAvailable` no
está definido en absoluto (ni plano ni en `snapshot`/`metrics`/`raw`), la
razón que devuelve es exactamente:

```js
// lib/rsCanonical.js:29
export const RS_NOT_HYDRATED_REASON = "Sin RS semanal en esta vista: la fila no trae cargado el ranking semanal del universo. Abre la ficha del valor para verlo.";
```

Y las columnas que SÍ tenían dato —tema, rendimiento, distancia a
máximos, capitalización— leen directamente `row.theme`, `row.perf3m` /
`perf6m` / `perf12m`, `row.distance52w`, `row.marketCap`
(`lib/screenerColumns.jsx:140-146, 177-227`).

## 3.2 El sospechoso: `loadCachedScreenerPreview`

Antes de que el escaneo en servidor arranque siquiera, `run()` llama a esto:

```js
// app/page.jsx:1330-1352
const cachePreview = await loadCachedScreenerPreview(activeSettings);
const symbols = selected(base);
const fullUniverseScan = scanMode === "all";
let stableResultsPublished = hadVisibleRows;
if (cachePreview.rows.length) {
  stableResultsPublished = true;
  if (hadVisibleRows) {
    setPendingResults({ rows: cachePreview.rows, diagnostics, completed: 0, total: symbols.length, done: false, updatedAt: new Date().toISOString() });
    setStatus(`Cache precalculada lista (${cachePreview.rows.length}). La tabla visible queda congelada mientras se refina el scan actual.`);
  } else {
    setRows(cachePreview.rows);
    setStatus(`Cache: ${cachePreview.rows.length} resultados precalculados. Refinando con scan actual.`);
  }
}
```

Y `loadCachedScreenerPreview`:

```js
// app/page.jsx:1232-1249
async function loadCachedScreenerPreview(set = activeSettings) {
  try {
    const params = cachedScreenerQuery(set, markets);
    const data = await getJson(`/api/leaderboards?${params.toString()}`, { timeoutMs: CACHE_PREVIEW_TIMEOUT_MS });
    const marketSet = new Set(markets);
    const items = data.leaderboard?.items || [];
    const cachedRows = items
      .map(cachedScreenerRow)
      .filter((row) => row.symbol && (!marketSet.size || marketSet.has(row.country || countryCode(row.symbol))));
    return { rows: cachedRows, generatedAt: data.leaderboard?.generatedAt || "", configured: data.configured !== false };
  } catch {
    return { rows: [], generatedAt: "", configured: false };
  }
}
```

```js
// lib/screenerPipeline.js:64-73 (cachedScreenerQuery)
function cachedScreenerQuery(settings = {}, selectedMarkets = []) {
  const params = new URLSearchParams({ strategy: "composite", limit: "50", maxRows: "120", sinceDays: "14" });
  for (const key of SCREENER_FILTER_QUERY_KEYS) {
    const value = settings[key];
    if (value === undefined || value === null || value === "") continue;
    if (!["string", "number", "boolean"].includes(typeof value)) continue;
    params.set(key, String(value));
  }
  if (selectedMarkets.length === 1) params.set("country", selectedMarkets[0]);
  return params;
}
```

Ahí está el **50**: `limit: "50"`, hardcodeado. Con un solo mercado
seleccionado ("solo Estados Unidos"), añade `country=US`.

## 3.3 Lo que devuelve `/api/leaderboards`: una proyección deliberadamente recortada

`cachedScreenerRow` es `normalizeCachedScreenerRow`
(`lib/cachedScreenerRows.js:176-202`), que construye la fila a partir de
`item.metrics`, `item.raw` e `item` mismo. El problema es que
**`item` no trae `metrics` ni `raw`** — cada elemento de
`leaderboard.items` es la salida de `publicItem()`:

```js
// lib/leaderboards.js:472-539 (publicItem, íntegro salvo la lista de campos)
function publicItem(row = {}, rank, strategy = "momentum", maxPriceFreshnessDays = DEFAULT_MAX_PRICE_FRESHNESS_DAYS) {
  ...
  return {
    rank, symbol: row.symbol, companyName: ..., country: ..., sector: ..., industry: ..., theme: ...,
    score: ..., objectiveScore: ..., totalScore: ..., compositeScore: ...,
    rsGlobalPct: finiteOrNull(rsUniverse), rsRating: finiteOrNull(rsBenchmark),
    rsCountryPct: ..., rsSectorPct: ..., rsQualityScore: ...,
    weinsteinScore: ..., minerviniScore: ..., riskScore: ..., weaknessScore: ..., dataCoverageScore: ...,
    percentileScope: ..., lastDate: ..., priceFreshnessDays: ..., priceFreshnessLabel: ..., priceFreshnessIssue: ...,
    price: ..., sma50: ..., sma150: ..., sma200: ..., sma200Slope: ...,
    perf3m: ..., perf6m: ..., perf12m: ..., distance20d: ..., distance50d: ..., distance52w: ..., extSma50: ...,
    avgTurnover: ..., marketCap: ..., currency: ..., ipoScore: ..., ipoDate: ..., chartProvider: ...,
    setupQualityScore: ..., patternQualityScore: ..., patternDataStatus: ..., patternEligible: ..., patternFamily: ..., patternMaturity: ...,
    ...publicMethodologyFields(reliability),
    vcpCandidate: ..., breakoutAttempt: ..., pivotSqueeze: ..., failedBreakout: ...,
    distanceToPivotPct: ..., baseDepthPct: ..., contractionCount: ..., volumeDryUpRatio: ...,
    sourceScanCreatedAt: row.sourceScanCreatedAt || "",
  };
}
```

Es una lista **cerrada, escrita a mano**. No hay `chartPreview`. No hay
`weeklyStageState` ni `weeklyStageLabel`. No hay `weeklyStage` (el objeto
completo). El comentario de cabecera del propio endpoint explica por qué
esta lista existe:

```js
// app/api/leaderboards/route.js:49-56
function apiPayload(payload = {}) {
  return {
    ok: true,
    legalMode: "derived-signals-only",
    note: "Leaderboards exponen rankings y metricas derivadas desde scans guardados; no publican universos completos ni datasets OHLCV crudos.",
    ...payload,
  };
}
```

`publicItem()` es la proyección "solo señales derivadas" de un endpoint
pensado para leaderboards **públicos** con una restricción legal explícita
de no republicar series de precios crudas. Eso es correcto para lo que fue
diseñado. El problema es que `loadCachedScreenerPreview` reutiliza esa
misma proyección para rellenar la tabla interactiva del screener —una
superficie que sí necesita la miniatura y la etapa— sin adaptarla.

## 3.4 ¿Y el RS? Aquí el código dice que SÍ debería funcionar

A diferencia de miniatura y etapa, el RS semanal **sí se re-hidrata** justo
después de construir los `publicItem()`:

```js
// app/api/leaderboards/route.js:103-118
async function withWeeklyRsItems(leaderboard) {
  if (!leaderboard || !Array.isArray(leaderboard.items) || !leaderboard.items.length) return leaderboard;
  const withRs = await hydrateRowsWithWeeklyRs(leaderboard.items);
  const caps = await readMarketCapForSymbols(withRs.map((item) => item?.symbol).filter(Boolean))
    .catch(() => ({ configured: false, bySymbol: new Map() }));
  return { ...leaderboard, items: withRs.map((item) => attachCachedMarketCap(item, caps.bySymbol)) };
}
```

Esto se llama en **las tres ramas de salida** de `GET /api/leaderboards`
(snapshot materializado, fallback de degradación, y la ruta normal —
`app/api/leaderboards/route.js:158, 180, 209`). `attachWeeklyRs` añade
`weeklyRsAvailable`/`weeklyRsRating` **encima** del objeto que ya devolvió
`publicItem()`, como propiedades planas nuevas — y como no están en ninguna
de las listas cerradas de `normalizeCachedScreenerRow`
(`NUMERIC_FIELDS`/`TEXT_FIELDS`/`BOOLEAN_FIELDS`, `lib/cachedScreenerRows.js:59-174`),
el spread inicial `{ ...metrics, ...raw, ...item, ... }` las conserva sin
tocar.

**Verificado en vivo** (servidor de desarrollo local, lectura, sin efectos
secundarios) contra un spec que sí usa el snapshot materializado:

```
GET /api/leaderboards?strategy=momentum&limit=10&maxRows=5&sinceDays=45&key=global-momentum
```

Primer elemento devuelto (símbolo `APGE`): trae `weeklyRsAvailable: true`,
`weeklyRsRating: 97`, `weeklyRsAsOf: "2026-08-09"`, etc. — **y en la lista
completa de 84 claves de esa fila no aparece `chartPreview` ni
`weeklyStageState`/`weeklyStageLabel` en ningún sitio.** Esto confirma con
una respuesta real: la hidratación de RS funciona; la ausencia de miniatura
y etapa es estructural, no un fallo puntual.

Así que si el RS también apareció en guion para las 50 filas del caso
reportado, la explicación más probable no es que `withWeeklyRsItems` esté
roto en general (se ha demostrado que no lo está cuando hay filas), sino
una de estas dos:

- Los 50 símbolos concretos que devolvió esa consulta `strategy=composite`
  no estaban en `rs_weekly_items` (posible si el ranking de "score
  compuesto" saca nombres pequeños o recién llegados que aún no entran en
  el ranking semanal de 4.868 símbolos).
- La lectura de `scan_results` que alimenta a `buildLeaderboard` (la RPC
  `leaderboard_publishable_rows`) ya estaba degradada en ese momento — ver
  Parte 6, donde se demuestra que **ahora mismo** esa RPC devuelve 0 filas.

No he podido determinar cuál de las dos, porque no tengo forma de volver al
estado exacto de la base en el momento en que se hizo la observación
original (ver "LO QUE NO HE VERIFICADO").

---

# PARTE 5 — De dónde sale "0 analizadas"

```js
// app/components/screener/ScreenerShell.jsx:558-562
<div className="resultsTitleBlock">
  <span>Results</span>
  <h2>{resultsFiltered.length} resultados</h2>
  <p>{resultsRows.length} pasan · {analyzedCountForDisplay(analyzedRows)} analizadas · {SORT_LABELS[sort] || sort}{scannedAtLabel ? ` · scan ${scannedAtLabel}` : ""}</p>
</div>
```

```js
// lib/screenerFormat.js:67-69
export function analyzedCountForDisplay(analyzedRows) {
  return Array.isArray(analyzedRows) ? analyzedRows.length : 0;
}
```

Esta es literalmente la cabecera "50 pasan · 0 analizadas" que describe el
encargo: `resultsRows.length` (que sale de `rows`) da 50, `analyzedRows.length`
da 0.

`analyzedRows` se resetea al principio de **cada** ejecución:

```js
// app/page.jsx:1310-1322 (run())
scanAbortRef.current = false;
resultsOwnerRef.current = "scan";
setRunning(true);
setPendingResults(null);
setAnalyzedRows([]);
setScanContext(null);
setScanPerf(null);
```

Y solo se rellena de nuevo **al terminar** el escaneo en servidor, después
de todo el bucle de sondeo:

```js
// app/page.jsx:1470 (tras el bucle while de polling a GET /api/scan)
setAnalyzedRows(rawRows);
```

Entre esos dos puntos, `rows` sí se actualiza en cuanto llega algo que
mostrar —incluida la vista previa cacheada (`setRows(cachePreview.rows)`,
Parte 3.2)— pero `analyzedRows` se queda en `[]` hasta que el escaneo de
verdad termine. Esto explica el contador con dos matices importantes:

- **Es cosmético y transitorio durante un escaneo en vivo normal**: si se
  mira la pantalla a mitad de un escaneo real (sin vista previa cacheada),
  también se vería "N pasan · 0 analizadas" durante un rato, y se corrige
  solo al terminar. Ese caso sí tendría miniatura/etapa/RS completos,
  porque esas filas parciales SÍ vienen de `GET /api/scan` (ver Parte 1).
- **Es persistente mientras la vista previa cacheada esté en pantalla y el
  escaneo real siga corriendo detrás**: aquí es donde coincide con filas
  estructuralmente incompletas, porque esas 50 filas nunca pasaron por
  `GET /api/scan` — vinieron de `/api/leaderboards`.

La combinación exacta que describe el encargo —contador en cero **y**
miniatura/etapa/RS ausentes a la vez, en las 50 filas— solo la produce la
rama de la vista previa cacheada. Un escaneo en vivo a mitad de camino
también daría el contador en cero, pero no las filas incompletas.

---

# PARTE 6 — Hallazgo adicional en vivo: la RPC de leaderboards está rota ahora mismo

No estaba en el encargo, pero apareció al intentar reproducir el escenario
y merece constar porque afecta directamente a la ruta señalada como
sospechosa (Parte 3-4).

## 6.1 La cadena de causalidad

`buildLeaderboard` (y por tanto `loadCachedScreenerPreview`) no lee
`scan_results` directamente: pasa por `readScanRows`, que llama a una RPC
de Postgres:

```js
// lib/leaderboards.js:713-744
export async function readScanRows({ maxRows = DEFAULT_SCAN_ROWS, sinceDays = 45, timeoutMs = DEFAULT_SCAN_READ_TIMEOUT_MS } = {}) {
  ...
  const rpcPayload = await supabaseRpc("leaderboard_publishable_rows", {
    p_owner_id: config.ownerId,
    p_max_rows: limit,
    p_since_days: since,
  }, { timeoutMs });
  ...
}
```

Y la RPC (`supabase/migrations/20260710180000_leaderboard_publishable_rows.sql:52-79`):

```sql
with scoped as (
  select sr.id, ..., s.settings -> 'progress' ->> 'status' as parent_status
  from public.scan_results as sr
  join public.scans as s on s.id = sr.scan_id
  where sr.owner_id = p_owner_id
    and sr.created_at >= (now() - make_interval(days => greatest(coalesce(p_since_days, 45), 1)))
  order by sr.created_at desc
  limit greatest(1, least(coalesce(p_max_rows, 5000), 10000))
)
select jsonb_build_object(
  'rows', coalesce((
    select jsonb_agg(...)
    from scoped as x
    where x.parent_status in ('complete', 'partial', 'done')
  ), '[]'::jsonb),
  ...
```

El orden de operaciones es: **primero** coge las `p_max_rows` filas más
recientes de `scan_results` de cualquier escaneo (`order by created_at desc
limit p_max_rows`), **después** descarta las que pertenezcan a un escaneo
no publicable (`error`, `cancelled`, `failed`). Si las filas más recientes
de toda la tabla pertenecen a un escaneo que falló, el `LIMIT` se agota
enteramente en filas que luego se van a descartar, y no llega a mirar
ninguna fila más antigua que sí sea publicable — aunque existan de sobra.

## 6.2 Evidencia: el escaneo que está envenenando la ventana

```
table: scans
select: id,name,created_at,row_count,progress:settings->progress
order: created_at.desc
limit: 15
```

La fila más reciente de toda la tabla:

```json
{
  "id": "2e210d72-1a2e-492d-be02-7ff792a40d8f",
  "name": "Scan servidor 2026-08-13T23:55:43.827Z",
  "created_at": "2026-08-13T23:55:44.414009+00:00",
  "row_count": 1194,
  "progress": { "status": "error", "error": "canceling statement due to statement timeout", ... }
}
```

**1.194 filas**, `status: "error"` → nunca publicable. Sus filas de
`scan_results` se escribieron entre `23:55:44` y `23:57:29` (dos minutos),
así que son, con mucha diferencia, las más recientes por `created_at` de
toda la tabla — por delante de escaneos publicables anteriores como
`f2d86829` (23:35, `complete`, 13 filas), `8c2b05dd` (05:03 del día 13,
`partial`, 75 filas) o `dd54b3fc` (9.918 filas, `partial`).

`DEFAULT_LEADERBOARD_SCAN_ROWS` es 900 (`lib/leaderboards.js` /
`app/api/leaderboards/route.js:7,10`, sin variable de entorno que lo eleve
— comprobado, no hay `LEADERBOARD_MAX_SCAN_ROWS` en `.env.local`). Con
`p_max_rows` topado en 900 y el escaneo fallido aportando 1.194 filas más
recientes que cualquier otra cosa, la CTE `scoped` se llena entera con
filas de `2e210d72` — todas con `parent_status = 'error'` — y el filtro
final no deja pasar ninguna.

## 6.3 Reproducido en vivo

```
GET /api/leaderboards?strategy=composite&limit=50&maxRows=900&sinceDays=45
→ "inputRows": 0, "leaderboard": { "count": 0, "items": [] }
```

```
GET /api/leaderboards?strategy=composite&limit=50&maxRows=120&sinceDays=14&country=US
→ "count": 0, "keysDeFilaEjemplo": []
```

Con los parámetros exactos que usa `cachedScreenerQuery`
(`maxRows=120&sinceDays=14`), la respuesta viene vacía. Con el máximo
permitido por la ruta (`maxRows=900`, tope de `MAX_LEADERBOARD_SCAN_ROWS`),
también.

`strategy=composite` **nunca** puede caer en el snapshot materializado
diario que sí funciona (comprobado: `DEFAULT_LEADERBOARD_SPECS`,
`lib/leaderboards.js:76-82`, no tiene ningún spec con `strategy: "composite"`,
así que `cacheSpec` siempre sale `null` para esta consulta y
`canUseMaterialized` siempre es `false` — `app/api/leaderboards/route.js:147-151`).
Es decir: **la vista previa cacheada del screener depende, sin posibilidad
de fallback, de esta RPC**, y ahora mismo esa RPC está devolviendo cero
filas por el escaneo fallido de las 23:55.

## 6.4 Qué significa esto para el bug reportado

Con el estado actual de la base, `loadCachedScreenerPreview()` no
devolvería 50 filas incompletas — devolvería **cero** filas, y el código
seguiría de largo hacia el escaneo real sin pasar por la rama de la Parte
3.2. Esto no contradice el diagnóstico de las Partes 3-5: significa que el
escenario exacto que se reportó (50 filas, ninguna con RS) se dio en un
momento **anterior** a las 23:55 del 13 de agosto, cuando esta RPC
probablemente sí devolvía filas — y ese momento anterior sigue sin explicar
por sí solo por qué el RS también faltaba en las 50 (Parte 3.4). Son dos
fallos relacionados por la misma ruta pero no idénticos:

- **Fallo A (estructural, permanente hasta que se corrija)**: `publicItem()`
  nunca lleva miniatura ni etapa. Esto es así SIEMPRE que la vista previa
  cacheada devuelva alguna fila, no depende del momento.
- **Fallo B (nuevo, encontrado hoy)**: la RPC `leaderboard_publishable_rows`
  puede devolver cero filas publicables aunque existan de sobra, si el
  escaneo más reciente de la tabla falló y tenía más filas que el límite de
  lectura. Esto es intermitente: depende de qué escaneo se haya guardado en
  último lugar.

---

# PARTE 7 — Comparación con `/api/scans`, la ruta que sí funciona

`GET /api/scans` (y el `scanFromDb`/`scanPayload` que usa) no reconstruye
la fila a mano campo por campo: hace un **merge total** de `raw` y
`metrics`, con `metrics` ganando si hay conflicto:

```js
// lib/scanDecisionProjection.js:150-165 (scanDecisionRowFromDb)
export function scanDecisionRowFromDb(item = {}, { decisionProjection = false } = {}) {
  const raw = objectOrEmpty(item.raw);
  const metrics = objectOrEmpty(item.metrics);
  const row = {};
  assignPresent(row, raw);
  assignPresent(row, metrics);
  assignPresent(row, { symbol: item.symbol, companyName: item.company_name, ... });
  ...
```

```js
// lib/scanDecisionProjection.js:143-148 (assignPresent)
function assignPresent(target, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) target[key] = value;
  }
  return target;
}
```

`assignPresent` copia **todas** las claves presentes en el objeto de
origen, sin lista cerrada. Así que cualquier campo que exista en `raw` o en
`metrics` —incluidos `chartPreview` y `weeklyStageState`— llega a la fila
final. Es la misma filosofía que usa `GET /api/scan` (Parte 1): "copia
todo, no cures nada". `withWeeklyRsItems` se aplica igual sobre las filas
que sirve `/api/scans` (`app/api/scans/route.js:240-260`, ya documentado en
la tarea del 13 de agosto).

`publicItem()`, en cambio, es una **proyección de campos elegidos a mano**.
Esa es la diferencia estructural exacta entre las dos rutas: una copia
(`assignPresent`/`{...raw, ...metrics}`), la otra reconstruye
(`return { rank, symbol, ... }` con cada campo escrito literalmente). La
primera hereda automáticamente cualquier campo nuevo que se añada a `raw` o
`metrics` en el futuro; la segunda no — hay que acordarse de añadirlo a
mano, y miniatura y etapa nunca se añadieron porque `publicItem()` no se
diseñó para alimentar la tabla del screener, se diseñó para leaderboards
públicos.

---

# Respuestas directas a las siete preguntas del encargo

1. **¿Qué devuelve `GET /api/scan` y qué falta?** Nada falta. Devuelve
   `item.raw` de `scan_results` sin recortar, con `chartPreview`,
   `weeklyStageState`/`weeklyStageLabel` y (tras `hydrateRowsWithWeeklyRs`)
   `weeklyRsAvailable`/`weeklyRsRating`. Verificado leyendo el código y con
   una fila real de producción.

2. **¿`raw` está compactado o recortado por el camino?** Se compacta **al
   escribir** (`scanDecisionRaw`: quita `objectiveMetricAudit`/`decisionTrace`,
   comprime `chartPreview` a 48 puntos) — ninguna de esas podas afecta a lo
   que falta en pantalla. **Al leer, `GET /api/scan` no recorta nada más.**

3. **¿Por qué falta `chartPreview` si está en la base?** Porque las 50
   filas que se vieron probablemente no vinieron de `GET /api/scan`, sino
   de `loadCachedScreenerPreview()` → `GET /api/leaderboards` → `publicItem()`,
   una proyección que nunca ha incluido `chartPreview`.

4. **Lo mismo con etapa y RS.** Etapa: igual que el punto 3, `publicItem()`
   nunca incluye `weeklyStageState`/`weeklyStageLabel`. RS: el código SÍ lo
   re-hidrata (`withWeeklyRsItems`) y se ha comprobado en vivo que funciona
   cuando hay filas que hidratar — pero la misma RPC de la que depende esa
   ruta está devolviendo 0 filas ahora mismo por un motivo distinto
   (Parte 6), y no he podido confirmar el estado exacto de esa RPC en el
   momento en que se observó el bug original.

5. **¿De dónde sale "0 analizadas"?** De `analyzedCountForDisplay(analyzedRows)`
   en la cabecera de resultados. `analyzedRows` se resetea a `[]` al
   empezar cada ejecución y solo se rellena al terminar el escaneo real;
   la vista previa cacheada llena `rows` pero nunca `analyzedRows`.

6. **¿Hay más campos que se pierdan sin notarse?** Sí, muchos — la lista de
   `publicItem()` tiene ~55 claves elegidas a mano (más 9 de `weeklyRs*` y
   la capitalización re-hidratada) frente a las ~260 que trae una fila
   completa. Los que importan para la METODOLOGÍA de filtrado (RS,
   volumen, patrón) siguen filtrando bien server-side porque
   `buildLeaderboard` filtra sobre la fila completa (`rowFromScanResult`,
   `lib/leaderboards.js:367-...`, que sí hace `{...metrics, ...raw}`) antes
   de reducirla con `publicItem()` al final. Lo que se pierde es solo lo
   que la RESPUESTA expone al cliente: además de miniatura y etapa, no
   viajan `upVolume`, `relativeVolume`, `volumeSurgePct`, `upDownVolRatio`,
   `shortPercentOfFloat`, `signalCoverage`, `growthMetrics`,
   `businessSummary`/`businessEs`, `objectiveMetricAudit`, `decisionTrace`,
   `contractionSwings`/`measuredContractionSwings`, `distanceATH`,
   `weeklyFastMa`/`weeklySlowMa`, ni el objeto `weeklyStage` completo. Hoy
   eso no se nota en la tabla de siete columnas porque ninguna de las otras
   seis (aparte de etapa y miniatura) los necesita — pero si alguna vez se
   añade una columna o un `MissingValue` que lea uno de esos campos, se
   romperá en silencio exactamente igual para las filas que vienen de esta
   ruta.

7. **Comparación con `/api/scans`.** Esa ruta reconstruye la fila con
   `scanDecisionRowFromDb`, que hace `assignPresent(row, raw)` seguido de
   `assignPresent(row, metrics)` — copia todo lo que exista, sin lista
   cerrada. `/api/leaderboards` reconstruye con `publicItem()`, una lista
   de campos escrita a mano y pensada para un endpoint público con
   restricción legal explícita de no exponer series de precios. Esa es la
   diferencia estructural entre "la ruta que funciona" y "la ruta que
   produce filas incompletas".

## Si el fallo estuviera en la escritura, no en la lectura

No es el caso aquí — la Parte 1 y 2 confirman que la escritura del escaneo
en vivo (`lib/serverScanRunner.js` → `scan_results.raw`) guarda todo lo
necesario, y la Parte 7 confirma que `/api/scans` lee ese mismo dato
completo sin problema. El fallo está enteramente en una ruta de LECTURA
distinta (`/api/leaderboards`) que nunca tuvo esos campos en su contrato, y
en cómo el cliente (`app/page.jsx`) la usa como si los tuviera.

---

# CONFIANZA

## Verificado leyendo código, con cita literal

- La traza completa de `GET /api/scan` (Parte 1), `scanDecisionRaw`/
  `compactChartPreview` (Parte 2), `publicItem()` y su falta de
  `chartPreview`/`weeklyStageState` (Parte 3.3), `withWeeklyRsItems` y su
  llamada en las tres ramas de `GET /api/leaderboards` (Parte 3.4), el
  origen de "0 analizadas" en `ScreenerShell.jsx`/`app/page.jsx` (Parte 5),
  la RPC `leaderboard_publishable_rows` (Parte 6.1), y la comparación con
  `scanDecisionRowFromDb`/`assignPresent` de `/api/scans` (Parte 7).
- Que `strategy=composite` nunca puede usar el snapshot materializado:
  confirmado leyendo `DEFAULT_LEADERBOARD_SPECS` (5 entradas, ninguna con
  `strategy: "composite"`) y la condición `canUseMaterialized` en
  `app/api/leaderboards/route.js:147-151`.
- `MAX_LIMIT = 50` en `lib/leaderboards.js:10` y `limit: "50"` en
  `cachedScreenerQuery` (`lib/screenerPipeline.js:65`): el "50" del
  encargo coincide con ambos.

## Verificado con datos reales de producción (solo lectura)

```
table: scan_results
select: symbol,rank_index,raw
filter: scan_id=eq.dd54b3fc-20fe-4c22-a93a-1c834167b955&rank_index=eq.1
→ 1 fila, raw con chartPreview/weeklyStageState/weeklyStage completos
```

```
table: scans
select: id,name,created_at,row_count,progress:settings->progress
order: created_at.desc
limit: 15
→ confirma 2e210d72 (1.194 filas, status "error", la más reciente de toda la tabla)
```

```
table: rs_weekly_items
select: symbol,snapshot_date,rs_rating,engine_version
filter: symbol=in.(AAPL,MSFT,NVDA)
→ confirma que hay RS semanal reciente (2026-08-09) para símbolos grandes de EEUU
```

## Verificado en vivo contra el servidor de desarrollo (solo lectura, sin efectos)

```
GET /api/leaderboards?strategy=momentum&limit=10&maxRows=5&sinceDays=45&key=global-momentum
→ source: "leaderboard_snapshots", 10 items, cada uno con weeklyRsAvailable/weeklyRsRating
  presentes y SIN chartPreview ni weeklyStageState en ninguna de sus 84 claves.
```

```
GET /api/leaderboards?strategy=composite&limit=50&maxRows=900&sinceDays=45
GET /api/leaderboards?strategy=composite&limit=50&maxRows=120&sinceDays=14&country=US
→ ambas: inputRows 0, leaderboard.items vacío. Reproduce el Fallo B en vivo,
  ahora mismo, con los parámetros exactos que usa la vista previa del screener.
```

No se ha ejecutado ningún escaneo, no se ha escrito nada: todas las
llamadas anteriores son `GET` de solo lectura contra rutas ya existentes.

# LO QUE NO HE VERIFICADO

- **El estado exacto de la base en el momento en que se observó el bug
  original.** El escaneo `2e210d72` que envenena la RPC ahora mismo se creó
  a las 23:55:44 UTC del 13 de agosto. No sé si la observación del encargo
  se hizo antes o después de esa hora, así que no puedo confirmar si en ese
  momento `loadCachedScreenerPreview()` devolvía 0 filas (como ahora) o 50
  (como describe el reporte). Lo que sí está confirmado con independencia
  de la hora exacta es que, **cuando** esa ruta devuelve filas, nunca
  llevan miniatura ni etapa.
- **Por qué el RS faltaba en las 50 filas concretas del reporte.** El
  mecanismo de hidratación (`withWeeklyRsItems`) funciona cuando se prueba
  en vivo con otro spec. No he podido reproducir el caso exacto
  `strategy=composite` con resultados no vacíos para comprobar si esas
  filas concretas también traían RS o no — la RPC lo impide ahora mismo
  (Fallo B). Quedan dos hipótesis abiertas sin decidir entre ellas
  (Parte 3.4): símbolos fuera del ranking semanal, o la RPC ya degradada
  en ese momento por otro motivo.
- **No he abierto el navegador para reproducir la interfaz.** Las citas de
  `ScreenerShell.jsx`/`screenerColumns.jsx` explican qué debería pintarse
  dado un estado de datos, verificado leyendo el código de renderizado —
  no se ha tomado ninguna captura de pantalla del bug reproducido en vivo.
- **No he medido cuánto tiempo suele tardar el escaneo real en alcanzar el
  punto donde `setAnalyzedRows(rawRows)` sustituye a la vista previa.** Si
  ese tiempo es corto, el bug sería casi imperceptible en la práctica salvo
  que el usuario mire la pantalla justo en la ventana inicial; si es largo
  (escaneo de universo completo), la ventana de filas incompletas puede
  durar minutos. No se cronometró.
- **No he revisado si otras superficies que también llaman a
  `/api/leaderboards`** (la propia página de leaderboards, `app/lists`,
  etc.) sufren el mismo Fallo B con sus propios parámetros — solo se probó
  con los parámetros exactos de `cachedScreenerQuery` y con un ejemplo de
  spec materializado para contraste. El Fallo A (campos ausentes en
  `publicItem()`) sí es universal a cualquier consumidor de esa función,
  por construcción del código, con o sin necesidad de probarlo en cada
  superficie.
- **No he propuesto ni evaluado ninguna solución.** Fuera del alcance de
  esta tarea, tal y como se pidió.
