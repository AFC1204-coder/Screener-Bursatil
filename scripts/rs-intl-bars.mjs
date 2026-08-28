// scripts/rs-intl-bars.mjs — backfill de barras diarias para los 833 símbolos
// internacionales curados del universo de RS global privado (MET-1b, Fase 0
// punto 3).
//
// EL PROBLEMA QUE RESUELVE: el motor exige ≥261 barras por símbolo, y hoy solo
// hay garantía de barras para lo que el cron materializó — un lote rotativo de
// unas decenas por noche (HK 23, GB 3, IT-ES 7 según INT-0 §2). Sin este
// backfill, HK/CA/EU entrarían al ranking con un puñado de símbolos y el resto
// saldría con motivo insufficient-bars: exactamente el "–" mudo que MET-1
// existe para eliminar.
//
// IDEMPOTENTE: reutiliza withDailyBarsCache, que lee la caché y decide
// fresh/stale antes de descargar (--stale-days gobierna el umbral), y que desde
// d0a628b escribe solo el delta. Una segunda corrida sobre símbolos ya al día no
// descarga ni escribe nada.
//
// TOPE DE FILAS: mismo mecanismo y misma razón que scripts/refresh-bars.mjs — el
// 9 de agosto de 2026 una carga inicial de ~700.000 filas tumbó la instancia
// Supabase (Micro, 1 GB) cuatro horas. 833 símbolos vírgenes × ~400 barras de
// cap son ~333.000 filas, así que este backfill ESTÁ en el rango peligroso y el
// tope no es decorativo: por defecto 100.000 filas, lo que obliga a partirlo en
// ~4 corridas. El orden es determinista (el de intlUniverseRows), así que una
// corrida cortada por el tope se retoma relanzando.
//
// Uso:
//   node --env-file=.env.local --loader ./scripts/loader.mjs \
//     scripts/rs-intl-bars.mjs [--dry-run] [--write] [--limit=N] \
//     [--market=HK] [--concurrency=4] [--stale-days=1] [--max-filas=100000]

import { pathToFileURL } from "node:url";

import { supabaseConfig, supabaseRequest } from "@/lib/supabaseServer.js";
import { fetchYahooChart } from "@/lib/yahoo.js";
import { withDailyBarsCache } from "@/lib/dailyBarsCache.js";
import { GLOBAL_RS_INTL_MARKETS, intlCountsByMarket, intlUniverseRows } from "@/lib/rsGlobalUniverse.js";

const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;
const MIN_BARS_REQUIRED = 261;

// Más conservador que las 200.000 de refresh-bars.mjs: aquel refresca un
// universo que en su mayoría YA tiene barras (delta de una sesión); este es una
// carga inicial declarada, donde casi cada símbolo trae ~400 filas nuevas.
const DEFAULT_MAX_ROWS = 100000;

export function parseArgs(argv) {
  const out = {
    dryRun: true,
    write: false,
    limit: 0,
    market: "",
    concurrency: DEFAULT_CONCURRENCY,
    staleDays: 1,
    maxRows: DEFAULT_MAX_ROWS,
  };
  for (const arg of argv) {
    const [rawKey, rawValue] = arg.replace(/^--/, "").split("=");
    const key = rawKey.trim();
    if (key === "dry-run") out.dryRun = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "write") out.write = rawValue === undefined ? true : rawValue !== "false";
    else if (key === "limit") out.limit = Math.max(0, Number(rawValue) || 0);
    else if (key === "market") out.market = String(rawValue || "").trim().toUpperCase();
    else if (key === "concurrency") out.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, Number(rawValue) || DEFAULT_CONCURRENCY));
    else if (key === "stale-days") out.staleDays = Math.max(0, Number(rawValue) ?? 1);
    else if (key === "max-filas") out.maxRows = Math.max(0, Number(rawValue) || 0) || DEFAULT_MAX_ROWS;
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

async function barDepth(config, symbol) {
  try {
    const rows = await supabaseRequest("daily_bars", {
      query: [
        `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
        `symbol=eq.${encodeURIComponent(symbol)}`,
        "select=trade_date",
        "order=trade_date.desc",
        `limit=${MIN_BARS_REQUIRED + 50}`,
      ].join("&"),
    });
    const dates = [...new Set((rows || []).map((row) => row.trade_date).filter(Boolean))];
    return { bars: dates.length, latest: dates[0] || null };
  } catch {
    return { bars: 0, latest: null };
  }
}

async function backfillOne(config, row, args) {
  // Mismo patrón de aislamiento que refreshOne en refresh-bars.mjs: el fallo de
  // un símbolo se atrapa y se reporta; un 429 o un símbolo retirado no aborta
  // la corrida. Con 833 símbolos intl esto no es hipotético.
  try {
    const result = await withDailyBarsCache(row.symbol, { range: "2A", interval: "D", maxAgeDays: args.staleDays }, fetchYahooChart);
    const cache = result?.meta?.cache || {};
    if (cache.hit === true) return { ...row, ok: true, skipped: true, barsWritten: 0 };
    if (cache.write) {
      if (cache.write.status === "error") return { ...row, ok: false, reason: cache.write.error || "writeDailyBarsCache status:error" };
      // rejected-non-daily es un caso REAL para intl: Yahoo devuelve granularidad
      // semanal para algunos .HK/.AX en rangos largos (ver lib/dailyBarsCache.js).
      // El guard lo rechaza entero, y eso se reporta como fallo del símbolo, no
      // como éxito silencioso con cero filas.
      if (cache.write.status === "rejected-non-daily") {
        return { ...row, ok: false, reason: `payload no diario rechazado: ${cache.write.reason || "cadencia no diaria"}` };
      }
      if (cache.write.status === "rejected-estimated") {
        return { ...row, ok: false, reason: "payload con barras estimadas rechazado" };
      }
      return { ...row, ok: true, skipped: false, barsWritten: cache.write.count || 0 };
    }
    return { ...row, ok: false, reason: `sin escritura nueva (status=${cache.status || "desconocido"}; posible fallo de proveedor)` };
  } catch (error) {
    return { ...row, ok: false, reason: error?.message || String(error) };
  }
}

// Mismo bucle con tope acumulado que refresh-bars.mjs (ver allí la nota sobre
// por qué no hay condición de carrera con el contador en JS de un solo hilo).
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

async function main() {
  const startedAt = Date.now();
  const args = parseArgs(process.argv.slice(2));
  const config = supabaseConfig();
  if (!config.configured) {
    console.error("Supabase no configurado. Faltan:", config.missing.join(", "));
    process.exit(1);
  }

  const markets = args.market ? [args.market] : GLOBAL_RS_INTL_MARKETS;
  if (args.market && !GLOBAL_RS_INTL_MARKETS.includes(args.market)) {
    console.error(`--market="${args.market}" no está en el universo v1: ${GLOBAL_RS_INTL_MARKETS.join(", ")}`);
    process.exit(1);
  }
  const universe = intlUniverseRows(markets);
  const toProcess = args.limit > 0 ? universe.slice(0, args.limit) : universe;

  console.log(`=== rs-intl-bars.mjs — modo=${args.write && !args.dryRun ? "WRITE" : "dry-run"} concurrency=${args.concurrency} stale-days=${args.staleDays} ===`);
  console.log(`Mercados: ${markets.join(", ")}`);
  console.log(`Símbolos definidos: ${universe.length}`);
  console.log(`Reparto por mercado: ${JSON.stringify(intlCountsByMarket(universe))}`);
  console.log(`A procesar en esta corrida: ${toProcess.length}${args.limit > 0 ? ` (por --limit)` : ""}`);

  if (!toProcess.length) {
    console.log("Nada que hacer.");
    return;
  }

  if (args.dryRun) {
    console.log("");
    console.log(`Midiendo profundidad actual en daily_bars (lectura, sin descargar)...`);
    const depths = await mapLimit(toProcess, args.concurrency, async (row) => ({ ...row, ...(await barDepth(config, row.symbol)) }));
    const ready = depths.filter((row) => row.bars >= MIN_BARS_REQUIRED);
    const partial = depths.filter((row) => row.bars > 0 && row.bars < MIN_BARS_REQUIRED);
    const empty = depths.filter((row) => row.bars === 0);

    const byMarket = {};
    for (const row of depths) {
      byMarket[row.market] = byMarket[row.market] || { definidos: 0, computables: 0 };
      byMarket[row.market].definidos += 1;
      if (row.bars >= MIN_BARS_REQUIRED) byMarket[row.market].computables += 1;
    }

    console.log("");
    console.log(`=== COBERTURA ACTUAL (antes del backfill) ===`);
    for (const market of markets) {
      const stat = byMarket[market];
      if (!stat) continue;
      console.log(`  ${market.padEnd(3)} ${String(stat.computables).padStart(4)}/${String(stat.definidos).padEnd(4)} con >=${MIN_BARS_REQUIRED} barras`);
    }
    console.log("");
    console.log(`Con barras suficientes (>=${MIN_BARS_REQUIRED}): ${ready.length}`);
    console.log(`Con barras insuficientes (1..${MIN_BARS_REQUIRED - 1}): ${partial.length}`);
    console.log(`Sin ninguna barra: ${empty.length}`);
    console.log(`Estimación de filas a escribir si se descargan todos los que faltan: ~${(partial.length + empty.length) * 400} (cap 400/símbolo)`);
    console.log("");
    console.log("Dry-run: no se descargó ni se escribió nada. Pasa --write para backfillear.");
    console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    return;
  }

  console.log("");
  console.log(`Descargando vía withDailyBarsCache (tope ${args.maxRows} filas escritas)...`);
  const processStartedAt = Date.now();
  const { results, rowsWritten, processed, remaining, stoppedByCap } = await runWriteLoop(toProcess, {
    concurrency: args.concurrency,
    maxRows: args.maxRows,
    backfill: (row) => backfillOne(config, row, args),
  });
  const processElapsedMs = Date.now() - processStartedAt;

  const skipped = results.filter((r) => r.ok && r.skipped);
  const succeeded = results.filter((r) => r.ok && !r.skipped);
  const failed = results.filter((r) => !r.ok);

  console.log("");
  console.log("=== REPORTE ===");
  console.log(`Procesados: ${processed}/${toProcess.length}`);
  console.log(`Al día, saltados: ${skipped.length}`);
  console.log(`Descargados: ${succeeded.length}`);
  console.log(`Fallidos: ${failed.length}`);
  console.log(`Filas escritas en daily_bars: ${rowsWritten} (tope ${args.maxRows})`);
  if (failed.length) {
    const byMarketFailed = {};
    for (const row of failed) byMarketFailed[row.market] = (byMarketFailed[row.market] || 0) + 1;
    console.log(`Fallos por mercado: ${JSON.stringify(byMarketFailed)}`);
    for (const row of failed.slice(0, 30)) console.log(`  - ${row.symbol}: ${row.reason}`);
    if (failed.length > 30) console.log(`  ... y ${failed.length - 30} más (omitidos del detalle, no del conteo).`);
  }
  const msPerSymbol = processed ? processElapsedMs / processed : 0;
  console.log(`Tiempo de procesamiento: ${(processElapsedMs / 1000).toFixed(1)}s (${msPerSymbol.toFixed(0)} ms/símbolo)`);
  console.log(`Tiempo total: ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);

  if (stoppedByCap) {
    console.log("");
    console.log(`PARADA POR TOPE: ${rowsWritten} filas escritas (tope ${args.maxRows}). Quedaron ${remaining} símbolos sin procesar.`);
    console.log("El orden es determinista: relanza para retomar, o sube el tope con --max-filas=N a sabiendas.");
    process.exitCode = 2;
  }
}

const invokedDirectly = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    console.error("Error fatal:", error?.message || error);
    process.exitCode = 1;
  });
}
