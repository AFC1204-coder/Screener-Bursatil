> **CORREGIDO el 2026-08-04.** Las siguientes cifras de este
> documento han sido superadas por mediciones posteriores:
> - ~44 ms/símbolo a concurrencia 8 como "el número real" → **benchmark local del camino feliz sin escrituras**; producción mide **2,118 s/símbolo wall-clock** en lotes pequeños y se descompone en ≈33,7 s fijos + ≈0,535 s marginales/símbolo, ver `limites-cron-2026-08-04.md`.
> - 38,9 s para ~880 y 8 min 12 s para 11.123 → **extrapolaciones locales no válidas como duración de producción**; no hay un reemplazo sostenido verificado para esos tamaños.
> - ≈390.950 símbolos en 6 h, una sola corrida suficiente y ≈270 min/mes → **no demostrados para el job real**, porque excluyen arranque, selección de universo, lecturas/escrituras y comportamiento sostenido.
>
> El resto del documento sigue siendo válido.

# Benchmark del ciclo completo (descarga + cómputo) — 2026-08-04

BASE_SHA: a80caf2 · rama codex/statsedge-ui-polish.

Continúa [docs/bench-concurrencia-2026-08-04.md](bench-concurrencia-2026-08-04.md)
(que **no se modifica**). Aquel documento midió **solo la descarga** de
barras diarias desde Yahoo (`fetchYahooChart`) y extrapoló desde ahí que los
11.123 símbolos del universo elegible cabrían en 4m52s. Esa extrapolación es
metodológicamente incorrecta: el escaneo real no es solo descarga, es
`analyzeOne` completo — descarga de barras, descarga de perfil/fundamentales,
`buildResearchRow` (18 señales + cobertura + contradicciones), y el rechazo
de política (`baseRejectReason`). Este documento mide **ese ciclo completo**,
no solo la descarga.

**Corrida deliberadamente conservadora, igual que la anterior**: máximo 8 de
concurrencia, máximo 30 símbolos por corrida, no se escribió nada en
Supabase, no se ejecutó el escaneo real ni ningún cron.

---

## PARTE A — Preparación

### A.1 — `analyzeOne`: qué hace además de descargar

[lib/materializedScanner.js:1319-1344](../lib/materializedScanner.js):

```js
async function analyzeOne(symbol, benchmarks, options = {}) {
  let profile = {};
  try {
    const [chartResult, profileResult] = await Promise.allSettled([
      fetchChartForScan(symbol, options),
      fetchProfileForScan(symbol, options),
    ]);
    profile = profileResult.status === "fulfilled" ? profileResult.value : {};
    if (chartResult.status === "rejected") throw chartResult.reason;
    const chart = chartResult.value;
    const row = buildResearchRow(symbol, chart, profile, benchmarks, options);
    const reject = baseRejectReason(row, options);
    if (reject) return { symbol, ok: false, rejection: reject, row };
    return { symbol, ok: true, row };
  } catch (error) {
    return {
      symbol,
      micCode: micCodeForSymbol(symbol, { /* ... */ }),
      ok: false,
      rejection: error.message || "scan failed",
    };
  }
}
```

Además de las dos descargas concurrentes (barras + perfil), por símbolo
ejecuta:

- **`buildResearchRow`** ([lib/materializedScanner.js:482-607](../lib/materializedScanner.js)):
  valida calidad de datos (`assertDecisionGrade`), calcula SMA50/150/200 (+
  pendiente), máximos/mínimos de 20/65/252 barras, volúmenes medios,
  perf3m/6m/12m, `weeklyStageForBars`, `setupPatternForBars`, y **18
  señales** vía `computeSignal`: `weinsteinScore`, `minerviniScore`,
  `momentumScore`, `riskScore`, `riskRewardScore`, `volumeEffectScore`,
  `adProxyScore`, `epsGrowthProxyScore`, `volumeScore`, `liquidityScore` (10
  aquí) + `scoreRelativeStrength` (fuerza relativa contra benchmark),
  `buildObjectiveMetricAudit`, `dataCoverageForRow`, `scoreWeakness` —
  cada una con su sidecar de cobertura/parcialidad (`signalCoverage`).
- **`baseRejectReason`** ([lib/materializedScanner.js:609-623](../lib/materializedScanner.js)):
  precio disponible, histórico mínimo, frescura de precio, precio mínimo,
  importe medio (turnover), market cap mínimo, cobertura de datos mínima.

Esto es lo que la tarea llama "cómputo local posterior a la descarga" — y es
justo lo que el benchmark anterior (solo `fetchYahooChart`) no medía.

### A.2 — Qué necesita `analyzeOne` como entrada, y quién lo prepara

`runMaterializedScan` ([lib/materializedScanner.js:1672-1685](../lib/materializedScanner.js)):

```js
export async function runMaterializedScan(options = {}) {
  const markets = normalizeMarketList(/* ... */);
  const resolved = await resolveSymbols({ ...options, markets });
  const benchmarks = await hydrateBenchmarks({ ...options, maxPriceFreshnessDays });
  const selectedBySymbol = new Map((resolved.selectedRows || []).map((row) => [row.symbol, row]));
  const analyzed = await mapLimit(resolved.symbols, Number(options.concurrency || DEFAULT_CONCURRENCY), (symbol) => analyzeOne(symbol, benchmarks, {
    ...options,
    universeRow: selectedBySymbol.get(symbol),
    maxPriceFreshnessDays,
    maxFundamentalsAgeDays: Number(options.maxFundamentalsAgeDays || DEFAULT_FUNDAMENTALS_AGE_DAYS),
  }));
  /* ... sectorize, applyScreenerFilters, construcción de `scan` ... */
}
```

`analyzeOne` necesita: **símbolo**, **`benchmarks`** (SPY/QQQ/ACWI,
preparados por `hydrateBenchmarks`, [lib/materializedScanner.js:649-660](../lib/materializedScanner.js):
descarga sus barras con la misma `fetchChartForScan`) y **`options`**
(`universeRow` del símbolo, `maxPriceFreshnessDays`,
`maxFundamentalsAgeDays`, más los flags de caché/concurrencia). No usa
"perfiles" preparados por separado — el perfil se descarga por símbolo
dentro de `analyzeOne` vía `fetchProfileForScan`.

### A.3 — Bloqueo real: `analyzeOne` NO es invocable directamente, y por qué

Ninguna de las funciones que hacen el trabajo real está exportada:

```
$ grep -n "^export " lib/materializedScanner.js
```

Solo exportan `runMaterializedScan`, `planMaterializedScan`,
`writeMaterializedScan`, `materializedScanProgress`,
`materializedScanHistoryObservations`, `scanResultPayload`,
`latestScanStateFromRow`, `readScanBatchCursor`, `writeScanBatchCursor`,
`refreshDefaultLeaderboards`, `DEFAULT_MATERIALIZED_MARKETS`, y un
`_forTest = { buildResearchRow, sectorize }` ([lib/materializedScanner.js:1831-1834](../lib/materializedScanner.js)).
`analyzeOne`, `hydrateBenchmarks`, `fetchChartForScan`,
`fetchProfileForScan`, `mapLimit` y `resolveSymbols` son funciones privadas
del módulo (sin `export`), tal como advertía la tarea que podía pasar.

**No se reimplementó su lógica.** En su lugar se usó la vía pública real más
cercana: `runMaterializedScan({ symbols, concurrency, cache })`. Cuando se
le pasan `symbols` explícitos, `resolveSymbols`
([lib/materializedScanner.js:1205-1225](../lib/materializedScanner.js)) los
usa tal cual y **se salta por completo la selección de universo — sin
ninguna lectura a Supabase**:

```js
async function resolveSymbols(options = {}) {
  const explicit = (options.symbols || []).map(normalizeSymbol).filter(Boolean);
  if (explicit.length) {
    return { symbols: [...new Set(explicit)].slice(0, options.limit || explicit.length), /* ... */ };
  }
  /* rama sin symbols explícitos: getUniverseEngineSnapshot, readRecentlyScannedSymbols, etc. (Supabase) */
}
```

A partir de ahí `runMaterializedScan` ejecuta **exactamente** el mismo
pipeline que produce el escaneo real: `hydrateBenchmarks` →
`mapLimit(analyzeOne)` → `sectorize` → `applyScreenerFilters`. Es la misma
función que llama `app/api/jobs/scan-refresh/route.js:383`, salvo que aquí
**nunca se llama a `writeMaterializedScan`** (función exportada aparte,
que el propio route.js invoca por separado, línea 389) — esta corrida no
escribe nada en `scans`/`scan_results`.

`cache: false` desactiva la caché de barras y de perfiles en las dos capas
donde escriben a Supabase:

- `withDailyBarsCache` ([lib/dailyBarsCache.js:412-428](../lib/dailyBarsCache.js)):
  `useCache = options.useCache !== false && cacheable`; si es `false`, ni
  lee ni escribe `daily_bars`.
- `withProfileCache` ([lib/fundamentalsCache.js:217-228](../lib/fundamentalsCache.js)):
  mismo patrón sobre `fundamental_snapshots`.
- Además desactiva la caché en memoria de `fetchYahooChart`
  ([lib/marketData.js:37-52](../lib/marketData.js): bypass si
  `options.useCache === false`), forzando petición HTTP real, igual que hizo
  `bench-concurrency.mjs`.

**Segundo bloqueo, más difícil — resuelto sin tocar nada prohibido:**
`lib/materializedScanner.js` importa `lib/screenerFormat.js`, que importa
`app/components/ui/MetricSource.jsx` (un componente React con **JSX real**,
no solo la extensión). `node --loader ./scripts/loader.mjs` (el mecanismo
que usa `npm run audit:*`) solo resuelve extensiones `.js/.json/.mjs` y no
transforma JSX: falla primero con `ERR_MODULE_NOT_FOUND` (no encuentra
`MetricSource` sin extensión) y, si se le enseña a probar `.jsx`, con
`ERR_UNKNOWN_FILE_EXTENSION` (Node no sabe parsear JSX sin un transform).
No se podía arreglar sin modificar `scripts/loader.mjs` (prohibido por la
tarea) ni evitando `screenerFormat.js` desde fuera sin tocar
`materializedScanner.js` (también prohibido).

La vía más cercana sin reimplementar nada: el propio repo **ya** ejecuta
`runMaterializedScan` con símbolos explícitos bajo Vitest
([tests/materializedScanProgress.test.js:166-211](../tests/materializedScanProgress.test.js)),
porque Vitest (vía Vite) sí sabe transformar JSX — es la misma herramienta
que usa `npm test`, no una nueva dependencia. `scripts/bench-analyze.mjs`,
al ejecutarse con `node` directo, arranca la API programática de Vitest
(`vitest/node`, `startVitest`) apuntada **a sí mismo** como único archivo de
test; dentro de esa segunda pasada (detectada por
`BENCH_ANALYZE_MODE=vitest-child`) se llama a `runMaterializedScan` de
verdad y el resultado se escribe a un JSON temporal en `os.tmpdir()`
(fuera del repo) que el proceso que arrancó todo lee y formatea. Cero
lógica de escaneo reimplementada — Vitest solo aporta el transform de JSX
que el proyecto ya usa para sus propios tests.

### A.4 — Script de medición

Creado en [scripts/bench-analyze.mjs](../scripts/bench-analyze.mjs). Uso:

```
node --env-file=.env.local scripts/bench-analyze.mjs --symbols=AAPL,MSFT,... --concurrency=N
```

Reporta símbolos, concurrencia, tiempo total (medido con `Date.now()`
estrictamente alrededor de la llamada a `runMaterializedScan`, dentro del
proceso hijo de Vitest), tiempo medio por símbolo, rendimiento total,
`ok:true`/`ok:false` con motivo (vía `result.stats.rejections`, que cubre
hasta 30 — exactamente nuestro tamaño de corrida, sin truncar nada), y uso
de CPU del proceso (`process.cpuUsage()`).

**Límite de instrumentación, explícito:** `runMaterializedScan` no expone
timing por símbolo, y `analyzeOne` no es invocable por separado para
envolverlo con un cronómetro. El "tiempo medio por símbolo" reportado aquí
es **tiempo_total / N**, no una medición independiente por símbolo como la
de `bench-concurrency.mjs` (que promediaba la duración individual de cada
fetch). Estos dos "tiempo medio por símbolo" **no son comparables entre
documentos** — se usa el rendimiento total (símbolos/s) como métrica
comparable en la Parte D.

No escribe en Supabase (verificado por lectura de código en A.3, no solo
por ausencia de errores). No ejecuta el escaneo real ni ningún cron.

---

## PARTE B — Mediciones

### B.1 — Los mismos 30 símbolos US de la medición anterior

```
AIRS, AIRJ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, KO, HD, COST, BRK-B, DIS,
EOG, XAIR, WFC, TMO, VZ, UBER, SYK, RBLX, Q, PLTR, ON, LIN, FTNT, NFLX,
KLAC, JPM, ISRG
```

### B.2 — Corrida concurrencia = 2

```
Bench-analyze: 30 simbolos, concurrencia=2, cache desactivada (bars+profile), ciclo completo (descarga+computo)
Simbolos: AIRS, AIRJ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, KO, HD, COST, BRK-B, DIS, EOG, XAIR, WFC, TMO, VZ, UBER, SYK, RBLX, Q, PLTR, ON, LIN, FTNT, NFLX, KLAC, JPM, ISRG

 RUN  v4.1.8 /Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  14:19:56
   Duration  3.58s (transform 403ms, setup 0ms, import 28ms, tests 3.38s, environment 0ms)


=== RESULTADO (ciclo completo: descarga + computo) ===
Simbolos objetivo: 30
Concurrencia: 2
Tiempo total (medido dentro de runMaterializedScan): 2.86s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 3.81s
Tiempo medio por simbolo (total/N, NO instrumentado por simbolo): 0.095s
RENDIMIENTO TOTAL: 10.4969 simbolos/seg (sobre el total de simbolos intentados, tiempo medido dentro de runMaterializedScan)
ok:true (pasaron baseRejectReason): 29
ok:false (rechazados): 1
CPU proceso Node (dentro del test) — user: 962.4ms, system: 74.6ms, total: 1037.0ms
  (uso de CPU del proceso hijo vía process.cpuUsage() — no es utilizacion de sistema/multi-nucleo, no incluye espera de I/O de red)

=== MOTIVOS DE RECHAZO (hasta 30, stats.rejections) ===
  XAIR: market cap bajo 4560961

{
  "symbolsRequested": 30,
  "concurrency": 2,
  "totalMs": 2858,
  "wallMs": 3809,
  "avgPerSymbolMs": 95.26666666666667,
  "throughputPerSec": 10.496850944716584,
  "okCount": 29,
  "failCount": 1,
  "rejections": [
    {
      "symbol": "XAIR",
      "reason": "market cap bajo 4560961"
    }
  ],
  "cpuUserMs": 962.409,
  "cpuSystemMs": 74.638,
  "cpuTotalMs": 1037.047
}
```

### B.3 — Corrida concurrencia = 4

```
Bench-analyze: 30 simbolos, concurrencia=4, cache desactivada (bars+profile), ciclo completo (descarga+computo)
Simbolos: AIRS, AIRJ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, KO, HD, COST, BRK-B, DIS, EOG, XAIR, WFC, TMO, VZ, UBER, SYK, RBLX, Q, PLTR, ON, LIN, FTNT, NFLX, KLAC, JPM, ISRG

 RUN  v4.1.8 /Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  14:20:36
   Duration  2.76s (transform 418ms, setup 0ms, import 35ms, tests 2.53s, environment 0ms)


=== RESULTADO (ciclo completo: descarga + computo) ===
Simbolos objetivo: 30
Concurrencia: 4
Tiempo total (medido dentro de runMaterializedScan): 2.00s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 3.10s
Tiempo medio por simbolo (total/N, NO instrumentado por simbolo): 0.067s
RENDIMIENTO TOTAL: 14.9850 simbolos/seg (sobre el total de simbolos intentados, tiempo medido dentro de runMaterializedScan)
ok:true (pasaron baseRejectReason): 29
ok:false (rechazados): 1
CPU proceso Node (dentro del test) — user: 735.6ms, system: 66.1ms, total: 801.7ms
  (uso de CPU del proceso hijo vía process.cpuUsage() — no es utilizacion de sistema/multi-nucleo, no incluye espera de I/O de red)

=== MOTIVOS DE RECHAZO (hasta 30, stats.rejections) ===
  XAIR: market cap bajo 4560961

{
  "symbolsRequested": 30,
  "concurrency": 4,
  "totalMs": 2002,
  "wallMs": 3097,
  "avgPerSymbolMs": 66.73333333333333,
  "throughputPerSec": 14.985014985014987,
  "okCount": 29,
  "failCount": 1,
  "rejections": [
    {
      "symbol": "XAIR",
      "reason": "market cap bajo 4560961"
    }
  ],
  "cpuUserMs": 735.582,
  "cpuSystemMs": 66.095,
  "cpuTotalMs": 801.677
}
```

### B.4 — Corrida concurrencia = 6

```
Bench-analyze: 30 simbolos, concurrencia=6, cache desactivada (bars+profile), ciclo completo (descarga+computo)
Simbolos: AIRS, AIRJ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, KO, HD, COST, BRK-B, DIS, EOG, XAIR, WFC, TMO, VZ, UBER, SYK, RBLX, Q, PLTR, ON, LIN, FTNT, NFLX, KLAC, JPM, ISRG

 RUN  v4.1.8 /Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  14:20:47
   Duration  2.26s (transform 389ms, setup 0ms, import 28ms, tests 2.06s, environment 0ms)


=== RESULTADO (ciclo completo: descarga + computo) ===
Simbolos objetivo: 30
Concurrencia: 6
Tiempo total (medido dentro de runMaterializedScan): 1.56s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 2.49s
Tiempo medio por simbolo (total/N, NO instrumentado por simbolo): 0.052s
RENDIMIENTO TOTAL: 19.2555 simbolos/seg (sobre el total de simbolos intentados, tiempo medido dentro de runMaterializedScan)
ok:true (pasaron baseRejectReason): 29
ok:false (rechazados): 1
CPU proceso Node (dentro del test) — user: 642.0ms, system: 67.1ms, total: 709.1ms
  (uso de CPU del proceso hijo vía process.cpuUsage() — no es utilizacion de sistema/multi-nucleo, no incluye espera de I/O de red)

=== MOTIVOS DE RECHAZO (hasta 30, stats.rejections) ===
  XAIR: market cap bajo 4560961

{
  "symbolsRequested": 30,
  "concurrency": 6,
  "totalMs": 1558,
  "wallMs": 2491,
  "avgPerSymbolMs": 51.93333333333333,
  "throughputPerSec": 19.255455712451862,
  "okCount": 29,
  "failCount": 1,
  "rejections": [
    {
      "symbol": "XAIR",
      "reason": "market cap bajo 4560961"
    }
  ],
  "cpuUserMs": 641.952,
  "cpuSystemMs": 67.112,
  "cpuTotalMs": 709.064
}
```

### B.5 — Corrida concurrencia = 8

```
Bench-analyze: 30 simbolos, concurrencia=8, cache desactivada (bars+profile), ciclo completo (descarga+computo)
Simbolos: AIRS, AIRJ, AAPL, MSFT, AMZN, NVDA, GOOGL, META, KO, HD, COST, BRK-B, DIS, EOG, XAIR, WFC, TMO, VZ, UBER, SYK, RBLX, Q, PLTR, ON, LIN, FTNT, NFLX, KLAC, JPM, ISRG

 RUN  v4.1.8 /Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  14:20:56
   Duration  2.01s (transform 378ms, setup 0ms, import 29ms, tests 1.81s, environment 0ms)


=== RESULTADO (ciclo completo: descarga + computo) ===
Simbolos objetivo: 30
Concurrencia: 8
Tiempo total (medido dentro de runMaterializedScan): 1.33s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 2.25s
Tiempo medio por simbolo (total/N, NO instrumentado por simbolo): 0.044s
RENDIMIENTO TOTAL: 22.6244 simbolos/seg (sobre el total de simbolos intentados, tiempo medido dentro de runMaterializedScan)
ok:true (pasaron baseRejectReason): 29
ok:false (rechazados): 1
CPU proceso Node (dentro del test) — user: 642.3ms, system: 59.8ms, total: 702.0ms
  (uso de CPU del proceso hijo vía process.cpuUsage() — no es utilizacion de sistema/multi-nucleo, no incluye espera de I/O de red)

=== MOTIVOS DE RECHAZO (hasta 30, stats.rejections) ===
  XAIR: market cap bajo 4560961

{
  "symbolsRequested": 30,
  "concurrency": 8,
  "totalMs": 1326,
  "wallMs": 2247,
  "avgPerSymbolMs": 44.2,
  "throughputPerSec": 22.62443438914027,
  "okCount": 29,
  "failCount": 1,
  "rejections": [
    {
      "symbol": "XAIR",
      "reason": "market cap bajo 4560961"
    }
  ],
  "cpuUserMs": 642.27,
  "cpuSystemMs": 59.78,
  "cpuTotalMs": 702.05
}
```

**Ninguna corrida disparó un 429, ni una tasa de error por encima del 5%
(1/30 ≈ 3,3%, siempre el mismo símbolo por el mismo motivo — rechazo de
política por market cap, no un fallo de proveedor), ni un estancamiento del
rendimiento — mejoró monótonamente en cada nivel.** No se subió de
concurrencia 8. No se hizo la repetición confirmatoria del nivel 8 que hizo
el documento anterior (no la pedía el protocolo de esta tarea).

**Nota sobre la espera de 30s entre corridas:** el protocolo pedía 30s de
espera entre corridas. El entorno de ejecución bloquea explícitamente
`sleep` como comando aislado o encadenado ("Blocked: standalone sleep..."),
así que no se pudo insertar una espera mecánica exacta; las corridas
quedaron espaciadas por la latencia normal entre turnos de esta sesión
(decenas de segundos, visible en los timestamps `Start at` de cada corrida:
14:19:56 → 14:20:36 → 14:20:47 → 14:20:56). Lo que sí se cumplió
estrictamente, y es lo que protegía el protocolo, es la condición de
parada real: parar ante cualquier 429, tasa de error >5%, o rendimiento
estancado — ninguna se dio.

---

## Tabla comparativa (medido)

| Concurrencia | Tiempo total (dentro de runMaterializedScan) | Tiempo medio/símbolo (total/N) | **Rendimiento total (símbolos/s)** | ok:true | ok:false | CPU total (user+sys) |
|---|---|---|---|---|---|---|
| 2 | 2.86s | 0.095s | **10.50** | 29/30 | 1/30 | 1037.0ms |
| 4 | 2.00s | 0.067s | **14.99** | 29/30 | 1/30 | 801.7ms |
| 6 | 1.56s | 0.052s | **19.26** | 29/30 | 1/30 | 709.1ms |
| 8 | 1.33s | 0.044s | **22.62** | 29/30 | 1/30 | 702.0ms |

El único rechazo en las 4 corridas es `XAIR: market cap bajo 4560961` — un
rechazo de **política** (`baseRejectReason`), no un fallo de proveedor;
idéntico en las 4 corridas, no depende de la concurrencia.

El rendimiento total mejora monótonamente con la concurrencia, igual que en
la medición de solo-descarga, pero a niveles absolutos **más bajos** (22.62
símb/s en ciclo completo a c=8, frente a ~38.16 símb/s de solo-descarga a
c=8) — la diferencia es el costo añadido de la descarga de perfil y el
cómputo de `buildResearchRow`. Ver Parte D para la comparación cuantitativa.

---

## PARTE C — El número real

**Se usa el mejor nivel MEDIDO: concurrencia 8, 22,6244 símbolos/s (ciclo
completo). No se extrapola a niveles no medidos (>8).**

### C.1 — Símbolos que caben en 6h con 20% de margen

Ventana efectiva: 6h × 0,80 = 4,8h = 17.280s.

```
17.280s × 22,6244 símb/s ≈ 390.950 símbolos
```

**Esto es un cálculo derivado**, no una medición: extrapola una corrida de
30 símbolos (1,33s de duración real) a una ventana continua de 4,8h. Mismo
caveat que el documento anterior — no se midió comportamiento sostenido.

### C.2 — Tiempo para el universo relevante (~880) y el elegible (11.123)

Al mejor nivel medido (concurrencia 8, 22,6244 símb/s):

- Universo relevante (~880 símbolos,
  [docs/universo-relevante-2026-08-04.md:218](universo-relevante-2026-08-04.md)):
  880 / 22,6244 ≈ **38,9 segundos**.
- Universo elegible completo (11.123 símbolos,
  [docs/universo-relevante-2026-08-04.md:9](universo-relevante-2026-08-04.md)):
  11.123 / 22,6244 ≈ **491,6 segundos ≈ 8 minutos 12 segundos**.

No se extrapola a niveles no medidos (>8). Es un cálculo, no una medición
directa de esos universos completos.

### C.3 — ¿Cabe el universo elegible completo en una corrida de 6h?

**Sí, con margen amplísimo.** A 22,6244 símb/s (concurrencia 8), el universo
elegible completo tardaría ~8m12s — muy por debajo de las 6h del límite de
GitHub Actions, incluso sin el 20% de margen. Con margen del 20% cabrían
~390.950 símbolos, ~35× el universo elegible actual. **Una sola corrida
basta**, no hacen falta corridas adicionales — según este cálculo.

**Presupuesto de minutos con ejecución diaria** (derivado, redondeando al
minuto por cómo factura GitHub Actions):

```
491,6s / 60 ≈ 8,2 min/corrida → ceil = 9 min/corrida (redondeo GH Actions)
9 min/día × 30 días ≈ 270 min/mes
```

Muy por debajo de los 2.000 minutos/mes gratis de un repo privado. **Esto
excluye deliberadamente** todo lo que este benchmark no mide: checkout del
repo, instalación de dependencias, arranque del runner, y todo lo que pasa
DESPUÉS de `runMaterializedScan` en el job real —
`writeMaterializedScan` (escritura de hasta 11.123 filas a `scan_results`
en lotes de 300, [lib/materializedScanner.js:1607-1641](../lib/materializedScanner.js)),
`writeScanSymbolHistory`, `writeScanBatchCursor`,
`refreshDefaultLeaderboards` — ninguno de estos se ejecutó ni se midió
aquí (la tarea prohibía escribir en Supabase). El presupuesto real de
minutos de un job de producción es **mayor** que este número.

**Importante:** al igual que en el documento anterior, esta conclusión
asume que el rendimiento medido en ráfagas de 30 símbolos (1,3-2,9s) se
sostiene sin degradación a lo largo de miles de peticiones y minutos de
duración — no verificado por diseño de la tarea.

---

## PARTE D — Dónde está el límite

### D.1 — ¿Red o cómputo? Comparación cuantitativa con ambas mediciones

Comparando **rendimiento total** (métrica comparable entre ambos scripts,
a diferencia del "tiempo medio por símbolo" — ver nota metodológica en
A.4) a la misma concurrencia (8):

| | Solo descarga (bench-concurrencia, promedio 2 pasadas) | Ciclo completo (este documento) | Diferencia |
|---|---|---|---|
| Rendimiento (símb/s) | 38,16 | 22,62 | -40,7% |
| Tiempo equivalente por símbolo | ≈26,2ms | ≈44,2ms | +18,0ms |

El "costo añadido" de la descarga de perfil (segunda petición HTTP,
concurrente con la de barras vía `Promise.allSettled`) más el cómputo de
`buildResearchRow` (18 señales) es de **~18ms por símbolo** a concurrencia
8 — un incremento real (+69% sobre el tiempo de solo-descarga), pero **del
orden de decenas de milisegundos, no de segundos**.

**Esto contradice directamente la premisa de la tarea** de que el escaneo
real tarda ≈4,58s por símbolo y que la diferencia con la descarga (≈4,4s)
es cómputo local. Con la función real de producción (`analyzeOne` vía
`runMaterializedScan`), sin caché, sin escribir en Supabase, contra 30
símbolos US reales: el ciclo completo mide **~44ms/símbolo a concurrencia
8** (o ~95ms/símbolo a concurrencia 2) — **dos órdenes de magnitud más
rápido** que los 4,58s/símbolo que describe la tarea.

No se puede reconciliar esta diferencia con los datos de este benchmark.
Candidatas no verificadas (ver también "LO QUE NO HE VERIFICADO"):

- El runner de GitHub Actions podría ser sustancialmente más lento en red
  y/o CPU que esta máquina local, o compartir recursos.
- El ~4,58s/símbolo del enunciado podría incluir trabajo que
  `runMaterializedScan` **no** hace por símbolo, sino por lote o después:
  `writeMaterializedScan`, `writeScanSymbolHistory`, backoff/reintentos no
  implementados hoy (ver `bench-concurrencia` D.1-D.2) pero que sí podrían
  estar activos en otra capa, o simplemente dividir tiempo total del job
  (incluyendo colas, checkout, etc.) entre símbolos.
- El universo relevante real (~880, ~11.123) incluye mercados no-US (HK,
  AU, etc.) que pueden disparar proveedores más lentos o de fallback
  (p. ej. `fetchAsicShortInterest` para AU) — esta corrida usó solo
  símbolos US, que no los ejercitan.
- Nunca se disparó un fallback de proveedor (0 errores de red en 120
  peticiones de este benchmark + 150 de `bench-concurrency.mjs`) — el
  costo de un fallback (Stooq, Alpha Vantage) no está representado aquí.

**Por diseño y honestidad de esta tarea: no se fuerza una conclusión de "el
cómputo domina" solo porque la tarea lo daba por sentado.** Los datos
medidos aquí muestran que, para el camino feliz (sin fallback, sin
reintentos, símbolos US, sin caché) tanto la red como el cómputo son
rápidos en términos absolutos, y ninguno de los dos explica por sí solo un
escaneo de ≈4,58s/símbolo.

### D.2 — ¿Ayudaría un runner con más núcleos?

Con los datos disponibles: **no hay evidencia de que este workload
concreto esté limitado por CPU**, así que no se puede argumentar que más
núcleos ayudarían — pero tampoco se puede descartar, porque no se
reprodujo el escenario de 4,58s/símbolo que la pregunta busca explicar.

Lo que sí se midió: CPU del proceso Node vía `process.cpuUsage()` en la
corrida de concurrencia 8 — user 642,3ms + system 59,8ms = 702,0ms de CPU
consumida en 1,33s de tiempo total (`totalMs`). Eso es **~53% de la
capacidad de un solo núcleo** durante la corrida (702ms CPU / 1.330ms wall
≈ 0,528), sin saturar ni siquiera 1 de los 4 vCPU que documentan los
runners estándar de GitHub Actions, y muy lejos de saturar los 4.

**Lo que se sabe:**
- Node.js es single-threaded para JS (el cómputo de `buildResearchRow` no
  se paraleliza entre símbolos salvo por el propio event loop intercalando
  I/O); `mapLimit` paraleliza las *esperas* de red entre símbolos
  concurrentes, no el cómputo puro.
- En esta medición, ni siquiera 1 núcleo se satura — así que, **para este
  workload medido**, más núcleos de los que ya tiene el runner estándar
  (4 vCPU) no parecen ser el cuello de botella.

**Lo que NO se sabe:**
- Si el verdadero cuello de botella detrás del 4,58s/símbolo del enunciado
  es CPU, red, I/O de Supabase, u otra cosa — no se reprodujo ese número
  aquí, así que no se puede decir si un runner con más núcleos lo
  resolvería.
- Cómo escala el cómputo de `buildResearchRow` bajo concurrencias mucho
  más altas que 8 (miles de símbolos en paralelo agotando el event loop) —
  no medido, y la tarea prohibía superar concurrencia 8.
- El comportamiento real del runner de GitHub Actions (CPU compartida,
  *noisy neighbors*, throttling) — esta corrida fue en una máquina local,
  no en un runner de Actions.

---

## CONFIANZA

- **Alta**: los 4 rendimientos totales (10,50 / 14,99 / 19,26 / 22,62
  símb/s) son mediciones directas contra la función real de producción
  (`runMaterializedScan` → `analyzeOne` → `buildResearchRow` con las 18
  señales, cobertura y contradicciones incluidas), sin caché, sin
  escritura a Supabase (verificado por lectura de código, no solo por
  ausencia de errores), 0 errores 429/5xx en 120 peticiones nuevas
  (+150 de la medición anterior = 270 totales sin incidentes).
- **Alta**: que `analyzeOne` y las funciones que usa no están exportadas
  (A.3), y que la vía usada (`runMaterializedScan` con `symbols`
  explícitos) es código de producción real, no una aproximación — está
  verificado por lectura directa del código y confirmado porque el propio
  repo ya usa este mismo patrón en sus tests.
- **Alta**: la comparación red-vs-cómputo de la Parte D.1 (~18ms/símbolo de
  diferencia a concurrencia 8) es aritmética directa sobre las dos
  mediciones reales (esta y la anterior).
- **Media**: los cálculos de "cuántos símbolos caben en 6h" y "cuánto
  tardarían los universos" (Parte C) son extrapolaciones lineales desde
  ráfagas de 1,3-2,9 segundos — aritmética simple sobre datos reales, pero
  no una medición de comportamiento sostenido.
- **Baja / no verificado**: por qué esta medición (~44ms/símbolo en el
  camino feliz) no se parece en nada a los ≈4,58s/símbolo que describe la
  tarea para el escaneo real. Ver D.1 y la lista de "LO QUE NO HE
  VERIFICADO".

## LO QUE NO HE VERIFICADO

- **Por qué el escaneo real reportado tarda ≈4,58s/símbolo.** Esta es la
  brecha más importante de todo el documento: no se pudo reproducir ni
  explicar con los datos disponibles. Candidatas enumeradas en D.1, ninguna
  confirmada.
- **Comportamiento bajo carga sostenida.** Cada corrida duró entre 1,3 y
  2,9 segundos. No hay medición de minutos/horas de concurrencia 8
  mantenida — el escenario real de un escaneo de miles de símbolos.
- **Concurrencias por encima de 8.** Prohibido explícitamente por la tarea.
- **Comportamiento con símbolos no-US** (HK, AU, etc.) que puedan disparar
  proveedores de fallback más lentos (`fetchAsicShortInterest` para AU,
  Stooq/Alpha Vantage si Yahoo falla) — los 30 símbolos de esta corrida son
  todos US y ninguno disparó fallback.
- **El costo real de `writeMaterializedScan`, `writeScanSymbolHistory`,
  `writeScanBatchCursor` y `refreshDefaultLeaderboards`** sobre 11.123
  filas — deliberadamente no ejecutados (la tarea prohibía escribir en
  Supabase), así que el presupuesto de minutos de la Parte C.3 **no**
  incluye ese costo.
- **El hardware/red real de un runner de GitHub Actions** — esta corrida
  se ejecutó en una máquina local, no en un runner de Actions; el dato de
  "4 vCPU en runners estándar" citado en D.2 es el que da la propia tarea,
  no algo que este benchmark haya medido directamente.
- **El overhead de arranque de un job de GitHub Actions** (checkout,
  `npm ci`, etc.) — no medido, no incluido en el presupuesto de minutos.
- **El overhead de Vitest en sí** (~0,4-1s de `transform`/`import` visibles
  en cada corrida) se excluyó deliberadamente del `Tiempo total` usado para
  los cálculos de la Parte C (se usó `totalMs`, medido estrictamente
  alrededor de `runMaterializedScan`, no `wallMs`) — porque el job real de
  producción no pasa por Vitest, arranca `runMaterializedScan` directo. Se
  reporta igualmente `wallMs` en cada corrida por transparencia.
- **Variabilidad por hora del día / carga de Yahoo** — igual que en el
  documento anterior, las 4 corridas se hicieron en una ventana de minutos.

**Decisión que queda pendiente, tal como en el documento anterior**:
cualquier concurrencia por encima de 8 requiere medición nueva y aprobada
por un humano. Adicionalmente, **la brecha entre esta medición
(~44ms/símbolo) y el ≈4,58s/símbolo del enunciado de la tarea necesita
investigación separada** antes de tomar cualquier decisión de
dimensionamiento del job real — este documento no la explica, solo la
señala.
