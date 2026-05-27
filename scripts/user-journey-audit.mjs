import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.USER_AUDIT_BASE_URL || "http://127.0.0.1:3000";
const OUT_DIR = path.join(process.cwd(), "output", "playwright");
const INTERNAL_TERMS = /\b(Yahoo|FMP|SEC|X API v2|recent search)\b/i;
const BROKEN_TEXT = /\b(undefined|NaN|null)\b/i;

function attachCollectors(page, label) {
  const events = {
    label,
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    serverErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") events.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => events.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.includes(".hot-update.")) return;
    if (url.includes("_rsc=") || url.includes("/__nextjs_font/")) return;
    if (url.startsWith(BASE_URL)) events.failedRequests.push(`${request.method()} ${url}: ${request.failure()?.errorText || "failed"}`);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.startsWith(BASE_URL) && response.status() >= 500) events.serverErrors.push(`${response.status()} ${url}`);
  });
  return events;
}

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

async function bottomNavOverlapCount(page) {
  return page.evaluate(() => {
    const nav = document.querySelector(".bottomNav");
    if (!nav) return 0;
    const navRect = nav.getBoundingClientRect();
    if (!navRect.width || !navRect.height) return 0;
    const selectors = [
      ".mobileResultRow",
      ".compactResultsTable tbody tr",
      ".btn",
      "button",
      "a",
      "select",
      "input",
    ].join(",");
    return Array.from(document.querySelectorAll(selectors)).filter((element) => {
      if (element === nav || nav.contains(element)) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
      const xOverlap = Math.max(0, Math.min(rect.right, navRect.right) - Math.max(rect.left, navRect.left));
      const yOverlap = Math.max(0, Math.min(rect.bottom, navRect.bottom) - Math.max(rect.top, navRect.top));
      return xOverlap * yOverlap > 80;
    }).length;
  });
}

async function waitForChartPixels(page, label) {
  await page.waitForSelector(".universalChartCanvas canvas", { timeout: 20_000 });
  await page.waitForFunction(() => {
    const canvases = Array.from(document.querySelectorAll(".universalChartCanvas canvas"));
    return canvases.some((canvas) => {
      const context = canvas.getContext("2d");
      if (!context || canvas.width < 200 || canvas.height < 120) return false;
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let signal = 0;
      const step = 16;
      for (let index = 0; index < data.length; index += 4 * step) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const alpha = data[index + 3];
        if (alpha > 12 && (red + green + blue > 110)) signal += 1;
        if (signal > 120) return true;
      }
      return false;
    });
  }, null, { timeout: 20_000 }).catch(async () => {
    const chartText = await page.locator(".universalChart").innerText({ timeout: 5_000 }).catch(() => "");
    throw new Error(`${label}: chart canvas did not render visible price/RS pixels. Visible chart text: ${chartText.slice(0, 300)}`);
  });
}

async function bodyText(page) {
  return (await page.locator("body").innerText({ timeout: 10_000 })).replace(/\s+/g, " ").trim();
}

async function assertCleanVisibleText(page, label, { allowInternalTerms = false } = {}) {
  const text = await bodyText(page);
  assert.ok(text.length > 200, `${label}: page looks blank`);
  assert.doesNotMatch(text, BROKEN_TEXT, `${label}: visible text contains broken placeholder`);
  if (!allowInternalTerms) assert.doesNotMatch(text, INTERNAL_TERMS, `${label}: visible text exposes provider/internal terms`);
  return text;
}

async function topKpis(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll(".kpis .kpi")).slice(0, 3).map((node) => ({
    value: Number((node.querySelector("b")?.textContent || "").replace(/[^\d.-]/g, "")),
    label: (node.querySelector("span")?.textContent || "").trim().toLowerCase(),
  })));
}

async function resultSymbols(page, limit = 8) {
  return page.$$eval(".compactResultsTable tbody .ticker", (links, max) => links.slice(0, max).map((link) => link.textContent.trim()), limit);
}

async function waitForScreenerResults(page, label = "screener") {
  try {
    await page.waitForFunction(() => document.querySelectorAll(".compactResultsTable tbody .ticker").length > 0, null, { timeout: 25_000 });
    return resultSymbols(page);
  } catch (error) {
    const text = await bodyText(page).catch(() => "");
    throw new Error(`${label}: screener results did not render within 25s. Visible text: ${text.slice(0, 500)}`);
  }
}

async function screenshot(page, name) {
  const file = path.join(OUT_DIR, `journey-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return file;
}

async function desktopJourney(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  if (process.env.USER_AUDIT_SYNC_CLOUD !== "1") {
    await context.route(`${BASE_URL}/api/favorites`, async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ configured: true, ok: true, saved: 1, favorites: [] }),
        });
        return;
      }
      await route.continue();
    });
  }
  const page = await context.newPage();
  const events = attachCollectors(page, "desktop");
  const result = { viewport: "desktop" };
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const firstSymbols = await waitForScreenerResults(page, "desktop initial");
    await assertCleanVisibleText(page, "desktop screener", { allowInternalTerms: true });
    const kpis = await topKpis(page);
    assert.ok(kpis[0]?.value > 0, `desktop screener: universe KPI should be non-zero when rows are visible: ${JSON.stringify(kpis)}`);
    assert.ok(kpis[1]?.value > 0, `desktop screener: pass KPI should be non-zero when rows are visible: ${JSON.stringify(kpis)}`);
    assert.equal(await visibleOverflowCount(page), 0, "desktop screener: visible overflow");
    result.screener = {
      firstSymbols,
      kpis,
      screenshot: await screenshot(page, "desktop-screener"),
    };

    await page.locator('select[aria-label="Filtrar por pais"]').selectOption("US");
    await page.waitForTimeout(250);
    const usSymbols = await resultSymbols(page, 50);
    assert.ok(usSymbols.length > 0, "desktop screener: country filter US should leave visible candidates");
    await page.locator('select[aria-label="Filtrar por pais"]').selectOption("Todos");
    await page.waitForTimeout(250);
    const restoredSymbols = await resultSymbols(page);
    assert.deepEqual(restoredSymbols.slice(0, 5), firstSymbols.slice(0, 5), "desktop screener: resetting view filter should restore result order");

    await page.evaluate(() => window.scrollTo(0, 720));
    const openedSymbol = firstSymbols[0];
    await page.locator(".compactResultsTable tbody .ticker").first().click();
    await page.waitForURL(/\/stock\//, { timeout: 20_000 });
    const expectedReturnScrollY = await page.evaluate(() => {
      const session = JSON.parse(localStorage.getItem("statsedge.screenerSession.v1") || "{}");
      return Number.isFinite(Number(session.scrollY)) ? Number(session.scrollY) : 0;
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    const stockText = await assertCleanVisibleText(page, "desktop stock");
    assert.ok(stockText.includes(openedSymbol), `desktop stock: opened symbol ${openedSymbol} should be visible`);
    assert.match(stockText, /\bRS\b/i, "desktop stock: RS should be visible");
    assert.match(stockText, /Negocio|Etapa|Ventas/i, "desktop stock: core ficha sections should be visible");
    assert.equal(await visibleOverflowCount(page), 0, "desktop stock: visible overflow");
    await waitForChartPixels(page, "desktop stock");
    result.stock = {
      symbol: openedSymbol,
      screenshot: await screenshot(page, "desktop-stock"),
    };

    await page.goBack({ waitUntil: "domcontentloaded" });
    await waitForScreenerResults(page, "desktop return");
    const afterBack = await resultSymbols(page);
    assert.deepEqual(afterBack.slice(0, 5), firstSymbols.slice(0, 5), "desktop return: result order should not change after opening ficha and going back");
    const scrollY = await page.evaluate(() => window.scrollY);
    assert.ok(expectedReturnScrollY <= 0 || Math.abs(scrollY - expectedReturnScrollY) <= 80, `desktop return: scroll context should be preserved, got ${scrollY}, expected around ${expectedReturnScrollY}`);

    await page.locator(".compactResultsTable tbody tr button[aria-label^='Guardar favorito']").first().click();
    await page.waitForFunction((symbol) => {
      const favs = JSON.parse(localStorage.getItem("statsedge.favorites.v1") || "[]");
      return favs.some((favorite) => favorite.symbol === symbol);
    }, openedSymbol, { timeout: 10_000 });
    await page.goto(`${BASE_URL}/lists`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".listsPage", { timeout: 15_000 });
    await page.waitForFunction((symbol) => document.body.innerText.includes(symbol), openedSymbol, { timeout: 8_000 });
    await assertCleanVisibleText(page, "desktop lists", { allowInternalTerms: true });
    const listsText = await bodyText(page);
    const listsDebug = await page.evaluate((symbol) => {
      const favorites = JSON.parse(localStorage.getItem("statsedge.favorites.v1") || "[]");
      return {
        favoriteSymbols: favorites.map((favorite) => favorite.symbol),
        bodyIncludesSymbol: document.body.innerText.includes(symbol),
        bodyHead: document.body.innerText.slice(0, 700),
      };
    }, openedSymbol);
    assert.ok(listsText.includes(openedSymbol), `desktop lists: favorite ${openedSymbol} should appear in lists. Debug: ${JSON.stringify(listsDebug)}`);
    assert.equal(await visibleOverflowCount(page), 0, "desktop lists: visible overflow");
    result.lists = {
      favorite: openedSymbol,
      screenshot: await screenshot(page, "desktop-lists"),
    };

    await page.goto(`${BASE_URL}/market-health`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("main", { timeout: 15_000 });
    const marketText = await assertCleanVisibleText(page, "desktop market health");
    assert.match(marketText, /Mercado|Riesgo|Sector|Salud/i, "desktop market health: expected market terms");
    assert.equal(await visibleOverflowCount(page), 0, "desktop market health: visible overflow");
    result.marketHealth = {
      screenshot: await screenshot(page, "desktop-market-health"),
    };

    assert.deepEqual(events.pageErrors, [], "desktop: page errors");
    assert.deepEqual(events.failedRequests, [], "desktop: failed same-origin requests");
    assert.deepEqual(events.serverErrors, [], "desktop: server errors");
    return result;
  } finally {
    await context.close();
  }
}

async function mobileJourney(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const page = await context.newPage();
  const events = attachCollectors(page, "mobile");
  try {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await waitForScreenerResults(page, "mobile initial");
    const text = await assertCleanVisibleText(page, "mobile screener", { allowInternalTerms: true });
    assert.match(text, /Screener|Filtros|Ejecutar/i, "mobile screener: expected primary controls");
    assert.equal(await visibleOverflowCount(page), 0, "mobile screener: visible overflow");
    assert.equal(await bottomNavOverlapCount(page), 0, "mobile screener: bottom navigation overlaps actionable content");
    const screenshotFile = await screenshot(page, "mobile-screener");
    assert.deepEqual(events.pageErrors, [], "mobile: page errors");
    assert.deepEqual(events.failedRequests, [], "mobile: failed same-origin requests");
    assert.deepEqual(events.serverErrors, [], "mobile: server errors");
    return { viewport: "mobile", screenshot: screenshotFile };
  } finally {
    await context.close();
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const desktop = await desktopJourney(browser);
    const mobile = await mobileJourney(browser);
    console.log(JSON.stringify({ ok: true, baseUrl: BASE_URL, desktop, mobile }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`FAIL user-journey-audit: ${error.message}`);
  process.exitCode = 1;
});
