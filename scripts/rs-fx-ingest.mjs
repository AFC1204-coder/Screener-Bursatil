// scripts/rs-fx-ingest.mjs — ingesta de las series FX que necesita el motor de
// RS global privado (MET-1b, Fase 0 punto 2).
//
// QUÉ HACE: descarga los pares {CCY}USD=X de Yahoo y los persiste en daily_bars
// con el MISMO camino que cualquier otro símbolo (withDailyBarsCache). No hay
// tabla dedicada: el spec deja la elección como decisión de implementación
// («Fuera / bloqueos», punto 1) y daily_bars ya trae, gratis, el cap de
// profundidad, el guard de cadencia diaria, el guard anti-estimados, el delta de
// escritura y la purga oportunista. Una tabla nueva habría que dotarla de los
// cinco.
//
// POR QUÉ NO HAY CRUCES: las diez divisas del universo v1 (HKD, CAD, GBP, EUR,
// CHF, SEK, DKK, NOK, AUD, JPY) cotizan todas contra USD. El addendum §7.4
// (cruces por piernas) no se ejercita; si un día hace falta una pierna
// intermedia eso es engine_version nuevo, no un parámetro de este script.
//
// PROFUNDIDAD: range=2A. El motor necesita 261 barras (52 semanas × 5 + 1) y el
// cap de escritura de daily_bars retiene 400 para símbolos no referenciados, así
// que pedir más se descartaría al escribir.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/rs-fx-ingest.mjs [--dry-run] [--write] [--concurrency=4]
//
// Por defecto --dry-run: reporta qué pares traería y qué profundidad tienen hoy
// en daily_bars, sin descargar ni escribir. --write exige pasarlo explícito,
// igual que rs-universe.mjs y refresh-bars.mjs.

import { pathToFileURL } from "node:url";

import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer.js";
import { fetchYahooChart } from "@/lib/yahoo.js";
import { withDailyBarsCache } from "@/lib/dailyBarsCache.js";
import { fxDirectPairs, fxPairsFor, FX_CURRENCIES } from "@/lib/rsFx.js";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
// Mismo mínimo que exige el motor: 52 semanas × 5 sesiones + 1.
const MIN_BARS_REQUIRED = 261;

export function parseArgs(argv) {
  const out = { dryRun: true, write: false, concurrency: DEFAULT_CONCURRENCY, staleDays: 1 };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "stale-days") out.staleDays = Math.max(0, Number(rawValue) ?? 1);
  }
  if (out.write && !argv.some((a) => a.startsWith("--dry-run"))) out.dryRun = false;
  return out;
}

async function mapLimit(items, limit, worker) {
  const out = new Array(items.length);
  let cursor = 0;
  async function run() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

// Profundidad actual en daily_bars: cuántas barras y cuál es la más reciente.
// Se usa tanto en dry-run (para previsualizar) como en el reporte final de
// --write (para verificar que el par quedó utilizable por el motor).
async function fxDepth(config, pair) {
  try {
    const rows = await supabaseRequest("daily_bars", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `symbol=eq.${encodeURIComponent(pair)}`,
        "select=trade_date",
        "order=trade_date.desc",
        `limit=${MIN_BARS_REQUIRED + 50}`,
      ].join("&"),
    });
    const dates = [...new Set((rows || []).map((row) => row.trade_date).filter(Boolean))];
    return { bars: dates.length, latest: dates[0] || null, oldest: dates.at(-1) || null };
  } catch (error) {
    return { bars: 0, latest: null, oldest: null, error: error?.message || String(error) };
  }
}

// Descarga con fallback al par inverso: si {CCY}USD=X no devuelve serie usable,
// se intenta USD{CCY}=X. El motor sabe normalizar el inverso (lib/rsFx.js
// convertToBase con inverse:true), pero preferimos el directo cuando existe —
// menos aritmética que auditar en la fila persistida.
async function ingestPair(config, currency, args) {
  const [direct, inverse] = fxPairsFor(currency);
  for (const pair of [direct, inverse]) {
    try {
      const result = await withDailyBarsCache(pair, { range: "2A", interval: "D", maxAgeDays: args.staleDays }, fetchYahooChart);
      const cache = result?.meta?.cache || {};
      if (cache.hit === true) {
        const depth = await fxDepth(config, pair);
        return { currency, pair, inverse: pair === inverse, ok: true, skipped: true, ...depth };
      }
      if (cache.write && cache.write.status !== "error") {
        const depth = await fxDepth(config, pair);
        return {
          currency,
          pair,
          inverse: pair === inverse,
          ok: true,
          skipped: false,
          barsWritten: cache.write.count || 0,
          ...depth,
        };
      }
      // Ni hit ni escritura: el proveedor no dio serie para este par. Se prueba
      // el inverso antes de dar la divisa por perdida.
    } catch {
      // Mismo criterio: un fallo del par directo no descarta la divisa.
    }
  }
  return { currency, pair: direct, ok: false, reason: `ni ${direct} ni ${inverse} devolvieron serie utilizable` };
}

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  console.log(`=== rs-fx-ingest.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} concurrency=${args.concurrency} ===`);
  console.log(`Divisas del universo v1 (${FX_CURRENCIES.length}): ${FX_CURRENCIES.join(", ")}`);
  console.log(`Pares directos: ${fxDirectPairs().join(", ")}`);
  console.log(`Mínimo de barras que exige el motor: ${MIN_BARS_REQUIRED}`);

  if (args.dryRun) {
    console.log("");
    console.log("Profundidad actual en daily_bars (lectura, sin descargar ni escribir):");
    const depths = await mapLimit(fxDirectPairs(), args.concurrency, async (pair) => ({ pair, ...(await fxDepth(config, pair)) }));
    for (const row of depths) {
      const verdict = row.bars >= MIN_BARS_REQUIRED ? "OK" : `INSUFICIENTE (faltan ${MIN_BARS_REQUIRED - row.bars})`;
      console.log(`  ${row.pair.padEnd(12)} barras=${String(row.bars).padStart(4)} última=${row.latest || "(ninguna)"} ${verdict}`);
    }
    console.log("");
    console.log("Dry-run: no se descargó ni se escribió nada. Pasa --write para ingerir.");
    console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return;
  }

  console.log("");
  console.log(`Ingiriendo ${FX_CURRENCIES.length} divisas vía withDailyBarsCache...`);
  const results = await mapLimit(FX_CURRENCIES, args.concurrency, (currency) => ingestPair(config, currency, args));

  const ok = results.filter((row) => row.ok);
  const failed = results.filter((row) => !row.ok);
  const insufficient = ok.filter((row) => (row.bars || 0) < MIN_BARS_REQUIRED);

  console.log("");
  console.log("=== REPORTE ===");
  for (const row of results) {
    if (!row.ok) {
      console.log(`  ${row.currency.padEnd(4)} FALLO — ${row.reason}`);
      continue;
    }
    const flag = (row.bars || 0) >= MIN_BARS_REQUIRED ? "OK" : "INSUFICIENTE";
    console.log(`  ${row.currency.padEnd(4)} ${row.pair.padEnd(12)}${row.inverse ? " (inverso)" : ""} barras=${String(row.bars).padStart(4)} última=${row.latest || "-"} escritas=${row.barsWritten ?? 0} ${flag}`);
  }
  console.log("");
  console.log(`Divisas ingeridas: ${ok.length}/${FX_CURRENCIES.length}`);
  console.log(`Divisas fallidas: ${failed.length}`);
  console.log(`Divisas con menos de ${MIN_BARS_REQUIRED} barras: ${insufficient.length}`);
  if (insufficient.length) {
    console.log("AVISO: todo símbolo cuya divisa esté en esa lista saldrá del ranking con motivo fx-unavailable/fx-stale.");
  }
  console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Error fatal:", error?.message || error);
    process.exitCode = 1;
  });
}
