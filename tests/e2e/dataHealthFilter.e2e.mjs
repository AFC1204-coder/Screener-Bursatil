// E2E salud de datos: el estado visible en cada fila debe convertirse en un
// filtro reversible para auditar resultados con datos viejos o bloqueados.
export const name = "filtro por salud de datos";

async function visibleSymbols(page) {
  return page.evaluate(() => [...document.querySelectorAll(".desktopResultsSection table a.ticker")]
    .map((el) => el.textContent.trim())
    .filter(Boolean));
}

export async function run({ context, baseUrl, sessionSeed }) {
  const base = {
    price: 50,
    currency: "USD",
    country: "US",
    sector: "Technology",
    industry: "Semiconductors",
    theme: "AI Hardware",
    chartBarsCount: 260,
    priceFreshnessOk: true,
    priceFreshnessDays: 1,
    priceFreshnessMaxDays: 4,
    dataCoverageScore: 82,
    technicalCoverageScore: 88,
    fundamentalCoverageScore: 64,
    totalScore: 82,
    compositeScore: 82,
    rsGlobalPct: 90,
    rsRating: 86,
    rsCountryPct: 80,
    rsSectorPct: 82,
    rsQualityScore: 78,
    weinsteinScore: 86,
    minerviniScore: 82,
    momentumScore: 76,
    riskScore: 72,
    volumeScore: 78,
    liquidityScore: 74,
    sectorScore: 76,
    setupQualityScore: 82,
    demandScore: 78,
    growthScore: 70,
    epsGrowthProxyScore: 68,
    volumeEffectScore: 76,
    adProxyScore: 74,
    riskRewardScore: 72,
    weaknessScore: 12,
    extSma50: 10,
    perf3m: 22,
    perf6m: 42,
    distance52w: -5,
    avgTurnover: 25_000_000,
    relativeVolume: 1.7,
    setupDisplayPlanValid: true,
    setupDisplayStrict: true,
    setupDisplayWatch: false,
    chartProvider: "Yahoo Finance",
    chartPreview: [
      { date: "2026-06-10", close: 45, sma50: 42, sma200: 38, volume: 1_000_000 },
      { date: "2026-06-11", close: 47, sma50: 43, sma200: 38.5, volume: 1_200_000 },
      { date: "2026-06-12", close: 50, sma50: 44, sma200: 39, volume: 1_300_000 },
    ],
  };
  const rows = [
    { ...base, symbol: "READY", companyName: "Ready Data Inc." },
    {
      ...base,
      symbol: "STALE",
      companyName: "Stale Price Corp.",
      priceFreshnessOk: false,
      priceFreshnessDays: 9,
      priceFreshnessIssue: "precio viejo: 9d > 4d",
      dataCoverageScore: 66,
    },
    {
      ...base,
      symbol: "BLOCK",
      companyName: "Blocked History Ltd.",
      chartBarsCount: 35,
      dataCoverageScore: 50,
      technicalCoverageScore: 45,
    },
  ];
  const seed = sessionSeed({ rows });
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("STALE"), null, { timeout: 20000 });

  const before = await visibleSymbols(page);
  for (const symbol of ["READY", "STALE", "BLOCK"]) {
    if (!before.includes(symbol)) throw new Error(`Falta ${symbol} antes de filtrar: ${before.join(",")}`);
  }

  await page.locator(".desktopResultsSection .resultsAuditGroup summary").click();
  const dataHealthSelector = '.desktopResultsSection .dataHealthSummaryRail button[title="Filtrar Precio viejo"]';
  try {
    await page.waitForSelector(dataHealthSelector, { timeout: 10000 });
  } catch {
    const buttons = await page.evaluate(() => [...document.querySelectorAll(".desktopResultsSection .dataHealthSummaryRail button")]
      .map((button) => `${button.getAttribute("title") || "sin title"}=${button.textContent.trim()}`));
    throw new Error(`No apareció el botón de precio viejo. Botones presentes: ${buttons.join(" | ") || "ninguno"}`);
  }

  await page.click(dataHealthSelector);
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.length === 1 && rows[0] === "STALE";
  }, null, { timeout: 10000 });
  const railFilterChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
    .map((el) => el.textContent.trim())
    .join(" "));
  if (!/Datos:\s*Viejos/.test(railFilterChip)) throw new Error(`Chip activo inesperado desde rail: ${railFilterChip}`);
  await page.click(".resultFilterChip");
  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });

  await page.click(dataHealthSelector);
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.length === 1 && rows[0] === "STALE";
  }, null, { timeout: 10000 });

  const activeChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
    .map((el) => el.textContent.trim())
    .join(" "));
  if (!/Datos:\s*Viejos/.test(activeChip)) throw new Error(`Chip activo inesperado: ${activeChip}`);

  await page.click(".resultFilterChip");
  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
  const restored = await visibleSymbols(page);
  for (const symbol of ["READY", "STALE", "BLOCK"]) {
    if (!restored.includes(symbol)) throw new Error(`Falta ${symbol} tras quitar filtro: ${restored.join(",")}`);
  }

  await page.click(".desktopResultsSection .resultsHeader button.btnPrimary");
  try {
    await page.waitForFunction(() => {
      const modal = document.querySelector(".quickReviewModal");
      const queue = document.querySelector(".reviewQueueList");
      const readyBadge = queue?.querySelector(".reviewQueueItem.data-health-ready .reviewQueueDataHealthBadge")?.textContent || "";
      const staleBadge = queue?.querySelector(".reviewQueueItem.data-health-stale .reviewQueueDataHealthBadge")?.textContent || "";
      const blockedBadge = queue?.querySelector(".reviewQueueItem.data-health-blocked .reviewQueueDataHealthBadge")?.textContent || "";
      const dataAuditCount = document.querySelector(".reviewQueueAuditSummary .audit-data b")?.textContent || "";
      return modal
        && readyBadge.includes("Aptos")
        && staleBadge.includes("Viejos")
        && blockedBadge.includes("Bloqueados")
        && dataAuditCount.trim() === "2";
    }, null, { timeout: 10000 });
  } catch {
    const state = await page.evaluate(() => ({
      modal: document.querySelector(".quickReviewModal")?.innerText || "",
      queue: [...document.querySelectorAll(".reviewQueueItem")].map((item) => ({
        className: item.className,
        text: item.textContent.trim(),
      })),
    }));
    throw new Error(`La cola Review no mostró badges de salud de datos: ${JSON.stringify(state)}`);
  }

  await page.click(".reviewQueueAuditSummary .audit-data");
  await page.waitForFunction(() => {
    const title = document.querySelector(".quickReviewTitleBlock")?.innerText || "";
    return title.includes("STALE");
  }, null, { timeout: 10000 });
}
