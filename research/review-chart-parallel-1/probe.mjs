/**
 * REVIEW-CHART-PARALLEL-1 — mide /api/chart y /api/rs-weekly al cambiar símbolo en /review.
 * Uso: SMOKE_BASE=http://127.0.0.1:3300 node research/review-chart-parallel-1/probe.mjs
 */
import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3300";
const env = fs.readFileSync(".env.local", "utf8");
const token = env.match(/^STATSEDGE_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) {
  console.error("NO_TOKEN");
  process.exit(1);
}

const SYMBOLS = ["AAA", "BBB", "CCC"];
const mockRows = SYMBOLS.map((symbol, index) => ({
  symbol,
  companyName: `${symbol} Corp`,
  country: "US",
  exchange: "NASDAQ",
  currency: "USD",
  weeklyStageState: "2",
  weeklyStageLabel: "Etapa 2",
  totalScore: 90 - index,
  rsRating: 88 - index,
  weeklyRsRating: 88 - index,
  weeklyRsAvailable: true,
  chartPreview: Array.from({ length: 60 }, (_, i) => ({
    date: `2025-${String(Math.floor(i / 28) + 1).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}`,
    close: 100 + i * 0.5,
    volume: 1000000,
    sma50: 100 + i * 0.4,
    sma200: 100 + i * 0.3,
  })),
}));

function chartPayload(symbol) {
  const bars = Array.from({ length: 120 }, (_, i) => ({
    time: 1700000000 + i * 86400,
    open: 100 + i * 0.4,
    high: 101 + i * 0.4,
    low: 99 + i * 0.4,
    close: 100 + i * 0.5,
    volume: 1000000,
  }));
  return { bars, meta: { provider: "probe", estimated: false } };
}

function rsPayload(symbol) {
  const series = Array.from({ length: 40 }, (_, i) => ({
    week: `2024-W${String(i + 1).padStart(2, "0")}`,
    rsRating: 70 + (i % 20),
  }));
  return {
    global: { series, latest: { rsRating: 85 } },
    country: { series: series.slice(0, 30), latest: { rsRating: 80 } },
    theme: { series: series.slice(0, 25), latest: { rsRating: 75 } },
  };
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(120000);

const networkLog = [];

page.on("request", (req) => {
  const url = req.url();
  if (url.includes("/api/chart") || url.includes("/api/rs-weekly") || url.includes("/api/company-brief")) {
    networkLog.push({ t: Date.now(), method: req.method(), url, phase: page.__phase || "unknown" });
  }
});

await page.route("**/api/scans**", async (route) => {
  if (route.request().method() !== "GET") {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    return;
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      configured: true,
      scans: [{
        id: "probe:US:2026-09-12",
        createdAt: "2026-09-12T03:15:31.000Z",
        rowsAreFilteredSnapshot: true,
        rowsSampled: true,
        rowsAvailable: 3,
        settings: { markets: ["US"], progress: { status: "completed" } },
        rows: mockRows,
      }],
      nightly: { found: true, localId: "probe:US:2026-09-12" },
    }),
  });
});

await page.route("**/api/supabase/status**", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ ok: true, configured: true }),
}));

await page.route("**/api/company-brief**", (route) => route.fulfill({
  status: 410,
  contentType: "application/json",
  body: JSON.stringify({ error: "must not be called" }),
}));

await page.route("**/api/chart**", async (route) => {
  const url = new URL(route.request().url());
  const symbol = url.searchParams.get("symbol") || "?";
  await new Promise((r) => setTimeout(r, 80));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(chartPayload(symbol)),
  });
});

await page.route("**/api/rs-weekly**", async (route) => {
  const url = new URL(route.request().url());
  const symbol = url.searchParams.get("symbol") || "?";
  await new Promise((r) => setTimeout(r, 60));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(rsPayload(symbol)),
  });
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(async (t) => {
  await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: t }),
  });
}, token);

await page.evaluate((rows) => {
  localStorage.setItem("statsedge.review.v1", JSON.stringify({
    source: "current",
    selectedSymbol: rows[0].symbol,
    rows,
    activeSettings: { markets: ["US"] },
    sessionIdentity: { version: 1, id: "probe-session" },
  }));
  localStorage.setItem("statsedge.scans.v1", JSON.stringify([{
    id: "probe:US:2026-09-12",
    createdAt: "2026-09-12T03:15:31.000Z",
    rows,
    settings: { markets: ["US"] },
  }]));
}, mockRows);

page.__phase = "open-review";
await page.goto(`${BASE}/review?source=current&symbol=AAA`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".reviewQueueItem", { timeout: 60000 });
await page.waitForTimeout(500);

const t0 = Date.now();
networkLog.push({ t: t0, marker: "after-open", phase: "open-review" });

async function clickSymbol(symbol) {
  page.__phase = `nav-${symbol}`;
  const tNav = Date.now();
  networkLog.push({ t: tNav, marker: `nav-start-${symbol}`, phase: page.__phase });
  await page.locator(`.reviewQueueItem`).filter({ hasText: new RegExp(`^${symbol}\\b`) }).first().click();
  await page.waitForFunction(
    (sym) => document.querySelector(".reviewIdentity b")?.textContent?.trim() === sym,
    symbol,
    { timeout: 10000 },
  );
  await page.waitForTimeout(400);
  networkLog.push({ t: Date.now(), marker: `nav-end-${symbol}`, phase: page.__phase });
}

await clickSymbol("BBB");
await clickSymbol("CCC");
await clickSymbol("AAA");

const chartCalls = networkLog.filter((e) => e.url?.includes("/api/chart"));
const rsCalls = networkLog.filter((e) => e.url?.includes("/api/rs-weekly"));
const briefCalls = networkLog.filter((e) => e.url?.includes("/api/company-brief"));

function groupBySymbol(calls) {
  const map = {};
  for (const c of calls) {
    try {
      const sym = new URL(c.url).searchParams.get("symbol") || "?";
      map[sym] = (map[sym] || 0) + 1;
    } catch { /* noop */ }
  }
  return map;
}

function timingForNav(symbol) {
  const start = networkLog.find((e) => e.marker === `nav-start-${symbol}`)?.t;
  const end = networkLog.find((e) => e.marker === `nav-end-${symbol}`)?.t;
  const chart = chartCalls.filter((c) => {
    if (!start || c.t < start || c.t > end) return false;
    try { return new URL(c.url).searchParams.get("symbol") === symbol; } catch { return false; }
  });
  const rs = rsCalls.filter((c) => {
    if (!start || c.t < start || c.t > end) return false;
    try { return new URL(c.url).searchParams.get("symbol") === symbol; } catch { return false; }
  });
  return {
    shellMs: end && start ? end - start : null,
    chartCount: chart.length,
    rsCount: rs.length,
    chartFirstMs: chart.length && start ? chart[0].t - start : null,
  };
}

const emptyText = await page.evaluate(() => {
  const el = document.querySelector(".universalChartEstimatedNote, .previewEmpty, .reviewChart .previewEmpty");
  return el?.textContent?.trim() || null;
});

await browser.close();

const result = {
  base: BASE,
  briefCalls: briefCalls.length,
  chartTotal: chartCalls.length,
  rsTotal: rsCalls.length,
  chartBySymbol: groupBySymbol(chartCalls),
  rsBySymbol: groupBySymbol(rsCalls),
  navTiming: {
    BBB: timingForNav("BBB"),
    CCC: timingForNav("CCC"),
    AAA: timingForNav("AAA"),
  },
  chartUrls: chartCalls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, "")),
  rsUrls: rsCalls.map((c) => c.url.replace(/^https?:\/\/[^/]+/, "")),
  emptyTextAfterLoad: emptyText,
  pass: {
    zeroBrief: briefCalls.length === 0,
    chartOnNav: ["BBB", "CCC"].every((s) => timingForNav(s).chartCount >= 1),
    noDoubleChart: Object.values(groupBySymbol(chartCalls)).every((n) => n <= 2),
    rsParallel: rsCalls.length >= 1,
  },
};

fs.mkdirSync("research/review-chart-parallel-1", { recursive: true });
fs.writeFileSync("research/review-chart-parallel-1/probe-summary.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
