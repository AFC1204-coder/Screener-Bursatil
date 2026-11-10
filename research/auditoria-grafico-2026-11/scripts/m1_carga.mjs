// Medida 1: carga de la ficha por símbolo (escritorio y móvil). Uso: node m1_carga.mjs <repo> <outdir> [desktop|mobile]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir, mode = "desktop"] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium, devices } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const line = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const symbols = (process.env.SYMS || "AAPL,KO,TJGC,MRNA,XTER,ZZZZNOEXISTE").split(",");

const INIT = () => {
  window.__probe = { canvasAt: null, charts: 0, chartRemoved: 0, states: [], loadingSeen: false, emptySeen: false };
  const mark = () => {
    const root = document.querySelector(".universalChart");
    const st = root ? (root.classList.contains("empty") ? (root.classList.contains("loading") ? "loading" : "empty") : "ready") : (document.querySelector(".stockChartLoadingShell") ? "shell" : "none");
    const last = window.__probe.states.at(-1);
    if (!last || last.s !== st) window.__probe.states.push({ s: st, t: Math.round(performance.now()), txt: (root || document.querySelector(".stockChartLoadingShell"))?.innerText?.slice(0, 80) || "" });
  };
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.classList?.contains("tv-lightweight-charts") || n.querySelector?.(".tv-lightweight-charts"))) {
          window.__probe.charts += 1;
          if (window.__probe.canvasAt == null) window.__probe.canvasAt = Math.round(performance.now());
        }
      }
      for (const n of m.removedNodes) {
        if (n.nodeType === 1 && (n.classList?.contains("tv-lightweight-charts") || n.querySelector?.(".tv-lightweight-charts"))) window.__probe.chartRemoved += 1;
      }
    }
    mark();
  }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
};

const browser = await chromium.launch({ channel: "chrome" });
const results = [];
for (const sym of symbols) {
  const ctxOpts = mode === "mobile"
    ? { ...devices["iPhone 13"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 900 } };
  delete ctxOpts.defaultBrowserType;
  const ctx = await browser.newContext(ctxOpts);
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  await page.addInitScript(INIT);
  const reqs = [];
  const t0 = Date.now();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") consoleErrors.push(`${m.type()}: ${m.text().slice(0, 220)}`); });
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) consoleErrors.push("nav@"+(Date.now()-t0)+" "+f.url().replace(BASE,"")); });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 220)}`));
  page.on("request", (r) => { if (r.url().includes("/api/")) reqs.push({ url: r.url().replace(BASE, ""), start: Date.now() - t0, r }); });
  page.on("requestfinished", async (r) => {
    const e = reqs.find((x) => x.r === r); if (!e) return;
    e.end = Date.now() - t0;
    try { const sz = await r.sizes(); e.bytes = sz.responseBodySize; e.hdr = sz.responseHeadersSize; } catch {}
    try { e.status = (await r.response())?.status(); } catch {}
  });
  page.on("requestfailed", (r) => { if (!r.url().includes("/api/")) consoleErrors.push("reqfailed: "+r.url().slice(0,120)+" "+(r.failure()?.errorText||"")); const e = reqs.find((x) => x.r === r); if (e) { e.end = Date.now() - t0; e.failed = r.failure()?.errorText; } });
  let gotoErr = "";
  try { await page.goto(`${BASE}/stock/${sym}`, { waitUntil: "domcontentloaded", timeout: 120000 }); } catch (e) { gotoErr = String(e).slice(0, 120); }
  const tDcl = Date.now() - t0;
  try { await page.waitForSelector(".universalChartCanvas canvas, .universalChart.empty:not(.loading), .stockChartLoading", { timeout: 30000 }); } catch {}
  await page.waitForTimeout(5000);
  let probe = {}; try { probe = await page.evaluate(() => ({ ...window.__probe, nav: (() => { const n = performance.getEntriesByType("navigation")[0]; return n ? { ttfb: Math.round(n.responseStart), dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transfer: n.transferSize } : null; })(), snap: window.__chartViewportSnapshot?.() ? JSON.parse(JSON.stringify(window.__chartViewportSnapshot())) : null, notes: [...document.querySelectorAll(".universalChart .dataNote, .universalChart .universalChartEstimatedNote, .universalRsAbsenceNote, .stockChartLoading")].map((n) => n.innerText.slice(0, 160)), badges: [...document.querySelectorAll(".universalChartBadges, .chartIdentityCard")].map((n) => n.innerText.replace(/\s+/g, " ").slice(0, 200)), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null })); } catch (e) { probe = { err: String(e).slice(0,100) }; }
  const chartEl = await page.$(".universalChart");
  const shot = `${outdir}/m1-${mode}-${sym}.png`;
  try { if (chartEl) { await chartEl.scrollIntoViewIfNeeded(); await chartEl.screenshot({ path: shot }); } else await page.screenshot({ path: shot }); } catch {}
  const apiReqs = reqs.map(({ r, ...rest }) => rest);
  results.push({ sym, mode, tDcl, gotoErr, probe, apiReqs, consoleErrors: consoleErrors.slice(0, 15) });
  console.log(JSON.stringify({ sym, mode, tDcl, canvasAt: probe.canvasAt, charts: probe.charts, removed: probe.chartRemoved, states: probe.states, nav: probe.nav, notes: probe.notes, badges: probe.badges, snapBars: probe.snap?.view?.visibleBars, heap: probe.heap }));
  for (const q of apiReqs) console.log("   ", q.start, "->", q.end, q.status ?? q.failed, q.bytes, q.url.slice(0, 110));
  for (const c of consoleErrors.slice(0, 8)) console.log("   !", c);
  await ctx.close();
}
writeFileSync(`${process.env.JSONDIR || outdir}/m1-${mode}.json`, JSON.stringify(results, null, 1));
await browser.close();
