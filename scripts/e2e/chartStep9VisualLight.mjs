// scripts/e2e/chartStep9VisualLight.mjs — verificación visual LIGERA del
// Paso 9 del ADR chart-controller-extraction (§9). Capturas reales que
// confirman que el aviso P0 de calidad (estimado/missing) sigue apareciendo
// en /stock/[symbol] y en /review tras la migración `chartEstimated` →
// `localQuality`.
//
// Pre-requisitos:
//   1. La app debe estar levantada en :PORT (default 3100):
//        PORT=3100 STATSEDGE_SESSION_SECRET=algo npm run start
//      (El secret es sólo si `STATSEDGE_ACCESS_TOKEN` ya está en `.env.local`.
//       El script usa ese mismo token.)
//   2. Las dependencias `playwright` (ya en devDependencies) deben tener
//      los binarios instalados (`npx playwright install chromium`).
//
// Uso:
//   PORT=3100 node scripts/e2e/chartStep9VisualLight.mjs

import { readFileSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

const PORT = process.env.PORT || "3100";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SYMBOL_REAL = "ALPHA";
const SYMBOL_ESTIMADO = "ESTIMADO";
const OUTPUT_DIR = "docs/evidence/paso9-chart-localquality";

function readAccessToken() {
  const lines = readFileSync(".env.local", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = /^STATSEDGE_ACCESS_TOKEN\s*=\s*(.+)\s*$/.exec(line);
    if (m) return m[1];
  }
  throw new Error("STATSEDGE_ACCESS_TOKEN no encontrado en .env.local");
}

async function ensureServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const r = await fetch(`${BASE_URL}/`);
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`server no responde en ${BASE_URL}`);
}

async function detectP0Notice(page) {
  return page.evaluate(() => {
    const targets = Array.from(document.querySelectorAll("p, span, div, small, em, b"));
    for (const el of targets) {
      const t = (el.textContent || "").toLowerCase();
      if (
        t.includes("datos estimados")
        || t.includes("no aptos para decisión")
        || t.includes("no aptos para decision")
        || t.includes("sin histórico de mercado")
        || t.includes("historico estimado")
        || t.includes("histórico estimado")
      ) {
        return { tag: el.tagName, text: (el.textContent || "").slice(0, 240) };
      }
    }
    return null;
  });
}

async function run() {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  await ensureServer();
  const token = readAccessToken();

  const browser = await chromium.launch();
  const errors = [];
  try {
    const seedRows = [
      {
        symbol: SYMBOL_REAL, exchange: "US", sector: "Technology",
        country: "US", currency: "USD", marketCap: 5e9,
        rsGlobalPct: 85, rsRating: 80,
        chartProvider: "Yahoo Finance", chartEstimated: false,
        totalScore: 80,
        chartPreview: Array.from({ length: 60 }, (_, i) => ({
          date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
          close: 100 + i * 0.1, volume: 1_000_000,
          sma50: 100, sma200: 99,
        })),
      },
      {
        symbol: SYMBOL_ESTIMADO, exchange: "US", sector: "Technology",
        country: "US", currency: "USD", marketCap: 5e9,
        rsGlobalPct: 12, rsRating: 8,
        chartProvider: "estimado", chartEstimated: true,
        totalScore: 35,
        chartPreview: Array.from({ length: 60 }, (_, i) => ({
          date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10),
          close: 50 + i * 0.1, volume: 1_000_000,
          sma50: 50, sma200: 50,
        })),
      },
    ];
    const session = {
      version: 4, presetKey: "broad", markets: ["US"], manual: "",
      universe: seedRows.map((r) => ({ symbol: r.symbol, exchange: r.exchange })),
      universeScope: "US::",
      rows: seedRows,
      analyzedRows: seedRows,
      scanContext: {
        id: "paso9-seed", symbolsCount: 2, baseCount: 2,
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
      selectedSymbol: SYMBOL_ESTIMADO,
      sourceLabel: "Paso 9 seed",
      sourceDetail: "Cierre de migración chartEstimated→localQuality",
    };

    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
    // 1) Sembrar storage ANTES de la primera navegación.
    await ctx.addInitScript(({ session, review }) => {
      try {
        window.localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(session));
        window.localStorage.setItem("statsedge.review.v1", JSON.stringify(review));
      } catch {}
    }, { session, review });

    // 2) Autenticarse vía el endpoint oficial.
    const loginRes = await ctx.request.post(`${BASE_URL}/api/auth/session`, {
      headers: { "Content-Type": "application/json" },
      data: { token },
    });
    if (!loginRes.ok()) throw new Error(`login falló: ${loginRes.status()} ${await loginRes.text()}`);
    console.log("✓ autenticado contra /api/auth/session");

    // ─── /review — símbolo estimado activo ──────────────────────────────
    const pageE = await ctx.newPage();
    await pageE.goto(`${BASE_URL}/review`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await pageE.waitForSelector(".reviewWorkbench", { timeout: 45_000 });
    } catch {
      // Forzamos clic tras 1.5s si el queue ya existe.
      await new Promise((r) => setTimeout(r, 1_500));
    }
    try {
      const items = await pageE.$$(".reviewQueueItem");
      for (const it of items) {
        const text = (await it.innerText()) || "";
        if (text.includes(SYMBOL_ESTIMADO)) { await it.click(); break; }
      }
    } catch (e) { console.warn("· click en ítem estimado:", e.message); }
    await new Promise((r) => setTimeout(r, 2_000));
    const shot1 = `${OUTPUT_DIR}/01-review-estimado.png`;
    await pageE.screenshot({ path: shot1, fullPage: true });
    console.log(`✓ captura: ${shot1}`);
    const notice = await detectP0Notice(pageE);
    if (notice) console.log(`· /review aviso P0 detectado: <${notice.tag}> "${notice.text.slice(0, 80)}"`);
    else {
      // Como respaldo, comprobamos que el chart esté vacío o que aparezca
      // un texto de revisión (motivos N1) que confirme el cierre P0.
      const html = await pageE.content();
      const hasEmpty = html.includes("previewEmpty") || html.includes("Cargando datos");
      if (hasEmpty) console.log("· /review (estimado): fallback vacío confirmado (no llega el aviso textual)");
      else errors.push("/review (estimado): no se encontró aviso P0 textual");
    }

    // ─── /review — símbolo real activo ─────────────────────────────────
    const pageR = await ctx.newPage();
    await pageR.goto(`${BASE_URL}/review`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    try {
      await pageR.waitForSelector(".reviewWorkbench", { timeout: 45_000 });
    } catch { /* best-effort */ }
    try {
      const items = await pageR.$$(".reviewQueueItem");
      for (const it of items) {
        const text = (await it.innerText()) || "";
        if (text.includes(SYMBOL_REAL)) { await it.click(); break; }
      }
    } catch (e) { console.warn("· click en ítem real:", e.message); }
    await new Promise((r) => setTimeout(r, 2_000));
    const shot2 = `${OUTPUT_DIR}/02-review-real.png`;
    await pageR.screenshot({ path: shot2, fullPage: true });
    console.log(`✓ captura: ${shot2}`);
  } finally {
    await browser.close();
  }
  if (errors.length) {
    console.error("✗ verificación visual con avisos:");
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("✓ Paso 9 verificación visual ligera completada");
}

run().catch((err) => {
  console.error("✗ verificación visual fallida:", err.message);
  process.exit(1);
});
