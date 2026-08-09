# Timeout al escanear "Todo el universo" (10.234 símbolos) — diagnóstico

Fecha: 2026-08-09. BASE_SHA: `d458257`. Rama: `codex/statsedge-ui-polish`.

**Este documento es solo diagnóstico. No se ha modificado ningún archivo de
código, no se ha escrito en Supabase y no se ha ejecutado ningún escaneo real
desde la interfaz.**

---

## Resumen para el dueño (sin jerga)

Al pulsar "Ejecutar" con el modo "Todo el universo" (10.234 símbolos), el
escaneo avanza normalmente hasta el símbolo 47 y entonces revienta con un
error crudo de la base de datos: `canceling statement due to statement
timeout` ("Postgres canceló la consulta porque tardaba demasiado").

**La sospecha inicial de esta tarea — que la culpable era la función que lee
"qué se escaneó recientemente" (`readRecentlyScannedSymbols`) o el cálculo de
fuerza relativa por lotes (`readGlobalRsForSymbols`) — queda descartada por
lectura directa del código: ninguna de las dos se ejecuta en el camino del
escaneo interactivo.** Solo se usan en el cron automático y en la pantalla de
"scans guardados", dos caminos distintos que el botón "Ejecutar" no toca.

Lo que sí encontré, con el código como evidencia:

1. **El candidato más plausible** es una escritura repetida (no una lectura):
   cada ~1,5-3 segundos, mientras el escaneo corre, el servidor guarda su
   progreso reescribiendo la fila completa del scan en la tabla `scans` —
   y esa fila lleva dentro, en el mismo campo, **la lista completa de los
   10.000 símbolos a escanear** (se repite entera en cada guardado, no solo
   el progreso). No pude confirmarlo ejecutando esa escritura de verdad,
   porque la tarea me restringe a solo lectura — ver "CONFIANZA" más abajo.
2. Los otros dos fallos que se pidió documentar sí están confirmados al
   100% por el código: el error de Postgres se muestra crudo en pantalla sin
   traducir (Parte C.1), y el contador final de "analizadas" no refleja lo
   procesado sino el tamaño del universo pedido — así falle a los 47 o a los
   10.234, el mensaje final siempre diría "10.234 analizadas" (Parte C.2).
3. El cron automático (12-24 símbolos por ciclo) usa un código **completamente
   distinto** al del botón "Ejecutar" — no comparte ni una función con el
   camino que falla, así que no hay riesgo de que le pase lo mismo por esta
   causa (Parte D.2).

---

## PARTE A — Qué consultas hace el escaneo interactivo y cuál escala con el universo

### A.1 El camino completo, desde que se pulsa "Ejecutar"

Pulsar "Ejecutar" en modo "Todo el universo" dispara, en el cliente
(`app/page.jsx`), la función `run()`. Para el modo servidor (el que se usa
aquí, no el legacy client-side), la parte relevante es:

`app/page.jsx:1332-1337`:
```js
const symbolList = symbols.map((item) => item?.symbol || item).filter(Boolean);
const launched = await postJson("/api/scan", {
  symbols: symbolList,
  name: `Scan servidor ${new Date().toISOString()}`,
  preset: presetKey,
  settings: activeSettings,
});
```

`symbols` viene de `selected(base)` (`app/page.jsx:1240-1246`), que en modo
`"all"` devuelve el universo completo cargado (`spread`, sin recortar) — es
decir, los 10.234 símbolos van íntegros en el body del POST.

**`POST /api/scan`** (`app/api/scan/route.js:18-76`) hace, en orden:

1. `supabaseRequest("scans", {method:"POST", ...})` (línea 34-62) — **UNA
   sola inserción** de la fila del scan. El body incluye
   `settings.scanSymbols: symbols` (línea 45) — la lista completa de
   símbolos normalizados — y `settings.progress` con el estado inicial.
   Tabla: `scans`. No escala per-query con miles de filas leídas (es un
   INSERT de una fila), pero el PAYLOAD de esa fila sí es proporcional al
   tamaño del universo (ver A.6).
2. Si `symbols.length > INLINE_SCAN_SYMBOL_LIMIT` (20, línea 16), se lanza el
   primer eslabón en segundo plano vía `after(runFirstChunk)` (línea 70) — la
   respuesta HTTP del POST vuelve enseguida; el trabajo real ocurre después,
   fuera de esa respuesta.

**El cliente hace polling** de `GET /api/scan?id=...&offset=...` cada 2
segundos (`SERVER_SCAN_POLL_MS = 2000`, `lib/screenerConfig.js:45`), citado
en `app/page.jsx:1343-1367`.

**`GET /api/scan`** (`app/api/scan/route.js:78-126`) hace dos consultas por
llamada:
- `supabaseRequest("scans", {query: "id=eq...&owner_id=eq...&select=...&limit=1"})`
  (línea 90-92) — una fila por `id`, tabla `scans`. No escala con el universo.
- `supabaseRequest("scan_results", {query: "scan_id=eq...&owner_id=eq...&rank_index=gt.${offset}&...&limit=${limit}"})`
  (línea 98-100) — filtrado por `scan_id` (no por fecha), tabla
  `scan_results`. `limit` está topado a 500 (línea 87). Esto SÍ toca
  `scan_results` sin filtro de fecha, pero está acotado por `scan_id` (un
  único scan) y por `limit`, y cubierto exactamente por el índice
  `scan_results_owner_scan_rank_idx (owner_id, scan_id, rank_index)`
  (`supabase/schema.sql:1522`) — no escala con el tamaño de la tabla
  completa ni con el universo pedido, solo con cuántas filas tiene ESE scan.

**El trabajo real ocurre en `runScanChunk`** (`lib/serverScanRunner.js:146-367`),
disparado por `after()` desde `POST /api/scan` y re-encadenado por
`POST /api/scan/continue` para cada eslabón siguiente. Dentro de un eslabón:

1. `supabaseRequest("scans", {query:"id=eq...&select=settings,row_count&limit=1"})`
   (línea 149-151) — lee la fila completa del scan, **incluida
   `settings.scanSymbols` con los 10.000 símbolos** (JSON completo por red).
   Una sola fila; no escala con volumen de tabla.
2. `supabaseRequest("scan_results", {method:"DELETE", query:"scan_id=eq...&owner_id=eq...&rank_index=gt.${insertedCount}"})`
   (línea 201-204) — saneo de restos de un eslabón muerto. Filtrado por
   `scan_id`, mismo índice que arriba. No escala con el universo.
3. `loadBenchmarks(...)` (línea 205, definida en 113-128) — llamadas a Yahoo
   Finance (`fetchYahooChart`), no a Supabase.
4. El bucle de workers (línea 213-244, concurrencia 5) llama por símbolo a
   `fetchYahooChart`/`fetchYahooProfile` (Yahoo, no Supabase) y a
   `writeDailyBarsCache(symbol, chart, {interval:"D"})` **sin awaitear**
   (línea 234, comentario explícito de por qué: no debe sumar latencia a la
   respuesta del usuario). Esta función sí escribe en `daily_bars`
   (`lib/dailyBarsCache.js:267-330`), filtrada siempre por `owner_id+symbol`
   individual — nunca por lote de miles. Al no ser awaiteada, si fallara
   (incluido un timeout), el `.catch(()=>{})` de la línea 234 se lo traga:
   **no puede ser la causa del error visible**, porque nunca llega a
   propagarse.
5. `flushBatches` (línea 247-257) — cada 50 filas completadas
   (`RESULT_BATCH_SIZE = 50`, línea 24), un `POST` a `scan_results` con ese
   lote. Escala con símbolos PROCESADOS del eslabón actual (máx. 300,
   `DEFAULT_SCAN_CHUNK_SIZE`, línea 30), no con el universo total.
6. **El bucle principal de persistencia de progreso** (línea 258-271, se
   repite cada `FLUSH_INTERVAL_MS = 1.5s`, línea 27):
   ```js
   while (!state.workersDone) {
     state.cancelRequested = state.cancelRequested || await readCancelRequested(scanId, ownerId);
     if (state.cancelRequested) break;
     await flushBatches(false);
     state.cancelRequested = state.cancelRequested || await readCancelRequested(scanId, ownerId);
     if (state.cancelRequested) break;
     await patchScan(scanId, ownerId, { row_count: state.insertedCount, settings: progressPayload("running") });
     await sleep(FLUSH_INTERVAL_MS);
   }
   ```
   (`lib/serverScanRunner.js:258-271`). `readCancelRequested` (línea 94-99)
   lee `settings` completo de la fila `scans` (filtrado por `id`). `patchScan`
   (línea 84-92) hace un `PATCH` a `scans` con `body: {...body, updated_at}`
   donde `body.settings = progressPayload(...)`.

### A.2 ¿Cuál de ellas escala con el tamaño del universo?

Ninguna consulta de este camino tiene un filtro `symbol=in.(...)` con miles
de valores, y ninguna omite el filtro por `scan_id`/`id` al leer o escribir
`scans`/`scan_results`. **En cuanto a filtros WHERE, ninguna escala.**

Pero hay una excepción real: **el PAYLOAD de la fila `scans` sí escala con el
universo**, porque `settings.scanSymbols` (los símbolos completos a escanear)
vive dentro del mismo JSON que se relee y se reescribe en cada ciclo. Ver A.6.

### A.3 ¿Usa el escaneo interactivo `readRecentlyScannedSymbols`?

**No. Confirmado por dos vías independientes:**

1. Búsqueda literal de todos los call-sites de la función en el repo:
   ```
   lib/materializedScanner.js:996:async function readRecentlyScannedSymbols(options = {}) {
   lib/materializedScanner.js:1160:    recentScanExclusion = await readRecentlyScannedSymbols({ ...options, markets });
   ```
   Su único caller es `resolveSymbols` (`lib/materializedScanner.js:1123-1209`),
   que a su vez solo la invocan `runMaterializedScan`
   (`lib/materializedScanner.js:1600`) y los tests. `runMaterializedScan` solo
   se importa desde:
   ```
   app/api/jobs/scan-refresh/route.js:9
   app/api/cron/shadow-europe-refresh/route.js:5
   app/api/cron/scan-refresh/route.js:5
   ```
   Los tres son rutas de cron/job, no `POST /api/scan`.
2. `app/api/scan/route.js` y `lib/serverScanRunner.js` (el camino real del
   botón "Ejecutar") **no importan `lib/materializedScanner.js` en absoluto**
   — puede verificarse en sus imports (`app/api/scan/route.js:8-12`,
   `lib/serverScanRunner.js:10-21`): ninguno menciona `materializedScanner`.

**La hipótesis del prompt (candidata principal: `readRecentlyScannedSymbols`,
5 páginas de `scan_results` con ventana de 90 días, 8-16s medidos en
`docs/recent-scanned-lectura-2026-08-05.md`) no aplica al escaneo
interactivo. Esa función y su coste son reales, pero viven en el cron
(`GET/POST /api/jobs/scan-refresh` y `/api/cron/scan-refresh`), un proceso
completamente distinto que el usuario no dispara al pulsar "Ejecutar".**

### A.4 ¿Hay algún `symbol=in.(...)` con miles de valores en este camino?

No en el camino interactivo. Existe una función que sí construye ese patrón
— `readGlobalRsForSymbols` (`lib/globalRs.js:85-138`), con troceo en lotes de
50 (`chunkSize`, línea 99) — pero su único caller en todo el repo es:

```
app/api/scans/route.js:7:import { readGlobalRsForSymbols } from "@/lib/globalRs";
app/api/scans/route.js:453:      const weeklyRs = await readGlobalRsForSymbols(scanSymbols).catch(() => ({ configured: false, bySymbol: new Map() }));
```

Es `GET /api/scans` (plural) — el endpoint que carga la lista de "scans
guardados" (usado por `lib/cloudSyncClient.js:251,331`, y en el cliente solo
al montar la página, `app/page.jsx:539`, no durante la ejecución del
escaneo). **El escaneo interactivo nunca llama a este endpoint mientras
corre** — confirmado leyendo todas las llamadas a `/api/scans` en
`app/page.jsx` y `lib/cloudSyncClient.js`: la única en `page.jsx` es
`getLatestScanFromCloud()` en un `useEffect` de montaje (línea 539), no
dentro de `run()`.

### A.5 `readGlobalRsForSymbols` — cómo trocea y si "aguantaría" 10.234

Por completitud, aunque no se ejecuta en este camino: si se le pasaran
10.234 símbolos, trocearía en 205 lotes de 50 (línea 99,
`Math.min(Math.max(Number(options.chunkSize || 50), 1), 200)`) y haría 205
peticiones **secuenciales** (`for` con `await` dentro, líneas 101-136, sin
`Promise.all`) a `rs_weekly_items` filtradas por `symbol=in.(<50 símbolos>)`
— cada una acotada e indexable, pero 205 peticiones en serie serían lentas
en conjunto (aunque cada una individualmente no debería golpear
`statement_timeout`). Esto es relevante solo como nota de diseño, no como
causa del fallo observado, porque este código no se ejecuta durante el
escaneo interactivo (A.4).

### A.6 El candidato real: el PATCH periódico a `scans` reescribe el JSON completo del universo

`progressPayload` (`lib/serverScanRunner.js:179-197`):
```js
const progressPayload = (status, extra = {}) => ({
  ...settings,
  progress: {
    status,
    cursor: state.completed,
    chunkSize,
    link: linkIndex,
    completed: state.completed,
    total: symbols.length,
    saved: state.insertedCount,
    currentSymbol: state.currentSymbol,
    cancelRequested: state.cancelRequested,
    errors: state.errors.slice(0, MAX_STORED_ERRORS),
    startedAt,
    updatedAt: new Date().toISOString(),
    nextLinkToken: null,
    ...extra,
  },
});
```
`settings` es la variable capturada al principio del eslabón
(`const settings = snapshot.settings || {}`, línea 161), es decir, **el
mismo objeto que trae `scanSymbols` con los 10.000 símbolos**. El spread
`...settings` en la línea 180 significa que **cada vez** que se llama
`progressPayload(...)` — cada 1,5s dentro del bucle mientras dura el
eslabón — se reconstruye un objeto que incluye la lista completa de 10.000
símbolos otra vez, y `patchScan` (línea 84-92) manda ese objeto entero como
`body.settings` en un `PATCH` a la tabla `scans`:
```js
async function patchScan(scanId, ownerId, body) {
  await supabaseRequest("scans", {
    method: "PATCH",
    query: `id=eq.${encodeURIComponent(scanId)}&owner_id=eq.${encodeURIComponent(ownerId)}`,
    prefer: "return=minimal",
    body: { ...body, updated_at: new Date().toISOString() },
  });
  clearScansApiCache();
}
```
(`lib/serverScanRunner.js:84-92`)

Esto es una escritura de **una sola fila** (filtrada por `id`), así que no es
un problema de "miles de filas" como `readRecentlyScannedSymbols` — es un
problema distinto: **el mismo payload grande (~10.000 símbolos serializados
en JSON, del orden de decenas-a-cientos de KB) se retransmite y se
re-escribe entero cada ~1,5-3 segundos durante todo el escaneo**, en vez de
guardarse una sola vez y solo actualizar los campos de progreso.

**Esta es mi hipótesis principal para la causa del `statement timeout`
observado**, por ser la única operación en todo el camino interactivo cuyo
coste (tamaño del payload de la consulta) escala directamente con el
tamaño del universo pedido, y por ejecutarse repetidamente y de forma
awaited (bloqueante para el eslabón) desde el primer ciclo del bucle — lo
que encaja con que el fallo apareciera pocos segundos después de empezar
(varios ciclos de 1,5s ya habrían ocurrido a los 10-13s). **No pude
confirmarlo ejecutando la escritura real — ver CONFIANZA.**

---

## PARTE B — Intento de reproducción sin ejecutar el escaneo

### B.1 Restricción de la herramienta disponible

El MCP de solo lectura (`supabase_query`) no permite `PATCH`/`UPDATE`, así
que **no pude ejecutar directamente la operación que sospecho responsable**
(el `PATCH` repetido a `scans` con el JSON completo de símbolos). Esto es
una limitación dura de la tarea (solo lectura), no un hallazgo negativo.

### B.2 Lo que sí pude probar: lecturas no timean con el volumen actual

Probé las lecturas del camino real (A.1) directamente:

```
table=scan_results, select=symbol,created_at, order=created_at.asc, limit=3
→ [{"symbol":"GOOGL","created_at":"2026-06-20T08:41:46..."}, ...]  (respuesta inmediata, sin error)

table=daily_bars, select=symbol,trade_date, order=trade_date.asc, limit=3
→ [{"symbol":"SPY","trade_date":"1993-06-01"}, ...]  (respuesta inmediata, sin error)
```

Ninguna de las dos —consultadas SIN filtro de fecha, tal como advertía el
contexto de la tarea— dio timeout con la clave de solo lectura. Esto no
contradice la advertencia del contexto (puede que se refiriera a una
consulta con otra forma, p.ej. con `owner_id` + agregación, o a la clave de
producción bajo carga real distinta a la mía en este momento) pero sí acota:
**el timeout no es tan trivial de disparar como "cualquier SELECT sin fecha
en estas tablas"** — al menos hoy, con la clave de solo lectura, en el
momento de esta prueba.

### B.3 Prueba de la hipótesis de `symbol=in.(...)` con volumen (aunque no aplica al camino interactivo)

Por descarte, probé si un `symbol=in.(...)` con 100 valores (el patrón de
`readGlobalRsForSymbols`, aunque no se ejecuta en este camino, A.4) fallaba
por longitud de URL o coste de consulta:

```
table=scan_results, select=symbol,
filter=symbol=in.(SYM0000,SYM0001,...,SYM0099)  [100 símbolos sintéticos]
→ []  (respuesta inmediata, sin error)
```

Sin error. No repetí con 500/1.000 reales porque, tras confirmar en A.4 que
esta función no forma parte del camino que falla, dejar de perseguir esa
pista y concentrar el tiempo en la hipótesis de A.6 (que si es real, es un
`PATCH`, no reproducible con esta herramienta de solo lectura) me pareció el
uso más honesto del alcance de la tarea.

### B.4 Umbral de fallo — no pude acotarlo con 100/500/1.000

La tarea pedía acotar el umbral con pruebas de 100, 500 y 1.000 símbolos.
**No pude hacerlo de forma que fuera representativa del fallo real**: la
operación que sospecho responsable (A.6) es un `PATCH`, bloqueado para mí
por ser de solo lectura, y las lecturas que sí pude probar (B.2, B.3) no
timearon con el volumen probado. Ver "LO QUE NO HE VERIFICADO".

---

## PARTE C — Los dos fallos de presentación

### C.1 El error de Postgres se muestra crudo, sin traducir

Cadena completa, de servidor a pantalla:

1. `runScanChunk` captura la excepción y la guarda tal cual:
   ```js
   } catch (error) {
     console.error("[scan-runner] eslabón fallido", { scanId, ownerId, error: error.message || String(error) });
     try {
       await patchScan(scanId, ownerId, {
         row_count: state.insertedCount,
         settings: progressPayload("error", { error: error.message || "Scan fallido", finishedAt: new Date().toISOString() }),
       });
     } ...
   ```
   (`lib/serverScanRunner.js:347-358`) — `error.message` es el texto crudo
   que `supabaseRequest` (`lib/supabaseServer.js:73-78`) construye desde la
   respuesta de PostgREST: `new Error(data?.message || data?.hint || ...)`
   — exactamente donde aparecería `"canceling statement due to statement
   timeout"` sin ninguna traducción ni envoltorio.
2. El cliente lee ese campo tal cual:
   ```js
   serverError = state.progress?.error || "";
   ...
   if (serverStatus === "error" && !rawRows.length) throw new Error(serverError || "El scan en servidor falló");
   ```
   (`app/page.jsx:1354,1358,1372`)
3. El `catch` de `run()` lo pasa a `setErr(e.message)` (`app/page.jsx:1421`,
   dentro del bloque `catch (e) { setErr(e.message); setStatus("Error"); }`).
4. Se pinta literal, sin ningún mapeo a lenguaje de producto:
   ```jsx
   {err && <div className="error">{err}</div>}
   ```
   (`app/components/screener/ScreenerShell.jsx:327`)

**Punto natural para traducir**: el paso 1 (`lib/serverScanRunner.js:356`,
donde se guarda `error.message`) es el único lugar donde se conoce a la vez
el error crudo de Postgres/PostgREST Y el contexto de negocio ("esto pasó
durante un escaneo de N símbolos") — sería el sitio para mapear patrones
conocidos (`"statement timeout"` → algo como "la base de datos tardó
demasiado en responder; probablemente el universo era demasiado grande para
un solo intento") antes de persistirlo en `progress.error`. Alternativamente,
en el paso 4 (`ScreenerShell.jsx:327`) se podría interceptar el string justo
antes de pintarlo. No até ninguna de las dos — es diagnóstico, no una
propuesta de implementación.

### C.2 El contador final ("19 pasan · 10234 analizadas") refleja el universo pedido, no lo procesado

Hay **dos lugares** donde el conteo total viene predeterminado, no medido:

**A. Durante el escaneo (mensajes de progreso)**, el campo `total` de cada
actualización de estado viene de la variable de cliente `symbols` (calculada
UNA vez al principio de `run()`, antes del POST), no de lo que el servidor
reporta haber procesado:
```js
const payload = {
  rows: partialView.rows,
  diagnostics: partialView.diagnostics,
  completed,
  total: symbols.length,   // ← fijo desde el inicio, nunca se recalcula
  done: false,
  updatedAt: new Date().toISOString(),
};
```
(`app/page.jsx:1305-1311`, dentro de `publishPartial`, reutilizado también en
la actualización final, línea 1411: `total: symbols.length`).

**B. El mensaje final** (el que el usuario ve literalmente, tipo "X pasan ·
muestra Y/Z"):
```js
setStatus(`${finishLabel}: ${final.length} pasan ${PRESETS[presetKey].name} · muestra ${completed}/${base.length} (${samplePct < 10 ? samplePct.toFixed(1) : samplePct.toFixed(0)}%) · RS calculado sobre ${filteredView.sectorized.length} acciones con datos · ${setupModeLabel(activeSettings.setupMode)} · ${activeLayerLabel}. Scan ${secondsLabel(fullScanMs)} · filtro ${secondsLabel(filteredView.filterMs)}${stableNote}.`);
```
(`app/page.jsx:1427`) — usa `base.length`, que es el universo COMPLETO
cargado en el cliente (10.234 en este caso, el tamaño de `universe` antes de
cualquier filtrado/selección), no `completed` (el contador real de símbolos
efectivamente procesados por el servidor, que si el fallo ocurrió en el
símbolo 47-90 sería ese número pequeño).

**Por qué el mensaje final muestra el total incluso tras un fallo**: porque
esta línea SOLO se alcanza si el código NO lanzó la excepción del `throw` de
la línea 1358 — y eso ocurre precisamente cuando `rawRows.length > 0` (hay
al menos alguna fila ya persistida en `scan_results` antes del fallo). En
ese caso el flujo cae a `publishPartial(true)` (línea 1373) y luego a este
`setStatus` final (línea 1427), que **siempre** cita `base.length`
(10.234) como denominador, sin importar si `completed` fue 47, 90 o
10.234. Es decir: **el bug no es "se cuela el total tras un fallo por un
caso especial" — es que esta línea de código nunca ha distinguido entre
"terminado" y "terminado a medias"; el denominador es constante por
diseño.**

Es importante notar la distinción entre "analizadas" (que el usuario
interpreta) y lo que el código realmente imprime: la palabra que usa la UI
es "muestra Y/Z (P%)", no "analizadas" — pero el efecto de lectura es el
mismo que describe el prompt: el número grande (`base.length`) se percibe
como "se completó sobre el universo pedido", cuando en realidad Y=`completed`
es el dato real de cuánto se procesó y ese si refleja lo correcto — el
problema es que Z (`base.length`) no es "lo procesado", es "lo pedido", y
tras un fallo con `rawRows.length > 0` esa distinción no se comunica en
ningún sitio del mensaje (no dice "parcial" salvo por `finishLabel`, que
solo distingue cancelado vs completado, no fallado-a-medias — ver C.3).

### C.3 Nota adicional no pedida explícitamente pero relevante: no hay un tercer estado para "falló a medias con resultados parciales"

`finishLabel` solo tiene dos valores: `"Cancelado · N filas conservadas"` (si
`aborted || serverStatus === "cancelled"`) o `"Completado"` (cualquier otro
caso, incluido `serverStatus === "error"` con `rawRows.length > 0`) —
`app/page.jsx:1424`:
```js
const cancelled = aborted || serverStatus === "cancelled";
const finishLabel = cancelled ? `Cancelado · ${rawRows.length} filas conservadas` : "Completado";
```
Un escaneo que reventó por timeout a los 47/10.234 símbolos, con
`rawRows.length > 0`, se etiqueta **"Completado"** — el mismo texto que un
escaneo que sí barrió las 10.234 acciones. Esto agrava el efecto de C.2: no
solo el denominador es el universo pedido, sino que la palabra "Completado"
tampoco distingue el caso de fallo parcial.

---

## PARTE D — Alcance

### D.1 ¿A partir de qué tamaño falla?

**No lo puedo acotar con precisión** por la razón dada en B.4: la operación
que sospecho causante (A.6, el `PATCH` que reescribe `settings.scanSymbols`
completo cada 1,5s) es una escritura, y estoy limitado a lectura. Lo único
que puedo decir con el código como evidencia:

- El coste de esa operación es **proporcional al número de símbolos en
  `settings.scanSymbols`**, que es `min(símbolos pedidos, MAX_SYMBOLS=10000)`
  (`lib/serverScanRunner.js:25,39-50`, `normalizeSymbols`). Con 50 símbolos
  (un scan típico) ese JSON es trivial (unos pocos KB); con 10.000 es del
  orden de decenas-a-cientos de KB, repetido cada 1,5-3s durante todo el
  escaneo (potencialmente minutos, dado que un eslabón de 300 símbolos con
  concurrencia 5 tarda "~3-4 min" según el propio comentario del código,
  `lib/serverScanRunner.js:28-29`).
- Si mi hipótesis de A.6 es correcta, el umbral de fallo dependería del
  tamaño en bytes del `PATCH`, no de un número mágico de símbolos — y ese
  umbral depende de la configuración de `statement_timeout` del rol de
  Supabase en producción, que no conozco (no expuesta en el repo, ver
  CONFIANZA).
- Dato de contexto que SÍ tengo: 50 símbolos (un scan normal) funciona sin
  problema conocido — no hay incidentes reportados con scans manuales
  pequeños. 10.234 falla. No tengo un punto intermedio medido.

### D.2 ¿El cron sufre el mismo problema?

**No, por diseño — no comparte código con el camino que falla.**

Confirmado por imports: `app/api/cron/scan-refresh/route.js` importa
`runMaterializedScan` de `lib/materializedScanner.js` (línea 5), un módulo
completamente distinto de `lib/serverScanRunner.js` (el que tiene el `PATCH`
sospechoso de A.6). El cron:

- No inserta una fila en `scans` con `settings.scanSymbols` igual al patrón
  del escaneo interactivo — `runMaterializedScan`/`writeMaterializedScan`
  tienen su propio camino de escritura (`lib/materializedScanner.js:1642-1676`,
  citado en `docs/recent-scanned-lectura-2026-08-05.md`), que no repite un
  PATCH de progreso cada 1,5s con la lista de símbolos.
- Procesa 12-24 símbolos por invocación (`ROTATION_SETTING`, grupos rotativos
  citados en el propio código del cron) — muy por debajo de cualquier escala
  donde A.6 sería un problema, pero esto es irrelevante porque **el cron ni
  siquiera pasa por el código que tiene el problema** — es una garantía
  estructural (caminos de código distintos), no solo una cuestión de volumen.
- El cron SÍ sufre el coste ya documentado de `readRecentlyScannedSymbols`
  (8-16s por invocación, `docs/recent-scanned-lectura-2026-08-05.md`), pero
  ese es un problema aparte, ya analizado en ese documento, y no relacionado
  con el tamaño del universo pedido en cada invocación (es function del
  volumen acumulado en `scan_results`, no de cuántos símbolos se piden).

---

## CONFIANZA

- **Alta**: que `readRecentlyScannedSymbols` y `readGlobalRsForSymbols` NO
  se ejecutan en el camino del escaneo interactivo (`POST /api/scan` →
  `runScanChunk`) — verificado por doble vía: grep exhaustivo de todos los
  call-sites de ambas funciones en el repo, y lectura de los imports de
  `app/api/scan/route.js` y `lib/serverScanRunner.js` (A.3, A.4).
- **Alta**: que ninguna consulta con filtro `WHERE` del camino interactivo
  escala con el tamaño del universo (todas están acotadas por `id`/`scan_id`
  y cubiertas por índices existentes) — lectura directa del código y de
  `supabase/schema.sql` (A.1, A.2).
- **Alta**: dónde se muestra el error crudo (cadena completa de 4 pasos,
  C.1) y por qué el contador final usa `base.length` en vez de `completed`
  (C.2) — ambos verificados citando el código exacto, sin inferencia.
- **Media**: que el `PATCH` periódico a `scans` (que reescribe
  `settings.scanSymbols` completo cada 1,5-3s, A.6) es la causa real del
  `statement timeout`. Es la única operación del camino interactivo cuyo
  coste escala con el universo, y el patrón temporal encaja (varios ciclos
  ya habrían corrido a los 10-13s desde el símbolo 47), pero **no pude
  ejecutar ni reproducir esa escritura** por estar limitado a una clave de
  solo lectura — es una inferencia arquitectónica fundada en el código, no
  una reproducción confirmada.
- **Baja**: el umbral exacto de símbolos/bytes a partir del cual el `PATCH`
  empezaría a fallar (D.1) — no pude medirlo (requiere poder ejecutar
  escrituras contra un `statement_timeout` real, o conocer su valor
  configurado, ninguno de los dos disponible aquí).
- **Baja**: si la advertencia del contexto de la tarea ("el mismo error
  aparece al consultar `scan_results` o `daily_bars` sin filtro por fecha")
  corresponde a una consulta que no llegué a identificar, o a condiciones de
  carga/clave distintas a las de mi prueba en B.2 (que no reprodujo timeout
  con selects similares sin fecha) — no puedo descartar que exista otra
  consulta problemática que no esté en el camino que tracé.

## LO QUE NO HE VERIFICADO

- **La causa raíz real del `statement timeout`** (A.6) — mi hipótesis
  principal (el `PATCH` repetido con `settings.scanSymbols` completo) no fue
  reproducida; es la explicación más consistente con el código y el patrón
  temporal observado, pero sigue siendo una inferencia, no una confirmación
  directa. Requeriría o bien acceso de escritura para reproducirla, o logs
  de producción del momento exacto del fallo (qué tabla, qué consulta,
  cuánto tardó) que no tuve disponibles.
- **El umbral exacto de símbolos que dispara el fallo** (D.1) — no pude
  correr las pruebas de 100/500/1.000 símbolos que pedía la tarea de forma
  representativa del fallo real, porque la operación sospechosa es una
  escritura y estoy limitado a lectura.
- **El valor de `statement_timeout` configurado en el rol de Supabase de
  producción** — no está en el repo (es configuración de la instancia, no
  del código), y no tengo acceso para consultarlo con la clave de solo
  lectura.
- **Si existe alguna otra consulta, fuera del camino que tracé en la Parte
  A, que sí golpee `scan_results`/`daily_bars` sin filtro de fecha y sí
  timee** — el contexto de la tarea afirma que existe; no la encontré en el
  camino del escaneo interactivo, y mi única prueba directa (B.2) no la
  reprodujo, pero no revisé el 100% de las rutas `/api` del repo, solo las
  que participan en el flujo de "Ejecutar" → escaneo → polling.
- **Si el tamaño real de `settings.scanSymbols` en el PATCH (A.6) es
  realmente el factor dominante, o si hay otro campo dentro de `settings`
  (p.ej. `errors`, topado a 300 por `MAX_STORED_ERRORS`, línea 26) que
  contribuya más de lo que estimé** — no medí el tamaño en bytes real de un
  `settings` con 10.000 símbolos; es una estimación razonada ("decenas a
  cientos de KB"), no una medición.
- **Si `INLINE_SCAN_SYMBOL_LIMIT=20` (`app/api/scan/route.js:16`) tiene
  algún efecto secundario relevante** en el caso de 10.234 símbolos más allá
  de decidir `after()` vs inline — confirmé que activa la vía `after()` (no
  inline), pero no profundicé más allá porque no pareció relevante para el
  timeout.
