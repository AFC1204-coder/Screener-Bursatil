// scripts/refresh-bars-hk.mjs — refresco de barras diarias de los valores
// LÍQUIDOS de Hong Kong (lista de scripts/ops/hk-liquid-universe.mjs).
//
// Plan: research/operacion-diaria-2026-11/plan-hong-kong-liquidos.md
//
// Por qué existe: scripts/refresh-bars.mjs está fijado a market='US' y el cron
// rotativo de scan-refresh solo toca ~84 símbolos HK cada 3-4 semanas, así que
// 1.782 símbolos HK llevaban congelados desde el 10-ago. Este script refresca
// SOLO la lista líquida (≈760) y reutiliza withDailyBarsCache, la misma vía que
// refresh-bars.mjs y rs-intl-bars.mjs (guards de cadencia incluidos).
//
// TOPE DE FILAS: igual que sus hermanos. La primera carga son ~380 filas por
// símbolo (≈290.000); las siguientes, el delta de una sesión. Por defecto
// 600.000. Si se alcanza, sale con código 2 y NO reintentar el mismo bloque.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/refresh-bars-hk.mjs [--dry-run] [--write] [--limit=N] \
//     [--list=logs/hk-liquid-universe.json] [--concurrency=4] \
//     [--stale-days=0] [--max-filas=600000]
//
// Por defecto corre en --dry-run. Salida: 0 bien · 1 error · 2 parada por tope
// · 3 demasiados fallos (>10 % de la lista).

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const DEFAULT_MAX_ROWS = 600000;
const FAILURE_RATIO_LIMIT = 0.1;

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    list: "logs/hk-liquid-universe.json",
    concurrency: DEFAULT_CONCURRENCY,
    staleDays: 0,
    maxRows: DEFAULT_MAX_ROWS,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "list") out.list = String(rawValue || out.list);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "stale-days") out.staleDays = Math.max(0, Number(rawValue) || 0);
    else if (key === "max-filas") out.maxRows = Math.max(0, Number(rawValue) || 0) || DEFAULT_MAX_ROWS;
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

/** Lee y valida la lista líquida; devuelve los símbolos en el orden del archivo. */
export function readLiquidList(file) {
  const payload = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  if (payload?.market !== "HK" || !Array.isArray(payload.symbols)) {
    throw new Error(`${file}: no es una lista líquida de HK válida`);
  }
  const symbols = payload.symbols.map((row) => String(row.symbol || "").trim()).filter(Boolean);
  if (!symbols.length) throw new Error(`${file}: lista vacía`);
  return { symbols, generatedAt: payload.generatedAt, minTurnoverHKD: payload.minTurnoverHKD };
}

export async function runWriteLoop(items, { concurrency, maxRows, backfill }) {
  const results = [];
  let rowsWritten = 0;
  let processed = 0;
  let stoppedByCap = false;
  let cursor = 0;
  async function run() {
    for (;;) {
      if (rowsWritten >= maxRows) {
        stoppedByCap = true;
        return;
      }
      const index = cursor++;
      if (index >= items.length) return;
      const result = await backfill(items[index], index);
      results.push(result);
      processed += 1;
      rowsWritten += result?.barsWritten || 0;
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return { results, rowsWritten, processed, remaining: Math.max(0, items.length - processed), stoppedByCap };
}

async function refreshOne(symbol, args, deps) {
  try {
    const result = await deps.withDailyBarsCache(symbol, { range: "2A", interval: "D", maxAgeDays: args.staleDays }, deps.fetchYahooChart);
    const cache = result?.meta?.cache || {};
    if (cache.hit === true) return { symbol, ok: true, skipped: true, barsWritten: 0 };
    if (cache.write) {
      if (cache.write.status === "error") return { symbol, ok: false, reason: cache.write.error || "writeDailyBarsCache status:error" };
      if (cache.write.status === "rejected-non-daily") return { symbol, ok: false, reason: `payload no diario rechazado: ${cache.write.reason || "cadencia no diaria"}` };
      if (cache.write.status === "rejected-estimated") return { symbol, ok: false, reason: "payload con barras estimadas rechazado" };
      return { symbol, ok: true, skipped: false, barsWritten: cache.write.count || 0 };
    }
    return { symbol, ok: false, reason: `sin escritura nueva (status=${cache.status || "desconocido"}; posible fallo de proveedor)` };
  } catch (error) {
    return { symbol, ok: false, reason: error?.message || String(error) };
  }
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const { symbols, generatedAt, minTurnoverHKD } = readLiquidList(args.list);
  const toProcess = args.limit > 0 ? symbols.slice(0, args.limit) : symbols;

  console.log(`=== refresh-bars-hk.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} concurrency=${args.concurrency} stale-days=${args.staleDays} ===`);
  console.log(`Lista: ${args.list} (generada ${generatedAt}, corte ${Number(minTurnoverHKD).toLocaleString("es-ES")} HKD/día)`);
  console.log(`Símbolos en la lista: ${symbols.length} · a procesar: ${toProcess.length}${args.limit > 0 ? " (por --limit)" : ""}`);

  if (args.dryRun) {
    console.log(`Primeros 10: ${toProcess.slice(0, 10).join(", ")}`);
    console.log("Dry-run: no se descargó ni se escribió nada. Pasa --write para persistir.");
    return 0;
  }

  const { withDailyBarsCache } = await import("@/lib/dailyBarsCache.js");
  const { fetchYahooChart } = await import("@/lib/yahoo.js");
  const deps = { withDailyBarsCache, fetchYahooChart };

  console.log(`Descargando vía withDailyBarsCache (tope ${args.maxRows} filas escritas)...`);
  const { results, rowsWritten, processed, remaining, stoppedByCap } = await runWriteLoop(toProcess, {
    concurrency: args.concurrency,
    maxRows: args.maxRows,
    backfill: (symbol) => refreshOne(symbol, args, deps),
  });
  const skipped = results.filter((r) => r.ok && r.skipped);
  const succeeded = results.filter((r) => r.ok && !r.skipped);
  const failed = results.filter((r) => !r.ok);

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Procesados: ${processed}/${toProcess.length}`);
  console.log(`Al día, saltados: ${skipped.length}`);
  console.log(`Refrescados con éxito: ${succeeded.length}`);
  console.log(`Fallidos: ${failed.length}`);
  console.log(`Filas escritas en daily_bars: ${rowsWritten} (tope ${args.maxRows})`);
  for (const row of failed.slice(0, 30)) console.log(`  - ${row.symbol}: ${row.reason}`);
  if (failed.length > 30) console.log(`  ... y ${failed.length - 30} más (omitidos del detalle, no del conteo).`);
  console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (stoppedByCap) {
    console.log("");
    console.log(`PARADA POR TOPE: ${rowsWritten} filas escritas (tope ${args.maxRows}). Quedaron ${remaining} símbolos sin procesar.`);
    console.log("No relances sin más: el orden es el de la lista y repetiría el mismo bloque. Sube --max-filas a sabiendas.");
    return 2;
  }
  if (processed > 0 && failed.length / processed > FAILURE_RATIO_LIMIT) {
    console.log(`Demasiados fallos: ${failed.length}/${processed} (> ${FAILURE_RATIO_LIMIT * 100} %).`);
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
