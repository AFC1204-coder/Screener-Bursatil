/**
 * FILTER-CPU-1 — correlación browser: long tasks + filterMs en status + gesto→truth line.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const OUT_DIR = path.join(process.cwd(), "research", "filter-cpu-1");

function accessToken() {
  const source = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const line = source.split(/\r?\n/).find((item) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(item));
  if (!line) throw new Error("STATSEDGE_ACCESS_TOKEN missing");
  return line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

async function login(context) {
  const res = await context.request.post(`${BASE_URL}/api/auth/session`, {
    headers: { "Content-Type": "application/json" },
    data: { token: accessToken() },
  });
  if (!res.ok()) throw new Error(`Auth ${res.status()}`);
}

function installHooks(page) {
  return page.addInitScript(() => {
    window.__filterCpu = { longTasks: [], gestures: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__filterCpu.longTasks.push({ start: e.startTime, duration: e.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch { /* */ }
  });
}

async function resetHooks(page) {
  await page.evaluate(() => {
    window.__filterCpu = { longTasks: [], gestures: [] };
  });
}

async function readHooks(page) {
  return page.evaluate(() => {
    const p = window.__filterCpu || {};
    const tasks = p.longTasks || [];
    return {
      longTaskCount: tasks.length,
      longTaskTotalMs: Math.round(tasks.reduce((s, t) => s + t.duration, 0)),
      longTaskMaxMs: tasks.length ? Math.round(Math.max(...tasks.map((t) => t.duration))) : 0,
    };
  });
}

function parseFilterMs(statusText = "") {
  const m = statusText.match(/filtro aplicado en ([\d.,]+)s/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

async function waitTruthChange(page, prevText, timeout = 15000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const text = await page.locator(".screenerTruthLine").innerText().catch(() => "");
    if (text && text !== prevText) return { text, ms: performance.now() - t0 };
    await page.waitForTimeout(30);
  }
  return { text: await page.locator(".screenerTruthLine").innerText().catch(() => ""), ms: performance.now() - t0, timeout: true };
}

async function measure(page, label, action) {
  await resetHooks(page);
  const prevTruth = await page.locator(".screenerTruthLine").innerText().catch(() => "");
  const prevStatus = await page.locator(".screenerStatus, [class*='status']").first().innerText().catch(() => "");
  const t0 = performance.now();
  await action();
  const truth = await waitTruthChange(page, prevTruth);
  const gestureMs = Math.round(performance.now() - t0);
  const status = await page.locator(".screenerStatus, [class*='status']").first().innerText().catch(() => prevStatus);
  const hooks = await readHooks(page);
  const filterMs = parseFilterMs(status);
  const reactOverheadMs = filterMs != null ? Math.max(0, truth.ms - filterMs) : null;
  return {
    workflow: label,
    gestureToTruthMs: Math.round(truth.ms),
    totalGestureMs: gestureMs,
    filterMsFromStatus: filterMs,
    reactAndDeferMs: reactOverheadMs,
    ...hooks,
    truthSnippet: truth.text.slice(0, 100),
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await login(context);
  const page = await context.newPage();
  await installHooks(page);

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const usBtn = page.locator('.marketPresetBar button', { hasText: "EE. UU." });
  if (await usBtn.count()) await usBtn.click();
  await page.waitForFunction(
    () => /3580|3\s?580/.test(document.querySelector(".screenerTruthLine")?.textContent || ""),
    null,
    { timeout: 120000 },
  );

  const results = [];

  results.push(await measure(page, "Hunt Líderes Etapa 2 (frío)", () =>
    page.locator('.huntCardRail button', { hasText: "Líderes Etapa 2" }).click()));

  results.push(await measure(page, "Hunt Líderes Etapa 2 (repetición)", () =>
    page.locator('.huntCardRail button', { hasText: "Cerca de pivot" }).click().then(() =>
      page.locator('.huntCardRail button', { hasText: "Líderes Etapa 2" }).click())));

  results.push(await measure(page, "Hunt Cerca de pivot (frío)", () =>
    page.locator('.huntCardRail button', { hasText: "Cerca de pivot" }).click()));

  results.push(await measure(page, "Hunt Cerca de pivot (caché)", () =>
    page.locator('.huntCardRail button', { hasText: "Líderes Etapa 2" }).click().then(() =>
      page.locator('.huntCardRail button', { hasText: "Cerca de pivot" }).click())));

  results.push(await measure(page, "Toggle Momentum OFF", () =>
    page.locator('button[aria-label*="Momentum"]').first().click()));

  results.push(await measure(page, "Toggle Liquidez OFF", () =>
    page.locator('button[aria-label*="Liquidez"], button[aria-label*="Liquid"]').first().click()));

  const rsSlider = page.locator('.layerControlRow:has(strong:text("RS")) input[type="range"], .layerControlRow:has(.layerControlLabel:text("RS")) input[type="range"]').first();
  if (await rsSlider.count()) {
    results.push(await measure(page, "Intensidad RS", async () => {
      const box = await rsSlider.boundingBox();
      if (box) await page.mouse.click(box.x + box.width * 0.8, box.y + box.height / 2);
    }));
  }

  const auditBtn = page.locator('.huntTapeModeToggle button', { hasText: "Auditoría" });
  if (await auditBtn.count() && await auditBtn.getAttribute("aria-pressed") !== "true") {
    await auditBtn.click();
    await page.waitForSelector("table.compactResultsTable tbody tr", { timeout: 30000 }).catch(() => {});
  }

  const sortBtn = page.locator('button.columnHeadBtn').filter({ hasText: /^RS$/ }).first();
  if (await sortBtn.count()) {
    results.push(await measure(page, "Sort RS", () => sortBtn.click()));
  }

  const periodPicker = page.locator('.resultsTableControls select, .performancePeriodPicker select').first();
  if (await periodPicker.count()) {
    const opts = await periodPicker.locator("option").allTextContents();
    const alt = opts.find((o) => /6M/i.test(o));
    if (alt) {
      results.push(await measure(page, "Periodo 6M", () => periodPicker.selectOption({ label: alt })));
    }
  }

  await browser.close();
  const output = { meta: { baseUrl: BASE_URL, finishedAt: new Date().toISOString() }, results };
  writeFileSync(path.join(OUT_DIR, "browser-profile.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
