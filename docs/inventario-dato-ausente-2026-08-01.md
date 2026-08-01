# Inventario de tratamiento de dato ausente — 2026-08-01

## Alcance y criterio de inclusión

Auditoría estática de `lib/` y `app/` en la rama `codex/statsedge-ui-polish`, HEAD `d29c82cfab9195de4f9c7b8641464b3c32bfb171` (`BASE_SHA` abreviado: `d29c82c`). Se inventariaron las coincidencias que afectan una métrica financiera, score, percentil, elegibilidad, clasificación o mensaje de rechazo. Las coincidencias puramente técnicas de fechas, coordenadas de chart, punteros, timeouts, tamaños de arrays, contadores administrativos o placeholders de render se conservaron en la salida amplia de `grep`, pero no se presentan como defectos del dominio porque no evalúan un criterio financiero.

Clasificación usada:

- `RECHAZA-POR-AUSENTE`: la ausencia hace fallar elegibilidad, filtro, gate o construcción de la fila.
- `FABRICA-VALOR`: la ausencia se sustituye por un número que participa en un score, percentil, ranking, bucket, tono o comparación.
- `NEUTRO`: la ausencia se omite o se conserva como no evaluable; no rechaza ni inventa una observación.

La columna **balanced** usa exclusivamente `QUALITY_DEFAULTS` de `lib/screenerFilterCatalog.js:103-165` y la expansión del preset en `:168`. `Sí directo` significa umbral activo en ese preset; `Sí upstream` significa gate previo que afecta a las filas disponibles para cualquier preset; `No` significa que el umbral/modo queda inactivo en `balanced`; `N/A` significa que no es un criterio del preset.

## CRÍTICO — afecta al preset activo o a su población y puede vaciar resultados

| ID | archivo:línea | Cita literal | Métrica | Clasificación | balanced | Justificación |
|---|---|---|---|---|---|---|
| C01 | `lib/trendStructure.js:51` | `if (![price, sma50, sma150, sma200, slope].every(Number.isFinite)) return false;` | precio, SMA50/150/200, pendiente SMA200 | RECHAZA-POR-AUSENTE | Sí directo (`requireStage2: true`) | La ausencia hace que la confirmación diaria sea falsa; sin confirmación semanal útil, `stage2RejectDetail` devuelve rechazo. |
| C02 | `lib/screenerFilters.js:105` | `if (!Number.isFinite(parsed)) return { days: null, ok: false };` | fecha/precio fresco | RECHAZA-POR-AUSENTE | Sí directo (`maxPriceFreshnessDays`) | El `ok:false` desemboca en el rechazo de `:704-705`. |
| C03 | `lib/screenerFilters.js:731` | `if (!Number.isFinite(value)) return reject(field, \`${rule.label} sin dato\`);` | las métricas de `FIELD_RULES` | RECHAZA-POR-AUSENTE | Sí directo para 26 reglas | En `balanced` están activos precio, market cap, volumen/turnover, tres métricas de volumen, 3M/6M/12M, spread/extensión, cinco métricas de rango/riesgo, tres de rentabilidad-riesgo, dos coberturas y Weinstein/Minervini/momentum/risk. Cada ausencia produce rechazo inmediato. |
| C04 | `lib/screenerFilters.js:740` | `if (!Number.isFinite(rs) \|\| rs < minRsRating) return reject("minRsRating", \`RS universo ${Number.isFinite(rs) ? rs.toFixed(0) : "sin dato"} < ${minRsRating}\`);` | `rsGlobalPct` | RECHAZA-POR-AUSENTE | Sí directo (`minRsRating: 50`) | Con muestra global insuficiente el percentil es `null`; toda fila falla este criterio. |
| C05 | `lib/screenerFilters.js:747` | `if (!Number.isFinite(value)) return reject(field, \`${rule.label} sin dato\`);` | `distance20d`, `distance50d`, `distance52w`, `distanceATH` | RECHAZA-POR-AUSENTE | Sí directo, las cuatro | Los cuatro máximos de distancia tienen umbral finito menor que `999` en `balanced`. |
| C06 | `lib/relativeStrength.js:181` | `const p3 = Number.isFinite(row.perf3m) ? row.perf3m : 0;` | `perf3m` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | Fabrica `0` antes del percentil global. |
| C07 | `lib/relativeStrength.js:182` | `const p6 = Number.isFinite(row.perf6m) ? row.perf6m : 0;` | `perf6m` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | Igual que C06. |
| C08 | `lib/relativeStrength.js:183` | `const p12 = Number.isFinite(row.perf12m) ? row.perf12m : 0;` | `perf12m` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | Igual que C06. |
| C09 | `lib/relativeStrength.js:184` | `const rs3 = Number.isFinite(row.rs3m) ? row.rs3m : 0;` | `rs3m` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | Igual que C06. |
| C10 | `lib/relativeStrength.js:185` | `const rs6 = Number.isFinite(row.rs6m) ? row.rs6m : 0;` | `rs6m` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | Igual que C06. |
| C11 | `lib/relativeStrength.js:186` | `const rs12 = Number.isFinite(row.rs12m) ? row.rs12m : 0;` | `rs12m` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | Igual que C06. |
| C12 | `lib/relativeStrength.js:187` | `const nearHigh = Number.isFinite(row.distance52w) ? row.distance52w : -50;` | `distance52w` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | La ausencia se convierte en una distancia fuertemente negativa. |
| C13 | `lib/relativeStrength.js:188` | `const drawdown = Number.isFinite(row.maxDrawdown63d) ? row.maxDrawdown63d : 25;` | `maxDrawdown63d` en `rsCompositeRaw` | FABRICA-VALOR | Sí, alimenta `minRsRating` | La ausencia se convierte en drawdown `25`. |
| C14 | `lib/materializedScanner.js:615` | `if (!Number.isFinite(row.price) \|\| row.price <= 0) return "precio no disponible";` | precio | RECHAZA-POR-AUSENTE | Sí upstream | Gate previo común a la materialización. |
| C15 | `lib/materializedScanner.js:616` | `if (!Number.isFinite(row.chartBarsCount) \|\| row.chartBarsCount < minBars) return \`historico insuficiente ${row.chartBarsCount \|\| 0}/${minBars}\`;` | número de barras | RECHAZA-POR-AUSENTE | Sí upstream | Ausente rechaza y además se muestra como `0`. |
| C16 | `lib/materializedScanner.js:619` | `if (Number.isFinite(minAvgTurnover) && (row.avgTurnover \|\| 0) < minAvgTurnover) return \`importe medio bajo ${Math.round(row.avgTurnover \|\| 0)}\`;` | turnover medio | RECHAZA-POR-AUSENTE | Sí upstream | El default de materialización es `250000`; ausente se compara como `0`. |
| C17 | `lib/materializedScanner.js:621` | `if (Number.isFinite(minCoverageScore) && (row.dataCoverageScore \|\| 0) < minCoverageScore) return \`cobertura baja ${row.dataCoverageScore \|\| 0}\`;` | cobertura de datos | RECHAZA-POR-AUSENTE | Sí upstream | El default de materialización es `40`; ausente se compara como `0`. |
| C18 | `lib/researchRow.js:201` | `if (!Number.isFinite(price) \|\| price <= 0) throw new Error("Precio no disponible");` | precio | RECHAZA-POR-AUSENTE | Sí upstream en el pipeline no materializado | Impide construir la fila. |
| C19 | `lib/materializedScanner.js:489` | `if (!Number.isFinite(price) \|\| price <= 0) throw new Error("Precio no disponible");` | precio | RECHAZA-POR-AUSENTE | Sí upstream | Impide construir la fila materializada. |
| C20 | `lib/qualityGate.js:4` | `if (!Number.isFinite(row.chartBarsCount) \|\| row.chartBarsCount < minBars) reasons.push(\`historico ${row.chartBarsCount \|\| 0}/${minBars}\`);` | barras | RECHAZA-POR-AUSENTE | Sí upstream | `filterAnalyzedRows` lo ejecuta como pre-scan en `lib/screenerPipeline.js:106-113`; ausente falla el gate. |
| C21 | `lib/qualityGate.js:5` | `if (!Number.isFinite(row.price) \|\| row.price <= 0) reasons.push("precio no disponible");` | precio | RECHAZA-POR-AUSENTE | Sí upstream | Mismo pre-scan que C20; ausente falla el gate. |

## MEDIO — activo, pero el efecto queda acotado a score, ranking, narrativa, bucket o metodología

| ID | archivo:línea | Cita literal | Métrica | Clasificación | balanced | Justificación |
|---|---|---|---|---|---|---|
| M01 | `lib/scoring.js:71` | `return rsUniverseValue(row) ?? rsBenchmarkValue(row) ?? 50;` | RS primario | FABRICA-VALOR | N/A, cálculo | Fabrica RS `50` si faltan ambas fuentes. |
| M02 | `lib/scoring.js:91` | `const rsPrimary = Number.isFinite(rsUniverse) ? rsUniverse : (rsBenchmark ?? 0);` | RS de narrativa | FABRICA-VALOR | N/A, narrativa | Ausencia total se convierte en `0` y puede generar “RS débil”. |
| M03 | `lib/scoring.js:97` | `if ((r.rsQualityScore \|\| 0) >= 72) reasons.push("RS calidad alta");` | `rsQualityScore` | FABRICA-VALOR | N/A, narrativa | Ausente se trata como `0`; no añade razón positiva. |
| M04 | `lib/scoring.js:98` | `if ((r.rsCountryPct \|\| 0) >= 80) reasons.push("RS país fuerte");` | `rsCountryPct` | FABRICA-VALOR | N/A, narrativa | Igual, con `0`. |
| M05 | `lib/scoring.js:99` | `if ((r.rsSectorPct \|\| 0) >= 80) reasons.push("RS Grupo fuerte");` | `rsSectorPct` | FABRICA-VALOR | N/A, narrativa | Igual, con `0`. |
| M06 | `lib/scoring.js:100` | `if ((r.sectorScore \|\| 0) >= 70) reasons.push("Grupo fuerte");` | `sectorScore` | FABRICA-VALOR | N/A, narrativa | Igual, con `0`. |
| M07 | `lib/scoring.js:101` | `if ((r.growthScore \|\| 0) >= 70) reasons.push("Crecimiento/calidad superior");` | `growthScore` | FABRICA-VALOR | N/A, narrativa | Igual, con `0`. |
| M08 | `lib/scoring.js:102` | `if ((r.riskRewardScore \|\| 0) >= 70) reasons.push("Rentabilidad/riesgo eficiente");` | `riskRewardScore` | FABRICA-VALOR | N/A, narrativa | Igual, con `0`. |
| M09 | `lib/scoring.js:104` | `if ((r.demandScore \|\| 0) >= 70) reasons.push("Demanda y liquidez sanas");` | `demandScore` | FABRICA-VALOR | N/A, narrativa | Igual, con `0`. |
| M10 | `lib/scoring.js:106` | `if ((r.riskScore \|\| 0) < 45) risks.push("Riesgo técnico alto");` | `riskScore` | FABRICA-VALOR | N/A, narrativa | Ausente se convierte en `0` y crea una alerta negativa. |
| M11 | `lib/scoring.js:108` | `if ((r.speculationRiskScore \|\| 0) >= 70) risks.push("Volatilidad especulativa");` | `speculationRiskScore` | FABRICA-VALOR | N/A, narrativa | Ausente se convierte en `0`; no añade alerta. |
| M12 | `lib/scoring.js:109` | `else if ((r.speculationRiskScore \|\| 0) >= 55) risks.push("RS volátil");` | `speculationRiskScore` | FABRICA-VALOR | N/A, narrativa | Igual, con `0`. |
| M13 | `lib/scoring.js:112` | `if ((r.volumeScore \|\| 0) < 35) risks.push("Volumen limitado");` | `volumeScore` | FABRICA-VALOR | N/A, narrativa | Ausente crea una alerta negativa. |
| M14 | `lib/scoring.js:113` | `if ((r.growthScore \|\| 0) < 45) risks.push("Fundamentales insuficientes/débiles");` | `growthScore` | FABRICA-VALOR | N/A, narrativa | Ausente crea una alerta negativa. |
| M15 | `lib/screenerPipeline.js:329` | `const riskRewardScore = Number.isFinite(r.riskRewardScore) ? r.riskRewardScore : 45;` | `riskRewardScore` | FABRICA-VALOR | N/A, cálculo de fila | `45` entra en composite. |
| M16 | `lib/screenerPipeline.js:330` | `const rsAnchor = Number.isFinite(r.rsGlobalPct) ? r.rsGlobalPct : (r.rsRating \|\| 50);` | ancla RS | FABRICA-VALOR | N/A, cálculo de fila | Ausencia total se convierte en `50`. |
| M17 | `lib/screenerPipeline.js:332` | `const rsQualityScore = Number.isFinite(rsQuality?.rsQualityScore) ? rsQuality.rsQualityScore : rsAnchor;` | `rsQualityScore` | FABRICA-VALOR | N/A, cálculo de fila | Sustituye un score ausente por otro score. |
| M18 | `lib/materializedScanner.js:433` | `const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;` | `riskRewardScore` | FABRICA-VALOR | N/A, cálculo de fila | Equivalente materializado de M15. |
| M19 | `lib/materializedScanner.js:434` | `const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (row.rsRating \|\| 50);` | ancla RS | FABRICA-VALOR | N/A, cálculo de fila | Equivalente materializado de M16. |
| M20 | `lib/materializedScanner.js:436` | `const rsQualityScore = Number.isFinite(rsQuality?.rsQualityScore) ? rsQuality.rsQualityScore : rsAnchor;` | `rsQualityScore` | FABRICA-VALOR | N/A, cálculo de fila | Equivalente materializado de M17. |
| M21 | `lib/scanPercentileFinalization.js:120` | `const setupQualityScore = Number.isFinite(row.setupQualityScore) ? row.setupQualityScore : 0;` | `setupQualityScore` | FABRICA-VALOR | N/A, finalización | `0` participa en el composite recomputado. |
| M22 | `lib/scanPercentileFinalization.js:121` | `const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (Number.isFinite(row.rsRating) ? row.rsRating : 50);` | ancla RS | FABRICA-VALOR | N/A, finalización | Fabrica `50`. |
| M23 | `lib/scanPercentileFinalization.js:122` | `const rsQualityScore = Number.isFinite(row.rsQualityScore) ? row.rsQualityScore : rsAnchor;` | `rsQualityScore` | FABRICA-VALOR | N/A, finalización | Sustituye por el ancla RS. |
| M24 | `lib/scanPercentileFinalization.js:123` | `const demandScore = Number.isFinite(row.demandScore) ? row.demandScore : 0;` | `demandScore` | FABRICA-VALOR | N/A, finalización | `0` participa en el composite. |
| M25 | `lib/scanPercentileFinalization.js:124` | `const adProxyScore = Number.isFinite(row.adProxyScore) ? row.adProxyScore : 0;` | `adProxyScore` | FABRICA-VALOR | N/A, finalización | `0` participa en el composite. |
| M26 | `lib/scanPercentileFinalization.js:125` | `const growthScore = Number.isFinite(row.growthScore) ? row.growthScore : 0;` | `growthScore` | FABRICA-VALOR | N/A, finalización | Reintroduce `0` cuando el score canónico puede ser `null`. |
| M27 | `lib/scanPercentileFinalization.js:129` | `const sectorScore = Number.isFinite(row.sectorScore) ? row.sectorScore : 40;` | `sectorScore` | FABRICA-VALOR | N/A, finalización | Fabrica `40`. |
| M28 | `lib/scanPercentileFinalization.js:130` | `const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;` | `riskRewardScore` | FABRICA-VALOR | N/A, finalización | Fabrica `45`. |
| M29 | `lib/scanPercentileFinalization.js:131` | `const riskScore = Number.isFinite(row.riskScore) ? row.riskScore : 0;` | `riskScore` | FABRICA-VALOR | N/A, finalización | Fabrica `0`. |
| M30 | `lib/scanPercentileFinalization.js:132` | `const momentumScore = Number.isFinite(row.momentumScore) ? row.momentumScore : 0;` | `momentumScore` | FABRICA-VALOR | N/A, finalización | Fabrica `0`. |
| M31 | `lib/scanPercentileFinalization.js:133` | `const ipoScore = Number.isFinite(row.ipoScore) ? row.ipoScore : 0;` | `ipoScore` | FABRICA-VALOR | N/A, finalización | Fabrica `0`. |
| M32 | `lib/relativeStrength.js:194` | `if (sorted.length === 1) return 50;` | percentil con una observación | FABRICA-VALOR | N/A; el mínimo global normal es superior | Devuelve un percentil constante cuando el ranking no es evaluable comparativamente. |
| M33 | `lib/relativeStrength.js:275` | `const rsQualityScore = clamp(rs * .62 + clamp(stability) * .28 + (Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45) * .1);` | `riskRewardScore` dentro de RS quality | FABRICA-VALOR | N/A, score | Fabrica `45`. |
| M34 | `lib/relativeStrength.js:277` | `Math.max(0, (Number.isFinite(row.volatility63d) ? row.volatility63d : 35) - 35) * .62 +` | volatilidad en riesgo especulativo | FABRICA-VALOR | N/A, score | Fabrica `35`. |
| M35 | `lib/relativeStrength.js:278` | `Math.max(0, Number.isFinite(row.maxDrawdown63d) ? row.maxDrawdown63d : 12) * .85 +` | drawdown en riesgo especulativo | FABRICA-VALOR | N/A, score | Fabrica `12`. |
| M36 | `lib/relativeStrength.js:279` | `Math.max(0, (Number.isFinite(row.maxDailyMove20dPct) ? row.maxDailyMove20dPct : 8) - 10) * 1.35 +` | movimiento diario en riesgo especulativo | FABRICA-VALOR | N/A, score | Fabrica `8`. |
| M37 | `lib/relativeStrength.js:280` | `Math.max(0, (Number.isFinite(row.range63dPct) ? row.range63dPct : 45) - 80) * .22 +` | rango 63d en riesgo especulativo | FABRICA-VALOR | N/A, score | Fabrica `45`. |
| M38 | `lib/relativeStrength.js:281` | `Math.max(0, (Number.isFinite(row.extSma50) ? row.extSma50 : 0) - 18) * .85 -` | extensión SMA50 en riesgo especulativo | FABRICA-VALOR | N/A, score | Fabrica `0`. |
| M39 | `lib/relativeStrength.js:282` | `(Number.isFinite(row.liquidityScore) ? row.liquidityScore : 45) * .12` | liquidez en riesgo especulativo | FABRICA-VALOR | N/A, score | Fabrica `45`. |
| M40 | `lib/setupPatterns.js:482` | `+ (volumeDryUpScore ?? 45) * .13` | volumen seco en `patternQualityScore` | FABRICA-VALOR | No (`minPatternQualityScore: 0`) | Score ausente aporta `45` al cálculo. |
| M41 | `lib/setupPatterns.js:499` | `&& (pivot.pivotClarityScore ?? 0) >= 55` | claridad de pivot | RECHAZA-POR-AUSENTE | No, gate de `pivotSqueeze` | Ausente se compara como `0` y bloquea el candidato. |
| M42 | `lib/tradePlan.js:196` | `if (!Number.isFinite(quality) \|\| quality < minPatternQuality) {` | calidad de patrón | RECHAZA-POR-AUSENTE | N/A, plan metodológico | Ausente hace el plan no accionable. |
| M43 | `lib/tradePlan.js:219` | `if (!Number.isFinite(pivot) \|\| pivot <= 0) {` | pivot | RECHAZA-POR-AUSENTE | N/A, plan metodológico | Ausente hace el plan no accionable. |
| M44 | `lib/tradePlan.js:222` | `if (!Number.isFinite(contractionCount) \|\| contractionCount < 3 \|\| input.contractionsDecreasing !== true) {` | contracciones | RECHAZA-POR-AUSENTE | N/A, plan metodológico | Ausente hace el plan no accionable. |
| M45 | `lib/vcpDiagnostics.js:170` | `if (!Number.isFinite(dry)) return gate("volume", "Vol.", "fail", "sin dato");` | volumen seco | RECHAZA-POR-AUSENTE | N/A, diagnóstico VCP | Ausente es estado `fail`. |
| M46 | `lib/vcpDiagnostics.js:178` | `if (!Number.isFinite(distance)) return gate("pivot", "Pivot", "fail", "sin dato");` | distancia al pivot | RECHAZA-POR-AUSENTE | N/A, diagnóstico VCP | Ausente es estado `fail`. |
| M47 | `lib/decisionAudit.js:541` | `const totalScore = rowNumber(row, "objectiveScore") ?? rowNumber(row, "totalScore") ?? rowNumber(row, "compositeScore") ?? 0;` | score total en prioridad | FABRICA-VALOR | N/A, prioridad | Ausencia total aporta `0`. |
| M48 | `lib/decisionAudit.js:542` | `const rs = rowNumber(row, "rsGlobalPct") ?? rowNumber(row, "rsRating") ?? 0;` | RS en prioridad | FABRICA-VALOR | N/A, prioridad | Ausencia total aporta `0`. |
| M49 | `lib/decisionAudit.js:543` | `const riskReward = rowNumber(row, "riskRewardScore") ?? 45;` | rentabilidad/riesgo en prioridad | FABRICA-VALOR | N/A, prioridad | Ausencia aporta `45`. |
| M50 | `lib/objectiveMetricTruth.js:448` | `const rsAnchor = finite(rowValue(row, "rsGlobalPct")) ?? finite(rowValue(row, "rsRating")) ?? 50;` | RS en auditoría del score | FABRICA-VALOR | N/A, auditoría | Fabrica `50`. |
| M51 | `lib/objectiveMetricTruth.js:453` | `rsQualityScore: finite(rowValue(row, "rsQualityScore")) ?? rsAnchor,` | RS quality en auditoría | FABRICA-VALOR | N/A, auditoría | Sustituye por ancla RS. |
| M52 | `lib/objectiveMetricTruth.js:462` | `ipoScore: finite(rowValue(row, "ipoScore")) ?? 0,` | IPO score en auditoría | FABRICA-VALOR | N/A, auditoría | Fabrica `0`. |
| M53 | `lib/stockRows.js:257` | `const rs = rowRsPrimary(row) ?? 50;` | RS en weakness derivado | FABRICA-VALOR | N/A, listas/mercado | Fabrica `50`. |
| M54 | `lib/stockRows.js:261` | `const riskScore = finiteOrNull(snapshotValue(row, "riskScore")) ?? 50;` | risk score en weakness derivado | FABRICA-VALOR | N/A, listas/mercado | Fabrica `50`. |
| M55 | `lib/grouping.js:41` | `const strength = clamp((avgTotal \|\| 0) * .58 + (avgPrimaryRsValue \|\| avgRsValue \|\| 50) * .28 + clamp(avg3m \|\| 0, -20, 40) * .35 + leaders * 4);` | fuerza de grupo | FABRICA-VALOR | N/A, agrupación | Fabrica `0/50/0` en el score agregado. |
| M56 | `app/api/market-health/route.js:439` | `if ((indexPct ?? 0) >= 60 && (stage2Pct ?? 0) >= 40 && (distributionAvg ?? 0) <= 3) label = "Confirmación interna positiva";` | amplitud/distribución | FABRICA-VALOR | N/A, salud de mercado | Ausencias pasan a `0`; `distributionAvg` ausente satisface el máximo. |
| M57 | `app/api/market-health/route.js:440` | `else if ((indexPct ?? 0) >= 50 && (stage2Pct ?? 0) >= 25) label = "Mejora selectiva";` | amplitud | FABRICA-VALOR | N/A, salud de mercado | Ausencias pasan a `0`. |
| M58 | `app/api/market-health/route.js:441` | `else if ((sectorPct ?? 0) < 40 \|\| (stage4Pct ?? 0) >= 35) label = "Deterioro interno";` | amplitud sectorial/Stage 4 | FABRICA-VALOR | N/A, salud de mercado | `sectorPct` ausente se convierte en `0` y activa deterioro. |
| M59 | `app/market-health/page.jsx:76` | `bucket.rs += Number.isFinite(rs) ? rs : 50;` | RS medio de grupo | FABRICA-VALOR | N/A, salud de mercado | Ausente aporta `50` al promedio. |
| M60 | `app/market-health/page.jsx:363` | `const above50 = filtered.filter((r) => (r.extSma50 ?? 0) >= 0).length;` | amplitud sobre SMA50 | FABRICA-VALOR | N/A, salud de mercado | Extensión ausente cuenta como no negativa. |
| M61 | `app/market-health/page.jsx:366` | `const avgRs = validRs.length ? validRs.reduce((s, v) => s + v, 0) / validRs.length : 50;` | RS medio regional | FABRICA-VALOR | N/A, salud de mercado | Sin observaciones devuelve `50`. |
| M62 | `app/market-health/RegimeConstellation.jsx:67` | `const score = Number(data?.marketScore) \|\| 50;` | market score | FABRICA-VALOR | N/A, tono visual | Ausencia —y también `0` real— se convierte en `50`. |
| M63 | `app/api/company-brief/route.js:878` | `const rsQualityScore = clamp(rating * .68 + clamp(benchmarkStrength.rsStabilityScore ?? 72) * .32);` | estabilidad RS | FABRICA-VALOR | N/A, ficha | Fabrica `72` si falta estabilidad. |
| M64 | `lib/scoringEngine.js:361` | `if (!Number.isFinite(m) \|\| m < 0 \|\| m > 60) return 0;` | `ipoScore` cuando falta/queda fuera de rango la edad | FABRICA-VALOR | N/A, score | Ausencia de edad devuelve score `0`. |
| M65 | `lib/scoringEngine.js:366` | `return clamp(age + high + liq + st + (r.sectorScore ? r.sectorScore * .15 : 5));` | componente sectorial de `ipoScore` | FABRICA-VALOR | N/A, score | `sectorScore` ausente —y `0` real— aporta `5`. |
| M66 | `lib/screenerComposite.js:96` | `const avg3 = avg(rows.map((row) => row.perf3m \|\| 0));` | `perf3m` en score sectorial | FABRICA-VALOR | N/A, score de grupo | Cada ausencia entra en el promedio como `0`. |
| M67 | `lib/screenerComposite.js:97` | `const avg6 = avg(rows.map((row) => row.perf6m \|\| 0));` | `perf6m` en score sectorial | FABRICA-VALOR | N/A, score de grupo | Cada ausencia entra en el promedio como `0`. |
| M68 | `lib/screenerComposite.js:100` | `+ clamp(Number.isFinite(avg3) ? avg3 : 0, 0, 20)` | media 3M en score sectorial | FABRICA-VALOR | N/A, score de grupo | Media no finita se convierte en `0`. |
| M69 | `lib/screenerComposite.js:101` | `+ clamp(Number.isFinite(avg6) ? avg6 / 2 : 0, 0, 20)` | media 6M en score sectorial | FABRICA-VALOR | N/A, score de grupo | Media no finita se convierte en `0`. |
| M70 | `lib/setupPatterns.js:246` | `+ (Number.isFinite(highsSpreadPct) ? clamp((18 - highsSpreadPct) * 1.5, 0, 24) : 0)` | spread de máximos en claridad de pivot | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M71 | `lib/setupPatterns.js:455` | `+ (Number.isFinite(lastContractionDepthPct) ? clamp((12 - lastContractionDepthPct) * 2.2, 0, 22) : 0)` | última contracción | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M72 | `lib/setupPatterns.js:456` | `+ (Number.isFinite(contractionReductionPct) ? clamp(contractionReductionPct * .25, 0, 15) : 0)` | reducción de contracciones | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M73 | `lib/setupPatterns.js:463` | `(Number.isFinite(tightness5dPct) ? clamp((10 - tightness5dPct) * 4, 0, 34) : 0)` | tightness 5d | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M74 | `lib/setupPatterns.js:464` | `+ (Number.isFinite(tightness10dPct) ? clamp((16 - tightness10dPct) * 2.2, 0, 30) : 0)` | tightness 10d | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M75 | `lib/setupPatterns.js:465` | `+ (Number.isFinite(tightness20dPct) ? clamp((24 - tightness20dPct) * 1.5, 0, 24) : 0)` | tightness 20d | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M76 | `lib/setupPatterns.js:472` | `(Number.isFinite(base.depthPct) ? clamp((42 - base.depthPct) * 1.7, 0, 44) : 0)` | profundidad base | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M77 | `lib/setupPatterns.js:481` | `+ (pivot.pivotClarityScore ?? 0) * .2` | claridad de pivot | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M78 | `lib/setupPatterns.js:484` | `+ (context.baseContextScore ?? 0) * .06` | contexto de base | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |
| M79 | `lib/setupPatterns.js:504` | `+ (Number.isFinite(latestVolumeRatio) ? clamp((latestVolumeRatio - 1) * 35, 0, 28) : 0)` | volumen de breakout | FABRICA-VALOR | N/A, score de breakout | Ausente aporta `0`. |
| M80 | `lib/setupPatterns.js:505` | `+ (Number.isFinite(latestCloseLocationPct) ? clamp((latestCloseLocationPct - 50) * 0.5, 0, 20) : 0)` | cierre de breakout | FABRICA-VALOR | N/A, score de breakout | Ausente aporta `0`. |
| M81 | `lib/comparables.js:138` | `const rsCredit = Number.isFinite(item.rsSectorPct) ? item.rsSectorPct : 0;` | crédito RS en score comparable | FABRICA-VALOR | N/A, comparables | Ausente aporta `0`. |
| M82 | `lib/comparables.js:139` | `const patternCredit = patternUsable && Number.isFinite(item.patternQualityScore) ? item.patternQualityScore * .5 : 0;` | crédito de patrón en score comparable | FABRICA-VALOR | N/A, comparables | Ausente aporta `0`. |
| M83 | `lib/comparables.js:140` | `const pivotPenalty = patternUsable && Number.isFinite(item.absDistanceToPivotPct) ? item.absDistanceToPivotPct * .7 : 8;` | penalización de pivot en score comparable | FABRICA-VALOR | N/A, comparables | Ausente fabrica penalización `8`. |
| M84 | `app/api/company-brief/route.js:327` | `const speculationRiskScore = clamp(Math.max(0, (Number.isFinite(volatility63d) ? volatility63d : 35) - 35) * .62 + Math.max(0, Number.isFinite(maxDrawdown63d) ? maxDrawdown63d : 12) * .85);` | volatilidad/drawdown en riesgo especulativo | FABRICA-VALOR | N/A, ficha | Ausentes se sustituyen por `35` y `12`. |
| M85 | `lib/setupPatterns.js:476` | `+ ((context.baseContextScore ?? 0) * .18)` | contexto de base en `baseQualityScore` | FABRICA-VALOR | N/A, score de patrón | Ausente aporta `0`. |

## BAJO — preset/modo no activo por defecto, clasificación auxiliar o tratamiento neutro

| ID | archivo:línea | Cita literal | Métrica | Clasificación | balanced | Justificación |
|---|---|---|---|---|---|---|
| B01 | `lib/screenerPipeline.js:265` | `if (set.setupMode === "weakness") return !Number.isFinite(row.weaknessScore) \|\| row.weaknessScore >= (set.minWeaknessScore \|\| 0) ? null : rejectReason("weakness", \`Deterioro ${row.weaknessScore.toFixed(0)} < ${set.minWeaknessScore \|\| 0}\`, "minWeaknessScore");` | `weaknessScore` | NEUTRO | No (`setupMode: leader`) | En weakness, ausente devuelve `null` y no rechaza. |
| B02 | `lib/screenerPipeline.js:266` | `if ((set.minRsCountryPct \|\| 0) > 0 && (!Number.isFinite(row.rsCountryPct) \|\| row.rsCountryPct < set.minRsCountryPct)) return rejectReason("relativeStrength", \`RS Pais ${row.rsCountryPct?.toFixed?.(0) \|\| "sin dato"} < ${set.minRsCountryPct \|\| 0}\`, "minRsCountryPct");` | `rsCountryPct` | RECHAZA-POR-AUSENTE | No (`0`) | Solo se activa con override/otro preset. |
| B03 | `lib/screenerPipeline.js:267` | `if ((set.minRsSectorPct \|\| 0) > 0 && (!Number.isFinite(row.rsSectorPct) \|\| row.rsSectorPct < set.minRsSectorPct)) return rejectReason("relativeStrength", \`${metricShortLabel("rsSectorPct")} ${row.rsSectorPct?.toFixed?.(0) \|\| "sin dato"} < ${set.minRsSectorPct \|\| 0}\`, "minRsSectorPct");` | `rsSectorPct` | RECHAZA-POR-AUSENTE | No (`0`) | Solo se activa con override/otro preset. |
| B04 | `lib/screenerPipeline.js:268` | `if ((set.minRsQualityScore \|\| 0) > 0 && (!Number.isFinite(row.rsQualityScore) \|\| row.rsQualityScore < set.minRsQualityScore)) return rejectReason("relativeStrength", \`RS Quality ${row.rsQualityScore?.toFixed?.(0) \|\| "sin dato"} < ${set.minRsQualityScore \|\| 0}\`, "minRsQualityScore");` | `rsQualityScore` | RECHAZA-POR-AUSENTE | No (`0`) | Solo se activa con override/otro preset. |
| B05 | `lib/screenerPipeline.js:269` | `if ((set.minSectorScore \|\| 0) > 0 && (!Number.isFinite(row.sectorScore) \|\| row.sectorScore < set.minSectorScore)) return rejectReason("relativeStrength", \`Fuerza grupo ${row.sectorScore?.toFixed?.(0) \|\| "sin dato"} < ${set.minSectorScore \|\| 0}\`, "minSectorScore");` | `sectorScore` | RECHAZA-POR-AUSENTE | No (`0`) | Solo se activa con override/otro preset. |
| B06 | `lib/screenerPipeline.js:271` | `if ((set.minTotalScore \|\| 0) > 0 && (!Number.isFinite(objectiveScore) \|\| objectiveScore < set.minTotalScore)) return rejectReason("score", \`Score compuesto ${objectiveScore?.toFixed?.(0) \|\| "sin dato"} < ${set.minTotalScore \|\| 0}\`, "minTotalScore");` | score compuesto | RECHAZA-POR-AUSENTE | No (`0`) | Solo se activa con override/otro preset. |
| B07 | `lib/screenerFilters.js:757` | `if (Number.isFinite(weak) && weak < minWeakness) return reject("minWeaknessScore", \`deterioro ${weak.toFixed(0)} < ${minWeakness}\`);` | `weaknessScore` | NEUTRO | No (`setupMode: leader`) | La comparación exige dato finito; ausente se omite. |
| B08 | `lib/coveragePlan.js:121` | `const qualityOk = freshness.ok && (!Number.isFinite(coverage) \|\| coverage >= minCoverageScore);` | cobertura | NEUTRO | N/A, cobertura | Ausente no bloquea `qualityOk`. |
| B09 | `lib/coveragePlan.js:122` | `const rankingEligible = qualityOk && (!Number.isFinite(objectiveScore) \|\| objectiveScore >= 45);` | score objetivo | NEUTRO | N/A, cobertura | Ausente no bloquea ranking. |
| B10 | `app/api/scan-coverage/route.js:84` | `const qualityOk = freshness.ok && (!Number.isFinite(coverage) \|\| coverage >= minCoverage);` | cobertura | NEUTRO | N/A, cobertura | Duplicado de B08. |
| B11 | `app/api/scan-coverage/route.js:85` | `const rankingEligible = qualityOk && (!Number.isFinite(objectiveScore) \|\| objectiveScore >= 45);` | score objetivo | NEUTRO | N/A, cobertura | Duplicado de B09. |
| B12 | `lib/leaderboards.js:400` | `if (Number.isFinite(coverage) && coverage < minCoverage) return false;` | cobertura | NEUTRO | N/A, leaderboard | Ausente no rechaza. |
| B13 | `lib/leaderboards.js:401` | `if (Number.isFinite(options.minTotalScore) && (objectiveMetric(row) \|\| 0) < options.minTotalScore) return false;` | score objetivo | RECHAZA-POR-AUSENTE | N/A, leaderboard | Con opción activa, ausente se compara como `0`. |
| B14 | `lib/leaderboards.js:402` | `if (Number.isFinite(options.minRs) && !(Number.isFinite(rsUniverseValue(row)) && rsUniverseValue(row) >= options.minRs)) return false;` | RS global | RECHAZA-POR-AUSENTE | N/A, leaderboard | Con opción activa, exige dato finito. |
| B15 | `lib/leaderboards.js:403` | `if (Number.isFinite(options.minMarketCap) && (metric(row, "marketCap") \|\| 0) < options.minMarketCap) return false;` | market cap | RECHAZA-POR-AUSENTE | N/A, leaderboard | Con opción activa, ausente se compara como `0`. |
| B16 | `lib/leaderboards.js:404` | `if (Number.isFinite(options.minAvgTurnover) && (metric(row, "avgTurnover") \|\| 0) < options.minAvgTurnover) return false;` | turnover medio | RECHAZA-POR-AUSENTE | N/A, leaderboard | Con opción activa, ausente se compara como `0`. |
| B17 | `lib/leaderboards.js:423` | `if (strategy === "growth") return (metric(row, "growthScore") \|\| metric(row, "epsGrowthProxyScore") \|\| 0) >= 50 && total >= 50;` | growth/EPS proxy | RECHAZA-POR-AUSENTE | N/A, estrategia growth | Ausencia de ambos impide pasar. |
| B18 | `lib/leaderboards.js:429` | `if (strategy === "liquidity") return (metric(row, "avgTurnover") \|\| 0) > 0 && total >= 45;` | turnover | RECHAZA-POR-AUSENTE | N/A, estrategia liquidity | Ausente impide pasar. |
| B19 | `lib/leaderboards.js:432` | `return total >= 45 && rs >= 45 && (!Number.isFinite(distance52w) \|\| distance52w >= -45);` | distancia 52w | NEUTRO | N/A, momentum | Distancia ausente se omite, mientras total/RS ya fueron convertidos a `0`. |
| B20 | `lib/leaderboards.js:467` | `if (strategy === "pullback") return clamp(total * 0.36 + rs * 0.28 + (100 - Math.min(100, Math.abs((metric(row, "extSma50") ?? 99) - 2) * 11)) * 0.24 + weinstein * 0.12);` | extensión SMA50 | FABRICA-VALOR | N/A, estrategia pullback | Ausente se sustituye por `99` en el score. |
| B21 | `lib/listRationale.js:145` | `const total = metric(row, "objectiveScore") ?? 0;` | score objetivo | FABRICA-VALOR | N/A, listas | `0` se usa en los contratos de lista. |
| B22 | `lib/listRationale.js:146` | `const rs = metric(row, "rsGlobalPct") ?? 0;` | RS global | FABRICA-VALOR | N/A, listas | `0` se usa en los contratos de lista. |
| B23 | `lib/listRationale.js:150` | `const minervini = metric(row, "minerviniScore") ?? 0;` | Minervini | FABRICA-VALOR | N/A, listas | `0` se usa en los contratos de lista. |
| B24 | `lib/listRationale.js:151` | `const weinstein = metric(row, "weinsteinScore") ?? 0;` | Weinstein | FABRICA-VALOR | N/A, listas | `0` se usa en los contratos de lista. |
| B25 | `lib/listRationale.js:166` | `if (listKey === "rsQuality") return (metric(row, "rsQualityScore") ?? 0) >= 55 && rs >= 55;` | RS quality | RECHAZA-POR-AUSENTE | N/A, lista RS quality | Ausente impide pertenecer. |
| B26 | `lib/listRationale.js:168` | `if (listKey === "ipo") return recentIpoOk(row, maxIpoAgeMonths) && ((metric(row, "ipoScore") ?? 0) >= 45 \|\| total >= 50 \|\| rs >= 55);` | IPO score | RECHAZA-POR-AUSENTE | N/A, lista IPO | Ausente se trata como `0` en una rama; otras ramas pueden salvar la fila. |
| B27 | `lib/listRationale.js:169` | `if (listKey === "extended") return total >= 70 && Number.isFinite(extSma50) && sma50ExtensionOk(row, extSma50) && extSma50 >= 15 && (!Number.isFinite(distance52w) \|\| distance52w >= -20);` | distancia 52w | NEUTRO | N/A, lista extended | La distancia ausente se omite; extensión ausente sí impide pasar. |
| B28 | `lib/screenerResultView.js:38` | `{ key: "rs", title: "RS", note: "Percentil del lote", check: (r) => (rsUniverseValue(r) ?? 0) >= 75 && gte(r.distance52w, -25) },` | RS bucket | FABRICA-VALOR | N/A, bucket UI | Ausente se convierte en `0` y no entra. |
| B29 | `lib/screenerResultView.js:39` | `{ key: "growth", title: "Growth Quality", note: "Crecimiento + margen", check: (r) => (r.growthScore \|\| 0) >= 70 && (r.objectiveScore ?? r.totalScore ?? 0) >= 64 },` | growth/score bucket | FABRICA-VALOR | N/A, bucket UI | Ausentes se convierten en `0` y no entran. |
| B30 | `lib/screenerResultView.js:42` | `{ key: "risk", title: "Riesgo a revisar", note: "Volatilidad/extensión", check: (r) => (r.riskScore \|\| 0) < 45 \|\| gt(r.extSma50, 28) \|\| (r.speculationRiskScore \|\| 0) >= 70 },` | risk/speculation risk bucket | FABRICA-VALOR | N/A, bucket UI | `riskScore` ausente mete la fila en el bucket de riesgo. |
| B31 | `lib/screenerMobile.jsx:189` | `const elite = rows.filter((r) => (r.objectiveScore ?? r.totalScore ?? 0) >= 75).length;` | conteo elite | FABRICA-VALOR | N/A, contador UI | Ausente cuenta como `0`; no filtra filas. |
| B32 | `lib/screenerMobile.jsx:191` | `const weaknessCount = rows.filter((r) => (r.weaknessScore \|\| 0) >= 65).length;` | conteo weakness | FABRICA-VALOR | N/A, contador UI | Ausente cuenta como `0`; no filtra filas. |
| B33 | `lib/screenerFiltersView.jsx:31` | `rs: rows.filter((row) => (rsUniverseValue(row) ?? 0) >= 75).length,` | conteo RS | FABRICA-VALOR | N/A, contador UI | Ausente cuenta como `0`; no filtra filas. |
| B34 | `lib/screenerMobile.jsx:54` | `const movers = [...rows].filter((row) => Number.isFinite(row.perf3m)).sort((a, b) => (b.perf3m \|\| 0) - (a.perf3m \|\| 0)).slice(0, 8);` | `perf3m` en ordenación | NEUTRO | N/A, UI | El filtro previo garantiza finitud; el `\|\| 0` no alcanza ausentes. |
| B35 | `lib/methodologyVerdict.js:77` | `&& (!Number.isFinite(baseDepth) \|\| baseDepth <= 35)` | profundidad base | NEUTRO | N/A, metodología | Ausente no bloquea. |
| B36 | `lib/methodologyVerdict.js:104` | `&& (!Number.isFinite(baseDepth) \|\| baseDepth <= 32)` | profundidad base | NEUTRO | N/A, metodología | Ausente no bloquea. |
| B37 | `lib/methodologyVerdict.js:105` | `&& (!Number.isFinite(pivotClarity) \|\| pivotClarity >= 55)` | claridad pivot | NEUTRO | N/A, metodología | Ausente no bloquea. |
| B38 | `lib/methodologyVerdict.js:124` | `&& (!Number.isFinite(baseDepth) \|\| baseDepth <= 32)` | profundidad base | NEUTRO | N/A, metodología | Ausente no bloquea. |
| B39 | `lib/methodologyVerdict.js:125` | `&& (!Number.isFinite(pivotClarity) \|\| pivotClarity >= 55);` | claridad pivot | NEUTRO | N/A, metodología | Ausente no bloquea. |
| B40 | `lib/methodologyVerdict.js:139` | `&& (!Number.isFinite(baseDepth) \|\| baseDepth <= 35)` | profundidad base | NEUTRO | N/A, metodología | Ausente no bloquea. |
| B41 | `lib/patternNarrative.js:220` | `&& (!Number.isFinite(baseDepth) \|\| baseDepth <= 32)` | profundidad base | NEUTRO | N/A, narrativa | Ausente no bloquea. |
| B42 | `lib/patternNarrative.js:221` | `&& (!Number.isFinite(pivotClarity) \|\| pivotClarity >= 55)` | claridad pivot | NEUTRO | N/A, narrativa | Ausente no bloquea. |
| B43 | `lib/patternNarrative.js:294` | `&& (family === "progressive_contraction" \|\| row.vcpCandidate \|\| (quality ?? 0) >= 50);` | calidad de patrón | FABRICA-VALOR | N/A, narrativa | Ausente se convierte en `0` en una de tres ramas. |
| B44 | `lib/setupPatterns.js:317` | `&& (!Number.isFinite(pivotAgeBars) \|\| pivotAgeBars <= 8)` | edad del pivot | NEUTRO | N/A, detector | Ausente no bloquea. |
| B45 | `lib/setupPatterns.js:319` | `const rangeControlled = !Number.isFinite(base.depthPct) \|\| base.depthPct <= 48;` | profundidad base | NEUTRO | N/A, detector | Ausente se considera rango controlado. |
| B46 | `lib/setupPatterns.js:379` | `const separated = (!Number.isFinite(highGap) \|\| highGap >= 4) && (!Number.isFinite(lowGap) \|\| lowGap >= 4);` | separación de swings | NEUTRO | N/A, detector | Ausencias se consideran separadas. |
| B47 | `lib/setupPatterns.js:380` | `const sameCeiling = !Number.isFinite(item.high) \|\| item.high <= ceiling;` | máximo del swing | NEUTRO | N/A, detector | Ausente no bloquea. |
| B48 | `lib/setupPatterns.js:381` | `const holdsBaseFloor = !Number.isFinite(item.low) \|\| item.low >= floor;` | mínimo del swing | NEUTRO | N/A, detector | Ausente no bloquea. |
| B49 | `lib/setupPatterns.js:382` | `const holdsPreviousLow = !Number.isFinite(item.low) \|\| !Number.isFinite(previous.low) \|\| item.low >= previous.low * 0.997;` | mínimos consecutivos | NEUTRO | N/A, detector | Cualquier ausencia no bloquea. |
| B50 | `lib/setupPatterns.js:383` | `const usefulReduction = !Number.isFinite(item.depthPct) \|\| !Number.isFinite(previous.depthPct)` | profundidad de contracciones | NEUTRO | N/A, detector | La expresión continúa en `:384-385`; ausencia hace verdadera la reducción útil. |

## Inconsistencias verificadas

1. **Misma función de post-filtro, semántica opuesta.** `lib/screenerPipeline.js:265` omite `weaknessScore` ausente, pero `:266-269` y `:271` rechazan ausencias en criterios vecinos cuando sus umbrales están activos.

2. **Misma función de filtro compartido, semántica opuesta.** `lib/screenerFilters.js:731`, `:740` y `:747` rechazan ausencias; `:757` exige que weakness sea finito antes de comparar y por tanto lo omite. Además, `buildScreenerFilterExplainPlan` etiqueta una ausencia como `missing` en `:402`, mientras la ejecución real del filtro la convierte en rechazo en `:731`/`:747`.

3. **Stage 2 diario es permisivo o estricto según exista estado semanal.** `pairIssue` en `lib/trendStructure.js:16` omite pares ausentes. Si `weeklyState === "stage2"`, `:67` puede aceptar esa omisión; si no hay estado semanal, `isDailyStage2` devuelve `false` por ausencia en `:51` y `:71` devuelve rechazo por defecto.

4. **El mismo `dataCoverageScore` ausente pasa o falla según la capa.** `lib/coveragePlan.js:121` y `app/api/scan-coverage/route.js:84` lo consideran aceptable; `lib/materializedScanner.js:621` lo convierte en `0` y lo rechaza; `lib/screenerFilters.js:731` también lo rechaza cuando `minDataCoverageScore` está activo (`35` en `balanced`).

5. **El mismo score objetivo ausente pasa en cobertura y falla en otras capas.** `lib/coveragePlan.js:122` y `app/api/scan-coverage/route.js:85` lo consideran elegible; `lib/leaderboards.js:401`, `lib/listRationale.js:145` y `lib/screenerPipeline.js:271` lo convierten en rechazo cuando el umbral correspondiente está activo.

6. **El composite canónico omite ausentes, la finalización los vuelve a fabricar.** `lib/scoringEngine.js:747-752` documenta y ejecuta la exclusión/renormalización de términos ausentes; `lib/scanPercentileFinalization.js:120-133` convierte esos términos a `0/40/45/50` antes de llamar a `scoreCompositeValue` en `:134-160`.

7. **La corrección de `growthScore` ausente no se conserva en todas las capas.** El productor puede entregar `growthScore: null`, pero `lib/scanPercentileFinalization.js:125` lo convierte en `0`, `lib/scoring.js:113` lo interpreta como fundamentales insuficientes/débiles y `lib/screenerResultView.js:39` lo usa como `0` en el bucket Growth.

8. **Misma narrativa, direcciones opuestas con el mismo fallback.** En `lib/scoring.js`, los scores positivos ausentes convertidos en `0` simplemente no añaden razón (`:97-104`), pero `riskScore`/`volumeScore`/`growthScore` ausentes convertidos en `0` sí crean alertas negativas (`:106`, `:112-113`).

9. **Métricas VCP ausentes pasan en un veredicto y fallan en el diagnóstico.** `lib/methodologyVerdict.js:104-105` permite `baseDepth`/`pivotClarity` ausentes; `lib/vcpDiagnostics.js:170` y `:178` convierten volumen/pivot ausentes en `fail`; `lib/setupPatterns.js:499` convierte claridad ausente en `0` y bloquea `pivotSqueeze`.

10. **Distancia 52w ausente se omite o se penaliza según consumidor.** `lib/leaderboards.js:432` y `lib/listRationale.js:169` la omiten; `lib/relativeStrength.js:187` fabrica `-50` dentro del RS raw.

## Salida cruda de `grep` de mayor señal

### Rechazos directos por ausencia

Comando:

```sh
grep -RInE '!Number\.isFinite\([^)]*\).*return[[:space:]]+(reject|rejectReason)|return[[:space:]]+!Number\.isFinite\([^)]*\)' lib app --exclude-dir=node_modules --exclude-dir=.next
```

Salida cruda:

```text
lib/screenerPipeline.js:265:  if (set.setupMode === "weakness") return !Number.isFinite(row.weaknessScore) || row.weaknessScore >= (set.minWeaknessScore || 0) ? null : rejectReason("weakness", `Deterioro ${row.weaknessScore.toFixed(0)} < ${set.minWeaknessScore || 0}`, "minWeaknessScore");
lib/screenerPipeline.js:266:  if ((set.minRsCountryPct || 0) > 0 && (!Number.isFinite(row.rsCountryPct) || row.rsCountryPct < set.minRsCountryPct)) return rejectReason("relativeStrength", `RS Pais ${row.rsCountryPct?.toFixed?.(0) || "sin dato"} < ${set.minRsCountryPct || 0}`, "minRsCountryPct");
lib/screenerPipeline.js:267:  if ((set.minRsSectorPct || 0) > 0 && (!Number.isFinite(row.rsSectorPct) || row.rsSectorPct < set.minRsSectorPct)) return rejectReason("relativeStrength", `${metricShortLabel("rsSectorPct")} ${row.rsSectorPct?.toFixed?.(0) || "sin dato"} < ${set.minRsSectorPct || 0}`, "minRsSectorPct");
lib/screenerPipeline.js:268:  if ((set.minRsQualityScore || 0) > 0 && (!Number.isFinite(row.rsQualityScore) || row.rsQualityScore < set.minRsQualityScore)) return rejectReason("relativeStrength", `RS Quality ${row.rsQualityScore?.toFixed?.(0) || "sin dato"} < ${set.minRsQualityScore || 0}`, "minRsQualityScore");
lib/screenerPipeline.js:269:  if ((set.minSectorScore || 0) > 0 && (!Number.isFinite(row.sectorScore) || row.sectorScore < set.minSectorScore)) return rejectReason("relativeStrength", `Fuerza grupo ${row.sectorScore?.toFixed?.(0) || "sin dato"} < ${set.minSectorScore || 0}`, "minSectorScore");
lib/screenerPipeline.js:271:  if ((set.minTotalScore || 0) > 0 && (!Number.isFinite(objectiveScore) || objectiveScore < set.minTotalScore)) return rejectReason("score", `Score compuesto ${objectiveScore?.toFixed?.(0) || "sin dato"} < ${set.minTotalScore || 0}`, "minTotalScore");
lib/screenerFilters.js:731:    if (!Number.isFinite(value)) return reject(field, `${rule.label} sin dato`);
lib/screenerFilters.js:740:    if (!Number.isFinite(rs) || rs < minRsRating) return reject("minRsRating", `RS universo ${Number.isFinite(rs) ? rs.toFixed(0) : "sin dato"} < ${minRsRating}`);
lib/screenerFilters.js:747:    if (!Number.isFinite(value)) return reject(field, `${rule.label} sin dato`);
app/research-desk/page.jsx:69:    return !Number.isFinite(selectedTime) || !Number.isFinite(itemTime) || itemTime < selectedTime;
```

### Fallbacks constantes ligados a scores/métricas

Comando:

```sh
grep -RInE '(Score|score|Rating|rating|Percentile|percentile|Pct|pct|Distance|distance|Growth|growth|Quality|quality|Strength|strength|Weakness|weakness|Composite|composite|Total|total).*(\?\?|\|\|)[[:space:]]*[1-9][0-9]*([.][0-9]+)?([^0-9]|$)' lib app --exclude-dir=node_modules --exclude-dir=.next
```

La salida cruda de este comando está representada literalmente por las filas M01, M15-M20, M33, M40, M47-M55, M61-M63, B20 y por las coincidencias no financieras conservadas en el comando reproducible de la sección siguiente.

### Ternarios que fabrican números cuando `Number.isFinite` falla

Comando:

```sh
grep -RInE 'Number\.isFinite\([^)]*\)[[:space:]]*\?[^:;]+:[[:space:]]*-?[0-9]+([.][0-9]+)?' lib app --exclude-dir=node_modules --exclude-dir=.next
```

Las coincidencias de dominio aparecen literalmente en C06-C13, M15, M18, M21-M31, M33-M39 y M59. La salida también contiene fallbacks técnicos de timestamps, coordenadas, volúmenes de render y contadores, excluidos según el alcance declarado.

## COMANDOS EJECUTADOS

### Preflight y lectura contextual principal

```sh
git branch --show-current
git rev-parse HEAD
git status --short
git cat-file -t d29c82c
nl -ba lib/screenerFilterCatalog.js | sed -n '90,210p'
nl -ba lib/screenerFilterCatalog.js | sed -n '530,615p'
nl -ba lib/screenerPipeline.js | sed -n '235,285p'
nl -ba lib/screenerFilters.js | sed -n '140,180p;370,435p;620,770p'
nl -ba lib/relativeStrength.js | sed -n '180,205p;235,290p'
nl -ba lib/scanPercentileFinalization.js | sed -n '105,175p;215,250p'
nl -ba lib/scoringEngine.js | sed -n '735,765p;800,865p'
nl -ba lib/scoringEngine.js | sed -n '470,520p'
nl -ba lib/materializedScanner.js | sed -n '425,440p;605,625p;1398,1412p'
nl -ba lib/trendStructure.js | sed -n '1,75p'
nl -ba lib/screenerPipeline.js | sed -n '88,115p'
nl -ba lib/scoring.js | sed -n '55,125p'
nl -ba lib/tradePlan.js | sed -n '175,235p'
nl -ba lib/leaderboards.js | sed -n '149,180p;320,345p;390,475p;600,625p'
nl -ba lib/listRationale.js | sed -n '130,180p;370,390p'
nl -ba lib/setupPatterns.js | sed -n '300,390p;465,510p'
nl -ba lib/vcpDiagnostics.js | sed -n '150,190p;270,292p'
nl -ba lib/coveragePlan.js | sed -n '100,130p'
nl -ba app/api/scan-coverage/route.js | sed -n '75,95p'
nl -ba lib/methodologyVerdict.js | sed -n '65,150p'
nl -ba lib/patternNarrative.js | sed -n '205,230p;285,300p'
nl -ba lib/objectiveMetricTruth.js | sed -n '435,470p'
nl -ba lib/stockRows.js | sed -n '250,270p'
nl -ba lib/decisionAudit.js | sed -n '530,610p'
nl -ba app/market-health/page.jsx | sed -n '40,115p;350,375p'
nl -ba app/api/market-health/route.js | sed -n '425,450p'
nl -ba app/market-health/RegimeConstellation.jsx | sed -n '55,75p'
nl -ba app/api/company-brief/route.js | sed -n '860,885p'
nl -ba lib/grouping.js | sed -n '20,48p'
rg -n 'qualityGateForResearchRow' lib app
```

### Todos los comandos `grep` ejecutados, en orden

Los repetidos se conservan porque se ejecutaron realmente. Los dos comandos marcados como fallidos también se conservan; no aportaron evidencia.

```sh
grep -RInE '!Number\.isFinite\(' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '\|\|[[:space:]]*0([^0-9]|$)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '\?\?[[:space:]]*0([^0-9]|$)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInEi '["'"'](sin dato|sin datos|no disponible)[^"'"']*["'"']' lib app --exclude-dir=node_modules --exclude-dir=.next
# El comando anterior falló con: zsh:1: bad pattern
grep -RInE 'return[[:space:]]+[0-9]+([.][0-9]+)?[[:space:]]*;|return[[:space:]]*\([^)]*\?[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*:[^)]*\)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInEi '(score|rating|percentile|pct|distance|growth|quality|strength|weakness|composite|total)[A-Za-z0-9_]*[[:space:]]*(\?\?|\|\|)[[:space:]]*0([^0-9]|$)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '!Number\.isFinite\([^)]*\).*(<=|>=|<|>)|(<=|>=|<|>).*(!Number\.isFinite\()' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '!Number\.isFinite\([^)]*\).*return[[:space:]]+(reject|rejectReason)|return[[:space:]]+!Number\.isFinite\([^)]*\)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '(\|\||\?\?)[[:space:]]*0[^;]*(<=|>=|<|>)|(<=|>=|<|>)[^;]*(\|\||\?\?)[[:space:]]*0' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInEi 'sin dato|sin datos|no disponible' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '(Score|score|Rating|rating|Percentile|percentile|Pct|pct|Distance|distance|Growth|growth|Quality|quality|Strength|strength|Weakness|weakness|Composite|composite|Total|total).*(\?\?|\|\|)[[:space:]]*[0-9]+([.][0-9]+)?' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInEi 'sin dato|sin datos|no disponible' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '(\|\||\?\?)[[:space:]]*0[^;]*(<=|>=|<|>)|(<=|>=|<|>)[^;]*(\|\||\?\?)[[:space:]]*0' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '(Score|score|Rating|rating|Percentile|percentile|Pct|pct|Distance|distance|Growth|growth|Quality|quality|Strength|strength|Weakness|weakness|Composite|composite|Total|total).*(\?\?|\|\|)[[:space:]]*[1-9][0-9]*([.][0-9]+)?([^0-9]|$)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '(return|\?\?|\|\||:)[[:space:]]*[1-9][0-9]*([.][0-9]+)?([^0-9]|$)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE 'return[[:space:]]+[0-9]+([.][0-9]+)?[[:space:]]*;|return[[:space:]]*\([^)]*\?[[:space:]]*[0-9]+([.][0-9]+)?[[:space:]]*:[^)]*\)' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE 'Number\.isFinite\([^)]*\)[[:space:]]*\?[^:;]+:[[:space:]]*-?[0-9]+([.][0-9]+)?' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE '(score|Score|rating|Rating|pct|Pct|distance|Distance|growth|Growth|quality|Quality|risk|Risk).*[?][^:;]+:[[:space:]]*-?[0-9]+([.][0-9]+)?' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE 'FIELD_RULES|DISTANCE_RULES|QUALITY_DEFAULTS|balanced' lib/screenerFilters.js lib/screenerFilterCatalog.js lib/screenerPipeline.js
grep -RInE 'finalizeScanPercentiles|scoreFormulaValue|scoreCompositeValue|computeCompositeWithCoverage|rsRawComposite' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE 'function stage2RejectDetail|function dailyLongBiasIssue|stage2RejectDetail\(|dailyLongBiasIssue\(' lib app --exclude-dir=node_modules --exclude-dir=.next
grep -RInE 'return (reject|rejectReason)|reasons\.push|actionable: false|return false|throw new Error' lib app --exclude-dir=node_modules --exclude-dir=.next | grep -Ei 'sin dato|sin datos|no disponible'
grep -RInE 'qualityGateReasons|baseRejectReason|applyQualityGate|from ["'"']@?/?.*qualityGate' lib app --exclude-dir=node_modules --exclude-dir=.next
# El comando anterior falló con: zsh:2: unmatched "
grep -RInE 'qualityGateReasons|baseRejectReason|applyQualityGate' lib app --exclude-dir=node_modules --exclude-dir=.next
```

## CONFIANZA

**Verificado leyendo código:** rama y HEAD; valores de `QUALITY_DEFAULTS` y expansión de `balanced`; activación de `FIELD_RULES`/`DISTANCE_RULES`; rutas de rechazo de `screenerFilterRejectReason`, `postFilterRejectReason`, Stage 2, quality gate, materialización y trade plan; fórmulas de `rsRawComposite`, RS quality, composite, finalización, leaderboards, listas, salud de mercado y narrativas; y consumidores de `qualityGateForResearchRow` en `lib/app` mediante el `rg` listado.

**Inferencia estática:** impacto cuantitativo concreto sobre un scan real, cuántas filas serían rechazadas y si una muestra productiva concreta se vaciaría. No se ejecutaron datos ni runtime, por lo que el informe afirma posibilidad y ruta de código, no frecuencia observada.

**No ejecutado:** tests, `npm`, navegador, servidor, scripts de proyecto, consultas SQL, Supabase/base de datos, commit, push o deploy.
