// E2E auditoría de score: el selector de vista debe aislar filas con
// descuadre material entre score mostrado y score calculado.
export const name = "filtro por auditoría de score";

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
    totalScore: 74,
    compositeScore: 74,
    rsGlobalPct: 90,
    rsRating: 86,
    rsCountryPct: 80,
    rsSectorPct: 82,
    rsQualityScore: 78,
    weinsteinScore: 86,
    minerviniScore: 82,
    momentumScore: 58,
    riskScore: 62,
    volumeScore: 78,
    liquidityScore: 74,
    sectorScore: 75,
    setupQualityScore: 80,
    demandScore: 70,
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
    { ...base, symbol: "TRACE", companyName: "Traceable Score Inc." },
    { ...base, symbol: "MIS", companyName: "Mismatch Score Corp.", totalScore: 92, compositeScore: 92 },
    {
      ...base,
      symbol: "MISS",
      companyName: "Missing Component Ltd.",
      totalScore: 50,
      compositeScore: 50,
      demandScore: undefined,
      sectorScore: undefined,
      riskRewardScore: undefined,
    },
  ];
  const seed = sessionSeed({ rows });
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("MISS"), null, { timeout: 20000 });

  const before = await visibleSymbols(page);
  for (const symbol of ["TRACE", "MIS", "MISS"]) {
    if (!before.includes(symbol)) throw new Error(`Falta ${symbol} antes de filtrar: ${before.join(",")}`);
  }

  const clickedRowScoreFilter = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".compactResultsTable tbody tr")]
      .find((item) => item.querySelector("a.ticker")?.textContent.trim() === "MIS");
    const button = row?.querySelector(".scoreAuditMini.compactTrustFilter");
    button?.click();
    return Boolean(button);
  });
  if (!clickedRowScoreFilter) throw new Error("No encontré el filtro compacto de score audit en la fila MIS");
  try {
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
      return rows.length === 1 && rows[0] === "MIS";
    }, null, { timeout: 10000 });
  } catch {
    const state = await page.evaluate(() => ({
      visible: [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim()),
      chips: [...document.querySelectorAll(".resultFilterChip")].map((el) => el.textContent.trim()),
    }));
    throw new Error(`Filtro de score desde fila no dejó solo MIS: ${JSON.stringify(state)}`);
  }
  const rowScoreChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
    .map((el) => el.textContent.trim())
    .join(" "));
  if (!/Score:\s*Descuadre/.test(rowScoreChip)) throw new Error(`Chip de auditoría desde fila inesperado: ${rowScoreChip}`);
  await page.click(".resultFilterChip");
  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });

  await page.click(".desktopResultsSection .scoreAuditSummaryRail .scoreAuditReviewAction");
  try {
    await page.waitForFunction(() => {
      const modal = document.querySelector(".quickReviewModal");
      const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
      const text = modal?.innerText || "";
      const lowerText = text.toLowerCase();
      const queue = document.querySelector(".reviewQueueList");
      const mismatchBadge = queue?.querySelector(".reviewQueueItem.score-audit-mismatch .reviewQueueScoreAuditBadge")?.textContent || "";
      const missingBadge = queue?.querySelector(".reviewQueueItem.score-audit-missing .reviewQueueScoreAuditBadge")?.textContent || "";
      return text.includes("MIS")
        && text.includes("MISS")
        && !text.includes("TRACE")
        && text.includes("Descuadre score")
        && lowerText.includes("score audit")
        && mismatchBadge.includes("Descuadre")
        && missingBadge.includes("Incompleto")
        && review.sourceLabel === "Score audit: Score a revisar"
        && review.queueMode === "score-audit-focus"
        && review.rows?.length === 2;
    }, null, { timeout: 10000 });
  } catch {
    const state = await page.evaluate(() => ({
      modal: document.querySelector(".quickReviewModal")?.innerText || "",
      review: JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}"),
    }));
    throw new Error(`Review de score audit no abrió la cola esperada: ${JSON.stringify(state)}`);
  }
  await page.evaluate(() => {
    const close = [...document.querySelectorAll(".quickReviewHeader button")].find((button) => button.textContent.includes("Cerrar"));
    close?.click();
  });
  await page.waitForFunction(() => !document.querySelector(".quickReviewModal"), null, { timeout: 10000 });

  await page.click('.desktopResultsSection .scoreAuditSummaryRail button[title="Filtrar Score descuadrado"]');
  try {
    await page.waitForFunction(() => {
      const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
      return rows.length === 1 && rows[0] === "MIS";
    }, null, { timeout: 10000 });
  } catch {
    const state = await page.evaluate(() => ({
      visible: [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim()),
      options: [...document.querySelectorAll('.desktopResultsSection select[aria-label="Filtrar por auditoría de score"] option')].map((option) => ({ value: option.value, text: option.textContent.trim(), selected: option.selected })),
      chips: [...document.querySelectorAll(".resultFilterChip")].map((el) => el.textContent.trim()),
    }));
    throw new Error(`Filtro de score descuadrado no dejó solo MIS: ${JSON.stringify(state)}`);
  }

  const activeChip = await page.evaluate(() => [...document.querySelectorAll(".resultFilterChip")]
    .map((el) => el.textContent.trim())
    .join(" "));
  if (!/Score:\s*Descuadre/.test(activeChip)) throw new Error(`Chip de auditoría inesperado: ${activeChip}`);

  await page.click(".resultFilterChip");
  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
  await page.locator('.desktopResultsSection select[aria-label="Filtrar por auditoría de score"]').selectOption("missing");
  await page.waitForFunction(() => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.length === 1 && rows[0] === "MISS";
  }, null, { timeout: 10000 });

  await page.click(".resultFilterChip");
  await page.waitForFunction(() => document.querySelectorAll(".desktopResultsSection table a.ticker").length >= 3, null, { timeout: 10000 });
  const restored = await visibleSymbols(page);
  for (const symbol of ["TRACE", "MIS", "MISS"]) {
    if (!restored.includes(symbol)) throw new Error(`Falta ${symbol} tras quitar filtro: ${restored.join(",")}`);
  }
}
