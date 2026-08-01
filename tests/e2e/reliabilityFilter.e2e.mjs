// E2E fiabilidad: el filtro compuesto debe separar filas limpias, validables
// y bloqueadas sin convertir el screener en una señal automática de inversión.
export const name = "filtro por fiabilidad de observación";

const reliableRow = {
  symbol: "REL",
  companyName: "Reliable Observation Inc.",
  sector: "Technology",
  industry: "Software",
  country: "US",
  exchange: "NASDAQ",
  currency: "USD",
  price: 120,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  priceFreshnessDays: 1,
  priceFreshnessMaxDays: 4,
  dataCoverageScore: 88,
  technicalCoverageScore: 90,
  fundamentalCoverageScore: 72,
  totalScore: 74.56,
  rsGlobalPct: 91,
  rsRating: 90,
  rsSectorPct: 84,
  rsQualityScore: 80,
  weinsteinScore: 86,
  minerviniScore: 84,
  setupQualityScore: 80,
  demandScore: 70,
  sectorScore: 75,
  riskScore: 62,
  momentumScore: 58,
  ipoScore: 20,
  volumeEffectScore: 78,
  adProxyScore: 76,
  growthScore: 72,
  epsGrowthProxyScore: 70,
  riskRewardScore: 74,
  weaknessScore: 8,
  extSma50: 9,
  avgTurnover: 25_000_000,
  setupDisplayPlanValid: true,
  setupDisplayStrict: true,
  setupDisplayWatch: false,
};

const validationRow = {
  ...reliableRow,
  symbol: "VAL",
  companyName: "Validate Price Corp.",
  priceFreshnessOk: false,
  priceFreshnessDays: 9,
  priceFreshnessIssue: "precio viejo: 9d > 4d",
};

const blockedRow = {
  ...reliableRow,
  symbol: "BLOCK",
  companyName: "Blocked Snapshot Ltd.",
  decisionProjectionPartial: true,
  decisionProjectionMissing: ["price", "chartBarsCount"],
};

async function visibleSymbols(page) {
  return page.evaluate(() => [...document.querySelectorAll(".desktopResultsSection table a.ticker")]
    .map((el) => el.textContent.trim())
    .filter(Boolean));
}

async function waitForStage(page, predicate, label, timeout = 15000) {
  try {
    await page.waitForFunction(predicate, null, { timeout });
  } catch {
    const table = await page.evaluate(() => document.querySelector(".compactResultsTable tbody")?.innerText || document.body.innerText.slice(0, 900));
    throw new Error(`${label} no ocurrió. Texto visible: ${table.replace(/\s+/g, " ").trim()}`);
  }
}

async function applyReliabilityFilter(page, value) {
  await page.locator('.desktopResultsSection select[aria-label="Filtrar por fiabilidad de observacion"]').selectOption(value);
}

export async function run({ context, baseUrl, sessionSeed }) {
  const seed = {
    ...sessionSeed({ rows: [blockedRow, validationRow, reliableRow] }),
    presetKey: "broad",
    settings: { setupMode: "leader" },
  };
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, seed);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await waitForStage(page, () => document.body.innerText.includes("REL") && document.body.innerText.includes("VAL") && document.body.innerText.includes("BLOCK"), "Restaurar filas de fiabilidad");
  await page.locator(".desktopResultsSection .resultsAuditGroup summary").click();
  await waitForStage(page, () => {
    const panel = (document.querySelector(".desktopResultsSection .auditabilitySummaryRail")?.innerText || "").toLowerCase();
    return panel.includes("auditabilidad") && panel.includes("observación");
  }, "Mostrar panel de auditabilidad interna");

  const before = await visibleSymbols(page);
  for (const symbol of ["REL", "VAL", "BLOCK"]) {
    if (!before.includes(symbol)) throw new Error(`Falta ${symbol} antes de filtrar: ${before.join(",")}`);
  }

  await page.locator('.desktopResultsSection .auditabilitySummaryRail button[aria-label^="Abrir Review:"]').first().click();
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const text = modal?.innerText || "";
    return modal?.open
      && text.includes("Método:")
      && text.includes("Foco de revisión metodológica")
      && Boolean(modal.querySelector(".reviewQueueMethodologyBadge"));
  }, "Abrir Review desde foco metodológico");
  await page.evaluate(() => {
    const close = [...document.querySelectorAll(".quickReviewModal button")].find((button) => button.textContent?.trim() === "Cerrar");
    close?.click();
  });
  await waitForStage(page, () => !document.querySelector(".quickReviewModal")?.open, "Cerrar Review de foco metodológico");

  await applyReliabilityFilter(page, "reliable");
  await waitForStage(page, () => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.length === 1 && rows[0] === "REL";
  }, "Filtrar alta fiabilidad");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Fiabilidad: Fiable"), "Mostrar chip de alta fiabilidad");
  await waitForStage(page, () => {
    const panel = (document.querySelector(".desktopResultsSection .auditabilitySummaryRail")?.innerText || "").toLowerCase();
    return panel.includes("100%") && panel.includes("snapshot");
  }, "Auditabilidad visible al 100% tras filtrar alta fiabilidad");

  await applyReliabilityFilter(page, "needs-validation");
  await waitForStage(page, () => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.length === 1 && rows[0] === "VAL";
  }, "Filtrar validar primero");
  await waitForStage(page, () => {
    const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
    return session.reliabilityFilter === "needs-validation";
  }, "Persistir filtro de fiabilidad");

  await applyReliabilityFilter(page, "blocked");
  await waitForStage(page, () => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.length === 1 && rows[0] === "BLOCK";
  }, "Filtrar bloqueadas");

  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".resultFilterChip")].find((button) => button.innerText.includes("Fiabilidad:"));
    chip?.click();
  });
  await waitForStage(page, () => {
    const rows = [...document.querySelectorAll(".desktopResultsSection table a.ticker")].map((el) => el.textContent.trim());
    return rows.includes("REL") && rows.includes("VAL") && rows.includes("BLOCK");
  }, "Limpiar filtro de fiabilidad");
}
