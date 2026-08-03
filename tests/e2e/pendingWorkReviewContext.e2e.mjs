// E2E Trabajo pendiente -> Vista rápida -> Ficha:
// la cola priorizada debe conservar su origen hasta la ficha.
export const name = "trabajo pendiente conserva contexto hasta ficha";

const baseRow = {
  symbol: "WAIT",
  companyName: "Watch Later Inc",
  sector: "Technology",
  industry: "Semiconductors",
  country: "US",
  exchange: "NASDAQ",
  currency: "USD",
  price: 42,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
  totalScore: 64,
  rsGlobalPct: 68,
  rsSectorPct: 66,
  rsQualityScore: 58,
  weinsteinScore: 62,
  minerviniScore: 60,
  volumeEffectScore: 62,
  adProxyScore: 58,
  growthScore: 52,
  epsGrowthProxyScore: 50,
  riskRewardScore: 64,
  weaknessScore: 12,
  extSma50: 8,
  setupDisplayPlanValid: true,
};

const resolvedRow = {
  ...baseRow,
  symbol: "DONE",
  companyName: "Resolved Leader Corp",
  totalScore: 88,
  rsGlobalPct: 92,
  rsSectorPct: 88,
  rsQualityScore: 82,
  weinsteinScore: 84,
  minerviniScore: 82,
  volumeEffectScore: 80,
  adProxyScore: 78,
  growthScore: 72,
  epsGrowthProxyScore: 70,
  riskRewardScore: 76,
};

async function waitForStage(page, predicate, label, timeout = 20000) {
  try {
    await page.waitForFunction(predicate, null, { timeout });
  } catch {
    const text = await page.evaluate(() => document.body.innerText.slice(0, 800));
    throw new Error(`${label} no ocurrió. Texto visible: ${text.replace(/\s+/g, " ").trim()}`);
  }
}

export async function run({ context, baseUrl, sessionSeed }) {
  const rows = [resolvedRow, baseRow];
  const session = {
    ...sessionSeed({ rows }),
    presetKey: "broad",
    settings: { setupMode: "leader" },
  };
  const review = {
    source: "current",
    rows,
    activeSettings: { setupMode: "leader" },
    decisionResolutions: {
      DONE: { key: "candidate", label: "Candidata", tone: "good", updatedAt: "2026-06-17T10:00:00.000Z" },
    },
    decisionResolutionLog: [],
  };
  await context.addInitScript((value) => {
    if (!localStorage.getItem("statsedge.screenerSession.v1")) {
      localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value.session));
    }
    if (!localStorage.getItem("statsedge.review.v1")) {
      localStorage.setItem("statsedge.review.v1", JSON.stringify(value.review));
    }
  }, { session, review });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await waitForStage(page, () => document.body.innerText.includes("WAIT") && document.body.innerText.includes("DONE"), "Restaurar filas en Screener");

  await page.locator(".desktopResultsSection .pendingDecisionWorkPrimary").click();
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("WAIT") && !table.includes("DONE");
  }, "Aplicar Trabajo pendiente");

  await page.evaluate(() => {
    const reviewButton = [...document.querySelectorAll(".desktopResultsSection .decisionRailAction button")]
      .find((button) => button.textContent.trim() === "Revisar");
    reviewButton?.click();
  });
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return modal?.innerText.includes("WAIT")
      && review.sourceLabel === "Trabajo pendiente"
      && review.queueMode === "pending-work"
      && review.resolutionFilter === "pending";
  }, "Abrir Vista rápida con origen Trabajo pendiente");

  await page.locator('.quickReviewHeader a[href="/stock/WAIT"]').click();
  await page.waitForURL(`${baseUrl}/stock/WAIT`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const contextAfterNav = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return {
      lastOpenedStockSymbol: session.lastOpenedStockSymbol || "",
      context: session.lastOpenedStockContext || null,
      reviewSourceLabel: review.sourceLabel || "",
      reviewQueueMode: review.queueMode || "",
    };
  });
  if (contextAfterNav.context?.sourceLabel !== "Review · Trabajo pendiente") {
    throw new Error(`Contexto Trabajo pendiente no guardado: ${JSON.stringify(contextAfterNav)}`);
  }
  await waitForStage(page, () => document.body.innerText.toLowerCase().includes("review · trabajo pendiente"), "Renderizar origen Trabajo pendiente en Ficha");
  await waitForStage(page, () => {
    const text = (document.body.innerText || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return text.includes("apoyo de observacion")
      && text.includes("no senal automatica")
      && text.includes("metodo")
      && text.includes("criterio propio")
      && text.includes("obligatorio");
  }, "Ficha muestra guardrail metodológico y checklist de observación", 45000);

  const stockState = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return {
      context: session.lastOpenedStockContext || {},
      reviewSourceLabel: review.sourceLabel || "",
      reviewQueueMode: review.queueMode || "",
    };
  });

  if (stockState.context.symbol !== "WAIT") throw new Error(`Ficha abrió símbolo incorrecto: ${stockState.context.symbol || "sin símbolo"}`);
  if (stockState.context.sourceLabel !== "Review · Trabajo pendiente") throw new Error(`Origen de ficha incorrecto: ${stockState.context.sourceLabel || "sin origen"}`);
  if (stockState.reviewSourceLabel !== "Trabajo pendiente") throw new Error(`Review perdió sourceLabel: ${stockState.reviewSourceLabel || "sin label"}`);
  if (stockState.reviewQueueMode !== "pending-work") throw new Error(`Review perdió queueMode: ${stockState.reviewQueueMode || "sin modo"}`);

  await page.locator(".stockDecisionResolveRail button.good", { hasText: "Candidata" }).click();
  await waitForStage(page, () => {
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return review.decisionResolutions?.WAIT?.key === "candidate";
  }, "Resolver WAIT desde la ficha");
  await waitForStage(page, () => {
    const rail = document.querySelector(".stockReviewFlowRail");
    const text = rail?.innerText || "";
    return rail?.classList.contains("outOfFilter")
      && rail.classList.contains("queueComplete")
      && text.includes("Cola completa")
      && text.includes("no quedan acciones pendientes");
  }, "Mostrar cola completa tras resolver el último pendiente en ficha");

  await page.locator(".stockReviewFlowActions a.primary", { hasText: "Ver Review" }).click();
  await page.waitForURL(`${baseUrl}/review?source=current&symbol=WAIT`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForStage(page, () => {
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    const empty = document.querySelector(".reviewEmptyState.complete");
    const status = document.querySelector(".reviewStatusLine.complete");
    const text = (empty?.innerText || "").toLowerCase();
    const statusText = (status?.innerText || "").toLowerCase();
    return review.resolutionFilter === "pending"
      && empty
      && status
      && text.includes("cola pendiente completada")
      && text.includes("no quedan acciones pendientes")
      && text.includes("ver candidatas")
      && statusText.includes("cola pendiente completada")
      && statusText.includes("1/1 resueltas")
      && !document.querySelector(".reviewQueueItem");
  }, "Mostrar cierre accionable de cola pendiente en Review");

  await page.locator(".reviewEmptyActions button", { hasText: "Ver candidatas" }).click();
  await waitForStage(page, () => {
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    const item = document.querySelector(".reviewQueueItem");
    const statusText = (document.querySelector(".reviewStatusLine.filtered")?.innerText || "").toLowerCase();
    return review.resolutionFilter === "candidate"
      && item?.innerText.includes("WAIT")
      && item.innerText.includes("Candidata")
      && statusText.includes("candidata")
      && statusText.includes("1/1 visibles");
  }, "Abrir candidatas desde cola pendiente completada");

  await page.locator('.reviewActionStrip a[href="/stock/WAIT"]').click();
  await page.waitForURL(`${baseUrl}/stock/WAIT`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await waitForStage(page, () => {
    const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
    const context = session.lastOpenedStockContext || {};
    const focusText = document.querySelector(".stockDecisionFocus")?.innerText || "";
    return context.decisionFocus?.resolutionFilterKey === "candidate"
      && context.decisionFocus?.queueFilterLabel === "Candidata"
      && focusText.includes("Candidata");
  }, "Ficha conserva subcola candidata desde Review");

  await page.locator(".stockDecisionResolveRail button.neutral", { hasText: "Reabrir" }).click();
  await waitForStage(page, () => {
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    const rail = document.querySelector(".stockReviewFlowRail");
    const text = rail?.innerText || "";
    return !review.decisionResolutions?.WAIT
      && rail?.classList.contains("queueComplete")
      && text.includes("Cola completa")
      && text.includes("acciones del filtro Candidata")
      && !text.includes("acciones pendientes");
  }, "Ficha cierra subcola candidata con copia específica");
}
