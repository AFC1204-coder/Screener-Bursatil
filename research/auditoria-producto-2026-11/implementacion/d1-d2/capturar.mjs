// D1/D2 · capturas del grupo semanal del raíl («Esta noche» → «Semana 9 → 16 oct»)
// a 1440×900 y 390×844. Uso: node capturar.mjs <repo> <outdir>
// Token leído de .env.local sin imprimirlo. Solo GET contra :3320.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const line = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const log = {};
const browser = await chromium.launch({ channel: "chrome" });

async function session(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  const weekly = [];
  page.on("response", async (res) => {
    if (!res.url().includes("/api/weekly-changes")) return;
    try {
      const j = await res.json();
      weekly.push({
        url: res.url().replace(BASE, ""),
        state: j.state, reason: j.reason || null,
        window: j.window ? { from: j.window.from, to: j.window.to, fromWeekEnd: j.window.fromWeekEnd, toWeekEnd: j.window.toWeekEnd, fromScan: j.window.fromScan?.localId, toScan: j.window.toScan?.localId } : null,
        entries: j.stage2?.entries?.rows?.map((r) => `${r.symbol}:${r.stageTo}`) || null,
        validation: j.validation || null,
      });
    } catch { /* respuesta abortada */ }
  });
  return { ctx, page, weekly };
}

// Etapas pintadas en la cinta para las filas visibles: «2 · sem. 10».
const tapeStages = (page) => page.evaluate(() => {
  const text = document.body.innerText;
  // Escritorio «2 · sem. 10»; móvil «2·10».
  const found = [...text.matchAll(/\b([1-4]) ?· ?(?:sem\. )?(\d+)\b/g)].map((m) => m[1]);
  const counts = {};
  for (const s of found) counts[s] = (counts[s] || 0) + 1;
  return counts;
});

// ── Escritorio 1440×900 ──
{
  const { ctx, page, weekly } = await session({ width: 1440, height: 900 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(14000);
  const rail = page.locator(".screenerViewRail");
  log.escritorio = {
    cabeceras: await page.locator(".screenerViewRailGroup h3").allInnerTexts(),
    contieneEstaNoche: (await page.evaluate(() => document.body.innerText)).includes("Esta noche"),
  };
  await rail.screenshot({ path: `${outdir}/d2-rail-1440.png` }).catch(() => {});
  await page.screenshot({ path: `${outdir}/d2-screener-1440.png` });
  const entradas = page.locator('.screenerViewRailItem[data-view="entradas-e2"]');
  if (await entradas.count() && await entradas.isEnabled()) {
    await entradas.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${outdir}/d2-entradas-1440.png` });
    log.escritorio.etapasEnCintaTrasEntradas = await tapeStages(page);
  }
  const detalle = page.locator(".screenerViewRailDetail");
  if (await detalle.count()) {
    await detalle.click();
    await page.waitForTimeout(2500);
    const panel = page.locator(".weeklyChangesPanel");
    if (await panel.count()) {
      log.escritorio.panelTitulo = await panel.locator("h2").innerText();
      log.escritorio.panelPie = (await panel.locator(".weeklyChangesFoot").innerText()).slice(0, 400);
      await panel.screenshot({ path: `${outdir}/d2-panel-1440.png` });
    }
  }
  log.escritorio.api = weekly;
  await ctx.close();
}

// ── Móvil 390×844 ──
{
  const { ctx, page, weekly } = await session({ width: 390, height: 844 }, { isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForTimeout(14000);
  const label = page.locator(".mobileViewTabGroupLabel");
  log.movil = { rotulo: (await label.count()) ? await label.first().innerText() : null };
  if (await label.count()) {
    await label.first().evaluate((el) => el.scrollIntoView({ inline: "start", block: "nearest" }));
    await page.waitForTimeout(500);
  }
  await page.screenshot({ path: `${outdir}/d2-movil-390.png` });
  const tab = page.locator('.mobileViewTab[data-view="entradas-e2"]');
  if (await tab.count() && await tab.isEnabled()) {
    await tab.evaluate((el) => el.click());
    await page.waitForTimeout(5000);
    await page.locator(".mobileViewTabGroupLabel").first().evaluate((el) => el.scrollIntoView({ inline: "start", block: "nearest" })).catch(() => {});
    await page.screenshot({ path: `${outdir}/d2-movil-entradas-390.png` });
    log.movil.etapasEnCintaTrasEntradas = await tapeStages(page);
  }
  log.movil.api = weekly;
  await ctx.close();
}
writeFileSync(`${outdir}/log.json`, JSON.stringify(log, null, 2));
await browser.close();
console.log(JSON.stringify({ escritorio: { ...log.escritorio, api: log.escritorio?.api?.map((a) => ({ ...a, entries: a.entries?.length })) }, movil: { ...log.movil, api: log.movil?.api?.map((a) => ({ ...a, entries: a.entries?.length })) } }, null, 1));
