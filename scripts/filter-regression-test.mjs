import assert from "node:assert/strict";

import {
  applyScreenerFilters,
  buildScreenerFilterExplainPlan,
  effectiveScreenerFilterValues,
  screenerFilterRejectReason,
  screenerFiltersFromParams,
} from "@/lib/screenerFilters";
import {
  ALL_FILTER_LAYERS,
  BOOLEAN_FILTER_KEYS,
  DEFAULT_FIELD_RULES,
  DISTANCE_RULES,
  FIELD_RULES,
  FILTER_FIELDS,
  FILTER_FIELD_LAYERS,
  FILTER_STRICTNESS_KEYS,
  NEUTRAL_FIELD_VALUES,
  SCREENER_FILTER_PRESETS,
  SCREENER_FILTER_QUERY_KEYS,
  SCREENER_WEB_FILTER_PRESETS,
  SETTING_LAYER_DEPENDENCIES,
  SETUP_MODE_DEFAULTS,
  SETUP_MODES,
  STRING_FILTER_KEYS,
} from "@/lib/screenerFilterCatalog";
import { buildScreenerContract, buildScreenerStockContext, isScreenerLongContract, screenerContractKeyForSettings, screenerStockContextFromSession } from "@/lib/screenerContracts";
import { alertSyncSummary } from "@/app/api/alerts/route.js";
import { favoriteDeleteSummary, favoriteSyncSummary } from "@/app/api/favorites/route.js";
import { resultPayload, scanDeleteSummary, scanSyncSummary } from "@/app/api/scans/route.js";
import { settingSyncSummary } from "@/app/api/settings/route.js";
import { mergeAlertsWithTimestamps, mergeByKey, mergeFavoritesWithTombstones, mergeScansWithTombstones } from "@/lib/cloudSyncClient";
import { normalizeCachedScreenerRow } from "@/lib/cachedScreenerRows";
import { comparablePatternUsable, comparableScore, normalizeComparableResult } from "@/lib/comparables";
import { buildDiscoverySnapshot } from "@/lib/discovery";
import { auditIssueLabels, buildCoverageAudit } from "@/lib/discoveryAudit";
import { buildLeaderboard } from "@/lib/leaderboards";
import { latestScanStateFromRow, scanResultPayload as materializedScanResultPayload } from "@/lib/materializedScanner";
import { buildSavedListView, listViewHref, listViewSignature, normalizeSavedListViews, savedListViewMetaLine } from "@/lib/listViews";
import { buildGroupListDrilldown, enforceListContractRows, isBullishListKey, listContractForKey, listInclusionReasons, listInclusionSummary, rowPassesListContract, rowReliabilityIssues, summarizeListReliability } from "@/lib/listRationale";
import { methodologyCompactDetailLine, methodologyDisplayForRow, methodologyPatternEvidenceBonus, methodologyPatternEvidenceUsable } from "@/lib/methodologyDisplay";
import { enrichRowsWithMethodology, methodologyEvents, setupTagsForRow } from "@/lib/methodologyEngine";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { createFavoriteFromRow, favoriteToRow, isLongOpportunityRow, isRecentIpo, normalizeStockRows } from "@/lib/stockRows";
import { isConfirmedStage2, stage2RejectDetail } from "@/lib/trendStructure";

const BASE_FILTERS = {
  filterStrictness: "balanced",
  setupMode: "any",
  requireStage2: false,
  requireSma200Up: false,
  requirePriceAboveSma50: false,
  requireRecentIpo: false,
  requireUpVolume: false,
  maxPriceFreshnessDays: 999,
  maxIpoAgeMonths: 999,
};

const MIN_FIELD_CASES = [
  ["minPrice", "price", 50, 49, { sma50: 35, sma150: 30, sma200: 25 }],
  ["minMarketCap", "marketCap", 500_000_000, 499_999_999],
  ["minAvgVolume", "avgVolume", 500_000, 499_999],
  ["minAvgTurnover", "avgTurnover", 10_000_000, 9_999_999],
  ["minLatestVolume", "latestVolume", 250_000, 249_999],
  ["minLatestTurnover", "latestTurnover", 5_000_000, 4_999_999],
  ["minRelativeVolume", "relativeVolume", 1.5, 1.49],
  ["minVolumeSurgePct", "volumeSurgePct", 20, 19.9],
  ["minUpDownVolRatio", "upDownVolRatio", 1, 0.99],
  ["minVolumeEffectScore", "volumeEffectScore", 60, 59.9],
  ["minShortFloatPct", "shortPercentOfFloat", 5, 4.9],
  ["minPerf3m", "perf3m", 10, 9.9],
  ["minPerf6m", "perf6m", 20, 19.9],
  ["minPerf12m", "perf12m", 30, 29.9],
  ["minRiskRewardScore", "riskRewardScore", 70, 69.9],
  ["minReturnToVol3m", "returnToVol3m", 1.2, 1.19],
  ["minReturnToDrawdown3m", "returnToDrawdown3m", 2, 1.99],
  ["minAdProxyScore", "adProxyScore", 75, 74.9],
  ["minEpsGrowthProxyScore", "epsGrowthProxyScore", 70, 69.9],
  ["minDataCoverageScore", "dataCoverageScore", 80, 79.9],
  ["minTechnicalCoverageScore", "technicalCoverageScore", 85, 84.9],
  ["minFundamentalCoverageScore", "fundamentalCoverageScore", 40, 39.9],
  ["minRsBenchmarkRating", "rsRating", 90, 89.9],
  ["minRsCountryPct", "rsCountryPct", 80, 79.9],
  ["minRsSectorPct", "rsSectorPct", 80, 79.9],
  ["minRsQualityScore", "rsQualityScore", 75, 74.9],
  ["minSectorScore", "sectorScore", 70, 69.9],
  ["minWeinsteinScore", "weinsteinScore", 80, 79.9],
  ["minMinerviniScore", "minerviniScore", 80, 79.9],
  ["minMomentumScore", "momentumScore", 70, 69.9],
  ["minRiskScore", "riskScore", 70, 69.9],
  ["minVolumeScore", "volumeScore", 60, 59.9],
  ["minLiquidityScore", "liquidityScore", 60, 59.9],
  ["minTotalScore", "totalScore", 85, 84.9],
  ["minRsRating", "rsGlobalPct", 99, 98.9],
];

const MAX_FIELD_CASES = [
  ["maxShortFloatPct", "shortPercentOfFloat", 10, 10.1],
  ["maxHighsSpreadPct", "highsSpreadPct", 8, 8.1],
  ["maxExtensionSma50", "extSma50", 25, 25.1],
  ["maxDailyMove20dPct", "maxDailyMove20dPct", 12, 12.1],
  ["maxDailyRange20dPct", "maxDailyRange20dPct", 16, 16.1],
  ["maxRange63dPct", "range63dPct", 55, 55.1],
  ["maxVolatility63d", "volatility63d", 60, 60.1],
  ["maxDrawdown63d", "maxDrawdown63d", 22, 22.1],
];

const DISTANCE_CASES = [
  ["maxDistance20dHigh", "distance20d", 6],
  ["maxDistance50dHigh", "distance50d", 12],
  ["maxDistance52w", "distance52w", 20],
  ["maxDistanceATH", "distanceATH", 35],
];

function assertSubset(name, values, allowed) {
  for (const value of values) {
    assert.ok(allowed.has(value), `${name} contains unknown key "${value}"`);
  }
}

function runFilterCatalogContractTests() {
  const queryKeys = new Set(SCREENER_FILTER_QUERY_KEYS);
  const filterFieldKeys = FILTER_FIELDS.map((field) => field.key);
  const fieldKeys = new Set(filterFieldKeys);
  const layerKeys = new Set(Object.keys(ALL_FILTER_LAYERS));
  const modeKeys = new Set(SETUP_MODES.map(([key]) => key));
  const specialQueryKeys = new Set([
    "filterPreset",
    "filterStrictness",
    "setupMode",
    "requireStage2",
    "requireSma200Up",
    "requirePriceAboveSma50",
    "requireRecentIpo",
    "requireUpVolume",
    "requireContractionsDecreasing",
    "stageFastWeeks",
    "stageSlowWeeks",
    "stageSlopeWeeks",
  ]);
  const engineRuleKeys = new Set([
    ...Object.keys(FIELD_RULES),
    ...Object.keys(DISTANCE_RULES),
    "minRsRating",
    "minWeaknessScore",
    "maxPriceFreshnessDays",
    "maxIpoAgeMonths",
  ]);
  const presetValueKeys = new Set([...queryKeys, "maxSymbols"]);

  assert.equal(new Set(SCREENER_FILTER_QUERY_KEYS).size, SCREENER_FILTER_QUERY_KEYS.length, "filter query keys must be unique");
  assert.equal(new Set(filterFieldKeys).size, filterFieldKeys.length, "visible filter field keys must be unique");

  assertSubset("boolean filters", BOOLEAN_FILTER_KEYS, queryKeys);
  assertSubset("string filters", STRING_FILTER_KEYS, queryKeys);
  assertSubset("filter fields", fieldKeys, queryKeys);
  assertSubset("field rules", Object.keys(FIELD_RULES), fieldKeys);
  assertSubset("distance rules", Object.keys(DISTANCE_RULES), fieldKeys);

  for (const field of FILTER_FIELDS) {
    assert.ok(Object.hasOwn(DEFAULT_FIELD_RULES, field.key), `${field.key} must have a default field-rule state`);
    assert.ok(Object.hasOwn(NEUTRAL_FIELD_VALUES, field.key), `${field.key} must have a neutral value`);
    assert.ok(FILTER_FIELD_LAYERS[field.key]?.length, `${field.key} must declare at least one execution layer`);
    assertSubset(`${field.key} layers`, FILTER_FIELD_LAYERS[field.key], layerKeys);
    assert.ok(engineRuleKeys.has(field.key), `${field.key} must be enforced by a generic or special screener rule`);
  }

  for (const key of queryKeys) {
    assert.ok(fieldKeys.has(key) || specialQueryKeys.has(key), `${key} must be visible as a field or documented as a special filter key`);
  }

  for (const [presetKey, preset] of Object.entries(SCREENER_FILTER_PRESETS)) {
    assert.ok(preset.name && preset.desc, `${presetKey} preset must expose name and description`);
    assertSubset(`${presetKey} preset values`, Object.keys(preset.v || {}), presetValueKeys);
    assert.ok(FILTER_STRICTNESS_KEYS.has(preset.v.filterStrictness || "balanced"), `${presetKey} preset must use a known strictness`);
    assert.ok(modeKeys.has(preset.v.setupMode || "leader"), `${presetKey} preset must use a known setup mode`);
  }

  for (const [presetKey, values] of Object.entries(SCREENER_WEB_FILTER_PRESETS)) {
    assert.equal(Object.hasOwn(values, "maxSymbols"), false, `${presetKey} web preset must not expose internal maxSymbols`);
    assertSubset(`${presetKey} web preset values`, Object.keys(values || {}), queryKeys);
  }

  for (const [modeKey, defaults] of Object.entries(SETUP_MODE_DEFAULTS)) {
    assert.ok(modeKeys.has(modeKey), `${modeKey} defaults must map to a visible setup mode`);
    assertSubset(`${modeKey} setup defaults`, Object.keys(defaults || {}), queryKeys);
  }

  for (const [key, dependency] of Object.entries(SETTING_LAYER_DEPENDENCIES)) {
    assert.ok(queryKeys.has(key), `${key} layer dependency must point to a query filter`);
    assert.ok(layerKeys.has(dependency.layer), `${key} layer dependency must point to an existing layer`);
  }
}

function baseRow(overrides = {}) {
  return {
    symbol: "BASE",
    companyName: "Base Test Corp.",
    country: "US",
    theme: "Software",
    sector: "Technology",
    industry: "Application Software",
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
    lastDate: new Date().toISOString().slice(0, 10),
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

function rejectField(reason) {
  return reason?.field || reason?.key || "";
}

function expectPass(label, row, filters) {
  const reason = screenerFilterRejectReason(row, filters);
  assert.equal(reason, "", `${label} should pass, rejected by ${JSON.stringify(reason)}`);
}

function expectReject(label, row, filters, field) {
  const reason = screenerFilterRejectReason(row, filters);
  assert.ok(reason, `${label} should reject`);
  assert.equal(rejectField(reason), field, `${label} rejected by unexpected field: ${JSON.stringify(reason)}`);
}

function withFilter(field, value, overrides = {}) {
  return { ...BASE_FILTERS, ...overrides, [field]: value };
}

function runThresholdMatrix() {
  for (const [field, metric, threshold, failingValue, extraRow = {}] of MIN_FIELD_CASES) {
    expectPass(
      `${field} accepts equality`,
      baseRow({ ...extraRow, [metric]: threshold }),
      withFilter(field, threshold),
    );
    expectReject(
      `${field} rejects below threshold`,
      baseRow({ ...extraRow, [metric]: failingValue }),
      withFilter(field, threshold),
      field,
    );
  }

  for (const [field, metric, threshold, failingValue] of MAX_FIELD_CASES) {
    expectPass(
      `${field} accepts equality`,
      baseRow({ [metric]: threshold }),
      withFilter(field, threshold),
    );
    expectReject(
      `${field} rejects above threshold`,
      baseRow({ [metric]: failingValue }),
      withFilter(field, threshold),
      field,
    );
  }

  for (const [field, metric, threshold] of DISTANCE_CASES) {
    expectPass(
      `${field} accepts exact drawdown boundary`,
      baseRow({ [metric]: -threshold }),
      withFilter(field, threshold),
    );
    expectReject(
      `${field} rejects beyond drawdown boundary`,
      baseRow({ [metric]: -threshold - 0.1 }),
      withFilter(field, threshold),
      field,
    );
  }
}

function runBooleanAndModeTests() {
  expectPass("requireUpVolume accepts true", baseRow({ upVolume: true }), withFilter("requireUpVolume", true));
  expectReject("requireUpVolume rejects false", baseRow({ upVolume: false }), withFilter("requireUpVolume", true), "requireUpVolume");

  expectPass("requireSma200Up accepts positive slope", baseRow({ sma200Slope: 0.1 }), withFilter("requireSma200Up", true));
  expectReject("requireSma200Up rejects flat slope", baseRow({ sma200Slope: 0 }), withFilter("requireSma200Up", true), "requireSma200Up");

  expectPass("requirePriceAboveSma50 accepts price above SMA50", baseRow({ price: 100, sma50: 99 }), withFilter("requirePriceAboveSma50", true));
  expectReject("requirePriceAboveSma50 rejects equality", baseRow({ price: 100, sma50: 100 }), withFilter("requirePriceAboveSma50", true), "requirePriceAboveSma50");

  expectPass("requireStage2 accepts confirmed daily Stage 2", baseRow(), withFilter("requireStage2", true));
  expectReject("requireStage2 rejects broken MA stack", baseRow({ sma50: 70, sma150: 82 }), withFilter("requireStage2", true), "requireStage2");

  expectPass("requireRecentIpo accepts age boundary", baseRow({ ipoAgeMonths: 12 }), withFilter("requireRecentIpo", true, { maxIpoAgeMonths: 12 }));
  expectReject("requireRecentIpo rejects older IPO", baseRow({ ipoAgeMonths: 13 }), withFilter("requireRecentIpo", true, { maxIpoAgeMonths: 12 }), "requireRecentIpo");

  expectReject("nearPivot rejects score-only pivot proximity without methodology", baseRow({ distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 }, "setupMode");
  expectPass("nearPivot accepts methodology-backed pivot watch at boundaries", pivotWatchRow({ distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 });
  expectReject("nearPivot rejects validated pivots below shared score contract", pivotWatchRow({ totalScore: 40, rsGlobalPct: 82, distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 }, "setupMode");
  expectReject("nearPivot rejects partial-volume pattern claims", pivotWatchRow({ patternDataStatus: "partial_volume", distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 }, "setupMode");
  expectReject("nearPivot rejects extension beyond internal cap", baseRow({ extSma50: 18.1 }), { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 25 }, "setupMode");

  expectPass("pullback accepts SMA50 pullback window", baseRow({ price: 100, sma50: 100, extSma50: 0, distance52w: -20, perf6m: 8 }), { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 });
  expectReject("pullback rejects rows below shared composite contract", baseRow({ totalScore: 40, price: 100, sma50: 100, sma200: 70, extSma50: 0, distance52w: -20, perf6m: 12 }), { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, "setupMode");
  expectReject("pullback rejects stale SMA50 extension mismatch", baseRow({ price: 80, sma50: 100, sma200: 70, extSma50: 0, distance52w: -20, perf6m: 12 }), { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, "setupMode");
  expectReject("pullback rejects broken pullback window", baseRow({ extSma50: 10, distance52w: -20, perf6m: 12 }), { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, "setupMode");

  expectPass("early accepts boundary setup", baseRow({ distance52w: -35, perf3m: 5, extSma50: 20 }), { ...BASE_FILTERS, setupMode: "early", minPerf3m: 5, maxExtensionSma50: 20 });
  expectReject("early rejects price below SMA200 via long bias", baseRow({ price: 70, sma200: 72 }), { ...BASE_FILTERS, setupMode: "early", minPerf3m: 5, maxExtensionSma50: 20 }, "longBiasFloor");

  expectPass("ipoRecent accepts recent issue", baseRow({ ipoAgeMonths: 10, distance52w: -35, extSma50: 35, momentumScore: 35 }), { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 });
  expectReject("ipoRecent rejects old issue", baseRow({ ipoAgeMonths: 13, distance52w: -35, extSma50: 35, momentumScore: 35 }), { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 }, "setupMode");
  expectReject("ipoRecent rejects bearish recent issues via shared contract", baseRow({ ipoAgeMonths: 10, price: 70, sma200: 100, distance52w: -20, extSma50: 20, momentumScore: 60 }), { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 }, "setupMode");

  expectPass("extended accepts strong extension window", baseRow({ price: 115, sma50: 100, extSma50: 15, momentumScore: 65 }), { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 });
  expectReject("extended rejects stale SMA50 extension mismatch", baseRow({ price: 90, sma50: 100, sma200: 70, extSma50: 15, momentumScore: 80 }), { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 }, "setupMode");
  expectReject("extended rejects under shared extension contract", baseRow({ price: 114.9, sma50: 100, extSma50: 14.9, momentumScore: 80 }), { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 }, "setupMode");

  expectPass("weakness accepts minimum deterioration", baseRow({ weaknessScore: 55 }), { ...BASE_FILTERS, setupMode: "weakness", minWeaknessScore: 55 });
  expectReject("weakness rejects below deterioration minimum", baseRow({ weaknessScore: 54.9 }), { ...BASE_FILTERS, setupMode: "weakness", minWeaknessScore: 55 }, "minWeaknessScore");
}

function runFreshnessAndDataGateTests() {
  expectPass("freshness accepts exact day boundary", baseRow({ priceFreshnessDays: 5 }), { ...BASE_FILTERS, maxPriceFreshnessDays: 5 });
  expectReject("freshness rejects stale price", baseRow({ priceFreshnessDays: 6 }), { ...BASE_FILTERS, maxPriceFreshnessDays: 5 }, "maxPriceFreshnessDays");

  assert.equal(qualityGateForResearchRow(baseRow({ chartBarsCount: 180 }), { setupMode: "leader" }).passed, true, "quality gate should accept 180 bars for normal scans");
  assert.equal(qualityGateForResearchRow(baseRow({ chartBarsCount: 179 }), { setupMode: "leader" }).passed, false, "quality gate should reject 179 bars for normal scans");
  assert.equal(qualityGateForResearchRow(baseRow({ chartBarsCount: 20 }), { setupMode: "ipoRecent" }).passed, true, "quality gate should accept 20 bars for IPO mode");
  assert.equal(qualityGateForResearchRow(baseRow({ chartBarsCount: 19 }), { setupMode: "ipoRecent" }).passed, false, "quality gate should reject 19 bars for IPO mode");
}

function runPatternValidityGateTests() {
  expectReject(
    "pattern filter rejects data-blocked VCP metrics",
    baseRow({ patternDataStatus: "insufficient_history", patternEligible: false, contractionCount: 3 }),
    withFilter("minContractionCount", 2),
    "patternDataStatus",
  );
  expectReject(
    "pattern filter rejects invalid VCP structure even when counts pass",
    baseRow({ patternDataStatus: "ok", patternEligible: true, contractionStructureStatus: "lower_low_drift", contractionCount: 3 }),
    withFilter("minContractionCount", 2),
    "contractionStructureStatus",
  );
  expectPass(
    "pattern filter accepts validated contraction structure",
    baseRow({ patternDataStatus: "ok", patternEligible: true, contractionStructureStatus: "ok", contractionCount: 3 }),
    withFilter("minContractionCount", 2),
  );
  expectReject(
    "volume dry-up filter rejects partial volume evidence",
    baseRow({ patternDataStatus: "partial_volume", patternEligible: true, patternVolumeEligible: false, volumeDryUpRatio: 0.7 }),
    withFilter("maxVolumeDryUpRatio", 0.9),
    "patternDataStatus",
  );
  expectPass(
    "contraction-only filter can still observe partial volume structures",
    baseRow({ patternDataStatus: "partial_volume", patternEligible: true, patternVolumeEligible: false, contractionStructureStatus: "ok", contractionCount: 3, contractionsDecreasing: true }),
    { ...BASE_FILTERS, requireContractionsDecreasing: true, minContractionCount: 3 },
  );
  expectReject(
    "pattern filter rejects display data-limited contraction claims",
    baseRow({
      patternDataStatus: "ok",
      patternEligible: true,
      contractionStructureStatus: "ok",
      contractionCount: 3,
      setupDisplayDataLimited: true,
      setupDisplayBlocksPatternClaim: true,
      methodologyReliabilityState: "data_limited",
      methodologyBlocksPatternClaim: true,
    }),
    withFilter("minContractionCount", 2),
    "patternDataStatus",
  );
  expectPass(
    "contraction-only filter can observe partial-volume display blockers when OHLC structure is valid",
    baseRow({
      patternDataStatus: "partial_volume",
      patternEligible: true,
      patternVolumeEligible: false,
      contractionStructureStatus: "ok",
      contractionCount: 3,
      contractionsDecreasing: true,
      setupDisplayBlocksPatternClaim: true,
      setupDisplayWatch: true,
      methodologyBlocksPatternClaim: true,
    }),
    { ...BASE_FILTERS, requireContractionsDecreasing: true, minContractionCount: 3 },
  );
  expectReject(
    "pattern quality filter rejects blocked full-claim evidence",
    baseRow({
      patternDataStatus: "partial_volume",
      patternEligible: true,
      patternVolumeEligible: false,
      contractionStructureStatus: "ok",
      patternQualityScore: 96,
      setupDisplayBlocksPatternClaim: true,
      setupDisplayWatch: true,
      methodologyBlocksPatternClaim: true,
    }),
    withFilter("minPatternQualityScore", 65),
    "patternDataStatus",
  );
  const blockedMethodologyClaim = baseRow({
    symbol: "METHBLOCK",
    patternDataStatus: "ok",
    patternEligible: true,
    consolidationCandidate: true,
    patternFamily: "progressive_contraction",
    patternQualityScore: 94,
    baseContextScore: 72,
    baseDepthPct: 20,
    pivotPrice: 101,
    pivotClarityScore: 82,
    pivotTouchCount: 3,
    baseNearPivotDays: 14,
    latestCloseLocationPct: 72,
    distanceToPivotPct: -1,
    absDistanceToPivotPct: 1,
    volumeDryUpRatio: .62,
    tightness10dPct: 5,
    contractionCount: 3,
    contractionsDecreasing: true,
    contractionDepths: [18, 10, 5],
    contraction1DepthPct: 18,
    contraction2DepthPct: 10,
    contraction3DepthPct: 5,
    lastContractionDepthPct: 5,
    breakoutAttempt: true,
    breakoutQualityScore: 92,
    setupDisplayKey: "data_limited",
    setupDisplayState: "data_limited",
    setupDisplayLabel: "Datos parciales",
    setupDisplayReason: "cobertura parcial del patrón",
    setupDisplayDataLimited: true,
    setupDisplayBlocksPatternClaim: true,
    setupDisplayPlanValid: false,
    setupDisplayActionable: false,
    setupDisplayObservable: false,
    setupDisplayWatch: false,
    setupDisplayStrict: false,
    setupDisplayTradePlanEligible: false,
    methodologyReliabilityState: "data_limited",
    methodologyBlocksPatternClaim: true,
  });
  const blockedTagKeys = setupTagsForRow(blockedMethodologyClaim).map((tag) => tag.key);
  assert.equal(blockedTagKeys.includes("setup_plan_valid"), false, "methodology tags must not emit VCP plan when display blocks the pattern claim");
  assert.equal(blockedTagKeys.includes("vcp_strict"), false, "methodology tags must not emit VCP strict when display blocks the pattern claim");
  assert.equal(blockedTagKeys.includes("setup_watch"), false, "methodology tags must not emit setup watch when display blocks the pattern claim");
  assert.equal(blockedTagKeys.includes("pattern_quality"), false, "methodology tags must not emit pattern quality when display blocks the pattern claim");
  assert.equal(blockedTagKeys.includes("breakout_quality"), false, "methodology tags must not emit breakout quality when display blocks the pattern claim");
  assert.equal(blockedTagKeys.includes("volume_dry_up"), false, "methodology tags must not emit volume dry-up when display blocks the pattern claim");
  const blockedEventTypes = methodologyEvents(blockedMethodologyClaim).map((event) => event.type);
  assert.equal(blockedEventTypes.includes("setup_plan_valid"), false, "methodology events must not emit VCP plan from blocked raw metrics");
  assert.equal(blockedEventTypes.includes("vcp_strict"), false, "methodology events must not emit strict VCP from blocked raw metrics");
  assert.equal(blockedEventTypes.includes("setup_watch"), false, "methodology events must not emit watch setup from blocked raw metrics");
  assert.equal(blockedEventTypes.includes("breakout_attempt"), false, "methodology events must not emit breakout attempts from blocked raw metrics");
  const enrichedBlocked = enrichRowsWithMethodology([blockedMethodologyClaim])[0];
  assert.equal(enrichedBlocked.methodologyTags.includes("VCP plan válido"), false, "enriched rows must not expose blocked VCP plan tags");
  assert.equal(enrichedBlocked.methodologyTags.includes("Breakout con calidad"), false, "enriched rows must not expose blocked breakout tags");
  const validMethodologyClaim = {
    ...blockedMethodologyClaim,
    symbol: "METHVALID",
    setupDisplayKey: "actionable_vcp",
    setupDisplayState: "actionable",
    setupDisplayLabel: "VCP plan válido",
    setupDisplayShortLabel: "Plan válido",
    setupDisplayReason: "VCP estricto validado.",
    setupDisplayDataLimited: false,
    setupDisplayBlocksPatternClaim: false,
    setupDisplayPlanValid: true,
    setupDisplayActionable: true,
    setupDisplayObservable: true,
    setupDisplayWatch: false,
    setupDisplayStrict: true,
    setupDisplayTradePlanEligible: true,
    methodologyReliabilityState: "",
    methodologyBlocksPatternClaim: false,
  };
  const validTagKeys = setupTagsForRow(validMethodologyClaim).map((tag) => tag.key);
  assert.equal(validTagKeys.includes("setup_plan_valid"), true, "methodology tags must still expose validated VCP plans");
  assert.equal(validTagKeys.includes("breakout_quality"), true, "methodology tags must still expose validated breakout evidence");
  const validEventTypes = methodologyEvents(validMethodologyClaim).map((event) => event.type);
  assert.equal(validEventTypes.includes("setup_plan_valid"), true, "methodology events must still expose validated VCP plans");
  assert.equal(validEventTypes.includes("breakout_attempt"), true, "methodology events must still expose validated breakout attempts");
}

function runParsingAndExactnessTests() {
  const exact = effectiveScreenerFilterValues({ filterStrictness: "discovery", minRsRating: 99, maxDistance52w: 12 });
  assert.equal(exact.filterStrictness, "discovery");
  assert.equal(exact.minRsRating, 99, "RS threshold must not be relaxed by strictness");
  assert.equal(exact.maxDistance52w, 12, "distance threshold must not be relaxed by strictness");

  const filters = screenerFiltersFromParams({
    setupMode: "any",
    requireStage2: "false",
    maxPriceFreshnessDays: "999",
    minRsRating: "99",
  });
  assert.equal(filters.enabled, true);
  assert.equal(filters.values.requireStage2, false);
  assert.equal(filters.values.minRsRating, 99);

  const blankNumericFilters = screenerFiltersFromParams({ minRsRating: "   " });
  assert.equal(blankNumericFilters.enabled, false, "blank numeric params with spaces must not activate filters");
  assert.equal(blankNumericFilters.values.minRsRating, null, "blank numeric params with spaces must stay missing, not become 0");

  const paddedNumericFilters = screenerFiltersFromParams({ maxPriceFreshnessDays: " 5 ", minRsRating: " 99 " });
  assert.equal(paddedNumericFilters.values.maxPriceFreshnessDays, 5, "padded numeric params must still parse");
  assert.equal(paddedNumericFilters.values.minRsRating, 99, "padded numeric thresholds must remain exact");

  const rows = [
    baseRow({ symbol: "RS98", rsGlobalPct: 98 }),
    baseRow({ symbol: "RS99", rsGlobalPct: 99 }),
  ];
  const result = applyScreenerFilters(rows, filters);
  assert.deepEqual(result.rows.map((row) => row.symbol), ["RS99"], "minRsRating 99 must only pass 99+ rows");
  assert.deepEqual(result.rejections.map((row) => row.symbol), ["RS98"]);
}

function runFilterExplainPlanTests() {
  const filters = {
    ...BASE_FILTERS,
    setupMode: "nearPivot",
    requireStage2: true,
    maxPriceFreshnessDays: 5,
    minRsRating: 75,
    minPerf6m: 30,
    maxDistance52w: 20,
    minTotalScore: 70,
  };
  const strong = buildScreenerFilterExplainPlan(pivotWatchRow({ symbol: "PLANOK", rsGlobalPct: 91, perf6m: 45, distance52w: -8, totalScore: 86, priceFreshnessDays: 0 }), filters);
  assert.equal(strong.status, "pass", "strong passing row should have a clean explain plan");
  assert.match(strong.text, /Pasa \d+ reglas activas/, "explain plan must summarize active rule count");
  assert.ok(strong.activeCount >= 5, "explain plan must include hard thresholds and boolean gates");

  const near = buildScreenerFilterExplainPlan(pivotWatchRow({ symbol: "PLANNR", rsGlobalPct: 76, perf6m: 31, distance52w: -19.5, totalScore: 71, priceFreshnessDays: 4 }), filters);
  assert.equal(near.status, "watch", "near-threshold passing row should be marked for review");
  assert.ok(near.near.some((item) => item.field === "maxDistance52w"), "distance close to threshold must be listed as near");
  assert.match(near.text, /cerca del corte/i, "near-threshold explanation must be visible in tooltip text");

  const failed = buildScreenerFilterExplainPlan(baseRow({ symbol: "PLANNO", rsGlobalPct: 70, perf6m: 45, distance52w: -8, totalScore: 86, priceFreshnessDays: 0 }), filters);
  assert.equal(failed.status, "fail", "failing row should not receive a passing explain plan");
  assert.ok(failed.failed.some((item) => item.field === "minRsRating"), "failing active RS rule must be identified");

  const missing = buildScreenerFilterExplainPlan(pivotWatchRow({ symbol: "PLANMS", rsGlobalPct: null, perf6m: 45, distance52w: -8, totalScore: 86, priceFreshnessDays: 0 }), filters);
  assert.equal(missing.status, "missing", "missing active metric should be distinguished from numeric failure");
  assert.ok(missing.missing.some((item) => item.field === "minRsRating"), "missing active RS rule must be identified");

  const setupFail = buildScreenerFilterExplainPlan(
    baseRow({ symbol: "PLANST", extSma50: 18.1 }),
    { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 25 },
  );
  assert.equal(setupFail.status, "fail", "setupMode gate failure must mark the explain plan as failing");
  assert.ok(setupFail.failed.some((item) => item.field === "setupMode"), "setupMode gate failure must be identified explicitly");

  const longBiasFail = buildScreenerFilterExplainPlan(
    baseRow({ symbol: "PLANLB", price: 70, sma200: 72 }),
    { ...BASE_FILTERS, setupMode: "any", requireStage2: false },
  );
  assert.equal(longBiasFail.status, "fail", "long-bias floor failure must mark the explain plan as failing");
  assert.ok(longBiasFail.failed.some((item) => item.field === "longBiasFloor"), "long-bias floor must be identified explicitly");
}

function scanResultFromRow(row, createdAt = "2026-05-25T10:00:00.000Z") {
  return {
    symbol: row.symbol,
    company_name: row.companyName,
    country: row.country,
    sector: row.sector,
    industry: row.industry,
    theme: row.theme,
    total_score: row.totalScore,
    weinstein_score: row.weinsteinScore,
    minervini_score: row.minerviniScore,
    risk_score: row.riskScore,
    rs_rating: row.rsGlobalPct ?? row.rsRating,
    created_at: createdAt,
    metrics: { ...row },
    raw: { ...row },
  };
}

function runLeaderboardSnapshotContractTests() {
  const benchmarkOnly = baseRow({
    symbol: "BENCH99",
    rsGlobalPct: null,
    rsRating: 99,
    totalScore: 96,
  });
  const globalLeader = baseRow({
    symbol: "GLOBAL99",
    rsGlobalPct: 99,
    rsRating: 30,
    totalScore: 90,
  });
  const globalLag = baseRow({
    symbol: "GLOBAL98",
    rsGlobalPct: 98,
    rsRating: 99,
    totalScore: 95,
  });
  const sparseButEligible = baseRow({
    symbol: "SPARSENULL",
    totalScore: 60,
    rsGlobalPct: 65,
    rsQualityScore: null,
    distanceToPivotPct: null,
    volumeDryUpRatio: null,
    contractionCount: null,
    minerviniScore: 0,
  });
  const rows = [benchmarkOnly, globalLeader, globalLag, sparseButEligible].map(scanResultFromRow);

  const topRs = buildLeaderboard(rows, {
    strategy: "rs",
    minRs: 99,
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(topRs.items.map((item) => item.symbol), ["GLOBAL99"], "Top RS must rank by RS global only, never benchmark fallback");

  const filteredComposite = buildLeaderboard(rows, {
    strategy: "composite",
    minRsRating: 99,
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(filteredComposite.items.map((item) => item.symbol), ["GLOBAL99"], "leaderboard screener minRsRating must remain a hard RS global contract");

  const composite = buildLeaderboard(rows, {
    strategy: "composite",
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  const sparseItem = composite.items.find((item) => item.symbol === "SPARSENULL");
  assert.ok(sparseItem, "eligible sparse rows should still appear in broad composite leaderboards");
  assert.equal(sparseItem.rsQualityScore, null, "leaderboard output must preserve missing RS quality as null, not 0");
  assert.equal(sparseItem.distanceToPivotPct, null, "leaderboard output must preserve missing pivot distance as null, not 0");
  assert.equal(sparseItem.volumeDryUpRatio, null, "leaderboard output must preserve missing VCP volume dry-up as null, not 0");
  assert.equal(sparseItem.contractionCount, null, "leaderboard output must preserve missing contraction count as null, not 0");
  assert.equal(sparseItem.minerviniScore, 0, "leaderboard output must keep genuine zero scores as 0");

  const persistedBlockedVcp = baseRow({
    symbol: "SCANMETRICSBLOCK",
    totalScore: 93,
    rsGlobalPct: 90,
    setupPlanValid: true,
    setupActionable: true,
    setupWatch: true,
    setupStrict: true,
    setupDisplayKey: "data_limited",
    setupDisplayState: "data_limited",
    setupDisplayLabel: "Datos parciales",
    setupDisplayShortLabel: "Datos",
    setupDisplayReason: "estructura de contracciones rechazada",
    setupDisplayDataLimited: true,
    setupDisplayBlocksPatternClaim: true,
    setupDisplayPlanValid: false,
    setupDisplayActionable: false,
    setupDisplayObservable: false,
    setupDisplayWatch: false,
    setupDisplayStrict: false,
    setupDisplayTradePlanEligible: false,
    methodologyReliabilityState: "data_limited",
    methodologyBlocksPatternClaim: true,
    patternDataStatus: "ok",
    patternEligible: true,
    patternVolumeEligible: false,
    contractionStructureStatus: "lower_low_drift",
    contractionStructureReason: "base floor not holding",
    contractionDepths: [20, 10],
    measuredContractionDepths: [20, 10, 12],
    rejectedContractionDepthPct: 12,
    contractionCount: 2,
    contractionsDecreasing: false,
    vcpCandidate: true,
    pivotSqueeze: true,
    distanceToPivotPct: -2,
    volumeDryUpRatio: .65,
  });
  const persistedPayload = resultPayload(persistedBlockedVcp, "scan-1", "owner-1", 0);
  assert.equal(persistedPayload.metrics.setupDisplayBlocksPatternClaim, true, "scan metrics must persist display claim blockers");
  assert.equal(persistedPayload.metrics.setupDisplayPlanValid, false, "scan metrics must persist display plan rejection");
  assert.equal(persistedPayload.metrics.contractionStructureStatus, "lower_low_drift", "scan metrics must persist contraction structure rejection");
  assert.deepEqual(persistedPayload.metrics.measuredContractionDepths, [20, 10, 12], "scan metrics must persist measured/rejected contraction depths");
  const metricsOnlyPayload = { ...persistedPayload, raw: null, created_at: "2026-05-25T10:00:00.000Z" };
  const metricsOnlyNearPivot = buildLeaderboard([metricsOnlyPayload], {
    strategy: "nearPivot",
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(metricsOnlyNearPivot.items.map((item) => item.symbol), [], "metrics-only scan rows must not leak blocked VCPs into near-pivot leaderboards");
  const recentScanState = latestScanStateFromRow(metricsOnlyPayload);
  assert.equal(recentScanState.planValid, false, "metrics-only recent scan state must let display blocker override legacy setupPlanValid");
  assert.equal(recentScanState.watch, false, "metrics-only recent scan state must let display blocker override legacy setupWatch");

  const materializedPayload = materializedScanResultPayload(persistedBlockedVcp, "materialized-scan-1", "owner-1", 0);
  assert.equal(materializedPayload.metrics.setupDisplayBlocksPatternClaim, true, "materialized scan metrics must persist display claim blockers");
  assert.equal(materializedPayload.metrics.patternVolumeEligible, false, "materialized scan metrics must persist unusable pattern volume");
  assert.equal(materializedPayload.metrics.contractionStructureStatus, "lower_low_drift", "materialized scan metrics must persist contraction structure rejection");
  assert.deepEqual(materializedPayload.metrics.measuredContractionDepths, [20, 10, 12], "materialized scan metrics must persist measured/rejected contraction depths");
  const materializedMetricsOnly = { ...materializedPayload, raw: null, created_at: "2026-05-25T10:00:00.000Z" };
  const materializedCachedRow = normalizeCachedScreenerRow(materializedMetricsOnly);
  assert.equal(materializedCachedRow.setupDisplayBlocksPatternClaim, true, "materialized cached rows must preserve display blockers from metrics");
  assert.equal(materializedCachedRow.patternVolumeEligible, false, "materialized cached rows must preserve pattern volume eligibility from metrics");
  assert.equal(materializedCachedRow.contractionStructureStatus, "lower_low_drift", "materialized cached rows must preserve contraction structure status from metrics");
  assert.equal(materializedCachedRow.rejectedContractionDepthPct, 12, "materialized cached rows must preserve rejected contraction depth from metrics");
  const blockedDetailLine = methodologyCompactDetailLine(materializedCachedRow);
  assert.match(blockedDetailLine, /Motivo:|Datos:/, "blocked pattern detail should explain why the claim is blocked");
  assert.doesNotMatch(blockedDetailLine, /Volumen seco/i, "blocked pattern detail must not advertise raw dry-up evidence");
  assert.doesNotMatch(blockedDetailLine, /Calidad:/i, "blocked pattern detail must not advertise raw pattern quality");
  const materializedNearPivot = buildLeaderboard([materializedMetricsOnly], {
    strategy: "nearPivot",
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(materializedNearPivot.items.map((item) => item.symbol), [], "materialized metrics-only rows must not leak blocked VCPs into near-pivot leaderboards");

  const validDetailLine = methodologyCompactDetailLine(baseRow({
    symbol: "DETAILVALID",
    patternDataStatus: "ok",
    patternEligible: true,
    patternQualityScore: 72,
    volumeDryUpRatio: .74,
    distanceToPivotPct: -2,
    setupDisplayKey: "vcp_watch",
    setupDisplayState: "watch",
    setupDisplayLabel: "Base en vigilancia",
    setupDisplayBlocksPatternClaim: false,
    setupDisplayWatch: true,
    setupDisplayObservable: true,
  }));
  assert.match(validDetailLine, /Volumen seco: 0\.74x/i, "valid pattern detail should still show usable dry-up evidence");
  assert.match(validDetailLine, /Calidad: 72/i, "valid pattern detail should still show usable quality evidence");
}

function runDiscoveryContractTests() {
  assert.equal(normalizeStockRows([baseRow({ sector: "", industry: "", theme: { color: "#22c55e", label: "Objeto legado", stance: "bullish" } })])[0].theme, "Objeto legado", "stock row normalization must render legacy theme objects as text");

  const legacyPlanTrap = baseRow({
    symbol: "DISCPLANLEGACY",
    companyName: "Legacy Plan Flag Trap",
    totalScore: 90,
    rsGlobalPct: 87,
    setupPlanValid: true,
    setupActionable: true,
    setupWatch: true,
    setupDisplayKey: "actionable_vcp",
    setupDisplayState: "data_limited",
    setupDisplayLabel: "VCP plan válido",
    setupDisplayShortLabel: "Plan válido",
    setupDisplayPlanValid: false,
    setupDisplayActionable: false,
    setupDisplayTradePlanEligible: false,
    setupDisplayWatch: false,
    setupDisplayBlocksPatternClaim: true,
    sector: "Technology",
    industry: "Application Software",
    theme: "Software / IA",
  });

  const rows = [
    baseRow({ symbol: "DISC1", companyName: "Discovery Leader", totalScore: 93, rsGlobalPct: 91, rsQualityScore: 88, sector: "Technology", industry: "Software", theme: "Software / IA" }),
    baseRow({ symbol: "DISC2", companyName: "Discovery Weak", totalScore: 42, rsGlobalPct: 32, weaknessScore: 78, perf3m: -18, distance52w: -46, riskScore: 25, sector: "Industrials", industry: "Machinery", theme: "Automatizacion" }),
    baseRow({ symbol: "DISC3", companyName: "Discovery Minervini", totalScore: 88, minerviniScore: 94, sector: "Healthcare", industry: "Medical Devices", theme: "Medtech / biotech" }),
    baseRow({ symbol: "DISC4", companyName: "Discovery Extended", totalScore: 89, rsGlobalPct: 86, price: 124, sma50: 100, extSma50: 24, distance52w: -6, sector: "Technology", industry: "Semiconductors", theme: "Semis / fotonica" }),
    baseRow({ symbol: "DISC5", companyName: "Discovery Pullback", totalScore: 84, rsGlobalPct: 82, price: 100, sma50: 98, sma200: 78, extSma50: 2, sector: "Consumer Cyclical", industry: "Specialty Retail", theme: "Consumo / marca" }),
    baseRow({ symbol: "DISC6", companyName: "Discovery IPO", totalScore: 72, rsGlobalPct: 77, ipoScore: 83, ipoDate: "2024-03-15", sector: "Technology", industry: "Application Software", theme: "Software / IA" }),
    baseRow({ symbol: "DISC7", companyName: "Stale Energy Theme", totalScore: 90, rsGlobalPct: 86, sector: "Industrials", industry: "Electrical Equipment & Parts", theme: "Energia / red" }),
    baseRow({ symbol: "DISC8", companyName: "Real Energy Theme", totalScore: 88, rsGlobalPct: 84, sector: "Energy", industry: "Oil & Gas Integrated", theme: "Energia / red" }),
    baseRow({
      symbol: "DISC9",
      companyName: "Bearish Minervini Trap",
      totalScore: 92,
      rsGlobalPct: 82,
      minerviniScore: 96,
      weinsteinScore: 78,
      weaknessScore: 82,
      price: 62,
      sma50: 78,
      sma150: 84,
      sma200: 90,
      sma200Slope: -4,
      perf3m: -24,
      distance52w: -52,
      sector: "Technology",
      industry: "Application Software",
      theme: "Software / IA",
    }),
    baseRow({
      symbol: "DISC10",
      companyName: "Negative 3M Minervini Pause",
      totalScore: 87,
      rsGlobalPct: 82,
      minerviniScore: 92,
      weinsteinScore: 88,
      weaknessScore: 20,
      perf3m: -4,
      distance52w: -14,
      sector: "Technology",
      industry: "Application Software",
      theme: "Software / IA",
    }),
    baseRow({
      symbol: "DISC11",
      companyName: "Stale Extension Trap",
      totalScore: 91,
      rsGlobalPct: 88,
      price: 90,
      sma50: 100,
      sma200: 70,
      extSma50: 18,
      distance52w: -6,
      sector: "Technology",
      industry: "Application Software",
      theme: "Software / IA",
    }),
    legacyPlanTrap,
  ].map(scanResultFromRow);

  const snapshot = buildDiscoverySnapshot(rows, {
    limit: 10,
    groupsLimit: 10,
    minGroupSize: 1,
    minCoverageScore: 0,
    maxPriceFreshnessDays: 999,
  });
  const listMap = Object.fromEntries(snapshot.lists.map((list) => [list.key, list]));

  assert.equal(snapshot.legalMode, "derived-signals-only", "discovery must keep the derived-only contract");
  assert.ok(snapshot.audit && snapshot.audit.universeRows >= snapshot.rows.length, "discovery must expose coverage audit over the source universe");
  assert.equal(snapshot.audit.scope.type, "global", "global discovery audit must declare global scope");
  assert.equal(Array.isArray(snapshot.audit.topMarkets), true, "discovery audit must expose ranked market distribution");
  assert.equal(snapshot.criteria.derivedOnly, true, "discovery criteria must declare derived-only mode");
  assert.equal(Number.isFinite(snapshot.health.lowCoverageRows), true, "discovery health must expose low-coverage row counts");
  assert.ok(snapshot.rows.some((item) => item.symbol === "DISCPLANLEGACY"), "legacy plan trap must still be visible as a broad discovery row");
  const legacyOnlySnapshot = buildDiscoverySnapshot([scanResultFromRow(legacyPlanTrap)], {
    limit: 10,
    groupsLimit: 10,
    minGroupSize: 1,
    minCoverageScore: 0,
    maxPriceFreshnessDays: 999,
  });
  assert.equal(legacyOnlySnapshot.health.planClaims, 0, "discovery health planClaims must ignore legacy setupPlanValid when display blocks the plan claim");
  assert.equal(legacyOnlySnapshot.health.watchRows, 0, "discovery health watchRows must ignore legacy setupWatch when display blocks the claim");
  assert.ok(listMap.leaders.items.some((item) => item.symbol === "DISC1"), "discovery leaders must use composite leaderboard strategy");
  assert.ok(listMap.rsQuality.items.every((item) => Number(item.rsQualityScore || 0) >= 55), "RS Quality list must require RS quality score");
  assert.ok(listMap.weakness.items.some((item) => item.symbol === "DISC2"), "weakness list must expose deterioration strategy");
  assert.ok(listMap.minervini.items.some((item) => item.symbol === "DISC3"), "minervini list must expose Minervini strategy");
  assert.equal(isLongOpportunityRow(listMap.weakness.items.find((item) => item.symbol === "DISC9")), false, "bearish high-score traps must fail long-opportunity coherence");
  assert.equal(listMap.minervini.items.some((item) => item.symbol === "DISC9"), false, "Minervini Leaders must not include bearish high-score traps");
  assert.equal(listMap.minervini.items.some((item) => item.symbol === "DISC10"), false, "Minervini Leaders must require non-negative 3M momentum");
  assert.equal(rowPassesListContract(listMap.leaders.items.find((item) => item.symbol === "DISC10") || rows.find((item) => item.symbol === "DISC10")?.raw, "minervini"), false, "visible Minervini contract must reject negative 3M momentum");
  assert.equal(["leaders", "rsQuality", "weinstein", "minervini", "nearPivot", "ipo", "extended", "pullback"].every((key) => !listMap[key].items.some((item) => item.symbol === "DISC9")), true, "bullish discovery lists must exclude bearish high-score traps");
  assert.equal(listMap.extended.items.some((item) => item.symbol === "DISC11"), false, "extended discovery list must exclude stale SMA50 extension traps");
  assert.equal(listMap.weakness.items.some((item) => item.symbol === "DISC9"), true, "bearish high-score traps may only appear in deterioration lists");
  const stringMetricTrap = baseRow({
    symbol: "STRINGWEAK",
    totalScore: "91",
    rsGlobalPct: "88",
    weaknessScore: "82",
    price: "120",
    sma200: "80",
    sma200Slope: "3",
  });
  assert.equal(isLongOpportunityRow(stringMetricTrap), false, "numeric-string weakness must still block long opportunity rows");
  assert.equal(rowPassesListContract(stringMetricTrap, "leaders"), false, "numeric-string weakness must not leak into bullish list contracts");
  assert.match(listInclusionReasons(stringMetricTrap, "leaders").join(" "), /Deterioro técnico 82/i, "string-metric trap rationale must explain deterioration");
  const normalizedStringMetrics = normalizeStockRows([{ symbol: "STRINGOK", totalScore: " 77 ", rsGlobalPct: "66", weaknessScore: "0" }])[0];
  assert.equal(normalizedStringMetrics.totalScore, 77, "stock row normalization must parse numeric-string total score");
  assert.equal(normalizedStringMetrics.rsGlobalPct, 66, "stock row normalization must parse numeric-string RS");
  assert.equal(normalizedStringMetrics.weaknessScore, 0, "stock row normalization must keep genuine numeric-string zero as 0");
  const normalizedBlankMetrics = normalizeStockRows([{ symbol: "STRINGMISS", totalScore: "   ", rsGlobalPct: "" }])[0];
  assert.equal(normalizedBlankMetrics.totalScore, null, "stock row normalization must preserve blank total score as null, not 0");
  assert.equal(normalizedBlankMetrics.rsGlobalPct, null, "stock row normalization must preserve blank RS as null, not 0");
  const uiGuard = enforceListContractRows([
    listMap.minervini.items.find((item) => item.symbol === "DISC3"),
    rows.find((item) => item.symbol === "DISC9")?.raw,
    rows.find((item) => item.symbol === "DISC10")?.raw,
  ], "minervini");
  assert.deepEqual(uiGuard.rows.map((item) => item.symbol), ["DISC3"], "visible list contract guard must preserve only coherent Minervini leaders");
  assert.equal(uiGuard.rejectedCount, 2, "visible list contract guard must count rejected discovery rows");
  const validPivotWatch = baseRow({
    symbol: "PIVOTOK",
    patternDataStatus: "ok",
    patternEligible: true,
    totalScore: 84,
    rsGlobalPct: 82,
    distanceToPivotPct: -2,
    setupDisplayKey: "vcp_watch",
    setupDisplayState: "watch",
    setupDisplayLabel: "Base en vigilancia",
    setupDisplayWatch: true,
    setupDisplayObservable: true,
    setupDisplayBlocksPatternClaim: false,
  });
  const scoreOnlyPivot = baseRow({
    symbol: "PIVOTSCORE",
    totalScore: 92,
    rsGlobalPct: 88,
    distanceToPivotPct: null,
    setupDisplayKey: "no_base",
    setupDisplayState: "blocked",
    setupDisplayWatch: false,
    setupDisplayObservable: false,
  });
  assert.equal(rowPassesListContract(validPivotWatch, "nearPivot"), true, "near-pivot list contract must accept validated pivot-watch rows");
  assert.equal(rowPassesListContract(scoreOnlyPivot, "nearPivot"), false, "near-pivot list contract must reject score-only rows without pivot methodology");
  const nearPivotGuard = enforceListContractRows([validPivotWatch, scoreOnlyPivot], "nearPivot");
  assert.deepEqual(nearPivotGuard.rows.map((item) => item.symbol), ["PIVOTOK"], "visible near-pivot guard must preserve only methodology-backed pivot rows");
  assert.match(listInclusionReasons(scoreOnlyPivot, "nearPivot").join(" "), /pivot no validado/i, "invalid near-pivot rationale must explain the missing pivot claim");
  const nearPivotBoard = buildLeaderboard([scanResultFromRow(scoreOnlyPivot), scanResultFromRow(validPivotWatch)], {
    strategy: "nearPivot",
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(nearPivotBoard.items.map((item) => item.symbol), ["PIVOTOK"], "Near-pivot leaderboard must use the shared list contract and reject score-only pivot rows");
  const cachedBlockedVcp = normalizeCachedScreenerRow({
    symbol: "CACHEBLOCK",
    score: "98",
    metrics: {
      ...baseRow({
        symbol: "CACHEBLOCK",
        totalScore: "91",
        rsGlobalPct: "88",
        setupPlanValid: "true",
        setupActionable: "true",
        setupWatch: "true",
        setupStrict: "true",
        patternEligible: "true",
        patternDataStatus: "ok",
        patternQualityScore: "96",
        contractionScore: "90",
        vcpCandidate: "true",
        pivotSqueeze: "true",
        distanceToPivotPct: "-2",
        volumeDryUpRatio: "0.60",
        setupDisplayKey: "data_limited",
        setupDisplayState: "data_limited",
        setupDisplayLabel: "Datos parciales",
        setupDisplayReason: "cobertura parcial del patrón",
        setupDisplayDataLimited: "true",
        setupDisplayBlocksPatternClaim: "true",
        setupDisplayPlanValid: "false",
        setupDisplayActionable: "false",
        setupDisplayObservable: "false",
        setupDisplayWatch: "false",
        setupDisplayStrict: "false",
        setupDisplayTradePlanEligible: "false",
        methodologyReliabilityState: "data_limited",
        methodologyBlocksPatternClaim: "true",
      }),
    },
  });
  assert.equal(cachedBlockedVcp.setupActionable, true, "cached row must preserve legacy actionability flags for audit visibility");
  assert.equal(cachedBlockedVcp.setupDisplayBlocksPatternClaim, true, "cached row must preserve nested display blockers");
  assert.equal(methodologyDisplayForRow(cachedBlockedVcp).dataLimited, true, "cached display blocker must dominate legacy VCP claims");
  assert.equal(methodologyPatternEvidenceUsable(cachedBlockedVcp), false, "cached blocked VCP evidence must not be usable");
  assert.equal(methodologyPatternEvidenceBonus(cachedBlockedVcp), 0, "cached blocked VCP metrics must not add setup-score bonus");
  assert.equal(rowPassesListContract(cachedBlockedVcp, "nearPivot"), false, "cached blocked VCP must not pass near-pivot contract from raw metrics");
  const cachedValidWatch = normalizeCachedScreenerRow({
    symbol: "CACHEWATCH",
    metrics: {
      ...baseRow({
        symbol: "CACHEWATCH",
        totalScore: "84",
        rsGlobalPct: "82",
        patternEligible: "true",
        patternDataStatus: "ok",
        patternQualityScore: "72",
        vcpCandidate: "true",
        distanceToPivotPct: "-2",
        volumeDryUpRatio: "0.74",
        setupDisplayKey: "vcp_watch",
        setupDisplayState: "watch",
        setupDisplayLabel: "Base en vigilancia",
        setupDisplayDataLimited: "false",
        setupDisplayBlocksPatternClaim: "false",
        setupDisplayActionable: "false",
        setupDisplayObservable: "true",
        setupDisplayWatch: "true",
        setupDisplayTradePlanEligible: "false",
      }),
    },
  });
  assert.equal(rowPassesListContract(cachedValidWatch, "nearPivot"), true, "cached validated VCP watch rows must still pass near-pivot contract");
  assert.ok(methodologyPatternEvidenceBonus(cachedValidWatch) > 0, "cached validated VCP evidence must still contribute positive setup evidence");
  const fakeIpoByScore = baseRow({ symbol: "IPOFAKE", totalScore: 92, rsGlobalPct: 88, ipoScore: 91, ipoDate: "", ipoAgeMonths: null });
  const ageVerifiedIpo = baseRow({ symbol: "IPOAGE", totalScore: 72, rsGlobalPct: 76, ipoScore: 82, ipoDate: "", ipoAgeMonths: 24 });
  const staleIpoAge = baseRow({ symbol: "IPOSTALE", totalScore: 90, rsGlobalPct: 86, ipoScore: 90, ipoDate: "", ipoAgeMonths: 84 });
  const futureIpoAge = baseRow({ symbol: "IPOFUTURE", totalScore: 90, rsGlobalPct: 86, ipoScore: 90, ipoDate: "", ipoAgeMonths: -1 });
  assert.equal(isRecentIpo(ageVerifiedIpo, 60), true, "shared IPO recency helper must accept verified IPO age without a date string");
  assert.equal(isRecentIpo(staleIpoAge, 60), false, "shared IPO recency helper must reject stale IPO age without a date string");
  assert.equal(isRecentIpo(futureIpoAge, 60), false, "shared IPO recency helper must reject future/negative IPO ages");
  assert.equal(isRecentIpo(fakeIpoByScore, 60), false, "shared IPO recency helper must reject score-only IPO rows without age/date evidence");
  assert.equal(rowPassesListContract(ageVerifiedIpo, "ipo"), true, "IPO list contract must accept age-verified IPO rows without a date string");
  assert.equal(rowPassesListContract(fakeIpoByScore, "ipo"), false, "IPO list contract must require a verifiable recent IPO, not only score");
  assert.match(listInclusionReasons(fakeIpoByScore, "ipo").join(" "), /IPO no verificada/i, "invalid IPO rationale must flag missing IPO evidence");
  const ipoTrapBoard = buildLeaderboard([scanResultFromRow(fakeIpoByScore), rows.find((item) => item.raw?.symbol === "DISC6")], {
    strategy: "ipo",
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(ipoTrapBoard.items.map((item) => item.symbol), ["DISC6"], "IPO leaderboard must exclude score-only rows without IPO evidence");
  const staleExtended = baseRow({ symbol: "EXTSTALE", totalScore: 91, rsGlobalPct: 88, price: 90, sma50: 100, sma200: 70, extSma50: 18, distance52w: -6 });
  const stalePullback = baseRow({ symbol: "PBSTALE", totalScore: 84, rsGlobalPct: 82, price: 80, sma50: 100, sma200: 70, extSma50: 0 });
  assert.equal(rowPassesListContract(staleExtended, "extended"), false, "extended list contract must reject stale SMA50 extension mismatches");
  assert.equal(rowPassesListContract(stalePullback, "pullback"), false, "pullback list contract must reject stale SMA50 extension mismatches");
  assert.match(listInclusionReasons(staleExtended, "extended").join(" "), /SMA50 no validada/i, "extended mismatch rationale must flag unvalidated SMA50 extension");
  assert.match(listInclusionReasons(stalePullback, "pullback").join(" "), /SMA50 no validada/i, "pullback mismatch rationale must flag unvalidated SMA50 extension");
  const extendedTrapBoard = buildLeaderboard([scanResultFromRow(staleExtended), rows.find((item) => item.raw?.symbol === "DISC4")], {
    strategy: "extended",
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(extendedTrapBoard.items.map((item) => item.symbol), ["DISC4"], "Extended leaderboard must reject stale SMA50 extension mismatches");
  const pullbackTrapBoard = buildLeaderboard([scanResultFromRow(stalePullback), rows.find((item) => item.raw?.symbol === "DISC5")], {
    strategy: "pullback",
    maxPriceFreshnessDays: 999,
    minCoverageScore: 0,
    limit: 10,
  });
  assert.deepEqual(pullbackTrapBoard.items.map((item) => item.symbol), ["DISC5"], "Pullback leaderboard must reject stale SMA50 extension mismatches");
  assert.equal(isBullishListKey("minervini"), true, "Minervini contract must be classified as bullish");
  assert.equal(isBullishListKey("weakness"), false, "weakness contract must not be classified as bullish");
  assert.equal(listContractForKey("minervini").tone, "bullish", "Minervini Leaders must expose a bullish contract");
  assert.equal(listContractForKey("weakness").tone, "bearish", "Deterioro tecnico must expose a deterioration contract");
  assert.match(listInclusionSummary(listMap.minervini.items.find((item) => item.symbol === "DISC3"), "minervini"), /Minervini|trend template/i, "Minervini rows must explain why they are included");
  assert.match(listInclusionSummary(listMap.weakness.items.find((item) => item.symbol === "DISC9"), "weakness"), /deterioro/i, "weakness rows must explain deterioration");
  assert.match(listInclusionReasons(listMap.weakness.items.find((item) => item.symbol === "DISC9"), "minervini").join(" "), /Revisar coherencia/i, "bullish rationale must flag bearish incoherence if called on an invalid row");
  const groupDrilldown = Object.fromEntries(buildGroupListDrilldown(snapshot.rows, ["minervini", "weakness"], 2).map((bucket) => [bucket.key, bucket]));
  assert.equal(groupDrilldown.minervini.count, listMap.minervini.items.length, "sector drill-down Minervini must use the same visible contract as Listas");
  assert.equal(groupDrilldown.minervini.sample.some((item) => item.symbol === "DISC9" || item.symbol === "DISC10"), false, "sector drill-down Minervini must exclude bearish or negative-momentum traps");
  assert.equal(groupDrilldown.weakness.sample.some((item) => item.symbol === "DISC9"), true, "sector drill-down deterioration must surface bearish traps");
  const softwareGroup = snapshot.groups.theme.find((group) => group.key === "Software / IA");
  assert.ok(softwareGroup?.contractDrilldown?.length, "discovery sector groups must expose contract drill-down over the full group");
  const softwareContracts = Object.fromEntries(softwareGroup.contractDrilldown.map((bucket) => [bucket.key, bucket]));
  assert.equal(softwareGroup.contractScopeRows >= softwareGroup.items.length, true, "sector contract scope must be at least as broad as the visible composite sample");
  assert.equal(softwareGroup.items.some((item) => item.symbol === "DISC11"), true, "software group must include the stale extension trap in broad composite context");
  assert.equal(softwareGroup.extended, 0, "discovery group extended count must use the visible contract and reject stale extension traps");
  assert.equal(softwareContracts.minervini.sample.some((item) => item.symbol === "DISC9" || item.symbol === "DISC10"), false, "discovery sector Minervini contract must exclude bearish or negative-momentum traps");
  assert.equal(softwareContracts.extended.sample.some((item) => item.symbol === "DISC11"), false, "discovery sector Extended contract must exclude stale extension traps");
  assert.equal(softwareContracts.weakness.sample.some((item) => item.symbol === "DISC9"), true, "discovery sector deterioration contract must preserve bearish traps");
  assert.equal(groupDrilldown.minervini.reliability.rows, groupDrilldown.minervini.count, "sector drill-down must summarize reliability on the same matching rows");
  assert.equal(groupDrilldown.minervini.reliability.state, "watch", "coherent fresh Minervini rows with limited pattern data should stay distinct from stale/low-coverage warnings");
  assert.equal(groupDrilldown.minervini.reliability.dataLimitedRows > 0, true, "Minervini reliability must surface methodology limits without invalidating the ranking contract");
  const reliabilityRow = baseRow({
    symbol: "REL1",
    priceFreshnessDays: 9,
    dataCoverageScore: 25,
    setupDisplayDataLimited: true,
    sector: "Sin sector",
  });
  const reliabilityIssues = rowReliabilityIssues(reliabilityRow).map((issue) => issue.key);
  assert.deepEqual(new Set(reliabilityIssues), new Set(["stale", "coverage", "dataLimited", "taxonomy"]), "row reliability must flag freshness, coverage, data limits and taxonomy independently");
  const missingReliabilityRow = baseRow({
    symbol: "RELMISS",
    priceFreshnessDays: null,
    priceFreshnessOk: undefined,
    priceFreshnessIssue: "",
    lastDate: "",
    dataCoverageScore: null,
  });
  const missingReliabilityIssues = rowReliabilityIssues(missingReliabilityRow);
  assert.equal(missingReliabilityIssues.some((issue) => issue.key === "stale" && /sin validar/i.test(issue.label)), true, "row reliability must flag missing freshness as unvalidated price");
  assert.equal(missingReliabilityIssues.some((issue) => issue.key === "coverage" && /sin validar/i.test(issue.label)), true, "row reliability must flag missing coverage as unvalidated coverage");
  const reliabilitySummary = summarizeListReliability([baseRow({ symbol: "REL0" }), reliabilityRow]);
  assert.equal(reliabilitySummary.state, "warn", "list reliability must warn when any visible candidate has weak data");
  assert.equal(reliabilitySummary.staleRows, 1, "list reliability must count stale rows");
  assert.equal(reliabilitySummary.lowCoverageRows, 1, "list reliability must count low coverage rows");
  assert.equal(reliabilitySummary.dataLimitedRows, 1, "list reliability must count data-limited rows");
  assert.equal(reliabilitySummary.missingTaxonomyRows, 1, "list reliability must count missing taxonomy rows");
  const missingReliabilitySummary = summarizeListReliability([missingReliabilityRow]);
  assert.equal(missingReliabilitySummary.state, "warn", "list reliability must warn when freshness and coverage are missing");
  assert.equal(missingReliabilitySummary.staleRows, 1, "list reliability must count missing freshness as stale risk");
  assert.equal(missingReliabilitySummary.lowCoverageRows, 1, "list reliability must count missing coverage as coverage risk");
  const warningDrilldown = buildGroupListDrilldown([reliabilityRow], ["leaders"], 2)[0];
  assert.equal(warningDrilldown.reliability.state, "warn", "sector drill-down reliability must warn on stale/low-coverage matching rows");
  assert.equal(warningDrilldown.reliability.lowCoverageRows, 1, "sector drill-down reliability must carry coverage issues to the UI");
  assert.ok(listMap.extended.items.some((item) => item.symbol === "DISC4"), "extended list must expose extension strategy");
  assert.ok(listMap.pullback.items.some((item) => item.symbol === "DISC5"), "pullback list must expose SMA50 pullback strategy");
  assert.ok(listMap.ipo.items.some((item) => item.symbol === "DISC6"), "IPO list must require a real IPO date");
  assert.ok(snapshot.rows.some((item) => item.symbol === "DISC7" && item.theme === "Automatizacion"), "discovery must canonicalize stale stored themes from sector/industry");
  assert.ok(snapshot.groups.sector.some((group) => group.key === "Technology"), "discovery must build sector groups from the same derived rows");
  assert.equal(snapshot.rows.every((item) => Array.isArray(item.sourceListKeys) && item.sourceListKeys.length), true, "deduped discovery rows must retain list provenance");

  const scopedTheme = buildDiscoverySnapshot(rows, {
    limit: 10,
    groupsLimit: 10,
    minGroupSize: 1,
    minCoverageScore: 0,
    maxPriceFreshnessDays: 999,
    scopeType: "theme",
    scopeValue: "Software / IA",
  });
  assert.equal(scopedTheme.criteria.scopeType, "theme", "scoped discovery must preserve scope type");
  assert.equal(scopedTheme.criteria.scopeValue, "Software / IA", "scoped discovery must preserve scope value");
  assert.equal(scopedTheme.audit.scope.type, "theme", "scoped discovery audit must preserve scope type");
  assert.equal(scopedTheme.audit.scope.value, "Software / IA", "scoped discovery audit must preserve scope value");
  assert.ok(scopedTheme.rows.length > 0, "scoped discovery must return matching rows");
  assert.equal(scopedTheme.rows.every((item) => item.theme === "Software / IA"), true, "scoped discovery rows must not leak another theme");
  assert.equal(scopedTheme.lists.every((list) => list.items.every((item) => item.theme === "Software / IA")), true, "scoped discovery lists must preserve the same theme");

  const scopedEnergy = buildDiscoverySnapshot(rows, {
    limit: 10,
    groupsLimit: 10,
    minGroupSize: 1,
    minCoverageScore: 0,
    maxPriceFreshnessDays: 999,
    scopeType: "theme",
    scopeValue: "Energia / red",
  });
  assert.ok(scopedEnergy.rows.some((item) => item.symbol === "DISC8"), "energy scope must keep genuine energy taxonomy");
  assert.equal(scopedEnergy.rows.some((item) => item.symbol === "DISC7"), false, "energy scope must not leak stale energy labels after canonicalization");
  assert.equal(scopedEnergy.lists.every((list) => list.items.every((item) => item.theme === "Energia / red")), true, "energy scoped lists must preserve canonical energy theme");

  const unvalidatedDiscovery = buildDiscoverySnapshot([
    baseRow({
      symbol: "DISCNULL",
      totalScore: 80,
      rsGlobalPct: 78,
      dataCoverageScore: null,
      priceFreshnessDays: null,
      priceFreshnessOk: undefined,
      priceFreshnessIssue: "",
      lastDate: "",
    }),
  ].map(scanResultFromRow), {
    limit: 10,
    groupsLimit: 10,
    minGroupSize: 1,
    minCoverageScore: 0,
    maxPriceFreshnessDays: 999,
  });
  assert.equal(unvalidatedDiscovery.health.state, "warn", "discovery health must warn when freshness and coverage are unvalidated");
  assert.equal(unvalidatedDiscovery.health.staleRows, 1, "discovery health must count unvalidated price freshness");
  assert.equal(unvalidatedDiscovery.health.lowCoverageRows, 1, "discovery health must count unvalidated coverage");
  assert.match(unvalidatedDiscovery.health.note, /precio sin validar|cobertura baja|sin validar/i, "discovery health note must explain unvalidated data");
}

function runComparableContractTests() {
  const target = normalizeComparableResult({
    symbol: "CMPTGT",
    sector: "Technology",
    industry: "Application Software",
    theme: "Software / IA",
    metrics: { rsSectorPct: 80 },
  });
  const validComparable = normalizeComparableResult({
    symbol: "CMPVALID",
    sector: "Technology",
    industry: "Application Software",
    theme: "Software / IA",
    metrics: {
      rsSectorPct: 74,
      patternDataStatus: "ok",
      patternEligible: true,
      patternQualityScore: 70,
      distanceToPivotPct: -2,
      absDistanceToPivotPct: 2,
      contractionDepths: [14, 7],
      contractionCount: 2,
      contractionsDecreasing: true,
      setupDisplayKey: "pivot_squeeze",
      setupDisplayState: "watch",
      setupDisplayLabel: "Compresión de pivot",
      setupDisplayWatch: true,
      setupDisplayObservable: true,
      setupDisplayBlocksPatternClaim: false,
      setupDisplayDataLimited: false,
    },
  });
  const blockedComparable = normalizeComparableResult({
    symbol: "CMPBLOCK",
    sector: "Technology",
    industry: "Application Software",
    theme: "Software / IA",
    metrics: {
      rsSectorPct: 96,
      patternDataStatus: "ok",
      patternEligible: true,
      patternQualityScore: 99,
      distanceToPivotPct: -0.5,
      absDistanceToPivotPct: 0.5,
      contractionDepths: [20, 10, 5],
      contractionCount: 3,
      contractionsDecreasing: true,
      setupPlanValid: true,
      setupActionable: true,
      setupWatch: true,
      setupDisplayKey: "actionable_vcp",
      setupDisplayState: "data_limited",
      setupDisplayLabel: "VCP plan válido",
      setupDisplayShortLabel: "Plan válido",
      setupDisplayPlanValid: false,
      setupDisplayActionable: false,
      setupDisplayTradePlanEligible: false,
      setupDisplayWatch: false,
      setupDisplayBlocksPatternClaim: true,
      setupDisplayDataLimited: true,
      methodologyReliabilityState: "data_limited",
    },
  });

  assert.equal(validComparable.comparablePatternUsable, true, "valid comparable pattern should be usable for ranking evidence");
  assert.equal(comparablePatternUsable(validComparable), true, "valid comparable pattern should remain usable after normalization");
  assert.equal(blockedComparable.setupDisplayBlocksPatternClaim, true, "comparable normalization must preserve display claim blockers");
  assert.equal(blockedComparable.setupDisplayPlanValid, false, "comparable normalization must preserve display plan rejection");
  assert.equal(blockedComparable.comparablePatternUsable, false, "blocked comparable pattern must not be usable for ranking evidence");
  assert.equal(comparablePatternUsable(blockedComparable), false, "blocked comparable pattern must stay unusable in scoring");
  assert.ok(
    comparableScore(validComparable, target) < comparableScore(blockedComparable, target),
    "blocked high-quality pivot traps must not outrank validated comparables by raw pattern/pivot metrics",
  );
}

function runCoverageAuditContractTests() {
  const inputRows = [
    baseRow({ symbol: "AUDUS", country: "US", sector: "Technology", industry: "Software", theme: "Software / IA", totalScore: 92 }),
    baseRow({ symbol: "AUDES.MC", country: "ES", sector: "Utilities", industry: "Renewables", theme: "Energia / red", totalScore: 30, rsGlobalPct: 20 }),
    baseRow({ symbol: "AUDJP.T", country: "JP", sector: "Industrials", industry: "Machinery", theme: "Automatizacion", totalScore: 28, rsGlobalPct: 18 }),
    baseRow({ symbol: "AUDCA.TO", country: "CA", sector: "Financial Services", industry: "Banks", theme: "Finanzas", totalScore: 25, rsGlobalPct: 16 }),
  ];
  const audit = buildCoverageAudit({
    inputRows,
    rankedRows: [inputRows[0]],
    lists: [
      { key: "leaders", title: "Composite Leaders", items: [inputRows[0]] },
      { key: "minervini", title: "Minervini Leaders", items: [] },
    ],
    groups: {
      sector: [
        { key: "Technology", count: 1, items: [inputRows[0]], strength: 78 },
        { key: "Utilities", count: 1, items: [inputRows[1]], strength: 40 },
      ],
    },
    criteria: { minMarketRows: 1, minGroupRows: 3, minListRows: 2, concentrationPct: 60, biasDeltaPct: 20 },
  });

  assert.equal(audit.state, "warn", "coverage audit must warn when rankings are materially biased");
  assert.equal(audit.universeRows, 4, "coverage audit must count scoped universe rows");
  assert.equal(audit.rankedRows, 1, "coverage audit must count ranked rows");
  assert.equal(audit.coverageGaps.uncoveredMarkets.some((item) => item.key === "ES"), true, "coverage audit must flag scanned markets with no visible candidates");
  assert.equal(audit.listHealth.emptyLists.some((item) => item.key === "minervini"), true, "coverage audit must flag empty derived lists");
  assert.equal(audit.groupHealth.strongThinGroups.some((item) => item.key === "Technology"), true, "coverage audit must flag strong groups built on too-small samples");
  assert.match(auditIssueLabels(audit).join(" "), /sin candidatos|muestra|vacia/i, "coverage audit labels must be reader-actionable");

  const scoped = buildCoverageAudit({
    inputRows,
    rankedRows: [inputRows[1]],
    scopeType: "country",
    scopeValue: "ES",
    lists: [{ key: "leaders", title: "Composite Leaders", items: [inputRows[1]] }],
    criteria: { minMarketRows: 1, minListRows: 1, minGroupRows: 1 },
  });
  assert.equal(scoped.universeRows, 1, "country-scoped audit must narrow universe rows");
  assert.equal(scoped.rankedRows, 1, "country-scoped audit must narrow ranked rows");
  assert.equal(scoped.scope.type, "country", "country-scoped audit must preserve scope type");
  assert.equal(scoped.state, "pass", "country-scoped audit with one represented market should not warn for global concentration");

  const missingCountAudit = buildCoverageAudit({
    inputRows: [inputRows[0]],
    lists: [
      { key: "leaders", title: "Composite Leaders", count: "", items: [inputRows[0]] },
      { key: "nearPivot", title: "Vigilancia pivot", count: 0, items: [inputRows[0]] },
    ],
    groups: {
      sector: [{ key: "Technology", count: "", items: [inputRows[0]], strength: "" }],
    },
    criteria: { minMarketRows: 1, minListRows: 2, minGroupRows: 2 },
  });
  const missingCountLists = Object.fromEntries(missingCountAudit.listHealth.lists.map((item) => [item.key, item]));
  assert.equal(missingCountLists.leaders.count, 1, "coverage audit must fallback blank list counts to visible items");
  assert.equal(missingCountLists.nearPivot.count, 1, "coverage audit must not mark a list empty when visible items contradict count 0");
  assert.equal(missingCountAudit.listHealth.emptyLists.length, 0, "coverage audit must not create false empty-list warnings from missing counts");
  assert.equal(missingCountAudit.groupHealth.thinGroups[0]?.count, 1, "coverage audit must fallback blank group counts to visible group items");
}

function runSavedListViewContractTests() {
  const discovery = {
    generatedAt: "2026-06-04T10:15:00.000Z",
    criteria: { maxPriceFreshnessDays: 5, minCoverageScore: 40 },
    health: { rows: 61, listItemCount: 144, staleRows: 0, planClaims: 0 },
  };
  const view = buildSavedListView({
    filter: { groupType: "theme", group: "Energia / red" },
    discovery,
    usingDiscovery: true,
    localRows: 12,
    now: "2026-06-04T11:00:00.000Z",
    id: "energy-view",
  });

  assert.equal(view.signature, "theme:Energia / red", "saved list view must preserve scope signature");
  assert.equal(view.name, "Tematica · Energia / red", "saved list view must use a readable scoped name");
  assert.equal(view.source, "discovery-api", "saved list view must preserve discovery source");
  assert.equal(view.generatedAt, discovery.generatedAt, "saved list view must preserve source generation date");
  assert.equal(view.counts.rows, 61, "saved list view must preserve discovery row count");
  assert.equal(view.criteria.maxPriceFreshnessDays, 5, "saved list view must preserve freshness criteria");
  assert.equal(listViewHref(view), "/lists?groupType=theme&group=Energia+%2F+red", "saved list view href must reconstruct the same filtered list");
  assert.equal(savedListViewMetaLine(view).includes("61 alcance"), true, "scoped discovery views must describe saved counts as scope coverage");
  assert.equal(listViewSignature({ groupType: "unknown", group: "Energia / red" }), "global", "invalid scopes must not create misleading signatures");

  const globalDiscoveryView = buildSavedListView({
    filter: {},
    discovery,
    usingDiscovery: true,
    now: "2026-06-04T11:05:00.000Z",
    id: "global-discovery",
  });
  assert.equal(savedListViewMetaLine(globalDiscoveryView).includes("61 filas"), true, "global discovery views must still describe ranking rows as rows");

  const missingCountsView = normalizeSavedListViews([{
    id: "missing-counts",
    source: "discovery-api",
    counts: { rows: null, scopeRows: "", staleRows: undefined, planClaims: null },
    criteria: { maxPriceFreshnessDays: "", minCoverageScore: null },
    updatedAt: "2026-06-04T11:10:00.000Z",
  }])[0];
  assert.equal(missingCountsView.counts.rows, null, "saved views must preserve missing row counts as null, not 0");
  assert.equal(missingCountsView.counts.scopeRows, null, "saved views must preserve blank scope counts as null, not 0");
  assert.equal(missingCountsView.criteria.maxPriceFreshnessDays, null, "saved views must preserve blank criteria as null, not 0");
  assert.equal(savedListViewMetaLine(missingCountsView).includes("filas -"), true, "saved views with unknown counts should not claim 0 rows");

  const sectorOriginView = buildSavedListView({
    filter: { groupType: "theme", group: "Energia / red" },
    discovery: {
      ...discovery,
      health: { ...discovery.health, rows: 12, scopeRows: 100, listItemCount: 12 },
    },
    usingDiscovery: true,
    now: "2026-06-04T11:15:00.000Z",
    id: "energy-sector-origin",
  });
  assert.equal(sectorOriginView.counts.rows, 12, "sector-origin saved views must preserve rendered top rows separately");
  assert.equal(sectorOriginView.counts.scopeRows, 100, "sector-origin saved views must preserve full group size separately");
  assert.equal(savedListViewMetaLine(sectorOriginView).includes("100 en grupo"), true, "sector-origin saved views must label full group size without calling it ranking rows");
  assert.equal(savedListViewMetaLine(sectorOriginView).includes("top 12"), true, "sector-origin saved views must label the represented top rows");

  const older = { ...view, id: "older", updatedAt: "2026-06-04T09:00:00.000Z", counts: { rows: 1 } };
  const newer = { ...view, id: "newer", updatedAt: "2026-06-04T12:00:00.000Z", counts: { rows: 62 } };
  const normalized = normalizeSavedListViews([older, newer, buildSavedListView({ filter: {}, usingDiscovery: false, localRows: 8, now: "2026-06-04T10:00:00.000Z", id: "global" })]);
  assert.equal(normalized.length, 2, "saved list views must dedupe by scope signature");
  assert.equal(normalized[0].id, "newer", "saved list views must keep the newest view per scope");
  assert.equal(normalized[0].counts.rows, 62, "deduped saved list view must preserve newest metadata");

  const localSectorView = buildSavedListView({
    filter: { groupType: "sector", group: "Industrials" },
    usingDiscovery: false,
    localRows: 28,
    now: "2026-06-04T11:30:00.000Z",
    id: "sector-view",
  });
  assert.equal(localSectorView.signature, "sector:Industrials", "sector views saved outside /lists must preserve sector scope");
  assert.equal(localSectorView.source, "local-snapshot", "local sector views must declare local snapshot source");
  assert.equal(localSectorView.counts.rows, 28, "local sector views must preserve local row count");
  assert.equal(listViewHref(localSectorView), "/lists?groupType=sector&group=Industrials", "sector views must reopen the same /lists scope");
}

function runCloudMergeContractTests() {
  const remoteFavs = [{ symbol: "NVDA", notes: "nube", updatedAt: "2026-05-25T10:00:00.000Z" }];
  const localFavs = [{ symbol: "NVDA", notes: "local viejo", updatedAt: "2026-05-24T10:00:00.000Z" }];
  const mergedRemoteWins = mergeByKey(remoteFavs, localFavs, (favorite) => favorite.symbol);
  assert.equal(mergedRemoteWins[0].notes, "nube", "cloud merge must keep the newest favorite snapshot by updatedAt");

  const mergedLocalWins = mergeByKey(remoteFavs, [{ symbol: "NVDA", notes: "local nuevo", updatedAt: "2026-05-26T10:00:00.000Z" }], (favorite) => favorite.symbol);
  assert.equal(mergedLocalWins[0].notes, "local nuevo", "cloud merge must keep the local favorite when it is newer");

  const scans = mergeByKey(
    [{ id: "scan-1", rows: [1], updatedAt: "2026-05-25T10:00:00.000Z" }],
    [{ id: "scan-1", rows: [1, 2], updatedAt: "2026-05-26T10:00:00.000Z" }],
    (scan) => scan.id,
  );
  assert.deepEqual(scans[0].rows, [1, 2], "snapshot merge must not replace newer local rows with older cloud rows");
}

function runFavoriteSyncContractTests() {
  const stale = favoriteSyncSummary(
    [{ symbol: "NVDA", updated_at: "2026-05-26T10:00:00.000Z" }],
    [{ symbol: "nvda", updated_at: "2026-05-25T10:00:00.000Z" }],
  );
  assert.deepEqual(stale, { saved: 0, returned: 1, skippedStale: 1 }, "favorite RPC summary must mark older local writes as skipped");

  const equal = favoriteSyncSummary(
    [{ symbol: "MSFT", updated_at: "2026-05-26T10:00:00.000Z" }],
    [{ symbol: "MSFT", updated_at: "2026-05-26T10:00:00.000Z" }],
  );
  assert.deepEqual(equal, { saved: 1, returned: 1, skippedStale: 0 }, "equal timestamps are accepted so idempotent retries stay safe");

  const duplicatePayload = favoriteSyncSummary(
    [{ symbol: "ASML", updated_at: "2026-05-26T10:00:00.000Z" }],
    [
      { symbol: "ASML", updated_at: "2026-05-25T10:00:00.000Z" },
      { symbol: "ASML", updated_at: "2026-05-27T10:00:00.000Z" },
    ],
  );
  assert.deepEqual(duplicatePayload, { saved: 1, returned: 1, skippedStale: 0 }, "duplicate payloads compare against the newest incoming timestamp");

  const staleDelete = favoriteDeleteSummary(
    [{ symbol: "NVDA", updated_at: "2026-05-26T10:00:00.000Z", deleted_at: null }],
    [{ symbol: "NVDA", deletedAt: "2026-05-25T10:00:00.000Z" }],
  );
  assert.deepEqual(staleDelete, { deleted: 0, returned: 1, skippedStale: 1 }, "older delete tombstones must not delete newer remote favorites");

  const acceptedDelete = favoriteDeleteSummary(
    [{ symbol: "MSFT", updated_at: "2026-05-26T10:00:00.000Z", deleted_at: "2026-05-26T10:00:00.000Z" }],
    [{ symbol: "MSFT", deletedAt: "2026-05-26T10:00:00.000Z" }],
  );
  assert.deepEqual(acceptedDelete, { deleted: 1, returned: 1, skippedStale: 0 }, "equal delete tombstones are idempotent");

  const mergedAfterRemoteDelete = mergeFavoritesWithTombstones(
    [],
    [{ symbol: "ASML", notes: "local viejo", updatedAt: "2026-05-25T10:00:00.000Z" }],
    [{ symbol: "ASML", deletedAt: "2026-05-26T10:00:00.000Z" }],
  );
  assert.deepEqual(mergedAfterRemoteDelete, [], "remote tombstones must remove older local favorites during pull");

  const mergedAfterLocalReadd = mergeFavoritesWithTombstones(
    [],
    [{ symbol: "ASML", notes: "readd", updatedAt: "2026-05-27T10:00:00.000Z" }],
    [{ symbol: "ASML", deletedAt: "2026-05-26T10:00:00.000Z" }],
  );
  assert.equal(mergedAfterLocalReadd[0].notes, "readd", "newer local re-add must beat an older tombstone");
}

function runSnapshotAlertSettingSyncContractTests() {
  const staleScanWrite = scanSyncSummary(
    [{ local_id: "scan-1", updated_at: "2026-05-26T10:00:00.000Z", deleted_at: null }],
    [{ local_id: "scan-1", updated_at: "2026-05-25T10:00:00.000Z" }],
  );
  assert.deepEqual(staleScanWrite, { saved: 0, returned: 1, skippedStale: 1 }, "older snapshot writes must not replace newer remote snapshots");

  const acceptedScanDelete = scanDeleteSummary(
    [{ local_id: "scan-1", updated_at: "2026-05-26T10:00:00.000Z", deleted_at: "2026-05-26T10:00:00.000Z" }],
    [{ id: "scan-1", deletedAt: "2026-05-26T10:00:00.000Z" }],
  );
  assert.deepEqual(acceptedScanDelete, { deleted: 1, returned: 1, skippedStale: 0 }, "snapshot deletes are idempotent at equal timestamps");

  const mergedAfterRemoteScanDelete = mergeScansWithTombstones(
    [],
    [{ id: "scan-1", rows: [1], updatedAt: "2026-05-25T10:00:00.000Z" }],
    [{ id: "scan-1", deletedAt: "2026-05-26T10:00:00.000Z" }],
  );
  assert.deepEqual(mergedAfterRemoteScanDelete, [], "remote scan tombstones must remove older local snapshots during pull");

  const mergedAfterLocalScanReadd = mergeScansWithTombstones(
    [],
    [{ id: "scan-1", rows: [1, 2], updatedAt: "2026-05-27T10:00:00.000Z" }],
    [{ id: "scan-1", deletedAt: "2026-05-26T10:00:00.000Z" }],
  );
  assert.deepEqual(mergedAfterLocalScanReadd[0].rows, [1, 2], "newer local snapshot re-add must beat older scan tombstones");

  const staleAlertWrite = alertSyncSummary(
    [{ local_id: "alert-1", updated_at: "2026-05-26T10:00:00.000Z" }],
    [{ local_id: "alert-1", updated_at: "2026-05-25T10:00:00.000Z" }],
  );
  assert.deepEqual(staleAlertWrite, { saved: 0, returned: 1, skippedStale: 1 }, "older alert writes must not reopen newer remote alert state");

  const mergedAlerts = mergeAlertsWithTimestamps(
    [{ id: "alert-1", status: "resolved", updatedAt: "2026-05-26T10:00:00.000Z" }],
    [{ id: "alert-1", status: "active", updatedAt: "2026-05-25T10:00:00.000Z" }],
  );
  assert.equal(mergedAlerts[0].status, "resolved", "alert pull must keep the newest status across local and cloud");

  const staleSettingWrite = settingSyncSummary(
    [{ setting_type: "screener_filters", setting_key: "default", updated_at: "2026-05-26T10:00:00.000Z" }],
    { updated_at: "2026-05-25T10:00:00.000Z" },
  );
  assert.deepEqual(staleSettingWrite, { saved: 0, returned: 1, skippedStale: 1 }, "older filter settings must not overwrite newer cloud settings");
}

function runQuickListCoherenceTests() {
  const source = baseRow({
    symbol: "COH",
    companyName: "Coherence Corp",
    rsGlobalPct: 97,
    rsRating: 52,
    totalScore: 91,
    lastDate: "2026-05-25",
  });
  const favorite = createFavoriteFromRow(source, { source: "coherence-test" });
  const rowFromFavorite = favoriteToRow(favorite);

  assert.equal(rowFromFavorite.symbol, source.symbol, "favorite quick-list row must preserve symbol");
  assert.equal(rowFromFavorite.rsGlobalPct, source.rsGlobalPct, "favorite quick-list row must preserve RS global, not benchmark RS");
  assert.equal(rowFromFavorite.totalScore, source.totalScore, "favorite quick-list row must preserve screener total score");
  assert.equal(rowFromFavorite.lastDate, source.lastDate, "favorite quick-list row must preserve price date for ficha/list consistency");
}

function runTrendStructureTests() {
  assert.equal(isConfirmedStage2(baseRow()), true, "base row should be confirmed Stage 2");
  const broken = baseRow({ sma50: 70, sma150: 82 });
  assert.equal(isConfirmedStage2(broken), false, "broken MA stack should not be Stage 2");
  assert.match(stage2RejectDetail(broken), /SMA50|Stage 2|Precio|SMA/i);
}

function runScreenerContractDisplayTests() {
  assert.equal(screenerContractKeyForSettings({ setupMode: "leader" }, "balanced"), "long", "leader mode should expose a long contract");
  assert.equal(screenerContractKeyForSettings({ setupMode: "weakness" }, "balanced"), "bearish", "weakness mode must never expose a long contract");
  assert.equal(screenerContractKeyForSettings({ setupMode: "any" }, "balanced"), "exploratory", "any mode must be labeled exploratory");
  assert.equal(screenerContractKeyForSettings({ setupMode: "nearPivot" }, "balanced"), "watch", "near pivot must be separated as watchlist");
  assert.equal(isScreenerLongContract({ setupMode: "weakness" }, "weakness"), false, "weakness preset is not a long-opportunity contract");

  const degraded = buildScreenerContract({
    settings: { setupMode: "leader" },
    presetKey: "balanced",
    filterLayers: { trend: false, momentum: true, relativeStrength: true, coverage: true },
    useRegimeFilter: false,
    executionRuleActive: 9,
    executionRuleTotal: 18,
    rowsCount: 10,
    filteredCount: 10,
    analyzedCount: 10,
  });
  const degradedText = degraded.warnings.map((warning) => warning.text).join(" ");
  assert.equal(degraded.key, "long", "degraded leader still has a long base contract");
  assert.match(degradedText, /Trend off/i, "long contract should warn when trend layer is disabled");
  assert.match(degradedText, /Regimen off/i, "long contract should warn when regime is disabled");

  const bearish = buildScreenerContract({ settings: { setupMode: "weakness" }, presetKey: "weakness", presetName: "Deterioro tecnico" });
  assert.equal(bearish.tone, "bearish", "weakness contract should render as bearish");
  assert.match(bearish.text, /no es una lista de largos/i, "weakness copy must prevent mixing with long lists");

  const bearishOrigin = buildScreenerStockContext(bearish, {
    symbol: "DISC9",
    row: baseRow({ symbol: "DISC9", weaknessScore: 82, totalScore: 88, rsGlobalPct: 91 }),
    rank: 3,
    queueSize: 9,
    openedAt: "2026-06-05T09:00:00.000Z",
  });
  assert.equal(bearishOrigin.tone, "bearish", "stock origin must preserve bearish screener tone");
  assert.equal(bearishOrigin.symbol, "DISC9", "stock origin must preserve symbol");
  assert.equal(bearishOrigin.rank, 3, "stock origin must preserve queue rank");
  assert.equal(bearishOrigin.row.weakness, "82", "stock origin must preserve deterioration score for bearish context");
  assert.match(bearishOrigin.statusText, /deterioro|debilidad|largos/i, "stock origin status must explain weakness context");

  const sparseOrigin = buildScreenerStockContext(bearish, {
    symbol: "NODATA",
    row: { symbol: "NODATA", totalScore: null, rsGlobalPct: "", weaknessScore: undefined },
    rank: null,
    queueSize: "",
    openedAt: "2026-06-05T09:30:00.000Z",
  });
  assert.equal(sparseOrigin.rank, null, "stock origin must preserve missing rank as null, not 0");
  assert.equal(sparseOrigin.queueSize, null, "stock origin must preserve missing queue size as null, not 0");
  assert.equal(sparseOrigin.row.score, "-", "stock origin must show missing score as dash, not 0");
  assert.equal(sparseOrigin.row.rs, "-", "stock origin must show missing RS as dash, not 0");
  assert.equal(sparseOrigin.row.weakness, "-", "stock origin must show missing weakness as dash, not 0");

  const session = {
    lastOpenedStockSymbol: "DISC9",
    lastOpenedStockAt: "2026-06-05T09:00:00.000Z",
    lastOpenedStockContext: bearishOrigin,
  };
  assert.equal(screenerStockContextFromSession(session, "DISC9", { now: Date.parse("2026-06-05T10:00:00.000Z") })?.tone, "bearish", "matching fresh stock page must recover screener origin");
  assert.equal(screenerStockContextFromSession(session, "OTHER", { now: Date.parse("2026-06-05T10:00:00.000Z") }), null, "stock page must not show screener origin for another symbol");
  assert.equal(screenerStockContextFromSession(session, "DISC9", { now: Date.parse("2026-06-06T10:00:00.000Z") }), null, "stock page must hide stale screener origin");
}

function main() {
  runFilterCatalogContractTests();
  runThresholdMatrix();
  runBooleanAndModeTests();
  runFreshnessAndDataGateTests();
  runPatternValidityGateTests();
  runParsingAndExactnessTests();
  runFilterExplainPlanTests();
  runLeaderboardSnapshotContractTests();
  runDiscoveryContractTests();
  runComparableContractTests();
  runCoverageAuditContractTests();
  runSavedListViewContractTests();
  runCloudMergeContractTests();
  runFavoriteSyncContractTests();
  runSnapshotAlertSettingSyncContractTests();
  runQuickListCoherenceTests();
  runTrendStructureTests();
  runScreenerContractDisplayTests();
  console.log("OK filter-regression-test: thresholds, leaderboards, sync merge, freshness, Stage 2 and screener contracts passed.");
}

main();
