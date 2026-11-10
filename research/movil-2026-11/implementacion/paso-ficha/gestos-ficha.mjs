// Arrastre, pellizco, botón de zoom y lectura del cursor en la ficha móvil.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const [repo, sym = "AAPL", vp = "390x844"] = process.argv.slice(2);
const require = createRequire(repo + "/package.json");
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:3320";
const line = readFileSync(repo + "/.env.local", "utf8").split(/\r?\n/).find((l) => /^STATSEDGE_ACCESS_TOKEN\s*=/.test(l));
const token = line.replace(/^STATSEDGE_ACCESS_TOKEN\s*=\s*/, "").trim().replace(/^['"]|['"]$/g, "");
const [w, h] = vp.split("x").map(Number);
const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await ctx.request.post(`${BASE}/api/auth/session`, { headers: { "Content-Type": "application/json" }, data: { token } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto(`${BASE}/stock/${sym}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(7000);
const cdp = await ctx.newCDPSession(page);
const snap = () => page.evaluate(() => { const s = window.__chartViewportSnapshot?.() || {}; return { bars: s.view?.visibleBars ?? null, manual: !!s.manual, label: s.visibleWindowLabel || "" }; });
const box = await page.locator(".universalChartCanvas").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x, y, id: i })) });
const out = { sym, vp, canvas: box };
out.inicial = await snap();
// Arrastre horizontal de un dedo.
await touch("touchStart", [[cx + 100, cy]]);
for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx + 100 - i * 20, cy]]); await page.waitForTimeout(16); }
await touch("touchEnd", []);
await page.waitForTimeout(400);
out.trasArrastre = await snap();
// Pellizco (abrir dedos = acercar).
await touch("touchStart", [[cx - 30, cy], [cx + 30, cy]]);
for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx - 30 - i * 8, cy], [cx + 30 + i * 8, cy]]); await page.waitForTimeout(16); }
await touch("touchEnd", []);
await page.waitForTimeout(400);
out.trasPellizco = await snap();
// Botón de acercar (44 px).
const zoomBtn = page.locator('.universalChartNavButton[aria-label="Acercar gráfico"]');
if (await zoomBtn.isVisible()) {
  const zb = await zoomBtn.boundingBox();
  out.botonZoomCaja = `${Math.round(zb.width)}x${Math.round(zb.height)}`;
  await zoomBtn.tap();
  await page.waitForTimeout(300);
  out.trasBotonZoom = await snap();
} else out.trasBotonZoom = "botonera oculta (horizontal)";
// Lectura: toque largo sobre el lienzo → crosshair → la línea cambia de fecha.
const readout = () => page.evaluate(() => { const n = document.querySelector(".universalChartReadout"); return n.textContent || `(defecto) ${n.dataset.default || ""}`; });
out.lecturaReposo = await readout();
await touch("touchStart", [[box.x + box.width * 0.3, cy]]);
await page.waitForTimeout(700);
out.lecturaToque = await readout();
await touch("touchEnd", []);
// Scroll vertical de la página arrastrando sobre el lienzo (touch-action: pan-y).
const y0 = await page.evaluate(() => scrollY);
await touch("touchStart", [[cx, cy + 100]]);
for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx, cy + 100 - i * 25]]); await page.waitForTimeout(16); }
await touch("touchEnd", []);
await page.waitForTimeout(600);
out.scrollVertical = { antes: y0, despues: await page.evaluate(() => scrollY) };
// Control: mismo gesto fuera del lienzo (sobre la tarjeta / rangos).
const y1 = await page.evaluate(() => scrollY);
const ctlY = Math.min(h - 80, box.y + box.height + 60);
await touch("touchStart", [[cx, ctlY]]);
for (let i = 1; i <= 10; i++) { await touch("touchMove", [[cx, ctlY - i * 25]]); await page.waitForTimeout(16); }
await touch("touchEnd", []);
await page.waitForTimeout(600);
out.scrollControlFueraLienzo = { antes: y1, despues: await page.evaluate(() => scrollY) };
// Pliegue: abrir «Noticias».
const fold = page.locator(".stockMobileFoldToggle", { hasText: "Noticias" });
if (await fold.count() && await fold.isVisible()) {
  await fold.scrollIntoViewIfNeeded();
  await fold.tap();
  await page.waitForTimeout(300);
  out.pliegueNoticias = await page.evaluate(() => { const b = [...document.querySelectorAll(".stockMobileFoldToggle")].find((n) => n.textContent.includes("Noticias")); const s = b.nextElementSibling; return { expanded: b.getAttribute("aria-expanded"), visible: s ? s.getBoundingClientRect().height : 0 }; });
}
out.errores = errors;
console.log(JSON.stringify(out, null, 1));
await browser.close();
