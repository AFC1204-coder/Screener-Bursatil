// scripts/scan-universe-hk.mjs — escaneo nocturno de los valores LÍQUIDOS de
// Hong Kong: escribe UN escaneo (scans + scan_results), ejecutable a mano.
//
// Plan: research/operacion-diaria-2026-11/plan-hong-kong-liquidos.md
//
// Por qué existe: scripts/scan-universe.mjs está fijado a market='US', y los
// escaneos HK salían del cron rotativo scan-refresh (≈84 símbolos cada 3-4
// semanas). Decisión del usuario (2026-11-08): HK = solo líquidos
// (lista de scripts/ops/hk-liquid-universe.mjs, corte 5 M HKD/día).
//
// Es una versión reducida de scan-universe.mjs y comparte su mecanismo: para
// importar runMaterializedScan (cadena de imports que llega a JSX) arranca la
// API programática de Vitest y se re-ejecuta como «test» (ver la cabecera de
// scan-universe.mjs, «BLOQUEO ENCONTRADO»). Diferencias a propósito:
//   - población = la lista líquida, no una instantánea;
//   - markets: ["HK"], y los umbrales por fila de HK los resuelve
//     baseRejectReason (INT-3c), igual que en el cron;
//   - SIN retención: no borra escaneos. Un escaneo HK por noche son ~760
//     filas; la retención se decidirá aparte.
//   - cada corrida es un escaneo distinto (t<HHMMSS> en el local_id).
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/scan-universe-hk.mjs [--dry-run] [--write] [--limit=N] \
//     [--list=logs/hk-liquid-universe.json] [--concurrency=4] [--preset=balanced]
//
// Por defecto corre en --dry-run. Una corrida con --limit escribe con el prefijo
// "test:" (no cuenta como escaneo HK real). Salida: 0 bien · 1 error.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { TEST_LOCAL_ID_PREFIX } from "@/lib/scanLocalId.js";
import { readLiquidList } from "./refresh-bars-hk.mjs";

const __filename = fileURLToPath(import.meta.url);

const MAX_CONCURRENCY = 6;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PRESET = "balanced";
const VITEST_TEST_TIMEOUT_MS = 900000;

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    list: "logs/hk-liquid-universe.json",
    concurrency: DEFAULT_CONCURRENCY,
    preset: DEFAULT_PRESET,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "list") out.list = String(rawValue || out.list);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "preset") out.preset = String(rawValue || DEFAULT_PRESET).trim() || DEFAULT_PRESET;
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

/** Una corrida acotada (--limit) nunca debe pasar por el escaneo HK real. */
export function localIdPrefixFor(args = {}) {
  return args.limit > 0 ? TEST_LOCAL_ID_PREFIX : "";
}

async function runAsVitestChild() {
  const { test } = await import("vitest");
  test("scan-universe-hk-write", async () => {
    const { runMaterializedScan, writeMaterializedScan } = await import("@/lib/materializedScanner.js");
    const { screenerFiltersFromParams } = await import("@/lib/screenerFilters.js");
    const { writeScanSymbolHistory } = await import("@/lib/scanHistory.js");
    const { supabaseConfig } = await import("@/lib/supabaseServer.js");

    const symbols = String(process.env.SCAN_HK_SYMBOLS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const concurrency = Number(process.env.SCAN_HK_CONCURRENCY || DEFAULT_CONCURRENCY);
    const preset = process.env.SCAN_HK_PRESET || DEFAULT_PRESET;
    const localIdPrefix = process.env.SCAN_HK_LOCAL_ID_PREFIX || "";
    const screenerFilters = screenerFiltersFromParams({ filterPreset: preset });

    const startedAt = Date.now();
    const result = await runMaterializedScan({
      symbols,
      concurrency,
      markets: ["HK"],
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
      localIdPrefix,
      localIdRunStamp: true,
    });
    const scanElapsedMs = Date.now() - startedAt;
    const savedScan = await writeMaterializedScan(result.scan);
    // La población NO es el universo completo de HK: nunca autoritativa, para no
    // marcar como «fuera del universo» a los ~2.000 ilíquidos que no se miran.
    const history = savedScan.saved && result.history
      ? await writeScanSymbolHistory({
        ownerId: supabaseConfig().ownerId,
        sourceScanId: savedScan.scanId,
        ...result.history,
        authoritativeUniverse: false,
        universeSymbols: [],
      }).catch((error) => ({ saved: false, error: error?.message || String(error) }))
      : { skipped: true, saved: 0 };

    fs.writeFileSync(
      process.env.SCAN_HK_RESULT_FILE,
      JSON.stringify({
        scanElapsedMs,
        totalElapsedMs: Date.now() - startedAt,
        scan: { id: result.scan.id, name: result.scan.name, rowCount: result.scan.rows.length, lightRowCount: result.scan.lightRows?.length || 0 },
        stats: result.stats,
        savedScan,
        history,
      }),
    );
  }, VITEST_TEST_TIMEOUT_MS);
}

async function runWriteViaVitestChild({ symbols, concurrency, preset, localIdPrefix }) {
  const resultFile = path.join(os.tmpdir(), `scan-universe-hk-result-${process.pid}.json`);
  process.env.SCAN_HK_MODE = "vitest-child";
  process.env.SCAN_HK_SYMBOLS = symbols.join(",");
  process.env.SCAN_HK_CONCURRENCY = String(concurrency);
  process.env.SCAN_HK_PRESET = preset;
  process.env.SCAN_HK_LOCAL_ID_PREFIX = localIdPrefix || "";
  process.env.SCAN_HK_RESULT_FILE = resultFile;

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
    throw new Error("La corrida bajo Vitest no produjo el archivo de resultados (revisa el output de Vitest).");
  }
  const payload = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  fs.unlinkSync(resultFile);
  return payload;
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const { symbols, generatedAt, minTurnoverHKD } = readLiquidList(args.list);
  const toProcess = args.limit > 0 ? symbols.slice(0, args.limit) : symbols;
  const localIdPrefix = localIdPrefixFor(args);

  console.log(`=== scan-universe-hk.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} concurrency=${args.concurrency} preset=${args.preset}${args.limit > 0 ? ` limit=${args.limit}` : ""} ===`);
  console.log(`Lista: ${args.list} (generada ${generatedAt}, corte ${Number(minTurnoverHKD).toLocaleString("es-ES")} HKD/día)`);
  if (localIdPrefix) console.log(`CORRIDA DE PRUEBA: --limit acota la población; el local_id llevará el prefijo "${localIdPrefix}".`);
  console.log(`Símbolos a analizar: ${toProcess.length} (de ${symbols.length} en la lista)`);

  if (args.dryRun) {
    console.log(`Primeros 10: ${toProcess.slice(0, 10).join(", ")}`);
    console.log("Dry-run: no se descargó ni se escribió nada. Pasa --write para persistir.");
    return 0;
  }

  const payload = await runWriteViaVitestChild({
    symbols: toProcess,
    concurrency: args.concurrency,
    preset: args.preset,
    localIdPrefix,
  });
  const { stats, scan, savedScan, history, scanElapsedMs, totalElapsedMs } = payload;
  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Seleccionados: ${stats.selected} · pasaron el cribado base: ${stats.passedBase} · rechazados: ${stats.rejected}`);
  if (stats.rejections?.length) {
    for (const r of stats.rejections.slice(0, 20)) console.log(`  - ${r.symbol}: ${r.reason}`);
    if (stats.rejected > 20) console.log(`  ... y ${stats.rejected - 20} más (omitidos del detalle, no del conteo).`);
  }
  console.log(`Pasan el preset "${args.preset}": ${stats.passedFilters}`);
  console.log(`Filas guardadas en scan_results: ${savedScan.totalRows ?? savedScan.rows ?? 0} (completas ${savedScan.rows || 0}, ligeras ${savedScan.lightRows || 0})`);
  console.log(`Escaneo creado: id=${savedScan.scanId} local_id=${savedScan.localId}`);
  console.log(`Nombre: ${scan.name}`);
  if (history?.error) console.log(`AVISO: el histórico de símbolos FALLÓ (el escaneo no se ve afectado): ${history.error}`);
  else if (!history?.skipped) console.log(`Histórico: ${history?.saved ?? 0} filas nuevas de ${history?.candidates ?? 0} observaciones.`);
  console.log(`Tiempo de escaneo: ${(scanElapsedMs / 1000).toFixed(1)}s · con escritura: ${(totalElapsedMs / 1000).toFixed(1)}s · total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
  return savedScan.saved ? 0 : 1;
}

if (process.env.SCAN_HK_MODE === "vitest-child") {
  await runAsVitestChild();
} else {
  const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
  if (invokedDirectly) {
    main()
      .then((code) => { process.exitCode = code; })
      .catch((error) => {
        console.error("Error fatal:", error?.message || error);
        process.exitCode = 1;
      });
  }
}
