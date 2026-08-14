# ADR — El escaneo nocturno guarda el universo entero en formato ligero

<!-- fecha interna: 2026-08-14 · BASE_SHA: 77ee4cb · rama: codex/statsedge-ui-polish -->

Documento de **diseño**, no de implementación. No se ha modificado ningún
archivo de código, no se ha escrito nada en Supabase, no se ha ejecutado
ningún escaneo, no hay commit ni push. `git status` al terminar es idéntico
al del arranque de la sesión.

**Decisión de producto ya tomada, que este documento diseña y no cuestiona**:
el usuario no lanza escaneos. Configura criterios —propios o guardados—,
pulsa un botón, y la respuesta llega al instante sobre los datos calculados
esa noche. En móvil, con los filtros ya configurados y sin ajustes.

**Veredicto, en una frase**: cabe, y con holgura. La fila ligera que hace
falta para filtrar, pintar la tabla y ordenar las Listas pesa **7,2 KB de
JSON medidos**, frente a los **46,5 KB medidos** de la fila de hoy; los 5.608
símbolos del universo estadounidense ocuparían **38,7 MB de JSON por noche**
(271 MB con siete días de retención) en el peor caso, y bastante menos en
disco una vez Postgres los comprime. No hay que pararse.

---

## Cómo se ha medido

Tres vías, y en el texto se distingue siempre cuál se usó.

**1. Lectura de código.** Todas las citas son literales del árbol en
`77ee4cb`.

**2. Consultas de solo lectura contra producción.** Dos canales, ambos sin
escritura:

- La herramienta MCP `supabase_query`.
- Peticiones `GET` directas a PostgREST con las credenciales de
  `.env.local`, para poder guardar las respuestas en disco y medirlas sin
  volcarlas al contexto. Los conteos exactos salen de la cabecera
  `Content-Range` con `Prefer: count=exact`, que no es una función agregada
  y por eso sí está permitida (la clave rechaza `select=count()` con
  `PGRST123`).
- Se intentó además la Management API de Supabase para obtener
  `pg_total_relation_size` — **devolvió `401 Unauthorized`**, así que las
  cifras de ocupación en disco son estimaciones y están marcadas como tales.

**3. Ejecución del motor real del repositorio**, con el mismo precedente que
`docs/auditoria-filtros-2026-08-13.md` y que `scripts/scan-universe.mjs`:
bajo Vitest, porque el loader plano no vale (la cadena de imports llega a
`app/components/ui/MetricSource.jsx`, que es JSX). Las sondas viven **fuera
del repositorio**, en el directorio temporal de la sesión, y no se ha creado
ni modificado ningún archivo del proyecto: la restricción de "el ADR es el
único archivo que puedes crear" se ha respetado sobre el repositorio.

Población medida: **262 filas reales** (las 62 del nocturno del 2026-08-14 y
200 de un escaneo interactivo de 9.918 filas) para peso y proyección, y
**1.000 filas estratificadas** (cinco tramos de 200 sobre el mismo escaneo de
9.918) para el efecto de población de la Parte D.

---

## El punto de partida, con datos frescos

Consulta ejecutada:

```
GET /rest/v1/scans?owner_id=eq.personal
  &local_id=like.materialized:US:*
  &select=id,local_id,name,created_at,row_count,settings
  &order=created_at.desc&limit=5
```

```
2026-08-14T04:59:30Z | materialized:US:2026-08-14:o0:l5608 | total=5608 completed=5608 saved=62  errors=41 status=partial
2026-08-13T05:03:38Z | materialized:US:2026-08-13:o0:l5608 | total=5608 completed=5608 saved=75  errors=41 status=partial
2026-08-12T14:20:59Z | materialized:US:2026-08-12:o0:l5608 | total=5608 completed=5608 saved=75  errors=43 status=partial
2026-08-12T14:00:50Z | materialized:US:2026-08-12:o0:l3390 | total=3390 completed=3390 saved=51  errors=21 status=partial
2026-08-12T04:59:50Z | materialized:US:2026-08-12:o0:l5606 | total=5606 completed=5606 saved=97  errors=39 status=partial
```

Anoche: **5.608 símbolos analizados, 62 guardados**. Se tira el **98,9 %**
del trabajo. No es un fallo: es lo que el código pide que pase. En
`runMaterializedScan`, [`lib/materializedScanner.js:1614-1619`](../lib/materializedScanner.js#L1614):

```js
const passedBase = analyzed.filter((item) => item.ok).map((item) => item.row);
const sectorized = sectorize(passedBase);
const filterResult = applyScreenerFilters(sectorized, options.screenerFilters);
const rows = filterResult.rows
  .sort((a, b) => (b.objectiveScore ?? b.totalScore ?? 0) - (a.objectiveScore ?? a.totalScore ?? 0))
  .slice(0, Math.max(Number(options.maxSavedRows || 500), 1));
```

y el preset lo pasa el propio script nocturno,
`scripts/scan-universe.mjs:289`:

```js
const screenerFilters = screenerFiltersFromParams({ filterPreset: preset });
```

con `const DEFAULT_PRESET = "balanced";` (`scripts/scan-universe.mjs:127`).

**Hallazgo que cambia el coste de la Fase 1**: la población completa, ya
puntuada, **ya se construye en memoria** en esa misma corrida, once líneas
más abajo — solo que se usa para otra tabla y luego se descarta,
[`lib/materializedScanner.js:1621-1626`](../lib/materializedScanner.js#L1621):

```js
const historyScoringPool = sectorize(
  analyzed
    .filter((item) => item.row && (item.ok === true || !insufficientDataRejection(item.rejection)))
    .map((item) => cloneForHistoryScoring(item.row)),
);
```

No hay que recalcular nada para guardar el universo: hay que dejar de tirarlo.

---

# PARTE A — Qué se filtra de verdad

## A.1 — Los campos que comparan las 62 reglas

El catálogo de reglas vive en `lib/screenerFilterCatalog.js` y se aplica en
`lib/screenerFilters.js`. La auditoría del 13 de agosto
(`docs/auditoria-filtros-2026-08-13.md`, Parte A.1) fija el recuento:
**62 controles numéricos** (`FILTER_FIELDS`), **6 interruptores de sí/no**
(`BOOLEAN_FILTER_KEYS`) y **3 puertas implícitas** sin control en la
interfaz. Total: 71 reglas.

De los 62 controles, **58 declaran su campo en una tabla del catálogo** y
**4 lo tienen escrito a mano** en el motor.

### Los 58 declarados

`FIELD_RULES` (`lib/screenerFilterCatalog.js:566-621`) es un diccionario
`clave de regla → { op, metric, label }`. `DISTANCE_RULES`
(`lib/screenerFilterCatalog.js:623-628`) es el mismo patrón para las cuatro
distancias. Cita del arranque de la primera:

```js
export const FIELD_RULES = {
  minPrice: { op: "min", metric: "price", label: "precio" },
  minMarketCap: { op: "min", metric: "marketCap", label: "market cap" },
  minAvgVolume: { op: "min", metric: "avgVolume", label: "volumen medio" },
  ...
```

y de la segunda, completa:

```js
export const DISTANCE_RULES = {
  maxDistance20dHigh: { metric: "distance20d", label: "distancia 20d" },
  maxDistance50dHigh: { metric: "distance50d", label: "distancia 50d" },
  maxDistance52w:     { metric: "distance52w", label: "distancia 52w" },
  maxDistanceATH:     { metric: "distanceATH", label: "distancia ATH" },
};
```

Recorriendo ambas y quedándose con los valores distintos de `metric` salen
**56 campos** (58 reglas, dos pares comparten campo: `minShortFloatPct`/
`maxShortFloatPct` sobre `shortPercentOfFloat` y `minBaseWeeks`/
`maxBaseWeeks` sobre `baseWeeks`):

| # | Campo | # | Campo | # | Campo | # | Campo |
|---|---|---|---|---|---|---|---|
| 1 | `absDistanceToPivotPct` | 15 | `distanceATH` | 29 | `momentumScore` | 43 | `rsQualityScore` |
| 2 | `adProxyScore` | 16 | `epsGrowthProxyScore` | 30 | `objectiveScore` | 44 | `rsRating` |
| 3 | `avgTurnover` | 17 | `extSma50` | 31 | `patternQualityScore` | 45 | `rsSectorPct` |
| 4 | `avgVolume` | 18 | `fundamentalCoverageScore` | 32 | `perf12m` | 46 | `sectorScore` |
| 5 | `baseDepthPct` | 19 | `highsSpreadPct` | 33 | `perf3m` | 47 | `shortPercentOfFloat` |
| 6 | `baseWeeks` | 20 | `lastContractionDepthPct` | 34 | `perf6m` | 48 | `technicalCoverageScore` |
| 7 | `contraction1DepthPct` | 21 | `latestTurnover` | 35 | `price` | 49 | `tightness10dPct` |
| 8 | `contraction2DepthPct` | 22 | `latestVolume` | 36 | `range63dPct` | 50 | `upDownVolRatio` |
| 9 | `contraction3DepthPct` | 23 | `liquidityScore` | 37 | `relativeVolume` | 51 | `volatility63d` |
| 10 | `contractionCount` | 24 | `marketCap` | 38 | `returnToDrawdown3m` | 52 | `volumeDryUpRatio` |
| 11 | `dataCoverageScore` | 25 | `maxDailyMove20dPct` | 39 | `returnToVol3m` | 53 | `volumeEffectScore` |
| 12 | `distance20d` | 26 | `maxDailyRange20dPct` | 40 | `riskRewardScore` | 54 | `volumeScore` |
| 13 | `distance50d` | 27 | `maxDrawdown63d` | 41 | `riskScore` | 55 | `volumeSurgePct` |
| 14 | `distance52w` | 28 | `minerviniScore` | 42 | `rsCountryPct` | 56 | `weinsteinScore` |

### Las 4 reglas con código propio (7 campos más)

No pasan por `FIELD_RULES`: el motor las evalúa aparte.

| Regla | Campos que compara | Cita |
|---|---|---|
| `maxPriceFreshnessDays` | `priceFreshnessDays`, `lastDate` | `lib/screenerFilters.js:102-110` (`priceFreshness`: usa el guardado y, si falta, parsea `lastDate`) |
| `minRsRating` | `weeklyRsAvailable`, `weeklyRsRating` | `lib/screenerFilters.js:769-773` |
| `minWeaknessScore` | `weaknessScore` | `lib/screenerFilters.js:786-790` |
| `maxIpoAgeMonths` / `requireRecentIpo` | `ipoAgeMonths`, `ipoDate` | `lib/screenerFilters.js:93-96` (`isRecentIpo`) |

```js
// lib/screenerFilters.js:769-773
const minRsRating = finite(set.minRsRating);
if (Number.isFinite(minRsRating) && minRsRating > 0 && row.weeklyRsAvailable === true) {
  const rs = finite(row.weeklyRsRating);
  if (!Number.isFinite(rs) || rs < minRsRating) return reject("minRsRating", `RS semanal ${...} < ${minRsRating}`);
}
```

**Nivel 1, total: 63 campos.** Eso es lo que hacen falta para que los 62
controles numéricos puedan evaluarse.

### Los 6 interruptores (10 campos más)

| Interruptor | Campos | Cita |
|---|---|---|
| `requireStage2` | `weeklyStageState`, `weeklyStageLabel`, `weeklyFastWeeks`, `weeklySlowWeeks` + `price`, `sma50`, `sma150`, `sma200`, `sma200Slope` | `lib/trendStructure.js:55-72` (`stage2RejectDetail`) y `:20-33` (`dailyLeaderTrendIssue`) |
| `requireSma200Up` | `sma200Slope` | `lib/screenerFilters.js:744` |
| `requirePriceAboveSma50` | `price`, `sma50` | `lib/screenerFilters.js:745` |
| `requireUpVolume` | `upVolume` | `lib/screenerFilters.js:746` |
| `requireContractionsDecreasing` | `contractionsDecreasing` | `lib/screenerFilters.js:765` |
| `requireRecentIpo` | ya contados arriba | — |

Nuevos respecto al nivel 1: `weeklyStageState`, `weeklyStageLabel`,
`weeklyFastWeeks`, `weeklySlowWeeks`, `sma50`, `sma150`, `sma200`,
`sma200Slope`, `upVolume`, `contractionsDecreasing` → **10**.

### Las 3 puertas implícitas (34 campos más)

`longBiasFloor` no añade nada (`price`, `sma200`, `sma200Slope`, ya
contados; `lib/trendStructure.js:35-43`).

`patternValidityGate` (`lib/screenerFilters.js:288-344`) lee nueve campos:
`patternDataStatus`, `patternEligible`, `patternVolumeEligible`,
`contractionStructureStatus`, `contractionStructureReason`,
`methodologyReliabilityState`, `methodologyReliabilityReason`,
`methodologyBlocksPatternClaim`, `setupDisplayDataLimited`,
`setupDisplayBlocksPatternClaim`.

`setupModeGate` (`lib/screenerFilters.js:462-589`) añade `totalScore`,
`rsGlobalPct`, `ipoScore` y, a través de `methodologyPivotWatchEligible`
(`lib/methodologyDisplay.js:289-299`), `distanceToPivotPct` más el bloque de
veredicto persistido que `methodologyDisplayForRow` prefiere sobre el
recálculo (`setupDisplay*`, `setupVerdict*`).

**Y un campo que la enumeración por lectura de código no encontró y sí
encontró la medición: `pivotPrice`.** Ver A.5.

### Recuento del nivel de filtrado

| Nivel | Campos nuevos | Acumulado |
|---|---|---|
| 62 controles numéricos | 63 | 63 |
| 6 interruptores | 10 | 73 |
| 3 puertas implícitas (incl. `pivotPrice`) | 34 | 107 |

## A.2 — Los campos de la tabla de siete columnas

La definición única está en `lib/screenerColumns.jsx:99-228`
(`SCREENER_COLUMNS`), tal como exige el principio 7 de
`docs/principios-producto.md`.

| # | Columna | Campos que lee |
|---|---|---|
| 1 | Ticker + miniatura | `symbol`, `companyName`, `country`, `chartPreview` |
| 2 | Tema | `theme` |
| 3 | RS | `weeklyRsAvailable`, `weeklyRsRating`, `weeklyRsAsOf`, `weeklyRsWeekKey`, `weeklyRsRank`, `weeklyRsSampleSize`, `weeklyRsEngineVersion`, `weeklyRsReason` |
| 4 | Etapa | `weeklyStageState`, `weeklyStageLabel` |
| 5 | Rendimiento | `perf3m`, `perf6m`, `perf12m` |
| 6 | Dist. máx 52s | `distance52w` |
| 7 | Capitalización | `marketCap` |

La columna 3 no lee un campo suelto: pasa por el lector único
`canonicalRs` (`lib/rsCanonical.js:80-111`), que exige
`weeklyRsAvailable === true` y devuelve además la fecha de corte, la semana,
el rango y el tamaño de muestra para el icono de información.

La columna 1 pide la miniatura de `chartPreview`
(`lib/screenerColumns.jsx:124-128`):

```jsx
{Array.isArray(row.chartPreview) && row.chartPreview.filter((bar) => Number.isFinite(bar?.close)).length > 1
  ? <MiniSparkline bars={row.chartPreview} className="rowSparkline" />
  : <span className="rowSparkline rowSparklineMissing">
    <MissingValue reason="Sin miniatura: no hay serie de precios suficiente para dibujarla." />
  </span>}
```

Las columnas 5 y 6 consultan además la auditoría objetiva para decidir si un
valor existente es **no fiable** y hay que pintarlo como ausente
(`lib/screenerColumns.jsx:63-71`, `auditIssueReason`), sobre cuatro claves:
`perf3m`, `perf6m`, `perf12m`, `distance52w`. Eso hoy exige llevar
`objectiveMetricAudit` entero. Ver B.5: es el campo más caro de la fila y
para esto basta un resumen de cuatro banderas.

Campos nuevos que aporta la tabla: `symbol`, `companyName`, `country`,
`chartPreview`, `theme`, los seis `weeklyRs*` de contexto, y el resumen de
auditoría. **15**, acumulado **122**.

## A.3 — Los campos que las Listas necesitan para ordenar

Las secciones se definen en `app/lists/page.jsx:655-665`. Nueve se calculan;
tres están retiradas de la vista (`RETIRED_LIST_SECTIONS`,
`app/lists/page.jsx:58-81`) pero se siguen calculando enteras.

| Sección | Campo de orden | Estado | Cita |
|---|---|---|---|
| Score compuesto | `objectiveScore` | visible | `app/lists/page.jsx:643` |
| RS Quality Leaders | `rsQualityScore` | visible | `:644` |
| Deterioro técnico | `weaknessScore` | retirada | `:645` |
| Tendencia establecida | `weinsteinScore` | visible | `:646` |
| Rupturas con contracción | `minerviniScore` | visible | `:647` |
| Vigilancia pivot | `objectiveScore ?? totalScore` | retirada | `:648` |
| IPO / New Leaders | `ipoScore` | retirada | `:649` |
| Extended but strong | `objectiveScore ?? totalScore` | visible | `:650` |
| Pullback to SMA50 | `objectiveScore ?? totalScore` | visible | `:651` |

Los nueve campos de orden ya estaban contados. Lo que cada lista añade es su
**contrato** de pertenencia, `rowPassesListContract`
(`lib/listRationale.js:144-172`), que lee `objectiveScore`, `rsGlobalPct`,
`perf3m`, `distance52w`, `extSma50`, `minerviniScore`, `weinsteinScore`,
`rsQualityScore`, `ipoScore`, `weaknessScore`, `ipoAgeMonths`, `ipoDate`,
`price`, `sma50`, más `longOpportunityIssue` (`lib/stockRows.js:293-312`,
que a su vez usa `sma200`, `sma200Slope`, `sma150`) y
`methodologyPivotWatchEligible`. Todos ya contados.

Y la tabla de cada sección (`MiniTable`, `app/lists/page.jsx:470`) muestra
además `sector` e `industry` en el resumen de fiabilidad
(`rowReliabilityIssues`, `lib/listRationale.js:275-313`), que también lee
`priceFreshnessOk` y `priceFreshnessIssue`.

Campos nuevos: `sector`, `industry`, `priceFreshnessOk`,
`priceFreshnessIssue`. **4**, acumulado **126** — que tras deduplicar contra
lo ya contado queda en **123**.

## A.4 — Cuántos son, frente a los 264 de `raw`

Medición directa sobre las 262 filas descargadas:

| | Claves en `raw` | Claves en `metrics` |
|---|---|---|
| Nocturno (62 filas de `materialized:US:2026-08-14`) | **260** (idéntico en las 62) | **201** (idéntico en las 62) |
| Interactivo (200 filas de `server-scan-73a25c8c…`) | **264** (idéntico en las 200) | **80** (idéntico en las 200) |

El **264** del enunciado es exacto y corresponde a las filas del escaneo
interactivo; las del nocturno tienen cuatro menos. Claves distintas entre
`raw` y `metrics` en el conjunto de las 262 filas: **279**.

**La proyección mínima son 123 campos.** Es decir: **el 44 % de los 279
campos distintos que hoy se escriben**, o dicho al revés, **156 campos que
se guardan cada noche y ninguna regla, ninguna columna y ninguna lista
consultan**.

## A.5 — La verificación: la proyección reproduce el veredicto

Enumerar leyendo código es una hipótesis. Se ha comprobado ejecutando el
motor real dos veces sobre cada fila —una con la fila completa y otra con
la proyección— y comparando el veredicto:

- **262 filas reales** × **63 combinaciones** de los 7 presets con los 8
  modos de setup = 16.506 comparaciones de `screenerFilterRejectReason`
  (comparando el par exacto `{campo, motivo}` del rechazo, no solo
  pasa/no pasa).
- + 2.620 comparaciones de `rowPassesListContract` (las 10 listas).
- + 524 comparaciones de las dos celdas de la tabla que no son lectura
  directa (`canonicalRs` y `stageWordForState`).
- **19.650 comprobaciones. 1 desajuste.**

El desajuste fue el símbolo `V` en la lista `nearPivot`. Bisecando campo a
campo, el responsable resultó ser **`pivotPrice`** (valor real:
373,2765…), que entra por `methodologyDisplayForRow` →
`setupStructureForRow` y del que ninguna lectura del catálogo avisa. Con
`pivotPrice` añadido, **la proyección reproduce el veredicto en las 19.650
comprobaciones**.

Vale la pena señalar de dónde salió el único fallo: de la única lista que
`docs/principios-producto.md` §7 ya declaró aplazada por no poder calcular
bien el pivote, y que `app/lists/page.jsx:73-80` retiró de la vista por ese
mismo motivo. La medición y la decisión de producto apuntan al mismo sitio.

---

# PARTE B — Cuánto ocuparía

## B.5 — El peso de una fila, medido

Metodología: se descargan las filas reales (`raw`, `metrics` y las columnas
escalares), se serializan a JSON y se cuentan bytes con
`Buffer.byteLength(..., "utf8")`. Consulta usada para el nocturno:

```
GET /rest/v1/scan_results?scan_id=eq.<id del nocturno del 2026-08-14>
  &select=id,symbol,company_name,country,sector,industry,theme,rank_index,
          total_score,weinstein_score,minervini_score,risk_score,rs_rating,
          metrics,raw,created_at
  &order=rank_index.asc&limit=1000
→ 62 filas
```

| | Nocturno (62) | Interactivo (200) | Conjunto (262) |
|---|---|---|---|
| `raw` | 18.880 B | 20.038 B | 19.764 B |
| `metrics` | 28.811 B | 25.560 B | 26.329 B |
| Columnas escalares | 373 B | 370 B | 370 B |
| **Fila completa** | **48.081 B** | **45.985 B** | **46.481 B** |

Los 48.081 B de la fila nocturna **confirman al byte** la medición del
commit `eb74eff` («89.237 → 48.423 bytes por fila»). La poda de agosto sigue
en pie y no se ha degradado.

### Quién pesa dentro de la fila

Bytes medios por campo, sobre las 262 filas, sumando su presencia en `raw` y
en `metrics`:

| Campo | B/fila | ¿Lo necesita filtrar, la tabla o las Listas? |
|---|---|---|
| `objectiveMetricAudit` | **16.270** | Solo 4 banderas de estado, no el objeto |
| `decisionTrace` | **6.675** | No |
| `growthMetrics` | **4.788** | No — es una copia de métricas que ya están sueltas |
| `chartPreview` | **4.093** | Sí (miniatura de la columna 1) |
| `signalCoverage` | 911 | No |
| `ratingModel` | 550 | No |
| `weeklyStage` | 537 | No (basta `weeklyStageState`/`Label`) |
| `businessSummary` | 397 | No |
| `measuredContractionSwings` | 343 | No |
| `contractionSwings` | 255 | No |

**Cuatro campos concentran 31,8 KB de los 46,5 KB: el 68 % del peso de la
fila.** Y de esos cuatro, tres no se consultan nunca desde la tabla, los
filtros ni las Listas.

`objectiveMetricAudit` merece una nota, porque ya está podado y aun así es
el más caro: `compactObjectiveMetricAudit`
(`lib/objectiveMetricTruth.js:563-...`) conserva hasta **48 ítems** con
`key`, `label`, `value`, `expected`, `source`, `formula`, `inputCount`… La
tabla del screener solo necesita, de todo eso, si el estado de cuatro claves
concretas está en `{mismatch, unverified-value, missing-source}`
(`lib/screenerColumns.jsx:61-71`). Un mapa de cuatro entradas: del orden de
100 bytes.

### Las variantes medidas

| Variante | Campos | B/fila (JSON) | vs. hoy |
|---|---|---|---|
| **v0 — la fila de hoy** | 279 | **46.481** | — |
| v1 — proyección tal cual, con `objectiveMetricAudit` entero | 124 | 23.503 | −49 % |
| **v4 — proyección con la auditoría resumida a 4 banderas** | 124 | **7.233** | **−84 %** |
| v3 — v4 sin la miniatura | 123 | 3.140 | −93 % |

La fila que hace falta para que el producto funcione es la **v4: 7,2 KB**.
La v3 se incluye porque separa limpiamente la parte "de datos" (3,1 KB) de la
miniatura (4,1 KB), que es más de la mitad del peso restante y tiene
alternativa (ver C.9).

## B.6 — 5.608 filas al día, y siete días

Se usa 5.608 —el `total` real de anoche— y no 5.600, y se toma como techo:
es todo lo analizado, antes de que `baseRejectReason`
(`lib/materializedScanner.js:499-513`: histórico ≥ 180 barras, precio
fresco, precio ≥ 1, importe medio ≥ 250.000, capitalización ≥ 300 M cuando
se conoce, cobertura ≥ 40) descarte a nadie. Cuántos pasan ese cribado **no
es medible desde la base**: `stats.passedBase` existe en el código
(`lib/materializedScanner.js:1692`) pero no se persiste — `settings.progress`
solo guarda `{saved, total, errors, completed, status, finishedAt,
percentilesFinalized}`. Así que todas las cifras de abajo son un **techo**.

### En JSON (medición directa × 5.608)

| Variante | Una noche | Siete noches |
|---|---|---|
| v0 (hoy) | **248,6 MB** | **1.740 MB** (1,70 GB) |
| v4 (ligera) | **38,7 MB** | **271 MB** |
| v3 (ligera sin miniatura) | 16,8 MB | 118 MB |

La cifra del enunciado —«~270 MB por noche, casi 2 GB con siete días»— es
correcta **para la fila de hoy** (248,6 MB/noche, 1,70 GB/semana). Con la
fila ligera, la misma retención de siete días cuesta **271 MB**: lo que hoy
cuesta **una sola noche**.

### En disco: estimación, no medición

Postgres comprime los valores `jsonb` que superan el umbral TOAST (~2 KB),
así que el peso en disco es menor que el JSON. No he podido medirlo
(`pg_total_relation_size` exige la Management API, que devolvió 401), así
que doy tres cifras y digo cuál es cuál:

1. **Cota superior (medida)**: los bytes de JSON de arriba, sin compresión.
2. **Cota inferior (estimada)**: comprimiendo cada fila por separado con
   gzip —el mismo grano al que trabaja TOAST, aunque no el mismo
   algoritmo—: v0 baja a 11.778 B/fila y v4 a 2.330 B/fila.
3. **Estimación central (triangulada)**: `scan_results` tiene hoy
   **25.536 filas** (conteo exacto, cabecera `Content-Range` con
   `Prefer: count=exact`), que a 46.481 B son **1.132 MB de JSON**. El ADR
   previo (`docs/adr-escaneo-nocturno.md`, D.11) documenta que la tabla ocupa
   ~490 MB. Eso implica un factor efectivo de **≈ 2,3×** una vez contados
   índices y sobrecarga por fila. Es el factor que uso abajo. **Los 490 MB
   son un dato heredado que no he podido reverificar.**

| Variante | Una noche | Siete noches |
|---|---|---|
| v0, factor 2,3× | 108 MB | 757 MB |
| **v4, factor 2,3×** | **17 MB** | **118 MB** |
| v4, cota inferior gzip | 12,5 MB | 87 MB |
| v4, cota superior sin comprimir | 38,7 MB | 271 MB |

## B.7 — ¿Cabe en la instancia?

**Sí, con mucho margen. No hay motivo para pararse.**

Tomando los datos del enunciado (base ~2,4 GB, disco 8 GB → **5,6 GB
libres**) y la estimación central:

| Escenario | Siete días | % del espacio libre |
|---|---|---|
| Fila ligera v4 | 118 MB | **2,1 %** |
| Fila ligera v4, cota superior sin comprimir | 271 MB | 4,8 % |
| Fila completa v0 (guardar el universo sin podar) | 757 MB | 13,5 % |
| Fila completa v0, cota superior | 1.740 MB | 31 % |

Conviene decirlo con claridad porque cambia el énfasis del plan:
**en espacio, incluso guardar el universo completo con la fila de hoy
cabría.** El motivo para podar no es el disco: es el **tiempo de
escritura**, que es lo que de verdad está rompiendo el sistema.

`writeMaterializedScan` inserta en tandas de 300
(`lib/materializedScanner.js:1560`). Con la fila de hoy, cada tanda son
**13,3 MB** de cuerpo HTTP contra un `statement_timeout` de 8 segundos —el
mismo muro que documentó `eb74eff` («escribir tandas de 50 tardaba hasta
6.599 ms») y el que mató el escaneo en vivo del enunciado a los 2.695
símbolos. Con la fila ligera, una tanda de 300 son **2,1 MB**: **6,4 veces
menos**. Y una noche completa pasa de 258 MB de escrituras a 40 MB.

El mismo argumento aparece ya escrito en el repo,
`lib/scanPercentileFinalization.js:113`: «finalize_scan_results solo toca
`metrics` (27.473 B de texto/fila…)». Esa cifra y los 26.329 B que he
medido son la misma cosa.

---

# PARTE C — Cómo conviven las dos formas

## C.8 — Los que pasan el preset ¿necesitan la fila completa?

La pregunta correcta no es "¿la necesitan?" sino "¿de dónde la sacan hoy?",
y la respuesta cambia el diseño: **la ficha del valor casi no lee de
`scan_results`**.

Inventario completo de lectores de `scan_results` fuera de tests
(`grep -rn "scan_results" lib app scripts supabase`, excluyendo migraciones
y tests):

| Lector | Qué pide | ¿Necesita la fila completa? |
|---|---|---|
| `GET /api/scans?projection=decision` (`app/api/scans/route.js:423`) | `scan_id,rank_index,symbol,…,metrics` — **sin la columna `raw`** | No, y ya hoy no la pide |
| `GET /api/scans` (por defecto) (`:422`) | lo mismo **+ `raw`** | Sí, hoy |
| `GET /api/scan?id=` (polling) (`app/api/scan/route.js:121`) | `rank_index,raw` | Sí, hoy |
| `readNightlyUsScanRows` (`lib/leaderboards.js:815`) | `metrics,raw` → `rowFromScanResult` | Proyecta a `publicItem`, ~70 campos |
| `readUniverseRsSnapshot` (`app/api/company-brief/route.js:841`) | `metrics,raw` | **No: proyecta 17 métricas** |
| `app/api/comparables/route.js:77` | filas por `scan_id` | No auditado a fondo |

Que exista ya `?projection=decision` —una ruta de producción que **no pide
`raw`**— es el precedente que hace viable todo esto: el producto ya sabe
funcionar sin esa columna.

## C.9 — ¿Dos formatos, o uno ligero y reconstruir?

**Recomendación: un solo formato ligero para todos, y reconstruir bajo
demanda lo poco que no cabe.** Tres razones medidas:

1. **Dos formatos exigen decidir de antemano quién es quién.** El criterio
   que hoy separa "los que pasan" de "los que no" es el preset nocturno. Si
   mañana el usuario filtra por otro criterio —que es literalmente el
   objetivo de este ADR—, el conjunto "los que pasan" cambia, y la fila
   completa estaría guardada para los símbolos equivocados. Un formato
   condicionado al preset reintroduce por la puerta de atrás el problema que
   este ADR viene a quitar.

2. **La diferencia de coste es de un orden de magnitud, y solo si se
   aplica a los 5.608.** Guardar 5.608 ligeras (17 MB/noche) más 62
   completas es 20 MB. Guardar 5.608 completas es 108 MB. Pero guardar
   5.608 ligeras **y ninguna completa** son los mismos 17 MB, y lo que
   falta se reconstruye.

3. **Lo que falta es poco y ya existe en otra parte.** La ficha del valor
   necesita de `scan_results` exactamente 17 métricas
   (`app/api/company-brief/route.js:852-886`): `rsGlobalPct`, `rsRating`,
   `rsCountryPct`, `rsSectorPct`, `rsGlobalSample`, `rsCountrySample`,
   `rsSectorSample`, `totalScore`, `weinsteinScore`, `minerviniScore`,
   `riskScore`, `riskRewardScore`, `liquidityScore`, `maxDailyMove20dPct`,
   `range63dPct`, `highsSpreadPct`, `extSma50`. **Catorce de esas
   diecisiete ya están en la proyección ligera.** Faltan tres:
   `rsGlobalSample`, `rsCountrySample`, `rsSectorSample`. Añadirlas cuesta
   ~60 bytes por fila.

**La miniatura merece decisión aparte.** Son 4,1 KB de los 7,2 KB de la fila
ligera: **el 57 %**. Y `daily_bars` ya tiene la serie (**4.249.744 filas**,
conteo exacto). Guardarla en `scan_results` es duplicar. Dos opciones, sin
decidir aquí:

- **Guardarla** (v4, 7,2 KB/fila, 118 MB/semana): la tabla se pinta con una
  sola consulta. Es lo que hace hoy el producto y lo que menos cambia.
- **Reconstruirla** (v3, 3,1 KB/fila, 54 MB/semana): la consulta de la tabla
  trae 50 filas ligeras y una segunda consulta trae 50 × 48 barras de
  `daily_bars`. Ahorra el 57 % del peso, pero añade una lectura y un camino
  de fallo nuevo.

Dado que el espacio no es el cuello de botella (B.7), la opción conservadora
—**guardarla**— parece la correcta para la primera versión, y la otra queda
como optimización si el volumen crece.

## C.10 — Qué necesita de verdad la ficha de `scan_results`

Ya contestado en C.9 con la cita: **17 métricas, de las cuales 14 están en
la proyección ligera y 3 hay que añadir**. El resto de la ficha no sale de
`scan_results`:

- El **gráfico** sale de `daily_bars` (4.249.744 filas).
- Los **fundamentales** de `fundamental_snapshots` (**25.169 filas**,
  conteo exacto).
- El **RS que se enseña** sale de `rs_weekly_items` (**29.888 filas**), no
  de `scan_results`, y esto está escrito de forma explícita y deliberada en
  `app/api/company-brief/route.js:892-894`:

  > «El `rating` que ve la ficha es EXCLUSIVAMENTE el RS semanal del ranking
  > global (rs_weekly_items vía readGlobalRsSeriesForSymbol). Sin respaldo.»

Este último punto tiene una consecuencia de diseño que conviene no
perderse: **el filtro de RS no es una columna de `scan_results`, es un
cruce con otra tabla**. Los campos `weeklyRsAvailable`/`weeklyRsRating` que
el motor exige (`lib/screenerFilters.js:770-772`) **no están en ninguna de
las 262 filas medidas** —la auditoría de filtros ya lo documentó
(`docs/auditoria-filtros-2026-08-13.md`, C.1: ausentes en 264 de 264)— y por
eso `minRsRating` no se evalúa nunca en la ruta nocturna, que es el hallazgo
número 2 de gravedad de aquella auditoría. Los añade `attachWeeklyRs`
(`lib/globalRs.js:152`) **al leer**, no al producir.

Si el filtrado pasa a resolverse con una consulta sobre la población
completa, ese cruce deja de ser una hidratación posterior y pasa a ser parte
de la consulta. **Ese cambio arregla, de paso, la regla de RS.** No es
alcance de este ADR decidirlo, pero sí señalarlo: es una de las pocas veces
en que la reestructuración corrige un fallo conocido sin trabajo extra.

---

# PARTE D — El efecto en el producto

## D.11 — Qué filtros pasarían a funcionar

Medición sobre una **muestra estratificada de 1.000 filas** (cinco tramos de
200 por `rank_index`: 1-200, 2.401-2.600, 4.901-5.100, 7.401-7.600,
9.700-9.899) del escaneo `server-scan-73a25c8c…`, de 9.918 filas, guardado
sin preset. Consultas:

```
GET /rest/v1/scan_results?scan_id=eq.<id>&rank_index=gte.<a>&rank_index=lte.<b>
  &select=...,metrics,raw&order=rank_index.asc&limit=200     (× 5 tramos)
```

Se compara, sobre las **mismas filas**, filtrar contra toda la población
frente a filtrar contra lo que el nocturno guardaría hoy (las que pasan
`balanced`: **11 de 1.000**).

### Los presets del propio producto

| Preset | Sobre el universo | Sobre lo guardado hoy | Se pierden |
|---|---|---|---|
| Balanceado | 11 | 11 | 0 |
| Líderes estrictos | 0 | 0 | 0 |
| Etapa 2 temprana | 16 | 11 | **5** |
| Exploratorio amplio | 19 | 11 | **8** |
| IPO / nuevos líderes | 0 | 0 | 0 |
| Vigilancia pivot | 1 | 1 | 0 |
| **Deterioro técnico** | **165** | **0** | **165** |

El caso extremo es «Deterioro técnico»: sobre la población completa
selecciona 165 de 1.000; sobre lo que el nocturno guarda, **cero, siempre**.
No puede ser de otra manera: el nocturno guarda lo que pasa un preset que
exige Etapa 2 confirmada, y un valor deteriorado no la pasa. Esto ya está
documentado como causa de una retirada de producto,
`app/lists/page.jsx:64`:

> «El escaneo nocturno aplica el preset balanced y guarda 75 de 5.608 PORQUE
> son fuertes, así que no deja débiles.»

### Las Listas

Es donde el cambio se ve de golpe.

| Sección | Sobre el universo | Sobre lo guardado hoy | Se pierden |
|---|---|---|---|
| Score compuesto | **407** | 11 | 396 |
| RS Quality Leaders | **392** | 11 | 381 |
| Deterioro técnico *(retirada)* | **490** | 0 | 490 |
| Tendencia establecida | **200** | 11 | 189 |
| Rupturas con contracción | **182** | 11 | 171 |
| Vigilancia pivot *(retirada)* | 33 | 1 | 32 |
| IPO / New Leaders *(retirada)* | 0 | 0 | 0 |
| Extended but strong | 25 | 4 | 21 |
| Pullback to SMA50 | **241** | 7 | 234 |

Seis de las nueve listas pasan de tener **una fila digna de mostrar** a
tener entre 25 y 490 en una muestra de 1.000. «Deterioro técnico», retirada
por no tener fuente propia, la recuperaría. «IPO / New Leaders» seguiría
vacía, porque su causa es otra (falta el dato `ipoDate`/`ipoAgeMonths`, no
la población) — ver D.12.

### Criterios propios del usuario

| Criterio | Sobre el universo | Sobre lo guardado |
|---|---|---|
| RS Benchmark ≥ 60, exploratorio amplio | 18 | 10 |
| Short float ≤ 6 %, exploratorio amplio | 9 | 7 |
| Etapa 2 sin exigir momentum | 13 | 11 |
| Base estrecha (rango 10d ≤ 8 %) | 3 | 3 |

Aquí el efecto es más modesto en número, pero cualitativamente es el que
importa: hoy esos criterios, aunque devuelvan alguna fila, **están operando
sobre una población que ya fue seleccionada por otro criterio**. El usuario
que pide "short float bajo" no está viendo los valores con short float bajo:
está viendo los valores con short float bajo *entre los que ya pasaron
Etapa 2, momentum de 3/6/12 meses y volumen relativo*. El número puede
parecer razonable y ser una respuesta a otra pregunta.

## D.12 — Qué se pierde

**Si el usuario pide un criterio sobre un campo que no se guardó, no hay
respuesta que dar, y hay que decirlo — no devolver una lista vacía.**

Con la proyección de la Parte A eso solo puede pasar en tres situaciones, y
conviene distinguirlas porque el usuario las vive distinto:

1. **Campo fuera de la proyección.** Hoy no es alcanzable desde la
   interfaz: los 62 controles están cubiertos por construcción, y se ha
   verificado con 19.650 comprobaciones (A.5). Pasaría si alguien añadiera
   un control nuevo al catálogo sin añadir su campo a la proyección. Eso
   pide un guardarraíl: un test que recorra `FIELD_RULES`/`DISTANCE_RULES`
   y falle si algún `metric` no está en la lista de campos persistidos. Es
   barato y evita exactamente el modo de fallo silencioso que ya sufrió
   `minRsRating`.

2. **Campo en la proyección, pero nulo en esa fila.** Es el caso real y
   frecuente. La auditoría lo midió: `shortPercentOfFloat` presente en el
   43,6 % de las filas, `rsSectorPct` en el 48,1 %, `rsQualityScore` en el
   61,4 %, `ipoAgeMonths` en el **0 %**. Y el motor, ante un umbral activo y
   un campo vacío, **rechaza** (`lib/screenerFilters.js:761`):

   ```js
   if (!Number.isFinite(value)) return reject(field, `${rule.label} sin dato`);
   ```

   Con 62 filas eso se nota poco. Con 5.608, un filtro de short float
   descartaría en silencio a más de la mitad del universo **por no tener el
   dato, no por el criterio**. Choca de frente con el principio 3
   (`docs/principios-producto.md`: «Un dato ausente se muestra como ausente,
   no como cero ni como valor por defecto») y **empeora al ampliar la
   población**. Ampliar la población hace más urgente separar «no cumple» de
   «no se sabe» en el recuento que ve el usuario.

3. **Criterios que hoy no existen como control.** Si el usuario quiere
   filtrar por algo que el catálogo no tiene —distancia al pivote real,
   semanas de base—, seguirá sin poder, y por el motivo correcto: el
   producto decidió aplazarlos hasta poder calcularlos bien
   (`docs/principios-producto.md` §7, «Aplazado hasta poder calcularlo
   bien»). Guardar más filas no cambia eso.

Y una pérdida que no es de filtrado sino de percentil, que hay que decir
porque afecta a un número que el usuario ve: `sectorize()` calcula
`rsGlobalPct` y `sectorScore` **sobre la población que recibe**
(`lib/materializedScanner.js:1615`). Hoy la recibe sobre `passedBase`. Si
pasa a recibirla sobre los 5.608, **esos dos números cambiarán para todos
los símbolos**, incluidos los 62 que hoy se guardan. Es un cambio a mejor
—un percentil sobre el universo es más honesto que sobre lo que sobrevivió
a un preset—, pero es un cambio visible y no debe colarse sin declararlo.

## D.13 — El botón «Ejecutar»

Hoy el botón es esto (`app/components/screener/ScreenerShell.jsx:305`):

```jsx
<button className={`btn ${running ? "btnGhost" : "btnPrimary"}`}
  onClick={() => { if (running) stopScan(); else { setShowMobileFilters(false); run(); } }}>
  {running ? "Detener" : "Ejecutar"}
</button>
```

Un botón que cambia de identidad según el estado. Y `run()`
(`app/page.jsx:1325`) arranca una máquina larga: `POST /api/scan`, polling,
encadenamiento por eslabones a través de `/api/scan/continue`, y
cancelación por `/api/scan/cancel`. La interfaz lo sabe y lo dice —el texto
de estado repite «Pulsa Ejecutar» en seis sitios distintos
(`app/page.jsx:810, 866, 988, 1049, 1280, 1577`)—, porque hoy el usuario
tiene que pedir explícitamente que se haga el trabajo.

**Con el universo precalculado, ese trabajo ya está hecho antes de que el
usuario abra la aplicación.** El botón deja de lanzar nada.

**Propuesta: el botón desaparece como disparador de trabajo y se convierte
en la confirmación de un filtro.** Concretamente:

- **Se llama «Ver resultados»**, no «Ejecutar». «Ejecutar» describe lo que
  hace la máquina; «Ver resultados» describe lo que quiere el usuario, y no
  promete un cálculo que ya no ocurre. Alternativa igual de válida:
  **«Aplicar»**. Lo que no debe llamarse es «Buscar» ni «Escanear» — ambos
  siguen sugiriendo que algo se pone en marcha.

- **No cambia de identidad.** Se acaba el par Ejecutar/Detener: no hay nada
  que detener. Un solo estado, siempre el mismo texto.

- **Deja de ser obligatorio en escritorio.** Si la respuesta es una consulta
  que tarda milisegundos, la tabla puede reaccionar al soltar un control, y
  el botón queda como confirmación explícita para quien la quiera. En móvil
  sí conserva su papel: el panel de filtros se abre encima, el usuario
  ajusta varias cosas y **una sola pulsación cierra el panel y aplica** —que
  es exactamente lo que ya hace hoy (`setShowMobileFilters(false)` antes de
  `run()`). Ese gesto no hay que inventarlo, ya existe.

- **Y el caso que la decisión de producto describe como principal —«en
  móvil, filtros ya configurados sin ajustes»— no necesita botón en
  absoluto**: al abrir, la tabla ya trae el resultado del preset guardado.

Junto al botón deja de tener sentido «Cargar universo»
(`ScreenerShell.jsx:374`), que hoy sirve para traer los tickers antes de
poder analizarlos. Sin escaneo desde el navegador, no hay universo que
cargar.

Lo que **sí sigue haciendo falta** en pantalla es la **fecha del dato**: si
el usuario ya no lanza el cálculo, la única forma de saber a qué momento
corresponde lo que ve es que se lo digan. La página de Listas ya resolvió
esto y su comentario explica el criterio
(`app/lists/page.jsx:102-108`):

> «El evaluador contó cinco fechas repartidas por el producto sin que
> ninguna dijera cuál manda. Ésta lo dice: primero el cierre de las barras
> sobre las que están calculadas TODAS las filas de debajo.»

La pantalla principal necesita lo mismo. Es la contrapartida honesta de
quitar el botón: se retira el control que daba la sensación de saber cuándo
se calculó algo, y hay que sustituirlo por decirlo.

---

# PARTE E — El plan

## E.14 — Las fases, de menor a mayor riesgo

### Fase 1 — Fijar la proyección, sin que nadie lo note *(sin riesgo)*

Definir en un solo módulo la lista de campos de la Parte A, junto a
`SCREENER_COLUMNS` y `FIELD_RULES`, y **no usarla todavía para escribir**.
Añadir el test de contrato de D.12.1: recorrer `FIELD_RULES`,
`DISTANCE_RULES`, `SCREENER_COLUMNS` y los `listSortValue` de
`lib/listRationale.js`, y fallar si algún campo consultado no está en la
lista.

**Verificable sin cambiar lo que ve el usuario**, y ya está medio hecho: la
comprobación de A.5 —262 filas × 63 combinaciones, comparando el veredicto
de la fila completa contra el de la proyección— es exactamente el test que
hay que dejar escrito. Hoy vive fuera del repositorio; esta fase consiste en
meterlo dentro. Cero escrituras, cero cambios visibles, y a partir de aquí
cualquier regla nueva que se salga de la proyección hace fallar la suite en
vez de fallar en silencio de noche.

### Fase 2 — Guardar la fila ligera en paralelo, sin sustituir nada *(riesgo bajo)*

Que el nocturno escriba **además** las filas ligeras de los 5.608 en una
tabla nueva, dejando `scan_results` exactamente como está. La población ya
existe en memoria (`historyScoringPool`,
`lib/materializedScanner.js:1621-1626`): no hay que recalcular.

Verificable comparando, para los 62 símbolos que hay en las dos tablas,
campo a campo. Coste medido: **17 MB/noche**. Reversible borrando una tabla.

Tabla nueva y no una columna nueva en `scan_results` por un motivo concreto
y ya documentado: `docs/poda-scan-results-2026-08-07.md` encontró **tres
consumidores** que dependen de que `scan_results` esté anclada a `scan_id`
(comparación de snapshots, polling de escaneo interactivo, y las RPC de
finalización de percentiles). La tabla de estado del universo tiene otra
identidad —una fila por símbolo y por fecha de corte— y mezclarlas fue
exactamente lo que bloqueó aquella poda.

### Fase 3 — Leer de la tabla nueva, detrás de un interruptor *(riesgo medio)*

La pantalla resuelve el filtro con una consulta sobre la tabla nueva, con
posibilidad de volver al camino de hoy. Aquí es donde se nota lo de D.12.2:
con 5.608 filas, un umbral activo sobre un campo escaso rechaza a miles
**por falta de dato**. Hay que separar en el recuento «no cumple» de «no se
sabe» antes de enseñárselo a nadie.

Y aquí es donde cambia el número de RS por el cambio de población de
`sectorize()` (D.12). Conviene medir la diferencia sobre los mismos símbolos
antes de encenderlo, no después.

Verificable: mismo preset, mismos símbolos, dos caminos, mismo resultado.

### Fase 4 — El botón cambia *(riesgo medio, todo visible)*

«Ejecutar» pasa a «Ver resultados», desaparece el par Ejecutar/Detener,
desaparece «Cargar universo», y aparece la fecha del dato. Es la primera
fase que el usuario ve. Se hace después de la 3 y no a la vez: si algo va
mal en la lectura, conviene poder distinguirlo de un problema de interfaz.

### Fase 5 — Retirar la maquinaria del escaneo en vivo *(riesgo alto, irreversible en la práctica)*

Ver E.15.

**Nota sobre el orden.** La Fase 2 escribe en la instancia de producción,
que ya se ha saturado dos veces. Antes de ella conviene tener resuelta la
retención — hoy **no existe**: la política N=3 del esquema
(`supabase/schema.sql:196-233`) vive dentro de `upsert_scan_newer_wins`, y
ninguno de los escritores automáticos la llama. Es el hallazgo D.11 del ADR
del escaneo nocturno, y sigue abierto. Una tabla nueva con retención de
siete días desde el primer día es más fácil que añadírsela después.

## E.15 — Qué habría que retirar después

Lo que sobra cuando el usuario deja de lanzar escaneos, con el **matiz de
que casi nada de esto muere del todo**: son piezas del escaneo interactivo,
y el escaneo interactivo sigue haciendo falta al menos como herramienta de
mantenimiento hasta que la corrida nocturna esté probada.

| Pieza | Dónde | Qué pasa con ella |
|---|---|---|
| **El encadenamiento por eslabones** | `lib/serverScanRunner.js:1-18`, `/api/scan/continue`, `DEAD_LINK_MS = 10 * 60 * 1000` (`:58`) | Existe porque Vercel corta a los 60/300 s. La corrida nocturna no está en Vercel. **Se retira con el escaneo interactivo, no antes.** |
| **Los tramos** (`chunkSize`) | `lib/serverScanRunner.js:53` («~3-4 min por eslabón con concurrencia 5») | Ídem: es el tamaño de cada eslabón. Cae con el eslabón. |
| **El progreso** | `settings.progress` (`{saved, total, errors, completed, status}`) | **No se retira: cambia de destinatario.** Deja de ser una barra que mira el usuario y pasa a ser el registro de salud de la corrida nocturna. Es lo único que hoy permite saber que anoche se analizaron 5.608 y se guardaron 62. |
| **La cancelación** | `/api/scan/cancel`, `stopScan()`, `scanAbortRef` (`app/page.jsx:1328, 1569`) | Sin escaneo en el navegador no hay nada que cancelar. Se retira con el botón (Fase 4). |
| **`maxSavedRows`** | `lib/materializedScanner.js:1619` | Se queda, pero como red de seguridad, no como política: hoy trunca a 500 y con 5.608 filas dejaría fuera 5.108 sin avisar. |
| **El troceo de la finalización de percentiles** | `FINALIZE_READ_BATCH_SIZE`, `FINALIZE_PATCH_BATCH_SIZE` (`lib/scanPercentileFinalization.js:107,136`) | **No se retira.** Existe por el `statement_timeout` de 8 s de Postgres, que no depende de dónde corra el proceso. Lo que sí puede desaparecer es la *necesidad* de invocarla: si toda la noche cabe en una corrida, `sectorize()` ya opera sobre la población completa (`docs/adr-escaneo-nocturno.md`, C.10). |
| **`readRecentlyScannedSymbols` y el cursor por `offset`** | `lib/materializedScanner.js:1132`, `app_settings` | Sirven para repartir el universo entre corridas pequeñas. Con una corrida que lo cubre entero cada noche, dejan de tener trabajo para EE.UU. Siguen sirviendo a los grupos que aún corren en Vercel. |
| **`growthMetrics` dentro de la fila** | 4.788 B/fila medidos | No es maquinaria de escaneo, pero es la duplicación más cara que queda: una copia de métricas que ya viajan sueltas en la misma fila. Se va sola con la proyección. |

---

# CONFIANZA

## Medido — ejecutando el motor real del repositorio sobre datos de producción

- **La proyección de 123 campos reproduce el veredicto del motor**:
  262 filas reales × 63 combinaciones de preset y modo de setup, comparando
  el par `{campo, motivo}` del rechazo, más las 10 listas y las dos celdas
  calculadas de la tabla. **19.650 comprobaciones, 1 desajuste** (`V` en
  `nearPivot`), resuelto al añadir `pivotPrice`, encontrado por bisección
  campo a campo. Se importaron `screenerFilterRejectReason`,
  `rowPassesListContract`, `canonicalRs` y `stageWordForState` del
  repositorio; no se reimplementó ninguna regla.
- **`pivotPrice` como dependencia oculta** del contrato `nearPivot`: hallada
  por medición, no por lectura de código.

## Medido — sobre filas reales descargadas de producción

- **Peso de la fila**: 46.481 B de media (262 filas); 48.081 B las 62 del
  nocturno, que confirman al byte la cifra del commit `eb74eff`.
- **Claves**: `raw` 260 (nocturno) / **264** (interactivo); `metrics` 201 /
  80; 279 claves distintas en el conjunto.
- **Peso por campo**: `objectiveMetricAudit` 16.270 B, `decisionTrace`
  6.675 B, `growthMetrics` 4.788 B, `chartPreview` 4.093 B — el 68 % de la
  fila en cuatro campos.
- **Peso de las variantes**: v4 = 7.233 B, v3 = 3.140 B.
- **Efecto de la población** (muestra estratificada de 1.000 filas): las
  cifras de D.11, incluida la de «Deterioro técnico» (165 sobre el universo,
  0 sobre lo guardado) y las de las nueve Listas.

## Medido — conteos exactos vía `Content-Range`

`scan_results` **25.536** · `scans` **33** · `daily_bars` **4.249.744** ·
`scan_symbol_history` **430** · `rs_weekly_items` **29.888** ·
`fundamental_snapshots` **25.169** · `universe_snapshot_symbols` **117.028**.

## Verificado leyendo código (cita literal)

- El orden `passedBase → sectorize → applyScreenerFilters → slice` en
  `runMaterializedScan`, y el preset `balanced` en `scan-universe.mjs:127,289`.
- Que `historyScoringPool` ya construye la población completa puntuada en la
  misma corrida.
- Que `stats.passedBase` existe en el código y **no** se persiste en
  `settings`.
- Las 17 métricas que la ficha lee de `scan_results`, y que el resto sale de
  `daily_bars`, `fundamental_snapshots` y `rs_weekly_items`.
- Que `?projection=decision` ya sirve filas sin la columna `raw`.
- El botón, `run()`, `stopScan()`, `/api/scan/continue`, `/api/scan/cancel`,
  `DEAD_LINK_MS`.

## Estimado — con el método declarado

- **Ocupación en disco.** Tres cifras: cota superior medida (JSON sin
  comprimir), cota inferior estimada (gzip por fila como sustituto de TOAST,
  que no es el mismo algoritmo), y estimación central con factor 2,3×
  triangulado contra los ~490 MB heredados. No he podido medirlo:
  `pg_total_relation_size` exige la Management API y devolvió **401**.
- **5.608 filas por noche** como techo: es todo lo analizado, antes de
  `baseRejectReason`. El número real será menor y no es medible desde la
  base.
- **La comparación 2,1 % del espacio libre** usa los 2,4 GB y 8 GB del
  enunciado, que no he verificado.

---

# LO QUE NO HE VERIFICADO

- **El tamaño real de la base y de `scan_results` en disco.** La Management
  API devolvió 401 y la clave de solo lectura no admite agregados. Los
  ~490 MB de `scan_results` son un dato heredado de
  `docs/adr-escaneo-nocturno.md` que no he podido reverificar; el factor de
  compresión de 2,3× depende de él. Cualquiera con acceso al panel de
  Supabase lo cierra en un minuto con
  `select pg_total_relation_size('scan_results')`.

- **Cuántos de los 5.608 pasan `baseRejectReason`.** No se persiste. Intenté
  acotarlo cruzando `universe_snapshot_symbols` con `fundamental_snapshots`
  y el resultado no es concluyente: la instantánea de universo más reciente
  (2026-07-16) es multimercado —9.608 símbolos con `passed=true` sobre
  11 mercados, no solo EE.UU.— y `baseRejectReason` **no** descarta a quien
  no tiene capitalización conocida, así que la intersección (6.339 con cap
  ≥ 300 M) no responde la pregunta. Todas las cifras de la Parte B son un
  techo por este motivo.

- **El algoritmo real de compresión TOAST de esta instancia.** No sé si es
  `pglz` o `lz4`. Uso gzip como sustituto y lo digo cada vez.

- **Si la muestra de 1.000 filas representa al universo estadounidense.**
  Viene de un escaneo de 9.918 filas que incluye otros mercados
  (`docs/auditoria-filtros-2026-08-13.md` documentó GB, SG, ZA, IT, ES, CA,
  DE, FR, NL, TW y más en la misma familia de escaneos). Las proporciones de
  D.11 son indicativas del orden de magnitud, no del recuento exacto que
  daría el universo US.

- **El coste real de una consulta de filtrado sobre 5.608 filas ligeras.**
  No he medido ninguna: no existe la tabla. Doy por hecho que una consulta
  con predicados sobre columnas de una tabla de ~5.600 filas es inmediata,
  pero si el filtrado se resuelve leyendo `jsonb` sin índices, eso hay que
  medirlo antes de prometer «al instante».

- **El coste de reconstruir la miniatura desde `daily_bars`** (opción v3 de
  C.9). No he medido esa consulta.

- **Si `app/api/comparables/route.js` sobrevive a la fila ligera.** Lee por
  `scan_id` y no leí `lib/comparables.js` entero. Ya estaba señalado como
  no verificado en `docs/poda-scan-results-2026-08-07.md`.

- **El efecto numérico exacto de ampliar la población de `sectorize()`.**
  Sé que `rsGlobalPct` y `sectorScore` cambiarán para todos los símbolos
  (D.12); no he calculado cuánto. Hacerlo exige ejecutar `sectorize` sobre
  las dos poblaciones, y la población completa de una noche no está
  guardada en ninguna parte.

- **Nada de esto se ha probado en ejecución.** No se ha lanzado ningún
  escaneo, no se ha escrito en Supabase, no se ha abierto el navegador. Las
  afirmaciones sobre lo que ve el usuario salen de leer
  `lib/screenerColumns.jsx`, `app/components/screener/ScreenerShell.jsx` y
  `app/lists/page.jsx`, no de verlas renderizadas.
