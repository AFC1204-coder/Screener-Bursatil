// Uso: node ficha.mjs <repo> <outdir> <prefijo> [vps=390x844,360x740,844x390,1440x900] [syms=AAPL,KO,TJGC,XTER,ZZZZNOEXISTE]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, outdir, prefix, vpsArg, symsArg] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:3320";
const src = readFileSync(repo + "/.env.local", "utf8");
const line = src.split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
mkdirSync(outdir, { recursive: true });
const vps = (vpsArg || "390x844,360x740,844x390,1440x900").split(",").map((s) => s.split("x").map(Number));
const syms = (symsArg || "AAPL,KO,TJGC,XTER,ZZZZNOEXISTE").split(",");
const browser = await chromium.launch({ channel: "chrome" });
const out = [];
for (const [w, h] of vps) {
  const mobile = w < 1000;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
  for (const sym of syms) {
    const page = await ctx.newPage();
    const errors = [];
    const reqs = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
    page.on("pageerror", (e) => errors.push("pageerror " + String(e).slice(0, 200)));
    page.on("request", (r) => { const u = r.url(); if (u.includes("/api/")) reqs.push(u.replace(BASE, "").split("?")[0]); });
    try {
      await page.goto(`${BASE}/stock/${sym}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForTimeout(7000);
      await page.addStyleTag({ content: "*{caret-color:transparent!important} nextjs-portal{display:none!important}" });
      await page.waitForTimeout(300);
      const tag = `${prefix}-${sym}-${w}x${h}`;
      await page.screenshot({ path: `${outdir}/${tag}.png` });
      if (!mobile || process.env.FULL) await page.screenshot({ path: `${outdir}/${tag}-completa.png`, fullPage: true });
      const m = await page.evaluate(() => {
        const r = (sel) => { const n = document.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y + scrollY), w: Math.round(b.width), h: Math.round(b.height), visible: b.width > 0 && b.height > 0 }; };
        const readout = document.querySelector(".universalChartReadout");
        const small = [];
        for (const n of document.querySelectorAll("a,button,summary,input,select,[role=button]")) {
          const b = n.getBoundingClientRect();
          const cs = getComputedStyle(n);
          if (!b.width || !b.height || cs.visibility === "hidden") continue;
          if (b.bottom < 0 || b.top > innerHeight) continue; // primer viewport
          if (b.height < 44 || b.width < 44) small.push(`${n.tagName}.${String(n.className && n.className.baseVal === undefined ? n.className : "").slice(0,30)} ${(n.textContent || n.getAttribute("aria-label") || n.tagName).trim().slice(0, 24)} ${Math.round(b.width)}x${Math.round(b.height)}`);
        }
        return {
          canvas: r(".universalChartCanvas"), card: r(".chartIdentityCard"), ticket: r(".stockTicket"), topbar: r(".topbar"), bottomNav: r(".bottomNav"),
          readout: readout ? { text: readout.textContent || getComputedStyle(readout, "::before").content, display: getComputedStyle(readout).display, ...r(".universalChartReadout") } : null,
          fresh: document.querySelector(".stockMobileFreshness")?.textContent || null,
          scrollW: document.documentElement.scrollWidth, innerW: innerWidth, docH: document.documentElement.scrollHeight,
          small,
        };
      });
      out.push({ sym, vp: `${w}x${h}`, ...m, errors, reqs });
      console.log(JSON.stringify({ sym, vp: `${w}x${h}`, canvasY: m.canvas?.y, canvasH: m.canvas?.h, card: m.card, readout: m.readout?.text, fresh: m.fresh, small: m.small.length, overflow: m.scrollW > m.innerW, errors: errors.length }));
    } catch (e) { console.log("fallo", sym, w, String(e).slice(0, 160)); }
    await page.close();
  }
  await ctx.close();
}
writeFileSync(`${outdir}/${prefix}-medidas.json`, JSON.stringify(out, null, 2));
await browser.close();
