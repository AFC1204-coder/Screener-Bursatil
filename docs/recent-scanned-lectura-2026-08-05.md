# `readRecentlyScannedSymbols` — para qué sirve y si se puede evitar traer miles de filas

Fecha del análisis: 2026-08-07. BASE_SHA: 7d5d85e. Rama: `codex/statsedge-ui-polish`.

Contexto: este documento profundiza específicamente en la fase que
[docs/overhead-scan-2026-08-05.md](overhead-scan-2026-08-05.md) identificó como
la más cara del cron de escaneo (9,3-15,9s medidos allí en C.2/B.4). No repito
la instrumentación de ese documento (script, metodología, universe_read) más
que para lo estrictamente necesario; me limito a `readRecentlyScannedSymbols`.

---

## PARTE A — Qué hace y para qué

### A.1 Cita completa de la función

`lib/materializedScanner.js:1107-1204`:

```js
async function readRecentlyScannedSymbols(options = {}) {
  const config = supabaseConfig();
  const days = Math.max(Number(options.recentScanDays || DEFAULT_SKIP_RECENT_SCAN_DAYS), 1);
  const lookbackDays = Math.max(
    days,
    Math.min(Math.max(Number(options.materializationLookbackDays || DEFAULT_MATERIALIZATION_LOOKBACK_DAYS), 1), 1095),
  );
  const maxRows = Math.min(Math.max(Number(options.materializationMaxRows || options.recentScanMaxRows || DEFAULT_RECENT_SCAN_MAX_ROWS), 1), 50000);
  const markets = normalizeMarketList(options.markets || DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const marketSet = new Set(markets);
  if (!config.configured) {
    return {
      enabled: true,
      configured: false,
      skipped: true,
      days,
      lookbackDays,
      symbols: new Set(),
      latestBySymbol: new Map(),
      count: 0,
      materialization: { stateConfigured: false, lookbackDays, latestScanned: 0, recent: 0, stale: 0, byMarket: {} },
      ...disabledPayload(),
    };
  }
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const rows = await supabaseRequestAll("scan_results", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&created_at=gte.${encodeURIComponent(since)}&select=symbol,country,created_at,total_score,metrics&order=created_at.desc`,
  }, {
    maxRows,
  });
  const symbols = new Set();
  const byMarketSets = {};
  const latestBySymbol = new Map();
  const materializationByMarket = {};
  const materialization = {
    stateConfigured: true,
    lookbackDays,
    latestScanned: 0,
    recent: 0,
    stale: 0,
    priorPlanValid: 0,
    priorActionable: 0,
    priorWatch: 0,
    highScore: 0,
    byMarket: materializationByMarket,
  };
  for (const row of rows || []) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    const market = cleanText(row.country || countryCode(symbol)).toUpperCase();
    if (marketSet.size && !marketSet.has(market) && !marketSet.has(countryCode(symbol))) continue;
    const key = marketSet.has(market) ? market : countryCode(symbol);
    if (latestBySymbol.has(symbol)) continue;
    const state = latestScanStateFromRow(row, days);
    latestBySymbol.set(symbol, { ...state, market: key });
    materialization.latestScanned += 1;
    materializationByMarket[key] ??= { latestScanned: 0, recent: 0, stale: 0, priorPlanValid: 0, priorActionable: 0, priorWatch: 0, highScore: 0 };
    materializationByMarket[key].latestScanned += 1;
    if (state.recent) {
      symbols.add(symbol);
      byMarketSets[key] ??= new Set();
      byMarketSets[key].add(symbol);
      materialization.recent += 1;
      materializationByMarket[key].recent += 1;
    } else {
      materialization.stale += 1;
      materializationByMarket[key].stale += 1;
    }
    if (state.planValid ?? state.actionable) {
      materialization.priorPlanValid += 1;
      materializationByMarket[key].priorPlanValid += 1;
      materialization.priorActionable += 1;
      materializationByMarket[key].priorActionable += 1;
    } else if (state.watch || state.strict || state.patternCandidate) {
      materialization.priorWatch += 1;
      materializationByMarket[key].priorWatch += 1;
    }
    if (Number.isFinite(state.totalScore) && state.totalScore >= 70) {
      materialization.highScore += 1;
      materializationByMarket[key].highScore += 1;
    }
  }
  const byMarket = Object.fromEntries(Object.entries(byMarketSets).map(([key, items]) => [key, items.size]));
  return {
    enabled: true,
    configured: true,
    skipped: false,
    days,
    lookbackDays,
    maxRows,
    rowsRead: rows?.length || 0,
    count: symbols.size,
    byMarket,
    symbols,
    latestBySymbol,
    materialization,
  };
}
```

Constantes (`lib/materializedScanner.js:61-68`): `DEFAULT_SKIP_RECENT_SCAN_DAYS = 45`,
`DEFAULT_RECENT_SCAN_MAX_ROWS = 5000`, `DEFAULT_MATERIALIZATION_LOOKBACK_DAYS = 90`
(comentario en el propio código: "2x DEFAULT_SKIP_RECENT_SCAN_DAYS: suficiente
para distinguir 'escaneado hace poco' de 'nunca'").

### A.2 Qué devuelve exactamente

No es una lista simple. Es un objeto con **dos estructuras principales** más
telemetría:

- `symbols: Set<string>` — símbolos cuyo escaneo más reciente cae dentro de
  `days` (45 por defecto). Es un subconjunto de `latestBySymbol` (solo los
  `recent === true`).
- `latestBySymbol: Map<string, state>` — **un estado por símbolo, para TODOS
  los símbolos vistos en la ventana de 90 días** (no solo los recientes),
  donde `state` viene de `latestScanStateFromRow` (`lib/materializedScanner.js:728-792`):
  `{ symbol, market, createdAt, ageDays, recent, totalScore, planValid,
  actionable, watch, strict, patternCandidate, qualityScore }`.
- Telemetría: `count` (= `symbols.size`), `rowsRead`, `byMarket`,
  `materialization` (contadores agregados: `latestScanned`, `recent`, `stale`,
  `priorPlanValid`, `priorWatch`, `highScore`, por mercado).

La deduplicación por símbolo ocurre en JS, línea por línea, quedándose con la
**primera fila que ve por símbolo** — que es la más reciente porque la consulta
pide `order=created_at.desc` (línea 1159: `if (latestBySymbol.has(symbol))
continue;`).

### A.3 Quién consume el resultado y para qué decisión

Cita literal, `resolveSymbols` (`lib/materializedScanner.js:1267-1291`):

```js
let recentScanExclusion = null;
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

El cron real (`app/api/cron/scan-refresh/route.js:210-228`, citado en el
documento hermano) **no fija `skipRecentlyScanned`** — solo
`cronUniverseSnapshot: true`, `prioritizeMaterialization: true` (implícito, es
el default), `universeMaxAgeHours: 48`, `refreshUniverse: false`. Consecuencia
directa, verificable en la línea citada arriba:

```js
excludedSymbols: options.skipRecentlyScanned ? recentScanExclusion?.symbols : new Set(),
```

**`options.skipRecentlyScanned` es `undefined` en el cron real → `excludedSymbols`
es SIEMPRE `new Set()` vacío.** Es decir: el campo `symbols` (el `Set` de
símbolos "recientes") que `readRecentlyScannedSymbols` calcula, puebla y
devuelve **no se usa nunca en el cron real** — es trabajo (el `if (state.recent)`,
el `byMarketSets`, el `symbols.add(symbol)` de las líneas 1165-1170) que se
ejecuta y luego se descarta en `resolveSymbols`. Lo único que el cron
consume es `latestBySymbol` (vía `scanStateBySymbol`) y `configured`/`skipped`
(vía `scanStateConfigured`).

`scanStateBySymbol` (= `latestBySymbol`) alimenta
`materializationPriorityForRow` (`lib/materializedScanner.js:833-890`), que
`selectUniverseRows` usa para ordenar (`lib/materializedScanner.js:1011-1026`,
cita literal):

```js
const priority = materializationPriorityForRow(row, options);
return { ...row, selectionPriorityScore: prioritizeMaterialization ? priority.score : 0, ... };
...
const orderedRows = prioritizeMaterialization
  ? [...rows].sort((a, b) => (b.selectionPriorityScore || 0) - (a.selectionPriorityScore || 0) || (a.selectionIndex || 0) - (b.selectionIndex || 0))
  : rows;
```

**Respuesta directa a la pregunta del prompt**: alimenta **solo la
priorización** (`materializationPriorityForRow`), no `skipRecentlyScanned` —
ese flag existe en el código y en la firma del retorno
(`recentScanExclusion.enabled: Boolean(options.skipRecentlyScanned)`,
`lib/materializedScanner.js:1300`), pero el cron real nunca lo activa. La
prioridad de escaneo (`materializationPriorityForRow`, líneas 850-863) usa
`state` para decidir: sin estado previo → `score += 1000` ("never_scanned",
máxima prioridad); recién escaneado → `+120`; escaneado hace tiempo → `+650`
(y +50/+90 extra si tiene ≥90/≥180 días), más bonos por `planValid`/`watch`/
`totalScore`/`qualityScore`.

### A.4 Qué pasa si devolviera una lista vacía

No rompe nada — solo pierde la señal de priorización. Con `rows = []`:
`symbols` y `latestBySymbol` quedan vacíos, pero `configured: true, skipped:
false` se mantiene (config de Supabase sigue presente). En `resolveSymbols`,
`scanStateConfigured = Boolean(recentScanExclusion.configured &&
!recentScanExclusion.skipped)` sigue siendo `true`. Dentro de
`materializationPriorityForRow` (`lib/materializedScanner.js:836-863`):

```js
const state = scanStateBySymbol.get(normalizeSymbol(row.symbol));
...
let score = investability.score;
let reason = "stale_scan";
if (!state) {
  score += 1000;
  reason = "never_scanned";
}
```

Con el `Map` vacío, **todos** los símbolos del universo caen en la rama
`!state` → `never_scanned`, empatan en `score = investability.score + 1000`,
y el desempate es `selectionIndex` (orden del snapshot de universo,
`lib/materializedScanner.js:1026`). Es decir: el escaneo seguiría
funcionando exactamente igual en términos de qué símbolos se seleccionan
técnicamente, pero la priorización colapsaría a "todos son igual de
prioritarios salvo por su score de investabilidad e índice de snapshot" —
se perdería la señal de "ya lo escaneé ayer, no hace falta repetirlo ya" /
"tenía un plan válido, priorízalo". El único camino que sí "rompe" algo
observable es `options.skipRecentlyScanned: true` (no usado por el cron):
ahí `excludedSymbols` sería `new Set()` en vez de excluir símbolos recientes,
así que un símbolo recién escaneado podría volver a escanearse — pero esto no
aplica al cron real, como se estableció en A.3.

---

## PARTE B — Cuánto trae y cuánto necesita

### B.1 Cuántas filas trae

**Hallazgo estructural, verificado por consulta directa**: la fila más
antigua de toda la tabla `scan_results` (`owner_id=personal`, sin filtro de
fecha) es del **2026-06-20**, es decir, **48 días de antigüedad respecto de
hoy (2026-08-07)** — por debajo de los 90 días de `lookbackDays`. Consulta:

```
table=scan_results, select=symbol,created_at, filter=owner_id=eq.personal,
order=created_at.asc, limit=5
→ [{"symbol":"GOOGL","created_at":"2026-06-20T08:41:46.429474+00:00"}, ...]
```

**Esto significa que la ventana de 90 días no filtra nada en la práctica
hoy: TODA la tabla `scan_results` del owner está dentro de la ventana.** El
número de filas que trae `readRecentlyScannedSymbols` hoy es, efectivamente,
el tamaño completo de la tabla (hasta el tope de `maxRows=5000`).

**No pude obtener el conteo exacto.** Dos limitaciones documentadas en el
propio intento:
1. La clave de solo-lectura del MCP rechaza funciones agregadas:
   `select=count()` → `PGRST123: "Use of aggregate functions is not allowed"`
   (probablemente una restricción de PostgREST/rol específica de esta clave,
   no necesariamente aplica a la `service_role` key que usa la app en
   producción — no lo pude verificar).
2. La herramienta de consulta no expone `offset`, así que no puedo paginar
   de forma exacta más allá de usar `created_at=lt.<cursor>` con los riesgos
   de empate que eso implica en fronteras de página.

**Lo que sí verifiqué por paginación manual (cursor `created_at=lt.X`,
`limit=200`, 3 páginas, ~600 filas)**: bajando desde 2026-08-06 hacia atrás
hasta 2026-07-15 encontré un **batch masivo de cientos de filas con
`created_at` en el rango `2026-07-15T18:39:35` a `18:40:27`** (menos de un
minuto de diferencia entre filas), con símbolos en orden alfabético denso
(`AHMA, AI, AIAI, AIB, AIBZ, AIDX, AIFA, AIFC, ... TPST, TPVG, TR, TRAD,
TRAK, ...` — cientos de tickers estadounidenses distintos, consistente con
una corrida manual de prueba contra el universo completo, no con un grupo
normal del cron de 6-40 símbolos). Solo en las dos páginas que tocan ese
batch ya conté más de 300 filas de ese único bloque de ~52 segundos, sin
haber llegado a su principio ni a su fin.

**Conclusión de B.1 (medición parcial + inferencia razonada, no conteo
exacto)**: el número real de filas en la ventana de 90 días está muy por
encima de las ~800-1000 que una extrapolación lineal ingenua sobre la
densidad "normal" del cron (17-25 filas/día × 48 días) habría sugerido, por
la existencia de al menos un batch de prueba de gran tamaño. Esto es
consistente con que la medición de producción (B.4 del documento hermano,
y la repetición que hice en Parte D de este documento) encuentre
**exactamente 5 páginas (offset 0,1000,2000,3000,4000)** en
`supabaseRequestAll` — que solo ocurre si hay **≥4001 filas** en la
ventana (con &lt;4001 filas, la página parcial habría cortado el bucle antes,
ver `lib/supabaseServer.js:100-109`: `if (page.length < limit) break;`). Es
decir, el propio comportamiento de paginación observado (5 peticiones, no 1,
2 o 3) es evidencia indirecta pero sólida de que el tamaño real está entre
~4001 y el tope de `maxRows=5000` (posiblemente en el tope, capado).

### B.2 Por qué el tamaño de la tabla no está acotado por ninguna política de retención (hallazgo no buscado por el prompt, pero relevante)

`supabase/schema.sql` documenta una política de retención — "conservar los
N=3 scans MÁS RECIENTES por owner_id" — dentro de la función
`upsert_scan_newer_wins` (líneas 197-269, cita parcial):

```sql
-- PURGA OPORTUNISTA (política de retención "últimos N scans por owner").
-- Política decidida por Fable (no rediseñar):
--   1. Retención: conservar los N=3 scans MÁS RECIENTES por owner_id
--      (ordenados por updated_at desc). Todo scan del mismo owner fuera de
--      ese top-3 se elimina.
...
v_retention_count int := 3;
...
delete from public.scans
where id in (
  select id from (
    select s.id, row_number() over (partition by s.owner_id order by s.updated_at desc, s.created_at desc) as rn
    from public.scans s where s.owner_id = v_owner and s.deleted_at is null
  ) ranked where ranked.rn > v_retention_count
);
```

Pero **el cron de escaneo no llama a esta función**. `writeMaterializedScan`
(`lib/materializedScanner.js:1642-1676`, citado también en el documento
hermano) escribe directo contra las tablas REST:

```js
const [saved] = await supabaseRequest("scans", {
  method: "POST",
  query: "on_conflict=owner_id,local_id",
  prefer: "resolution=merge-duplicates,return=representation",
  body: [{ owner_id: config.ownerId, local_id: textOrNull(scan.id) || crypto.randomUUID(), ... }],
});
await supabaseRequest("scan_results", { method: "DELETE", query: `scan_id=eq.${encodeURIComponent(saved.id)}` });
for (let i = 0; i < rows.length; i += 300) {
  await supabaseRequest("scan_results", { method: "POST", prefer: "return=minimal", body: rows.slice(i, i + 300).map(...) });
}
```

Esto hace `on_conflict=owner_id,local_id` — si `scan.id` (que se usa como
`local_id`) es distinto en cada invocación (lo que la evidencia de datos
reales sugiere: hay filas con `created_at` distintos por cada grupo de
mercado y cada día, no un único scan que se sobrescribe), **cada invocación
del cron crea un `scan` nuevo con su propio `local_id`**, y el `DELETE` de
`scan_results` antes del `POST` solo borra las filas del `scan_id` de ESA
invocación — no las de invocaciones anteriores. La política de "retener solo
3 scans" de `upsert_scan_newer_wins` (que sí se usa desde el flujo cliente/
localStorage-sync, no verificado en detalle aquí) **no se aplica a los scans
materializados del cron**. Esto es consistente con la evidencia de datos:
`scan_results` tiene 48+ días de historia continua sin huecos de purga.

**Consecuencia directa para este problema**: el costo de
`readRecentlyScannedSymbols` no es estable — crece indefinidamente mientras
el cron siga corriendo, porque no hay ningún mecanismo de purga para su
camino de escritura. Cada día que pasa, la ventana de 90 días acumula más
filas (hasta que las más antiguas salgan de la ventana por edad, a partir de
~90 días de operación continua), pero el fondo (el batch masivo de prueba
del 2026-07-15) permanecerá dentro de la ventana durante 90 días desde su
fecha, y seguirá inflando el conteo hasta el 2026-10-13 aproximadamente.

### B.3 Qué campos se usan de verdad

La consulta pide `select=symbol,country,created_at,total_score,metrics` — ya
descarta `company_name,sector,industry,theme,rank_index,weinstein_score,
minervini_score,risk_score,rs_rating,raw` (que si están en el `select=*` de
otra ruta, no en esta). De las 5 columnas que sí trae, el uso real
(`latestScanStateFromRow`, `lib/materializedScanner.js:728-792`) es:

- `symbol` — usado (clave del Map/Set).
- `country` — usado para bucketing por mercado (`market`).
- `created_at` — usado para `ageDays`/`recent`.
- `total_score` — usado solo como **fallback** de menor prioridad:
  `firstFinite(metrics.objectiveScore, metrics.objective_score, row.total_score, metrics.totalScore, metrics.total_score)`
  (línea 732) — si `metrics.objectiveScore`/`objective_score` están presentes
  (que es el caso normal, dado que `metrics` es JSON generado por el propio
  motor de scoring), `total_score` ni se toca.
- `metrics` (jsonb) — es la columna más pesada de la fila (contiene, según el
  propio `scanResultPayload` citado en el documento hermano, decenas de
  campos numéricos de estructura VCP: `baseNearPivotDays`,
  `contractionDepths`, `measuredContractionSwings`, `tightness5dPct`, etc.) y
  de ella **solo se leen ~15 subclaves puntuales**: `objectiveScore`,
  `objective_score`, `totalScore`, `total_score`, `setupVerdictKey`,
  `setupVerdictState`, `setupStructureKey`, `patternFamily`,
  `methodologyReliabilityState`, `patternDataStatus`,
  `contractionStructureStatus`, `setupDisplayBlocksPatternClaim`,
  `setupDisplayDataLimited`, `methodologyBlocksPatternClaim`,
  `patternEligible`, `setupDisplayActionable`,
  `setupDisplayTradePlanEligible`, `setupDisplayPlanValid`,
  `setupDisplayWatch`, `setupDisplayStrict`, `setupActionable`,
  `setupPlanValid`, `setupWatch`, `setupStrict`, `setupQualityScore`,
  `patternQualityScore`, `baseQualityScore` (cita completa en A.1, líneas
  729-777).

**El desperdicio no está en `select=*` (ya está acotado a 5 columnas) sino en
traer el `metrics` JSONB completo por cada una de miles de filas cuando solo
se leen ~25 subclaves de él.** No medí el peso en bytes de `metrics` por fila
(sería necesario un `SELECT pg_column_size(metrics)` que la clave de solo
lectura tampoco permitiría por ser también una función, no lo intenté dado
el bloqueo ya confirmado de agregados/funciones). Queda como estimación
razonada: dado que `scanResultPayload` (documento hermano, cita de
`lib/materializedScanner.js:1600-1637`) tiene ~45 campos numéricos en
`metrics`, cada fila de `metrics` probablemente pesa varios cientos de bytes
a low-single-digit KB en JSON — con miles de filas, esto es fácilmente el
componente dominante del payload de red de esta fase.

### B.4 ¿Hay símbolos repetidos? ¿Trae todas las filas o deduplica?

**Trae todas las filas de la red; deduplica solo en JS después de
transferirlas.** Confirmado en el código (A.1, línea 1159:
`if (latestBySymbol.has(symbol)) continue;`, se ejecuta DESPUÉS de que
`supabaseRequestAll` ya trajo e hizo `JSON.parse` de todas las filas).

**Confirmado en datos reales** — el mismo símbolo aparece en múltiples filas
con `created_at` distintos dentro de la ventana de 90 días. Ejemplos
literales de la consulta de B.1 (`table=scan_results,
select=symbol,created_at, filter=owner_id=eq.personal&created_at=gte.
2026-05-09T00:00:00Z, order=created_at.desc, limit=200`):

```
AAPL: 2026-08-06T23:06:34 (no, ese es otro symbol — ver abajo), 
  2026-07-30T14:51:39, 2026-07-30T00:15:05, 2026-07-29T23:52:09,
  2026-07-29T23:51:03, 2026-07-29T23:34:56, 2026-07-29T19:44:12,
  2026-07-16T11:43:13  → AAPL aparece al menos 7 veces solo en las primeras
  ~600 filas leídas (menos de una cuarta parte de la ventana completa)
GOOGL, MSFT, NVDA, AMZN, META: mismo patrón, 6-7 apariciones cada uno en el
  mismo rango — corridas manuales de prueba con el mismo puñado de 6
  símbolos, repetidas varias veces en una ventana de pocas horas
  (2026-07-29T23:34:56 → 2026-07-29T23:52:09 → 2026-07-30T00:15:05 →
  2026-07-30T14:51:39, cuatro corridas del mismo lote de 6 símbolos en <15h)
ALLEI.ST, APOTEA.ST, AQ.ST, ASKER.ST, BEWI.OL, ...: también repetidos en
  múltiples fechas de cron real (2026-07-16, 07-20, 07-24, 07-28, 08-01,
  08-05 — el mismo grupo de mercado nórdico rota y reescanea los mismos
  símbolos cada ~4 días, como es de esperar de la rotación de grupos)
```

Es decir: la tabla trae, sin deduplicar, **cada corrida histórica de cada
símbolo dentro de 90 días** — para un símbolo escaneado 7 veces, trae 7 filas
completas (con su `metrics` JSONB completo cada una) solo para quedarse con
la más reciente. El patrón de rotación de grupos del cron (~cada 4-8 días
por grupo, ver `SCAN_CRON_GROUPS`) más las corridas manuales de prueba hacen
que la proporción filas-totales / símbolos-distintos sea significativamente
mayor que 1 — no medí la proporción exacta (dependería del conteo exacto de
B.1, que no obtuve), pero la evidencia cualitativa (7 apariciones de AAPL en
~600 filas de 90 días de ventana) sugiere que **una fracción sustancial de
las filas leídas son descartadas inmediatamente por deduplicación**.

---

## PARTE C — Alternativas

### C.1 ¿Se puede resolver con una consulta agregada?

Sí, y el propio código ya tiene el precedente exacto: `scan_symbol_history`
resuelve el mismo problema ("último estado por símbolo") con una función SQL
`DISTINCT ON`, no trayendo filas para deduplicar en JS. Cita,
`supabase/schema.sql:1480-1505`:

```sql
create or replace function public.scan_symbol_history_latest_v1(
  p_owner_id text,
  p_mic_codes text[] default null
)
returns setof public.scan_symbol_history
language sql stable security invoker set search_path = ''
as $$
  select distinct on (h.owner_id, h.mic_code, h.symbol)
    h.*
  from public.scan_symbol_history as h
  where h.owner_id = p_owner_id
    and (p_mic_codes is null or cardinality(p_mic_codes) = 0 or h.mic_code = any(p_mic_codes))
  order by h.owner_id, h.mic_code, h.symbol, h.observed_at desc, h.id desc;
$$;
```

El equivalente para `scan_results` sería una función `scan_results_latest_v1`
con la misma forma:

```sql
create or replace function public.scan_results_latest_v1(
  p_owner_id text,
  p_since timestamptz
)
returns table (symbol text, country text, created_at timestamptz, total_score numeric, metrics jsonb)
language sql stable security invoker set search_path = ''
as $$
  select distinct on (r.symbol)
    r.symbol, r.country, r.created_at, r.total_score, r.metrics
  from public.scan_results as r
  where r.owner_id = p_owner_id and r.created_at >= p_since
  order by r.symbol, r.created_at desc;
$$;
```

(Esbozo ilustrativo, no probado ni desplegado — respeta la restricción de
no modificar código.) Esto movería el trabajo de deduplicación de JS/red a
Postgres, devolviendo una fila por símbolo en vez de una por escaneo
histórico. La alternativa de `select symbol, max(created_at) group by
symbol` que menciona el prompt es **insuficiente por sí sola**: la función
necesita devolver también `metrics`/`total_score` de esa fila más reciente
(no solo el timestamp), y un `GROUP BY symbol` con `max(created_at)` no trae
el resto de columnas de esa fila concreta sin un `JOIN` adicional —
`DISTINCT ON` es la forma idiomática en Postgres para "toda la fila más
reciente por grupo", que es exactamente lo que necesita
`latestScanStateFromRow`.

**Confirmé, empíricamente, que la ruta agregada directa vía PostgREST
(`select=count()` o cualquier función agregada) está bloqueada** para la
clave de solo lectura que usé (`PGRST123: "Use of aggregate functions is not
allowed"`). No pude verificar si esto es una restricción específica de esa
clave/rol o del proyecto entero (afectaría también a la `service_role` key
de producción) — si es lo segundo, la vía de una función SQL (como el
`scan_results_latest_v1` de arriba, expuesta vía RPC igual que
`scan_symbol_history_latest_v1`) sería la única forma de conseguir esta
agregación, no un `select=count()`/`select=symbol,max(created_at)`
directamente vía REST.

### C.2 ¿Existe ya un índice sobre las columnas implicadas?

**Para la consulta ACTUAL** (`owner_id=eq.X&created_at=gte.Y&order=created_at.desc`):
sí, cubierto por el índice existente. Cita, `supabase/schema.sql:1524`:

```sql
create index if not exists scan_results_owner_created_idx on scan_results(owner_id, created_at desc);
```

Este índice ya cubre exactamente el `WHERE owner_id = ? AND created_at >= ?`
más el `ORDER BY created_at DESC` de la consulta actual — el costo medido
(9,3-15,9s / 7,9-24s en Parte D) **no es un problema de índice faltante en
la lectura actual**; es un problema de volumen de filas y payload por fila
(B.3/B.4), no de plan de consulta.

**Para la alternativa `DISTINCT ON (symbol) ... ORDER BY symbol, created_at
desc` de C.1**: el índice actual `(owner_id, created_at desc)` NO sirve para
esa forma — Postgres necesitaría escanear y ordenar por `symbol` primero
para poder hacer el "skip scan" que `DISTINCT ON` puede aprovechar
eficientemente. Faría falta un índice nuevo:

```sql
create index if not exists scan_results_owner_symbol_created_idx
  on scan_results(owner_id, symbol, created_at desc);
```

Existe un índice parecido pero no equivalente,
`scan_results_symbol_idx on scan_results(owner_id, symbol)`
(`supabase/schema.sql:1523`) — le falta la tercera columna `created_at desc`,
así que no permite el "index-only scan hacia atrás por símbolo" que
`DISTINCT ON (symbol) ORDER BY symbol, created_at DESC` necesita para ser
realmente barato (sin el índice de 3 columnas, Postgres tendría que hacer un
scan completo del índice de 2 columnas y ordenar en memoria dentro de cada
grupo de símbolo, lo cual con miles de filas por owner sigue siendo mucho
más barato que traer todo el JSONB por red, pero no es óptimo).

### C.3 ¿La información podría estar ya en otro sitio más barato? (`scan_symbol_history`)

**Parcialmente sí, con matices importantes que impiden un swap 1:1.**

**A favor**: `scan_symbol_history` ya tiene la RPC `latest_v1` (C.1) que
devuelve exactamente "una fila por símbolo, la más reciente", sin necesidad
de crear nada nuevo — y **por diseño ("change-only", `lib/scanHistory.js:45-74,
119-132`) ya escribe menos filas de las que existen escaneos**: solo inserta
cuando algo cambió (`screening_changed`, `stage_changed`,
`rs_*_moved` con umbral >5 puntos, `weekly_anchor`), así que para un símbolo
escaneado repetidamente sin cambios sustantivos, la tabla NO acumula una fila
por cada escaneo — acumula solo las filas de cambio real. Esto es
estructuralmente más barato que `scan_results`, que sí inserta una fila por
símbolo en CADA escaneo sin excepción (`writeMaterializedScan`, B.2). Y no
tiene el problema de retención de B.2: es aditiva por diseño (comentario en
`supabase/schema.sql:1300-1304`: "Aditiva: no altera ni referencia con FK a
scans, scan_results o daily_bars").

**En contra — no es un reemplazo directo**:
1. **Cobertura condicionada**: `writeScanSymbolHistory` solo se llama si
   `savedScan.saved && result.history` (documento hermano, cita de
   `app/api/cron/scan-refresh/route.js:41-44`), con un `.catch()` que no
   revierte el run si falla (`phase = "history_write"`). Si esa escritura
   falla silenciosamente en alguna invocación, esos símbolos quedan sin
   registro en `scan_symbol_history` para ese ciclo — no verifiqué la tasa
   de fallo real de esta escritura en producción.
2. **Esquema distinto, no superset**: `scan_symbol_history` tiene
   `rs_global`, `rs_benchmark`, `rs_country`, `rs_sector`, `composite_score`,
   `composite_coverage`, `stage`, `passed_screen`, `absence_reason` — **no
   tiene** los campos de verdicto/patrón VCP que `latestScanStateFromRow`
   necesita (`setupVerdictKey`, `setupDisplayPlanValid`, `setupDisplayWatch`,
   `setupQualityScore`, etc. — comparar el esquema de
   `supabase/schema.sql:1305-1422` contra la lista completa de B.3). Migrar
   `materializationPriorityForRow` a leer de `scan_symbol_history` en vez de
   `scan_results` requeriría o (a) mapear aproximadamente `composite_score`/
   `stage`/`passed_screen` a `planValid`/`watch`/`totalScore` — cambiando la
   semántica de la priorización, no solo su fuente de datos — o (b) añadir
   las columnas de verdicto VCP a `scan_symbol_history`, lo cual es un
   cambio de esquema no trivial y fuera del alcance de "sin tocar código"
   de esta tarea.
3. **No until confirmado con datos reales**: no ejecuté una consulta contra
   `scan_symbol_history` para confirmar cuántas filas/símbolos distintos
   tiene hoy (la tabla está en la lista de tablas permitidas por el rol de
   solo lectura, pero no la consulté por límite de alcance/tiempo de este
   análisis) — la cobertura real (qué fracción de símbolos alguna vez
   escaneados por el cron tienen una fila viva en `scan_symbol_history`) es
   una suposición razonada a partir de leer el código de escritura, no una
   medición.

### C.4 Comparación de alternativas — qué se toca, costo estimado, riesgo

| Alternativa | Qué se toca | Costo estimado (no medido) | Riesgo |
|---|---|---|---|
| **RPC `scan_results_latest_v1` (`DISTINCT ON`)** — C.1 | 1 función SQL nueva (migración), + nuevo índice `(owner_id, symbol, created_at desc)` (C.2), + cambiar `readRecentlyScannedSymbols` para llamar `supabaseRpc(...)` en vez de `supabaseRequestAll("scan_results", ...)` | Migración SQL: bajo (patrón ya existe, copiar `scan_symbol_history_latest_v1`). Cambio de código: bajo-medio (una función, mismo shape de retorno si se mapea bien). Gana en tiempo de invocación: alto — pasa de traer N-filas-por-escaneo a 1-fila-por-símbolo, eliminando tanto el volumen de red como el trabajo de deduplicación en JS. Es la única alternativa que ataca la causa raíz (B.4: se traen duplicados) en vez de solo el síntoma. | Bajo-medio: la función es `security invoker` + `stable`, mismo patrón que la existente; el riesgo principal es de mapeo de campos (que `metrics` siga trayéndose completo por fila — sigue siendo 1 fila por símbolo, no 7, así que el ahorro es real aunque no se recorten subclaves de `metrics`) y de mantenimiento (dos funciones RPC casi idénticas para dos tablas hermanas, sin abstracción compartida) |
| **Reducir el lookback de 90 a algo más corto (p.ej. 45, igualando `recentScanDays`)** | 1 constante (`DEFAULT_MATERIALIZATION_LOOKBACK_DAYS`) | Bajo: cambio de una línea. Ahorro: reduce filas totales proporcionalmente al acortar la ventana, pero NO elimina duplicados (sigue trayendo cada escaneo repetido dentro de la ventana más corta) — con el patrón de rotación de grupos cada ~4-8 días observado en B.4, 45 días todavía cubre 5-11 ciclos de rotación por símbolo, así que el ahorro sería parcial, no proporcional al recorte de días | Medio: `lookbackDays` también determina qué tan atrás se considera "prior_plan_valid"/"prior_watch" para la priorización (`materializationPriorityForRow`); acortarlo cambia la semántica de negocio de "qué cuenta como antecedente", no es un cambio puramente de performance — necesitaría validación de producto, no solo de ingeniería |
| **Purgar/retener `scan_results` del cron igual que `upsert_scan_newer_wins` (B.2)** | Añadir lógica de purga al camino de escritura del cron (`writeMaterializedScan` o una función SQL nueva), o programar el backstop semanal ya existente (`purge_daily_bars_backstop`, `supabase/schema.sql:1716` es el patrón, pero para `daily_bars`, no para `scans`) para que también cubra `scans`/`scan_results` del cron | Medio: requiere decidir una política de retención para scans materializados (¿por grupo de mercado? ¿por antigüedad?) — no es una alternativa "gratis", es una decisión de producto/arquitectura nueva | Medio-alto: cambia el comportamiento observable de otras partes del sistema que sí leen `scan_results` históricos (p.ej., cualquier vista de "historial de scans" en el producto) — no evalué qué otros consumidores de `scan_results` existen fuera de esta ruta, así que no puedo descartar romper algo. Ataca la causa de fondo (B.2: crecimiento sin límite) pero es la de mayor alcance de las tres |
| **Reducir columnas del `select` actual** | 1 línea en `readRecentlyScannedSymbols` (quitar `total_score`, que es solo fallback de segundo orden) | Muy bajo: ahorro marginal, `total_score` es un `numeric`, no el campo pesado (`metrics` sigue siendo indispensable tal como está estructurado el consumo en B.3) | Muy bajo, pero el ahorro también es marginal — no ataca el problema real (B.4: duplicados) |

**No implementé ni medí ninguna de estas — quedan como estimaciones
razonadas de costo/riesgo, tal como pide la tarea.** La única con potencial
de resolver la causa raíz identificada en B.4 (filas duplicadas por
símbolo) es la RPC `DISTINCT ON`; las demás atacan síntomas relacionados
pero distintos (ventana temporal, crecimiento sin límite, payload marginal).

---

## PARTE D — Verificación de la premisa

Repetí el bench `--markets=US,HK,AU --limit=2` (mismo comando que B.4 del
documento hermano) para confirmar que `recent_scan_read` sigue siendo caro
hoy, dos días después de la medición original. Comando:

```bash
node scripts/bench-scan-overhead.mjs --markets=US,HK,AU --limit=2
```

Salida literal (recorte relevante):

```
=== RESULTADO ===
Modo: markets-real
Tiempo total (dentro de runMaterializedScan): 24.819s
Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): 25.990s
  Fase universe_select (onPhase, hasta hydrateBenchmarks): 23.933s
  Fase materialized_scan (hydrateBenchmarks + analyzeOne + sectorize + filtros): 0.886s
Escrituras a Supabase bloqueadas por el bench: 1
Peticiones de red totales capturadas: 41
CPU proceso Node (dentro del test) — user: 8943.4ms, system: 894.2ms

=== DESGLOSE POR TIPO DE PETICION DE RED (medido) ===
  recent_scan_read: 5 peticiones, 3133ms suma-duraciones, 626.6ms/peticion promedio, 7966ms span-reloj-pared (primera arranca -> ultima termina)
  other:isin.twse.com.tw: 1 peticiones, 1866ms suma-duraciones, 1866.0ms/peticion promedio, 1866ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_other:other: 8 peticiones, 1755ms suma-duraciones, 219.4ms/peticion promedio, 389ms span-reloj-pared (primera arranca -> ultima termina)
  universe_read: 12 peticiones, 1434ms suma-duraciones, 119.5ms/peticion promedio, 1877ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_chart:benchmark: 3 peticiones, 611ms suma-duraciones, 203.7ms/peticion promedio, 206ms span-reloj-pared (primera arranca -> ultima termina)
  other:www.nasdaqtrader.com: 2 peticiones, 588ms suma-duraciones, 294.0ms/peticion promedio, 1143ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_chart:other: 2 peticiones, 495ms suma-duraciones, 247.5ms/peticion promedio, 307ms span-reloj-pared (primera arranca -> ultima termina)
  other:fc.yahoo.com: 2 peticiones, 461ms suma-duraciones, 230.5ms/peticion promedio, 232ms span-reloj-pared (primera arranca -> ultima termina)
  yahoo_profile:other: 2 peticiones, 370ms suma-duraciones, 185.0ms/peticion promedio, 192ms span-reloj-pared (primera arranca -> ultima termina)
  asic_short_interest: 2 peticiones, 348ms suma-duraciones, 174.0ms/peticion promedio, 351ms span-reloj-pared (primera arranca -> ultima termina)
  other:www.hkex.com.hk: 1 peticiones, 248ms suma-duraciones, 248.0ms/peticion promedio, 248ms span-reloj-pared (primera arranca -> ultima termina)
  BLOCKED_WRITE: 1 peticiones, 0ms suma-duraciones, 0.0ms/peticion promedio, 0ms span-reloj-pared (primera arranca -> ultima termina)

=== STATS runMaterializedScan ===
  universeTotal: 9305, selected: 2, passedBase: 2, savedRows: 2, rejected: 0
  cache (universo): {"hit":false,"status":"supabase-skip","written":false,"error":"Cannot read properties of undefined (reading 'id')"}
```

**Lectura**: `recent_scan_read` volvió a hacer **5 peticiones** (mismo
patrón que B.4 del documento hermano — confirma indirectamente el hallazgo
de B.1 de este documento: ≥4001 filas en la ventana), con **7,966s de span
de reloj de pared** (3,133s en suma de duraciones). Esto está por debajo del
rango 9,3-15,9s medido hace dos días en el documento hermano, pero **en el
mismo orden de magnitud** y sigue siendo, junto con `isin.twse.com.tw`
(1,87s) y `nasdaqtrader.com` (1,14s span, ambos parte de la reconstrucción
de universo por `shouldRetryMissingRequiredSources`, ya documentada en el
documento hermano), el bloque de tiempo dominante de toda la corrida. **La
premisa se confirma**: `readRecentlyScannedSymbols` sigue siendo caro hoy,
con la misma forma de paginación (5 páginas) que dos días atrás, aunque el
número exacto de segundos varía entre corridas (latencia de red real,
variación del volumen de datos día a día).

No repetí la corrida `--markets` múltiples veces para promediar — una sola
repetición era suficiente para el objetivo de esta parte ("confirma que la
fase sigue costando ese orden de magnitud, o dilo y para si no se
reproduce") — sí se reprodujo, así que continué con el resto del análisis.

---

## CONFIANZA

- **Alta**: la cita literal de `readRecentlyScannedSymbols` (A.1), su
  estructura de retorno (A.2) y sus dos consumidores dentro de
  `resolveSymbols` (A.3) — lectura directa del código, sin ambigüedad.
- **Alta**: el hallazgo de que `excludedSymbols`/`options.skipRecentlyScanned`
  nunca se activa en el cron real, y que por tanto el `Set` `symbols` que
  calcula la función es trabajo descartado en la práctica (A.3) — verificado
  leyendo la línea condicional exacta y confirmando que el cron real no pasa
  `skipRecentlyScanned` (cruce con el documento hermano, que ya citó las
  opciones exactas que pasa el cron).
- **Alta**: que la ventana de 90 días no filtra nada hoy porque la fila más
  antigua de `scan_results` tiene 48 días (B.1) — medición directa por
  consulta.
- **Alta**: que no hay retención/purga aplicada al camino de escritura del
  cron, a diferencia de `upsert_scan_newer_wins` (B.2) — verificado leyendo
  ambas funciones de escritura y confirmando que `writeMaterializedScan` no
  invoca la RPC que sí tiene la política de retención.
- **Alta**: que existen símbolos duplicados en la ventana, con casos
  concretos citados con timestamps reales (B.4) — medición directa.
- **Media**: el número exacto de filas en la ventana de 90 días (B.1) — no
  lo pude contar exactamente por las limitaciones de la clave de solo
  lectura (sin agregados, sin `offset`); la conclusión de "≥4001, plausible
  cerca del tope de 5000" es una inferencia sólida (a partir del propio
  comportamiento de paginación de 5 peticiones) pero no un conteo directo.
- **Media**: el patrón de repetición del cron de escaneo real dentro de la
  ventana (B.4) — confirmado cualitativamente con ejemplos reales, pero no
  cuantifiqué qué fracción exacta de las filas totales son duplicados vs.
  primeras apariciones.
- **Media**: la viabilidad y el shape exacto de la RPC `scan_results_latest_v1`
  propuesta en C.1 — el patrón (`DISTINCT ON`, mismo lenguaje/seguridad que
  `scan_symbol_history_latest_v1`) es sólido por precedente directo en el
  mismo esquema, pero no escribí ni probé la migración real.
- **Baja**: si el bloqueo de funciones agregadas de PostgREST (C.1) también
  aplica a la `service_role` key de producción, o es específico de la clave
  de solo lectura que usé — no lo pude distinguir.
- **Baja**: la cobertura real de `scan_symbol_history` como fuente
  alternativa (C.3) — no consulté la tabla, es una evaluación basada
  solo en el código de escritura.

## LO QUE NO HE VERIFICADO

- **El conteo exacto de filas en la ventana de 90 días** (B.1) — limitación
  de herramienta (agregados bloqueados, sin `offset`), no de tiempo. Sería
  resoluble con acceso a `execute_sql`/`psql` directo o una clave con
  permiso de agregados.
- **El peso en bytes de la columna `metrics` por fila** (B.3) — no pude
  ejecutar `pg_column_size` ni nada equivalente con la clave de solo
  lectura disponible.
- **Qué fracción exacta de las filas leídas por invocación son duplicados
  vs. primeras apariciones de un símbolo** (B.4) — tengo evidencia
  cualitativa fuerte (7 apariciones de AAPL en 600 filas de muestra) pero no
  un ratio exacto sobre el total.
- **Si el batch masivo del 2026-07-15 (B.1) es una anomalía puntual (una
  corrida de prueba manual, como sugiere el patrón alfabético denso) o un
  patrón recurrente** — no revisé si hay batches similares en otras fechas
  dentro de la ventana de 90 días; solo paginé ~600 de las miles de filas
  totales.
- **Qué otros consumidores del producto leen `scan_results` históricamente**
  más allá de este flujo del cron (relevante para evaluar el riesgo de la
  alternativa de purga en C.4) — no busqué otros call-sites de la tabla.
- **La tasa de fallo real de `writeScanSymbolHistory` en producción**
  (relevante para C.3, cobertura de `scan_symbol_history` como alternativa)
  — no consulté `provider_runs` para esto.
- **Si `scan_symbol_history` tiene, hoy, una fila por cada símbolo que
  `scan_results` conoce** (C.3) — no consulté la tabla directamente.
- **La latencia real función-Vercel-a-Supabase** — mis mediciones (Parte D)
  son desde mi máquina local, igual que las del documento hermano; no
  cambia la conclusión cualitativa pero sí puede cambiar la magnitud
  absoluta en producción real.
