// scripts/bench-scan-overhead.mjs — instrumenta runMaterializedScan
// (lib/materializedScanner.js) fase por fase para separar el coste FIJO
// (no escala con símbolos) del coste MARGINAL (por símbolo), en el contexto
// del análisis docs/overhead-scan-2026-08-05.md.
//
// Reutiliza el mecanismo de scripts/bench-analyze.mjs para resolver el
// bloqueo de JSX (materializedScanner.js -> screenerFormat.js ->
// MetricSource.jsx): arranca Vitest programáticamente (vitest/node) apuntado
// a sí mismo como único test file, porque Vitest ya trae el transform de
// JSX que usa el proyecto (npm test). No se reimplementa ninguna lógica de
// escaneo ni se toca scripts/loader.mjs.
//
// INSTRUMENTACION (no existe en bench-analyze.mjs): antes de importar
// materializedScanner.js se envuelve global.fetch para:
//   1. Cronometrar cada petición de red por separado (Supabase REST, Yahoo,
//      ASIC) y clasificarla por tabla/host/símbolo a partir de la URL.
//   2. BLOQUEAR cualquier método de escritura (POST/PATCH/DELETE/PUT) hacia
//      el host de Supabase — nunca se deja pasar, se responde con un 200
//      vacío sintético y se registra como "blocked_write" en vez de tocar
//      produccion. Esto es un cinturón de seguridad adicional sobre
//      `cache:false` (que ya evita que withDailyBarsCache/withProfileCache
//      intenten escribir) para el caso `--markets` (ver más abajo), donde
//      un cache-miss de universo dispararía writeSupabaseSnapshot.
//   3. Las peticiones GET a Supabase y a Yahoo/ASIC SÍ se dejan pasar: son
//      lecturas reales contra produccion (permitido — la restricción es NO
//      ESCRIBIR) o contra la API pública de Yahoo.
//
// DOS MODOS:
//   --symbols=A,B,C   Modo pedido explícitamente por la tarea (item 3): symbols
//                      explícitos, igual que bench-analyze.mjs. resolveSymbols()
//                      (lib/materializedScanner.js:1234-1254) los usa tal cual
//                      y SALTA POR COMPLETO getUniverseEngineSnapshot y
//                      readRecentlyScannedSymbols (no hay red hacia Supabase
//                      para universo/scan_results en este modo). Mide
//                      hydrateBenchmarks + analyzeOne + sectorize + filtros.
//   --markets=US,HK,AU --limit=12   Modo adicional (no pedido literalmente,
//                      añadido porque el modo --symbols no puede medir
//                      universe_select ni readRecentlyScannedSymbols, que son
//                      las fases sospechosas de cargar el coste fijo). Llama
//                      a runMaterializedScan con mercados reales para forzar
//                      la resolución real de símbolos (lecturas GET reales a
//                      universe_snapshot_symbols y scan_results), igual que
//                      hace app/api/cron/scan-refresh/route.js. Ninguna
//                      escritura: refreshUniverse queda forzado a false y el
//                      bloqueador de fetch (punto 2) corta cualquier intento.
//
// LIMITE DE INSTRUMENTACION: igual que bench-analyze.mjs, runMaterializedScan
// no expone timing por símbolo; el desglose por fase que SI se puede medir
// aquí es el de las llamadas de red (cada await fetch() cronometrado
// individualmente), no un hook interno de fases adicional a onPhase.
//
// No escribe en Supabase (bloqueado activamente, ver punto 2). No ejecuta el
// escaneo real ni ningún cron. No modifica ningún archivo existente.

import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

function parseArgs(argv) {
  const out = {
    concurrency: 2,
    symbols: [],
    markets: [],
    limit: 12,
    perMarket: 0,
    cache: false,
    skipRecentlyScanned: true,
    cronUniverseSnapshot: true,
    universeMaxAgeHours: 48,
  };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "concurrency") out.concurrency = Math.max(1, Number(value) || 2);
    if (key === "symbols") out.symbols = value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (key === "markets") out.markets = value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (key === "limit") out.limit = Math.max(1, Number(value) || 12);
    if (key === "perMarket") out.perMarket = Math.max(0, Number(value) || 0);
    if (key === "cache") out.cache = value !== "false" && value !== "0";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clasificación de peticiones de red (usada dentro del hijo de Vitest)
// ---------------------------------------------------------------------------
function classifyUrl(urlStr, symbolsOfInterest = []) {
  let u;
  try {
    u = new URL(urlStr);
  } catch {
    return { kind: "unknown", table: null };
  }
  const host = u.hostname;
  if (host.includes("supabase.co") || u.pathname.includes("/rest/v1/") || u.pathname.includes("/rpc/")) {
    const restMatch = u.pathname.match(/\/rest\/v1\/([^/?]+)/);
    const rpcMatch = u.pathname.match(/\/rpc\/([^/?]+)/);
    const table = restMatch?.[1] || rpcMatch?.[1] || "unknown_table";
    let kind = `supabase:${table}`;
    if (table === "universe_snapshots" || table === "universe_snapshot_symbols") kind = "universe_read";
    else if (table === "scan_results") kind = "recent_scan_read";
    else if (table === "daily_bars") kind = "daily_bars_cache";
    else if (table === "fundamental_snapshots") kind = "fundamentals_cache";
    return { kind, table };
  }
  if (host.includes("finance.yahoo.com")) {
    const symbolMatch = u.pathname.match(/\/(?:chart|quoteSummary)\/([^/?]+)/) || u.search.match(/symbols?=([^&]+)/);
    const rawSymbol = decodeURIComponent(symbolMatch?.[1] || "").toUpperCase();
    const isBenchmark = ["SPY", "QQQ", "ACWI"].includes(rawSymbol);
    const isTarget = symbolsOfInterest.includes(rawSymbol);
    const yahooKind = u.pathname.includes("/chart/") ? "chart" : u.pathname.includes("quoteSummary") ? "profile" : "other";
    return { kind: `yahoo_${yahooKind}:${isBenchmark ? "benchmark" : isTarget ? "target" : "other"}`, table: null, symbol: rawSymbol };
  }
  if (host.includes("asic.gov.au")) return { kind: "asic_short_interest", table: null };
  if (host.includes("stooq.com")) return { kind: "stooq", table: null };
  return { kind: `other:${host}`, table: null };
}

async function runAsVitestChild() {
  const { test } = await import("vitest");
  test("bench-scan-overhead", async () => {
    const symbols = String(process.env.BENCH_SYMBOLS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const markets = String(process.env.BENCH_MARKETS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const limit = Number(process.env.BENCH_LIMIT || 12);
    const perMarket = Number(process.env.BENCH_PERMARKET || 0);
    const concurrency = Number(process.env.BENCH_CONCURRENCY || 2);
    const cache = process.env.BENCH_CACHE === "true";
    const skipRecentlyScanned = process.env.BENCH_SKIP_RECENT === "true";
    const cronUniverseSnapshot = process.env.BENCH_CRON_SNAPSHOT === "true";
    const universeMaxAgeHours = Number(process.env.BENCH_MAX_AGE_HOURS || 48);
    const symbolsOfInterest = symbols;

    // --- Instrumentacion de fetch: cronometraje + bloqueo de escritura -----
    const requestLog = [];
    let blockedWrites = 0;
    const originalFetch = global.fetch;
    global.fetch = async (input, init = {}) => {
      const urlStr = typeof input === "string" ? input : input?.url || String(input);
      const method = (init.method || "GET").toUpperCase();
      const isSupabase = urlStr.includes("supabase.co") || urlStr.includes("/rest/v1/") || urlStr.includes("/rpc/");
      if (isSupabase && method !== "GET") {
        blockedWrites += 1;
        requestLog.push({
          urlStr,
          method,
          kind: "BLOCKED_WRITE",
          startedAt: Date.now(),
          durationMs: 0,
        });
        // Respuesta sintética: PostgREST responde arrays en GET/POST con
        // return=representation; un array vacío es un valor seguro que no
        // hace que el código que lo consume (ej. writeSupabaseSnapshot)
        // lance con "cannot read [0] of undefined" en la mayoría de casos.
        // Este modo del script nunca ejercita esos caminos de escritura de
        // forma intencional (ver cabecera), este bloqueo es cinturón extra.
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      }
      const classification = classifyUrl(urlStr, symbolsOfInterest);
      const startedAt = Date.now();
      try {
        const res = await originalFetch(input, init);
        requestLog.push({
          urlStr,
          method,
          ...classification,
          startedAt,
          durationMs: Date.now() - startedAt,
          status: res.status,
        });
        return res;
      } catch (error) {
        requestLog.push({
          urlStr,
          method,
          ...classification,
          startedAt,
          durationMs: Date.now() - startedAt,
          error: error.message,
        });
        throw error;
      }
    };

    const { runMaterializedScan } = await import("@/lib/materializedScanner.js");

    const phaseTimestamps = { start: Date.now() };
    const options = symbols.length
      ? { symbols, concurrency, cache, markets: ["US"] }
      : {
        markets,
        limit,
        perMarket,
        concurrency,
        cache,
        skipRecentlyScanned,
        prioritizeMaterialization: true,
        cronUniverseSnapshot,
        universeMaxAgeHours,
        refreshUniverse: false, // nunca forzar reconstruccion completa del universo
        refreshPrices: false,
        refreshProfiles: false,
        maxSavedRows: 500,
        maxPriceFreshnessDays: 5,
        maxFundamentalsAgeDays: 14,
        minBars: 180,
        minPrice: 1,
        minAvgTurnover: 250000,
        minMarketCap: 300000000,
        minCoverageScore: 40,
      };

    const cpuBefore = process.cpuUsage();
    const result = await runMaterializedScan({
      ...options,
      onPhase: (nextPhase) => {
        phaseTimestamps[nextPhase] = Date.now();
      },
    });
    const finishedAt = Date.now();
    const cpuDelta = process.cpuUsage(cpuBefore);

    global.fetch = originalFetch;

    // --- Agregacion del log de red por "kind" -------------------------------
    const byKind = {};
    for (const entry of requestLog) {
      const key = entry.kind;
      byKind[key] ??= { count: 0, totalMs: 0, urls: [], minStart: Infinity, maxEnd: -Infinity };
      byKind[key].count += 1;
      byKind[key].totalMs += entry.durationMs || 0;
      byKind[key].minStart = Math.min(byKind[key].minStart, entry.startedAt);
      byKind[key].maxEnd = Math.max(byKind[key].maxEnd, entry.startedAt + (entry.durationMs || 0));
      if (byKind[key].urls.length < 3) byKind[key].urls.push(entry.urlStr);
    }
    // wallSpanMs: para peticiones lanzadas en paralelo (ej. hydrateBenchmarks
    // hace Promise.all de SPY/QQQ/ACWI), totalMs suma las 3 duraciones pero el
    // coste real en el reloj de pared es solo el span entre la primera que
    // arranca y la ultima que termina — mas fiel para "cuanto le costo a la
    // fase", distinto de "cuanto CPU/red se gasto en total".
    for (const key of Object.keys(byKind)) {
      byKind[key].wallSpanMs = byKind[key].maxEnd - byKind[key].minStart;
      delete byKind[key].minStart;
      delete byKind[key].maxEnd;
    }

    const totalMs = finishedAt - phaseTimestamps.start;
    const universeSelectMs = phaseTimestamps.materialized_scan
      ? phaseTimestamps.materialized_scan - phaseTimestamps.start
      : null;
    const restMs = phaseTimestamps.materialized_scan
      ? finishedAt - phaseTimestamps.materialized_scan
      : totalMs;

    fs.writeFileSync(
      process.env.BENCH_RESULT_FILE,
      JSON.stringify({
        totalMs,
        universeSelectMs,
        restMs,
        blockedWrites,
        cpuUserMs: cpuDelta.user / 1000,
        cpuSystemMs: cpuDelta.system / 1000,
        stats: result.stats,
        requestCount: requestLog.length,
        byKind,
      }),
    );
  }, 300000);
}

// Carga minima de .env.local: ni vitest.config.js ni este script tienen
// dotenv por defecto (confirmado: vitest.config.js no lo carga). Sin esto,
// supabaseConfig() ve SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY vacios y
// getUniverseEngineSnapshot() cae a buildUniverse() (reconstruccion completa
// contra NasdaqTrader/HKEX/TWSE/ASIC) en vez de leer el cache real de
// Supabase — falseando por completo la medicion del modo --markets. Solo
// lee el archivo, nunca lo escribe ni lo modifica.
function loadDotEnvLocal() {
  const envPath = path.join(REPO_ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function runAsBootstrap() {
  loadDotEnvLocal();
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.symbols.length && !opts.markets.length) {
    console.error("Uso: --symbols=AAPL,MSFT,... [--concurrency=N]   O   --markets=US,HK,AU --limit=12 [--perMarket=N]");
    process.exit(1);
  }

  const mode = opts.symbols.length ? "symbols-explicit" : "markets-real";
  console.log(`Bench-scan-overhead: modo=${mode}`);
  if (mode === "symbols-explicit") {
    console.log(`  ${opts.symbols.length} simbolos explicitos, concurrencia=${opts.concurrency}, cache=${opts.cache}`);
    console.log(`  Simbolos: ${opts.symbols.join(", ")}`);
    console.log("  NOTA: en este modo, resolveSymbols() se salta getUniverseEngineSnapshot");
    console.log("  y readRecentlyScannedSymbols por completo (symbols explicitos). Este bench");
    console.log("  NO mide universe_select ni recent_scan_read en este modo.");
  } else {
    console.log(`  mercados=${opts.markets.join(",")}, limit=${opts.limit}, perMarket=${opts.perMarket}, concurrencia=${opts.concurrency}, cache=${opts.cache}`);
    console.log("  Este modo SI ejecuta resolveSymbols() real (lecturas GET a Supabase:");
    console.log("  universe_snapshot_symbols + scan_results). No se escribe nada: cualquier");
    console.log("  POST/PATCH/DELETE hacia Supabase queda bloqueado por el bench.");
  }

  const resultFile = path.join(os.tmpdir(), `bench-scan-overhead-result-${process.pid}.json`);
  process.env.BENCH_SYMBOLS = opts.symbols.join(",");
  process.env.BENCH_MARKETS = opts.markets.join(",");
  process.env.BENCH_LIMIT = String(opts.limit);
  process.env.BENCH_PERMARKET = String(opts.perMarket);
  process.env.BENCH_CONCURRENCY = String(opts.concurrency);
  process.env.BENCH_CACHE = String(opts.cache);
  process.env.BENCH_SKIP_RECENT = String(opts.skipRecentlyScanned);
  process.env.BENCH_CRON_SNAPSHOT = String(opts.cronUniverseSnapshot);
  process.env.BENCH_MAX_AGE_HOURS = String(opts.universeMaxAgeHours);
  process.env.BENCH_RESULT_FILE = resultFile;
  process.env.BENCH_ANALYZE_MODE = "vitest-child";

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

  console.log("");
  console.log("=== RESULTADO ===");
  console.log(`Modo: ${mode}`);
  console.log(`Tiempo total (dentro de runMaterializedScan): ${(child.totalMs / 1000).toFixed(3)}s`);
  console.log(`Tiempo total (wall-clock del proceso, incluye arranque de Vitest/transform): ${(wallMs / 1000).toFixed(3)}s`);
  if (child.universeSelectMs !== null) {
    console.log(`  Fase universe_select (onPhase, hasta hydrateBenchmarks): ${(child.universeSelectMs / 1000).toFixed(3)}s`);
    console.log(`  Fase materialized_scan (hydrateBenchmarks + analyzeOne + sectorize + filtros): ${(child.restMs / 1000).toFixed(3)}s`);
  } else {
    console.log("  onPhase no reporto transicion 'materialized_scan' (no debería pasar; revisar).");
  }
  console.log(`Escrituras a Supabase bloqueadas por el bench: ${child.blockedWrites}`);
  console.log(`Peticiones de red totales capturadas: ${child.requestCount}`);
  console.log(`CPU proceso Node (dentro del test) — user: ${child.cpuUserMs.toFixed(1)}ms, system: ${child.cpuSystemMs.toFixed(1)}ms`);

  console.log("");
  console.log("=== DESGLOSE POR TIPO DE PETICION DE RED (medido) ===");
  const sortedKinds = Object.entries(child.byKind).sort((a, b) => b[1].totalMs - a[1].totalMs);
  for (const [kind, agg] of sortedKinds) {
    console.log(`  ${kind}: ${agg.count} peticiones, ${agg.totalMs}ms suma-duraciones, ${(agg.totalMs / agg.count).toFixed(1)}ms/peticion promedio, ${agg.wallSpanMs}ms span-reloj-pared (primera arranca -> ultima termina)`);
  }

  console.log("");
  console.log("=== STATS runMaterializedScan ===");
  console.log(`  universeTotal: ${child.stats.universeTotal}, selected: ${child.stats.selected}, passedBase: ${child.stats.passedBase}, savedRows: ${child.stats.savedRows}, rejected: ${child.stats.rejected}`);
  console.log(`  cache (universo): ${JSON.stringify(child.stats.cache)}`);

  console.log("");
  console.log(
    JSON.stringify(
      {
        mode,
        symbolsRequested: opts.symbols.length || null,
        markets: opts.markets.length ? opts.markets : null,
        limit: opts.markets.length ? opts.limit : null,
        concurrency: opts.concurrency,
        totalMs: child.totalMs,
        wallMs,
        universeSelectMs: child.universeSelectMs,
        materializedScanPhaseMs: child.restMs,
        blockedWrites: child.blockedWrites,
        requestCount: child.requestCount,
        byKind: child.byKind,
        stats: {
          universeTotal: child.stats.universeTotal,
          selected: child.stats.selected,
          passedBase: child.stats.passedBase,
          savedRows: child.stats.savedRows,
          rejected: child.stats.rejected,
          cache: child.stats.cache,
        },
        cpuUserMs: child.cpuUserMs,
        cpuSystemMs: child.cpuSystemMs,
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
