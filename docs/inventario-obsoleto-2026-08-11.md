# Inventario de lo obsoleto — 2026-08-11

<!-- fecha interna: 2026-08-11 · BASE_SHA: 7bc3144 · rama: codex/statsedge-ui-polish -->

Este documento es un **inventario**, no un plan de acción. No se ha modificado
ningún archivo de código, no se ha escrito nada en Supabase, no se ha ejecutado
ningún escaneo y no se ha hecho commit ni push. Todas las consultas citadas son
de solo lectura, vía la herramienta `supabase_query`, acotadas (sin `COUNT`,
sin agregados, sin barridos) porque la instancia es Micro y se ha saturado dos
veces esta semana.

**No se recomienda retirar nada.** La clasificación de la Parte E es material
para decidir después, no una propuesta de borrado.

---

## Cómo leer esto (sin jerga)

El sistema tiene tres tipos de "peso muerto" distintos, y conviene no
confundirlos:

1. **Lo que nunca llegó a funcionar** — se construyó, se dejó a medias, y no
   hay ni un solo dato en producción que demuestre que corrió.
2. **Lo que funcionó y dejó de usarse** — hay rastro de cuándo tenía un
   consumidor y cuándo lo perdió.
3. **Lo que funciona hoy pero está dimensionado para otro tamaño de problema**
   — números elegidos cuando había 200 símbolos, o cuando se esperaban varios
   usuarios a la vez, y hoy hay 10.000 símbolos y un usuario.

El tercero es el más peligroso, porque no da error: simplemente devuelve menos
de lo que debería y nadie se entera.

**Convención de este documento**: cada afirmación lleva la etiqueta
`[VERIFICADO]` (lo comprobé yo, en este repo o contra producción, con la cita o
la consulta al lado) o `[SUPUESTO]` (razonamiento mío, no comprobado).

---

## PARTE A — Lo que no se ejecuta

### A.1 — Tablas vacías en producción

Las cuatro tablas del Hito 1B siguen vacías. `[VERIFICADO]` — cuatro consultas,
una por tabla, cada una con `limit: 3`:

```
supabase_query(table: "scan_executions",      select: "id",             limit: 3)  → []
supabase_query(table: "scan_result_sets",     select: "id",             limit: 3)  → []
supabase_query(table: "scan_work_items",      select: "result_set_id",  limit: 3)  → []
supabase_query(table: "scan_result_set_rows", select: "result_set_id",  limit: 3)  → []
```

Las cuatro devolvieron `[]`. Esto **reconfirma con datos frescos de agosto** lo
que ya documentaba `docs/adr-hito-1b-diferido.md` §2 (medido el 2026-08-03):
nunca ha corrido ni una sola vez.

El código que las escribiría son las 10 RPC de ciclo de vida
(`begin_scan_execution`, `register_scan_work_item`, `persist_scan_result`,
`complete_scan_work_item`, `finalize_scan_execution`, …), hoy en
`supabase/deferred/hito-1b.sql` (2.239 líneas) `[VERIFICADO]` — `wc -l`. **Ningún
archivo de `lib/` o `app/` llama a ninguna de esas RPC** `[VERIFICADO]` — grep de
`begin_scan_execution` en `lib app` sin resultados fuera del propio SQL.

**Tabla que existe en el esquema pero nadie toca en absoluto:**

- `company_profiles` (`supabase/schema.sql:993`). `[VERIFICADO]` — la única
  aparición de la cadena `company_profiles` en todo el código es en dos
  inventarios de diagnóstico:
  ```
  scripts/supabase-admin.mjs:15:  ["company_profiles", "core"],
  lib/supabaseDiagnostics.js:10:  { name: "company_profiles", area: "core" },
  ```
  Es decir: se declara como "tabla requerida" del sistema, y ninguna ruta ni
  librería escribe ni lee una sola fila. No pude consultar su contenido: **no
  está en la lista blanca del servidor MCP** (`scripts/mcp/supabase-readonly.mjs:26-33`),
  así que no sé si está vacía. `[SUPUESTO]` — que esté vacía; el perfil de
  empresa vive de hecho en `app_settings` con `setting_type = "company_brief_cache"`
  (ver A.2), lo que sugiere que `company_profiles` fue la primera idea y
  `app_settings` la que ganó.

- `rs_weekly_snapshots` (`supabase/schema.sql:1254`). `[VERIFICADO]` — cero
  apariciones en `app/` y `lib/`; solo la toca `scripts/rs-universe.mjs:306`,
  un script manual. Ver A.4 y A.6.

**Nota sobre la lista blanca del MCP**: incluye una tabla que no existe.
`[VERIFICADO]`:
```
supabase_query(table: "rs_weekly_runs", select: "id", limit: 3)
→ PostgREST 404: "Could not find the table 'public.rs_weekly_runs' in the schema cache"
```
`rs_weekly_runs` figura en `scripts/mcp/supabase-readonly.mjs:33` pero no existe
en la base. Es un residuo de un diseño anterior; no rompe nada, pero es una
pista falsa para quien lea esa lista creyendo que es un inventario fiable.

### A.2 — Tablas que SÍ se llenan y que nadie lee (el caso más silencioso)

Este patrón no lo pedía el enunciado, pero es el mismo problema con otra cara:
código que corre cada noche, escribe filas, y no tiene ningún consumidor.

**`scan_symbol_history`** — historial de qué le pasó a cada símbolo en cada
escaneo.

- Se escribe: `lib/scanHistory.js:211` (`writeScanSymbolHistory`), invocada
  desde **tres** rutas `[VERIFICADO]`:
  ```
  app/api/cron/scan-refresh/route.js:9
  app/api/cron/shadow-europe-refresh/route.js:6
  app/api/jobs/scan-refresh/route.js:13
  ```
- Se lee: **por nadie**. `[VERIFICADO]` — la única aparición de la cadena
  `scan_symbol_history` en `app/` y `lib/` es la escritura de la línea 211. No
  hay ningún `select` contra esa tabla en el producto.
- Tiene datos reales y sigue creciendo `[VERIFICADO]`:
  ```
  supabase_query(table: "scan_symbol_history", select: "symbol,observed_at,source_pipeline",
                 order: "observed_at.asc", limit: 3)
  → [{"symbol":"AAPL","observed_at":"2026-07-29T19:44:11.959+00:00","source_pipeline":"materialized_scan"}, …]

  supabase_query(table: "scan_symbol_history", select: "symbol,observed_at,source_pipeline",
                 order: "observed_at.desc", limit: 5)
  → [{"symbol":"ADN1.DE","observed_at":"2026-08-10T23:23:46.327+00:00","source_pipeline":"materialized_scan"}, …]
  ```
  Acumula desde el 29 de julio de 2026 y la última escritura es de anoche.

En castellano llano: **cada noche se escribe un historial que nadie ha leído
nunca**, desde hace dos semanas. Son 222 líneas de código
(`lib/scanHistory.js`), una migración (`20260729130755_scan_symbol_history.sql`)
y una tabla que crece en una instancia que ya se satura.

**`market_health_cache`** — una entrada de `app_settings` que dejó de
refrescarse. `[VERIFICADO]`:
```
supabase_query(table: "app_settings", select: "setting_type,setting_key,updated_at",
               order: "updated_at.desc", limit: 50)
```
En las 50 filas más recientes, `market_health_cache` aparece con
`updated_at: "2026-06-20T08:18:24.721+00:00"` — **hace casi dos meses**, mientras
`company_brief_cache` se refresca a diario (última: `8395.HK`, 2026-08-11).
`[SUPUESTO]` — que la caché de salud de mercado dejó de escribirse; podría
también ser que se escriba con el mismo valor y Postgres no toque `updated_at`,
aunque `upsert_app_setting_newer_wins` (`supabase/schema.sql:1143`) sí lo
actualiza en cada escritura, lo que hace poco probable esa explicación.

### A.3 — Funciones exportadas que nadie importa

Metodología `[VERIFICADO]`: script propio que recorre los 129 archivos de `lib/`,
extrae cada símbolo exportado (`export function`, `export const`,
`export { … }`) y busca su nombre en todos los demás archivos `.js/.jsx/.mjs`
del repo. Es una heurística **conservadora**: si el nombre aparece en cualquier
otro archivo cuenta como "consumido", aunque sea una coincidencia. Por tanto
sobre-cuenta el consumo, y lo que marca como huérfano es bastante fiable.

Resultado: **250 símbolos exportados sin ningún consumidor de producción**. Ese
número por sí solo no dice mucho (muchos son constantes internas exportadas solo
para poder testearlas). Lo relevante son los **módulos enteros** sin ningún
importador:

| Archivo | Líneas | Situación |
|---|---|---|
| `lib/listsSeedData.js` | 363 | **Ningún importador, en ningún sitio** |
| `lib/rcReadinessRuntime.js` | 285 | Solo lo importan `scripts/rc-readiness-audit.mjs` y `scripts/post-deploy-observability-audit.mjs` |
| `lib/postDeployObservability.js` | 177 | Solo scripts de auditoría y su propio test |
| `lib/scanResultSetIntegrityContracts.js` | 39 | Solo `tests/scanResultSetFoundationContracts.test.js` (pieza del Hito 1B) |

Otros exports huérfanos notables, agrupados por familia `[VERIFICADO]`:

- `lib/sec.js` — `fetchSecTickerMap`, `cikForTicker`: sin consumidor (el módulo
  entero son 362 líneas; otras funciones suyas sí se usan).
- `lib/yahoo.js` — `fetchYahooNews`, `fetchYahooCompanyNews`,
  `fetchYahooFundamentals`: sin consumidor.
- `lib/universes.js` — `fetchUSUniverse`, `CURATED`, `EXTRA_UNIVERSES`: sin
  consumidor.
- `lib/screenerPipeline.js` — 9 exports sin consumidor (`listCount`,
  `chartPreviewForRange`, `sharedRejectKey`, `filterRejectReason`,
  `splitByFilter`, `postFilterRejectReason`, `summarizeRejections`,
  `scanDiagnosticsSummary`, …).
- `lib/stockDecisionResolution.js` — 4 de sus exports sin consumidor.
- `lib/weeklyStage.js` — `normalizeWeeklyStageSettings`,
  `DEFAULT_WEEKLY_STAGE_SETTINGS`: sin consumidor.

`[SUPUESTO]` — que ninguno se cargue por una vía dinámica que el grep no ve
(`import()` con nombre construido). No encontré ese patrón en el repo, pero no
lo descarté exhaustivamente.

### A.4 — Rutas de API que nadie llama

Metodología `[VERIFICADO]`: para cada una de las 48 rutas de `app/api/**`, conté
en cuántos archivos del repo (incluidos `vercel.json`, `.github/`, `docs/`,
`scripts/`, `tests/`) aparece su ruta literal `/api/<x>`.

**Cero referencias en todo el repo salvo documentos:**

| Ruta | Único rastro | Líneas |
|---|---|---|
| `app/api/symbol-resolve/route.js` | **ninguna en absoluto**, ni siquiera en docs | — |
| `app/api/rs-weekly/route.js` | solo `docs/adr-rs-universo-us.md` y una auditoría | — |
| `app/api/jobs/esef-refresh/route.js` | solo `docs/audit-tenancy-gate-2026-07-24.md` | 120 (más `lib/esef.js`, 364) |
| `app/api/jobs/jquants-refresh/route.js` | solo `docs/data-providers.md` | (más `lib/jquants.js`, 308) |
| `app/api/jobs/leaderboards-refresh/route.js` | solo `docs/coverage-roadmap.md` | — |
| `app/api/jobs/universe-refresh/route.js` | solo `docs/coverage-roadmap.md` | — |

Las dos últimas tienen además un **gemelo que sí corre**: `vercel.json` programa
`/api/cron/leaderboards-refresh` y `/api/cron/universe-refresh` `[VERIFICADO]`
(cita literal de `vercel.json`):
```json
{ "path": "/api/cron/universe-refresh",     "schedule": "10 21 * * *" },
{ "path": "/api/cron/scan-refresh",         "schedule": "20 22 * * *" },
{ "path": "/api/cron/shadow-europe-refresh","schedule": "50 22 * * *" },
{ "path": "/api/cron/shadow-firds-refresh", "schedule": "30 23 * * *" },
{ "path": "/api/cron/favorite-snapshots",   "schedule": "30 22 * * *" },
{ "path": "/api/cron/leaderboards-refresh", "schedule": "45 23 * * *" }
```
Es decir: hay un patrón `/api/jobs/X` (disparo manual protegido) duplicando
`/api/cron/X` (disparo programado), y el lado `jobs` no lo dispara nadie.

**Caso destacado — `/api/jobs/scan-refresh`, 457 líneas** `[VERIFICADO]`. Es un
segundo camino completo hacia `runMaterializedScan`, con sus propios topes
independientes de los del cron:
```js
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 200;
const DEFAULT_PER_MARKET = 10;
const MAX_CONCURRENCY = 4;
```
(`app/api/jobs/scan-refresh/route.js:19-22`). Sus únicas menciones en código son
**cadenas de texto**, no llamadas `[VERIFICADO]`:
```
lib/coveragePlan.js:278:  path: "/api/jobs/scan-refresh?markets=US,HK,AU,CA&perMarket=25&limit=100&…"
lib/rcReadinessRuntime.js:95: path: "/api/jobs/scan-refresh?markets=US,HK&limit=4&perMarket=2&…&dryRun=1"
```
La primera es una "acción sugerida" que se muestra en un plan de cobertura; la
segunda es un chequeo de un script de auditoría (y `rcReadinessRuntime.js` a su
vez solo lo importan scripts, ver A.3).

**Rutas cuyo único invocador es el smoke test** `[VERIFICADO]` — vivas solo en
`scripts/smoke-test.mjs`, ningún componente ni cron las llama:
`/api/jquants` (línea 32), `/api/universe-engine` (102, 114, 120),
`/api/shadow-universe` (168), `/api/jobs/discovery-refresh` (66),
`/api/jobs/shadow-price-freshness` (222), `/api/short-interest` (246).

### A.5 — Proveedores declarados sin configurar

`[VERIFICADO]` — clasifiqué cada clave de `.env.local` comparando su valor con
el placeholder de `.env.example` (`your-…`, `change-me`, o vacío). No imprimí
ningún valor real.

**Sin configurar (placeholder tal cual):**

| Variable | ¿Hay código que la use? | Volumen |
|---|---|---|
| `STOOQ_API_KEY` | Sí — `lib/yahoo.js:10,1172-1175` | fallback de gráfico |
| `ALPHA_VANTAGE_API_KEY` | Sí — `lib/dataProviders.js:290,391` | fallback de gráfico |
| `FMP_API_KEY` | Sí — `lib/fmp.js:4,38-39` | **236 líneas de adaptador completo** |
| `JQUANTS_API_KEY` / `JQUANTS_REFRESH_TOKEN` | Sí — `lib/jquants.js` | **308 líneas + 2 rutas** |
| `FINNHUB_API_KEY` | **No** — solo entrada de catálogo | ~12 líneas |
| `TWELVE_DATA_API_KEY` | **No** — solo entrada de catálogo | ~12 líneas |
| `MARKETSTACK_API_KEY` | **No** — solo entrada de catálogo | ~12 líneas |
| `EODHD_API_KEY` | **No** — solo entrada de catálogo | ~12 líneas |

Los cuatro últimos son el hallazgo nuevo que pedía el enunciado (además de
Stooq y Alpha Vantage, ya conocidos). No tienen adaptador: son entradas
declarativas en `lib/dataProviders.js` con `status: "planned-premium-candidate"`.
Cita literal `[VERIFICADO]` (`lib/dataProviders.js:248-259`):
```js
  {
    id: "finnhub",
    name: "Finnhub",
    role: "Noticias, eventos y perfiles opcionales",
    tier: "gratis limitado con API key",
    status: "planned-premium-candidate",
    envKey: "FINNHUB_API_KEY",
    …
  },
```
`[VERIFICADO]` — grep de `finnhub|twelve-data|marketstack|eodhd` en `lib/` y
`app/` fuera de `dataProviders.js` da exactamente dos resultados, ambos
declarativos:
```
lib/coveragePlan.js:73:  steps: [… "FMP/EODHD como capa premium si la cobertura gratuita no alcanza"]
app/api/data-providers/route.js:11: premiumLater: ["eodhd", "twelve-data", "marketstack", "finnhub"],
```
No hay ni una línea de `fetch` contra ninguno de los cuatro.

**Adaptadores europeos declarados y apagados** `[VERIFICADO]`: `ESMA_FIRDS_ENABLED`
y `FCA_FIRDS_ENABLED` **no aparecen en `.env.local`** (sí en `.env.example`, con
valor `0`). El código las lee con `envFlag(...)`
(`lib/universeEngine.js:38,48`, `lib/officialUniverses.js:590`), así que
ausencia = apagado. Pese a ello, `lib/officialUniverses.js` y la maquinaria
FIRDS asociada siguen en el camino activo, y `shadow_instruments`/
`symbol_resolutions` **sí tienen datos frescos** `[VERIFICADO]`:
```
supabase_query(table: "shadow_instruments", select: "isin,provider,market,status,updated_at",
               order: "updated_at.desc", limit: 5)
→ 5 filas provider "esma-firds", market "IT", updated_at 2026-08-10T23:37
```
Es decir: el adaptador está "apagado" como fuente de universo, pero la vía
paralela (`/api/cron/shadow-firds-refresh`, sí programada en `vercel.json`)
sigue sembrando la tabla oculta cada noche. **No es código muerto**, es una
segunda ruta viva que convive con el flag apagado. `[SUPUESTO]` — que esto sea
intencional; el comentario de `lib/cronPlan.js:1-19` lo describe así, pero no
verifiqué si el dato sembrado llega a usarse en el producto.

**Aviso importante sobre este punto** `[VERIFICADO]`: lo anterior describe
`.env.local`, que es el entorno **local**. Las variables reales de producción
viven en Vercel Project Settings y **no las puedo ver desde aquí**. Un proveedor
podría estar configurado en producción y no en local. Ver "LO QUE NO HE
VERIFICADO".

### A.6 — ¿Nunca se usó, o se usó y dejó de usarse?

`[VERIFICADO]` — con `git log --oneline -- <archivo>` y `git log --all -S"<cadena>"`.

**Se usó y dejó de usarse (hay rastro del corte):**

- `lib/listsSeedData.js` (363 líneas). Creado en `45a9a5b` (2026-05-26). Su
  export `SEED_STOCKS` **tenía un consumidor real**: el commit `1971c76`
  ("Stabilize StageRadar workflows", 2026-05-27) contiene la línea
  ```
  -import { SEED_STOCKS } from "@/lib/listsSeedData";
  ```
  en `app/lists/page.jsx`. Es decir: vivió **un día**, se le quitó el
  consumidor, y el archivo lleva 2,5 meses ahí sin que nadie lo importe.

- `rs_weekly_items` / `lib/globalRs.js` / `/api/rs-weekly`. Caso mixto,
  documentado ya en `docs/adr-rs-universo-us.md` §A.1 y reconfirmado aquí. La
  tabla **tiene datos** `[VERIFICADO]`:
  ```
  supabase_query(table: "rs_weekly_items", select: "symbol", limit: 3)
  → [{"symbol":"NOKIA.HE"}, {"symbol":"STMPA.PA"}, {"symbol":"BESI.AS"}]
  ```
  (símbolos europeos, consistente con lo que ya decía ese ADR: el único run
  real no calculó RS sobre acciones estadounidenses). El **lector** sí sigue
  vivo: `readGlobalRsSeriesForSymbol` lo usa `app/api/company-brief/route.js:1475`,
  que es una ruta que el producto sí llama. El que está muerto es el endpoint
  envoltorio `/api/rs-weekly`, y el **escritor** nunca existió dentro de la app
  (solo `scripts/rs-universe.mjs`, manual).

**Nunca se usó (creado y abandonado en el mismo empujón):** todos con 1-2
commits y ninguno posterior `[VERIFICADO]`:

```
lib/esef.js                        → 45a9a5b (2026-05-26), 1 commit
lib/jquants.js                     → cbd197b (2026-05-18), 1 commit
lib/fmp.js                         → cbd197b (2026-05-18), 2 commits
app/api/symbol-resolve/route.js    → 3bf2d97 (2026-05-17), 1 commit
app/api/rs-weekly/route.js         → 45a9a5b (2026-05-26), 1 commit
lib/postDeployObservability.js     → b2551c9 (2026-06-22), 1 commit
lib/sec.js (fetchSecTickerMap)     → bae2d11 (2026-05-16), cadena introducida y nunca tocada
```

Patrón claro: **casi todo lo huérfano nace entre el 16 de mayo y el 22 de junio
de 2026** — la fase de exploración de proveedores del proyecto — y no se volvió a
tocar. No es deuda acumulada por erosión; es un banco de trabajo de mayo que
nunca se recogió.

**Hito 1B** es el único caso distinto: es reciente (17-23 de julio), grande, y
está **deliberadamente** aparcado con su decisión escrita
(`docs/adr-hito-1b-diferido.md`). No es lo mismo que lo de mayo.

---

## PARTE B — Lo dimensionado para otra escala

### B.1 — El tope que corta el universo por debajo de su tamaño real

Este es el hallazgo más concreto de esta parte.

`[VERIFICADO]` — cita literal, `lib/serverScanRunner.js:40`:
```js
export const MAX_SYMBOLS = 10000;
```
Se aplica en `normalizeSymbols` (`lib/serverScanRunner.js:92`):
```js
    if (out.length >= MAX_SYMBOLS) break;
```
Es decir: **si el cliente pide escanear más de 10.000 símbolos, el servidor tira
los sobrantes en silencio** — sin error, sin aviso; la lista simplemente se
corta.

El universo real ya lo supera `[VERIFICADO]`:
```
supabase_query(table: "universe_snapshots", select: "cache_key,source,total_count,updated_at",
               order: "updated_at.desc", limit: 20)
→ "universe:AT,AU,BE,BR,CA,CH,CN,DE,DK,ES,FI,FR,GB,HK,IE,IL,IN,IT,JP,KR,MX,NL,NO,PT,SE,SG,TW,US,ZA|…"
    total_count 11469  (2026-08-11)
→ "universe:AU,CA,HK,JP,SG,TW,US,ZA"  total_count 11983  (2026-08-10)
→ "universe:HK,US"                    total_count  9870  (2026-08-11)
```
**11.983 símbolos frente a un tope de 10.000.** Y los escaneos interactivos
recientes se paran justo debajo del techo `[VERIFICADO]`:
```
supabase_query(table: "scans", select: "id,local_id,preset,row_count,created_at",
               order: "created_at.desc", limit: 25)
→ row_count 9922, 9922, 9920, 9920, 8578, …  (los cinco escaneos grandes del 10-11 de agosto)
```
`[SUPUESTO]` — que esos 9.922 sean exactamente "10.000 menos los que fallaron";
no verifiqué el desglose. Pero el patrón (varios escaneos distintos parándose en
9.920-9.922 con un universo de 11.469-11.983) es coherente con un corte en
10.000, no con el tamaño real del universo.

**Qué asumía**: que 10.000 era un número redondo holgadamente por encima del
universo. Cuando se escribió, lo era. Hoy no.

### B.2 — Los topes del cron: dimensionados por el reloj de Vercel, no por el producto

`[VERIFICADO]` — cita literal, `lib/cronPlan.js:21-70`:
```js
export const SCAN_CRON_GROUPS = [
  { key: "core-us-hk-au", title: "Core US/HK/AU", markets: ["US", "HK", "AU"], limit: 12, perMarket: 4 },
  { key: "europe-priority", title: "Europe priority", markets: ["EU1"], limit: 24, perMarket: 3 },
  { key: "europe-secondary", title: "Europe secondary", markets: ["EU2"], limit: 21, perMarket: 3 },
  { key: "asia-japan", title: "Asia Japan", markets: ["JP"], limit: 24, perMarket: 24 },
  { key: "asia-taiwan", title: "Asia Taiwan", markets: ["TW"], limit: 20, perMarket: 20 },
  { key: "north-america-canada", title: "North America Canada", markets: ["CA"], limit: 24, perMarket: 24 },
  { key: "asia-singapore-africa", title: "Asia Singapore / Africa South Africa", markets: ["SG", "ZA"], limit: 24, perMarket: 12 },
];
```
Y el motivo, `app/api/cron/scan-refresh/route.js:13`:
```js
export const maxDuration = 60;
```

**Qué asumían estos números**: que cada invocación tiene 60 segundos y hay que
caber dentro. `limit: 12` con `perMarket: 4` significa **como mucho 4 símbolos
estadounidenses por invocación de ese grupo**, y con 7 grupos rotando una vez al
día, a EE.UU. le toca turno cada ~7 días. Para cubrir 5.600 símbolos
estadounidenses a ese ritmo harían falta años.

Esto ya está analizado en detalle en `docs/adr-escaneo-nocturno.md` §A.2, con
la misma conclusión, y es exactamente el problema que el proceso nocturno viene
a resolver. Lo repito aquí porque es el ejemplo canónico de "constante elegida
con otras cifras en mente": no se eligió `4` porque 4 sea la cifra correcta de
producto, se eligió porque es lo que cabe en 60 segundos.

Otros topes de la misma familia `[VERIFICADO]`, `lib/materializedScanner.js:57-68`:
```js
const DEFAULT_FUNDAMENTALS_AGE_DAYS = 14;
const DEFAULT_LIMIT = 40;
const DEFAULT_PER_MARKET = 10;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_SKIP_RECENT_SCAN_DAYS = 45;
const DEFAULT_RECENT_SCAN_MAX_ROWS = 5000;
const DEFAULT_MATERIALIZATION_LOOKBACK_DAYS = 90;
```
`DEFAULT_CONCURRENCY = 2` frente a los `5` del escaneo interactivo
(`lib/serverScanRunner.js:38`) y los `4` que `scripts/refresh-bars.mjs` usa en
producción sin incidentes: el `2` es una concesión al reloj de Vercel, no una
medida de lo que el proveedor tolera. `[SUPUESTO]`.

### B.3 — Topes de lectura por debajo del tamaño de un escaneo

Aquí el desajuste va en la dirección contraria: se lee menos de lo que hay.

`[VERIFICADO]` — `lib/leaderboards.js:9-12`:
```js
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;
const DEFAULT_SCAN_ROWS = 5000;
const DEFAULT_SCAN_READ_TIMEOUT_MS = 12000;
```
Y `lib/leaderboards.js:713-716`:
```js
export async function readScanRows({ maxRows = DEFAULT_SCAN_ROWS, sinceDays = 45, timeoutMs = DEFAULT_SCAN_READ_TIMEOUT_MS } = {}) {
  …
  const limit = Math.min(Math.max(Number(maxRows || DEFAULT_SCAN_ROWS), 1), 10000);
```
Los rankings se construyen leyendo **5.000 filas** de escaneos que hoy tienen
**9.922** `[VERIFICADO], ver B.1`. `[SUPUESTO]` — que eso implique que los
rankings ignoran la mitad del universo: depende del orden en que PostgREST
devuelva las filas y de si el filtro previo ya reduce el conjunto por debajo de
5.000; no lo verifiqué.

`[VERIFICADO]` — `app/api/comparables/route.js:5-6`:
```js
const COMPARABLES_MAX_ROWS = 2500;
const COMPARABLES_PAGE_SIZE = 750;
```
La búsqueda de comparables mira 2.500 filas de un universo de ~12.000.

`[VERIFICADO]` — `lib/materializedScanner.js:62`:
```js
const DEFAULT_RECENT_SCAN_MAX_ROWS = 5000;
```
La lectura de "qué se escaneó recientemente" (que alimenta la priorización del
cron) también se corta en 5.000.

### B.4 — Topes dimensionados para varios usuarios cuando hay uno

`[VERIFICADO]` — `lib/screenerConfig.js:41-48`:
```js
const DEFAULT_RESULT_PAGE_SIZE = 50;
const DEFAULT_SCAN_BATCH_SIZE = 100;
const SERVER_SCAN_POLL_MS = 2000;
const USER_TEMPLATE_LIMIT = 18;
```

Y toda la maquinaria de exclusión mutua del Hito 1B (lease fencing, bloqueo
advisory no bloqueante, epochs) es el caso extremo: 2.239 líneas de SQL para
arbitrar ejecutores concurrentes cuando hay **un solo `owner_id`**
(`DEFAULT_OWNER = "personal"` en `lib/supabaseServer.js`) y un cron en serie.
Esto ya está razonado en `docs/adr-hito-1b-diferido.md` §4; lo listo aquí para
completar el inventario, no para reabrirlo.

### B.5 — Topes que NO son de escala y conviene no confundir

`[VERIFICADO]` — `lib/scanPercentileFinalization.js:83,107,136`:
```js
export const FINALIZE_MAX_ROWS = 50000;
export const FINALIZE_PATCH_BATCH_SIZE = 100;
export const FINALIZE_READ_BATCH_SIZE = 50;
```
El troceo en tandas de 100 y 50 **no** viene de la escala del universo: viene
del `statement_timeout` de 8 segundos del rol `authenticator` de Supabase,
documentado en el propio comentario del archivo (`lib/scanPercentileFinalization.js:16-23`):
```
// ESCRITURA EN TANDAS (...): hasta aquí, un scan de 9.920 filas moría con
// "canceling statement due to statement timeout" (límite de 8s del rol
// authenticator) porque finalize_scan_results aplicaba las 9.920 filas en
// un ÚNICO UPDATE
```
Ese límite es de la base de datos, no del sitio desde el que se llame. Cambiar
de Vercel a un proceso nocturno **no lo elimina**. Ver Parte C.

---

## PARTE C — Lo que sobra con el diseño nuevo

Recordatorio del diseño decidido: **un solo cálculo nocturno del universo,
idéntico para todos; el usuario guarda filtros que se aplican sobre lo ya
calculado, no lanza escaneos propios.**

La distinción crítica que pide el enunciado —y que es fácil de equivocar— es
esta:

> El proceso nocturno **también tiene que analizar símbolos**. Lo que desaparece
> no es el análisis: es el andamiaje que existe *porque un usuario está mirando
> una pantalla mientras el análisis ocurre*.

### C.1 — Lo que sobra del todo (existe solo porque hay alguien esperando)

| Pieza | Dónde | Líneas | Por qué sobra |
|---|---|---|---|
| **Encadenamiento por eslabones** | `lib/serverScanRunner.js` + `app/api/scan/continue/route.js` | 585 + 84 | Existe para no rebasar `maxDuration=300` de Vercel. Un proceso nocturno no tiene reloj de invocación. |
| **Tramos (`chunkSize`)** | `lib/serverScanRunner.js:55-57,97-101` | — | Ídem: trocear el trabajo en pedazos que quepan en una lambda. |
| **Token de eslabón + retoma de eslabón muerto** | `lib/serverScanRunner.js:58,242-255`, `app/api/scan/continue/route.js:1-8` | — | Existe para reanudar cuando una lambda muere a mitad. |
| **Progreso en vivo** | `settings.progress` completo + polling cada 2s | — | Nadie mira una barra de progreso a las 3 de la mañana. |
| **Cancelación** | `app/api/scan/cancel/route.js` + `readCancelRequested` | 49 + ~30 | Existe para que el usuario pueda parar lo que él lanzó. |
| **Grupos de errores topados** | `lib/scanErrorGroups.js` | — | Topados para no reescribir 48 KiB en cada latido de progreso; sin latidos, el tope pierde su motivo. |
| **Etiqueta de resultado al usuario** | `classifyScanOutcome`, `scanOutcomeLabel` (`lib/scanStatus.js:123-150`) | ~30 | "Cancelado · N filas conservadas" no aplica a un proceso sin usuario. |

Citas literales de las piezas más caras `[VERIFICADO]`:

`lib/serverScanRunner.js:1-5` — la descripción del mecanismo entero:
```js
// lib/serverScanRunner.js — runner por eslabones del scan en servidor.
// Cada invocación (eslabón) procesa como máximo progress.chunkSize símbolos desde
// progress.cursor, con concurrencia 5, y persiste en scan_results por lotes de 50;
// si quedan pendientes, se auto-reencadena con un fetch interno a POST
// /api/scan/continue autenticado con el token del proxy.
```

`app/api/scan/continue/route.js:1-8` — las dos vías de reanudación:
```js
// POST /api/scan/continue — ejecuta el siguiente eslabón de un scan encadenado.
// Dos vías de entrada:
//  1) Cadena normal: el eslabón anterior pasa { scanId, linkToken } y el token debe
//     coincidir con settings.progress.nextLinkToken (uso único, CAS al reclamar).
//  2) Retoma de eslabón muerto: sin token válido, solo si el scan sigue "running"
//     y su updated_at (heartbeat, se refresca cada ~1.5s) tiene más de 10 minutos.
```

`app/api/scan/cancel/route.js:1-4`:
```js
// POST /api/scan/cancel — solicita la cancelación de un scan en servidor.
// Valida que el scan existe y sigue en curso, y escribe
// settings.progress.cancelRequested = true; el runner de /api/scan relee ese flag
// al inicio de cada lote de persistencia y termina limpio marcando "cancelled".
```

**Coste añadido que no es solo líneas** `[VERIFICADO]`: el flag de cancelación
se relee **dos veces por lote** contra Supabase, y hay comentarios de código
dedicados a explicar por qué (`lib/serverScanRunner.js:379-397`). Es
complejidad que cuesta entender, no solo mantener.

### C.2 — Lo que NO sobra: solo cambia de sitio

Esto es lo que el proceso nocturno **sigue necesitando**, íntegro:

| Pieza | Dónde | Por qué se queda |
|---|---|---|
| **El motor de análisis** | `buildResearchRow` (`lib/researchRow.js`), `lib/materializedScanner.js:372-497` | Es lo que calcula la fila. Sin él no hay nada que filtrar. |
| **Selección del universo** | `resolveSymbols`/`selectUniverseRows` (`lib/materializedScanner.js:884-1205`) | Sigue habiendo que decidir qué símbolos se analizan. |
| **Caché de barras y perfil** | `withDailyBarsCache`, `withProfileCache` | Es lo que evita pedirle 12.000 veces el precio a Yahoo. |
| **Escritura por lotes** | `writeMaterializedScan` (lotes de 300), `RESULT_BATCH_SIZE = 50` | El troceo de escritura no es por el reloj de Vercel: es por el tamaño de la petición a PostgREST. |
| **Cálculo de percentiles** | `sectorize()`, `enrichRelativePercentiles` | Se queda, y de hecho **mejora**: con todo el universo en una corrida, el "lote" y "la población completa" pasan a ser lo mismo (razonado en `docs/adr-escaneo-nocturno.md` §C.10). |
| **Troceo de la finalización** | `FINALIZE_PATCH_BATCH_SIZE=100`, `FINALIZE_READ_BATCH_SIZE=50` | **No se puede quitar**: es el límite de 8s de Postgres (Parte B.5), no el de Vercel. |
| **Filtros del screener** | `lib/screenerFilters.js`, `lib/screenerFilterCatalog.js` | Es exactamente lo que el diseño nuevo pone en el centro. |
| **Plantillas de filtro guardadas** | `savedFilterTemplates` (`app/page.jsx:385,951-980`), `USER_TEMPLATE_LIMIT = 18` | Ya existe. Es la pieza sobre la que se apoya el diseño nuevo, no algo a construir. |

`[VERIFICADO]` — que las plantillas de filtro ya existen en la UI:
```
app/page.jsx:385:  const [savedFilterTemplates, setSavedFilterTemplates] = useState([]);
app/page.jsx:960:  const next = [template, ...savedFilterTemplates.filter((item) => item.id !== targetId)].slice(0, USER_TEMPLATE_LIMIT);
```

### C.3 — Lo que queda en zona gris

- **`GET /api/scan?id=&offset=`** (`app/api/scan/route.js:93-148`) — hoy sirve
  el estado + resultados incrementales del escaneo en vivo. Con el diseño nuevo,
  el equivalente ("dame las filas de lo calculado anoche") ya existe:
  `GET /api/scans`. `[SUPUESTO]` — que uno pueda sustituir al otro; no comparé
  las dos respuestas campo a campo.
- **`/api/scan-coverage` y `/api/coverage` + `lib/coveragePlan.js`** (1.032
  líneas entre los tres). Miden "cuánto del universo se ha escaneado". Con un
  proceso nocturno que cubre el universo entero cada noche, esa pregunta cambia
  de "¿cuánto llevamos?" a "¿corrió anoche, sí o no?". `[SUPUESTO]` — no
  verifiqué qué parte de esas 1.032 líneas sobreviviría a esa simplificación.
- **El cursor por mercado** (`scan-refresh-cursor` en `app_settings`,
  `lib/materializedScanner.js:70-71`). `[VERIFICADO]` — sigue vivo y se actualizó
  anoche (consulta de A.2: `setting_key: "scan-refresh-cursor"`,
  `updated_at: "2026-08-10T22:28:00.161+00:00"`). Deja de tener sentido para
  cualquier mercado que el proceso nocturno cubra de una vez, y lo sigue
  teniendo para los que se queden en Vercel. Ya señalado en
  `docs/adr-escaneo-nocturno.md` §E.15.

---

## PARTE D — Los campos que nadie lee

**Nota metodológica importante, léela antes que los números.** No existe forma
mecánica y exacta de saber si un campo "se lee". El código no hace
`row.metrics.miCampo` casi nunca: `scanDecisionRowFromDb`
(`lib/scanDecisionProjection.js:144-149`) **aplana** `raw` y `metrics` en un solo
objeto, y a partir de ahí todo el mundo lee `row.miCampo`. Cita literal
`[VERIFICADO]`:
```js
  const raw = objectOrEmpty(item.raw);
  const metrics = objectOrEmpty(item.metrics);
  const row = {};
  assignPresent(row, raw);
  assignPresent(row, metrics);
```
Lo que hice, por tanto, es buscar el **nombre** de cada campo en la capa que
consume filas (126 archivos: todo `app/**` salvo el escritor
`app/api/scans/route.js`, más `lib/screener*`, `lib/leaderboards.js`,
`lib/comparables.js`, `lib/cachedScreenerRows.js`, `lib/stockRows.js`,
`lib/methodology*`, `lib/decisionAudit.js`, `lib/coveragePlan.js`,
`lib/objectiveMetricTruth.js`, `lib/trendStructure.js`, `lib/vcpDiagnostics.js`).

Esta heurística **sobre-cuenta el consumo**: si el nombre aparece por cualquier
motivo, cuenta como leído. Por eso el número de "leídos" es una **cota
superior** y el de "no leídos" es un suelo bastante sólido.

### D.1 — `raw`: 264 campos, 39 sin ningún lector

`[VERIFICADO]` — fila real de producción, la mejor clasificada del escaneo
interactivo más reciente:
```
supabase_query(table: "scan_results", select: "symbol,raw",
               filter: "scan_id=eq.ad3da299-a758-4257-afc1-f935828217fe&rank_index=eq.1",
               limit: 1)
→ symbol "8035.T" (Tokyo Electron), raw con 264 claves de primer nivel
```
El enunciado decía 263; medí **264** en esta fila concreta. La diferencia de una
clave es irrelevante para la conclusión y se explica por variación entre filas
(campos como `rejectedContractionSwing` solo existen si hubo un rechazo).
Control de calidad de mi transcripción `[VERIFICADO]`: las 264 claves salieron
ordenadas por longitud creciente, que es el orden en que Postgres almacena
`jsonb`; comprobé que mi lista mantiene ese orden sin un solo salto, lo que
descarta que me saltara bloques.

**Resultado:**

| | Campos |
|---|---|
| Total en la fila real | **264** |
| Aparecen en al menos un consumidor | **225** (85 %) |
| **No aparecen en ningún consumidor** | **39** (15 %) |
| …de esos 39, ni siquiera aparecen en el escritor de `/api/scans` | 14 |

Desglose por dónde aparecen `[VERIFICADO]`: 122 se mencionan en algún componente
de interfaz (`.jsx`), 57 en alguna ruta de API distinta de `/api/scans`, y 107
**solo** en el bloque que construye el payload de `/api/scans` (es decir: se
escriben, se copian, y ahí acaba su recorrido).

Los 39 sin lector, íntegros `[VERIFICADO]`:
```
sma10w, atr20Pct, atr50Pct, baseDays, avgVolume10, avgVolume50, weeklyFastMa,
weeklySlowMa, baseReturnPct, rsCompositeRaw, tightnessScore, benchmarkPerf1m,
priorUptrendPct, tightness15dPct, weeklyBaseWeeks, weeklyStageWeek,
baseNewHighCount, basePivotAgeBars, lateBaseDepthPct, patternTimeframe,
rsBenchmarkIssue, weeklySlopeWeeks, baseNearPivotDays, earlyBaseDepthPct,
latestVolumeRatio, rsBenchmarkSample, weeklyNearHighPct, weeklySlowMaSlope,
marginalHighBreaks, middleBaseDepthPct, weeklyBaseDepthPct, rsBenchmarkAvailable,
weeklyDistanceFastMa, weeklyDistanceSlowMa, rangeCompressionRatio,
volatilityCompression, latestCloseLocationPct, measuredContractionSwings,
meaningfulContractionMinPct
```
Se agrupan en tres familias reconocibles: métricas semanales (`weekly*`),
geometría de la base (`base*`, `*BaseDepthPct`, `contraction*`) y diagnóstico
del benchmark de RS (`rsBenchmark*`). `[SUPUESTO]` — que sean cálculos
intermedios que en su día alimentaron una vista que ya no existe; no rastreé
cada uno en el historial.

### D.2 — `metrics`: depende de quién escribiera la fila

Aquí hay un matiz que el enunciado no recoge y que cambia la respuesta: **hay
dos formas distintas de `metrics` conviviendo en la misma tabla.**

**Forma A — escaneo interactivo (`lib/serverScanRunner.js:120`)**: `metrics:
scanDecisionMetrics(preparedRow)`, la lista explícita de
`lib/scanDecisionProjection.js:42-125`.

`[VERIFICADO]` — **78 claves** (el enunciado dice 77; la diferencia es
`marketCap`, añadida después de la auditoría de agosto que fijó esa cifra —
`lib/scanDecisionProjection.js:50`).

| | Campos |
|---|---|
| Total | **78** |
| Aparecen en algún consumidor | **77** |
| No aparecen | **1** (`rsCompositeRaw`) |
| Leídos **explícitamente** como `metrics.<campo>` | **21** |

Los 21 que se leen por su nombre completo `[VERIFICADO]`: `totalScore`,
`objectiveScore`, `marketCap`, `rsGlobalPct`, `rsRating`, `rsCountryPct`,
`rsSectorPct`, `riskRewardScore`, `liquidityScore`, `setupQualityScore`,
`setupDisplayPlanValid`, `setupDisplayActionable`, `setupDisplayStrict`,
`setupDisplayWatch`, `setupDisplayDataLimited`,
`setupDisplayBlocksPatternClaim`, `methodologyBlocksPatternClaim`,
`weaknessScore`, `extSma50`, `compositeScore`, `objectiveMetricAudit`.

**Forma B — cron materializado (`lib/materializedScanner.js:1358-1526`)**: la
misma base **más un overlay de 166 claves añadidas a mano**, cada una con su
`?? null`.

`[VERIFICADO]` — conté las claves del overlay directamente sobre el código:
**166**, que unidas a las 78 dan **201 claves distintas**. Esto corrobora de
forma independiente la medición sobre datos reales de
`docs/proyeccion-metrics-2026-08-05.md` §B.5, que contó **200 claves** en filas
de producción del 4 de agosto (la diferencia de 1 es de nuevo `marketCap`).

| | Campos |
|---|---|
| Total (unión) | **201** |
| Aparecen en algún consumidor | **183** |
| No aparecen | **18** |

Los 18 sin lector `[VERIFICADO]`: `atr20Pct`, `atr50Pct`, `baseNearPivotDays`,
`baseNewHighCount`, `basePivotAgeBars`, `baseReturnPct`, `earlyBaseDepthPct`,
`lateBaseDepthPct`, `marginalHighBreaks`, `meaningfulContractionMinPct`,
`measuredContractionSwings`, `middleBaseDepthPct`, `priorUptrendPct`,
`rangeCompressionRatio`, `rsBenchmarkAvailable`, `rsBenchmarkIssue`,
`rsBenchmarkSample`, `rsCompositeRaw`. Son un subconjunto exacto de los 39 de
`raw` — la misma familia de campos, escrita dos veces.

### D.3 — Lo que estos números significan en llano

- De los ~264 datos que se guardan por acción, **unos 40 no los mira nadie,
  nunca**, ni la pantalla ni ninguna ruta interna.
- De los que sí se miran, **166 se guardan dos veces** en las filas del cron:
  una en `raw`, otra en `metrics`. No es un error de funcionamiento —el
  producto no se rompe— pero significa que cada fila pesa aproximadamente el
  doble de lo necesario en esos campos.
- Con 9.922 filas por escaneo interactivo y varios escaneos al día
  `[VERIFICADO]`, en una instancia Micro que ya se ha saturado dos veces esta
  semana, ese "el doble" no es teórico.

**No propongo quitarlos.** El enunciado lo pide explícitamente y además hay un
motivo real para no hacerlo a ciegas: `docs/proyeccion-metrics-2026-08-05.md`
§B.6 documenta que varias rutas leen `metrics` **sin** pedir `raw`
(`app/api/comparables/route.js`, `readRecentlyScannedSymbols`), y funcionan hoy
precisamente porque el overlay del cron rellena lo que `scanDecisionMetrics` no
lleva.

---

## PARTE E — El juicio

### E.1 — Clasificación

**MUERTO** — no se usa y no se usará con el diseño actual ni el nuevo:

| Hallazgo | Evidencia | Parte |
|---|---|---|
| `lib/listsSeedData.js` (363 líneas) | Consumidor eliminado en `1971c76` (2026-05-27); ningún importador desde entonces | A.3, A.6 |
| `app/api/symbol-resolve/route.js` | Cero referencias en todo el repo, ni siquiera en docs | A.4 |
| `app/api/jobs/leaderboards-refresh` y `app/api/jobs/universe-refresh` | Duplican crons programados que sí corren | A.4 |
| `rs_weekly_runs` en la lista blanca del MCP | La tabla no existe (404 de PostgREST) | A.1 |
| Entradas de catálogo Finnhub / Twelve Data / Marketstack / EODHD | Declaradas `planned-premium-candidate`, sin una línea de `fetch` | A.5 |
| `company_profiles` (tabla) | Solo aparece en dos inventarios de diagnóstico; ninguna lectura ni escritura | A.1 |
| `/api/rs-weekly` (el endpoint, no el lector `lib/globalRs.js`) | Cero llamadas; el lector sí lo usa `company-brief` | A.4, A.6 |
| Los 39 campos de `raw` sin lector | Grep sobre 126 archivos de la capa de consumo | D.1 |

**DORMIDO** — no se usa hoy pero resuelve un problema futuro real y está
documentado como tal:

| Hallazgo | Señal de despertar | Parte |
|---|---|---|
| Hito 1B completo (2.239 líneas SQL diferidas + 2.188 de migraciones + ~1.821 de tests + `lib/scanResultSetIntegrityContracts.js`) | Las 4 señales de `docs/adr-hito-1b-diferido.md` §6: segundo `owner_id` real, ejecuciones solapadas, escrituras parciales observadas, concurrencia cron↔interactivo | A.1, B.4 |
| `lib/jquants.js` (308) + `/api/jquants` + `/api/jobs/jquants-refresh` | Contratar J-Quants; Japón sigue en modo curado hasta entonces (`lib/coveragePlan.js:21`) | A.5 |
| `lib/fmp.js` (236) | Contratar FMP como capa premium de fundamentales | A.5 |
| `lib/esef.js` (364) + `/api/jobs/esef-refresh` | Fundamentales europeos vía ESEF | A.4, A.6 |
| `lib/sec.js` — `fetchSecTickerMap`, `cikForTicker` | Fundamentales US vía EDGAR | A.3 |
| `lib/rcReadinessRuntime.js` + `lib/postDeployObservability.js` (462 juntas) | Son el arnés de auditoría post-despliegue; se usan a mano, no en el producto | A.3 |

**VIVO PERO MAL DIMENSIONADO** — se usa, pero su diseño asume otra escala:

| Hallazgo | Valor actual | Qué asumía | Parte |
|---|---|---|---|
| `MAX_SYMBOLS = 10000` (`lib/serverScanRunner.js:40`) | 10.000 | Que el universo cabía holgadamente debajo. Hoy hay 11.983 y **se cortan en silencio** | B.1 |
| `SCAN_CRON_GROUPS` — `limit: 12, perMarket: 4` para US | ≤4 símbolos US cada ~7 días | Que cabía en `maxDuration = 60` | B.2 |
| `DEFAULT_CONCURRENCY = 2` (`lib/materializedScanner.js:60`) | 2 | El reloj de Vercel, no la tolerancia del proveedor (el interactivo usa 5; `refresh-bars` usa 4 en producción) | B.2 |
| `DEFAULT_SCAN_ROWS = 5000` (`lib/leaderboards.js:11`) | 5.000 | Escaneos más pequeños que los 9.922 de hoy | B.3 |
| `COMPARABLES_MAX_ROWS = 2500` (`app/api/comparables/route.js:5`) | 2.500 | Ídem | B.3 |
| `DEFAULT_RECENT_SCAN_MAX_ROWS = 5000` (`lib/materializedScanner.js:62`) | 5.000 | Ídem | B.3 |
| Overlay de 166 claves duplicadas en `metrics` del cron | 201 claves vs 78 | Dos escritores que crecieron por separado | D.2 |
| Toda la maquinaria de eslabones/tramos/progreso/cancelación (~1.737 líneas) | — | Que el escaneo lo lanza un usuario mirando la pantalla | C.1 |

**INCIERTO** — no puedo determinarlo con lo que tengo:

| Hallazgo | Por qué no puedo cerrarlo |
|---|---|
| `scan_symbol_history` (222 líneas + tabla que crece desde el 29-jul) | Escritores confirmados, lector cero. Podría ser deuda muerta, o el cimiento deliberado de una función de historial aún no construida. No hay ADR que lo diga. |
| `market_health_cache` sin refrescar desde el 20-jun | No sé si es un fallo silencioso o una función retirada a propósito |
| `/api/scan-coverage`, `/api/coverage`, `lib/coveragePlan.js` (1.032 líneas) | Se usan hoy; cuánto sobreviviría al diseño nuevo depende de decisiones de producto no tomadas |
| Estado real de las claves de proveedor **en producción** | Solo veo `.env.local`; Vercel Project Settings no es accesible desde aquí |
| `favorite_snapshots`, `leaderboard_snapshots`, `leaderboard_items`, `notes`, `alerts` | Tienen código que las lee y escribe, pero **no están en la lista blanca del MCP**, así que no pude comprobar si tienen filas |
| Los 9 exports huérfanos de `lib/screenerPipeline.js` | Módulo muy central; un falso positivo aquí sería caro. La heurística de grep no distingue "sin consumidor" de "consumido por un nombre construido dinámicamente" |

### E.2 — Orden por coste de mantenimiento

Ordenado de mayor a menor coste combinado (líneas + complejidad conceptual +
riesgo de confundir a quien lea). El coste **no** es una recomendación de
retirada: el Hito 1B encabeza la lista y su decisión ya está tomada en sentido
contrario.

1. **Hito 1B — ~6.250 líneas** (2.239 SQL diferido + 2.188 migraciones + ~1.821
   tests). Coste de complejidad máximo: lease fencing, hashes canónicos,
   bloqueos advisory. Riesgo de confundir: **demostrado dos veces** — el
   incidente de producción del 29-30 de julio y la nota
   `docs/note-hito-1b1-rpc-service-role-inaccesible-2026-07-30.md`, ambos
   causados por su *presencia*, no por su uso. Ya mitigado al moverlo a
   `supabase/deferred/`. **DORMIDO.**

2. **Maquinaria de escaneo por eslabones — ~1.737 líneas**
   (`serverScanRunner` 585, `scanPercentileFinalization` 531, `scanStatus` 150,
   `/api/scan` 148, `/api/scan/continue` 84, `/api/scan/cancel` 49, más
   `scanErrorGroups`). Complejidad alta y densa: tokens de un solo uso, CAS,
   heartbeat, relectura doble del flag de cancelación por lote. Es el bloque
   que el diseño nuevo más afecta — pero **solo en parte** (C.1 vs C.2).
   **VIVO PERO MAL DIMENSIONADO**, con partes que pasan a MUERTO en cuanto el
   nocturno esté.

3. **Cobertura — ~1.032 líneas** (`coveragePlan` 484, `/api/scan-coverage` 387,
   `/api/coverage` 161). Se usa hoy. **INCIERTO** bajo el diseño nuevo.

4. **Duplicación `raw`/`metrics` — 166 claves escritas dos veces por fila.** No
   son líneas de código sino bytes por fila, multiplicados por ~10.000 filas
   por escaneo en una instancia Micro. **VIVO PERO MAL DIMENSIONADO.**

5. **`/api/jobs/*` sin invocador — ~1.100 líneas** (`jobs/scan-refresh` 457 +
   `esef-refresh` 120 y su `lib/esef.js` 364 + `jquants-refresh` +
   `leaderboards-refresh` + `universe-refresh`). Coste bajo de complejidad,
   alto de confusión: son seis puertas que parecen operativas y no lo son.
   Mezcla de **MUERTO** (las que duplican crons) y **DORMIDO** (las de
   proveedores no contratados).

6. **Arnés de auditoría — 462 líneas** (`rcReadinessRuntime` 285 +
   `postDeployObservability` 177). Fuera del camino de producción, se invoca a
   mano. Coste de confusión moderado: viven en `lib/`, donde se espera código de
   producto. **DORMIDO.**

7. **`scan_symbol_history` — 222 líneas + una tabla que crece cada noche.** El
   coste no está en las líneas: está en que **escribe en una base saturada sin
   que nadie lea el resultado**. **INCIERTO.**

8. **`lib/listsSeedData.js` — 363 líneas.** Coste puramente de volumen: es un
   bloque de datos semilla sin lógica. **MUERTO.**

9. **Proveedores planned-premium — ~48 líneas** (4 entradas de catálogo).
   Coste casi nulo en código; el coste real es de *expectativa*: aparecen en la
   respuesta de `/api/data-providers` como si fueran parte del plan.
   **MUERTO** en el sentido de código, aunque su intención documental siga
   siendo válida.

10. **Residuos de una línea**: `rs_weekly_runs` en la lista blanca del MCP,
    `company_profiles` en dos inventarios de tablas requeridas. Coste
    despreciable, salvo que hacen mentir a dos inventarios que alguien podría
    creerse. **MUERTO.**

---

## CONFIANZA

**Alta — verificado leyendo código, con cita literal:**

- Las 250 exportaciones sin consumidor y los 4 módulos sin ningún importador de
  producción (script propio sobre los 129 archivos de `lib/`, heurística
  conservadora que sobre-cuenta el consumo).
- El mapa de las 48 rutas de API y cuáles no tiene invocador (conteo de
  referencias literales a `/api/<x>` en todo el repo, incluidos `vercel.json`,
  `.github/`, `docs/` y `scripts/`).
- Que Finnhub, Twelve Data, Marketstack y EODHD **no tienen adaptador**: solo
  entradas declarativas en `lib/dataProviders.js`.
- Que `scan_symbol_history` tiene tres escritores y **cero** lectores.
- Que `company_profiles` y `rs_weekly_snapshots` no se tocan desde `app/` ni
  `lib/`.
- Todos los valores de constantes citados en la Parte B (copiados literalmente
  de su archivo:línea).
- El reparto de la maquinaria de escaneo entre "sobra" y "cambia de sitio"
  (Parte C), basado en los comentarios de cabecera de cada archivo, que
  explican por qué existe cada pieza.
- El conteo de `metrics`: 78 claves en `scanDecisionMetrics`, 166 en el overlay
  del cron, 201 en la unión — contado sobre el código, y **corroborado de forma
  independiente** contra la medición sobre datos reales de
  `docs/proyeccion-metrics-2026-08-05.md` (200 claves, 4 de agosto).

**Alta — verificado consultando producción (solo lectura, consultas citadas):**

- Las cuatro tablas del Hito 1B siguen vacías (4 consultas, `limit: 3`).
- `scan_symbol_history` acumula desde el 2026-07-29 y sigue creciendo (última
  fila de anoche).
- `rs_weekly_runs` no existe (404 de PostgREST).
- `rs_weekly_items` contiene símbolos europeos, no estadounidenses.
- `market_health_cache` no se actualiza desde el 2026-06-20.
- El universo real está en 11.469-11.983 símbolos y los escaneos interactivos se
  paran en 9.920-9.922.
- La composición de `raw` en una fila real: 264 claves, con control de orden por
  longitud que descarta saltos en mi transcripción.

**Media — inferido, marcado como `[SUPUESTO]` en el punto correspondiente:**

- Que `company_profiles` esté vacía (no consultable con la herramienta
  disponible).
- Que los 9.922 del escaneo sean consecuencia directa del tope de 10.000.
- Que los rankings de leaderboards estén perdiendo información por
  `DEFAULT_SCAN_ROWS = 5000`.
- Que los 39 campos sin lector sean restos de vistas retiradas.
- Que `market_health_cache` haya dejado de escribirse (frente a "se escribe
  igual y no cambia").

---

## LO QUE NO HE VERIFICADO

- **El entorno de producción.** Todo lo dicho sobre claves de proveedor sale de
  `.env.local`. Las variables reales corren en Vercel Project Settings, que no
  es accesible desde esta sesión. Un proveedor marcado aquí como "sin
  configurar" podría estar configurado en producción, y viceversa. **Este es el
  punto ciego más importante de todo el documento.**
- **Cinco tablas que el producto sí usa** — `favorite_snapshots`,
  `leaderboard_snapshots`, `leaderboard_items`, `notes`, `alerts`, más
  `company_profiles` — **no están en la lista blanca del servidor MCP**
  (`scripts/mcp/supabase-readonly.mjs:26-33`), así que no pude comprobar si
  tienen filas. Cualquier afirmación sobre ellas es sobre el código, no sobre
  los datos.
- **El tamaño en bytes de `scan_results`** (los ~490 MB citados en sesiones
  anteriores). La clave de solo lectura no admite `pg_total_relation_size` ni
  ningún agregado. No lo confirmé ni lo desmentí.
- **Cuántas filas tiene cada tabla.** Sin `COUNT` no hay cifras; solo pude
  distinguir "vacía" de "no vacía" y ver las fechas extremas.
- **Si algún módulo huérfano se carga dinámicamente** (`import()` con nombre
  construido en tiempo de ejecución). No encontré ese patrón, pero no lo
  descarté exhaustivamente.
- **Si los 39 campos de `raw` sin lector se leen desde fuera de este repo** —
  por ejemplo, un cliente externo que llame a `GET /api/scans?projection=decision`.
  `docs/proyeccion-metrics-2026-08-05.md` §B.6 ya señalaba que esa proyección no
  tiene ningún invocador dentro del repo y podría estar reservada para un
  consumidor externo. No pude descartarlo.
- **Si `/api/scans` puede sustituir funcionalmente a `GET /api/scan?id=`** con
  el diseño nuevo. No comparé las dos respuestas campo a campo.
- **Qué parte de las 1.032 líneas de cobertura sobrevive al diseño nuevo.**
  Depende de decisiones de producto que aún no están tomadas.
- **Si `lib/screenerPipeline.js` usa realmente sus 9 exports huérfanos por
  alguna vía indirecta.** Es un módulo central; lo marqué INCIERTO en vez de
  MUERTO precisamente por eso.
- **Si `scan_symbol_history` está pensada para una función futura.** No hay ADR
  ni comentario que lo diga; la clasifiqué INCIERTO en vez de MUERTA para no
  cometer el falso positivo que el enunciado advierte que sería caro.
