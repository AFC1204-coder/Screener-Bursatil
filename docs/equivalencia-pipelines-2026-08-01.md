# Equivalencia de los tres pipelines de resultados — 2026-08-01

Auditoría estática + verificación con datos reales sobre la rama `codex/statsedge-ui-polish`, `BASE_SHA d29c82c`. Alcance: comparar los tres caminos que producen filas de resultados —
1. UI interactiva: `app/page.jsx` → `lib/screenerPipeline.js` (`filterAnalyzedRows`/`sectorize`) → `lib/screenerFilters.js`, construyendo la fila con `lib/researchRow.js` (`buildResearchRow`) y ensamblando el composite vía `lib/serverScanRunner.js`.
2. Cron/materializado: `lib/materializedScanner.js` (`runMaterializedScan`, `buildResearchRow` y `sectorize` propios) → `applyScreenerFilters`.
3. Leaderboards: `lib/leaderboards.js` → `applyScreenerFilters`.

No se modificó ningún archivo existente. No se proponen arreglos. Este documento no fue comiteado.

---

## PARTE A — Inventario de señales

### A.1 Conteo real de `SIGNAL_REGISTRY`

`lib/scoringEngine.js:161-628` define `SIGNAL_REGISTRY` con **18 claves** (verificado leyendo el objeto completo, no por conteo de terceros):

```
weinsteinScore, minerviniScore, momentumScore, riskScore, riskRewardScore,
volumeEffectScore, volumeScore, liquidityScore, ipoScore, objectiveSetupScore,
patternContributionScore, patternScore, setupQualityScore, demandScore,
growthScore, epsGrowthProxyScore, adProxyScore, weaknessScore
```

**Discrepancia con el contrato de la tarea**: el enunciado pide enumerar "las 20 señales". El registry tiene 18. El propio archivo tampoco es consistente consigo mismo: su comentario de cabecera dice *"Comparación byte-a-byte de las 21 fórmulas entre lib/scoring.js y lib/materializedScanner.js"* (`lib/scoringEngine.js:7`). Ninguno de los tres números (21, 20, 18) coincide entre sí. Se reporta la discrepancia tal cual, sin forzar el conteo a 20.

### A.2 Señal por señal: `compute()`, entrada al composite, y en qué pipelines se calcula

| # | Clave | `compute()` (cita breve, `lib/scoringEngine.js`) | ¿Entra a `COMPOSITE_WEIGHTS`? | researchRow.js (interactivo) | materializedScanner.js (cron) | leaderboards.js |
|---|---|---|---|---|---|---|
| 1 | `weinsteinScore` | L166-176, umbrales sobre SMA50/150/200 y pendiente | No (insumo de narrativa/legacyTotalScore) | Sí, `computeSignal` en `buildResearchRow` (L291-316, confirmado por grep) | Sí, mismas 11 señales que researchRow.js (L580-604) | No calcula: `rowFromScanResult` (L367-392) hace spread de `metrics`/`raw` ya persistidos |
| 2 | `minerviniScore` | L178-196 | No | Sí | Sí | No |
| 3 | `momentumScore` | L197-214 | Sí, peso 0.02 | Sí | Sí | No |
| 4 | `riskScore` | L215-233 | Sí, peso 0.05 | Sí | Sí | No |
| 5 | `riskRewardScore` | L234-269 | Sí, peso 0.08 | Sí | Sí | No |
| 6 | `volumeEffectScore` | L270-296 | No (insumo de `volumeScore`/`demandScore`) | Sí | Sí | No |
| 7 | `volumeScore` | L297-321 | No (insumo de `demandScore`) | Sí | Sí | No |
| 8 | `liquidityScore` | L322-341 | No (insumo de `demandScore`) | Sí | Sí | No |
| 9 | `ipoScore` | L342-368 | Sí, peso 0.02 | **Sí** — `screenerPipeline.js:sectorize` L318: `computeSignal({ ...r, sectorScore }, "ipoScore")` | **NO se invoca en ningún punto de `materializedScanner.js`** (verificado: `grep -n "ipoScore" lib/materializedScanner.js` no devuelve ninguna llamada a `computeSignal`; el nombre solo aparece leído como `Number.isFinite(row.ipoScore)` en consumidores externos) | No |
| 10 | `objectiveSetupScore` | L369-397 | Indirecto: alimenta `objectiveScore` (no `compositeScore`) en ambos `sectorize()` | Sí, `screenerPipeline.js:sectorize` L319 | Sí, `materializedScanner.js:sectorize` L423 | No |
| 11 | `patternContributionScore` | L398-421 | No directo (insumo de `patternScore`/`setupQualityScore`) | Sí, L320 | Sí, L424 | No |
| 12 | `patternScore` | L422-432 | No (señal de presentación) | Sí, L321 | Sí, L425 | No |
| 13 | `setupQualityScore` | L433-449 | Sí, peso 0.17 | Sí, L322 | Sí, L426 | No |
| 14 | `demandScore` | L450-475 | Sí, peso 0.10 | Sí, L323 | Sí, L427 | No |
| 15 | `growthScore` | L476-530 | Sí, peso 0.08 | Sí, L324 | Sí, L428 | No |
| 16 | `epsGrowthProxyScore` | L531-571 | Indirecto vía `epsAnchor` (no es una clave literal de `COMPOSITE_WEIGHTS`, pero `epsAnchor = epsGrowthProxyScore ?? growthScore` en ambos `sectorize()`) | Sí, L328 (preferido `r.epsGrowthProxyScore` precomputado) | Sí, L432 | No |
| 17 | `adProxyScore` | L572-595 | Sí, peso 0.08 | Sí, L327 | Sí, L431 | No |
| 18 | `weaknessScore` | L615-627 (envuelve `scoreWeakness`) | **No** — diagnóstica, resuelta por cascada de prioridad en `lib/decisionAudit.js`, `direction:"negative"` | Sí, L291-316 (dentro de las 11) y de nuevo en `sectorize` L352 (`computeSignal(r, "weaknessScore")` + `scoreWeakness(scoredBase)` en L355) | Sí, dentro de las 11 de `buildResearchRow` | No calcula: usa `lib/stockRows.js:weaknessScore` (ver B.4.1, implementación DISTINTA) |

**`COMPOSITE_WEIGHTS`** (`lib/scoringEngine.js:633-646`) tiene 12 entradas, de las cuales solo 8 son claves literales del registry (`setupQualityScore, demandScore, adProxyScore, growthScore, riskRewardScore, riskScore, momentumScore, ipoScore`); las otras 4 (`rsAnchor, rsQualityScore, sectorScore, epsAnchor`) se calculan fuera del registry, dentro de cada `sectorize()`.

**Hallazgo central de Parte A**: `ipoScore` se computa e incluye en el composite del camino interactivo (`screenerPipeline.js:335-336`, ambas llamadas a `scoreCompositeValue` incluyen `ipoScore`) pero **nunca se invoca ni se pasa** en el camino cron (`materializedScanner.js:438-439`, ninguna de las dos llamadas incluye la clave `ipoScore`). Esto coincide exactamente con la discrepancia ya documentada en la cabecera de `scoringEngine.js:15-19` y se confirma aquí en código vivo, no solo en el comentario.

`leaderboards.js` **no calcula ninguna señal**: `rowFromScanResult` (`lib/leaderboards.js:367-392`) construye la fila de trabajo por spread de `metrics`/`raw` ya persistidos en `scan_results`, y solo deriva campos de presentación con `firstFinite` sobre valores ya calculados por el productor original (interactivo o cron) del scan que está leyendo. Hereda sin corregir cualquier divergencia de los dos caminos anteriores.

---

## PARTE B — Divergencias de cálculo

### B.3 Construcción de fila: campos que aparecen en un camino y faltan en otro

`lib/researchRow.js:buildResearchRow` (L188-319) y `lib/materializedScanner.js:buildResearchRow` (**L482-607**, confirmado por lectura directa — el rango estimado en el contrato, L489-620, está desplazado ~7 líneas) son dos implementaciones **paralelas independientes**, no una función compartida.

Campos presentes solo en `lib/researchRow.js`:
- `normalizeWebsite(profile.website)` (L235) — en `materializedScanner.js` L530 el campo `website` se persiste crudo, sin normalizar.
- `compactBusinessSummary` (L236).
- `ipoCategory`/`ipoCatForRow` (L302).
- `logoDomain`/`domainFromUrl` (L287).
- `businessEs`/`actividadEs` (L288).
- Fusión de `scoreRsQuality` dentro del mismo `buildResearchRow` (L311, vía `withQuality`) — en el cron esta fusión ocurre más tarde, dentro de `sectorize()` (L435-436), no en `buildResearchRow`.

Campos presentes solo en `lib/materializedScanner.js:buildResearchRow`:
- `micCode` (L518-521, vía `micCodeForSymbol`).
- `sharesOutstanding` (L537).
- `dataProviderOrigin` (L541).
- `providerMeta`/`dataSourceMeta` (L574).

`lib/leaderboards.js` no construye fila: no hay una tercera implementación de cálculo de campos, solo lectura/normalización de nombres sobre lo que el productor (interactivo o cron) ya persistió. Cualquier campo ausente en el scan de origen queda ausente en el leaderboard también.

### B.4 Cálculos duplicados

**B.4.1 — `weaknessScore` (ya conocido por el contrato, verificado con lectura directa de ambas implementaciones)**

Canónica, `lib/scoringEngine.js:86-132` (`scoreWeakness`), ~15 factores, techo 100 (`Math.max(0, Math.min(100, s))`, L126), cadena de fallback RS: `rsGlobalPct ?? rsRating ?? rsCountryPct ?? rsSectorPct ?? 50` (L97).

Divergente, `lib/stockRows.js:252-269`:

```js
export function weaknessScore(row = {}) {
  const direct = finiteOrNull(snapshotValue(row, "weaknessScore"));
  if (Number.isFinite(direct)) return direct;

  let score = 0;
  const rs = rowRsPrimary(row) ?? 50;
  const distance52w = finiteOrNull(snapshotValue(row, "distance52w"));
  const perf3m = finiteOrNull(snapshotValue(row, "perf3m"));
  const extSma50 = finiteOrNull(snapshotValue(row, "extSma50"));
  const riskScore = finiteOrNull(snapshotValue(row, "riskScore")) ?? 50;

  if (rs < 45) score += 16;
  if (Number.isFinite(distance52w) && distance52w < -30) score += 14;
  if (Number.isFinite(perf3m) && perf3m < 0) score += 12;
  if (Number.isFinite(extSma50) && extSma50 < -8) score += 10;
  if (riskScore < 35) score += 10;
  return clamp(score);
}
```

Solo 5 factores (contra ~15 de la canónica), umbrales distintos (`rs<45` vs `rs<30/45/55` escalonado), y sin factores de `sma50`/`sma200`/`sma200Slope`/`perf6m`/`perf12m`/`maxDrawdown63d`/`upDownVolRatio`/`upVolume`/`speculationRiskScore` que sí tiene la canónica. **Confirmado: no producen el mismo resultado para la misma fila.** Sí devuelve `row.weaknessScore` directo cuando ya está presente en el snapshot (primera línea de la función), por lo que la divergencia solo se manifiesta cuando `weaknessScore` no viene precalculado en la fila que consume `lib/stockRows.js`.

**B.4.2 — `sectorize()` duplicado casi línea a línea entre `lib/materializedScanner.js:409-465` y `lib/screenerPipeline.js:304-359`**

Ambas funciones repiten la misma secuencia de `computeSignal(...)` y llaman dos veces a `scoreCompositeValue`/`computeCompositeWithCoverage` con argumentos casi idénticos. La diferencia real, verificada línea a línea:

- `lib/screenerPipeline.js:335-336` (interactivo): ambas llamadas incluyen `ipoScore`.
- `lib/materializedScanner.js:438-439` (cron): **ninguna de las dos llamadas incluye `ipoScore`** (confirmado, cita literal):

```js
const objectiveScore = scoreCompositeValue({ setupQualityScore: objectiveSetupScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
const composite = computeCompositeWithCoverage({ setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
```

Como `computeComposite`/`computeCompositeWithCoverage` tratan una clave ausente como término faltante y **excluyen su peso** (renormalizando sobre el resto, `lib/scoringEngine.js:786-793`, no como default 0), el cron no solo pierde el aporte de `ipoScore`: redistribuye ese 0.02 de peso proporcionalmente entre las 11 señales restantes del composite. Es una divergencia de cálculo real, no solo de nombre, con efecto medible en el valor final (aunque pequeño, 2 puntos porcentuales de peso).

**B.4.3 — `objectiveScore` y `compositeScore` colapsan al mismo valor tras la finalización, rompiendo su distinción de diseño**

En ambos `sectorize()` (interactivo y cron, previos a finalización), `objectiveScore` usa `setupQualityScore: objectiveSetupScore` (sin bonus de patrón/VCP) mientras `compositeScore`/`totalScore` usa `setupQualityScore` (con bonus) — están deliberadamente diseñados para diferir. Cita, `lib/screenerPipeline.js:335-336`:

```js
const objectiveScore = scoreCompositeValue({ setupQualityScore: objectiveSetupScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: r.riskScore, momentumScore: r.momentumScore, ipoScore });
const compositeScore = scoreCompositeValue({ setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: r.riskScore, momentumScore: r.momentumScore, ipoScore });
```

Pero en `lib/scanPercentileFinalization.js:118-161` (invocado por `finalizeScanResultsInDb`, solo desde `lib/serverScanRunner.js` — el cron nunca llega aquí, divergencia ya confirmada por el contrato), **ambas llamadas usan la misma variable `setupQualityScore`** (nunca `objectiveSetupScore`), cita literal completa:

```js
// El composite objetivo
// sustituye objectiveSetupScore por setupQualityScore (sin bonus de
// patrón) — mismo verbatim que lib/screenerPipeline.js:335.
const setupQualityScore = Number.isFinite(row.setupQualityScore) ? row.setupQualityScore : 0;
...
const objectiveScore = scoreCompositeValue({
  setupQualityScore,
  rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor,
  sectorScore, riskRewardScore, riskScore, momentumScore, ipoScore,
});
const compositeScore = scoreCompositeValue({
  setupQualityScore,
  rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor,
  sectorScore, riskRewardScore, riskScore, momentumScore, ipoScore,
});
```

**El comentario del propio archivo (`scanPercentileFinalization.js:118-119`, "mismo verbatim que lib/screenerPipeline.js:335") es objetivamente falso**: `screenerPipeline.js:335` usa `objectiveSetupScore`, no `setupQualityScore`, precisamente para que `objectiveScore` excluya el bonus de patrón y difiera de `compositeScore`. La finalización pasa la MISMA variable (`setupQualityScore`, con bonus incluido) a ambas llamadas, por lo que tras finalizar, `objectiveScore === compositeScore === totalScore` **siempre**, por construcción — sin importar el patrón/VCP de la fila. Este colapso se confirma con datos reales en la Parte C (AAPL: interactivo finalizado `objectiveScore = totalScore = 79.19338220237788`; cron no finalizado `objectiveScore 79.157 ≠ totalScore 80.857`).

No se hallaron duplicaciones adicionales de lógica de cálculo (más allá de nombres compartidos que ya delegan al mismo canónico) entre `screenerFilters.js`, `relativeStrength.js`, `researchRow.js`, `materializedScanner.js`, `leaderboards.js`, `stockRows.js` y `scoringEngine.js` en el tiempo disponible de esta auditoría; `relativeStrength.js` es importado (no reimplementado) por los tres consumidores.

### B.5 Tratamiento de dato ausente: divergencias entre pipelines específicamente

Sin repetir el catálogo completo de `docs/inventario-dato-ausente-2026-08-01.md` (334 líneas, ya existente y leído íntegro para esta auditoría):

1. **Ya catalogado como divergencia base del contrato**: la renormalización por exclusión de `computeCompositeDetailed` (`lib/scoringEngine.js:744-806`) solo opera "pura" en las filas que nunca pasan por finalización (todas las del cron, y las interactivas cuyo scan no llegó a finalizar). Las filas que sí finalizan pasan primero por `lib/scanPercentileFinalization.js:120-133`, que sustituye ~11 métricas ausentes por constantes (`0/40/45/50`) ANTES de recomputar el composite — contradice el diseño de exclusión/renormalización documentado en `scoringEngine.js:744-763`. Esta es exactamente la divergencia (c) ya confirmada por el contrato de la tarea; esta auditoría la verifica en código vivo en las líneas citadas arriba y la reconfirma con datos reales en C.8.1.

2. **Hallazgo nuevo, no catalogado en `docs/inventario-dato-ausente-2026-08-01.md`**: el colapso `objectiveScore === compositeScore` post-finalización (B.4.3) no es estrictamente "tratamiento de dato ausente" sino "recomputación con inputs artificialmente igualados" — no encontré un ID (C01-C21/M01-M85/B01-B50) que lo cubra. Se reporta aquí como hallazgo nuevo de esta auditoría.

3. **Hallazgo nuevo**: `ipoScore` ausente en el cron no es un caso de "dato ausente en la fila" sino de "señal nunca invocada en ese pipeline" — un tipo de divergencia distinto a los catalogados en el inventario (que asume que la señal se calcula en todos los caminos y varía el tratamiento de su ausencia). Tampoco tiene ID en el inventario existente.

4. Campos exclusivos de un camino (`micCode`, `sharesOutstanding`, `dataProviderOrigin`, `providerMeta` solo en cron; `logoDomain`, `businessEs`, `ipoCategory` solo en interactivo, ver B.3) son "ausentes por diseño" en el otro camino. No se determinó si tienen impacto en scoring (aparentemente no, son campos de presentación/proveniencia) — se deja explícitamente sin cerrar por no haber podido verificar consumo aguas abajo de cada uno en el tiempo disponible.

---

## PARTE C — Verificación con datos reales

### C.6 Discriminador cron vs. interactivo (corrige un supuesto del enunciado)

El enunciado supone que `settings.source = "jobs/scan-refresh"` sin `shadowSource` identifica un scan de cron, y `settings.scanSymbols` identifica uno interactivo. Verificado en código (`app/api/scan/route.js:34-62`) que el endpoint interactivo hace spread del `body` recibido del cliente sin fijar su propio `source` — en la práctica, algunos registros interactivos creados por herramientas admin heredan `settings.source = "jobs/scan-refresh"`, lo que habría producido falsos negativos de clasificación.

**Discriminador verificado y usado en su lugar**: la columna `market_regime` de la tabla `scans`. El cron fija literalmente `market_regime: "batch-cache"` (`lib/materializedScanner.js:1622`); el endpoint interactivo no incluye esa clave en su INSERT y las filas reales inspeccionadas muestran `market_regime: "server-scan"` para todos los scans creados vía `/api/scan`.

Queries ejecutadas:
```
table=scans, select=id,created_at,market_regime,row_count, filter=market_regime=eq.server-scan
table=scans, select=id,created_at,market_regime,row_count, filter=market_regime=eq.batch-cache
```

### C.7 Símbolos encontrados en ambos tipos de scan — 3 casos

**Caso 1 — AAPL**

- Cron: `scan_id=c2643a97-e4c3-46ce-b895-54b0bb1d78f8`, `created_at=2026-07-29T19:44:11.959Z`, `market_regime=batch-cache`, `settings.source=jobs/scan-refresh`, `shadowSource=null`, `row_count=1`.
- Interactivo: `scan_id=819b849e-6adc-4d1f-9b9e-b86025ba8c89`, `created_at=2026-07-30T00:15:01.878Z`, `market_regime=server-scan`, `progress.status=complete`, `progress.finalizationStatus=succeeded`, `progress.percentilesFinalized=true`. Separación de ~4.5 h (mismo día calendario).

Query ejecutada:
```
table=scan_results
select=symbol,scan_id,created_at,rank_index,metrics->totalScore,metrics->objectiveScore,metrics->weinsteinScore,metrics->minerviniScore,metrics->rsRating,metrics->rsGlobalPct,metrics->sectorScore,metrics->riskScore,metrics->percentileScope,metrics->lastDate
filter=scan_id=in.(c2643a97-e4c3-46ce-b895-54b0bb1d78f8,819b849e-6adc-4d1f-9b9e-b86025ba8c89)&symbol=eq.AAPL
```

| campo | cron (batch) | interactivo (final) |
|---|---|---|
| totalScore | 80.85693972348903 | 79.19338220237788 |
| objectiveScore | 79.15693972348903 | 79.19338220237788 |
| weinsteinScore | 100 | 100 |
| minerviniScore | 100 | 100 |
| rsRating | 77 | 76 |
| rsGlobalPct | null | null |
| sectorScore | 54.005397234890296 | 52.5938220237787 |
| riskScore | 92 | 92 |
| percentileScope | "batch" | "final" |
| lastDate | "2026-07-29" | null |

**Casos 2 y 3 — ASML.AS y AZN.L**

Par de scans: cron `scan_id=7c62655b-b88c-4b3f-9a01-16e449610f85`, `created_at=2026-07-13T21:44:23.549Z`, `market_regime=batch-cache`, `shadowSource=null`; interactivo `scan_id=b325393c-6865-4a99-8e6d-7d9c8a8f9cb8`, `created_at=2026-07-06T23:43:09.870Z`, `market_regime=server-scan`, 7 días antes.

**Advertencia verificada**: el `settings.progress` del scan interactivo `b325393c` tiene `status="error"` (`"error": "canceling statement due to statement timeout"`), sin `finalizationStatus`/`percentilesFinalized`. Este scan interactivo se interrumpió y **nunca llegó a `finalizeScanResultsInDb`** — su `percentileScope` sigue en `"batch"`, igual que el cron. Esto no contradice el Caso 1 (donde el interactivo sí finalizó): es una instancia concreta interrumpida por timeout, no una regla general del pipeline interactivo. Se incluye igual porque las señales "puras" (`weinsteinScore`, `minerviniScore`, `riskScore`) no dependen de la finalización y siguen siendo comparables.

Query ejecutada:
```
table=scan_results
select=symbol,scan_id,created_at,rank_index,metrics->totalScore,metrics->objectiveScore,metrics->weinsteinScore,metrics->minerviniScore,metrics->rsRating,metrics->rsGlobalPct,metrics->sectorScore,metrics->riskScore,metrics->percentileScope,metrics->lastDate
filter=scan_id=in.(7c62655b-b88c-4b3f-9a01-16e449610f85,b325393c-6865-4a99-8e6d-7d9c8a8f9cb8)&symbol=in.(ASML.AS,AZN.L,SHEL.L,CABK.MC,IBE.MC)
```

| campo | ASML.AS cron (07-13) | ASML.AS interactivo (07-06) | AZN.L cron (07-13) | AZN.L interactivo (07-06) |
|---|---|---|---|---|
| totalScore | 83.7992 | 83.1584 | 41.6537 | 58.8159 |
| objectiveScore | 81.4192 | 83.1584 | 40.9778 | 58.8159 |
| weinsteinScore | 100 | 100 | 46 | 54 |
| minerviniScore | 100 | 100 | 38 | 58 |
| rsGlobalPct | 91 | 93 | 29 | 59 |
| sectorScore | 80 | 94 | 27.47 | 44.75 |
| riskScore | 92 | 84 | 40 | 70 |
| percentileScope | "batch" | "batch" (interrumpido) | "batch" | "batch" (interrumpido) |
| lastDate | "2026-07-10" | null | "2026-07-13" | null |

SHEL.L y CABK.MC/IBE.MC también aparecen en el mismo par de scans con el mismo patrón general; no se tabulan en detalle por espacio, la query ya ejecutada los incluyó.

### C.8 Dictamen de causa por diferencia

1. **AAPL — colapso `objectiveScore = totalScore` solo en el interactivo finalizado, no en el cron**: causa **verificada por código** (no solo inferida): el interactivo pasó por `finalizeScanResultsInDb` (`percentileScope="final"` confirmado en la fila), que aplica el bug de B.4.3 (misma `setupQualityScore` en ambas llamadas). El cron nunca finaliza (divergencia (b) del contrato), así que conserva la distinción original `objectiveSetupScore` vs `setupQualityScore` de `materializedScanner.js:sectorize` — de ahí que su `objectiveScore` (79.157) y `totalScore` (80.857) sí difieran. **Causa: cálculo genuinamente distinto por el bug de finalización, no diferencia de universo ni de fecha.**

2. **AAPL — `sectorScore` difiere (54.0 vs 52.6), `rsRating` difiere (77 vs 76), `totalScore` difiere ~1.7 pts**: los scans distan ~4.5 h (mismo día). `sectorScore` se recalcula sobre la población completa solo en la finalización (comentario explícito en `scanPercentileFinalization.js`); el cron ese día escaneó una población multi-mercado (`["US","HK","AU","GB","DE","FR","NL","CH","SE","IT","ES"]`, 1 fila para AAPL en ese scan) mientras el interactivo usó una población fija de 6 símbolos (`AAPL,GOOGL,MSFT,NVDA,AMZN,META`). **No se puede aislar** cuánto de la diferencia proviene del universo distinto frente al mecanismo de finalización en sí — ambos factores coexisten y no hay forma de separarlos con los datos disponibles. Se reporta explícitamente como **no determinable con precisión**.

3. **ASML.AS/AZN.L — diferencias de score (p. ej. AZN.L totalScore 41.65 vs 58.82, weinsteinScore 46 vs 54)**: los scans distan **7 días** (2026-07-06 vs 2026-07-13). `weinsteinScore`/`minerviniScore` dependen de SMAs y distancia a máximos, que cambian día a día con el precio — 7 días de mercado bastan para explicar cambios de esta magnitud sin invocar divergencia de pipeline. No se puede descartar un efecto adicional de pipeline (ambos scans muestran `percentileScope="batch"`, pero por razones distintas: el cron nunca finaliza, el interactivo se interrumpió antes de finalizar), pero ese efecto no es cuantificable por separado del efecto temporal con los datos disponibles. **Causa dominante y verificada: diferencia de fecha (`created_at`); efecto secundario de pipeline presente pero no cuantificable.**

### C.9 Cobertura de casos

Se encontraron **3 símbolos** con presencia confirmada en ambos tipos de scan: AAPL, ASML.AS y AZN.L (además SHEL.L, CABK.MC e IBE.MC comparten el mismo par de scans que ASML.AS/AZN.L, no detallados por espacio pero disponibles en la query ya ejecutada). Cumple el mínimo de 3 casos pedido, aunque la disponibilidad real de pares comparables es escasa: de los scans interactivos existentes, solo un subconjunto pequeño completó finalización con éxito, y de esos solo uno (`819b849e`) comparte símbolo con un scan cron limpio de una sola fila (`c2643a97`). El resto de solapamientos disponibles proviene de scans interactivos grandes (`b325393c`, y otros de tamaño similar) que están todos interrumpidos por timeout de sentencia SQL antes de completar — lo cual también les impide llegar a finalización. Esto es en sí mismo una observación operativa relevante para interpretar cualquier comparación futura entre pipelines: la finalización, cuando el scan es grande, no siempre se ejecuta.

---

## PARTE D — Respuesta

### D.10 Tabla de equivalencia — 18 señales del registry (no 20, ver A.1)

| Señal | Interactivo | Cron | Leaderboards | Veredicto |
|---|---|---|---|---|
| `weinsteinScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** entre interactivo/cron; leaderboards hereda sin discrepancia propia |
| `minerviniScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `momentumScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `riskScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `riskRewardScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `volumeEffectScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `volumeScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `liquidityScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `ipoScore` | **Calcula y entra al composite** (`screenerPipeline.js:318,335-336`) | **NUNCA se invoca** (ausente en `materializedScanner.js`) | No calcula, hereda | **Distinto — divergencia confirmada, no solo teórica** |
| `objectiveSetupScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** en cálculo puntual; su consumo aguas abajo diverge tras finalización (B.4.3) |
| `patternContributionScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `patternScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `setupQualityScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** en cálculo puntual; ver B.4.3 para el efecto en `objectiveScore` post-finalización |
| `demandScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `growthScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `epsGrowthProxyScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `adProxyScore` | Calcula | Calcula, misma fórmula | No calcula, hereda | **Igual** |
| `weaknessScore` | Calcula vía `scoreWeakness` canónico (`scoringEngine.js`) | Calcula vía el mismo canónico | **No calcula igual** — `lib/leaderboards.js` no invoca ninguna, pero cualquier consumidor que use `lib/stockRows.js:weaknessScore` obtiene una fórmula **distinta** (5 factores vs ~15, techos y umbrales distintos) | **Distinto** — implementación paralela confirmada en `lib/stockRows.js:252-269` |

Nota sobre `rsAnchor`, `rsQualityScore`, `sectorScore`, `epsAnchor`: no son señales del registry, pero al pesar 0.16+0.06+0.10+0.08 = 0.40 del composite merecen mención — se calculan de forma paralela (no compartida) en `screenerPipeline.js:sectorize` y `materializedScanner.js:sectorize`, con la MISMA fórmula fuente (`scoreRsQuality`, `computeSectorScoresForRows`), pero `sectorScore` se calcula sobre la población completa del scan solo en el camino que sí finaliza (comentario explícito en ambos archivos) — divergencia de alcance poblacional entre cron y finalización, ya cubierta en C.8.2 con datos reales.

### D.11 Divergencias por gravedad (pueden hacer que el mismo símbolo sea candidato en un camino y no en otro)

1. **Alta — el cron nunca aplica el filtro de preset** (ya confirmada por el contrato, no reinvestigada): `applyScreenerFilters` corta en `if (!filters?.enabled)` porque `runMaterializedScan` no define `options.screenerFilters`. Efecto: cualquier símbolo que el preset activo rechazaría en la UI interactiva (por `minRsRating`, distancias, cobertura, etc.) puede aparecer como fila persistida por el cron sin haber pasado ese filtro.

2. **Alta — el cron nunca finaliza percentiles**, y la finalización tiene un bug que colapsa `objectiveScore`/`totalScore` (B.4.3): un símbolo cuyo ranking depende de qué tan cerca esté `objectiveScore` de un umbral (p. ej. `minTotalScore` en `leaderboards.js:401` o `listRationale.js`) puede quedar por encima o por debajo del corte según si la fila que se está leyendo pasó por finalización o no — el valor de `objectiveScore` es sistemáticamente distinto de `compositeScore` en filas no finalizadas (como todas las del cron) y sistemáticamente igual en las finalizadas.

3. **Alta — `ipoScore` ausente en el cron** (D.10): para símbolos donde `ipoScore` es alto (IPOs recientes con buen setup), el composite del cron pierde ese aporte (2% de peso redistribuido a otras señales), lo que puede desplazar el ranking relativo de ese símbolo frente al mismo símbolo evaluado por el camino interactivo.

4. **Media — `weaknessScore` con dos implementaciones** (D.10, B.4.1): cualquier vista o lista que use `lib/stockRows.js:weaknessScore` en vez de la canónica de `scoringEngine.js` puede clasificar el mismo símbolo con distinto nivel de "deterioro", afectando la elegibilidad en `setupMode: "weakness"` (`lib/screenerPipeline.js:265`) o en el filtro `minWeaknessScore` (`lib/screenerFilters.js:757`) según cuál de las dos funciones haya poblado `row.weaknessScore` antes de llegar a esos puntos. No se verificó en esta auditoría qué vistas concretas consumen `lib/stockRows.js:weaknessScore` en producción — queda **explícitamente sin cerrar**.

5. **Media — universo poblacional distinto entre cron (multi-mercado, escaneos parciales) e interactivo (símbolos fijos elegidos por el usuario)** afecta `sectorScore` y cualquier percentil relativo (`rsGlobalPct`, `rsRating`) — confirmado con datos reales en C.8.2, pero sin poder aislar su magnitud del efecto de finalización.

6. **Baja/no cuantificable — campos exclusivos de un pipeline** (`micCode`, `sharesOutstanding`, `ipoCategory`, etc., B.3): no se verificó que afecten scoring o elegibilidad; se reportan como diferencia de fila cruda persistida, no como divergencia de candidatura confirmada.

---

## CONFIANZA

**Verificado leyendo código** (alta confianza, cita literal disponible):
- Conteo real de 18 claves en `SIGNAL_REGISTRY` y discrepancia con "20"/"21" del contrato/comentario propio.
- `ipoScore` nunca invocado en `lib/materializedScanner.js` (confirmado con `grep` directo, cero ocurrencias de `computeSignal(..., "ipoScore")` o llamada equivalente en ese archivo).
- Las dos implementaciones divergentes de `weaknessScore` (`lib/scoringEngine.js:86-132` vs `lib/stockRows.js:252-269`), confirmadas por lectura directa de ambos cuerpos de función.
- El colapso `objectiveScore === compositeScore` en `lib/scanPercentileFinalization.js:118-161` por reutilizar la misma variable `setupQualityScore` en ambas llamadas, contra `objectiveSetupScore` vs `setupQualityScore` en `lib/screenerPipeline.js:335-336` y `lib/materializedScanner.js:438-439` — confirmado por lectura directa de las tres funciones.
- `lib/leaderboards.js` no calcula señales propias, solo hereda de `metrics`/`raw` persistidos (`rowFromScanResult`, L367-392).
- Campos exclusivos de cada `buildResearchRow` (B.3), confirmados por lectura directa de ambos archivos.
- El discriminador real cron/interactivo es `market_regime`, no `settings.source`/`settings.scanSymbols` (verificado en `app/api/scan/route.js` y `lib/materializedScanner.js:1622`).

**Verificado consultando datos** (vía `mcp__supabase-readonly__supabase_query`, queries y resultados citados literalmente en Parte C):
- Existencia de al menos 3 símbolos (AAPL, ASML.AS, AZN.L) presentes en ambos tipos de scan, con sus valores de métricas exactos.
- El estado de finalización real de cada scan comparado (`progress.status`, `progress.finalizationStatus`, `percentileScope` en las filas).
- La magnitud numérica de las diferencias reportadas en las tablas de C.7.

**Inferido, con incertidumbre explícita declarada**:
- Cuánto de la diferencia de `sectorScore`/`rsRating`/`totalScore` en AAPL (C.8.2) se debe a universo de scan distinto frente a mecanismo de finalización — **no se pudo aislar, declarado explícitamente como no determinable**.
- Cuánto del efecto en ASML.AS/AZN.L (C.8.3) es atribuible a divergencia de pipeline más allá del efecto dominante de 7 días de diferencia temporal — **no cuantificable con los datos disponibles**.
- Si los campos exclusivos de cada `buildResearchRow` (micCode, ipoCategory, etc.) tienen algún efecto de candidatura aguas abajo — **no verificado, queda abierto**.
- Qué vistas de producción consumen `lib/stockRows.js:weaknessScore` en vez de la canónica, y con qué frecuencia esto produce una clasificación de deterioro distinta para el mismo símbolo — **no verificado en esta auditoría, queda abierto**.

**No se pudo cerrar con los datos disponibles**:
- Aislar el efecto puro de "universo de scan" del efecto puro de "finalización de percentiles" sobre `sectorScore`/`totalScore`, porque en los pares de scans disponibles ambos factores coexisten simultáneamente.
- Encontrar un scan interactivo grande (cientos/miles de símbolos) que haya finalizado con éxito para comparar contra el cron en igualdad de tamaño de universo — todos los scans interactivos grandes disponibles en la base terminaron en `status:"error"` por timeout antes de finalizar.
