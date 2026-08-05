> **CORREGIDO el 2026-08-04.** Las siguientes cifras de este
> documento han sido superadas por mediciones posteriores:
> - Universo elegible ≈8.998 → **11.123**, ver `universo-relevante-2026-08-04.md`.
> - ≈4,58 s/símbolo como tiempo real → **2,118 s/símbolo wall-clock** en 18 corridas; la descomposición disponible es ≈33,7 s fijos + ≈0,535 s marginales/símbolo, ver `limites-cron-2026-08-04.md`.
> - Techo de ≈26 símbolos/invocación como cifra puntual → **rango derivado de 22-26** a la concurrencia 2 actual; ≈26 sigue siendo la cota alta, no una medición directa, ver `limites-cron-2026-08-04.md`.
>
> El resto del documento sigue siendo válido.

# Por qué el universo efectivo de un escaneo es tan pequeño (auditoría 2026-08-04)

BASE_SHA: a80caf2 · rama codex/statsedge-ui-polish. Contexto ya verificado (no
se repite aquí): applyScreenerFilters no corre en los crons por falta de
options.screenerFilters; baseRejectReason no es fallo de proveedor; Vercel
Hobby limita maxDuration a 60s en rutas sin override explícito y crons con
ventana flexible de 1h.

---

## PARTE A — De dónde sale el universo

### A1. Dos caminos independientes: cron vs UI

**Camino cron (materialización nocturna).** Un único cron
(`vercel.json`, ver A3) golpea `app/api/cron/scan-refresh/route.js`, que
llama a `runMaterializedScan` (`lib/materializedScanner.js:1672`):

```
export async function runMaterializedScan(options = {}) {
  const markets = normalizeMarketList(options.markets?.length ? options.markets : DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  ...
  const resolved = await resolveSymbols({ ...options, markets });
  ...
  const analyzed = await mapLimit(resolved.symbols, Number(options.concurrency || DEFAULT_CONCURRENCY), (symbol) => analyzeOne(symbol, benchmarks, {...}));
  const passedBase = analyzed.filter((item) => item.ok).map((item) => item.row);
  const sectorized = sectorize(passedBase);
```
(`lib/materializedScanner.js:1672-1687`)

`resolveSymbols` (`lib/materializedScanner.js:1205-1281`) hace dos cosas:
1. Pide el snapshot completo del universo vía `getUniverseEngineSnapshot`
   (`lib/materializedScanner.js:1227`, definida en `lib/universeEngine.js:413`).
2. Recorta ese snapshot a un lote pequeño con `selectUniverseRows`
   (`lib/materializedScanner.js:994-1104`), que aplica `limit`, `perMarket` y
   `offset` recibidos en `options`.

Es decir: el cron SÍ ve el universo completo (miles de símbolos) en
`snapshot.universe`, pero `selectUniverseRows` corta ese universo a los
`limit` símbolos configurados en `lib/cronPlan.js` (ver A3) antes de analizar
nada. `sectorize(passedBase)` (línea 1687) solo ve los símbolos que
sobrevivieron ese recorte — nunca el universo completo.

**Camino UI ("Ejecutar").** Es un mecanismo totalmente distinto, no pasa por
`materializedScanner.js` ni por `cronPlan.js`:

- `loadUniverse()` (`app/page.jsx:1210-1239`) pide `/api/universe?markets=...`
  y guarda **todo** el universo devuelto en el estado `universe` — sin
  recorte:
  ```
  const d = await getJson(`/api/universe?markets=${encodeURIComponent(targetMarkets.join(","))}`);
  const all = d.universe || [];
  ...
  setUniverse(u);
  ```
  (`app/page.jsx:1223-1228`)
- `selected(u)` (`app/page.jsx:1240-1247`) decide cuántos de esos símbolos se
  escanean según `scanMode`:
  ```
  function selected(u) {
    const list = [...u];
    if (scanMode === "random") return shuffle(list).slice(0, scanBatchSize);
    const spread = spreadByInitial(list);
    const start = Math.max(0, Math.min(batchStart, Math.max(0, spread.length - 1)));
    if (scanMode === "all") return spread;
    return spread.slice(start, start + scanBatchSize);
  }
  ```
  El estado inicial es `scanMode = "all"` (`app/page.jsx:183`:
  `const [scanMode, setScanMode] = useState("all");`), es decir, por defecto
  la UI pide el universo **completo** cargado en pantalla, no un lote.
- `run()` (`app/page.jsx:1248` en adelante) llama `POST /api/scan` con esa
  lista completa de símbolos (`app/page.jsx:1337-1342`), y ese endpoint
  (`app/api/scan/route.js`) delega en `lib/serverScanRunner.js`, que procesa
  en "eslabones" de `chunkSize` (300 por defecto,
  `lib/serverScanRunner.js:29`) con concurrencia 5
  (`lib/serverScanRunner.js:22`) y `maxDuration = 300`
  (`app/api/scan/route.js:15`), re-encadenándose vía
  `POST /api/scan/continue` hasta terminar (`lib/serverScanRunner.js:326-332`).

**Conclusión A1:** el "12-24 símbolos por escaneo" que reporta el usuario es
un fenómeno exclusivo del cron nocturno de materialización. El botón
"Ejecutar" de la UI, en su configuración por defecto, corre sobre el universo
completo cargado (miles de símbolos) mediante un runner por eslabones
independiente que no tiene el límite de 12-24. Ver PARTE C para qué ve
realmente el usuario en pantalla y por qué esto no resuelve el problema
reportado.

### A2. Tamaño real del universo

Los tamaños "curados" en código (`lib/universes.js`, objetos `CURATED`,
`EXTRA_UNIVERSES`, `EXPANDED_CORE_UNIVERSES`, expuestos vía
`marketSymbols(code)` en `lib/universes.js:100-102`) son solo un **fallback**
de unas pocas decenas/cientos de símbolos por mercado, usado cuando no hay
snapshot en caché (`buildCuratedFallbackUniverse`,
`lib/universeEngine.js:234-255`) o como semilla mínima mezclada con datos
oficiales (`getUniverse`, `lib/universes.js:337-366`).

El universo REAL que ve el cron es el snapshot vivo de
`getUniverseEngineSnapshot` (`lib/universeEngine.js:413`), construido a
partir de proveedores oficiales por mercado
(`fetchUSUniverse`/NasdaqTrader para US, HKEX para HK, TWSE para TW,
J-Quants para JP, ASIC para AU, FIRDS para la UE) mezclados con el curado.
Datos medidos (no estimados) de la tabla `app_settings`,
`setting_key=scan-refresh-cursor`, campo `value.markets[<mercado>].universeTotal`
(consulta exacta: `supabase_query table=app_settings
filter=setting_key=eq.scan-refresh-cursor`, resultado del 2026-08-03
23:08:30 UTC):

| Mercado | universeTotal (medido) |
|---|---|
| US | 5.866 |
| HK | 2.771 |
| TW | 1.053 |
| AU | 666 |
| CA | 205 |
| SG | 45 |
| ZA | 55 |
| GB | 44 |
| SE | 41 |
| CH | 69 |
| DE | 32 |
| ES | 33 |
| FR | 33 |
| IT | 25 |
| NL | 22 |
| NO | 31 |
| DK | 27 |
| FI | 13 |
| BE | 6 |
| PT | 5 |
| AT | 5 |
| IE | 3 |
| JP | 73 |

También hay medición directa en `provider_runs.stats.selection.marketTotals`
para corridas concretas del cron, p. ej. `core-us-hk-au` del 2026-07-30:
`"marketTotals": {"AU": 666, "HK": 2771, "US": 5866}` (consulta:
`supabase_query table=provider_runs filter=run_type=eq.cron-scan-refresh`).

El caso de **JP=73** es notablemente bajo frente a US/HK/TW y coincide casi
exactamente con el tamaño de los arrays curados
`CURATED.JP` + `EXTRA_UNIVERSES.JP` en `lib/universes.js` (12 + ~61
símbolos). Esto es consistente con que J-Quants (el proveedor oficial para
JP, `fetchJquantsUniverse`, invocado en
`lib/universes.js:135` vía `fetchOfficialMarketUniverse`) no está aportando
datos dinámicos y JP cae al curado — **esto es una inferencia por
coincidencia de magnitud, no confirmada leyendo el estado de
`providerRuntimeStatus` para JP**, que no se consultó en esta auditoría.
CA=205, SG=45, ZA=55 muestran el mismo patrón (`fetchOfficialMarketUniverse`,
`lib/universes.js:128-147`, no tiene rama para CA/SG/ZA, así que esos
mercados son curado-solamente por diseño, no por fallo de proveedor).

**Total universo curado potencial (todos los mercados con `universeTotal`
medido arriba, sumado):** ≈ 8.998 símbolos únicos elegibles en el snapshot
vigente a 2026-08-03. Esto es la suma de la tabla anterior, medición directa,
no estimación.

### A3. Origen de `limit`, `perMarket`, `scanLimit`, `scanPerMarket`

**Cron (`lib/cronPlan.js:21-71`, `SCAN_CRON_GROUPS`):**

```
export const SCAN_CRON_GROUPS = [
  { key: "core-us-hk-au", title: "Core US/HK/AU", markets: ["US","HK","AU"], limit: 12, perMarket: 4 },
  { key: "europe-priority", title: "Europe priority", markets: ["EU1"], limit: 24, perMarket: 3 },
  { key: "europe-secondary", title: "Europe secondary", markets: ["EU2"], limit: 21, perMarket: 3 },
  { key: "asia-japan", title: "Asia Japan", markets: ["JP"], limit: 24, perMarket: 24 },
  { key: "asia-taiwan", title: "Asia Taiwan", markets: ["TW"], limit: 20, perMarket: 20 },
  { key: "north-america-canada", title: "North America Canada", markets: ["CA"], limit: 24, perMarket: 24 },
  { key: "asia-singapore-africa", title: "Asia Singapore / Africa South Africa", markets: ["SG","ZA"], limit: 24, perMarket: 12 },
];
```

Estos 7 grupos rotan uno por invocación de cron
(`scanCronGroupAt`, `lib/cronPlan.js:215-219`, usado en
`app/api/cron/scan-refresh/route.js:177`: `const rotated =
scanCronGroupAt(rotation.value?.nextIndex || 0);`). El cron corre **una vez
al día** (ver A3-cron abajo), así que cada grupo se ejecuta cada 7 días salvo
override manual.

`limit`/`perMarket` de cada corrida son overrides opcionales de query string
que caen al valor del grupo si no se pasan
(`app/api/cron/scan-refresh/route.js:180-181`):
```
const limit = numberParam(searchParams, "limit", group.limit, 1, Math.min(group.limit, 80));
const perMarket = numberParam(searchParams, "perMarket", group.perMarket, 1, Math.min(group.perMarket, 25));
```
Nótese que el techo (`max`) de `numberParam` es `Math.min(group.limit, 80)` —
es decir, el propio valor del grupo actúa como techo de sí mismo salvo que
sea menor a 80, por lo que un override manual no puede subir el límite por
encima del valor ya bajo definido en el array (a menos que se edite
`SCAN_CRON_GROUPS`).

**`app/api/jobs/scan-refresh/route.js`** (el endpoint interno que
`runMaterializedScan` comparte con el cron, también usado por
`shadow-europe-refresh`) tiene sus propios defaults, independientes de
`cronPlan.js`:
```
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const DEFAULT_PER_MARKET = 10;
...
const limit = symbols.length ? Math.min(symbols.length, MAX_LIMIT) : numberParam(searchParams, "limit", DEFAULT_LIMIT, 1, MAX_LIMIT);
const perMarket = symbols.length ? 0 : numberParam(searchParams, "perMarket", markets.length > 1 || !markets.length ? DEFAULT_PER_MARKET : 0, 0, MAX_LIMIT);
```
(`app/api/jobs/scan-refresh/route.js:19-21,58-63`). Este endpoint permite
`limit` de hasta 200 vía query string si se invoca directamente (no es el
cron quien lo hace así — el cron pasa siempre sus propios `limit`/`perMarket`
bajos desde `SCAN_CRON_GROUPS`).

`scanLimit`/`scanPerMarket` (los nombres que aparecen en el contexto de la
tarea) corresponden a `SHADOW_EUROPE_CRON_GROUPS`
(`lib/cronPlan.js:73-110`), usado por
`app/api/cron/shadow-europe-refresh/route.js` para el universo "shadow" de
GB + nórdicos + Europa occidental/sur — estos son los `scanLimit: 18/24` y
`scanPerMarket: 6` que el usuario reportó (IT+ES: total 12; DE+FR+NL: total
18; nórdicos: total 24; GB: total 6). Confirmado en los datos reales de
`scans.settings.progress` consultados en PARTE B.

**Cron real (una sola ejecución diaria):** `vercel.json`:
```
"crons": [
  { "path": "/api/cron/universe-refresh", "schedule": "10 21 * * *" },
  { "path": "/api/cron/scan-refresh", "schedule": "20 22 * * *" },
  { "path": "/api/cron/shadow-europe-refresh", "schedule": "50 22 * * *" },
  { "path": "/api/cron/shadow-firds-refresh", "schedule": "30 23 * * *" },
  { "path": "/api/cron/favorite-snapshots", "schedule": "30 22 * * *" },
  { "path": "/api/cron/leaderboards-refresh", "schedule": "45 23 * * *" }
]
```
`scan-refresh` y `shadow-europe-refresh` corren una vez cada 24h. Esto es
consistente con los timestamps medidos en `provider_runs` (todas las
corridas de `cron-scan-refresh` caen ~23:07-23:08 UTC, una por día).

---

## PARTE B — Por qué son tan bajos

### B4. Justificación escrita

**Para `SCAN_CRON_GROUPS` (lib/cronPlan.js:21-71): no hay justificación
escrita.** El array se introdujo íntegro, sin comentarios, en el commit
`45a9a5b7` ("Polish screener filters and RS research UX", 2026-05-26), un
commit grande que tocó decenas de archivos a la vez. `git blame` confirma que
ninguna línea del array se ha modificado desde entonces y no hay comentarios
adyacentes que expliquen por qué `core-us-hk-au` usa `limit:12,perMarket:4`
mientras `asia-japan`/`asia-taiwan`/`north-america-canada` usan
`limit:20-24,perMarket:20-24` (prácticamente sin recorte, porque esos
universos ya son pequeños — ver A2).

**Contraste:** `SHADOW_FIRDS_CRON_GROUPS` y `SHADOW_EUROPE_CRON_GROUPS`, en
el mismo archivo, SÍ tienen justificación extensa y citada con mediciones
(`lib/cronPlan.js:1-18, 112-139`):
```
// GB-FCA is excluded from that rotation because the FCA payload + OpenFIGI +
// Yahoo pass takes ~168s for 11.375 ISIN per
// docs/firds-coverage-impact-study-2026-07-11.md#e10; that exceeds
// maxDuration=60.
...
// pricePerMarket bumped from 8 → 20 (2026-07-11). Empirical measurements in
// docs/evidence/shadow-write-mechanism-confirm-2026-07-11.md §4 show the
// worst-pair (ES+IT) at 26.7s on cache-hit runs, with DE/FR solo around
// 12-20s, all comfortably under maxDuration=60.
```
Es decir: el proyecto SÍ tiene precedente de medir y documentar límites por
`maxDuration`, pero esa disciplina no se aplicó a `SCAN_CRON_GROUPS`, que es
justo el array responsable de los números que reporta el usuario (12, 18,
24...).

**Único comentario relacionado con `maxDuration=60` que toca este cron**
está en `app/api/cron/scan-refresh/route.js:198-203`, pero justifica la
ventana de antigüedad del snapshot de universo (`universeMaxAgeHours: 48`),
no los valores de `limit`/`perMarket`:
```
// universe-refresh corre a las 21:10 UTC, 70 min antes que este cron
// (22:20 UTC) — en operación normal el snapshot tiene minutos de
// antigüedad. 48h es solo el colchón para el día en que universe-refresh
// falle o se salte, evitando el fallback a buildUniverse() completo
// (que puede tardar >60s y detona el maxDuration del cron).
```

**Conclusión B4:** existe una restricción real y documentada de
`maxDuration=60` en el cron (`app/api/cron/scan-refresh/route.js:13`), pero
la relación causal específica entre esa restricción y los valores exactos
12/18/20/21/24 de `SCAN_CRON_GROUPS` no está documentada en ningún comentario
o commit. Es plausible por inferencia (ver B5), no está confirmada por
escrito.

### B5. Cuánto tarda analizar un símbolo — medición

**Medido** en `provider_runs` (`run_type=cron-scan-refresh`,
`started_at`→`finished_at`, concurrencia real del cron = 2, ver
`app/api/cron/scan-refresh/route.js:188`:
`concurrency: numberParam(searchParams, "concurrency", 2, 1, 3)`):

| Grupo | Fecha | Duración (finished−started) | Símbolos analizados (`selected`) | s/símbolo × concurrencia (worker-seg / símbolo) |
|---|---|---|---|---|
| core-us-hk-au | 2026-07-30 | 49,44s | 12 | 8,24s |
| asia-taiwan | 2026-08-03 | 46,70s | 20 | 4,67s |
| europe-secondary (DK,NO,FI,BE,PT,AT,IE) | 2026-08-01 | 37,78s | 19 | 3,98s |
| europe-priority (GB,DE,FR,NL,CH,SE,IT,ES) | 2026-07-31 | 41,52s | 24 | 3,46s |
| asia-japan | 2026-08-02 | 51,47s | 24 | 4,29s |
| north-america-canada | 2026-07-26 | 44,71s | 24 | 3,73s |
| asia-singapore-africa | 2026-07-27 | 44,35s | 24 | 3,70s |

Cálculo mostrado: duración_total × concurrencia(2) ÷ símbolos_seleccionados =
segundos-trabajador por símbolo (incluye fetch de chart Yahoo + perfil +
scoring; casi todas estas corridas tienen `cache.hit: false`, es decir, sin
caché tibia). Promedio medido: **≈4,58s por símbolo** (rango 3,46–8,24s).

**Estimación derivada** (no medida directamente): con `maxDuration=60`
(`app/api/cron/scan-refresh/route.js:13`) y concurrencia 2, el techo teórico
de símbolos por invocación ronda:
```
60s × concurrencia(2) / 4,58s/símbolo ≈ 26 símbolos
```
dejando cero margen para el resto del trabajo de la invocación (lectura de
cursor, `hydrateBenchmarks` — 3 símbolos SPY/QQQ/ACWI adicionales,
`lib/materializedScanner.js:649-660> —, escritura a Supabase de `scans` +
`scan_results` + `scan_symbol_history` + cursor + `provider_runs`). Los
valores reales de `SCAN_CRON_GROUPS` (12-24) están en ese orden de magnitud
o por debajo, lo cual es **consistente** con un techo de ~60s/concurrencia=2,
pero esto es una correlación de magnitud, no una confirmación: no hay
comentario en el código que documente este cálculo para `SCAN_CRON_GROUPS`
(a diferencia de los grupos shadow, ver B4).

### B6. Paginación por cursor

**Mecanismo confirmado leyendo código:** `app_settings` con
`setting_type="jobs"`, `setting_key="scan-refresh-cron-rotation"` guarda qué
grupo de `SCAN_CRON_GROUPS` toca a continuación
(`app/api/cron/scan-refresh/route.js:15-16,238-247`), y
`setting_key="scan-refresh-cursor"` guarda, por mercado, el `offset` desde
donde continuar la próxima vez (`lib/materializedScanner.js:68-69`,
`marketOffsetFor`, `lib/materializedScanner.js:680-685`;
escritura en `nextCursorValue`,
`app/api/cron/scan-refresh/route.js:69-100`). El offset avanza en
`selectUniverseRows` (`lib/materializedScanner.js:994-1104`) tomando `limit`
filas desde `offset` en orden de prioridad de materialización
(`materializationPriorityForRow`, `lib/materializedScanner.js:832-889`), y
`nextMarketOffsets` vuelve a 0 solo cuando el cursor llega al final del
universo del mercado (`lib/materializedScanner.js:1096`:
`group.length && cursor < group.length ? cursor : 0`).

**Cálculo de noches para recorrer el universo entero** — combina: (a) medido
de `scan-refresh-cursor` (`universeTotal`, `selected` por visita, tabla A2) y
(b) el hecho de que cada grupo de `SCAN_CRON_GROUPS` corre una vez cada 7
días (7 grupos, 1 cron/día, rotación round-robin,
`scanCronGroupAt`/`nextIndex`, `app/api/cron/scan-refresh/route.js:177,241`):

| Mercado | universeTotal | seleccionados/visita | visitas necesarias | noches (visitas × 7) | ≈ años |
|---|---|---|---|---|---|
| US | 5.866 | 4 | 1.467 | 10.266 | 28,1 |
| HK | 2.771 | 4 | 693 | 4.851 | 13,3 |
| AU | 666 | 4 | 167 | 1.166 | 3,2 |
| TW | 1.053 | 20 | 53 | 371 | 1,0 |
| CA | 205 | 24 | 9 | 60 | 0,16 |
| JP | 73 | 24 | 4 | 21 | 0,06 |
| SG | 45 | 12 | 4 | 26 | 0,07 |
| ZA | 55 | 12 | 5 | 33 | 0,09 |
| GB | 44 | 3 | 15 | 103 | 0,28 |
| SE | 41 | 3 | 14 | 96 | 0,26 |
| CH | 69 | 3 | 23 | 161 | 0,44 |

(Cálculo mostrado: `ceil(universeTotal / seleccionados) × 7`; "seleccionados
por visita" tomado del campo `selected` medido en `scan-refresh-cursor` para
cada mercado, tabla A2/A3.) Esto es **estimación derivada de datos medidos**,
no una medición directa de "noches transcurridas", porque el sistema lleva
operando ~2,5 meses (primer `scans` registrado 2026-06-20, ver B9) — no hay
histórico suficiente para observar un ciclo completo en ningún mercado
grande.

**Hallazgo central de B6:** US y HK, que juntos concentran ≈8.637 de los
≈8.998 símbolos elegibles del snapshot medido (A2), están en el grupo con
`perMarket: 4` — el más bajo de los 7 — y tardarían **13 a 28 años** en
recorrerse una sola vez al ritmo actual. Los mercados con universos pequeños
(JP, CA, SG, ZA, Europa) sí completan un ciclo en semanas o pocos meses. El
cursor "funciona" como mecanismo, pero el reparto de `perMarket` entre
grupos no es proporcional al tamaño real de cada universo.

---

## PARTE C — Qué ve el usuario

### C7. Sobre qué universo corre "Ejecutar"

Confirmado en A1: la UI corre sobre el universo cargado en pantalla
(`universe` state, poblado por `/api/universe`, potencialmente miles de
símbolos), no sobre el curado fijo ni sobre `scan_results` materializado por
el cron. Cita clave (`app/page.jsx:1272-1273`):
```
const currentUniverseScope = universeScopeKey(markets, manual);
const base = universe.length && universeScope === currentUniverseScope ? universe : await loadUniverse(null, { preserveResults: hadVisibleRows });
```
y el modo por defecto es `"all"` (universo completo), como se citó en A1.
`/api/scan` (`app/api/scan/route.js`) crea una fila nueva en `scans` con
`settings.scanSymbols` = la lista completa recibida — es un escaneo *ad hoc*,
independiente de lo que el cron haya materializado esa noche.

**Esto significa que el botón "Ejecutar" de la UI, técnicamente, no está
limitado a 12-24 símbolos** — puede escanear miles si `scanMode==="all"`.
Existen en la tabla `scans` corridas históricas que lo confirman (ver C9:
filas con `row_count` de 297, 1.967 y 3.972). El problema reportado por el
usuario ("cada escaneo procesa una docena de símbolos") describe con
precisión el comportamiento del **cron nocturno**, no necesariamente el de
la UI interactiva — algo que vale la pena que el usuario confirme: ¿el "0
pasan" que observa viene de pulsar "Ejecutar", o de las pantallas de
leaderboards/discovery que leen `scan_results` acumulado por el cron? Ver
C8-C9.

### C8. Qué leen las pantallas: `scan_results` acumulado, con ventana temporal

`readScanRows` (`lib/leaderboards.js:713-744`) es la función que alimentan
`/api/leaderboards` y `/api/discovery`. No lee la tabla directamente: llama a
la RPC `leaderboard_publishable_rows`
(`supabase/migrations/20260710180000_leaderboard_publishable_rows.sql`),
cuyo cuerpo es:
```sql
with scoped as (
  select ...
  from public.scan_results as sr
  join public.scans as s on s.id = sr.scan_id
  where sr.owner_id = p_owner_id
    and sr.created_at >= (now() - make_interval(days => greatest(coalesce(p_since_days, 45), 1)))
  order by sr.created_at desc
  limit greatest(1, least(coalesce(p_max_rows, 5000), 10000))
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(...) from scoped as x
    where x.parent_status in ('complete', 'partial', 'done')), '[]'::jsonb),
  ...
```
Es decir: SÍ lee el acumulado histórico de `scan_results` (no solo el último
escaneo), acotado a una ventana de `p_since_days` (default 45) y a lo sumo
`p_max_rows` (default 5000) filas *más recientes por `created_at`*, filtradas
después por que el `scans` padre haya terminado en estado publicable
(`complete`/`partial`/`done` — `status="failed"` o `"error"` no publica,
aunque tenga filas ya insertadas).

Valores por defecto de cada consumidor:
- `readScanRows` (`lib/leaderboards.js:713`): `maxRows=5000`, `sinceDays=45`.
- `/api/discovery` (`app/api/discovery/route.js:5-11`):
  `DEFAULT_DISCOVERY_SCAN_ROWS=900`, `DEFAULT_DISCOVERY_SINCE_DAYS=21` — más
  estrecho que leaderboards.
- `refreshDefaultLeaderboards` (`lib/materializedScanner.js:1812-1817`,
  llamado solo desde `/api/cron/leaderboards-refresh`, no desde
  `scan-refresh`): `sinceDays=45`, `maxRows=10000`.

### C9. Datos reales: filas en `scan_results`

**Medición con la limitación declarada de 200 filas/consulta:** la tabla
`scan_results` no expone un `COUNT()` a través de la herramienta de solo
lectura, así que se midió indirectamente sumando `row_count` de la tabla
`scans` (que registra cuántas filas escribió cada scan en `scan_results` al
completarse — `writeMaterializedScan`/`runScanChunk`). La tabla `scans`
completa cabe en una sola consulta:

- `supabase_query table=scans select=id,created_at,row_count
  order=created_at.asc limit=1` → primera fila: `2026-06-20T08:41:39Z`,
  `row_count=6`.
- `supabase_query table=scans select=id,created_at,row_count
  order=created_at.desc limit=200` → devolvió **62 filas** (menos que el
  tope de 200 ⇒ es la tabla `scans` completa, no una página parcial), última
  fila `2026-08-03T23:08:28Z`.

**Suma de `row_count` de las 62 filas = 6.819.** Esta es la estimación del
total de filas en `scan_results` (medición indirecta vía metadata de
`scans`, no un `COUNT(*)` directo sobre `scan_results`). Rango temporal:
2026-06-20 → 2026-08-03 (45 días), que coincide casi exactamente con la
ventana por defecto de `readScanRows` (`sinceDays=45`) — es decir, en la
práctica **toda la historia de `scan_results` cae dentro de la ventana de
lectura de leaderboards.**

De esas 62 filas de `scans`, la inmensa mayoría son corridas del cron con
`row_count` de 0-24 (materialización nocturna: ver PARTE B). Cuatro filas son
outliers muy por encima de ese rango, todas escaneos manuales via UI
(`preset` en esos registros no es `"materialized-cache"`):

| id (parcial) | created_at | row_count |
|---|---|---|
| 29dc00e5 | 2026-07-15T18:36:39Z | 3.972 |
| b325393c | 2026-07-06T23:43:09Z | 1.967 |
| 966090e7 | 2026-07-08T14:46:15Z | 297 |
| cc772a99 | 2026-07-16T11:43:09Z | 50 |

Esto confirma empíricamente lo dicho en C7: el camino UI **sí** es capaz de
producir miles de filas cuando se ejecuta sobre el universo completo. Sin
esos 4 outliers (suma 6.286), el resto de `scans` (58 filas, todas del cron
o de escaneos UI pequeños) suma solo 533 filas en 45 días — **≈11,8 filas
nuevas de `scan_results` por día en el flujo normal del cron**, lo cual
confirma el problema reportado a nivel de acumulación diaria.

**Ventana de `/api/discovery` (`sinceDays=21`, `maxRows=900`):** sumando
`row_count` de las filas de `scans` con `created_at ≥ 2026-07-14` (21 días
antes de 2026-08-04, mismo listado de 62 filas): **4.491**, de las cuales
3.972 pertenecen al outlier `29dc00e5` del 2026-07-15. La RPC pide `limit
900` ordenado por `created_at desc` **antes** de filtrar por status
publicable — con ~493 filas más recientes que ese outlier (suma de
row_count de scans posteriores al 2026-07-15), discovery leería primero esas
~493 filas del cron y completaría el resto de las 900 con una porción
arbitraria del outlier de 3.972 filas (todas con `created_at` casi idéntico
entre sí, así que el orden dentro de ese bloque no es significativo). **No
se verificó directamente cuántas de esas 900 filas caen del lado del cron
vs. del outlier** — es una inferencia a partir de sumar `row_count`
ordenados por fecha, no una consulta directa a `scan_results` con ese
filtro exacto (se habría necesitado más de una consulta de 200 filas para
confirmarlo con precisión).

---

## PARTE D — Qué haría falta

### 10. Cambios necesarios para cubrir miles de valores por escaneo

- **Subir `limit`/`perMarket` en `SCAN_CRON_GROUPS`
  (`lib/cronPlan.js:21-71`).** Acotado en superficie (son 7 números), pero
  bloqueado por `maxDuration=60` del cron
  (`app/api/cron/scan-refresh/route.js:13`) combinado con el costo medido de
  ≈4,58s/símbolo a concurrencia 2 (B5): subir el límite sin más cambios
  arriesga que la invocación exceda los 60s y sea cortada a mitad de
  escritura (el propio código ya documenta ese riesgo para otros crons, ver
  B4). No hay margen visible dentro del mismo diseño (misma concurrencia,
  mismo `maxDuration`, mismo patrón de una invocación = un lote completo).

- **Subir `maxDuration` del cron.** Bloqueado por el plan Hobby de Vercel
  (contexto ya verificado por el usuario: 60s en Hobby). Requeriría cambio de
  plan o mover el trabajo a un mecanismo que no dependa de una sola
  invocación HTTP síncrona (p. ej. el patrón de "eslabones" que ya existe en
  `lib/serverScanRunner.js` para el camino UI, pero el cron no lo usa).

- **Aumentar la concurrencia del cron** (`concurrency` en
  `app/api/cron/scan-refresh/route.js:188`, tope actual 3). Acotado
  técnicamente, pero cada símbolo adicional en paralelo consume más llamadas
  simultáneas al proveedor de datos (Yahoo/HKEX/TWSE/etc.) — no hay medición
  en este repo de cuotas o rate limits de esos proveedores, así que el techo
  real de concurrencia segura es desconocido con los datos disponibles.

- **Redistribuir `perMarket` proporcionalmente al tamaño real del
  universo** (B6 muestra que US/HK, con el 96% de los símbolos elegibles,
  tienen el `perMarket` más bajo: 4). Esto es un cambio de datos
  (`lib/cronPlan.js`), no de arquitectura — pero por sí solo no resuelve el
  techo de tiempo por invocación: redistribuir sin subir el total del
  `limit` solo mueve el problema entre mercados, no lo resuelve.

- **Adoptar en el cron el mismo patrón de eslabones que ya usa
  `lib/serverScanRunner.js` para la UI** (re-encadenarse vía fetch interno
  hasta cubrir un lote grande, en vez de una invocación = un lote fijo). Es
  un rediseño del cron, no un ajuste de parámetros: cambia el modelo de
  ejecución (de "cron simple limitado por `maxDuration`" a "cron que
  dispara un proceso encadenado como el de `/api/scan`"). Bloqueado
  principalmente por diseño/tiempo de implementación, no por una
  restricción externa dura — el propio código ya prueba que el patrón
  funciona bajo Hobby (route `/api/scan` declara `maxDuration=300`, no 60,
  lo cual en sí mismo es una discrepancia frente al techo de 60s de Hobby
  citado en el contexto de esta tarea; no se investigó si esa declaración de
  300s tiene efecto real en producción bajo Hobby o si Vercel la trunca
  silenciosamente a 60s).

- **Aumentar `RS_GLOBAL_MIN_SAMPLE` o el criterio de cálculo de
  `rsGlobalPct` para lotes pequeños** (`lib/relativeStrength.js:4`,
  `percentileFromSorted`, `lib/relativeStrength.js:192-201`). Esto no
  aumenta el universo cubierto, pero destraba el síntoma final ("0 pasan")
  para los lotes que el cron sí produce hoy: mientras `sectorize` calcule
  percentiles solo sobre el lote de la corrida
  (`lib/materializedScanner.js:1687`: `sectorize(passedBase)`, donde
  `passedBase` tiene como mucho `limit` filas), cualquier lote de menos de
  20 símbolos seguirá dando `rsGlobalPct=null` para (casi) todas sus filas,
  y el preset por defecto `balanced`
  (`lib/screenerFilterCatalog.js:168`, con `minRsRating: 50` heredado de
  `QUALITY_DEFAULTS`, `lib/screenerFilterCatalog.js:123`) seguirá
  rechazándolas todas vía `screenerFilterRejectReason`
  (`lib/screenerFilters.js:737-741`). Esto es un cambio acotado en superficie
  (una función), pero conceptualmente cambia qué significa el percentil
  ("global" dejaría de serlo si se calcula sobre 4-24 símbolos) — el
  trade-off metodológico no se investigó en esta auditoría.

### 11. Vía que no requiere cambiar los límites del cron

Ya existe en el código: las pantallas (`/api/leaderboards`, `/api/discovery`)
**ya leen el acumulado histórico de `scan_results`** a través de
`readScanRows`/`leaderboard_publishable_rows` (C8), no solo el último
escaneo. El mecanismo de acumulación con cursor (B6) ya está diseñado para
que, corrida a corrida, se vaya cubriendo más universo sin repetir símbolos
recientes (`skipRecentlyScanned`/`materializationPriorityForRow`,
`lib/materializedScanner.js:832-889`, prioriza `never_scanned` y
`stale_scan` sobre símbolos ya escaneados recientemente).

El problema de B9/C9 no es que la vía no exista, sino que:
1. La velocidad de acumulación es demasiado baja para los mercados grandes
   (US/HK tardarían años en cubrirse una vez, B6), así que el acumulado de
   `scan_results` para esos mercados seguirá siendo una fracción mínima del
   universo real durante mucho tiempo aunque el mecanismo de acumulación en
   sí funcione correctamente.
2. Incluso las filas que sí se acumulan quedan con `rsGlobalPct=null` (B5,
   punto D10 sobre `RS_GLOBAL_MIN_SAMPLE`) porque el cálculo de percentil se
   hace por lote, no sobre el acumulado — así que aunque `scan_results`
   tuviera miles de filas, ampliar la ventana de lectura (`sinceDays`,
   `maxRows`) no arregla el `rsGlobalPct=null` ya persistido en cada fila,
   porque ese valor se calculó y guardó en el momento del escaneo, no se
   recalcula al leer.

Esta vía (acumular más y leer más ancho) es la que menos toca arquitectura,
pero **no resuelve por sí sola** ninguno de los dos problemas anteriores sin
tocar también B5/B6 (ritmo de cobertura) o D10 (cálculo de RS por lote).

---

## CONFIANZA

**Verificado leyendo código (alta confianza, cita directa):**
- A1: los dos caminos (cron vs UI) son mecanismos separados; UI por defecto
  escanea el universo completo cargado (`scanMode="all"`).
- A3: valores exactos de `SCAN_CRON_GROUPS`, `SHADOW_EUROPE_CRON_GROUPS`,
  defaults de `app/api/jobs/scan-refresh/route.js`, cron schedule en
  `vercel.json`.
- B4: ausencia de comentarios justificativos en `SCAN_CRON_GROUPS` (git
  blame + lectura de archivo); presencia de justificación medida para los
  grupos shadow.
- B6: mecanismo de cursor (`app_settings`, `selectUniverseRows`,
  `nextMarketOffsets`).
- C7-C8: qué universo usa cada camino; contrato de
  `leaderboard_publishable_rows` (ventana temporal + filtro de estado
  publicable) leído directamente del SQL de la migración.
- D10/D11: qué bloquea cada cambio, citado desde el propio código.

**Verificado consultando datos (alta confianza, consulta y resultado
citados):**
- A2: `universeTotal` medido por mercado desde `app_settings` y
  `provider_runs`.
- B5: duraciones reales de 7 corridas del cron desde `provider_runs`.
- B9/C9: 62 filas totales en `scans`, suma de `row_count`=6.819, rango
  temporal 2026-06-20→2026-08-03, los 4 outliers de escaneos UI grandes.
- Los números de `total`/`saved` del enunciado del usuario (IT+ES 12/6,
  DE+FR+NL 18/4, nórdicos 24/12, GB 6/1, JP 24/24) se confirmaron
  literalmente en `scans.settings.progress` de las filas correspondientes.

**Inferido / no cerrado (confianza media o explícitamente abierto):**
- B4/B5: la relación causal exacta entre `maxDuration=60` y los valores
  12/18/20/21/24 de `SCAN_CRON_GROUPS` es plausible por coincidencia de
  magnitud (60s × concurrencia2 ÷ 4,58s/símbolo ≈ 26), pero no está
  documentada por escrito en ningún commit o comentario — se presenta como
  inferencia, no como hecho confirmado.
- A2: que JP/CA/SG/ZA sean "curado-solamente" por falta de proveedor
  dinámico activo es una inferencia por coincidencia de tamaño de array; no
  se consultó `providerRuntimeStatus` en vivo para confirmarlo.
- C9: la composición exacta de qué filas entrarían en la ventana de 900 de
  `/api/discovery` (cuántas del cron vs. cuántas del outlier de 3.972) es
  una estimación aritmética a partir de `row_count` ordenado por fecha, no
  una consulta directa con el mismo filtro que usa la RPC.
- D10: si `maxDuration=300` declarado en `app/api/scan/route.js` realmente
  se respeta en producción bajo el plan Hobby, o si Vercel lo trunca a 60s,
  no se investigó — se señala como discrepancia abierta frente al contexto
  ya verificado por el usuario ("Hobby: maxDuration limitado a 60s").
- No se pudo obtener un `COUNT(*)` directo sobre `scan_results` (la
  herramienta de solo lectura no expone agregados y el tope es 200 filas por
  consulta); el total de 6.819 es una suma de metadata de `scans`, no un
  conteo directo de la tabla de destino. Si algún proceso hubiera insertado
  filas en `scan_results` sin pasar por `writeMaterializedScan`/
  `runScanChunk` (que son los que fijan `row_count`), o si se hubieran
  borrado filas después, esa cifra quedaría desactualizada — no se
  encontró evidencia de eso en el código revisado, pero tampoco se
  descartó exhaustivamente.
