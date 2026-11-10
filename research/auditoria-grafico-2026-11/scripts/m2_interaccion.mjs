// Medida 2: interacción en escritorio (rueda, ctrl+rueda, arrastre, botones, teclado, crosshair, rangos).
// Uso: node m2_interaccion.mjs <repo> <outdir> [SYMBOL]
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir, SYM = "AAPL"] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const token = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l)).replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__lt = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push({ t: Math.round(e.startTime), d: Math.round(e.duration) }); }).observe({ type: "longtask", buffered: true }); } catch {}
  window.__charts = 0;
  new MutationObserver((muts) => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList?.contains("tv-lightweight-charts")) window.__charts += 1; }).observe(document, { childList: true, subtree: true });
});
const reqs = [];
const t0 = Date.now();
page.on("request", (r) => { if (r.url().includes("/api/chart") || r.url().includes("/api/rs-weekly") || r.url().includes("/api/company-brief")) reqs.push({ url: r.url().replace(BASE, ""), start: Date.now() - t0, r }); });
page.on("requestfinished", async (r) => { const e = reqs.find((x) => x.r === r); if (!e) return; e.end = Date.now() - t0; try { e.bytes = (await r.sizes()).responseBodySize; } catch {} });
page.on("requestfailed", (r) => { const e = reqs.find((x) => x.r === r); if (e) { e.end = Date.now() - t0; e.failed = r.failure()?.errorText; } });
const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); });

let reloads = 0;
page.on("framenavigated", (f) => { if (f === page.mainFrame()) reloads += 1; });
const _ev = page.evaluate.bind(page);
page.evaluate = async (...a) => { for (let i = 0; i < 4; i += 1) { try { return await _ev(...a); } catch (e) { if (!String(e).includes("context was destroyed")) throw e; console.log("   [recarga HMR detectada, reintento]"); await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1500); } } return null; };
await page.goto(`${BASE}/stock/${SYM}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 });
await page.waitForTimeout(2500);

const snap = () => page.evaluate(() => { const s = window.__chartViewportSnapshot?.(); return s ? { lr: s.visibleLogicalRange && { from: +s.visibleLogicalRange.from.toFixed(1), to: +s.visibleLogicalRange.to.toFixed(1) }, manual: s.manual, bars: s.view?.visibleBars, label: s.visibleWindowLabel, key: s.view?.key } : null; });
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
const log = (...a) => console.log(...a);

const canvasBox = async () => {
  const el = await page.$(".universalChartCanvas");
  await el.scrollIntoViewIfNeeded();
  return el.boundingBox();
};
let box = await canvasBox();
// centro del panel de precio, lejos de la tarjeta (mitad derecha)
const cx = () => box.x + box.width * 0.62;
const cy = () => box.y + box.height * 0.55;
await page.evaluate(() => window.scrollTo(0, Math.max(0, window.scrollY - 120)));
box = await canvasBox();
log("inicial", JSON.stringify(await snap()), "scrollY", await scrollY(), "box", JSON.stringify(box));

// 1) rueda sin ctrl
const sy0 = await scrollY(); const s0 = await snap();
await page.mouse.move(cx(), cy());
await page.mouse.wheel(0, 300);
await page.waitForTimeout(500);
log("rueda sin ctrl: scrollY", sy0, "->", await scrollY(), "rango", JSON.stringify(s0?.lr), "->", JSON.stringify((await snap())?.lr));
await page.evaluate((y) => window.scrollTo(0, y), sy0); await page.waitForTimeout(300); box = await canvasBox();

// 1b) rueda horizontal (trackpad) sin ctrl
const s1b = await snap();
await page.mouse.move(cx(), cy());
await page.mouse.wheel(300, 0);
await page.waitForTimeout(400);
log("rueda horizontal: rango", JSON.stringify(s1b?.lr), "->", JSON.stringify((await snap())?.lr));

// 2) ctrl+rueda (zoom / pinch de trackpad en macOS llega como ctrl+wheel)
const sy2 = await scrollY(); const s2 = await snap();
await page.keyboard.down("Control");
for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, -120); await page.waitForTimeout(40); }
await page.keyboard.up("Control");
await page.waitForTimeout(400);
const s2b = await snap();
log("ctrl+rueda acercar x5: scrollY", sy2, "->", await scrollY(), "rango", JSON.stringify(s2?.lr), "->", JSON.stringify(s2b?.lr), "barras", s2?.bars, "->", s2b?.bars, "manual", s2b?.manual);
await page.screenshot({ path: `${outdir}/m2-ctrlrueda-zoom.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });

// 3) arrastre (pan) con medición de long tasks y frames
await page.evaluate(() => { window.__lt.length = 0; window.__frames = []; let last = performance.now(); const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__frames.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
const s3 = await snap();
await page.mouse.move(cx(), cy());
await page.mouse.down();
for (let i = 1; i <= 30; i += 1) { await page.mouse.move(cx() + i * 12, cy(), { steps: 1 }); }
await page.mouse.up();
await page.waitForTimeout(500);
const s3b = await snap();
const jank = await page.evaluate(() => { const f = window.__frames.slice(1); const over = f.filter((d) => d > 34).length; return { frames: f.length, p95: Math.round([...f].sort((a, b) => a - b)[Math.floor(f.length * 0.95)] || 0), max: Math.round(Math.max(...f)), over34: over, longtasks: window.__lt.slice(0, 10) }; });
log("arrastre derecha 360px: rango", JSON.stringify(s3?.lr), "->", JSON.stringify(s3b?.lr), "manual", s3b?.manual, "label", s3b?.label, "jank", JSON.stringify(jank));
await page.screenshot({ path: `${outdir}/m2-arrastre.png`, clip: { x: box.x, y: box.y - 60, width: box.width, height: box.height + 60 } });

// 4) arrastre hasta el borde izquierdo del histórico (¿hay más? ¿carga progresiva?)
const before4 = reqs.length;
for (let k = 0; k < 4; k += 1) {
  await page.mouse.move(box.x + box.width * 0.2, cy()); await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.9, cy(), { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(250);
}
const s4 = await snap();
log("arrastre al pasado x4: rango", JSON.stringify(s4?.lr), "label", s4?.label, "peticiones nuevas", reqs.length - before4);
await page.screenshot({ path: `${outdir}/m2-borde-historico.png`, clip: { x: box.x, y: box.y - 60, width: box.width, height: box.height + 60 } });

// 5) botones: restaurar, acercar, mover izq, último dato
const clickBtn = async (label) => { const b = page.locator(`button[aria-label="${label}"]`).first(); if (await b.count() === 0) return "no-existe"; if (await b.isDisabled()) return "deshabilitado"; await b.click(); await page.waitForTimeout(350); return JSON.stringify(await snap()); };
log("btn Restaurar:", await clickBtn("Restaurar rango seleccionado"));
log("btn Acercar:", await clickBtn("Acercar gráfico"));
log("btn Mover hist:", await clickBtn("Mover ventana hacia el historial"));
log("btn Último dato:", await clickBtn("Volver al último dato sin cambiar el zoom"));
log("btn Restaurar:", await clickBtn("Restaurar rango seleccionado"));

// 6) teclado: foco en el lienzo y flechas / +/-
await page.mouse.click(cx(), cy());
const s6 = await snap();
for (const k of ["ArrowLeft", "ArrowRight", "+", "-", "Home", "End"]) await page.keyboard.press(k);
await page.waitForTimeout(300);
const focusInfo = await page.evaluate(() => ({ active: document.activeElement?.tagName + "." + (document.activeElement?.className || "").toString().slice(0, 40), canvasTabIndex: document.querySelector(".universalChartCanvas")?.getAttribute("tabindex") }));
log("teclado flechas/+/-/Home/End: rango", JSON.stringify(s6?.lr), "->", JSON.stringify((await snap())?.lr), "foco", JSON.stringify(focusInfo));

// 7) crosshair: hover en una vela antigua (zona RS) y lectura de DOM
await clickBtn("Restaurar rango seleccionado");
await page.mouse.move(box.x + box.width * 0.30, box.y + box.height * 0.80);
await page.waitForTimeout(400);
const legend = await page.evaluate(() => [...document.querySelectorAll(".universalChart [class*=egend], .universalChart [class*=ooltip], .universalChart [class*=rosshair]")].map((n) => n.className + ": " + n.innerText.slice(0, 80)));
log("crosshair DOM legend/tooltip:", JSON.stringify(legend));
await page.screenshot({ path: `${outdir}/m2-crosshair.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });

// 8) doble clic en eje de precio
await page.mouse.dblclick(box.x + box.width - 30, box.y + box.height * 0.4);
await page.waitForTimeout(300);
log("doble clic eje precio:", JSON.stringify(await snap()));

// 9) cambios de rango/temporalidad: peticiones, recreaciones, tiempo hasta nuevo lienzo
const seq = [["Rango 2A"], ["Rango 5A"], ["Rango Max"], ["Temporalidad W"], ["Temporalidad M"], ["Temporalidad D"], ["Rango 1A"]];
for (const [label] of seq) {
  const nReq = reqs.length; const charts0 = await page.evaluate(() => window.__charts);
  const t = Date.now();
  const b = page.locator(`button[aria-label="${label}"]`).first();
  if (await b.count() === 0) { log(label, "no existe"); continue; }
  if (await b.isDisabled()) { log(label, "deshabilitado"); continue; }
  await b.click();
  let ms = null;
  for (let i = 0; i < 100; i += 1) { await page.waitForTimeout(50); const c = await page.evaluate(() => window.__charts); if (c > charts0) { ms = Date.now() - t; break; } }
  await page.waitForTimeout(1500);
  const s = await snap();
  const charts1 = await page.evaluate(() => window.__charts);
  const notes = await page.evaluate(() => [...document.querySelectorAll(".universalChart .dataNote, .universalChart .universalChartEstimatedNote")].map((n) => n.innerText.slice(0, 120)));
  const newReqs = reqs.slice(nReq).map((q) => `${q.url.slice(0, 70)} ${q.end != null ? q.end - q.start + "ms" : "pendiente"} ${q.bytes ?? ""}${q.failed ? " FAIL " + q.failed : ""}`);
  log(label, "msHastaNuevoLienzo", ms, "recreaciones", charts1 - charts0, "visible", s?.bars, s?.label, "notas", JSON.stringify(notes), "req", JSON.stringify(newReqs));
  const safe = label.replace(/\s+/g, "-");
  await page.screenshot({ path: `${outdir}/m2-${SYM}-${safe}.png`, clip: { x: box.x, y: box.y - 60, width: box.width, height: box.height + 60 } });
}

// 10) cambios rápidos (cancelación): 1A→5A→Max→2A en <300ms
const nReq = reqs.length;
for (const label of ["Rango 5A", "Rango Max", "Rango 2A"]) { await page.locator(`button[aria-label="${label}"]`).first().click(); await page.waitForTimeout(60); }
await page.waitForTimeout(3000);
log("ráfaga 5A→Max→2A:", JSON.stringify(reqs.slice(nReq).map((q) => `${q.url.slice(0, 60)} ${q.end != null ? q.end - q.start + "ms" : "pend"} ${q.failed || "ok"}`)), "visible", JSON.stringify(await snap()));
log("longtasks totales tras ráfaga", JSON.stringify(await page.evaluate(() => window.__lt.slice(-8))));
log("navegaciones/recargas del marco principal", reloads);
log("errores", JSON.stringify(errs.slice(0, 10)));
await browser.close();
