// E2E: el checklist de evidencia no solo se muestra; también filtra la tabla.
export const name = "filtro por pruebas de decisión";

const readyRow = {
  symbol: "READY",
  companyName: "Ready Compounder",
  sector: "Technology",
  industry: "Software",
  country: "US",
  exchange: "NASDAQ",
  currency: "USD",
  price: 120,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 88,
  technicalCoverageScore: 90,
  fundamentalCoverageScore: 72,
  totalScore: 86,
  rsGlobalPct: 91,
  rsSectorPct: 84,
  rsQualityScore: 80,
  weinsteinScore: 86,
  minerviniScore: 84,
  volumeEffectScore: 78,
  adProxyScore: 76,
  growthScore: 72,
  epsGrowthProxyScore: 70,
  riskRewardScore: 74,
  weaknessScore: 8,
  extSma50: 9,
  setupDisplayPlanValid: true,
};

const needsWorkRow = {
  ...readyRow,
  symbol: "CHECK",
  companyName: "Check First Inc",
  totalScore: 82,
  rsGlobalPct: 74,
  rsSectorPct: 71,
  rsQualityScore: 52,
  weinsteinScore: 55,
  minerviniScore: 54,
  volumeEffectScore: 69,
  adProxyScore: 50,
  growthScore: 45,
  epsGrowthProxyScore: 45,
  riskRewardScore: 68,
};

const blockedRow = {
  ...readyRow,
  symbol: "BLOCK",
  companyName: "Blocked Data Ltd",
  decisionProjectionPartial: true,
  decisionProjectionMissing: ["price", "chartBarsCount"],
};

async function waitForStage(page, predicate, label, timeout = 20000) {
  try {
    await page.waitForFunction(predicate, null, { timeout });
  } catch {
    const table = await page.evaluate(() => document.querySelector(".compactResultsTable tbody")?.innerText || document.body.innerText.slice(0, 800));
    throw new Error(`${label} no ocurrió. Texto visible: ${table.replace(/\s+/g, " ").trim()}`);
  }
}

async function applyEvidenceFilter(page, value) {
  const applied = await page.evaluate((nextValue) => {
    const select = document.querySelector('.desktopResultsSection select[aria-label="Filtrar por pruebas de decision"]');
    if (!select || ![...select.options].some((option) => option.value === nextValue)) return false;
    select.value = nextValue;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
  if (!applied) throw new Error(`No encontré el filtro de pruebas ${value}`);
}

export async function run({ context, baseUrl, sessionSeed }) {
  const session = {
    ...sessionSeed({ rows: [blockedRow, needsWorkRow, readyRow] }),
    presetKey: "broad",
    settings: { setupMode: "leader" },
  };
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, session);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await waitForStage(page, () => document.body.innerText.includes("READY") && document.body.innerText.includes("CHECK") && document.body.innerText.includes("BLOCK"), "Restaurar filas de evidencia");
  await waitForStage(page, () => {
    const rail = document.querySelector(".desktopResultsSection .decisionEvidenceSummaryRail");
    return rail?.innerText.includes("Pruebas") && rail.innerText.includes("OK") && rail.innerText.includes("Validar");
  }, "Mostrar resumen clicable de pruebas");

  await page.locator(".desktopResultsSection .decisionEvidenceSummaryRail .dataHealthSummaryItem", { hasText: "OK" }).click();
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("READY") && !table.includes("CHECK") && !table.includes("BLOCK");
  }, "Filtrar por pruebas OK desde resumen");
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".resultFilterChip")].find((button) => button.innerText.includes("Pruebas:"));
    chip?.click();
  });
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("READY") && table.includes("CHECK") && table.includes("BLOCK");
  }, "Limpiar filtro de pruebas desde resumen");

  const clickedRowEvidenceFilter = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".compactResultsTable tbody tr")]
      .find((item) => item.querySelector("a.ticker")?.textContent.trim() === "CHECK");
    const button = row?.querySelector(".decisionEvidenceChecklist.compactTrustFilter");
    button?.click();
    return Boolean(button);
  });
  if (!clickedRowEvidenceFilter) throw new Error("No encontré el filtro compacto de pruebas en la fila CHECK");
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("CHECK") && !table.includes("READY") && !table.includes("BLOCK");
  }, "Filtrar por pruebas pendientes desde fila");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Pruebas: Validar"), "Mostrar chip de pruebas desde fila");
  await waitForStage(page, () => {
    const focus = (document.querySelector(".resultViewFocusSummary")?.innerText || "").toLowerCase();
    const brief = (document.querySelector(".resultViewBrief")?.innerText || "").toLowerCase();
    return focus.includes("vista de investigación")
      && focus.includes("1/3")
      && focus.includes("revisar vista")
      && brief.includes("brief vista")
      && brief.includes("freno");
  }, "Mostrar resumen de vista filtrada desde fila");
  await page.locator(".resultViewFocusSummary button", { hasText: "Revisar vista" }).click();
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const source = (modal?.querySelector(".quickReviewSourceBrief")?.innerText || "").toLowerCase();
    const origin = (modal?.querySelector(".screenerOriginPanel")?.innerText || "").toLowerCase();
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return modal?.innerText.includes("CHECK")
      && !modal.innerText.includes("READY")
      && source.includes("vista filtrada")
      && source.includes("brief vista")
      && origin.includes("vista filtrada")
      && review.sourceLabel === "Vista filtrada"
      && review.queueMode === "filtered-view"
      && review.sourceDetail?.includes("Pruebas: Validar")
      && review.sourceDetail?.includes("Freno:");
  }, "Abrir Review desde brief de vista filtrada");
  const stockContextFromFilteredReview = await page.evaluate(() => {
    const link = document.querySelector('.quickReviewHeader a[href="/stock/CHECK"]');
    link?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
    return session.lastOpenedStockContext || {};
  });
  if (stockContextFromFilteredReview.sourceLabel !== "Review · Vista filtrada") {
    throw new Error(`La ficha no heredó origen de vista filtrada: ${JSON.stringify(stockContextFromFilteredReview)}`);
  }
  if (stockContextFromFilteredReview.queueMode !== "filtered-view") {
    throw new Error(`La ficha no heredó queueMode filtered-view: ${JSON.stringify(stockContextFromFilteredReview)}`);
  }
  if (!stockContextFromFilteredReview.sourceDetail?.includes("Pruebas: Validar") || !stockContextFromFilteredReview.sourceDetail?.includes("Freno:")) {
    throw new Error(`La ficha no heredó sourceDetail de vista filtrada: ${JSON.stringify(stockContextFromFilteredReview)}`);
  }
  await page.evaluate(() => {
    const close = [...document.querySelectorAll(".quickReviewHeader button")].find((button) => button.textContent.includes("Cerrar"));
    close?.click();
  });
  await waitForStage(page, () => !document.querySelector(".quickReviewModal"), "Cerrar Review de vista filtrada");
  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".resultFilterChip")].find((button) => button.innerText.includes("Pruebas:"));
    chip?.click();
  });
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("READY") && table.includes("CHECK") && table.includes("BLOCK");
  }, "Limpiar filtro de pruebas desde fila");

  await page.locator(".desktopResultsSection .decisionEvidenceSummaryRail .decisionEvidenceReviewAction", { hasText: "Validar" }).click();
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return modal?.innerText.includes("CHECK")
      && !modal.innerText.includes("READY")
      && review.sourceLabel === "Pruebas: Falta validar"
      && review.queueMode === "evidence-focus"
      && review.rows?.length === 1;
  }, "Abrir Review desde pruebas pendientes");
  await page.evaluate(() => {
    const close = [...document.querySelectorAll(".quickReviewHeader button")].find((button) => button.textContent.includes("Cerrar"));
    close?.click();
  });
  await waitForStage(page, () => !document.querySelector(".quickReviewModal"), "Cerrar Review de pruebas pendientes");

  await applyEvidenceFilter(page, "ready");
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("READY") && !table.includes("CHECK") && !table.includes("BLOCK");
  }, "Filtrar por pruebas OK");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Pruebas: OK"), "Mostrar chip de pruebas OK");

  await applyEvidenceFilter(page, "needs-work");
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("CHECK") && !table.includes("READY") && !table.includes("BLOCK");
  }, "Filtrar por pruebas pendientes");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Pruebas: Validar"), "Mostrar chip de pruebas pendientes");

  await applyEvidenceFilter(page, "blocked");
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("BLOCK") && !table.includes("READY") && !table.includes("CHECK");
  }, "Filtrar por pruebas bloqueadas");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Pruebas: Bloq"), "Mostrar chip de pruebas bloqueadas");

  await page.evaluate(() => {
    const chip = [...document.querySelectorAll(".resultFilterChip")].find((button) => button.innerText.includes("Pruebas:"));
    chip?.click();
  });
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("READY") && table.includes("CHECK") && table.includes("BLOCK");
  }, "Limpiar filtro de pruebas");
}
