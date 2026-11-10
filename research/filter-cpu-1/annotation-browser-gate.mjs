/**
 * FILTER-ANNOTATION-1 — browser gate (investigate only).
 * Gestos: pivot frío, pivot repeat, momentum OFF→ON.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const OUT_DIR = path.join(process.cwd(), "research", "filter-cpu-1");
const OUT_FILE = path.join(OUT_DIR, "annotation-browser-gate.json");

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
    window.__annotationGate = { longTasks: [], mutations: 0, lastMutationAt: 0 };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__annotationGate.longTasks.push({ start: e.startTime, duration: e.duration });
        }
      }).observe({ type: "longtask", buffered: true });
    } catch { /* */ }
    try {
      new MutationObserver(() => {
        window.__annotationGate.mutations += 1;
        window.__annotationGate.lastMutationAt = performance.now();
      }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch { /* */ }
  });
}

async function resetHooks(page) {
  await page.evaluate(() => {
    window.__annotationGate = { longTasks: [], mutations: 0, lastMutationAt: performance.now() };
  });
}

async function readHooks(page) {
  return page.evaluate(() => {
    const p = window.__annotationGate || {};
    const tasks = p.longTasks || [];
    return {
      longTaskCount: tasks.length,
      longTaskTotalMs: Math.round(tasks.reduce((s, t) => s + t.duration, 0)),
      longTaskMaxMs: tasks.length ? Math.round(Math.max(...tasks.map((t) => t.duration))) : 0,
    };
  });
}

async function waitStable(page, { timeout = 15000, quietMs = 450 } = {}) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const { lastMutationAt } = await page.evaluate(() => ({
      lastMutationAt: window.__annotationGate?.lastMutationAt || 0,
    }));
    const since = performance.now() - lastMutationAt;
    const netIdle = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource");
      return entries.filter((e) => performance.now() - e.responseEnd < 300).length === 0;
    });
    if (since >= quietMs && netIdle) return Math.round(performance.now() - start);
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

async function waitStatusChange(page, prevStatus, timeout = 30000) {
  const t0 = performance.now();
  while (performance.now() - t0 < timeout) {
    const status = await page.locator(".screenerStatus").innerText().catch(() => "");
    if (status && status !== prevStatus) return { status, ms: Math.round(performance.now() - t0) };
    await page.waitForTimeout(30);
  }
  const status = await page.locator(".screenerStatus").innerText().catch(() => "");
  return { status, ms: Math.round(performance.now() - t0), timeout: true };
}

async function clickMomentumToggle(page) {
  const label = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button.layerPowerToggle")].find((b) => /Momentum/i.test(b.getAttribute("aria-label") || ""));
    if (!btn) return null;
    btn.click();
    return btn.getAttribute("aria-label");
  });
  if (!label) throw new Error("Momentum toggle not found in DOM");
  return label;
}

function parsePassCount(truth = "") {
  const m = truth.match(/(\d[\d\s.,]*)\s+de\s+(\d[\d\s.,]*)\s+pasan/i)
    || truth.match(/(\d[\d\s.,]*)\s*(de|\/)\s*(\d[\d\s.,]*)/i);
  if (!m) return { pass: null, total: null };
  const pass = Number(String(m[1]).replace(/[\s.,]/g, ""));
  const total = Number(String(m[3] || m[2]).replace(/[\s.,]/g, ""));
  return { pass: Number.isFinite(pass) ? pass : null, total: Number.isFinite(total) ? total : null };
}

function parseFilterMs(statusText = "") {
  const m = statusText.match(/filtro aplicado en ([\d.,]+)s/i);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 1000) : null;
}

async function captureViewState(page) {
  return page.evaluate(() => {
    const truth = document.querySelector(".screenerTruthLine")?.textContent?.trim() || "";
    const status = document.querySelector(".screenerStatus")?.textContent?.trim() || "";
    const brief = document.querySelector(".resultViewBrief")?.textContent?.trim().replace(/\s+/g, " ") || "";
    const quality = document.querySelector(".decisionQualityStrip")?.textContent?.trim().replace(/\s+/g, " ") || "";
    const rows = [...document.querySelectorAll(".compactResultsTable tbody tr")].map((tr) => {
      const symbol = tr.querySelector(".ticker")?.textContent?.trim() || "";
      const cells = [...tr.querySelectorAll("td")].map((td) => td.textContent?.trim().replace(/\s+/g, " ") || "");
      return { symbol, cells };
    });
    const diagnostics = [...document.querySelectorAll(".diagnosticBlock")].map((b) => b.textContent?.trim().replace(/\s+/g, " "));
    return { truth, status, brief, quality, rows, diagnostics };
  });
}

async function collectAllSymbols(page) {
  const symbols = [];
  const seen = new Set();
  for (let pageIdx = 0; pageIdx < 40; pageIdx += 1) {
    const batch = await page.$$eval(".compactResultsTable tbody .ticker", (links) => links.map((l) => l.textContent.trim()));
    for (const sym of batch) {
      if (!seen.has(sym)) {
        seen.add(sym);
        symbols.push(sym);
      }
    }
    const next = page.locator('.resultPager button:has-text("Siguiente"), .resultPager button[aria-label*="Siguiente"]').first();
    if (!(await next.count()) || await next.isDisabled().catch(() => true)) break;
    await next.click();
    await page.waitForTimeout(120);
  }
  return symbols;
}

async function ensureUsMarket(page) {
  const usBtn = page.locator('.marketPresetBar button', { hasText: "EE. UU." });
  if (await usBtn.count()) {
    await usBtn.click();
    await page.waitForTimeout(400);
  }
}

async function ensureAuditView(page) {
  const auditBtn = page.locator('.huntTapeModeToggle button', { hasText: "Auditoría" });
  if (await auditBtn.count()) {
    const pressed = await auditBtn.getAttribute("aria-pressed");
    if (pressed !== "true") {
      await auditBtn.click();
      await page.waitForSelector("table.compactResultsTable tbody tr", { timeout: 60000 }).catch(() => {});
    }
  }
}

async function measureGesture(page, label, action, truthPredicate, { allowSameTruth = false } = {}) {
  await resetHooks(page);
  const prevTruth = await page.locator(".screenerTruthLine").innerText().catch(() => "");
  const prevStatus = await page.locator(".screenerStatus").innerText().catch(() => "");
  const t0 = performance.now();
  await action();
  const truth = allowSameTruth
    ? await waitTruthChange(page, truthPredicate, 5000).then(async (r) => {
      if (!r.timeout) return r;
      const status = await waitStatusChange(page, prevStatus, 15000);
      const text = await page.locator(".screenerTruthLine").innerText().catch(() => prevTruth);
      return { text, ms: status.ms, viaStatus: true };
    })
    : await waitTruthChange(page, (text) => text !== prevTruth && truthPredicate(text), 30000);
  const feedbackMs = Math.round(performance.now() - t0);
  const stableMs = await waitStable(page);
  const hooks = await readHooks(page);
  const status = await page.locator(".screenerStatus").innerText().catch(() => "");
  const filterMs = parseFilterMs(status);
  const view = await captureViewState(page);
  const pass = parsePassCount(view.truth);
  const symbols = pass.pass != null && pass.pass <= 120
    ? await collectAllSymbols(page)
    : view.rows.map((r) => r.symbol).filter(Boolean);
  return {
    label,
    feedbackMs,
    truthMs: truth.ms,
    stableMs,
    longTaskMaxMs: hooks.longTaskMaxMs,
    longTaskTotalMs: hooks.longTaskTotalMs,
    longTaskCount: hooks.longTaskCount,
    filterMsFromStatus: filterMs,
    reactResidualMs: filterMs != null ? Math.max(0, stableMs - filterMs) : null,
    truth: view.truth,
    passCount: pass.pass,
    analyzedTotal: pass.total,
    symbols,
    brief: view.brief,
    quality: view.quality,
    diagnostics: view.diagnostics,
    rowSample: view.rows.slice(0, 5),
    statusSnippet: status.slice(0, 180),
  };
}

function compareStates(a, b, label) {
  const issues = [];
  if (a.passCount !== b.passCount) issues.push(`passCount ${a.passCount} !== ${b.passCount}`);
  if (JSON.stringify(a.symbols) !== JSON.stringify(b.symbols)) issues.push("symbol order/members differ");
  if (a.brief !== b.brief) issues.push("resultViewBrief differs");
  if (a.quality !== b.quality) issues.push("decisionQualityStrip differs");
  for (let i = 0; i < Math.min(a.rowSample.length, b.rowSample.length); i += 1) {
    if (JSON.stringify(a.rowSample[i]) !== JSON.stringify(b.rowSample[i])) {
      issues.push(`rowSample[${i}] differs (${a.rowSample[i]?.symbol})`);
      break;
    }
  }
  return { label, ok: issues.length === 0, issues };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await login(context);
  const page = await context.newPage();
  await installHooks(page);

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 180000 });
  await ensureUsMarket(page);
  const loaded = await waitTruthChange(
    page,
    (t) => /3576|3\s?576|3580|3\s?580/.test(t) && /\d+ de \d+/.test(t),
    180000,
  );
  await ensureAuditView(page);
  await waitStable(page, { quietMs: 600 });

  const leadersPrePivot = await captureViewState(page);
  const leadersPrePivotSymbols = await collectAllSymbols(page).catch(() => leadersPrePivot.rows.map((r) => r.symbol));

  const pivotCold = await measureGesture(
    page,
    "1. Cerca de pivot (frío)",
    () => page.locator('.huntCardRail button', { hasText: "Cerca de pivot" }).click(),
    (t) => /pivot|Cerca|\d+ de \d+/i.test(t),
  );

  const pivotRepeat = await measureGesture(
    page,
    "2. Cerca de pivot (inmediato otra vez)",
    () => page.locator('.huntCardRail button', { hasText: "Cerca de pivot" }).click(),
    (t) => /pivot|Cerca|\d+ de \d+/i.test(t),
    { allowSameTruth: true },
  );

  const leadersReturn = await measureGesture(
    page,
    "return Líderes Etapa 2 (pre-momentum)",
    () => page.locator('.huntCardRail button', { hasText: "Líderes Etapa 2" }).click(),
    (t) => /Etapa|Líderes|\d+ de \d+/i.test(t),
  );

  const momentumOff = await measureGesture(
    page,
    "3a. Momentum OFF (desde Líderes)",
    () => clickMomentumToggle(page),
    (t) => /\d+ de \d+/i.test(t),
  );

  const momentumOn = await measureGesture(
    page,
    "3b. Momentum ON (vuelta)",
    () => clickMomentumToggle(page),
    (t) => /\d+ de \d+/i.test(t),
  );

  const leadersBaseline = {
    label: "baseline Líderes (mesa cargada)",
    passCount: parsePassCount(leadersPrePivot.truth).pass,
    symbols: leadersPrePivotSymbols,
    brief: leadersPrePivot.brief,
    quality: leadersPrePivot.quality,
    rowSample: leadersPrePivot.rows.slice(0, 5).map((row) => ({ symbol: row.symbol || row.cells?.[0], cells: row.cells })),
  };

  const correctness = [
    compareStates(pivotCold, pivotRepeat, "pivot cold vs pivot repeat"),
    compareStates(leadersReturn, momentumOn, "leaders return vs momentum ON round-trip"),
    {
      label: "momentum OFF increased pass set vs Líderes",
      ok: (momentumOff.passCount ?? 0) > (leadersReturn.passCount ?? 0),
      issues: (momentumOff.passCount ?? 0) > (leadersReturn.passCount ?? 0)
        ? []
        : [`passCount ${momentumOff.passCount} not > ${leadersReturn.passCount}`],
    },
  ];

  const output = {
    meta: {
      baseUrl: BASE_URL,
      buildHead: "639ceae",
      datasetTruth: loaded.text,
      finishedAt: new Date().toISOString(),
      baselinePerfReal: {
        pivotColdFeedbackMs: 473,
        pivotCacheHitFeedbackMs: 315,
        pivotCacheHitLongTaskMaxMs: 0,
        momentumToggleFeedbackMs: 1076,
        momentumToggleLongTaskMaxMs: 244,
      },
    },
    gestures: [leadersBaseline, pivotCold, pivotRepeat, leadersReturn, momentumOff, momentumOn],
    correctness,
    deltas: {
      pivotRepeatVsCold: {
        feedbackMs: pivotRepeat.feedbackMs - pivotCold.feedbackMs,
        stableMs: pivotRepeat.stableMs - pivotCold.stableMs,
        longTaskMaxMs: pivotRepeat.longTaskMaxMs - pivotCold.longTaskMaxMs,
        filterMs: (pivotRepeat.filterMsFromStatus ?? 0) - (pivotCold.filterMsFromStatus ?? 0),
      },
      momentumOnVsOff: {
        feedbackMs: momentumOn.feedbackMs - momentumOff.feedbackMs,
        stableMs: momentumOn.stableMs - momentumOff.stableMs,
        longTaskMaxMs: momentumOn.longTaskMaxMs - momentumOff.longTaskMaxMs,
        passCountDelta: (momentumOn.passCount ?? 0) - (momentumOff.passCount ?? 0),
      },
      momentumRoundTripPassMatch: (momentumOn.passCount === leadersReturn.passCount),
    },
    annotationObservation: {
      note: "No hook en window; proxy = filterMs status + timing repeat vs cold",
      pivotColdFilterMs: pivotCold.filterMsFromStatus,
      pivotRepeatFilterMs: pivotRepeat.filterMsFromStatus,
      pivotRepeatLikelyHuntCacheHit: (pivotRepeat.filterMsFromStatus ?? 999) <= 50,
    },
  };

  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  await page.screenshot({ path: path.join(OUT_DIR, "annotation-browser-gate.png"), fullPage: false }).catch(() => {});
  await browser.close();
  console.log(JSON.stringify(output, null, 2));
  return output;
}

main().catch((err) => {
  console.error("annotation-browser-gate failed:", err?.message || err);
  process.exitCode = 1;
});
