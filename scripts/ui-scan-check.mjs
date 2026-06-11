// Verificación UI del screener: scan por lote de 50 (US) con dos ajustes avanzados
// modificados (stageFastWeeks=8, requireUpVolume on). Guarda símbolos finales y la
// parte estable del estado para comparar antes/después del refactor de layout.
import { chromium } from "playwright";

const outFile = process.argv[2] || "/tmp/screener-baseline.json";
const expectAdvancedPanel = process.argv[3] === "advanced";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.setDefaultTimeout(30000);
await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle", timeout: 60000 });

await page.click('button:has-text("EE. UU.")');

let badges = {};
if (expectAdvancedPanel) {
  const summary = page.locator("details.advancedConfigPanel > summary");
  await summary.waitFor();
  badges.initial = (await summary.innerText()).replace(/\s+/g, " ").trim();
  await summary.click();
}

await page.click('summary:has-text("Cobertura y alcance")');
await page.locator('details:has(summary:has-text("Cobertura y alcance")) select').first().selectOption("batch");
await page.locator('details:has(summary:has-text("Cobertura y alcance")) select').nth(1).selectOption("50");

await page.locator('label:has-text("Media rapida semanal") input').fill("8");
await page.click('label.filterToggleLine:has-text("Volumen en vela alcista")');

if (expectAdvancedPanel) {
  badges.afterChanges = (await page.locator("details.advancedConfigPanel > summary").innerText()).replace(/\s+/g, " ").trim();
  console.log("badges:", JSON.stringify(badges));
}

await page.click('.topbar button:has-text("Ejecutar")');
await page.waitForFunction(() => /Completado|Cancelado|^Error/.test(document.querySelector("footer")?.innerText || ""), null, { timeout: 240000 });

// Si hay resultados pendientes (tabla congelada), confirmarlos
const commit = page.locator(".pendingResultsBar button >> visible=true");
try { await commit.first().click({ timeout: 3000 }); await page.waitForTimeout(500); } catch {}

const footer = (await page.locator("footer").innerText()).replace(/\s+/g, " ").trim();
const statusCore = (footer.match(/Completado: .*?(?= Scan )/) || [footer])[0];
const symbols = await page.$$eval(".compactResultsTable tbody tr", (rows) =>
  rows.map((row) => row.querySelector('a[href*="/stock/"], a.ticker')?.innerText?.trim().split("\n")[0]).filter(Boolean));
console.log("estado:", statusCore);
console.log("símbolos finales:", JSON.stringify(symbols));

const { writeFileSync } = await import("node:fs");
writeFileSync(outFile, JSON.stringify({ statusCore, symbols, badges }, null, 2));
await browser.close();
