import assert from "node:assert/strict";
import { chromium } from "playwright";

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

const DEFAULT_FILTER_LAYERS = {
  trend: true,
  momentum: true,
  relativeStrength: true,
  proximity: true,
  volatility: true,
  score: true,
  liquidity: true,
  volumeSurge: false,
  shortInterest: false,
  riskReward: false,
  coverage: true,
  ipo: true,
};

const NEUTRAL_SETTINGS = {
  filterStrictness: "balanced",
  setupMode: "any",
  requireStage2: false,
  requireSma200Up: false,
  requirePriceAboveSma50: false,
  requireRecentIpo: false,
  requireUpVolume: false,
  stageFastWeeks: 10,
  stageSlowWeeks: 30,
  stageSlopeWeeks: 10,
  maxPriceFreshnessDays: 999,
  maxIpoAgeMonths: 999,
  minPrice: 0,
  minMarketCap: 0,
  minAvgVolume: 0,
  minAvgTurnover: 0,
  minLatestVolume: 0,
  minLatestTurnover: 0,
  minRelativeVolume: 0,
  minVolumeSurgePct: -999,
  minUpDownVolRatio: 0,
  minVolumeEffectScore: 0,
  minShortFloatPct: 0,
  maxShortFloatPct: 999,
  minPerf3m: -100,
  minPerf6m: -100,
  minPerf12m: -100,
  maxDistance20dHigh: 999,
  maxDistance50dHigh: 999,
  maxDistance52w: 999,
  maxDistanceATH: 999,
  maxHighsSpreadPct: 999,
  maxExtensionSma50: 999,
  maxDailyMove20dPct: 999,
  maxDailyRange20dPct: 999,
  maxRange63dPct: 999,
  maxVolatility63d: 999,
  maxDrawdown63d: 999,
  minRiskRewardScore: 0,
  minReturnToVol3m: -999,
  minReturnToDrawdown3m: -999,
  minAdProxyScore: 0,
  minEpsGrowthProxyScore: 0,
  minDataCoverageScore: 0,
  minTechnicalCoverageScore: 0,
  minFundamentalCoverageScore: 0,
  minRsRating: 0,
  minRsBenchmarkRating: 0,
  minRsCountryPct: 0,
  minRsSectorPct: 0,
  minRsQualityScore: 0,
  minSectorScore: 0,
  minWeinsteinScore: 0,
  minMinerviniScore: 0,
  minMomentumScore: 0,
  minRiskScore: 0,
  minVolumeScore: 0,
  minLiquidityScore: 0,
  minTotalScore: 0,
  minWeaknessScore: 0,
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
    assert.match(kpiText, /\b2\b[\s\S]*acciones visibles/i, "quick lists should read exactly the seeded latest snapshot rows");
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
    await testOpenStockPersistsReturnContext(browser);
    await testSessionRestoresReturnScroll(browser);
    await testQuickListsUseSameSnapshotContract(browser);
    console.log(`OK filter-ui-regression: view filters, execution exactness and return navigation passed against ${BASE_URL}.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL filter-ui-regression: ${error.message}`);
  process.exitCode = 1;
});
