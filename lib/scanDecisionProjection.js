import { decisionTraceForRow } from "@/lib/decisionAudit";
import { compactObjectiveMetricAudit } from "@/lib/objectiveMetricTruth";
import { finiteOrNull } from "@/lib/supabaseServer";

export function prepareScanDecisionRow(row = {}, settingsOrExplanation = {}) {
  if (!row || typeof row !== "object") return {};
  return { ...row, decisionTrace: decisionTraceForRow(row, settingsOrExplanation) };
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
