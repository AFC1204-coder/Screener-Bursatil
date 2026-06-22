import { fetchYahooProfile } from "@/lib/marketData";
import { fetchAsicShortInterest, mergeAsicShortInterest } from "@/lib/asicShort";
import { withProfileCache } from "@/lib/fundamentalsCache";
import { peerIdentityForSymbol } from "@/lib/peers";
import { CURATED_NAMES } from "@/lib/universes";
import { countryCode } from "@/lib/symbols";

const PROFILE_RESPONSE_TIMEOUT_MS = Number(process.env.PROFILE_RESPONSE_TIMEOUT_MS || 6000);
const PROFILE_CACHE_READ_TIMEOUT_MS = Number(process.env.PROFILE_CACHE_READ_TIMEOUT_MS || 1500);

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

function timeoutAfter(ms, message) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), Math.max(500, Number(ms) || 0));
  });
}

function fallbackProfile(symbol = "", error = {}) {
  const clean = String(symbol || "").trim().toUpperCase();
  const peer = peerIdentityForSymbol(clean);
  const name = peer?.name || CURATED_NAMES[clean] || clean;
  return {
    symbol: clean,
    name,
    sector: peer?.sector || "Sin sector",
    industry: peer?.industry || "Sin industria",
    exchange: "",
    currency: "",
    country: peer?.country || countryCode(clean) || "",
    businessSummary: peer?.theme ? `${name}: ${peer.theme}.` : "",
    marketCap: null,
    valuationMetrics: {},
    quoteSnapshot: {},
    growthMetrics: {
      providerNote: "Perfil degradado: proveedor no disponible dentro del presupuesto operativo.",
    },
    shortInterest: null,
    profileProviderError: error.message || "Proveedor no disponible",
    fundamentalsCache: {
      status: "provider-timeout",
      hit: false,
      stale: false,
      fallbackError: error.message || "Proveedor no disponible",
    },
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const refresh = searchParams.get("refresh") === "1";
  const useCache = searchParams.get("cache") !== "0";
  const maxAgeDays = optionalNumber(searchParams.get("maxAgeDays") || searchParams.get("maxFundamentalsAgeDays"));
  if (!symbol) return Response.json({ error: "Missing symbol" }, { status: 400 });
  try {
    return Response.json(await Promise.race([
      withProfileCache(symbol, { refresh, useCache, maxAgeDays, timeoutMs: PROFILE_CACHE_READ_TIMEOUT_MS }, fetchLiveProfile),
      timeoutAfter(PROFILE_RESPONSE_TIMEOUT_MS, "Profile provider timeout"),
    ]));
  } catch (err) {
    return Response.json(fallbackProfile(symbol, err));
  }
}
