// scripts/bench-concurrency.mjs — mide el rendimiento real de descarga de
// barras diarias de Yahoo Finance a distintos niveles de concurrencia.
//
// Uso:
//   node --loader ./scripts/loader.mjs scripts/bench-concurrency.mjs --concurrency=4 --symbols=AAPL,MSFT,...
//
// Importa fetchYahooChart desde lib/marketData.js — la MISMA función que usa
// el escaneo real (lib/materializedScanner.js:fetchChartForScan). Se invoca
// con { refresh: true } para desactivar la caché de memoria y forzar una
// petición HTTP real a Yahoo en cada llamada, igual que haría un símbolo
// nunca visto en producción.
//
// No escribe en Supabase. Solo descarga y mide. Aborta la corrida completa
// en cuanto detecta el primer 429 (no completa el resto de símbolos).

import { fetchYahooChart } from "@/lib/marketData.js";
import { classifyProviderError } from "@/lib/scanErrors.js";

function parseArgs(argv) {
  const out = { concurrency: 2, symbols: [] };
  for (const arg of argv) {
    const [key, value] = arg.replace(/^--/, "").split("=");
    if (key === "concurrency") out.concurrency = Math.max(1, Number(value) || 2);
    if (key === "symbols") out.symbols = value.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  return out;
}

async function mapLimitAbortable(items, limit, worker, shouldAbort) {
  const out = new Array(items.length);
  let index = 0;
  let aborted = false;
  let abortReason = null;

  async function run() {
    while (index < items.length && !aborted) {
      const current = index;
      index += 1;
      const item = items[current];
      const started = Date.now();
      try {
        const result = await worker(item);
        out[current] = { symbol: item, ok: true, ms: Date.now() - started, ...result };
      } catch (error) {
        const classified = classifyProviderError(error);
        out[current] = {
          symbol: item,
          ok: false,
          ms: Date.now() - started,
          status: classified.status,
          kind: classified.kind,
          reason: classified.reason,
        };
        if (shouldAbort(classified)) {
          aborted = true;
          abortReason = { symbol: item, status: classified.status, reason: classified.reason };
        }
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length || 1) }, run);
  await Promise.all(workers);
  return { out: out.slice(0, index), aborted, abortReason, attempted: index };
}

async function main() {
  const { concurrency, symbols } = parseArgs(process.argv.slice(2));
  if (!symbols.length) {
    console.error("Uso: --symbols=AAPL,MSFT,... --concurrency=N");
    process.exit(1);
  }

  console.log(`Bench: ${symbols.length} simbolos, concurrencia=${concurrency}, cache desactivada (refresh:true)`);
  console.log(`Simbolos: ${symbols.join(", ")}`);

  const startedAt = Date.now();
  const { out, aborted, abortReason, attempted } = await mapLimitAbortable(
    symbols,
    concurrency,
    (symbol) => fetchYahooChart(symbol, { range: "2A", interval: "D", refresh: true, useCache: false }),
    (classified) => classified.status === 429,
  );
  const totalMs = Date.now() - startedAt;

  const successes = out.filter((r) => r.ok);
  const errors = out.filter((r) => !r.ok);
  const rate429 = errors.filter((r) => r.status === 429).length;
  const rate5xx = errors.filter((r) => r.status >= 500 && r.status < 600).length;
  const otherErrors = errors.length - rate429 - rate5xx;

  const totalSeconds = totalMs / 1000;
  const throughput = totalSeconds > 0 ? successes.length / totalSeconds : 0;
  const avgPerSymbolMs = out.length ? out.reduce((sum, r) => sum + r.ms, 0) / out.length : 0;

  console.log("");
  console.log("=== RESULTADO ===");
  console.log(`Simbolos objetivo: ${symbols.length}`);
  console.log(`Simbolos intentados: ${attempted}`);
  console.log(`Concurrencia: ${concurrency}`);
  console.log(`Tiempo total: ${totalSeconds.toFixed(2)}s`);
  console.log(`Tiempo medio por simbolo: ${(avgPerSymbolMs / 1000).toFixed(2)}s`);
  console.log(`RENDIMIENTO TOTAL: ${throughput.toFixed(4)} simbolos/seg (exitosos)`);
  console.log(`Exitos: ${successes.length}`);
  console.log(`429: ${rate429}`);
  console.log(`5xx: ${rate5xx}`);
  console.log(`Otros errores: ${otherErrors}`);
  console.log(`Abortado por 429: ${aborted ? "SI" : "NO"}`);
  if (aborted) {
    console.log(`  -> abortado en simbolo=${abortReason.symbol} status=${abortReason.status} reason=${abortReason.reason}`);
  }

  console.log("");
  console.log("=== DETALLE POR SIMBOLO ===");
  for (const r of out) {
    if (r.ok) {
      console.log(`  ${r.symbol}: OK ${r.ms}ms bars=${r.bars?.length ?? "?"}`);
    } else {
      console.log(`  ${r.symbol}: ERROR ${r.ms}ms status=${r.status} kind=${r.kind} reason=${r.reason}`);
    }
  }

  console.log("");
  console.log(
    JSON.stringify(
      {
        symbolsRequested: symbols.length,
        symbolsAttempted: attempted,
        concurrency,
        totalMs,
        avgPerSymbolMs,
        throughputPerSec: throughput,
        successes: successes.length,
        errors429: rate429,
        errors5xx: rate5xx,
        errorsOther: otherErrors,
        aborted,
        abortReason,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error("Fallo del bench:", error);
  process.exit(1);
});
