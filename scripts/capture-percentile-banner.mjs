// Render-fixture helper para la franja "Muestra parcial · percentil por lote".
//
// IMPORTANTE — esto NO es una captura de flujo real ni un batch productivo:
// es una utilidad de fixture local. Inyecta en localStorage
// (statsedge.scans.v1) un snapshot sintético cuyas filas provienen de un
// fichero JSON local (no de un scan en vivo) y, además, intercepta
// /api/scans para devolver una lista vacía. El resultado es un render
// controlado del banner con datos seedados, útil solo como evidencia visual
// de que la UI pinta la franja cuando hay filas marcadas como batch.
//
// Lo que NO hace:
//  - No ejecuta ningún scan contra Supabase.
//  - No escribe en Supabase ni en ninguna tabla remota.
//  - No refleja un lote productivo real: las filas vienen de un fixture
//    local en /tmp (típicamente exportadas manualmente desde un dump JSON
//    previo) y el snapshot se siembra en localStorage antes del primer
//    goto. La marca percentileScope="batch" se aplica localmente sobre
//    esas filas; no es el estado "batch" real de un scan vivo.
//
// Uso: node scripts/capture-percentile-banner.mjs
// Pre-requisito: el fichero de filas en /tmp debe existir (ver ROWS_PATH).
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const ROWS_PATH = "/tmp/scan-rows-batch-fixture.json";
const OUT_PATH = "./docs/evidence-percentile-banner.png";
const ZOOM_PATH = "./docs/evidence-percentile-banner-zoom.png";
const URL = process.env.CAPTURE_URL || "http://localhost:3000/";

const rows = JSON.parse(readFileSync(ROWS_PATH, "utf8"));
if (!Array.isArray(rows) || !rows.length) {
  console.error(`[fixture] No hay filas en ${ROWS_PATH}.`);
  console.error("[fixture] Esto es una utilidad de render-fixture: nada se ejecuta contra Supabase.");
  process.exit(1);
}
// Re-etiquetamos el scope como "batch" localmente para forzar el banner.
// NO afirmamos que este sea el estado real de un scan en vivo: es una
// reconfiguración de fixture para validar el render de la franja.
const fixtureRows = rows.map((row) => ({ ...row, percentileScope: "batch" }));
const hasBatch = fixtureRows.some((r) => (r.percentileScope || "batch") === "batch");
console.log(`[fixture] Filas cargadas del fixture local: ${fixtureRows.length} | etiquetadas como batch: ${hasBatch}`);
console.log("[fixture] AVISO: esto es un render con fixture local. No es una captura de flujo real ni un batch productivo.");

// Snapshot local mínimo que restoreSnapshot acepta (settings.progress.status
// terminal para máxima prioridad de restauración; rowsAreFilteredSnapshot=true
// para que restoredSnapshotView devuelva las filas sin re-filtrar). Este
// snapshot es sintético: lo construye el script en memoria, no viene de
// Supabase ni de un scan en ejecución.
const scan = {
  id: "fixture-banner-render",
  local_id: "fixture-banner-render",
  name: "Render fixture: franja banner con filas batch (local, no batch real)",
  preset: "balanced",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  rowsAreFilteredSnapshot: true,
  settings: {
    sort: "totalScore",
    progress: { status: "complete", completed: fixtureRows.length, total: fixtureRows.length, chunkSize: 300 },
  },
  rows: fixtureRows,
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
});
// Hard-reload: limpiamos cookies/permisos y sembramos localStorage antes de la
// primera navegación, para que el restoreSnapshot dispare en el mount inicial.
await context.clearCookies();
await context.addInitScript(([{ key, value }]) => {
  try { window.localStorage.setItem(key, value); } catch (e) { console.warn("[fixture] localStorage seed failed", e); }
}, [{ key: "statsedge.scans.v1", value: JSON.stringify([scan]) }]);

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

// Interceptamos /api/scans para que el endpoint remoto NO devuelva snapshots
// con filas (el fixture es 100% local). Esto NO es parte de un flujo real:
// simplemente evita que el mount restaure algo desde la nube y caiga en
// nuestro snapshot sembrado en localStorage.
await page.route("**/api/scans**", (route) => route.fulfill({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ ok: true, configured: true, scans: [] }),
}));

// Autenticación: la app está tras AuthGate (POST /api/auth/session setea cookie
// statsedge_session). Sin esto, el goto muestra el formulario de login en vez
// del ScreenerShell. El token es STATSEDGE_ACCESS_TOKEN (env local).
const appToken = process.env.STATSEDGE_ACCESS_TOKEN;
if (appToken) {
  const authResp = await page.request.post(`${URL}api/auth/session`, {
    data: { token: appToken },
    headers: { "Content-Type": "application/json" },
  });
  console.log(`[fixture] Auth POST status: ${authResp.status()}`);
}

await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
// Damos tiempo al restoreSnapshot (ocurre tras cargar universo en effect).
await page.waitForTimeout(6000);

// Expandimos el <details> de la franja para que el párrafo sea visible en la captura.
const summary = page.locator(".percentileScopeNotice summary");
const notice = page.locator(".percentileScopeNotice");
const noticeCount = await notice.count();
const noticeVisible = noticeCount > 0 ? await notice.isVisible() : false;
console.log(`[fixture] Franja presente en DOM: ${noticeVisible} (count=${noticeCount})`);
if (noticeVisible) {
  // Forzamos el <details> abierto vía atributo (robusto frente a cualquier
  // pegada de CSS/eventos) y hacemos click en el summary como respaldo.
  await notice.evaluate((el) => { el.setAttribute("open", ""); }).catch(() => {});
  try { await summary.click({ timeout: 3000 }); } catch {}
  await notice.evaluate((el) => { el.setAttribute("open", ""); }).catch(() => {});
  // Hacemos scroll para que la franja quede en la zona visible.
  await notice.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
}

// Captura full-page + captura recortada a la franja.
await page.screenshot({ path: OUT_PATH, fullPage: false });
if (noticeVisible) {
  await notice.screenshot({ path: ZOOM_PATH }).catch(() => {});
}

// Validación de contenido: el texto del banner debe estar en el DOM renderizado.
// Leemos textContent del propio notice (no depende de la visibilidad del <p>
// colapsado) Y del body (confirmación de que está en el render real).
const noticeText = noticeCount > 0 ? await notice.textContent() : "";
const bannerTextPresent = Boolean(noticeText)
  && noticeText.includes("Muestra parcial")
  && noticeText.includes("percentil por lote");
console.log(`[fixture] Texto del banner renderizado: ${bannerTextPresent}`);

await browser.close();

if (!noticeVisible || !bannerTextPresent) {
  console.error("[fixture] BLOQUEO: la franja no se renderizó con el fixture local.");
  console.error("[fixture] Recuerda: este script es solo render-fixture, no ejecuta scans reales.");
  console.error("[fixture] Errores de consola capturados:", consoleErrors.slice(0, 8).join("\n  "));
  process.exit(2);
}
console.log(`[fixture] OK — render guardado en ${OUT_PATH} (y zoom en ${ZOOM_PATH}).`);
console.log("[fixture] AVISO: la imagen es solo evidencia de render con fixture local; no representa un batch productivo ni un flujo real.");