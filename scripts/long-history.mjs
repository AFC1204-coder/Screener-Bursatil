// scripts/long-history.mjs — lote SEMANAL de la capa de histórico largo.
//
// Para cada símbolo pide a Yahoo el histórico ENTERO con cadencia semanal real
// (fetchYahooFullHistoryChart: period1=0&interval=1wk, que falla si Yahoo
// degrada la granularidad), calcula lib/longHistory.js y lo guarda en la tabla
// long_history_stats (migración 20261108120000, pendiente de aplicar).
//
// NO toca daily_bars ni la caché de barras diarias: las semanales de décadas
// nunca se mezclan con las diarias. Las guardas de cadencia de dailyBarsCache
// siguen intactas porque este lote no pasa por ella.
//
// Fuentes de símbolos (una de ellas):
//   --list=logs/hk-liquid-universe.json   (misma forma que refresh-bars-hk)
//   --symbols=AAPL,RDDT,0700.HK           (lista explícita)
//   --universe-us                         (lee universe_snapshot_symbols; solo con --write/--fetch-only)
//
// Modos:
//   (por defecto) --dry-run  Solo plan y estimación de coste. SIN red, SIN base.
//   --fetch-only --out=f.json  Pide a Yahoo y calcula; escribe un JSON local. SIN base.
//   --write                  Pide, calcula y hace upsert en long_history_stats.
//
// Tope: --max-filas (def. 10.000 filas upsert por ejecución). Si se alcanza →
// código 2 y NO relanzar el mismo bloque. Cadencia: con --write se salta el
// símbolo cuya estadística utilizable tenga menos de --min-age-days (def. 6)
// salvo --force.
//
// Salida: 0 bien · 1 error · 2 parada por tope · 3 demasiados fallos (>10 %)
//         · 4 Yahoo limita (5 HTTP 429 seguidos): parar y esperar, no insistir.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/long-history.mjs [--dry-run|--fetch-only|--write] [--limit=N] \
//     [--concurrency=3] [--delay-ms=250] [--min-age-days=6] [--force]

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONCURRENCY = 3;
const MAX_CONCURRENCY = 6;
const DEFAULT_DELAY_MS = 250;
const DEFAULT_MAX_ROWS = 10000;
const DEFAULT_MIN_AGE_DAYS = 6;
const FAILURE_RATIO_LIMIT = 0.1;
const RATE_LIMIT_STREAK = 5;
// Medido el 2026-11-08: ~0,25-0,30 s por petición (AAPL 1wk: 89 KB, RDDT: 4 KB).
const EST_SECONDS_PER_REQUEST = 0.3;

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    fetchOnly: false,
    out: "",
    limit: 0,
    list: "",
    symbols: [],
    universeUs: false,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    maxRows: DEFAULT_MAX_ROWS,
    minAgeDays: DEFAULT_MIN_AGE_DAYS,
    force: false,
  };
  for (const arg of argv) {
    const [rawKey, ...rest] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    const value = rest.length ? rest.join("=") : undefined;
    if (key === "dry-run") out.dryRun = value === undefined ? true : value !== "false";
    else if (key === "write") out.write = value === undefined ? true : value !== "false";
    else if (key === "fetch-only") out.fetchOnly = value === undefined ? true : value !== "false";
    else if (key === "out") out.out = String(value || "");
    else if (key === "limit") out.limit = Math.max(0, Number(value) || 0);
    else if (key === "list") out.list = String(value || "");
    else if (key === "symbols") out.symbols = String(value || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (key === "universe-us") out.universeUs = true;
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(value) || DEFAULT_CONCURRENCY));
    else if (key === "delay-ms") out.delayMs = Math.max(0, Number(value) || 0);
    else if (key === "max-filas") out.maxRows = Math.max(0, Number(value) || 0) || DEFAULT_MAX_ROWS;
    else if (key === "min-age-days") out.minAgeDays = Math.max(0, Number(value) || 0);
    else if (key === "force") out.force = true;
  }
  // --write / --fetch-only ganan sobre el default dry-run, salvo --dry-run explícito.
  if ((out.write || out.fetchOnly) && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  if (out.write && out.fetchOnly) throw new Error("--write y --fetch-only son excluyentes");
  return out;
}

export function readSymbolList(file) {
  const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const raw = Array.isArray(payload) ? payload : payload?.symbols;
  if (!Array.isArray(raw)) throw new Error(`${file}: formato no válido (se espera { symbols: [...] })`);
  const symbols = raw.map((row) => String(typeof row === "string" ? row : row?.symbol || "").trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) throw new Error(`${file}: lista vacía`);
  return symbols;
}

/** ¿Hay que saltar el símbolo por cadencia? (estadística utilizable más joven que minAgeDays) */
export function isFreshEnough(stat, { minAgeDays, now = Date.now(), force = false } = {}) {
  if (force || !stat?.asOf || minAgeDays <= 0) return false;
  const computed = Date.parse(String(stat.asOf).slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(computed)) return false;
  return (now - computed) / 86400000 < minAgeDays;
}

/** Bucle con concurrencia, tope de filas y parada por límite del proveedor. */
export async function runLoop(items, { concurrency, maxRows, worker, delayMs = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const results = [];
  let rows = 0;
  let cursor = 0;
  let stoppedByCap = false;
  let rateLimited = false;
  let streak = 0;
  async function run() {
    for (;;) {
      if (rows >= maxRows) { stoppedByCap = true; return; }
      if (rateLimited) return;
      const index = cursor++;
      if (index >= items.length) return;
      const result = await worker(items[index], index);
      results.push(result);
      rows += result?.rowsToWrite || 0;
      streak = result?.rateLimited ? streak + 1 : 0;
      if (streak >= RATE_LIMIT_STREAK) { rateLimited = true; return; }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return { results, rows, processed: results.length, remaining: Math.max(0, items.length - results.length), stoppedByCap, rateLimited };
}

async function loadSymbols(args) {
  if (args.symbols.length) return args.symbols;
  if (args.list) return readSymbolList(args.list);
  if (args.universeUs) {
    if (args.dryRun) return [];
    const { supabaseConfig, supabaseRequestAll } = await import("@/lib/supabaseServer.js");
    const config = supabaseConfig();
    const snap = await supabaseRequestAll("universe_snapshot_symbols", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&market=eq.US&select=snapshot_id,created_at&order=created_at.desc`,
      maxRows: 1,
    });
    const snapshotId = snap?.[0]?.snapshot_id;
    if (!snapshotId) throw new Error("Sin instantánea US en universe_snapshot_symbols");
    const rows = await supabaseRequestAll("universe_snapshot_symbols", {
      query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&snapshot_id=eq.${encodeURIComponent(snapshotId)}&market=eq.US&passed=eq.true&select=symbol&order=symbol.asc`,
      maxRows: 20000,
    });
    return rows.map((r) => String(r.symbol || "").trim().toUpperCase()).filter(Boolean);
  }
  throw new Error("Indica una fuente: --list=archivo.json, --symbols=A,B o --universe-us");
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const mode = args.write ? "WRITE" : args.fetchOnly ? "fetch-only" : "dry-run";
  console.log(`=== long-history.mjs — modo=${mode} concurrency=${args.concurrency} delay=${args.delayMs}ms ===`);

  let symbols = await loadSymbols(args);
  if (args.limit > 0) symbols = symbols.slice(0, args.limit);
  console.log(`Símbolos a procesar: ${symbols.length}${args.limit > 0 ? " (por --limit)" : ""}`);

  if (args.dryRun) {
    const secs = (symbols.length * EST_SECONDS_PER_REQUEST) / args.concurrency + (symbols.length * args.delayMs) / 1000 / args.concurrency;
    console.log(`Estimación: ${symbols.length} peticiones a Yahoo (1 por símbolo), ~${(secs / 60).toFixed(1)} min con concurrencia ${args.concurrency}.`);
    console.log(`Filas a escribir: hasta ${symbols.length} (tope ${args.maxRows}).`);
    console.log(`Primeros 10: ${symbols.slice(0, 10).join(", ")}`);
    console.log("Dry-run: no se descargó ni se escribió nada. Usa --fetch-only --out=… o --write.");
    return 0;
  }

  const { fetchYahooFullHistoryChart } = await import("@/lib/yahoo.js");
  const { computeLongHistoryStats } = await import("@/lib/longHistory.js");
  let store = null;
  let latest = new Map();
  if (args.write) {
    store = await import("@/lib/longHistoryStore.js");
    if (!args.force) latest = await store.readLatestLongHistoryMap();
  }

  const collected = [];
  const worker = async (symbol) => {
    if (args.write && isFreshEnough(latest.get(symbol), args)) return { symbol, ok: true, skipped: true, rowsToWrite: 0 };
    try {
      const chart = await fetchYahooFullHistoryChart(symbol, { barInterval: "1wk" });
      const stat = computeLongHistoryStats(chart.bars, { splitEvents: chart.meta?.splitEvents, firstTradeDate: chart.meta?.firstTradeDate });
      collected.push({ symbol, stat });
      return { symbol, ok: true, skipped: false, status: stat.status, rowsToWrite: 1 };
    } catch (error) {
      const message = error?.message || String(error);
      return { symbol, ok: false, reason: message, rateLimited: /HTTP 429/.test(message), rowsToWrite: 0 };
    }
  };
  const loop = await runLoop(symbols, { concurrency: args.concurrency, maxRows: args.maxRows, worker, delayMs: args.delayMs });

  let written = 0;
  if (args.write && collected.length) written = await store.writeLongHistoryStats(collected);
  if (args.fetchOnly && args.out) {
    fs.writeFileSync(path.resolve(args.out), JSON.stringify(collected, null, 1));
    console.log(`Escrito JSON local: ${args.out} (${collected.length} símbolos)`);
  }

  const byStatus = {};
  for (const r of loop.results) if (r.ok && !r.skipped) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  const failed = loop.results.filter((r) => !r.ok);
  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Procesados: ${loop.processed}/${symbols.length} · saltados por cadencia: ${loop.results.filter((r) => r.skipped).length}`);
  console.log(`Estados: ${JSON.stringify(byStatus)}`);
  console.log(`Fallidos: ${failed.length}`);
  if (args.write) console.log(`Filas upsert en long_history_stats: ${written} (tope ${args.maxRows})`);
  for (const row of failed.slice(0, 30)) console.log(`  - ${row.symbol}: ${row.reason}`);
  if (failed.length > 30) console.log(`  ... y ${failed.length - 30} más (omitidos del detalle, no del conteo).`);
  console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (loop.rateLimited) {
    console.log(`PARADA: ${RATE_LIMIT_STREAK} respuestas HTTP 429 seguidas. Espera (≥ 1 h) y baja --concurrency; no insistas.`);
    return 4;
  }
  if (loop.stoppedByCap) {
    console.log(`PARADA POR TOPE: ${loop.rows} filas (tope ${args.maxRows}); quedan ${loop.remaining} símbolos. No relances el mismo bloque sin subir --max-filas a sabiendas.`);
    return 2;
  }
  if (loop.processed > 0 && failed.length / loop.processed > FAILURE_RATIO_LIMIT) {
    console.log(`Demasiados fallos: ${failed.length}/${loop.processed} (> ${FAILURE_RATIO_LIMIT * 100} %).`);
    return 3;
  }
  return 0;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((error) => {
      console.error("Error fatal:", error?.message || error);
      process.exitCode = 1;
    });
}
