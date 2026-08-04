# Contrato verificable de señales de scoring — 2026-08-03

## Veredicto

El contrato de `SIGNAL_REGISTRY` es de **18 señales: 17 positivas y 1 negativa/diagnóstica**. El objeto ocupa `lib/scoringEngine.js:161-628`; el censo por claves de primer nivel devuelve 18 y el censo de `direction` devuelve `positive=17`, `negative=1`, `total=18`.

No hay evidencia de que el registro haya tenido 20 o 21 entradas ni de que se hayan eliminado señales. `SIGNAL_REGISTRY` nació con las mismas 18 claves en `7cbbbf2` (2026-07-06) y el diff de nombres de clave entre ese commit y `HEAD` está vacío.

La frase informal «contrato para las 20 señales» puede explicarse en el código vivo: `tests/favoriteSnapshotAmpliado.test.js:51-59` llama «20 señales del SIGNAL_REGISTRY» a una lista que contiene las 18 claves reales **más** `sectorScore` y `rsQualityScore`, dos métricas externas al registro. No se encontró ningún archivo `.task` en este checkout, por lo que el contenido exacto del `.task` mencionado no es verificable aquí.

## PARTE A — Censo

### A.1 Claves, una a una

| # | Clave | Entrada | `compute` canónico | Dirección |
|---:|---|---|---|---|
| 1 | `weinsteinScore` | `lib/scoringEngine.js:162` | inline, L166-176 | positiva |
| 2 | `minerviniScore` | `lib/scoringEngine.js:178` | inline, L182-195 | positiva |
| 3 | `momentumScore` | `lib/scoringEngine.js:197` | inline, L201-213 | positiva |
| 4 | `riskScore` | `lib/scoringEngine.js:215` | inline, L219-232 | positiva |
| 5 | `riskRewardScore` | `lib/scoringEngine.js:234` | inline, L238-268 | positiva |
| 6 | `volumeEffectScore` | `lib/scoringEngine.js:270` | inline, L274-295 | positiva |
| 7 | `volumeScore` | `lib/scoringEngine.js:297` | inline, L301-320 | positiva |
| 8 | `liquidityScore` | `lib/scoringEngine.js:322` | inline, L326-340 | positiva |
| 9 | `ipoScore` | `lib/scoringEngine.js:342` | inline, L346-367 | positiva |
| 10 | `objectiveSetupScore` | `lib/scoringEngine.js:369` | inline, L376-396 | positiva |
| 11 | `patternContributionScore` | `lib/scoringEngine.js:398` | `resolvePatternContribution`, L149-153 y L420 | positiva |
| 12 | `patternScore` | `lib/scoringEngine.js:422` | inline, L426-431 | positiva |
| 13 | `setupQualityScore` | `lib/scoringEngine.js:433` | inline, L437-448 | positiva |
| 14 | `demandScore` | `lib/scoringEngine.js:450` | inline, L454-474 | positiva |
| 15 | `growthScore` | `lib/scoringEngine.js:476` | inline, L494-529 | positiva |
| 16 | `epsGrowthProxyScore` | `lib/scoringEngine.js:531` | inline, L546-570 | positiva |
| 17 | `adProxyScore` | `lib/scoringEngine.js:572` | inline, L576-594 | positiva |
| 18 | `weaknessScore` | `lib/scoringEngine.js:615` | `scoreWeakness(r).weaknessScore`, L86-132 y L626 | **negativa, diagnóstica** |

### A.2 De dónde salen 21, 20, 19 y 18

| Cifra | Qué cuenta realmente | Veredicto |
|---:|---|---|
| 21 | El comentario `lib/scoringEngine.js:7` dice «21 fórmulas». Ese texto ya estaba en el commit que creó el archivo (`7cbbbf2`). En el padre de ese commit, `lib/scoring.js` tenía exactamente 19 funciones `score*`: las 18 fórmulas que pasaron a ser entradas del registro más el agregador `scoreCompositeValue`. Si además se cuentan `compositeLabel` y `compositeNarrative`, el total da exactamente 21. El scanner antiguo solo tenía 17 funciones `score*`. | **21 elementos de la superficie antigua, no 21 señales.** La aritmética se reconstruye como 18 señales + 1 agregador + 2 helpers de presentación. No puede probarse la intención mental del autor, pero sí que tres de esos 21 elementos no son señales del registro y que nunca hubo 21 claves. |
| 20 | `tests/favoriteSnapshotAmpliado.test.js:53-59` enumera 20 nombres, pero los dos últimos externos son `sectorScore` y `rsQualityScore`. `lib/signalContradictions.js:3` y `lib/scoring.js:26` repiten también comentarios de 20/19 que no concuerdan con el objeto. | **18 del registro + 2 externas**, no 20 entradas. El `.task` original no está en este checkout. |
| 19 | `grep -c "compute:" lib/scoringEngine.js` cuenta 19 líneas: 18 propiedades reales `compute:` y el comentario `// compute:` de L611. | **Conteo textual con un falso positivo de comentario.** |
| 18 | Conteo estructural de claves de primer nivel entre `SIGNAL_REGISTRY = {` y su `};`. La auditoría previa `docs/equivalencia-pipelines-2026-08-01.md:14-25` coincide. | **Contrato exacto vigente.** |

Historial verificado:

- `git log --follow` muestra cuatro commits del archivo: `7cbbbf2`, `d577fa5`, `eaee4f1`, `cc8c598`.
- El censo sobre `git show 7cbbbf2:lib/scoringEngine.js` ya devuelve las mismas 18 claves.
- `git diff 7cbbbf2:lib/scoringEngine.js HEAD:lib/scoringEngine.js` no contiene ninguna adición/eliminación de una clave de primer nivel del registro.
- En el padre, las 19 funciones `score*` se descomponen en 18 fórmulas con correspondencia en el registro inicial y `scoreCompositeValue`; `compositeLabel` y `compositeNarrative` completan los 21 elementos contables. La lista se obtuvo del código histórico, no por coincidencia de cifras.
- Por tanto, **no hubo una señal eliminada del registro cuyo borrado explicase el 21**. Lo desactualizado son los comentarios numéricos, no el objeto.

### A.3 Composite y carácter diagnóstico

`COMPOSITE_WEIGHTS` tiene 12 términos y suma 1.00 (`lib/scoringEngine.js:633-646`). Solo 8 términos son claves literales del registro; los otros 4 son dependencias externas.

| Término del composite | Peso | ¿Clave del registro? | Origen |
|---|---:|---|---|
| `setupQualityScore` | 0.17 | sí | registro |
| `rsAnchor` | 0.16 | no | `rsGlobalPct`, fallback `rsRating` |
| `rsQualityScore` | 0.06 | no | `scoreRsQuality` |
| `demandScore` | 0.10 | sí | registro |
| `adProxyScore` | 0.08 | sí | registro |
| `growthScore` | 0.08 | sí | registro |
| `epsAnchor` | 0.08 | no | `epsGrowthProxyScore`, fallback `growthScore` |
| `sectorScore` | 0.10 | no | cálculo poblacional de grupo |
| `riskRewardScore` | 0.08 | sí | registro |
| `riskScore` | 0.05 | sí | registro |
| `momentumScore` | 0.02 | sí | registro |
| `ipoScore` | 0.02 | sí | registro |

`weaknessScore` es la única señal `direction: "negative"` y la única declarada expresamente diagnóstica y fuera del composite (`lib/scoringEngine.js:596-626`). `epsGrowthProxyScore` no entra por su propia clave, pero alimenta normalmente `epsAnchor` con peso 0.08 (`lib/screenerPipeline.js:333-336`; `lib/materializedScanner.js:437-439`). Otras señales no ponderadas directamente alimentan señales ponderadas: `objectiveSetupScore` y `patternContributionScore` alimentan `setupQualityScore`; `volumeScore`, `volumeEffectScore` y `liquidityScore` alimentan `demandScore`.

## PARTE B — Señales y métricas fuera del registro

### B.1 Candidatos conocidos

| Métrica | Dónde se calcula | Consumidores comprobados | Por qué no está en el registro |
|---|---|---|---|
| `rsGlobalPct` | `enrichRelativePercentiles`, `lib/relativeStrength.js:224-240`, especialmente L229-236. Se invoca desde `lib/screenerPipeline.js:313-314`, `lib/materializedScanner.js:418-419` y finalización global en `lib/scanPercentileFinalization.js:91-103`. | `rsAnchor` del composite (`screenerPipeline.js:330-336`, `materializedScanner.js:434-439`, finalización L121-160); `demandScore` y `weaknessScore` (`scoringEngine.js:452-474`, L86-126); contradicciones C1/C3 (`signalContradictions.js:93,114`); filtros y persistencia (`screenerFilters.js:628,739`; `scanDecisionProjection.js:35,153`). | Es un percentil dependiente del conjunto ordenado y de un tamaño mínimo de muestra. `computeSignal(row, key)` opera sobre una sola fila; no dispone del universo. |
| `rsCountryPct` | Mismo `enrichRelativePercentiles`, agrupado por país en `relativeStrength.js:203-221,238`. | Filtro `minRsCountryPct` (`screenerPipeline.js:266`; `screenerFilterCatalog.js:582`), fallback de `weaknessScore` (`scoringEngine.js:97`), ficha/review y persistencia (`app/review/page.jsx:419`; `scanDecisionProjection.js:37,154`). | Percentil poblacional por grupo/país, no fórmula pura de una fila. |
| `rsSectorPct` | Mismo `enrichRelativePercentiles`, agrupado por `theme || sector` en `relativeStrength.js:203-221,239`. | Fallback de `weaknessScore` y filtros (`scoringEngine.js:97`; `screenerFilters.js:64`), auditoría/explicabilidad (`decisionAudit.js:252`; `screenerExplainability.js:263,523`), evidencia metodológica (`screenerMethodologyEvidence.js:255-291`) y persistencia (`scanDecisionProjection.js:38,155`). | Percentil poblacional por grupo, no fórmula pura de una fila. |
| `technicalCoverageScore` | Dos copias de `dataCoverageForRow`: `lib/researchRow.js:77-164` (cálculo técnico L86-121) y `lib/materializedScanner.js:320-406` (L329-364). | Salud/decisión y explicabilidad (`decisionAudit.js:181-182,414-415`; `screenerDataHealth.js:196-197`; `screenerExplainability.js:350-351`), filtro (`screenerFilterCatalog.js:579`) y persistencia (`scanDecisionProjection.js:26,144`). | Mide presencia/frescura de datos, no una tesis bursátil; pertenece al contrato de calidad de la fila, no al motor de scoring. |
| `dataCoverageScore` | Las mismas dos funciones: fórmula ponderada en `researchRow.js:150` y `materializedScanner.js:392`. | Gate del cron (`materializedScanner.js:621`), filtros y health (`screenerFilterCatalog.js:578`; `screenerDataHealth.js:196`), decisión/explicabilidad (`decisionAudit.js:414`; `screenerExplainability.js:350`) y persistencia (`scanDecisionProjection.js:25,143`). | Es una métrica diagnóstica de completitud/frescura. No participa en `COMPOSITE_WEIGHTS` ni usa el contrato de cobertura por señal de `computeSignal`. |

### B.2 Dependencias del composite que tampoco son entradas

- `rsAnchor`: alias local, no métrica persistida independiente (`scoringEngine.js:51-55`; `screenerPipeline.js:330`; `materializedScanner.js:434`).
- `rsQualityScore`: se calcula canónicamente en `lib/relativeStrength.js:243-289` y entra al composite con 0.06.
- `sectorScore`: se calcula canónicamente por población/grupo en `lib/screenerComposite.js:93-128`, se inyecta en L147-159 y entra al composite con 0.10.
- `epsAnchor`: alias local `epsGrowthProxyScore ?? growthScore`, con 0.08 (`screenerPipeline.js:333`; `materializedScanner.js:437`).

Esto explica otra fuente de confusión: «estar en el composite» y «estar en `SIGNAL_REGISTRY`» no son conjuntos equivalentes. Hay 12 términos ponderados, 8 claves del registro ponderadas directamente y 4 términos externos.

### B.3 ¿Hay entradas huérfanas?

**No.** La búsqueda de invocaciones de `computeSignal(..., "clave")`/aliases canónicos confirma al menos un productor vivo para las 18 entradas:

- Builders interactivo y cron, ambos: `weinsteinScore`, `minerviniScore`, `momentumScore`, `riskScore`, `riskRewardScore`, `volumeEffectScore`, `volumeScore`, `liquidityScore`, `epsGrowthProxyScore`, `adProxyScore` (`researchRow.js:291-301`; `materializedScanner.js:580-589`).
- Ambos `sectorize`: `objectiveSetupScore`, `patternContributionScore`, `patternScore`, `setupQualityScore`, `demandScore`, `growthScore`; además vuelven a evaluar los overrides de EPS/AD (`screenerPipeline.js:319-328`; `materializedScanner.js:423-432`).
- `ipoScore`: sí lo consume el `sectorize` interactivo (`screenerPipeline.js:318`), pero **no** el cron. Es una divergencia de pipeline, no una señal huérfana.
- `weaknessScore`: builders y `sectorize` la consumen para valor/cobertura (`researchRow.js:313-318`; `materializedScanner.js:598-606`; `screenerPipeline.js:352-357`).
- La proyección de persistencia consume las 18 como campos en `lib/scanDecisionProjection.js:13-75`; snapshots/listas consumen las mismas familias en `lib/stockRows.js:7-74`.

## PARTE C — Implementaciones duplicadas

### C.1 `weaknessScore`: confirmado, dos implementaciones divergentes

Implementación canónica completa, `lib/scoringEngine.js:86-132`:

```js
export function scoreWeakness(r = {}) {
  let s = 0;
  const reasons = [];
  // Cadena de fallback unificada con lib/screenerFilters.js (metric(row, "rsPrimary")):
  // rsGlobalPct ?? rsRating ?? rsCountryPct ?? rsSectorPct ?? 50.
  // Antes este punto usaba rsPrimaryScore(r) que solo cubría rsGlobalPct ?? rsRating,
  // cayendo a 50 cuando ambos faltaban incluso si rsCountryPct/rsSectorPct estaban
  // presentes. Esa divergencia hacía que scoreWeakness devolviera scores distintos
  // según qué consumidor lo invocara (researchRow/screenerPipeline vía scoring.js vs
  // materializedScanner vía screenerFilters.js). Ver test `scoreWeakness · cadena de
  // fallback RS unificada con screenerFilters.js`.
  const rs = firstFinite(r.rsGlobalPct, r.rsRating, r.rsCountryPct, r.rsSectorPct) ?? 50;
  if (rs < 30) { s += 18; reasons.push("RS muy bajo"); }
  else if (rs < 45) { s += 13; reasons.push("RS bajo"); }
  else if (rs < 55) s += 6;
  if (Number.isFinite(r.price) && Number.isFinite(r.sma50) && r.price < r.sma50) { s += 12; reasons.push("bajo SMA50"); }
  if (Number.isFinite(r.price) && Number.isFinite(r.sma200) && r.price < r.sma200) { s += 18; reasons.push("bajo SMA200"); }
  if (Number.isFinite(r.sma200Slope) && r.sma200Slope < 0) { s += 12; reasons.push("SMA200 cae"); }
  if (Number.isFinite(r.sma50) && Number.isFinite(r.sma200) && r.sma50 < r.sma200) s += 7;
  if (Number.isFinite(r.perf3m) && r.perf3m < 0) { s += 8; reasons.push("3M negativo"); }
  if (Number.isFinite(r.perf6m) && r.perf6m < 0) s += 8;
  if (Number.isFinite(r.perf12m) && r.perf12m < 0) s += 8;
  if (Number.isFinite(r.distance52w)) {
    if (r.distance52w < -45) { s += 12; reasons.push("muy lejos de máximos"); }
    else if (r.distance52w < -30) { s += 8; reasons.push("lejos de máximos"); }
    else if (r.distance52w < -20) s += 4;
  }
  if (Number.isFinite(r.distance20d) && r.distance20d < -12) s += 5;
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d > 40) { s += 10; reasons.push("drawdown alto"); }
    else if (r.maxDrawdown63d > 28) s += 7;
  }
  if (Number.isFinite(r.upDownVolRatio)) {
    if (r.upDownVolRatio < .7) { s += 9; reasons.push("volumen vendedor"); }
    else if (r.upDownVolRatio < .9) s += 5;
  }
  if (r.upVolume === false && Number.isFinite(r.relativeVolume) && r.relativeVolume >= 1.15) { s += 7; reasons.push("caída con volumen"); }
  if (Number.isFinite(r.riskScore) && r.riskScore < 35) s += 7;
  if (Number.isFinite(r.extSma50) && r.extSma50 < -12) s += 5;
  if (Number.isFinite(r.speculationRiskScore) && r.speculationRiskScore >= 70) s += 4;
  const weaknessScore = Math.max(0, Math.min(100, s));
  return {
    weaknessScore,
    weaknessLabel: weaknessScore >= 78 ? "Deterioro severo" : weaknessScore >= 65 ? "Deterioro alto" : weaknessScore >= 50 ? "Deterioro visible" : weaknessScore >= 35 ? "Debilidad mixta" : "Sin deterioro claro",
    weaknessReasons: reasons.length ? reasons.slice(0, 4) : ["Sin evidencia fuerte"],
  };
}
```

Implementación paralela completa, `lib/stockRows.js:252-269`:

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

**Conclusión:** producen resultados distintos cuando el snapshot no trae un `weaknessScore` directo. Los umbrales de RS ya bastan para demostrarlo estáticamente: con `rsGlobalPct=20` y sin otros campos, la canónica suma 18 (`scoringEngine.js:98`) y la paralela suma 16 (`stockRows.js:263`). La paralela además omite SMA/precios, pendiente SMA200, rendimientos 6M/12M, drawdown, firma de volumen y riesgo especulativo. No se consiguió ejecutar el pequeño contraste importando ambos módulos directamente porque el loader local falló al resolver `app/components/ui/MetricSource`; la divergencia queda cerrada por lectura literal de ambos cuerpos, no por esa ejecución fallida.

Uso por pipeline/superficie:

- `researchRow` y el builder del cron ensamblan el valor con la canónica `scoreWeakness` (`researchRow.js:313-318`; `materializedScanner.js:598-606`).
- `screenerPipeline.sectorize` vuelve a usar la canónica tras percentiles (`screenerPipeline.js:352-357`).
- `stockRows.weaknessScore` se usa en normalización, orden/filtro y snapshots (`stockRows.js:275-302,402-423`); lo importan market-health, sectores, listas, `grouping` y `listRationale`. `leaderboards.js:7` entra indirectamente por `isLongOpportunityRow`.
- Si la fila ya contiene el valor canónico persistido, `stockRows` lo devuelve sin recalcular (`stockRows.js:253-254`). El riesgo aparece en filas/snapshots sin ese campo, o con un valor directo que no corresponda al cálculo vigente.

### C.2 Resto de duplicados o aparentes duplicados

| Métrica/patrón | Sitios | ¿Mismo resultado? | Conclusión |
|---|---|---|---|
| `technicalCoverageScore` / `dataCoverageScore` | `researchRow.js:77-164` y `materializedScanner.js:320-406` | `technicalCoverageScore` usa la misma lista y fórmula. `dataCoverageScore` **puede divergir**: la copia interactiva incluye `ebitdaMargin` (`researchRow.js:140`) y la del cron no; el diff literal de ambas funciones solo muestra esa diferencia numérica y una tilde cosmética en el texto del issue. | Duplicado de producción real. La diferencia de `ebitdaMargin` altera `fundamentalCoverageScore` y por tanto puede alterar `dataCoverageScore`. |
| `rsQualityScore` | Canónica del screener `relativeStrength.js:243-289`; company brief `app/api/company-brief/route.js:276-345,858-898` | **No en general.** Screener: `rs*.62 + stability*.28 + riskReward*.10` (L275). Company brief: `rating*.68 + stability*.32` (route L326/L878), sin el término risk/reward y con una estabilidad construida en otra ruta. | Mismo nombre de campo, fórmulas de superficie distintas. No es una segunda implementación del registro porque `rsQualityScore` está fuera de él, pero sí es duplicidad semántica. |
| `sectorScore` | Wrappers `screenerPipeline.js:304-314` y `materializedScanner.js:409-419` | Para **el mismo array de entrada**, sí: ambos delegan en `computeSectorScoresForRows`/`applySectorScores`, única fórmula en `screenerComposite.js:93-159`. En operación pueden diferir porque el interactivo/finalización usa población completa y el cron aún trabaja por lote (`screenerComposite.js:44-58`). | Ya no hay dos fórmulas de `sectorScore`; queda duplicada la orquestación/contexto. |
| Composite (`totalScore`/`objectiveScore`) | Motor `scoringEngine.js:633-646,764-827`; espejo de auditoría `objectiveMetricTruth.js:98-110,447-469` | Con los 12 valores como números finitos, pesos y suma coinciden. Con ausencias o strings coercibles, **no**: el motor excluye y renormaliza términos no finitos; el auditor devuelve `null` si falta cualquier término y su helper `finite` admite strings numéricos. | Duplicado intencional de auditoría, no segundo productor. La política de dato ausente no es equivalente. |
| `objectiveScore` frente a `compositeScore` en finalización | `screenerPipeline.js:335-336` frente a `scanPercentileFinalization.js:120-161` | **No conserva la distinción.** El pipeline usa `objectiveSetupScore` para el objetivo y `setupQualityScore` para el composite; finalización pasa el mismo `setupQualityScore` a ambas llamadas, por lo que allí quedan iguales por construcción. | Divergencia de orquestación ya señalada por `docs/equivalencia-pipelines-2026-08-01.md:125-154`; sigue presente en código vivo. |
| Fórmulas golden | `tests/_golden_snapshot_scoring.js` frente al engine | Las 17 señales positivas se comparan mediante aserciones numéricas en `signalRegistryAudit.test.js:603-660`; la selección ejecutada pasó. `growthScore` sin datos conserva deliberadamente un 45 en el snapshot viejo mientras el engine devuelve `null` (`scoringEngine.test.js:272-278`). | Duplicado de test/oráculo, no de producción. La divergencia conocida está afirmada explícitamente. |

No se clasifican como duplicado de señal:

- `monthsSince`/edad IPO aparece en varios módulos, pero es un helper temporal; la única fórmula de `ipoScore` está en el registro.
- `scoreRelativeStrength` y `relativeStrengthFromBars` ensamblan superficies diferentes, pero ambas delegan el modelo base en `scoreRsBenchmarkModel`; `rsGlobalPct` solo se calcula como percentil en `enrichRelativePercentiles`.
- Los scripts `refactor-check/before.mjs` y `tests/_golden_snapshot_scoring.js` son fixtures/oráculos, no productores vivos.

## PARTE D — Contrato por señal

Abreviaturas de consumidores:

- **Builders**: interactivo `researchRow.js:291-318`; cron `materializedScanner.js:580-606`.
- **Sectorizers**: interactivo `screenerPipeline.js:318-357`; cron `materializedScanner.js:423-465`.
- **Persistencia**: `scanDecisionProjection.js:13-75`.
- **G**: aserción numérica contra snapshot independiente para las 17 positivas, `signalRegistryAudit.test.js:603-660`.
- **W**: aserción numérica específica de debilidad, `scoringEngine.test.js:956-962` (y casos 6/100 en `scoring.test.js:29-61`).

| Clave | Implementación canónica | Composite | Consumidores comprobados | Test unitario con aserción |
|---|---|---|---|---|
| `weinsteinScore` | `scoringEngine.js:166-176` | No directo; aporta líderes a `sectorScore` | Builders; `screenerComposite.js:75-104`; contradicción C6; persistencia | Sí — G |
| `minerviniScore` | `scoringEngine.js:182-195` | No directo; aporta líderes a `sectorScore` | Builders; `screenerComposite.js:75-104`; contradicción C6; persistencia | Sí — G |
| `momentumScore` | `scoringEngine.js:201-213` | Sí, 0.02 | Builders; composite; contradicciones C1/C5; persistencia | Sí — G |
| `riskScore` | `scoringEngine.js:219-232` | Sí, 0.05 | Builders; composite; input de `weaknessScore`; persistencia | Sí — G |
| `riskRewardScore` | `scoringEngine.js:238-268` | Sí, 0.08 | Builders; composite; `scoreRsQuality`; contradicción C4; persistencia | Sí — G |
| `volumeEffectScore` | `scoringEngine.js:274-295` | No directo; alimenta `volumeScore`/`demandScore` | Builders; `scoringEngine.js:318,462`; UI/filtros; persistencia | Sí — G |
| `volumeScore` | `scoringEngine.js:301-320` | No directo; alimenta `demandScore` | Builders; `scoringEngine.js:461`; persistencia | Sí — G |
| `liquidityScore` | `scoringEngine.js:326-340` | No directo; alimenta `demandScore` | Builders; `scoringEngine.js:463`; contradicción C5; `scoreRsQuality`; persistencia | Sí — G |
| `ipoScore` | `scoringEngine.js:346-367` | Sí, 0.02 | Sectorizer interactivo; composite/filtros/listas; persistencia. Ausente del sectorizer cron | Sí — G |
| `objectiveSetupScore` | `scoringEngine.js:376-396` | No por su clave; sustituye `setupQualityScore` en `objectiveScore` | Ambos sectorizers; `setupQualityScore`; objective composite; persistencia | Sí — G |
| `patternContributionScore` | `scoringEngine.js:149-153,398-420` | No directo; alimenta setup | Ambos sectorizers; `patternScore`/`setupQualityScore`; persistencia | Sí — G y tests específicos L692-909 |
| `patternScore` | `scoringEngine.js:426-431` | No | Ambos sectorizers; UI/persistencia | Sí — G |
| `setupQualityScore` | `scoringEngine.js:437-448` | Sí, 0.17 | Ambos sectorizers; composite; contradicciones C2/C3/C4; persistencia | Sí — G |
| `demandScore` | `scoringEngine.js:454-474` | Sí, 0.10 | Ambos sectorizers; composite; persistencia | Sí — G |
| `growthScore` | `scoringEngine.js:494-529` | Sí, 0.08; además fallback de `epsAnchor` | Ambos sectorizers; composite/explicabilidad; persistencia | Sí — G y casos de ausencia/parcial L264-278,389-449 |
| `epsGrowthProxyScore` | `scoringEngine.js:546-570` | Indirecto: `epsAnchor`, 0.08 | Builders y ambos sectorizers; composite/UI/filtros; persistencia | Sí — G |
| `adProxyScore` | `scoringEngine.js:576-594` | Sí, 0.08 | Builders y ambos sectorizers; composite; contradicción C2; persistencia | Sí — G |
| `weaknessScore` | `scoringEngine.js:86-132,615-626` | **No; diagnóstica negativa** | Builders/sectorizers; C6; filtros/decisión; persistencia; superficies `stockRows` mediante implementación paralela | Sí — W |

### D.1 Cobertura ejecutada

Primera ejecución, bloqueada antes de cargar tests por el `node_modules` enlazado fuera del área escribible:

```text
failed to load config from /Users/alejandrofrutos1204/nightly-worktrees/contrato-senales-20260804-104258/vitest.config.mjs

⎯⎯⎯⎯⎯⎯⎯ Startup Error ⎯⎯⎯⎯⎯⎯⎯⎯
Error: EPERM: operation not permitted, open '/Users/alejandrofrutos1204/nightly-worktrees/contrato-senales-20260804-104258/node_modules/.vite-temp/vitest.config.mjs.timestamp-1785833427233-f04dfd21f5f3f8.mjs'
```

Se repitió usando el loader `runner`, que no crea ese bundle dentro del symlink. Salida literal de las cuatro suites de scoring:

```text
 RUN  v4.1.8 /Users/alejandrofrutos1204/nightly-worktrees/contrato-senales-20260804-104258


 Test Files  4 passed (4)
      Tests  313 passed (313)
   Start at  10:50:46
   Duration  910ms (transform 922ms, setup 0ms, import 1.46s, tests 155ms, environment 0ms)
```

Selección literal que ejecuta una aserción numérica por cada clave (17 golden + `weaknessScore`):

```text
 RUN  v4.1.8 /Users/alejandrofrutos1204/nightly-worktrees/contrato-senales-20260804-104258

 ✓ tests/scoringEngine.test.js > scoringEngine · weaknessScore (registro diagnósticas) > computeSignal con fila completa → coverage=1.0, value === scoreWeakness(row).weaknessScore 2ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(weinsteinScore) === snapshot(weinsteinScore) en fila completa 1ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(minerviniScore) === snapshot(minerviniScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(momentumScore) === snapshot(momentumScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(riskScore) === snapshot(riskScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(riskRewardScore) === snapshot(riskRewardScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(volumeEffectScore) === snapshot(volumeEffectScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(volumeScore) === snapshot(volumeScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(liquidityScore) === snapshot(liquidityScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(ipoScore) === snapshot(ipoScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(objectiveSetupScore) === snapshot(objectiveSetupScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(patternScore) === snapshot(patternScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(patternContributionScore) === snapshot(patternContributionScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(setupQualityScore) === snapshot(setupQualityScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(demandScore) === snapshot(demandScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(growthScore) === snapshot(growthScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(epsGrowthProxyScore) === snapshot(epsGrowthProxyScore) en fila completa 0ms
 ✓ tests/signalRegistryAudit.test.js > audit · equivalencia vs golden snapshot (referencia independiente) > computeSignal(adProxyScore) === snapshot(adProxyScore) en fila completa 0ms

 Test Files  2 passed (2)
      Tests  18 passed | 263 skipped (281)
   Start at  10:51:13
   Duration  779ms (transform 513ms, setup 0ms, import 803ms, tests 7ms, environment 0ms)
```

### D.2 Señales sin cobertura de test

**Ninguna de las 18 entradas del registro carece de una aserción numérica.** Esto significa «al menos un caso numérico afirmado», no cobertura exhaustiva de todas las ramas/umbrales.

Riesgos de cobertura que quedan fuera de esa respuesta binaria:

1. `lib/stockRows.js:252-269` es una implementación paralela divergente de `weaknessScore` y la búsqueda en tests unitarios no encontró ninguna importación/aserción directa sobre ese helper.
2. El golden replica fórmulas; protege regresión respecto a esa copia, pero no sustituye tests de propiedades/umbrales para cada rama.
3. Las métricas externas (`rs*Pct`, coberturas, `sectorScore`, `rsQualityScore`) no forman parte de las 18 filas del contrato y requieren sus suites propias; no se afirma aquí haberlas ejecutado.

## COMANDOS EJECUTADOS

Todos se ejecutaron desde `/Users/alejandrofrutos1204/nightly-worktrees/contrato-senales-20260804-104258`. `rg` no estaba instalado; después de comprobarlo se usaron `grep`/`find`.

### Preflight y localización

```sh
pwd
git status --short --branch
sed -n '1,260p' AGENTS.md
wc -l AGENTS.md
sed -n '261,520p' AGENTS.md
wc -l lib/scoringEngine.js docs/equivalencia-pipelines-2026-08-01.md lib/stockRows.js
grep -nE "SIGNAL_REGISTRY|COMPOSITE_WEIGHTS|compute:|21|weaknessScore" lib/scoringEngine.js
find tests -type f -maxdepth 3 | sort | grep -Ei "scor|signal|stockRows|screener|technical|coverage|relative|rs"
grep -nE "weaknessScore|scoringEngine|stockRows|duplicate|duplic|diverg" docs/equivalencia-pipelines-2026-08-01.md
find . -path './node_modules' -prune -o -type f \( -name '*.task' -o -path '*/.task/*' -o -name '*task*' \) -print | sort
test ! -e docs/contrato-senales-2026-08-03.md
```

### Censo y código numerado

```sh
nl -ba lib/scoringEngine.js | sed -n '1,360p'
nl -ba lib/scoringEngine.js | sed -n '361,700p'
nl -ba lib/scoringEngine.js | sed -n '701,861p'
nl -ba lib/scoringEngine.js | sed -n '160,269p'
nl -ba lib/scoringEngine.js | sed -n '270,321p'
nl -ba lib/scoringEngine.js | sed -n '320,475p'
nl -ba lib/scoringEngine.js | sed -n '476,646p'
awk '/export const SIGNAL_REGISTRY =/{inreg=1; next} inreg && /^};/{exit} inreg && /^  [A-Za-z0-9_]+: \{$/{line=$0; sub(/^  /,"",line); sub(/: \{$/,"",line); printf "%d\t%s\n", NR, line; count++} END{printf "TOTAL\t%d\n", count}' lib/scoringEngine.js
awk '/export const COMPOSITE_WEIGHTS = \[/{inweights=1; next} inweights && /^\];/{exit} inweights && /key:/{print NR "\t" $0; count++; if ($0 ~ /key: "(weinsteinScore|minerviniScore|momentumScore|riskScore|riskRewardScore|volumeEffectScore|volumeScore|liquidityScore|ipoScore|objectiveSetupScore|patternContributionScore|patternScore|setupQualityScore|demandScore|growthScore|epsGrowthProxyScore|adProxyScore|weaknessScore)"/) registry++} END{printf "TOTAL_WEIGHTS\t%d\nREGISTRY_KEYS_IN_WEIGHTS\t%d\n", count, registry}' lib/scoringEngine.js
grep -c "compute:" lib/scoringEngine.js
grep -n "compute:" lib/scoringEngine.js
awk '/export const SIGNAL_REGISTRY =/{inreg=1; next} inreg && /^};/{exit} inreg && /^    direction: "positive"/{positive++} inreg && /^    direction: "negative"/{negative++} END{printf "positive=%d\nnegative=%d\ntotal=%d\n", positive, negative, positive+negative}' lib/scoringEngine.js
awk '/export const COMPOSITE_WEIGHTS = \[/{inweights=1; next} inweights && /^\];/{exit} inweights && /weight:/{line=$0; sub(/^.*weight: /,"",line); sub(/[^0-9.].*$/,"",line); sum+=line; count++} END{printf "entries=%d\nsum=%.2f\n", count, sum}' lib/scoringEngine.js
```

También se ejecutaron estas dos primeras variantes fallidas. La primera contó la palabra `direction` dentro de comentarios y produjo el falso `17/2/19`; la segunda falló porque el `awk` de macOS no admite ese tercer argumento de `match`. Sus resultados se descartaron y se sustituyeron por los dos comandos exactos anteriores.

```sh
awk '/export const SIGNAL_REGISTRY =/{inreg=1; next} inreg && /^};/{exit} inreg && /direction: "positive"/{positive++} inreg && /direction: "negative"/{negative++} END{printf "positive=%d\nnegative=%d\ntotal=%d\n", positive, negative, positive+negative}' lib/scoringEngine.js
awk '/export const COMPOSITE_WEIGHTS = \[/{inweights=1; next} inweights && /^\];/{exit} inweights && /weight:/{match($0,/weight: ([0-9.]+)/,m); sum+=m[1]; count++} END{printf "entries=%d\nsum=%.2f\n", count, sum}' lib/scoringEngine.js
```

### Historial y explicación de cifras

```sh
git --no-pager log --follow --format='%h %ad %s' --date=short -- lib/scoringEngine.js
git --no-pager log -S'Comparación byte-a-byte de las 21 fórmulas' --format='%h %ad %s' --date=short -p -- lib/scoringEngine.js
git --no-pager log -S'weaknessScore: {' --format='%h %ad %s' --date=short -p -- lib/scoringEngine.js
git show 7cbbbf2:lib/scoringEngine.js | awk '/export const SIGNAL_REGISTRY =/{inreg=1; next} inreg && /^};/{exit} inreg && /^  [A-Za-z0-9_]+: \{$/{line=$0; sub(/^  /,"",line); sub(/: \{$/,"",line); print line; count++} END{print "TOTAL", count}'
git --no-pager diff 7cbbbf2:lib/scoringEngine.js HEAD:lib/scoringEngine.js | grep -E '^[-+]  [A-Za-z0-9_]+: \{$'
git --no-pager show --stat --oneline 7cbbbf2
git ls-tree -r --name-only 7cbbbf2^ | grep -E '^lib/(scoring|materializedScanner)\.js$'
git show 7cbbbf2^:lib/scoring.js | grep -nE '^(export )?function score|^export const score|^const score|^function score'
git show 7cbbbf2^:lib/materializedScanner.js | grep -nE '^(export )?function score|^export const score|^const score|^function score'
git show 7cbbbf2^:lib/scoring.js | grep -cE '^(export )?function score|^export const score|^const score|^function score'
git show 7cbbbf2^:lib/materializedScanner.js | grep -cE '^(export )?function score|^export const score|^const score|^function score'
git show 7cbbbf2^:lib/scoring.js | grep -nE '^(export )?function |^export const [A-Za-z0-9_]+ *= *\('
git show 7cbbbf2^:lib/materializedScanner.js | grep -nE '^(export )?function |^export const [A-Za-z0-9_]+ *= *\('
git show 7cbbbf2^:lib/scoring.js | grep -nA80 '^export {'
git show 7cbbbf2^:lib/scoring.js | grep -nE '^(export )?function |^export const [A-Za-z0-9_]+ *= *\(' && git show 7cbbbf2^:lib/scoring.js | grep -nE '^(export )?function score|^export const score|^const score|^function score' && git show 7cbbbf2:lib/scoringEngine.js | awk '/export const SIGNAL_REGISTRY =/{inreg=1; next} inreg && /^};/{exit} inreg && /^  [A-Za-z0-9_]+: \{$/{line=$0; sub(/^  /,"",line); sub(/: \{$/,"",line); print line}'
find . -path './node_modules' -prune -o -path './.next' -prune -o -type f -print0 | xargs -0 grep -nEi "20 señales|21 fórmulas|18 claves|contrato para las 20|SIGNAL_REGISTRY"
nl -ba tests/favoriteSnapshotAmpliado.test.js | sed -n '1,90p'
nl -ba lib/scoring.js | sed -n '1,55p'
nl -ba lib/signalContradictions.js | sed -n '1,40p'
git --no-pager log -S'20 señales' --format='%h %ad %s' --date=short -p -- tests/favoriteSnapshotAmpliado.test.js lib/signalContradictions.js
```

El comando `git diff ... | grep ...` terminó con código 1 y salida vacía: para `grep`, eso significa que no hubo ninguna línea de clave añadida/eliminada que coincidiera.

### Consumidores, métricas externas y duplicados

```sh
nl -ba lib/relativeStrength.js | sed -n '1,280p'
nl -ba lib/relativeStrength.js | sed -n '224,315p'
nl -ba lib/dataCoverageShared.js | sed -n '1,260p'
nl -ba lib/researchRow.js | sed -n '60,175p'
nl -ba lib/materializedScanner.js | sed -n '305,410p'
nl -ba lib/researchRow.js | sed -n '255,325p'
nl -ba lib/materializedScanner.js | sed -n '409,450p;565,605p'
nl -ba lib/materializedScanner.js | sed -n '598,612p'
nl -ba lib/screenerPipeline.js | sed -n '300,345p'
nl -ba lib/stockRows.js | sed -n '225,285p'
nl -ba lib/stockRows.js | sed -n '271,325p;395,425p'; nl -ba lib/leaderboards.js | sed -n '1,18p;550,580p'
nl -ba tests/_audit_contract.js | sed -n '35,170p'
nl -ba tests/_audit_contract.js | sed -n '145,180p'
nl -ba lib/scanPercentileFinalization.js | sed -n '80,180p'
nl -ba app/api/company-brief/route.js | sed -n '270,345p;810,900p'
nl -ba lib/screenerComposite.js | sed -n '1,175p'
nl -ba lib/objectiveMetricTruth.js | sed -n '85,115p;430,510p'
nl -ba lib/scanDecisionProjection.js | sed -n '1,175p'
nl -ba lib/researchRowContract.js | sed -n '1,70p'
nl -ba lib/stockRows.js | sed -n '1,75p'
diff -u <(sed -n '77,165p' lib/researchRow.js) <(sed -n '320,407p' lib/materializedScanner.js)
grep -RhoE '^(export )?(async )?function [A-Za-z0-9_]+' lib app --include='*.js' --include='*.jsx' | sed -E 's/^(export )?(async )?function //' | sort | uniq -d
grep -RInE '^(export )?(async )?function (dataCoverageForRow|priceFreshnessForDate|coveragePct|monthsSince|ipoAgeMonthsForRow|sectorize|scoreWeakness|weaknessScore|scoreCompositeValue|computeComposite|scoreRsQuality|enrichRelativePercentiles)' lib app --include='*.js' --include='*.jsx'
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next -E 'const (dataCoverageScore|technicalCoverageScore|rsGlobalPct|rsCountryPct|rsSectorPct|rsQualityScore|sectorScore|objectiveScore|compositeScore|weaknessScore) *=' lib app --include='*.js' --include='*.jsx' | sed -n '1,300p'
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next -E 'enrichRelativePercentiles|scoreRsQuality|computeSectorScoresForRows|applySectorScores' lib | sed -n '1,240p'
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next -E 'dataCoverageForRow|coverageForRow|technicalCoverageScore|dataCoverageScore' lib | sed -n '1,260p'
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next -E 'import .*weaknessScore|weaknessScore\(' app lib scripts tests | sed -n '1,260p'
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next -E 'from "@/lib/stockRows"|from '\''@/lib/stockRows'\''' app lib scripts tests | sed -n '1,260p'
grep -RIn --exclude-dir=e2e -E 'import .*weaknessScore.*stockRows|weaknessScore\(' tests --include='*.test.js' --include='*.test.mjs' | sed -n '1,240p'
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next 'rsCountryPct' app lib --include='*.js' --include='*.jsx' | sed -n '1,220p'
```

También se ejecutaron búsquedas literales por cada una de las 18 claves y por cada candidato externo sobre `app lib scripts tests`, y una búsqueda de archivos por clave. La forma reproducible compacta usada para el inventario de consumidores fue:

```sh
for key in weinsteinScore minerviniScore momentumScore riskScore riskRewardScore volumeEffectScore volumeScore liquidityScore ipoScore objectiveSetupScore patternContributionScore patternScore setupQualityScore demandScore growthScore epsGrowthProxyScore adProxyScore weaknessScore; do printf '%s\t' "$key"; grep -RIl --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.next "$key" app lib | tr '\n' ','; printf '\n'; done
```

### Tests

```sh
npx vitest run tests/scoring.test.js tests/scoringEngine.test.js tests/signalRegistryAudit.test.js tests/signalCoverage.test.js
npx vitest --help --expand-help
grep -RIn --exclude='*.map' 'vite-temp\|configLoader' node_modules/vite node_modules/vitest | sed -n '1,220p'
npx vitest run --configLoader runner tests/scoring.test.js tests/scoringEngine.test.js tests/signalRegistryAudit.test.js tests/signalCoverage.test.js
grep -nE '^[[:space:]]*(describe|it|test)\(' tests/scoringEngine.test.js
grep -nE '^[[:space:]]*(describe|it|test)\(' tests/scoring.test.js tests/signalRegistryAudit.test.js tests/signalCoverage.test.js
nl -ba tests/scoringEngine.test.js | sed -n '180,285p'
nl -ba tests/signalRegistryAudit.test.js | sed -n '590,675p'
npx vitest run --configLoader runner --reporter verbose tests/signalRegistryAudit.test.js tests/scoringEngine.test.js -t 'computeSignal\(.*\) === snapshot|computeSignal con fila completa'
npx vitest run --configLoader runner --reporter verbose --hideSkippedTests tests/signalRegistryAudit.test.js tests/scoringEngine.test.js -t 'computeSignal\(.*\) === snapshot|computeSignal con fila completa'
```

Intento diagnóstico adicional, ejecutado pero no usado como evidencia porque falló la resolución de módulos:

```sh
node --loader ./scripts/loader.mjs --input-type=module -e 'import { scoreWeakness } from "@/lib/scoringEngine"; import { weaknessScore } from "@/lib/stockRows"; const row = { rsGlobalPct: 20 }; console.log(JSON.stringify({ canonical: scoreWeakness(row).weaknessScore, stockRows: weaknessScore(row) }));'
npx vite-node --help
```

`npx vite-node --help` quedó bloqueado sin salida útil y se interrumpió manualmente; no se usa como evidencia.

### Verificación del entregable

```sh
wc -l docs/contrato-senales-2026-08-03.md && sed -n '1,240p' docs/contrato-senales-2026-08-03.md && git --no-pager diff -- docs/contrato-senales-2026-08-03.md && git status --short
sed -n '241,520p' docs/contrato-senales-2026-08-03.md
awk -F'`' '/^\| [0-9]+ \| `[^`]+` \| `lib\/scoringEngine\.js:/{print $2}' docs/contrato-senales-2026-08-03.md
git --no-pager diff --no-index -- /dev/null docs/contrato-senales-2026-08-03.md
git status --short
```

No se ejecutó `npm run test:e2e`, ningún test de integración, SQL ni acceso a base de datos.

## CONFIANZA

### Verificado leyendo código e historial

- Censo exacto de 18 entradas, sus claves, direcciones, fórmulas y pesos.
- 12 términos del composite, de los que 8 son claves literales del registro y 4 son dependencias externas.
- El registro nació con 18 claves y no perdió ninguna desde `7cbbbf2`.
- Origen concreto del 19 textual y del 20 del test de snapshots.
- Productores/consumidores de las 18 entradas; no hay huérfanas.
- Doble implementación divergente de `weaknessScore`.
- Duplicación y diferencia de `dataCoverageForRow`, fórmula distinta de `rsQualityScore` en company brief, consolidación canónica de `sectorScore` y diferencia de política del espejo de composite.

### Verificado ejecutando

- Suite seleccionada: 4 archivos, 313 tests, todos aprobados con `--configLoader runner`.
- Selección explícita por señal: 18 aserciones numéricas aprobadas.
- La ejecución sin `configLoader runner` no llegó a tests por `EPERM` en `.vite-temp`; no se interpretó como fallo de código.

### Inferido o no cerrable con este checkout

- No se puede identificar con certeza qué contó el autor del comentario «21 fórmulas»; la hipótesis 19 `score*` + 2 helpers no demuestra una comparación entre ambos pipelines.
- No se puede inspeccionar el `.task` de julio porque no está presente.
- No se midió cobertura de ramas; «cubierta» significa que existe y pasó al menos una aserción numérica sobre el valor.
- No se ejecutaron suites propias de métricas externas ni se validó comportamiento con base de datos.
