// scripts/bench-analyze.mjs — mide el CICLO COMPLETO por símbolo (descarga +
// cómputo local: fila de investigación, señales, cobertura) a distintas
// concurrencias, usando la función real de producción `runMaterializedScan`
// (lib/materializedScanner.js) — la misma que usa jobs/scan-refresh.
//
// Por qué runMaterializedScan y no analyzeOne directamente: `analyzeOne`,
// `hydrateBenchmarks`, `fetchChartForScan`, `fetchProfileForScan` y `mapLimit`
// son funciones privadas del módulo (sin `export`) — solo `buildResearchRow`
// y `sectorize` se exponen vía `_forTest`. No se reimplementó su lógica. En
// su lugar se invoca `runMaterializedScan({ symbols, concurrency, cache })`,
// la vía pública real: cuando se le pasan `symbols` explícitos, `resolveSymbols`
// (lib/materializedScanner.js:1205-1211) los usa tal cual y se salta la
// selección de universo (sin lectura a Supabase). A partir de ahí ejecuta
// EXACTAMENTE el mismo pipeline que el escaneo real: hydrateBenchmarks ->
// mapLimit(analyzeOne) -> sectorize -> applyScreenerFilters. Es la misma
// función que llama app/api/jobs/scan-refresh/route.js:383, salvo que aquí
// nunca se llama a `writeMaterializedScan` (función aparte, exportada por
// separado) — esta corrida no escribe nada en Supabase.
//
// `cache: false` desactiva la caché de barras y de perfiles en las dos capas:
// la de Supabase (daily_bars / fundamental_snapshots, vía
// withDailyBarsCache/withProfileCache: `useCache = options.useCache !== false`)
// y la caché en memoria de fetchYahooChart (lib/marketData.js:46: bypass si
// `options.useCache === false`). Cada símbolo fuerza una petición HTTP real,
// igual que hizo bench-concurrency.mjs con { refresh: true, useCache: false }.
//
// BLOQUEO ENCONTRADO Y CÓMO SE RESOLVIÓ (léase antes de desconfiar del
// resultado): lib/materializedScanner.js importa lib/screenerFormat.js, que
// importa app/components/ui/MetricSource.jsx (un componente React con JSX
// real). `node --loader ./scripts/loader.mjs` (el mecanismo que usan el
// resto de scripts de `npm run audit:*`) solo resuelve extensiones .js/.json/
// .mjs y no transforma JSX — falla con ERR_MODULE_NOT_FOUND primero y
// ERR_UNKNOWN_FILE_EXTENSION/error de sintaxis después. No se podía arreglar
// sin tocar scripts/loader.mjs (prohibido) ni sin reimplementar el pipeline
// de import de materializedScanner.js evitando screenerFormat.js (habría
// significado reimplementar/parchear lógica real, también prohibido).
//
// La vía real más cercana sin reimplementar nada: el propio repo ya prueba
// runMaterializedScan con símbolos explícitos bajo Vitest
// (tests/materializedScanProgress.test.js), y Vitest ya trae su propio
// pipeline de transformación (vía Vite) que sí sabe compilar JSX — es la
// misma herramienta que usa `npm test`, no una nueva. Este script, cuando se
// ejecuta directo con `node`, arranca la API programática de Vitest
// (`vitest/node`) apuntada a sí mismo como único "test file"; dentro de ese
// test file (segunda pasada de este mismo módulo, detectada por
// BENCH_ANALYZE_MODE=vitest-child) se llama a runMaterializedScan de verdad
// y el resultado se escribe a un JSON temporal fuera del repo (os.tmpdir())
// que el proceso padre lee y formatea. No se reimplementó ninguna lógica de
// escaneo: Vitest solo aporta el transform de JSX que ya usa el proyecto.
//
// Límite de instrumentación: runMaterializedScan no expone timing por
// símbolo. El "tiempo medio por símbolo" reportado es tiempo_total / N.
//
// No escribe en Supabase. No ejecuta el escaneo real ni ningún cron.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

function parseArgs(argv) {
  const out = { concurrency: 2, symbols: [] };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "concurrency") out.concurrency = Math.max(1, Number(value) || 2);
    if (key === "symbols") out.symbols = value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  return out;
}

async function runAsVitestChild() {
  const { test } = await import("vitest");
  test("bench-analyze", async () => {
    const { runMaterializedScan } = await import("@/lib/materializedScanner.js");
    const concurrency = Number(process.env.BENCH_CONCURRENCY || 2);
    const symbols = String(process.env.BENCH_SYMBOLS || "").split(",").map((s) => s.trim()).filter(Boolean);

    const cpuBefore = process.cpuUsage();
    const startedAt = Date.now();

    const result = await runMaterializedScan({
      symbols,
      concurrency,
      cache: false,
      markets: ["US"],
    });

    const totalMs = Date.now() - startedAt;
    const cpuDelta = process.cpuUsage(cpuBefore);

    fs.writeFileSync(
      process.env.BENCH_RESULT_FILE,
      JSON.stringify({
        totalMs,
        cpuUserMs: cpuDelta.user / 1000,
        cpuSystemMs: cpuDelta.system / 1000,
        stats: result.stats,
      }),
    );
  }, 300000);
}

async function runAsBootstrap() {
  const { concurrency, symbols } = parseArgs(process.argv.slice(2));
  if (!symbols.length) {
    console.error("Uso: --symbols=AAPL,MSFT,... --concurrency=N");
    process.exit(1);
  }

  console.log(`Bench-analyze: ${symbols.length} simbolos, concurrencia=${concurrency}, cache desactivada (bars+profile), ciclo completo (descarga+computo)`);
  console.log(`Simbolos: ${symbols.join(", ")}`);

  const resultFile = path.join(os.tmpdir(), `bench-analyze-result-${process.pid}-${concurrency}.json`);
  process.env.BENCH_ANALYZE_MODE = "vitest-child";
  process.env.BENCH_CONCURRENCY = String(concurrency);
  process.env.BENCH_SYMBOLS = symbols.join(",");
  process.env.BENCH_RESULT_FILE = resultFile;

  const wallStart = Date.now();
  const { startVitest } = await import("vitest/node");
  const vitest = await startVitest("test", [], {
    run: true,
    include: [pathToFileURL(__filename).href.replace("file://", "")],
    root: REPO_ROOT,
    testTimeout: 300000,
    watch: false,
  });
  await vitest?.close();
  const wallMs = Date.now() - wallStart;

  if (!fs.existsSync(resultFile)) {
    console.error("Fallo del bench: la corrida bajo Vitest no produjo el archivo de resultados (revisa el output de Vitest arriba por errores).");
    process.exit(1);
  }
  const child = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  fs.unlinkSync(resultFile);

  const { stats } = child;
  const okCount = stats.passedBase;
  const failCount = stats.rejected;
  const totalMs = child.totalMs;
  const totalSeconds = totalMs / 1000;
  const throughput = totalSeconds > 0 ? symbols.length / totalSeconds : 0;
  const avgPerSymbolMs = symbols.length ? totalMs / symbols.length : 0;

  console.log("");
  console.log("=== RESULTADO (ciclo completo: descarga + computo) ===");
  console.log(`Simbolos objetivo: ${symbols.length}`);
  console.log(`Concurrencia: ${concurrency}`);
  console.log(`Tiempo total (medido dentro de runMaterializedScan): ${totalSeconds.toFixed(2)}s`);
  console.log(`Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): ${(wallMs / 1000).toFixed(2)}s`);
  console.log(`Tiempo medio por simbolo (total/N, NO instrumentado por simbolo): ${(avgPerSymbolMs / 1000).toFixed(3)}s`);
  console.log(`RENDIMIENTO TOTAL: ${throughput.toFixed(4)} simbolos/seg (sobre el total de simbolos intentados, tiempo medido dentro de runMaterializedScan)`);
  console.log(`ok:true (pasaron baseRejectReason): ${okCount}`);
  console.log(`ok:false (rechazados): ${failCount}`);
  console.log(`CPU proceso Node (dentro del test) — user: ${child.cpuUserMs.toFixed(1)}ms, system: ${child.cpuSystemMs.toFixed(1)}ms, total: ${(child.cpuUserMs + child.cpuSystemMs).toFixed(1)}ms`);
  console.log(`  (uso de CPU del proceso hijo vía process.cpuUsage() — no es utilizacion de sistema/multi-nucleo, no incluye espera de I/O de red)`);

  console.log("");
  console.log("=== MOTIVOS DE RECHAZO (hasta 30, stats.rejections) ===");
  if (!stats.rejections.length) {
    console.log("  (ninguno)");
  } else {
    for (const r of stats.rejections) {
      console.log(`  ${r.symbol}: ${r.reason}`);
    }
  }

  console.log("");
  console.log(
    JSON.stringify(
      {
        symbolsRequested: symbols.length,
        concurrency,
        totalMs,
        wallMs,
        avgPerSymbolMs,
        throughputPerSec: throughput,
        okCount,
        failCount,
        rejections: stats.rejections,
        cpuUserMs: child.cpuUserMs,
        cpuSystemMs: child.cpuSystemMs,
        cpuTotalMs: child.cpuUserMs + child.cpuSystemMs,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

if (process.env.BENCH_ANALYZE_MODE === "vitest-child") {
  await runAsVitestChild();
} else {
  await runAsBootstrap();
}
