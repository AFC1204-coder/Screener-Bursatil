# Contrato de auditoría — Equivalencia de las 18 señales entre las 3 rutas

- **Versión:** 4.0.0
- **Fecha:** 2026-07-15
- **Rama:** `codex/statsedge-ui-polish`
- **Estado:** Camino A — base auditable, **NO cerrado** (Sin divergencias pendientes; Camino A listo para cierre formal.)
- **Alcance:** inventario, trazabilidad y equivalencia NUMÉRICA de las 18 señales del
  `SIGNAL_REGISTRY` (17 positivas + 1 negativa) entre las tres rutas reales del sistema:
    1. `lib/researchRow.js` → `buildResearchRow` (camino cliente + `/api/scan`).
    2. `lib/screenerPipeline.js` → `sectorize` (composite por universo).
    3. `lib/materializedScanner.js` → `buildResearchRow` privado + `sectorize` privado (cron).
- **Auditoría automática:** `tests/signalRegistryAudit.test.js`.
- **Fuente estructurada única:** `tests/_audit_contract.js`. Este documento se GENERA desde esa fuente.
- **Golden snapshot independiente:** `tests/_golden_snapshot_scoring.js`.

## 0. Estado global del audit

- **Divergencias aceptadas (DIVERG-DOC):** 8
- **Divergencias pendientes (DIVERG-PENDIENTE):** 0
- **Listo para cierre formal:** SÍ
- **Mensaje:** Sin divergencias pendientes; Camino A listo para cierre formal.

> ⚠️ **Seam de Ruta C:** `lib/materializedScanner.js` exporta `_forTest = { buildResearchRow, sectorize }`
> como cambio estrictamente no funcional (17 líneas adicionales). Verificar visualmente y hard-reload
> antes de commit; no altera JSX ni comportamiento de producción.

> ⚠️ **Conteo del registry:** 17 positives + 1 negative = 18 total.
> El brief original decía 20 (19+weaknessScore); el código tiene 18 (17+weaknessScore).

## 1. Inventario canónico (18 señales)

Fuente: `Object.values(SIGNAL_REGISTRY)` en `lib/scoringEngine.js`.

| # | Key | direction | requiredInputs |
|---|-----|-----------|----------------|
| 1 | `weinsteinScore` | positive | 7 |
| 2 | `minerviniScore` | positive | 10 |
| 3 | `momentumScore` | positive | 3 |
| 4 | `riskScore` | positive | 5 |
| 5 | `riskRewardScore` | positive | 7 |
| 6 | `volumeEffectScore` | positive | 6 |
| 7 | `volumeScore` | positive | 6 |
| 8 | `liquidityScore` | positive | 4 |
| 9 | `ipoScore` | positive | 9 |
| 10 | `objectiveSetupScore` | positive | 9 |
| 11 | `patternContributionScore` | positive | 0 |
| 12 | `patternScore` | positive | 4 |
| 13 | `setupQualityScore` | positive | 3 |
| 14 | `demandScore` | positive | 9 |
| 15 | `growthScore` | positive | 9 |
| 16 | `epsGrowthProxyScore` | positive | 6 |
| 17 | `adProxyScore` | positive | 10 |
| 18 | `weaknessScore` | **negative** | 20 |

### Composite (`COMPOSITE_WEIGHTS`)

Suma de pesos = 0.9999999999999999 (verificado por `compositeWeightsCheck()`).

## 2. Tabla de equivalencia por ruta (matriz canónica)

Cada celda (señal × ruta) tiene un `kind`: `EQUIVALENT`, `EQUIVALENT_ADAPT`, `DIVERGENCE_DOC`, `DIVERGENCE_PENDING` o `NOT_APPLICABLE`.

### Ruta A — `lib/researchRow.js · buildResearchRow`

| Señal | kind | evidence |
|-------|------|----------|
| `weinsteinScore` | EQUIVALENT | lib/researchRow.js:291 |
| `minerviniScore` | EQUIVALENT | lib/researchRow.js:292 |
| `momentumScore` | EQUIVALENT | lib/researchRow.js:293 |
| `riskScore` | EQUIVALENT | lib/researchRow.js:294 |
| `riskRewardScore` | EQUIVALENT | lib/researchRow.js:295 |
| `volumeEffectScore` | EQUIVALENT | lib/researchRow.js:296 |
| `volumeScore` | EQUIVALENT | lib/researchRow.js:300 |
| `liquidityScore` | EQUIVALENT | lib/researchRow.js:301 |
| `ipoScore` | NOT_APPLICABLE | no invocado en Ruta A; calculado en sectorize |
| `objectiveSetupScore` | NOT_APPLICABLE | no invocado en Ruta A; calculado en sectorize |
| `patternContributionScore` | NOT_APPLICABLE | no invocado en Ruta A; calculado en sectorize |
| `patternScore` | NOT_APPLICABLE | no invocado en Ruta A; calculado en sectorize |
| `setupQualityScore` | NOT_APPLICABLE | no invocado en Ruta A; calculado en sectorize |
| `demandScore` | NOT_APPLICABLE | no invocado en Ruta A; calculado en sectorize |
| `growthScore` | NOT_APPLICABLE | no invocado en Ruta A; calculado en sectorize |
| `epsGrowthProxyScore` | EQUIVALENT | lib/researchRow.js:299 |
| `adProxyScore` | EQUIVALENT | lib/researchRow.js:298 |
| `weaknessScore` | EQUIVALENT_ADAPT | lib/researchRow.js:316-318 (doble invocación) |

### Ruta B — `lib/screenerPipeline.js · sectorize`

| Señal | kind | evidence |
|-------|------|----------|
| `weinsteinScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `minerviniScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `momentumScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `riskScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `riskRewardScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `volumeEffectScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `volumeScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `liquidityScore` | EQUIVALENT | llega pre-calculado de Ruta A; no recalculado |
| `ipoScore` | EQUIVALENT | lib/screenerPipeline.js:318 (computeSignal con sectorScore) |
| `objectiveSetupScore` | EQUIVALENT | lib/screenerPipeline.js:319 |
| `patternContributionScore` | EQUIVALENT | lib/screenerPipeline.js:320 |
| `patternScore` | EQUIVALENT | lib/screenerPipeline.js:321 |
| `setupQualityScore` | EQUIVALENT | lib/screenerPipeline.js:322 |
| `demandScore` | EQUIVALENT | lib/screenerPipeline.js:323 |
| `growthScore` | EQUIVALENT | lib/screenerPipeline.js:324 |
| `epsGrowthProxyScore` | EQUIVALENT_ADAPT | lib/screenerPipeline.js:328 (prefiere pre-calc si finito) |
| `adProxyScore` | EQUIVALENT_ADAPT | lib/screenerPipeline.js:327 (prefiere pre-calc si finito) |
| `weaknessScore` | EQUIVALENT_ADAPT | lib/screenerPipeline.js:352-357 (doble invocación + narrativa) |

### Ruta C — `lib/materializedScanner.js · buildResearchRow` (privado, vía seam `_forTest`)

| Señal | kind | evidence |
|-------|------|----------|
| `weinsteinScore` | EQUIVALENT | lib/materializedScanner.js:567 |
| `minerviniScore` | EQUIVALENT | lib/materializedScanner.js:568 |
| `momentumScore` | EQUIVALENT | lib/materializedScanner.js:569 |
| `riskScore` | EQUIVALENT | lib/materializedScanner.js:570 |
| `riskRewardScore` | EQUIVALENT | lib/materializedScanner.js:571 |
| `volumeEffectScore` | EQUIVALENT | lib/materializedScanner.js:572 |
| `volumeScore` | EQUIVALENT | lib/materializedScanner.js:575 |
| `liquidityScore` | EQUIVALENT | lib/materializedScanner.js:576 |
| `ipoScore` | NOT_APPLICABLE | no se invoca en buildResearchRow privado |
| `objectiveSetupScore` | NOT_APPLICABLE | calculado en sectorize, no en buildResearchRow |
| `patternContributionScore` | NOT_APPLICABLE | idem |
| `patternScore` | NOT_APPLICABLE | idem |
| `setupQualityScore` | NOT_APPLICABLE | idem |
| `demandScore` | NOT_APPLICABLE | idem |
| `growthScore` | NOT_APPLICABLE | idem |
| `epsGrowthProxyScore` | EQUIVALENT | lib/materializedScanner.js:574 |
| `adProxyScore` | EQUIVALENT | lib/materializedScanner.js:573 |
| `weaknessScore` | EQUIVALENT_ADAPT | lib/materializedScanner.js:591-593 (doble invocación) |

### Ruta C — `lib/materializedScanner.js · sectorize` (privado, vía seam `_forTest`)

| Señal | kind | evidence |
|-------|------|----------|
| `weinsteinScore` | EQUIVALENT | llega pre-calculado del builder |
| `minerviniScore` | EQUIVALENT | idem |
| `momentumScore` | EQUIVALENT | idem |
| `riskScore` | EQUIVALENT | idem |
| `riskRewardScore` | EQUIVALENT | idem |
| `volumeEffectScore` | EQUIVALENT | idem |
| `volumeScore` | EQUIVALENT | idem |
| `liquidityScore` | EQUIVALENT | idem |
| `ipoScore` | DIVERGENCE_DOC | ADR §4.3 — NO se invoca en sectorize privado |
| `objectiveSetupScore` | EQUIVALENT | lib/materializedScanner.js:419 |
| `patternContributionScore` | EQUIVALENT | lib/materializedScanner.js:420 |
| `patternScore` | EQUIVALENT | lib/materializedScanner.js:421 |
| `setupQualityScore` | EQUIVALENT | lib/materializedScanner.js:422 |
| `demandScore` | EQUIVALENT | lib/materializedScanner.js:423 |
| `growthScore` | EQUIVALENT | lib/materializedScanner.js:424 |
| `epsGrowthProxyScore` | EQUIVALENT_ADAPT | lib/materializedScanner.js:428 (override) |
| `adProxyScore` | EQUIVALENT_ADAPT | lib/materializedScanner.js:427 (override) |
| `weaknessScore` | EQUIVALENT_ADAPT | lib/materializedScanner.js:591-593 (post-percentiles; ADR §4.4) |

## 3. Divergencias aceptadas (DIVERG-DOC, con respaldo literal en el ADR)

| ID | Severidad | Descripción | ADR § | Cita literal |
|----|-----------|-------------|-------|--------------|
| DIVERG-DOC #1 | comportamiento-observable | ipoScore no se invoca en materializedScanner.sectorize; composite se construye con ipoScore=0 implícito. | §4.3 | `**`ipoScore` en el composite**` |
| DIVERG-DOC #2 | cobertura | ebitdaMargin ausente en dataCoverageForRow privado; presente en researchRow.js (13 entradas). | §4.2 | ``ebitdaMargin` en cobertura fundamental` |
| DIVERG-DOC #3 | producto | Narrativa + legacyTotalScore + ratingModel ausentes en filas del cron. | §4.5 | `Narrativa + `legacyTotalScore` + `ratingModel`` |
| DIVERG-DOC #4 | contrato-compacto | chartPreview privado produce {date, close, volume} descendente; contrato define {date, close, sma50, sma200, volume} ascendente. | §4.6 | ``chartPreview`` |
| DIVERG-DOC #5 | defensa-barata | normalizeBars ausente en Ruta A; presente en materializedScanner. | §4.7 | ``normalizeBars`` |
| DIVERG-DOC #6 | politica-seleccion | Gate de 180 barras como política de selección en cron; Ruta A exige 20 (mínimo técnico) y 180 solo con requireLongHistory=true. | §4.8 | `Gate de barras` |
| DIVERG-DOC #7 | defensa-barata | Ruta C rechaza charts no decision-grade en el ensamblado y expone chartEstimated=false; la unificación estructural del builder queda para fase 2. | §4.1 | `**`chartEstimated`**` |
| DIVERG-DOC #8 | fiabilidad-estadistica | El cron calcula percentiles por lote local; los leaderboards conservan filas batch, exponen su scope, lo comunican y priorizan final solo en empates. La corrección estructural queda para fase 3. | §4.9 | `Percentiles por lote en leaderboards` |

## 4. Divergencias pendientes (DIVERG-PENDIENTE, pendientes de decisión humana)

Estas divergencias fueron detectadas por la auditoría pero **NO están respaldadas por el ADR**.
Permanecen en estado pendiente hasta que:
(a) se añada respaldo explícito al ADR y pasen a DIVERG-DOC; o
(b) se decida que no son divergencias y se retiren; o
(c) se cierre Camino A asumiéndolas como decisiones humanas.

| ID | Rutas | Señal | Evidencia | Impacto | Estado |
|----|-------|-------|-----------|---------|--------|

**Consecuencia:** mientras existan DIVERG-PENDIENTE, el estado global es "pendiente de decisión humana" y Camino A NO puede cerrarse formalmente.

## 5. Reglas que el audit enforza

1. **Registry ↔ matriz:** las claves de `SIGNAL_REGISTRY` coinciden con `EQUIVALENCE_MATRIX[*]`.
2. **Pesos del composite:** `COMPOSITE_WEIGHTS` suma 1.0 (real).
3. **Equivalencia numérica:** para cada celda EQUIVALENT/EQUIVALENT_ADAPT, el valor post-ruta === `computeSignal(row, key).value`.
4. **Override rule:** adProxy/epsGrowthProxy se preservan si finitos; fallback al canon si no.
5. **DIVERGENCE_DOC:** cada cita literal debe aparecer en el ADR.
6. **Golden snapshot:** cada `computeSignal(signal)` en fila completa === función snapshot pre-consolidación.
   La excepción histórica de `patternContributionScore` queda corregida y el override `r.patternContribution` se conserva.
7. **Sincronización Markdown ↔ matriz:** el archivo `docs/audit-score-coherence-contract.md` debe coincidir EXACTAMENTE con la salida de `renderContractMarkdown()`.
8. **Estado global:** `auditGlobalStatus().pendingCount === PENDING_DIVERGENCES.length`.

## 6. Cómo extender este contrato

1. Si añades una señal al `SIGNAL_REGISTRY`: actualiza la matriz, regenera el Markdown con `renderContractMarkdown()`.
2. Si eliminas: retírala de registry + matriz.
3. Si renombras: propágalo a todos los lugares. El test `validateMatrixCoverage` rompe con mensaje accionable.
4. Si añades una DIVERG-DOC: ponla en `ACCEPTED_DIVERGENCES` con cita literal del ADR; regenera el Markdown.
5. Si detectas una nueva divergencia sin respaldo del ADR: ponla en `PENDING_DIVERGENCES`; el estado global pasa a "pendiente".

## 7. Lo que este contrato NO hace

- No audita `COMPOSITE_WEIGHTS` semánticamente (las 12 claves). Solo la suma.
- No audita `scoreWeakness` semánticamente (umbrales).
- No audita la capa de fetch ni el contrato compacto.
- No audita `scoreCompositeValue`.
- **No declara Camino A cerrado.** Esta base auditable es prerrequisito de la validación humana posterior.

