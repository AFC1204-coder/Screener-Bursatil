# Timeout al arrancar la app — diagnóstico 2026-08-13

<!-- fecha interna: 2026-08-13 · BASE_SHA: 1f20345 · rama: codex/statsedge-ui-polish -->

Este documento es un **diagnóstico**, no un plan de acción. No se ha modificado
ningún archivo de código, no se ha escrito nada en Supabase, no se ha
ejecutado ningún escaneo y no se ha hecho commit ni push. Las consultas contra
producción citadas más abajo son de solo lectura, vía `supabase_query`
(PostgREST, sin `EXPLAIN` posible desde esa herramienta).

---

## 1 — Qué consultas hace la app al arrancar

Al montar `app/page.jsx`, un único `useEffect` (línea 456) decide entre
restaurar la sesión guardada en `localStorage` o, si no hay sesión con filas,
pedir el último escaneo a Supabase. Es esta segunda rama la que dispara la
cadena de red antes de mostrar nada útil.

**Paso 1 — `app/page.jsx:543`**, dentro del bloque `if (!restoredRowsCount)`:

```js
getLatestScanFromCloud().then((result) => {
```

**Paso 2 — `lib/cloudSyncClient.js:250-252`**, la función que arma la petición:

```js
export async function getLatestScanFromCloud() {
  return requestJson("/api/scans?includeRows=1&limit=10&rowsLimit=2000");
}
```

Pide los **10 escaneos más recientes** (`limit=10`) y hasta **2.000 filas de
resultados en total** (`rowsLimit=2000`, no por escaneo — vuelvo sobre esto en
el punto 6).

**Paso 3 — servidor, `app/api/scans/route.js:381-442`**, el handler `GET`.
Dentro, dos consultas a Supabase en serie y dos más en paralelo:

a) Lista de escaneos — `app/api/scans/route.js:405-408`:
```js
const scans = await supabaseRequest("scans", {
  query: `owner_id=eq.${encodeURIComponent(config.ownerId)}${includeDeleted ? "" : "&deleted_at=is.null"}&select=${scanSelect}&order=created_at.desc&limit=${limit}`,
  timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
});
```
Toca `scans`. `SCANS_SUPABASE_TIMEOUT_MS = 8000` (línea 10).

b) Filas de esos escaneos — `app/api/scans/route.js:412-417`:
```js
if (includeRows && activeScans.length && rowsLimit > 0) {
  const ids = activeScans.map((scan) => scan.id).join(",");
  results = await supabaseRequest("scan_results", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&scan_id=in.(${ids})&select=${resultSelect}&order=rank_index.asc&limit=${rowsLimit}`,
    timeoutMs: SCANS_SUPABASE_TIMEOUT_MS,
  });
  if (!full && !decisionProjection) results = results.map((item) => ({ ...item, raw: compactResearchRow(item.raw) }));
}
```
Toca `scan_results`. Mismo timeout de 8 s. **`resultSelect` incluye la
columna `raw` completa** (línea 398, `resultSelectFull`) — la compactación de
la línea 418 pasa **después** de traer los datos de Postgres, no evita
leerlos ni transferirlos.

c) RS semanal y capitalización — `app/api/scans/route.js:426-433`, en
paralelo tras (b):
```js
const scanSymbols = results.map((item) => item.symbol).filter(Boolean);
const [weeklyRs, marketCaps] = await Promise.all([
  readGlobalRsForSymbols(scanSymbols).catch(() => ({ configured: false, bySymbol: new Map() })),
  readMarketCapForSymbols(scanSymbols).catch(() => ({ configured: false, bySymbol: new Map() })),
]);
```
Tocan `rs_weekly_items` (`lib/globalRs.js:103-111`) y `fundamental_snapshots`
(`lib/fundamentalsCache.js:201-211`). Ninguna de las dos falla la respuesta si
se cae (van con `.catch`), pero **sí pueden alargarla**: ambas recorren los
símbolos en un `for` **secuencial** (no `Promise.all` interno), en lotes de 50
(`lib/globalRs.js:99-111`) y 200 (`lib/fundamentalsCache.js:196-211`). Con
hasta 2.000 símbolos eso son hasta 40 y 10 idas y vueltas a Supabase, una
detrás de otra. La de `rs_weekly_items` no lleva `timeoutMs` — sin timeout
propio, no puede producir el error "Timeout consultando Supabase" que vio el
usuario, pero si se cuelga, alarga la respuesta igualmente.

**Nada de esto está detrás de una condición de carrera con la sesión
guardada**: el efecto de la línea 456 solo entra en esta rama si
`localStorage` no tenía ya filas (`!restoredRowsCount`), así que en un
arranque en frío esta es la primera — y única — fuente de datos.

## 2 — Candidata al timeout

La pista del enunciado encaja de forma exacta con datos reales. Consulté
`scans` (solo lectura, `supabase_query`) y el escaneo de 9.918 filas existe
tal cual se describe:

```
table: scans, select: id,local_id,owner_id,preset,row_count,created_at,deleted_at
order: created_at.desc, limit: 15
→ {"id":"dd54b3fc-20fe-4c22-a93a-1c834167b955","local_id":"server-scan-73a25c8c-...",
   "owner_id":"personal","preset":"balanced","row_count":9918,
   "created_at":"2026-08-12T23:29:35.023096+00:00","deleted_at":null}
```

`created_at` = 23:29:35 del 12 de agosto. Coincide con "lanzado desde la
interfaz a las 23:29". `owner_id` confirmado como `"personal"`
(`lib/supabaseServer.js:4`, `DEFAULT_OWNER = "personal"`).

Los 10 escaneos más recientes en ese momento (antes de que corriera nada más
esta madrugada) eran estos, con sus `row_count`:

| # | scan_id | row_count | created_at |
|---|---|---|---|
| 1 | `dd54b3fc-20fe-4c22-a93a-1c834167b955` | **9918** | 23:29:35 |
| 2 | `dfc82449-eb6c-4298-990c-0ea8227c7e73` | 1 | 23:29:17 |
| 3 | `abb4d4bd-783e-46e6-8afd-b2779d61f600` | 18 | 22:20:40 |
| 4 | `1f044966-a553-4ad6-9474-7d888b55e20b` | **9916** | 17:45:16 |
| 5 | `5dd1833e-7afc-45cc-87ba-60f1d37a01b0` | 75 | 14:20:59 |
| 6 | `653ef600-c38f-4c72-843a-1808cc129fa0` | 51 | 14:00:50 |
| 7 | `75af44c8-2ddf-4865-bd8a-8bcfd6934d05` | 97 | 04:59:50 |
| 8 | `344ca7c0-a7d2-4681-b5cb-9f7a516168e1` | 5 | 2026-08-11 22:56:42 |
| 9 | `03689e54-1fce-44ed-84df-0916c74ae908` | 24 | 2026-08-11 22:45:05 |
| 10 | `ef9199b5-cc4d-41a5-8100-f9dd626258c6` | 97 | 2026-08-11 16:46:54 |

Suma de `row_count`: **20.202 filas**. La candidata es la consulta (b) del
punto 1 — `scan_results` filtrando por `owner_id` y `scan_id IN (...)`,
ordenando por `rank_index` — porque:

- Es la única de las cuatro que toca un volumen de filas de ese orden de
  magnitud (`scans` solo trae 10 filas; RS y capitalización van troceadas con
  su propio tope por lote).
- Trae la columna `raw` completa (264 claves por fila según
  `docs/inventario-obsoleto-2026-08-11.md` D.1) para las ~20.202 filas
  candidatas, antes de recortar a 2.000 y de compactar en JS.
- El `ORDER BY rank_index` es **global**, no por escaneo: con dos escaneos de
  ~9.900 filas cada uno en la mezcla, Postgres tiene que considerar el total
  antes de poder aplicar el `LIMIT 2000`.

## 3 — EXPLAIN ANALYZE de la candidata

Dos consultas, listas para pegar en el editor SQL de Supabase. La primera es
la sospechosa principal; la segunda (`scans`) es barata de descartar y la
incluyo porque es la otra pieza del mismo `GET`.

**3a. La consulta candidata — `scan_results`, con los 10 `scan_id` reales de
la ventana del incidente:**

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT scan_id, rank_index, raw, symbol, company_name, country, sector,
       industry, theme, total_score, weinstein_score, minervini_score,
       risk_score, rs_rating, metrics
FROM scan_results
WHERE owner_id = 'personal'
  AND scan_id IN (
    'dd54b3fc-20fe-4c22-a93a-1c834167b955',
    'dfc82449-eb6c-4298-990c-0ea8227c7e73',
    'abb4d4bd-783e-46e6-8afd-b2779d61f600',
    '1f044966-a553-4ad6-9474-7d888b55e20b',
    '5dd1833e-7afc-45cc-87ba-60f1d37a01b0',
    '653ef600-c38f-4c72-843a-1808cc129fa0',
    '75af44c8-2ddf-4865-bd8a-8bcfd6934d05',
    '344ca7c0-a7d2-4681-b5cb-9f7a516168e1',
    '03689e54-1fce-44ed-84df-0916c74ae908',
    'ef9199b5-cc4d-41a5-8100-f9dd626258c6'
  )
ORDER BY rank_index ASC
LIMIT 2000;
```

**3b. Variante sin `raw`**, para separar "el plan tarda por el índice/orden"
de "tarda por transferir el JSON grande" — compara el tiempo de esta contra
la de arriba:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT scan_id, rank_index, symbol, company_name, country, sector,
       industry, theme, total_score, weinstein_score, minervini_score,
       risk_score, rs_rating, metrics
FROM scan_results
WHERE owner_id = 'personal'
  AND scan_id IN (
    'dd54b3fc-20fe-4c22-a93a-1c834167b955',
    'dfc82449-eb6c-4298-990c-0ea8227c7e73',
    'abb4d4bd-783e-46e6-8afd-b2779d61f600',
    '1f044966-a553-4ad6-9474-7d888b55e20b',
    '5dd1833e-7afc-45cc-87ba-60f1d37a01b0',
    '653ef600-c38f-4c72-843a-1808cc129fa0',
    '75af44c8-2ddf-4865-bd8a-8bcfd6934d05',
    '344ca7c0-a7d2-4681-b5cb-9f7a516168e1',
    '03689e54-1fce-44ed-84df-0916c74ae908',
    'ef9199b5-cc4d-41a5-8100-f9dd626258c6'
  )
ORDER BY rank_index ASC
LIMIT 2000;
```

**3c. La otra consulta del mismo `GET` — `scans`:**

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, local_id, created_at, updated_at, deleted_at, name, preset,
       settings, market_score, market_regime, row_count
FROM scans
WHERE owner_id = 'personal' AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 10;
```

Nota sobre 3c: el único índice de `scans` es
`scans_active_idx on scans(owner_id, deleted_at, updated_at desc)`
(`supabase/schema.sql:1529`) — ordenado por **`updated_at`**, pero la
consulta ordena por **`created_at`** (`app/api/scans/route.js:406`). El
índice sirve para el filtro pero no evita un `Sort` explícito. Con la tabla
`scans` probablemente pequeña (decenas o cientos de filas, no miles) esto es
casi seguro barato, pero el `EXPLAIN` lo confirma o lo descarta sin
adivinar.

## 4 — Las dos consultas que predijo el inventario

Ambas con símbolo real (`AAPL`), verificado que tiene filas en ambas tablas
antes de escribir la consulta.

**4a. `readUniverseRsSnapshot` — `app/api/company-brief/route.js:837-849`:**

```js
const rows = await supabaseRequest("scan_results", {
  query: [
    `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
    `symbol=eq.${encodeURIComponent(cleanSymbol)}`,
    "select=created_at,scan_id,symbol,company_name,country,sector,industry,theme,total_score,weinstein_score,minervini_score,risk_score,rs_rating,metrics,raw",
    "order=created_at.desc",
    "limit=1",
  ].join("&"),
});
```

Confirmé que `AAPL` tiene filas recientes en `scan_results` (dos, de los dos
escaneos interactivos grandes: 23:29 y 17:45 del 12 de agosto). EXPLAIN listo
para copiar:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT created_at, scan_id, symbol, company_name, country, sector, industry,
       theme, total_score, weinstein_score, minervini_score, risk_score,
       rs_rating, metrics, raw
FROM scan_results
WHERE owner_id = 'personal' AND symbol = 'AAPL'
ORDER BY created_at DESC
LIMIT 1;
```

El único índice que cubre `scan_results` por `symbol` es
`scan_results_symbol_idx on scan_results(owner_id, symbol)`
(`supabase/schema.sql:1523`) — **no incluye `created_at`**, así que el
`ORDER BY created_at DESC LIMIT 1` necesita, como mínimo, un `Sort` sobre
todas las filas de ese símbolo (que crecen con cada escaneo interactivo y
cada corrida del cron materializado que lo incluya). Con `AAPL` apareciendo
en casi todos los escaneos de EE.UU., el número de filas a ordenar puede ser
ya considerable y seguirá creciendo.

**4b. Caché de perfil — `lib/fundamentalsCache.js:141-152`:**

```js
const rows = await supabaseRequest("fundamental_snapshots", {
  query: {
    select: "symbol,period_end,period_type,provider,currency,market_cap,metrics,updated_at",
    owner_id: `eq.${config.ownerId}`,
    symbol: `eq.${normalized}`,
    period_type: `eq.${PROFILE_PERIOD_TYPE}`,  // "profile"
    order: "updated_at.desc",
    limit: "1",
  },
  timeoutMs: Number(options.timeoutMs || DEFAULT_PROFILE_CACHE_READ_TIMEOUT_MS), // 1500 ms
});
```

Confirmé que `AAPL` tiene 10+ filas con `period_type: "profile"` en
`fundamental_snapshots`, la más reciente del 2026-08-09. EXPLAIN:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT symbol, period_end, period_type, provider, currency, market_cap,
       metrics, updated_at
FROM fundamental_snapshots
WHERE owner_id = 'personal' AND symbol = 'AAPL' AND period_type = 'profile'
ORDER BY updated_at DESC
LIMIT 1;
```

El único índice de esta tabla es
`fundamental_snapshots_symbol_idx on fundamental_snapshots(owner_id, symbol, period_end desc)`
(`supabase/schema.sql:1542`) — **no incluye `period_type`** (hay varios
`period_type`/`provider` por símbolo, según el `unique` de la línea 1073:
`(owner_id, symbol, period_end, period_type, provider)`) y **ordena por
`period_end`, no por `updated_at`**, que es por lo que ordena esta consulta.
Esta ruta además tiene su propio timeout corto (1.500 ms, no los 8.000 de
`/api/scans`) — si el volumen por símbolo crece, esta es la que antes se
rompe, y con un timeout tan corto probablemente sin producir el mismo banner
(el fallo de `readProfileCache` no tumba `company-brief`, solo degrada el
dato de perfil).

## 5 — Índices que harían falta

Sujeto a lo que confirme el `EXPLAIN` real (punto 3-4), pero si el plan
muestra `Seq Scan` o un `Sort` costoso en cualquiera de las cuatro:

| Consulta | Tabla | Índice que faltaría |
|---|---|---|
| 1 — restaurar último escaneo (candidata) | `scan_results` | Ya existe `scan_results_owner_scan_rank_idx(owner_id, scan_id, rank_index)` — cubre el filtro, pero el `ORDER BY rank_index` es **global** entre varios `scan_id`, algo que ningún índice por-escaneo puede resolver del todo (ver punto 6). Si el `EXPLAIN` muestra el cuello en el `Sort`/transferencia de `raw`, el índice no es la palanca; lo es reducir qué se pide. |
| 4a — `readUniverseRsSnapshot` | `scan_results` | `(owner_id, symbol, created_at desc)` — hoy el índice es `(owner_id, symbol)` sin `created_at` |
| 4b — caché de perfil | `fundamental_snapshots` | `(owner_id, symbol, period_type, updated_at desc)` — hoy es `(owner_id, symbol, period_end desc)`, sin `period_type` y con la columna de orden equivocada |

Los dos primeros de la tabla ya estaban en el inventario del 11 de agosto
como `[SUPUESTO]`; con símbolo real y consulta lista para copiar, quedan a un
`EXPLAIN` de confirmarse.

## 6 — ¿Tiene sentido cargar el último escaneo completo al arrancar?

Esto es lo más importante de los seis puntos, y la respuesta corta es: **no
tal como está montado hoy, y además tiene un bug de recorte silencioso
independiente del rendimiento.**

**Qué pide el cliente.** `getLatestScanFromCloud()`
(`lib/cloudSyncClient.js:250-252`) pide `rowsLimit=2000` — no por escaneo,
**en total** para los 10 escaneos. El servidor aplica ese límite en una sola
consulta con `ORDER BY rank_index ASC LIMIT 2000` sobre la unión de los 10
`scan_id` (`app/api/scans/route.js:415`). `rank_index` es el puesto **dentro
de cada escaneo** (1, 2, 3, ... — ver `resultPayload`,
`app/api/scans/route.js:56`, `rank_index: index + 1`), no un timestamp global.

Eso significa que el recorte a 2.000 no es "las 2.000 filas más relevantes
del escaneo más reciente": es "las primeras filas por `rank_index`,
mezclando los 10 escaneos, hasta llegar a 2.000". Con 10 escaneos en la
mezcla, el reparto aproximado es ~200 filas por escaneo antes de agotar el
cupo — así que del escaneo de 9.918 filas probablemente **solo lleguen del
orden de 200**, las mejor rankeadas, no las 9.918. El código cliente
(`scanFromDb`, línea 246: `results.filter((item) => item.scan_id === row.id)`)
simplemente usa lo que haya sobrevivido al recorte global para ese
`scan_id`, sin saber que se quedó corto. No hay error, no hay aviso: el
escaneo "restaurado" tiene menos filas que el real, y nada en la UI lo dice.
`[SUPUESTO]` sobre el reparto exacto de ~200 por escaneo — depende del
`rank_index` real de cada fila, que no medí; lo que sí es un hecho verificado
por lectura de código es que el corte es global y por `rank_index`, no por
escaneo ni por fecha.

**Qué hace la app con lo que sí llega.** `restoreSnapshot`
(`app/page.jsx:398-455`) mete **todas** las filas restauradas en el estado
`analyzedRows`/`rows` (línea 440-441: `setRows(...)`, `setAnalyzedRows(scan.rows)`),
sin paginar en el servidor. La paginación —`resultPageSize` con
`DEFAULT_RESULT_PAGE_SIZE = 50` (`lib/screenerConfig.js:41`)— es enteramente
del lado cliente (`pagedRows`, referenciado en `app/page.jsx:293`): se
recortan a 50 **después** de haberlas traído todas a memoria del navegador.

**El costo real, en cifras:**
- Se piden hasta 2.000 filas, cada una con la columna `raw` completa (264
  claves de primer nivel según D.1 del inventario), desde una consulta que
  tiene que barajar ~20.202 filas candidatas para decidir cuáles 2.000 le
  tocan a cada escaneo.
- La "compactación" del lado servidor (`compactResearchRow`,
  `lib/researchRowContract.js:90-95`) solo poda `growthMetrics` y
  `chartPreview`; el resto de las 264 claves viaja igual. La lectura y
  transferencia desde Postgres ya pagó el costo completo antes de que esa
  poda ocurra.
- La pantalla, en cualquier momento, pinta 50 filas.

**La pregunta de fondo no es "¿qué índice hace falta?", es "¿por qué
`rowsLimit=2000` para una tabla de 50?".** Un límite razonado por
producto —por ejemplo, pedir solo el escaneo más reciente
(`limit=1` en vez de `limit=10`) y unas pocas páginas de margen
(`rowsLimit` en el orden de 100-200, no 2.000— resolvería a la vez el
timeout de anoche (mucho menos que barajar) y el bug de recorte silencioso
(si solo se pide un escaneo, `rank_index` sí es un orden significativo
dentro de él). Además: `limit === 1` es exactamente la condición que activa
la caché de 15 minutos ya existente (`cacheableLatest`,
`app/api/scans/route.js:402`, `LATEST_SCAN_TTL_MS` en `lib/scansApiCache.js`)
— hoy `limit=10` la
desactiva sin que nadie lo haya decidido explícitamente, así que cada
arranque en frío repite la consulta cara contra Supabase en vez de servir
caché.

No propongo el cambio concreto (la tarea es de diagnóstico), pero el patrón
es el mismo que ya describía B.3 del inventario del 11 de agosto: un tope
dimensionado para "traer bastante por si acaso" que hoy es mayor que la
tabla que en verdad se muestra.

---

## CONFIANZA

**Alta — verificado leyendo código, con cita literal:**
- La cadena completa de arranque: `app/page.jsx:456-568` →
  `getLatestScanFromCloud` (`lib/cloudSyncClient.js:250-252`) → `GET
  /api/scans` (`app/api/scans/route.js:381-442`).
- Que la consulta de `scan_results` en ese `GET` ordena globalmente por
  `rank_index` sobre la unión de hasta 10 `scan_id`, no por escaneo
  (`app/api/scans/route.js:412-417`).
- Que `rank_index` es el puesto dentro de un escaneo, no un valor global
  (`app/api/scans/route.js:56`).
- Que la app pagina en cliente a 50 filas
  (`lib/screenerConfig.js:41`) sobre lo que sea que haya llegado en `rows`,
  sin límite de servidor.
- Que `compactResearchRow` solo poda `growthMetrics`/`chartPreview`, no el
  resto de `raw` (`lib/researchRowContract.js:90-95`).
- Los tres índices citados y su definición exacta
  (`supabase/schema.sql:1521-1529,1542`).
- El mecanismo de timeout: `AbortSignal.timeout(timeoutMs)` en
  `lib/supabaseServer.js:52`, `SCANS_SUPABASE_TIMEOUT_MS = 8000` en
  `app/api/scans/route.js:10`, y el filtro de mensaje
  `/aborted|timeout|timed out/i` → "Timeout consultando Supabase."
  (`app/api/scans/route.js:302`), que es lo que produce el texto del banner
  de `app/page.jsx:536`.

**Alta — verificado contra producción (solo lectura, consultas citadas):**
- El escaneo de 9.918 filas existe con `created_at` 23:29:35 del 12 de
  agosto, `owner_id: "personal"`.
- Los 10 escaneos más recientes de esa ventana y sus `row_count`, con la
  suma de 20.202 filas candidatas para la consulta sospechosa.
- Que `AAPL` tiene filas reales tanto en `scan_results` (para 4a) como en
  `fundamental_snapshots` con `period_type: "profile"` (para 4b), así que
  los `EXPLAIN` del punto 3-4 son ejecutables tal cual están escritos.

**Media — inferido, marcado como `[SUPUESTO]`:**
- Que del escaneo de 9.918 filas solo sobrevivan al recorte global del orden
  de 200 tras el `LIMIT 2000` repartido entre 10 escaneos — la lógica del
  reparto es sólida (`rank_index` es puesto dentro de cada escaneo, el
  `ORDER BY` es global), pero no medí los `rank_index` reales fila por fila
  para confirmar el número exacto.
- Que la candidata del punto 2 sea efectivamente la que se agotó anoche
  (encaja en tiempo, volumen y estructura de la consulta, pero sin el
  `EXPLAIN ANALYZE` real no es una prueba directa).

---

## LO QUE NO HE VERIFICADO

- **El `EXPLAIN ANALYZE` real de las cuatro consultas.** La herramienta de
  solo lectura disponible en esta sesión es PostgREST, no puede ejecutar
  `EXPLAIN`. Los cuatro bloques SQL del punto 3-4 están listos para que los
  corras tú en el editor de Supabase; sin ese resultado, la Parte 2 y la
  Parte 5 son hipótesis fundamentadas, no hechos confirmados.
- **Si el cuello de botella real es el `Sort`/plan de consulta o el volumen
  de bytes transferidos (`raw`).** Por eso incluí la variante 3b sin `raw`:
  compararla contra 3a debería aislarlo. No pude ejecutar ninguna de las dos.
- **El tamaño de `work_mem` del rol usado por PostgREST/Supabase.** Si es
  bajo, un `Sort` de ~20.000 filas con `raw` grande podría volcarse a disco
  (`external merge` en el plan), lo que sería mucho más lento que un sort en
  memoria y no se ve sin el `EXPLAIN` real.
- **Cuántas filas por símbolo tiene ya `scan_results` para `AAPL` u otros
  símbolos frecuentes** — solo confirmé que hay al menos 2 (las de los dos
  escaneos interactivos recientes); el cron materializado también escribe en
  esta tabla y puede haber muchas más que no conté (sin `COUNT` disponible).
- **Si `readGlobalRsForSymbols` (`lib/globalRs.js:103-111`, sin `timeoutMs`)
  contribuyó al timeout de anoche.** Es sospechosa por estructura (hasta 40
  llamadas secuenciales sin timeout propio) pero no produce el mensaje
  "Timeout consultando Supabase" que reportó el banner — ese texto viene
  específicamente de un `AbortSignal.timeout`, y esta ruta no lo usa. Podría
  haber alargado la respuesta sin ser la causa del mensaje exacto.
- **El tamaño en bytes de la columna `raw` para las filas del escaneo de
  9.918.** No hay forma de medirlo con la herramienta de solo lectura
  (sin `pg_column_size` ni agregados). Lo cito como sospechoso por el conteo
  de 264 claves del inventario del 11 de agosto, no por medición directa hoy.
- **Si el banner de anoche vino de esta consulta y no de otra ruta que
  también use Supabase en el arranque** (por ejemplo alguna llamada
  adicional no cubierta en `useEffect` de `app/page.jsx:456`). Tracé el
  camino que el código permite recorrer en un arranque en frío sin sesión
  local; no tengo logs de anoche que confirmen que fue exactamente esta
  petición la que abortó a los 8 segundos.
