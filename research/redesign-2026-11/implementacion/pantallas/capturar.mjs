// Captura de todas las pantallas modificadas. Uso: node capturar.mjs <repo> <outdir>
import { readFileSync, mkdirSync } from "node:fs";
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
  ["01-screener", "/"],
  ["02-listas", "/lists"],
  ["03-research-desk", "/research-desk"],
  ["04-review", "/review"],
  ["05-ficha-simbolo", "/stock/AAPL"],
  ["06-ficha-desconocida", "/stock/ZZZZNOEXISTE"],
  ["07-buscador-fichas", "/stock"],
  ["08-sectores", "/sectors"],
  ["09-market-health", "/market-health"],
  ["10-ipo-radar", "/ipo-radar"],
  ["11-404", "/ruta-que-no-existe"],
];
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
const page = await ctx.newPage();
for (const [name, path] of pantallas) {
  try {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForTimeout(6000);
    await page.screenshot({ path: `${outdir}/${name}.png` });
    console.log("ok", name);
  } catch (e) { console.log("fallo", name, String(e).slice(0, 120)); }
}
await browser.close();
