import { fetchYahooChart } from "@/lib/marketData";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { estimatedChartForSymbol } from "@/lib/estimatedBars";

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

function degradedChartPayload(symbol, options = {}, error = {}) {
  if (options.estimatedFallback !== false) return estimatedChartForSymbol(symbol, options, error);
  return {
    ok: false,
    bars: [],
    meta: {
      symbol,
      requestedInterval: options.interval || "",
      requestedRange: options.range || "2A",
      dataProvider: "No disponible",
      cache: {
        hit: false,
        stale: false,
        rows: 0,
        maxAgeDays: options.maxAgeDays ?? null,
        error: error.message || "Historico no disponible",
      },
    },
    dataQuality: {
      status: "missing",
      issue: "Historico no disponible dentro del presupuesto operativo",
    },
  };
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
  const estimatedFallback = searchParams.get("estimatedFallback") !== "0" && searchParams.get("fallback") !== "0";
  const options = { range, interval, refresh, useCache, maxAgeDays, minBars, asOfDate, estimatedFallback, timeoutMs: CHART_CACHE_READ_TIMEOUT_MS };
  try {
    return Response.json(await Promise.race([
      withDailyBarsCache(symbol, options, fetchYahooChart),
      timeoutAfter(CHART_RESPONSE_TIMEOUT_MS, "Chart provider timeout"),
    ]));
  } catch (err) {
    return Response.json(degradedChartPayload(symbol, options, err));
  }
}
