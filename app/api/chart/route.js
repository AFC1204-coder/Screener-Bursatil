import { fetchYahooChart, fetchYahooFullHistoryChart } from "@/lib/marketData";
import { normalizeChartInterval } from "@/lib/chartSettings";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { unavailableChartForSymbol } from "@/lib/estimatedBars";
import { compressedJsonResponse } from "@/lib/compressedJsonResponse";

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

// «Max» del gráfico (range=MAX con interval W o M): histórico ENTERO con su
// cadencia real semanal/mensual, pedido a Yahoo con period1=0 (range=max
// degrada a trimestral). Este camino NO toca daily_bars — ni lee ni escribe:
// son barras no diarias y la tabla ya sufrió 1.840 filas así por esta misma
// causa. Caché: solo memoria del proceso (marketData, TTL diario) + gzip.
// `range=MAX&interval=D` sigue el camino de siempre (hay consumidores que
// esperan diario, p. ej. scripts/methodology-audit-utils.mjs).
export function fullHistoryBarInterval(range = "", interval = "") {
  if (String(range || "").toUpperCase() !== "MAX") return null;
  const normalized = normalizeChartInterval(interval);
  if (normalized === "W") return "1wk";
  if (normalized === "M") return "1mo";
  return null;
}

function fullHistoryPayload(chart = {}, barInterval = "1wk") {
  const bars = Array.isArray(chart.bars) ? chart.bars : [];
  return {
    bars,
    meta: { ...(chart.meta || {}), barInterval },
    dataQuality: {
      status: bars.length >= 2 ? "real" : "missing",
      source: chart.meta?.dataProvider || "Yahoo Finance",
      cache: "memory",
      barInterval,
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
  const options = { range, interval, refresh, useCache, maxAgeDays, minBars, asOfDate, timeoutMs: CHART_CACHE_READ_TIMEOUT_MS };
  // gzip negociado como /api/chart/batch: la respuesta iba en claro (1A 79 KB,
  // 5A 200 KB; auditoría 2026-11, H23). El contrato JSON no cambia (el
  // navegador descomprime solo); no se recortan campos de la barra porque hay
  // más consumidores de esta ruta que el gráfico.
  let payload;
  const barInterval = fullHistoryBarInterval(range, interval);
  if (barInterval) {
    try {
      const chart = await Promise.race([
        fetchYahooFullHistoryChart(symbol, { barInterval, refresh, useCache }),
        timeoutAfter(CHART_RESPONSE_TIMEOUT_MS, "Chart provider timeout"),
      ]);
      payload = fullHistoryPayload(chart, barInterval);
    } catch (err) {
      // Ausencia explícita: el cliente cae a su histórico diario local y lo
      // rotula; nunca se rellena con la caché diaria.
      payload = degradedChartPayload(symbol, options, err);
    }
    return compressedJsonResponse(request, payload);
  }
  try {
    payload = await Promise.race([
      withDailyBarsCache(symbol, options, fetchYahooChart),
      timeoutAfter(CHART_RESPONSE_TIMEOUT_MS, "Chart provider timeout"),
    ]);
  } catch (err) {
    payload = degradedChartPayload(symbol, options, err);
  }
  return compressedJsonResponse(request, payload);
}
