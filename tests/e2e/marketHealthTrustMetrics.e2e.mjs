export const name = "market health marca métricas proxy del snapshot";

const row = {
  symbol: "MHL",
  companyName: "Market Health Leader",
  country: "US",
  sector: "Technology",
  industry: "Software",
  theme: "AI Platforms",
  price: 100,
  sma50: 92,
  sma200: 80,
  sma200Slope: 1,
  distance52w: -3,
  objectiveScore: 82,
  totalScore: 82,
  rsGlobalPct: 72,
  weaknessScore: 12,
  objectiveMetricAudit: {
    status: "verified",
    verifiedCount: 2,
    traceableCount: 1,
    issues: [],
    items: [
      { key: "rsGlobalPct", label: "RS global", status: "verified", severity: "neutral", proxy: false },
      { key: "objectiveScore", label: "Score objetivo", status: "traceable", severity: "neutral", proxy: true },
    ],
  },
};

export async function run({ context, baseUrl }) {
  await context.route("**/api/market-health", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      marketScore: 55,
      regime: { label: "Neutral", stance: "Observación", color: "amber" },
      breadthProxy: { pctAbove50: 50, pctAbove200: 45, indexes: 0, above50: 0, above200: 0, above30w: 0, positiveSma200Slope: 0, near52wHigh: 0 },
      weinsteinTape: null,
      sectorTape: [],
      sectorSummary: {},
      indexes: [],
      failures: [],
    }),
  }));
  await context.route("**/api/market-news", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [] }) }));
  await context.route("**/api/social-sentiment**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [] }) }));
  await context.route("**/api/coverage**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [], summary: {} }) }));
  await context.route("**/api/methodology-health", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ rows: [], summary: {} }) }));
  await context.addInitScript((payload) => {
    localStorage.setItem("statsedge.scans.v1", JSON.stringify([payload.scan]));
  }, {
    scan: {
      id: "market-health-trust-scan",
      name: "Market health trust scan",
      createdAt: "2026-06-18T08:00:00.000Z",
      rows: [row],
    },
  });

  const page = await context.newPage();
  await page.goto(`${baseUrl}/market-health`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForFunction(() => document.body.innerText.includes("MHL"), null, { timeout: 30000 });
  await page.waitForFunction(() => {
    const proxy = document.querySelector(".marketHealthPage .marketTrustMetric.source-proxy");
    const label = proxy?.getAttribute("aria-label")?.toLowerCase() || "";
    return label.includes("82") && label.includes("proxy/estimada");
  }, null, { timeout: 30000 });
}
