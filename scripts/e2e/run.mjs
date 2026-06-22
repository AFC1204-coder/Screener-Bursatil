// Runner E2E del screener. Uso: npm run test:e2e
// (node --import ./scripts/refactor-check/register.mjs scripts/e2e/run.mjs [filtro])
// Arranca el dev server si no está, genera filas semilla con el buildResearchRow
// real y ejecuta las specs de tests/e2e/ secuencialmente en Chromium headless.
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { chromium } from "playwright";
import { buildResearchRow } from "@/lib/researchRow";
import { stage2Bars } from "../../tests/fixtures.js";

const BASE_URL = "http://127.0.0.1:3000";
const onlyFilter = process.argv[2] || "";
const SERVER_START_TIMEOUT_MS = Number(process.env.E2E_SERVER_TIMEOUT_MS || 180_000);

async function serverUp(page) {
  try {
    const response = await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded", timeout: 4_000 });
    return Boolean(response && response.status() < 500);
  } catch {
    return false;
  }
}

async function ensureServer() {
  const probeBrowser = await chromium.launch();
  const page = await probeBrowser.newPage();
  try {
    if (await serverUp(page)) return null;
    console.log("· arrancando dev server...");
    const child = spawn("npm", ["run", "dev"], {
      detached: false,
      env: { ...process.env, PORT: "3000" },
      stdio: "ignore",
    });
    const startedAt = Date.now();
    while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (await serverUp(page)) return child;
      if (child.exitCode !== null) break;
    }
    child.kill("SIGTERM");
    throw new Error(`El dev server no levantó en ${Math.round(SERVER_START_TIMEOUT_MS / 1000)}s`);
  } finally {
    await probeBrowser.close();
  }
}

// Filas semilla deterministas (mismas series sintéticas que los tests unitarios)
// en tres países para poder ejercitar los filtros de vista.
function seedRows() {
  const profile = (name) => ({ name, sector: "Technology", industry: "Semiconductors", marketCap: 5_000_000_000, growthMetrics: { revenueGrowth: 25, earningsGrowth: 30 } });
  return ["ALPHA", "BETA.DE", "GAMMA.PA"].map((symbol) => ({
    ...buildResearchRow(symbol, { bars: stage2Bars() }, profile(symbol), { requireLongHistory: false }, {}),
    // Percentiles RS que en un scan real añade la fase cross-sectional:
    rsGlobalPct: 85,
    rsRating: 80,
    rsCountryPct: 80,
    rsSectorPct: 80,
  }));
}

function sessionSeed({ rows = [], universe = [], markets = ["US"], manual = "" } = {}) {
  return {
    version: 4,
    presetKey: "broad",
    markets,
    manual,
    universe,
    universeScope: `${markets.join(",")}::${manual.trim()}`,
    rows,
    analyzedRows: rows,
    scanContext: rows.length ? {
      id: "e2e-seed",
      symbolsCount: rows.length,
      baseCount: rows.length,
      providerErrors: [],
      scannedAt: new Date().toISOString(),
    } : null,
    settings: {},
    scanMode: "all",
    status: "Listo",
  };
}

const specsDir = new URL("../../tests/e2e/", import.meta.url);
const specFiles = readdirSync(specsDir).filter((file) => file.endsWith(".e2e.mjs")).sort()
  .filter((file) => !onlyFilter || file.includes(onlyFilter));

const startedServer = await ensureServer();
const browser = await chromium.launch();
let failed = 0;
for (const file of specFiles) {
  const spec = await import(new URL(file, specsDir));
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const startedAt = Date.now();
  try {
    await spec.run({ context, baseUrl: BASE_URL, sessionSeed, seedRows });
    console.log(`✓ ${spec.name || file} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${spec.name || file}: ${error.message.split("\n")[0]}`);
  } finally {
    await context.close();
  }
}
await browser.close();
if (startedServer) {
  try {
    startedServer.kill("SIGTERM");
  } catch {
    // El proceso puede haber terminado por sí solo durante la suite.
  }
}
console.log(failed ? `E2E: ${failed} fallo(s) de ${specFiles.length}` : `E2E: ${specFiles.length}/${specFiles.length} en verde`);
process.exit(failed ? 1 : 0);
