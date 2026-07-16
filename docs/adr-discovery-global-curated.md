# ADR — Descubrimiento global curado: publicabilidad de los resultados del cron materializado

- **Estado:** aceptado
- **Fecha:** 2026-07-16
- **Rama de análisis:** `codex/statsedge-ui-polish` @ `0b874ab`
- **Decisión humana:** aprobada la **Opción A-curada** con la **variante (i)** — adaptar el orden dentro de los leaderboards existentes; no crear una superficie separada. Aprobación otorgada por el usuario en la sesión del 2026-07-16; este documento es su trazabilidad, no la aprobación misma.
- **Este ADR NO autoriza:** runs reales del cron o de jobs, scans, llamadas a producción, escrituras en Supabase, despliegues ni `git push`. Cualquiera de esas acciones requiere autorización humana explícita y separada, igual que en el cierre de Camino A ([camino-a-closure-2026-07-16.md](camino-a-closure-2026-07-16.md) §8).

## 1. Decisión

1. Los scans materializados del cron pasan a ser **publicables** mediante un estado terminal coherente en `scans.settings.progress.status` (contrato existente `computeTerminalCompleteness`: `complete`/`partial`/`failed`).
2. La superficie pública se llama **"Descubrimiento global curado"**. Nunca "ranking global".
3. Solo se publica una fila si supera los **gates obligatorios** ya existentes (§5).
4. Toda lista declara una **estrategia existente del catálogo** (`LEADERBOARD_STRATEGIES`); no se inventan señales ni patrones.
5. El orden principal solo puede usar **señales estrictamente absolutas por símbolo**. Quedan **prohibidos como criterio de orden**: `objectiveScore` (contiene `sectorScore` calculado sobre el lote local) y `rsGlobalPct` o cualquier percentil con scope de lote (`percentileScope: "batch"`).
6. **Invariante 10 (humana, no negociable):** RS global y cualquier indicador comparativo global solo pueden calcularse y publicarse sobre un universo global canónico, completo dentro de su cobertura declarada, versionado y estable. Nunca sobre lotes diarios, cursores parciales ni muestras arbitrarias.
7. La futura RS global(baseCurrency) USD/EUR sigue **fuera de alcance**, bloqueada por su contrato propio ([addendum-rs-global-basecurrency-v3.2.md](addendum-rs-global-basecurrency-v3.2.md) §13). Cuando exista, será una proyección derivada del mismo snapshot canónico, jamás dos muestras distintas.

## 2. Contexto y problema

StatsEdge tiene dos productores de filas en `scan_results`: los scans de usuario ([lib/serverScanRunner.js](../lib/serverScanRunner.js)), que finalizan percentiles sobre la población completa del scan y marcan estado terminal, y el cron materializado ([lib/materializedScanner.js](../lib/materializedScanner.js)), que materializa cohortes internacionales pequeñas (12–24 símbolos/run según [lib/cronPlan.js](../lib/cronPlan.js)) sin finalización ni estado terminal.

Antes de esta decisión convivían tres piezas incoherentes: un cron que gastaba presupuesto diario materializando filas internacionales decision-grade; una puerta de publicación (`leaderboard_publishable_rows`) que las descartaba en silencio por metadata ausente; y una maquinaria de disclosure batch/final construida para una mezcla de filas que la puerta impedía. La decisión convierte esa asimetría accidental en un contrato deliberado: el cron publica, pero solo descubrimiento curado, nunca un ranking estadístico global.

Motivación de la invariante 10: un percentil calculado sobre 20 acciones un día y 30 distintas al siguiente no mide lo mismo dos veces; la composición de la muestra es parte de la identidad de la métrica, igual que su fórmula.

## 3. Hechos técnicos verificados (rama `0b874ab`)

| # | Hecho | Evidencia |
|---|---|---|
| H1 | Las filas del cron son decision-grade: `assertDecisionGrade` antes de puntuar y `chartEstimated: false` en toda fila | `lib/materializedScanner.js:477,595` |
| H2 | El cron avanza cursores por mercado en `app_settings` y rota cohortes diarias con budgets 12–24 | `lib/materializedScanner.js:1627-1657`, `lib/cronPlan.js:21-71` |
| H3 | `writeMaterializedScan` persiste `scans.settings` sin clave `progress`; ni el job ni el cron la añaden | `lib/materializedScanner.js:1526,1579-1602` |
| H4 | `leaderboard_publishable_rows` filtra por `progress.status ∈ (complete, partial, done)` y excluye `parent_status` nulo → las filas del cron no llegaban a leaderboards | `supabase/migrations/20260710180000_leaderboard_publishable_rows.sql`, `lib/leaderboards.js:663-694` |
| H5 | Las filas del cron no reciben finalización: su `sectorize` privado opera sobre el lote local; `percentileScope` ausente se lee como `"batch"` | `lib/materializedScanner.js:406-414`, `lib/scanDecisionProjection.js:48`, `lib/leaderboards.js:500` |
| H6 | Con `RS_GLOBAL_MIN_SAMPLE = 20`, runs con limit < 20 producen `rsGlobalPct: null`; los de 20–24, un "percentil global" sobre ≤ 24 valores | `lib/relativeStrength.js:4,224-241`, `lib/cronPlan.js:23-42` |
| H7 | Los leaderboards ya exponen `percentileScope` por item y priorizan `final` solo en empates, sin mutar score | `lib/leaderboards.js:500,586`, `tests/leaderboardPercentileScope.test.js` |
| H8 | Existe contrato de completitud terminal reutilizable (`computeTerminalCompleteness`) | `lib/serverScanRunner.js:287-305`, `lib/scanStatus.js` |
| H9 | Camino A cerrado con 0 divergencias pendientes; los percentiles batch son guardrail de fiabilidad, no señal de trading (DIVERG-DOC #8) | [audit-score-coherence-contract.md](audit-score-coherence-contract.md) §3 |
| H10 | Los gates de calidad existen en ambas capas: `baseRejectReason` en escritura; `basePasses` + `strategyPasses` + `applyScreenerFilters` en lectura | `lib/materializedScanner.js:598-612`, `lib/leaderboards.js:394-433,576-581` |
| H11 | Las filas del cron no tienen `signalContradictions`: C1–C6 solo se evalúan en la finalización del scan de servidor | `lib/scanPercentileFinalization.js:109` |
| H12 | El orden actual prefiere `rsGlobalPct` (`rsValue()` cae a `rsRating` solo si es null); `rsRating` es RS por símbolo contra benchmark local, independiente del lote; `objectiveScore` del cron incorpora `sectorScore` de lote | `lib/leaderboards.js:149-151,435-469`, `lib/relativeStrength.js:139-178` |

No se verificaron datos de producción (sin llamadas ni lecturas a Supabase en la sesión de análisis).

## 4. Las tres capas del contrato de publicación

| Capa | Población permitida | Orden/percentil | Prohibiciones | Declaraciones obligatorias |
|---|---|---|---|---|
| **1. Descubrimiento global curado** (esta decisión) | Lotes parciales del cron, aceptados por diseño | Solo señales absolutas por símbolo + estrategia declarada del catálogo | No ordenar por `objectiveScore` ni por `rsGlobalPct`/percentil batch; no presentarlo como RS global; no llamarse "ranking global" | Muestra parcial, estrategia activa, mercados incluidos, frescura, no-comparabilidad |
| **2. Ranking por mercado** (futuro) | Población completa y fresca del mercado según definición explícita | Percentil sobre esa población versionada | No mezclar poblaciones de fechas/versiones distintas; no extrapolar a "global" | Denominador (N/M), fecha del snapshot, cobertura del mercado |
| **3. Ranking global comparable / RS global** (futuro) | Snapshot global canónico y versionado; solo mercados con reglas homogéneas de cobertura y frescura | Percentil sobre el snapshot; congelado o degradado si la cobertura deja de cumplir | **Nunca recalcularse desde un lote diario del cursor**; nunca variar según qué cohorte corrió anoche | Mercados incluidos/excluidos, universo y versión, fecha/as-of, metodología |

Los lotes de la capa 1 solo aportan filas materializadas a las capas 2–3; **nunca su denominador**. La variante USD/EUR de la capa 3 será una proyección `(canonicalScanId, baseCurrency, methodologyVersion)` del mismo snapshot, según el addendum v3.2 (§5, §6, §10, §11).

**Decisión humana pendiente registrada (no bloquea la capa 1):** definición numérica de "universo suficientemente completo" para las capas 2–3 — umbral de cobertura por mercado, ventana de frescura homogénea, mercados prioridad-1 imprescindibles y política de degradación.

## 5. Gates obligatorios de publicación (capa 1)

Un item solo aparece en "Descubrimiento global curado" si supera, con los mecanismos ya existentes:

1. **Frescura de precio:** dentro de `maxPriceFreshnessDays` (default 5; `basePasses`).
2. **Decision-grade:** `chartEstimated: false`, garantizado en origen (H1).
3. **Cobertura mínima:** `dataCoverageScore ≥ 40` (`basePasses`).
4. **Liquidez y filtros técnicos vigentes:** `minAvgTurnover`/`minMarketCap`/`applyScreenerFilters` con defaults no relajables desde la UI pública.
5. **Estrategia declarada:** `strategyPasses` de una estrategia existente (`momentum`, `stage2`, `nearPivot`, `growth`, u otra del catálogo).
6. **Contradicciones:** no se publican filas con contradicciones graves **presentes**; la ausencia del campo `signalContradictions` (caso cron, H11) no excluye por sí sola — límite conocido que debe comunicarse, no aparentar un control que no se aplica.

## 6. Prohibiciones de orden

- **`objectiveScore` prohibido como criterio de orden:** incorpora `sectorScore` calculado sobre el lote local (H12); su residuo de dependencia de lote lo descalifica por decisión humana explícita.
- **`rsGlobalPct` y cualquier percentil batch prohibidos como criterio de orden:** un percentil sobre ≤ 24 valores no es una posición global (H6).
- **Permitidos (señales absolutas por símbolo):** `rsRating` (RS vs. benchmark local, H12), `weinsteinScore`, `minerviniScore`, `perf3m/6m/12m`, `distance52w`/`extSma50`, `setupQualityScore`, `avgTurnover`.
- `percentileScope: "batch"` y `rsGlobalPct` de lote pueden **mostrarse como contexto etiquetado** en el item; nunca como prueba de superioridad global ni como criterio de orden o desempate principal.

## 7. Disclosure UX obligatorio

Toda vista de la capa 1 declara, de forma visible y no colapsable por defecto en su primera aparición:

1. "Muestra parcial" (con tamaño efectivo cuando esté disponible).
2. Estrategia activa.
3. Mercados incluidos.
4. Frescura (fecha del dato más viejo incluido).
5. La frase explícita de que **no es un ranking global comparable**.

El renombrado a "Descubrimiento global curado" es condición del cambio de publicabilidad, no un seguimiento. El estado vacío (gates estrictos + cohortes pequeñas) se diseña como información ("materializando N/M"), no como fallo.

## 8. Límites de esta decisión

- **No modifica** scores, señales, el registry (`SIGNAL_REGISTRY`), `COMPOSITE_WEIGHTS`, percentiles canónicos, la finalización (`finalizeScanPercentiles`/`finalize_scan_results`), la RS existente ni **ningún campo de `scan_results`**. El único objeto que ganará una clave en la implementación futura es `scans.settings` (jsonb `progress`) del scan padre.
- No introduce FX, USD/EUR ni RS nueva.
- No cambia `strategyPasses` ni los gates existentes: solo hace obligatorio su uso; el único ajuste de código previsto es la rama de orden de la vista curada (variante (i)).
- No reabre Camino A ni sus divergencias aceptadas.
- Este documento no implementa nada: registra la decisión. La implementación es trabajo futuro bajo sus propias verificaciones.

## 9. Plan de fases

1. **F-A1 — Estado terminal del cron:** `writeMaterializedScan`/`runMaterializedScan` persisten `progress.status` terminal vía `computeTerminalCompleteness`. Sin migración: la RPC actual ya acepta `complete`/`partial`.
2. **F-A2 — Orden curado en leaderboards (variante (i)):** la vista curada usa exclusivamente señales absolutas (§6) en su rama de orden; `strategyScore` y las demás superficies no cambian.
3. **F-A3 — Renombrado y disclosure UX (§7),** en el mismo diff que abre la puerta, con evidencia de navegador.
4. **F-A4 — Run real acotado de verificación:** requiere **autorización humana separada** (§11).
5. **Capas 2–3:** fuera de este ADR; requerirán ADR propio, esquema/migración para snapshots versionados y la decisión pendiente de "universo suficientemente completo" (§4).

## 10. Criterios de aceptación

1. **Test de puerta:** un scan materializado sintético con el nuevo `progress.status` pasa el filtro de paridad de `leaderboard_publishable_rows`; sin la clave, queda excluido.
2. **Test de gating:** una fila materializada que falle frescura, cobertura, liquidez o `strategyPasses` no aparece en la vista curada; una que pase todos, sí.
3. **Test de orden:** dos filas con `rsGlobalPct` batch invertido respecto a sus señales absolutas se ordenan por las absolutas; `objectiveScore` no participa en el orden; el item expone `percentileScope: "batch"` solo como contexto.
4. **Test de contradicciones:** una fila finalizada con contradicción grave presente queda excluida; una fila de cron sin el campo no queda excluida por su ausencia.
5. **No-regresión del canon:** `tests/signalRegistryAudit.test.js`, `tests/researchRowContract.test.js`, `tests/researchRowDecisionGrade.test.js` y el golden snapshot pasan **sin cambios en sus fixtures**; si un fixture del canon necesita tocarse, el diff se salió del alcance.
6. **Evidencia de navegador con hard-reload** (disciplina de la evidencia P3): vista "Descubrimiento global curado" con estrategia activa, muestra parcial, mercados, frescura y negación explícita de ranking global; incluida la pantalla de estado vacío. Capturas antes y después del hard-reload.
7. **Auditoría de no-mutación:** el diff no toca `lib/scoringEngine.js`, `lib/researchRow.js`, `lib/screenerComposite.js`, `lib/scanPercentileFinalization.js`, `lib/relativeStrength.js` ni los payloads de fila (`scanResultPayload`/`resultPayload`); baseline de coherencia (patrón `b9ba723`) con hash idéntico en la parte de scoring.
8. **Criterios futuros de la invariante 10 (capas 2–3):** (a) dos ejecuciones del cron con lotes diarios distintos posteriores a la publicación de un snapshot global vN dejan sus percentiles byte-idénticos; (b) el snapshot registra la lista (o hash) de símbolos de su denominador y recomputarlo desde ella reproduce percentiles idénticos; (c) la pérdida de frescura de un mercado incluido congela/degrada el snapshot con fecha visible, sin re-percentilar en silencio; (d) las proyecciones USD y EUR de un mismo `canonicalScanId` comparten exactamente el mismo denominador.

## 11. Run real futuro

Un único run acotado (p. ej. `POST /api/jobs/scan-refresh?perMarket=4&limit=12&leaderboards=1`) verificará en datos reales el estado terminal, `rowsPublished`/`rowsExcluded` de la RPC y el disclosure en la vista. Ese run **no está autorizado por este ADR**: requiere aprobación humana explícita, separada y registrada, y se tramita como sesión propia.

## 12. Referencias

- [adr-scoring-pipeline-canon.md](adr-scoring-pipeline-canon.md) — canon de scoring y fase 3 pendiente (finalización en el cron).
- [audit-score-coherence-contract.md](audit-score-coherence-contract.md) — contrato de coherencia; DIVERG-DOC #8.
- [camino-a-closure-2026-07-16.md](camino-a-closure-2026-07-16.md) — cierre formal de Camino A y sus límites.
- [addendum-rs-global-basecurrency-v3.2.md](addendum-rs-global-basecurrency-v3.2.md) — contrato de la futura RS global(baseCurrency), fuera de alcance aquí.
- [coverage-roadmap.md](coverage-roadmap.md) — plan de cobertura y semántica de leaderboards derivados.
