// Medida 3: táctil 390 px (swipe vertical/horizontal, pinch, objetivos táctiles, desbordes) + crosshair escritorio.
// Uso: node m3_movil.mjs <repo> <outdir> [SYMBOL]
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir, SYM = "AAPL"] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const token = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l)).replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const log = (...a) => console.log(...a);
const browser = await chromium.launch({ channel: "chrome" });

async function robust(page) {
  const _ev = page.evaluate.bind(page);
  page.evaluate = async (...a) => { for (let i = 0; i < 4; i += 1) { try { return await _ev(...a); } catch (e) { if (!String(e).includes("context was destroyed")) throw e; log("   [recarga HMR, reintento]"); await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 }).catch(() => {}); await page.waitForTimeout(1500); } } return null; };
}
const snapFn = () => { const s = window.__chartViewportSnapshot?.(); return s ? { lr: s.visibleLogicalRange && { from: +s.visibleLogicalRange.from.toFixed(1), to: +s.visibleLogicalRange.to.toFixed(1) }, bars: s.view?.visibleBars, manual: s.manual } : null; };

// ── Móvil ────────────────────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage(); await robust(page);
  await page.goto(`${BASE}/stock/${SYM}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 });
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  const el = await page.$(".universalChartCanvas");
  await el.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -40));
  await page.waitForTimeout(300);
  let box = await el.boundingBox();
  const layout = await page.evaluate(() => {
    const nav = [...document.querySelectorAll(".universalChartNavButton")].map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
    const segs = [...document.querySelectorAll(".chartSegmented button")].slice(0, 3).map((b) => { const r = b.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
    const card = document.querySelector(".chartIdentityCard")?.getBoundingClientRect();
    const canvas = document.querySelector(".universalChartCanvas")?.getBoundingClientRect();
    return { scrollW: document.documentElement.scrollWidth, innerW: innerWidth, nav, segs, cardPctDelLienzo: card && canvas ? Math.round((card.width * card.height) / (canvas.width * canvas.height) * 100) : null, card: card && `${Math.round(card.width)}x${Math.round(card.height)}`, canvas: canvas && `${Math.round(canvas.width)}x${Math.round(canvas.height)}`, touchAction: getComputedStyle(document.querySelector(".universalChartCanvas")).touchAction, tvTouchAction: document.querySelector(".tv-lightweight-charts") ? getComputedStyle(document.querySelector(".tv-lightweight-charts td canvas") || document.body).touchAction : null };
  });
  log("MÓVIL layout", JSON.stringify(layout), "box", JSON.stringify(box));
  await page.screenshot({ path: `${outdir}/m3-movil-${SYM}-inicial.png` });

  const touch = async (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
  const swipe = async (x0, y0, x1, y1, steps = 12) => {
    await touch("touchStart", [[x0, y0]]);
    for (let i = 1; i <= steps; i += 1) { await touch("touchMove", [[x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps]]); await page.waitForTimeout(16); }
    await touch("touchEnd", []);
    await page.waitForTimeout(600);
  };
  const midX = box.x + box.width * 0.6; const midY = box.y + box.height * 0.6;
  // vertical: ¿desplaza la página?
  let sy = await page.evaluate(() => scrollY); let s = await page.evaluate(snapFn);
  await swipe(midX, midY, midX, midY - 250);
  log("MÓVIL swipe vertical sobre el gráfico: scrollY", sy, "->", await page.evaluate(() => scrollY), "rango", JSON.stringify(s?.lr), "->", JSON.stringify((await page.evaluate(snapFn))?.lr));
  await page.evaluate((y) => window.scrollTo(0, y), sy); await page.waitForTimeout(300); box = await el.boundingBox();
  // horizontal: pan
  sy = await page.evaluate(() => scrollY); s = await page.evaluate(snapFn);
  await swipe(box.x + box.width * 0.3, box.y + box.height * 0.6, box.x + box.width * 0.85, box.y + box.height * 0.6);
  log("MÓVIL swipe horizontal (pan): scrollY", sy, "->", await page.evaluate(() => scrollY), "rango", JSON.stringify(s?.lr), "->", JSON.stringify((await page.evaluate(snapFn))?.lr));
  // diagonal suave (gesto real): 30° respecto a la horizontal
  s = await page.evaluate(snapFn); sy = await page.evaluate(() => scrollY);
  await swipe(box.x + box.width * 0.7, box.y + box.height * 0.6, box.x + box.width * 0.3, box.y + box.height * 0.6 - 120);
  log("MÓVIL swipe diagonal: scrollY", sy, "->", await page.evaluate(() => scrollY), "rango", JSON.stringify(s?.lr), "->", JSON.stringify((await page.evaluate(snapFn))?.lr));
  await page.evaluate((y) => window.scrollTo(0, y), sy); await page.waitForTimeout(300); box = await el.boundingBox();
  // pinch abrir (zoom in)
  s = await page.evaluate(snapFn);
  const cxp = box.x + box.width * 0.5, cyp = box.y + box.height * 0.55;
  await touch("touchStart", [[cxp - 30, cyp], [cxp + 30, cyp]]);
  for (let i = 1; i <= 12; i += 1) { await touch("touchMove", [[cxp - 30 - i * 8, cyp], [cxp + 30 + i * 8, cyp]]); await page.waitForTimeout(16); }
  await touch("touchEnd", []);
  await page.waitForTimeout(700);
  const sp = await page.evaluate(snapFn);
  log("MÓVIL pinch abrir: rango", JSON.stringify(s?.lr), "->", JSON.stringify(sp?.lr), "barras", s?.bars, "->", sp?.bars, "manual", sp?.manual, "scrollY", await page.evaluate(() => scrollY));
  await page.screenshot({ path: `${outdir}/m3-movil-${SYM}-tras-pinch.png` });
  // tap largo → crosshair en táctil
  await touch("touchStart", [[cxp, cyp]]); await page.waitForTimeout(700);
  await page.screenshot({ path: `${outdir}/m3-movil-${SYM}-tap-largo.png` });
  await touch("touchEnd", []);
  await ctx.close();
}

// ── Crosshair escritorio ────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage(); await robust(page);
  await page.goto(`${BASE}/stock/${SYM}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".universalChartCanvas canvas", { timeout: 60000 });
  await page.waitForTimeout(2500);
  const el = await page.$(".universalChartCanvas");
  await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  const box = await el.boundingBox();
  // punto sobre la zona de la línea RS (banda inferior 75–98 % del panel), a mitad de ventana
  await page.mouse.move(box.x + box.width * 0.40, box.y + box.height * 0.80);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outdir}/m3-crosshair-escritorio-${SYM}.png`, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  const dom = await page.evaluate(() => [...document.querySelectorAll(".universalChart *")].filter((n) => n.children.length === 0 && /RS|O |H |L |C /.test(n.textContent || "") && n.offsetParent).map((n) => n.textContent.trim().slice(0, 40)).slice(0, 20));
  log("CROSSHAIR textos DOM visibles con RS/OHLC:", JSON.stringify(dom));
  await ctx.close();
}
await browser.close();
