# ADR — Canon único de scoring: consolidación de las 3 pipelines

- Fecha: 2026-07-10
- Estado: propuesto
- Rama de análisis: `codex/statsedge-ui-polish` @ `3212b76`
- Relación con Camino A: este ADR define la arquitectura destino; el audit de
  equivalencia de señales (MiniMax + validación humana) valida las fórmulas
  actuales. Las fases 2-4 de la migración dependen de cerrar Camino A; la
  fase 1 no.

## 1. Contexto: qué son realmente las "3 pipelines"

El diagnóstico de partida ("3 pipelines duplicadas") es correcto en líneas de
código pero impreciso en estructura. Lo que hay es:

**Una pipeline viva en dos capas, compartida por dos de los tres puntos de
entrada:**

| Capa | Módulo | Responsabilidad |
|---|---|---|
| Señales (20) | [scoringEngine.js](lib/scoringEngine.js) | Registry canónico + composite declarativo. **Ya consolidado** (`lib/scoring.js` es solo fachada de compatibilidad). |
| Fila por símbolo | [researchRow.js](lib/researchRow.js) `buildResearchRow` | Indicadores (vía `lib/indicators.js`), stage semanal, patrón, RS vs benchmark, cobertura de datos, guard `assertDecisionGrade`, campo `chartEstimated`. |
| Composite por universo | [screenerPipeline.js:303](lib/screenerPipeline.js:303) `sectorize` | `enrichRelativePercentiles` (RS global/país/sector), `sectorScore`, composite objetivo/legacy, `ipoScore`, narrativa, `scoreWeakness` post-percentil. |
| Proyección | [researchRowContract.js](lib/researchRowContract.js) | Forma completa vs compacta de la fila (sessionStorage y `/api/scans`). |

La consumen **el cliente** (`app/page.jsx`: búsqueda individual +
`filterAnalyzedRows`) y **el scan de servidor** (`lib/serverScanRunner.js`,
que importa `buildResearchRow` de researchRow y `sectorize` de
screenerPipeline — [serverScanRunner.js:12,18](lib/serverScanRunner.js:12)).

**Y una copia derivada:** [materializedScanner.js](lib/materializedScanner.js)
(cron `jobs/scan-refresh`) reimplementa en privado los indicadores
(≈ `lib/indicators.js` líneas 61-263), `coveragePct`/`priceFreshnessForDate`/
`dataCoverageForRow` (líneas 279-397), `buildResearchRow` (línea 469),
`sectorize` (línea 399) y `compactChartPreview` (línea 454). Es la única de
las tres que no consume el canon en las capas de fila y composite.

## 2. Decisión

**La pipeline canónica es la composición por capas ya existente en el camino
vivo.** No se elige "una de las tres": se completa la consolidación que
`scoringEngine.js` ya empezó, subiendo una capa:

1. `lib/scoringEngine.js` — canon de señales (sin cambios; ya lo es).
2. `lib/researchRow.js` `buildResearchRow` — **único** ensamblador de fila
   para los tres puntos de entrada, absorbiendo las defensas útiles de la
   copia del materialized (ver §4).
3. **Nuevo** `lib/screenerComposite.js` — extracción verbatim de `sectorize`
   (+ helpers de percentil/composite) desde `screenerPipeline.js`.
   `screenerPipeline.js` lo re-exporta (cero cambios en consumers) y queda
   como lo que realmente es: helpers de sesión/filtrado del cliente.
4. `lib/researchRowContract.js` — única proyección compacta, también para las
   filas del materialized (hoy la viola, ver §4.6).
5. `lib/materializedScanner.js` — queda reducido a sus responsabilidades
   **propias y no duplicadas**: selección/priorización de universo
   (`selectUniverseRows`, `materializationPriorityForRow`, cursores), fetch
   con caché persistente (`dailyBarsCache`/`fundamentalsCache`), policy gate
   de presupuesto (`baseRejectReason`), persistencia (`scanResultPayload`,
   `writeMaterializedScan`) y leaderboards.

### Por qué no el materializedScanner como canon

- Es la copia que ha derivado: no invoca `ipoScore` (discrepancia #2
  documentada en [scoringEngine.js:15-19](lib/scoringEngine.js:15)), su
  `dataCoverageForRow` omite `ebitdaMargin`
  ([materializedScanner.js:367-380](lib/materializedScanner.js:367) vs
  [researchRow.js:140](lib/researchRow.js:140)), no re-aplica `scoreWeakness`
  tras los percentiles, no produce narrativa (`compositeReasons/Risks`) ni
  `ratingModel`, y su `chartPreview` viola el contrato compacto.
- No recibió el guard `assertDecisionGrade` ni `chartEstimated`.
- Solo lo consume un punto de entrada (cron); el camino vivo ya lo consumen
  dos.

### Por qué no una composición nueva

El coste de una cuarta implementación "limpia" no compra nada: las fórmulas ya
están canonizadas en el registry, y el trabajo real es de *cableado* (que el
cron consuma las mismas funciones), no de rediseño. Una reescritura invalidaría
además el audit de equivalencia de Camino A en curso.

## 3. Responsabilidades a preservar de cada módulo

| Módulo | Se preserva | Se elimina (tras paridad) |
|---|---|---|
| researchRow.js | Todo; gana `normalizeBars`, `providerMeta`, `sharesOutstanding`, passthrough de `maxPriceFreshnessDays` (hoy solo en la copia B) | — |
| screenerPipeline.js | Helpers de sesión, filtrado cliente, diagnósticos, firmas de scan | `sectorize` se muda a `screenerComposite.js` (con re-export temporal) |
| materializedScanner.js | Selección/priorización, cursores, `latestScanStateFromRow`, fetchers cacheados, `baseRejectReason` (como policy explícita), `scanResultPayload` (superset de metrics que consumen leaderboards), leaderboards | `firstFinite/avg/sma/perf/highDist/lowAdv/riskAdjustedStats/udVol/monthsSince/theme` (≈ indicators.js), `coveragePct/priceFreshnessForDate/dataCoverageForRow`, `buildResearchRow`, `sectorize`, `compactChartPreview` (~550 líneas) |

## 4. Divergencias concretas y su resolución en la fusión

Cada una es un cambio de comportamiento observable en las filas del cron;
deben cruzarse con los resultados de Camino A antes de la fase 2.

1. **`assertDecisionGrade` + `chartEstimated`** (la asimetría que motivó este
   ADR): **se generaliza a las tres** vía el builder canónico
   ([researchRow.js:195,253](lib/researchRow.js:195)). Razonamiento: el
   invariante "una fila de decisión nunca se construye sobre barras
   sintéticas" pertenece al *ensamblado de fila*, no al transporte de datos.
   Hoy el camino del cron no puede ver barras estimadas en la práctica
   (el caché las rechaza en escritura,
   [dailyBarsCache.js:322-332](lib/dailyBarsCache.js:322), y `lib/yahoo.js`
   no las fabrica), así que el coste de generalizar es cero — pero dejar el
   guard solo en A significa que el invariante desaparece en silencio el día
   que cambie la capa de fetch del cron. `chartEstimated: false` pasa a estar
   en toda fila; conviene añadirlo al grupo `coverage` de
   `RESEARCH_ROW_CORE_FIELDS` en el contrato.
2. **`ebitdaMargin` en cobertura fundamental**: se adopta la lista de A (13
   entradas). Efecto: `fundamentalCoverageScore` del cron sube ligeramente
   para valores con dato.
3. **`ipoScore` en el composite**: se adopta A (se invoca). Efecto acotado:
   ≤2 puntos de composite (peso 0.02,
   [scoringEngine.js:616](lib/scoringEngine.js:616)); hoy el cron lo computa
   como 0 implícito. Es la resolución de la discrepancia #2 documentada.
4. **`scoreWeakness` post-percentiles**: se adopta A
   ([screenerPipeline.js:351](lib/screenerPipeline.js:351)). Hoy el
   `weaknessScore` persistido por el cron se calcula ANTES de
   `enrichRelativePercentiles` (sin `rsGlobalPct`), el del scan vivo después
   — misma señal, semántica distinta según pipeline.
5. **Narrativa + `legacyTotalScore` + `ratingModel`**: se adoptan de A. Las
   filas del cron ganan `compositeReasons/Risks` (hoy ausentes en
   `scan_results` de origen materialized, lo que ya se nota en review).
6. **`chartPreview`**: el cron persiste 48 barras `{date, close, volume}` en
   orden descendente ([materializedScanner.js:454](lib/materializedScanner.js:454));
   el contrato define `{date, close, sma50, sma200, volume}` ascendente
   ([researchRowContract.js:56](lib/researchRowContract.js:56)). Se adopta el
   contrato (el builder canónico ya produce la forma correcta).
7. **`normalizeBars`** (orden/saneo de barras): se adopta de B dentro del
   builder canónico. A confía hoy en que el proveedor devuelva orden
   descendente; B lo garantiza. Defensa barata que elimina una clase de bug.
8. **Gate de barras**: el builder canónico mantiene el mínimo de 20 barras +
   flag `requireLongHistory`; el umbral de 180 del cron sigue viviendo en
   `baseRejectReason` (política de selección, no ensamblado), igual que en el
   camino vivo vive en `qualityGateForResearchRow`.

## 5. Plan de migración (fases, cada una desplegable por separado)

**Invariantes en todo momento:** no se toca `lib/scanStatus.js` /
`lib/scanErrors.js` / `lib/screenerFormat.js` (interfaces resueltas); no se
toca el shape de `scans.settings.progress` ni el contrato de completitud; el
shape de `scan_results` solo *gana* claves (los consumidores —
`scanDecisionRowFromDb`, leaderboards — ya toleran claves ausentes/extra).

- **Fase 0 (precondición para 2-4):** cerrar Camino A. Cualquier divergencia
  formulaica encontrada se corrige o se acepta explícitamente antes de fundir.
- **Fase 1 (sin dependencia de Camino A):** extraer `sectorize` + helpers a
  `lib/screenerComposite.js`; `screenerPipeline.js` re-exporta. Cobertura:
  `tests/_golden_snapshot_scoring.js` + tests existentes de
  screenerPipeline/serverScanRunner sin cambios. Riesgo: nulo (movimiento
  verbatim).
- **Fase 2:** `materializedScanner.analyzeOne` pasa a llamar
  `buildResearchRow` de researchRow (con `normalizeBars` previo hasta que se
  absorba, y mapeo de opciones). Verificación por **doble ejecución**: durante
  N corridas del cron se computan ambas filas y se loguea el diff por campo
  (aceptando la lista del §4). El cron es el entorno ideal para esto: no hay
  usuario esperando.
- **Fase 3:** sustituir el `sectorize` privado por `screenerComposite`. En el
  mismo paso, marcar `percentileScope: "final"` en las filas del cron: su
  población de percentil ya ES el scan completo (todo `passedBase` se
  sectoriza junto antes de guardar), así que el scope "batch" actual es un
  falso negativo que contamina la mezcla de filas en leaderboards
  ([scanDecisionProjection.js:48](lib/scanDecisionProjection.js:48)).
- **Fase 4:** borrar las copias privadas de materializedScanner y, cuando no
  queden imports, los re-exports temporales. `lib/scoring.js` (fachada) se
  mantiene: tiene consumers legítimos y documentados.
- **Fase 5 (opcional, separable):** unificar la capa de fetch — hoy
  `/api/scan` usa `marketData.js` (caché en memoria) y el cron
  `dailyBarsCache.js` (caché persistente Supabase), de modo que el mismo
  símbolo puede scorearse con series distintas según el camino. Recomendado
  converger a `withDailyBarsCache` para ambos. Riesgo medio (presupuesto de
  lecturas Supabase por scan); decisión aparte, no bloquea el canon.

### Qué se puede eliminar con seguridad vs. capa de compatibilidad

- **Eliminar tras fase 4:** las ~550 líneas duplicadas listadas en §3. Nada
  externo las importa (verificado: los imports de `materializedScanner` desde
  fuera son `runMaterializedScan`, `planMaterializedScan`,
  `writeMaterializedScan`, `scanResultPayload`, `latestScanStateFromRow`,
  `readScanBatchCursor`/`write…`, `refreshDefaultLeaderboards` — todos se
  conservan).
- **Compat temporal:** re-export de `sectorize` en screenerPipeline (hasta
  migrar imports de `app/page.jsx` y serverScanRunner, trivial); fachada
  `lib/scoring.js` (permanente hasta tarea propia).
- **No tocar:** `scanResultPayload` del materialized guarda un superset de
  metrics (campos de patrón/estructura) que `latestScanStateFromRow` y las
  leaderboards leen; se conserva tal cual y solo cambia la *fuente* de la fila.

## 6. Consecuencias

- Positivas: una sola definición de fila y de composite; el fix de un bug de
  señal llega a los tres caminos; `chartEstimated`/decision-grade uniformes;
  las filas del cron ganan narrativa, ipoScore, weakness coherente y preview
  conforme a contrato; desaparece la clase de bug "arreglado en A, olvidado
  en B" (exactamente lo ocurrido con `assertDecisionGrade`).
- Negativas/costes: los scores del cron cambian de forma medible (ipoScore,
  ebitdaMargin, weakness) — hay que comunicarlo como cambio intencional y
  registrarlo en el diff de la fase 2; una corrida de doble ejecución encarece
  temporalmente el cron.
- Nota explícita sobre trabajo ya resuelto: la consolidación a nivel de
  *señal* (registry + fachada) ya está hecha y este ADR no la re-decide; las
  interfaces `scanStatus`/`scanErrors`/`screenerFormat` se tratan como dadas.
