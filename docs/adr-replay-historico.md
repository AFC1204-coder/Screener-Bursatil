# ADR — Replay histórico: recalcular desde barras, no leer `scan_results`

- Fecha: 2026-08-07
- Estado: decidido (alcance de producto), pendiente de implementación
- Rama de análisis: `codex/statsedge-ui-polish` @ `0e6afb2`

## 1. Contexto

StatsEdge quiere ofrecer replay histórico al estilo MarketSmith: ver un valor
en una fecha pasada como si se estuviera mirando ese día — gráfico, medias
móviles, etapa de Weinstein, señales técnicas y fuerza relativa (RS) tal como
eran en esa fecha.

Hay dos formas de construir esto:

1. **Leer** `scan_results`/`scan_symbol_history` — snapshots ya guardados por
   el cron de escaneo en fechas pasadas.
2. **Recalcular** desde las barras de precio (`daily_bars`), truncando la
   serie a la fecha objetivo y volviendo a correr el motor de señales.

## 2. Decisión

**El replay histórico se implementa recalculando desde barras, no leyendo
`scan_results`.**

### Alcance incluido

Gráfico, medias móviles, etapa de Weinstein, señales técnicas y RS contra
benchmark (`rsRating`) — todo lo que se reconstruye desde barras de precio
(del símbolo y del benchmark).

### Alcance excluido

Fundamentales históricos. Aportan poco al análisis de etapas (metodología
técnica) y añaden mucha complejidad: las empresas revisan cifras, y "el valor
correcto en la fecha X" exigiría guardar cada dato junto con su fecha de
conocimiento (point-in-time), no solo su `period_end`.

### Pendiente de evaluar

`rsGlobalPct` (percentil de universo). Requiere conocer `rsCompositeRaw` de
**todos** los símbolos del universo en esa fecha, no solo del símbolo que se
mira. Se decide más adelante (ver §7).

## 3. Verificación de la premisa: ¿de qué depende cada señal?

### 3.1 — Barras diarias en producción

**No pude verificar esto directamente.** La herramienta de solo-lectura
disponible en esta sesión (`mcp__supabase-readonly__supabase_query`) tiene
una lista blanca de tablas que **no incluye `daily_bars`**:

```
ERROR: Tabla no permitida: daily_bars. Permitidas: scans, scan_results,
scan_symbol_history, symbol_resolutions, shadow_instruments, app_settings,
favorites, provider_runs, scan_executions, scan_result_sets, scan_work_items,
scan_result_set_rows, universe_snapshots, universe_snapshot_symbols
```

Tampoco hay acceso a la Management API de Supabase en esta sesión (el
servidor MCP con permisos de escritura/lectura ampliada requiere
autorización interactiva no disponible aquí). No encontré ninguna tabla de
las permitidas que exponga profundidad de `daily_bars` por símbolo (los
candidatos que revisé — `scan_results.raw`, `provider_runs.stats` — no la
contienen: `compactChartPreview` solo guarda las últimas 48 barras en el
payload del scan,
[lib/materializedScanner.js:468](../lib/materializedScanner.js), no la serie
completa).

Lo que sí pude verificar por **código** (diseño, no estado real de la
tabla):

- Esquema: `daily_bars` es `(owner_id, symbol, trade_date, provider)` único,
  con `open/high/low/close/adj_close/volume`
  ([supabase/schema.sql:1043-1058](../supabase/schema.sql)).
- Política de retención (`purge_daily_bars_backstop`,
  [supabase/schema.sql:1716-1821](../supabase/schema.sql)): retiene las
  **1260** barras más recientes por símbolo si está referenciado (favorito,
  nota o alerta activa) o **400** si no lo está; borra símbolos huérfanos
  (sin referencia y sin `updated_at` en 90 días). 1260 sesiones ≈ 5 años de
  bolsa; 400 ≈ 1,6 años. Esto es el **tope de diseño**, no la profundidad
  real actual por símbolo (un símbolo recién añadido al universo puede tener
  mucho menos).
- Los benchmarks globales (`SPY`, `QQQ`, `ACWI`) se hidratan siempre en el
  cron batch (`hydrateBenchmarks`,
  [lib/materializedScanner.js:650-661](../lib/materializedScanner.js)) y se
  cachean en la misma tabla `daily_bars` que cualquier símbolo — no hay
  motivo de diseño para que tengan menos profundidad que un símbolo normal,
  pero no pude confirmarlo con una consulta real.

**Esta es una laguna real de la verificación, no una suposición.** Antes de
implementar, hace falta una consulta con acceso de administrador (fuera de
esta sesión) del tipo:

```sql
select count(distinct symbol) as symbols,
       avg(cnt) as avg_depth,
       max(cnt) as max_depth,
       min(min_date) as oldest_date
from (
  select symbol, count(*) as cnt, min(trade_date) as min_date
  from daily_bars
  group by symbol
) t;
```

### 3.2 — Las 18 señales de `SIGNAL_REGISTRY` (lib/scoringEngine.js)

| Señal | Entradas (`requiredInputs`) | Reconstruible desde barras | Cita |
|---|---|---|---|
| `weinsteinScore` | price, sma50/150/200, sma200Slope, distance52w, perf6m | **Sí** — todo derivado de barras propias | [scoringEngine.js:162-177](../lib/scoringEngine.js) |
| `minerviniScore` | price, sma50/150/200, sma200Slope, lowAdvance52w, distance52w, distance20d, highsSpreadPct, perf3m | **Sí** — `lowAdvance52w`/`highsSpreadPct` se calculan de `calcBars` en `researchRow.js:272-273` | [scoringEngine.js:178-196](../lib/scoringEngine.js) |
| `momentumScore` | perf3m, perf6m, perf12m | **Sí** | [scoringEngine.js:197-214](../lib/scoringEngine.js) |
| `riskScore` | extSma50, distance20d, distance50d, price, sma50 | **Sí** | [scoringEngine.js:215-233](../lib/scoringEngine.js) |
| `riskRewardScore` | returnToVol3m, returnToDrawdown3m, volatility63d, maxDrawdown63d, maxDailyMove20dPct, range63dPct, perf3m | **Sí** | [scoringEngine.js:234-269](../lib/scoringEngine.js) |
| `volumeEffectScore` | latestTurnover, latestVolume, relativeVolume, volumeSurgePct, upDownVolRatio, upVolume | **Sí** — turnover = precio×volumen, todo de barras | [scoringEngine.js:270-296](../lib/scoringEngine.js) |
| `volumeScore` | avgTurnover, avgVolume, upDownVolRatio, relativeVolume, volumeSurgePct, volumeEffectScore | **Sí** | [scoringEngine.js:297-321](../lib/scoringEngine.js) |
| `liquidityScore` | marketCap, avgTurnover, avgVolume, price | **Parcial** — `marketCap` viene de `profile` (fundamentales/perfil), no de barras: `marketCap: firstFinite(profile.marketCap)` | [researchRow.js:254](../lib/researchRow.js), [scoringEngine.js:322-341](../lib/scoringEngine.js) |
| `ipoScore` | ipoAgeMonths, ipoDate, distanceATH, distance52w, avgVolume, price, sma50, perf3m, sectorScore | **Parcial** — `ipoDate` es un hecho fijo (sin riesgo histórico), pero `sectorScore` requiere la población de símbolos del mismo sector/theme en esa fecha (ver fila `sectorScore` abajo) | [scoringEngine.js:342-368](../lib/scoringEngine.js) |
| `objectiveSetupScore` | price, sma50/150/200, sma200Slope, distance52w, distance20d, extSma50, highsSpreadPct | **Sí** | [scoringEngine.js:369-397](../lib/scoringEngine.js) |
| `patternContributionScore` | (ninguna declarada; lee patternQualityScore, contractionScore, vcpCandidate, breakoutAttempt, breakoutQualityScore, distanceToPivotPct, volumeDryUpRatio vía `methodologyPatternEvidenceBonus`) | **Sí** — toda la detección de patrones (`lib/setupPatterns.js`) opera sobre `rows` (barras), sin fundamentales | [scoringEngine.js:398-421](../lib/scoringEngine.js), [methodologyDisplay.js:271-287](../lib/methodologyDisplay.js) |
| `patternScore` | patternContribution, patternQualityScore, baseQualityScore, contractionScore | **Sí** — mismos insumos que la anterior | [scoringEngine.js:422-432](../lib/scoringEngine.js) |
| `setupQualityScore` | objectiveSetupScore, patternContribution, failedBreakout | **Sí** | [scoringEngine.js:433-449](../lib/scoringEngine.js) |
| `demandScore` | rsGlobalPct, rsRating, volumeScore, volumeEffectScore, liquidityScore, upDownVolRatio, relativeVolume, volumeSurgePct, avgVolume | **Parcial** — hereda la dependencia de `liquidityScore` (marketCap) y de `rsGlobalPct` (pendiente, §7) | [scoringEngine.js:450-475](../lib/scoringEngine.js) |
| `growthScore` | growthMetrics.{revenueGrowth, earningsGrowth, grossMargin, operatingMargin, profitMargin, roe, roa, debtToEquity, currentRatio} | **No** — 100% fundamentales | [scoringEngine.js:476-530](../lib/scoringEngine.js) |
| `epsGrowthProxyScore` | growthMetrics.{revenueGrowth, earningsGrowth, operatingMargin, profitMargin, roe, roa} | **No** — 100% fundamentales | [scoringEngine.js:531-570](../lib/scoringEngine.js) |
| `adProxyScore` | upDownVolRatio, relativeVolume, upVolume, volumeSurgePct, perf3m, distance20d, distance52w, price, sma50, maxDrawdown63d | **Sí** | [scoringEngine.js:572-594](../lib/scoringEngine.js) |
| `weaknessScore` | rsGlobalPct/rsRating/rsCountryPct/rsSectorPct, price, sma50/200, sma200Slope, perf3/6/12m, distance52w/20d, maxDrawdown63d, upDownVolRatio, upVolume, relativeVolume, riskScore, extSma50, speculationRiskScore | **Parcial** — hereda de `liquidityScore` vía `speculationRiskScore` (ver §3.4) y del estado de `rsGlobalPct`/`rsCountryPct`/`rsSectorPct` (§7); tiene fallback a `rsRating` puro de barras | [scoringEngine.js:86-132,615-627](../lib/scoringEngine.js) |

**Confirmación del alcance decidido:** las únicas señales 100% no
reconstruibles desde barras son `growthScore` y `epsGrowthProxyScore` —
exactamente los "fundamentales" que la decisión ya excluye. No hay
contradicción ahí.

**Hallazgo que sí matiza el alcance decidido — no lo contradice, pero no
está cubierto por su redacción actual:** `liquidityScore` (vía `marketCap`)
y `sectorScore` (vía población del universo, ver §3.3) introducen
dependencias que **no son barras del símbolo ni del benchmark**, y por tanto
cualquier definición de "todo eso se reconstruye desde barras" debe leerse
con esta excepción. Detalle cuantificado en §5.

### 3.3 — `sectorScore`: la misma clase de problema que `rsGlobalPct`, sin decisión tomada

`sectorScore` no está en `SIGNAL_REGISTRY` — se calcula en
`lib/screenerComposite.js` a partir del **grupo completo** de filas del
mismo `theme`/sector en el universo:

```js
// lib/screenerComposite.js:93-105
export function sectorScoreForGroup(group = []) {
  const rows = Array.isArray(group) ? group : [];
  const groupSize = rows.length;
  const avg3 = avg(rows.map((row) => row.perf3m || 0));
  const avg6 = avg(rows.map((row) => row.perf6m || 0));
  const leaders = rows.filter(isLeader).length;
  ...
}
```

Igual que `rsGlobalPct`, esto exige conocer `perf3m`/`perf6m` de **todos**
los símbolos del mismo sector en la fecha objetivo — no solo barras del
símbolo mirado. La decisión de producto marca `rsGlobalPct` como "pendiente
de evaluar" (§7) pero no menciona `sectorScore`, que tiene exactamente el
mismo obstáculo estructural y entra al composite con peso 0.10 (además de
alimentar `ipoScore`). Debe resolverse junto con `rsGlobalPct`, no por
separado — ver §7.

### 3.4 — `marketCap` y `speculationRiskScore`: aproximación con dato de hoy

`liquidityScore` lee `row.marketCap`, que viene de `profile.marketCap`
(perfil/fundamentales del proveedor, no de barras):

```js
// lib/researchRow.js:254
marketCap: firstFinite(profile.marketCap),
```

Un replay recalculado usaría el `marketCap` **actual** (el único disponible
sin fundamentales históricos), no el de la fecha objetivo. Para la mayoría
de large/mid caps la distorsión es pequeña salvo splits o emisiones
grandes; para small caps con dilución agresiva puede ser significativa. Esto
propaga a `demandScore` (que pesa `liquidityScore`) y a
`speculationRiskScore` (`lib/relativeStrength.js:276-283`, resta
`liquidityScore*.12`), que a su vez alimenta `weaknessScore` vía
`speculationRiskScore` (`scoringEngine.js` línea 125) y `rsQualityLabel`.

### 3.5 — `rsRating`: solo necesita barras del símbolo y del benchmark

```js
// lib/relativeStrength.js:139-178
export function scoreRelativeStrength(row = {}, benchmarkBars = []) {
  const bench1 = perf(benchmarkBars, 21);
  ...
  const rs1m = Number.isFinite(row.perf1m) && Number.isFinite(bench1) ? row.perf1m - bench1 : null;
  ...
  return { ...campos rs1m/3m/6m/12m, rsRating: ... };
}
```

Confirmado: `rsRating` solo consume `row.perf1m/3m/6m/12m` (derivados de las
barras propias) y `benchmarkBars` (barras del benchmark). No toca
fundamentales ni universo. `benchmarkSymbolForRow`
([relativeStrength.js:99-102](../lib/relativeStrength.js)) resuelve un
benchmark por país vía `LOCAL_BENCHMARK_BY_COUNTRY`
([relativeStrength.js:7-36](../lib/relativeStrength.js)): `SPY` (US),
`^GSPTSE` (CA), `^IBEX` (ES), `^GDAXI` (DE), `^FCHI` (FR), `^AEX` (NL),
`^FTSE` (GB), `^SSMI` (CH), `^OMX`/`^OMXC25`/`^OSEAX`/`^OMXH25` (nórdicos),
`^FTSEMIB.MI` (IT), `^BFX` (BE), `PSI20.LS` (PT), `^ATX` (AT), `^N225`
(JP), `^HSI` (HK), `^STI` (SG), `^J203.JO` (ZA), `^AXJO` (AU), `^TWII`
(TW), `^TA125.TA` (IL), `^KS11` (KR), `^BSESN` (IN), `000001.SS` (CN),
`^BVSP` (BR), `^MXX` (MX); `ACWI` de fallback.

**Hallazgo sobre hidratación, no sobre el cálculo:** el cron batch
(`hydrateBenchmarks`,
[lib/materializedScanner.js:650-661](../lib/materializedScanner.js)) solo
hidrata `SPY`/`QQQ`/`ACWI` — los benchmarks locales (`^IBEX`, `^GDAXI`,
etc.) **no** se cachean ahí, así que una fila no-US calculada por ese camino
cae en `rsBenchmarkIssue:"benchmark insuficiente"`. El camino interactivo
(`lib/serverScanRunner.js:113-125`, función `loadBenchmarks`) sí resuelve
esto: calcula `benchmarkSymbolForRow` por cada símbolo del lote y hidrata
también los locales. Como el replay es una operación por símbolo/fecha (no
un batch), el camino relevante a reutilizar es el de `serverScanRunner.js`,
no el de `materializedScanner.js`. No pude verificar con una consulta real
que `daily_bars` tenga profundidad suficiente para los benchmarks locales
menos usados (ver §3.1).

## 4. Qué existe ya de recálculo a fecha pasada

**Sí existe un mecanismo — parcial, ya en la rama principal.**

`lib/dailyBarsCache.js` acepta una opción `asOf`/`asOfDate` que trunca las
barras devueltas (nunca lo que se escribe en caché) a `date <= asOf`:

```js
// lib/dailyBarsCache.js:118-121
function barsThroughAsOf(bars = [], asOfDate = "") {
  const asOf = toDate(asOfDate);
  if (!asOf) return bars;
  const cutoff = dateMs(asOf);
  ...
}
```

Aplicado en los 3 caminos de `withDailyBarsCache` (cache-hit, live,
stale-fallback) — [lib/dailyBarsCache.js:164-180](../lib/dailyBarsCache.js)
(cache-hit), [:437-448](../lib/dailyBarsCache.js) (live) — y cubierto por
`tests/dailyBarsAsOfReplay.test.js`, cuyo comentario de cabecera dice
explícitamente:

> "Tests de contrato del recorte por asOf en lib/dailyBarsCache.js (**paso 0
> del ADR de replay histórico**)."

Y está expuesto en el API de chart:

```js
// app/api/chart/route.js:56
const asOfDate = searchParams.get("asOf") || searchParams.get("asOfDate") || "";
```

Confirmado con `git log` que esto ya está en `main`/`codex/statsedge-ui-polish`
(commits `df1c929`, `62f14e2`, `9aea1e0` — el primero corrige exactamente el
bug de fuga de barras futuras que este contrato previene).

**Lo que NO existe:** nada conecta ese truncado de barras con
`buildResearchRow`/`SIGNAL_REGISTRY` para producir una fila de research
completa en una fecha pasada. `buildResearchRow` (`lib/researchRow.js:188`)
recibe `chart` ya resuelto — quien lo llama decide qué barras le pasa; hoy
nadie le pasa barras truncadas por `asOf`. El truncado solo llega hasta el
payload de `/api/chart` (gráfico), no hasta el cálculo de señales/etapa/RS.

## 5. Qué habría que construir

Sin diseñar la solución, lo que falta (con lo reutilizable ya identificado):

1. **Función de ensamblado del replay** (nueva, en algún módulo tipo
   `lib/replayRow.js`): recibe `symbol` + `asOfDate`; internamente:
   - Llama `withDailyBarsCache(symbol, { asOf: asOfDate, ... })` — **ya
     existe**, [lib/dailyBarsCache.js](../lib/dailyBarsCache.js).
   - Resuelve el benchmark del símbolo (`benchmarkSymbolForRow`) y pide sus
     barras con el mismo `asOf` — **ya existe** la función de benchmark, el
     truncado por `asOf` **ya existe** para cualquier símbolo (el benchmark
     no es distinto a otro símbolo para `dailyBarsCache`), lo que falta es
     el pegamento que hidrate el benchmark correcto con `asOf` en el camino
     de un solo símbolo (`loadBenchmarks` de `serverScanRunner.js:113-125`
     es el patrón a reutilizar/extraer, hoy pensado para lotes).
   - Obtiene `profile` **actual** (no histórico — no hay fundamentales
     históricos, ver §6) para los pocos campos usados fuera de
     `growthScore`/`epsGrowthProxyScore` (`marketCap`, `ipoDate`).
   - Llama `buildResearchRow(symbol, chart, profile, requireLongHistoryOrOptions, benchmarks)`
     — **ya existe**, sin cambios de firma necesarios en principio.
   - Decide qué hacer con `sectorScore`/`rsGlobalPct` (ver §7) — probablemente
     omitirlos u ofrecer solo la variante local (`rsRating`,
     `rsCountryPct`/`rsSectorPct` de una población parcial), documentando la
     limitación en la UI.
2. **Endpoint o server action** que exponga esto (`app/api/replay/route.js`
   o similar) — no existe ninguno hoy; es nuevo.
3. **UI de selección de fecha** en `app/stock/[symbol]/StockClient.jsx` (o
   donde se muestre la ficha) que pase `asOf` al endpoint nuevo y al
   `/api/chart` existente (que ya soporta `asOf` para el gráfico) — nuevo.
4. **Cobertura/contrato de completitud para el replay**: decidir cómo se
   comunica al usuario cuándo la profundidad de barras en `asOfDate` es
   insuficiente para una señal (p. ej. `sma200` necesita ≥200 sesiones antes
   de `asOfDate`) — análogo a `dataCoverageForRow`/`assertDecisionGrade` que
   ya existen para el escaneo normal
   (`lib/researchRow.js`), pero aplicado a una ventana truncada. Nuevo
   trabajo de adaptación, no una función nueva desde cero.

## 6. Coste de recalcular

Del benchmark medido en
[docs/bench-analyze-2026-08-04.md](bench-analyze-2026-08-04.md) (nota: el
propio documento tiene un aviso de corrección en cabecera que invalida los
números de **rendimiento sostenido de producción en el cron batch**
— 2,118 s/símbolo real por costes fijos del job, no del cómputo — pero deja
explícitamente vigente "el resto del documento", que incluye la
descomposición red-vs-cómputo local citada abajo):

> "El 'costo añadido' de la descarga de perfil (segunda petición HTTP,
> concurrente con la de barras vía `Promise.allSettled`) más el cómputo de
> `buildResearchRow` (18 señales) es de **~18ms por símbolo** a concurrencia
> 8" — [docs/bench-analyze-2026-08-04.md:551-554](bench-analyze-2026-08-04.md)

Y la tabla comparativa de ciclo completo (descarga + `buildResearchRow`) a
distintas concurrencias:
[docs/bench-analyze-2026-08-04.md:451-457](bench-analyze-2026-08-04.md) —
0,095s/símbolo a concurrencia 2 hasta 0,044s/símbolo a concurrencia 8.

**Importante para el replay, no señalado en el documento original:** esos
~18-44ms **incluyen la descarga de perfil por red** (fetch HTTP), no son
cómputo puro aislado — el documento no separa "solo `buildResearchRow`" del
"fetch de perfil + `buildResearchRow`". El replay de un símbolo/fecha es una
operación interactiva de un solo símbolo (no un lote), y las barras del
símbolo y del benchmark, si ya están en caché de Supabase (`daily_bars`),
no requieren red — solo la consulta a Supabase (que también es red, pero de
menor latencia y más predecible que un proveedor externo) y el truncado por
`asOf` (`barsThroughAsOf`, O(n) sobre el array de barras ya en memoria — no
medido por separado, pero es un `filter` simple sobre como mucho 1260
elementos).

**Conclusión, con la cautela del propio benchmark:** recalcular las 18
señales para un símbolo en una fecha, sobre barras ya cacheadas, es del
orden de **decenas de milisegundos**, no de segundos — coherente con que es
exactamente el mismo `buildResearchRow` que ya corre por símbolo en el scan
normal e interactivo. No hay medición específica de una petición interactiva
aislada (sin el resto del ciclo de scan) ni bajo carga concurrente de
usuarios reales; el número citado es de un benchmark local, no sostenido, no
de producción (ver el propio aviso de corrección del documento).

## 7. Lo que se pierde

Con este diseño, **no se podrá responder**:

- "¿Qué `growthScore`/`epsGrowthProxyScore` (o cualquier métrica de
  `growthMetrics`: crecimiento de ingresos, márgenes, ROE/ROA, deuda) tenía
  este símbolo el 15 de julio?" — no se sabe. Fundamentales históricos están
  fuera de alcance (§1).
- "¿Qué `rsGlobalPct` (percentil frente a todo el universo) tenía este
  símbolo en esa fecha?" — pendiente de evaluar (no resuelto por este ADR).
  Requeriría recalcular `rsCompositeRaw` de **todos** los símbolos del
  universo en esa fecha, no solo el mirado.
- "¿Qué `sectorScore` (fuerza del sector) tenía en esa fecha?" — mismo
  problema que `rsGlobalPct` (§3.3), no mencionado explícitamente en la
  decisión de producto pero con idéntico obstáculo estructural.
- "¿Cuál era el `total_score`/composite objetivo completo en esa fecha?" —
  **no exactamente**. De los 12 términos del composite
  (`COMPOSITE_WEIGHTS`, [scoringEngine.js:633-646](../lib/scoringEngine.js)),
  peso 0,16 (`growthScore` + mitad de `epsAnchor`) es 100% no reconstruible,
  y peso ≈0,44 adicional (`rsAnchor`, `rsQualityScore`, parte de
  `demandScore`, `sectorScore`, parte de `ipoScore`) depende de universo
  (`rsGlobalPct`/`sectorScore`, pendientes) o de un dato de hoy usado como
  aproximación (`marketCap` en `liquidityScore`). Solo ≈0,40 del peso
  (`setupQualityScore`, `adProxyScore`, `riskRewardScore`, `riskScore`,
  `momentumScore`) es reconstrucción limpia desde barras. Un replay honesto
  debe mostrar el desglose (etapa, señales técnicas, RS local) y **no**
  presentar un `total_score` histórico como si fuera comparable al de
  producción, salvo que se decida una variante reducida del composite solo
  para replay.
- "¿Cuál era el `marketCap` exacto en esa fecha?" — se usaría el actual como
  aproximación (§3.4); para splits/ampliaciones recientes será incorrecto.

### ¿Depende algo del producto de estas respuestas?

Búsqueda en código y `docs/` de asunciones de fundamentales históricos
disponibles: no encontré ninguna. La única tabla con vocación de histórico
de fundamentales es `fundamental_snapshots`
([supabase/schema.sql:1060+](../supabase/schema.sql), usada por
`lib/fundamentalsCache.js`), con `unique(owner_id, symbol, period_end,
period_type, provider)` — es decir, acumula por **periodo fiscal**
reportado, no por "fecha en que se conoció el dato". No resuelve el
point-in-time que exigiría responder "qué se sabía el 15 de julio", y no vi
en el código ningún consumidor que la trate como tal. No hay contradicción:
la tabla existe para otro propósito (comparables/perfil de empresa actual),
y confirma por qué la decisión de excluir fundamentales históricos evita un
problema real (restatements sin fecha de conocimiento) en vez de uno
imaginario.

## 8. Descartado y por qué

- **Leer `scan_results`/`scan_symbol_history` como fuente del replay** —
  descartado. Acoplaría el replay a la retención de esa tabla (hoy pensada
  para historial de decisiones de scan, no como serie temporal densa por
  símbolo) y a lo que el cron decidiera guardar, en vez de a la fuente
  primaria (barras). Es también la premisa que desbloquea la poda de
  `scan_results` — ver §9.
- **Fundamentales históricos** — descartado por complejidad
  desproporcionada frente al valor para un análisis de etapas técnico (§1,
  §7).

## 9. Consecuencia: desbloquea la poda de `scan_results`

Como el replay **no depende** de `scan_results` ni de `scan_symbol_history`
— toda la reconstrucción sale de `daily_bars` (+ `profile` actual para los
pocos campos no técnicos) — esa tabla puede reducirse a **una fila por
símbolo** (el último scan) sin cerrar esta función. Antes de este ADR,
podar `scan_results` era arriesgado porque no estaba claro si algún futuro
"ver esto en el pasado" necesitaría los snapshots guardados; con la decisión
de recalcular desde barras, esa duda queda resuelta: los snapshots de
`scan_results` no son la fuente de verdad de ningún historial de producto,
son solo el resultado más reciente materializado para lectura rápida.

## LO QUE NO HE VERIFICADO

- **Profundidad real de `daily_bars` en producción** (símbolos, profundidad
  media/máxima, fecha más antigua) — la tabla no está en la lista blanca de
  `mcp__supabase-readonly__supabase_query` en esta sesión, y no hay acceso a
  la Management API de Supabase aquí. Solo verifiqué el **diseño** (tope de
  retención 400/1260 sesiones, esquema). Este es el hueco más importante:
  toda la Parte A de la tarea original pedía esta cifra y no pude obtenerla.
- **Profundidad de barras de los benchmarks locales** (`^IBEX`, `^GDAXI`,
  etc., más allá de `SPY`/`QQQ`/`ACWI`) — mismo motivo.
- **El coste de recálculo (§6) en producción bajo carga real** — el único
  dato es un benchmark local, de una máquina de desarrollo, sin escrituras
  a Supabase, con el propio documento fuente advirtiendo que no es
  extrapolable a comportamiento sostenido. No hay medición de una petición
  de replay aislada (sin el resto del ciclo de scan).
- **Si `assertDecisionGrade`/`dataCoverageForRow` (guard de fila
  decision-grade) se comportan razonablemente sobre una serie de barras
  truncada por `asOf`** — no ejecuté el pipeline con barras truncadas de
  verdad, solo leí el código y los tests unitarios existentes de
  `dailyBarsCache`.
- **Si `sectorScore` puede aproximarse con una población parcial** (p. ej.
  solo los símbolos que StatsEdge ya tiene en universo hoy, con barras
  hidratadas hasta esa fecha) en vez de recalcular todo el universo — no lo
  investigué; queda para cuando se resuelva `rsGlobalPct` (§7), ya que es el
  mismo problema.

## Ampliación del alcance (2026-08-07)

La verificación destapó dos señales con dependencias que la decisión
original no contemplaba. Se resuelven así:

- **`sectorScore`**: necesita la población del sector o tema en la fecha
  pedida, igual que `rsGlobalPct`. Pasa al mismo grupo de PENDIENTE DE
  EVALUAR. En un primer replay puede omitirse o mostrarse marcado como
  no disponible, sin bloquear el resto.
- **`liquidityScore`**: usa `marketCap`, que es dato de perfil y no de
  barras. Se decide mostrarlo con el `marketCap` ACTUAL, no el de la
  fecha. La capitalización cambia despacio y el error introducido es
  menor que la complejidad de fechar los perfiles. Debe quedar visible
  en la interfaz que ese dato es el de hoy, no el de entonces.

Criterio general: si una señal no se puede reconstruir con fidelidad,
se marca como no disponible en vez de mostrarse aproximada sin avisar.


## Profundidad real de daily_bars (verificado 2026-08-07)

La tabla se añadió a la lista blanca del servidor MCP de solo lectura y
se pudo comprobar lo que quedaba pendiente:

- La barra más antigua de AAPL es del **2024-12-27**: unos 19 meses de
  histórico, coherente con el `range: "2A"` que usa el descargador.
- La profundidad **no es uniforme entre símbolos**. Cada uno tiene dos
  años contados desde la primera vez que se descargó, así que un símbolo
  tocado por primera vez ayer no tiene datos de hace 19 meses. El replay
  debe comprobar la profundidad disponible por símbolo antes de ofrecer
  una fecha, no asumir una ventana común.
- Una consulta global ordenada por `trade_date` da timeout: la tabla es
  grande y no hay índice que la soporte. Cualquier consulta de replay
  debe filtrar por símbolo primero.

Límite práctico del replay: **no se puede retroceder más allá de la
primera barra descargada de cada símbolo**, y eso hoy son unos 19 meses
en el mejor caso.

## Corrección (2026-08-07): la poda de scan_results NO queda desbloqueada

Este ADR afirma que, como el replay no depende de `scan_results`, esa
tabla puede podarse a una fila por símbolo. **Esa conclusión es falsa**
y no debe usarse como permiso.

El replay efectivamente no depende de `scan_results`, y eso sigue
siendo cierto. Pero otros tres consumidores sí dependen de que la tabla
conserve varias filas por símbolo, todos anclados a `scan_id`: la
comparación de escaneos en la interfaz, el polling de un escaneo en
curso, y las RPC de finalización de percentiles.

Verificado contra Postgres local: un índice único `(owner_id, symbol)`
falla con error 23505 contra dos escritores reales.

Detalle completo en `docs/poda-scan-results-2026-08-07.md`. El camino
correcto para abaratar la lectura es una vista `DISTINCT ON (symbol)`,
sin borrar filas.
