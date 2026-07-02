// Verificación runtime dirigida del declutter del listado móvil.
// Comprueba lo que la suite unitaria no cubre:
//   (a) la cabecera móvil queda con 1 solo select (orden) + botones de acción
//   (b) el disclosure "Filtros" contiene los 4 selects no redundantes y abre al click
//   (c) los grupos Decisiones (abierto) / Auditoría y datos (cerrado) funcionan
//   (d) los selects duplicados por rails (pruebas/datos/score) ya no existen en móvil
// Uso: STATSEDGE_E2E_BASE_URL=... node --env-file=.env.local --import ./scripts/refactor-check/register.mjs scripts/e2e/mobileDeclutter.mjs
import { chromium } from "playwright";
import { createHmac } from "crypto";
import { buildResearchRow } from "@/lib/researchRow";
import { stage2Bars } from "../../tests/fixtures.js";

const BASE_URL = process.env.STATSEDGE_E2E_BASE_URL || "http://127.0.0.1:3000";

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
    scanContext: { id: "mobile-declutter-seed", symbolsCount: rows.length, baseCount: rows.length, providerErrors: [], scannedAt: new Date().toISOString() },
    settings: {}, scanMode: "all", status: "Listo",
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FALLÓ: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addCookies([{ name: "statsedge_session", value: signedSessionCookie(), domain: "127.0.0.1", path: "/" }]);
const page = await context.newPage();
await page.addInitScript((seed) => {
  window.localStorage.setItem("statsedge.screenerSession.v1", JSON.stringify(seed));
}, sessionSeed(seedRows()));

await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".mobileResultList", { timeout: 20_000 });
const list = page.locator(".mobileResultList");

console.log("== (a) cabecera móvil reducida ==");
const headSelects = await list.locator(".mobileResultListHead select").count();
assert(headSelects === 1, `la cabecera tiene exactamente 1 select de orden (hallados: ${headSelects})`);
const headButtons = await list.locator(".mobileResultListHead button").count();
assert(headButtons === 4, `la cabecera conserva los 4 botones de acción (hallados: ${headButtons})`);

console.log("== (b) disclosure Filtros ==");
const filterDisclosure = list.locator("details.mobileFilterDisclosure");
assert(await filterDisclosure.count() === 1, "existe el disclosure Filtros");
assert(await filterDisclosure.getAttribute("open") === null, "Filtros cerrado por defecto (sin filtros activos)");
await filterDisclosure.locator("summary").click();
await page.waitForTimeout(200);
assert(await filterDisclosure.getAttribute("open") !== null, "Filtros abre al click");
for (const label of ["Filtrar por confianza de decision", "Filtrar por prioridad de investigacion", "Filtrar por fiabilidad de observacion", "Filtrar por resolución de decision"]) {
  assert(await filterDisclosure.locator(`select[aria-label="${label}"]`).count() === 1, `select "${label}" dentro del disclosure`);
}

console.log("== (c) grupos Decisiones / Auditoría y datos ==");
const decisionGroup = list.locator("details.resultsDecisionGroup");
const auditGroup = list.locator("details.resultsAuditGroup");
assert(await decisionGroup.count() === 1, "existe el grupo Decisiones");
assert(await decisionGroup.getAttribute("open") !== null, "grupo Decisiones abre por defecto");
assert(await auditGroup.count() === 1, "existe el grupo Auditoría y datos");
assert(await auditGroup.getAttribute("open") === null, "grupo Auditoría y datos cerrado por defecto");
await auditGroup.locator("summary").click();
await page.waitForTimeout(200);
assert(await auditGroup.getAttribute("open") !== null, "grupo Auditoría y datos abre al click");
const railsInAudit = await auditGroup.locator(".dataHealthSummaryRail, .scoreAuditSummaryRail, .decisionEvidenceSummaryRail").count();
assert(railsInAudit >= 2, `hay rails dentro del grupo Auditoría (hallados: ${railsInAudit})`);

console.log("== (d) selects duplicados eliminados en móvil ==");
for (const label of ["Filtrar por pruebas de decision", "Filtrar por salud de datos", "Filtrar por auditoría de score"]) {
  assert(await list.locator(`select[aria-label="${label}"]`).count() === 0, `select "${label}" eliminado (su rail es el control canónico)`);
}

console.log("\nRESULTADO: verificación runtime móvil SUPERADA");
await browser.close();
process.exit(0);
