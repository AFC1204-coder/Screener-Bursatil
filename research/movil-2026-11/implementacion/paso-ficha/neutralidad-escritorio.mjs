// Escritorio: captura con la ficha tal cual y tras retirar del DOM todo lo
// que añade el paso móvil (cabecera, botones de pliegue, data-default y
// stock-mobile.css). Si las dos capturas son idénticas, el paso no toca la
// ficha de escritorio.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, out, ...syms] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:3320";
const line = readFileSync(repo + "/.env.local", "utf8").split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
for (const sym of syms) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/stock/${sym}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  await page.addStyleTag({ content: "*{caret-color:transparent!important} nextjs-portal{display:none!important}" });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/antes-${sym}.png`, fullPage: true });
  const removed = await page.evaluate(() => {
    let n = 0;
    document.querySelectorAll(".stockMobileHead, .stockMobileFoldToggle").forEach((el) => { el.remove(); n++; });
    document.querySelectorAll("[data-default]").forEach((el) => { el.removeAttribute("data-default"); n++; });
    // En dev las hojas de la página van juntas: se borran solo las reglas
    // de stock-mobile.css (las que nombran stockMobile* o su media query).
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (let i = rules.length - 1; i >= 0; i--) {
        const t = rules[i].cssText || "";
        if (t.includes("stockMobile") || t.includes("max-height: 500px) and (max-width: 1000px)")) { sheet.deleteRule(i); n++; }
      }
    }
    return n;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/despues-${sym}.png`, fullPage: true });
  console.log(sym, "nodos/hojas retirados:", removed);
  await page.close();
}
await browser.close();
