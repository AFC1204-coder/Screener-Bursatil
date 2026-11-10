// Panel lateral (Space), vista Auditoría, «Entradas en Etapa 2» y ficha AAPL en semanal. Uso: node capturas2.mjs <repo> <outdir>
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const line = readFileSync(repo + "/.env.local", "utf8").split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
const page = await ctx.newPage();
const out = {};
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(9000);
// foco en la cinta y panel
await page.keyboard.press("j"); await page.waitForTimeout(500); await page.keyboard.press("Space"); await page.waitForTimeout(4000);
await page.screenshot({ path: `${outdir}/p10-screener-panel.png` });
out.panel = (await page.evaluate(() => document.body.innerText)).slice(0, 4000);
await page.keyboard.press("Escape"); await page.waitForTimeout(800);
// vista «Entradas en Etapa 2»
const entradas = page.getByText("Entradas en Etapa 2", { exact: false }).first();
if (await entradas.count()) { await entradas.click(); await page.waitForTimeout(4000); await page.screenshot({ path: `${outdir}/p11-esta-noche-entradas.png` }); out.entradas = (await page.evaluate(() => document.body.innerText)).slice(0, 3000); }
// Auditoría
const aud = page.getByText("Auditoría", { exact: true }).first();
if (await aud.count()) { await aud.click(); await page.waitForTimeout(3000); await page.screenshot({ path: `${outdir}/p12-screener-auditoria.png` }); }
// ficha AAPL semanal
await page.goto(BASE + "/stock/AAPL", { waitUntil: "domcontentloaded" }); await page.waitForTimeout(8000);
const w = page.locator("button", { hasText: /^W$/ }).first();
if (await w.count()) { await w.click(); await page.waitForTimeout(4000); await page.screenshot({ path: `${outdir}/p13-ficha-AAPL-semanal.png` }); }
writeFileSync(`${outdir}/log2.json`, JSON.stringify(out, null, 2));
await browser.close();
console.log("ok");
