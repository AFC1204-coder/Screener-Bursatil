/**
 * REACT-COMMIT-PERF-1 — longtask + filterMs + User Timing (view audit) en gestos US.
 * Requisitos: :3300 + túnel :15432 UP, dataset US ~3.5k filas.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const OUT_DIR = path.join(process.cwd(), "research", "react-commit-perf-1");
const REPS = Number(process.env.PERF_REPS || 3);

function accessToken() {
  const source = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const line = source.split(/\r?\n/).find((item) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(item));
  if (!line) throw new Error("STATSEDGE_ACCESS_TOKEN missing in .env.local");
  return line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

async function login(context) {
  const res = await context.request.post(`${BASE_URL}/api/auth/session`, {
    headers: { "Content-Type": "application/json" },
    data: { token: accessToken() },
  });
  if (!res.ok()) throw new Error(`Auth failed: ${res.status()}`);
}

function installHooks(page) {
  return page.addInitScript(() => {
    window.__reactCommitPerf = { longTasks: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__reactCommitPerf.longTasks.push({ start: e.startTime, duration: e.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch { /* */ }
  });
}

async function resetHooks(page) {
  await page.evaluate(() => {
    window.__reactCommitPerf = { longTasks: [] };
    try {
      performance.clearMeasures("screener:viewAudit");
      performance.clearMarks("screener:viewAudit:start");
      performance.clearMarks("screener:viewAudit:end");
    } catch { /* */ }
  });
}

function parseFilterMs(text = "") {
  const m = text.match(/filtro aplicado en ([\d.,]+)s/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

async function readPerf(page) {
  return page.evaluate(() => {
    const tasks = window.__reactCommitPerf?.longTasks || [];
    const auditMeasure = performance.getEntriesByName("screener:viewAudit", "measure").slice(-1)[0];
    return {
      longTaskCount: tasks.length,
      longTaskTotalMs: Math.round(tasks.reduce((s, t) => s + t.duration, 0)),
      longTaskMaxMs: tasks.length ? Math.round(Math.max(...tasks.map((t) => t.duration))) : 0,
      viewAuditMs: auditMeasure ? Math.round(auditMeasure.duration) : null,
    };
  });
}

async function waitStable(page, { timeout = 12000, quietMs = 400 } = {}) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const netIdle = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource");
      return entries.filter((e) => performance.now() - e.responseEnd < 250).length === 0;
    });
    if (netIdle) {
      await page.waitForTimeout(quietMs);
      return Math.round(performance.now() - start);
    }
    await page.waitForTimeout(40);
  }
  return Math.round(performance.now() - start);
}

async function waitTruthChange(page, predicate, timeout = 30000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const text = await page.locator(".screenerTruthLine").innerText().catch(() => "");
    if (predicate(text)) return { text, ms: Math.round(performance.now() - t0) };
    await page.waitForTimeout(30);
  }
  const text = await page.locator(".screenerTruthLine").innerText().catch(() => "");
  return { text, ms: Math.round(performance.now() - t0), timeout: true };
}

async function readStatusText(page) {
  return page.evaluate(() => {
    const bar = document.querySelector(".scanStatusBar b, .scanStatusBar");
    const truth = document.querySelector(".screenerTruthLine");
    return [bar?.textContent, truth?.textContent, document.body?.innerText?.slice(0, 4000)]
      .filter(Boolean)
      .join("\n");
  });
}

async function measureGesture(page, label, action, { waitPredicate, settleMs = 120 } = {}) {
  await resetHooks(page);
  const prevTruth = await page.locator(".screenerTruthLine").innerText().catch(() => "");
  const t0 = performance.now();
  await action();
  const truth = waitPredicate
    ? await waitTruthChange(page, waitPredicate)
    : await waitTruthChange(page, (t) => t && t !== prevTruth);
  await page.waitForTimeout(settleMs);
  const perf = await readPerf(page);
  const status = await readStatusText(page);
  const filterMs = parseFilterMs(status);
  const reactCommitProxyMs = filterMs != null ? Math.max(0, truth.ms - filterMs) : null;
  const stableMs = await waitStable(page, { quietMs: 300 });
  return {
    workflow: label,
    gestureMs: Math.round(performance.now() - t0),
    truthMs: truth.ms,
    stableMs,
    filterMs,
    reactCommitProxyMs,
    ...perf,
    truthSnippet: truth.text.slice(0, 100),
    statusSnippet: status.slice(0, 120),
  };
}

function median(nums) {
  const list = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const mid = Math.floor(list.length / 2);
  return list.length % 2 ? list[mid] : Math.round((list[mid - 1] + list[mid]) / 2);
}

function summarizeRuns(runs) {
  return {
    n: runs.length,
    longTaskMaxMs: median(runs.map((r) => r.longTaskMaxMs)),
    truthMs: median(runs.map((r) => r.truthMs)),
    filterMs: median(runs.map((r) => r.filterMs)),
    reactCommitProxyMs: median(runs.map((r) => r.reactCommitProxyMs)),
    viewAuditMs: median(runs.map((r) => r.viewAuditMs)),
    runs,
  };
}

async function loadUsMesa(page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("statsedge.screenerSession.v1");
      localStorage.removeItem("statsedge.scans.v1");
    } catch { /* */ }
  });
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const usBtn = page.locator('.marketPresetBar button', { hasText: "EE. UU." });
  if (await usBtn.count()) await usBtn.click();
  await page.waitForFunction(
    () => {
      const truth = document.querySelector(".screenerTruthLine")?.textContent || "";
      const rows = document.querySelectorAll("table.compactResultsTable tbody tr, .huntTapeRow, .huntTapeItem").length;
      return /35\d{2}|3576|3580/.test(truth) && rows >= 10;
    },
    null,
    { timeout: 180000 },
  );
  await waitStable(page, { quietMs: 800 });
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await login(context);
  const page = await context.newPage();
  await installHooks(page);

  await loadUsMesa(page);

  const workflows = [];

  // Hunt switch (truth line rápida + long tasks del commit)
  {
    const runs = [];
    for (let i = 0; i < REPS; i += 1) {
      if (i > 0) {
        await page.locator('.huntCardRail button', { hasText: "Cerca de pivot" }).click();
        await waitStable(page);
      }
      runs.push(await measureGesture(
        page,
        "Hunt → Líderes Etapa 2",
        () => page.locator('.huntCardRail button', { hasText: "Líderes Etapa 2" }).click(),
        { waitPredicate: (t) => /Líderes|Etapa|\d+ de \d+/i.test(t) },
      ));
    }
    workflows.push(summarizeRuns(runs));
  }

  // Toggle Momentum (status con filterMs — FILTER-CPU-1)
  {
    const runs = [];
    for (let i = 0; i < REPS; i += 1) {
      runs.push(await measureGesture(
        page,
        "Toggle Momentum",
        () => page.locator('button[aria-label*="Momentum"]').first().click(),
        { waitPredicate: (t) => /\d+ de \d+/i.test(t), settleMs: 200 },
      ));
    }
    workflows.push(summarizeRuns(runs));
  }

  // Sort RS (tabla auditoría)
  const auditBtn = page.locator('.huntTapeModeToggle button', { hasText: "Auditoría" });
  if (await auditBtn.count() && await auditBtn.getAttribute("aria-pressed") !== "true") {
    await auditBtn.click();
    await page.waitForSelector("table.compactResultsTable tbody tr", { timeout: 30000 }).catch(() => {});
  }
  const sortBtn = page.locator('button.columnHeadBtn').filter({ hasText: /^RS$/ }).first();
  if (await sortBtn.count()) {
    const runs = [];
    for (let i = 0; i < REPS; i += 1) {
      runs.push(await measureGesture(
        page,
        "Sort columna RS",
        () => sortBtn.click(),
        { waitPredicate: () => true },
      ));
      await page.waitForTimeout(200);
    }
    workflows.push(summarizeRuns(runs));
  }

  await browser.close();

  const output = {
    meta: {
      baseUrl: BASE_URL,
      reps: REPS,
      finishedAt: new Date().toISOString(),
      phase: process.env.PERF_PHASE || "baseline",
    },
    workflows,
  };
  const outFile = path.join(OUT_DIR, `${process.env.PERF_PHASE || "baseline"}.json`);
  writeFileSync(outFile, JSON.stringify(output, null, 2));
  writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error("PROBE FAILED:", err?.message || err);
  process.exitCode = 1;
});
