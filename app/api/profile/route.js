import { fetchYahooProfile } from "@/lib/yahoo";
import { fetchAsicShortInterest, mergeAsicShortInterest } from "@/lib/asicShort";
import { withProfileCache } from "@/lib/fundamentalsCache";

function optionalNumber(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

async function fetchLiveProfile(symbol) {
  const profile = await fetchYahooProfile(symbol);
  const asicShort = await fetchAsicShortInterest(symbol).catch(() => null);
  return mergeAsicShortInterest(profile, asicShort);
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const refresh = searchParams.get("refresh") === "1";
  const useCache = searchParams.get("cache") !== "0";
  const maxAgeDays = optionalNumber(searchParams.get("maxAgeDays") || searchParams.get("maxFundamentalsAgeDays"));
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  try {
    return Response.json(await withProfileCache(symbol, { refresh, useCache, maxAgeDays }, fetchLiveProfile));
  } catch (err) {
    return Response.json({ error: err.message }, { status: 502 });
  }
}
