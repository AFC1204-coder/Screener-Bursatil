import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const repo = process.argv[2];
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://localhost:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const line = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
const browser = await chromium.launch({ channel: "chrome" });
for (const [w,h] of [[390,844],[360,740]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/lists", { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForSelector(".listMobileRow", { timeout: 90000 }).catch(()=>{});
  await page.waitForTimeout(5000);
  const el = await page.$(".listMobileRow");
  if (el) { await el.scrollIntoViewIfNeeded(); await page.waitForTimeout(800); }
  const m = await page.evaluate(() => { const s=document.querySelector(".listMobileSpark svg"); const f=document.querySelector(".listMobileFacts"); return { spark: s?.getBoundingClientRect().height, facts: f?.getBoundingClientRect().height, hscroll: document.documentElement.scrollWidth > innerWidth }; });
  console.log(w, JSON.stringify(m));
  await page.screenshot({ path: `${repo}/research/auditoria-producto-2026-11/implementacion/listas-movil/despues-${w}.png` });
  await ctx.close();
}
await browser.close();
