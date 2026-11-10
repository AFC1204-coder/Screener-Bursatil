// Capturas D6/D9 (Listas, Research Desk, screener). Uso: node capturar.mjs <repo> <outdir> <prefijo>
// Mismo patrón que research/redesign-2026-11/implementacion/pantallas/capturar.mjs. No imprime el token.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir, prefix = "antes"] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const line = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const pantallas = [
  // El screener primero: deja en localStorage la ficha del nocturno, como en la auditoría.
  ["screener", "/", 14000],
  ["listas", "/lists", 16000],
  ["research-desk", "/research-desk", 9000],
];
const sizes = [[1440, 900], [390, 844]];
const log = [];
const browser = await chromium.launch({ channel: "chrome" });
for (const [w, h] of sizes) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  let current = "";
  page.on("console", (msg) => { if (msg.type() === "error" || msg.type() === "warning") log.push({ size: w, page: current, type: msg.type(), text: msg.text().slice(0, 300) }); });
  page.on("pageerror", (err) => log.push({ size: w, page: current, type: "pageerror", text: String(err).slice(0, 300) }));
  for (const [name, path, wait] of pantallas) {
    current = name;
    try {
      const t0 = Date.now();
      await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(wait);
      await page.screenshot({ path: `${outdir}/${prefix}-${name}-${w}.png` });
      const text = await page.evaluate(() => document.body.innerText);
      writeFileSync(`${outdir}/${prefix}-${name}-${w}.txt`, text);
      console.log("ok", name, w, `${Date.now() - t0} ms`);
    } catch (e) { console.log("fallo", name, w, String(e).slice(0, 120)); }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${outdir}/${prefix}-log.json`, JSON.stringify(log, null, 2));
console.log("consola:", log.length, "mensajes");
