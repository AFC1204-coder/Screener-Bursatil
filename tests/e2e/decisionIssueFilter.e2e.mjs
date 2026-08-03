// E2E incidencias de decision: una alerta visible en una fila debe actuar como
// filtro reversible, para convertir el diagnostico en una vista de trabajo.
export const name = "filtro por incidencia desde badge de fila";

async function visibleSymbols(page) {
  return page.evaluate(() => [...document.querySelectorAll(".desktopResultsSection table a.ticker")]
    .map((el) => el.textContent.trim())
    .filter(Boolean));
}

async function clickIssueBadge(page, titlePart) {
  return page.evaluate((needle) => {
    const buttons = [...document.querySelectorAll(".desktopResultsSection .resultsDecisionGroup button.decisionQualityIssue")];
    const button = buttons.find((el) => (el.getAttribute("title") || "").includes(needle) || el.textContent.includes(needle));
    if (!button) return false;
    button.click();
    return true;
  }, titlePart);
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
    chartPreview: [
      { date: "2026-06-10", close: 45, sma50: 42, sma200: 38, volume: 1_000_000 },
      { date: "2026-06-11", close: 47, sma50: 43, sma200: 38.5, volume: 1_200_000 },
      { date: "2026-06-12", close: 50, sma50: 44, sma200: 39, volume: 1_300_000 },
    ],
  };
  const rows = [
    { ...base, symbol: "HIGH", companyName: "High Quality Inc." },
    { ...base, symbol: "MISS", companyName: "Missing Evidence Corp.", fundamentalCoverageScore: undefined },
    { ...base, symbol: "EXT", companyName: "Extended Setup Ltd.", extSma50: 36 },
  ];
  const seed = sessionSeed({ rows });
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("MISS"), null, { timeout: 20000 });

  const before = await visibleSymbols(page);
  for (const symbol of ["HIGH", "MISS", "EXT"]) {
    if (!before.includes(symbol)) throw new Error(`Falta ${symbol} antes de filtrar: ${before.join(",")}`);
  }

  if (!await clickIssueBadge(page, "Evidencia incompleta")) throw new Error("No encontré la incidencia agregada de evidencia incompleta");
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.length === 1 && rows[0] === "MISS";
  }, null, { timeout: 10000 });
  const activeChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
    .map((el) => el.textContent.trim())
    .join(" "));
  if (!/Evidencia incompleta/.test(activeChip)) throw new Error(`Chip activo inesperado: ${activeChip}`);

  if (!await clickIssueBadge(page, "Evidencia incompleta")) throw new Error("No encontré la incidencia agregada activa para quitar filtro");
  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
  const restored = await visibleSymbols(page);
  for (const symbol of ["HIGH", "MISS", "EXT"]) {
    if (!restored.includes(symbol)) throw new Error(`Falta ${symbol} tras quitar filtro: ${restored.join(",")}`);
  }
}
