# Overhead del cron de escaneo — por qué 43s solo alcanzan para 12-24 símbolos

Fecha del análisis: 2026-08-07. BASE_SHA: 765e0b0. Rama: `codex/statsedge-ui-polish`.

Endpoint auditado: `app/api/cron/scan-refresh/route.js` (`run_type: "cron-scan-refresh"`
en `provider_runs`), que es el que corre en el cron real de Vercel (Hobby,
`maxDuration = 60`, [app/api/cron/scan-refresh/route.js:12](../app/api/cron/scan-refresh/route.js#L12)).
Se distingue de `app/api/jobs/scan-refresh/route.js`, un endpoint hermano con
más opciones (dry-run, shadow universe) que también llama a
`runMaterializedScan` pero no es el que dispara el cron.

---

## PARTE A — Inventario de operaciones que no escalan con el número de símbolos

Trazando `GET` en `app/api/cron/scan-refresh/route.js` de arriba a abajo:

### A.1 Fuera de `runMaterializedScan` (route.js)

| Paso | Qué hace | Dónde | Tipo |
|---|---|---|---|
| `readRotation()` | 1 GET a `app_settings` (clave de rotación de grupos) | [app/api/cron/scan-refresh/route.js:29-41](../app/api/cron/scan-refresh/route.js#L29-L41) | red/DB |
| `readScanBatchCursor()` | 1 GET a `app_settings` (cursor de offsets por mercado) | `lib/materializedScanner.js:1815-1827` | red/DB |
| `createRun(group, options)` | 1 POST a `provider_runs` (abre el run) | [app/api/cron/scan-refresh/route.js:135-158](../app/api/cron/scan-refresh/route.js#L135-L158) | red/DB |
| `writeMaterializedScan(result.scan)` | 1 POST `scans` + 1 DELETE `scan_results` + N POST `scan_results` en lotes de 300 | `lib/materializedScanner.js:1642-1676` | red/DB |
| `writeScanSymbolHistory(...)` | 1 RPC `scan_symbol_history_latest_v1` + 1 POST `scan_symbol_history` | `lib/scanHistory.js:176-222` | red/DB |
| `writeScanBatchCursor(...)` | 1 POST `app_settings` | `lib/materializedScanner.js:1829-1845` | red/DB |
| `writeRotation(nextRotation)` | 1 POST `app_settings` (si no es grupo manual) | [app/api/cron/scan-refresh/route.js:44-58](../app/api/cron/scan-refresh/route.js#L44-L58) | red/DB |
| `finishRun(run, ...)` | 1 PATCH `provider_runs` | [app/api/cron/scan-refresh/route.js:160-176](../app/api/cron/scan-refresh/route.js#L160-L176) | red/DB |

Todo esto se ejecuta **secuencialmente, con `await` uno detrás de otro** — no
hay ningún `Promise.all` en esta cadena (cita literal, líneas 247-266):

```js
const run = await createRun(group, options);
let phase = "scan";
try {
    const result = await runMaterializedScan(options);
    phase = "saved_scan_write";
    const savedScan = await writeMaterializedScan(result.scan);
    phase = "history_write";
    const history = savedScan.saved && result.history
      ? await writeScanSymbolHistory({...}).catch(...)
      : { skipped: true, saved: 0 };
    phase = "cursor_write";
    const cursorWrite = savedScan.saved
      ? await writeScanBatchCursor(...).catch(...)
      : { skipped: true };
    ...
    const rotationWrite = manualGroup ? { skipped: true } : await writeRotation(nextRotation).catch(...);
```

Eso son **8 round-trips secuenciales a Supabase como mínimo** que no dependen
de cuántos símbolos se procesen (2, 12 o 24 dan el mismo número de estas
llamadas, salvo el volumen de filas en `scan_results`/`scan_symbol_history`,
que para 12-24 filas es trivial: un único lote de escritura).

### A.2 Dentro de `runMaterializedScan` (`lib/materializedScanner.js:1707-1813`)

```js
export async function runMaterializedScan(options = {}) {
  ...
  options.onPhase?.("universe_select");
  const resolved = await resolveSymbols({ ...options, markets });
  options.onPhase?.("materialized_scan");
  const benchmarks = await hydrateBenchmarks({ ...options, maxPriceFreshnessDays });
  ...
  const analyzed = await mapLimit(resolved.symbols, Number(options.concurrency || DEFAULT_CONCURRENCY), (symbol) => analyzeOne(...));
  const passedBase = analyzed.filter((item) => item.ok).map((item) => item.row);
  const sectorized = sectorize(passedBase);
  const filterResult = applyScreenerFilters(sectorized, options.screenerFilters);
  ...
  const historyScoringPool = sectorize(
    analyzed.filter(...).map((item) => cloneForHistoryScoring(item.row)),
  );
```

Candidatas verificadas:

**`getUniverseEngineSnapshot` (dentro de `resolveSymbols`)** — `lib/universeEngine.js:413-456`.
Con `cronUniverseSnapshot: true` (como pasa el cron real,
[app/api/cron/scan-refresh/route.js:225](../app/api/cron/scan-refresh/route.js#L225)),
pide la instantánea combinada de los 8 mercados (`CRON_UNIVERSE_MARKETS`,
`lib/cronPlan.js:19`). Confirmado en producción (ver Parte B): esa
instantánea tiene **10.940 filas** en `universe_snapshot_symbols`
(`cache_key = "universe:AU,CA,HK,JP,SG,TW,US,ZA"`, consultado vía
`supabase_query` de solo lectura, ver tabla en B.5). `readSupabaseSnapshot`
las lee TODAS con `supabaseRequestAll`:

```js
const symbols = await supabaseRequestAll("universe_snapshot_symbols", {
  query: `snapshot_id=eq.${encodeURIComponent(snapshot.id)}&select=*&order=symbol.asc`,
  timeoutMs: SUPABASE_UNIVERSE_READ_TIMEOUT_MS,
}, {
  maxRows: Number(snapshot.total_count || 20000),
});
```
`lib/universeEngine.js:338-343`. `supabaseRequestAll` pagina de a 1000 filas
por defecto (`lib/supabaseServer.js:100`), así que 10.940 filas son **11
peticiones GET secuenciales** (no paralelas: `for (let offset...) { ... await
supabaseRequest(...) }`, `lib/supabaseServer.js:103-109`) más 1 GET a
`universe_snapshots` para el metadato = **12 peticiones**. Medido en B.4:
~2,7-3,4s de reloj de pared.

Riesgo adicional verificado en B.4 (no documentado en el prompt original):
`missingRequiredSources` + `shouldRetryMissingRequiredSources`
(`lib/universeEngine.js:192-219`) pueden invalidar una instantánea
perfectamente fresca (<48h) si el snapshot leído no trae, para HK o TW, la
fuente oficial requerida en `coverage.bySourceByMarket`. Cuando eso pasa,
`readSupabaseSnapshot` devuelve `null` (`lib/universeEngine.js:350`) y
`getUniverseEngineSnapshot` cae a `buildUniverse()` — la reconstrucción
completa contra NasdaqTrader + HKEX + TWSE + ASIC descartada como hipótesis
en el prompt, pero que SÍ se disparó en una de mis propias mediciones (ver
B.4). Esto es coherente con que `provider_runs` muestre `cache.hit: false`
para corridas de mercados que SÍ están en `CRON_UNIVERSE_MARKETS` (CA, TW, JP
en las corridas de 2026-08-02 a 2026-08-04, ver tabla B.6) — no todos los
días acierta el caché, aunque la hipótesis original ("6f22087 lo arregló")
sea cierta para el caso feliz.

**`readRecentlyScannedSymbols` (dentro de `resolveSymbols`)** —
`lib/materializedScanner.js:1107-1204`. Se ejecuta siempre que
`options.skipRecentlyScanned || options.prioritizeMaterialization !== false`
(`lib/materializedScanner.js:1268`); el cron real no fija ninguna de las dos
explícitamente, así que por el default (`prioritizeMaterialization !== false`
= `true` cuando es `undefined`) **esto corre en cada invocación real**, para
priorizar qué símbolos escanear primero, no solo cuando se activa
`skipRecentlyScanned`. Lee hasta `DEFAULT_RECENT_SCAN_MAX_ROWS = 5000` filas
de `scan_results` con lookback de `DEFAULT_MATERIALIZATION_LOOKBACK_DAYS = 90`
días (`lib/materializedScanner.js:62,68,1112,1114`), también vía
`supabaseRequestAll` → hasta **5 peticiones GET secuenciales**. Medido en
B.4: fue la fase más cara de todas — ~9,3s en suma de duraciones, ~15,9s de
span de reloj de pared (peticiones bastante más lentas individualmente que
las de `universe_snapshot_symbols`, ver discusión en C.2).

**`hydrateBenchmarks`** — `lib/materializedScanner.js:650-661`. Descarga
SPY, QQQ, ACWI en paralelo (`Promise.all`), cada uno vía
`fetchChartForScan` → `withDailyBarsCache` → Yahoo si hay cache-miss. Medido
en B.3: ~220-360ms de span de reloj de pared (coste fijo, no escala con N
símbolos, corre una vez por invocación).

**Las escrituras finales** — cubiertas en A.1 (`writeMaterializedScan`,
`writeScanSymbolHistory`, `writeScanBatchCursor`), todas fuera de
`runMaterializedScan` mismo (que en sí no escribe nada — solo lee y calcula,
confirmado leyendo el archivo completo: no hay ningún `supabaseRequest` con
método distinto de GET dentro de `resolveSymbols`/`hydrateBenchmarks`/
`analyzeOne`/`sectorize`/`applyScreenerFilters` salvo el cache-write
condicional de `withDailyBarsCache`/`withProfileCache` cuando `cache: true`
y hay cache-miss por símbolo — eso SÍ escala con N).

**Extra no listado en el prompt: `sectorize` se llama DOS VECES por
invocación** (`lib/materializedScanner.js:1722` y `:1728-1731`), la segunda
vez sobre `historyScoringPool` para poblar `scan_symbol_history`. Es cómputo
puro en JS (sin red), pero corre sobre prácticamente los mismos símbolos dos
veces — duplica el trabajo de `computeSectorScoresForRows` +
`enrichRelativePercentiles` + los ~10 `computeSignal(...)` por fila. Con 12
símbolos esto es insignificante en ms; queda documentado porque técnicamente
es coste no explicado en el enunciado del problema, aunque su magnitud (ver
B.2, CPU total del proceso ~250-500ms para TODO el ciclo con 2-12 símbolos)
descarta que sea un contribuyente relevante a los ~30s.

---

## PARTE B — Medición real

### B.1 Script

`scripts/bench-scan-overhead.mjs` (único archivo nuevo, además de este
documento). Reutiliza el mecanismo de `scripts/bench-analyze.mjs` para
resolver el bloqueo de JSX (`materializedScanner.js` → `screenerFormat.js` →
`MetricSource.jsx`): arranca Vitest programáticamente
(`vitest/node`/`startVitest`) apuntado a sí mismo como único test file,
porque Vitest ya trae el transform de JSX que usa `npm test` — no se
reimplementa ninguna lógica de escaneo ni se toca `scripts/loader.mjs`.

Instrumentación añadida (no existe en `bench-analyze.mjs`): antes de
importar `materializedScanner.js`, el script envuelve `global.fetch` para:

1. Cronometrar cada petición de red por separado y clasificarla por
   tabla/host/símbolo según la URL (Supabase REST/RPC, Yahoo, ASIC, u
   otros proveedores de universo).
2. **Bloquear activamente cualquier método de escritura (POST/PATCH/DELETE)
   hacia el host de Supabase** — nunca se deja pasar; se responde con un
   array vacío sintético (`[]`, 200) y se registra como `BLOCKED_WRITE`.
   Esto es un cinturón de seguridad adicional sobre `cache: false` (que ya
   evita que `withDailyBarsCache`/`withProfileCache` intenten escribir por
   símbolo): protege también el camino de `writeSupabaseSnapshot` en
   `lib/universeEngine.js:354-411`, que se dispara si `getUniverseEngineSnapshot`
   cae a `buildUniverse()` por cualquier motivo (lo que de hecho ocurrió en
   una corrida, ver B.4 — el bloqueo actuó de verdad, no fue teórico).

Dos modos:

- **`--symbols=A,B,C`** — el modo pedido literalmente en la tarea (item 3),
  símbolos explícitos igual que `bench-analyze.mjs`. **Limitación
  importante, y por diseño de la propia tarea**: `resolveSymbols` con
  símbolos explícitos SALTA POR COMPLETO `getUniverseEngineSnapshot` y
  `readRecentlyScannedSymbols` (`lib/materializedScanner.js:1234-1254`, el
  primer `if (explicit.length) return {...}` retorna antes de tocar
  Supabase). Este modo por tanto **no puede medir universe_select ni
  recent_scan_read** — solo mide `hydrateBenchmarks` + `analyzeOne` (fetch +
  cómputo) + `sectorize` + `applyScreenerFilters`.
- **`--markets=US,HK,AU --limit=N`** — modo adicional que añadí porque el
  modo anterior deja fuera precisamente las dos fases que la Parte A
  identifica como sospechosas del coste fijo. Llama a `runMaterializedScan`
  con mercados reales (`cronUniverseSnapshot: true`, `skipRecentlyScanned:
  true`, `prioritizeMaterialization: true`, `universeMaxAgeHours: 48`,
  `refreshUniverse: false` — igual que el cron real,
  [app/api/cron/scan-refresh/route.js:210-228](../app/api/cron/scan-refresh/route.js#L210-L228)),
  forzando la resolución real de símbolos: son lecturas GET (permitidas),
  nunca escrituras (bloqueadas activamente por el punto 2 de arriba).

Uso:
```bash
node scripts/bench-scan-overhead.mjs --symbols=AAPL,MSFT --concurrency=2
node scripts/bench-scan-overhead.mjs --markets=US,HK,AU --limit=2 --concurrency=2
```

El script también carga `.env.local` manualmente (ni `vitest.config.js` ni
Vitest lo hacen por defecto — confirmado leyendo `vitest.config.js`: no hay
`dotenv`), porque sin `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` el propio
`supabaseConfig().configured` es `false` y `getUniverseEngineSnapshot` cae
directo a `buildUniverse()`, invalidando la medición del modo `--markets`
(esto de hecho pasó en mi primera corrida, ver nota en B.4). Solo lee ese
archivo, nunca lo modifica.

### B.2 Salida literal — modo `--symbols`, N=2

```
Bench-scan-overhead: modo=symbols-explicit
  2 simbolos explicitos, concurrencia=2, cache=false
  Simbolos: AAPL, MSFT
  NOTA: en este modo, resolveSymbols() se salta getUniverseEngineSnapshot
  y readRecentlyScannedSymbols por completo (symbols explicitos). Este bench
  NO mide universe_select ni recent_scan_read en este modo.

 RUN  v4.1.8 .../Statsedge-v0.1

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  17:36:23
   Duration  1.98s (transform 435ms, setup 0ms, import 37ms, tests 1.76s, environment 0ms)

=== RESULTADO ===
Modo: symbols-explicit
Tiempo total (dentro de runMaterializedScan): 1.200s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 2.232s
  Fase universe_select (onPhase, hasta hydrateBenchmarks): 0.000s
  Fase materialized_scan (hydrateBenchmarks + analyzeOne + sectorize + filtros): 1.200s
Escrituras a Supabase bloqueadas por el bench: 0
Peticiones de red totales capturadas: 17
CPU proceso Node (dentro del test) — user: 249.6ms, system: 26.0ms

=== DESGLOSE POR TIPO DE PETICION DE RED (medido) ===
  yahoo_other:other: 4 peticiones, 1110ms suma-duraciones, 277.5ms/peticion promedio, 561ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_chart:benchmark: 3 peticiones, 953ms suma-duraciones, 317.7ms/peticion promedio, 359ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_other:target: 4 peticiones, 853ms suma-duraciones, 213.3ms/peticion promedio, 266ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_chart:target: 2 peticiones, 434ms suma-duraciones, 217.0ms/peticion promedio, 276ms span-reloj-pared (primera arranca -> ultima termina)
  other:fc.yahoo.com: 2 peticiones, 406ms suma-duraciones, 203.0ms/peticion promedio, 215ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_profile:target: 2 peticiones, 393ms suma-duraciones, 196.5ms/peticion promedio, 213ms span-reloj-pared (primera arranca -> ultima termina)

=== STATS runMaterializedScan ===
  universeTotal: 2, selected: 2, passedBase: 2, savedRows: 2, rejected: 0
  cache (universo): null
```

### B.3 Salida literal — modo `--symbols`, N=12

```
Bench-scan-overhead: modo=symbols-explicit
  12 simbolos explicitos, concurrencia=2, cache=false
  Simbolos: AAPL, MSFT, GOOGL, AMZN, NVDA, META, TSLA, JPM, V, UNH, XOM, JNJ
  ...
 Duration  3.33s (transform 418ms, setup 0ms, import 36ms, tests 3.12s, environment 0ms)

=== RESULTADO ===
Modo: symbols-explicit
Tiempo total (dentro de runMaterializedScan): 2.583s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 3.584s
  Fase universe_select (onPhase, hasta hydrateBenchmarks): 0.001s
  Fase materialized_scan (hydrateBenchmarks + analyzeOne + sectorize + filtros): 2.582s
Escrituras a Supabase bloqueadas por el bench: 0
Peticiones de red totales capturadas: 67
CPU proceso Node (dentro del test) — user: 492.3ms, system: 43.1ms

=== DESGLOSE POR TIPO DE PETICION DE RED (medido) ===
  yahoo_other:target: 24 peticiones, 3298ms suma-duraciones, 137.4ms/peticion promedio, 2051ms span-reloj-pared
  yahoo_chart:target: 12 peticiones, 2767ms suma-duraciones, 230.6ms/peticion promedio, 2094ms span-reloj-pared
  yahoo_other:other: 14 peticiones, 2085ms suma-duraciones, 148.9ms/peticion promedio, 2054ms span-reloj-pared
  yahoo_profile:target: 12 peticiones, 2027ms suma-duraciones, 168.9ms/peticion promedio, 1745ms span-reloj-pared
  yahoo_chart:benchmark: 3 peticiones, 790ms suma-duraciones, 263.3ms/peticion promedio, 333ms span-reloj-pared
  other:fc.yahoo.com: 2 peticiones, 275ms suma-duraciones, 137.5ms/peticion promedio, 140ms span-reloj-pared

=== STATS runMaterializedScan ===
  universeTotal: 12, selected: 12, passedBase: 12, savedRows: 12, rejected: 0
  cache (universo): null
```

**Lectura de B.2/B.3 (MEDICIÓN):**
- `hydrateBenchmarks` (span de `yahoo_chart:benchmark`): **359ms (N=2) vs
  333ms (N=12)** — confirma que es coste fijo, prácticamente independiente
  de N, como predice el código (se ejecuta una sola vez, antes del
  `mapLimit`).
- Fase `materialized_scan` completa: **1.200s (N=2) → 2.582s (N=12)**.
  Regresión lineal de 2 puntos (**ESTIMACIÓN**, no medición directa — con
  solo 2 puntos y jitter de red real hacia Yahoo, el intervalo de confianza
  es amplio): marginal ≈ (2582-1200)/(12-2) ≈ **138ms/símbolo**; fijo ≈
  1200 - 2×138 ≈ **924ms**, de los cuales ~350ms son el span medido de
  `hydrateBenchmarks` y el resto (~570ms) es una mezcla de: crumb/cookie de
  Yahoo (`fc.yahoo.com`, ~200-400ms, se pide una vez por símbolo con perfil
  nuevo, ver `lib/yahoo.js:277-290` — no es estrictamente fijo, escala con
  símbolos que necesitan crumb nuevo) y ruido de medición. **No se puede
  aislar más sin instrumentar dentro de `analyzeOne`, que es privada y no
  exportada** (ver límite declarado en la cabecera del script).

### B.4 Salida literal — modo `--markets=US,HK,AU --limit=2`

Esta corrida SÍ ejecuta `resolveSymbols` real. Primera corrida (sin cargar
`.env.local`, antes de arreglar el script) reveló que sin credenciales de
Supabase el bench mide por accidente la ruta de reconstrucción completa del
universo (`buildUniverse()`), no la ruta de caché — quedó documentado porque
también es información real y relevante (ver discusión de
`shouldRetryMissingRequiredSources` en A.2, es la MISMA ruta de código que se
disparó por una razón distinta en la segunda corrida). Con `.env.local`
cargado:

```
Bench-scan-overhead: modo=markets-real
  mercados=US,HK,AU, limit=2, perMarket=0, concurrencia=2, cache=false
  Este modo SI ejecuta resolveSymbols() real (lecturas GET a Supabase:
  universe_snapshot_symbols + scan_results). No se escribe nada: cualquier
  POST/PATCH/DELETE hacia Supabase queda bloqueado por el bench.

 Duration  36.77s (transform 426ms, setup 0ms, import 38ms, tests 36.54s, environment 0ms)

=== RESULTADO ===
Modo: markets-real
Tiempo total (dentro de runMaterializedScan): 35.994s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 37.055s
  Fase universe_select (onPhase, hasta hydrateBenchmarks): 35.122s
  Fase materialized_scan (hydrateBenchmarks + analyzeOne + sectorize + filtros): 0.872s
Escrituras a Supabase bloqueadas por el bench: 1
Peticiones de red totales capturadas: 41
CPU proceso Node (dentro del test) — user: 9239.6ms, system: 890.6ms

=== DESGLOSE POR TIPO DE PETICION DE RED (medido) ===
  recent_scan_read: 5 peticiones, 9289ms suma-duraciones, 1857.8ms/peticion promedio, 15933ms span-reloj-pared
  universe_read: 12 peticiones, 2712ms suma-duraciones, 226.0ms/peticion promedio, 3401ms span-reloj-pared
  other:isin.twse.com.tw: 1 peticiones, 1792ms suma-duraciones, 1792.0ms/peticion promedio, 1792ms span-reloj-pared
  yahoo_other:other: 8 peticiones, 1765ms suma-duraciones, 220.6ms/peticion promedio, 421ms span-reloj-pared
  other:www.hkex.com.hk: 1 peticiones, 963ms suma-duraciones, 963.0ms/peticion promedio, 963ms span-reloj-pared
  other:www.nasdaqtrader.com: 2 peticiones, 793ms suma-duraciones, 396.5ms/peticion promedio, 1434ms span-reloj-pared
  yahoo_chart:benchmark: 3 peticiones, 647ms suma-duraciones, 215.7ms/peticion promedio, 221ms span-reloj-pared
  asic_short_interest: 2 peticiones, 470ms suma-duraciones, 235.0ms/peticion promedio, 474ms span-reloj-pared
  other:fc.yahoo.com: 2 peticiones, 444ms suma-duraciones, 222.0ms/peticion promedio, 224ms span-reloj-pared
  yahoo_chart:other: 2 peticiones, 381ms suma-duraciones, 190.5ms/peticion promedio, 252ms span-reloj-pared
  yahoo_profile:other: 2 peticiones, 356ms suma-duraciones, 178.0ms/peticion promedio, 216ms span-reloj-pared
  BLOCKED_WRITE: 1 peticiones, 0ms suma-duraciones, 0.0ms/peticion promedio, 0ms span-reloj-pared

=== STATS runMaterializedScan ===
  universeTotal: 9305, selected: 2, passedBase: 2, savedRows: 2, rejected: 0
  cache (universo): {"hit":false,"status":"supabase-skip","written":false,"error":"Cannot read properties of undefined (reading 'id')"}
```

`urls` de muestra capturadas para `universe_read` (confirma 11 páginas +
1 metadato contra la instantánea combinada real de 10.940 símbolos):
```
https://dzovggfbcoymjgikkbno.supabase.co/rest/v1/universe_snapshots?owner_id=eq.personal&cache_key=eq.universe%3AAU%2CCA%2CHK%2CJP%2CSG%2CTW%2CUS%2CZA&select=*&order=updated_at.desc&limit=1
https://dzovggfbcoymjgikkbno.supabase.co/rest/v1/universe_snapshot_symbols?snapshot_id=eq.df7e3961-...&select=*&order=symbol.asc&limit=1000&offset=0
https://dzovggfbcoymjgikkbno.supabase.co/rest/v1/universe_snapshot_symbols?snapshot_id=eq.df7e3961-...&select=*&order=symbol.asc&limit=1000&offset=1000
```
y para `recent_scan_read` (confirma el filtro de 90 días y la paginación de
`scan_results`):
```
https://dzovggfbcoymjgikkbno.supabase.co/rest/v1/scan_results?owner_id=eq.personal&created_at=gte.2026-05-09T15%3A38%3A25.869Z&select=symbol,country,created_at,total_score,metrics&order=created_at.desc&limit=1000&offset=0
```

**Lectura de B.4 (MEDICIÓN, con matices):**
- `universe_read` (11 páginas + 1 metadato, 10.940 filas reales) costó
  **2,7s en suma / 3,4s de span de reloj de pared**. Esto SÍ es una medición
  directa y real de exactamente la operación que la hipótesis del prompt
  señala como candidata #1.
- `recent_scan_read` (5 páginas, hasta 5000 filas de `scan_results`, filtro
  de 90 días) costó **9,3s en suma / 15,9s de span de reloj de pared** —
  individualmente mucho más lento por petición (1857ms/petición vs
  226ms/petición de `universe_read`, ambos paginando 1000 filas). Es la
  fase más cara medida en todo este análisis, y no estaba en la lista de
  "candidatas conocidas" del enunciado original.
- Después de leer las 10.940 filas del universo con éxito, el snapshot fue
  **rechazado igualmente** por `shouldRetryMissingRequiredSources`
  (`lib/universeEngine.js:211-219`) — probablemente porque el snapshot leído
  no traía, para HK o TW, la fuente oficial requerida en
  `coverage.bySourceByMarket` en el momento de esta corrida (antigüedad del
  snapshot: ~19-20h, dentro del límite de 48h, pero fuera del límite de 1h
  que exime del reintento). Esto forzó una caída a `buildUniverse()`
  (peticiones a NasdaqTrader, HKEX, TWSE, ASIC — ~4,7s adicionales medidos
  aquí) y luego un intento de escritura (`writeSupabaseSnapshot`) que mi
  bloqueador interceptó (`BLOCKED_WRITE`, y el error
  `"Cannot read properties of undefined (reading 'id')"` que aparece en
  `stats.cache` es exactamente el efecto esperado de responder `[]` a ese
  POST — el propio código de producción atrapa ese error con `try/catch`,
  `lib/universeEngine.js:448-452`, así que no hizo caer la corrida).
  **Esto no es necesariamente lo que pasa en cada invocación real** — es una
  ruta condicional (ver C.1) que coincide con por qué `provider_runs` muestra
  `cache.hit` alternando entre `true` y `false` incluso para mercados dentro
  de `CRON_UNIVERSE_MARKETS` (ver tabla en B.6).

Diferencia de entorno relevante: esta medición corre desde mi máquina local
hacia Supabase/Yahoo, no desde una función de Vercel. La latencia de red
absoluta no es directamente comparable a producción (Vercel probablemente
está en una región más cercana a Supabase), pero el **número de round-trips
secuenciales y su naturaleza** (misma cantidad de páginas, mismo patrón
secuencial sin paralelismo) sí son representativos del código real.

### B.5 Datos de producción usados (solo lectura, vía `supabase_query`)

Instantánea combinada de los 8 mercados del cron (`universe_snapshots`):

| cache_key | total_count | passed_count | excluded_count | updated_at |
|---|---|---|---|---|
| `universe:AU,CA,HK,JP,SG,TW,US,ZA` | 10.940 | 9.696 | 1.244 | 2026-08-06T21:59:51Z |

### B.6 `provider_runs` de `cron-scan-refresh`, últimos 6 días (solo lectura)

| Fecha | Mercados | Duración | cache.hit universo | seleccionados | notas |
|---|---|---|---|---|---|
| 2026-08-06 | US,HK,AU | 43,3s | `true` (status `supabase`) | 12 | universo total 9.306 |
| 2026-08-05 | SG,ZA | 42,8s | `true` | 24 | universo pequeño (100 símbolos), no es representativo de universe_read |
| 2026-08-04 | CA | 39,5s | **`false`** (`written: true`) | 24 | reconstruyó y ESCRIBIÓ el universo completo de 8 mercados ese día |
| 2026-08-03 | TW | ~46,7s | **`false`** (`written: true`) | 20 | idem |
| 2026-08-02 | JP | ~51,5s | **`false`** (`written: true`) | 24 | idem |

Este patrón (3 de 5 días recientes con `cache.hit: false` y reconstrucción +
escritura completa del universo de 8 mercados, para mercados que sí están en
`CRON_UNIVERSE_MARKETS`) es consistente con el mecanismo de invalidación
verificado en B.4 (`shouldRetryMissingRequiredSources`), no con que la
instantánea esté simplemente vieja (`cron-universe-refresh` corre a diario
según el comentario en `app/api/cron/scan-refresh/route.js:214-218`). **No
verifiqué la causa exacta de cada caso individual** (requeriría inspeccionar
`coverage.bySourceByMarket` de cada snapshot histórico, que no se conserva
tras sobrescribirse) — lo dejo anotado como hallazgo relacionado, no como
parte cerrada de este análisis (ver "LO QUE NO HE VERIFICADO").

---

## PARTE C — Qué se puede recortar

### C.1 `universe_read` (lectura de `universe_snapshot_symbols`)

Es necesaria en cada invocación tal como está escrita: no hay caché en
memoria entre invocaciones porque cada invocación del cron en Vercel Hobby
muy probablemente es una función fría distinta (`memoryCache` es un `Map` a
nivel de módulo, `lib/universeEngine.js:20`, que solo sobrevive si la
instancia de la función se reutiliza — no hay garantía de eso entre
invocaciones de cron espaciadas por más de una hora, y el propio `MEMORY_TTL_MS`
de 6h asume reuso de proceso que en Hobby no está garantizado).

Lo que SÍ se puede recortar sin tocar la arquitectura:
- **Seleccionar columnas en vez de `select=*`**
  (`lib/universeEngine.js:339`: `select=*`) — la fila trae `raw` (el objeto
  completo de universo original) y `quality_gate`/`coverage` como JSON;
  `dbSnapshotToApi` (`lib/universeEngine.js:277-327`) solo usa
  `symbol,name,country,market,source,quality_gate,coverage,raw.micCode` — no
  usa la mayoría de columnas del `raw` embebido para esta ruta de
  materialización. No medí el ahorro (dependería de cuánto pesa `raw` por
  fila), pero reducir el payload reduce tiempo de transferencia y
  deserialización JSON en cada una de las 11 páginas.
- **Aumentar `pageSize`** — `supabaseRequestAll` topa `pageSize` en 1000
  (`lib/supabaseServer.js:100`, hardcodeado con `Math.min(...,1000)`); ese
  límite es el máximo por defecto de PostgREST, no cambia sin tocar
  `Prefer: count` o el límite del propio PostgREST. No es recortable sin
  cambiar la infraestructura de paginación.
- **`shouldRetryMissingRequiredSources` es lo más caro de arreglar y lo más
  rentable**: cuando se dispara, no solo repite las 12 lecturas de
  `universe_read`, sino que fuerza `buildUniverse()` completo (measured en
  B.4: NasdaqTrader + HKEX + TWSE + ASIC, ~4,7s adicionales medidos aquí, y
  en producción probablemente más ya que construye los 8 mercados, no solo
  3). Esto es lo que más directamente explica por qué 3 de 5 corridas
  recientes (B.6) tardaron 40-52s en vez de los ~30s "base". Arreglar esto
  (ej. relajar el retry a 24h en vez de 1h — `PARTIAL_REQUIRED_SOURCE_MAX_AGE_HOURS`,
  `lib/universeEngine.js:12` — o hacer que el retry sea asíncrono/best-effort
  en vez de bloquear la ruta de caché) recortaría potencialmente esos
  ~15-20s extra en los días que se dispara.

### C.2 `readRecentlyScannedSymbols` — ¿para qué sirve, y puede ser agregada?

**Para qué sirve** (cita literal, `lib/materializedScanner.js:1234-1291`,
dentro de `resolveSymbols`):
```js
const needsScanState = options.skipRecentlyScanned || options.prioritizeMaterialization !== false;
if (needsScanState) {
  try {
    recentScanExclusion = await readRecentlyScannedSymbols({ ...options, markets });
  } catch (error) { ... }
}
const selection = selectUniverseRows(snapshot, {
  ...options,
  markets,
  excludedSymbols: options.skipRecentlyScanned ? recentScanExclusion?.symbols : new Set(),
  scanStateBySymbol: recentScanExclusion?.latestBySymbol,
  scanStateConfigured: Boolean(recentScanExclusion?.configured && !recentScanExclusion?.skipped),
});
```
`recentScanExclusion.latestBySymbol` alimenta
`materializationPriorityForRow` (`lib/materializedScanner.js:833-890`), que
ordena qué símbolos escanear primero: nunca escaneados > planes válidos
recientes/antiguos > watch > score alto, etc. Es decir: no es solo un
filtro de exclusión (`skipRecentlyScanned`, que el cron real ni siquiera
activa explícitamente) — es el insumo de la **prioridad de escaneo**, que
sí está activa siempre por default.

**¿Se podría hacer con una consulta agregada?** El uso real que se le da a
las filas leídas es, por símbolo, solo la **más reciente**
(`lib/materializedScanner.js:1153-1159`):
```js
for (const row of rows || []) {
  const symbol = normalizeSymbol(row.symbol);
  ...
  if (latestBySymbol.has(symbol)) continue;   // ya se quedó con la primera (mas reciente, por order=created_at.desc)
  const state = latestScanStateFromRow(row, days);
  latestBySymbol.set(symbol, { ...state, market: key });
  ...
}
```
Esto es exactamente el patrón que en Postgres se resuelve con
`DISTINCT ON (symbol) ... ORDER BY symbol, created_at DESC` (o una vista/RPC
equivalente, similar a como ya existe `scan_symbol_history_latest_v1` para
`scan_symbol_history`, usada en `lib/scanHistory.js:188-191`) en vez de traer
hasta 5000 filas completas (incluyendo la columna `metrics`, que es JSON
pesado) y deduplicar en JS. El propio código ya tiene el precedente de este
patrón (una RPC "latest_v1") para la tabla hermana `scan_symbol_history`;
crear el equivalente `scan_results_latest_v1` (o una función/vista
materializada) evitaría traer filas duplicadas por completo — con datos de
90 días de lookback y escaneos diarios de 12-24 símbolos por grupo en ~15
grupos, el número de filas *distintas* de símbolo es mucho menor que las
filas totales del período, así que el ahorro de payload/tiempo podría ser
sustancial. **No medí el tamaño real de `scan_results` para cuantificar
esto** (la propia tarea advierte que consultarla sin filtro de fecha da
timeout; no lo intenté sin fecha por esa razón) — queda como estimación
razonada, no medición.

### C.3 ¿Las escrituras finales son secuenciales? ¿Podrían paralelizarse?

Sí son secuenciales (cita en A.1). De las 4 escrituras post-scan
(`writeMaterializedScan`, `writeScanSymbolHistory`, `writeScanBatchCursor`,
`writeRotation`), hay dependencias reales entre algunas:
- `writeScanSymbolHistory` necesita `savedScan.scanId`
  (`sourceScanId: savedScan.scanId`, [app/api/cron/scan-refresh/route.js:241](../app/api/cron/scan-refresh/route.js#L241)) →
  depende de `writeMaterializedScan`. No paralelizable con ella.
- `writeScanBatchCursor` necesita `nextCursorValue(cursor.value, options,
  result, savedScan)`, que lee `savedScan.localId`/`savedScan.scanId` solo
  para logging (no bloquea lógica), pero el código actual la condiciona a
  `savedScan.saved` (`savedScan.saved ? await writeScanBatchCursor(...) :
  ...`) — **no depende de `writeScanSymbolHistory`**, solo de
  `writeMaterializedScan`. Podría lanzarse en paralelo con
  `writeScanSymbolHistory` en vez de esperar a que esta termine primero,
  vía `Promise.all([writeScanSymbolHistory(...), writeScanBatchCursor(...)])`
  — ambas dependen solo de `savedScan`, no una de otra.
- `writeRotation` (`nextRotation`) depende de `savedScan.rows` para
  `lastSavedRows` (dato de logging, no bloqueante) — también podría entrar
  al mismo `Promise.all`.
- `createRun`/`finishRun` (provider_runs) son telemetría del propio run: no
  pueden paralelizarse con el trabajo que están registrando por diseño
  (abren y cierran el run), pero si fallan no bloquean nada
  (`createRun`/`finishRun` tienen `try/catch` que devuelven `null` o no
  lanzan, [app/api/cron/scan-refresh/route.js:135-158,160-176](../app/api/cron/scan-refresh/route.js#L135-L158)).

Estimación (no medida): paralelizar `writeScanSymbolHistory` +
`writeScanBatchCursor` + `writeRotation` ahorraría aproximadamente el tiempo
de las 2 escrituras más rápidas de las 3 (si cada una tarda del orden de
100-300ms en Vercel, esto son ~200-600ms de ahorro) — modesto comparado con
los 15-20s de `readRecentlyScannedSymbols`/`shouldRetryMissingRequiredSources`,
pero gratis en términos de riesgo (no cambia semántica, solo orden de
ejecución de escrituras independientes).

---

## PARTE D — Cuánto margen daría

### D.1 Presupuesto actual (medido/observado)

Con los ~43s reales de la corrida de referencia (2026-08-06, US,HK,AU,
`cache.hit: true`) y el desglose medido en B.4 para el mismo tipo de
operación (universe_read + recent_scan_read), el reparto aproximado del
tiempo — **ESTIMACIÓN**, combinando la medición local de B.4 con el dato de
producción de que esa corrida específica NO disparó `buildUniverse()`
(`cache.hit: true`, sin las líneas de NasdaqTrader/HKEX/TWSE/ASIC) — sería
del orden de:

| Fase | Estimado (caso `cache.hit: true`, sin retry) |
|---|---|
| `readRotation` + `readScanBatchCursor` + `createRun` (3 round-trips chicos) | ~0,5-1s (no medido directamente, extrapolado de latencias individuales observadas ~150-450ms/petición) |
| `universe_read` (11+1 páginas, 10.940 filas) | ~2,7-3,4s (medido, B.4) |
| `recent_scan_read` (hasta 5 páginas, 90 días) | ~9,3-15,9s (medido, B.4) |
| `hydrateBenchmarks` | ~0,2-0,4s (medido, B.2/B.3) |
| `analyzeOne` × 12 símbolos, concurrencia 2 | ~1-3s (extrapolado de B.3: ~138ms/símbolo × 12 ≈ 1,7s, aunque el entorno de red difiere de Vercel) |
| Escrituras finales (`writeMaterializedScan` + `writeScanSymbolHistory` + `writeScanBatchCursor` + `writeRotation` + `finishRun`) secuenciales | ~1-2s (no medido: serían 5-6 round-trips chicos si no hay reintentos) |
| **Total estimado** | **~15-26s**, sin explicar completamente los 43,3s medidos en producción |

La brecha entre esta estimación (~15-26s) y los 43,3s reales medidos en
producción sugiere que **la latencia individual por petición en Vercel/red
real hacia Supabase es más alta que la que medí localmente**, y/o que
`recent_scan_read` en producción es más lento aún que mis 9,3-15,9s locales
(posible: mi entorno local puede tener mejor o peor latencia hacia el mismo
proyecto Supabase que la función de Vercel — no hay forma de saberlo sin
instrumentar la función real en producción, lo cual está fuera del alcance
permitido aquí). **Esta fila del total es la estimación menos confiable de
todo el documento** — lo marco explícitamente como tal.

### D.2 Margen si se recorta cada fase

- Reemplazar `readRecentlyScannedSymbols` por una consulta agregada
  (C.2) podría recortar la fase más cara medida (9,3-15,9s locales) a una
  fracción de eso (una vista/RPC "latest por símbolo" evita traer filas
  duplicadas, similar a como `scan_symbol_history_latest_v1` ya lo hace para
  la tabla hermana) — **no cuantificable sin medir el tamaño real de
  `scan_results`** dentro de la ventana de 90 días.
- Evitar que `shouldRetryMissingRequiredSources` dispare `buildUniverse()`
  en corridas que no lo necesitan recortaría los ~15-20s extra observados en
  3 de 5 días recientes (B.6), aunque no afecta el caso "feliz" (2026-08-06)
  que ya tenía `cache.hit: true`.
- Paralelizar las escrituras finales independientes (C.3): ahorro modesto,
  ~200-600ms estimados.

Con esos tres recortes combinados, en el **mejor caso realista** (sin retry
de universo, `recent_scan_read` convertido a consulta agregada, escrituras
paralelizadas), el coste fijo por invocación podría bajar de los ~43s
observados a algo del orden de **10-15s** (ESTIMACIÓN compuesta, no
medición — construida sumando los recortes de arriba sobre el total
estimado de D.1, así que hereda toda su incertidumbre). Eso dejaría
~45-50s de los 60s disponibles para símbolos, y a razón de ~0,54s marginal
por símbolo (dato de producción del propio prompt), permitiría procesar del
orden de **85-90 símbolos por invocación** en vez de los 12-24 actuales —
sin cambiar `maxDuration` ni la arquitectura del cron.

### D.3 ¿Alcanza para el universo relevante o el elegible?

Con ~85-90 símbolos por invocación (D.2, mejor caso estimado) y 15 grupos de
cron rotando (`SCAN_CRON_GROUPS`, `lib/cronPlan.js:21-...`, cron corre
aparentemente una vez al día por grupo según la cadencia observada en B.6),
cubrir el universo **elegible** completo (~11.123 símbolos, cifra del
prompt) tomaría del orden de 11.123 / 90 ≈ **124 invocaciones** — a una
invocación diaria por grupo rotando entre ~15 grupos, eso son varios meses
para dar una vuelta completa al universo elegible, incluso con todos los
recortes de la Parte C aplicados. El universo **relevante** (~880 símbolos)
sí sería cubrible en unas ~10 invocaciones, es decir, en el orden de una a
dos semanas con la rotación actual — **pero esto asume que la
priorización por `materializationPriorityForRow` ya concentra esos ~880
símbolos relevantes al frente de la cola**, algo que no verifiqué en este
análisis (depende de cómo se define "relevante" y si coincide con los
criterios de prioridad ya implementados: nunca escaneado, plan válido
reciente, score alto, etc.).

**Conclusión de D.3**: incluso en el mejor caso de recortes de la Parte C,
sigue haciendo falta o bien (a) una ventana de ejecución más larga que los
60s de Vercel Hobby (un plan superior con `maxDuration` mayor cambiaría esta
cuenta directamente y de forma más confiable que optimizar código), o bien
(b) aceptar que el barrido completo del universo elegible tome meses en vez
de días — lo cual puede ser aceptable o no dependiendo de qué tan
frecuentemente se necesite refrescar cada símbolo, decisión de producto que
no me corresponde tomar aquí.

---

## CONFIANZA

- **Alta**: la estructura secuencial de fases dentro y fuera de
  `runMaterializedScan` (Parte A) — es lectura directa y literal del código,
  no requiere interpretación.
- **Alta**: `universe_read` cuesta ~2,7-3,4s medidos, para 10.940 filas
  reales de producción, vía 12 peticiones GET secuenciales — medición
  directa y reproducible con el script.
- **Alta**: `readRecentlyScannedSymbols` (`recent_scan_read`) es, medido,
  la fase más cara de las candidatas — 9,3-15,9s en una corrida real contra
  producción. Esto es un hallazgo nuevo, no estaba en la lista de
  "candidatas conocidas" del enunciado.
- **Media**: la relación cuantitativa entre lo medido localmente y los 43,3s
  reales medidos en Vercel (D.1) — la brecha (~15-26s estimados vs 43,3s
  reales) es real y está declarada, no oculta, pero no la puedo cerrar sin
  instrumentar la función en producción real.
- **Media**: `shouldRetryMissingRequiredSources` como explicación de por qué
  3 de 5 corridas recientes tuvieron `cache.hit: false` (B.6) — es
  consistente con lo que medí (se disparó una vez, en vivo, durante este
  análisis) pero no verifiqué la causa exacta de cada corrida histórica
  específica.
- **Baja**: los números de "mejor caso" de la Parte D (10-15s de coste fijo,
  85-90 símbolos por invocación, cobertura del universo elegible/relevante)
  — son estimaciones compuestas sobre estimaciones, útiles como orden de
  magnitud, no como compromiso de ingeniería.

## LO QUE NO HE VERIFICADO

- **La causa exacta, corrida por corrida, de por qué `cache.hit` alterna
  entre `true`/`false` en `provider_runs` para mercados dentro de
  `CRON_UNIVERSE_MARKETS`** (B.6) — solo verifiqué el mecanismo
  (`shouldRetryMissingRequiredSources`) que PUEDE producir ese efecto, no que
  sea la causa en cada una de las 3 corridas históricas con `hit: false`.
- **El tamaño real de la tabla `scan_results`** dentro de la ventana de 90
  días de `readRecentlyScannedSymbols` — no la consulté sin filtro de fecha
  (la propia tarea advierte que da timeout) ni hice un `count` agregado con
  filtro, así que la estimación de C.2/D.2 sobre cuánto ahorraría una
  consulta agregada es razonada, no cuantificada.
- **La latencia real función-Vercel-a-Supabase** — todas mis mediciones son
  desde mi máquina local hacia el mismo proyecto Supabase de producción; no
  tengo forma de instrumentar la función real desplegada en Vercel dentro
  de las restricciones de esta tarea (no ejecutar el cron, no hacer commit/
  push). La forma del problema (qué operaciones son secuenciales, cuántos
  round-trips hace cada una) sí está verificada; las magnitudes absolutas en
  producción, no.
- **Si `EU1`/`EU2` y otros grupos que no son subconjunto de
  `CRON_UNIVERSE_MARKETS`** sufren el mismo patrón — no los medí, y por
  construcción (`useCronUniverseSnapshot` exige que todos los mercados del
  grupo estén en `CRON_UNIVERSE_MARKETS`,
  `lib/materializedScanner.js:1256-1258`) su camino de universo es distinto
  (siempre `buildUniverse()` por mercado propio, sin instantánea combinada).
- **El coste real de la doble llamada a `sectorize`** (A.2) más allá de que
  la CPU total medida del proceso (~250-500ms para todo el ciclo con 2-12
  símbolos) descarta que sea significativa a esta escala — no aislé cuánto
  de esa CPU corresponde a cada una de las dos llamadas.
- **Si aumentar `pageSize` o reducir `select=*` en `universe_read` (C.1)
  produce una mejora medible** — son sugerencias basadas en lectura de
  código, no las implementé ni medí (la tarea prohíbe modificar archivos
  existentes).
