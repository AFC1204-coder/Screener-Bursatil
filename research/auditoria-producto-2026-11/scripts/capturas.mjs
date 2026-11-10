// Capturas 1440×900 de las pantallas principales + texto visible + peticiones /api. Uso: node capturas.mjs <repo> <outdir>
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
const pantallas = [
  ["p01-screener", "/"],
  ["p02-ficha-AAPL", "/stock/AAPL"],
  ["p03-review", "/review"],
  ["p04-listas", "/lists"],
  ["p05-research-desk", "/research-desk"],
  ["p06-sectores", "/sectors"],
  ["p07-market-health", "/market-health"],
  ["p08-ipo-radar", "/ipo-radar"],
];
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
const page = await ctx.newPage();
const log = {};
for (const [name, path] of pantallas) {
  const reqs = []; const errs = [];
  const onReq = (r) => { if (r.url().includes("/api/")) reqs.push(r.url().replace(BASE, "").slice(0, 120)); };
  const onCon = (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 200)); };
  page.on("request", onReq); page.on("console", onCon);
  const t0 = Date.now();
  try {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(9000);
    await page.screenshot({ path: `${outdir}/${name}.png` });
    await page.screenshot({ path: `${outdir}/${name}-completa.png`, fullPage: true });
    const text = await page.evaluate(() => document.body.innerText);
    writeFileSync(`${outdir}/${name}.txt`, text);
    const a11y = await page.evaluate(() => {
      const small = [...document.querySelectorAll("body *")].filter((e) => e.childElementCount === 0 && e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 11).length;
      const btnNoName = [...document.querySelectorAll("button,a,[role=button]")].filter((b) => !(b.innerText.trim() || b.getAttribute("aria-label") || b.getAttribute("title"))).length;
      return { textosMenos11px: small, controlesSinNombre: btnNoName, altoPagina: document.documentElement.scrollHeight };
    });
    log[name] = { ms: Date.now() - t0, api: reqs, errores: errs, ...a11y };
    console.log("ok", name, JSON.stringify(a11y), reqs.length, "api");
  } catch (e) { console.log("fallo", name, String(e).slice(0, 160)); }
  page.off("request", onReq); page.off("console", onCon);
}
// Foco de teclado en el screener: 8 tabulaciones y captura
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(8000);
const focos = [];
for (let i = 0; i < 12; i++) { await page.keyboard.press("Tab"); focos.push(await page.evaluate(() => { const e = document.activeElement; const s = getComputedStyle(e); return `${e.tagName}.${(e.className || "").toString().slice(0, 30)} "${(e.innerText || e.getAttribute("aria-label") || "").slice(0, 25)}" outline=${s.outlineStyle}/${s.outlineWidth} shadow=${s.boxShadow !== "none"}`; })); }
log.focoTeclado = focos;
await page.screenshot({ path: `${outdir}/p09-foco-teclado.png` });
writeFileSync(`${outdir}/log.json`, JSON.stringify(log, null, 2));
await browser.close();
