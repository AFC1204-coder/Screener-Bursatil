// Captura de preview del bloque de resultados de escritorio rediseñado.
// Genera 3 PNG: (1) estado inicial (grupo Decisiones abierto, Auditoría cerrado),
// (2) ambos grupos abiertos, (3) barra de filtros + "Más filtros" abierto.
// Uso: node --env-file=.env.local --import ./scripts/refactor-check/register.mjs scripts/e2e/previewDeclutter.mjs
import { chromium } from "playwright";
import { createHmac } from "crypto";
import { buildResearchRow } from "@/lib/researchRow";
import { stage2Bars } from "../../tests/fixtures.js";

const BASE_URL = process.env.STATSEDGE_E2E_BASE_URL || "http://127.0.0.1:3000";
const OUT_DIR = "output/playwright";

function signedSessionCookie(now = Date.now()) {
  const secret = String(process.env.STATSEDGE_SESSION_SECRET || process.env.STATSEDGE_ACCESS_TOKEN || "").trim();
  if (!secret) throw new Error("Falta STATSEDGE_SESSION_SECRET / STATSEDGE_ACCESS_TOKEN");
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000;
  const payload = `v1.${expiresAt}`;
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function seedRows() {
  const profile = (name) => ({ name, sector: "Technology", industry: "Semiconductors", marketCap: 5_000_000_000, growthMetrics: { revenueGrowth: 25, earningsGrowth: 30 } });
  return ["ALPHA", "BETA.DE", "GAMMA.PA"].map((symbol) => ({
    ...buildResearchRow(symbol, { bars: stage2Bars() }, profile(symbol), { requireLongHistory: false }, {}),
    rsGlobalPct: 85, rsRating: 80, rsCountryPct: 80, rsSectorPct: 80,
  }));
}

function sessionSeed(rows) {
  return {
    version: 4, presetKey: "broad", markets: ["US"], manual: "",
    universe: [], universeScope: "US::", rows, analyzedRows: rows,
    scanContext: { id: "preview-seed", symbolsCount: rows.length, baseCount: rows.length, providerErrors: [], scannedAt: new Date().toISOString() },
    settings: {}, scanMode: "all", status: "Listo",
  };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
const page = await context.newPage();
await page.addInitScript((seed) => { window.localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(seed)); }, sessionSeed(seedRows()));

await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".desktopResultsSection", { timeout: 20_000 });
await page.waitForTimeout(800);

const section = page.locator(".desktopResultsSection");

// (1) Estado inicial: Decisiones abierto, Auditoría cerrado.
await section.screenshot({ path: `${OUT_DIR}/declutter-1-inicial.png` });
console.log(`✓ ${OUT_DIR}/declutter-1-inicial.png (Decisiones abierto / Auditoría cerrado)`);

// (2) Abrir grupo Auditoría y datos → ambos abiertos.
await page.locator(".desktopResultsSection details.resultsAuditGroup > summary").click();
await page.waitForTimeout(400);
await section.screenshot({ path: `${OUT_DIR}/declutter-2-todo-abierto.png` });
console.log(`✓ ${OUT_DIR}/declutter-2-todo-abierto.png (ambos grupos abiertos)`);

// (3) Cerrar de nuevo Auditoría y abrir "Más filtros" para ver la barra de filtros completa.
await page.locator(".desktopResultsSection details.resultsAuditGroup > summary").click();
const moreFilters = page.locator(".desktopResultsSection .viewLayerFilters > summary");
if (await moreFilters.count() > 0) {
  await moreFilters.click();
  await page.waitForTimeout(300);
  await section.screenshot({ path: `${OUT_DIR}/declutter-3-filtros.png` });
  console.log(`✓ ${OUT_DIR}/declutter-3-filtros.png (barra de filtros + Más filtros abierto)`);
} else {
  console.log("· viewLayers inactivos: no hay disclosure 'Más filtros' que abrir (esperado si ningún view-layer está activo)");
}

await browser.close();
console.log("\nPreview generado.");
process.exit(0);
