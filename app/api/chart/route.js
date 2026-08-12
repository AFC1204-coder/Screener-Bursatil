import { fetchYahooChart } from "@/lib/marketData";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { unavailableChartForSymbol } from "@/lib/estimatedBars";

const CHART_RESPONSE_TIMEOUT_MS = Number(process.env.CHART_RESPONSE_TIMEOUT_MS || 6500);
const CHART_CACHE_READ_TIMEOUT_MS = Number(process.env.CHART_CACHE_READ_TIMEOUT_MS || 1500);

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : undefined;
}

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), Math.max(500, Number(ms) || 0));
  });
}

// Cuando el proveedor y la caché fallan, la respuesta es AUSENCIA explícita:
// cero barras y dataQuality.status === "missing". Antes esta ruta servía por
// defecto una serie sintética (estimatedFallback default true), y por eso
// cualquier símbolo —inexistente o real con histórico insuficiente— recibía
// precio y velas fabricadas en todas las superficies que leen /api/chart.
function degradedChartPayload(symbol, options = {}, error = {}) {
  return unavailableChartForSymbol(symbol, options, error);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const range = searchParams.get("range") || "";
  const interval = searchParams.get("interval") || "";
  const refresh = searchParams.get("refresh") === "1";
  const useCache = searchParams.get("cache") !== "0";
  const maxAgeDays = optionalNumber(searchParams.get("maxAgeDays") || searchParams.get("maxPriceFreshnessDays"));
  const minBars = optionalNumber(searchParams.get("minBars") || searchParams.get("minChartBars"));
  const asOfDate = searchParams.get("asOf") || searchParams.get("asOfDate") || "";
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  const options = { range, interval, refresh, useCache, maxAgeDays, minBars, asOfDate, timeoutMs: CHART_CACHE_READ_TIMEOUT_MS };
  try {
    return Response.json(await Promise.race([
      withDailyBarsCache(symbol, options, fetchYahooChart),
      timeoutAfter(CHART_RESPONSE_TIMEOUT_MS, "Chart provider timeout"),
    ]));
  } catch (err) {
    return Response.json(degradedChartPayload(symbol, options, err));
  }
}
