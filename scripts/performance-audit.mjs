import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.PERF_BASE_URL || process.env.COHERENCE_BASE_URL || "http://127.0.0.1:3000";
const SYMBOL = process.env.PERF_SYMBOL || "TXN";
const OUT_DIR = path.join(process.cwd(), "output", "playwright");
const MAX_INTERACTIVE_MS = Number(process.env.PERF_MAX_INTERACTIVE_MS || 15000);

const ROUTES = [
  { name: "screener", path: "/" },
  { name: "lists", path: "/lists" },
  { name: "stock", path: `/stock/${encodeURIComponent(SYMBOL)}` },
];

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1100 },
  { name: "mobile", width: 390, height: 844 },
];

async function visibleOverflowCount(page) {
  return page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    function hasScrollableAncestor(element) {
      let current = element.parentElement;
      while (current && current !== document.body) {
        const style = window.getComputedStyle(current);
        const overflowX = style.overflowX || style.overflow;
        if ((overflowX === "auto" || overflowX === "scroll") && current.scrollWidth > current.clientWidth + 8) return true;
        current = current.parentElement;
      }
      return false;
    }
    return Array.from(document.querySelectorAll("body *")).filter((element) => {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") return false;
      if (hasScrollableAncestor(element)) return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > window.innerHeight) return false;
      return rect.left < -2 || rect.right > viewportWidth + 2;
    }).length;
  });
}

async function auditRoute(browser, viewport, route) {
  const page = await browser.newPage({ viewport });
  const startedAt = performance.now();
  await page.goto(`${BASE_URL}${route.path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  const interactiveMs = performance.now() - startedAt;
  await page.waitForTimeout(250);
  const textLength = await page.locator("body").innerText({ timeout: 5000 }).then((text) => text.trim().length);
  const overflow = await visibleOverflowCount(page);
  const screenshot = path.join(OUT_DIR, `perf-${viewport.name}-${route.name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await page.close();
  assert.ok(textLength > 120, `${viewport.name}/${route.name}: page looks blank`);
  assert.ok(overflow <= 20, `${viewport.name}/${route.name}: too many visible overflow elements (${overflow})`);
  assert.ok(interactiveMs <= MAX_INTERACTIVE_MS, `${viewport.name}/${route.name}: interactive took ${Math.round(interactiveMs)}ms`);
  return {
    viewport: viewport.name,
    route: route.name,
    path: route.path,
    interactiveMs: Math.round(interactiveMs),
    visibleOverflow: overflow,
    textLength,
    screenshot,
  };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const viewport of VIEWPORTS) {
      for (const route of ROUTES) {
        results.push(await auditRoute(browser, viewport, route));
      }
    }
  } finally {
    await browser.close();
  }
  console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, results }, null, 2));
}

main().catch((error) => {
  console.error(`FAIL performance-audit: ${error.message}`);
  process.exitCode = 1;
});
