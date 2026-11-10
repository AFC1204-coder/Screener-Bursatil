// Propuesta 2 «decidir la entrada» · capturas antes/después del chip de pivote
// y riesgo (cinta) y del bloque «Entrada» (panel y vista rápida móvil).
// Uso: node capturar.mjs <repo> <outdir> <antes|despues>
// Token leído de .env.local sin imprimirlo. Solo GET contra :3320 (no abre
// fichas ni /api/chart: nada que haga a la app escribir caché).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir, phase = "antes"] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const line = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const log = { phase };
const browser = await chromium.launch({ channel: "chrome" });

async function session(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text().slice(0, 240)); });
  page.on("pageerror", (err) => errors.push(`pageerror: ${String(err).slice(0, 240)}`));
  return { ctx, page, errors };
}

// ── Escritorio 1440×900 ──
{
  const { ctx, page, errors } = await session({ width: 1440, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".huntTapeRow", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(8000);
  log.escritorio = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".huntTapeRow")];
    const heights = rows.slice(0, 40).map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10);
    const head = [...document.querySelectorAll(".huntTapeHead span")].map((s) => s.textContent.trim());
    const pivots = rows.map((r) => r.querySelector(".huntTapePivot")?.textContent?.trim() || null);
    const withRisk = pivots.filter((t) => t && /R \d/.test(t)).length;
    const firstWithRisk = pivots.findIndex((t) => t && /R \d/.test(t));
    const list = document.querySelector(".huntTapeList");
    const sw = document.documentElement.scrollWidth;
    return {
      rowCount: rows.length,
      rowHeights: [...new Set(heights)],
      head,
      chipsMuestra: pivots.slice(0, 8),
      filasConRiesgo: withRisk,
      primeraConRiesgo: firstWithRisk,
      listaScrollWidth: list ? [list.scrollWidth, list.clientWidth] : null,
      pageScrollWidth: sw,
    };
  });
  await page.screenshot({ path: `${outdir}/${phase}-screener-1440.png` });
  // Panel: si hay una fila con riesgo, llevar el foco hasta ella con «j».
  const target = Math.max(0, log.escritorio.primeraConRiesgo ?? 0);
  await page.locator(".huntTapeList").focus();
  for (let i = 0; i < target; i += 1) await page.keyboard.press("j");
  await page.keyboard.press(" ");
  await page.waitForTimeout(1500);
  const panel = page.locator(".huntPeekPanel");
  if (await panel.count()) {
    log.escritorio.panelTexto = (await panel.innerText()).slice(0, 1200);
    log.escritorio.rowHeightsConPanel = await page.evaluate(() => [...new Set([...document.querySelectorAll(".huntTapeRow")].slice(0, 40).map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10))]);
    await page.screenshot({ path: `${outdir}/${phase}-panel-1440.png` });
    await panel.screenshot({ path: `${outdir}/${phase}-panel-solo-1440.png` }).catch(() => {});
  }
  log.escritorio.consola = errors;
  await ctx.close();
}

// ── Móvil 390×844 y 360×740 ──
for (const [w, h] of [[390, 844], [360, 740]]) {
  const { ctx, page, errors } = await session({ width: w, height: h }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".mobileTapeRow", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const key = `movil${w}`;
  log[key] = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".mobileTapeRow")];
    const vh = window.innerHeight;
    const nav = document.querySelector(".bottomNav, nav[class*='bottom' i]");
    const navTop = nav ? nav.getBoundingClientRect().top : vh;
    const limit = Math.min(vh, navTop);
    const visibles = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= 0 && b.bottom <= limit + 0.5; }).length;
    const enPantalla = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top < vh && b.bottom > 0; }).length;
    const first = rows[0]?.getBoundingClientRect();
    return {
      rowCount: rows.length,
      alturas: [...new Set(rows.slice(0, 30).map((r) => Math.round(r.getBoundingClientRect().height * 10) / 10))],
      primeraFilaY: first ? Math.round(first.top) : null,
      filasCompletasVisibles: visibles,
      filasTocandoPantalla: enPantalla,
      limiteInferior: Math.round(limit),
      chipsMuestra: rows.slice(0, 6).map((r) => r.querySelector(".mobileTapePivot")?.textContent?.trim() || null),
      nombresMuestra: rows.slice(0, 3).map((r) => r.querySelector(".mobileTapeName")?.textContent?.trim() || null),
      pageScrollWidth: document.documentElement.scrollWidth,
    };
  });
  await page.screenshot({ path: `${outdir}/${phase}-cinta-${w}.png` });
  const firstRow = page.locator(".mobileTapeRow").first();
  if (await firstRow.count()) {
    await firstRow.evaluate((el) => el.click());
    await page.waitForTimeout(1800);
    const sheet = page.locator(".mobilePeekSheet");
    if (await sheet.count()) {
      await page.screenshot({ path: `${outdir}/${phase}-vista-rapida-${w}.png` });
      const body = page.locator(".mobilePeekSheet .mobileSheetBody");
      const entry = page.locator(".mobilePeekSheet .entryBlock");
      if (await entry.count()) {
        await entry.evaluate((el) => el.scrollIntoView({ block: "start" }));
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${outdir}/${phase}-vista-rapida-entrada-${w}.png` });
      }
      log[key].vistaRapidaTexto = (await body.innerText().catch(() => "")).slice(0, 900);
    }
  }
  log[key].consola = errors;
  await ctx.close();
}

writeFileSync(`${outdir}/${phase}-log.json`, JSON.stringify(log, null, 2));
await browser.close();
console.log(JSON.stringify(log, null, 1).slice(0, 6000));
