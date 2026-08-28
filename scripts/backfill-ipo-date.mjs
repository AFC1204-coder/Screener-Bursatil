// scripts/backfill-ipo-date.mjs — puebla y mide `ipoDate` fuera del nocturno.
//
// Dos usos, el primero por defecto:
//
//   1. MEDIR (dry-run). Resuelve la fecha de salida a bolsa contra los
//      proveedores reales para una muestra del universo y reporta cobertura,
//      procedencia y reparto de edades. Es la forma de contestar "¿cuántas
//      filas tendrían edad IPO <= 60 meses?" sin esperar a una corrida
//      nocturna y sin escribir nada en ninguna parte.
//
//   2. ESCRIBIR (--write). Guarda la fecha en `fundamental_snapshots`
//      (metrics.ipoDate + metrics.ipoDateSource) con un PATCH sobre la fila
//      que ya existe — no crea una fila nueva por símbolo y día. Esa tabla es
//      la que lee el escaneo (withProfileCache), así que poblarla ahí es lo
//      que hace que el nocturno siguiente ya traiga la fecha sin pedir nada.
//      Exige credenciales de Supabase y OK del dueño (política de AGENTS.md:
//      datos = no se escribe sin aprobación explícita).
//
// Uso:
//   node --loader ./scripts/loader.mjs scripts/backfill-ipo-date.mjs \
//     [--source=us|market|symbols] [--market=DE] [--symbols=RDDT,ARM] \
//     [--limit=300] [--concurrency=6] [--no-fmp] [--write]
//
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/backfill-ipo-date.mjs --source=us --limit=300 --write
//
// La muestra de `--source=us` se toma con paso constante sobre el universo
// completo (símbolo 1, 1+k, 1+2k…), no con los N primeros: el directorio de
// NasdaqTrader viene ordenado alfabéticamente y coger la cabeza sesgaría la
// medición hacia los tickers que empiezan por A.

import { pathToFileURL } from "node:url";

import { patchProfileCacheIpoDate } from "@/lib/fundamentalsCache.js";
import { fetchIpoDateFromProviders } from "@/lib/ipoDateSources.js";
import { supabaseConfig } from "@/lib/supabaseServer.js";
import { fetchUSUniverse, marketSymbols } from "@/lib/universes.js";

const DEFAULT_LIMIT = 300;
const DEFAULT_CONCURRENCY = 6;
const MAX_CONCURRENCY = 8;
const RECENT_IPO_MAX_MONTHS = 60; // el umbral del preset `ipo` (lib/screenerFilters.js)

export function parseArgs(argv) {
  const out = {
    source: "us",
    market: "",
    symbols: [],
    limit: DEFAULT_LIMIT,
    concurrency: DEFAULT_CONCURRENCY,
    fmpFallback: true,
    dryRun: true,
    write: false,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "source") out.source = String(rawValue || "us").trim().toLowerCase();
    else if (key === "market") out.market = String(rawValue || "").trim().toUpperCase();
    else if (key === "symbols") out.symbols = String(rawValue || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
    else if (key === "limit") out.limit = Math.max(1, Number(rawValue) || DEFAULT_LIMIT);
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "no-fmp") out.fmpFallback = false;
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
  }
  if (out.symbols.length && out.source === "us") out.source = "symbols";
  if (out.market && out.source === "us") out.source = "market";
  // Mismo criterio que purge-scans.mjs / refresh-bars.mjs: --write gana sobre
  // el dry-run por defecto, pero un --dry-run explícito manda sobre --write.
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

// Muestra de paso constante: reparte `limit` posiciones a lo largo de la lista
// entera en vez de cortar por la cabeza. Con limit >= lista devuelve la lista.
export function strideSample(items = [], limit = DEFAULT_LIMIT) {
  if (!Array.isArray(items) || items.length <= limit) return [...(items || [])];
  const step = items.length / limit;
  const out = [];
  for (let i = 0; i < limit; i += 1) out.push(items[Math.floor(i * step)]);
  return out;
}

async function resolveSymbols(args) {
  if (args.source === "symbols") return { symbols: args.symbols, universeTotal: args.symbols.length, origin: "lista explícita" };
  if (args.source === "market") {
    const all = marketSymbols(args.market);
    if (!all.length) throw new Error(`Sin símbolos curados para el mercado '${args.market}' (lib/universes.js)`);
    return { symbols: strideSample(all, args.limit), universeTotal: all.length, origin: `universo curado ${args.market} (lib/universes.js)` };
  }
  // fetchUSUniverse devuelve [{symbol, name, country, micCode, source}, ...]
  // deduplicado por símbolo (lib/universes.js).
  const all = (await fetchUSUniverse()).map((row) => row?.symbol).filter(Boolean);
  if (!all.length) throw new Error("fetchUSUniverse() no devolvió símbolos");
  return { symbols: strideSample(all, args.limit), universeTotal: all.length, origin: "universo US real (NasdaqTrader)" };
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, run));
  return out;
}

export function summarize(results = []) {
  const withDate = results.filter((r) => r.ipoDate);
  const ages = withDate.map((r) => r.ipoAgeMonths).filter((m) => Number.isFinite(m) && m >= 0);
  const bucket = (max) => ages.filter((m) => m <= max).length;
  const bySource = {};
  for (const r of withDate) bySource[r.ipoDateSource || "?"] = (bySource[r.ipoDateSource || "?"] || 0) + 1;
  return {
    examined: results.length,
    resolved: withDate.length,
    unresolved: results.length - withDate.length,
    bySource,
    age12: bucket(12),
    age24: bucket(24),
    age60: bucket(RECENT_IPO_MAX_MONTHS),
    age84: bucket(84),
    older: ages.filter((m) => m > RECENT_IPO_MAX_MONTHS).length,
    oldest: ages.length ? Math.max(...ages) : null,
    newest: ages.length ? Math.min(...ages) : null,
  };
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();

  if (!args.dryRun && !config.configured) {
    console.error("--write exige Supabase configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  console.log(`=== backfill-ipo-date.mjs — modo=${args.dryRun ? "dry-run (no escribe nada)" : "WRITE"} source=${args.source} limit=${args.limit} concurrency=${args.concurrency} fmp=${args.fmpFallback ? "sí" : "no"} ===`);

  const { symbols, universeTotal, origin } = await resolveSymbols(args);
  console.log(`Origen: ${origin} — ${universeTotal} símbolos en el universo, ${symbols.length} en la muestra.`);
  console.log("");

  let done = 0;
  const results = await mapLimit(symbols, args.concurrency, async (symbol) => {
    const resolved = await fetchIpoDateFromProviders(symbol, { fmpFallback: args.fmpFallback });
    done += 1;
    if (done % 50 === 0) console.log(`  ...${done}/${symbols.length}`);
    let write = null;
    if (!args.dryRun && resolved.ipoDate) {
      // Misma función que usa el nocturno (lib/fundamentalsCache.js): un PATCH
      // que añade la fecha sin tocar `updated_at`, para no hacer pasar por
      // frescos unos fundamentales que no se han vuelto a pedir.
      write = await patchProfileCacheIpoDate(symbol, resolved).catch((error) => ({ status: `error: ${error.message || error}`, written: false }));
    }
    return { symbol, ...resolved, write };
  });

  const stats = summarize(results);
  console.log("");
  console.log("=== Cobertura del proveedor ===");
  console.log(`Examinados:  ${stats.examined}`);
  console.log(`Con fecha:   ${stats.resolved} (${((stats.resolved / stats.examined) * 100).toFixed(1)}%)`);
  console.log(`Sin fecha:   ${stats.unresolved} (motivo declarado: ipo-date-unavailable)`);
  console.log(`Procedencia: ${Object.entries(stats.bySource).map(([k, v]) => `${k}=${v}`).join(" · ") || "-"}`);
  console.log("");
  console.log("=== Edad IPO en la muestra ===");
  console.log(`<= 12 meses: ${stats.age12}`);
  console.log(`<= 24 meses: ${stats.age24}`);
  console.log(`<= 60 meses: ${stats.age60}   <-- umbral del preset 'ipo'`);
  console.log(`<= 84 meses: ${stats.age84}`);
  console.log(`>  60 meses: ${stats.older}`);
  console.log(`Más reciente: ${stats.newest ?? "-"} meses · más antigua: ${stats.oldest ?? "-"} meses`);
  if (stats.examined) {
    const rate = stats.age60 / stats.examined;
    console.log(`Tasa <=60m en la muestra: ${(rate * 100).toFixed(1)}% → sobre ${universeTotal} símbolos del universo: ≈${Math.round(rate * universeTotal)} filas (extrapolación, no censo).`);
  }

  // Qué símbolos concretos se quedan sin fecha, no solo cuántos: es lo que
  // decide si el hueco es del proveedor o de una lista de símbolos mal formada.
  const sinFecha = results.filter((r) => !r.ipoDate).map((r) => r.symbol);
  if (sinFecha.length) {
    console.log("");
    console.log(`Sin fecha (hasta 40 de ${sinFecha.length}): ${sinFecha.slice(0, 40).join(", ")}`);
  }

  const intl = results.filter((r) => r.ipoDate && /\.(HK|L|T|MC|DE|PA|AS|SW|ST|CO|OL|HE|MI|BR|LS|VI|IR|TO|AX)$/i.test(r.symbol));
  if (intl.length) {
    console.log("");
    console.log(`Smoke intl (símbolos no-US con fecha): ${intl.length}`);
    for (const r of intl.slice(0, 10)) console.log(`  - ${r.symbol.padEnd(14)} ${r.ipoDate}  ${r.ipoAgeMonths}m  [${r.ipoDateSource}]`);
  }

  const recientes = results.filter((r) => Number.isFinite(r.ipoAgeMonths) && r.ipoAgeMonths >= 0 && r.ipoAgeMonths <= RECENT_IPO_MAX_MONTHS)
    .sort((a, b) => a.ipoAgeMonths - b.ipoAgeMonths);
  if (recientes.length) {
    console.log("");
    console.log(`Detalle de las <=60m (hasta 25 de ${recientes.length}):`);
    for (const r of recientes.slice(0, 25)) console.log(`  - ${r.symbol.padEnd(14)} ${r.ipoDate}  ${String(r.ipoAgeMonths).padStart(3)}m  [${r.ipoDateSource}]`);
  }

  if (!args.dryRun) {
    const writes = results.map((r) => r.write).filter(Boolean);
    const byStatus = {};
    for (const w of writes) byStatus[w.status] = (byStatus[w.status] || 0) + 1;
    console.log("");
    console.log("=== Escritura en fundamental_snapshots ===");
    console.log(Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(" · ") || "nada que escribir");
  } else {
    console.log("");
    console.log("Dry-run: no se escribió nada. Pasa --write (con credenciales y OK del dueño) para poblar fundamental_snapshots.");
  }

  console.log("");
  console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

// Igual que purge-scans.mjs: main() solo corre por CLI. Importarlo (los tests
// importan parseArgs/strideSample/summarize) no toca red ni Supabase.
const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Error fatal:", error?.message || error);
    process.exitCode = 1;
  });
}
