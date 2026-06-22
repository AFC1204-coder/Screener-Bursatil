// E2E trazabilidad de decisiones: una resolución tomada en Review/Ficha debe
// aparecer en Research Desk y Listas para el mismo símbolo.
export const name = "trazabilidad de decisiones en research y listas";

const row = {
  symbol: "TRACE",
  companyName: "Traceable Decision Corp",
  sector: "Technology",
  industry: "Software",
  country: "US",
  price: 100,
  totalScore: 84,
  rsQualityScore: 78,
  weaknessScore: 8,
  weinsteinScore: 82,
  minerviniScore: 80,
  riskScore: 22,
  perf3m: 18,
  perf6m: 31,
  perf12m: 52,
  distance52w: -3,
  extSma50: 4,
  chartPreview: [
    { date: "2026-06-14", close: 96, volume: 1000000 },
    { date: "2026-06-15", close: 98, volume: 1100000 },
    { date: "2026-06-16", close: 100, volume: 1200000 },
  ],
  objectiveMetricAudit: {
    status: "verified",
    verifiedCount: 3,
    traceableCount: 1,
    issues: [],
    items: [
      { key: "perf3m", label: "Perf 3M", status: "verified", severity: "neutral", proxy: false },
      { key: "distance52w", label: "Dist. max 52w", status: "verified", severity: "neutral", proxy: false },
      { key: "objectiveScore", label: "Score objetivo", status: "verified", severity: "neutral", proxy: false },
      { key: "rsQualityScore", label: "RS Quality", status: "traceable", severity: "neutral", proxy: true },
    ],
  },
};

async function waitForTrace(page, predicate, label, timeout = 30000) {
  try {
    await page.waitForFunction(predicate, null, { timeout });
  } catch (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function run({ context, baseUrl }) {
  const now = "2026-06-18T08:00:00.000Z";
  const page = await context.newPage();
  await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.evaluate((payload) => {
    localStorage.setItem("statsedge.scans.v1", JSON.stringify([payload.scan]));
    localStorage.setItem("statsedge.favorites.v1", JSON.stringify([payload.favorite]));
    localStorage.setItem("statsedge.review.v1", JSON.stringify(payload.review));
  }, {
    scan: {
      id: "trace-scan",
      name: "Traceability scan",
      createdAt: now,
      rows: [row],
    },
    favorite: {
      id: "trace-fav",
      symbol: row.symbol,
      companyName: row.companyName,
      addedAt: now,
      updatedAt: now,
      source: "review",
      notes: "",
      snapshot: row,
    },
    review: {
      source: "latest",
      rows: [row],
      selectedSymbol: "TRACE",
      decisionResolutions: {},
      decisionResolutionLog: [],
      updatedAt: now,
    },
  });

  await page.goto(`${baseUrl}/review?source=latest&symbol=TRACE`, { waitUntil: "networkidle", timeout: 90000 });
  await waitForTrace(page, () => {
    const text = document.body.innerText.toLowerCase();
    return text.includes("trace") && text.includes("resolver desde review");
  }, "Cargar Review con TRACE");
  await page.locator(".reviewResolveRail button.good", { hasText: "Candidata" }).click();
  await waitForTrace(page, () => {
    const review = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
    return review.decisionResolutions?.TRACE?.key === "candidate"
      && (review.decisionResolutionLog || []).some((entry) => entry.symbol === "TRACE" && entry.key === "candidate");
  }, "Persistir resolución candidata desde Review");

  await page.goto(`${baseUrl}/research-desk`, { waitUntil: "networkidle", timeout: 90000 });
  await waitForTrace(page, () => {
    const panel = document.querySelector(".decisionTracePanel");
    const text = (panel?.innerText || "").toLowerCase();
    const proxyMetric = document.querySelector(".researchDeskPage .researchTrustMetric.source-proxy, .page .researchTrustMetric.source-proxy");
    return text.includes("trazabilidad review")
      && text.includes("1 trazadas")
      && text.includes("candidata")
      && text.includes("trace")
      && proxyMetric?.getAttribute("aria-label")?.toLowerCase().includes("proxy/estimada")
      && [...document.querySelectorAll(".decisionTraceBadge.good")].some((badge) => badge.innerText.toLowerCase().includes("candidata"));
  }, "Research Desk muestra la resolución tomada en Review", 20000);

  await page.evaluate((updatedAt) => {
    const nextReview = {
      source: "current",
      rows: [],
      decisionResolutions: {
        TRACE: { key: "watch", label: "Vigilar", tone: "warn", source: "review", note: "Esperar ruptura limpia", updatedAt },
      },
      decisionResolutionLog: [
        { symbol: "TRACE", key: "watch", label: "Vigilar", tone: "warn", source: "review", note: "Esperar ruptura limpia", updatedAt },
      ],
      updatedAt,
    };
    localStorage.setItem("statsedge.review.v1", JSON.stringify(nextReview));
    window.dispatchEvent(new Event("focus"));
  }, "2026-06-18T09:00:00.000Z");

  await waitForTrace(page, () => {
    const panel = document.querySelector(".decisionTracePanel");
    const text = (panel?.innerText || "").toLowerCase();
    return text.includes("vigilar")
      && text.includes("esperar ruptura limpia")
      && [...document.querySelectorAll(".decisionTraceBadge.warn")].some((badge) => badge.innerText.toLowerCase().includes("vigilar"));
  }, "Research Desk refresca una resolución actualizada por foco", 20000);

  await page.goto(`${baseUrl}/lists`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await waitForTrace(page, () => {
    const panel = document.querySelector(".decisionTracePanel");
    const text = (panel?.innerText || "").toLowerCase();
    const proxyMetric = document.querySelector(".listsPage .listTrustMetric.source-proxy");
    return text.includes("trazabilidad review")
      && text.includes("1 trazadas")
      && text.includes("vigilar")
      && text.includes("esperar ruptura limpia")
      && proxyMetric?.getAttribute("aria-label")?.toLowerCase().includes("proxy/estimada")
      && [...document.querySelectorAll(".decisionTraceBadge.warn")].some((badge) => badge.innerText.toLowerCase().includes("vigilar"));
  }, "Listas hereda la resolución vigente", 30000);

  await page.evaluate((updatedAt) => {
    const nextReview = {
      source: "current",
      rows: [],
      decisionResolutions: {
        TRACE: { key: "watch", label: "Vigilar", tone: "warn", source: "review", note: "Esperar ruptura limpia", updatedAt },
      },
      decisionResolutionLog: [
        { symbol: "TRACE", key: "watch", label: "Vigilar", tone: "warn", source: "review", note: "Esperar ruptura limpia", updatedAt },
      ],
      updatedAt,
    };
    localStorage.setItem("statsedge.review.v1", JSON.stringify(nextReview));
    window.dispatchEvent(new Event("focus"));
  }, "2026-06-18T10:00:00.000Z");

  await waitForTrace(page, () => {
    const panel = document.querySelector(".decisionTracePanel");
    const text = (panel?.innerText || "").toLowerCase();
    return text.includes("vigilar")
      && text.includes("esperar ruptura limpia")
      && [...document.querySelectorAll(".decisionTraceBadge.warn")].some((badge) => badge.innerText.toLowerCase().includes("vigilar"));
  }, "Listas refresca una resolución actualizada por foco", 30000);
}
