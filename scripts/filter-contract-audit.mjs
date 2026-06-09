import assert from "node:assert/strict";
import fs from "node:fs/promises";

import {
  applyScreenerFilters,
  buildScreenerFilterExplainPlan,
  screenerFilterRejectReason,
} from "@/lib/screenerFilters";
import {
  DISTANCE_RULES,
  FIELD_RULES,
  FILTER_FIELDS,
  NEUTRAL_FIELD_VALUES,
  SCREENER_FILTER_QUERY_KEYS,
} from "@/lib/screenerFilterCatalog";

const MATRIX_PATH = process.env.FILTER_CONTRACT_MATRIX_PATH || "docs/methodology/filter-golden-matrix.json";
const MARKDOWN_OUTPUT = process.env.FILTER_CONTRACT_MARKDOWN !== "0";
const QUIET = process.env.FILTER_CONTRACT_QUIET === "1";
const OUTPUT_PATH = process.env.FILTER_CONTRACT_OUTPUT || (MARKDOWN_OUTPUT ? "docs/methodology/latest-filter-contract-audit.md" : "");

const BASE_FILTERS = {
  filterStrictness: "strict",
  setupMode: "any",
  requireStage2: false,
  requireSma200Up: false,
  requirePriceAboveSma50: false,
  requireRecentIpo: false,
  requireUpVolume: false,
  requireContractionsDecreasing: false,
  maxPriceFreshnessDays: 999,
  maxIpoAgeMonths: 999,
  minWeaknessScore: 35,
};

const FIELD_THRESHOLDS = {
  minPrice: 50,
  minMarketCap: 500_000_000,
  minAvgVolume: 500_000,
  minAvgTurnover: 10_000_000,
  minLatestVolume: 250_000,
  minLatestTurnover: 5_000_000,
  minRelativeVolume: 1.5,
  minVolumeSurgePct: 20,
  minUpDownVolRatio: 1,
  minVolumeEffectScore: 60,
  minShortFloatPct: 5,
  maxShortFloatPct: 10,
  minPerf3m: 10,
  minPerf6m: 20,
  minPerf12m: 30,
  maxHighsSpreadPct: 8,
  maxExtensionSma50: 25,
  maxDailyMove20dPct: 12,
  maxDailyRange20dPct: 16,
  maxRange63dPct: 55,
  maxVolatility63d: 60,
  maxDrawdown63d: 22,
  minContractionCount: 3,
  maxContraction1DepthPct: 25,
  maxContraction2DepthPct: 16,
  maxContraction3DepthPct: 8,
  maxLastContractionDepthPct: 8,
  maxBaseDepthPct: 35,
  minBaseWeeks: 7,
  maxBaseWeeks: 22,
  maxAbsDistanceToPivotPct: 6,
  maxVolumeDryUpRatio: 0.9,
  maxTightness10dPct: 12,
  minPatternQualityScore: 65,
  minRiskRewardScore: 70,
  minReturnToVol3m: 1.2,
  minReturnToDrawdown3m: 2,
  minAdProxyScore: 75,
  minEpsGrowthProxyScore: 70,
  minDataCoverageScore: 80,
  minTechnicalCoverageScore: 85,
  minFundamentalCoverageScore: 40,
  minRsBenchmarkRating: 90,
  minRsCountryPct: 80,
  minRsSectorPct: 80,
  minRsQualityScore: 75,
  minSectorScore: 70,
  minWeinsteinScore: 80,
  minMinerviniScore: 80,
  minMomentumScore: 70,
  minRiskScore: 70,
  minVolumeScore: 60,
  minLiquidityScore: 60,
  minTotalScore: 85,
};

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function mdEscape(value = "") {
  return String(value ?? "").replace(/\|/g, "/").replace(/\s+/g, " ").trim();
}

function fmt(value) {
  if (value === null || value === undefined || value === "") return "null";
  const n = Number(value);
  if (Number.isFinite(n)) return Math.abs(n) >= 1000 ? n.toLocaleString("en-US") : String(Number(n.toFixed(4)));
  return cleanText(value);
}

function rejectField(reason) {
  return reason?.field || reason?.key || "";
}

function epsilonFor(value) {
  const n = Math.abs(Number(value));
  if (!Number.isFinite(n)) return 0.1;
  if (n >= 1_000_000) return 1;
  if (n >= 1000) return 1;
  if (n >= 10) return 0.1;
  return 0.01;
}

function baseRow(overrides = {}) {
  return {
    symbol: "GOLDEN",
    companyName: "Golden Filter Row",
    country: "US",
    sector: "Technology",
    industry: "Application Software",
    theme: "Software / IA",
    currency: "USD",
    price: 100,
    marketCap: 1_000_000_000,
    avgVolume: 1_000_000,
    avgTurnover: 100_000_000,
    latestVolume: 900_000,
    latestTurnover: 90_000_000,
    relativeVolume: 1.4,
    volumeSurgePct: 30,
    upDownVolRatio: 1.4,
    volumeEffectScore: 82,
    shortPercentOfFloat: 3,
    perf3m: 28,
    perf6m: 45,
    perf12m: 72,
    sma50: 92,
    sma150: 82,
    sma200: 72,
    sma200Slope: 4,
    distance20d: -2,
    distance50d: -4,
    distance52w: -8,
    distanceATH: -12,
    highsSpreadPct: 5,
    extSma50: 8,
    maxDailyMove20dPct: 5,
    maxDailyRange20dPct: 7,
    range63dPct: 24,
    volatility63d: 28,
    maxDrawdown63d: 8,
    contractionsDecreasing: true,
    contractionCount: 3,
    contraction1DepthPct: 16,
    contraction2DepthPct: 10,
    contraction3DepthPct: 6,
    lastContractionDepthPct: 6,
    baseDepthPct: 22,
    baseWeeks: 11,
    absDistanceToPivotPct: 3,
    volumeDryUpRatio: 0.75,
    tightness10dPct: 6,
    patternQualityScore: 80,
    riskRewardScore: 82,
    returnToVol3m: 1.8,
    returnToDrawdown3m: 2.4,
    adProxyScore: 83,
    epsGrowthProxyScore: 76,
    dataCoverageScore: 92,
    technicalCoverageScore: 95,
    fundamentalCoverageScore: 75,
    rsGlobalPct: 90,
    rsRating: 88,
    rsCountryPct: 87,
    rsSectorPct: 84,
    rsQualityScore: 82,
    sectorScore: 78,
    weinsteinScore: 84,
    minerviniScore: 81,
    momentumScore: 86,
    riskScore: 77,
    volumeScore: 72,
    liquidityScore: 74,
    totalScore: 86,
    weaknessScore: 20,
    chartBarsCount: 252,
    priceFreshnessDays: 0,
    lastDate: "2026-06-05",
    ipoAgeMonths: 36,
    ipoDate: "2023-05-01",
    upVolume: true,
    ...overrides,
  };
}

function pivotWatchRow(overrides = {}) {
  return baseRow({
    patternDataStatus: "ok",
    patternEligible: true,
    consolidationCandidate: true,
    patternFamily: "pivot_squeeze",
    patternQualityScore: 78,
    baseDepthPct: 20,
    distanceToPivotPct: -4,
    absDistanceToPivotPct: 4,
    pivotClarityScore: 82,
    tightness10dPct: 4,
    rightSideTight: true,
    volumeDryUpRatio: .7,
    contractionCount: 2,
    contractionsDecreasing: true,
    contractionDepths: [12, 5],
    contraction1DepthPct: 12,
    contraction2DepthPct: 5,
    lastContractionDepthPct: 5,
    ...overrides,
  });
}

function rowWithMetric(metric, value, overrides = {}) {
  const coherence = metric === "price" && Number.isFinite(Number(value))
    ? { sma200: Number(value) - 1 }
    : {};
  return baseRow({ [metric]: value, ...coherence, ...overrides });
}

function withFilter(field, value, overrides = {}) {
  const modeOverride = field === "minWeaknessScore" ? { setupMode: "weakness" } : {};
  return { ...BASE_FILTERS, ...modeOverride, ...overrides, [field]: value };
}

function thresholdForField(field, rule = {}) {
  if (Object.hasOwn(FIELD_THRESHOLDS, field)) return FIELD_THRESHOLDS[field];
  if (rule.op === "max") return 10;
  return 10;
}

function caseItem({ id, area, field, metric = "", threshold = "", input = "", row, filters, expectPass, rejectField: expectedRejectField = "" }) {
  return {
    id,
    area,
    field,
    metric,
    threshold,
    input,
    row,
    filters,
    expectPass,
    expectedRejectField,
  };
}

function genericFieldCases() {
  const cases = [];
  for (const [field, rule] of Object.entries(FIELD_RULES)) {
    const threshold = thresholdForField(field, rule);
    const eps = epsilonFor(threshold);
    const failValue = rule.op === "max" ? threshold + eps : threshold - eps;
    cases.push(caseItem({
      id: `${field}-boundary-pass`,
      area: "synthetic-boundary",
      field,
      metric: rule.metric,
      threshold,
      input: threshold,
      row: rowWithMetric(rule.metric, threshold),
      filters: withFilter(field, threshold),
      expectPass: true,
    }));
    cases.push(caseItem({
      id: `${field}-${rule.op === "max" ? "above" : "below"}-reject`,
      area: "synthetic-boundary",
      field,
      metric: rule.metric,
      threshold,
      input: failValue,
      row: rowWithMetric(rule.metric, failValue),
      filters: withFilter(field, threshold),
      expectPass: false,
      rejectField: field,
    }));
    cases.push(caseItem({
      id: `${field}-null-reject`,
      area: "synthetic-null",
      field,
      metric: rule.metric,
      threshold,
      input: null,
      row: rowWithMetric(rule.metric, null),
      filters: withFilter(field, threshold),
      expectPass: false,
      rejectField: field,
    }));
  }
  return cases;
}

function distanceCases() {
  const cases = [];
  for (const [field, rule] of Object.entries(DISTANCE_RULES)) {
    const threshold = FIELD_THRESHOLDS[field] || 12;
    cases.push(caseItem({
      id: `${field}-drawdown-boundary-pass`,
      area: "synthetic-distance",
      field,
      metric: rule.metric,
      threshold,
      input: -threshold,
      row: rowWithMetric(rule.metric, -threshold),
      filters: withFilter(field, threshold),
      expectPass: true,
    }));
    cases.push(caseItem({
      id: `${field}-positive-extension-pass`,
      area: "synthetic-distance",
      field,
      metric: rule.metric,
      threshold,
      input: 2,
      row: rowWithMetric(rule.metric, 2),
      filters: withFilter(field, threshold),
      expectPass: true,
    }));
    cases.push(caseItem({
      id: `${field}-beyond-drawdown-reject`,
      area: "synthetic-distance",
      field,
      metric: rule.metric,
      threshold,
      input: -threshold - 0.1,
      row: rowWithMetric(rule.metric, -threshold - 0.1),
      filters: withFilter(field, threshold),
      expectPass: false,
      rejectField: field,
    }));
    cases.push(caseItem({
      id: `${field}-null-reject`,
      area: "synthetic-null",
      field,
      metric: rule.metric,
      threshold,
      input: null,
      row: rowWithMetric(rule.metric, null),
      filters: withFilter(field, threshold),
      expectPass: false,
      rejectField: field,
    }));
  }
  return cases;
}

function specialCases() {
  return [
    caseItem({ id: "minRsRating-global-boundary-pass", area: "synthetic-special", field: "minRsRating", metric: "rsGlobalPct", threshold: 90, input: 90, row: baseRow({ rsGlobalPct: 90, rsRating: 10 }), filters: withFilter("minRsRating", 90), expectPass: true }),
    caseItem({ id: "minRsRating-global-below-reject", area: "synthetic-special", field: "minRsRating", metric: "rsGlobalPct", threshold: 90, input: 89.9, row: baseRow({ rsGlobalPct: 89.9, rsRating: 99 }), filters: withFilter("minRsRating", 90), expectPass: false, rejectField: "minRsRating" }),
    caseItem({ id: "minRsRating-no-benchmark-fallback", area: "synthetic-special", field: "minRsRating", metric: "rsGlobalPct", threshold: 90, input: null, row: baseRow({ rsGlobalPct: null, rsRating: 99 }), filters: withFilter("minRsRating", 90), expectPass: false, rejectField: "minRsRating" }),

    caseItem({ id: "maxPriceFreshnessDays-boundary-pass", area: "synthetic-special", field: "maxPriceFreshnessDays", metric: "priceFreshnessDays", threshold: 5, input: 5, row: baseRow({ priceFreshnessDays: 5 }), filters: withFilter("maxPriceFreshnessDays", 5), expectPass: true }),
    caseItem({ id: "maxPriceFreshnessDays-stale-reject", area: "synthetic-special", field: "maxPriceFreshnessDays", metric: "priceFreshnessDays", threshold: 5, input: 6, row: baseRow({ priceFreshnessDays: 6 }), filters: withFilter("maxPriceFreshnessDays", 5), expectPass: false, rejectField: "maxPriceFreshnessDays" }),
    caseItem({ id: "maxPriceFreshnessDays-missing-date-reject", area: "synthetic-null", field: "maxPriceFreshnessDays", metric: "lastDate", threshold: 5, input: null, row: baseRow({ priceFreshnessDays: null, lastDate: "" }), filters: withFilter("maxPriceFreshnessDays", 5), expectPass: false, rejectField: "maxPriceFreshnessDays" }),

    caseItem({ id: "requireSma200Up-positive-pass", area: "synthetic-special", field: "requireSma200Up", metric: "sma200Slope", threshold: true, input: 0.1, row: baseRow({ sma200Slope: 0.1 }), filters: withFilter("requireSma200Up", true), expectPass: true }),
    caseItem({ id: "requireSma200Up-flat-reject", area: "synthetic-special", field: "requireSma200Up", metric: "sma200Slope", threshold: true, input: 0, row: baseRow({ sma200Slope: 0 }), filters: withFilter("requireSma200Up", true), expectPass: false, rejectField: "requireSma200Up" }),
    caseItem({ id: "requireSma200Up-null-reject", area: "synthetic-null", field: "requireSma200Up", metric: "sma200Slope", threshold: true, input: null, row: baseRow({ sma200Slope: null }), filters: withFilter("requireSma200Up", true), expectPass: false, rejectField: "requireSma200Up" }),

    caseItem({ id: "requirePriceAboveSma50-above-pass", area: "synthetic-special", field: "requirePriceAboveSma50", metric: "price/sma50", threshold: true, input: "100>99", row: baseRow({ price: 100, sma50: 99 }), filters: withFilter("requirePriceAboveSma50", true), expectPass: true }),
    caseItem({ id: "requirePriceAboveSma50-equality-reject", area: "synthetic-special", field: "requirePriceAboveSma50", metric: "price/sma50", threshold: true, input: "100=100", row: baseRow({ price: 100, sma50: 100 }), filters: withFilter("requirePriceAboveSma50", true), expectPass: false, rejectField: "requirePriceAboveSma50" }),
    caseItem({ id: "requirePriceAboveSma50-null-reject", area: "synthetic-null", field: "requirePriceAboveSma50", metric: "price/sma50", threshold: true, input: null, row: baseRow({ price: null, sma50: 100 }), filters: withFilter("requirePriceAboveSma50", true), expectPass: false, rejectField: "requirePriceAboveSma50" }),

    caseItem({ id: "requireUpVolume-true-pass", area: "synthetic-special", field: "requireUpVolume", metric: "upVolume", threshold: true, input: true, row: baseRow({ upVolume: true }), filters: withFilter("requireUpVolume", true), expectPass: true }),
    caseItem({ id: "requireUpVolume-false-reject", area: "synthetic-special", field: "requireUpVolume", metric: "upVolume", threshold: true, input: false, row: baseRow({ upVolume: false }), filters: withFilter("requireUpVolume", true), expectPass: false, rejectField: "requireUpVolume" }),
    caseItem({ id: "requireUpVolume-null-reject", area: "synthetic-null", field: "requireUpVolume", metric: "upVolume", threshold: true, input: null, row: baseRow({ upVolume: null }), filters: withFilter("requireUpVolume", true), expectPass: false, rejectField: "requireUpVolume" }),

    caseItem({ id: "requireContractionsDecreasing-true-pass", area: "synthetic-special", field: "requireContractionsDecreasing", metric: "contractionsDecreasing", threshold: true, input: true, row: baseRow({ contractionsDecreasing: true }), filters: withFilter("requireContractionsDecreasing", true), expectPass: true }),
    caseItem({ id: "requireContractionsDecreasing-false-reject", area: "synthetic-special", field: "requireContractionsDecreasing", metric: "contractionsDecreasing", threshold: true, input: false, row: baseRow({ contractionsDecreasing: false }), filters: withFilter("requireContractionsDecreasing", true), expectPass: false, rejectField: "requireContractionsDecreasing" }),
    caseItem({ id: "requireContractionsDecreasing-null-reject", area: "synthetic-null", field: "requireContractionsDecreasing", metric: "contractionsDecreasing", threshold: true, input: null, row: baseRow({ contractionsDecreasing: null }), filters: withFilter("requireContractionsDecreasing", true), expectPass: false, rejectField: "requireContractionsDecreasing" }),
    caseItem({ id: "pattern-data-blocked-rejects-structure-filter", area: "synthetic-special", field: "patternDataStatus", metric: "patternDataStatus", threshold: "pattern active", input: "insufficient_history", row: baseRow({ patternDataStatus: "insufficient_history", patternEligible: false, contractionCount: 3 }), filters: withFilter("minContractionCount", 2), expectPass: false, rejectField: "patternDataStatus" }),
    caseItem({ id: "pattern-invalid-structure-rejects-count-pass", area: "synthetic-special", field: "contractionStructureStatus", metric: "contractionStructureStatus", threshold: "pattern active", input: "lower_low_drift", row: baseRow({ patternDataStatus: "ok", patternEligible: true, contractionStructureStatus: "lower_low_drift", contractionCount: 3 }), filters: withFilter("minContractionCount", 2), expectPass: false, rejectField: "contractionStructureStatus" }),
    caseItem({ id: "pattern-valid-structure-allows-count-pass", area: "synthetic-special", field: "contractionStructureStatus", metric: "contractionStructureStatus", threshold: "pattern active", input: "ok", row: baseRow({ patternDataStatus: "ok", patternEligible: true, contractionStructureStatus: "ok", contractionCount: 3 }), filters: withFilter("minContractionCount", 2), expectPass: true }),
    caseItem({ id: "pattern-partial-volume-rejects-dry-up-filter", area: "synthetic-special", field: "patternDataStatus", metric: "patternVolumeEligible", threshold: "maxVolumeDryUpRatio", input: "partial_volume", row: baseRow({ patternDataStatus: "partial_volume", patternEligible: true, patternVolumeEligible: false, volumeDryUpRatio: 0.7 }), filters: withFilter("maxVolumeDryUpRatio", 0.9), expectPass: false, rejectField: "patternDataStatus" }),
    caseItem({ id: "pattern-display-data-limited-rejects-count-filter", area: "synthetic-special", field: "patternDataStatus", metric: "setupDisplayDataLimited", threshold: "pattern active", input: true, row: baseRow({ patternDataStatus: "ok", patternEligible: true, contractionStructureStatus: "ok", contractionCount: 3, setupDisplayDataLimited: true, setupDisplayBlocksPatternClaim: true, methodologyReliabilityState: "data_limited", methodologyBlocksPatternClaim: true }), filters: withFilter("minContractionCount", 2), expectPass: false, rejectField: "patternDataStatus" }),
    caseItem({ id: "pattern-partial-volume-allows-ohlc-count-filter", area: "synthetic-special", field: "minContractionCount", metric: "partial volume + OHLC contractions", threshold: 3, input: 3, row: baseRow({ patternDataStatus: "partial_volume", patternEligible: true, patternVolumeEligible: false, contractionStructureStatus: "ok", contractionCount: 3, contractionsDecreasing: true, setupDisplayBlocksPatternClaim: true, setupDisplayWatch: true, methodologyBlocksPatternClaim: true }), filters: { ...BASE_FILTERS, requireContractionsDecreasing: true, minContractionCount: 3 }, expectPass: true }),
    caseItem({ id: "pattern-blocked-full-claim-rejects-quality-filter", area: "synthetic-special", field: "patternDataStatus", metric: "blocked pattern quality", threshold: 65, input: 96, row: baseRow({ patternDataStatus: "partial_volume", patternEligible: true, patternVolumeEligible: false, contractionStructureStatus: "ok", patternQualityScore: 96, setupDisplayBlocksPatternClaim: true, setupDisplayWatch: true, methodologyBlocksPatternClaim: true }), filters: withFilter("minPatternQualityScore", 65), expectPass: false, rejectField: "patternDataStatus" }),

    caseItem({ id: "requireStage2-confirmed-pass", area: "synthetic-special", field: "requireStage2", metric: "stage2 structure", threshold: true, input: "confirmed", row: baseRow(), filters: withFilter("requireStage2", true, { setupMode: "any" }), expectPass: true }),
    caseItem({ id: "requireStage2-broken-stack-reject", area: "synthetic-special", field: "requireStage2", metric: "sma stack", threshold: true, input: "sma50<sma150", row: baseRow({ sma50: 70, sma150: 82 }), filters: withFilter("requireStage2", true, { setupMode: "any" }), expectPass: false, rejectField: "requireStage2" }),

    caseItem({ id: "requireRecentIpo-age-boundary-pass", area: "synthetic-special", field: "maxIpoAgeMonths", metric: "ipoAgeMonths", threshold: 12, input: 12, row: baseRow({ ipoAgeMonths: 12 }), filters: withFilter("requireRecentIpo", true, { setupMode: "any", maxIpoAgeMonths: 12 }), expectPass: true }),
    caseItem({ id: "requireRecentIpo-age-over-reject", area: "synthetic-special", field: "maxIpoAgeMonths", metric: "ipoAgeMonths", threshold: 12, input: 13, row: baseRow({ ipoAgeMonths: 13 }), filters: withFilter("requireRecentIpo", true, { setupMode: "any", maxIpoAgeMonths: 12 }), expectPass: false, rejectField: "requireRecentIpo" }),
    caseItem({ id: "requireRecentIpo-null-reject", area: "synthetic-null", field: "maxIpoAgeMonths", metric: "ipoAgeMonths", threshold: 12, input: null, row: baseRow({ ipoAgeMonths: null, ipoDate: "" }), filters: withFilter("requireRecentIpo", true, { setupMode: "any", maxIpoAgeMonths: 12 }), expectPass: false, rejectField: "requireRecentIpo" }),

    caseItem({ id: "setupMode-nearPivot-score-only-reject", area: "synthetic-mode", field: "setupMode", metric: "distance/spread/ext", threshold: "nearPivot", input: "-6/10/18 no method pivot", row: baseRow({ distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), filters: { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-nearPivot-boundary-pass", area: "synthetic-mode", field: "setupMode", metric: "method-pivot/distance/spread/ext", threshold: "nearPivot", input: "-4 pivot/-6/10/18", row: pivotWatchRow({ distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), filters: { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 }, expectPass: true }),
    caseItem({ id: "setupMode-nearPivot-contract-score-reject", area: "synthetic-mode", field: "setupMode", metric: "method-pivot/contract-score", threshold: "nearPivot", input: "score 40", row: pivotWatchRow({ totalScore: 40, rsGlobalPct: 82, distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), filters: { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-nearPivot-partial-volume-reject", area: "synthetic-mode", field: "setupMode", metric: "method-pivot/partial-volume", threshold: "nearPivot", input: "partial_volume", row: pivotWatchRow({ patternDataStatus: "partial_volume", distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), filters: { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-nearPivot-extension-reject", area: "synthetic-mode", field: "setupMode", metric: "extSma50", threshold: "nearPivot", input: 18.1, row: baseRow({ extSma50: 18.1 }), filters: { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 25 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-pullback-window-pass", area: "synthetic-mode", field: "setupMode", metric: "price/sma50/ext/distance52w/perf6m", threshold: "pullback", input: "100/100/0/-20/8", row: baseRow({ price: 100, sma50: 100, extSma50: 0, distance52w: -20, perf6m: 8 }), filters: { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, expectPass: true }),
    caseItem({ id: "setupMode-pullback-contract-score-reject", area: "synthetic-mode", field: "setupMode", metric: "composite", threshold: "pullback", input: 40, row: baseRow({ totalScore: 40, price: 100, sma50: 100, sma200: 70, extSma50: 0, distance52w: -20, perf6m: 12 }), filters: { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-pullback-stale-extension-reject", area: "synthetic-mode", field: "setupMode", metric: "price/sma50/ext", threshold: "pullback", input: "80/100/0", row: baseRow({ price: 80, sma50: 100, sma200: 70, extSma50: 0, distance52w: -20, perf6m: 12 }), filters: { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-pullback-extension-reject", area: "synthetic-mode", field: "setupMode", metric: "extSma50", threshold: "pullback", input: 10, row: baseRow({ extSma50: 10, distance52w: -20, perf6m: 12 }), filters: { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-early-boundary-pass", area: "synthetic-mode", field: "setupMode", metric: "distance52w/perf3m/ext", threshold: "early", input: "-35/5/20", row: baseRow({ distance52w: -35, perf3m: 5, extSma50: 20 }), filters: { ...BASE_FILTERS, setupMode: "early", minPerf3m: 5, maxExtensionSma50: 20 }, expectPass: true }),
    caseItem({ id: "setupMode-ipoRecent-boundary-pass", area: "synthetic-mode", field: "setupMode", metric: "ipo/momentum/ext", threshold: "ipoRecent", input: "10/35/35", row: baseRow({ ipoAgeMonths: 10, distance52w: -35, extSma50: 35, momentumScore: 35 }), filters: { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 }, expectPass: true }),
    caseItem({ id: "setupMode-ipoRecent-old-reject", area: "synthetic-mode", field: "setupMode", metric: "ipoAgeMonths", threshold: "ipoRecent", input: 13, row: baseRow({ ipoAgeMonths: 13, distance52w: -35, extSma50: 35, momentumScore: 35 }), filters: { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-ipoRecent-long-bias-reject", area: "synthetic-mode", field: "setupMode", metric: "ipo/long-bias", threshold: "ipoRecent", input: "price below SMA200", row: baseRow({ ipoAgeMonths: 10, price: 70, sma200: 100, distance52w: -20, extSma50: 20, momentumScore: 60 }), filters: { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-extended-boundary-pass", area: "synthetic-mode", field: "setupMode", metric: "price/sma50/ext/momentum", threshold: "extended", input: "115/100/15/65", row: baseRow({ price: 115, sma50: 100, extSma50: 15, momentumScore: 65 }), filters: { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 }, expectPass: true }),
    caseItem({ id: "setupMode-extended-stale-extension-reject", area: "synthetic-mode", field: "setupMode", metric: "price/sma50/ext", threshold: "extended", input: "90/100/15", row: baseRow({ price: 90, sma50: 100, sma200: 70, extSma50: 15, momentumScore: 80 }), filters: { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-extended-underextension-reject", area: "synthetic-mode", field: "setupMode", metric: "extSma50", threshold: "extended", input: 14.9, row: baseRow({ price: 114.9, sma50: 100, extSma50: 14.9, momentumScore: 80 }), filters: { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 }, expectPass: false, rejectField: "setupMode" }),
    caseItem({ id: "setupMode-weakness-boundary-pass", area: "synthetic-mode", field: "minWeaknessScore", metric: "weaknessScore", threshold: 55, input: 55, row: baseRow({ weaknessScore: 55 }), filters: { ...BASE_FILTERS, setupMode: "weakness", minWeaknessScore: 55 }, expectPass: true }),
    caseItem({ id: "setupMode-weakness-below-reject", area: "synthetic-mode", field: "minWeaknessScore", metric: "weaknessScore", threshold: 55, input: 54.9, row: baseRow({ weaknessScore: 54.9 }), filters: { ...BASE_FILTERS, setupMode: "weakness", minWeaknessScore: 55 }, expectPass: false, rejectField: "minWeaknessScore" }),
  ];
}

function frozenCases(dataset = {}) {
  const out = [];
  for (const item of dataset.frozenCases || []) {
    const row = baseRow({
      symbol: item.symbol || item.id,
      asOf: item.asOf || "",
      ...(item.row || {}),
    });
    for (const check of item.checks || []) {
      out.push(caseItem({
        id: `${item.id}:${check.id}`,
        area: "frozen-real",
        field: Object.keys(check.filter || {}).join(", "),
        metric: item.symbol || "",
        threshold: item.asOf || "",
        input: item.archetype || item.id,
        row,
        filters: { ...BASE_FILTERS, setupMode: "any", minWeaknessScore: 0, maxPriceFreshnessDays: 999, ...(check.filter || {}) },
        expectPass: check.expect?.pass === true,
        rejectField: check.expect?.rejectField || "",
      }));
    }
  }
  return out;
}

function evaluate(item) {
  const reason = screenerFilterRejectReason(item.row, item.filters);
  const actualPass = !reason;
  const actualRejectField = rejectField(reason);
  const rejectFieldOk = item.expectPass || !item.expectedRejectField || actualRejectField === item.expectedRejectField;
  const explain = buildScreenerFilterExplainPlan(item.row, item.filters);
  const explainPass = explain.status === "pass" || explain.status === "watch";
  const explainOk = actualPass ? explainPass : !explainPass;
  return {
    ...item,
    actualPass,
    actualRejectField,
    explainStatus: explain.status,
    explainText: explain.text,
    reason: reason?.reason || (!explainOk ? `explain ${explain.status}: ${explain.text}` : ""),
    ok: actualPass === item.expectPass && rejectFieldOk && explainOk,
  };
}

function coverageFailures() {
  const covered = new Set([
    ...Object.keys(FIELD_RULES),
    ...Object.keys(DISTANCE_RULES),
    "minRsRating",
    "maxPriceFreshnessDays",
    "maxIpoAgeMonths",
    "minWeaknessScore",
  ]);
  const fieldKeys = new Set(FILTER_FIELDS.map((field) => field.key));
  const queryKeys = new Set(SCREENER_FILTER_QUERY_KEYS);
  const failures = [];
  for (const field of FILTER_FIELDS) {
    if (!covered.has(field.key)) failures.push({ label: "visible-field-coverage", expected: "covered by matrix", actual: field.key });
    if (!queryKeys.has(field.key)) failures.push({ label: "query-key-coverage", expected: "visible field in query keys", actual: field.key });
    if (!Object.hasOwn(NEUTRAL_FIELD_VALUES, field.key)) failures.push({ label: "neutral-value", expected: "neutral value defined", actual: field.key });
  }
  for (const key of Object.keys(FIELD_RULES)) {
    if (!fieldKeys.has(key)) failures.push({ label: "field-rule-visible", expected: "FIELD_RULES key visible", actual: key });
  }
  for (const key of Object.keys(DISTANCE_RULES)) {
    if (!fieldKeys.has(key)) failures.push({ label: "distance-rule-visible", expected: "DISTANCE_RULES key visible", actual: key });
  }
  return failures;
}

function exactnessProbe() {
  const rows = [
    baseRow({ symbol: "RS89", rsGlobalPct: 89, rsRating: 99 }),
    baseRow({ symbol: "RS90", rsGlobalPct: 90, rsRating: 10 }),
  ];
  const result = applyScreenerFilters(rows, {
    enabled: true,
    values: { ...BASE_FILTERS, minRsRating: 90 },
  });
  return {
    passed: result.rows.map((row) => row.symbol),
    rejected: result.rejections.map((row) => row.symbol),
    ok: JSON.stringify(result.rows.map((row) => row.symbol)) === JSON.stringify(["RS90"]),
  };
}

function summaryByArea(results = []) {
  const map = new Map();
  for (const item of results) {
    const current = map.get(item.area) || { area: item.area, cases: 0, failed: 0 };
    current.cases += 1;
    if (!item.ok) current.failed += 1;
    map.set(item.area, current);
  }
  return [...map.values()].sort((a, b) => a.area.localeCompare(b.area));
}

function markdownReport(payload = {}) {
  const lines = [
    "# Filter Contract Audit",
    "",
    `Dataset version: ${payload.version || "unknown"}`,
    `Cases: ${payload.cases} · Passed: ${payload.passed} · Failed: ${payload.failed}`,
    `Synthetic: ${payload.syntheticCases} · Frozen: ${payload.frozenCases}`,
    `Visible fields covered: ${payload.coverage.covered}/${payload.coverage.total}`,
    `Guardrails: ${payload.guardrails.length ? payload.guardrails.map((item) => `${item.label} expected ${item.expected}, actual ${item.actual}`).join("; ") : "OK"}`,
    `Exactness probe: ${payload.exactness.ok ? "OK" : "FAIL"} · passed ${payload.exactness.passed.join(", ") || "-"} · rejected ${payload.exactness.rejected.join(", ") || "-"}`,
    "",
    "## Area Summary",
    "",
    "| Area | Cases | Failed |",
    "|---|---:|---:|",
  ];
  for (const item of payload.areaSummary || []) {
    lines.push(`| ${mdEscape(item.area)} | ${item.cases} | ${item.failed} |`);
  }
  lines.push(
    "",
    "## Matrix",
    "",
    "| Result | Area | Case | Filter | Metric | Threshold | Input | Expected | Actual | Reject field | Detail |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  for (const item of payload.results || []) {
    lines.push([
      item.ok ? "OK" : "FAIL",
      mdEscape(item.area),
      mdEscape(item.id),
      mdEscape(item.field),
      mdEscape(item.metric),
      mdEscape(fmt(item.threshold)),
      mdEscape(fmt(item.input)),
      item.expectPass ? "pass" : `reject ${item.expectedRejectField || ""}`.trim(),
      item.actualPass ? "pass" : "reject",
      mdEscape(item.actualRejectField || "-"),
      mdEscape(item.reason || "-"),
    ].join(" | "));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const dataset = JSON.parse(await fs.readFile(MATRIX_PATH, "utf8"));
  const synthetic = [...genericFieldCases(), ...distanceCases(), ...specialCases()];
  const frozen = frozenCases(dataset);
  assert.ok(synthetic.length > 0, "synthetic matrix must not be empty");
  assert.ok(frozen.length > 0, "frozen matrix must not be empty");

  const results = [...synthetic, ...frozen].map(evaluate);
  const failed = results.filter((item) => !item.ok);
  const coverage = coverageFailures();
  const exactness = exactnessProbe();
  const expectations = dataset.expectations || {};
  const guardrails = [];
  const maxFailures = Number(expectations.maxFailures);
  if (Number.isFinite(maxFailures) && failed.length > maxFailures) guardrails.push({ label: "maxFailures", expected: `<= ${maxFailures}`, actual: String(failed.length) });
  const minSynthetic = Number(expectations.minSyntheticCases);
  if (Number.isFinite(minSynthetic) && synthetic.length < minSynthetic) guardrails.push({ label: "minSyntheticCases", expected: `>= ${minSynthetic}`, actual: String(synthetic.length) });
  const minFrozen = Number(expectations.minFrozenCases);
  if (Number.isFinite(minFrozen) && frozen.length < minFrozen) guardrails.push({ label: "minFrozenCases", expected: `>= ${minFrozen}`, actual: String(frozen.length) });
  if (expectations.requireAllVisibleFieldsCovered === true && coverage.length) guardrails.push({ label: "visibleFieldCoverage", expected: "all visible fields covered", actual: coverage.map((item) => item.actual).join(", ") });
  if (!exactness.ok) guardrails.push({ label: "exactnessProbe", expected: "only RS90 passes", actual: `passed ${exactness.passed.join(", ")}` });

  const payload = {
    ok: failed.length === 0 && coverage.length === 0 && guardrails.length === 0 && exactness.ok,
    version: dataset.version,
    cases: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    syntheticCases: synthetic.length,
    frozenCases: frozen.length,
    coverage: {
      total: FILTER_FIELDS.length,
      covered: FILTER_FIELDS.length - coverage.filter((item) => item.label === "visible-field-coverage").length,
      failures: coverage,
    },
    exactness,
    guardrails,
    areaSummary: summaryByArea(results),
    results,
  };
  const output = MARKDOWN_OUTPUT ? markdownReport(payload) : JSON.stringify(payload, null, 2);
  if (OUTPUT_PATH) await fs.writeFile(OUTPUT_PATH, output, "utf8");
  if (QUIET) {
    console.log(`OK filter-contract-audit: ${payload.cases} cases, ${payload.failed} failed, ${payload.coverage.covered}/${payload.coverage.total} visible fields covered.`);
  } else {
    console.log(output);
  }

  if (!payload.ok) {
    const failedSummary = failed.slice(0, 12).map((item) => `${item.id}: expected ${item.expectPass ? "pass" : `reject ${item.expectedRejectField || ""}`}, got ${item.actualPass ? "pass" : `reject ${item.actualRejectField || ""}`}`).join(" | ");
    const guardrailSummary = guardrails.map((item) => `${item.label} expected ${item.expected}, got ${item.actual}`).join(" | ");
    const coverageSummary = coverage.slice(0, 12).map((item) => `${item.label}: ${item.actual}`).join(" | ");
    throw new Error(`filter contract audit failed: ${[failedSummary, guardrailSummary, coverageSummary].filter(Boolean).join(" | ")}`);
  }
}

main().catch((error) => {
  console.error(`FAIL filter-contract-audit: ${error.message}`);
  process.exitCode = 1;
});
