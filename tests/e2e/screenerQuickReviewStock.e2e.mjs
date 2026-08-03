// E2E Screener -> Vista rápida -> Ficha: el enlace de ficha dentro del modal
// debe guardar contexto Review completo, no el contexto genérico de Screener.
export const name = "screener vista rápida a ficha con foco Review";

const fragileOperable = {
  symbol: "FRAG",
  companyName: "Fragile Growth Corp",
  sector: "Technology",
  industry: "Semiconductors",
  country: "US",
  exchange: "NASDAQ",
  currency: "USD",
  price: 50,
  chartBarsCount: 260,
  priceFreshnessOk: true,
  dataCoverageScore: 82,
  technicalCoverageScore: 88,
  fundamentalCoverageScore: 64,
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
  weaknessScore: 12,
  extSma50: 10,
  setupDisplayPlanValid: true,
  objectiveMetricAudit: {
    schemaVersion: 1,
    status: "verified",
    worstStatus: "traceable",
    checkedCount: 4,
    verifiedCount: 1,
    traceableCount: 3,
    issueCount: 0,
    items: [
      { key: "totalScore", label: "Score", status: "verified", severity: "neutral", proxy: false },
      { key: "rsGlobalPct", label: "RS global", status: "traceable", severity: "neutral", proxy: false },
      { key: "adProxyScore", label: "A/D proxy", status: "traceable", severity: "neutral", proxy: true },
      { key: "epsGrowthProxyScore", label: "EPS proxy", status: "traceable", severity: "neutral", proxy: true },
    ],
  },
};

const waitRow = {
  ...fragileOperable,
  symbol: "WAIT",
  companyName: "Watch Later Inc",
  totalScore: 48,
  rsGlobalPct: 45,
  rsSectorPct: 42,
  rsQualityScore: 40,
  weinsteinScore: 44,
  minerviniScore: 38,
  volumeEffectScore: 35,
  adProxyScore: 32,
  growthScore: 28,
  epsGrowthProxyScore: 25,
  riskRewardScore: 35,
  setupDisplayPlanValid: false,
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
  const rows = [waitRow, fragileOperable];
  const session = {
    ...sessionSeed({ rows }),
    presetKey: "broad",
    settings: { setupMode: "leader" },
  };
  await context.addInitScript((value) => {
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(value));
  }, session);

  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "networkidle", timeout: 90000 });
  await waitForStage(page, () => document.body.innerText.includes("FRAG"), "Restaurar FRAG en Screener");

  const priorityFilterSelector = ".desktopResultsSection .reviewPriorityResultRail button.priority-validate-first:not(.reviewPriorityAction)";
  const appliedPriorityFilter = await page.evaluate((selector) => {
    const button = document.querySelector(selector);
    if (!button) return false;
    button.click();
    return true;
  }, priorityFilterSelector);
  if (!appliedPriorityFilter) throw new Error("No encontré el filtro de prioridad Validar primero en el Screener");
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("FRAG") && !table.includes("WAIT");
  }, "Filtrar tabla principal por prioridad Validar primero");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Prioridad: Validar primero"), "Mostrar chip de prioridad de investigación");
  await page.locator(".desktopResultsSection .reviewPriorityResultRail .reviewPriorityAction", { hasText: "Revisar Validar" }).click();
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return modal?.innerText.includes("FRAG")
      && review.sourceLabel === "Prioridad: Validar primero"
      && review.queueMode === "priority-focus"
      && review.rows?.length === 1;
  }, "Abrir cola Review desde prioridad Validar primero");
  await page.evaluate(() => {
    const close = [...document.querySelectorAll(".quickReviewHeader button")].find((button) => button.textContent.includes("Cerrar"));
    close?.click();
  });
  await waitForStage(page, () => !document.querySelector(".quickReviewModal"), "Cerrar Vista rápida de prioridad");
  await page.click(priorityFilterSelector);
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("FRAG") && table.includes("WAIT");
  }, "Restaurar todas las prioridades en tabla principal");

  const opened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".compactResultsTable tbody tr")];
    const target = rows.find((row) => row.innerText.includes("FRAG"));
    if (!target) return false;
    target.click();
    return true;
  });
  if (!opened) throw new Error("No encontré la fila FRAG para abrir la vista rápida");

  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    return modal && modal.innerText.includes("FRAG") && modal.innerText.includes("Ficha");
  }, "Abrir Vista rápida de FRAG");
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const priorityPanel = modal?.querySelector(".quickReviewPriorityPanel");
    const summary = modal?.querySelector(".reviewPrioritySummary");
    const badges = [...(modal?.querySelectorAll(".reviewQueuePriorityBadge") || [])].map((badge) => badge.textContent.trim());
    return priorityPanel?.innerText.includes("Validar primero")
      && summary?.innerText.toLowerCase().includes("validar")
      && badges.includes("Validar");
  }, "Mostrar prioridad auditable en Vista rápida");
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const read = modal?.querySelector(".screenerOriginDecisionRead");
    const text = (read?.innerText || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return text.includes("accion") && text.includes("confianza") && text.includes("freno");
  }, "Mostrar lectura compacta de decision en Vista rápida");
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    const evidence = modal?.querySelector(".decisionEvidenceChecklist");
    const originEvidence = modal?.querySelector(".screenerOriginEvidence");
    const text = `${evidence?.innerText || ""} ${originEvidence?.innerText || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    return text.includes("pruebas") && /confluencia|datos fiables|setup accionable|liderazgo/.test(text);
  }, "Mostrar pruebas de decisión en Vista rápida");
  await waitForStage(page, () => {
    const proxyMetrics = [...document.querySelectorAll(".quickReviewModal .quickReviewMetricValue.source-proxy")];
    return proxyMetrics.some((metric) => metric.textContent.trim().includes("50p") && metric.getAttribute("title")?.includes("proxy"));
  }, "Marcar métricas proxy en Vista rápida");

  await page.locator(".quickReviewResolveRail button.good").click();
  await waitForStage(page, () => {
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return review.decisionResolutions?.FRAG?.key === "candidate";
  }, "Resolver FRAG como candidata desde Vista rápida");
  await waitForStage(page, () => [...document.querySelectorAll(".screenerReviewQueue .reviewQueueResolutionBadge")]
    .some((badge) => badge.textContent.trim() === "Candidata"), "Mostrar resolución en la cola de Vista rápida");
  await waitForStage(page, () => [...document.querySelectorAll(".compactResultsTable tbody tr")]
    .some((row) => row.innerText.includes("FRAG") && [...row.querySelectorAll(".reviewQueueResolutionBadge")]
      .some((badge) => badge.textContent.trim() === "Candidata")), "Mostrar resolución en la tabla principal del Screener");
  const appliedResolutionFilter = await page.evaluate(() => {
    const select = document.querySelector('.desktopResultsSection select[aria-label="Filtrar por resolución de decision"]');
    if (!select || ![...select.options].some((option) => option.value === "candidate")) return false;
    select.value = "candidate";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  });
  if (!appliedResolutionFilter) throw new Error("No encontré el filtro de resolución candidata en el Screener");
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("FRAG") && !table.includes("WAIT");
  }, "Filtrar tabla principal por resolución candidata");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Resolución: Candidata"), "Mostrar chip de filtro por resolución");
  await page.evaluate(() => {
    const select = document.querySelector('.desktopResultsSection select[aria-label="Filtrar por resolución de decision"]');
    if (!select) return;
    select.value = "all";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("FRAG") && table.includes("WAIT");
  }, "Restaurar todas las resoluciones en tabla principal");

  await page.evaluate(() => {
    const close = [...document.querySelectorAll(".quickReviewHeader button")].find((button) => button.textContent.includes("Cerrar"));
    close?.click();
  });
  await waitForStage(page, () => !document.querySelector(".quickReviewModal"), "Cerrar Vista rápida antes de aplicar trabajo pendiente");
  await page.locator(".desktopResultsSection .pendingDecisionWorkPrimary").click();
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("WAIT") && !table.includes("FRAG");
  }, "Aplicar trabajo pendiente desde Screener");
  await waitForStage(page, () => document.querySelector(".resultFilterChips")?.innerText.includes("Resolución: Sin decidir"), "Mostrar chip de trabajo pendiente");
  await page.evaluate(() => {
    const clear = [...document.querySelectorAll(".desktopResultsSection .pendingDecisionWorkActions button")]
      .find((button) => button.textContent.includes("Limpiar enfoque"));
    clear?.click();
  });
  await waitForStage(page, () => {
    const table = document.querySelector(".compactResultsTable tbody")?.innerText || "";
    return table.includes("FRAG") && table.includes("WAIT");
  }, "Limpiar trabajo pendiente");

  const reopened = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".compactResultsTable tbody tr")];
    const target = rows.find((row) => row.innerText.includes("FRAG"));
    if (!target) return false;
    target.click();
    return true;
  });
  if (!reopened) throw new Error("No pude reabrir FRAG tras probar trabajo pendiente");
  await waitForStage(page, () => {
    const modal = document.querySelector(".quickReviewModal");
    return modal && modal.innerText.includes("FRAG") && modal.innerText.includes("Ficha");
  }, "Reabrir Vista rápida de FRAG tras trabajo pendiente");

  await page.locator('.quickReviewHeader a[href="/stock/FRAG"]').click();
  await page.waitForURL(`${baseUrl}/stock/FRAG`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(".screenerOriginPanel", { timeout: 30000 });
  await waitForStage(page, () => document.querySelector(".screenerOriginPanel")?.innerText.toLowerCase().includes("review · screener actual"), "Renderizar origen Review en Ficha");

  const stockState = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    const context = session.lastOpenedStockContext || {};
    return {
      text: document.body.innerText,
      context,
      reviewSelectedSymbol: review.selectedSymbol || "",
      reviewCurrentIndex: review.currentIndex,
    };
  });

  if (stockState.context.symbol !== "FRAG") throw new Error(`Contexto guardado para símbolo incorrecto: ${stockState.context.symbol || "sin símbolo"}`);
  if (stockState.context.sourceLabel !== "Review · Screener actual") throw new Error(`Origen incorrecto desde vista rápida: ${stockState.context.sourceLabel || "sin origen"}`);
  if (!stockState.context.decisionFocus?.key) throw new Error("La ficha abierta desde Vista rápida no conserva Foco Review");
  if (stockState.context.methodologyFocus?.key !== "confluence") throw new Error(`La ficha no conserva foco metodológico: ${stockState.context.methodologyFocus?.key || "sin foco"}`);
  if (stockState.reviewSelectedSymbol !== "FRAG") throw new Error(`Review no seleccionó FRAG: ${stockState.reviewSelectedSymbol || "sin símbolo"}`);
  if (stockState.context.decisionProfile?.key !== "operable-fragile") throw new Error(`Perfil no preservado desde resolución rápida: ${stockState.context.decisionProfile?.key || "sin perfil"}`);
  if (!stockState.text.toLowerCase().includes("foco a observar")) throw new Error("La ficha no renderiza el foco de observación desde Vista rápida");
  if (!stockState.text.toLowerCase().includes("método pendiente")) throw new Error("La ficha no renderiza el foco metodológico desde Vista rápida");
}
