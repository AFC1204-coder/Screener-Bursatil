// scripts/refresh-fundamentals.mjs — refresco de perfiles fundamentales
// (resumen, ratios, resultados anuales/trimestrales, BPA) en
// fundamental_snapshots, por la MISMA vía que usa company-brief
// (withProfileCache + fetchYahooProfile), así que no hay esquema nuevo.
//
// Diagnóstico y motivo: research/datos-fundamentales-2026-11/fase1-diagnostico.md
// (BPA trimestral nunca pedido; quote v7 sin crumb → 401; perfiles de hasta
// meses de antigüedad; 429 de Yahoo en 1.705 símbolos).
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/refresh-fundamentals.mjs [--dry-run] [--write] \
//     (--symbols=AAPL,0425.HK | --list=archivo.json) \
//     [--limit=N] [--concurrency=2] [--pause-ms=400] [--max-perfiles=500]
//
// --list admite ["AAPL",...] o {symbols:[{symbol:"AAPL"},...]}.
// Por defecto corre en --dry-run. TOPE: --max-perfiles (por defecto 500) frena
// con código 2. Cadencia sugerida: ~5 noches por barrido completo para no
// disparar el 429 de Yahoo; reintentar solo los fallidos.
// Salida: 0 bien · 1 error · 2 parada por tope · 3 demasiados fallos (>10 %).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 4;
const DEFAULT_MAX_PROFILES = 500;
const DEFAULT_PAUSE_MS = 400;
const FAILURE_RATIO_LIMIT = 0.1;

export function parseArgs(argv) {
  const out = { dryRun: true, write: false, symbols: [], list: "", limit: 0, concurrency: DEFAULT_CONCURRENCY, pauseMs: DEFAULT_PAUSE_MS, maxProfiles: DEFAULT_MAX_PROFILES };
  for (const arg of argv) {
    const [rawKey, ...rest] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    const value = rest.join("=");
    if (key === "dry-run") out.dryRun = rest.length === 0 ? true : value !== "false";
    else if (key === "write") out.write = rest.length === 0 ? true : value !== "false";
    else if (key === "symbols") out.symbols = value.split(",").map((s) => s.trim()).filter(Boolean);
    else if (key === "list") out.list = value;
    else if (key === "limit") out.limit = Math.max(0, Number(value) || 0);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(value) || DEFAULT_CONCURRENCY));
    else if (key === "pause-ms") out.pauseMs = Math.max(0, Number(value) || 0);
    else if (key === "max-perfiles") out.maxProfiles = Math.max(1, Number(value) || DEFAULT_MAX_PROFILES);
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

export function readSymbols(args) {
  let symbols = [...args.symbols];
  if (args.list) {
    const payload = JSON.parse(fs.readFileSync(path.resolve(args.list), "utf8"));
    const rows = Array.isArray(payload) ? payload : payload?.symbols;
    if (!Array.isArray(rows)) throw new Error(`${args.list}: formato no válido`);
    symbols = symbols.concat(rows.map((r) => (typeof r === "string" ? r : r?.symbol)).filter(Boolean));
  }
  symbols = [...new Set(symbols)];
  if (!symbols.length) throw new Error("Indica --symbols=… o --list=…");
  return args.limit > 0 ? symbols.slice(0, args.limit) : symbols;
}

export async function runLoop(items, { concurrency, maxProfiles, pauseMs = 0, refreshOne, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const results = [];
  let written = 0;
  let cursor = 0;
  let stoppedByCap = false;
  async function worker() {
    for (;;) {
      if (cursor >= items.length) return;
      if (written >= maxProfiles) { stoppedByCap = true; return; }
      const index = cursor++;
      const result = await refreshOne(items[index]);
      results.push(result);
      if (result.ok) written += 1;
      if (pauseMs) await sleep(pauseMs);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { results, written, remaining: Math.max(0, items.length - results.length), stoppedByCap };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const symbols = readSymbols(args);
  const write = args.write && !args.dryRun;
  console.log(`=== refresh-fundamentals.mjs — modo=${write ? "WRITE" : "dry-run"} símbolos=${symbols.length} concurrency=${args.concurrency} tope=${args.maxProfiles} ===`);
  if (!write) {
    console.log(`Primeros 10: ${symbols.slice(0, 10).join(", ")}`);
    console.log("Dry-run: no se descargó ni se escribió nada. Pasa --write para persistir.");
    return 0;
  }
  const { withProfileCache } = await import("@/lib/fundamentalsCache.js");
  const { fetchYahooProfile } = await import("@/lib/marketData.js");
  const refreshOne = async (symbol) => {
    try {
      const profile = await withProfileCache(symbol, { refresh: true, useCache: true }, (s) => fetchYahooProfile(s, { refresh: true }));
      const w = profile?.fundamentalsCache?.write;
      if (w && w.written === false) return { symbol, ok: false, reason: `no escrito (${w.status || "?"})` };
      const err = profile?.profileProviderError;
      return { symbol, ok: true, partialError: err || "", quarters: profile?.fundamentalsFinancialResults?.incomeQuarterly?.length ?? profile?.growthMetrics?.financialResults?.incomeQuarterly?.length ?? null };
    } catch (error) {
      return { symbol, ok: false, reason: error?.message || String(error) };
    }
  };
  const { results, written, remaining, stoppedByCap } = await runLoop(symbols, { concurrency: args.concurrency, maxProfiles: args.maxProfiles, pauseMs: args.pauseMs, refreshOne });
  const failed = results.filter((r) => !r.ok);
  console.log(`Procesados: ${results.length}/${symbols.length} · escritos: ${written} · fallidos: ${failed.length}`);
  for (const row of failed.slice(0, 30)) console.log(`  - ${row.symbol}: ${row.reason}`);
  if (stoppedByCap) { console.log(`PARADA POR TOPE: quedaron ${remaining} sin procesar.`); return 2; }
  if (results.length && failed.length / results.length > FAILURE_RATIO_LIMIT) { console.log("Demasiados fallos."); return 3; }
  return 0;
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().then((code) => { process.exitCode = code; }).catch((e) => { console.error("Error fatal:", e?.message || e); process.exitCode = 1; });
}
