import { decisionTraceForRow } from "@/lib/decisionAudit";
import { compactObjectiveMetricAudit } from "@/lib/objectiveMetricTruth";
import { compactChartPreview } from "@/lib/researchRowContract";
import { finiteOrNull } from "@/lib/supabaseServer";

export function prepareScanDecisionRow(row = {}, settingsOrExplanation = {}) {
  if (!row || typeof row !== "object") return {};
  return { ...row, decisionTrace: decisionTraceForRow(row, settingsOrExplanation) };
}

// Proyección de `raw` PARA PERSISTENCIA. Es la única diferencia entre la fila en
// memoria (que sigue completa: 96 barras OHLC, auditoría íntegra) y la que se
// guarda en scan_results.raw. Dos podas, ninguna observable en el producto:
//
//  1. chartPreview → serie compacta del contrato (48 puntos
//     date/close/sma50/sma200/volume, redondeados). Las tres MiniSparkline del
//     repo (lib/screenerAtoms.jsx, app/lists/page.jsx, app/review/page.jsx) son
//     idénticas y solo leen close, sma50, sma200 y volume; open/high/low no los
//     lee nadie. Además /api/scans ya servía esta misma proyección compacta en
//     su ruta por defecto (app/api/scans/route.js), así que la interfaz ya
//     estaba viendo 48 puntos ligeros: lo que cambia es que ahora no se
//     escriben 96 barras OHLC para tirar la mitad al leerlas.
//
//  2. objectiveMetricAudit y decisionTrace se omiten porque `metrics` ya los
//     lleva y es la copia que GANA: scanDecisionRowFromDb hace
//     assignPresent(row, raw) y después assignPresent(row, metrics), de modo
//     que la de metrics sobrescribe siempre a la de raw. Además es la única
//     disponible con ?projection=decision, que ni siquiera pide la columna raw.
//     objectiveMetricAuditForRow (lib/objectiveMetricTruth.js) también prefiere
//     metrics sobre raw. Ninguna superficie leía la copia de raw.
//
// NO elimina los campos: siguen en `metrics`. Solo deja de escribirlos dos veces.
export function scanDecisionRaw(row = {}) {
  if (!row || typeof row !== "object") return {};
  const { objectiveMetricAudit, decisionTrace, ...rest } = row;
  if (Array.isArray(rest.chartPreview)) rest.chartPreview = compactChartPreview(rest.chartPreview);
  return rest;
}

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
    marketCap: row.marketCap ?? null,
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
    // "batch" mientras el scan está en progreso (percentiles calculados dentro
    // del batch de scoring); "final" tras el paso de finalización al completar
    // el scan (percentiles recalculados sobre el universo completo). Default
    // "batch" para filas históricas pre-finalización y para inserts en progreso.
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

function coerceNumber(row, key) {
  const value = finiteOrNull(row[key]);
  if (value != null) row[key] = value;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function assignPresent(target, source = {}) {
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== null) target[key] = value;
  }
  return target;
}

export function scanDecisionRowFromDb(item = {}, { decisionProjection = false } = {}) {
  const raw = objectOrEmpty(item.raw);
  const metrics = objectOrEmpty(item.metrics);
  const row = {};
  assignPresent(row, raw);
  assignPresent(row, metrics);
  assignPresent(row, {
    symbol: item.symbol,
    companyName: item.company_name,
    country: item.country,
    sector: item.sector,
    industry: item.industry,
    theme: item.theme,
    totalScore: finiteOrNull(item.total_score),
    weinsteinScore: finiteOrNull(item.weinstein_score),
    minerviniScore: finiteOrNull(item.minervini_score),
    riskScore: finiteOrNull(item.risk_score),
    rsRating: finiteOrNull(item.rs_rating),
  });

  [
    "totalScore",
    "compositeScore",
    "objectiveScore",
    "objectiveSetupScore",
    "patternScore",
    "patternContributionScore",
    "price",
    "chartBarsCount",
    "patternBarsCount",
    "dataCoverageScore",
    "technicalCoverageScore",
    "fundamentalCoverageScore",
    "profileCoverageScore",
    "priceFreshnessDays",
    "priceFreshnessMaxDays",
    "weinsteinScore",
    "minerviniScore",
    "riskScore",
    "rsRating",
    "rsGlobalPct",
    "rsCountryPct",
    "rsSectorPct",
    "rsGlobalSample",
    "rsCountrySample",
    "rsSectorSample",
    "rsQualityScore",
    "setupQualityScore",
    "demandScore",
    "growthScore",
    "epsGrowthProxyScore",
    "sectorScore",
    "groupStrengthScore",
    "riskRewardScore",
    "momentumScore",
    "ipoScore",
    "adProxyScore",
    "volumeEffectScore",
    "upDownVolRatio",
  ].forEach((key) => coerceNumber(row, key));

  if (decisionProjection) {
    const missing = [];
    if (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount <= 0) {
      if (Number.isFinite(row.patternBarsCount) && row.patternBarsCount > 0) row.chartBarsCount = row.patternBarsCount;
      else missing.push("chartBarsCount");
    }
    if (!Number.isFinite(row.price) || row.price <= 0) missing.push("price");
    if (missing.length) {
      row.decisionProjectionPartial = true;
      row.decisionProjectionMissing = missing;
    }
  }

  return row;
}
