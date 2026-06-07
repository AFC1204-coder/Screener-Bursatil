import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  DEFAULT_FILTER_LAYERS,
  DEFAULT_FILTER_STRICTNESS,
  NEUTRAL_FIELD_VALUES,
} from "../lib/screenerFilterCatalog.js";

const BASE_URL = process.env.FILTER_UI_BASE_URL || "http://127.0.0.1:3000";
const STORAGE_KEY = "statsedge.screenerSession.v1";
const SCANS_KEY = "statsedge.scans.v1";
const FAVORITES_KEY = "statsedge.favorites.v1";
const SESSION_VERSION = 4;

const DEFAULT_VIEW_LAYERS = {
  country: true,
  theme: true,
  sector: true,
  industry: true,
  sectorStrength: true,
  ipo: true,
};

const NEUTRAL_SETTINGS = {
  filterStrictness: DEFAULT_FILTER_STRICTNESS,
  setupMode: "any",
  requireStage2: false,
  requireSma200Up: false,
  requirePriceAboveSma50: false,
  requireRecentIpo: false,
  requireUpVolume: false,
  requireContractionsDecreasing: false,
  stageFastWeeks: 10,
  stageSlowWeeks: 30,
  stageSlopeWeeks: 10,
  ...NEUTRAL_FIELD_VALUES,
};

function chartPreview(seed = 100) {
  return Array.from({ length: 48 }, (_, index) => ({
    date: `2026-03-${String((index % 28) + 1).padStart(2, "0")}`,
    open: seed + index * 0.2,
    high: seed + index * 0.2 + 1,
    low: seed + index * 0.2 - 1,
    close: seed + index * 0.2,
    volume: 500_000 + index * 1000,
    sma50: seed - 6 + index * 0.1,
    sma200: seed - 18 + index * 0.05,
  }));
}

function row(overrides = {}) {
  const symbol = overrides.symbol || "TST";
  return {
    symbol,
    companyName: overrides.companyName || `${symbol} Test Corp.`,
    country: "US",
    theme: "Software",
    sector: "Technology",
    industry: "Application Software",
    currency: "USD",
    price: 100,
    marketCap: 1_000_000_000,
    avgVolume: 1_000_000,
    avgTurnover: 100_000_000,
    latestVolume: 1_000_000,
    latestTurnover: 100_000_000,
    relativeVolume: 1.2,
    volumeSurgePct: 20,
    upDownVolRatio: 1.3,
    volumeEffectScore: 80,
    shortPercentOfFloat: 2,
    perf3m: 25,
    perf6m: 40,
    perf12m: 70,
    sma50: 92,
    sma150: 82,
    sma200: 72,
    sma200Slope: 4,
    distance20d: -2,
    distance50d: -4,
    distance52w: -8,
    distanceATH: -10,
    highsSpreadPct: 5,
    extSma50: 7,
    maxDailyMove20dPct: 5,
    maxDailyRange20dPct: 6,
    range63dPct: 24,
    volatility63d: 26,
    maxDrawdown63d: 8,
    riskRewardScore: 82,
    returnToVol3m: 1.8,
    returnToDrawdown3m: 2.5,
    adProxyScore: 80,
    epsGrowthProxyScore: 74,
    dataCoverageScore: 90,
    technicalCoverageScore: 95,
    fundamentalCoverageScore: 70,
    rsGlobalPct: 80,
    rsRating: 80,
    rsCountryPct: 80,
    rsSectorPct: 80,
    rsQualityScore: 80,
    sectorScore: 80,
    groupStrengthScore: 80,
    weinsteinScore: 80,
    minerviniScore: 80,
    momentumScore: 80,
    riskScore: 75,
    volumeScore: 72,
    liquidityScore: 74,
    totalScore: 80,
    compositeScore: 80,
    chartBarsCount: 252,
    priceFreshnessDays: 0,
    lastDate: "2026-05-25",
    ipoAgeMonths: 72,
    ipoDate: "2020-01-01",
    ipoCategory: "Maduras",
    upVolume: true,
    chartPreview: chartPreview(100),
    ...overrides,
  };
}

function baseSession(overrides = {}) {
  const rows = overrides.rows || [];
  return {
    version: SESSION_VERSION,
    updatedAt: new Date().toISOString(),
    markets: ["US", "ES", "JP", "CA", "DE"],
    manual: "",
    settings: { ...NEUTRAL_SETTINGS, ...(overrides.settings || {}) },
    presetKey: overrides.presetKey || "broad",
    universe: rows.map((item) => ({ symbol: item.symbol, name: item.companyName, country: item.country })),
    universeScope: "filter-ui-regression",
    rows,
    analyzedRows: overrides.analyzedRows || [],
    scanContext: overrides.scanContext || null,
    scanPerf: null,
    fail: [],
    diagnostics: overrides.diagnostics || null,
    status: "Sesion de test de filtros",
    themeFilter: overrides.themeFilter || "Todos",
    sectorFilter: overrides.sectorFilter || "Todos",
    industryFilter: overrides.industryFilter || "Todos",
    countryFilter: overrides.countryFilter || "Todos",
    sectorStrength: overrides.sectorStrength || "Todos",
    ipo: overrides.ipo || "Todos",
    sort: overrides.sort || "totalScore",
    scanMode: "all",
    batchStart: 0,
    scanBatchSize: 25,
    resultPageSize: 50,
    resultPage: 1,
    marketHealth: { marketScore: 90 },
    useRegimeFilter: false,
    filterLayers: { ...DEFAULT_FILTER_LAYERS, ...(overrides.filterLayers || {}) },
    fieldRules: {},
    viewLayers: { ...DEFAULT_VIEW_LAYERS, ...(overrides.viewLayers || {}) },
    searchSymbol: "",
    searchCandidates: [],
    searchResult: null,
    quickReviewRows: [],
    quickReviewIndex: 0,
    ...overrides.extra,
  };
}

async function openSeededPage(browser, session) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.clear();
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: session },
  );
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".desktopResultsSection", { timeout: 15_000 });
  return { context, page };
}

async function openSeededPath(browser, path, storage = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.addInitScript((items) => {
    localStorage.clear();
    for (const [key, value] of Object.entries(items)) {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }, storage);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" });
  return { context, page };
}

async function symbols(page) {
  return page.$$eval(".compactResultsTable tbody .ticker", (links) => links.map((link) => link.textContent.trim()));
}

async function waitForSymbols(page, expectedCount) {
  await page.waitForFunction(
    (count) => document.querySelectorAll(".compactResultsTable tbody .ticker").length === count,
    expectedCount,
    { timeout: 15_000 },
  );
  return symbols(page);
}

async function selectByLabel(page, label, value) {
  await page.locator(`select[aria-label="${label}"]`).selectOption(value);
}

async function testViewFilters(browser) {
  const seededRows = [
    row({ symbol: "USA1", country: "US", theme: "Software", sector: "Technology", industry: "Application Software", sectorScore: 82, totalScore: 91 }),
    row({ symbol: "ESP1.MC", country: "ES", theme: "Software", sector: "Technology", industry: "Cybersecurity", sectorScore: 76, totalScore: 88 }),
    row({ symbol: "ESP2.MC", country: "ES", theme: "Energy", sector: "Utilities", industry: "Renewables", sectorScore: 58, totalScore: 75, ipoAgeMonths: 8, ipoDate: "2025-09-01", ipoCategory: "IPO reciente" }),
    row({ symbol: "JPN1.T", country: "JP", theme: "Industrials", sector: "Machinery", industry: "Robotics", sectorScore: 35, totalScore: 67 }),
    row({ symbol: "CAN1.TO", country: "CA", theme: "Finance", sector: "Banks", industry: "Regional Banks", sectorScore: 70, totalScore: 72 }),
    row({ symbol: "NODATA.DE", country: "DE", theme: "Software", sector: "Technology", industry: "Application Software", sectorScore: null, groupStrengthScore: null, totalScore: 65 }),
  ];
  const { context, page } = await openSeededPage(browser, baseSession({ rows: seededRows }));
  try {
    assert.deepEqual(await waitForSymbols(page, 6), ["USA1", "ESP1.MC", "ESP2.MC", "CAN1.TO", "JPN1.T", "NODATA.DE"], "initial view should keep all countries");

    await selectByLabel(page, "Filtrar por pais", "ES");
    assert.deepEqual(await waitForSymbols(page, 2), ["ESP1.MC", "ESP2.MC"], "country filter should only hide non-ES rows");

    await selectByLabel(page, "Filtrar por pais", "Todos");
    assert.deepEqual(await waitForSymbols(page, 6), ["USA1", "ESP1.MC", "ESP2.MC", "CAN1.TO", "JPN1.T", "NODATA.DE"], "country reset should restore all rows");

    await selectByLabel(page, "Filtrar por tema", "Energy");
    assert.deepEqual(await waitForSymbols(page, 1), ["ESP2.MC"], "theme filter should not leak other themes");

    await selectByLabel(page, "Filtrar por tema", "Todos");
    await selectByLabel(page, "Filtrar por fuerza de grupo", "Fuertes");
    assert.deepEqual(await waitForSymbols(page, 3), ["USA1", "ESP1.MC", "CAN1.TO"], "strong group view should require sectorScore >= 70 and exclude missing scores");

    await selectByLabel(page, "Filtrar por fuerza de grupo", "Debiles");
    assert.deepEqual(await waitForSymbols(page, 1), ["JPN1.T"], "weak group view should require sectorScore < 55 and exclude missing scores");

    await selectByLabel(page, "Filtrar por fuerza de grupo", "Todos");
    await selectByLabel(page, "Filtrar por IPO", "IPO reciente");
    assert.deepEqual(await waitForSymbols(page, 1), ["ESP2.MC"], "IPO view should only show matching IPO category");
  } finally {
    await context.close();
  }
}

function rsRows() {
  return Array.from({ length: 100 }, (_, index) => {
    const rank = index + 1;
    return row({
      symbol: `RS${String(rank).padStart(3, "0")}`,
      companyName: `RS ${rank}`,
      country: rank % 2 === 0 ? "US" : "ES",
      theme: "Software",
      sector: "Technology",
      industry: "Application Software",
      perf3m: rank,
      perf6m: rank * 1.4,
      perf12m: rank * 2,
      rs3m: rank * 0.3,
      rs6m: rank * 0.2,
      rs12m: rank * 0.1,
      rsGlobalPct: rank,
      rsRating: rank,
      totalScore: rank,
      compositeScore: rank,
      chartPreview: chartPreview(80 + rank),
    });
  });
}

async function testExecutionExactness(browser) {
  const analyzedRows = rsRows();
  const session = baseSession({
    rows: [],
    analyzedRows,
    settings: { minRsRating: 99 },
    scanContext: {
      id: "rs-exactness",
      symbolsCount: analyzedRows.length,
      baseCount: analyzedRows.length,
      providerErrors: [],
      marketHealth: { marketScore: 90 },
      useRegimeFilter: false,
    },
  });
  const { context, page } = await openSeededPage(browser, session);
  try {
    const accepted = await waitForSymbols(page, 1);
    assert.deepEqual(accepted, ["RS100"], "minRsRating 99 should pass only the 99th percentile row in a 100-row sample");
    const header = await page.locator(".desktopResultsSection h2").first().textContent();
    assert.match(header || "", /^1 resultados/, "result header should report exactly one result");
  } finally {
    await context.close();
  }
}

async function testExecutionUpperBoundary(browser) {
  const analyzedRows = rsRows();
  const session = baseSession({
    rows: [],
    analyzedRows,
    settings: { minRsRating: 100 },
    scanContext: {
      id: "rs-exactness-empty",
      symbolsCount: analyzedRows.length,
      baseCount: analyzedRows.length,
      providerErrors: [],
      marketHealth: { marketScore: 90 },
      useRegimeFilter: false,
    },
  });
  const { context, page } = await openSeededPage(browser, session);
  try {
    await waitForSymbols(page, 0);
    const header = await page.locator(".desktopResultsSection h2").first().textContent();
    assert.match(header || "", /^0 resultados/, "minRsRating 100 should produce zero rows because RS is capped at 99");
  } finally {
    await context.close();
  }
}

async function testPreviewChartUsesMainRs(browser) {
  const seededRows = [row({ symbol: "RSCHART", rsGlobalPct: 83, totalScore: 83, compositeScore: 83 })];
  const { context, page } = await openSeededPage(browser, baseSession({ rows: seededRows }));
  try {
    await waitForSymbols(page, 1);
    await page.locator(".compactSparkCell button").first().click();
    await page.waitForSelector(".quickReviewChart .universalChart", { timeout: 15_000 });
    const chartText = await page.locator(".quickReviewChart").innerText();
    assert.match(chartText, /\bRS\b/, "preview chart should expose the main RS label");
    assert.match(chartText, /\b83\b/, "preview chart should expose the main RS score");
    assert.doesNotMatch(chartText, /Rel vs Bench|Base 100/i, "preview chart should not expose the old benchmark-relative line label");
    const prefsText = await page.locator(".quickReviewGrid .chartPrefs").first().innerText();
    assert.match(prefsText, /\bRS\b/, "chart preference button should be labelled RS");
    assert.doesNotMatch(prefsText, /Rel vs Bench|Relativa vs bench|Comparativa relativa/i, "chart preferences should not describe the old benchmark-relative overlay");
  } finally {
    await context.close();
  }
}

async function testMissingScoreDoesNotPass(browser) {
  const analyzedRows = [
    row({ symbol: "MOMOK", momentumScore: 82, totalScore: 80, compositeScore: 80 }),
    row({ symbol: "MOMMISS", momentumScore: undefined, totalScore: 80, compositeScore: 80 }),
  ];
  const session = baseSession({
    rows: [],
    analyzedRows,
    settings: { minMomentumScore: 80 },
    scanContext: {
      id: "missing-score-contract",
      symbolsCount: analyzedRows.length,
      baseCount: analyzedRows.length,
      providerErrors: [],
      marketHealth: { marketScore: 90 },
      useRegimeFilter: false,
    },
  });
  const { context, page } = await openSeededPage(browser, session);
  try {
    const accepted = await waitForSymbols(page, 1);
    assert.deepEqual(accepted, ["MOMOK"], "a positive minimum score must reject rows with missing score values");
  } finally {
    await context.close();
  }
}

async function testProgressiveContractionFilter(browser) {
  const progressiveMetrics = {
    patternDataStatus: "ok",
    patternEligible: true,
    consolidationCandidate: true,
    patternFamily: "progressive_contraction",
    contractionCount: 3,
    contractionDepths: [22, 13, 6],
    contractionsDecreasing: true,
    contraction1DepthPct: 22,
    contraction2DepthPct: 13,
    contraction3DepthPct: 6,
    lastContractionDepthPct: 6,
    baseDepthPct: 28,
    baseWeeks: 9,
    absDistanceToPivotPct: 3,
    volumeDryUpRatio: 0.72,
    tightness10dPct: 6,
    patternQualityScore: 76,
  };
  const analyzedRows = [
    row({ symbol: "VCPGOOD", totalScore: 92, compositeScore: 92, ...progressiveMetrics }),
    row({
      symbol: "VCPEXPAND",
      totalScore: 91,
      compositeScore: 91,
      patternFamily: "tight_base",
      contractionCount: 4,
      contractionDepths: [9.7, 5.8, 3.5, 6.5],
      contractionsDecreasing: false,
      contraction1DepthPct: 9.7,
      contraction2DepthPct: 5.8,
      contraction3DepthPct: 3.5,
      lastContractionDepthPct: 6.5,
      baseDepthPct: 13,
      baseWeeks: 9,
      absDistanceToPivotPct: 1,
      volumeDryUpRatio: 0.62,
      tightness10dPct: 5.5,
      patternQualityScore: 77,
    }),
    row({
      symbol: "TRENDONLY",
      totalScore: 90,
      compositeScore: 90,
      patternFamily: "trend_no_base",
      consolidationCandidate: false,
      contractionCount: 0,
      contractionDepths: [],
      contractionsDecreasing: false,
      baseDepthPct: 31,
      baseWeeks: 9,
      absDistanceToPivotPct: 2,
      volumeDryUpRatio: 0.8,
      tightness10dPct: 7,
      patternQualityScore: 0,
    }),
  ];
  const session = baseSession({
    rows: [],
    analyzedRows,
    settings: {
      requireContractionsDecreasing: true,
      minContractionCount: 3,
      maxContraction1DepthPct: 25,
      maxContraction2DepthPct: 16,
      maxContraction3DepthPct: 8,
      maxLastContractionDepthPct: 8,
      maxBaseDepthPct: 35,
      maxAbsDistanceToPivotPct: 6,
      maxVolumeDryUpRatio: 0.9,
      maxTightness10dPct: 12,
    },
    filterLayers: { pattern: true },
    scanContext: {
      id: "pattern-progressive-contract",
      symbolsCount: analyzedRows.length,
      baseCount: analyzedRows.length,
      providerErrors: [],
      marketHealth: { marketScore: 90 },
      useRegimeFilter: false,
    },
  });
  const { context, page } = await openSeededPage(browser, session);
  try {
    const accepted = await waitForSymbols(page, 1);
    assert.deepEqual(accepted, ["VCPGOOD"], "progressive contraction filter should reject trend-only and non-decreasing contraction structures");
  } finally {
    await context.close();
  }
}

async function testSetupCellKeepsDetailsBehindInfo(browser) {
  const setupMetrics = {
    patternDataStatus: "ok",
    patternEligible: true,
    consolidationCandidate: true,
    patternFamily: "progressive_contraction",
    contractionCount: 3,
    contractionDepths: [22, 13, 6],
    contractionsDecreasing: true,
    contraction1DepthPct: 22,
    contraction2DepthPct: 13,
    contraction3DepthPct: 6,
    lastContractionDepthPct: 6,
    baseDepthPct: 28,
    baseContextScore: 55,
    baseWeeks: 9,
    pivotPrice: 104,
    distanceToPivotPct: -4,
    absDistanceToPivotPct: 4,
    pivotClarityScore: 80,
    pivotTouchCount: 3,
    baseNearPivotDays: 12,
    volumeDryUpRatio: 0.72,
    tightness10dPct: 6,
    patternQualityScore: 76,
    latestCloseLocationPct: 65,
  };
  const nonDecreasingMetrics = {
    ...setupMetrics,
    contractionDepths: [8, 13, 7],
    contractionsDecreasing: false,
    contraction1DepthPct: 8,
    contraction2DepthPct: 13,
    contraction3DepthPct: 7,
    lastContractionDepthPct: 7,
    volumeDryUpRatio: 0.82,
    patternQualityScore: 70,
  };
  const constructiveMetrics = {
    ...setupMetrics,
    patternFamily: "base_structure",
    contractionCount: 2,
    contractionDepths: [14, 5],
    contractionsDecreasing: true,
    contraction1DepthPct: 14,
    contraction2DepthPct: 5,
    contraction3DepthPct: null,
    lastContractionDepthPct: 5,
    baseDepthPct: 20,
    distanceToPivotPct: -3,
    absDistanceToPivotPct: 3,
    volumeDryUpRatio: 0.86,
    patternQualityScore: 72,
  };
  const { context, page } = await openSeededPage(browser, baseSession({
    rows: [
      row({ symbol: "SETUPUI", totalScore: 92, compositeScore: 92, ...setupMetrics }),
      row({ symbol: "SETUPBAD", totalScore: 91, compositeScore: 91, ...nonDecreasingMetrics }),
      row({ symbol: "SETUPBASE", totalScore: 90, compositeScore: 90, ...constructiveMetrics }),
    ],
  }));
  try {
    await waitForSymbols(page, 3);
    const setupCells = page.locator(".compactResultsTable tbody tr td:nth-child(6)");
    assert.equal(await setupCells.count(), 3, "seeded setup rows should render compact setup cells");
    const firstSetupCell = setupCells.nth(0);
    const secondSetupCell = setupCells.nth(1);
    const thirdSetupCell = setupCells.nth(2);
    const visibleText = `${await firstSetupCell.innerText()}\n${await secondSetupCell.innerText()}`;
    const allSetupText = `${visibleText}\n${await thirdSetupCell.innerText()}`;
    assert.match(allSetupText, /3 comp\.\s*·\s*22\.0% -> 13\.0% -> 6\.0%/i, "setup cell should show objective contraction count and sequence");
    assert.match(allSetupText, /3 comp\.\s*·\s*8\.0% -> 13\.0% -> 7\.0%/i, "rejected setup cell should still show measured contraction sequence");
    assert.match(allSetupText, /2 comp\.\s*·\s*14\.0% -> 5\.0%/i, "two-contraction constructive bases should show measured count and sequence");
    assert.match(allSetupText, /ultima 6\.0%|pivot -4\.0%|vol 0\.72x/i, "setup cell should expose compact objective context");
    assert.doesNotMatch(allSetupText, /Base en vigilancia|Base constructiva|VCP estricto|Plan válido|No VCP/i, "setup cell should not lead with methodology verdict labels");
    assert.doesNotMatch(allSetupText, /Volumen seco|Calidad:/i, "setup cell should keep secondary metrics behind the info hint");
    assert.doesNotMatch(allSetupText, /contracciones|volumen \d/i, "setup cell should avoid full methodology sentences");
    const info = firstSetupCell.locator(".infoHint").first();
    assert.equal(await firstSetupCell.locator(".infoHint").count(), 1, "setup cell should expose one info hint for methodology details");
    assert.equal(await secondSetupCell.locator(".infoHint").count(), 1, "rejected setup cell should also expose one info hint for methodology details");
    assert.equal(await thirdSetupCell.locator(".infoHint").count(), 1, "constructive setup cell should also expose one info hint for methodology details");
    const detail = await info.getAttribute("aria-label");
    assert.match(detail || "", /Evidencia: 22\.0% -> 13\.0% -> 6\.0%/, "info hint should retain contraction evidence");
    assert.match(detail || "", /Pivot: -4\.0%/, "info hint should retain pivot distance");
    assert.match(detail || "", /Volumen seco: 0\.72x/, "info hint should retain volume dry-up");
    assert.match(detail || "", /Calidad: 76/, "info hint should retain pattern quality");
    assert.match(detail || "", /Veredicto:/, "info hint should retain the methodology verdict as secondary context");
    const rejectedDetail = await secondSetupCell.locator(".infoHint").first().getAttribute("aria-label");
    assert.match(rejectedDetail || "", /Evidencia: 8\.0% -> 13\.0% -> 7\.0%/, "rejected setup info hint should retain contraction evidence");
    const constructiveDetail = await thirdSetupCell.locator(".infoHint").first().getAttribute("aria-label");
    assert.match(constructiveDetail || "", /Evidencia: 14\.0% -> 5\.0%/, "constructive setup info hint should retain contraction evidence");
  } finally {
    await context.close();
  }
}

async function testOpenStockPersistsReturnContext(browser) {
  const seededRows = Array.from({ length: 80 }, (_, index) => row({
    symbol: `NAV${String(index + 1).padStart(2, "0")}`,
    companyName: `Navigation ${index + 1}`,
    totalScore: 100 - index,
    compositeScore: 100 - index,
  }));
  const { context, page } = await openSeededPage(browser, baseSession({ rows: seededRows }));
  try {
    await waitForSymbols(page, 50);
    await page.evaluate(() => window.scrollTo(0, 720));
    await page.locator(".compactResultsTable tbody .ticker").first().dispatchEvent("pointerdown");
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || "{}"), STORAGE_KEY);
    assert.equal(saved.lastOpenedStockSymbol, "NAV01", "opening a stock should persist the active symbol before navigation");
    assert.ok(Number(saved.scrollY) >= 500, `opening a stock should persist scroll position, got ${saved.scrollY}`);
    assert.equal(saved.resultPage, 1, "opening a stock should preserve the current result page");
  } finally {
    await context.close();
  }
}

async function testSessionRestoresReturnScroll(browser) {
  const seededRows = Array.from({ length: 80 }, (_, index) => row({
    symbol: `RET${String(index + 1).padStart(2, "0")}`,
    companyName: `Return ${index + 1}`,
    totalScore: 100 - index,
    compositeScore: 100 - index,
  }));
  const { context, page } = await openSeededPage(browser, baseSession({
    rows: seededRows,
    extra: { scrollY: 680, lastOpenedStockSymbol: "RET20", lastOpenedStockAt: new Date().toISOString() },
  }));
  try {
    await waitForSymbols(page, 50);
    await page.waitForFunction(() => window.scrollY > 400, null, { timeout: 15_000 });
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(y >= 400, `screener should restore the previous scroll position, got ${y}`);
  } finally {
    await context.close();
  }
}

async function testQuickListsUseSameSnapshotContract(browser) {
  const rows = [
    row({ symbol: "QLA", companyName: "Quick Leader A", totalScore: 96, compositeScore: 96, rsGlobalPct: 97, rsRating: 44, lastDate: "2026-05-25" }),
    row({ symbol: "QLB", companyName: "Quick Leader B", totalScore: 82, compositeScore: 82, rsGlobalPct: 84, rsRating: 83, lastDate: "2026-05-24" }),
  ];
  const scan = {
    id: "quick-list-scan",
    createdAt: "2026-05-26T08:00:00.000Z",
    updatedAt: "2026-05-26T08:00:00.000Z",
    name: "Quick List Coherence",
    rows,
  };
  const favorite = {
    id: "favorite-qla",
    symbol: "QLA",
    companyName: "Quick Leader A",
    addedAt: "2026-05-26T08:30:00.000Z",
    updatedAt: "2026-05-26T08:30:00.000Z",
    source: "test",
    notes: "",
    snapshot: { ...rows[0] },
  };
  const { context, page } = await openSeededPath(browser, "/lists", {
    [SCANS_KEY]: [scan],
    [FAVORITES_KEY]: [favorite],
  });
  try {
    await page.waitForSelector(".listsPage .table", { timeout: 15_000 });
    await page.waitForFunction(() => {
      const values = [...document.querySelectorAll(".listsPage .kpi b")].map((node) => node.textContent?.trim());
      return values[0] === "2" && values[1] === "1";
    }, null, { timeout: 15_000 });
    const kpiText = await page.locator(".listsPage .kpis").innerText();
    assert.match(kpiText, /\b2\b[\s\S]*acciones unicas/i, "quick lists should read exactly the seeded latest snapshot rows");
    assert.match(kpiText, /\b1\b[\s\S]*favoritos/i, "quick lists should read exactly the seeded favorites");

    const favoritesTicker = await page.locator("section.card", { hasText: "Favoritos" }).locator("tbody .ticker").first().textContent();
    assert.equal(favoritesTicker?.trim(), "QLA", "favorites quick list should preserve the favorite symbol");

    const compositeTicker = await page.locator("details", { hasText: "Composite Leaders" }).locator("tbody .ticker").first().textContent();
    assert.equal(compositeTicker?.trim(), "QLA", "composite quick list should use the same totalScore ordering as the screener snapshot");

    const favoriteRow = await page.locator("section.card", { hasText: "Favoritos" }).locator("tbody tr").first().innerText();
    assert.match(favoriteRow, /\b96\b/, "favorites quick list should preserve visible score metrics from the screener snapshot");
    const href = await page.locator("details", { hasText: "Composite Leaders" }).locator("tbody .ticker").first().getAttribute("href");
    assert.equal(href, "/stock/QLA", "quick-list ticker should route to the same stock ficha URL");
  } finally {
    await context.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    await testViewFilters(browser);
    await testExecutionExactness(browser);
    await testExecutionUpperBoundary(browser);
    await testPreviewChartUsesMainRs(browser);
    await testMissingScoreDoesNotPass(browser);
    await testProgressiveContractionFilter(browser);
    await testSetupCellKeepsDetailsBehindInfo(browser);
    await testOpenStockPersistsReturnContext(browser);
    await testSessionRestoresReturnScroll(browser);
    await testQuickListsUseSameSnapshotContract(browser);
    console.log(`OK filter-ui-regression: view filters, execution exactness and return navigation passed against ${BASE_URL}.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL filter-ui-regression: ${error.stack || error.message}`);
  process.exitCode = 1;
});
