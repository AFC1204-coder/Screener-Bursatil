# Auditoría: `scanDecisionMetrics` como proyección de `raw` — qué falta y por qué

Fecha: 2026-08-07. Rama: `codex/statsedge-ui-polish`. BASE_SHA: `5e43f17`.

## PARTE A — Qué falta

### 1. `scanDecisionMetrics` completa (cita literal, `lib/scanDecisionProjection.js:10-95`)

```js
export function scanDecisionMetrics(row = {}, settingsOrExplanation = {}) {
  row = prepareScanDecisionRow(row, settingsOrExplanation);
  return {
    totalScore: row.totalScore ?? null,
    objectiveScore: row.objectiveScore ?? null,
    objectiveLabel: row.objectiveLabel ?? null,
    objectiveSetupScore: row.objectiveSetupScore ?? null,
    patternScore: row.patternScore ?? null,
    patternContributionScore: row.patternContributionScore ?? null,
    price: row.price ?? null,
    chartBarsCount: row.chartBarsCount ?? null,
    sma50: row.sma50 ?? null,
    sma150: row.sma150 ?? null,
    sma200: row.sma200 ?? null,
    sma200Slope: row.sma200Slope ?? null,
    dataCoverageScore: row.dataCoverageScore ?? null,
    technicalCoverageScore: row.technicalCoverageScore ?? null,
    fundamentalCoverageScore: row.fundamentalCoverageScore ?? null,
    profileCoverageScore: row.profileCoverageScore ?? null,
    dataCoverageIssues: row.dataCoverageIssues ?? null,
    priceFreshnessOk: row.priceFreshnessOk ?? null,
    priceFreshnessIssue: row.priceFreshnessIssue ?? null,
    priceFreshnessDays: row.priceFreshnessDays ?? null,
    priceFreshnessMaxDays: row.priceFreshnessMaxDays ?? null,
    priceFreshnessLabel: row.priceFreshnessLabel ?? null,
    rsGlobalPct: row.rsGlobalPct ?? null,
    rsRating: row.rsRating ?? null,
    rsCountryPct: row.rsCountryPct ?? null,
    rsSectorPct: row.rsSectorPct ?? null,
    rsCompositeRaw: row.rsCompositeRaw ?? null,
    rsGlobalSample: row.rsGlobalSample ?? null,
    rsCountrySample: row.rsCountrySample ?? null,
    rsSectorSample: row.rsSectorSample ?? null,
    rsQualityScore: row.rsQualityScore ?? null,
    percentileScope: row.percentileScope ?? "batch",
    weinsteinScore: row.weinsteinScore ?? null,
    minerviniScore: row.minerviniScore ?? null,
    momentumScore: row.momentumScore ?? null,
    riskScore: row.riskScore ?? null,
    riskRewardScore: row.riskRewardScore ?? null,
    volumeEffectScore: row.volumeEffectScore ?? null,
    volumeScore: row.volumeScore ?? null,
    liquidityScore: row.liquidityScore ?? null,
    adProxyScore: row.adProxyScore ?? null,
    epsGrowthProxyScore: row.epsGrowthProxyScore ?? null,
    demandScore: row.demandScore ?? null,
    growthScore: row.growthScore ?? null,
    groupStrengthScore: row.groupStrengthScore ?? null,
    sectorScore: row.sectorScore ?? null,
    setupQualityScore: row.setupQualityScore ?? null,
    ipoScore: row.ipoScore ?? null,
    setupDisplayPlanValid: row.setupDisplayPlanValid ?? null,
    setupDisplayActionable: row.setupDisplayActionable ?? null,
    setupDisplayStrict: row.setupDisplayStrict ?? null,
    setupDisplayWatch: row.setupDisplayWatch ?? null,
    setupDisplayReason: row.setupDisplayReason ?? null,
    setupDisplayLabel: row.setupDisplayLabel ?? null,
    setupDisplayDataLimited: row.setupDisplayDataLimited ?? null,
    setupDisplayBlocksPatternClaim: row.setupDisplayBlocksPatternClaim ?? null,
    methodologyReliabilityReason: row.methodologyReliabilityReason ?? null,
    methodologyBlocksPatternClaim: row.methodologyBlocksPatternClaim ?? null,
    weaknessScore: row.weaknessScore ?? null,
    weaknessLabel: row.weaknessLabel ?? null,
    weaknessReasons: row.weaknessReasons ?? null,
    perf3m: row.perf3m ?? null,
    perf6m: row.perf6m ?? null,
    perf12m: row.perf12m ?? null,
    distance52w: row.distance52w ?? null,
    extSma50: row.extSma50 ?? null,
    maxDrawdown63d: row.maxDrawdown63d ?? null,
    shortPercentOfFloat: row.shortPercentOfFloat ?? null,
    relativeVolume: row.relativeVolume ?? null,
    upDownVolRatio: row.upDownVolRatio ?? null,
    compositeScore: row.compositeScore ?? null,
    compositeLabel: row.compositeLabel ?? null,
    compositeReasons: row.compositeReasons ?? null,
    compositeRisks: row.compositeRisks ?? null,
    decisionTrace: row.decisionTrace ?? null,
    objectiveMetricAudit: compactObjectiveMetricAudit(row.objectiveMetricAudit),
    patternBarsCount: row.patternBarsCount ?? null,
  };
}
```

Son **77 claves explícitas** (conté con un regex sobre el `return { ... }` literal, ver metodología abajo). `marketCap` no está entre ellas — es el hallazgo ya verificado. Nótese que hoy, tras el fix del punto 9, son 78.

### 2 y 3. Campos de `buildResearchRow` ausentes en la proyección, y quién los consume

**Hallazgo que cambia el marco del análisis:** hay **tres funciones distintas** que escriben la columna `metrics` de `scan_results`, y solo una usa `scanDecisionMetrics()` "pelada", sin overlay:

| Escritor | Ruta | ¿Usa `scanDecisionMetrics()` sola? |
|---|---|---|
| `lib/serverScanRunner.js:74` (`resultPayload`, escaneo interactivo) | `metrics: scanDecisionMetrics(preparedRow)` | **Sí, sin overlay** → el `metrics` real de estas filas tiene literalmente 77-78 claves |
| `app/api/scans/route.js:60-91` (`resultPayload`, subida de scans del cliente vía RPC `upsert_scan_newer_wins`) | `metrics: { ...scanDecisionMetrics(preparedRow), rsGlobalPct: ..., ... }` (~150 claves más, líneas 61-230) | No — extiende con overlay grande |
| `lib/materializedScanner.js:1470-1600` (`scanResultPayload`, pipeline de escaneo materializado / cron) | `metrics: { ...scanDecisionMetrics(preparedRow), rsGlobalPct: ..., ... }` (~150 claves más) | No — extiende con overlay grande, casi idéntico al anterior |

Verifiqué en datos reales (ver Parte B.5) que **el `metrics` de producción tiene 200 claves**, es decir: las filas persistidas en el periodo muestreado (2026-07-25 a 2026-08-04, 40 filas de varios símbolos y fechas) vienen **todas** del pipeline de `materializedScanner.js` (cron), no de `serverScanRunner.js`. Por eso la comparación relevante para "qué falta hoy en producción" es `raw` (258 claves reales) vs el `metrics` de 200 claves del cron — **no** contra las 77-78 de `scanDecisionMetrics` pelada.

**Los 70 campos presentes en `raw` y ausentes del `metrics` real de producción (200 claves, muestra RUS.TO/CU.TO del 2026-08-04):**

```
avgDailyRange20dPct, avgVolume10, avgVolume5, avgVolume50, baseDays,
benchmarkPerf1m, breakoutAttempt, breakoutQualityScore, chartEstimated,
chartFallbackReason, chartPreview, chartProvider, companyName,
compositeCoverage, compositePartial, contractionScore, country, currency,
dataCoverageLabel, dataProviderOrigin, distanceSma30w, downsideVolatility63d,
exchange, failedBreakout, growthMetrics, industry, ipoAgeMonths, ipoDate,
latestCloseLocationPct, latestVolumeRatio, lowAdvance52w, marketCap, micCode,
patternTimeframe, pivotPrice, pivotTouchCount, prevAvgVolume20, priceSource,
providerMeta, returnToDownsideVol3m, rightSideTight, rs1m, sector,
sharesOutstanding, signalCoverage, sma10w, sma30w, sma30wSlope, symbol,
theme, tightness15dPct, tightnessScore, vcpCandidate, volatilityCompression,
website, weeklyBaseDepthPct, weeklyBaseWeeks, weeklyDistanceFastMa,
weeklyDistanceSlowMa, weeklyFastMa, weeklyFastWeeks, weeklyNearHighPct,
weeklySlopeWeeks, weeklySlowMa, weeklySlowMaSlope, weeklySlowWeeks,
weeklyStage, weeklyStageLabel, weeklyStageState, weeklyStageWeek
```

Si en cambio la fila viene de `serverScanRunner.js` (metrics "pelada", 77-78 claves), la lista de ausentes crece a **188 campos** — incluye además todo lo que el cron sí añade por overlay (`patternFamily`, `setupStructureKey`, `setupVerdictKey`, `floatShares`, `shortRatio`, `sharesShort`, `sharesPercentSharesOut`, `contraction*`, `base*`, `tightness5/10/20dPct`, `pivotClarityScore`, `atr20Pct`/`atr50Pct`, etc.). No encontré evidencia en la muestra de producción de que esta ruta esté generando filas persistidas hoy, pero el código la mantiene activa y sin tests que impidan que diverja aún más.

**Clasificación de consumo** (metodología: grepeé `(row|item|result|r)?.metrics?.<campo>` en `app/` y `lib/` para cada uno de los 70+188 campos — cero resultados para **todos**, en ningún archivo no-test. Ningún consumidor de la base de código lee ninguno de estos campos directamente desde `metrics`). Ver tabla completa en la Parte C.

Sí until encontré consumo de `metrics.<campo>` para un puñado de campos que **ya están** en `scanDecisionMetrics` y por tanto no son parte del problema: `rsGlobalPct`, `rsRating`, `rsCountryPct`, `rsSectorPct` (`app/api/company-brief/route.js:832,845-847`), `totalScore`, `objectiveScore` (`app/api/scan-coverage/route.js:82-83`, `lib/coveragePlan.js:119-120`), `weaknessScore` (`lib/screenerFilters.js:76`), y `signalContradictions` (`lib/leaderboards.js:593` — este campo no proviene de `buildResearchRow`, se calcula después, en `lib/scanPercentileFinalization.js`, y queda fuera del alcance de esta auditoría).

## PARTE B — Por qué existe la proyección

### 4. Justificación documentada

```bash
$ git log --follow --oneline -- lib/scanDecisionProjection.js
7cbbbf2 checkpoint: save all pending scoring engine + cron backstop work before infra sync
b2551c9 checkpoint: stabilize statsedge phase 1

$ git log --oneline --all -S "scanDecisionMetrics"
7cbbbf2 checkpoint: save all pending scoring engine + cron backstop work before infra sync
b2551c9 checkpoint: stabilize statsedge phase 1
```

Solo hay dos commits de "checkpoint" genéricos, sin ADR ni docs asociados que expliquen el diseño. El único comentario en el propio código que da contexto de intención es este, en `lib/scanDecisionProjection.js:1` y la docstring de `scanDecisionRowFromDb` (test `tests/scanDecisionProjection.test.js:11`: *"persiste los campos necesarios para explicar una decision sin leer raw"*). No hay comentario en `scanDecisionMetrics` mismo que explique el criterio de inclusión/exclusión de campos, ni por qué es una lista explícita en vez de una función que reste un denylist. **No hay justificación escrita del porqué `metrics` es un subconjunto y no la fila entera.**

### 5. Diferencia de tamaño entre `raw` y `metrics` en filas reales

Consulta (vía `mcp__supabase-readonly__supabase_query`, tabla `scan_results`):

```
select=symbol,raw,metrics
filter=created_at=gte.2026-08-04T00:00:00&created_at=lt.2026-08-05T00:00:00
limit=2
```

Medido con `json.dumps(...)` en Python sobre las dos primeras filas devueltas:

| symbol | `raw` (bytes JSON) | `metrics` (bytes JSON) | claves `raw` | claves `metrics` |
|---|---|---|---|---|
| RUS.TO | 47 739 | 34 425 | 258 | 200 |
| CU.TO | 47 593 | 34 119 | 258 | 200 |

`metrics` pesa ~72% de `raw` (no es una reducción drástica: gran parte del peso de `raw` es `chartPreview` — hasta 96 barras OHLCV — que si se excluyera de `metrics` explicaría buena parte del ahorro, pero el resto de campos ausentes son numéricos/strings pequeños). **El tamaño no explica por sí solo por qué `metrics` es un subconjunto tan específico**: si el objetivo fuera solo ahorrar espacio, bastaría con excluir `chartPreview` (el campo más pesado, un array de barras) y mantener el resto. En cambio, la proyección excluye selectivamente decenas de campos escalares pequeños (`marketCap`, `sector`, `micCode`, `ipoDate`, etc.) que no mueven la aguja del tamaño.

### 6. Consumidores de `raw` vs consumidores de `metrics`

**Selects contra `scan_results` que piden `metrics` sin `raw`** (dependen 100% de la proyección):
- `app/api/scans/route.js:383` — `resultSelectDecision`, usado cuando `projection=decision` en `GET /api/scans`. **No encontré ningún caller interno en el repo** que pase `projection=decision` (grep de `searchParams`/query strings hacia `/api/scans`); parece una ruta reservada para un cliente externo no presente en este repo, o código muerto. No verificable como "en uso" hoy.
- `lib/materializedScanner.js:1133` — `readRecentlyScannedSymbols`, alimenta `latestScanStateFromRow` (`lib/materializedScanner.js:728`), que lee campos como `metrics.setupVerdictKey`, `metrics.patternFamily`, `metrics.methodologyReliabilityState`. Todos estos SÍ están en el `metrics` de 200 claves del cron (confirmado: ninguno aparece en la lista de 70 ausentes de la Parte A.3), así que **hoy no está roto** para filas escritas por el propio cron. Se rompería si algún día una fila de `serverScanRunner.js` entrara en este mismo re-scan.
- `app/api/comparables/route.js:73` → `lib/comparables.js:16-18` (`rowValue(row,key) = row.raw?.[key] ?? row.metrics?.[key] ?? row[key] ?? null`), consume decenas de campos de patrón/setup (`patternFamily`, `setupStructureKey`, `setupVerdictKey`, `contractionDepths`, etc.). Mismo caso: todos están en el `metrics` de 200 claves del cron; **no roto hoy**, latente si la fila viniera de `serverScanRunner.js`.
- `app/api/favorites/snapshots/route.js:17` — tabla distinta (`favorite_snapshots`), con un `metrics` construido a mano en `app/api/cron/favorite-snapshots/route.js:72-83` (no usa `scanDecisionMetrics`). No aplica a esta auditoría.

**Selects que piden `raw` y `metrics` juntos** (red de seguridad activa):
- `app/api/scans/route.js:382` — `resultSelectFull` (modo por defecto/compacto de `GET /api/scans`).
- `app/api/company-brief/route.js:825`.
- `lib/leaderboards.js` — vía RPC `leaderboard_publishable_rows` (`supabase/migrations/20260710180000_leaderboard_publishable_rows.sql:69-70,99-100`), que devuelve `jsonb_build_object(..., 'metrics', x.metrics, 'raw', x.raw, ...)`. `rowFromScanResult` (`lib/leaderboards.js:367-392`) hace `{ ...metrics, ...raw, ... }`, así que `raw` siempre sobreescribe lo que falte en `metrics`. **A salvo del bug.**

**Consumidores directos de `row.raw` / `item.raw`** (patrón `row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key]` o similar), archivo:línea:
- `app/api/scans/route.js:402` (`compactResearchRow(item.raw)`, solo fuera de `decisionProjection`).
- `app/api/scan/route.js:101` (`results.map((item) => item.raw)`).
- `lib/trendStructure.js:6,12`; `lib/decisionAudit.js:169,176`; `lib/screenerFilters.js:67-80`; `lib/screenerDataHealth.js:24`; `lib/screenerScoreAudit.js:26`; `lib/coveragePlan.js:91,95,119-125`.
- `lib/cachedScreenerRows.js:19,178` (`sourceObject(item.raw)`).
- `lib/scanPercentileFinalization.js:92,100` (reconstruye filas desde `row.raw` explícitamente).
- `app/api/scan-coverage/route.js:50,54,82-91` tiene el mismo patrón de fallback, pero no localicé el select de `scan_results` que alimenta ese archivo — **no verificado**.

En conjunto: la inmensa mayoría de la UI/API lee `row.<campo>` sobre una fila ya aplanada (`raw` sobreescribiendo `metrics`, o viceversa según el caso) y no `row.metrics.<campo>` directamente. Eso explica por qué, pese a que faltan 70-188 campos en `metrics`, casi nada se rompe visiblemente hoy: casi todos los caminos activos siguen trayendo `raw`.

## PARTE C — Los campos que importan

### 7-8. Priorización y filas afectadas en datos reales

Dado que (a) toda la producción muestreada usa el `metrics` extendido del cron con 200 claves, y (b) ningún consumidor activo lee ninguno de los 70 campos ausentes vía `metrics.<campo>` (grep exhaustivo, cero resultados), **ningún campo de la Parte A.3 está hoy en la categoría "AUSENTE Y CONSUMIDO" de forma verificable con código en ejecución**. La tabla siguiente clasifica los 70 según si existe algún consumidor de `row.<campo>` (sin pasar por `metrics`) en código no relacionado con la propia definición — heurística: `grep -rlE '\.<campo>\b' app lib`, excluyendo `researchRow.js`, `materializedScanner.js`, `scanDecisionProjection.js` (donde el campo se define/escribe, no se "consume" como decisión). Un recuento > 0 no prueba que ese consumo dependa de `metrics` — en casi todos los casos consume `row.<campo>` después de que `raw` ya lo aportó; se reporta para ubicar el **riesgo latente** si algún día ese camino pierde `raw`.

| Campo | Usos de `row.<campo>` fuera de su definición | Clasificación | Nota |
|---|---|---|---|
| `symbol` | 90 | AUSENTE PERO NO NECESITADO desde `metrics` | columna propia en `scan_results` (`symbol`) |
| `companyName` | 31 | AUSENTE PERO NO NECESITADO desde `metrics` | columna propia (`company_name`) |
| `country` | 35 | AUSENTE PERO NO NECESITADO desde `metrics` | columna propia |
| `sector` | 29 | AUSENTE PERO NO NECESITADO desde `metrics` | columna propia |
| `industry` | 28 | AUSENTE PERO NO NECESITADO desde `metrics` | columna propia |
| `theme` | 25 | AUSENTE PERO NO NECESITADO desde `metrics` | columna propia |
| `currency` | 20 | AUSENTE Y NO CONSUMIDO desde `metrics` (usado vía `raw`/perfil) | ficha de research, `app/stock/[symbol]/StockClient.jsx` |
| `exchange` | 15 | AUSENTE Y NO CONSUMIDO desde `metrics` | idem, filtros de screener |
| `growthMetrics` | 12 | AUSENTE Y NO CONSUMIDO desde `metrics` | fundamentales; consumido siempre vía `raw`/perfil |
| `ipoDate` | 10 | AUSENTE Y NO CONSUMIDO desde `metrics` | ficha, filtros de IPO |
| `marketCap` | 8 | **AUSENTE PERO LEÍDO DESDE `raw`** (funciona hoy por otra vía) | `lib/scoringEngine.js:328-330` (setup/tamaño), `lib/researchRow.js:127`/`lib/materializedScanner.js:371,621` (coverage + filtro `minMarketCap`), `app/components/screener/QuickReviewModal.jsx:269` (ficha), `app/stock/[symbol]/StockClient.jsx:1164,2081-2083`. Ninguno de estos consumidores pasa hoy por un select "metrics-only", por eso el bug no se manifestó como crash — pero cualquier lector futuro de solo-`metrics` (export, auditoría externa, el propio `projection=decision`) lo recibiría `null`. Es el campo que se corrige en la Parte D. |
| `website` | 7 | AUSENTE Y NO CONSUMIDO desde `metrics` | ficha |
| `pivotPrice` | 6 | AUSENTE Y NO CONSUMIDO desde `metrics` | plan de trade en ficha, siempre con `raw` |
| `failedBreakout` | 6 | AUSENTE Y NO CONSUMIDO desde `metrics` | narrativa de patrón |
| `sharesOutstanding` | 6 | AUSENTE Y NO CONSUMIDO desde `metrics` | fundamentales |
| `chartPreview` | 5 | AUSENTE Y NO CONSUMIDO desde `metrics` | gráfico embebido en ficha (el campo más pesado, ver Parte B.5) |
| `breakoutAttempt` | 5 | AUSENTE Y NO CONSUMIDO desde `metrics` | narrativa de patrón |
| `chartProvider` / `chartEstimated` | 4 c/u | AUSENTE Y NO CONSUMIDO desde `metrics` | badge de calidad de dato |
| `ipoAgeMonths` | 4 | AUSENTE Y NO CONSUMIDO desde `metrics` | categoría IPO |
| `rs1m` | 4 | AUSENTE Y NO CONSUMIDO desde `metrics` | fuerza relativa 1 mes (no forma parte del rating compuesto) |
| `vcpCandidate` | 4 | AUSENTE Y NO CONSUMIDO desde `metrics` | narrativa VCP |
| `signalCoverage`, `weeklyStageLabel`, `pivotTouchCount`, `latestCloseLocationPct`, `rightSideTight`, `weeklyFastWeeks`, `weeklySlowWeeks` | 2-3 c/u | AUSENTE Y NO CONSUMIDO desde `metrics` | ficha/narrativa, siempre vía `raw` |
| Resto (44 campos: `avgVolume5/10/50`, `benchmarkPerf1m`, `compositeCoverage`, `compositePartial`, `dataCoverageLabel`, `dataProviderOrigin`, `patternTimeframe`, `prevAvgVolume20`, `priceSource`, `providerMeta`, `sma10w/30w`, `tightness15dPct`, `tightnessScore`, `volatilityCompression`, `weeklyBaseDepthPct`, `weeklyStage`, etc.) | 0-1 | AUSENTE Y NO CONSUMIDO | sin lector activo detectado en `app/`/`lib/` fuera de su punto de escritura |

**No afecta hoy superficies de decisión** (filtros, ranking, fichas) de forma medible, porque esas superficies siempre reciben `raw` hidratado en los caminos que ejercité (`resultSelectFull`, RPC de leaderboards). El riesgo real es de **contrato roto silencioso**: cualquier código nuevo que decida leer solo `metrics` (como hace ya `latestScanStateFromRow` y `lib/comparables.js`) hereda automáticamente estos huecos, y hoy nada in-code documenta cuáles son "seguros" de leer desde `metrics` y cuáles no.

### 8. Filas afectadas en datos reales (consulta acotada por fecha)

```
select=symbol,metrics
filter=created_at=gte.2026-08-04T00:00:00&created_at=lt.2026-08-05T00:00:00
limit=50   → 16 filas devueltas, todas con 200 claves en metrics (100%)

select=symbol,metrics,created_at
filter=created_at=gte.2026-07-25T00:00:00
order=created_at.desc
limit=40   → 40 filas devueltas, todas con 200 claves en metrics (100%)
```

`marketCap` es `null` en el 100% de las 56 filas muestreadas (2026-07-25 a 2026-08-05) porque ninguna de ellas trae 201+ claves; se confirma que el hallazgo original ("null en 15/15 filas del 4 de agosto", "null en 400/400 de auditorías previas") es consistente y no es un caso aislado.

## PARTE D — El arreglo de `marketCap`

### 9. Cambio aplicado

`lib/scanDecisionProjection.js` — una línea, siguiendo el patrón de la vecina `price`:

```diff
     price: row.price ?? null,
+    marketCap: row.marketCap ?? null,
     chartBarsCount: row.chartBarsCount ?? null,
```

### 10. `npm test` — salida literal completa

```
> test
> vitest run


 RUN  v4.1.8 /Users/alejandrofrutos1204/Documents/Codex/2026-05-13/estoy-desarrollando-un-screener-investment-research/Statsedge-v0.1

(node:93756) ExperimentalWarning: localStorage is not available because --localstorage-file was not provided.
(Use `node --trace-warnings ...` to show where the warning was created)

 Test Files  95 passed (95)
      Tests  1291 passed | 8 skipped (1299)
   Start at  14:56:08
   Duration  14.54s (transform 7.04s, setup 0ms, import 17.03s, tests 24.15s, environment 14ms)
```

### 11. Test añadido

Se extendió el test existente `tests/scanDecisionProjection.test.js` (primer `it`, "persiste los campos necesarios para explicar una decision sin leer raw") en vez de crear un archivo nuevo, porque ya ejercita `scanDecisionMetrics` a través de `snapshotResultPayload`:

```diff
       symbol: "STG",
       companyName: "Stage Radar",
       price: 42.5,
+      marketCap: 3826251264,
       chartBarsCount: 260,
@@
     expect(payload.metrics.price).toBe(42.5);
+    expect(payload.metrics.marketCap).toBe(3826251264);
     expect(payload.metrics.chartBarsCount).toBe(260);
```

El valor `3826251264` es el `marketCap` real de RUS.TO verificado en producción (Parte A/consulta inicial), para que el test documente el caso concreto que motivó el fix.

### 12. Campos NO añadidos (a decidir)

No se tocó ningún otro campo de la lista de 70 (ni de los 188 del camino `serverScanRunner.js`). Quedan para que decidas cuáles entran — ver tabla completa de la Parte C. Los candidatos con mayor uso fuera de su punto de escritura (y por tanto mayor riesgo si algún día pierden `raw`) son, en orden: `currency` (20), `exchange` (15), `growthMetrics` (12), `ipoDate` (10), `website` (7), `pivotPrice`/`failedBreakout`/`sharesOutstanding` (6 c/u).

## `git diff` completo

```diff
diff --git a/lib/scanDecisionProjection.js b/lib/scanDecisionProjection.js
index 31a499e..c08624e 100644
--- a/lib/scanDecisionProjection.js
+++ b/lib/scanDecisionProjection.js
@@ -17,6 +17,7 @@ export function scanDecisionMetrics(row = {}, settingsOrExplanation = {}) {
     patternScore: row.patternScore ?? null,
     patternContributionScore: row.patternContributionScore ?? null,
     price: row.price ?? null,
+    marketCap: row.marketCap ?? null,
     chartBarsCount: row.chartBarsCount ?? null,
     sma50: row.sma50 ?? null,
     sma150: row.sma150 ?? null,
diff --git a/tests/scanDecisionProjection.test.js b/tests/scanDecisionProjection.test.js
index 4ceb647..2ce3ca8 100644
--- a/tests/scanDecisionProjection.test.js
+++ b/tests/scanDecisionProjection.test.js
@@ -13,6 +13,7 @@ describe("scan decision projection", () => {
       symbol: "STG",
       companyName: "Stage Radar",
       price: 42.5,
+      marketCap: 3826251264,
       chartBarsCount: 260,
       dataCoverageScore: 88,
       technicalCoverageScore: 91,
@@ -40,6 +41,7 @@ describe("scan decision projection", () => {
     expect(payload.metrics.decisionTrace.engineVersion).toBe(DECISION_TRACE_ENGINE_VERSION);
     expect(payload.metrics.decisionTrace.priorityScore).toBe(payload.raw.decisionTrace.priorityScore);
     expect(payload.metrics.price).toBe(42.5);
+    expect(payload.metrics.marketCap).toBe(3826251264);
     expect(payload.metrics.chartBarsCount).toBe(260);
     expect(payload.metrics.totalScore).toBeNull();
     expect(payload.metrics.dataCoverageScore).toBe(88);
```

(No hay más archivos modificados: `git status` solo muestra este archivo de informe como nuevo, además de `docs/yahoo-401-crumb-2026-08-05.md` que ya existía sin trackear antes de esta sesión.)

## CONFIANZA

- **Alta**: el hallazgo original (marketCap ausente en `metrics`, presente en `raw`), la lista de 77-78 campos de `scanDecisionMetrics`, el fix aplicado y su test, y el resultado de `npm test` (verificado ejecutando el comando yo mismo, salida pegada literal).
- **Alta**: que el 100% de la muestra de producción (56 filas, 2026-07-25 a 2026-08-05) tiene `metrics` de 200 claves (pipeline cron/`materializedScanner.js`), no de 77-78 (pipeline `serverScanRunner.js`). Verificado con dos consultas Supabase distintas.
- **Media-alta**: la clasificación "ningún campo ausente se lee hoy vía `metrics.<campo>`" — se basa en un grep exhaustivo (`(row|item|result|r)?.metrics?.<campo>`) sobre los 70+188 campos en `app/` y `lib/`, con cero resultados. Un grep no captura acceso dinámico (`row.metrics[computedKey]`) ni código en `sql`/RPC de Postgres que yo no haya revisado completo.
- **Media**: la tabla de "usos de `row.<campo>`" de la Parte C es una heurística de recuento (`grep -c`), no un análisis semántico por archivo — sirve para priorizar, no como prueba de que cada uso dependa de `metrics` faltante.

## LO QUE NO HE VERIFICADO

- Si `projection=decision` (`app/api/scans/route.js:383`) tiene algún consumidor externo (cliente móvil, integración, script) fuera de este repo. Solo puedo afirmar que no hay caller interno visible.
- El origen exacto de las filas que consume `app/api/scan-coverage/route.js` (usa un patrón de fallback a `raw`/`metrics` pero no localicé el select de `scan_results` que las alimenta).
- Si `lib/coveragePlan.js` recibe filas de `scan_results` con `raw` siempre hidratado, o si en algún flujo del universo (`lib/shadowUniverse.js`, jobs de refresh) llegan filas parciales — no tracé esa cadena completa.
- Si existen filas de `serverScanRunner.js` (metrics "pelada", 77-78 claves) en producción fuera de la ventana muestreada (2026-07-25 a 2026-08-05); no pude confirmar ni descartar su existencia histórica.
- Comportamiento de acceso dinámico a `metrics` (por ejemplo, iteración sobre `Object.keys(metrics)` para exportar/serializar) que un grep de patrón fijo no detecta.
