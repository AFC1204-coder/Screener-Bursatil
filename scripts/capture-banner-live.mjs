// Captura de evidencia EN VIVO de la franja "Muestra parcial · percentil por lote"
// durante un scan REAL, autenticado, contra Supabase de producción.
//
// LO QUE HACE ESTE SCRIPT (flujo soportado, 100% real):
//  - Arranca un navegador, autentica la app vía el flujo normal (POST /api/auth/session
//    con el token de entorno, exactamente igual que un humano que escribe el token en
//    AuthGate). No inyecta localStorage de sesión ni cookies a mano: el endpoint
//    setea la cookie HttpOnly statsedge_session como en producción.
//  - Navega al ScreenerShell y conduce la UI con CLICKS reales: selecciona mercado US,
//    pulsa "Cargar universo", cambia el alcance a "Por lote" (batch de 50), pulsa Ejecutar.
//  - Hace polling del DOM mientras el scan corre y, cuando aparecen filas (=> la franja
//    se renderiza porque las filas de polling vienen sin metrics.percentileScope),
//    confirma la franja en el DOM, expande el <details>, captura el viewport completo.
//  - Hace hard-reload del navegador (page.goto + recarga forzada) y re-verifica la franja.
//
// LO QUE NO HACE (reglas estrictas respetadas):
//  - NO inyecta localStorage ni sembrado de snapshots.
//  - NO intercepta/redirige ninguna API (no page.route, no addInitScript de datos).
//  - NO usa fixtures ni snapshots locales. Las filas vienen del scan en vivo.
//  - NO escribe directamente en Supabase ni altera filas existentes.
//
// Uso: node scripts/capture-banner-live.mjs
import { chromium } from "playwright";

const URL = process.env.CAPTURE_URL || "http://localhost:3000/";
const APP_TOKEN = process.env.STATSEDGE_ACCESS_TOKEN;
const OUT_PATH = "./docs/evidence-percentile-banner-live.png";
const ZOOM_PATH = "./docs/evidence-percentile-banner-live-zoom.png";

if (!APP_TOKEN) {
  console.error("[live] Falta STATSEDGE_ACCESS_TOKEN. Necesario para autenticar la app.");
  process.exit(1);
}

const log = (...a) => console.log(`[live]`, ...a);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 2,
});
const page = await context.newPage();

const consoleErrors = [];
page.on("console", (msg) => { if (msg.type() === "error") consoleErrors.push(msg.text()); });
page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
page.on("requestfailed", (req) => {
  const u = req.url();
  if (/\/api\//.test(u)) consoleErrors.push(`requestfailed: ${u} :: ${req.failure()?.errorText}`);
});

// --- 1. Autenticación por el flujo soportado (igual que AuthGate onSubmit) ---
log("Autenticando vía POST /api/auth/session (flujo normal de AuthGate)...");
const authResp = await context.request.post(`${URL}api/auth/session`, {
  data: { token: APP_TOKEN },
  headers: { "Content-Type": "application/json" },
});
log(`Auth POST status: ${authResp.status()}`);
if (authResp.status() >= 400) {
  const body = await authResp.text().catch(() => "");
  console.error(`[live] Auth falló (${authResp.status()}): ${body.slice(0, 200)}`);
  await browser.close();
  process.exit(2);
}

// --- 2. Navegar al ScreenerShell ---
log("Navegando al ScreenerShell...");
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(4000); // tiempo para sessionReady + restoreSnapshot inicial

// Confirmamos que estamos autenticados (no en AuthGate).
const isAuthed = await page.locator("text=Global Leaders").first().isVisible({ timeout: 10000 }).catch(() => false);
log(`ScreenerShell visible (autenticado): ${isAuthed}`);
if (!isAuthed) {
  await page.screenshot({ path: OUT_PATH }).catch(() => {});
  console.error("[live] BLOQUEO: no se alcanzó el ScreenerShell (¿auth?). Captura de diagnóstico guardada.");
  await browser.close();
  process.exit(3);
}

// --- 3. Seleccionar mercado US (deseleccionar todos, luego activar US) ---
log("Seleccionando mercado US...");
// Botones de preset de mercado: click "EE. UU."
await page.locator('button:has-text("EE. UU.")').first().click({ timeout: 5000 }).catch((e) => log("preset US click:", e.message));

// --- 4. Cargar universo ---
log("Cargando universo US...");
await page.locator('button:has-text("Cargar universo")').first().click({ timeout: 10000 }).catch((e) => log("cargar universo:", e.message));
// Esperar a que el universo se cargue (el botón pasa a enabled / aparece kpi universo)
await page.waitForTimeout(6000);
const kpiUniverse = await page.locator(".kpi span:has-text('universo')").first().textContent().catch(() => "");
const kpiUnivNum = await page.locator(".kpi").first().locator("b").first().textContent().catch(() => "");
log(`KPI universo: "${kpiUnivNum}" (${kpiUniverse.trim()})`);

// --- 5. Cambiar alcance a "Por lote" (batch) y tamaño 50 ---
log("Configurando alcance: Por lote, 50 tickers...");
// Abrir "Cobertura y alcance"
const coberturaSummary = page.locator('summary:has-text("Cobertura y alcance")').first();
await coberturaSummary.click({ timeout: 5000 }).catch((e) => log("abrir cobertura:", e.message));
await page.waitForTimeout(400);

// select scanMode = "batch" (texto "Por lote")
await page.locator('select').first().selectOption("batch").catch((e) => log("select mode:", e.message));
// select scanBatchSize = 50
const sizeSelect = page.locator('select[aria-label="Tickers por lote"]').first();
await sizeSelect.selectOption("50").catch(async (e) => {
  log("select size (por aria-label):", e.message);
  // respaldo: segundo select del panel
  await page.locator('select').nth(1).selectOption("50").catch(() => {});
});
await page.waitForTimeout(300);

// --- 6. Ejecutar scan ---
log("Pulsando Ejecutar (scan real batch 50)...");
const runBtn = page.locator('button:has-text("Ejecutar")').first();
await runBtn.click({ timeout: 10000 }).catch((e) => log("ejecutar:", e.message));

// --- 7. Polling del DOM: esperar a que aparezcan filas y la franja ---
log("Esperando filas / franja durante el scan...");
const notice = page.locator(".percentileScopeNotice");
let scanId = null;
let bannerBefore = null;
let rowSnapshotBefore = null;
let rowsCountBefore = 0;
let capturedDuring = false;

// Leemos el scanId observando las peticiones reales POST /api/scan (sin interceptarlas:
// solo escuchamos el response; el body viaje normalmente).
page.on("response", async (resp) => {
  if (!scanId && /\/api\/scan(?:\?|$)/.test(resp.url()) && resp.request().method() === "POST") {
    try {
      const j = await resp.json();
      if (j?.scanId) scanId = j.scanId;
      log(`scanId observado (POST /api/scan): ${scanId}`);
    } catch {}
  }
});

const deadline = Date.now() + 180000; // 3 min máximo de observación
while (Date.now() < deadline) {
  await page.waitForTimeout(2500);
  const now = Date.now();
  const noticeCount = await notice.count();
  const bannerVisible = noticeCount > 0 ? await notice.isVisible().catch(() => false) : false;
  const running = await page.locator('.scanStatusBar.running').first().isVisible().catch(() => false);
  const statusText = await page.locator('.scanStatusBar b').first().textContent().catch(() => "");
  // Contar filas visibles en la tabla de resultados
  const rowCount = await page.locator('table tbody tr').count().catch(() => 0);
  log(`t+${Math.round((now - (deadline - 180000)) / 1000)}s | running=${running} | status="${(statusText||"").trim().slice(0,60)}" | filasTabla=${rowCount} | franja=${bannerVisible} (count=${noticeCount})`);

  if (bannerVisible && rowCount > 0 && !capturedDuring) {
    // ¡Aparecieron filas batch reales y la franja!
    rowsCountBefore = rowCount;
    bannerBefore = true;
    // Snapshot del DOM de la franja (textContent)
    rowSnapshotBefore = await notice.textContent().catch(() => "");
    // Expandir el <details>
    const summary = notice.locator("summary").first();
    await notice.evaluate((el) => el.setAttribute("open", "")).catch(() => {});
    await summary.click({ timeout: 3000 }).catch(() => {});
    await notice.evaluate((el) => el.setAttribute("open", "")).catch(() => {});
    await notice.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
    // Captura viewport completo + zoom a la franja
    await page.screenshot({ path: OUT_PATH, fullPage: false });
    await notice.screenshot({ path: ZOOM_PATH }).catch(() => {});
    log(`>>> CAPTURA durante polling guardada: ${OUT_PATH}`);
    log(`>>> filas batch: ${rowsCountBefore} | franja visible: ${bannerBefore}`);
    log(`>>> texto franja: "${(rowSnapshotBefore||"").replace(/\s+/g," ").trim().slice(0,200)}"`);
    capturedDuring = true;
    break; // suficiente evidencia durante el flujo
  }
  // Si el scan terminó sin nunca pintar la franja, salimos para reportar.
  if (!running && rowCount > 0 && noticeCount === 0) {
    log("Scan terminó; la franja no apareció durante el flujo.");
    break;
  }
}

// Estado del DOM antes del reload
const noticeCountBeforeReload = await notice.count().catch(() => 0);
const bannerVisibleBeforeReload = noticeCountBeforeReload > 0 ? await notice.isVisible().catch(() => false) : false;
const rowsBeforeReload = await page.locator('table tbody tr').count().catch(() => 0);
const overlayError = await page.locator('.error, [role="alert"]').first().isVisible().catch(() => false);
log(`--- ESTADO PRE-RELOAD --- franja=${bannerVisibleBeforeReload} (count=${noticeCountBeforeReload}) | filas=${rowsBeforeReload} | overlayError=${overlayError}`);

// --- 8. HARD-RELOAD ---
log("HARD-RELOAD del navegador...");
await context.clearCookies().catch(() => {}); // limpiar cookies para forzar re-auth (reload duro)
// Re-autenticar por el flujo soportado (igual que antes)
const reauth = await context.request.post(`${URL}api/auth/session`, {
  data: { token: APP_TOKEN },
  headers: { "Content-Type": "application/json" },
});
log(`Re-auth POST status: ${reauth.status()}`);
// Recarga forzada
await page.goto(URL, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(7000); // tiempo para sessionReady + restoreSnapshot (local o nube)

// --- 9. Re-verificar la franja tras el reload ---
const noticeCountAfter = await notice.count().catch(() => 0);
const bannerVisibleAfter = noticeCountAfter > 0 ? await notice.isVisible().catch(() => false) : false;
const rowsAfter = await page.locator('table tbody tr').count().catch(() => 0);
const statusAfter = await page.locator('.scanStatusBar b').first().textContent().catch(() => "");
const overlayErrorAfter = await page.locator('.error, [role="alert"]').first().isVisible().catch(() => false);
let bannerTextAfter = "";
if (noticeCountAfter > 0) {
  bannerTextAfter = await notice.textContent().catch(() => "");
  await notice.evaluate((el) => el.setAttribute("open", "")).catch(() => {});
  await notice.locator("summary").first().click({ timeout: 3000 }).catch(() => {});
  await notice.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
}
log(`--- ESTADO POST-RELOAD --- franja=${bannerVisibleAfter} (count=${noticeCountAfter}) | filas=${rowsAfter} | status="${(statusAfter||"").trim().slice(0,60)}" | overlayError=${overlayErrorAfter}`);
if (bannerTextAfter) log(`>>> texto franja post-reload: "${bannerTextAfter.replace(/\s+/g," ").trim().slice(0,200)}"`);

await browser.close();

// --- Reporte final ---
console.log("\n================ REPORTE ================");
console.log(`scanId: ${scanId || "(no observado)"}`);
console.log(`filas batch durante polling: ${rowsCountBefore}`);
console.log(`franja durante polling: ${bannerBefore}`);
console.log(`filas pre-reload: ${rowsBeforeReload} | franja pre-reload: ${bannerVisibleBeforeReload}`);
console.log(`filas post-reload: ${rowsAfter} | franja post-reload: ${bannerVisibleAfter}`);
console.log(`overlayError pre-reload: ${overlayError} | post-reload: ${overlayErrorAfter}`);
console.log(`errores de consola (api/runtime): ${consoleErrors.length}`);
if (consoleErrors.length) console.log("  muestras:\n  " + consoleErrors.slice(0, 8).join("\n  "));
console.log(`captura: ${OUT_PATH}${capturedDuring ? "" : " (NO capturada durante polling)"}`);
console.log("=========================================");
