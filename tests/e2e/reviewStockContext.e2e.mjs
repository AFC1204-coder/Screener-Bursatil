// E2E review -> stock: una cola guardada se prioriza por perfil accionable y
// al abrir Ficha la ficha recibe el contexto completo de decision del screener.
export const name = "review a ficha con contexto de decision";

const mixedMetricAudit = {
  schemaVersion: 1,
  status: "verified",
  verifiedCount: 3,
  traceableCount: 1,
  issueCount: 0,
  issues: [],
  items: [
    { key: "sma50", label: "SMA50", value: 45.2, status: "verified", severity: "neutral", proxy: false },
    { key: "sma200", label: "SMA200", value: 38.1, status: "verified", severity: "neutral", proxy: false },
    { key: "totalScore", label: "Score", value: 82, status: "verified", severity: "neutral", proxy: false },
    { key: "rsGlobalPct", label: "RS global", value: 74, status: "traceable", severity: "neutral", proxy: false },
    { key: "adProxyScore", label: "A/D proxy", value: 50, status: "traceable", severity: "neutral", proxy: true },
    { key: "epsGrowthProxyScore", label: "EPS proxy", value: 45, status: "traceable", severity: "neutral", proxy: true },
  ],
};

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
  objectiveMetricAudit: mixedMetricAudit,
  setupDisplayPlanValid: true,
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

export async function run({ context, baseUrl, sessionSeed }) {
  const rows = [waitRow, fragileOperable];
  const activeSettings = { setupMode: "leader" };
  const reviewSeed = {
    source: "current",
    rows,
    activeSettings,
    currentIndex: 0,
    selectedSymbol: "FRAG",
    reviewedSymbols: [],
    hiddenSymbols: [],
    updatedAt: "2026-06-15T12:00:00.000Z",
  };
  const session = sessionSeed({ rows });
  await context.addInitScript(({ reviewSeedValue, sessionValue }) => {
    if (localStorage.getItem("statsedge.e2e.reviewStockSeeded") === "1") return;
    localStorage.setItem("statsedge.e2e.reviewStockSeeded", "1");
    localStorage.setItem("statsedge.review.v1", JSON.stringify(reviewSeedValue));
    localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(sessionValue));
  }, { reviewSeedValue: reviewSeed, sessionValue: session });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/review?source=current&symbol=FRAG`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("FRAG"), null, { timeout: 20000 });

  const reviewState = await page.evaluate(() => {
    const queueSymbols = [...document.querySelectorAll(".reviewQueueItem .reviewQueueBody > b")]
      .map((el) => el.textContent.trim())
      .filter(Boolean);
    return {
      queueSymbols,
      text: document.body.innerText,
      activeSymbol: document.querySelector(".reviewQueueItem.active .reviewQueueBody > b")?.textContent.trim() || "",
      dataBadge: document.querySelector(".reviewQueueItem.active .reviewQueueDataHealthBadge")?.textContent.trim() || "",
      metricBadge: document.querySelector(".reviewQueueItem.active .reviewQueueMetricTruthBadge")?.textContent.trim() || "",
      scoreBadge: document.querySelector(".reviewQueueItem.active .reviewQueueScoreAuditBadge")?.textContent.trim() || "",
      focusBadge: document.querySelector(".reviewQueueItem.active .reviewQueueFocusBadge")?.textContent.trim() || "",
      proxyMetric: document.querySelector(".reviewMetricGrid .reviewTrustMetric.source-proxy")?.textContent.trim() || "",
      proxyMetricTitle: document.querySelector(".reviewMetricGrid .reviewTrustMetric.source-proxy")?.getAttribute("title") || "",
    };
  });
  if (reviewState.queueSymbols[0] !== "FRAG") throw new Error(`La cola no priorizó FRAG: ${reviewState.queueSymbols.join(",")}`);
  if (reviewState.activeSymbol !== "FRAG") throw new Error(`La fila activa no es FRAG: ${reviewState.activeSymbol || "sin activa"}`);
  if (!reviewState.dataBadge) throw new Error("La cola no muestra salud de datos por fila");
  if (reviewState.metricBadge !== "Mixto") throw new Error(`La cola no muestra trazabilidad de métricas: ${reviewState.metricBadge || "sin badge"}`);
  if (!reviewState.scoreBadge) throw new Error("La cola no muestra auditoría de score por fila");
  if (!/^Foco\b/.test(reviewState.focusBadge)) throw new Error(`La cola no muestra foco de revisión: ${reviewState.focusBadge || "sin badge"}`);
  if (!reviewState.proxyMetric.includes("50p") || !reviewState.proxyMetricTitle.includes("proxy")) {
    throw new Error(`Review no marca métricas proxy en el panel: ${reviewState.proxyMetric || "sin marca"} · ${reviewState.proxyMetricTitle || "sin title"}`);
  }
  if (!reviewState.text.includes("Fragiles")) throw new Error("La cola de review no muestra el resumen de perfil frágil");

  await page.getByRole("link", { name: "Ficha" }).click();
  await page.waitForURL(`${baseUrl}/stock/FRAG`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForFunction(() => document.body.innerText.includes("REVIEW · SCREENER ACTUAL"), null, { timeout: 20000 });
  await page.waitForFunction(() => Boolean(document.querySelector(".screenerOriginReviewFocus")), null, { timeout: 20000 });

  const stockState = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
    const context = session.lastOpenedStockContext || {};
    return {
      text: document.body.innerText,
      originText: document.querySelector(".screenerOriginPanel")?.innerText || "",
      focusText: document.querySelector(".screenerOriginReviewFocus")?.innerText || "",
      snapshotProxyMetric: document.querySelector(".screenerOriginSnapshotMetrics .source-proxy")?.textContent.trim() || "",
      snapshotProxyTitle: document.querySelector(".screenerOriginSnapshotMetrics .source-proxy")?.getAttribute("title") || "",
      context,
    };
  });
  const { context: savedContext, text, originText, focusText } = stockState;
  if (savedContext.symbol !== "FRAG") throw new Error(`Contexto guardado para símbolo incorrecto: ${savedContext.symbol || "sin símbolo"}`);
  if (savedContext.sourceLabel !== "Review · Screener actual") throw new Error(`Origen incorrecto: ${savedContext.sourceLabel || "sin origen"}`);
  if (savedContext.rank !== 1 || savedContext.queueSize !== 2) throw new Error(`Cola incorrecta: ${savedContext.rank}/${savedContext.queueSize}`);
  if (savedContext.decisionProfile?.key !== "operable-fragile") throw new Error(`Perfil no persistido: ${savedContext.decisionProfile?.key || "sin perfil"}`);
  if (savedContext.readiness?.key !== "operable") throw new Error(`Readiness no persistido: ${savedContext.readiness?.key || "sin readiness"}`);
  if (!savedContext.dataHealth?.status?.key) throw new Error("Salud de datos no persistida en el contexto de ficha");
  if (savedContext.metricTruth?.key !== "mixed") throw new Error(`Trazabilidad de métricas no persistida en el contexto de ficha: ${savedContext.metricTruth?.key || "sin key"}`);
  if (!savedContext.reviewFocus?.key) throw new Error("Foco de revisión no persistido en el contexto de ficha");
  if (!savedContext.scoreAudit?.components?.length) throw new Error("Score audit no persistido en el contexto de ficha");
  if (!savedContext.decisionTrace?.confidence || savedContext.decisionTrace.confidence.key === "high") {
    throw new Error("La trazabilidad no conserva la confianza frágil");
  }
  if (!text.includes("REVIEW · SCREENER ACTUAL")) throw new Error("La ficha no renderiza el origen Review");
  if (!text.includes("Operable fragil")) throw new Error("La ficha no renderiza el perfil de decisión");
  if (!text.includes("Datos")) throw new Error("La ficha no renderiza el bloque de salud de datos del origen");
  if (!text.includes("Métricas")) throw new Error("La ficha no renderiza el bloque de métricas del origen");
  if (!stockState.snapshotProxyMetric.includes("50p") || !stockState.snapshotProxyTitle.includes("proxy")) {
    throw new Error(`La ficha no marca métricas proxy del snapshot Screener: ${stockState.snapshotProxyMetric || "sin marca"} · ${stockState.snapshotProxyTitle || "sin title"}`);
  }
  if (!/foco/i.test(focusText)) throw new Error(`La ficha no renderiza el foco de revisión del origen: ${originText.slice(0, 500) || "sin panel"}`);
  if (!/score audit/i.test(text)) throw new Error("La ficha no renderiza el bloque de auditoría del score");
}
