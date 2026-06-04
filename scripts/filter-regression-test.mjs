import assert from "node:assert/strict";

import {
  applyScreenerFilters,
  effectiveScreenerFilterValues,
  screenerFilterRejectReason,
  screenerFiltersFromParams,
} from "@/lib/screenerFilters";
import { buildScreenerContract, buildScreenerStockContext, isScreenerLongContract, screenerContractKeyForSettings, screenerStockContextFromSession } from "@/lib/screenerContracts";
import { alertSyncSummary } from "@/app/api/alerts/route.js";
import { favoriteDeleteSummary, favoriteSyncSummary } from "@/app/api/favorites/route.js";
import { scanDeleteSummary, scanSyncSummary } from "@/app/api/scans/route.js";
import { settingSyncSummary } from "@/app/api/settings/route.js";
import { mergeAlertsWithTimestamps, mergeByKey, mergeFavoritesWithTombstones, mergeScansWithTombstones } from "@/lib/cloudSyncClient";
import { buildDiscoverySnapshot } from "@/lib/discovery";
import { auditIssueLabels, buildCoverageAudit } from "@/lib/discoveryAudit";
import { buildLeaderboard } from "@/lib/leaderboards";
import { buildSavedListView, listViewHref, listViewSignature, normalizeSavedListViews, savedListViewMetaLine } from "@/lib/listViews";
import { buildGroupListDrilldown, enforceListContractRows, isBullishListKey, listContractForKey, listInclusionReasons, listInclusionSummary, rowPassesListContract, rowReliabilityIssues, summarizeListReliability } from "@/lib/listRationale";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { createFavoriteFromRow, favoriteToRow, isLongOpportunityRow, normalizeStockRows } from "@/lib/stockRows";
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

  expectPass("nearPivot accepts all boundaries", baseRow({ distance20d: -6, highsSpreadPct: 10, extSma50: 18 }), { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 18 });
  expectReject("nearPivot rejects extension beyond internal cap", baseRow({ extSma50: 18.1 }), { ...BASE_FILTERS, setupMode: "nearPivot", maxDistance20dHigh: 6, maxHighsSpreadPct: 10, maxExtensionSma50: 25 }, "setupMode");

  expectPass("pullback accepts SMA50 pullback window", baseRow({ extSma50: 0, distance52w: -20, perf6m: 8 }), { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 });
  expectReject("pullback rejects broken pullback window", baseRow({ extSma50: 10, distance52w: -20, perf6m: 12 }), { ...BASE_FILTERS, setupMode: "pullback", minPerf6m: 0 }, "setupMode");

  expectPass("early accepts boundary setup", baseRow({ distance52w: -35, perf3m: 5, extSma50: 20 }), { ...BASE_FILTERS, setupMode: "early", minPerf3m: 5, maxExtensionSma50: 20 });
  expectReject("early rejects price below SMA200 via long bias", baseRow({ price: 70, sma200: 72 }), { ...BASE_FILTERS, setupMode: "early", minPerf3m: 5, maxExtensionSma50: 20 }, "longBiasFloor");

  expectPass("ipoRecent accepts recent issue", baseRow({ ipoAgeMonths: 10, distance52w: -35, extSma50: 35, momentumScore: 35 }), { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 });
  expectReject("ipoRecent rejects old issue", baseRow({ ipoAgeMonths: 13, distance52w: -35, extSma50: 35, momentumScore: 35 }), { ...BASE_FILTERS, setupMode: "ipoRecent", maxIpoAgeMonths: 12, maxExtensionSma50: 35, minMomentumScore: 35 }, "setupMode");

  expectPass("extended accepts strong extension window", baseRow({ extSma50: 12, momentumScore: 65 }), { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 });
  expectReject("extended rejects under-extension", baseRow({ extSma50: 11.9, momentumScore: 80 }), { ...BASE_FILTERS, setupMode: "extended", maxExtensionSma50: 25, minMomentumScore: 50 }, "setupMode");

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

  const rows = [
    baseRow({ symbol: "RS98", rsGlobalPct: 98 }),
    baseRow({ symbol: "RS99", rsGlobalPct: 99 }),
  ];
  const result = applyScreenerFilters(rows, filters);
  assert.deepEqual(result.rows.map((row) => row.symbol), ["RS99"], "minRsRating 99 must only pass 99+ rows");
  assert.deepEqual(result.rejections.map((row) => row.symbol), ["RS98"]);
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
  const rows = [benchmarkOnly, globalLeader, globalLag].map(scanResultFromRow);

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
}

function runDiscoveryContractTests() {
  assert.equal(normalizeStockRows([baseRow({ sector: "", industry: "", theme: { color: "#22c55e", label: "Objeto legado", stance: "bullish" } })])[0].theme, "Objeto legado", "stock row normalization must render legacy theme objects as text");

  const rows = [
    baseRow({ symbol: "DISC1", companyName: "Discovery Leader", totalScore: 93, rsGlobalPct: 91, rsQualityScore: 88, sector: "Technology", industry: "Software", theme: "Software / IA" }),
    baseRow({ symbol: "DISC2", companyName: "Discovery Weak", totalScore: 42, rsGlobalPct: 32, weaknessScore: 78, perf3m: -18, distance52w: -46, riskScore: 25, sector: "Industrials", industry: "Machinery", theme: "Automatizacion" }),
    baseRow({ symbol: "DISC3", companyName: "Discovery Minervini", totalScore: 88, minerviniScore: 94, sector: "Healthcare", industry: "Medical Devices", theme: "Medtech / biotech" }),
    baseRow({ symbol: "DISC4", companyName: "Discovery Extended", totalScore: 89, rsGlobalPct: 86, extSma50: 24, distance52w: -6, sector: "Technology", industry: "Semiconductors", theme: "Semis / fotonica" }),
    baseRow({ symbol: "DISC5", companyName: "Discovery Pullback", totalScore: 84, rsGlobalPct: 82, extSma50: 2, price: 100, sma200: 78, sector: "Consumer Cyclical", industry: "Specialty Retail", theme: "Consumo / marca" }),
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
  assert.ok(listMap.leaders.items.some((item) => item.symbol === "DISC1"), "discovery leaders must use composite leaderboard strategy");
  assert.ok(listMap.rsQuality.items.every((item) => Number(item.rsQualityScore || 0) >= 55), "RS Quality list must require RS quality score");
  assert.ok(listMap.weakness.items.some((item) => item.symbol === "DISC2"), "weakness list must expose deterioration strategy");
  assert.ok(listMap.minervini.items.some((item) => item.symbol === "DISC3"), "minervini list must expose Minervini strategy");
  assert.equal(isLongOpportunityRow(listMap.weakness.items.find((item) => item.symbol === "DISC9")), false, "bearish high-score traps must fail long-opportunity coherence");
  assert.equal(listMap.minervini.items.some((item) => item.symbol === "DISC9"), false, "Minervini Leaders must not include bearish high-score traps");
  assert.equal(listMap.minervini.items.some((item) => item.symbol === "DISC10"), false, "Minervini Leaders must require non-negative 3M momentum");
  assert.equal(rowPassesListContract(listMap.leaders.items.find((item) => item.symbol === "DISC10") || rows.find((item) => item.symbol === "DISC10")?.raw, "minervini"), false, "visible Minervini contract must reject negative 3M momentum");
  assert.equal(["leaders", "rsQuality", "weinstein", "minervini", "nearPivot", "ipo", "extended", "pullback"].every((key) => !listMap[key].items.some((item) => item.symbol === "DISC9")), true, "bullish discovery lists must exclude bearish high-score traps");
  assert.equal(listMap.weakness.items.some((item) => item.symbol === "DISC9"), true, "bearish high-score traps may only appear in deterioration lists");
  const uiGuard = enforceListContractRows([
    listMap.minervini.items.find((item) => item.symbol === "DISC3"),
    rows.find((item) => item.symbol === "DISC9")?.raw,
    rows.find((item) => item.symbol === "DISC10")?.raw,
  ], "minervini");
  assert.deepEqual(uiGuard.rows.map((item) => item.symbol), ["DISC3"], "visible list contract guard must preserve only coherent Minervini leaders");
  assert.equal(uiGuard.rejectedCount, 2, "visible list contract guard must count rejected discovery rows");
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
  assert.equal(softwareContracts.minervini.sample.some((item) => item.symbol === "DISC9" || item.symbol === "DISC10"), false, "discovery sector Minervini contract must exclude bearish or negative-momentum traps");
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
  const reliabilitySummary = summarizeListReliability([baseRow({ symbol: "REL0" }), reliabilityRow]);
  assert.equal(reliabilitySummary.state, "warn", "list reliability must warn when any visible candidate has weak data");
  assert.equal(reliabilitySummary.staleRows, 1, "list reliability must count stale rows");
  assert.equal(reliabilitySummary.lowCoverageRows, 1, "list reliability must count low coverage rows");
  assert.equal(reliabilitySummary.dataLimitedRows, 1, "list reliability must count data-limited rows");
  assert.equal(reliabilitySummary.missingTaxonomyRows, 1, "list reliability must count missing taxonomy rows");
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
  runThresholdMatrix();
  runBooleanAndModeTests();
  runFreshnessAndDataGateTests();
  runParsingAndExactnessTests();
  runLeaderboardSnapshotContractTests();
  runDiscoveryContractTests();
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
