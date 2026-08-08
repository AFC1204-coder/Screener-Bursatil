# Diagnóstico de contradicciones UI — 2026-08-08

Rama `codex/statsedge-ui-polish`, BASE_SHA `dfcbacc`. Documento de **puro
diagnóstico**: no se ha modificado ningún archivo de código, no hay commit,
no se ha escrito en Supabase. Todas las consultas SQL se hicieron vía
`mcp__supabase-readonly__supabase_query` (solo lectura), acotadas al scan
más reciente que incluye los símbolos de ejemplo.

Metodología heredada de `docs/contrato-senales-2026-08-04.md` y del
precedente de doble lectura resuelto en el commit `765e0b0` (unificación de
`weaknessScore` entre `lib/scoringEngine.js` y `lib/stockRows.js`): cita
literal de código, archivo:línea, y verificación contra datos reales antes
de aceptar cualquier hipótesis.

## Scan usado como referencia

```
mcp__supabase-readonly__supabase_query
table: scans
select: *
order: created_at.desc
limit: 5
```

El scan más reciente que contiene FTNT/KO/JNJ/UNH/BAC es:

- `id = 6c35d404-f1d3-4bf9-84ee-077e31c1ab12`
- `name = "Scan servidor 2026-08-08T15:03:24.519Z"`
- `created_at = 2026-08-08T15:03:25.110369+00:00`
- `settings.scanSymbols` incluye `FTNT, KO, JNJ, UNH, BAC` entre otros 45 símbolos.

Todas las consultas de `scan_results` siguientes se acotaron con
`scan_id=eq.6c35d404-f1d3-4bf9-84ee-077e31c1ab12` para evitar el timeout de
consultas sin filtro documentado en las instrucciones de la tarea.

---

## PARTE A — "Fuerza de grupo" (filtro) vs columna "Grp" (tabla)

### A.1 — Componente que renderiza la columna de tabla

`lib/screenerTable.jsx:57` y `lib/screenerTable.jsx:115-118`:

```js
57:          const rsValue = rsUniverseValue(r);
...
115:              <div className="compactMetricGrid">
116:                <CompactMetric label="G" value={Number.isFinite(rsValue) ? rsValue.toFixed(0) : "-"} tone={compactTone(rsValue, 75, 45)} source={metricSource("rsGlobalPct")} zero={isZero(rsValue)} />
117:                <CompactMetric label="Grp" value={Number.isFinite(r.rsSectorPct) ? r.rsSectorPct.toFixed(0) : "-"} source={metricSource("rsSectorPct")} zero={isZero(r.rsSectorPct)} />
118:                <CompactMetric label="Q" value={Number.isFinite(r.rsQualityScore) ? r.rsQualityScore.toFixed(0) : "-"} tone={compactTone(r.rsQualityScore, 70, 40)} source={metricSource("rsQualityScore")} zero={isZero(r.rsQualityScore)} />
119:              </div>
```

La etiqueta literal en el JSX es `"Grp"` (no `"GRP"` en mayúsculas); el
texto en mayúsculas observado en la captura del usuario (`docs/e2e-auth-diagnostico-2026-07-30.md:58,65`, p. ej. `"G 91 GRP 84 Q 80"`) es consistente con una transformación CSS `text-transform: uppercase` sobre la etiqueta del chip — no se encontró una segunda columna llamada `"GRP"` en mayúsculas literales en ningún archivo `.jsx`/`.js` de `app/` o `lib/` (`grep -rn "\bGRP\b" app/ lib/` no devuelve nada; solo aparece en el doc de 2026-07-30 y en `tests/screenerExplainability.test.js`).

**El campo que se muestra bajo "Grp" es `r.rsSectorPct`** (`metricSource("rsSectorPct")`), leído directamente de la fila, sin fallback ni recálculo.

### A.2 — Dónde se define el filtro "Fuerza de grupo" y sus umbrales

`lib/screenerResultView.js:51-60`:

```js
51: export function passesSectorStrength(row = {}, mode = "Todos") {
52:   const score = row.sectorScore ?? row.groupStrengthScore;
53:   if (mode === "Todos") return true;
54:   if (!Number.isFinite(score)) return false;
55:   if (mode === "Fuertes") return score >= 70;
56:   if (mode === "Constructivos") return score >= 55 && score < 70;
57:   if (mode === "Debiles" || mode === "Débiles") return score < 55;
58:   if (mode === "Muy debiles" || mode === "Muy débiles") return score < 40;
59:   return true;
60: }
```

Aplicado en `lib/screenerResultView.js:103`:

```js
103:  if (filters.viewLayers?.sectorStrength) list = list.filter((row) => passesSectorStrength(row, filters.sectorStrength));
```

Las opciones y etiquetas del selector están en `lib/screenerConfig.js:58-64`:

```js
58: const SECTOR_STRENGTH_OPTIONS = ["Todos", "Fuertes", "Constructivos", "Debiles", "Muy debiles"];
59: const SECTOR_STRENGTH_LABELS = {
60:   Debiles: "Débiles",
61:   "Muy debiles": "Muy débiles",
62:   Débiles: "Débiles",
63:   "Muy débiles": "Muy débiles",
64: };
```

Hay además un slider de umbral mínimo independiente, `minSectorScore`
(`lib/screenerFilterCatalog.js:585`, `op: "min", metric: "sectorScore", label: "fuerza grupo"`), aplicado en `lib/screenerPipeline.js:269`. No es el filtro de tiers descrito por el usuario, pero confirma que **todo el subsistema de "fuerza de grupo" lee `sectorScore`**, nunca `rsSectorPct`.

**El campo que lee el filtro es `row.sectorScore` (alias `groupStrengthScore`)**, un score de grupo agregado por tema/sector (`lib/screenerComposite.js:93-159`), no el percentil individual `rsSectorPct`.

### A.3 — ¿Mismo campo o campos distintos?

**Campos distintos.** La columna de tabla ("Grp") lee `r.rsSectorPct`: el
percentil de fuerza relativa de la acción individual dentro de su
sector/tema. El filtro "Fuerza de grupo" lee `row.sectorScore` /
`row.groupStrengthScore`: un score compuesto calculado a nivel de
grupo/sector completo (`sectorScoreForGroup` sobre la población del
scan), no sobre la fila individual. Confirmación de que son alias del
mismo valor de grupo (no del percentil individual) en
`lib/screenerComposite.js:158`:

```js
158:    return { ...row, sectorScore: score, groupStrengthScore: score };
```

### A.4 — ¿Comparación invertida?

No. Los tres umbrales de `passesSectorStrength` (`lib/screenerResultView.js:55-58`) son consistentemente "cuanto más alto, mejor" (`>=70` fuerte, `<55` débil, `<40` muy débil). No hay inversión de operador. La contradicción observada por el usuario **no es un bug de comparación invertida**, es un **mismatch de campo**: la columna visible no es la magnitud que clasifica el filtro.

### A.5 — Verificación con datos reales

```
mcp__supabase-readonly__supabase_query
table: scan_results
select: symbol,metrics
filter: scan_id=eq.6c35d404-f1d3-4bf9-84ee-077e31c1ab12&symbol=in.(FTNT,KO,JNJ,UNH,BAC)
```

(Respuesta filtrada con `jq` sobre el JSON de `metrics` por tamaño de payload.)

| symbol | rsSectorPct (columna "Grp") | sectorScore = groupStrengthScore (filtro) | Tier del filtro con esos valores |
|---|---:|---:|---|
| FTNT | 99 | 36.36 | Muy débil (`<40`) |
| KO | 99 | 32.88 | Muy débil (`<40`) |
| JNJ | 62 | 80.00 | Fuerte (`>=70`) |
| UNH | 87 | 80.00 | Fuerte (`>=70`) |
| BAC | 99 | 50.72 | Débil (`<55`, `>=40`) |

Esto reproduce exactamente el ejemplo reportado por el usuario: FTNT y KO
muestran `Grp` alto (99) en la tabla pero el filtro los clasifica "muy
débil" porque `sectorScore` es bajo (36.36 / 32.88); JNJ y UNH muestran
`Grp` más bajo (62 / 87) pero el filtro los clasifica "fuerte" porque su
`sectorScore` es 80. **Los dos campos no solo son distintos: en esta
muestra están anticorrelacionados**, lo que hace la contradicción visual
más aguda de lo que sería con campos independientes pero no opuestos.

### A.6 — Veredicto

**No es un bug de umbral invertido.** Es una columna de tabla (`Grp` =
`rsSectorPct`, percentil individual dentro del sector) etiquetada de forma
casi idéntica a un filtro que en realidad opera sobre otra magnitud
(`sectorScore`, fuerza agregada del sector/tema completo). Ambos son
señales legítimas y calculadas correctamente por separado — el problema es
de **presentación/nomenclatura compartida** ("grupo"/"Grp"/"fuerza de
grupo" para dos conceptos distintos), no de fórmula rota.

---

## PARTE B — RS global: tabla vs ficha de stock

### B.1 — De dónde saca el RS global la tabla

`lib/screenerTable.jsx:57,116` (ya citado arriba) usa `rsUniverseValue(r)`,
definida en `lib/relativeStrength.js:87-89`:

```js
87: export function rsUniverseValue(row = {}) {
88:   return firstFinite(row.rsGlobalPct);
89: }
```

La tabla lee **directamente `row.rsGlobalPct`**, el percentil persistido
del último scan, sin recálculo ni fallback a otro campo.

### B.2 — De dónde saca el RS global la ficha de stock

`app/stock/[symbol]/StockClient.jsx:1719-1721`:

```js
1719:  const weeklyGlobalRs = latestWeeklyRs(rs);
1720:  const rsUniverse = finiteValue(weeklyGlobalRs?.rsRating, rs.rsGlobalPct);
1721:  const rsBenchmark = finiteValue(rs.benchmarkRating, rs.rsRating);
```

`latestWeeklyRs`, `app/stock/[symbol]/StockClient.jsx:496-498`:

```js
496: function latestWeeklyRs(rs = {}) {
497:   return Array.isArray(rs.globalRsSeries) ? rs.globalRsSeries.at(-1) : null;
498: }
```

Y en el componente que pinta el número "RS global",
`app/stock/[symbol]/StockClient.jsx:519-522,552`:

```js
519:   const weeklyScore = finiteValue(weekly?.rsRating);
...
521:   const snapshotScore = finiteValue(rs.rsGlobalPct);
522:   const globalScore = finiteValue(rsUniverse, weeklyScore, snapshotScore);
...
552:         <RsMetric label="RS global" value={rsFmt(globalScore)} detail={sampleText(globalSample)} tone={scoreTone(globalScore)} source={sourceForSample("RS global", globalScore, globalSample, 20, sourceLine)} />
```

`finiteValue(a, b, c, ...)` devuelve el primer argumento finito en orden de
prioridad. Por tanto el orden de prioridad real es:
`weeklyGlobalRs.rsRating` → `rs.rsGlobalPct` (via `rsUniverse`) →
`weeklyScore` (repetido) → `snapshotScore` (repetido, `rs.rsGlobalPct`).
En la práctica: **si existe un valor semanal, gana sobre el percentil
persistido del scan**, aunque ambos representen conceptualmente "el mismo"
RS global 0-99.

### B.3 — ¿Recálculo sobre otra población?

Sí, pero no es un recálculo en el cliente sobre "solo el símbolo": es una
**fuente de datos completamente distinta**, un job semanal por lotes que
persiste en su propia tabla. En `lib/globalRs.js:20-33`:

```js
20:   const rows = await supabaseRequest("rs_weekly_items", {
...
24:       "select=symbol,snapshot_date,week_key,base_currency,engine_version,rank_index,rs_rating,rs_raw,sample_size,metrics",
...
33:       rsRating: finiteOrNull(row.rs_rating),
```

Mientras que `rsGlobalPct` sale de la fila del scan más reciente en
`app/api/company-brief/route.js:847-863`:

```js
847:   const rsGlobalPct = firstFinite(row.raw?.rsGlobalPct, row.metrics?.rsGlobalPct);
848:   if (!Number.isFinite(rsGlobalPct)) return null;
...
859:     rsGlobalPct,
860:     rsRating: firstFinite(row.raw?.rsRating, row.metrics?.rsRating, row.rs_rating),
...
863:     rsGlobalSample: scanMetric(row, "rsGlobalSample"),
```

Es decir: **dos pipelines distintos, dos poblaciones/universos distintos,
dos cadencias distintas** (`rs_weekly_items` es un job semanal con su
propio `engine_version`; `scan_results.metrics.rsGlobalPct` sale del
percentil calculado en el scan interactivo/cron más reciente vía
`enrichRelativePercentiles`, documentado en
`docs/contrato-senales-2026-08-04.md`, sección B.1). El propio código deja
constancia explícita de que son magnitudes distintas conceptualmente
similares pero no intercambiables — comentarios literales:

`app/api/company-brief/route.js:541`:
```js
541:     note: "Linea relativa vs benchmark rebased a 100. No es el RS StatsEdge 0-99; ese score sale del universo de la web.",
```

`app/api/company-brief/route.js:948` (aprox., citado por agente de
investigación; no releído directamente por mí en esta sesión — ver "no
verificado"):
```js
948:     note: "RS StatsEdge = percentil 0-99 calculado desde el universo de la web. RS Benchmark solo mide comparativa frente al benchmark asignado.",
```

### B.4 — ¿`rsRating` mal etiquetado como "RS global"?

No exactamente. `lib/relativeStrength.js:91-93` define un tercer campo,
`rsBenchmarkValue`, que sí es una magnitud distinta (comparación 1-99
contra un benchmark único, no percentil poblacional):

```js
91: export function rsBenchmarkValue(row = {}) {
92:   return firstFinite(row.rsRating);
93: }
```

Este se usa por separado como "RS bench" en la ficha
(`app/stock/[symbol]/StockClient.jsx:1721`), correctamente diferenciado de
"RS global" en la UI. El problema no es una confusión de etiqueta con
`rsRating`; es que **"RS global" en la ficha puede venir de dos fuentes
percentiles distintas** (`weeklyGlobalRs.rsRating` persistido en
`rs_weekly_items`, o `rs.rsGlobalPct` persistido en `scan_results`), y la
prioridad favorece silenciosamente la primera cuando ambas existen.

### B.5 — Verificación con datos reales

```
mcp__supabase-readonly__supabase_query
table: scan_results
select: symbol,metrics
filter: scan_id=eq.6c35d404-f1d3-4bf9-84ee-077e31c1ab12&symbol=in.(FTNT,UNH)
```

| symbol | rsGlobalPct (persistido, scan_results) | rsRating (persistido, scan_results) | Valor mostrado en ficha (reportado por usuario) |
|---|---:|---:|---:|
| FTNT | 97 | 85 | 90 |
| UNH | 91 | 73 | 78 |

**Ninguno de los dos campos persistidos en `scan_results` coincide
exactamente con el valor que muestra la ficha (90 y 78).** Esto es
consistente con la hipótesis de código: la ficha probablemente está
mostrando `weeklyGlobalRs.rsRating`, un valor que vive en la tabla
`rs_weekly_items`, **no incluida en la lista de tablas permitidas para
`mcp__supabase-readonly__supabase_query`** (la whitelist es: `scans,
scan_results, scan_symbol_history, symbol_resolutions,
shadow_instruments, app_settings, favorites, provider_runs,
scan_executions, scan_result_sets, scan_work_items,
scan_result_set_rows, universe_snapshots, universe_snapshot_symbols,
daily_bars, fundamental_snapshots`). Por tanto **no pude confirmar
numéricamente que 90 y 78 provienen de `rs_weekly_items.rs_rating`** — la
conclusión de fuente se apoya en la lectura literal del código
(`StockClient.jsx:1720`, `lib/globalRs.js:20-33`), no en una consulta SQL
directa a esa tabla. Ver sección "LO QUE NO HE VERIFICADO".

### B.6 — Veredicto

**Doble lectura confirmada, mismo patrón que el bug de `weaknessScore`
resuelto en `765e0b0`.** La tabla lee siempre `rsGlobalPct` del scan más
reciente. La ficha de stock prioriza un valor equivalente pero calculado
por un pipeline semanal independiente (`rs_weekly_items` /
`weeklyGlobalRs.rsRating`) y solo cae a `rsGlobalPct` si ese pipeline no
tiene dato. Como los dos pipelines corren en cadencias y universos
distintos, es esperable que difieran para el mismo símbolo el mismo día.

---

## PARTE C — Conteo del filtro de Fiabilidad

### C.1 — Dónde se calculan los contadores

`lib/screenerReliability.js`. Etiquetas, líneas 6-11:

```js
6:  const RELIABILITY_FILTERS = [
7:    { key: "reliable", label: "Alta fiabilidad", shortLabel: "Fiable", tone: "good" },
8:    { key: "reviewable", label: "Revisables sin bloqueo", shortLabel: "Revisables", tone: "neutral" },
9:    { key: "needs-validation", label: "Validar primero", shortLabel: "Validar", tone: "warn" },
10:   { key: "blocked", label: "Bloqueadas", shortLabel: "Bloq.", tone: "bad" },
11: ];
```

Clasificación por fila, `lib/screenerReliability.js:166-189,224-227`:

```js
166:  const observationReady = ["ready", "partial"].includes(dataKey)
167:    && ["ready", "needs-work"].includes(evidenceKey)
168:    && scoreTraceable
169:    && confidence.key !== "very-low"
170:    && !blocked
171:    && restoredAudit.key === "audit-ready";
172:  const reliable = observationReady
173:    && dataKey === "ready"
174:    && evidenceKey === "ready"
175:    && ["high", "medium"].includes(confidence.key)
176:    && !hasIssueSeverity(issues, "bad")
177:    && methodWarnings.length === 0;
178:  const needsValidation = !blocked && !reliable && (
179:    dataKey !== "ready"
180:    || evidenceKey !== "ready"
181:    || scoreKey !== "clean"
182:    || restoredAudit.key !== "audit-ready"
183:    || confidence.key === "low"
184:    || confidence.key === "very-low"
185:    || hasIssueSeverity(issues, "warn")
186:    || hasIssueSeverity(issues, "bad")
187:    || methodWarnings.length > 0
188:  );
189:  const key = blocked ? "blocked" : reliable ? "reliable" : needsValidation ? "needs-validation" : "reviewable";
```

y el objeto que se devuelve por fila (líneas 224-227):

```js
224:    reliable,
225:    reviewable: observationReady || reliable,
226:    needsValidation,
227:    blocked,
```

El conteo agregado, `lib/screenerReliability.js:248-257`:

```js
248: export function buildScreenerReliabilitySummary(rows = [], settingsOrExplanation = {}) {
249:   const list = Array.isArray(rows) ? rows : [];
250:   const counts = new Map(RELIABILITY_FILTER_ORDER.map((key) => [key, 0]));
251:   for (const row of list) {
252:     const state = buildScreenerReliability(row, settingsOrExplanation);
253:     if (state.reliable) counts.set("reliable", (counts.get("reliable") || 0) + 1);
254:     if (state.reviewable) counts.set("reviewable", (counts.get("reviewable") || 0) + 1);
255:     if (state.needsValidation) counts.set("needs-validation", (counts.get("needs-validation") || 0) + 1);
256:     if (state.blocked) counts.set("blocked", (counts.get("blocked") || 0) + 1);
257:   }
```

Y el filtro individual usado cuando se hace click en un chip,
`lib/screenerReliability.js:238-246` (numeración aproximada según el
agente de investigación que localizó el bloque; contiene explícitamente):

```js
if (filter === "reliable") return state.reliable;
if (filter === "reviewable") return state.reviewable;
if (filter === "needs-validation") return state.needsValidation;
if (filter === "blocked") return state.blocked;
```

### C.2 — ¿Puede una fila contar en dos categorías?

**Sí, por diseño de la estructura de datos, aunque el propio módulo ya
calcula una clasificación mutuamente excluyente que no usa para contar.**
La línea 189 (`const key = blocked ? "blocked" : reliable ? "reliable" :
needsValidation ? "needs-validation" : "reviewable"`) es exactamente una
cadena if/else-if que asignaría cada fila a **una sola** categoría — y de
hecho se usa para la etiqueta/tono de la insignia individual de cada fila
(`meta = RELIABILITY_LABELS.get(key)`). Pero `buildScreenerReliabilitySummary`
(líneas 248-257) y `screenerReliabilityMatchesFilter` **no leen `state.key`**;
leen los cuatro booleanos independientes `reliable`, `reviewable`,
`needsValidation`, `blocked` con cuatro `if` separados (no `else if`), así
que una fila puede incrementar más de un contador y coincidir con más de
un filtro individual.

### C.3 — Por qué "Alta fiabilidad" y "Revisables sin bloqueo" devuelven ambas la fila BAC

La causa exacta está en la definición de `reviewable`
(`lib/screenerReliability.js:225`):

```js
225:    reviewable: observationReady || reliable,
```

Y `reliable` (línea 172) tiene `observationReady` como su primer
operando obligatorio:

```js
172:  const reliable = observationReady
173:    && dataKey === "ready"
...
```

Es decir, **`reliable` es un subconjunto lógico de `reviewable`**: toda
fila para la que `reliable === true` hace automáticamente
`reviewable === true` (porque `reliable` implica `observationReady`, y
`reviewable` es `observationReady || reliable`). No es una coincidencia de
campos no relacionados: es una relación de subconjunto explícita en el
propio operador `||`. Para BAC, que cumple todas las condiciones de
`reliable`, ambos booleanos son `true` simultáneamente, así que aparece en
ambos contadores y en ambos filtros individuales.

### C.4 — ¿Diseño intencional (chips solapados) o tiers mutuamente excluyentes rotos?

No hay ningún comentario o docstring en `lib/screenerReliability.js` que
documente que estos cuatro contadores deban solaparse. Al contrario: el
propio archivo ya construye la clasificación excluyente `key`
(línea 189) para exactamente este propósito (una etiqueta por fila), y
las cuatro etiquetas ("Alta fiabilidad", "Revisables sin bloqueo",
"Validar primero", "Bloqueadas") se presentan en la UI como una taxonomía
aparentemente exhaustiva y excluyente (como en la cadena `key`), pero el
conteo (`buildScreenerReliabilitySummary`) y el filtrado individual
(`screenerReliabilityMatchesFilter`) usan los booleanos independientes en
lugar de `state.key`. Esto se lee como una **inconsistencia real de
implementación** — el resumen y el filtrado deberían derivarse de
`state.key` (una fila, un bucket), no de los cuatro booleanos donde
`reviewable` es deliberadamente un superconjunto de `reliable`.

### C.5 — Consistencia de la suma observada por el usuario

"Alta fiabilidad (1)" + "Revisables sin bloqueo (1)" + "Validar primero
(7)" = 9 sobre 8 acciones es exactamente el efecto esperado si una sola
fila (BAC) cuenta en dos contadores (`reliable` y `reviewable`) a la vez:
8 filas reales, 1 duplicada = 9 conteos. No se consultó `scan_results`
para reproducir el conteo exacto de 7/1/1 sobre el universo específico
mostrado al usuario porque `buildScreenerReliability` depende de
`explainScreenerRank`/`buildScreenerDataHealth`/`buildDecisionEvidenceChecklist`,
que a su vez consumen columnas y configuración de sesión (`settingsOrExplanation`)
no reproducibles fielmente solo con `supabase_query`; ver "LO QUE NO HE
VERIFICADO".

---

## PARTE D — Alcance: otras superficies y otras métricas

### D.1 — Superficies que muestran RS o fuerza de grupo

Búsqueda: `grep -rln "rsGlobalPct\|rsSectorPct\|sectorScore\|groupStrengthScore" app/`. Resultado y qué campo lee cada una:

| Superficie | Archivo | Campo leído |
|---|---|---|
| Tabla de resultados (columnas "G"/"Grp"/"Q") | `lib/screenerTable.jsx:57,116-118` | `rsGlobalPct` (G), `rsSectorPct` (Grp), `rsQualityScore` (Q) — lectura directa |
| Filtro "Fuerza de grupo" / slider `minSectorScore` | `lib/screenerResultView.js:51-60,103`; `lib/screenerFilterCatalog.js:585`; `lib/screenerPipeline.js:269` | `sectorScore` / `groupStrengthScore` |
| Ficha de stock, panel "Fuerza relativa" | `app/stock/[symbol]/StockClient.jsx:519-552` | `weeklyGlobalRs.rsRating` (prioridad), fallback `rs.rsGlobalPct`; además muestra por separado `rs.rsCountryPct` y `rs.rsSectorPct` (etiquetados "RS pais" y "Grupo") |
| `/market-health` | `app/market-health/page.jsx` (uso de `sectorScore`/`groupStrengthScore` confirmado por grep; no releído en profundidad en esta sesión) | `sectorScore`/`groupStrengthScore` (ver "no verificado") |
| `/sectors` | `app/sectors/page.jsx` | `sectorScore`/`groupStrengthScore` y umbrales de fuerza (ver grep inicial de "MUY DÉBIL"/"Fuerza de grupo") |
| `/review` (revisión de decisiones) | `app/review/page.jsx` | `rsCountryPct`, `rsSectorPct` (confirmado por grep; no releído línea a línea) |
| `ResultFilterBar` (selector de "Fuerza grupo" en la barra de filtros) | `app/components/screener/ResultFilterBar.jsx:118-119` | `SECTOR_STRENGTH_OPTIONS`/`SECTOR_STRENGTH_LABELS` sobre `sectorStrength` (que internamente filtra por `passesSectorStrength`, es decir `sectorScore`) |
| `useResultViewModel` (conteos por chip de fuerza de grupo) | `app/components/screener/useResultViewModel.js:580-588` | `passesSectorStrength(row, key)` → `sectorScore` |
| `QuickReviewModal` | `app/components/screener/QuickReviewModal.jsx` | uso de campos RS confirmado por grep; no releído en detalle |
| `ScreenerOriginPanel` | `app/ScreenerOriginPanel.jsx` | uso de campos RS confirmado por grep; no releído en detalle |
| `app/api/scans/route.js` | uso de campos RS confirmado por grep; no releído en detalle | — |
| Exportación CSV (`app/page.jsx:1554-1564`, función `csv(filteredRows)`) | No se confirmó qué columnas exactas incluye el CSV (headers `h`) ni si usa `rsGlobalPct`/`rsSectorPct` directamente o pasa por otra capa. **No verificado.** | — |
| `research-desk`, `lists` (posible watchlist/comparador) | `app/research-desk/page.jsx`, `app/lists/page.jsx` | No se comprobó si muestran RS/fuerza de grupo; solo se identificaron como superficies con navegación de símbolos. **No verificado.** | — |

### D.2 — ¿Otras métricas con el mismo patrón de doble lectura?

| Métrica | ¿Doble lectura tabla vs ficha? | Evidencia |
|---|---|---|
| `weaknessScore` | **Ya resuelto** (fuera de alcance de esta tarea, pero es el precedente metodológico). Antes de `765e0b0`, `lib/stockRows.js` tenía una implementación paralela de 5 factores frente a los 15 de `scoreWeakness` en `lib/scoringEngine.js`. Commit `765e0b0` unificó ambas. | `git show 765e0b0` |
| `dataCoverageScore` / `technicalCoverageScore` | Duplicado de producción **ya documentado** en `docs/contrato-senales-2026-08-04.md` sección C.2 (dos copias de `dataCoverageForRow`, una con `ebitdaMargin` extra). No se encontró una tercera lectura divergente en la ficha de stock: `grep -n "dataCoverageScore" app/stock/[symbol]/StockClient.jsx app/api/company-brief/route.js` no devolvió resultados — la ficha no muestra ese campo bajo ese nombre. | Grep vacío en `StockClient.jsx`/`company-brief/route.js` |
| `momentumScore` | No se encontró evidencia de que la ficha de stock muestre `momentumScore` en absoluto (`grep -n "momentumScore" app/stock/[symbol]/StockClient.jsx app/api/company-brief/route.js` vacío). No hay doble lectura porque no hay segunda lectura. | Grep vacío |
| Volumen relativo (`relativeVolume`) | **Posible caso distinto, no confirmado como bug.** La tabla usa `r.relativeVolume` (`lib/screenerTable.jsx:130`). La ficha de stock calcula localmente `relativeVolume50` (`app/stock/[symbol]/StockClient.jsx:1299`: `latest.volume / avgVolume50`, ventana de 50 días) a partir de las barras del gráfico. Son nombres de campo distintos (`relativeVolume` vs `relativeVolume50`) y no se encontró que la ficha la muestre bajo la misma etiqueta "RV" que la tabla — no pude confirmar si `relativeVolume50` se renderiza visiblemente en algún punto de la ficha bajo un rótulo que un usuario confundiría con el de la tabla. **No verificado si esto es un bug de doble lectura real o dos métricas legítimamente distintas sin colisión de UI.** | `lib/screenerTable.jsx:130`; `StockClient.jsx:1299` |
| Score compuesto (`totalScore`/`objectiveScore`) | La tabla lo muestra en `lib/screenerTable.jsx:137`: `r.objectiveScore ?? r.totalScore`. No se encontró que la ficha de stock muestre un score compuesto equivalente bajo un nombre reconocible (`grep -n "totalScore\|compositeScore\|objectiveScore" app/stock/[symbol]/StockClient.jsx` vacío). Si la ficha no expone esa métrica, no hay superficie de contradicción visible para el usuario, aunque `docs/contrato-senales-2026-08-04.md` ya documenta que el motor (`scoringEngine.js`) y el auditor (`objectiveMetricTruth.js`) pueden diferir en política de dato ausente. | Grep vacío en `StockClient.jsx` |

---

## Tabla resumen

| Métrica | Superficie | Campo que lee | Valor observado |
|---|---|---|---|
| "Grp" (columna tabla) | Tabla de resultados | `rsSectorPct` | FTNT 99, KO 99, JNJ 62, UNH 87 |
| "Fuerza de grupo" (filtro) | Barra de filtros / tiers | `sectorScore` (alias `groupStrengthScore`) | FTNT 36.36→Muy débil, KO 32.88→Muy débil, JNJ 80→Fuerte, UNH 80→Fuerte |
| "G" (RS global, columna tabla) | Tabla de resultados | `rsGlobalPct` (persistido, scan) | FTNT 97, UNH 91 |
| "RS global" (ficha) | `/stock/[symbol]` | `weeklyGlobalRs.rsRating` (prioritario) → fallback `rsGlobalPct` | FTNT 90 (reportado), UNH 78 (reportado) — no coincide con `rsGlobalPct` (97/91) ni con `rsRating` (85/73) persistidos |
| Fiabilidad — "Alta fiabilidad" | Filtro/resumen | `state.reliable` (booleano independiente) | BAC cuenta aquí |
| Fiabilidad — "Revisables sin bloqueo" | Filtro/resumen | `state.reviewable = observationReady \|\| reliable` (superconjunto de `reliable`) | BAC también cuenta aquí (solape por diseño del `\|\|`) |

---

## CONFIANZA

- **Alto**: Parte A completa (campo distinto entre columna "Grp" y filtro
  "Fuerza de grupo", sin inversión de operador) — verificado por lectura
  directa de código en dos archivos independientes y por consulta SQL real
  con los 5 símbolos exactos del ejemplo del usuario.
- **Alto**: Parte C completa (solape estructural entre `reliable` y
  `reviewable` por el operador `observationReady || reliable`) — verificado
  por lectura directa y por el hecho de que la propia clasificación
  excluyente `key` existe en el código pero no se usa para contar.
- **Alto**: que la tabla de resultados lee `rsGlobalPct` directamente sin
  fallback (Parte B.1) — confirmado por dos archivos (`screenerTable.jsx`,
  `relativeStrength.js`) y sin ambigüedad de prioridad.
- **Medio-alto**: que la ficha de stock prioriza `weeklyGlobalRs.rsRating`
  sobre `rsGlobalPct` (Parte B.2-B.3) — el código de prioridad
  (`finiteValue(weeklyGlobalRs?.rsRating, rs.rsGlobalPct)`) es inequívoco,
  pero **no pude verificar con una consulta SQL directa** que el valor
  numérico final mostrado (90, 78) sea efectivamente el de
  `rs_weekly_items.rs_rating`, porque esa tabla no está en la whitelist de
  `mcp__supabase-readonly__supabase_query`. La coincidencia es indirecta:
  ninguno de los campos persistidos en `scan_results` (`rsGlobalPct`,
  `rsRating`) coincide con 90/78, lo cual es consistente con —pero no
  prueba de forma concluyente— que la fuente sea `rs_weekly_items`.
- **Medio**: alcance de Parte D.1 (lista de superficies). Confirmé con
  grep que `/market-health`, `/sectors`, `/review`, `ResultFilterBar`,
  `QuickReviewModal` y `ScreenerOriginPanel` referencian estos campos, pero
  no releí línea a línea cada uno para confirmar que el campo mostrado es
  exactamente el mismo que documenté para la tabla y el filtro principal.
- **Bajo**: Parte D.2, fila de "volumen relativo" — detecté nombres de
  campo distintos (`relativeVolume` vs `relativeVolume50`) pero no
  confirmé si la ficha de stock efectivamente renderiza `relativeVolume50`
  en un lugar visible con una etiqueta que un usuario confundiría con la
  columna "RV" de la tabla, ni si existe otra ruta de cálculo de RV en la
  ficha además de la citada.
- **Bajo**: reproducción exacta del conteo "Alta fiabilidad (1), Revisables
  sin bloqueo (1), Validar primero (7)" sobre el conjunto específico de 8
  acciones que vio el usuario — no se ejecutó `buildScreenerReliability`
  contra esas filas reales porque depende de módulos de auditoría
  (`decisionAudit`, `screenerDataHealth`, `screenerExplainability`,
  `screenerScoreAudit`) con múltiples entradas de configuración de sesión
  que no son triviales de reconstruir solo con `supabase_query`. El
  mecanismo de solape (C.2-C.4) sí está confirmado por código; el número
  exacto (9 sobre 8) no se recalculó de forma independiente.

## LO QUE NO HE VERIFICADO

1. **`rs_weekly_items`**: no está en la whitelist de tablas de
   `mcp__supabase-readonly__supabase_query`, así que no pude leer
   directamente `rs_rating`/`snapshot_date`/`engine_version` para FTNT/UNH
   ni confirmar que 90/78 salen literalmente de ahí.
2. **Exportación CSV** (`app/page.jsx:1554-1564`): no revisé qué columnas
   exactas incluye (`h.join(",")`) ni si reutiliza `rsGlobalPct`/
   `rsSectorPct` directamente de la fila o pasa por alguna transformación.
3. **`research-desk`, `lists` (posible watchlist/comparador)**: no
   confirmé si estas páginas muestran RS o fuerza de grupo, ni bajo qué
   campo.
4. **`/market-health`, `/sectors`, `/review`, `QuickReviewModal`,
   `ScreenerOriginPanel`, `app/api/scans/route.js`**: confirmé por grep
   que referencian los campos relevantes, pero no releí línea a línea cada
   uno para verificar que el campo mostrado coincide exactamente con el de
   la tabla principal o el filtro.
5. **Reproducción numérica exacta del conteo 1/1/7 de fiabilidad** sobre el
   conjunto de 8 acciones específico que vio el usuario en su sesión —
   solo se confirmó el mecanismo de solape en el código, no el resultado
   numérico exacto contra esas filas reales (dependencias de
   `settingsOrExplanation` no triviales de reconstruir vía SQL de solo
   lectura).
6. **`momentumScore` y el score compuesto (`totalScore`/`objectiveScore`)
   en la ficha de stock**: confirmé por grep que no aparecen bajo esos
   nombres literales en `StockClient.jsx`/`company-brief/route.js`, pero
   no descarté que existan bajo un nombre distinto no anticipado en la
   búsqueda.
7. No ejecuté la app en navegador (fuera del alcance explícito de la
   tarea: diagnóstico puro sobre código y datos, sin cron/scans nuevos).
   Los valores "90" y "78" reportados por el usuario para la ficha de
   FTNT/UNH se toman como dato de entrada de la tarea, no como algo que yo
   haya reproducido visualmente.
