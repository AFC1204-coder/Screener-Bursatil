# Por qué el escaneo interactivo analizó 50 de 10.234 símbolos (2026-08-09)

BASE_SHA: `3e30482` (HEAD de `codex/statsedge-ui-polish`) · documento de **diagnóstico
puro**, no se ha tocado ningún archivo de código.

Resumen para quien no programa: el tope de 50 **no lo pone Vercel ni ningún
límite de tiempo del servidor**. Lo pone un control de la propia interfaz
—"Cobertura y alcance"— que vive escondido dentro de una sección plegada y
que, si quedó guardado en "Por lote de 50" en una sesión anterior, se queda
así aunque después cambies de preset o de mercados. El servidor, en cambio,
está preparado para encadenarse tantas veces como haga falta y cubrir el
universo completo; no es el cuello de botella.

---

## PARTE A — De dónde sale el 50

### 1. Camino completo, botón "Ejecutar" → símbolos analizados

**Paso 1 — botón.** [`app/components/screener/ScreenerShell.jsx:324`](../app/components/screener/ScreenerShell.jsx#L324):
```jsx
<button className={`btn ${running ? "btnGhost" : "btnPrimary"}`} onClick={() => { if (running) stopScan(); else { setShowMobileFilters(false); run(); } }}>{running ? "Detener" : "Ejecutar"}</button>
```
`run` es una prop que `ScreenerShell` recibe del contenedor `app/page.jsx`
(componente presentacional puro, según su propio comentario de cabecera,
[`app/components/screener/ScreenerShell.jsx:3-8](../app/components/screener/ScreenerShell.jsx#L3)).

**Paso 2 — `run()` en el contenedor.** [`app/page.jsx:1248`](../app/page.jsx#L1248)
en adelante. Lo relevante para la selección de símbolos:
```js
const base = universe.length && universeScope === currentUniverseScope ? universe : await loadUniverse(null, { preserveResults: hadVisibleRows });
...
const symbols = selected(base);
...
const symbolList = symbols.map((item) => item?.symbol || item).filter(Boolean);
const launched = await postJson("/api/scan", {
  symbols: symbolList,
  name: `Scan servidor ${new Date().toISOString()}`,
  preset: presetKey,
  settings: activeSettings,
});
```
([`app/page.jsx:1273`](../app/page.jsx#L1273), [`app/page.jsx:1277`](../app/page.jsx#L1277),
[`app/page.jsx:1336-1342`](../app/page.jsx#L1336)).

`loadUniverse` es la función que produce el texto que viste en pantalla,
**"Descargando universos completos..."** — literal en
[`app/page.jsx:1220`](../app/page.jsx#L1220):
```js
setStatus(preserveResults ? "Actualizando universo en segundo plano..." : "Descargando universos completos...");
```
y trae el universo real vía `GET /api/universe?markets=...`
([`app/page.jsx:1223`](../app/page.jsx#L1223)) — para "Global" con 29
mercados, esto sí devuelve los 10.234 símbolos (confirmado por el propio
mensaje de progreso de la prueba: "10.234").

**Paso 3 — `selected(base)` decide cuántos y cuáles se analizan.**
[`app/page.jsx:1240-1246`](../app/page.jsx#L1240):
```js
function selected(u) {
  const list = [...u];
  if (scanMode === "random") return shuffle(list).slice(0, scanBatchSize);
  const spread = spreadByInitial(list);
  const start = Math.max(0, Math.min(batchStart, Math.max(0, spread.length - 1)));
  if (scanMode === "all") return spread;
  return spread.slice(start, start + scanBatchSize);
}
```
**Aquí está el corte.** Si `scanMode` es `"batch"` (o `"random"`), el array
que se envía a `/api/scan` queda truncado a `scanBatchSize` elementos
**antes de que el servidor vea nada**. Con `scanMode === "all"` no hay
truncado: se envían los 10.234.

**Paso 4 — servidor recibe la lista ya truncada.**
[`app/api/scan/route.js:29-30`](../app/api/scan/route.js#L29):
```js
const symbols = normalizeSymbols(body.symbols);
if (!symbols.length) return Response.json({ ok: false, error: "symbols requerido (array no vacío)" }, { status: 400 });
```
El servidor **no decide cuántos símbolos analizar** — analiza exactamente
los que el cliente le mandó en `body.symbols`. Si el cliente ya mandó 50,
el servidor analiza 50 y termina; eso explica el estado `"complete"` en
~20s sin ningún error ni corte.

### 2. Dónde está el tope de 50 exactamente

No es una constante del servidor. Es el **valor de un `<select>` de la UI**
combinado con **el valor por defecto que un usuario haya dejado guardado**:

- Opciones disponibles: [`lib/screenerConfig.js:42`](../lib/screenerConfig.js#L42)
  `const SCAN_BATCH_SIZES = [50, 100];`
- Valor de fábrica (primera carga, sin sesión guardada):
  [`lib/screenerConfig.js:43`](../lib/screenerConfig.js#L43)
  `const DEFAULT_SCAN_BATCH_SIZE = 100;` — **el valor de fábrica no es 50**,
  es 100, y el `scanMode` de fábrica es `"all"`
  ([`app/page.jsx:183`](../app/page.jsx#L183): `const [scanMode, setScanMode] = useState("all");`),
  que ni siquiera usa `scanBatchSize`.
- El control real en la interfaz — plegado bajo `<summary>Cobertura y
  alcance</summary>`, es decir, **oculto hasta que el usuario expande esa
  sección**: [`app/components/screener/ScreenerShell.jsx:465-472`](../app/components/screener/ScreenerShell.jsx#L465):
```jsx
<summary><span>Cobertura y alcance{scanModeStale ? <i className="controlDot controlDotStale" aria-hidden="true" title="Modo de alcance cambiado desde el último scan" /> : null}</span></summary>
  <select className="select" value={scanMode} onChange={(e) => { setScanMode(e.target.value); setBatchStart(0); }}><option value="batch">Por lote</option><option value="random">Aleatorio</option><option value="all">Todo el universo</option></select>
  <select className="select" value={scanBatchSize} onChange={(e) => { setScanBatchSize(Number(e.target.value)); setBatchStart(0); }} aria-label="Tickers por lote">
    {SCAN_BATCH_SIZES.map((size) => <option key={size} value={size}>{size} tickers por lote</option>)}
  <input className="input" type="number" value={batchStart} placeholder="Inicio" onChange={(e) => setBatchStart(Number(e.target.value) || 0)} />
  <button className="btn btnGhost" onClick={nextBatch} disabled={running || !universe.length || scanMode === "all"}>Siguiente lote</button>
```
- Ese estado se **persiste en `localStorage` y se restaura entero al
  recargar la página**, sin depender de qué preset o mercados elijas
  después: [`app/page.jsx:492-494`](../app/page.jsx#L492):
```js
setScanMode(session.scanMode || "all");
setBatchStart(Number.isFinite(session.batchStart) ? session.batchStart : 0);
setScanBatchSize(SCAN_BATCH_SIZES.includes(session.scanBatchSize) ? session.scanBatchSize : DEFAULT_SCAN_BATCH_SIZE);
```

En otras palabras: si en algún momento (esta sesión de pruebas u otra
anterior) `scanMode` quedó en `"batch"` y `scanBatchSize` en `50` —lo que
puede pasar con un solo clic en un `<select>` que está plegado y que no se
resetea al cambiar de preset ni de mercados—, **todo escaneo posterior
queda capado a 50, incluido el que se lanzó con preset "Balanceado" y
universo "Global"**, sin ningún aviso visible salvo el punto `controlDotStale`
que solo aparece si `scanMode` cambia respecto al *último* scan ya
ejecutado (no compara contra un valor "esperado").

### 3. Otros límites en el camino (no son la causa de este 0,5%, pero existen)

| Límite | Valor | Dónde | Qué corta |
|---|---|---|---|
| `MAX_SYMBOLS` | 10.000 | [`lib/serverScanRunner.js:25`](../lib/serverScanRunner.js#L25), aplicado en `normalizeSymbols` ([`lib/serverScanRunner.js:39-50`](../lib/serverScanRunner.js#L39)) | Si se enviaran los 10.234 símbolos completos, el servidor recortaría a 10.000 — **menor que el universo Global real**, un límite a tener en cuenta si se resuelve el problema principal. |
| `RESULT_BATCH_SIZE` | 50 | [`lib/serverScanRunner.js:24`](../lib/serverScanRunner.js#L24) | Tamaño del lote de **escritura** en `scan_results` (inserta de 50 en 50). No limita cuántos símbolos se analizan — coincide numéricamente con el bug pero es una cosa distinta. |
| `INLINE_SCAN_SYMBOL_LIMIT` | 20 | [`app/api/scan/route.js:16`](../app/api/scan/route.js#L16) | Si `symbols.length <= 20`, el primer eslabón corre síncrono en la misma request POST; si no, se dispara en `after()`. No trunca símbolos, solo decide si el primer chunk es síncrono o no. |
| `DEFAULT_SCAN_CHUNK_SIZE` | 300 | [`lib/serverScanRunner.js:30`](../lib/serverScanRunner.js#L30) | Símbolos por eslabón del servidor. No es un tope duro (`clampChunkSize` acepta 10–1000), y no limita el total, solo el tamaño de cada tramo antes de reencadenar. |
| `maxDuration` | 300 (declarado) | [`app/api/scan/route.js:15`](../app/api/scan/route.js#L15), [`app/api/scan/continue/route.js:15`](../app/api/scan/continue/route.js#L15) | Límite de duración por invocación serverless — ver Parte C, el valor *real* en el plan Hobby es otro. |
| `groupsLimit` | 50 (default) | [`lib/discoveryCache.js:46`](../lib/discoveryCache.js#L46), [`lib/discovery.js:8`](../lib/discovery.js#L8) | Pertenece al módulo de *discovery/agrupación* (curación de "grupos" de acciones relacionadas), no al runner de escaneo. Coincide en el número, no en la causa. |
| `limit=50` en `/api/leaderboards` | 50 | [`lib/screenerPipeline.js:61-62`](../lib/screenerPipeline.js#L61) (`cachedScreenerQuery`) | Usado por `loadCachedScreenerPreview` ([`app/page.jsx:1276`](../app/page.jsx#L1276)) para pintar una vista previa desde un leaderboard **ya materializado** (scans previos), mientras el scan en vivo sigue corriendo en paralelo. Es una tabla temporal que la propia interfaz reemplaza cuando llegan resultados reales del scan en curso — no es "lo que se analizó", es "lo que había cacheado de antes". Puede confundirse con el resultado final si el usuario mira la pantalla justo cuando aparece este preview. |

Ninguno de estos otros "50" es la causa del 0,5% observado: el único que
determina **cuántos símbolos entran al scan real** es `scanBatchSize` vía
`selected()` (punto 1-2 arriba).

### 4. ¿Se puede subir desde la interfaz?

Sí, es un control de UI, no algo fijo en el código: el `<select>` de
"Tickers por lote" ofrece 50 o 100 ([`lib/screenerConfig.js:42`](../lib/screenerConfig.js#L42)),
y el modo se puede cambiar a **"Todo el universo"** (`scanMode: "all"`),
que elimina el truncado por completo ([`app/page.jsx:1245`](../app/page.jsx#L1245):
`if (scanMode === "all") return spread;`). El problema no es que esté fijo
en el código — es que:
1. El control vive plegado bajo un `<summary>` que hay que expandir a
   mano.
2. Su valor se restaura de una sesión anterior guardada en `localStorage`
   sin relación con el preset/universo que acabas de elegir en la parte
   visible de la pantalla ([`app/page.jsx:492-494`](../app/page.jsx#L492)).
3. No hay ninguna advertencia tipo "vas a analizar solo el 0,5% del
   universo elegido" — el único indicador (`scanModeStale`) compara contra
   el *scan anterior*, no contra la expectativa del usuario.

---

## PARTE B — Con qué criterio se eligen esos 50

### 5. Algoritmo de selección: `spreadByInitial`

[`lib/screenerPipeline.js:366-388`](../lib/screenerPipeline.js#L366):
```js
function spreadByInitial(list) {
  const groups = new Map();
  for (const item of list) {
    const symbol = item.symbol || item;
    const key = /^[A-Z]/.test(symbol?.[0]) ? symbol[0] : "#";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const buckets = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, items]) => items);
  const out = [];
  let index = 0;
  while (out.length < list.length) {
    let added = false;
    for (const bucket of buckets) {
      if (bucket[index]) {
        out.push(bucket[index]);
        added = true;
      }
    }
    if (!added) break;
    index += 1;
  }
  return out;
}
```
Agrupa por **letra inicial del símbolo** y reparte "en ronda": primero un
símbolo de cada bucket A, B, C... (el índice 0 de cada grupo), luego el
índice 1 de cada grupo, etc. Después, `selected()` corta con
`spread.slice(start, start + scanBatchSize)` — es decir, toma los
primeros `scanBatchSize` elementos de esa secuencia repartida.

**No hay ningún criterio de liquidez, materialización, relevancia o
prioridad.** El único criterio es alfabético dentro de cada bucket (el
orden interno de cada grupo de letra es el orden en que `loadUniverse`
concatenó los datos del proveedor — no está ordenado por market cap ni
volumen en este punto del código) y el reparto round-robin entre letras
para no sesgar hacia "todo empieza por A".

### 6. ¿Es determinista?

- Con `scanMode: "batch"`: **sí**, si el universo (`base`) no cambia entre
  corridas, `spreadByInitial` es una función pura sobre el mismo array de
  entrada y `batchStart` es un estado persistido — dos escaneos seguidos
  con la misma configuración analizan los mismos símbolos.
- Con `scanMode: "random"`: **no**. [`app/page.jsx:1242`](../app/page.jsx#L1242):
  `if (scanMode === "random") return shuffle(list).slice(0, scanBatchSize);`
  usa `shuffle` ([`lib/screenerPipeline.js:365`](../lib/screenerPipeline.js#L365)),
  que se basa en `Math.random()` — cada corrida es distinta.

### 7. Consecuencia: no prioriza por relevancia

Confirmado por el código: el escaneo interactivo, en modo `"batch"`, no
mira capitalización, volumen, ni ninguna señal de liderazgo antes de
elegir qué analizar. Si el universo trae mezclados líderes reales (AAPL,
MSFT...) con microcaps ilíquidas, ambos tienen la misma probabilidad de
entrar en los primeros 50 — depende solo de en qué posición alfabética
caigan dentro de su bucket de letra, y de qué tramo (`batchStart`) esté
activo. **Es un muestreo alfabético, no una preselección de calidad.**

**Evidencia directa en producción** (no solo lectura de código): se
consultó la tabla `scans` real vía el MCP de solo lectura de Supabase.

Consulta ejecutada:
```
supabase_query(table="scans", select="id,name,preset,market_regime,row_count,created_at,updated_at,settings", order="created_at.desc", limit=5)
```
Resultado (extracto, fila más reciente, `created_at: 2026-08-09T14:07:42Z`,
`preset: "balanced"`, `market_regime: "server-scan"`, `row_count: 50`,
`progress.status: "complete"`, `progress.total: 50`,
`progress.completed: 50`):
```json
"scanSymbols": ["8035.T", "AAPL", "BRK-B", "COST", "DIS", "EOG", "FTNT", "GOOGL", "HD", "IBM", "JPM", "KO", "LLY", "MSFT", "NVDA", "ORCL", "PG", "QCOM", "RTX", "SPGI", "TSLA", "UNH", "V", "WMT", "XOM", "YAAS", "Z", "6857.T", "AMZN", "BAC", "CRM", "DHR", "ECL", "FCX", "GE", "HON", "ISRG", "JNJ", "KLAC", "LIN", "META", "NFLX", "ON", "PLTR", "Q", "RBLX", "SYK", "TMO", "UBER", "VZ"]
```
Esta lista es **exactamente** el patrón que produce `spreadByInitial`: un
símbolo por cada letra A→Z en la primera ronda (AAPL, BRK-B, COST, DIS,
EOG... hasta Z), seguido del arranque de la segunda ronda (AMZN, BAC,
CRM...). Esto confirma en datos reales de producción — no solo en teoría
— que el mecanismo que truncó a 50 fue `scanMode !== "all"` con
`scanBatchSize` pequeño, actuando sobre `spreadByInitial`, tal como se
describe en los puntos 1-2 y 5. `market_regime: "server-scan"` solo lo
escribe [`app/api/scan/route.js:59`](../app/api/scan/route.js#L59) — los
caminos de cron (`writeMaterializedScan`,
[`lib/materializedScanner.js:1546`](../lib/materializedScanner.js#L1546))
escriben siempre `market_regime: "batch-cache"`, así que esta fila viene
del mismo camino interactivo trazado en la Parte A, no de un cron.

**Aviso — no se ha podido confirmar al 100% que esta fila concreta sea la
misma prueba descrita en el enunciado**: los `settings` guardados de esa
fila incluyen claves (`source: "jobs/scan-refresh"`, `limit`, `offset`,
`perMarket`, `marketOffsets`, `priorityMode`) que no aparecen en ningún
sitio del catálogo de filtros de la interfaz (`lib/screenerFilterCatalog.js`)
y que sí coinciden con el formato que usa el módulo de scans
materializados/cron (`lib/materializedScanner.js`, `app/api/jobs/scan-refresh/route.js`)
para su propio `settings`. No se encontró en el código ningún llamador que
haga `POST /api/scan` con ese tipo de `settings` aparte de
`app/page.jsx` — es decir, `activeSettings` del cliente **contenía** esas
claves cron-style en el momento del escaneo, probablemente porque
`settingsForPreset` (`app/page.jsx:989`, `app/page.jsx:468`) hace spread
de un objeto `settings` de sesión que en algún punto anterior se rellenó
con datos de un scan materializado y esas claves quedaron pegadas sin
limpiarse en corridas posteriores. Esto **no cambia la conclusión** de la
Parte A/B (el mecanismo de truncado es el mismo, y la lista de símbolos lo
demuestra), pero queda como pregunta abierta secundaria — ver "LO QUE NO
HE VERIFICADO".

---

## PARTE C — Qué lo limita de verdad

### 8. ¿Es el `maxDuration` de 60s del plan Hobby el límite real?

**No es el mecanismo que produjo este caso concreto** (la Parte A/B ya
demuestra que el corte ocurre en el cliente, antes de que el servidor
reciba nada). Pero conviene aclarar la relación entre lo declarado en
código y el plan de Vercel:

- `app/api/scan/route.js:15` y `app/api/scan/continue/route.js:15`
  declaran `export const maxDuration = 300;` — 300 segundos.
- La documentación interna del propio repo, al hablar del **cron**
  (`app/api/cron/scan-refresh/route.js:12`, que declara
  `export const maxDuration = 60;`), confirma explícitamente que el
  proyecto corre en **Vercel Hobby**:
  [`docs/overhead-scan-2026-08-05.md:6-7`](../docs/overhead-scan-2026-08-05.md#L6):
  > "...que es el que corre en el cron real de Vercel (Hobby, `maxDuration = 60`...)"

  y [`docs/overhead-scan-2026-08-05.md:655`](../docs/overhead-scan-2026-08-05.md#L655):
  > "...60s de Vercel Hobby (un plan superior con `maxDuration` mayor cambiaría esta...)"

Vercel Hobby impone un techo de 60s por invocación de función
independientemente de lo que declare `maxDuration` en el código (esto es
una regla de la plataforma, no algo verificable leyendo este repo — ver
"LO QUE NO HE VERIFICADO"). Si eso es correcto, **el `maxDuration = 300`
declarado en `app/api/scan/route.js` y `app/api/scan/continue/route.js` es
optimista**: cada eslabón real probablemente tiene ~60s reales, no 300,
sin que el código lo sepa ni lo controle.

### 9. ¿Cuántos símbolos caben en 60s, con los números medidos?

Aquí hay que distinguir **qué se midió** de **qué pide la tarea**, porque
no coinciden:

**Lo que efectivamente está medido y documentado en el repo** (no lo que
describe el enunciado de esta tarea, que no se pudo verificar tal cual —
ver más abajo):

- [`docs/limites-cron-2026-08-04.md:78`](../docs/limites-cron-2026-08-04.md#L78):
  **2,118 s/símbolo** (wall-clock real de producción, promedio simple,
  sobre `runMaterializedScan`/`analyzeOne`, el pipeline del **cron**, no el
  de `serverScanRunner.js`).
- [`docs/limites-cron-2026-08-04.md:90`](../docs/limites-cron-2026-08-04.md#L90):
  **0,095 s/símbolo** medido para la parte de red pura (sin Supabase).
- [`docs/limites-cron-2026-08-04.md:103`](../docs/limites-cron-2026-08-04.md#L103):
  regresión lineal sobre corridas reales: **b ≈ 0,535 s/símbolo marginal**,
  con un término fijo de arranque de invocación de **≈33,7s** (línea 612 del
  mismo documento: "la regresión de A.2 (33,7s fijo + 0,535s/símbolo)").
- [`docs/bench-analyze-2026-08-04.md:559`](../docs/bench-analyze-2026-08-04.md#L559):
  benchmark local (sin escrituras a Supabase, caché caliente) del ciclo
  completo `analyzeOne`: **~44 ms/símbolo a concurrencia 8** (~95ms a
  concurrencia 2) — dos órdenes de magnitud más rápido que la producción
  real, porque no incluye las escrituras/lecturas a Supabase ni la
  variabilidad de red real.

**Estimación** (no medición) usando la regresión más realista de
producción — 33,7s fijos + 0,535 s/símbolo marginal, [`docs/limites-cron-2026-08-04.md:103`](../docs/limites-cron-2026-08-04.md#L103) —
para un techo de 60s por invocación:

```
símbolos ≈ (60 − 33,7) / 0,535 ≈ 49
```

Esto da, por coincidencia numérica, un número muy cercano a 50 — pero
**es una estimación con los números del pipeline del cron
(`materializedScanner.js`/`analyzeOne`), no del pipeline del escaneo
interactivo (`serverScanRunner.js`)**, que no tiene su propio benchmark
documentado en el repo (ver "LO QUE NO HE VERIFICADO"). Con
`SCAN_CONCURRENCY = 5` ([`lib/serverScanRunner.js:23`](../lib/serverScanRunner.js#L23))
en vez de la concurrencia 1-8 usada en esos benchmarks, el número real de
símbolos que caben en 60s sería distinto (mayor, si el término fijo de
33,7s no escala igual con concurrencia 5, algo que tampoco está medido
para este runner específico). **No se puede afirmar con los datos
disponibles que el techo de 60s de Hobby explique por qué se obtuvieron
exactamente 50** — la Parte A/B ya demuestra que la causa real es el
truncado en cliente, que ocurre *antes* de que el servidor procese ningún
símbolo.

**Sobre la cifra que trae el enunciado de la tarea** ("195 ms por símbolo
a concurrencia 4, corrida real de 5.564 símbolos en 18 minutos"): no se
encontró esa medición en el repo. Lo que sí hay, en el commit más reciente
(`3e30482`, "feat(bars): script de refresco masivo del universo
estadounidense"), es:
> "Medido con `--write --limit=10`: **369 ms por símbolo** a concurrencia 4,
> incluyendo lectura, descarga y escritura. **Extrapolado** a 5.605: unos 34
> minutos."

Es decir: la medición real fue sobre **10 símbolos** (369 ms/símbolo,
concurrencia 4), y los "34 minutos para 5.605" son una **extrapolación**
del propio autor del commit, no una corrida real cronometrada de principio
a fin. Además, ese script (`scripts/refresh-bars.mjs`) solo **descarga y
escribe barras** (`withDailyBarsCache`) — no ejecuta `buildResearchRow` ni
las 18 señales, así que no es directamente comparable al coste de
"analizar" un símbolo en el sentido del escaneo interactivo. No hay en el
repo evidencia de una corrida real medida de 5.564 símbolos en 18 minutos
tal como la describe el enunciado.

### 10. Mecanismo de continuación: `/api/scan/continue`, `nextLinkToken`, `DEAD_LINK_MS`

Cadena normal, en [`lib/serverScanRunner.js:340-346`](../lib/serverScanRunner.js#L340)
(tras procesar un chunk y quedar símbolos pendientes):
```js
// Quedan símbolos: persistir cursor + token de eslabón y re-encadenar.
const linkToken = crypto.randomUUID();
await patchScan(scanId, ownerId, {
  row_count: state.insertedCount,
  settings: progressPayload("running", { nextLinkToken: linkToken }),
});
await chainNextLink({ baseUrl, scanId, linkToken });
```
`chainNextLink` ([`lib/serverScanRunner.js:132-142`](../lib/serverScanRunner.js#L132))
hace un `POST /api/scan/continue` interno con `{ scanId, linkToken }`. El
endpoint valida el token contra `settings.progress.nextLinkToken`
([`app/api/scan/continue/route.js:42`](../app/api/scan/continue/route.js#L42):
`const isChain = Boolean(linkToken && progress.nextLinkToken && linkToken === progress.nextLinkToken);`),
hace un CAS (compare-and-swap) al reclamarlo
([`app/api/scan/continue/route.js:54-71`](../app/api/scan/continue/route.js#L54))
y relanza `runScanChunk` en `after()`
([`app/api/scan/continue/route.js:73`](../app/api/scan/continue/route.js#L73)).

**Retoma de eslabón muerto**: si el heartbeat (`updated_at`, que se
refresca cada `FLUSH_INTERVAL_MS` = 1.500 ms mientras el eslabón vive,
[`lib/serverScanRunner.js:270`](../lib/serverScanRunner.js#L270)) lleva
más de `DEAD_LINK_MS` = 10 minutos sin actualizarse
([`lib/serverScanRunner.js:33`](../lib/serverScanRunner.js#L33)), cualquier
llamada a `/api/scan/continue` sin token válido puede reclamar el scan y
seguir desde el último cursor persistido
([`app/api/scan/continue/route.js:41-50`](../app/api/scan/continue/route.js#L41)).
Esto cubre el caso de que una lambda muera a mitad de un eslabón (por
ejemplo, si de verdad topa con el techo de 60s de Hobby) — el siguiente
disparo retoma desde `progress.cursor`, no desde cero.

El cliente es agnóstico al número de eslabones: solo hace `GET
/api/scan?id=...&offset=...` cada `SERVER_SCAN_POLL_MS` = 2.000 ms
([`lib/screenerConfig.js:45`](../lib/screenerConfig.js#L45)) hasta que
`isTerminalScanStatus(serverStatus)` sea verdadero
([`app/page.jsx:1366`](../app/page.jsx#L1366)). El diseño **sí permite**
superar el límite de una sola invocación — está construido justo para
eso.

### 11. ¿Por qué se detuvo en 50 en vez de encadenar?

Porque nunca hizo falta encadenar: el criterio de parada de
`runScanChunk` es puramente aritmético, sin relación con tiempo ni con el
tamaño real del universo elegido:
```js
if (state.completed >= symbols.length) {
  // ... finaliza el scan ...
  return;
}
```
([`lib/serverScanRunner.js:281`](../lib/serverScanRunner.js#L281)). Como
`symbols` viene de `settings.scanSymbols`, que el cliente ya había
recortado a 50 **antes de llamar a `POST /api/scan`** (Parte A, puntos
1-2), el primer y único eslabón procesó `chunkEnd = min(0 + chunkSize,
50) = 50` símbolos, `state.completed` llegó a `50 >= symbols.length (50)`
en la primera pasada, y el scan terminó como `"complete"` sin necesidad de
ningún `nextLinkToken`. El mecanismo de encadenamiento nunca se activó
porque **nunca hubo más de 50 símbolos que encadenar** — el cuello de
botella está antes de esta función, no dentro de ella.

---

## PARTE D — Qué haría falta

### 12. Opciones para escanear una porción significativa del universo (sin recomendar ninguna)

| Opción | Qué se toca | Qué límite resuelve | Qué sigue en pie |
|---|---|---|---|
| **A. Cambiar el modo de escaneo en la UI a "Todo el universo" y limpiar/subir el estado guardado de `scanBatchSize`** | Nada de código — es un cambio de configuración/uso, expandir "Cobertura y alcance" y seleccionar `scanMode = "all"` | El truncado del cliente (Parte A/B), que es la causa real observada | El límite de tiempo real por invocación (60s en Hobby, si aplica) para escaneos con miles de símbolos; sin encadenamiento eficiente esto puede tardar muchos eslabones. También el `MAX_SYMBOLS = 10.000` del servidor (10.234 > 10.000). |
| **B. Aumentar `DEFAULT_SCAN_BATCH_SIZE`/las opciones de `SCAN_BATCH_SIZES` y hacerlo el valor por defecto real** | `lib/screenerConfig.js` | Solo sirve si además se fuerza `scanMode` distinto de `"batch"`/`"random"`, o se sube mucho el batch — sigue siendo un tope arbitrario, no "todo el universo" | El usuario sigue sin ver ni entender que hay un tope; no resuelve el problema de fondo (falta de aviso/transparencia) |
| **C. Hacer visible y explícito el aviso cuando el alcance configurado (`scanMode`/`scanBatchSize`) analiza menos del universo elegido** | UI: `ScreenerShell.jsx`, posiblemente el mensaje de `run()` en `app/page.jsx` | El problema de "no explica por qué analiza el 0,5%" señalado en el enunciado — transparencia, no cobertura | No cambia cuántos símbolos se analizan, solo lo hace visible |
| **D. Subir `MAX_SYMBOLS` en el servidor por encima de 10.234** | `lib/serverScanRunner.js:25` | El corte a 10.000 si algún día se envían los 10.234 completos | El coste real de analizar ~10.234 símbolos en eslabones encadenados (tiempo total del scan, número de eslabones, carga sobre Yahoo/Supabase) |
| **E. Aumentar `maxDuration` declarado o cambiar de plan de Vercel (Hobby → Pro/Enterprise)** | `app/api/scan/route.js`, `app/api/scan/continue/route.js`, y la suscripción de Vercel | Si el techo real de 60s (Hobby) resulta ser un cuello de botella genuino para escaneos grandes, permitiría eslabones más largos, menos invocaciones | No resuelve el truncado en cliente (causa real de este caso); sigue habiendo un límite de plataforma, solo que más alto |
| **F. Reducir `DEFAULT_SCAN_CHUNK_SIZE` para ajustarse al techo de tiempo real por invocación** | `lib/serverScanRunner.js:30` | Evita que un eslabón muera a mitad de proceso por exceder el tiempo real disponible (si 300 es efectivamente 60 en Hobby) | El número total de eslabones necesarios para cubrir el universo completo aumenta, y con ello la duración total del scan (aunque el mecanismo de encadenamiento ya soporta esto) |
| **G. Leer de `daily_bars` en vez de descargar de Yahoo para símbolos ya refrescados** | `lib/serverScanRunner.js` (o una función paralela), aprovechando el trabajo de `scripts/refresh-bars.mjs` (commit `3e30482`) | Reduce drásticamente el coste por símbolo si las barras ya están frescas en Supabase (evita la descarga de red, que es la parte más cara medida) | Requiere que el universo objetivo ya esté refrescado en `daily_bars` (hoy, 5.564 de 10.234 según el commit `3e30482`, no la totalidad) |

### 13. Coste de analizar el universo ya refrescado (5.564 símbolos), solo leyendo de la base

**Esto es una estimación, no una medición** — no se ha ejecutado ningún
escaneo real ni se ha cronometrado esta ruta específica (leer
`daily_bars` sin descargar de Yahoo) porque la tarea prohíbe ejecutar
escaneos reales.

Verificación de que la cifra "5.564 con barras hasta el 7 de agosto" del
enunciado es plausible — consulta ejecutada:
```
supabase_query(table="daily_bars", select="symbol,trade_date", order="trade_date.desc", limit=5)
```
Resultado: las 5 filas más recientes tienen `trade_date: "2026-08-07"`
(símbolos `XMTR`, `TALO`, `SHBI`, `GROY`, `ANET`). Esto confirma que
**hay** barras frescas al 7 de agosto en producción, consistente con el
commit `3e30482` (corrida `--write` del script de refresco), pero esta
consulta **no cuenta cuántos símbolos** tienen esa fecha — el conector de
solo lectura disponible no soporta `COUNT` ni SQL arbitrario, solo
filtros PostgREST simples, así que el número exacto de "5.564" no se pudo
re-verificar de forma independiente en esta sesión; se toma del commit
`3e30482` como dato ya documentado por el propio autor del repo.

Con eso como base, y usando el número medido más relevante para "leer sin
descargar" — el propio commit describe el script como midiendo "lectura,
descarga y escritura" juntas (369 ms/símbolo a concurrencia 4), sin
desglosar cuánto de eso es solo la lectura de Supabase — la estimación más
razonable disponible en el repo es la de
[`docs/limites-cron-2026-08-04.md:90`](../docs/limites-cron-2026-08-04.md#L90):
**0,095 s/símbolo** para la parte de red (que en un escenario "solo lectura
de base, sin red a Yahoo" se sustituiría por una lectura a Supabase,
previsiblemente más rápida, pero no medida por separado en el repo) más el
coste de cómputo puro de `buildResearchRow`, medido en
[`docs/bench-analyze-2026-08-04.md:551`](../docs/bench-analyze-2026-08-04.md#L551)
en **~18 ms por símbolo** a concurrencia 8.

Estimación gruesa (no medición): si el coste dominante pasa a ser el
cómputo (~18-44 ms/símbolo, camino feliz sin red a Yahoo) en vez de la
descarga:
```
5.564 símbolos × ~0,044 s/símbolo (concurrencia 8, límite superior optimista) ≈ 245 s ≈ 4 min
5.564 símbolos × ~0,095 s/símbolo (con lectura a Supabase en vez de red a Yahoo) ≈ 529 s ≈ 8,8 min
```
Ambas cifras son **extrapolaciones de benchmarks locales sin escrituras
reales a `scan_results`/finalización de percentiles**, no mediciones del
escenario "leer daily_bars + analizar 5.564 símbolos reales de punta a
punta". El propio [`docs/bench-analyze-2026-08-04.md`](../docs/bench-analyze-2026-08-04.md)
trae un aviso al principio advirtiendo que extrapolaciones de este tipo
("38,9s para ~880 y 8min 12s para 11.123") ya se marcaron como **no
válidas como duración de producción** en una revisión anterior del mismo
documento, precisamente porque excluyen arranque, selección de universo,
y lecturas/escrituras reales. La misma cautela aplica aquí: esto es una
cota inferior optimista, no una promesa de duración real.

---

## CONFIANZA

- **Alta** — el mecanismo de truncado a 50 (Parte A, puntos 1-4 y Parte B,
  puntos 5-7): confirmado por lectura directa del código, con cita
  literal de cada eslabón, y corroborado con datos reales de producción
  (Parte B.7) donde la lista de símbolos analizados coincide exactamente
  con la firma algorítmica de `spreadByInitial`.
- **Alta** — que el servidor no impone ningún tope de tiempo/símbolos que
  explique el 50 en este caso concreto (Parte C.11): el criterio de parada
  de `runScanChunk` es aritmético (`completed >= symbols.length`) y
  `symbols.length` ya era 50 al llegar al servidor.
- **Media** — la estimación de "~49 símbolos caben en 60s" (Parte C.9):
  aritméticamente correcta con los números documentados, pero esos
  números provienen del pipeline del **cron** (`materializedScanner.js`),
  no del pipeline del **escaneo interactivo** (`serverScanRunner.js`), que
  no tiene benchmark propio documentado en el repo. Tratarla como
  coincidencia plausible, no como explicación causal de por qué salieron
  exactamente 50.
- **Baja** — la cifra de "195 ms/símbolo, 5.564 símbolos en 18 minutos"
  del enunciado de la tarea: no se encontró en el repo. Lo documentado
  (commit `3e30482`) es 369 ms/símbolo medido sobre 10 símbolos,
  extrapolado (no medido) a ~34 minutos para 5.605.
- **Baja / no verificado** — la identidad exacta de la fila de `scans` de
  producción citada en la Parte B.7 como "la misma prueba" que describe el
  enunciado: coincide en fecha, preset, mecanismo y tamaño, pero sus
  `settings` incluyen claves que no se pudo rastrear a ningún llamador
  conocido de `POST /api/scan` distinto de `app/page.jsx`.

## LO QUE NO HE VERIFICADO

1. **Que Vercel Hobby imponga realmente un techo de 60s pese a
   `maxDuration = 300` declarado en el código.** Esto es una regla de la
   plataforma Vercel, no algo que se pueda confirmar leyendo este
   repositorio; se basa en comentarios de otros documentos del propio
   repo (`docs/overhead-scan-2026-08-05.md`) que sí afirman explícitamente
   que el proyecto corre en Hobby, pero no se verificó contra el
   dashboard/API de Vercel en esta sesión (el MCP de Vercel requiere
   autorización que no está disponible en este entorno no interactivo).
2. **Benchmark propio del pipeline `serverScanRunner.js`** (descarga +
   `buildResearchRow` + escritura por lotes de 50 + heartbeat cada 1,5s).
   Todos los números de tiempo citados en la Parte C.9 provienen de
   benchmarks del pipeline del cron (`materializedScanner.js`) o de un
   script distinto (`refresh-bars.mjs`), no del código que realmente
   ejecuta el escaneo interactivo.
3. **El conteo exacto de símbolos con barras frescas al 7 de agosto**
   (5.564 según el commit `3e30482`): no se pudo re-verificar con `COUNT`
   porque el conector de solo lectura de Supabase disponible en esta
   sesión no soporta SQL arbitrario, solo filtros PostgREST simples sin
   agregación.
4. **El origen exacto de las claves `source: "jobs/scan-refresh"`,
   `perMarket`, `marketOffsets`, etc. dentro de `settings.scanSymbols`**
   de la fila de producción citada en la Parte B.7 — se identificó que
   provienen del cliente (`activeSettings`) porque ningún otro código
   llama a `POST /api/scan` con esa forma, pero no se rastreó el punto
   exacto donde esas claves entraron al estado de sesión del cliente.
5. **Si la prueba real descrita en el enunciado ("Global", 29 mercados,
   10.234 símbolos, ~20s) corresponde exactamente a la fila de `scans` de
   producción citada en la Parte B.7**, o si fue una corrida distinta (esa
   fila solo lista mercados `US, HK, AU, CA`, no los 29 de "Global") que
   compartió el mismo mecanismo de truncado. No se dispone de más
   contexto (por ejemplo, logs del navegador o el `localId` exacto de esa
   sesión) para confirmarlo con certeza.
6. **No se ejecutó ningún escaneo real** (prohibido por la tarea), así que
   ninguna de las cifras de tiempo de la Parte D.13 es una medición
   directa del escenario "leer `daily_bars` sin descargar, universo
   completo" — son extrapolaciones explícitamente marcadas como tales.
