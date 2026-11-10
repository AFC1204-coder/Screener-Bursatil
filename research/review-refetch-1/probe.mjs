import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3302";
const SCAN_DELAY_MS = Number(process.env.SCAN_DELAY_MS || 2500);
const env = fs.readFileSync(".env.local", "utf8");
const token = env.match(/^STATSEDGE_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) {
  console.error("NO_TOKEN");
  process.exit(1);
}

const SCAN_ID = "materialized:US:2026-09-12:t031531:o0:l3";
const scannedAt = "2026-09-12T03:15:31.000Z";
const mockRows = ["AAA", "BBB", "CCC"].map((symbol, index) => ({
  symbol,
  companyName: symbol,
  country: "US",
  weeklyStageState: "2",
  weeklyStageLabel: "Etapa 2",
  totalScore: 90 - index,
  rsRating: 90 - index,
  weeklyRsRating: 90 - index,
}));

function scansPayload({ markets = ["US"] } = {}) {
  return {
    ok: true,
    configured: true,
    scans: [{
      id: SCAN_ID,
      createdAt: scannedAt,
      updatedAt: scannedAt,
      rowsAreFilteredSnapshot: true,
      rowsSampled: true,
      rowsAvailable: 3309,
      settings: { markets, progress: { status: "completed" } },
      rows: mockRows,
    }],
    nightly: { found: true, localId: SCAN_ID },
  };
}

function classifyUrl(url) {
  try {
    const parsed = new URL(url, BASE);
    if (parsed.pathname !== "/api/scans") return "other";
    const methodMark = parsed.searchParams.toString();
    if (parsed.searchParams.get("anchor") === "nightly-us") return "GET nightly-us";
    if (parsed.searchParams.get("anchor") === "markets") {
      const markets = parsed.searchParams.get("markets") || "";
      const count = markets ? markets.split(",").length : 0;
      return `GET markets (${count})`;
    }
    if (parsed.searchParams.get("includeDeleted") === "1") return "GET pullCloudState";
    return `GET other?${methodMark.slice(0, 80)}`;
  } catch {
    return url;
  }
}

function callerFromStack(stack = "") {
  const lines = String(stack).split("\n").map((line) => line.trim());
  return lines.filter((line) => /page\.jsx|cloudSyncClient|useQuickReviewSession|review\/page|screenerPipeline/.test(line)).slice(0, 6);
}

async function setPhase(phase) {
  await page.evaluate((nextPhase) => {
    window.__scansPhase = nextPhase;
    sessionStorage.setItem("__scansPhase", nextPhase);
  }, phase);
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(120000);

await page.addInitScript(() => {
  const storedPhase = sessionStorage.getItem("__scansPhase");
  window.__scansPhase = storedPhase || "boot";
  window.__scansLog = JSON.parse(sessionStorage.getItem("__scansLog") || "[]");
  const persist = () => {
    sessionStorage.setItem("__scansPhase", window.__scansPhase);
    sessionStorage.setItem("__scansLog", JSON.stringify(window.__scansLog));
  };
  const orig = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (String(url).includes("/api/scans")) {
      const err = new Error("scans-call");
      window.__scansLog.push({
        phase: window.__scansPhase,
        url: String(url),
        method: (init && init.method) || (typeof input === "object" && input && input.method) || "GET",
        t: Date.now(),
        stack: err.stack || "",
      });
      persist();
    }
    return orig.apply(this, arguments);
  };
});

await page.route("**/api/scans**", async (route) => {
  const request = route.request();
  if (request.method() !== "GET") {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, configured: true }),
    });
    return;
  }
  const url = new URL(request.url());
  const markets = (url.searchParams.get("markets") || "US").split(",").filter(Boolean);
  await new Promise((resolve) => setTimeout(resolve, SCAN_DELAY_MS));
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(scansPayload({ markets: url.searchParams.get("anchor") === "markets" ? markets : ["US"] })),
  });
});

await page.route("**/api/supabase/status**", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ ok: true, configured: true }),
}));
await page.route("**/api/company-brief**", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ symbol: "AAA", name: "AAA", chartBars: [] }),
}));
await page.route("**/api/chart**", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ bars: [] }),
}));
await page.route("**/api/rs-weekly**", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ series: [] }),
}));

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(async (t) => {
  await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: t }),
  });
}, token);
await page.evaluate(() => {
  window.__scansPhase = "boot";
  window.__scansLog = [];
  sessionStorage.setItem("__scansPhase", "boot");
  sessionStorage.setItem("__scansLog", "[]");
});
await page.reload({ waitUntil: "domcontentloaded" });

await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Revisar" && !b.disabled);
  return Boolean(btn);
}, { timeout: 120000 });

const boot = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__scansLog") || "[]").filter((item) => item.phase === "boot"));

await setPhase("first-open");
await page.locator("button.btnPrimary", { hasText: "Revisar" }).first().click();
await page.waitForURL(/\/review/, { timeout: 60000 });
await page.waitForTimeout(300);
const firstOpen = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__scansLog") || "[]").filter((item) => item.phase === "first-open"));

await setPhase("return-home");
await page.locator('a[href="/"]').first().click();
await page.waitForURL(/\/$/, { timeout: 30000 });
await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Revisar" && !b.disabled);
  return Boolean(btn);
}, { timeout: 120000 });
const returnHome = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__scansLog") || "[]").filter((item) => item.phase === "return-home"));

await setPhase("reopen-click");
await page.locator("button.btnPrimary", { hasText: "Revisar" }).first().click();
await page.waitForURL(/\/review/, { timeout: 60000 });
await page.waitForTimeout(SCAN_DELAY_MS + 400);
const reopenClick = await page.evaluate(() => JSON.parse(sessionStorage.getItem("__scansLog") || "[]").filter((item) => item.phase === "reopen-click"));

const reviewState = await page.evaluate(() => {
  const r = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
  return {
    queueSize: (r.rows || []).length,
    selected: r.selectedSymbol,
    hasIdentity: Boolean(r.sessionIdentity?.version),
    status: document.querySelector(".reviewStatusLine")?.textContent || "",
    url: location.href,
  };
});

await browser.close();

function summarize(calls) {
  return calls.map((call) => ({
    kind: classifyUrl(call.url),
    method: call.method,
    url: call.url.replace(/^https?:\/\/[^/]+/, ""),
    callers: callerFromStack(call.stack),
  }));
}

const result = {
  base: BASE,
  scanDelayMs: SCAN_DELAY_MS,
  reviewState,
  counts: {
    boot: boot.length,
    firstOpen: firstOpen.length,
    returnHome: returnHome.length,
    reopenClick: reopenClick.length,
  },
  boot: summarize(boot),
  firstOpen: summarize(firstOpen),
  returnHome: summarize(returnHome),
  reopenClick: summarize(reopenClick),
};

const outPath = "research/review-refetch-1/probe.json";
fs.mkdirSync("research/review-refetch-1", { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
