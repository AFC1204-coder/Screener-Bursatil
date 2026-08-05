# Por qué el cron procesa 12-24 símbolos por noche — 2026-08-04

BASE_SHA: a80caf2 · rama codex/statsedge-ui-polish.

Corrige y complementa [docs/universo-efectivo-2026-08-04.md](universo-efectivo-2026-08-04.md)
y [docs/universo-relevante-2026-08-04.md](universo-relevante-2026-08-04.md)
(**no se modifican**, solo se señala qué corregir) usando datos reales de
producción (`provider_runs`, `scans`) cruzados con el benchmark de
[docs/bench-analyze-2026-08-04.md](bench-analyze-2026-08-04.md). No se
escribió nada en Supabase, no se ejecutó el cron, no se cambió ninguna
configuración.

---

## PARTE A — El coste real de una corrida completa

### A.1 — Duración real por corrida, medida en `provider_runs`

**Corrección de partida sobre dónde vive el timestamp:** la tarea suponía
`startedAt`/`updatedAt`/`finishedAt` dentro de `scans.settings.progress`.
Comprobado por consulta: eso solo existe para escaneos **interactivos**
(`preset: "balanced"`, motor de progreso de `app/api/scan/route.js`). Los
escaneos del cron (`preset: "materialized-cache"`, `source:
"jobs/scan-refresh"`) usan `materializedScanProgress()`
([lib/materializedScanner.js:1657-1670](../lib/materializedScanner.js)), que
**solo** trae `{status, completed, total, saved, errors, finishedAt,
percentilesFinalized}` — sin `startedAt`. Consulta que lo demuestra:

```
supabase_query table=scans select=settings order=created_at.desc limit=1
```

El timestamp de inicio real del cron vive en `provider_runs.started_at`
(escrito por `createRun(options)`,
[app/api/cron/scan-refresh/route.js:130-149](../app/api/cron/scan-refresh/route.js),
llamado **antes** de `runMaterializedScan`), y el de fin en
`provider_runs.finished_at` (escrito por `finishRun`,
[app/api/cron/scan-refresh/route.js:153-169](../app/api/cron/scan-refresh/route.js),
llamado en el bloque `try` de éxito o en el `catch`). No hace falta cruzar
con `scans` para esto — `provider_runs` ya trae ambos timestamps y, en
`stats.selected`, el número de símbolos procesados. Consulta exacta usada:

```
mcp__supabase-readonly__supabase_query
  table=provider_runs
  select=id,market,status,started_at,finished_at,stats
  filter=run_type=eq.cron-scan-refresh
  order=started_at.desc
  limit=20
```

**18 corridas `completed`** (se excluyen 3 con `status:"started"` y
`finished_at:null` — nunca terminaron; ver D.1, es un hallazgo, no ruido) en
la ventana 2026-07-13 → 2026-08-03:

| Grupo | Fecha | `started_at` → `finished_at` | Duración | `selected` |
|---|---|---|---|---|
| core-us-hk-au | 2026-07-30 | 23:07:44.410797 → 23:08:33.855 | 49,44s | 12 |
| asia-taiwan | 2026-08-03 | 23:07:44.00855 → 23:08:30.705 | 46,70s | 20 |
| europe-secondary | 2026-08-01 | 23:07:44.07926 → 23:08:21.862 | 37,78s | 19 |
| europe-priority | 2026-07-31 | 23:07:44.24847 → 23:08:25.773 | 41,53s | 24 |
| asia-japan | 2026-08-02 | 23:07:44.267255 → 23:08:35.737 | 51,47s | 24 |
| north-america-canada | 2026-07-26 | 22:39:10.820481 → 22:39:55.533 | 44,71s | 24 |
| asia-singapore-africa | 2026-07-27 | 22:41:15.899272 → 22:42:00.252 | 44,35s | 24 |
| asia-taiwan | 2026-07-25 | 22:39:10.909999 → 22:40:01.583 | 50,67s | 20 |
| asia-japan | 2026-07-24 | 22:56:33.274675 → 22:57:15.923 | 42,65s | 24 |
| europe-secondary | 2026-07-23 | 23:03:45.898481 → 23:04:35.108 | 49,21s | 21 |
| europe-priority | 2026-07-22 | 23:03:45.437234 → 23:04:25.77 | 40,33s | 24 |
| core-us-hk-au | 2026-07-21 | 23:03:45.732959 → 23:04:14.94 | 29,21s | 12 |
| asia-singapore-africa | 2026-07-19 | 23:03:45.592479 → 23:04:39.963 | 54,37s | 24 |
| north-america-canada | 2026-07-18 | 23:03:45.931451 → 23:04:29.033 | 43,10s | 24 |
| asia-taiwan | 2026-07-17 | 23:03:45.846121 → 23:04:37.806 | 51,96s | 20 |
| asia-japan | 2026-07-15 | 23:07:00.882552 → 23:07:42.344 | 41,46s | 24 |
| europe-secondary | 2026-07-14 | 23:07:01.058149 → 23:07:39.324 | 38,27s | 19 |
| europe-priority | 2026-07-13 | 21:43:42.151303 → 21:44:36.394 | 54,24s | 24 |

**Medido, agregado:** Σduración = 811,46s, Σ`selected` = 383 símbolos →
**2,118s/símbolo (wall-clock real, promedio simple)**.

Esto usa `selected` (símbolos que `analyzeOne` procesó de verdad, pasen o
no el filtro de política) como denominador, no `savedRows`
(`row_count`/filas que además pasaron `screenerFilters` y se guardaron) —
`selected` es la base correcta porque es el número de veces que se ejecutó
el trabajo caro (`analyzeOne`), independientemente de si el resultado se
guardó.

### A.2 — Comparación con el bench: ¿cuánto del tiempo real NO es análisis?

El bench de `runMaterializedScan` a concurrencia 2, sin caché, sin escribir
en Supabase, midió **0,095s/símbolo**
([docs/bench-analyze-2026-08-04.md](bench-analyze-2026-08-04.md), B.2).
Producción real, misma concurrencia (2, ver B.6 más abajo), mide
**2,118s/símbolo**. La diferencia bruta es **≈2,02s/símbolo que NO es
`analyzeOne` puro** — pero repartir esa diferencia por igual entre todos
los símbolos es engañoso, porque una parte importante del tiempo de una
corrida **no depende de cuántos símbolos se analizan**. Para separar ambas
cosas se ajustó una regresión lineal simple `duración = a + b·N` sobre las
18 corridas de A.1 (N = `selected`):

```
Σselected = 383, ΣDuración = 811,46
ΣN² = 8.411, ΣN·D = 17.406,01
b = (18·17406,01 − 383·811,46) / (18·8411 − 383²) = 2519,44 / 4709 ≈ 0,535 s/símbolo
a = 45,081 − 0,535·21,278 ≈ 33,7 s
```

**Cálculo derivado** (aritmética directa sobre los datos medidos de A.1, no
una medición independiente): `duración ≈ 33,7s fijo + 0,535s por símbolo
adicional`. Es decir, de los ~45s medios que dura una corrida, **~34s no
dependen de cuántos símbolos se analizan** (overhead fijo por invocación) y
solo ~0,5s/símbolo es coste marginal — todavía ~5,6× más que el 0,095s/símbolo
del bench, pero muy lejos de ser el factor dominante que sugiere el
promedio simple de 2,12s/símbolo.

**Qué explica el overhead fijo (~34s), leído directamente en el código —
esto NO se puede medir sin logs de producción que no tengo, así que es una
hipótesis fundamentada en lectura de código, marcada como tal**:

1. **`getUniverseEngineSnapshot` con clave de caché que nunca coincide.**
   `resolveSymbols` (sin `symbols` explícitos, la rama que usa el cron) llama
   `getUniverseEngineSnapshot({ markets, maxAgeHours: options.universeMaxAgeHours || 24 })`
   ([lib/materializedScanner.js:1226-1231](../lib/materializedScanner.js))
   con `markets = group.markets` — p. ej. `["TW"]` solo, o `["US","HK","AU"]`.
   La clave de caché es
   ```js
   function cacheKey(markets = []) {
     const normalized = normalizeMarkets(markets).sort().join(",");
     const signature = universeSourceSignature(markets);
     return `universe:${normalized}${signature ? `|${signature}` : ""}`;
   }
   ```
   ([lib/universeEngine.js:60-64](../lib/universeEngine.js)). El cron
   `cron-universe-refresh` (que sí puebla la caché) siempre escribe con
   `CRON_UNIVERSE_MARKETS = ["US","HK","AU","JP","TW","CA","SG","ZA"]`
   ([lib/cronPlan.js:18](../lib/cronPlan.js)) — una clave `universe:AU,CA,HK,...`
   con los 8 mercados juntos. Ningún grupo de `SCAN_CRON_GROUPS` pide esos 8
   mercados a la vez (el más grande, `core-us-hk-au`, pide solo 3). **La
   clave de caché de cada corrida del cron de scan-refresh nunca coincide
   con la clave que escribió `cron-universe-refresh`** →
   `readSupabaseSnapshot` devuelve `null` → sin `allowCuratedFallback`
   (no se pasa, es `false` por defecto), cae a
   ```js
   const snapshot = await buildUniverse(normalizedMarkets);
   ```
   ([lib/universeEngine.js:446](../lib/universeEngine.js)), que hace, **de
   forma secuencial** (`for...of`, no paralelo, no gobernado por el
   parámetro `concurrency`):
   ```js
   async function buildUniverse(markets = []) {
     const raw = [];
     for (const market of normalizedMarkets) {
       const rows = await getUniverse(market);
       raw.push(...rows.map((row) => normalizeEntry(row, market)));
     }
     /* ... */
   }
   ```
   ([lib/universeEngine.js:221-231](../lib/universeEngine.js)) — una
   descarga y parseo real por mercado (NasdaqTrader para US, HKEX Full List
   para HK, ASIC short position reports para AU, TWSE ISIN para TW, etc.).
   **Confirmado en los datos**: todas las corridas de A.1 muestran
   `"cache": {"hit": false, "status": "supabase", "written": true}` en
   `provider_runs.stats.cache` — nunca `"hit": true` salvo una excepción
   (US,HK,AU 2026-07-21, que si tuvo `hit:true` — probablemente porque una
   corrida previa de ese MISMO grupo, minutos/horas antes, ya había escrito
   una snapshot con esa clave concreta de 3 mercados, y esa sí estaba dentro
   de `maxAgeHours`). Esto es consistente con: cada grupo reconstruye su
   propio universo desde cero en la inmensa mayoría de sus corridas, en vez
   de reusar la snapshot diaria de `cron-universe-refresh`.
2. **`readRecentlyScannedSymbols`, lectura paginada de hasta 5.000 filas.**
   Con `prioritizeMaterialization !== false` (el cron no lo desactiva, así
   que es `true` por defecto), `resolveSymbols` llama
   `readRecentlyScannedSymbols({...options, markets})`
   ([lib/materializedScanner.js:1233-1249](../lib/materializedScanner.js)),
   que hace:
   ```js
   const rows = await supabaseRequestAll("scan_results", {
     query: `owner_id=eq.${...}&created_at=gte.${since}&select=symbol,country,created_at,total_score,metrics&order=created_at.desc`,
   }, { maxRows });
   ```
   ([lib/materializedScanner.js:1131-1135](../lib/materializedScanner.js))
   con `lookbackDays` de hasta 90 (`DEFAULT_MATERIALIZATION_LOOKBACK_DAYS`,
   [lib/materializedScanner.js:67](../lib/materializedScanner.js)) y
   `maxRows` de hasta 5.000 (`DEFAULT_RECENT_SCAN_MAX_ROWS`,
   [lib/materializedScanner.js:61](../lib/materializedScanner.js)).
   `supabaseRequestAll` pagina de 1.000 en 1.000, **secuencialmente**
   ([lib/supabaseServer.js:98-112](../lib/supabaseServer.js)): hasta 5
   peticiones HTTP a PostgREST, una tras otra, antes de analizar el primer
   símbolo.
3. Ninguno de los dos puntos anteriores está gobernado por `concurrency` —
   `concurrency` solo se aplica a `mapLimit(resolved.symbols, concurrency,
   analyzeOne)` ([lib/materializedScanner.js:1680](../lib/materializedScanner.js)).
   Subir la concurrencia no acelera ni (1) ni (2).

**No puedo aislar cuánto de los ~34s corresponde a (1) frente a (2)**, ni
descartar arranque en frío de la función serverless como componente
adicional — no tengo logs de producción ni acceso a trazas de Vercel. Esto
queda como hipótesis fundamentada por lectura de código y por el patrón
`cache.hit:false` casi universal en los datos, no como medición directa.

### A.3 — Coste de las escrituras: acotado, no medido

**No se midió directamente** (la tarea prohibía escribir en Supabase, y
medirlo sin escribir de verdad —o sin logs de producción con desglose por
fase— no es posible). Se acota por lectura de código, contando cuántas
peticiones a Supabase hace el camino de escritura, y por lo que dice A.2
sobre el tamaño del overhead fijo total:

- `writeMaterializedScan` ([lib/materializedScanner.js:1607-1641](../lib/materializedScanner.js)):
  1 upsert a `scans`, 1 `DELETE` a `scan_results` por `scan_id`, y despues
  1 `POST` de inserción por cada bloque de 300 filas — con `savedRows` ≤ 24
  en todas las corridas de A.1, es **siempre 1 sola petición de inserción**
  (nunca se llega a 300). Total: **3 peticiones**, tamaño de payload
  pequeño (≤24 filas).
- `writeScanSymbolHistory` ([lib/scanHistory.js:176-...](../lib/scanHistory.js)):
  1 llamada RPC (`scan_symbol_history_latest_v1`) + la escritura de las
  observaciones (no se leyó el resto de la función a fondo, pero el punto
  de entrada ya es al menos 1 RPC + 1 escritura).
- `writeScanBatchCursor` y la escritura de rotación (`writeRotation`):
  2 escrituras pequeñas a `app_settings` (upsert de una fila JSON cada
  una).
- `createRun` + `finishRun`: 1 `INSERT` + 1 `PATCH` a `provider_runs`.

**Total estimado de peticiones de ESCRITURA por corrida: ~8-9**, todas de
tamaño pequeño (≤24 filas o una fila JSON), no proporcionales al número de
símbolos analizados dentro del rango 12-24 que maneja el cron hoy. Por
tamaño y cantidad, es poco plausible que expliquen por sí solas los ~34s de
overhead fijo de A.2 — los candidatos de A.2 (universo reconstruido desde
cero, lectura de hasta 5.000 filas de `scan_results`) son lecturas de
volumen mucho mayor y más plausibles como causa principal. Esto es una
**acotación por descarte, no una medición** — no tengo forma de medir el
tiempo real de cada petición sin instrumentar el código o acceder a logs.

---

## PARTE B — De dónde salen los límites

### B.4 — Valores exactos

`SCAN_CRON_GROUPS`, [lib/cronPlan.js:20-68](../lib/cronPlan.js):

| `key` | `markets` | `limit` | `perMarket` |
|---|---|---|---|
| core-us-hk-au | US, HK, AU | 12 | 4 |
| europe-priority | EU1 | 24 | 3 |
| europe-secondary | EU2 | 21 | 3 |
| asia-japan | JP | 24 | 24 |
| asia-taiwan | TW | 20 | 20 |
| north-america-canada | CA | 24 | 24 |
| asia-singapore-africa | SG, ZA | 24 | 12 |

`SHADOW_EUROPE_CRON_GROUPS`, [lib/cronPlan.js:70-104](../lib/cronPlan.js)
(cron distinto, `shadow-europe-refresh`, no es el mismo pipeline que
`SCAN_CRON_GROUPS` aunque también acaba en `runMaterializedScan`):

| `key` | `markets` | `resolvePerMarket` | `pricePerMarket` | `scanPerMarket` | `scanLimit` |
|---|---|---|---|---|---|
| shadow-europe-uk | GB | 3 | 6 | 6 | 18 |
| shadow-europe-nordics | FI, DK, NO, SE | 3 | 6 | 6 | 24 |
| shadow-europe-west | DE, FR, NL | 3 | 6 | 6 | 24 |
| shadow-europe-south | IT, ES | 3 | 6 | 6 | 18 |

Endpoint manual `app/api/jobs/scan-refresh/route.js:18-22`:

```js
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const DEFAULT_PER_MARKET = 10;
const MAX_CONCURRENCY = 4;
```

y `concurrency: numberParam(searchParams, "concurrency", 2, 1, MAX_CONCURRENCY)`
([app/api/jobs/scan-refresh/route.js:83](../app/api/jobs/scan-refresh/route.js)).

Endpoint del cron `app/api/cron/scan-refresh/route.js:188-189`:

```js
const limit = numberParam(searchParams, "limit", group.limit, 1, Math.min(group.limit, 80));
const perMarket = numberParam(searchParams, "perMarket", group.perMarket, 1, Math.min(group.perMarket, 25));
```

y `concurrency: numberParam(searchParams, "concurrency", 2, 1, 3)`
([app/api/cron/scan-refresh/route.js:184](../app/api/cron/scan-refresh/route.js)).
`maxSavedRows: 500` fijo, sin parámetro de override, en las mismas líneas
del bloque `options` del cron.

### B.5 — Historial de git: cuándo se fijaron, con qué mensaje

```
git log --oneline --follow -- lib/cronPlan.js
```

```
2fdedc3 fix(cron): re-validar priced shadow (corrige filtro status=eq.resolved en ambos crons) + sube pricePerMarket 8 → 20
cc72b7d feat(cron): añade shadow-firds-refresh con rotación de 8 cohortes ESMA (8 días/ciclo)
bee6dfc fix(cron): excluye mercados FIRDS de universe-refresh para evitar timeout
45a9a5b Polish screener filters and RS research UX
```

`SCAN_CRON_GROUPS` con sus valores actuales (`limit`/`perMarket` de la
tabla de B.4) se creó **entero en el primer commit** que introdujo
`lib/cronPlan.js`, `45a9a5b7b021f71a72e546fad74269935f9c8dfc` ("Polish
screener filters and RS research UX", 2026-05-26), confirmado con
`git show 45a9a5b -- lib/cronPlan.js`. **El mensaje de commit no tiene
cuerpo** (`git show -s --format="%B" 45a9a5b` devuelve solo el título) y el
diff no incluye ningún comentario junto a `SCAN_CRON_GROUPS` que justifique
los números 12/24/21/24/20/24/24 — a diferencia de `SHADOW_EUROPE_CRON_GROUPS`
y `SHADOW_FIRDS_CRON_GROUPS`, que sí acumularon comentarios extensos
justificando sus números en commits posteriores (`2fdedc3`, `cc72b7d`,
`bee6dfc` — ver los comentarios citados en B.4 del propio
`lib/cronPlan.js`, líneas 3-16 y 106-127).

**Ningún commit posterior tocó los números de `SCAN_CRON_GROUPS`** — la
lista de 4 commits de arriba es el historial completo del archivo, y los 3
commits posteriores a `45a9a5b` solo tocan los grupos `SHADOW_*`. **No hay
evidencia de que los valores de `SCAN_CRON_GROUPS` se bajaran nunca tras un
incidente** — nunca se tocaron, ni al alza ni a la baja, desde su creación.

### B.6 — ¿Está topada la concurrencia? Sí, en dos sitios distintos

- Cron: `numberParam(searchParams, "concurrency", 2, 1, 3)` — techo **3**
  ([app/api/cron/scan-refresh/route.js:184](../app/api/cron/scan-refresh/route.js)).
  Todas las corridas medidas en A.1 usaron el valor por defecto (**2**), no
  hay evidencia en `provider_runs.stats` de que se haya pedido nunca
  `concurrency=3` en el cron real.
- Endpoint manual: techo **4** (`MAX_CONCURRENCY`,
  [app/api/jobs/scan-refresh/route.js:22,83](../app/api/jobs/scan-refresh/route.js)).

`numberParam` hace `Math.min(Math.max(value, min), max)`
([app/api/cron/scan-refresh/route.js:21-25](../app/api/cron/scan-refresh/route.js)
y homólogo en el endpoint): **pedir más no da error, se recorta
silenciosamente** al techo (3 o 4 según el endpoint) sin ningún aviso en la
respuesta ni en `provider_runs.stats`.

**Hallazgo adicional, no pedido explícitamente pero relevante para B.4-B.6:**
el techo de `limit` en el cron —
`Math.min(group.limit, 80)` — es **igual al propio `group.limit`** para los
7 grupos (todos <80). Esto significa que el parámetro `?limit=` del cron
**nunca puede subir** el número de símbolos por encima del valor hardcodeado
en `SCAN_CRON_GROUPS` — solo puede bajarlo. Subir de verdad el límite del
cron requiere editar `lib/cronPlan.js`, no un parámetro de query en runtime.

---

## PARTE C — Cuánto cabría de verdad

**Con el tiempo real de A.2, no con el del bench**, y `maxDuration=60`
([app/api/cron/scan-refresh/route.js:13](../app/api/cron/scan-refresh/route.js)),
20% de margen (presupuesto de trabajo = 60×0,8 = 48s):

**Método 1 — ingenuo** (todo el tiempo escala igual, `2,118s/símbolo`
medido a concurrencia 2, asumiendo que escala como `1/concurrencia`, la
misma asunción que usaban los documentos previos):

| Concurrencia | s/símbolo derivado | Símbolos/invocación (48s ÷ s/símbolo) |
|---|---|---|
| 2 | 2,118 | 22 |
| 4 | 1,059 | 45 |
| 8 | 0,530 | 90 |

**Método 2 — con overhead fijo separado** (usa la regresión de A.2:
~33,7s fijos que **no** dependen de la concurrencia porque no pasan por
`mapLimit` — ver A.2 punto 3 —, más 0,535s/símbolo marginal a concurrencia
2, escalando el marginal como `1/concurrencia`):

```
presupuesto_para_análisis = 48s − 33,7s ≈ 14,3s
```

| Concurrencia | s/símbolo marginal derivado | Símbolos/invocación (14,3s ÷ s/símbolo) |
|---|---|---|
| 2 | 0,535 | 26 |
| 4 | 0,268 | 53 |
| 8 | 0,134 | 106 |

**Ambos son cálculos derivados, no mediciones** — no existe ningún dato
real de producción a concurrencia 4 u 8 (todas las 18 corridas de A.1 son a
concurrencia 2, el valor por defecto). El Método 2 es más defendible porque
separa explícitamente el overhead que el código muestra que **no** escala
con concurrencia, pero su proyección a concurrencia 4/8 sigue asumiendo
escalado lineal perfecto del componente marginal, algo que
[docs/bench-analyze-2026-08-04.md](bench-analyze-2026-08-04.md) **contradice
directamente**: el propio bench, corriendo `analyzeOne` real, midió un
salto de solo **2,15×** (22,62 ÷ 10,50 símb/s) al subir la concurrencia
**4×** (de 2 a 8) — muy por debajo del 4× lineal que asume el Método 2. Si
esa misma pérdida de eficiencia se aplica al componente marginal de
producción, el número real a concurrencia 8 estaría más cerca de
`14,3 ÷ (0,535/2,15) ≈ 57` que de 106. **Ninguno de estos tres números
(90, 106, 57) está verificado** — son extrapolaciones con distintos
supuestos, no mediciones.

**Símbolos/invocación con el valor que corre HOY en producción
(concurrencia=2, confirmado en B.6): entre 22 (Método 1) y 26 (Método 2)**
— consistente en orden de magnitud con los 12-24 que fija `SCAN_CRON_GROUPS`
(B.4), y notablemente cercano al ≈26 que ya citaban los documentos previos
(aunque, como se explica en la Parte D, este documento llega a esa cifra
por una vía distinta y más verificable).

### C.8 — Noches para cubrir el universo relevante y el elegible

Usando el rango del Método 2 a concurrencia 2 (26/noche, lo que corre hoy)
y Método 1 (22/noche) como cota inferior, **asumiendo 1 invocación/noche
dedicada por completo a cubrir universo nuevo** (simplificación pedida por
la tarea — en la práctica el cron rota entre 7 grupos de mercado, ver
matiz más abajo):

| | 22/noche (Método 1) | 26/noche (Método 2) |
|---|---|---|
| Universo relevante (~880) | 40 noches | 34 noches |
| Universo elegible (11.123) | 506 noches (≈1,39 años) | 428 noches (≈1,17 años) |

**Matiz que esta cifra simplificada esconde** (ya explorado con más detalle
en `docs/universo-relevante-2026-08-04.md` B6, que este documento no
modifica): el cron no dedica una invocación/noche a "cubrir universo
nuevo" en general — rota entre los 7 grupos de `SCAN_CRON_GROUPS`, cada uno
con su propio cursor por mercado, así que la cobertura real de US/HK (los
mercados más grandes) depende de `perMarket:4` del grupo `core-us-hk-au`,
no de estas 26 símbolos/noche promedio. Esta tabla responde a la pregunta
literal de la tarea (símbolos/invocación × noches), no sustituye el
análisis por mercado ya hecho en el documento previo.

### C.9 — Qué corrige esto de los documentos previos

`docs/universo-efectivo-2026-08-04.md` B5 mide `duración × concurrencia(2)
÷ selected = 4,58s/símbolo` y lo llama "s/símbolo". **Verificado
recalculando sus mismas 7 corridas**: esa cifra es exactamente el doble del
tiempo real por símbolo (wall-clock) porque multiplica por la concurrencia.
P. ej. su fila "core-us-hk-au, 49,44s, 12 símbolos → 8,24s/símbolo" es en
realidad `49,44/12=4,12s` de tiempo real, `×2` (concurrencia) `=8,24`.
**Importante — esto NO invalida su cifra final de ~26 símbolos/invocación**
(su fórmula `60×2/4,58≈26`): la concurrencia se cancela algebraicamente
(`60×concurrencia / (duración×concurrencia/N) = 60×N/duración`), así que su
resultado final coincide en magnitud con el Método 1 de este documento (22,
usando el promedio de 18 corridas en vez de sus 7) — la etiqueta
"s/símbolo" de esa cifra intermedia es confusa/incorrecta (es en realidad
segundos-trabajador, no tiempo real por símbolo), pero el número final de
símbolos/invocación no estaba mal por eso.

**Lo que sí queda corregido por este documento:**
1. **El origen del techo no es (solo) el tiempo de `analyzeOne`.** Los
   documentos previos asumían implícitamente que 4,58s "por símbolo" era
   todo trabajo de análisis. La Parte A.2 de este documento muestra que
   ~34 de los ~45s medios de una corrida son overhead FIJO por invocación
   (reconstrucción del universo, lectura de símbolos recientes) que no
   escala con el número de símbolos ni se acelera con concurrencia — el
   coste de análisis real, ajustado, es de solo ~0,5s/símbolo, no ~2,3s.
2. Por tanto, **subir la concurrencia por sí sola tiene mucho menos
   recorrido del que sugería `docs/escaneo-github-actions-2026-08-04.md`
   sección 9** (que multiplicaba 11.123×4,58s/concurrencia sin descontar
   ningún overhead fijo): con overhead fijo constante, el techo de
   símbolos/invocación crece sublinealmente con la concurrencia (Método 2:
   26→53→106 en vez de escalar 2×/4× limpio), y el propio bench muestra que
   ni siquiera el componente de análisis puro escala linealmente (2,15× no
   4× de 2 a 8).
3. `docs/universo-relevante-2026-08-04.md` C7/C8 usa "~26 símbolos/invocación"
   como techo — sigue siendo, por casualidad de la cancelación algebraica
   explicada arriba, un número defendible (este documento llega a 22-26 por
   una vía independiente), pero su justificación ("4,58s/símbolo medido")
   describe mal qué se está midiendo. La cifra sobrevive; su explicación no.

---

## PARTE D — Qué bloquea de verdad

### D.10 — Si no es el tiempo de análisis, ¿qué es?

**Evidencia directa en producción, no solo lectura de código:** de las 21
corridas `run_type=cron-scan-refresh` en la ventana consultada, **3 quedaron
en `status:"started"` con `finished_at:null` para siempre** — nunca
llegaron al `catch` del endpoint (que sí escribe `status:"failed"` con
`finished_at` — [app/api/cron/scan-refresh/route.js:280-283](../app/api/cron/scan-refresh/route.js)),
lo que indica que el proceso serverless fue matado externamente a mitad de
ejecución (consistente con un timeout duro de `maxDuration=60`, no con una
excepción capturada por el propio código). Consulta:

```
mcp__supabase-readonly__supabase_query
  table=provider_runs
  select=id,market,status,started_at,finished_at
  filter=run_type=eq.cron-scan-refresh&status=eq.started
  order=started_at.desc
```

```
2784ac5a  US,HK,AU  started_at=2026-07-28T22:41:16Z  finished_at=null
cfaa14f2  US,HK,AU  started_at=2026-07-20T23:03:45Z  finished_at=null
a156d152  US,HK,AU  started_at=2026-07-13T19:33:56Z  finished_at=null
```

**Las 3 corridas huérfanas son del mismo grupo: `core-us-hk-au`** — el que
combina 3 mercados grandes (US, HK, AU) y por tanto el que más tarda en
`buildUniverse()` cuando falla el caché de snapshot (A.2, punto 1). Es
también el grupo con el peor `s/símbolo` derivado en la tabla de A.1
(4,12s en su corrida más lenta completada, el doble que el resto). Esto es
**evidencia real, no solo hipótesis de código**, de que este grupo ya está
en el borde de `maxDuration=60` — probablemente ya lo ha cruzado varias
veces.

**Restricciones documentadas en el código, además del overhead de A.2:**

- `maxDuration=60` en el cron
  ([app/api/cron/scan-refresh/route.js:13](../app/api/cron/scan-refresh/route.js)) —
  confirmado como límite duro de Vercel Functions, no una config propia del
  proyecto.
- El endpoint manual (`app/api/jobs/scan-refresh/route.js`) **no declara
  `maxDuration`** — no encontré ningún `export const maxDuration` en ese
  archivo (`grep -rn "export const maxDuration" app/api/` lista 11 rutas,
  ninguna es `jobs/scan-refresh`). Usa el valor por defecto de la
  plataforma/Next.js para esta cuenta de Vercel — **no verificado en este
  documento** cuál es ese valor por defecto en este proyecto concreto.
- `maxSavedRows: 500` en el cron (B.4) — muy por encima de cualquier
  `selected` observado (12-24), no es un límite activo hoy.
- No se encontró ningún límite documentado de cuota del proveedor de datos
  (Yahoo) más allá de lo ya medido en
  [docs/bench-concurrencia-2026-08-04.md](bench-concurrencia-2026-08-04.md)
  (0 errores 429 hasta concurrencia 8, en ráfagas cortas) — no hay
  evidencia de que Yahoo sea el bloqueo real.
- No se encontró ningún límite de tamaño de payload ni de memoria
  documentado explícitamente en el código para esta ruta.

### D.11 — Qué pasaría si se sube `scanLimit`/`limit` a 200, sin más cambios

Razonado desde el código, **no probado**:

1. **Subir solo `limit` en `lib/cronPlan.js` puede no hacer nada.**
   `selectUniverseRows` reparte la selección entre `limit` (techo global) y
   `perMarket` (techo por mercado) —
   ([lib/materializedScanner.js:994-1104](../lib/materializedScanner.js), no
   reproducido entero aquí). Para `core-us-hk-au`, `perMarket:4` con 3
   mercados limita la selección real a 12 **aunque `limit` fuera 200** — hay
   que subir `perMarket` también para que `limit=200` tenga efecto.
2. **Si de verdad se seleccionan 200 símbolos, `analyzeOne` tardaría, por el
   Método 2 de la Parte C, ~34s fijos + 200×0,535s ≈ 141s** — muy por
   encima de `maxDuration=60`. La función sería matada por Vercel a mitad
   de `mapLimit`.
3. **El fallo sería total, no parcial.** `writeMaterializedScan` se llama
   **después** de que `runMaterializedScan` complete el `mapLimit` entero
   ([app/api/cron/scan-refresh/route.js:216-219](../app/api/cron/scan-refresh/route.js)) —
   si la función muere a mitad de análisis, no se ha escrito nada todavía
   (ni `scans`, ni `scan_results`, ni `scan_symbol_history`, ni el cursor).
   El resultado sería exactamente el patrón ya observado en D.10: una fila
   en `provider_runs` con `status:"started"` para siempre, cero símbolos
   guardados, y **el cursor no avanza** — la próxima corrida de ese grupo
   volvería a empezar desde el mismo `offset`, en vez de progresar.
4. Esto ya está pasando hoy con el grupo más pesado (`core-us-hk-au`, 3
   corridas huérfanas de D.10) con solo 12 símbolos objetivo — subir a 200
   lo agravaría en todos los grupos, no solo en el más grande.

### D.12 — Respuesta directa: ¿migrar a GitHub Actions, o subir límites del cron actual?

**Depende del objetivo, y ninguna opción es gratis tal como está el código
hoy:**

- **Si el objetivo es "procesar algo más de 12-24 símbolos/noche sin
  cambiar de arquitectura":** el cambio de mayor apalancamiento no es subir
  `scanLimit`, es **arreglar el desajuste de clave de caché de A.2 punto 1**
  (que `SCAN_CRON_GROUPS` pida la snapshot combinada de 8 mercados que ya
  escribe `cron-universe-refresh`, en vez de una clave por-grupo que nunca
  hace caché-hit) y acotar/paginar mejor `readRecentlyScannedSymbols` (A.2
  punto 2). Eso, por sí solo y sin tocar `concurrency` ni `limit`, podría
  recuperar buena parte de los ~34s fijos por invocación y dejar mucho más
  presupuesto real para análisis dentro del mismo `maxDuration=60` —
  **razonado, no medido**: no se puede cuantificar el ahorro exacto sin
  instrumentar el código.
- **Si el objetivo es cubrir de verdad el universo relevante (~880) o el
  elegible (11.123) en plazos de días, no de más de un año:** ni siquiera el
  Método 2 más optimista de la Parte C (106 símbolos/invocación a
  concurrencia 8, con overhead fijo ya descontado) se acerca — 11.123/106
  ≈ 105 noches solo en tiempo de invocación, sin contar que concurrencia 8
  en el cron actual **no es alcanzable** (techo real de 3, B.6) y que la
  propia medición del bench muestra escalado sublineal. La arquitectura de
  "una invocación corta por noche con overhead fijo de ~34s" no escala a
  ese tamaño de universo aunque se arregle el caché de A.2 — el
  presupuesto de tiempo (60s) es estructuralmente demasiado pequeño frente
  al overhead fijo no relacionado con símbolos. Para esa escala, el cambio
  de ventana de tiempo que ya exploran
  [docs/bench-analyze-2026-08-04.md](bench-analyze-2026-08-04.md) y
  [docs/escaneo-github-actions-2026-08-04.md](escaneo-github-actions-2026-08-04.md)
  (6h en vez de 60s) sigue siendo la vía estructuralmente necesaria — no
  porque `analyzeOne` sea lento (no lo es, 0,044-0,095s/símbolo medido),
  sino porque el overhead fijo por invocación (~34s) dejaría de ser
  relevante si una sola invocación puede cubrir el universo entero de una
  sentada en vez de repetirse cientos de noches.

**En una frase: arreglar el cron actual (caché de universo + lectura de
recientes) probablemente destape algo más de margen dentro de 12-24→~26-50
símbolos/noche sin migrar nada; pero para cubrir el universo relevante o
elegible en un plazo razonable, ninguna cantidad de ajuste de
`scanLimit`/`concurrency` dentro de un `maxDuration=60` resuelve el
problema — ahí sí hace falta el salto de ventana de tiempo que ofrece
GitHub Actions.**

---

## CONFIANZA

- **Alta**: los timestamps de `provider_runs` (A.1) son datos de
  producción reales, consultados directamente, sin transformación más allá
  de restar `finished_at − started_at` y dividir por `stats.selected`.
- **Alta**: la lectura de código de A.2 (clave de caché de universo,
  `readRecentlyScannedSymbols`, `buildUniverse` secuencial) — citada línea
  por línea, sin ambigüedad sobre qué hace el código.
- **Alta**: los valores exactos de `SCAN_CRON_GROUPS`/`SHADOW_EUROPE_CRON_GROUPS`
  y los techos de concurrencia (B.4, B.6) — leídos directamente del código
  vigente en `BASE_SHA=a80caf2`.
- **Alta**: el historial de git de `lib/cronPlan.js` (B.5) — comando
  ejecutado y verificado, solo 4 commits tocan el archivo, ninguno ajusta
  los números de `SCAN_CRON_GROUPS` tras su creación.
- **Alta**: las 3 corridas huérfanas de `core-us-hk-au` (D.10) — dato de
  producción directo, patrón (mismo grupo las 3 veces) demasiado
  específico para ser casualidad.
- **Media**: la regresión de A.2 (33,7s fijo + 0,535s/símbolo) — aritmética
  correcta sobre datos reales, pero son solo 18 puntos con ruido
  considerable (R² no calculado explícitamente; los residuos varían bastante,
  p. ej. europe-priority va de 40,3s a 54,2s para el mismo `limit`/`perMarket`).
  Es la mejor descomposición disponible con estos datos, no una medición
  directa de "cuánto tarda cada fase".
- **Media**: la atribución del overhead fijo a `buildUniverse()`/
  `readRecentlyScannedSymbols` específicamente (A.2) — coherente con el
  código y con el patrón `cache.hit:false`, pero sin logs de producción no
  puedo confirmar que sean estas dos fases y no arranque en frío u otra
  cosa no identificada.
- **Baja/no verificado**: las proyecciones de símbolos/invocación a
  concurrencia 4 y 8 (Parte C) — no hay ningún dato real de producción a
  esas concurrencias, y el propio bench demuestra que la asunción de
  escalado lineal es optimista.

## LO QUE NO HE VERIFICADO

- **Cuánto del overhead fijo (~34s) es `buildUniverse()`, cuánto es
  `readRecentlyScannedSymbols`, y cuánto es arranque en frío de la función
  serverless.** No tengo logs de producción con desglose por fase.
- **El coste real, en milisegundos, de las escrituras a Supabase por
  corrida (A.3).** Se acotó por número y tamaño de peticiones, no se midió
  tiempo de respuesta real de ninguna.
- **Si las 3 corridas huérfanas de D.10 son timeout de `maxDuration`
  específicamente**, frente a otra causa de muerte del proceso (OOM,
  despliegue en curso, error de red no capturado antes del `try`). Es la
  explicación más consistente con el código (el `catch` cubre excepciones
  JS normales) pero no es una confirmación directa — no tengo acceso a
  logs de Vercel.
- **El valor de `maxDuration` por defecto que aplica hoy al endpoint manual
  `app/api/jobs/scan-refresh/route.js`** (no declara uno explícito) — no
  verificado contra la configuración real de este proyecto en Vercel.
- **Si concurrencia 4 u 8 en el cron real produciría el escalado sublineal
  que muestra el bench, u otro patrón** — nunca se ha ejecutado el cron
  real a esas concurrencias (techo actual: 3).
- **Cuánto ahorraría en la práctica arreglar el desajuste de clave de
  caché de universo (D.12)** — razonado desde el código, no medido; no se
  ejecutó ningún cambio ni prueba.
- **Comportamiento bajo carga sostenida / distinta hora del día** — mismo
  caveat que los documentos de benchmark previos, no repetido en detalle
  aquí.

Preguntas de la tarea que quedan explícitamente sin cerrar: **cuánto pesa
cada fase individual del overhead fijo** (A.2) y **el coste exacto de cada
escritura a Supabase** (A.3) — ambas requieren instrumentación o acceso a
logs que no tengo en este entorno de solo lectura.
