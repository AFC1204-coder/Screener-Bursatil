import fs from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.SMOKE_BASE || "http://localhost:3302";
const env = fs.readFileSync(".env.local", "utf8");
const token = env.match(/^STATSEDGE_ACCESS_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) {
  console.error("NO_TOKEN");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(180000);
const scansOnReopen = [];
page.on("request", (req) => {
  if (req.url().includes("/api/scans")) scansOnReopen.push(req.url());
});

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.evaluate(async (t) => {
  await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: t }),
  });
}, token);
await page.reload({ waitUntil: "domcontentloaded" });

await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Revisar" && !b.disabled);
  return Boolean(btn);
}, { timeout: 180000 });

await page.evaluate(() => localStorage.removeItem("statsedge.review.v1"));
await page.locator("button.btnPrimary", { hasText: "Revisar" }).first().click();
await page.waitForURL(/\/review/, { timeout: 60000 });

const open1 = await page.evaluate(() => {
  const r = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
  const symbols = (r.rows || []).map((row) => row.symbol);
  return {
    queueSize: symbols.length,
    first6: symbols.slice(0, 6),
    selected: r.selectedSymbol,
    hasIdentity: Boolean(r.sessionIdentity?.version),
    presetKey: r.presetKey,
    url: location.href,
  };
});

for (let i = 0; i < 5; i += 1) {
  await page.locator("button.btnPrimary", { hasText: "Siguiente" }).click();
  await page.waitForTimeout(400);
}

const beforeClose = await page.evaluate(() => {
  const r = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
  return {
    queueSize: (r.rows || []).length,
    symbols: (r.rows || []).map((row) => row.symbol),
    selectedSymbol: r.selectedSymbol,
    currentIndex: r.currentIndex,
    sessionIdentity: r.sessionIdentity,
    presetKey: r.presetKey,
    url: location.href,
    pos: document.querySelector(".reviewFloatingNav span")?.textContent || "",
  };
});

await page.locator('a[href="/"]').first().click();
await page.waitForURL(/\/$/, { timeout: 30000 });
await page.waitForFunction(() => {
  const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Revisar" && !b.disabled);
  return Boolean(btn);
}, { timeout: 120000 });
scansOnReopen.length = 0;
await page.locator("button.btnPrimary", { hasText: "Revisar" }).first().click();
await page.waitForURL(/\/review/, { timeout: 60000 });

const afterReopen = await page.evaluate(() => {
  const r = JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}");
  const symbols = (r.rows || []).map((row) => row.symbol);
  return {
    queueSize: symbols.length,
    selected: r.selectedSymbol,
    currentIndex: r.currentIndex,
    hasIdentity: Boolean(r.sessionIdentity?.version),
    presetKey: r.presetKey,
    sessionIdentity: r.sessionIdentity,
    url: location.href,
    pos: document.querySelector(".reviewFloatingNav span")?.textContent || "",
    status: document.querySelector(".reviewStatusLine")?.textContent || "",
    active: document.querySelector(".reviewIdentity b")?.textContent?.trim() || "",
  };
});

const checks = {
  sameSize: afterReopen.queueSize === beforeClose.queueSize,
  sameOrder: JSON.stringify(afterReopen.queueSize ? beforeClose.symbols : []) === JSON.stringify(
    JSON.parse(await page.evaluate(() => JSON.stringify((JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}").rows || []).map((r) => r.symbol)))),
  ),
  focusMatch: afterReopen.selected === beforeClose.selectedSymbol,
  urlMatch: afterReopen.url.includes(beforeClose.selectedSymbol),
  identityPreserved: JSON.stringify(afterReopen.sessionIdentity) === JSON.stringify(beforeClose.sessionIdentity),
  zeroScansOnReopen: scansOnReopen.length === 0,
  resumed: afterReopen.status.includes("restaurada"),
};

const sameOrder = JSON.stringify(
  JSON.parse(await page.evaluate(() => JSON.stringify((JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}").rows || []).map((r) => r.symbol)))),
) === JSON.stringify(beforeClose.symbols);
checks.sameOrder = sameOrder;

const pass = Object.values({ ...checks, sameOrder }).every(Boolean);

// bad URL symbol test (expect stored focus fallback, not queue[0])
await page.goto(`${BASE}/review?source=current&symbol=NOTINQUEUE`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(800);
const badUrl = await page.evaluate(() => ({
  url: location.href,
  status: document.querySelector(".reviewStatusLine")?.textContent || "",
  selected: JSON.parse(localStorage.getItem("statsedge.review.v1") || "{}").selectedSymbol,
}));

await browser.close();

const result = {
  base: BASE,
  open1,
  beforeClose,
  afterReopen,
  checks: { ...checks, sameOrder },
  scansOnReopen: scansOnReopen.length,
  badUrl,
  pass,
};
console.log(JSON.stringify(result, null, 2));
process.exit(pass ? 0 : 1);
