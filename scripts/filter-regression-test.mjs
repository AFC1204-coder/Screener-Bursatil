import assert from "node:assert/strict";

import {
  applyScreenerFilters,
  effectiveScreenerFilterValues,
  screenerFilterRejectReason,
  screenerFiltersFromParams,
} from "@/lib/screenerFilters";
import { alertSyncSummary } from "@/app/api/alerts/route.js";
import { favoriteDeleteSummary, favoriteSyncSummary } from "@/app/api/favorites/route.js";
import { scanDeleteSummary, scanSyncSummary } from "@/app/api/scans/route.js";
import { settingSyncSummary } from "@/app/api/settings/route.js";
import { mergeAlertsWithTimestamps, mergeByKey, mergeFavoritesWithTombstones, mergeScansWithTombstones } from "@/lib/cloudSyncClient";
import { buildLeaderboard } from "@/lib/leaderboards";
import { qualityGateForResearchRow } from "@/lib/qualityGate";
import { createFavoriteFromRow, favoriteToRow } from "@/lib/stockRows";
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

function main() {
  runThresholdMatrix();
  runBooleanAndModeTests();
  runFreshnessAndDataGateTests();
  runParsingAndExactnessTests();
  runLeaderboardSnapshotContractTests();
  runCloudMergeContractTests();
  runFavoriteSyncContractTests();
  runSnapshotAlertSettingSyncContractTests();
  runQuickListCoherenceTests();
  runTrendStructureTests();
  console.log("OK filter-regression-test: thresholds, leaderboards, sync merge, freshness and Stage 2 contracts passed.");
}

main();
