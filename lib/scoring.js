// lib/scoring.js — fachada de compatibilidad.
// La fuente única de verdad del scoring vive en lib/scoringEngine.js.
// Este módulo re-exporta las señales del composite desde el engine y conserva
// localmente las funciones no-registry (diagnósticas y de catálogo) que aún
// consumen app/, lib/screenerPipeline.js, lib/screenerResultView.js y tests/.
//
// Lista completa de consumidores preservados por esta fachada:
//   - app/page.jsx                              (compositeLabel, volumeEvidence)
//   - app/review/page.jsx                       (objectiveStage)
//   - lib/researchRow.js                        (ipoAgeMonthsForRow, monthsSince, scoreXxx…)
//   - lib/screenerMarket.jsx                    (ipoAgeMonthsForRow)
//   - lib/screenerPipeline.js                   (compositeLabel, compositeNarrative, gt, lt,
//                                                REJECTION_META, regimeRejectReason, rejectReason,
//                                                scoreXxx…, scoreIpo, scorePatternQuality, etc.)
//   - lib/screenerResultView.js                 (gt, gte, lte, isStage2)
//   - tests/scoring.test.js                     (múltiple)
//   - scripts/refactor-check/after.mjs          (export *)

import { firstFinite } from "@/lib/indicators";
import { metricShortLabel } from "@/lib/metricCatalog";
import { rsUniverseValue, rsBenchmarkValue } from "@/lib/relativeStrength";
import { isConfirmedStage2 } from "@/lib/trendStructure";
import { userFacingSearchError } from "@/lib/screenerFormat";
import { gte, gt, lt as _lt } from "@/lib/scoringEngine"; // gte/gt/lt se usan en volumeEvidence, compositeNarrative

// Re-export verbatim desde el engine: 19 señales del composite + scoreWeakness
// (diagnóstica, registrada en SIGNAL_REGISTRY) + helpers + composite + label.
export {
  // Helpers
  gt, gte, lt, lte, between,
  // Registro y composite
  SIGNAL_REGISTRY, COMPOSITE_WEIGHTS, computeSignal, computeComposite, compositeLabel,
  // API canónica (señales del composite)
  scoreWeinstein, scoreMinervini, scoreMomentum, scoreRisk, scoreRiskReward,
  scoreVolumeEffect, scoreVolume, scoreLiquidity, scoreIpo,
  scoreObjectiveSetupQuality, scorePatternContribution, scorePatternQuality,
  scoreSetupQuality, scoreCompositeValue, scoreDemandQuality,
  scoreGrowthQuality, scoreEpsGrowthProxy, scoreAdProxy,
  // Diagnósticas (consumers: lib/screenerFilters.js, lib/materializedScanner.js,
  // lib/researchRow.js, lib/screenerPipeline.js)
  scoreWeakness,
} from "@/lib/scoringEngine";

// Alias legacy: lib/researchRow.js importa scoreLiq; el engine lo llama liquidityScore.
export { scoreLiquidity as scoreLiq } from "@/lib/scoringEngine";

// `lt` lo necesitamos como binding local para compositeNarrative; gte/gt ya
// exportados como named import satisfacen los usos internos.
const lt = _lt;

// ---------------------------------------------------------------------------
// Funciones NO-registry: diagnósticas y de catálogo.
// Quedan locales porque ninguna entra al composite; moverlas ahora ensancharía
// el scope de esta tarea sin valor para la consolidación.
// ---------------------------------------------------------------------------

function monthsSince(d) {
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const n = new Date();
  return (n.getFullYear() - x.getFullYear()) * 12 + n.getMonth() - x.getMonth();
}

function ipoAgeMonthsForRow(row = {}) {
  const direct = firstFinite(row.ipoAgeMonths, row.snapshot?.ipoAgeMonths);
  return Number.isFinite(direct) ? direct : monthsSince(row.ipoDate || row.snapshot?.ipoDate || "");
}

function rsPrimaryScore(row = {}) {
  return rsUniverseValue(row) ?? rsBenchmarkValue(row) ?? 50;
}

function volumeEvidence(r = {}) {
  const parts = [];
  if (gte(r.latestTurnover, 10000000)) parts.push("importe sesion >=10M");
  else if (gte(r.latestTurnover, 3000000)) parts.push("importe sesion >=3M");
  if (gte(r.relativeVolume, 1.6)) parts.push("relVol >=1.6x");
  else if (gte(r.relativeVolume, 1.2)) parts.push("relVol >=1.2x");
  if (gte(r.volumeSurgePct, 35)) parts.push("5d +35%");
  else if (gte(r.volumeSurgePct, 15)) parts.push("5d +15%");
  if (gte(r.upDownVolRatio, 1.25)) parts.push("up/down >=1.25x");
  return parts.length ? parts.slice(0, 4).join(" · ") : "sin efecto objetivo";
}

function compositeNarrative(r) {
  const reasons = [];
  const risks = [];
  const rsUniverse = rsUniverseValue(r);
  const rsBenchmark = rsBenchmarkValue(r);
  const rsPrimary = Number.isFinite(rsUniverse) ? rsUniverse : (rsBenchmark ?? 0);
  if (isStage2(r)) reasons.push("Stage 2 confirmado");
  if (Number.isFinite(rsUniverse) && rsUniverse >= 85) reasons.push("RS líder");
  else if (Number.isFinite(rsUniverse) && rsUniverse >= 80) reasons.push("RS alto");
  else if (Number.isFinite(rsUniverse) && rsUniverse >= 65) reasons.push("RS positivo");
  else if (!Number.isFinite(rsUniverse) && Number.isFinite(rsBenchmark) && rsBenchmark >= 75) reasons.push("RS Benchmark fuerte sin RS");
  if ((r.rsQualityScore || 0) >= 72) reasons.push("RS calidad alta");
  if ((r.rsCountryPct || 0) >= 80) reasons.push("RS país fuerte");
  if ((r.rsSectorPct || 0) >= 80) reasons.push("RS Grupo fuerte");
  if ((r.sectorScore || 0) >= 70) reasons.push("Grupo fuerte");
  if ((r.growthScore || 0) >= 70) reasons.push("Crecimiento/calidad superior");
  if ((r.riskRewardScore || 0) >= 70) reasons.push("Rentabilidad/riesgo eficiente");
  if (gte(r.distance52w, -10)) reasons.push("Cerca de máximos");
  if ((r.demandScore || 0) >= 70) reasons.push("Demanda y liquidez sanas");
  if (gt(r.extSma50, 22)) risks.push("Extendida sobre SMA50");
  if ((r.riskScore || 0) < 45) risks.push("Riesgo técnico alto");
  if (rsPrimary < 40) risks.push(Number.isFinite(rsUniverse) ? "RS débil" : "RS Benchmark débil sin RS");
  if ((r.speculationRiskScore || 0) >= 70) risks.push("Volatilidad especulativa");
  else if ((r.speculationRiskScore || 0) >= 55) risks.push("RS volátil");
  if (gt(r.maxDrawdown63d, 30)) risks.push("Drawdown reciente elevado");
  if (gt(r.volatility63d, 70)) risks.push("Volatilidad elevada");
  if ((r.volumeScore || 0) < 35) risks.push("Volumen limitado");
  if ((r.growthScore || 0) < 45) risks.push("Fundamentales insuficientes/débiles");
  if (lt(r.distance52w, -25)) risks.push("Lejos de máximos");
  if (!reasons.length) reasons.push("Candidato exploratorio");
  if (!risks.length) risks.push("Sin alerta principal");
  return { reasons: reasons.slice(0, 4), risks: risks.slice(0, 3) };
}

function isStage2(row) {
  return isConfirmedStage2(row);
}

const REJECTION_META = {
  provider: { label: "Datos proveedor", stage: "Datos" },
  liquidity: { label: "Liquidez", stage: "Puerta" },
  coverage: { label: "Cobertura", stage: "Puerta" },
  relativeStrength: { label: "Fuerza relativa", stage: "Score" },
  volumeSurge: { label: "Volumen objetivo", stage: "Opcional" },
  shortInterest: { label: metricShortLabel("shortPercentOfFloat"), stage: "Opcional" },
  riskReward: { label: "Rentabilidad/riesgo", stage: "Opcional" },
  volatility: { label: "Volatilidad/rango", stage: "Puerta" },
  pattern: { label: "Estructura", stage: "Patrones" },
  trend: { label: "Tendencia", stage: "Puerta" },
  proximity: { label: "Cercanía a máximos", stage: "Puerta" },
  momentum: { label: "Momentum", stage: "Puerta" },
  score: { label: "Calidad minima", stage: "Score" },
  ipo: { label: "IPO real", stage: "Opcional" },
  mode: { label: "Setup", stage: "Modo" },
  weakness: { label: "Deterioro", stage: "Modo" },
  regime: { label: "Regimen de mercado", stage: "Contexto" },
  post: { label: "Post filtro", stage: "Score" },
};

function rejectReason(key, detail, field = "") {
  const meta = REJECTION_META[key] || { label: key || "Filtro", stage: "Filtro" };
  return { key, label: meta.label, stage: meta.stage, detail, field };
}

function regimeRejectReason(row, marketHealth, enabled, set = {}) {
  if (set.setupMode === "weakness" || !enabled || !marketHealth?.marketScore) return null;
  const s = marketHealth.marketScore;
  const objectiveScore = firstFinite(row.objectiveScore, row.totalScore, row.compositeScore) ?? 0;
  if (s >= 75) return null;
  if (s >= 55) return objectiveScore >= 60 && row.riskScore >= 45 && row.weinsteinScore >= 55 ? null : rejectReason("regime", "Régimen exige score compuesto >= 60, risk >= 45 y Weinstein >= 55");
  if (s >= 40) return objectiveScore >= 72 && row.riskScore >= 55 && row.weinsteinScore >= 65 && row.minerviniScore >= 55 ? null : rejectReason("regime", "Régimen exige score compuesto >= 72, risk >= 55, Weinstein >= 65 y Minervini >= 55");
  return objectiveScore >= 82 && row.riskScore >= 65 && row.weinsteinScore >= 75 && row.minerviniScore >= 65 ? null : rejectReason("regime", "Régimen exige score compuesto >= 82, risk >= 65, Weinstein >= 75 y Minervini >= 65");
}

function regimeFiltered(list, marketHealth, enabled, set = {}) {
  return list.filter((r) => !regimeRejectReason(r, marketHealth, enabled, set));
}

function value(row = {}, key) {
  return row[key] ?? row.snapshot?.[key] ?? null;
}

function objectiveStage(row = {}) {
  const price = value(row, "price");
  const sma50 = value(row, "sma50");
  const sma150 = value(row, "sma150");
  const sma200 = value(row, "sma200");
  const slope = value(row, "sma200Slope");
  if ([price, sma50, sma150, sma200].every(Number.isFinite) && price > sma50 && sma50 > sma150 && sma150 > sma200 && slope > 0) return "Precio > SMA50 > SMA150 > SMA200";
  if (Number.isFinite(price) && Number.isFinite(sma200) && price < sma200) return "Precio < SMA200";
  if (Number.isFinite(price) && Number.isFinite(sma50) && price < sma50) return "Precio < SMA50";
  if (Number.isFinite(price) && Number.isFinite(sma200) && price > sma200) return "Precio > SMA200";
  return userFacingSearchError("Historico insuficiente");
}

export {
  monthsSince,
  ipoAgeMonthsForRow,
  rsPrimaryScore,
  volumeEvidence,
  // scoreWeakness ya se re-exporta desde @/lib/scoringEngine al inicio del archivo.
  compositeNarrative,
  isStage2,
  REJECTION_META,
  rejectReason,
  regimeRejectReason,
  regimeFiltered,
  objectiveStage,
};