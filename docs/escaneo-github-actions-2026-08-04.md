# Mover el escaneo a GitHub Actions — diseño y viabilidad (Fase 1, 2026-08-04)

BASE_SHA: a80caf2 · rama codex/statsedge-ui-polish. Continúa
`docs/universo-efectivo-2026-08-04.md` y `docs/universo-relevante-2026-08-04.md`
(no se repite lo ya verificado allí). Decisión ya tomada (no se cuestiona
aquí): mover el escaneo de Vercel a un workflow programado de GitHub
Actions. Esta auditoría es solo diseño/viabilidad — no se creó ningún
workflow ni script nuevo, no se modificó ningún archivo existente.

---

## PARTE A — Qué ejecutar

### 1. Punto de entrada actual

**No existe un script invocable desde línea de comandos para el
escaneo.** El único punto de entrada es la ruta de API
`app/api/cron/scan-refresh/route.js`:
```
import { scanCronGroupAt, scanCronGroupByKey } from "@/lib/cronPlan";
import { isInternalRequest } from "@/lib/internalAuth";
import {
  readScanBatchCursor,
  runMaterializedScan,
  writeMaterializedScan,
  writeScanBatchCursor,
} from "@/lib/materializedScanner";
import { writeScanSymbolHistory } from "@/lib/scanHistory";
import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
```
(`app/api/cron/scan-refresh/route.js:1-13`). `export async function
GET(request)` es lo único exportado que ejecuta el trabajo; no hay
`scripts/*.mjs` que importe `runMaterializedScan` (búsqueda:
`grep -rl "runMaterializedScan" scripts/` → sin resultados). Existe, eso
sí, precedente de scripts Node que importan piezas de `lib/materializedScanner.js`
sin pasar por Next.js: `scripts/pattern-detector-regression.mjs:7`
importa `latestScanStateFromRow` directamente desde
`"../lib/materializedScanner.js"` y se ejecuta con
`node --loader ./scripts/loader.mjs scripts/pattern-detector-regression.mjs`
(`package.json`, script `test:patterns`) — confirma que el archivo se
puede cargar fuera de Next.js sin romperse.

### 2. Qué haría falta para invocar el mismo trabajo desde un script Node

**Nada de `runMaterializedScan` (`lib/materializedScanner.js`) importa
`next/server`, `next/headers`, `next/cache` ni ningún otro paquete de
Next.js** — verificado con `grep -n "next/server\|next/headers\|next/cache"`
sobre `lib/materializedScanner.js`, `lib/universeEngine.js`,
`lib/universes.js`, `lib/yahoo.js`, `lib/supabaseServer.js`,
`lib/relativeStrength.js`, `lib/screenerFilters.js`: sin coincidencias. El
único uso de un API específica de Next en todo el camino del escaneo es
`after()` de `next/server`, y está en `app/api/scan/route.js:8,70`
(el camino UI, no el cron) — **el cron no lo usa**.

Lo que un script Node necesitaría replicar de `GET()` en
`app/api/cron/scan-refresh/route.js` (líneas 172-285, ya citadas en el
documento previo) es la orquestación, no el runtime:
1. Resolver el grupo/mercados/`limit`/`perMarket` (hoy viene de
   `scanCronGroupAt`/`searchParams`, en un script sería configuración
   directa).
2. `await readScanBatchCursor()` — lee `app_settings` vía
   `supabaseRequest` (HTTP directo a PostgREST, no depende de Next).
3. `await runMaterializedScan(options)` — el trabajo real.
4. `await writeMaterializedScan(result.scan)`,
   `await writeScanSymbolHistory(...)`,
   `await writeScanBatchCursor(...)` — todas usan `supabaseRequest`
   (`lib/supabaseServer.js`), que es `fetch()` nativo contra la REST API
   de Supabase, sin nada de Vercel/Next de por medio.

`Response.json(...)` (usado en el `return` de la ruta) es la única pieza
que es "envoltorio HTTP", y no haría falta en un script — el script
llamaría a las mismas funciones y terminaría el proceso, sin necesidad de
construir una `Response`. (`Response`/`fetch` como globals están
disponibles nativamente desde Node 18, así que aunque se reutilizara ese
código tal cual tampoco fallaría por falta del global.)

**Conclusión:** no hay nada atado a Next.js o al entorno de ejecución de
Vercel en la cadena `runMaterializedScan → writeMaterializedScan →
writeScanSymbolHistory → writeScanBatchCursor`. Un script Node que importe
esas cuatro funciones y las llame en el mismo orden que la ruta reproduce
el trabajo exacto de hoy.

### 3. Variables de entorno — citadas, no inventadas

Grep de `envValue("...")` / `process.env.XXX` sobre toda la cadena de
dependencias de `runMaterializedScan` (`lib/materializedScanner.js`,
`lib/universeEngine.js`, `lib/universes.js`, `lib/officialUniverses.js`,
`lib/asicShort.js`, `lib/fundamentalsCache.js`, `lib/dailyBarsCache.js`,
`lib/supabaseServer.js`, `lib/providerRuntimeStatus.js`,
`lib/internalAuth.js`, `lib/scanHistory.js`, `lib/leaderboards.js`,
`lib/markets.js`, `lib/micCodes.js`, `lib/yahoo.js`,
`lib/dataProviders.js`):

| Variable | Dónde se usa | Cita |
|---|---|---|
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | URL de Supabase | `lib/supabaseServer.js:11` |
| `SUPABASE_SERVICE_ROLE_KEY` | clave de escritura | `lib/supabaseServer.js:12` |
| `STATSEDGE_OWNER_ID` | owner_id de todas las filas (default `DEFAULT_OWNER` si falta) | `lib/supabaseServer.js:13` |
| `STOOQ_API_KEY` | fallback de chart si Yahoo falla | `lib/yahoo.js:10` |
| `ALPHA_VANTAGE_API_KEY` | segundo fallback de chart | `lib/dataProviders.js:290` |
| `HKEX_SECURITIES_LIST_URL` | override de URL, universo HK | `lib/officialUniverses.js:436` |
| `TWSE_ISIN_LIST_URL` | override de URL, universo TW | `lib/officialUniverses.js:502` |
| `JQUANTS_API_BASE_URL`, `JQUANTS_ID_TOKEN`, `JQUANTS_REFRESH_TOKEN`, `JQUANTS_API_KEY` | universo/auth JP | `lib/officialUniverses.js:540,556-578` |
| `ESMA_FIRDS_ENABLED`, `ESMA_FIRDS_MAX_FILES`, `ESMA_FIRDS_RESOLVE_LIMIT_PER_MARKET`, `ESMA_FIRDS_SCAN_RECORD_LIMIT`, `ESMA_FIRDS_REFERENCE_LIMIT_PER_MARKET`, `ESMA_FIRDS_FILE_PREFIX`, `ESMA_FIRDS_SEARCH_URL` | universo UE (13 mercados FIRDS) | `lib/officialUniverses.js:608-771`, `lib/universeEngine.js:38-43` |
| `FCA_FIRDS_ENABLED`, `FCA_FIRDS_MAX_FILES`, `FCA_FIRDS_RESOLVE_LIMIT_PER_MARKET`, `FCA_FIRDS_SCAN_RECORD_LIMIT`, `FCA_FIRDS_REFERENCE_LIMIT_PER_MARKET`, `FCA_FIRDS_FILE_PREFIX`, `FCA_FIRDS_SEARCH_URL` | universo GB | `lib/officialUniverses.js:631-816`, `lib/universeEngine.js:48-53` |
| `UNIVERSE_CACHE_READ_TIMEOUT_MS` | timeout de lectura de snapshot de universo (default 2500) | `lib/universeEngine.js:13` |
| `PROFILE_CACHE_READ_TIMEOUT_MS` | timeout de caché de perfiles (default 1500) | `lib/fundamentalsCache.js:6` |
| `DAILY_BARS_CACHE_READ_TIMEOUT_MS` | timeout de caché de barras diarias (default 1500) | `lib/dailyBarsCache.js:7` |
| `LEADERBOARD_CACHE_READ_TIMEOUT_MS` | timeout de lectura de leaderboards materializados (default 1500) | `lib/leaderboards.js:13` |
| `NASDAQTRADER_TIMEOUT_MS` | timeout de descarga del directorio de símbolos US | `lib/universes.js:281` (citado en el documento previo) |

**No se necesitan** `STATSEDGE_ACCESS_TOKEN`, `CRON_SECRET`,
`STATSEDGE_API_TOKEN`/`STATSEDGE_ADMIN_TOKEN` (`lib/internalAuth.js:37-40,68`)
**si el script llama a las funciones directamente** en vez de hacer una
petición HTTP a la ruta desplegada — esos tokens solo los consume
`isInternalRequest`, que es la puerta de la ruta HTTP, no algo que
`runMaterializedScan` compruebe internamente. Esto es relevante para el
diseño: **si en vez de importar las funciones se opta por que el workflow
haga `curl` contra `https://.../api/cron/scan-refresh` desplegado en
Vercel, el trabajo seguiría corriendo dentro de una función de Vercel y
seguiría atado a `maxDuration=60`** — la migración solo elimina esa
restricción si el código se ejecuta directamente en el runner de Actions,
no si Actions solo dispara la ruta existente por HTTP.

---

## PARTE B — Concurrencia

### 4. Dónde se fija hoy

```js
const DEFAULT_CONCURRENCY = 2;
```
(`lib/materializedScanner.js:59`, usado en
`runMaterializedScan`: `mapLimit(resolved.symbols, Number(options.concurrency
|| DEFAULT_CONCURRENCY), ...)`, línea 1680).

El valor efectivo lo fija cada invocador, con techo distinto en cada uno:
- Cron (`app/api/cron/scan-refresh/route.js:188`):
  `concurrency: numberParam(searchParams, "concurrency", 2, 1, 3)` — default
  2, **techo 3**.
- Endpoint interno `app/api/jobs/scan-refresh/route.js:22,83`:
  `const MAX_CONCURRENCY = 4;` ... `concurrency: numberParam(searchParams,
  "concurrency", 2, 1, MAX_CONCURRENCY)` — default 2, **techo 4**.

`mapLimit` (`lib/materializedScanner.js:662-674`) es un pool simple —
`Math.min(Math.max(limit, 1), items.length || 1)` workers concurrentes,
sin cola de prioridad ni control de ráfaga adicional.

### 5. Qué limita subirla — búsqueda de rate limits/throttling

**No se encontró ningún rate limit documentado del proveedor de datos
(Yahoo Finance) ni de Twelve Data en el código.** Búsqueda de
`429|rateLimit|rate_limit|RATE_LIMIT|throttle|Throttle|backoff|Backoff` en
todo `lib/` y `app/api/` (excluyendo tests): solo dos archivos, y ninguno
implementa throttling activo:

- `lib/scanErrors.js:1-27` **clasifica** errores 429/5xx como
  `"retryable"`, con este comentario explícito en el propio archivo:
  ```
  // "retryable": el siguiente reintento podría resolverse (timeouts, rate
  //   limits 429, 5xx transitorios, fetch failed, ECONNRESET, EAI_AGAIN).
  ```
  Pero la clasificación es solo para telemetría (`progress.errors`,
  `kindBreakdown`) — **no hay ningún reintento automático** implementado
  sobre esa clasificación en `analyzeOne`
  (`lib/materializedScanner.js:1319-1344`): si `fetchChartForScan`/
  `fetchProfileForScan` fallan, el símbolo se marca como rechazado y no se
  reintenta dentro de la misma corrida.
- `lib/screenerPipeline.js:201` solo usa el string `"rate"` para generar
  un mensaje de diagnóstico legible en la UI cuando el texto del error
  contiene "429"/"too many"/"rate" — tampoco implementa throttling.

No hay cabecera de API key para el chart/quote de Yahoo
(`fetchYahooChartDirect`, dentro de `lib/yahoo.js`, usa la API pública no
oficial de Yahoo Finance sin token) — es decir, no hay una cuota
contractual conocida que el propio proveedor comunique en el código; los
únicos límites que el repo SÍ modela son de sus fallbacks
(`STOOQ_API_KEY`, `ALPHA_VANTAGE_API_KEY`), y tampoco para esos hay lógica
de cuota, solo la clave en sí.

### 6. Conclusión sobre un valor "seguro" de concurrencia

**No hay evidencia en el código para estimar un valor seguro.** El único
dato empírico disponible (documentos previos) es que a concurrencia=2 el
tiempo medido por símbolo fue 3,46-8,24s (n=7 corridas), sin ningún error
`429` observado en las muestras de `scan_symbol_history`/`provider_runs`
consultadas hasta ahora — pero esa ausencia de 429 a concurrencia=2 **no
demuestra** que concurrencias más altas sean seguras: no se hizo ninguna
prueba a mayor concurrencia en este repo ni hay documentación de terceros
citada en el código. Cualquier cifra de concurrencia usada en la Parte C
de este documento es explícitamente **hipotética/paramétrica**, no una
recomendación.

---

## PARTE C — Qué escanear cada noche

### 7-8. `materializationPriorityForRow` completa y qué prioriza

```js
function materializationPriorityForRow(row = {}, options = {}) {
  const scanStateBySymbol = options.scanStateBySymbol instanceof Map ? options.scanStateBySymbol : new Map();
  const scanStateConfigured = options.scanStateConfigured !== false;
  const state = scanStateBySymbol.get(normalizeSymbol(row.symbol));
  const investability = universeInvestabilityPriority(row);
  if (!scanStateConfigured) {
    return {
      score: investability.score,
      reason: "unknown_scan_state",
      lastScanAgeDays: null,
      priorScanScore: null,
      priorSetupState: "",
      investabilityScore: investability.score,
      investabilityFlags: investability.flags,
    };
  }

  let score = investability.score;
  let reason = "stale_scan";
  if (!state) {
    score += 1000;
    reason = "never_scanned";
  } else if (state.recent) {
    score += 120;
    reason = "recent_scan";
  } else {
    score += 650;
    reason = "stale_scan";
    if (Number.isFinite(state.ageDays) && state.ageDays >= 180) score += 90;
    else if (Number.isFinite(state.ageDays) && state.ageDays >= 90) score += 50;
  }

  const planValid = state?.planValid ?? state?.actionable;
  if (planValid) {
    score += state.recent ? 80 : 260;
    reason = state.recent ? "recent_plan_valid" : "prior_plan_valid";
  } else if (state?.watch || state?.strict || state?.patternCandidate) {
    score += state.recent ? 45 : 160;
    reason = state.recent ? "recent_watch" : "prior_watch";
  }

  if (Number.isFinite(state?.totalScore)) {
    if (state.totalScore >= 75) score += state.recent ? 20 : 80;
    else if (state.totalScore >= 65) score += state.recent ? 10 : 45;
  }
  if (Number.isFinite(state?.qualityScore) && state.qualityScore >= 65) score += state.recent ? 8 : 28;

  return {
    score,
    reason,
    lastScanAgeDays: state?.ageDays ?? null,
    priorScanScore: state?.totalScore ?? null,
    priorSetupState: planValid ? "plan_valid" : state?.watch || state?.strict || state?.patternCandidate ? "watch" : state ? "scanned" : "never",
    priorSetupStateLegacy: planValid ? "actionable" : state?.watch || state?.strict || state?.patternCandidate ? "watch" : state ? "scanned" : "never",
    investabilityScore: investability.score,
    investabilityFlags: investability.flags,
  };
}
```
(`lib/materializedScanner.js:832-889`, cita literal completa.)

**Qué ordena:** dentro de cada mercado, `selectUniverseRows` ordena
`orderedRows` de mayor a menor `selectionPriorityScore`
(`lib/materializedScanner.js:1024-1026`), y el cursor recorre esa lista ya
ordenada desde `offset`. El orden resultante es (de mayor a menor
prioridad): nunca escaneado (+1000) > escaneado hace tiempo con plan válido
previo (+650+260=910) > escaneado hace tiempo sin señal (+650) >
escaneado recientemente con plan válido (+120+80=200) > escaneado
recientemente sin señal (+120) — modulado en todos los casos por
`investability.score` (fuente del dato + tipo de instrumento, puede restar
hasta -260 si parece SPAC/warrant/preferente).

**Con qué criterio, respondiendo Q8:** el campo `reason` lo deja explícito
en el propio nombre — es un mecanismo de **cobertura/frescura**
(`never_scanned`, `stale_scan`, `recent_scan`), no un predictor de "esto
va a ser candidato". El único componente que se acerca a "probabilidad de
ser candidato" es el bonus por `planValid`/`watch`/`totalScore alto` — pero
ese bonus **solo se activa para símbolos que YA se escanearon antes** (viene
de `state`, que sale de `scanStateBySymbol`, poblado por
`readRecentlyScannedSymbols` a partir de escaneos previos reales,
`lib/materializedScanner.js:1106-1203`). Para un símbolo nunca escaneado
(el 99%+ de US/HK hoy, documento previo) no hay ningún dato de
"probabilidad de ser candidato" disponible — el score de esos símbolos es
`investability.score + 1000`, y `investability.score` mide calidad de la
fuente/tipo de instrumento (¿es una acción común bien formada?), no
tendencia ni fuerza relativa. **Conclusión: sirve para priorizar cobertura
(qué no se ha visto / qué lleva más tiempo sin refrescarse) y, en segunda
instancia, para volver antes a lo que ya demostró ser prometedor — no
sirve para adivinar candidatos entre símbolos nunca vistos.**

### 9. Estrategias con 2.000 min/mes — cálculo

Base de cálculo: 4,58s/símbolo (medido, documentos previos, concurrencia
2). `runs/mes` para "semanal" = 4,33 (52 semanas / 12 meses).

**A concurrencia = 2 (sin cambios respecto al valor por defecto de hoy):**

| Estrategia | Símbolos/corrida | Corridas/mes | Min/corrida | Min/mes | Horas/corrida |
|---|---|---|---|---|---|
| Universo completo semanal (11.123) | 11.123 | 4,33 | 424,5 | **1.838** | **7,07h** |
| Candidatos diarios (~880, estimado con margen de error — doc previo) | 880 | 30 | 33,6 | **1.008** | 0,56h |
| Priorizado por antigüedad, ciclo de 30 noches sobre todo el universo (11.123/30 ≈ 371/noche) | 371 | 30 | 14,2 | **425** | 0,24h |

**Universo completo semanal a concurrencia=2 excede el tope de 6h/trabajo**
del contexto de partida (7,07h > 6h) — no cabría en un solo `job` de
Actions sin subir la concurrencia o partir el trabajo en varios jobs,
aunque el presupuesto de 2.000 min/mes casi alcanzase (1.838 < 2.000, con
poco margen para el resto de workflows del repo). Candidatos diarios y
priorizado-30-noches sí caben cómodamente en ambos topes a concurrencia=2.

**A concurrencia = 10 (hipotético, sin evidencia de que sea seguro — ver
B6):**

| Estrategia | Min/corrida | Min/mes | Horas/corrida |
|---|---|---|---|
| Universo completo semanal | 84,9 | 368 | 1,41h |
| Candidatos diarios | 6,7 | 202 | 0,11h |
| Priorizado, 30 noches | 2,8 | 85 | 0,05h |

A esta concurrencia hipotética las tres estrategias caben con margen
amplio tanto en minutos/mes como en el tope de 6h — pero, como se
estableció en B6, no hay evidencia en el repo de que concurrencia=10 sea
segura frente al proveedor de datos.

---

## PARTE D — Estado y reanudación

### 10. ¿Sigue teniendo sentido el cursor con un proceso que cubre todo de una vez?

El cursor (`app_settings.scan-refresh-cursor`, documento previo) existe
para resolver un problema específico: **una invocación no puede cubrir
todo el universo**, así que hace falta recordar dónde se quedó la anterior.
Si el nuevo proceso en Actions cubre el universo relevante completo (o
todo el universo bruto) **en una sola ejecución** (una estrategia tipo
"universo completo semanal" de la Parte C, en una sola corrida), **el
cursor por `offset` deja de tener trabajo que hacer dentro de esa
corrida** — no hay nada que "continuar" si se procesa todo de un tirón.

Pero el cursor no desaparece de golpe en ningún escenario:
- Si se adopta la estrategia "priorizado por antigüedad" (C9), el proceso
  sigue cubriendo un subconjunto cada noche, no el universo completo — ahí
  el cursor (o el mecanismo equivalente de `materializationPriorityForRow`,
  que ya versiona la prioridad usando el propio historial de
  `scan_results` en vez de un offset numérico) sigue siendo necesario.
- Incluso en "universo completo semanal", si la corrida se divide en
  varios `jobs` de Actions (por el tope de 6h, ver C9) hace falta algún
  mecanismo para que cada job sepa qué porción le toca — podría ser el
  mismo cursor por `offset`, o un particionado estático (p.ej. por
  mercado, como ya hace `SCAN_CRON_GROUPS`) que no necesita estado
  persistido entre ejecuciones. **Cuál de las dos opciones conviene es una
  decisión de diseño que esta auditoría no cierra** (la tarea pide no
  proponer arreglos concretos).

### 11. Si el trabajo falla a mitad, ¿qué pasa con lo ya escrito? ¿Es idempotente?

**Sí, las tres escrituras del cron son idempotentes por diseño, vía
upsert con `on_conflict`:**

```js
export async function writeMaterializedScan(scan = {}) {
  ...
  const [saved] = await supabaseRequest("scans", {
    method: "POST",
    query: "on_conflict=owner_id,local_id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{ ... }],
  });
  await supabaseRequest("scan_results", {
    method: "DELETE",
    query: `scan_id=eq.${encodeURIComponent(saved.id)}`,
  });
  for (let i = 0; i < rows.length; i += 300) {
    await supabaseRequest("scan_results", {
      method: "POST",
      prefer: "return=minimal",
      body: rows.slice(i, i + 300).map((row, offset) => scanResultPayload(row, saved.id, config.ownerId, i + offset, scan.settings || {})),
    });
  }
  ...
}
```
(`lib/materializedScanner.js:1607-1641`, cita literal completa salvo el
cuerpo interno del objeto `scans` ya citado en A2/A3.) El `local_id` que
determina el `on_conflict` se construye de forma determinista a partir de
mercados+fecha+offset+cantidad de símbolos
(`lib/materializedScanner.js:1706-1712`, ya citado en el documento
previo), así que **reintentar la misma corrida el mismo día produce el
mismo `local_id`** → upsert sobre la misma fila, y el `DELETE` previo al
bucle de inserción evita duplicar filas de `scan_results` en un reintento.

```js
const saved = await supabaseRequest("scan_symbol_history", {
  method: "POST",
  query: "on_conflict=owner_id,source_scan_id,mic_code,symbol",
  prefer: "resolution=ignore-duplicates,return=representation",
  body: inserts,
});
```
(`lib/scanHistory.js:211-216`.) Restricción `unique (owner_id,
source_scan_id, mic_code, symbol)` en el propio esquema
(`supabase/schema.sql:1426-1427`, ya citado en el documento anterior) — un
reintento con el mismo `source_scan_id` no duplica filas.

```js
export async function writeScanBatchCursor(value = {}) {
  ...
  const saved = await supabaseRequest("app_settings", {
    method: "POST",
    query: "on_conflict=owner_id,setting_type,setting_key",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{ owner_id: config.ownerId, setting_type: SCAN_CURSOR_SETTING_TYPE, setting_key: SCAN_CURSOR_SETTING_KEY, value, updated_at: new Date().toISOString() }],
  });
  ...
}
```
(`lib/materializedScanner.js:1794-1810`, cita literal.)

**Lo que NO es cierto es que sea "reanudable a mitad de escritura":** si
el proceso muere entre el `DELETE` (línea 1629-1631) y la última tanda de
`INSERT` del bucle de 300 en 300, un reintento del **mismo** `local_id`
vuelve a hacer `DELETE` de lo que sí llegó a insertarse y reinserta desde
cero — es "seguro reintentar" (no deja duplicados ni filas huérfanas),
pero no es "retoma desde donde se quedó": empieza el lote de escritura de
nuevo desde el principio de `rows`. Si el fallo ocurre ANTES de terminar
`analyzeOne` sobre todos los símbolos seleccionados (es decir, dentro de
`runMaterializedScan`, antes de llegar a `writeMaterializedScan`), no se
escribe nada — no hay checkpoint intermedio dentro del análisis en sí.

---

## PARTE E — Lo que no funcionaría igual fuera de Vercel

### 12. Comportamiento distinto fuera de Vercel

- **Alias `next: { revalidate: N }` en `fetch()`:** usado en
  `lib/universes.js:286` (`fetch(url, { headers: {...}, next: { revalidate: 86400 }, signal: timeout.signal })`,
  descarga del directorio NasdaqTrader). Esta opción es una extensión de
  Next.js al `fetch` global; en Node puro (runner de Actions) **no produce
  error, simplemente se ignora** — el `fetch` nativo de Node no reconoce
  `next.revalidate` y no cachea nada por su cuenta. Efecto: cada corrida
  del script en Actions volvería a descargar el directorio completo de
  NasdaqTrader (comportamiento distinto, no roto — hoy en Vercel esa
  caché de 24h tampoco se puede garantizar entre invocaciones serverless
  distintas salvo que compartan el mismo edge cache, así que el cambio
  real de comportamiento es menor de lo que parece a primera vista, pero
  no se verificó cuánto ahorra hoy esa caché en producción).
- **`app_settings`/Supabase-based caching (`getUniverseEngineSnapshot`,
  `withDailyBarsCache`, `withProfileCache`):** estos SÍ son caché propia
  contra Supabase, no dependen de Vercel/Next — deberían comportarse
  igual en Actions.
- **Memoria en proceso (`memoryCache` de `lib/universeEngine.js:20`, un
  `Map` module-level con TTL de 6h):** en Vercel, cada invocación
  serverless puede o no reutilizar la misma instancia caliente
  (comportamiento no garantizado, fuera del control del código). En un
  runner de GitHub Actions, cada job arranca un proceso Node nuevo desde
  cero — **este caché en memoria nunca tendría hit entre corridas**,
  siempre partiría frío. Esto es un cambio de comportamiento real y
  verificable por lectura de código (`const memoryCache = new Map();` a
  nivel de módulo, sin persistencia), no una suposición.
- **Variables de entorno:** en Vercel se inyectan vía el dashboard/
  `vercel env`; en Actions habría que declararlas como `secrets`/`vars`
  del repositorio o del workflow — mecanismo distinto, mismo efecto neto,
  no afecta al código en sí (`envValue()` sigue leyendo
  `process.env[key]` igual en ambos entornos, `lib/env.js`).

### 13. ¿Algo depende de estar dentro de Next.js? Alias `@/lib`

**Sí depende, y sí hay solución ya usada en el propio repo.** El alias
`"@/*": ["./*"]` (`jsconfig.json`) es una configuración de resolución de
módulos específica de webpack/Next — Node por sí solo no sabe resolver
`import ... from "@/lib/materializedScanner"`. El repo ya tiene un loader
ESM de Node que resuelve exactamente ese alias fuera de Next:

```js
export async function resolve(specifier, context, nextResolve) {
  let target = specifier;
  const rootDir = process.cwd();

  if (target.startsWith("@/")) {
    target = path.join(rootDir, target.replace(/^@\//, ""));
  } else if (context.parentURL && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    ...
  }
  ...
  return nextResolve(target, context);
}
```
(`scripts/loader.mjs:5-19`, cita parcial de la función `resolve`
completa — el resto son detalles de resolución de extensión/`index.js`).
Se invoca hoy con `node --loader ./scripts/loader.mjs <script>.mjs` en
varios scripts de `package.json` (`test:patterns`, `test:filters`). Un
script para Actions podría usar el mismo mecanismo (`node --loader
./scripts/loader.mjs mi-script.mjs`) para poder escribir
`import { runMaterializedScan } from "@/lib/materializedScanner";` sin
tocar los imports existentes del código que se reutilice. Alternativa no
verificada en este repo: reescribir los imports a rutas relativas
(`../lib/materializedScanner.js`, como ya hace
`pattern-detector-regression.mjs`) y prescindir del loader — ambas rutas
son viables con lo que ya existe en el repo, ninguna requiere el runtime
de Vercel.

---

## CONFIANZA

**Verificado leyendo código (alta confianza, cita directa):**
- No existe script CLI para el escaneo; único punto de entrada es la ruta
  de API.
- Cadena de imports de `runMaterializedScan` sin ninguna dependencia de
  `next/server`/`next/headers`/`next/cache`.
- `after()` de `next/server` solo se usa en el camino UI
  (`app/api/scan/route.js`), no en el cron.
- Lista completa de variables de entorno usadas en la cadena, con cita
  exacta de cada una.
- `DEFAULT_CONCURRENCY=2`, techos de 3 (cron) y 4 (jobs/scan-refresh).
- Ausencia de throttling/rate-limiting implementado — solo clasificación
  de errores sin reintento automático.
- `materializationPriorityForRow` citada íntegra; qué ordena y por qué no
  sirve para predecir candidatos entre símbolos nunca escaneados.
- Las tres escrituras del cron (`scans`, `scan_symbol_history`,
  `scan-refresh-cursor`) usan upsert con `on_conflict` — idempotentes por
  diseño, con la salvedad del `DELETE`+reinserción completa en
  `scan_results`.
- El alias `@/` no lo resuelve Node nativamente; el repo ya tiene un
  loader ESM (`scripts/loader.mjs`) que lo resuelve, en uso activo en
  otros scripts.
- `next: { revalidate }` en `fetch()` es una extensión de Next.js que Node
  ignora sin error.

**Verificado consultando datos:** ninguna consulta a Supabase fue
necesaria para este documento — todas las preguntas de la Fase 1 se
responden desde el código y desde cifras ya medidas en los dos documentos
previos (que sí tienen sus propias consultas citadas).

**Inferido / no cerrado (confianza media o explícitamente abierto):**
- Los cálculos de minutos/mes de la Parte C a concurrencia=10 son
  puramente aritméticos sobre una hipótesis no verificada de seguridad —
  se presentan etiquetados como tales, no como recomendación.
- El ahorro real que aporta hoy `next: { revalidate: 86400 }` en
  producción (Vercel) no se midió — no se puede afirmar cuánto cambiaría
  el tráfico a NasdaqTrader al perder ese comportamiento en Actions.
- Qué mecanismo reemplazaría al cursor por `offset` si el trabajo se
  particiona en varios `jobs` de Actions (por el tope de 6h) no se cierra
  aquí — es una decisión de diseño fuera del alcance pedido ("no
  propongas arreglos").
- No se verificó si Twelve Data está wired en algún camino no explorado
  del repo (esta auditoría solo confirmó que no aparece en la cadena de
  `fetchChartForScan`/`fetchProfileForScan` que usa el escaneo); el grep
  de `TWELVE_DATA`/`twelvedata` en `lib/` no dio coincidencias, pero no se
  revisó el 100% del árbol de archivos del repo (p.ej. `app/`, `scripts/`
  fuera de lo ya listado).
- No se pudo confirmar ni descartar, con evidencia del propio repo, si
  Vercel Hobby limita el número de invocaciones de cron/día — esto ya
  quedó abierto en `docs/universo-relevante-2026-08-04.md` y no era parte
  del alcance de esta tarea (que ya asume la migración fuera de Vercel).
