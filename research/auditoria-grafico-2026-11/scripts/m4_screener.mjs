// Medida 4: screener (miniaturas de la cinta + vista rápida), cancelación al cambiar rango, memoria al navegar entre fichas.
// Uso: node m4_screener.mjs <repo> <outdir>
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const token = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l)).replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ channel: "chrome", args: ["--enable-precise-memory-info", "--js-flags=--expose-gc"] });

function track(page, t0, filter) {
  const reqs = [];
  page.on("request", (r) => { if (filter(r.url())) reqs.push({ url: r.url().replace(BASE, ""), start: Date.now() - t0(), r }); });
  page.on("requestfinished", async (r) => { const e = reqs.find((x) => x.r === r); if (!e) return; e.end = Date.now() - t0(); try { e.bytes = (await r.sizes()).responseBodySize; } catch {} });
  page.on("requestfailed", (r) => { const e = reqs.find((x) => x.r === r); if (e) { e.end = Date.now() - t0(); e.failed = r.failure()?.errorText; } });
  return reqs;
}
const fmt = (q) => `${q.start}->${q.end ?? "pend"} ${q.failed ? "FAIL:" + q.failed : (q.bytes ?? "")} ${q.url.slice(0, 120)}`;

// ── A) Screener + vista rápida ─────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  let base = Date.now();
  const reqs = track(page, () => base, (u) => /\/api\/(chart|rs-weekly|scans)/.test(u));
  const errs = []; page.on("pageerror", (e) => errs.push(String(e).slice(0, 200))); page.on("console", (m) => { if (m.type() === "error" && !/ERR_NAME_NOT_RESOLVED/.test(m.text())) errs.push(m.text().slice(0, 200)); });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".huntTapeRow", { timeout: 90000 }).catch(() => log("sin .huntTapeRow"));
  await page.waitForTimeout(8000);
  const spark = await page.evaluate(() => ({ rows: document.querySelectorAll(".huntTapeRow").length, svgs: document.querySelectorAll(".huntTapeRow svg").length }));
  log("SCREENER carga: filas", spark.rows, "svg", spark.svgs);
  for (const q of reqs) log("  ", fmt(q));
  await page.screenshot({ path: `${outdir}/m4-screener-cinta.png` });
  // abrir vista rápida en la primera fila
  const nBefore = reqs.length;
  base = Date.now();
  const row = page.locator(".huntTapeRow").first();
  if (await row.count()) {
    await row.click({ position: { x: 400, y: 10 } }).catch((e) => log("click fila", String(e).slice(0, 80)));
    const t = Date.now();
    let canvasMs = null; let states = [];
    for (let i = 0; i < 120; i += 1) {
      await page.waitForTimeout(100);
      const st = await page.evaluate(() => { const r = document.querySelector(".universalChart"); if (!r) return "none"; const c = r.querySelector("canvas") ? "canvas" : "nocanvas"; const n = [...r.querySelectorAll(".universalChartEstimatedNote,.dataNote")].map((x) => x.innerText).join("|"); return `${r.className.includes("empty") ? "empty" : "ready"}:${c}:${n.slice(0, 60)}`; }).catch(() => "err");
      if (states.at(-1)?.s !== st) states.push({ s: st, t: Date.now() - t });
      if (canvasMs == null && st.includes(":canvas")) canvasMs = Date.now() - t;
    }
    log("VISTA RÁPIDA: ms hasta lienzo", canvasMs, "estados", JSON.stringify(states));
    for (const q of reqs.slice(nBefore)) log("  ", fmt(q));
    await page.screenshot({ path: `${outdir}/m4-vista-rapida.png` });
    // siguiente valor de la cola (flecha derecha / j)
    const n2 = reqs.length; base = Date.now();
    await page.keyboard.press("ArrowRight").catch(() => {});
    await page.waitForTimeout(4000);
    log("VISTA RÁPIDA siguiente (ArrowRight):");
    for (const q of reqs.slice(n2)) log("  ", fmt(q));
  }
  log("errores screener", JSON.stringify(errs.slice(0, 8)));
  await ctx.close();
}

// ── B) Cancelación: cambio de rango antes de que llegue la respuesta ─────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  let base = Date.now();
  const reqs = track(page, () => base, (u) => u.includes("/api/chart"));
  // retrasar artificialmente /api/chart 2,5 s para poder cambiar de rango con la petición en vuelo
  await page.route("**/api/chart?**", async (route) => { await new Promise((r) => setTimeout(r, 2500)); try { await route.continue(); } catch {} });
  await page.goto(`${BASE}/stock/KO`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 });
  await page.waitForTimeout(1500);
  base = Date.now();
  await page.locator('button[aria-label="Rango 5A"]').first().click();
  await page.waitForTimeout(300);
  await page.locator('button[aria-label="Rango 1A"]').first().click();
  await page.waitForTimeout(4500);
  log("CANCELACIÓN 1A→5A→(300ms)→1A con /api/chart retrasada 2,5 s:");
  for (const q of reqs) log("  ", fmt(q));
  const s = await page.evaluate(() => window.__chartViewportSnapshot?.()?.view?.visibleBars);
  log("   barras visibles tras volver a 1A:", s);
  // XTER: aviso «Ampliando histórico…» persiste en montaje y se corrige al cambiar de rango
  await page.unroute("**/api/chart?**");
  await page.goto(`${BASE}/stock/XTER`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 });
  await page.waitForTimeout(5000);
  const n1 = await page.evaluate(() => [...document.querySelectorAll(".universalChartExpandingNote")].map((n) => n.innerText));
  await page.locator('button[aria-label="Rango 2A"]').first().click();
  await page.waitForTimeout(3000);
  const n2 = await page.evaluate(() => [...document.querySelectorAll(".universalChartExpandingNote")].map((n) => n.innerText));
  await page.locator('button[aria-label="Rango 1A"]').first().click();
  await page.waitForTimeout(3000);
  const n3 = await page.evaluate(() => [...document.querySelectorAll(".universalChartExpandingNote")].map((n) => n.innerText));
  log("XTER aviso ampliando: montaje+5s", JSON.stringify(n1), "| tras 2A+3s", JSON.stringify(n2), "| de vuelta a 1A+3s", JSON.stringify(n3));
  await ctx.close();
}

// ── C) Memoria: 12 cambios de ficha por navegación de cliente ──────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${BASE}/stock/AAPL`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 });
  await page.waitForTimeout(2000);
  const heap = async () => { await cdp.send("HeapProfiler.collectGarbage"); const m = await cdp.send("Runtime.getHeapUsage"); const c = await page.evaluate(() => ({ canvases: document.querySelectorAll("canvas").length, charts: document.querySelectorAll(".tv-lightweight-charts").length })); return { mb: +(m.usedSize / 1048576).toFixed(1), ...c }; };
  log("MEMORIA inicial", JSON.stringify(await heap()));
  const syms = ["KO", "MRNA", "AAPL", "KO", "MRNA", "AAPL", "KO", "MRNA", "AAPL", "KO", "MRNA", "AAPL"];
  let navType = "";
  for (const [i, s] of syms.entries()) {
    // navegación de cliente: enlace interno si existe; si no, history API del router de Next
    const ok = await page.evaluate((sym) => { const a = [...document.querySelectorAll(`a[href="/stock/${sym}"]`)][0]; if (a) { a.click(); return "link"; } if (window.next?.router?.push) { window.next.router.push(`/stock/${sym}`); return "router"; } return "none"; }, s);
    navType = ok;
    if (ok === "none") { await page.goto(`${BASE}/stock/${s}`, { waitUntil: "domcontentloaded" }); navType = "goto"; }
    await page.waitForFunction((sym) => document.querySelector(".universalChartSymbol, .chartIdentityCard")?.innerText?.includes(sym), s, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    if (i % 3 === 2) log(`MEMORIA tras ${i + 1} navegaciones (${navType})`, JSON.stringify(await heap()));
  }
  await ctx.close();
}
await browser.close();
