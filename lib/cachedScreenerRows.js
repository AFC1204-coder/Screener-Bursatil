import { businessThemeKey } from "@/lib/businessTheme";
import { countryCode } from "@/lib/symbols";

function sourceObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstPresent(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return null;
}

function fieldValue(item = {}, key = "") {
  const metrics = sourceObject(item.metrics);
  const raw = sourceObject(item.raw);
  return firstPresent(item[key], metrics[key], raw[key]);
}

function textField(item = {}, key = "", fallback = "") {
  const value = fieldValue(item, key);
  return value === null ? fallback : String(value);
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function numberField(item = {}, key = "", fallbackKey = "") {
  return finiteNumber(fieldValue(item, key)) ?? (fallbackKey ? finiteNumber(fieldValue(item, fallbackKey)) : null);
}

function boolField(item = {}, key = "") {
  const value = fieldValue(item, key);
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    if (/^(1|true|yes|y)$/i.test(value.trim())) return true;
    if (/^(0|false|no|n)$/i.test(value.trim())) return false;
  }
  return value ?? null;
}

function normalizedTheme(item = {}) {
  const sector = textField(item, "sector");
  const industry = textField(item, "industry");
  const hasBusinessTaxonomy = (sector && sector !== "Sin sector") || (industry && industry !== "Sin industria");
  if (hasBusinessTaxonomy) return businessThemeKey(sector, industry, textField(item, "businessSummary") || textField(item, "summary") || textField(item, "businessEs"));
  return textField(item, "theme", "General");
}

const NUMERIC_FIELDS = [
  "score",
  "totalScore",
  "rsGlobalPct",
  "rsRating",
  "rsCountryPct",
  "rsSectorPct",
  "rsQualityScore",
  "weinsteinScore",
  "minerviniScore",
  "dataCoverageScore",
  "priceFreshnessDays",
  "perf3m",
  "perf6m",
  "perf12m",
  "distance20d",
  "distance50d",
  "distance52w",
  "distanceATH",
  "avgTurnover",
  "marketCap",
  "price",
  "sma50",
  "sma150",
  "sma200",
  "sma200Slope",
  "extSma50",
  "weaknessScore",
  "setupQualityScore",
  "patternQualityScore",
  "contractionScore",
  "breakoutQualityScore",
  "distanceToPivotPct",
  "baseDepthPct",
  "baseWeeks",
  "absDistanceToPivotPct",
  "contractionCount",
  "contraction1DepthPct",
  "contraction2DepthPct",
  "contraction3DepthPct",
  "contraction4DepthPct",
  "lastContractionDepthPct",
  "rejectedContractionDepthPct",
  "contractionReductionPct",
  "volumeDryUpRatio",
  "patternFreshnessDays",
  "patternBarsCount",
  "patternMinBars",
  "patternCoveragePct",
  "patternOhlcCoveragePct",
  "patternVolumeCoveragePct",
  "tightness5dPct",
  "tightness10dPct",
  "tightness20dPct",
  "pivotClarityScore",
  "volumeDryUpScore",
  "baseQualityScore",
];

const TEXT_FIELDS = [
  "currency",
  "lastDate",
  "priceFreshnessLabel",
  "priceFreshnessIssue",
  "patternDataStatus",
  "patternFamily",
  "patternMaturity",
  "setupVerdictKey",
  "setupVerdictState",
  "setupVerdictLabel",
  "setupVerdictShortLabel",
  "setupVerdictReason",
  "setupVerdictEvidence",
  "setupVerdictTone",
  "setupDisplayKey",
  "setupDisplayState",
  "setupDisplayLabel",
  "setupDisplayShortLabel",
  "setupDisplayReason",
  "setupDisplayEvidence",
  "setupDisplayLine",
  "setupDisplayTone",
  "setupDisplayConfidenceKey",
  "setupDisplayConfidenceLabel",
  "setupDataConfidenceKey",
  "setupDataConfidenceLabel",
  "methodologyReliabilityState",
  "methodologyReliabilityLabel",
  "methodologyReliabilityReason",
  "contractionStructureStatus",
  "contractionStructureReason",
];

const BOOLEAN_FIELDS = [
  "patternEligible",
  "patternVolumeEligible",
  "consolidationCandidate",
  "contractionsDecreasing",
  "setupPlanValid",
  "setupActionable",
  "setupWatch",
  "setupStrict",
  "setupDisplayDataLimited",
  "setupDisplayBlocksPatternClaim",
  "setupDisplayPlanValid",
  "setupDisplayActionable",
  "setupDisplayObservable",
  "setupDisplayWatch",
  "setupDisplayStrict",
  "setupDisplayTradePlanEligible",
  "methodologyBlocksPatternClaim",
  "vcpCandidate",
  "breakoutAttempt",
  "pivotSqueeze",
  "failedBreakout",
];

export function normalizeCachedScreenerRow(item = {}) {
  const metrics = sourceObject(item.metrics);
  const raw = sourceObject(item.raw);
  const symbol = String(firstPresent(fieldValue(item, "symbol"), item.symbol) || "").toUpperCase();
  const row = {
    ...metrics,
    ...raw,
    ...item,
    symbol,
    companyName: textField(item, "companyName") || textField(item, "name") || symbol,
    country: textField(item, "country") || countryCode(symbol),
    sector: textField(item, "sector", "Sin sector"),
    industry: textField(item, "industry", "Sin industria"),
    theme: normalizedTheme(item),
    totalScore: numberField(item, "totalScore", "score"),
    sourceType: "materialized-cache",
  };

  for (const key of NUMERIC_FIELDS) {
    const value = key === "totalScore" ? numberField(item, "totalScore", "score") : numberField(item, key);
    if (value !== null) row[key] = value;
  }
  for (const key of TEXT_FIELDS) row[key] = textField(item, key);
  for (const key of BOOLEAN_FIELDS) row[key] = boolField(item, key);

  return row;
}
