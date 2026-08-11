// scripts/scan-universe.mjs — analiza el universo estadounidense completo y
// escribe UN escaneo (scans + scan_results), ejecutable a mano.
//
// ADR: docs/adr-escaneo-nocturno.md — el escaneo del universo se hace UNA VEZ
// POR NOCHE, fuera de Vercel. El usuario no lanza escaneos: aplica filtros
// guardados sobre los datos de la corrida de esta noche. Este script es
// FASE 1 de ese ADR: solo el script a mano. NO monta workflow, NO toca el
// escaneo interactivo (lib/serverScanRunner.js) ni el cron de Vercel
// (SCAN_CRON_GROUPS) — ambos siguen intactos y siguen siendo lo que ve hoy
// el usuario.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/scan-universe.mjs [--dry-run] [--write] [--limit=N] \
//     [--concurrency=4] [--preset=balanced]
//
// Por defecto corre en --dry-run (lista qué símbolos analizaría, no descarga
// ni escribe nada). Escribir en Supabase exige --write explícito.
//
// ── POBLACIÓN: reutiliza la selección de refresh-bars, no la duplica en
// espíritu, sí en código ──────────────────────────────────────────────────
// scripts/refresh-bars.mjs ya resolvió qué población usar (~5.605 símbolos
// US investables) y de dónde sacarla (universe_snapshot_symbols, la misma
// instantánea que usa scripts/rs-universe.mjs). Sus funciones de población
// (fetchLatestUsSnapshotId/fetchUniverseRows/buildEquityPopulation) NO
// llevan `export` — el propio refresh-bars.mjs explica por qué (su cabecera,
// líneas 82-91): rs-universe.mjs tampoco las exporta, y modificar un script
// existente para exportar funciones solo para que otro las importe queda
// fuera del alcance de esa tarea. Se aplica el MISMO criterio aquí, con el
// mismo motivo: "NO modifiques ningún archivo existente salvo que sea
// imprescindible" (restricción de esta tarea) y no lo es — reproducir la
// misma consulta y el mismo patrón de filtro (línea por línea, no solo el
// criterio) es la vía que el propio repo ya eligió dos veces.
//
// ── BLOQUEO ENCONTRADO (Parte A, punto 2) — confirmado citando código, no
// asumido del inventario ──────────────────────────────────────────────────
// El inventario (docs/inventario-obsoleto-2026-08-11.md) afirma que
// runMaterializedScan "se puede invocar directamente desde un script". Es
// cierto, pero NO con el patrón simple de refresh-bars.mjs (`node --loader
// ./scripts/loader.mjs`): ese loader solo resuelve extensiones .js/.json/
// .mjs vía node:fs y no transforma JSX. Import estático confirmado con un
// trace del grafo de imports:
//   lib/materializedScanner.js -> lib/leaderboards.js -> lib/screenerFilters.js
//   -> lib/listRationale.js -> lib/stockRows.js -> lib/methodologyEngine.js
//   -> lib/screenerFormat.js -> app/components/ui/MetricSource.jsx
// scripts/bench-analyze.mjs (líneas 27-49) ya documentó y resolvió este
// mismo bloqueo para benchmarking: arranca la API programática de Vitest
// (`vitest/node`), que sí trae el transform de JSX (vía Vite) que ya usa
// `npm test`. Este script sigue ese mismo precedente para el modo --write
// (que sí importa runMaterializedScan/writeMaterializedScan/
// screenerFiltersFromParams). El modo --dry-run NO lo necesita: solo lee
// universe_snapshot_symbols vía lib/supabaseServer.js, que no toca esa
// cadena de imports — corre con el loader plano, igual que refresh-bars.mjs.
//
// ── PRESET: "balanced", el mismo que el escaneo interactivo por defecto ──
// app/page.jsx inicializa su estado con settingsForPreset("balanced")
// (línea 168). PERO el cron actual (app/api/jobs/scan-refresh/route.js,
// app/api/cron/scan-refresh/route.js) NO aplica ese preset por defecto: si
// no llegan query params de filtro, screenerFiltersFromParams({}) devuelve
// `enabled:false`, y applyScreenerFilters con `enabled:false` es un
// pass-through literal (lib/screenerFilters.js:775) — el cron de hoy guarda
// a todo el que pase baseRejectReason (precio/turnover/market cap/cobertura/
// frescura), sin aplicar los umbrales de tendencia/momentum/cercanía de
// "balanced". Este script SÍ pasa `screenerFiltersFromParams({ filterPreset:
// args.preset })` explícitamente, para cumplir el punto 7 de la tarea al
// pie de la letra.
//
// ── RETENCIÓN: AVISO, no implementado ─────────────────────────────────────
// Este script NO implementa borrado/retención de escaneos viejos en `scans`/
// `scan_results`. Es fase aparte. NO debe programarse para correr a diario
// (ni en un workflow, ni en un cron) hasta que exista esa retención — cada
// corrida --write añade ~5.605 filas nuevas (o actualiza las del mismo día
// vía upsert por local_id) sin borrar las de días anteriores.
//
// ── maxSavedRows: sin el tope de 500 del cron actual ──────────────────────
// El cron interactivo cae a maxSavedRows=500 por defecto porque solo
// materializa una porción rotativa del universo cada noche. Este script
// analiza el universo COMPLETO en una sola corrida, así que truncar a 500
// perdería resultados reales del preset. Se pasa maxSavedRows =
// toProcess.length (con mínimo 1) para no truncar nada que sí pase el
// preset.

import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer.js";

const __filename = fileURLToPath(import.meta.url);

// Mismo patrón de nombre que scripts/refresh-bars.mjs:148 / scripts/rs-universe.mjs:85.
const CLOSED_END_FUND_NAME_PATTERN = /\b(FUND|BDC|BUSINESS DEVELOPMENT (CORP(ORATION)?|COMPANY)|CLOSED[- ]END)\b/i;

const MAX_CONCURRENCY = 8;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PRESET = "balanced";
// Cortesía con la instancia Supabase Micro (ver AVISO en el prompt de la
// tarea: se ha saturado dos veces esta semana): timeout generoso para que
// una corrida --write lenta no aborte a medias con datos parciales.
const VITEST_TEST_TIMEOUT_MS = 900000;

// ── CLI args ─────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    concurrency: DEFAULT_CONCURRENCY,
    preset: DEFAULT_PRESET,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "preset") out.preset = String(rawValue || DEFAULT_PRESET).trim() || DEFAULT_PRESET;
  }
  // Mismo criterio que refresh-bars.mjs: --write gana sobre el default
  // dry-run=true, pero --dry-run=true explícito manda sobre --write (más seguro).
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

// ── Población: mismo criterio "equity" que scripts/refresh-bars.mjs ───────
// (reproducido, no importado — ver cabecera).

async function fetchLatestUsSnapshotId(config) {
  const rows = await supabaseRequest("universe_snapshot_symbols", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      "market=eq.US",
      "select=snapshot_id,created_at",
      "order=created_at.desc",
      "limit=1",
    ].join("&"),
  });
  const snapshotId = rows?.[0]?.snapshot_id;
  if (!snapshotId) throw new Error("No hay ninguna instantánea de universe_snapshot_symbols con market='US'.");
  return { snapshotId, asOf: rows[0].created_at };
}

async function fetchUniverseRows(config, snapshotId) {
  const pageSize = 1000;
  const rows = [];
  let lastId = "";
  for (;;) {
    const query = [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `snapshot_id=eq.${encodeURIComponent(snapshotId)}`,
      "market=eq.US",
      "select=id,symbol,name,instrument_type,passed",
      "order=id.asc",
      `limit=${pageSize}`,
      lastId ? `id=gt.${encodeURIComponent(lastId)}` : "",
    ].filter(Boolean).join("&");
    const page = await supabaseRequest("universe_snapshot_symbols", { query });
    if (!Array.isArray(page) || page.length === 0) break;
    rows.push(...page);
    lastId = page.at(-1).id;
    if (page.length < pageSize) break;
  }
  return rows;
}

function buildEquityPopulation(universeRows) {
  const passedEquity = universeRows.filter((row) => row.passed === true && (row.instrument_type === "equity" || row.instrument_type === "listed-vehicle"));
  const closedEndFunds = passedEquity.filter((row) => CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
  const clean = passedEquity.filter((row) => !CLOSED_END_FUND_NAME_PATTERN.test(row.name || ""));
  return { rows: clean, excludedAsClosedEndFund: closedEndFunds };
}

// ── Modo --write: bootstrap de Vitest (ver "BLOQUEO ENCONTRADO" arriba) ───
// Mismo mecanismo que scripts/bench-analyze.mjs: este mismo archivo se
// re-ejecuta una segunda vez como "test file" bajo la API programática de
// Vitest (que sí transforma JSX), detectado por SCAN_UNIVERSE_MODE. La
// primera pasada (bootstrap, este proceso) le pasa los parámetros por
// variables de entorno y lee el resultado de un JSON temporal fuera del
// repo. No se reimplementa ninguna lógica de escaneo ni de escritura.

async function runAsVitestChild() {
  const { test } = await import("vitest");
  test("scan-universe-write", async () => {
    const { runMaterializedScan, writeMaterializedScan } = await import("@/lib/materializedScanner.js");
    const { screenerFiltersFromParams } = await import("@/lib/screenerFilters.js");

    const symbols = String(process.env.SCAN_UNIVERSE_SYMBOLS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const concurrency = Number(process.env.SCAN_UNIVERSE_CONCURRENCY || DEFAULT_CONCURRENCY);
    const preset = process.env.SCAN_UNIVERSE_PRESET || DEFAULT_PRESET;
    const screenerFilters = screenerFiltersFromParams({ filterPreset: preset });

    const startedAt = Date.now();
    const result = await runMaterializedScan({
      symbols,
      concurrency,
      markets: ["US"],
      cache: true,
      maxSavedRows: Math.max(symbols.length, 1),
      maxPriceFreshnessDays: 5,
      maxFundamentalsAgeDays: 14,
      minBars: 180,
      minPrice: 1,
      minAvgTurnover: 250000,
      minMarketCap: 300000000,
      minCoverageScore: 40,
      screenerFilters,
    });
    const scanElapsedMs = Date.now() - startedAt;

    const savedScan = await writeMaterializedScan(result.scan);
    const totalElapsedMs = Date.now() - startedAt;

    fs.writeFileSync(
      process.env.SCAN_UNIVERSE_RESULT_FILE,
      JSON.stringify({
        scanElapsedMs,
        totalElapsedMs,
        scan: { id: result.scan.id, name: result.scan.name, rowCount: result.scan.rows.length },
        stats: result.stats,
        savedScan,
        screenerFilters: { preset: screenerFilters.preset, enabled: screenerFilters.enabled, activeCount: screenerFilters.active.length },
      }),
    );
  }, VITEST_TEST_TIMEOUT_MS);
}

async function runWriteViaVitestChild({ symbols, concurrency, preset }) {
  const resultFile = path.join(os.tmpdir(), `scan-universe-write-result-${process.pid}.json`);
  process.env.SCAN_UNIVERSE_MODE = "vitest-child";
  process.env.SCAN_UNIVERSE_SYMBOLS = symbols.join(",");
  process.env.SCAN_UNIVERSE_CONCURRENCY = String(concurrency);
  process.env.SCAN_UNIVERSE_PRESET = preset;
  process.env.SCAN_UNIVERSE_RESULT_FILE = resultFile;

  const { startVitest } = await import("vitest/node");
  const vitest = await startVitest("test", [], {
    run: true,
    include: [pathToFileURL(__filename).href.replace("file://", "")],
    root: path.resolve(path.dirname(__filename), ".."),
    testTimeout: VITEST_TEST_TIMEOUT_MS,
    watch: false,
  });
  await vitest?.close();

  if (!fs.existsSync(resultFile)) {
    throw new Error("La corrida bajo Vitest no produjo el archivo de resultados (revisa el output de Vitest arriba por errores).");
  }
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  fs.unlinkSync(resultFile);
  return payload;
}

// ── Main (bootstrap) ───────────────────────────────────────────────────────

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  console.log(`=== scan-universe.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} concurrency=${args.concurrency} preset=${args.preset}${args.limit > 0 ? ` limit=${args.limit}` : ""} ===`);
  console.log("AVISO: este script NO implementa retención de escaneos viejos (scans/scan_results).");
  console.log("No lo programes a diario (cron ni workflow) hasta que exista esa retención — fase aparte.");
  console.log("");

  const { snapshotId, asOf } = await fetchLatestUsSnapshotId(config);
  console.log(`Instantánea de universo usada: ${snapshotId} (creada ${asOf})`);

  const universeRows = await fetchUniverseRows(config, snapshotId);
  console.log(`Filas market='US' en la instantánea: ${universeRows.length}`);

  const { rows: population, excludedAsClosedEndFund } = buildEquityPopulation(universeRows);
  console.log(`Población equity investable (passed=true, equity|listed-vehicle, sin fondos cerrados): ${population.length}`);
  console.log(`Excluidos por patrón de fondo cerrado: ${excludedAsClosedEndFund.length}`);

  const toProcess = args.limit > 0 ? population.slice(0, args.limit) : population;
  console.log("");
  console.log(`Símbolos a analizar en esta corrida: ${toProcess.length}${args.limit > 0 ? ` (de ${population.length}, por --limit)` : ""}`);

  if (!toProcess.length) {
    console.log("Nada que hacer: población vacía.");
    return;
  }

  if (args.dryRun) {
    console.log("");
    console.log(`Dry-run: lista de hasta 50 símbolos que se analizarían (de ${toProcess.length}), sin descargar ni escribir:`);
    for (const row of toProcess.slice(0, 50)) console.log(`  - ${row.symbol.padEnd(10)} ${row.name || ""}`);
    if (toProcess.length > 50) console.log(`  ... y ${toProcess.length - 50} más (omitidos del detalle, no del conteo).`);
    console.log("");
    console.log(`Preset a aplicar en una corrida real: ${args.preset}`);
    console.log("Dry-run: no se descargó ni se escribió nada en Supabase. Pasa --write para persistir.");
    console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return;
  }

  console.log("");
  console.log(`Procesando ${toProcess.length} símbolos vía runMaterializedScan (concurrency=${args.concurrency}, preset=${args.preset})...`);
  console.log("(arranca la API programática de Vitest para poder importar la cadena de imports que llega a JSX — ver cabecera del script)");

  const payload = await runWriteViaVitestChild({
    symbols: toProcess.map((row) => row.symbol),
    concurrency: args.concurrency,
    preset: args.preset,
  });

  const { stats, scan, savedScan, scanElapsedMs, totalElapsedMs, screenerFilters } = payload;

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Población total (universo US investable): ${population.length}`);
  console.log(`Seleccionados para esta corrida: ${stats.selected}`);
  console.log(`Analizados (con o sin éxito): ${stats.selected}`);
  console.log(`Pasaron el cribado base (histórico/precio/turnover/coverage/frescura): ${stats.passedBase}`);
  console.log(`Fallidos en el cribado base: ${stats.rejected}`);
  if (stats.rejections?.length) {
    for (const r of stats.rejections.slice(0, 30)) console.log(`  - ${r.symbol}: ${r.reason}`);
    if (stats.rejections.length > 30) console.log(`  ... y ${stats.rejected - 30} más (omitidos del detalle, no del conteo).`);
  }
  console.log(`Preset aplicado: ${screenerFilters.preset || "(ninguno, enabled=false)"} — ${screenerFilters.activeCount} reglas activas`);
  console.log(`Pasan el preset "${args.preset}": ${stats.passedFilters}`);
  console.log(`Filas guardadas en scan_results: ${savedScan.rows || 0}`);
  console.log("");
  console.log(`Escaneo creado en 'scans': id=${savedScan.scanId} local_id=${savedScan.localId}`);
  console.log(`Nombre: ${scan.name}`);

  const elapsedMs = Date.now() - startedAt;
  const msPerSymbol = stats.selected ? scanElapsedMs / stats.selected : 0;
  console.log("");
  console.log(`Tiempo de escaneo (runMaterializedScan, dentro del proceso Vitest): ${(scanElapsedMs / 1000).toFixed(1)}s`);
  console.log(`Tiempo de escaneo + escritura (runMaterializedScan + writeMaterializedScan): ${(totalElapsedMs / 1000).toFixed(1)}s`);
  console.log(`Ritmo: ${msPerSymbol.toFixed(0)} ms/símbolo (${(1000 / msPerSymbol || 0).toFixed(3)} símbolos/seg)`);
  console.log(`Tiempo total del script: ${(elapsedMs / 1000).toFixed(1)}s`);

  if (msPerSymbol > 0) {
    const estimatedFullMs = msPerSymbol * population.length;
    console.log("");
    console.log(`Estimación corrida completa (${population.length} símbolos, extrapolando el ritmo medido): ${(estimatedFullMs / 1000 / 60).toFixed(1)} min`);
  }
}

// ── Entrypoint: bootstrap normal, o segunda pasada como test de Vitest ────

if (process.env.SCAN_UNIVERSE_MODE === "vitest-child") {
  await runAsVitestChild();
} else {
  const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
  if (invokedDirectly) {
    main().catch((error) => {
      console.error("Error fatal:", error?.message || error);
      process.exitCode = 1;
    });
  }
}
