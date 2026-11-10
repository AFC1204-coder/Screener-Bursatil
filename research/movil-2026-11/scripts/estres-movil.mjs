// Screener a 390 px con CPU ×4 y red «4G rápida» emulada (CDP): primer contenido,
// nodos DOM, jank al desplazar y orden real de la lista. Uso: node estres-movil.mjs <repo> <outdir>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const token = readFileSync(repo + "/.env.local", "utf8").split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l)).replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
const res = {};
for (const mode of ["sin-throttle", "cpu4-4g"]) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  if (mode !== "sin-throttle") {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  }
  // warm: segunda visita (la compilación de dev ya ocurrió en la auditoría)
  const t0 = Date.now();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 180000 });
  const dcl = Date.now() - t0;
  await page.waitForSelector(".mobileResultRow, .mobileEmpty", { timeout: 120000 });
  const first = Date.now() - t0;
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => ({ nodos: document.querySelectorAll("*").length, filas: document.querySelectorAll(".mobileResultRow").length, nodosPorFila: Math.round(document.querySelectorAll(".mobileResultRow *").length / Math.max(1, document.querySelectorAll(".mobileResultRow").length)), heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, orden: [...document.querySelectorAll(".mobileResultRow")].map((r) => (r.querySelector(".ticker, a[href^='/stock/']")?.textContent || "").trim().split(/\s/)[0]) }));
  const jank = await page.evaluate(async () => {
    const longs = []; const po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(Math.round(e.duration)))); po.observe({ type: "longtask" });
    const frames = []; let last = performance.now(); const t0 = performance.now(); const total = innerHeight * 6;
    await new Promise((r) => { const st = (t) => { frames.push(t - last); last = t; const p = Math.min(1, (t - t0) / 2500); scrollTo(0, total * p); p < 1 ? requestAnimationFrame(st) : r(); }; requestAnimationFrame(st); });
    await new Promise((r) => setTimeout(r, 300)); po.disconnect();
    const f = frames.slice(1).sort((a, b) => a - b);
    return { fotogramas: f.length, p50: +f[Math.floor(f.length / 2)].toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1), max: +f[f.length - 1].toFixed(1), sobre33: f.filter((x) => x > 33.4).length, tareasLargas: longs };
  });
  res[mode] = { dclMs: dcl, primeraFilaMs: first, ...info, orden: undefined, jank };
  if (mode === "sin-throttle") writeFileSync(`${outdir}/orden-lista.json`, JSON.stringify(info.orden.filter(Boolean)));
  console.log(mode, JSON.stringify(res[mode]));
  await page.close();
}
writeFileSync(`${outdir}/estres.json`, JSON.stringify(res, null, 1));
await browser.close();
