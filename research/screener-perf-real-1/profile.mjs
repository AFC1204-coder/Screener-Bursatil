/**
 * SCREENER-PERF-REAL-1 — profiling harness (investigate only, no product changes).
 * Measures screener interactions with ~3580 real US rows via :3300 + tunnel :15432.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const BASE_URL = process.env.PERF_BASE_URL || "http://127.0.0.1:3300";
const OUT_DIR = path.join(process.cwd(), "research", "screener-perf-real-1");
const VIEWPORT = { width: 1440, height: 1100 };

function accessToken() {
  const source = readFileSync(new URL("../../.env.local", import.meta.url), "utf8");
  const line = source.split(/\r?\n/).find((item) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(item));
  if (!line) throw new Error("STATSEDGE_ACCESS_TOKEN missing in .env.local");
  return line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
}

async function login(context) {
  const response = await context.request.post(`${BASE_URL}/api/auth/session`, {
    headers: { "Content-Type": "application/json" },
    data: { token: accessToken() },
  });
  if (!response.ok()) throw new Error(`Auth failed: ${response.status()} ${await response.text()}`);
}

function installPerfHooks(page) {
  return page.addInitScript(() => {
    window.__perf = {
      longTasks: [],
      marks: [],
      resources: [],
      mutations: 0,
      lastMutationAt: 0,
    };
    try {
      const lt = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          window.__perf.longTasks.push({ start: e.startTime, duration: e.duration });
        }
      });
      lt.observe({ type: "longtask", buffered: true });
    } catch { /* unsupported */ }
    try {
      const mo = new MutationObserver(() => {
        window.__perf.mutations += 1;
        window.__perf.lastMutationAt = performance.now();
      });
      mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
    } catch { /* unsupported */ }
  });
}

function createNetworkTracker(page) {
  const requests = [];
  const onReq = (req) => {
    if (!req.url().includes("/api/")) return;
    requests.push({ url: req.url(), method: req.method(), start: performance.now(), end: null, status: null, size: 0 });
  };
  const onRes = async (res) => {
    const url = res.url();
    const entry = [...requests].reverse().find((r) => !r.end && r.url === url);
    if (!entry) return;
    entry.end = performance.now();
    entry.status = res.status();
    try {
      const body = await res.body();
      entry.size = body?.length || 0;
    } catch { /* aborted */ }
  };
  page.on("request", onReq);
  page.on("response", onRes);
  return {
    snapshot(since = 0) {
      return requests.filter((r) => r.start >= since).map((r) => ({
        url: r.url.replace(BASE_URL, ""),
        method: r.method,
        ms: r.end ? Math.round(r.end - r.start) : null,
        status: r.status,
        kb: r.size ? Math.round(r.size / 1024) : 0,
      }));
    },
    reset() { requests.length = 0; },
  };
}

async function readPerf(page) {
  return page.evaluate(() => {
    const p = window.__perf || {};
    const tasks = (p.longTasks || []).slice();
    const totalLt = tasks.reduce((s, t) => s + t.duration, 0);
    const maxLt = tasks.length ? Math.max(...tasks.map((t) => t.duration)) : 0;
    return {
      longTasks: tasks.length,
      longTaskTotalMs: Math.round(totalLt),
      longTaskMaxMs: Math.round(maxLt),
      mutations: p.mutations || 0,
      lastMutationAt: p.lastMutationAt || 0,
    };
  });
}

async function resetPerf(page) {
  await page.evaluate(() => {
    if (!window.__perf) window.__perf = {};
    window.__perf.longTasks = [];
    window.__perf.mutations = 0;
    window.__perf.lastMutationAt = performance.now();
  });
}

async function waitStable(page, { timeout = 12000, quietMs = 400 } = {}) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const { lastMutationAt } = await readPerf(page);
    const since = performance.now() - lastMutationAt;
    const netIdle = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource");
      const recent = entries.filter((e) => performance.now() - e.responseEnd < 300);
      return recent.length === 0;
    });
    if (since >= quietMs && netIdle) return performance.now() - start;
    await page.waitForTimeout(50);
  }
  return performance.now() - start;
}

async function waitTruthLine(page, predicate, timeout = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const text = await page.locator(".screenerTruthLine").innerText().catch(() => "");
    if (predicate(text)) return { text, ms: performance.now() - start };
    await page.waitForTimeout(30);
  }
  const text = await page.locator(".screenerTruthLine").innerText().catch(() => "");
  return { text, ms: performance.now() - start, timeout: true };
}

async function waitForUsefulRender(page, timeout = 120000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const state = await page.evaluate(() => ({
      auditRows: document.querySelectorAll("table.compactResultsTable tbody tr").length,
      tapeItems: document.querySelectorAll(".huntTapeRow, .huntTapeItem").length,
      queue: document.querySelector(".resultViewChrome")?.textContent || "",
    }));
    if (state.auditRows >= 20 || state.tapeItems >= 20 || /en cola/.test(state.queue)) {
      return { ...state, ms: performance.now() - start };
    }
    await page.waitForTimeout(200);
  }
  const state = await page.evaluate(() => ({
    auditRows: document.querySelectorAll("table.compactResultsTable tbody tr").length,
    tapeItems: document.querySelectorAll(".huntTapeRow, .huntTapeItem").length,
    queue: document.querySelector(".resultViewChrome")?.textContent || "",
  }));
  return { ...state, ms: performance.now() - start, timeout: true };
}

async function ensureUsMarket(page) {
  const usBtn = page.locator('.marketPresetBar button', { hasText: "EE. UU." });
  if (await usBtn.count()) {
    await usBtn.click();
    await page.waitForTimeout(500);
  }
}

async function ensureAuditView(page) {
  const auditBtn = page.locator('.huntTapeModeToggle button', { hasText: "Auditoría" });
  if (await auditBtn.count()) {
    const pressed = await auditBtn.getAttribute("aria-pressed");
    if (pressed !== "true") {
      await auditBtn.click();
      await page.waitForSelector("table.compactResultsTable tbody tr", { timeout: 30000 }).catch(() => {});
    }
  }
}

async function measureInteraction(page, net, label, action, feedbackCheck, { stableQuietMs = 500 } = {}) {
  await resetPerf(page);
  net.reset();
  const t0 = performance.now();
  await action();
  let feedbackMs = null;
  let feedbackDetail = "";
  if (feedbackCheck) {
    const fb = await feedbackCheck(t0);
    feedbackMs = Math.round(fb.ms);
    feedbackDetail = fb.detail || "";
  } else {
    feedbackMs = Math.round(performance.now() - t0);
  }
  const stableMs = Math.round(await waitStable(page, { quietMs: stableQuietMs }));
  const perf = await readPerf(page);
  const reqs = net.snapshot(t0);
  return {
    workflow: label,
    feedbackMs,
    stableMs,
    feedbackDetail,
    longTasks: perf.longTasks,
    longTaskTotalMs: perf.longTaskTotalMs,
    longTaskMaxMs: perf.longTaskMaxMs,
    mutations: perf.mutations,
    requests: reqs,
    blocking: perf.longTaskMaxMs > 100,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  await login(context);
  const page = await context.newPage();
  await installPerfHooks(page);
  const net = createNetworkTracker(page);

  const results = [];
  const meta = { baseUrl: BASE_URL, startedAt: new Date().toISOString() };

  // 1. Restauración/carga mesa US (sesión limpia de localStorage para medir restore API)
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("statsedge.screenerSession.v1");
      localStorage.removeItem("statsedge.scans.v1");
    } catch { /* ignore */ }
  });

  const loadT0 = performance.now();
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const firstPaintMs = Math.round(performance.now() - loadT0);
  await ensureUsMarket(page);
  const truthLoaded = await waitTruthLine(page, (t) => /3580|3\s?580/.test(t) && /\d+ de \d+/.test(t) && !/0\/0/i.test(t), 120000);
  const rowsReady = await waitForUsefulRender(page, 120000);
  const loadStableMs = Math.round(await waitStable(page, { quietMs: 600 }));
  const loadPerf = await readPerf(page);
  const loadReqs = net.snapshot(0);
  const truthText = truthLoaded.text;
  const analyzedMatch = truthText.match(/(\d[\d\s.,]*)\s*(de|\/)\s*(\d[\d\s.,]*)/);
  results.push({
    workflow: "1. Restauración/carga mesa US",
    feedbackMs: truthLoaded.ms,
    stableMs: loadStableMs,
    feedbackDetail: `truth: ${truthText.slice(0, 120)}`,
    firstPaintMs,
    rowsVisible: rowsReady.auditRows || rowsReady.tapeItems,
    viewMode: rowsReady.queue,
    longTasks: loadPerf.longTasks,
    longTaskTotalMs: loadPerf.longTaskTotalMs,
    longTaskMaxMs: loadPerf.longTaskMaxMs,
    mutations: loadPerf.mutations,
    requests: loadReqs,
    analyzedEstimate: analyzedMatch ? analyzedMatch[0] : null,
    dominantCost: classifyLoad(loadReqs, loadPerf),
    confidence: (rowsReady.auditRows || rowsReady.tapeItems) >= 20 ? "HIGH" : "MEDIUM",
  });

  // Switch to Auditoría for sort/table workflows
  await ensureAuditView(page);

  // 2. Primer render útil (cinta Caza o tabla Auditoría)
  const tickerCount = await page.locator("table a.ticker, .huntTapeRow a.ticker, .huntTapeItem a.ticker").count();
  results.push({
    workflow: "2. Primer render útil (mesa visible)",
    feedbackMs: rowsReady.ms,
    stableMs: loadStableMs,
    feedbackDetail: `${tickerCount} tickers, audit=${rowsReady.auditRows} tape=${rowsReady.tapeItems}`,
    longTasks: loadPerf.longTasks,
    longTaskTotalMs: loadPerf.longTaskTotalMs,
    longTaskMaxMs: loadPerf.longTaskMaxMs,
    requests: loadReqs.filter((r) => r.url.includes("/api/scans")),
    dominantCost: tickerCount > 0 ? "E network (scans payload) + B React render tabla" : "UNKNOWN",
    confidence: tickerCount > 0 ? "HIGH" : "LOW",
  });

  // 3. Truth line estable (post-load baseline)
  const truthNow = await page.locator(".screenerTruthLine").innerText();
  results.push({
    workflow: "3. Truth line estable (baseline post-carga)",
    feedbackMs: 0,
    stableMs: 0,
    feedbackDetail: truthNow.slice(0, 140),
    dominantCost: "N/A — ya estable",
    confidence: "HIGH",
  });

  // 4. Cambiar hunt card → Cerca de pivot
  results.push(await measureInteraction(
    page, net, "4. Hunt card → Cerca de pivot",
    () => page.locator('.huntCardRail button', { hasText: "Cerca de pivot" }).click(),
    async (t0) => {
      const r = await waitTruthLine(page, (t) => t.includes("pivot") || t.includes("Cerca") || /\d+ de \d+/.test(t), 15000);
      return { ms: performance.now() - t0, detail: r.text?.slice(0, 100) };
    },
    { stableQuietMs: 450 },
  ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "HIGH" })));

  // 5. Hunt card → Líderes Etapa 2 (another card)
  results.push(await measureInteraction(
    page, net, "4b. Hunt card → Líderes Etapa 2",
    () => page.locator('.huntCardRail button', { hasText: "Líderes Etapa 2" }).click(),
    async (t0) => {
      const r = await waitTruthLine(page, (t) => /Etapa|Líderes|\d+ de \d+/.test(t), 15000);
      return { ms: performance.now() - t0, detail: r.text?.slice(0, 100) };
    },
  ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "HIGH" })));

  // 5. Toggle filter family Momentum off
  results.push(await measureInteraction(
    page, net, "5. Desactivar familia Momentum",
    () => page.locator('button[aria-label*="Momentum"]').first().click(),
    async (t0) => {
      const r = await waitTruthLine(page, (t) => /\d+ de \d+/.test(t), 15000);
      return { ms: performance.now() - t0, detail: r.text?.slice(0, 100) };
    },
  ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "HIGH" })));

  // 6. Toggle Momentum back on
  results.push(await measureInteraction(
    page, net, "5b. Reactivar familia Momentum",
    () => page.locator('button[aria-label*="Momentum"]').first().click(),
    async (t0) => {
      const r = await waitTruthLine(page, (t) => /\d+ de \d+/.test(t), 15000);
      return { ms: performance.now() - t0, detail: r.text?.slice(0, 100) };
    },
  ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "HIGH" })));

  // 7. Change intensity RS family (relativeStrength has slider)
  const rsSlider = page.locator('.layerControlRow:has(.layerControlLabel:text("RS")) input[type="range"], .layerControlRow:has(strong:text("RS")) input[type="range"]').first();
  if (await rsSlider.count()) {
    results.push(await measureInteraction(
      page, net, "6. Cambiar intensidad familia RS",
      async () => {
        const box = await rsSlider.boundingBox();
        if (box) await page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
        else await rsSlider.fill("75");
      },
      async (t0) => {
        await page.waitForTimeout(100);
        const r = await waitTruthLine(page, (t) => /\d+ de \d+/.test(t), 15000);
        return { ms: performance.now() - t0, detail: r.text?.slice(0, 100) };
      },
      { stableQuietMs: 550 },
    ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "MEDIUM" })));
  }

  // 8. Sort by column (Score total or RS)
  const sortBtn = page.locator('button.columnHeadBtn').filter({ hasText: /Score|RS|Total/i }).first();
  if (await sortBtn.count()) {
    const sortLabel = await sortBtn.innerText();
    results.push(await measureInteraction(
      page, net, `7. Ordenar tabla por ${sortLabel.trim()}`,
      () => sortBtn.click(),
      async (t0) => {
        await page.waitForSelector('button.columnHeadBtn.isActive', { timeout: 5000 }).catch(() => {});
        return { ms: performance.now() - t0, detail: `sorted by ${sortLabel.trim()}` };
      },
    ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "HIGH" })));
  }

  // 9. Change perf period
  const periodPicker = page.locator('.resultsTableControls select, .performancePeriodPicker select').first();
  if (await periodPicker.count()) {
    const options = await periodPicker.locator('option').allTextContents();
    const currentPeriod = await periodPicker.inputValue().catch(() => "");
    const alt = options.find((o) => /6M|12M|3M/i.test(o) && !o.includes(currentPeriod));
    if (alt) {
      results.push(await measureInteraction(
        page, net, "8. Cambiar periodo rendimiento",
        () => periodPicker.selectOption({ label: alt }),
        async (t0) => {
          await page.waitForTimeout(200);
          return { ms: performance.now() - t0, detail: `period → ${alt}` };
        },
      ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "MEDIUM" })));
    }
  }

  // 9. Abrir Quick Review (clic en fila → modal; el botón «Revisar» navega a /review)
  const firstRow = page.locator("table.compactResultsTable tbody tr").first();
  if (await firstRow.count()) {
    results.push(await measureInteraction(
      page, net, "9. Abrir Quick Review (clic fila)",
      () => firstRow.click(),
      async (t0) => {
        await page.waitForSelector("dialog.quickReviewModal, .quickReviewModal", { timeout: 15000 });
        return { ms: performance.now() - t0, detail: "modal open via row click" };
      },
      { stableQuietMs: 900 },
    ).then((r) => ({
      ...r,
      dominantCost: classifyQuickReview(r),
      confidence: "HIGH",
      chartRequests: r.requests.filter((x) => x.url.includes("/api/chart")),
    })));

    // 10. Navigate next in Quick Review
    const nextBtn = page.locator('.quickReviewNavGroup button:has-text("Siguiente")');
    if (await nextBtn.isEnabled().catch(() => false)) {
      results.push(await measureInteraction(
        page, net, "10. Quick Review → Siguiente",
        () => nextBtn.click(),
        async (t0) => {
          await page.waitForFunction(() => {
            const counter = document.querySelector(".quickReviewCounter");
            return counter && !counter.textContent?.startsWith("1/");
          }, null, { timeout: 10000 }).catch(() => {});
          return { ms: performance.now() - t0, detail: await page.locator(".quickReviewCounter").innerText().catch(() => "") };
        },
        { stableQuietMs: 800 },
      ).then((r) => ({
        ...r,
        dominantCost: classifyQuickReview(r),
        confidence: "HIGH",
        chartRequests: r.requests.filter((x) => x.url.includes("/api/chart")),
      })));
    }

    // 11. Close Quick Review
    results.push(await measureInteraction(
      page, net, "11. Cerrar Quick Review",
      () => page.locator('.quickReviewExitGroup button:has-text("Cerrar"), dialog.quickReviewModal button:has-text("Cerrar")').first().click(),
      async (t0) => {
        await page.waitForSelector("dialog.quickReviewModal, .quickReviewModal", { state: "hidden", timeout: 10000 }).catch(() => {});
        return { ms: performance.now() - t0, detail: "modal closed" };
      },
    ).then((r) => ({ ...r, dominantCost: "B React (unmount modal)", confidence: "HIGH" })));
  }

  // Verify context recovered
  const postCloseRows = await page.locator("table.compactResultsTable tbody tr").count();

  // 13. Change preset with coverage — Deterioro hunt card
  results.push(await measureInteraction(
    page, net, "12. Hunt card → Deterioro",
    () => page.locator('.huntCardRail button', { hasText: "Deterioro" }).click(),
    async (t0) => {
      const r = await waitTruthLine(page, (t) => /Deterioro|\d+ de \d+/.test(t), 15000);
      return { ms: performance.now() - t0, detail: r.text?.slice(0, 100) };
    },
  ).then((r) => ({ ...r, dominantCost: classifyFilter(r), confidence: "HIGH" })));

  // 14. US → Core intl market switch (if viable)
  const coreIntlBtn = page.getByRole("button", { name: "Core intl", exact: true });
  if (await coreIntlBtn.count()) {
    results.push(await measureInteraction(
      page, net, "13a. Mercado → Core intl",
      () => coreIntlBtn.click(),
      async (t0) => {
        const r = await waitTruthLine(page, (t) => /analiz|mercado|filtro|0\/0|\d+ de \d+/i.test(t), 30000);
        return { ms: performance.now() - t0, detail: r.text?.slice(0, 120) };
      },
      { stableQuietMs: 600 },
    ).then((r) => ({
      ...r,
      dominantCost: classifyMarketSwitch(r),
      confidence: r.requests.some((x) => x.url.includes("/api/scans")) ? "HIGH" : "MEDIUM",
    })));

    // Back to US
    results.push(await measureInteraction(
      page, net, "13b. Mercado → EE. UU. (vuelta)",
      () => page.locator('.marketPresetBar button', { hasText: "EE. UU." }).click(),
      async (t0) => {
        const r = await waitTruthLine(page, (t) => /3580|3\s?\d{3}|\d+ de \d+/i.test(t), 60000);
        return { ms: performance.now() - t0, detail: r.text?.slice(0, 120) };
      },
      { stableQuietMs: 600 },
    ).then((r) => ({
      ...r,
      dominantCost: classifyMarketSwitch(r),
      confidence: "HIGH",
    })));
  }

  meta.finishedAt = new Date().toISOString();
  meta.postCloseRows = postCloseRows;
  meta.truthLineFinal = await page.locator(".screenerTruthLine").innerText().catch(() => "");

  await page.screenshot({ path: path.join(OUT_DIR, "final-state.png"), fullPage: false }).catch(() => {});
  await browser.close();

  const output = { meta, results };
  writeFileSync(path.join(OUT_DIR, "raw-results.json"), JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
  return output;
}

function classifyLoad(reqs, perf) {
  const scans = reqs.find((r) => r.url.includes("/api/scans"));
  if (scans && scans.ms > 5000) return `E network (/api/scans ${scans.ms}ms, ${scans.kb}KB) + A filter/parse post-fetch`;
  if (perf.longTaskMaxMs > 100) return `A/B sync (${perf.longTaskMaxMs}ms max long task) + E network`;
  return "E network + B React hydrate";
}

function classifyFilter(r) {
  if (r.longTaskMaxMs > 100) return `A filtrado/sort síncrono (${r.longTaskMaxMs}ms LT) + B React`;
  if (r.feedbackMs < 80 && r.stableMs < 300) return "A fast-path/caché (hunt) — dominante";
  if (r.feedbackMs > 200) return `A filtrado O(N) + B render (${r.feedbackMs}ms feedback)`;
  return "A filtrado + B React (moderado)";
}

function classifyQuickReview(r) {
  const charts = r.requests?.filter((x) => x.url.includes("/api/chart")) || [];
  if (charts.length) return `F charts/QR (${charts.length} chart fetches, max ${Math.max(...charts.map((c) => c.ms || 0))}ms)`;
  if (r.longTaskMaxMs > 100) return `F charts mount + B React (${r.longTaskMaxMs}ms LT)`;
  return "F Quick Review mount";
}

function classifyMarketSwitch(r) {
  const scans = r.requests?.find((x) => x.url.includes("/api/scans"));
  if (scans) return `E network (rescans ${scans.ms}ms) + A re-filter`;
  return "A re-filter mercado (sin refetch)";
}

main().catch((err) => {
  console.error("PROFILE FAILED:", err?.message || err);
  process.exitCode = 1;
});
