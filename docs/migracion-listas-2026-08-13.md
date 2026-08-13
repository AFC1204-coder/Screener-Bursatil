# Listas: de dónde lee, de dónde debería leer y cómo mostrar la fecha

> **Actualización del mismo 2026-08-13, tras aplicar la caducidad de caché.**
> El diagnóstico se confirmó con evidencia directa y dos afirmaciones suyas
> resultaron equivocadas. Ambas están corregidas en el sitio donde
> aparecían (§6 y §7.1), y el detalle está en §12 al final. En resumen:
> la fila congelada del 20 de junio **existía** —la API la reporta ahora
> con `ageHours: 1306.4`—, y "Deterioro técnico" **no sale vacía**: saca
> tres valores de Hong Kong, que es peor de lo que este documento predijo.

Fecha: 2026-08-13
Rama: `codex/statsedge-ui-polish` · BASE_SHA `07cca5f`
Alcance: **solo Listas** (`/lists`). Sectores y Salud de mercado se tratan
al final, únicamente para decir si el patrón les sirve.
Naturaleza: **diagnóstico y diseño. No se ha modificado ni una línea de
código, ni se ha escrito nada en Supabase, ni se ha lanzado ningún
escaneo.**

---

## Resumen en cinco líneas

Listas no lee un escaneo viejo: lee un **resultado ya cocinado y
guardado el 20 de junio de 2026 a las 10:15 UTC**, que nadie ha vuelto a
generar desde entonces. Ese resultado congelado contiene **seis valores
en total** para repartir entre nueve secciones, y por eso las mismas tres
acciones aparecen una y otra vez. El trabajo que lo generaba
(`/api/jobs/discovery-refresh`) **no está programado en ningún cron**:
corrió dos veces el 20 de junio, a mano, y nunca más. Mientras tanto, el
escaneo nocturno deja cada madrugada 75 valores frescos con barras del
cierre anterior, y ninguna pantalla los mira. Y la fecha "21/5/2026" que
el evaluador vio en Listas no es ni una cosa ni la otra: es una copia
guardada en el navegador de quien evaluó.

Es decir: **sí, Listas lee de una fuente que ya no se alimenta.** Es un
problema distinto del que parecía.

---

# PARTE A — De dónde lee hoy

## 1. Qué consulta hace la página al cargar

Listas es un componente de cliente (`"use client"`,
[app/lists/page.jsx:1](../app/lists/page.jsx)). Al montarse hace
exactamente **tres** tipos de lectura. Ni una más.

### 1.1 Lectura del navegador (`localStorage`) — inmediata

[app/lists/page.jsx:455-469](../app/lists/page.jsx#L455):

```js
useEffect(() => {
    const storedScans = safeRead(STORAGE_KEYS.scans, []);
    const loadedScans = (Array.isArray(storedScans) ? storedScans : []).filter((scan) => scan?.id !== "seed-scan-01");
    const loadedFavorites = safeRead(STORAGE_KEYS.favorites, []);
    const loadedListViews = normalizeSavedListViews(safeRead(STORAGE_KEYS.listViews, []));
    const loadedReview = safeRead(STORAGE_KEYS.review, {});
```

No toca ninguna tabla. Lee cuatro claves del `localStorage` del
navegador: escaneos guardados, favoritos, vistas guardadas y
resoluciones de revisión.

De aquí sale la fecha que el evaluador citó como
**"último snapshot local 21/5/2026"** —
[app/lists/page.jsx:679](../app/lists/page.jsx#L679):

```jsx
<div className="kpi"><b>{loaded && latest ? new Date(latest.createdAt).toLocaleDateString() : "-"}</b><span>ultimo snapshot local</span></div>
```

donde `latest = scans[0]` ([línea 519](../app/lists/page.jsx#L519)), o
sea el primer elemento del array de `localStorage`. **Esa fecha no
describe los datos que se están viendo en la tabla.** Describe la última
vez que ese navegador guardó un escaneo. Es un dato del dispositivo, no
del producto.

### 1.2 Lectura del ranking (`/api/discovery`) — a los 1,4 s

[app/lists/page.jsx:492-517](../app/lists/page.jsx#L492):

```js
const timer = window.setTimeout(() => {
      if (!alive) return;
      fetchJsonWithTimeout(scopedDiscoveryPath(filter), 8000)
```

Con la ruta construida en
[app/lists/page.jsx:49-63](../app/lists/page.jsx#L49):

```js
function scopedDiscoveryPath(filter = {}) {
  const params = new URLSearchParams({
    limit: "20",
    groupItemLimit: "8",
    groupsLimit: "12",
    maxRows: "80",
    sinceDays: "10",
    minGroupSize: "1",
  });
```

La petición literal, sin filtro de grupo, es:

```
GET /api/discovery?limit=20&groupItemLimit=8&groupsLimit=12&maxRows=80&sinceDays=10&minGroupSize=1
```

Retén esos seis parámetros. Son la causa del problema — no por lo que
piden, sino por con qué coinciden.

### 1.3 Lectura de gráficos (`/api/chart`) — por lotes de cuatro

[app/lists/page.jsx:616-618](../app/lists/page.jsx#L616):

```js
await Promise.all(batch.map(async (symbol) => {
          try {
            const data = await getJson(`/api/chart?symbol=${encodeURIComponent(symbol)}`, { timeoutMs: 12000 });
```

Solo para dibujar las miniaturas de los tickers ya visibles. No influye
en qué valores salen ni en qué fecha se muestra.

### 1.4 La cadena completa, con tablas

| Paso | Archivo:línea | Qué toca |
|---|---|---|
| Página | [app/lists/page.jsx:499](../app/lists/page.jsx#L499) | `GET /api/discovery?…` |
| Ruta API | [app/api/discovery/route.js:122-134](../app/api/discovery/route.js#L122) | **primero** la caché |
| Caché | [lib/discoveryCache.js:55-77](../lib/discoveryCache.js#L55) | tabla `leaderboard_snapshots` |
| Solo si la caché falla | [app/api/discovery/route.js:136](../app/api/discovery/route.js#L136) | `readScanRows` |
| Lectura viva | [lib/leaderboards.js:723-731](../lib/leaderboards.js#L723) | RPC `leaderboard_publishable_rows` |
| La RPC | [supabase/migrations/20260710180000_leaderboard_publishable_rows.sql:73-74](../supabase/migrations/20260710180000_leaderboard_publishable_rows.sql#L73) | `scan_results` ⋈ `scans` |

El detalle decisivo es el orden: **la caché va primero y, si contesta,
la lectura viva no llega a ejecutarse nunca.**

---

## 2. Por qué muestra datos de mayo (en realidad, de junio)

### 2.1 La caché se sirve siempre, y no caduca

[app/api/discovery/route.js:119-134](../app/api/discovery/route.js#L119):

```js
export async function GET(request) {
  const params = paramsFromRequest(request);
  try {
    const cacheKey = discoveryCacheKeyForParams(params);
    if (cacheKey) {
      const cached = await readMaterializedDiscoverySnapshot(cacheKey).catch(() => null);
      if (cached?.payload) {
        return Response.json(apiPayload({
          configured: true,
          ...cached.payload,
```

`readMaterializedDiscoverySnapshot`
([lib/discoveryCache.js:55-77](../lib/discoveryCache.js#L55)) hace esto:

```js
  const snapshots = await supabaseRequest("leaderboard_snapshots", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&leaderboard_key=eq.${encodeURIComponent(key)}&select=*&order=generated_at.desc&limit=1`,
    timeoutMs: 1500,
  });
```

Lee **la fila más reciente que exista, sea de cuando sea**. No hay
comparación con `now()`, no hay TTL, no hay umbral de antigüedad, no hay
ninguna condición que diga "si esto tiene más de N días, ignóralo". Si
la fila existe, se devuelve. Punto.

### 2.2 Listas encaja con la caché por accidente de parámetros

[lib/discoveryCache.js:11-24](../lib/discoveryCache.js#L11) declara la
especificación:

```js
export const DISCOVERY_CACHE_SPECS = [
  {
    key: "discovery:interactive:v1",
    title: "Discovery interactivo",
    params: { limit: "20", groupItemLimit: "8", groupsLimit: "12", minGroupSize: "1" },
```

Y [lib/discoveryCache.js:41-48](../lib/discoveryCache.js#L41) decide si
una petición encaja:

```js
function matchesSpec(params = {}, spec = {}) {
  if (scopeKey(params) !== "global") return false;
  const specParams = spec.params || {};
  return intValue(params.limit, 25) === intValue(specParams.limit, 25)
    && intValue(params.groupItemLimit, 12) === intValue(specParams.groupItemLimit, 12)
    && intValue(params.groupsLimit, 50) === intValue(specParams.groupsLimit, 50)
    && intValue(params.minGroupSize, 2) === intValue(specParams.minGroupSize, 2);
}
```

Los cuatro parámetros que Listas manda (`limit=20`, `groupItemLimit=8`,
`groupsLimit=12`, `minGroupSize=1`) son **exactamente** los de la
especificación. Sin filtro de grupo, `scopeKey` es `"global"`. Encaja.

Fíjate en lo que `matchesSpec` **no** mira: `maxRows` y `sinceDays`.
Listas pide `sinceDays=10` — "dame datos de los últimos diez días" — y
recibe un payload de hace 54. El parámetro que expresa la frescura
deseada no participa en la decisión de servir caché.

### 2.3 Quién escribe esa caché: nadie, desde el 20 de junio

El único escritor es
[app/api/jobs/discovery-refresh/route.js:88](../app/api/jobs/discovery-refresh/route.js#L88):

```js
    const saved = await writeMaterializedDiscoverySnapshots(built.entries);
```

Búsqueda exhaustiva de invocaciones:

```bash
grep -rn "writeMaterializedDiscoverySnapshots\|buildDiscoveryCacheEntries\|DISCOVERY_CACHE_SPECS" app lib scripts .github
```

Resultado: solo el propio archivo de la ruta y `lib/discoveryCache.js`.
Nadie más la llama.

Y [vercel.json](../vercel.json) programa seis crons — `universe-refresh`,
`scan-refresh`, `shadow-europe-refresh`, `shadow-firds-refresh`,
`favorite-snapshots`, `leaderboards-refresh` — y **`discovery-refresh`
no está entre ellos**. Tampoco está en `.github/workflows/`, que solo
contiene `refresh-bars.yml` y `scan-universe.yml`.

Es un endpoint que solo corre si alguien lo llama con la mano.

### 2.4 La prueba en producción

Consulta exacta (MCP `supabase_query`, solo lectura):

```
table=provider_runs
select=*
filter=run_type=eq.discovery-refresh
order=started_at.desc
limit=5
```

Resultado completo — **dos filas, ninguna más**:

```json
[
 {"run_type":"discovery-refresh","status":"completed",
  "started_at":"2026-06-20T10:15:30.940718+00:00",
  "finished_at":"2026-06-20T10:15:35.837+00:00",
  "stats":{"saved":2,"inputRows":300,
           "snapshots":[{"key":"discovery:interactive:v1","count":6,
                         "snapshotId":"83f80f34-0b11-409e-938f-5adcc093fe67"},
                        {"key":"discovery:review:v1","count":6,
                         "snapshotId":"9e0db470-314e-4960-956a-a3b666b929b9"}]}},
 {"run_type":"discovery-refresh","status":"completed",
  "started_at":"2026-06-20T10:14:39.217068+00:00",
  "finished_at":"2026-06-20T10:14:53.941+00:00",
  "stats":{"saved":2,"inputRows":900, "…mismos dos snapshotId…"}}
]
```

Léelo despacio, porque ahí está todo:

- **`started_at` = 2026-06-20T10:15:30 UTC.** El evaluador vio
  "Discovery API 20/6/2026". Coincide al día. La fecha que ve viene de
  `generatedAt`, que `buildDiscoverySnapshot` sella con
  `new Date().toISOString()`
  ([lib/discovery.js:245](../lib/discovery.js#L245)) en el momento de
  construir el payload — es decir, ese instante del 20 de junio, guardado
  dentro del JSON y devuelto tal cual cada vez desde entonces.
- **`count: 6`.** Ese `count` es `snapshot.rows?.length`
  ([lib/discoveryCache.js:107](../lib/discoveryCache.js#L107)). **Seis
  filas.** Volveremos a este número en el punto 4.
- **`inputRows: 300`.** El trabajo leyó 300 filas de escaneo
  (`DEFAULT_CACHE_SCAN_ROWS = 300`,
  [lib/discoveryCache.js:7](../lib/discoveryCache.js#L7)) y de ellas
  sobrevivieron seis.
- **Solo dos ejecuciones, con 51 segundos de diferencia, ambas el mismo
  día.** El patrón de alguien probando el endpoint a mano una vez, no de
  un proceso programado.

Desde el 20 de junio hasta hoy, 13 de agosto, han pasado 54 días sin que
nadie regenere ese payload. Y la página lo sigue sirviendo.

### 2.5 Entonces, ¿lee "el más reciente" o "algo cacheado"?

**Algo cacheado, y ni siquiera cacheado con criterio de caducidad.** Es
un documento estático guardado en una tabla, servido indefinidamente.

Precisión importante: si la petición a Supabase falla o tarda más de
1.500 ms, `.catch(() => null)`
([app/api/discovery/route.js:124](../app/api/discovery/route.js#L124))
hace que el flujo continúe hacia la lectura viva. Es decir, **en un mal
día de red la página muestra datos frescos, y en un buen día muestra
junio.** El comportamiento correcto solo ocurre por accidente.

### 2.6 Y las tres fechas de mayo

Las fechas de mayo que citó el evaluador **no vienen de aquí**. Son de
`localStorage`:

- Listas, "último snapshot local 21/5/2026" →
  [app/lists/page.jsx:679](../app/lists/page.jsx#L679), campo
  `latest.createdAt` de `STORAGE_KEYS.scans`.
- Sectores, "Materialized scan 2026-05-21" →
  [app/sectors/page.jsx:430](../app/sectors/page.jsx#L430):
  `` `Snapshot · ${new Date(selectedScan.createdAt).toLocaleString()}` ``,
  también sobre escaneos de `localStorage`.
- Salud de mercado, "último snapshot · 21 may, 17:38" →
  [app/market-health/page.jsx:748](../app/market-health/page.jsx#L748),
  alimentado por
  [app/market-health/page.jsx:530](../app/market-health/page.jsx#L530):
  `setScanPulse(buildScanPulse(safeRead(STORAGE_KEYS.scans, [])))`.

Las tres son **la misma fecha del mismo navegador**, mostrada en tres
sitios. Por eso el evaluador contó cinco fechas: son en realidad tres
orígenes — el navegador (21 may), la caché congelada (20 jun) y las
barras reales (12 ago, la que sale en la ficha) — repartidos por cinco
sitios de la interfaz.

---

## 3. Qué es "Discovery API" y de dónde salen sus datos

"Discovery" es la capa que convierte filas crudas de escaneo en las
nueve listas temáticas y en los grupos por tema/sector/industria. Vive en
[lib/discovery.js](../lib/discovery.js) y se expone en
[app/api/discovery/route.js](../app/api/discovery/route.js).

Su declaración de intenciones está en
[app/api/discovery/route.js:35](../app/api/discovery/route.js#L35):

```js
    note: "Discovery expone listas y grupos derivados desde scans guardados; no publica universos completos ni OHLCV crudo.",
```

Las nueve listas están definidas en
[lib/discovery.js:13-23](../lib/discovery.js#L13):

```js
export const DISCOVERY_LIST_SPECS = [
  { key: "leaders", title: "Score compuesto", strategy: "composite" },
  { key: "rsQuality", title: "RS Quality Leaders", strategy: "rsQuality" },
  { key: "weakness", title: "Deterioro técnico", strategy: "weakness" },
  { key: "weinstein", title: "Tendencia establecida", strategy: "stage2" },
  { key: "minervini", title: "Rupturas con contracción", strategy: "minervini" },
  { key: "nearPivot", title: "Vigilancia pivot", strategy: "nearPivot" },
  { key: "ipo", title: "IPO / New Leaders", strategy: "ipo" },
  { key: "extended", title: "Extended but strong", strategy: "extended" },
  { key: "pullback", title: "Pullback to SMA50", strategy: "pullback" },
];
```

Sus datos, en el camino vivo (el que hoy casi nunca se ejecuta), salen de
`scan_results` filtrada por el estado del escaneo padre. La RPC
[supabase/migrations/20260710180000_leaderboard_publishable_rows.sql:73-78](../supabase/migrations/20260710180000_leaderboard_publishable_rows.sql#L73):

```sql
  from public.scan_results as sr
  join public.scans as s on s.id = sr.scan_id
  where sr.owner_id = p_owner_id
    and sr.created_at >= (now() - make_interval(days => greatest(coalesce(p_since_days, 45), 1)))
  order by sr.created_at desc
  limit greatest(1, least(coalesce(p_max_rows, 5000), 10000))
```

y luego, [línea 105](../supabase/migrations/20260710180000_leaderboard_publishable_rows.sql#L105):

```sql
    where x.parent_status in ('complete', 'partial', 'done')
```

Por qué aparece con fecha distinta del resto: porque **es el único
elemento de la pantalla cuya fecha describe cuándo se calculó el
ranking**, mientras las demás describen cuándo el navegador guardó algo.
Que difieran no es un fallo de presentación: es que efectivamente son
dos cosas distintas, y ninguna de las dos es "de cuándo son los precios".

---

## 4. Por qué tres secciones devuelven los mismos tres símbolos

La respuesta está en un solo número: `"count": 6`.

El payload congelado del 20 de junio contiene **seis filas únicas en
total** (`snapshot.rows`), obtenidas deduplicando lo que produjeron las
nueve listas
([lib/discovery.js:219](../lib/discovery.js#L219),
`const rows = dedupeDiscoveryRows(lists)`).

Con seis valores para nueve secciones, la repetición es aritmética, no
un fallo de filtrado. Y peor: las nueve listas comparten un mismo embudo
previo. Toda lista con sesgo alcista pasa por
[lib/leaderboards.js:417](../lib/leaderboards.js#L417):

```js
  if (longStrategy && !isLongOpportunityRow(row, { requireTrendTemplate: strictTrendStrategy })) return false;
```

Y antes de eso, por `basePasses`
([lib/leaderboards.js:394-406](../lib/leaderboards.js#L394)), que exige
frescura de precio y cobertura mínima. Si el embudo común deja pasar seis
valores, las ocho listas alcistas están escogiendo entre esos seis. Los
umbrales propios de cada lista
([lib/listRationale.js:144-172](../lib/listRationale.js#L144)) son
distintos entre sí —"RS Quality ≥ 55", "Minervini ≥ 60", "extensión sobre
SMA50 ≥ 15"— pero da igual lo distintos que sean si solo hay seis
candidatos.

**Conclusión matizada: las listas sí filtran, y filtran cosas
diferentes. Lo que no hay es población sobre la que filtrar.** El
síntoma "no filtran de verdad" es real, pero la causa no está en los
contratos: está en que el conjunto de entrada tiene seis elementos.

Comprobación de que el problema no es estructural, sino de fuente: con
los datos del nocturno de hoy (ver Parte B), los mismos contratos
producen conjuntos claramente distintos entre sí — y dos de ellos,
vacíos, que es información útil y honesta.

### 4.1 Hallazgo adicional (no pedido, pero relevante)

[app/lists/page.jsx:507](../app/lists/page.jsx#L507) usa
`userFacingServiceError`:

```js
          setDiscoveryError(userFacingServiceError(error?.message, RANKING_UNAVAILABLE));
```

pero **esa función no está importada en el archivo**. Los imports ocupan
las líneas 2-20 y no incluyen `@/lib/serviceErrors`; `grep -c
"serviceErrors" app/lists/page.jsx` devuelve `0`. Comparar con
[app/market-health/page.jsx:17](../app/market-health/page.jsx#L17), que
sí lo importa.

Consecuencia: cuando `/api/discovery` falla, el `catch` lanza un
`ReferenceError` dentro del propio manejador de errores. `setDiscovery(null)`
(línea 506) ya se ha ejecutado, así que la página cae al camino local,
pero el mensaje de error nunca se asigna y `discoveryLoading` se queda en
`true` porque el `.finally()` no llega a correr. La interfaz se queda
diciendo "Cargando" para siempre, sin explicar nada.

No lo he reproducido en navegador. Lo cito como lectura de código, y como
algo a arreglar en el mismo paso que toque este `useEffect`.

---

# PARTE B — De dónde debería leer

## 5. Fuentes disponibles hoy, con qué hay en cada una

### 5.1 El escaneo nocturno del universo estadounidense

- **Qué es:** `scripts/scan-universe.mjs`, disparado por
  `.github/workflows/scan-universe.yml` a las **03:00 UTC** diarias.
- **Dónde escribe:** `scans` + `scan_results`, con `local_id` que empieza
  por `materialized:US:`.
- **Qué contiene hoy.** Consulta:

  ```
  table=scans  select=id,created_at,local_id,settings->progress->>status,settings->progress->>saved
  order=created_at.desc  limit=20
  ```

  Fila más reciente:

  ```json
  {"id":"8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5",
   "created_at":"2026-08-13T05:03:38.193+00:00",
   "local_id":"materialized:US:2026-08-13:o0:l5608",
   "status":"partial","saved":"75"}
  ```

  El `l5608` del `local_id` es la población analizada; `saved: 75`, lo
  que pasó el preset. Coincide con el enunciado: 75 de 5.608.

  Hay uno cada día: `materialized:US:2026-08-12:o0:l5608` (75),
  `materialized:US:2026-08-12:o0:l3390` (51),
  `materialized:US:2026-08-11:o0:l5605` (97)…

- **Estado `partial` — importante:** la RPC publica
  `('complete','partial','done')`, así que **`partial` sí publica**. El
  nocturno no está bloqueado por ese filtro.

- **Calidad de las filas.** Consulta:

  ```
  table=scan_results
  select=symbol,metrics->>priceFreshnessDays,metrics->>lastDate,metrics->>dataCoverageScore,metrics->>percentileScope,metrics->>patternEligible
  filter=scan_id=eq.8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5
  order=total_score.desc  limit=10
  ```

  Las diez primeras, sin excepción:

  ```json
  {"symbol":"VCTR","priceFreshnessDays":"1","lastDate":"2026-08-12",
   "dataCoverageScore":"96","percentileScope":"batch","patternEligible":"true"}
  ```

  `priceFreshnessDays = 1`, `lastDate = 2026-08-12`, cobertura 94-96,
  `patternEligible: true`. **Pasan `basePasses` con holgura**
  (`maxPriceFreshnessDays` por defecto 5, `minCoverageScore` 40) y son
  `percentileScope: "batch"`, lo que las hace elegibles también para la
  vista curada.

- **Lo que NO trae — hallazgo relevante.** Consulta:

  ```
  table=scan_results
  select=symbol,metrics->>weeklyRsAvailable,metrics->>weeklyRsRating,metrics->>weeklyRsAsOf,raw->>weeklyRsRating
  filter=scan_id=eq.8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5  limit=6
  ```

  Todas las columnas `weeklyRs*` devuelven `null` en las seis filas
  consultadas. **El nocturno no hidrata el RS semanal canónico.** Lo que
  sí trae es `rsGlobalPct` (89, 91, 87, 94…), que es el percentil dentro
  del lote de 75 — precisamente lo que
  [lib/rsCanonical.js:16-19](../lib/rsCanonical.js#L16) prohíbe mostrar
  como RS:

  ```js
  //   2. `scan_results.rsGlobalPct` — percentil del símbolo DENTRO del lote de
  //      un escaneo concreto. Puede calcularse sobre 50 símbolos o sobre 9.916,
  //      cambia con cada escaneo y no es comparable con nada. Sigue existiendo
  //      y sigue alimentando el scoring (no se toca), pero NO es el RS y no
  //      puede mostrarse bajo esa etiqueta.
  ```

  Consecuencia práctica: si Listas pasa a leer el nocturno, la columna RS
  saldrá **ausente** con el motivo `RS_NOT_HYDRATED_REASON`. Es el
  comportamiento correcto por el principio 3, pero hay que saberlo antes
  de migrar, no descubrirlo después. Coincide con el hallazgo de
  severidad Alta ya registrado sobre benchmarks sin hidratar en escaneos
  batch.

### 5.2 Los escaneos del cron por mercados

- **Qué es:** `/api/cron/scan-refresh`, programado en
  [vercel.json](../vercel.json) a las 22:20 UTC.
- **Qué produce:** escaneos con `local_id` como
  `materialized:GB:2026-08-12:o0:l6` (1 fila guardada),
  `materialized:SG-ZA:2026-08-12:o36:l21` (18),
  `materialized:IT-ES:2026-08-11:o0:l12` (5),
  `materialized:CA:2026-08-11:o72:l24` (24),
  `materialized:TW:2026-08-10:o60:l20` (19),
  `materialized:JP:2026-08-09:o72:l1` (1).
- **Volumen:** entre 1 y 24 filas por corrida. Son ventanas rotativas
  minúsculas de mercados no estadounidenses.
- **Relevancia para el lanzamiento:** **ninguna.** El lanzamiento es solo
  Estados Unidos.

### 5.3 `rs_weekly_items`

- **Qué es:** el ranking semanal de fuerza relativa sobre el universo
  estadounidense, calculado por `scripts/rs-universe.mjs`.
- **Qué contiene.** Consulta:

  ```
  table=rs_weekly_items
  select=symbol,snapshot_date,week_key,engine_version,rank_index,rs_rating,sample_size
  order=snapshot_date.desc,rank_index.asc  limit=10
  ```

  ```json
  {"symbol":"MGRT","snapshot_date":"2026-08-09","week_key":"2026-W32",
   "engine_version":"statsedge-us-equity-rs-v1","rank_index":1,
   "rs_rating":99,"sample_size":4868}
  ```

  **4.868 símbolos, corte del 9 de agosto (semana 2026-W32).**
- **Estatus:** es la **fuente canónica del RS**
  ([lib/rsCanonical.js:27](../lib/rsCanonical.js#L27),
  `export const RS_CANONICAL_SOURCE = "rs_weekly_items"`). Ya hay lector
  por lotes en [lib/globalRs.js](../lib/globalRs.js) — no hay que
  escribir uno nuevo.
- **Cadencia:** semanal. Su fecha (9 ago) es legítimamente distinta de la
  de las barras (12 ago), y eso hay que decirlo, no ocultarlo.

### 5.4 Otras fuentes que existen y conviene tener en el mapa

| Fuente | Qué es | Sirve para Listas |
|---|---|---|
| `daily_bars` | barras diarias, refrescadas por `refresh-bars.yml` a las 02:00 UTC | indirectamente: alimenta el nocturno |
| `universe_snapshot_symbols` | población investable (~5.608 US) | denominador honesto para "75 de N" |
| `scan_symbol_history` | historia por símbolo entre escaneos | deltas noche a noche (fuera de alcance hoy) |
| `favorites` | watchlist del usuario | sí — la sección Favoritos ya vive de aquí |
| `fundamental_snapshots` | fundamentales del proveedor | no en Listas |
| `leaderboard_snapshots` | **la caché congelada** | hoy es el problema, no la fuente |
| Escaneos `server-scan-*` | escaneos interactivos del servidor | **ojo**, ver aviso abajo |

**Aviso sobre los escaneos interactivos.** En la consulta a `scans` hay
`server-scan-73a25c8c…` del 12/08 a las 23:29 con `saved: "9918"` y
estado `partial` — es decir, **publicable**. La RPC ordena por
`created_at desc` y corta con `limit`, así que si alguien lanza un
escaneo interactivo grande, **sus filas desplazan al nocturno** en
cualquier lectura con `maxRows` pequeño. Con `maxRows=80`, un escaneo
interactivo posterior al nocturno se lo come entero. Esto hay que
resolverlo al elegir fuente: no basta con "lee lo más reciente".

---

## 6. Fuente correcta para cada sección de Listas

Base de la recomendación: el escaneo nocturno más reciente **identificado
por su `local_id`**, no por ser el más reciente en general. Es decir,
seleccionar explícitamente el último `scans` cuyo `local_id` empiece por
`materialized:US:`, y leer sus `scan_results`. Eso lo hace inmune al
problema del escaneo interactivo que acabo de describir, y encaja con que
el lanzamiento sea solo Estados Unidos.

Para dimensionar cada sección he traído las 75 filas del nocturno de hoy
con las métricas que usan los contratos:

```
table=scan_results
select=symbol,metrics->>objectiveScore,metrics->>rsGlobalPct,metrics->>weinsteinScore,metrics->>minerviniScore,metrics->>rsQualityScore,metrics->>extSma50,metrics->>distance52w,metrics->>perf3m,metrics->>ipoAgeMonths,metrics->>distanceToPivotPct
filter=scan_id=eq.8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5
order=total_score.desc  limit=80
```

y una segunda con las que faltaban:

```
table=scan_results
select=symbol,metrics->>weaknessScore,metrics->>ipoDate,metrics->>ipoScore,metrics->>price,metrics->>sma50,raw->>ipoDate,metrics->>pivotPrice
filter=scan_id=eq.8c2b05dd-e9ef-483d-9fa4-5599ebeb49a5  limit=8
```

Rangos observados en las 75 filas: `objectiveScore` de 61,7 a 83,6;
`rsGlobalPct` de 53 a 97; `weinsteinScore` = 100 en **todas**;
`minerviniScore` de 82 a 100; `rsQualityScore` de 66,7 a 94,8;
`extSma50` de 0,89 a 37,3; `weaknessScore` de 0 a 7 en la muestra;
`ipoDate` vacío y `ipoScore` nulo en toda la muestra.

| Sección | Contrato ([lib/listRationale.js](../lib/listRationale.js)) | Fuente correcta | Sale población hoy |
|---|---|---|---|
La columna final ya no es una estimación: son los recuentos **medidos** en
`/api/discovery` una vez la caché caduca (§12).

| Sección | Contrato ([lib/listRationale.js](../lib/listRationale.js)) | Fuente correcta | Devuelve hoy |
|---|---|---|---|
| Favoritos | manual, sin contrato (L176-178) | `favorites` + hidratación desde el nocturno | según usuario |
| Score compuesto | `total >= 50` (L171) | nocturno US | **20** |
| RS Quality Leaders | `rsQuality >= 55 && rs >= 55` (L166) | nocturno US, **RS desde `rs_weekly_items`** | **20** |
| Deterioro técnico | `weaknessScore >= 45` (L154) | **ninguna válida** — ver punto 7 | **3, todos de Hong Kong** |
| Tendencia establecida | `trendTemplate && weinstein >= 55 && total >= 55` (L165) | nocturno US | **20** |
| Rupturas con contracción | `minervini >= 60 && total >= 50 && rs >= 55 && perf3m >= 0 && distance52w >= -25` (L157-163) | nocturno US | **20** |
| Vigilancia pivot | `total>=55 && rs>=55 && methodologyPivotWatchEligible` (L167) | **retirar** — ver punto 7 | **12** |
| IPO / New Leaders | `recentIpoOk(...)` (L168) | **ninguna hoy** — ver punto 7 | **0** |
| Extended but strong | `total>=70 && extSma50>=15 && sma50ExtensionOk && distance52w>=-20` (L169) | nocturno US | **20** |
| Pullback to SMA50 | `total>=50 && -3 <= extSma50 <= 8` (L170) | nocturno US | **20** |

El `limit=20` de la petición es el techo de las listas que salen a 20; la
tabla muestra 18 por fila porque `MiniTable` corta en `rows.slice(0, 18)`
([app/lists/page.jsx:374](../app/lists/page.jsx#L374)).

Dos advertencias sobre la tabla:

1. Los recuentos son de **una lectura concreta** (13 ago, 20:40 UTC) sobre
   las 80 filas más recientes. Cambiarán cada noche, y bastante: dependen
   de qué guarde el nocturno.
2. Las diferencias entre `extended` y `pullback` son reales y
   **excluyentes por construcción** (`extSma50 >= 15` frente a
   `extSma50 <= 8`): con 75 filas repartidas entre 0,89 y 37,3 de
   extensión, ambas listas devolverán conjuntos disjuntos. Esa es la
   prueba de que los contratos sí discriminan cuando hay población.

### Sobre el RS: no basta con cambiar de escaneo

`rowPassesListContract` lee `rs` así
([lib/listRationale.js:146](../lib/listRationale.js#L146)):

```js
  const rs = metric(row, "rsGlobalPct") ?? 0;
```

Es decir, **los contratos de RS Quality, Minervini y Vigilancia pivot se
evalúan hoy contra el percentil del lote**, no contra el ranking
canónico. Con el lote de 75, un `rsGlobalPct` de 55 significa "está en el
percentil 55 de setenta y cinco valores ya preseleccionados por ser
fuertes" — una afirmación mucho más débil que "percentil 55 de 4.868".

No propongo tocarlo en esta migración: es un cambio de metodología, no de
fuente, y merece su propia decisión. Pero **debe quedar escrito** que
mientras el RS que se enseña venga de `rs_weekly_items` y el RS que
filtra venga del lote, hay dos números distintos con el mismo nombre
detrás de la misma tabla.

---

## 7. Secciones sin fuente válida hoy

**Sí, hay tres. Dos hay que retirarlas y una hay que decidirla.**

### 7.1 "Deterioro técnico" — sin fuente válida, y peor de lo previsto

> **Corregido el 13 de agosto.** Este apartado decía que la lista saldría
> vacía. Sale con **tres valores, y los tres son de Hong Kong**:
> `8328.HK` (deterioro 100), `8329.HK` (100) y `8326.HK` (65), con cierre
> del **10 de agosto**, dos días más viejos que el resto de la pantalla.
> No vienen del nocturno estadounidense sino de los escaneos del cron por
> mercados (§5.2). El razonamiento de abajo sobre el nocturno era
> correcto; lo que fallaba era dar por hecho que el nocturno es la única
> fuente que entra por la lectura viva. No lo es: entran las 80 filas más
> recientes, vengan del mercado que vengan.
>
> Para una lista de deterioro, eso significa que hoy **solo puede sacar
> valores de fuera del mercado de lanzamiento**: los únicos débiles que
> hay en la ventana son los que el cron trae de otros mercados, porque el
> nocturno US filtra a los débiles por diseño. La conclusión de retirarla
> se refuerza, y añade un motivo que este documento no había visto: no es
> que esté vacía, es que enseña otro mercado y otra fecha sin decirlo.

El contrato exige `weaknessScore >= 45`
([lib/listRationale.js:154](../lib/listRationale.js#L154)). En la muestra
del nocturno los valores son **0, 0, 7, 0, 0, 0, 0, 7**.

No es casualidad: el nocturno aplica el preset `balanced`, tal como
documenta su propia cabecera
([scripts/scan-universe.mjs](../scripts/scan-universe.mjs), sección
"PRESET"):

> Este script SÍ pasa `screenerFiltersFromParams({ filterPreset: args.preset })` explícitamente

De 5.608 símbolos analizados solo guarda 75, y los guarda **porque son
fuertes**. Un escaneo que solo conserva a los fuertes no puede alimentar
una lista de débiles. Es una contradicción estructural, no un umbral mal
puesto.

Opciones, en orden de coste:

- **Retirarla** del producto de lanzamiento. Es lo que recomiendo: la
  lista de deterioro sirve para evitar largos o estudiar cortos, y no es
  ninguna de las cinco cosas del principio 4.
- Hacer que el nocturno guarde también una cohorte de débiles. Es un
  cambio en el escaneo, no en Listas, y multiplica el volumen escrito.

Lo que **no** se puede hacer es dejarla con el contrato actual sobre el
nocturno: mostraría siempre "Sin datos" sin explicar por qué, que es
exactamente lo que el principio 3 llama presentar una ausencia como si
fuera un resultado.

### 7.2 "IPO / New Leaders" — sin fuente, por dato ausente

El contrato es `recentIpoOk(row, 60)`
([lib/listRationale.js:168](../lib/listRationale.js#L168)), que necesita
`ipoAgeMonths` o `ipoDate`
([lib/listRationale.js:113-121](../lib/listRationale.js#L113)):

```js
function ipoAgeMonths(row = {}) {
  const stored = metric(row, "ipoAgeMonths");
  if (Number.isFinite(stored)) return stored;
  return monthsSince(rowValue(row, "ipoDate"));
}
```

En el nocturno, `metrics->>ipoAgeMonths` es `null` en las 75 filas
consultadas, `metrics->>ipoDate` es `null` y `raw->>ipoDate` es cadena
vacía. `monthsSince("")` devuelve `null`
([lib/stockRows.js:338-339](../lib/stockRows.js#L338)), y
`recentIpoOk` exige `Number.isFinite(age)`. **Cero filas, siempre.**

El título de la sección ya avisa de la ambición —"Solo IPOs reales
verificables <= 5 años", [app/lists/page.jsx:553](../app/lists/page.jsx#L553)—
y el dato para verificarlo no llega. **Retirar**, y reconsiderarla cuando
el nocturno hidrate fechas de salida a bolsa. Existe además una página
`/ipo-radar` dedicada; conviene mirar si duplica esta sección antes de
reconstruirla en Listas.

### 7.3 "Vigilancia pivot" — tiene datos, pero el dato es el equivocado

Esta sí devolvería filas. El contrato usa `methodologyPivotWatchEligible`
([lib/methodologyDisplay.js:289-299](../lib/methodologyDisplay.js#L289)),
que pide `distanceToPivotPct` entre -10 y 3, y el nocturno sí trae ese
campo.

El problema es qué mide. Comparando las dos columnas en las filas reales:

| Símbolo | `distance52w` | `distanceToPivotPct` |
|---|---|---|
| HALO | -2,8535960093562407 | -2,8535960093562407 |
| DGII | -1,8424672289201527 | -1,8424672289201527 |
| GHRS | -3,813732740645115 | -3,813732740645115 |
| TILE | -4,864200544945985 | -4,864200544945985 |
| VCTR | -0,042995719718030845 | 1,3515896822751117 |

En la mayoría de filas **los dos números son idénticos hasta el último
decimal**. Es decir, para esas filas "distancia al pivote" *es* la
distancia al máximo de 52 semanas, con otro nombre. Y `metrics->>pivotPrice`
es `null`.

Eso es exactamente lo que los principios de producto ya dictaminaron
([docs/principios-producto.md:178-184](principios-producto.md#L178)):

> Pero hoy el pivote parece ser una línea sobre máximos históricos, y el
> pivote real es el máximo de la contracción final de la base, que suele
> estar por debajo. Un número falso con aspecto de preciso es peor que no
> tenerlo.

La decisión ya está tomada en el documento de principios: **el pivote
está aplazado hasta poder calcularlo bien.** Migrar esta lista sería
reintroducir por la puerta de atrás un número que el producto ya decidió
no publicar. **Retirar**, y que vuelva con el pivote de verdad.

### 7.4 Recuento

De nueve secciones más Favoritos, la migración deja **seis listas
derivadas** (Score compuesto, RS Quality, Tendencia establecida, Rupturas
con contracción, Extended, Pullback) más Favoritos. Tres se retiran.

Eso, además, va en la misma dirección que el principio 2 ("menos
superficie, más claridad"): nueve secciones apiladas con las mismas tres
acciones dentro no era una tabla que se leyera de un vistazo.

---

# PARTE C — La fecha visible

## 8. Una sola fecha, y ya existe el patrón

El evaluador no se queja de que falten fechas. Se queja de que **sobran y
ninguna manda**. La solución no es añadir una décima etiqueta: es
declarar cuál es la fecha del dato y quitar las demás de la vista
principal.

### 8.1 Lo que ya existe y hay que reutilizar

La ficha tiene exactamente esto. `QualityStrip`,
[app/stock/[symbol]/StockClient.jsx:120-134](../app/stock/[symbol]/StockClient.jsx#L120):

```jsx
/* Franja de calidad de dato (una sola, bajo cabecera N0). */
function QualityStrip({ items = [] }) {
  if (!items.length) return null;
  return (
    <div className="stockQualityStrip" aria-label="Cobertura de datos">
      <span className="stockQualityStripLabel">Calidad de dato</span>
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`} className="stockQualityStripItem">
          <span className="stockTechRowLabel">{item.label}</span>
          <span className="stockTechRowValue">{item.value}</span>
        </span>
      ))}
    </div>
  );
}
```

Y así se alimenta,
[app/stock/[symbol]/StockClient.jsx:191-199](../app/stock/[symbol]/StockClient.jsx#L191):

```jsx
      <QualityStrip items={[
        { label: "Cierre", value: freshness.priceDate ? compactDate(freshness.priceDate) : "Sin fecha" },
        { label: "Cobertura", value: coverage.label || "Completa" },
        { label: "RS", value: freshness.rsGlobalAsOf ? `${compactDate(freshness.rsGlobalAsOf)} · n=${Math.round(freshness.rsGlobalSample || 0)}` : "Sin snapshot" },
```

De aquí sale el "cierre 12 ago 2026" que el evaluador vio en la ficha y
que le pareció bien. Sus estilos ya están escritos:
[styles/stock.css:309](../styles/stock.css#L309), y sus tokens de color
en [styles/tokens-v2.css:91](../styles/tokens-v2.css#L91), descritos como
"Calidad de dato (ficha ticker)".

**No hay que inventar nada.** El componente existe, tiene estilos, tiene
tokens, y el usuario ya lo ha validado en la ficha.

### 8.2 La propuesta

**Una sola franja de "Calidad de dato" bajo la cabecera de Listas, con
tres elementos y ninguno más:**

```
Calidad de dato   Cierre 12 ago 2026   RS 9 ago 2026 · n=4.868   Universo 75 de 5.608
```

- **Cierre — la fecha que manda.** Sale de `metrics.lastDate` de las
  filas mostradas (hoy, `2026-08-12`). No de `scans.created_at` (que es
  cuando corrió el trabajo, `2026-08-13T05:03`), no de `generatedAt` (que
  es cuando se construyó el payload). **La fecha del dato, no la del
  proceso.** Si las filas tuvieran fechas distintas, mostrar la más
  antigua: es la que acota lo que se puede afirmar.
- **RS — su propia fecha, porque es semanal y no puede tener la misma.**
  `snapshot_date` de `rs_weekly_items` (hoy, `2026-08-09`) y el tamaño de
  muestra (4.868). Idéntico formato al de la ficha: `compactDate` + `n=`.
  Que sean fechas distintas no es incoherencia: es honestidad sobre dos
  cadencias distintas.
- **Universo — el denominador.** "75 de 5.608" contesta a la pregunta que
  el evaluador no llegó a hacer pero que está debajo de todas las demás:
  ¿esto es todo el mercado o una selección? Los dos números están
  disponibles sin consultas nuevas: `saved` en `settings.progress` y el
  sufijo `l5608` del `local_id` (o mejor, un conteo sobre
  `universe_snapshot_symbols`).

**Y a la vez, se quita:**

- El KPI "ultimo snapshot local"
  ([app/lists/page.jsx:679](../app/lists/page.jsx#L679)). Es una fecha
  del navegador presentada al mismo nivel visual que datos de mercado.
  Es la que causó la confusión principal.
- El KPI "fuente rankings" con sus valores "Datos actualizados" / "Datos
  guardados" (misma línea 679). "Actualizados" no dice de cuándo, y era
  literalmente falso mientras servía junio.
- La franja `ListsInfraStrip` con "fuente", "filas ranking", "cobertura
  ranking", "mercados", "listas vacias"
  ([app/lists/page.jsx:154-202](../app/lists/page.jsx#L154)). Es
  vocabulario interno — el principio 2 lo señala por su nombre ("Snapshot
  íntegro", "Auditabilidad 13%") y el principio 5 manda la metodología a
  una página propia.
- `ListScopeSummary` con "acciones unicas", "apariciones visibles",
  "listas con datos" ([líneas 204-235](../app/lists/page.jsx#L204)).
  Mismo motivo.
- `ListReliabilityStrip` por sección, con "precio viejo", "cobertura
  baja", "excluidas contrato" ([líneas 333-351](../app/lists/page.jsx#L333)).
  El principio 7 es explícito: *"Sin etiquetas de estado en la fila. El
  dato afectado se muestra como ausente —un guion— con el icono de
  información"*.

Todo eso ya está construido y probado en la ficha con el mismo
componente. La sustitución es de una franja por seis paneles.

### 8.3 Una nota sobre la fecha en el servidor

Para que la franja pueda mostrar la fecha correcta, el payload de
`/api/discovery` tiene que llevarla. Hoy lleva `generatedAt`
([lib/discovery.js:245](../lib/discovery.js#L245)), que es cuándo se
calculó, no de cuándo son los datos. Hace falta añadir junto a él algo
como `dataAsOf` (el mínimo `lastDate` de las filas publicadas) — un campo
nuevo en la respuesta, sin tocar el existente.

Es el cambio de mayor alcance de toda la propuesta y aun así es aditivo:
nada que hoy lea `generatedAt` deja de funcionar.

---

# PARTE D — El plan

## 9. Pasos, del menos al más arriesgado

### Paso 0 — Confirmar el diagnóstico con una llamada (riesgo: cero)

Antes de tocar nada, verificar en producción lo único que no he podido
consultar (la tabla `leaderboard_snapshots` no está en la lista blanca
del MCP de solo lectura):

```bash
curl -s "https://<host>/api/discovery?limit=20&groupItemLimit=8&groupsLimit=12&maxRows=80&sinceDays=10&minGroupSize=1" | head -c 2000
```

Qué confirma: si el JSON trae `"source":"discovery_snapshots"` y
`"generatedAt":"2026-06-20T…"`, el diagnóstico está cerrado. Si además
`"rows"` tiene seis elementos y entre ellos están GOOGL, AAPL y NVDA,
está cerrado dos veces.

Y la misma llamada con `&cache=0` al final —que
[lib/discoveryCache.js:51](../lib/discoveryCache.js#L51) respeta:
`if (params.cache === false || params.cache === "0") return "";`— debe
devolver datos de hoy. Si los devuelve, el camino vivo funciona y el
único problema es la caché.

**Este paso solo lee. No cambia nada. Hazlo primero.**

### Paso 1 — Cortar la caché congelada (riesgo: bajo, reversible en un carácter)

Añadir `cache: "0"` a `scopedDiscoveryPath`
([app/lists/page.jsx:49-63](../app/lists/page.jsx#L49)).

Una línea. Efecto inmediato: Listas deja de leer junio y pasa a leer las
80 filas más recientes de `scan_results`. Revertir es borrar esa línea.

Es un parche, no la solución: seguirá siendo vulnerable al escaneo
interactivo que desplaza al nocturno (§5.4). Pero convierte el problema
de "datos de hace dos meses" en "datos de hoy con matices", y eso ya es
otra conversación.

Alternativa equivalente y algo más limpia: dar caducidad a
`readMaterializedDiscoverySnapshot` — descartar el snapshot si
`generated_at` tiene más de N horas. Mismo efecto, aplicado a todas las
superficies que usan discovery a la vez, y arregla también Sectores. Lo
prefiero si Sectores va a migrar pronto de todos modos.

### Paso 2 — Arreglar el `catch` roto (riesgo: bajo)

Añadir `import { userFacingServiceError } from "@/lib/serviceErrors";`
a [app/lists/page.jsx](../app/lists/page.jsx), como ya hacen
[app/market-health/page.jsx:17](../app/market-health/page.jsx#L17) y
[app/research-desk/page.jsx:14](../app/research-desk/page.jsx#L14).

Va después del paso 1 a propósito: cortando la caché, el camino de fallo
pasa a ejercitarse de verdad, y conviene que no explote cuando lo haga.

### Paso 3 — Retirar las tres listas sin fuente (riesgo: bajo, solo se quita)

Quitar `weakness`, `ipo` y `nearPivot` de `listSections`
([app/lists/page.jsx:546-556](../app/lists/page.jsx#L546)).

Solo la vista de Listas. Sin tocar `DISCOVERY_LIST_SPECS`
([lib/discovery.js:13](../lib/discovery.js#L13)) ni
`LIST_CONTRACTS` ([lib/listRationale.js:5](../lib/listRationale.js#L5)):
la lógica sigue existiendo para quien la use, simplemente deja de
mostrarse. Reversible añadiendo tres líneas.

Documentar el porqué en el mismo commit, con el enlace a §7 de este
documento. Una lista que desaparece sin explicación es indistinguible de
una lista rota.

### Paso 4 — Anclar la fuente al nocturno (riesgo: medio)

Seleccionar explícitamente el último `scans` con `local_id` que empiece
por `materialized:US:` y leer sus `scan_results`, en vez de "las N filas
más recientes".

Es el primer paso que toca servidor y el primero que necesita una
decisión: ¿un parámetro nuevo en `/api/discovery`, o una función de
lectura nueva en [lib/leaderboards.js](../lib/leaderboards.js)? Yo iría
por un parámetro (`source=nightly-us`), porque deja el camino actual
intacto y permite comparar los dos lado a lado.

Esto es lo que hace que un escaneo interactivo del usuario deje de poder
vaciar la pantalla de Listas.

### Paso 5 — Hidratar el RS canónico (riesgo: medio)

Cruzar las filas del nocturno con `rs_weekly_items` usando el lector por
lotes que ya existe en [lib/globalRs.js](../lib/globalRs.js), para poblar
`weeklyRs*` antes de que las filas lleguen a la vista.

Sin esto, la columna RS de Listas sale vacía tras el paso 4 — que es
correcto por el principio 3, pero es una regresión visible respecto a
hoy, donde sale un número (equivocado, del lote de junio, pero número).
**Los pasos 4 y 5 deberían salir juntos a producción**, aunque se
desarrollen y verifiquen por separado.

### Paso 6 — La franja de calidad de dato (riesgo: medio-alto, es UI)

Añadir `dataAsOf` al payload de `/api/discovery` (§8.3), montar la franja
reutilizando el patrón de `QualityStrip`, y **en el mismo commit** quitar
los KPIs y paneles que enumera §8.2.

Es el más arriesgado porque toca JSX nuevo y estructura visual. Por la
regla dura #2 del repo, exige verificación en navegador real con recarga
forzada antes de comitear, no solo tests verdes.

Va el último a propósito: si algo se tuerce, los pasos 1-5 ya han
arreglado la corrección de los datos, que es el problema de fondo. La
franja arregla la *comunicación* del problema, que sin datos correctos no
tendría sentido.

---

## 10. Qué se puede verificar en aislamiento

| Paso | Verificable solo | Cómo |
|---|---|---|
| 0 | **Sí** | dos `curl`, sin desplegar nada |
| 1 | **Sí** | recargar `/lists` y comprobar que la fecha del payload es de hoy; contrastar con `?cache=0` |
| 2 | **Sí** | test unitario que fuerce el rechazo del `fetch` y compruebe que `discoveryError` se puebla y `discoveryLoading` vuelve a `false` |
| 3 | **Sí** | test de render: `listSections` tiene seis entradas y ninguna es `weakness`/`ipo`/`nearPivot` |
| 4 | **Sí** | test de la nueva función de lectura con filas simuladas: un nocturno + un `server-scan` posterior con más filas → debe devolver el nocturno. Es exactamente el caso que hoy falla |
| 5 | **Sí** | test que cruce filas sin `weeklyRs*` con un `rs_weekly_items` simulado y compruebe que sale el rating del ranking, y que un símbolo ausente del ranking sale como ausencia con motivo, nunca como `rsGlobalPct` |
| 6 | **Parcialmente** | la construcción de `dataAsOf` es unitaria; el resultado visual **no** — regla dura #2, navegador real |

Hay precedentes de test que copiar: `tests/leaderboardFailedScanExclusion.test.js`,
`tests/leaderboardPercentileScope.test.js`,
`tests/curatedDiscoveryPanel.test.js`. Y ya existe
`tests/rsSurfaceConsistency.test.js`, citado en
[lib/rsCanonical.js:26](../lib/rsCanonical.js#L26), que es el sitio
natural donde extender la verificación del paso 5.

Lo que **no** se puede verificar en aislamiento: que la caché de
`leaderboard_snapshots` deje de servirse. Esa fila vive en producción y
solo se comprueba contra producción (paso 0).

---

## 11. ¿Sirve el mismo patrón para Sectores y Salud de mercado?

### Sectores: **misma causa exacta.** Comparte el arreglo.

[app/sectors/page.jsx:401](../app/sectors/page.jsx#L401):

```js
    fetchJsonWithTimeout("/api/discovery?limit=20&groupItemLimit=8&groupsLimit=12&maxRows=80&sinceDays=10&minGroupSize=1", 8000)
```

Es la **misma cadena de parámetros, carácter por carácter**, que la que
construye `scopedDiscoveryPath` en Listas. Encaja con el mismo
`matchesSpec`, recibe el mismo payload congelado del 20 de junio y muestra
su `generatedAt` en
[app/sectors/page.jsx:444](../app/sectors/page.jsx#L444):

```js
      ? `Ranking en vivo · ${discovery?.generatedAt ? new Date(discovery.generatedAt).toLocaleString() : "escaneos guardados"}`
```

—etiquetado, además, como "Ranking en vivo", que es lo contrario de lo
que es.

Y su "Materialized scan 2026-05-21" sale de `localStorage`, igual que en
Listas ([app/sectors/page.jsx:430](../app/sectors/page.jsx#L430)).

**Conclusión:** si el paso 1 se implementa como caducidad en
`readMaterializedDiscoverySnapshot` en vez de como `cache=0` en la
página, **Sectores se arregla solo**. Los pasos 4, 5 y 6 le aplican tal
cual. No necesita diagnóstico propio: necesita que alguien confirme que
los *grupos* (`groups.theme` / `sector` / `industry`) tienen sentido con
75 filas — con `minGroupSize=1`, 75 valores pueden producir muchos
grupos de un solo elemento, y un "sector" de una acción no es un sector.
Esa es la única pregunta abierta, y es de umbral, no de fuente.

### Salud de mercado: **causa distinta. Diagnóstico propio.**

No pasa por discovery. Sus llamadas son `/api/market-health`,
`/api/market-news`, `/api/social-sentiment`, `/api/coverage`,
`/api/methodology-health`. Y su fecha de mayo viene de un tercer sitio:

[app/market-health/page.jsx:529-531](../app/market-health/page.jsx#L529):

```js
  function refreshScanPulse() {
    setScanPulse(buildScanPulse(safeRead(STORAGE_KEYS.scans, [])));
  }
```

`safeRead(STORAGE_KEYS.scans, [])` es `localStorage`. El panel entero de
"pulso de mercado" —amplitud, liderazgo, deterioro, sus KPIs de
"RS ≥ 80", "cerca de máximos", "deterioro 2+"— se calcula sobre lo que
haya guardado ese navegador. En un navegador nuevo, sale vacío. En el del
evaluador, salió mayo.

Lo que sí se traslada: **el patrón de la Parte C** (una franja de calidad
de dato con la fecha del dato) y **el principio** de que ninguna pantalla
debe calcular análisis de mercado sobre `localStorage`. Lo que no se
traslada: nada de las Partes A y B, porque la cadena de datos es otra.

Estimación: Sectores es media jornada una vez hecho Listas. Salud de
mercado es una investigación completa aparte, probablemente más grande
que esta, porque hay que decidir de dónde sale la amplitud de mercado —
y ahí no hay una respuesta obvia esperando en Supabase.

---

# CONFIANZA

**Alta — verificado contra producción y contra el código, sin inferencia:**

- `/api/discovery` sirve la caché antes que la lectura viva, y la caché no
  tiene caducidad. Código citado literal
  ([app/api/discovery/route.js:122-134](../app/api/discovery/route.js#L122),
  [lib/discoveryCache.js:55-77](../lib/discoveryCache.js#L55)).
- Los seis parámetros que Listas envía encajan con
  `discovery:interactive:v1`. Comparación directa entre
  [app/lists/page.jsx:50-56](../app/lists/page.jsx#L50) y
  [lib/discoveryCache.js:15](../lib/discoveryCache.js#L15).
- El trabajo que escribe esa caché corrió **dos veces, el 2026-06-20**, y
  nunca más. Consulta a `provider_runs` reproducida íntegra en §2.4.
- El payload congelado contiene **seis filas** (`"count": 6` en `stats`).
- `discovery-refresh` no está en `vercel.json` ni en `.github/workflows/`.
  Verificado leyendo ambos y con `grep` sobre `app lib scripts .github`.
- El nocturno de hoy existe, es publicable (`partial`), guardó 75 de
  5.608, y sus filas tienen `lastDate = 2026-08-12`,
  `priceFreshnessDays = 1`, cobertura 94-96. Consultas reproducidas.
- El nocturno **no** trae `weeklyRs*`: `null` en las seis filas
  consultadas.
- El nocturno **no** trae `ipoDate` ni `ipoAgeMonths`: la lista IPO no
  puede devolver nada.
- `weaknessScore` de 0 a 7 en la muestra: la lista de deterioro no puede
  devolver nada.
- `distanceToPivotPct` es idéntico a `distance52w` en cuatro de las cinco
  filas comparadas.
- `rs_weekly_items` tiene corte del 2026-08-09 sobre 4.868 símbolos.
- Sectores hace la misma llamada con los mismos parámetros.
- Salud de mercado calcula su pulso desde `localStorage`.
- `userFacingServiceError` se usa sin importar en
  [app/lists/page.jsx:507](../app/lists/page.jsx#L507).

**Media — deducido de código, coherente con lo observado, no ejecutado:**

- Que los tres símbolos repetidos sean GOOGL, AAPL y NVDA. Sé que hay
  seis filas y que vienen de junio; no he podido leer cuáles son.
- Los recuentos estimados por lista en §6. Las métricas son reales; el
  filtro `longOpportunityIssue` no lo he ejecutado sobre ellas.
- La cadena exacta de fallo del `catch` sin import (§4.1). Leída, no
  reproducida en navegador.

---

# LO QUE NO HE VERIFICADO

> **Los puntos 1 y 3 quedaron resueltos el mismo día**, al aplicar la
> caducidad y medir contra el servidor: ver §12. El resto sigue en pie.

1. **La tabla `leaderboard_snapshots`, directamente.** No está en la
   lista blanca del MCP de solo lectura (las permitidas son `scans`,
   `scan_results`, `scan_symbol_history`, `symbol_resolutions`,
   `shadow_instruments`, `app_settings`, `favorites`, `provider_runs`,
   `scan_executions`, `scan_result_sets`, `scan_work_items`,
   `scan_result_set_rows`, `universe_snapshots`,
   `universe_snapshot_symbols`, `daily_bars`, `fundamental_snapshots`,
   `rs_weekly_items`). No he podido leer el payload congelado ni
   confirmar que las dos filas del 20 de junio sigan existiendo. Toda la
   evidencia sobre ellas es indirecta: `provider_runs` dice que se
   escribieron y qué contenían, y el evaluador vio la fecha del 20 de
   junio en pantalla. El paso 0 del plan cierra este hueco.
2. **No he abierto la aplicación.** Nada de lo que digo sobre lo que se
   ve en pantalla viene de mirarla: viene del código y de las capturas
   verbales del evaluador.
3. **No he ejecutado los contratos de lista sobre las filas reales.** Los
   recuentos de §6 son estimaciones sobre las métricas consultadas.
4. **No he ejecutado los tests.** Ni la suite existente ni ninguno nuevo.
5. **`ipoDate` fuera del nocturno.** He comprobado que las filas del
   nocturno no lo traen. No he comprobado si algún otro proceso lo
   escribe en `scan_results`, ni si `/api/company-brief` lo tiene por su
   cuenta — lo que cambiaría la recomendación sobre la lista de IPOs.
6. **Los grupos de Sectores con 75 filas.** No he calculado cuántos
   grupos de tamaño 1 saldrían con `minGroupSize=1`. Es la pregunta
   abierta de §11.
7. **De dónde saldría la amplitud de mercado** para Salud de mercado.
   He confirmado que hoy sale de `localStorage`; no he buscado el
   sustituto.
8. **El contenido concreto del escaneo `server-scan-73a25c8c`** del 12/08
   con 9.918 filas. Sé que existe, que es publicable y que puede
   desplazar al nocturno; no sé de qué mercado es ni con qué filtros
   corrió.
9. **`fundamental_snapshots` y `scan_symbol_history`.** Los he listado
   como fuentes existentes sin consultarlos. Quedan fuera del alcance de
   Listas hoy.
10. **La página `/ipo-radar`.** La menciono como posible duplicado de la
    sección IPO sin haberla leído.

---

# 12. Lo medido tras aplicar la caducidad (13 ago 2026, 20:40 UTC)

El paso 1 del plan (§9) ya está implementado, pero **no como `cache=0` en
la página sino como caducidad en el servidor**, que es la variante que §11
recomendaba porque arregla Sectores a la vez.

## 12.1 El plazo, y por qué no es un TTL en horas

La caducidad vive en
[lib/discoveryCache.js](../lib/discoveryCache.js) y no cuenta horas: mira
si el snapshot es anterior a **la última frontera de las 04:00 UTC**.

Un TTL fijo no vale aquí. Los datos no envejecen poco a poco: cambian de
golpe una vez al día, cuando corre el nocturno. Un snapshot generado a
las 02:00 con un TTL de 12 horas seguiría dándose por fresco a las 14:00,
once horas después de que el escaneo haya dejado datos nuevos. El TTL
mediría la edad del snapshot, cuando lo que importa es si entremedias han
llegado datos.

La frontera son las 04:00 UTC y no las 03:00 porque hay que sumar las dos
holguras que el propio workflow documenta: GitHub puede retrasar un
`schedule` entre 5 y 30 minutos, y la corrida tiene `timeout-minutes: 30`.
A las 04:00 UTC los datos de esa noche están completos.

Vida máxima 24 h; mínima, unos minutos si el snapshot se generó a las
03:59. Ese es el lado correcto en el que fallar: una caducidad de más
cuesta una lectura viva, y una de menos ya costó 54 días de datos falsos.

## 12.2 La fila congelada existía: confirmado

Era el hueco número 1 de "LO QUE NO HE VERIFICADO" — la tabla no se podía
consultar por MCP. Ahora la respuesta de la API la reporta:

```json
"cache": {
  "hit": false, "status": "expired", "key": "discovery:interactive:v1",
  "generatedAt": "2026-06-20T10:15:33.964+00:00",
  "ageHours": 1306.4, "boundary": "2026-08-13T04:00:00.000Z"
}
```

**1.306,4 horas: 54,4 días.** Coincide con el `provider_runs` de §2.4 al
segundo. El diagnóstico era correcto.

## 12.3 Antes y después, con la misma petición

`GET /api/discovery?limit=20&groupItemLimit=8&groupsLimit=12&maxRows=80&sinceDays=10&minGroupSize=1`

| | Antes | Después |
|---|---|---|
| `source` | `discovery_snapshots` | `scan_results` |
| Fecha del payload | 20 jun 2026 | 13 ago 2026 |
| `inputRows` | 300 (leídas en junio) | 80 |
| Valores únicos | **6** | **55** |
| Cierre de las barras | junio | 12 ago (131 filas) y 10 ago (4) |

Y en pantalla, con el KPI de Listas en "Datos actualizados" y 123
apariciones de 53 tickers únicos:

| Sección | Filas | Primeros valores |
|---|---|---|
| Score compuesto | 18 | VCTR HALO MRX DGII |
| RS Quality Leaders | 18 | MPC SN VCTR MSGE |
| Deterioro técnico | **3** | 8328.HK 8329.HK 8326.HK |
| Tendencia establecida | 18 | DGII GHRS IMVT MRX |
| Rupturas con contracción | 18 | IMVT MPC DGII MRX |
| Vigilancia pivot | 12 | MSGS NTB CRON RMAX |
| IPO / New Leaders | **0** | — |
| Extended but strong | 18 | EAT DCTH SEPN URGN |
| Pullback to SMA50 | 18 | LQDA OSCR YETI MANU |

Esto contesta a la pregunta 4 de §4 con datos, no con razonamiento: las
secciones **sí filtran cosas distintas**. Score compuesto empieza por
VCTR, RS Quality por MPC, Extended por EAT y Pullback por LQDA. Los tres
nombres repetidos eran falta de población, no falta de criterio.

## 12.4 Sectores se arregló solo, como decía §11

Sin tocar `app/sectors/page.jsx`. Su etiqueta de fuente pasó a mostrar la
fecha de hoy y ya no aparece rastro del 20 de junio en la página. Era lo
esperable: hace la misma llamada carácter por carácter y el arreglo está
en el servidor.

Queda abierta la pregunta de umbral que §11 planteaba —cuántos grupos de
un solo valor produce `minGroupSize=1`—, que no es de fuente y no cambia
con esto.

## 12.5 Las tres listas sin fuente: qué muestran ahora

Sin retirarlas, que es decisión de producto aparte:

- **IPO / New Leaders: 0 filas.** Exactamente lo previsto en §7.2.
- **Vigilancia pivot: 12 filas.** Tiene datos, y siguen siendo el pivote
  dudoso de §7.3. Se ve en las propias filas: `INSW` tiene
  `distanceToPivotPct` y `distance52w` idénticos (-6,0), mientras `CRON`
  los tiene distintos (0,0 frente a -7,6). Sigue midiendo dos cosas según
  la fila.
- **Deterioro técnico: 3 filas de Hong Kong.** El hallazgo nuevo, ya
  corregido en §7.1.

## 12.6 Lo que este arreglo NO hace

- **No repuebla la caché.** `discovery-refresh` sigue sin estar programado
  (§2.3), así que a partir de ahora **toda** lectura entra por el camino
  vivo. Es lo correcto —mejor una lectura viva que datos de junio—, pero
  significa que la caché está efectivamente desactivada, no arreglada. Si
  la RPC empieza a dar timeouts bajo carga, la causa será esta.
- **No ancla la fuente al nocturno US** (paso 4 de §9). Sigue leyendo "las
  80 filas más recientes", que es justo por lo que se cuelan los tres
  valores de Hong Kong y las dos fechas de cierre distintas. Ese paso
  sigue pendiente y ahora tiene una razón medida a favor.
- **No toca el RS.** Las filas siguen sin `weeklyRs*` (§5.1).
- **No toca `readMaterializedLeaderboard`**
  ([lib/leaderboards.js:746-772](../lib/leaderboards.js#L746)), que tiene
  el mismo patrón sin caducidad —`order=generated_at.desc&limit=1`— para
  `/api/leaderboards`. No estaba en el encargo y no lo he investigado:
  no sé si su caché está igual de vieja ni qué pantallas la consumen.

---

# 13. Las tres listas retiradas (13 ago 2026)

Decidido tras la medición de §12.5. Se retiran de la vista **sin borrar
nada**: contratos, estrategias y cálculo siguen intactos y se siguen
ejecutando. El porqué de cada una y qué haría falta para devolverla viven
en `RETIRED_LIST_SECTIONS`, en
[app/lists/page.jsx](../app/lists/page.jsx) — junto al código, no solo
aquí, para que quien las encuentre no tenga que buscar este documento.

Fijado por `tests/e2e/listsRetiredSections.e2e.mjs`, que da tres filas a
cada una de las nueve listas y comprueba que solo se pintan seis.
Verificado que falla si se reactiva una.

## 13.1 Qué queda

Seis secciones, 108 apariciones, **47 valores únicos** (eran seis en
total antes de que la caché caducara):

| Sección | Filas | Primeros |
|---|---|---|
| Score compuesto | 18 | VCTR HALO MRX DGII RPRX |
| RS Quality Leaders | 18 | MPC SN VCTR MSGE LFST |
| Tendencia establecida | 18 | DGII GHRS IMVT MRX MPC |
| Rupturas con contracción | 18 | IMVT MPC DGII MRX VCTR |
| Extended but strong | 18 | EAT DCTH SEPN URGN HALO |
| Pullback to SMA50 | 18 | LQDA OSCR YETI MANU SLF |

## 13.2 Redundancia entre las que quedan

Solapamiento medido como |A∩B| / |A∪B| sobre los tickers visibles:

| Par | Solape |
|---|---|
| **Tendencia establecida ∩ Rupturas con contracción** | **71 %** |
| RS Quality ∩ Rupturas con contracción | 57 % |
| Rupturas con contracción ∩ Extended | 57 % |
| RS Quality ∩ Tendencia establecida | 50 % |
| Tendencia establecida ∩ Extended | 44 % |
| Score compuesto ∩ Tendencia establecida | 38 % |
| Score compuesto ∩ Rupturas con contracción | 38 % |
| RS Quality ∩ Extended | 38 % |
| Score compuesto ∩ RS Quality | 29 % |
| Score compuesto ∩ Extended | 24 % |
| Score compuesto ∩ Pullback | 13 % |
| RS Quality ∩ Pullback | 6 % |
| Tendencia establecida ∩ Pullback | 3 % |
| Rupturas con contracción ∩ Pullback | 3 % |
| **Extended ∩ Pullback** | **0 %** |

Contesta a la pregunta 4 del encargo: **las que quedan son distintas, con
una excepción clara.**

- **Extended ∩ Pullback = 0 %** es la prueba limpia de que los contratos
  discriminan: son excluyentes por construcción (`extSma50 >= 15` frente
  a `extSma50 <= 8`) y el dato lo confirma sin un solo solape.
- **Tendencia establecida ∩ Rupturas con contracción = 71 %** es
  redundancia real. Sus contratos comparten `trendTemplateOk` y se
  diferencian solo en qué puntuación miran (`weinstein >= 55` frente a
  `minervini >= 60` más cercanía a máximos), y con la población de hoy
  eso separa poco. **No la he retirado: el encargo era retirar tres, y
  ésta no está en la lista.** Queda señalada como la primera candidata
  si se quiere seguir reduciendo superficie — el principio 2 empuja en
  esa dirección.
- El resto, entre el 3 % y el 57 %, es solape esperable: todas las listas
  alcistas beben del mismo embudo de valores fuertes.

## 13.3 Retirar "Deterioro técnico" NO arregla la mezcla de mercados

Hallazgo de la verificación, y conviene no confundirlo con un éxito de
esta retirada: tras quitar las tres listas, **sigue habiendo un valor de
Hong Kong en pantalla** — `8321.HK`, dentro de **Pullback to SMA50**.

La lista de deterioro era donde la mezcla resultaba sistemática (los tres
únicos débiles de la ventana eran de HK), pero la causa no era la lista:
es que la lectura viva coge las 80 filas más recientes **vengan del
mercado que vengan** (§5.4). Cualquier lista puede recibir un valor de
otro mercado y otra fecha de cierre.

Es decir: la retirada quita el síntoma más visible, no la causa.
**El paso 4 de §9 —anclar la fuente al último `materialized:US:`— sigue
siendo necesario**, y ahora tiene dos pruebas a favor en vez de una.

---

# 14. El anclaje al nocturno estadounidense (13 ago 2026)

Paso 4 de §9, hecho. La lectura viva ya no coge "las N filas más recientes
de cualquier origen": va a **un escaneo concreto**, el último `scans` cuyo
`local_id` empieza por `materialized:US:`, y lee sus `scan_results` por
`scan_id`.

Vive en `readNightlyUsScan` / `readNightlyUsScanRows`
([lib/leaderboards.js](../lib/leaderboards.js)), y `/api/discovery` lo usa
**por defecto**. `?source=recent` recupera el comportamiento anterior para
poder comparar los dos al depurar; no lo usa ninguna pantalla.

Se mantiene el contrato terminal de la RPC: solo publican los escaneos en
`complete`, `partial` o `done`.

## 14.1 La misma petición, con y sin anclaje

| | `source=recent` (antes) | anclado (ahora) |
|---|---|---|
| Filas en listas | 131 US + **4 HK** | **132, todas US** |
| Fechas de cierre | 12 ago (131) y **10 ago (4)** | **12 ago (132)** |
| Valores no estadounidenses | 8328.HK 8329.HK 8326.HK **8321.HK** | **ninguno** |
| Escaneo de origen | varios | `materialized:US:2026-08-13:o0:l5608` (75 filas) |

El `8321.HK` que §13.3 dejó señalado dentro de "Pullback to SMA50" ha
desaparecido. **Una sola fecha de cierre en toda la pantalla**, que es lo
que hace posible la franja de fecha única de la Parte C.

## 14.2 Cuántos valores quedan por sección

La población **no se reduce**, contra lo que cabía temer:

| Sección | Antes | Ahora |
|---|---|---|
| Score compuesto | 18 | 18 |
| RS Quality Leaders | 18 | 18 |
| Tendencia establecida | 18 | 18 |
| Rupturas con contracción | 18 | 18 |
| Extended but strong | 18 | 18 |
| Pullback to SMA50 | 18 | 18 |
| **Apariciones / únicos** | 108 / 47 | **108 / 47** |

Las 75 filas del nocturno bastan para llenar las seis listas hasta el tope
de `limit=20` (18 en pantalla por el corte de `MiniTable`). Lo que cambia
no es cuántos valores hay, sino **cuáles**: los cuatro de Hong Kong salen
y no los sustituye nada, porque nunca hicieron falta para llenar la tabla.

En las listas retiradas sí se nota, y confirma el diagnóstico de §13:
"Deterioro técnico" pasa de 3 filas a **0**. Sus tres únicas filas eran los
valores de Hong Kong. Con el mercado de lanzamiento anclado, la lista queda
vacía del todo — que es exactamente lo que §7.1 predijo antes de que la
mezcla de mercados lo enmascarara.

## 14.3 Sin nocturno: ausencia explícita, nunca un sustituto

Si el escaneo no existe, no terminó en un estado publicable, no guardó
filas o no se puede leer, `/api/discovery` responde
`source: "nightly_us_unavailable"` con el motivo, y **no busca sustituto**.
En particular **no coge el nocturno de anteayer**: servirlo como si fuera
el de hoy es la misma mentira que servir otro mercado — una fecha que la
pantalla no declara.

Los cuatro motivos se distinguen porque se arreglan distinto:

| `reason` | Qué pasó |
|---|---|
| `no-nightly-scan` | no hay ningún `materialized:US:` guardado |
| `nightly-not-publishable` | el último existe pero terminó en `failed`/`error`/`cancelled` |
| `empty` | corrió y no guardó ningún valor |
| `nightly-read-failed` | no se pudo leer (timeout o error recuperable) |

En pantalla, Listas muestra el motivo en el cuerpo del estado vacío, no
detrás de un icono. Y si hay copia local en el navegador, el aviso va
aparte y dice de dónde sale lo que se está enseñando.

Cubierto por `tests/nightlyUsAnchor.test.js` (7 casos, con Supabase
simulado) y `tests/e2e/listsNightlyAbsence.e2e.mjs` (los tres motivos, en
navegador, comprobando que no aparece ni un ticker).

## 14.4 Sectores, otra vez gratis

Misma llamada, mismo anclaje, sin tocar `app/sectors/page.jsx`. Sus grupos
salen del mismo escaneo: **135 filas, todas US, todas con cierre del 12 de
agosto**, repartidas en 11 temas, 10 sectores y 12 industrias.

Queda en pie la única pregunta abierta de §11, que no es de fuente: con
`minGroupSize=1`, cuántos de esos grupos tienen un solo valor — y si un
"sector" de una acción merece pintarse.

## 14.5 Lo que sigue sin estar

- **El RS.** Las filas del nocturno siguen sin `weeklyRs*` (§5.1). El paso
  5 de §9 sigue pendiente y ahora es más visible: con la fuente anclada, la
  columna RS es lo único que aún no puede decir de dónde sale.
- **La franja de fecha** (Parte C). Ahora hay una sola fecha de cierre que
  mostrar —12 ago— y ya no hay excusa de datos mezclados.
- **El caveat del prefijo.** `app/api/jobs/scan-refresh` con `?markets=US`
  produciría un `local_id` con el mismo prefijo `materialized:US:` y sería
  indistinguible de un nocturno. Lo hereda de `scripts/scan-universe.mjs`,
  que ya decidió no resolverlo con una segunda señal; se mantiene ese
  criterio, y queda escrito para quien lo encuentre.
