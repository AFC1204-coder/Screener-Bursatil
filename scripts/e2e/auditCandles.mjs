// scripts/e2e/auditCandles.mjs
// Verificación visual del fix de velas en UniversalPriceChart.jsx.
// Vela alcista → relleno sólido tiza. Vela bajista → relleno transparente (hueca, solo borde).
//
//   node scripts/e2e/auditCandles.mjs [SYMBOL]
//
// Salidas:
//   output/playwright/candles-<SYMBOL>-full.png
//   output/playwright/candles-<SYMBOL>-crop.png
//   output/playwright/candles-<SYMBOL>-report.txt
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const symbol = (process.argv[2] || "META").toUpperCase();
const BASE_URL = "http://127.0.0.1:3000";
const OUT_DIR = "output/playwright";
mkdirSync(OUT_DIR, { recursive: true });

function readEnvFile(name) {
  try {
    const text = readFileSync(".env.local", "utf8");
    const m = text.match(new RegExp(`^${name}=(.+)$`, "m"));
    return m ? m[1].trim().replace(/^['"]|['"]$/g, "") : "";
  } catch { return ""; }
}

const sessionSecret = readEnvFile("STATSEDGE_SESSION_SECRET") || readEnvFile("STATSEDGE_ACCESS_TOKEN");
if (!sessionSecret) throw new Error("No STATSEDGE_SESSION_SECRET ni STATSEDGE_ACCESS_TOKEN en .env.local");
const exp = Date.now() + 7 * 86400 * 1000;
const payload = `v1.${exp}`;
const sig = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
const sessionCookie = `${payload}.${sig}`;

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  });
  await ctx.addCookies([{
    name: "statsedge_session",
    value: sessionCookie,
    domain: "127.0.0.1",
    path: "/",
    httpOnly: true,
  }]);
  const page = await ctx.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("[browser-error]", msg.text());
  });

  console.log(`· navegando a ${BASE_URL}/stock/${symbol}`);
  await page.goto(`${BASE_URL}/stock/${symbol}`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  // Haz scroll hasta el chart y amplía la altura del viewport para capturarlo entero.
  await page.evaluate(() => {
    const el = document.querySelector(".universalChart");
    if (el) el.scrollIntoView({ block: "start" });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });

  const container = page.locator(".universalChartCanvas").first();
  await container.waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForFunction(() => {
    const canvases = document.querySelectorAll(".universalChartCanvas canvas");
    return Array.from(canvases).some((c) => c.clientWidth > 50 && c.clientHeight > 50);
  }, { timeout: 20_000 });
  await page.waitForTimeout(1200);

  // Fuerza fitContent para que entren todas las velas en el viewport y se
  // vean tanto alcistas como bajistas. lightweight-charts expone timeScale()
  // en la instancia del chart, pero la referencia se pierde tras re-render.
  // Pulsamos el botón "Restaurar rango" que llama a timeScale.fitContent().
  const resetButton = page.locator('button[aria-label="Restaurar rango seleccionado"]');
  if (await resetButton.count()) {
    const enabled = await resetButton.first().isEnabled().catch(() => false);
    if (enabled) {
      await resetButton.first().click();
      await page.waitForTimeout(400);
    }
  }
  await page.waitForTimeout(400);

  const fullPath = `${OUT_DIR}/candles-${symbol}-full.png`;
  const cropPath = `${OUT_DIR}/candles-${symbol}-crop.png`;
  await page.screenshot({ path: fullPath, fullPage: true });
  const box = await container.boundingBox();
  if (!box) throw new Error("No bounding box para el contenedor del chart");
  await page.screenshot({
    path: cropPath,
    clip: {
      x: Math.max(0, box.x - 8),
      y: Math.max(0, box.y - 60),
      width: box.width + 16,
      height: box.height + 100,
    },
  });
  console.log(`· capturas: ${fullPath}, ${cropPath}`);

const stats = await page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll(".universalChartCanvas canvas"));
    const w = canvases[0]?.width || 0;
    const h = canvases[0]?.height || 0;
    if (!w || !h) return { error: "canvas-empty" };
    const composite = document.createElement("canvas");
    composite.width = w;
    composite.height = h;
    const ctx = composite.getContext("2d");
    for (const c of canvases) ctx.drawImage(c, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    // Tokens resueltos:
    //   --tiza  #EDE8DA = (237,232,218)   relleno alcista
    //   --soft  #B9BFB2 = (185,191,178)   borde y mecha alcista
    //   --humo  #7E8B82 = (126,139,130)   mecha bajista
    const tiza = [237, 232, 218];
    const soft = [185, 191, 178];
    const humo = [126, 139, 130];

    function near(r, g, b, t, tol = 18) {
      return Math.abs(r - t[0]) <= tol && Math.abs(g - t[1]) <= tol && Math.abs(b - t[2]) <= tol;
    }

    // Conteo global + estructura por columnas para clasificar.
    let totalTiza = 0;
    let totalSoft = 0;
    let totalHumo = 0;
    let totalAlphaSolid = 0;

    // Para cada columna medimos el "run" más largo vertical de pixeles tiza
    // contiguos con alpha sólido (>=200). En una vela alcista sólida el cuerpo
    // está relleno opaco → run largo. En una vela hueca la tiza no aparece
    // (downColor=rgba(0,0,0,0)); solo se ven los bordes soft y la mecha humo.
    // Descartamos pixeles con alpha < 100 para ignorar el grid tenue.
    const cols = new Array(w);
    for (let x = 0; x < w; x += 1) {
      let tizaRows = 0, softRows = 0, humoRows = 0;
      let tizaMaxRun = 0, tizaCurRun = 0;
      for (let y = 0; y < h; y += 1) {
        const idx = (y * w + x) * 4;
        const a = data[idx + 3];
        const r = data[idx], g = data[idx + 1], b = data[idx + 2];
        const isTiza = a >= 100 && near(r, g, b, tiza);
        const isSoft = a >= 100 && !isTiza && near(r, g, b, soft);
        const isHumo = a >= 100 && !isTiza && !isSoft && near(r, g, b, humo);
        if (isTiza) { tizaRows += 1; tizaCurRun += 1; if (tizaCurRun > tizaMaxRun) tizaMaxRun = tizaCurRun; }
        else tizaCurRun = 0;
        if (isSoft) softRows += 1;
        if (isHumo) humoRows += 1;
      }
      cols[x] = { tizaRows, softRows, humoRows, tizaMaxRun };
      totalTiza += tizaRows;
      totalSoft += softRows;
      totalHumo += humoRows;
      totalAlphaSolid += tizaRows + softRows + humoRows;
    }

    // Heurística definitiva tras inspección pixel-perfect:
    //   - bullish (alcista sólida): tizaRows >= 4 con tizaMaxRun >= 4. El
    //     cuerpo está relleno de tiza opaca → bloque vertical continuo ≥4px.
    //   - bearish (bajista hueca): tizaRows === 0 (el interior está vacío)
    //     y softRows >= 1 (los bordes horizontales están pintados con soft).
    //   - neutral: resto (ejes, grid, mechas puras sin cuerpo, mezclas).
    let bullish = 0, bearish = 0, neutral = 0;
    for (const c of cols) {
      if (c.tizaRows >= 4 && c.tizaMaxRun >= 4) bullish += 1;
      else if (c.tizaRows === 0 && c.softRows >= 1) bearish += 1;
      else neutral += 1;
    }
    const bearishEdgeOnly = 0;

    return {
      canvasWidth: w,
      canvasHeight: h,
      columnsAnalyzed: w,
      bullishColumns: bullish,
      bearishColumns: bearish,
      neutralColumns: neutral,
      totalTizaPx: totalTiza,
      totalSoftPx: totalSoft,
      totalHumoPx: totalHumo,
      totalAlphaSolidPx: totalAlphaSolid,
    };
  });

  const report = `SYMBOL: ${symbol}
Fecha: ${new Date().toISOString()}
Capturas:
  - ${fullPath}
  - ${cropPath}
Estadísticas canvas (composite de todas las capas):
${JSON.stringify(stats, null, 2)}
Interpretación:
  - bullishColumns  → columnas con relleno tiza opaco (vela alcista sólida).
  - bearishColumns  → columnas con solo borde soft/humo y sin relleno opaco (vela bajista hueca).
  - Ambos valores deben ser > 0 para confirmar el fix.
`;
  writeFileSync(`${OUT_DIR}/candles-${symbol}-report.txt`, report);
  console.log(`· reporte: ${OUT_DIR}/candles-${symbol}-report.txt`);
  console.log("· estadísticas:", JSON.stringify(stats, null, 2));

  await browser.close();

  if (!stats || stats.error) {
    console.error("FAIL: no se pudo leer el canvas");
    process.exit(2);
  }
  if (stats.bullishColumns < 3 || stats.bearishColumns < 3) {
    console.error(`FAIL: bullishColumns=${stats.bullishColumns} bearishColumns=${stats.bearishColumns} (esperado ≥3 cada uno)`);
    process.exit(3);
  }
  console.log("OK: se detectan columnas alcistas (relleno tiza) y bajistas (borde soft, huecas) en el canvas.");
}

main().catch((err) => { console.error(err); process.exit(1); });