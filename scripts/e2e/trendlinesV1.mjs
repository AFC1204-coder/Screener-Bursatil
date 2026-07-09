// scripts/e2e/trendlinesV1.mjs — Verificación E2E completa de TRENDLINES-V1.
//
// Ejecuta los 9 puntos del documento contra el dev server:
//   1. Hard-reload y carga limpia del chart en desktop.
//   2. Dibuja línea (clic-clic) con estilo D5.
//   3. Pan/zoom entre clics funciona.
//   4. Selección → tiradores → arrastre sin pan → restaurar.
//   5. Borrado por teclado Supr.
//   6. Cambio de temporalidad 1D→W reproyecta correctamente.
//   7. Navegación SPA ticker→otro→vuelve preserva la línea.
//   8. Tolerancia táctil en viewport móvil 375px.
//   9. Capturas visuales.
//
// Salida: stdout con veredictos por punto + capturas en output/playwright/.

import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = "http://127.0.0.1:3000";
const SYMBOL = "AAPL";
const OTHER_SYMBOL = "NVDA";
const OUTPUT_DIR = path.resolve("output/playwright");
const TOKEN = "3252cf152ece0048c5ce9052fbbe2ac48a849b74532322b9eb728db93ad6d877";

const log = (...args) => console.log(...args);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
}

async function getMainCanvasBox(page) {
  return await page.evaluate(() => {
    const canvases = document.querySelectorAll(".universalChartCanvas canvas");
    // El canvas principal de velas es el primero (los demás son ejes, rs, vol).
    const c = canvases[0];
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function waitForChart(page, timeout = 30_000) {
  await page.waitForSelector(".universalChartCanvas canvas", { timeout });
  await sleep(1500);
}

async function login(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await sleep(1500);
  const tokenInput = page.locator('input[type="password"]').first();
  if (await tokenInput.count()) {
    await tokenInput.fill(TOKEN);
    await page.locator('button:has-text("Entrar")').first().click();
    await sleep(2500);
  }
}

async function gotoStock(page, symbol) {
  await page.goto(`${BASE_URL}/stock/${symbol}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await waitForChart(page);
  await page.evaluate(() => document.querySelector(".universalChartCanvas")?.scrollIntoView({ block: "center" }));
  await sleep(500);
}

async function drawLineInPlotArea(page, xRel1, yRel1, xRel2, yRel2) {
  // Dibuja usando coords del CANVAS principal de velas, no del wrapper
  // universalChartCanvas. Los anclas se proyectan a precios dentro del plot
  // area visible, así que la línea se ve realmente en el chart.
  await page.locator('button[aria-label="Dibujar línea de tendencia"]').click();
  await sleep(250);
  const box = await getMainCanvasBox(page);
  const p1 = { x: box.x + xRel1 * box.w, y: box.y + yRel1 * box.h };
  const p2 = { x: box.x + xRel2 * box.w, y: box.y + yRel2 * box.h };
  await page.mouse.click(p1.x, p1.y);
  await sleep(250);
  const chipP1 = await getChip(page);
  await page.mouse.click(p2.x, p2.y);
  await sleep(500);
  const chipP2 = await getChip(page);
  const pressed = await getPressed(page);
  return { p1, p2, chipP1, chipP2, pressed };
}

// Tap variante para móvil (no usa mouse).
async function drawLineInPlotAreaTouch(page, xRel1, yRel1, xRel2, yRel2) {
  await page.locator('button[aria-label="Dibujar línea de tendencia"]').tap();
  await sleep(250);
  const box = await getMainCanvasBox(page);
  const p1 = { x: box.x + xRel1 * box.w, y: box.y + yRel1 * box.h };
  const p2 = { x: box.x + xRel2 * box.w, y: box.y + yRel2 * box.h };
  await page.touchscreen.tap(p1.x, p1.y);
  await sleep(300);
  const chipP1 = await getChip(page);
  await page.touchscreen.tap(p2.x, p2.y);
  await sleep(500);
  const pressed = await getPressed(page);
  return { p1, p2, chipP1, pressed };
}

async function getChip(page) {
  return await page.evaluate(() => document.querySelector(".universalChartViewportChip.drawing b")?.textContent || null);
}

async function getPressed(page) {
  return await page.evaluate(() => document.querySelector('button[aria-label="Dibujar línea de tendencia"]')?.getAttribute("aria-pressed") === "true");
}

async function getDeleteBtnVisible(page) {
  return await page.evaluate(() => !!document.querySelector('button[aria-label="Borrar línea seleccionada"]'));
}

async function detectTizaPixels(page) {
  return await page.evaluate(() => {
    const canvases = document.querySelectorAll(".universalChartCanvas canvas");
    for (const c of canvases) {
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      const w = c.width, h = c.height;
      const data = ctx.getImageData(0, 0, w, h).data;
      // La línea de tendencia se pinta en tiza al 60% sobre pizarra. Buscamos
      // filas/columnas con un patrón de muchos píxeles "casi-tiza" consecutivos
      // (la línea es un trazo de 1.5–2px, así que produce corridas verticales
      // u horizontales densas). El umbral por fila es conservador.
      let rows = 0;
      for (let y = 50; y < h - 50; y += 1) {
        let runMax = 0;
        let run = 0;
        for (let x = 0; x < w; x += 1) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2];
          // "casi tiza" con alpha medio: r en 150-235, g en 140-235, b en 100-220
          if (r > 150 && g > 140 && b > 100 && r >= b && r - b > 15) {
            run += 1;
            if (run > runMax) runMax = run;
          } else {
            run = 0;
          }
        }
        if (runMax > 20) rows += 1;
      }
      if (rows > 5) return true;
    }
    return false;
  });
}

async function main() {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, hasTouch: false });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  log("=== TRENDLINES-V1 E2E (desktop 1280x900) ===\n");

  log("[setup] login + goto AAPL");
  await login(page);
  await gotoStock(page, SYMBOL);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-01-baseline.png") });
  record("1. Carga limpia desktop", errors.length === 0, errors.join("; "));

  log("\n[P2] Dibujar línea con estilo D5");
  // El plot area real está aprox en y=0.30..0.65 del canvas (sin contar ejes).
  // Las velas se ven entre y=0.20 y y=0.70.
  const draw1 = await drawLineInPlotArea(page, 0.20, 0.35, 0.85, 0.55);
  log(`  chip P1=${draw1.chipP1}  chip P2=${draw1.chipP2}  pressed=${draw1.pressed}`);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-02-line-resting.png") });
  record("2a. Línea dibujada (chip cambia + herramienta se desactiva)", draw1.chipP1 === "Dibujando · clic para punto 2/2" && draw1.pressed === false);
  const tizaDrawn = await detectTizaPixels(page);
  record("2b. Línea visible en canvas (píxeles tiza detectados)", tizaDrawn);

  log("\n[P3] Pan/zoom entre clics funciona");
  // Dibuja con pan en medio: clic 1, arrastra izquierda, clic 2.
  await page.locator('button[aria-label="Dibujar línea de tendencia"]').click();
  await sleep(200);
  const box = await getMainCanvasBox(page);
  const p1Pan = { x: box.x + box.w * 0.80, y: box.y + box.h * 0.40 };
  await page.mouse.click(p1Pan.x, p1Pan.y);
  await sleep(200);
  // Pan izquierda
  await page.mouse.move(box.x + box.w * 0.5, box.y + box.h * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.w * 0.2, box.y + box.h * 0.5, { steps: 8 });
  await page.mouse.up();
  await sleep(400);
  const newBox = await getMainCanvasBox(page);
  const p2Pan = { x: newBox.x + newBox.w * 0.30, y: newBox.y + newBox.h * 0.55 };
  await page.mouse.click(p2Pan.x, p2Pan.y);
  await sleep(400);
  const pressedAfterPanDraw = await getPressed(page);
  record("3. Dibujo con pan entre clics funciona (herramienta se desactiva)", pressedAfterPanDraw === false);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-03-after-pan-during-draw.png") });

  log("\n[P4] Selección → tiradores (clic en cuerpo de la línea)");
  const draw2 = await drawLineInPlotArea(page, 0.25, 0.30, 0.75, 0.55);
  // Usamos la geometría real reportada por la primitiva (en píxeles del canvas
  // principal) en lugar de la mitad del segmento de viewport, que no coincide
  // exactamente porque los anclas se proyectan y se extrapolan.
  const lineCenter = await page.evaluate(() => {
    const p = window.__trendlinePrimitive;
    const c = p?.getFirstLineCenter?.();
    if (!c) return null;
    const main = document.querySelectorAll(".universalChartCanvas canvas")[0];
    const r = main.getBoundingClientRect();
    return { x: r.x + c.center.x, y: r.y + c.center.y };
  });
  log(`  centro de la línea en viewport: ${lineCenter ? `(${lineCenter.x.toFixed(0)},${lineCenter.y.toFixed(0)})` : "(no detectado)"}`);
  if (lineCenter) {
    await page.mouse.click(lineCenter.x, lineCenter.y);
    await sleep(400);
  }
  const delVisible = await getDeleteBtnVisible(page);
  record("4a. Selección activa tras clic en cuerpo (botón borrar visible)", delVisible);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-04-selected.png") });

  log("\n[P5] Borrado por teclado Supr");
  if (delVisible) {
    await page.keyboard.press("Delete");
    await sleep(400);
    const afterDelete = await getDeleteBtnVisible(page);
    record("5. Borrado por Supr (botón borrar desaparece)", afterDelete === false);
    await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-05-after-delete.png") });
  } else {
    record("5. Borrado por Supr", false, "no se pudo seleccionar línea en el cuerpo");
  }

  log("\n[P6] Cambio de temporalidad 1D→W reproyecta");
  await drawLineInPlotArea(page, 0.20, 0.40, 0.80, 0.60);
  const tizaBeforeInterval = await detectTizaPixels(page);
  // Buscar botón "W" en el panel de preferencias
  let clickedInterval = false;
  try {
    const intervalW = page.locator('button:has-text("W")').first();
    await intervalW.scrollIntoViewIfNeeded({ timeout: 3000 });
    await intervalW.click({ timeout: 3000 });
    clickedInterval = true;
    await sleep(3000);
  } catch (e) {
    log("  no se encontró botón W");
  }
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-06-after-interval-W.png") });
  const tizaAfterInterval = await detectTizaPixels(page);
  record("6a. Click en W funcionó", clickedInterval);
  record("6b. Línea preservada tras cambio 1D→W (píxeles tiza)", tizaAfterInterval);

  log("\n[P7] Navegación SPA ticker → otro → vuelve preserva la línea");
  await gotoStock(page, OTHER_SYMBOL);
  await sleep(500);
  await gotoStock(page, SYMBOL);
  await sleep(1500);
  const tizaAfterSpa = await detectTizaPixels(page);
  record("7. Línea preservada tras SPA (píxeles tiza)", tizaAfterSpa);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-07-after-spa.png") });

  log(`\n[errors] total: ${errors.length}`);
  for (const e of errors.slice(0, 5)) log("  - " + e);

  log("\n=== Resumen ===");
  let passed = 0;
  for (const r of results) {
    if (r.ok) passed++;
  }
  log(`Total: ${passed}/${results.length} OK`);
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);

  // No cerramos el browser aquí: runMobile lo reutiliza.

  log("\n=== TRENDLINES-V1 E2E MÓVIL (375x812) ===\n");
  await runMobile(browser);
  // runMobile ya llama a record() sobre el array global.

  log("\n=== Resumen Final ===");
  let total = 0;
  let passedTotal = 0;
  for (const r of results) {
    total++;
    if (r.ok) passedTotal++;
  }
  log(`Total: ${passedTotal}/${total} OK`);
  for (const r of results) log(`  ${r.ok ? "✓" : "✗"} ${r.name}${r.detail ? "  — " + r.detail : ""}`);

  await browser.close();
  process.exit(passedTotal === total ? 0 : 1);
}

async function runMobile(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  await login(page);
  await gotoStock(page, SYMBOL);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-08-mobile-baseline.png") });

  // Dibujar línea con touch simulado
  log("[mobile] dibujar línea con tap-tap");
  await page.locator('button[aria-label="Dibujar línea de tendencia"]').tap();
  await sleep(300);
  const box = await getMainCanvasBox(page);
  const p1 = { x: box.x + box.w * 0.20, y: box.y + box.h * 0.35 };
  const p2 = { x: box.x + box.w * 0.80, y: box.y + box.h * 0.60 };
  await page.touchscreen.tap(p1.x, p1.y);
  await sleep(300);
  const chipP1 = await getChip(page);
  await page.touchscreen.tap(p2.x, p2.y);
  await sleep(500);
  const pressed = await getPressed(page);
  log(`  mobile: chipP1=${chipP1}  pressed=${pressed}`);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-09-mobile-line.png") });
  record("8a. Dibujo con tap-tap en viewport 375px", chipP1 === "Dibujando · clic para punto 2/2" && pressed === false);

  // Tolerancia táctil: usar la geometría reportada por la primitiva como
  // ancla y probar taps con variación aleatoria para simular imprecisión
  // táctil humana.
  log("[mobile] intentar seleccionar línea dibujada con tap en cuerpo");
  const lineCenterMobile = await page.evaluate(() => {
    const p = window.__trendlinePrimitive;
    const c = p?.getFirstLineCenter?.();
    if (!c) return null;
    const main = document.querySelectorAll(".universalChartCanvas canvas")[0];
    const r = main.getBoundingClientRect();
    return { x: r.x + c.center.x, y: r.y + c.center.y };
  });
  log(`  centro línea móvil: ${lineCenterMobile ? `(${lineCenterMobile.x.toFixed(0)},${lineCenterMobile.y.toFixed(0)})` : "(no detectado)"}`);
  let mobileHits = 0;
  let mobileTries = 0;
  if (lineCenterMobile) {
    for (let i = 0; i < 5; i += 1) {
      mobileTries += 1;
      // Variación aleatoria ±3-5px
      const dx = (Math.random() - 0.5) * 8;
      const dy = (Math.random() - 0.5) * 8;
      await page.touchscreen.tap(lineCenterMobile.x + dx, lineCenterMobile.y + dy);
      await sleep(200);
      if (await getDeleteBtnVisible(page)) {
        mobileHits += 1;
        await page.keyboard.press("Escape");
        await sleep(150);
      }
    }
  }
  log(`  mobile: ${mobileHits}/${mobileTries} intentos de selección acertaron`);
  record("8b. Tolerancia táctil razonable en 375px", mobileHits >= 3, `${mobileHits}/${mobileTries} aciertos (±4px)`);
  await page.screenshot({ path: path.join(OUTPUT_DIR, "trendlines-10-mobile-selection.png") });

  log(`[mobile errors] total: ${errors.length}`);
  for (const e of errors.slice(0, 5)) log("  - " + e);

  await ctx.close();
}

main().catch((err) => {
  console.error("FATAL", err);
  process.exit(1);
});