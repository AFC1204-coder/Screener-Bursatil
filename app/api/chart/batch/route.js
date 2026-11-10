import { fetchYahooChart } from "@/lib/marketData";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { compressedJsonResponse } from "@/lib/compressedJsonResponse";
import { mapLimit, normalizeBatchSymbols, trimBarsForPreview } from "@/lib/chartBatch";

// GET /api/chart/batch?symbols=KO,AAPL,… — miniaturas de varios símbolos en UNA
// petición. Misma resolución por símbolo que GET /api/chart (withDailyBarsCache,
// mismos timeouts), así que no cambia de dónde salen los datos: solo evita
// pedir 50 gráficos con 50 viajes (la página de Listas los iba rellenando a
// goteo durante ~5 s). Un símbolo sin datos va como [].
const CONCURRENCY = 8;
const CHART_RESPONSE_TIMEOUT_MS = Number(process.env.CHART_RESPONSE_TIMEOUT_MS || 6500);
const CHART_CACHE_READ_TIMEOUT_MS = Number(process.env.CHART_CACHE_READ_TIMEOUT_MS || 1500);

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), Math.max(500, Number(ms) || 0));
  });
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbols = normalizeBatchSymbols(searchParams.get("symbols"));
  if (!symbols.length) return Response.json({ error: "Faltan symbols", charts: {} }, { status: 400 });

  const options = { range: "", interval: "", refresh: false, useCache: true, timeoutMs: CHART_CACHE_READ_TIMEOUT_MS };
  const entries = await mapLimit(symbols, CONCURRENCY, async (symbol) => {
    try {
      const payload = await Promise.race([
        withDailyBarsCache(symbol, options, fetchYahooChart),
        timeoutAfter(CHART_RESPONSE_TIMEOUT_MS, "Chart provider timeout"),
      ]);
      return [symbol, trimBarsForPreview(payload?.bars)];
    } catch {
      return [symbol, []];
    }
  });
  return compressedJsonResponse(request, { charts: Object.fromEntries(entries) });
}
