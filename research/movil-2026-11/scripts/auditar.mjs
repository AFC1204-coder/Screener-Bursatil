// Auditoría móvil de StatsEdge (solo lectura). Uso:
//   node auditar.mjs <repo> <outdir> [anchos=390x844,360x740,768x1024] [rutas=all]
// Lee STATSEDGE_ACCESS_TOKEN de .env.local sin imprimirlo; sesión vía POST /api/auth/session.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir, sizesArg = "390x844,360x740,768x1024", routesArg = "all"] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const token = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l)).replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });

// [nombre, ruta, selector de "primer contenido útil"]
const ROUTES = [
  ["01-screener", "/", ".mobileResultRow, .huntTapeRow, .mesaEmptyCard, .mobileEmpty"],
  ["02-ficha-AAPL", "/stock/AAPL", ".universalChartCanvas canvas"],
  ["03-listas", "/lists", ".listsPage table tbody tr, .listRow, .listsTable tr, main h1"],
  ["04-research", "/research-desk", "main h1"],
  ["05-review", "/review", "main h1"],
  ["06-sectores", "/sectors", "main h1"],
  ["07-mercado", "/market-health", "main h1"],
  ["08-ipo-radar", "/ipo-radar", "main h1"],
  ["09-404", "/ruta-que-no-existe", "main h1, h1"],
].filter(([n]) => routesArg === "all" || routesArg.split(",").some((r) => n.includes(r)));

const SIZES = sizesArg.split(",").map((s) => s.split("x").map(Number));

// Métricas de layout evaluadas en la página.
const measureFn = () => {
  const vw = innerWidth, vh = innerHeight;
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity !== 0; };
  const label = (el) => { const cls = (el.className && typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 2).join(".") : ""); const t = (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24); return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}「${t}」`; };
  const inter = [...document.querySelectorAll("a[href], button, input:not([type=hidden]), select, summary, [role=button], [role=tab], [role=option], textarea")].filter(vis);
  const small44 = [], small24 = [];
  for (const el of inter) {
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > document.documentElement.scrollHeight) continue;
    if (r.width < 44 || r.height < 44) small44.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    if (r.width < 24 || r.height < 24) small24.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  // Texto < 12 px (elementos con texto propio)
  const tiny = new Map(); let textEls = 0;
  for (const el of document.querySelectorAll("body *")) {
    if (!vis(el)) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
    if (!own) continue;
    textEls++;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) { const k = `${fs}px`; tiny.set(k, (tiny.get(k) || 0) + 1); }
  }
  const tinyExamples = [...document.querySelectorAll("body *")].filter((el) => vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).slice(0, 8).map((el) => `${label(el)} ${getComputedStyle(el).fontSize}`);
  // Desborde horizontal
  const scrollW = document.documentElement.scrollWidth;
  const overflow = [...document.querySelectorAll("body *")].filter((el) => { if (!vis(el)) return false; const r = el.getBoundingClientRect(); return r.right > vw + 1 && getComputedStyle(el).position !== "fixed"; }).slice(0, 6).map((el) => `${label(el)} right=${Math.round(el.getBoundingClientRect().right)}`);
  // Cromos fijos/pegajosos
  const chrome = [...document.querySelectorAll("body *")].filter((el) => { const p = getComputedStyle(el).position; return (p === "fixed" || p === "sticky") && vis(el); }).map((el) => { const r = el.getBoundingClientRect(); return { el: label(el), top: Math.round(r.top), h: Math.round(r.height), w: Math.round(r.width) }; }).filter((c) => c.h >= 20 && c.w >= vw * 0.5);
  const topBar = document.querySelector(".appTopBar")?.getBoundingClientRect();
  const bottomNav = document.querySelector(".bottomNav")?.getBoundingClientRect();
  const navItems = [...document.querySelectorAll(".bottomNav .navItem")].map((a) => { const r = a.getBoundingClientRect(); const lab = a.querySelector(".navLabel"); return `${Math.round(r.width)}x${Math.round(r.height)}${lab && getComputedStyle(lab).display === "none" ? " sin-etiqueta" : ""}`; });
  const usableBottom = bottomNav && bottomNav.height ? bottomNav.top : vh;
  const rows = [...document.querySelectorAll(".mobileResultRow, .huntTapeRow")];
  const firstRow = rows[0]?.getBoundingClientRect();
  const rowsVisible = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= usableBottom; }).length;
  const rowH = rows.slice(0, 5).map((r) => Math.round(r.getBoundingClientRect().height));
  const fonts = [...new Set([...document.querySelectorAll("body *")].slice(0, 400).map((el) => getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "")))].slice(0, 5);
  const h1 = document.querySelector("main h1, h1");
  return {
    vw, vh, scrollW, hScroll: scrollW > vw, overflow,
    docH: document.documentElement.scrollHeight, pantallas: +(document.documentElement.scrollHeight / vh).toFixed(1),
    interactivos: inter.length, menos44: small44.length, menos24: small24.length, ej44: small44.slice(0, 10), ej24: small24.slice(0, 6),
    textEls, texto12: [...tiny.entries()], ejTexto12: tinyExamples,
    topBarH: topBar ? Math.round(topBar.height) : null, bottomNavTop: bottomNav ? Math.round(bottomNav.top) : null, bottomNavH: bottomNav ? Math.round(bottomNav.height) : null, navItems,
    chrome,
    h1: h1 ? { text: h1.textContent.trim().slice(0, 40), y: Math.round(h1.getBoundingClientRect().top), fs: getComputedStyle(h1).fontSize } : null,
    filas: rows.length, firstRowY: firstRow ? Math.round(firstRow.top) : null, filasVisibles: rowsVisible, altoFila: rowH,
    fuentes: fonts,
  };
};

const jankFn = async () => {
  // Desplaza 3 pantallas en 1,5 s con rAF y mide fotogramas y tareas largas.
  const longs = []; let po;
  try { po = new PerformanceObserver((l) => l.getEntries().forEach((e) => longs.push(Math.round(e.duration)))); po.observe({ type: "longtask", buffered: false }); } catch {}
  const frames = []; let last = performance.now();
  const total = innerHeight * 3, dur = 1500; const t0 = performance.now(); const y0 = scrollY;
  await new Promise((res) => { const step = (t) => { frames.push(t - last); last = t; const p = Math.min(1, (t - t0) / dur); scrollTo(0, y0 + total * p); if (p < 1) requestAnimationFrame(step); else res(); }; requestAnimationFrame(step); });
  await new Promise((r) => setTimeout(r, 200));
  po?.disconnect();
  const f = frames.slice(1).sort((a, b) => a - b);
  const p95 = f[Math.floor(f.length * 0.95)] || 0;
  return { fotogramas: f.length, p95: +p95.toFixed(1), max: +(f[f.length - 1] || 0).toFixed(1), sobre33: f.filter((x) => x > 33.4).length, tareasLargas: longs };
};

const results = [];
const browser = await chromium.launch({ channel: "chrome" });
for (const [w, h] of SIZES) {
  const mobile = w < 768;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 2, isMobile: mobile, hasTouch: true, userAgent: mobile ? "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" : undefined });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  for (const [name, path, ready] of ROUTES) {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send("Network.enable");
    const reqs = new Map();
    cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0, t0: e.timestamp }));
    cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.t1 = e.timestamp; } });
    cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) r.enc = e.response.headers["content-encoding"] || e.response.headers["Content-Encoding"] || ""; });
    const out = { name, size: `${w}x${h}`, path };
    try {
      const t0 = Date.now();
      await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 120000 });
      out.dclMs = Date.now() - t0;
      try { await page.waitForSelector(ready, { timeout: 45000, state: "visible" }); out.primerContenidoMs = Date.now() - t0; } catch { out.primerContenidoMs = null; }
      await page.waitForTimeout(5000);
      out.estableMs = Date.now() - t0;
      out.m = await page.evaluate(measureFn);
      const list = [...reqs.values()].filter((r) => r.url.startsWith("http"));
      const api = list.filter((r) => r.url.includes("/api/"));
      out.peticiones = list.length; out.kb = Math.round(list.reduce((s, r) => s + (r.bytes || 0), 0) / 1024);
      out.api = api.map((r) => `${r.url.replace(BASE, "").split("?")[0]}${r.url.includes("?") ? "?" + r.url.split("?")[1].slice(0, 50) : ""} ${Math.round((r.bytes || 0) / 1024)}KB${r.enc ? " " + r.enc : " sin-compr"}`);
      out.kbApi = Math.round(api.reduce((s, r) => s + (r.bytes || 0), 0) / 1024);
      out.kbJs = Math.round(list.filter((r) => r.type === "Script").reduce((s, r) => s + (r.bytes || 0), 0) / 1024);
      out.kbImg = Math.round(list.filter((r) => r.type === "Image").reduce((s, r) => s + (r.bytes || 0), 0) / 1024);
      out.nImg = list.filter((r) => r.type === "Image").length;
      await page.screenshot({ path: `${outdir}/${name}-${w}.png` });
      if (w === 390) await page.screenshot({ path: `${outdir}/${name}-${w}-completa.png`, fullPage: true });
      out.jank = await page.evaluate(jankFn);
      await page.evaluate(() => scrollTo(0, 0));
      // Interacciones del screener a 390 y 360
      if (name === "01-screener" && w < 768) {
        const act = {};
        const fil = page.locator(".screenerMobileSubBarBtn", { hasText: "Filtros" }).first();
        if (await fil.count()) {
          await fil.click(); await page.waitForTimeout(1200);
          await page.screenshot({ path: `${outdir}/${name}-${w}-filtros.png` });
          act.filtros = await page.evaluate(() => { const d = document.querySelector(".mobileFilters, .sidebar.open, aside[class*=Sidebar], .screenerSidebar"); const r = d?.getBoundingClientRect(); return r ? { el: d.className.slice(0, 60), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), scrollH: d.scrollHeight } : null; });
          await page.screenshot({ path: `${outdir}/${name}-${w}-filtros-completa.png`, fullPage: true });
          await page.keyboard.press("Escape").catch(() => {});
          await page.goto(BASE + path, { waitUntil: "domcontentloaded" }); await page.waitForSelector(ready, { timeout: 45000 }).catch(() => {}); await page.waitForTimeout(3000);
        }
        const ficha = page.locator(".screenerMobileSubBarFicha summary").first();
        if (await ficha.count()) {
          await ficha.click(); await page.waitForTimeout(700);
          await page.screenshot({ path: `${outdir}/${name}-${w}-vistas.png` });
          act.vistas = await page.evaluate(() => [...document.querySelectorAll(".screenerMobileSubBarFichaMenu button")].map((b) => { const r = b.getBoundingClientRect(); return `${b.textContent.trim()} ${Math.round(r.width)}x${Math.round(r.height)}`; }));
          await ficha.click(); await page.waitForTimeout(300);
        }
        const row = page.locator(".mobileResultRow").first();
        if (await row.count()) {
          const tq = Date.now();
          await row.locator(".mobileResultGrid").first().click({ position: { x: 20, y: 10 } });
          await page.waitForTimeout(400);
          try { await page.waitForSelector(".stockModal[open], dialog[open], .quickReviewModal, [role=dialog]", { timeout: 15000 }); act.vistaRapidaMs = Date.now() - tq; } catch { act.vistaRapidaMs = null; }
          await page.waitForTimeout(3500);
          await page.screenshot({ path: `${outdir}/${name}-${w}-vista-rapida.png` });
          act.vistaRapida = await page.evaluate(measureFn).then((m) => ({ menos44: m.menos44, ej44: m.ej44.slice(0, 8), texto12: m.texto12 })).catch(() => null);
          act.vistaRapidaDialog = await page.evaluate(() => { const d = document.querySelector(".stockModal[open], dialog[open], [role=dialog]"); if (!d) return null; const r = d.getBoundingClientRect(); return { cls: d.className.slice(0, 60), y: Math.round(r.top), h: Math.round(r.height), scrollH: d.scrollHeight, texto: d.innerText.replace(/\s+/g, " ").slice(0, 400) }; });
          await page.screenshot({ path: `${outdir}/${name}-${w}-vista-rapida-scroll.png`, fullPage: false });
        }
        out.interacciones = act;
      }
      if (name === "02-ficha-AAPL" && w === 390) {
        const c = await page.$(".universalChartCanvas");
        if (c) { await c.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await page.screenshot({ path: `${outdir}/${name}-${w}-grafico.png` }); out.grafico = await page.evaluate(() => { const r = document.querySelector(".universalChartCanvas").getBoundingClientRect(); return { yAbs: Math.round(r.top + scrollY), w: Math.round(r.width), h: Math.round(r.height) }; }); }
        // Horizontal
        await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(1500);
        const c2 = await page.$(".universalChartCanvas"); if (c2) { await c2.scrollIntoViewIfNeeded(); await page.waitForTimeout(500); }
        await page.screenshot({ path: `${outdir}/${name}-844x390-horizontal.png` });
        out.horizontal = await page.evaluate(() => { const r = document.querySelector(".universalChartCanvas")?.getBoundingClientRect(); const bn = document.querySelector(".bottomNav")?.getBoundingClientRect(); return { canvas: r && `${Math.round(r.width)}x${Math.round(r.height)}`, bottomNavH: bn && Math.round(bn.height), topBarH: Math.round(document.querySelector(".appTopBar")?.getBoundingClientRect().height || 0), hScroll: document.documentElement.scrollWidth > innerWidth }; });
      }
    } catch (e) { out.error = String(e).slice(0, 200); }
    results.push(out);
    console.log(JSON.stringify(out));
    await page.close();
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${outdir}/auditoria.json`, JSON.stringify(results, null, 1));
