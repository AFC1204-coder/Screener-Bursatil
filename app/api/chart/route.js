import { fetchYahooChart } from "@/lib/yahoo";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const range = searchParams.get("range") || "";
  const interval = searchParams.get("interval") || "";
  const refresh = searchParams.get("refresh") === "1";
  const useCache = searchParams.get("cache") !== "0";
  const maxAgeDays = optionalNumber(searchParams.get("maxAgeDays") || searchParams.get("maxPriceFreshnessDays"));
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  try {
    return Response.json(await withDailyBarsCache(symbol, { range, interval, refresh, useCache, maxAgeDays }, fetchYahooChart));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
