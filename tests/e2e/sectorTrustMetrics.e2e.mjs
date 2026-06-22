export const name = "sectores marca métricas proxy en filas";

const row = {
  symbol: "SECT",
  companyName: "Sector Proxy Corp",
  country: "US",
  exchange: "NASDAQ",
  theme: "AI Hardware",
  sector: "Technology",
  industry: "Semiconductors",
  price: 80,
  objectiveScore: 78,
  totalScore: 78,
  rsGlobalPct: 86,
  weaknessScore: 9,
  perf3m: 24,
  perf6m: 41,
  distance52w: -4,
  extSma50: 7,
  weinsteinScore: 83,
  minerviniScore: 80,
  riskScore: 62,
  chartPreview: [
    { date: "2026-06-16", close: 76, volume: 1_000_000 },
    { date: "2026-06-17", close: 78, volume: 1_100_000 },
    { date: "2026-06-18", close: 80, volume: 1_250_000 },
  ],
  objectiveMetricAudit: {
    status: "verified",
    verifiedCount: 3,
    traceableCount: 1,
    issues: [],
    items: [
      { key: "rsGlobalPct", label: "RS global", status: "verified", severity: "neutral", proxy: false },
      { key: "perf3m", label: "Perf 3M", status: "verified", severity: "neutral", proxy: false },
      { key: "objectiveScore", label: "Score objetivo", status: "verified", severity: "neutral", proxy: false },
      { key: "riskScore", label: "Riesgo", status: "traceable", severity: "neutral", proxy: true },
    ],
  },
};

export async function run({ context, baseUrl }) {
  await context.route("**/api/discovery?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ configured: false, groups: {}, health: { state: "local" } }),
  }));
  await context.addInitScript((payload) => {
    localStorage.setItem("statsedge.scans.v1", JSON.stringify([payload.scan]));
  }, {
    scan: {
      id: "sector-trust-scan",
      name: "Sector trust scan",
      createdAt: "2026-06-18T08:00:00.000Z",
      rows: [row],
    },
  });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/sectors`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("SECT"), null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const proxy = document.querySelector(".sectorsPage .sectorTrustMetric.source-proxy");
    const label = proxy?.getAttribute("aria-label")?.toLowerCase() || "";
    return label.includes("62") && label.includes("proxy/estimada");
  }, null, { timeout: 30000 });
}
