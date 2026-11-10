// Capturas y medidas del prototipo. Uso: node capturar-prototipo.mjs <repo> <outdir>
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
const [repo, outdir] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const url = `file://${repo}/research/movil-2026-11/prototipo/index.html?capture`;
const browser = await chromium.launch({ channel: "chrome" });
const out = {};
const shots = [["screener", 390, 844], ["filtros", 390, 844], ["peek", 390, 844], ["ficha", 390, 844], ["ficha-h", 844, 390], ["listas", 390, 844], ["mas", 390, 844], ["carga", 390, 844], ["vacio", 390, 844], ["retrasados", 390, 844], ["screener", 360, 740]];
for (const [h, w, ht] of shots) {
  const ctx = await browser.newContext({ viewport: { width: w, height: ht }, deviceScaleFactor: 3, hasTouch: true, isMobile: w < 768 });
  const page = await ctx.newPage();
  await page.goto(`${url}#${h}`); await page.waitForTimeout(600);
  if (w === 360) await page.evaluate(() => { const p = document.getElementById("phone"); p.style.width = "360px"; p.style.height = "740px"; });
  if (h === "ficha") { const b = await page.$("#fx-chart"); const bb = await b.boundingBox(); await page.mouse.move(bb.x + bb.width * 0.62, bb.y + 100); await page.waitForTimeout(200); }
  const m = await page.evaluate(() => {
    const scr = document.querySelector(".screen.on"); const vh = scr.getBoundingClientRect().height;
    const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden"; };
    const tabs = scr.querySelector(".tabs")?.getBoundingClientRect();
    const rows = [...scr.querySelectorAll(".row")].filter(vis);
    const sheetOn = document.querySelector(".sheet.on");
    const ctx = sheetOn || scr;
    const inter = [...ctx.querySelectorAll("button, a, [role=button], summary, .sw")].filter(vis).filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    // objetivo efectivo: incluye ::after ampliado en .vpill/.seg (se mide la caja + 12 px)
    const small = inter.filter((el) => { const r = el.getBoundingClientRect(); const ext = el.matches(".vpill") ? 12 : el.matches(".seg button") ? 4 : 0; return (r.height + ext) < 44 && !el.matches(".sw, .row"); }).map((el) => `${el.className || el.tagName} ${Math.round(el.getBoundingClientRect().width)}x${Math.round(el.getBoundingClientRect().height)}`);
    const tiny = [...ctx.querySelectorAll("*")].filter((el) => vis(el) && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => `${el.tagName}.${el.className} ${getComputedStyle(el).fontSize}`);
    return { firstRowY: rows[0] ? Math.round(rows[0].getBoundingClientRect().top) : null, filasVisibles: rows.filter((r) => r.getBoundingClientRect().bottom <= (tabs ? tabs.top : innerHeight)).length, menos44: small.length, ej: small.slice(0, 6), texto12: tiny.length, ejTexto: [...new Set(tiny)].slice(0, 4), hScroll: document.documentElement.scrollWidth > innerWidth };
  });
  out[`${h}-${w}`] = m;
  await page.screenshot({ path: `${outdir}/${h}-${w}.png` });
  console.log(h, w, JSON.stringify(m));
  await ctx.close();
}
writeFileSync(`${outdir}/medidas-prototipo.json`, JSON.stringify(out, null, 1));
await browser.close();
