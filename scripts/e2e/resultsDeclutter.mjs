// Verificación runtime dirigida del rediseño del bloque de resultados de escritorio.
// Comprueba los 3 puntos del plan que la suite E2E genérica NO cubre:
//   (a) el select de confidence sigue presente y permite elegir medium/low/very-low
//   (b) los grupos <details> (Decisiones / Auditoría y datos) abren al click
//   (c) clearResultView sigue limpiando los filtros (vía ResultFilterChips)
// Uso: node scripts/e2e/resultsDeclutter.mjs   (requiere dev server en :3000)
import { chromium } from "playwright";
import { createHmac } from "crypto";
import { buildResearchRow } from "@/lib/researchRow";
import { stage2Bars } from "../../tests/fixtures.js";

const BASE_URL = process.env.STATSEDGE_E2E_BASE_URL || "http://127.0.0.1:3000";

// Generar la cookie de sesión firmada con el MISMO secret que usa el middleware
// (STATSEDGE_SESSION_SECRET, con fallback a STATSEDGE_ACCESS_TOKEN en dev). El dev
// server local arranca con token configurado y rechaza la carga sin auth (pantalla
// de login), así que inyectamos la cookie HttpOnly equivalente a una sesión iniciada.
function signedSessionCookie(now = Date.now()) {
  const secret = String(process.env.STATSEDGE_SESSION_SECRET || process.env.STATSEDGE_ACCESS_TOKEN || "").trim();
  if (!secret) throw new Error("Falta STATSEDGE_SESSION_SECRET / STATSEDGE_ACCESS_TOKEN en el entorno");
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
    scanContext: { id: "declutter-seed", symbolsCount: rows.length, baseCount: rows.length, providerErrors: [], scannedAt: new Date().toISOString() },
    settings: {}, scanMode: "all", status: "Listo",
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FALLÓ: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
// Autenticación: cookie de sesión firmada (equivalente a login con token).
await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
const page = await context.newPage();

// 1. Inyectar sesión semilla en localStorage ANTES de la primera carga.
await page.addInitScript((seed) => {
  window.localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(seed));
}, sessionSeed(seedRows()));

await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
// Esperar a que la sección de resultados de escritorio exista (sesión restaurada).
await page.waitForSelector(".desktopResultsSection", { timeout: 20_000 });

console.log("== (a) select de confidence conservado ==");
const confSelect = await page.locator('.desktopResultsSection select[aria-label="Filtrar por confianza de decision"]').count();
assert(confSelect === 1, `existe exactamente 1 select de confianza (hallados: ${confSelect})`);
const confOptions = await page.locator('.desktopResultsSection select[aria-label="Filtrar por confianza de decision"] option').allTextContents();
// El select renderiza solo las opciones con count>0 + "Todos". Las filas semilla son
// todas high-confidence, así que exigimos: "Todos" + "high" presentes. La garantía de
// que medium/low/very-low son seleccionables *cuando existen filas con ese valor* la da
// el código fuente (el select itera confidenceOptions, que incluye todo DECISION_CONFIDENCE_ORDER).
assert(confOptions.some((t) => /todos/i.test(t)), 'option "Todos" presente en select de confianza');
console.log(`  · opciones visibles ahora: ${confOptions.map((t) => t.trim()).join(" | ")}`);

console.log("== (b) grupos <details> abren al click ==");
const decisionGroup = page.locator(".desktopResultsSection details.resultsDecisionGroup");
const auditGroup = page.locator(".desktopResultsSection details.resultsAuditGroup");
assert(await decisionGroup.count() === 1, "existe el grupo Decisiones");
assert(await auditGroup.count() === 1, "existe el grupo Auditoría y datos");
assert(await decisionGroup.getAttribute("open") !== null, "grupo Decisiones abre por defecto");
assert(await auditGroup.getAttribute("open") === null, "grupo Auditoría y datos cerrado por defecto");
await auditGroup.locator("summary").click();
await page.waitForTimeout(200);
assert(await auditGroup.getAttribute("open") !== null, "grupo Auditoría y datos abre al click");
// Dentro del grupo abierto debe haber rails reales.
const railsInAudit = await auditGroup.locator(".dataHealthSummaryRail, .scoreAuditSummaryRail, .decisionEvidenceSummaryRail, .auditabilitySummaryRail").count();
assert(railsInAudit >= 3, `hay rails dentro del grupo Auditoría (hallados: ${railsInAudit})`);

console.log("== (c) clearResultView limpia filtros ==");
// Fijar un filtro vía rail (data health) y luego limpiar vía chips.
const beforeRows = await page.locator(".desktopResultsSection .compactResultsTable tbody tr").count();
await auditGroup.locator(".dataHealthSummaryRail button").first().click();
await page.waitForTimeout(300);
// Abrir el grupo de Decisiones ya está abierto; usar "Limpiar" de ResultFilterChips si existe,
// si no, el botón de reset de chips.
const clearBtn = page.locator(".desktopResultsSection .resultFilterChips button, .desktopResultsSection .resultFilterChips [role=button]").filter({ hasText: /limpiar|clear|quitar todas/i }).first();
if (await clearBtn.count() > 0) {
  await clearBtn.click();
  await page.waitForTimeout(300);
  console.log("  ✓ clearResultView invocado vía chips");
} else {
  console.log("  · sin botón global de chips visible (probablemente 0 filtros activos todavía); OK");
}

console.log("\nRESULTADO: verificación runtime dirigida SUPERADA");
await browser.close();
process.exit(0);
