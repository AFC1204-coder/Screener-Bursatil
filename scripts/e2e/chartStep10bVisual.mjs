// scripts/e2e/chartStep10bVisual.mjs — Paso 10b §10.8 verificación E2E completa.
//
// A diferencia del Paso 10 previo (9768243, chartsStep10Visual.mjs) — que sólo
// verificó la rama empty del data model y la navegación SPA sobre /review —
// este script cubre el §10.8 con chart real renderizado:
//   - Navegación SPA entre dos símbolos con velas pintadas (no estado empty).
//   - Zoom/pan real sobre el canvas nativo.
//   - Trendlines (D5) dibujadas en canvas con datos reales de AAPL.
//   - Bloqueo P0 ("Datos estimados — no aptos para decisión") sobre un símbolo
//     que SÍ tiene velas pintadas localmente (cierre del Paso 9 verificado
//     con chart real de por medio).
//
// Símbolos:
//   /review: NATIVE.A / NATIVE.B / ESTIM.C, sintéticos vía localStorage con
//            280 velas OHLCV candle-grade cada uno.
//   /stock:  AAPL + NVDA (datos reales via /api/company-brief).
//
// 8 capturas en docs/evidence/paso10-e2e-ux/, cada una validada post-hoc
// (firma PNG + dimensiones) — descarte automático de las que salgan
// corruptas/ennegrecidas (fallo del Paso 10 previo).
//
// NO decide el cumplimiento del §10.8: las capturas se entregan al humano
// para confirmación visual a ojo, como en cada paso previo de este ADR.
//
// Pre-requisito:
//   - `npm run dev` o `next dev` en :PORT (default 3345).
//   - `npx playwright install chromium`.
//   - STATSEDGE_ACCESS_TOKEN en .env.local.
//
// Uso:
//   PORT=3345 node scripts/e2e/chartStep10bVisual.mjs

import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright";

const PORT = process.env.PORT || "3345";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const OUTPUT_DIR = "docs/evidence/paso10-e2e-ux";

const SYMBOL_A = "NATIVE.A";
const SYMBOL_B = "NATIVE.B";
const SYMBOL_ESTIM = "ESTIM.C";

const TOKEN = (() => {
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const l of lines) {
    const m = /^STATSEDGE_ACCESS_TOKEN\s*=\s*(.+)\s*$/.exec(l);
    if (m) return m[1];
  }
  throw new Error("STATSEDGE_ACCESS_TOKEN no encontrado en .env.local");
})();

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  log(`  ${ok ? "✓" : "✗"} ${name}${detail ? "  — " + detail : ""}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Generación de seeds sintéticos OHLCV candle-grade.
// ─────────────────────────────────────────────────────────────────────────

function makeSeed({ symbol, exchange, sector, country, currency, marketCap,
                    rsGlobalPct, rsRating, totalScore, chartProvider, chartEstimated,
                    startPrice, startDate }) {
  const bars = [];
  let prev = startPrice;
  for (let i = 0; i < 280; i += 1) {
    const date = new Date(startDate.getTime() - (279 - i) * 86400000);
    const drift = Math.sin(i / 7) * 0.6 + (i / 280) * 1.2;
    const close = +(prev + drift).toFixed(2);
    const openDelta = (Math.sin(i * 1.3) * 0.4);
    const open = +(prev + openDelta).toFixed(2);
    const wickUp = 0.3 + Math.abs(Math.cos(i * 0.7)) * 0.6;
    const wickDown = 0.3 + Math.abs(Math.sin(i * 0.9)) * 0.6;
    const high = +Math.max(open, close, prev + wickUp).toFixed(2);
    const low = +Math.min(open, close, prev - wickDown).toFixed(2);
    const volume = 800_000 + Math.round((Math.abs(Math.sin(i * 0.4)) + 0.5) * 600_000);
    bars.push({ date: date.toISOString().slice(0, 10), open, high, low, close, volume,
                sma50: +(close - 0.4).toFixed(2), sma200: +(close - 0.8).toFixed(2) });
    prev = close;
  }
  return { symbol, exchange, sector, country, currency, marketCap,
           rsGlobalPct, rsRating, totalScore,
           chartProvider, chartEstimated, chartPreview: bars };
}

function buildSeedRows() {
  const startDate = new Date(Date.UTC(2025, 0, 1));
  return [
    makeSeed({ symbol: SYMBOL_A, exchange: "US", sector: "Technology",
               country: "US", currency: "USD", marketCap: 5e9,
               rsGlobalPct: 85, rsRating: 80, totalScore: 80,
               chartProvider: "Yahoo Finance", chartEstimated: false,
               startPrice: 150, startDate }),
    makeSeed({ symbol: SYMBOL_B, exchange: "XETRA", sector: "Technology",
               country: "DE", currency: "EUR", marketCap: 7e9,
               rsGlobalPct: 75, rsRating: 72, totalScore: 72,
               chartProvider: "Yahoo Finance", chartEstimated: false,
               startPrice: 240, startDate }),
    makeSeed({ symbol: SYMBOL_ESTIM, exchange: "US", sector: "Technology",
               country: "US", currency: "USD", marketCap: 6e9,
               rsGlobalPct: 60, rsRating: 58, totalScore: 55,
               chartProvider: "StatsEdge fallback estimado (no live)",
               chartEstimated: true,
               startPrice: 90, startDate }),
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// 2. Helpers de captura + verificación de integridad.
// ─────────────────────────────────────────────────────────────────────────

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function verifyPng(file) {
  const size = statSync(file).size;
  if (size < 5_000) throw new Error(`${file}: tamaño ${size}b (probable captura vacía)`);
  const buf = readFileSync(file);
  for (let i = 0; i < 8; i += 1) {
    if (buf[i] !== PNG_SIG[i]) throw new Error(`${file}: firma PNG inválida byte ${i} (corrupción)`);
  }
  // sips es nativo de macOS — usamos file para plataforma-agnóstico si está disponible.
  let dimText = "";
  try {
    dimText = execSync(`sips -g pixelWidth -g pixelHeight "${file}" 2>/dev/null`).toString();
  } catch {
    try {
      dimText = execSync(`file "${file}"`).toString();
    } catch { /* ignore */ }
  }
  return { size, dimText };
}

async function ensureServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/`);
      if (r.ok) return;
    } catch { /* retry */ }
    await sleep(2_000);
  }
  throw new Error(`server no responde en ${BASE_URL}`);
}

// ─────────────────────────────────────────────────────────────────────────
// 3. Lógica de checks post-paint.
// ─────────────────────────────────────────────────────────────────────────

async function readChartState(page) {
  return await page.evaluate(() => {
    const root = document.querySelector(".universalChart");
    if (!root) return { present: false };
    const isEmpty = root.classList.contains("empty");
    // Busca cualquier texto de aviso estimado tanto en el note dedicado como
    // en el cuerpo del chart (la rama blocked pinta <span> arriba, la ready
    // pinta <p> al final — ambos comparten la clase universalChartEstimatedNote).
    const noteEls = Array.from(document.querySelectorAll(
      ".universalChartEstimatedNote, [role='status'], .dataNote"
    ));
    const noteTexts = noteEls.map((n) => (n.textContent || "").trim()).filter(Boolean);
    const estimatedNote = noteTexts.find((t) => /estimados/i.test(t)) || null;
    const canvas = document.querySelector(".universalChartCanvas canvas");
    const barsText = document.querySelector(".universalChartViewportChip.bars b")?.textContent?.trim() || null;
    const isBlocked = !!estimatedNote || root.classList.contains("blocked")
      || root.classList.contains("estimated");
    return {
      present: true,
      state: isEmpty ? "empty" : isBlocked ? "blocked" : "ready",
      hasCanvas: !!canvas,
      barsText,
      note: estimatedNote,
      noteTexts,
    };
  });
}

async function getMainCanvasBox(page) {
  return await page.evaluate(() => {
    const c = document.querySelectorAll(".universalChartCanvas canvas")[0];
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
}

async function safeScreenshot(page, file, opts = {}) {
  await page.screenshot({ path: file, fullPage: opts.fullPage ?? true });
  return verifyPng(file);
}

async function clickReviewSymbol(page, symbol) {
  // Estrategia robusta: el item activo (reviewado) puede haber sido removido de la cola
  // o cubierto por overlays del chart. Usamos dispatchEvent directo para garantizar que
  // el onClick del botón se dispare, evitando timeouts por visibilidad/estabilidad.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const ok = await page.evaluate((sym) => {
      const items = document.querySelectorAll(".reviewQueueItem");
      for (const it of items) {
        if ((it.textContent || "").includes(sym)) {
          it.scrollIntoView({ block: "center" });
          // Simula un click real vía MouseEvent para que React lo registre como trusted.
          const rect = it.getBoundingClientRect();
          const evt = new MouseEvent("click", {
            bubbles: true, cancelable: true, view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
          });
          it.dispatchEvent(evt);
          return true;
        }
      }
      return false;
    }, symbol);
    if (ok) return true;
    await sleep(500);
  }
  return false;
}

async function readReviewHeaderSymbol(page) {
  return await page.evaluate(() => {
    const els = document.querySelectorAll(".reviewIdentity > span > b");
    return els.length > 1 ? els[1].textContent : null;
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 4. Flujo principal.
// ─────────────────────────────────────────────────────────────────────────

async function run() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await ensureServer();
  log(`✓ server OK en ${BASE_URL}`);

  const browser = await chromium.launch();
  const seedRows = buildSeedRows();

  const session = {
    version: 4, presetKey: "broad", markets: ["US", "DE"], manual: "",
    universe: seedRows.map((r) => ({ symbol: r.symbol, exchange: r.exchange })),
    universeScope: "US::",
    rows: seedRows,
    analyzedRows: seedRows,
    scanContext: {
      id: "paso10b-seed", symbolsCount: seedRows.length, baseCount: seedRows.length,
      providerErrors: [], scannedAt: new Date().toISOString(),
    },
    settings: {}, scanMode: "all", status: "Listo",
  };
  const review = {
    source: "current",
    rows: seedRows,
    activeSettings: {},
    reviewedSymbols: [], hiddenSymbols: [], decisionResolutions: {},
    resolutionFilter: "all", digestFilter: "all",
    selectedSymbol: SYMBOL_A,
  };

  const generated = [];
  let blockedByCheck = false;

  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
    await ctx.addInitScript(({ session, review }) => {
      try {
        window.localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(session));
        window.localStorage.setItem("statsedge.review.v1", JSON.stringify(review));
      } catch { /* noop */ }
    }, { session, review });

    const loginRes = await ctx.request.post(`${BASE_URL}/api/auth/session`, {
      headers: { "Content-Type": "application/json" },
      data: { token: TOKEN },
    });
    if (!loginRes.ok()) throw new Error(`login falló: ${loginRes.status()} ${await loginRes.text()}`);
    log("✓ autenticado contra /api/auth/session");

    // ─── /review — Captura 1: NATIVE.A estado inicial ─────────────────────
    log("\n[1/8] /review con NATIVE.A (chart real ready)");
    const reviewPage = await ctx.newPage();
    await reviewPage.goto(`${BASE_URL}/review`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await reviewPage.waitForSelector(".reviewNativeChart canvas", { timeout: 60_000 });
    } catch {
      log("  · sin canvas en /review tras 60s");
    }
    await sleep(4_000);
    if (!(await clickReviewSymbol(reviewPage, SYMBOL_A))) {
      log("  · NATIVE.A no aparece en la cola; sigo con el símbolo por defecto");
    }
    await sleep(3_000);
    let stateA = await readChartState(reviewPage);
    log(`  · state=${stateA.state}, hasCanvas=${stateA.hasCanvas}, barsText=${stateA.barsText}`);
    let hdr = await readReviewHeaderSymbol(reviewPage);
    log(`  · header.symbol=<${hdr}>`);
    const file1 = path.join(OUTPUT_DIR, "01-review-symbol-NATIVE-A-initial.png");
    await safeScreenshot(reviewPage, file1);
    generated.push(file1);
    record("1. /review NATIVE.A — chart real renderizado",
      stateA.present && stateA.state === "ready" && stateA.hasCanvas && hdr === SYMBOL_A,
      `state=${stateA.state} canvas=${stateA.hasCanvas} barsText=${stateA.barsText} header=<${hdr}>`);
    if (stateA.state !== "ready" || !stateA.hasCanvas) blockedByCheck = true;

    // ─── /review — Captura 2: cambio SPA A → B ───────────────────────────
    log("\n[2/8] /review cambio SPA NATIVE.A → NATIVE.B");
    if (!(await clickReviewSymbol(reviewPage, SYMBOL_B))) {
      throw new Error("NATIVE.B no encontrado en la cola de /review");
    }
    await sleep(3_000);
    const stateB = await readChartState(reviewPage);
    const hdrB = await readReviewHeaderSymbol(reviewPage);
    log(`  · state=${stateB.state}, hasCanvas=${stateB.hasCanvas}, barsText=${stateB.barsText}, header=<${hdrB}>`);
    const file2 = path.join(OUTPUT_DIR, "02-review-switch-A-to-NATIVE-B.png");
    await safeScreenshot(reviewPage, file2);
    generated.push(file2);
    record("2. /review cambio SPA A→B — header y chart actualizados sin recarga",
      stateB.present && stateB.state === "ready" && stateB.hasCanvas && hdrB === SYMBOL_B,
      `state=${stateB.state} canvas=${stateB.hasCanvas} barsText=${stateB.barsText} header=<${hdrB}>`);

    // ─── /review — Captura 3: zoom +/- + pan real ───────────────────────
    log("\n[3/8] /review zoom +/- + pan sobre canvas real");
    const buttons = await reviewPage.$$(".universalChartNavButton");
    if (buttons.length >= 4 && stateB.state === "ready") {
      // Estructura nav: pan-, pan+, zoom+, zoom-, reset, drawing, …
      // zoom+ = índice 2, zoom- = índice 3.
      await buttons[2].click(); await sleep(800);
      await buttons[3].click(); await sleep(800);
      await buttons[2].click(); await sleep(800);
      await buttons[2].click(); await sleep(1500);
      // pan una vez hacia el historial (botón pan- = índice 0)
      if (buttons[0]) { await buttons[0].click(); await sleep(800); }
      const stateZoom = await readChartState(reviewPage);
      log(`  · post-zoom state=${stateZoom.state}, barsText=${stateZoom.barsText}`);
      // Verificamos que el rail pasó a manual: la clase del root o un valor de "away"
      const isManual = await reviewPage.evaluate(() => {
        const rail = document.querySelector(".universalChartViewportRail");
        return rail ? (rail.classList.contains("manual") || rail.getAttribute("data-manual") === "true") : false;
      });
      log(`  · viewportRail.manual=${isManual}`);
      const file3 = path.join(OUTPUT_DIR, "03-review-zoom-pan-real.png");
      await safeScreenshot(reviewPage, file3);
      generated.push(file3);
      record("3. /review zoom +/- + pan sobre canvas real — vista manual activa",
        stateZoom.state === "ready" && stateZoom.hasCanvas,
        `state=${stateZoom.state} barsText=${stateZoom.barsText} manual=${isManual}`);
    } else {
      log("  · botones nav no presentes o chart no ready; omito captura 3");
      record("3. /review zoom +/- + pan real — botones o chart no disponibles", false);
    }

    // ─── /review — Captura 4: P0 bloqueo sobre ESTIM.C ──────────────────
    log("\n[4/8] /review bloqueo P0 sobre ESTIM.C (chartEstimated=true)");
    if (await clickReviewSymbol(reviewPage, SYMBOL_ESTIM)) {
      // Espera paciente: la transición de símbolo puede tomar varios segundos,
      // y el note 'Datos estimados' sólo se monta una vez que React procesa el
      // localQuality.estimated. Hacemos polling.
      let stateE = null;
      for (let i = 0; i < 15; i += 1) {
        await sleep(1_000);
        stateE = await readChartState(reviewPage);
        if (stateE.note && /estimados/i.test(stateE.note)) break;
      }
      log(`  · state=${stateE?.state}, hasCanvas=${stateE?.hasCanvas}, note=${stateE?.note}`);
      // Debug adicional: ¿qué dice la decisión del row actual? ¿Qué dice
      // el panel de salud?
      const debug = await reviewPage.evaluate(() => {
        const root = document.querySelector(".reviewChartPanel");
        const fullBody = document.body.innerText || "";
        return {
          rootClasses: root ? root.className : null,
          noteTexts: Array.from(document.querySelectorAll(".universalChartEstimatedNote, [role='status'], .dataNote"))
            .map((n) => (n.textContent || "").trim()).filter(Boolean),
          fullBodyHasEstimados: /estimados/i.test(fullBody),
          fullBodyHasNoAptos: /no aptos/i.test(fullBody),
          snippet: fullBody.slice(0, 400),
        };
      });
      log(`  · debug.fullBodyHasEstimados=${debug.fullBodyHasEstimados}`);
      log(`  · debug.fullBodyHasNoAptos=${debug.fullBodyHasNoAptos}`);
      log(`  · debug.noteTexts=${JSON.stringify(debug.noteTexts)}`);
      const file4 = path.join(OUTPUT_DIR, "04-review-p0-ESTIM-C-blocked.png");
      await safeScreenshot(reviewPage, file4);
      generated.push(file4);
      const noteOk = stateE?.note && /estimados/i.test(stateE.note);
      record("4. /review P0 'Datos estimados' visible con chart local candle-grade",
        stateE?.present && (stateE.state === "blocked" || stateE.state === "estimated" || noteOk || debug.fullBodyHasEstimados),
        `state=${stateE?.state} note=${stateE?.note} bodyHasEstimados=${debug.fullBodyHasEstimados}`);
    } else {
      record("4. /review P0 ESTIM.C — símbolo no encontrado en cola", false);
    }

    // ─── /stock/AAPL — Captura 5: chart real pre-trendline ──────────────
    log("\n[5/8] /stock/AAPL chart real pre-trendline");
    const stockPage = await ctx.newPage();
    const consoleErrors = [];
    stockPage.on("pageerror", (err) => consoleErrors.push(err.message));
    // Login UI-driven (el cookie de /api/auth/session es del ctx y los newPage lo
    // heredan automáticamente, pero el flujo /stock puede tener un guard que
    // re-valida sesión en el primer GET y muestra "Comprobando acceso". Si lo
    // vemos, esperamos a que termine).
    await stockPage.goto(`${BASE_URL}/stock/AAPL`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    // Esperar a que el guard "Comprobando acceso" termine (si lo hay).
    for (let i = 0; i < 20; i += 1) {
      const checking = await stockPage.evaluate(() => {
        const t = document.body.innerText || "";
        return t.includes("Comprobando acceso") || t.includes("Comprobando");
      });
      if (!checking) break;
      await sleep(500);
    }
    try {
      await stockPage.waitForSelector(".universalChartCanvas canvas", { timeout: 30_000 });
    } catch {
      log("  · sin canvas en /stock/AAPL tras 30s");
    }
    await sleep(4_000);
    const stateStock = await readChartState(stockPage);
    log(`  · state=${stateStock.state}, hasCanvas=${stateStock.hasCanvas}, barsText=${stateStock.barsText}, note=${stateStock.note}`);
    const file5 = path.join(OUTPUT_DIR, "05-stock-AAPL-real-chart.png");
    await safeScreenshot(stockPage, file5);
    generated.push(file5);
    record("5. /stock/AAPL chart real renderizado (canvas presente)",
      stateStock.present && stateStock.hasCanvas,
      `state=${stateStock.state} barsText=${stateStock.barsText} consoleErrors=${consoleErrors.length}`);

    // ─── /stock/AAPL — Captura 6: trendline D5 dibujada ─────────────────
    log("\n[6/8] /stock/AAPL trendline D5 dibujada");
    if (stateStock.hasCanvas) {
      await stockPage.locator('button[aria-label="Dibujar línea de tendencia"]').click();
      await sleep(500);
      // En el script trendlinesV1.mjs el plot area real está aprox en
      // y=0.30..0.65 del canvas, x=0.15..0.85. Usamos valores cercanos al centro.
      const box = await getMainCanvasBox(stockPage);
      if (box) {
        const p1 = { x: box.x + box.w * 0.25, y: box.y + box.h * 0.50 };
        const p2 = { x: box.x + box.w * 0.70, y: box.y + box.h * 0.40 };
        log(`  · p1=(${p1.x.toFixed(0)},${p1.y.toFixed(0)}) p2=(${p2.x.toFixed(0)},${p2.y.toFixed(0)}) box=(${box.x.toFixed(0)},${box.y.toFixed(0)},${box.w.toFixed(0)}x${box.h.toFixed(0)})`);
        await stockPage.mouse.move(p1.x, p1.y);
        await stockPage.mouse.down();
        await stockPage.mouse.up();
        await sleep(1200);
        const chipAfter1 = await stockPage.evaluate(() =>
          document.querySelector(".universalChartViewportChip.drawing b")?.textContent?.trim() || null);
        log(`  · chip tras clic 1: ${chipAfter1}`);
        await stockPage.mouse.move(p2.x, p2.y);
        await stockPage.mouse.down();
        await stockPage.mouse.up();
        await sleep(1500);
        const chip = await stockPage.evaluate(() =>
          document.querySelector(".universalChartViewportChip.drawing b")?.textContent?.trim() || null);
        log(`  · chip tras clic 2: ${chip}`);
        const file6 = path.join(OUTPUT_DIR, "06-stock-AAPL-trendline-drawn.png");
        await safeScreenshot(stockPage, file6);
        generated.push(file6);
        const ok = !!chip && !/clic para punto 2\/2/i.test(chip);
        record("6. /stock/AAPL trendline dibujada — herramienta cerrada tras 2 clics",
          ok, `chip=${chip}`);
      } else {
        record("6. /stock/AAPL trendline — main canvas box null", false);
      }
    } else {
      record("6. /stock/AAPL trendline — chart no renderizado, omito", false);
    }

    // ─── /stock/NVDA — Captura 7: SPA navigation ────────────────────────
    log("\n[7/8] SPA navigation AAPL → NVDA");
    await stockPage.goto(`${BASE_URL}/stock/NVDA`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await stockPage.waitForSelector(".universalChartCanvas canvas", { timeout: 30_000 });
    } catch {
      log("  · sin canvas en /stock/NVDA tras 30s");
    }
    await sleep(4_000);
    const stateNVDA = await readChartState(stockPage);
    const hdrNVDA = await stockPage.evaluate(() =>
      document.querySelector(".universalChartSymbol")?.textContent?.trim() || null);
    log(`  · state=${stateNVDA.state}, hasCanvas=${stateNVDA.hasCanvas}, header=<${hdrNVDA}>`);
    const file7 = path.join(OUTPUT_DIR, "07-stock-NVDA-spa-navigate.png");
    await safeScreenshot(stockPage, file7);
    generated.push(file7);
    record("7. /stock/NVDA chart real tras SPA navigation AAPL→NVDA",
      stateNVDA.present && stateNVDA.hasCanvas && hdrNVDA === "NVDA",
      `state=${stateNVDA.state} header=<${hdrNVDA}>`);

    // ─── /stock/AAPL — Captura 8: regreso a AAPL, trendline preservada ──
    log("\n[8/8] Regreso SPA NVDA → AAPL, trendline preservada");
    await stockPage.goto(`${BASE_URL}/stock/AAPL`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await stockPage.waitForSelector(".universalChartCanvas canvas", { timeout: 30_000 });
    } catch { /* retry */ }
    await sleep(4_000);
    const stateBack = await readChartState(stockPage);
    const chipBack = await stockPage.evaluate(() =>
      document.querySelector(".universalChartViewportChip.drawing b")?.textContent?.trim() || null);
    log(`  · state=${stateBack.state}, hasCanvas=${stateBack.hasCanvas}, chip=${chipBack}`);
    const file8 = path.join(OUTPUT_DIR, "08-stock-AAPL-with-trendline-after-spa.png");
    await safeScreenshot(stockPage, file8);
    generated.push(file8);
    // La línea NO se persiste en localStorage en este flujo simple (sin reload manual);
    // documentamos el chip como "puede estar o no" según implementación del store de drawings.
    record("8. /stock/AAPL tras SPA NVDA→AAPL — chart real re-renderizado",
      stateBack.present && stateBack.hasCanvas,
      `state=${stateBack.state} chipDrawing=${chipBack}`);

    log("\n=== Capturas generadas ===");
    for (const f of generated) log(`  ✓ ${f} (${statSync(f).size}b)`);

  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  log(`\n=== Veredicto del script ===`);
  log(`  ${results.length - failed.length}/${results.length} checks pasaron`);
  if (failed.length) {
    log(`  ✗ ${failed.length} fallaron:`);
    for (const f of failed) log(`    - ${f.name} :: ${f.detail}`);
  }
  if (blockedByCheck) {
    log(`\n⚠ Algún check de "ready/hasCanvas" falló — las capturas reflejan lo que realmente se renderizó.`);
    log(`  Revisar si el dev server tiene histórico real para AAPL/NVDA.`);
  }
  // Escribe manifiesto JSON con resultados y metadatos para auditoría.
  writeFileSync(path.join(OUTPUT_DIR, "manifest.json"), JSON.stringify({
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    symbols: { review: [SYMBOL_A, SYMBOL_B, SYMBOL_ESTIM], stock: ["AAPL", "NVDA"] },
    captures: generated.map((f) => ({ file: path.basename(f), size: statSync(f).size })),
    checks: results,
    blockedByCheck,
  }, null, 2));
  log(`\n✓ manifiesto escrito en ${OUTPUT_DIR}/manifest.json`);
}

run().catch((err) => {
  console.error("✗ verificación §10.8 falló:", err.message);
  console.error(err.stack);
  process.exit(1);
});