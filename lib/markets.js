export const EUROPE_CORE_MARKETS = ["GB", "DE", "FR", "NL", "CH", "SE", "IT", "ES", "DK", "NO", "FI", "BE", "PT", "AT", "IE"];

export const EUROPE_PRIORITY_MARKETS = ["GB", "DE", "FR", "NL", "CH", "SE", "IT", "ES"];

export const EUROPE_SECONDARY_MARKETS = ["DK", "NO", "FI", "BE", "PT", "AT", "IE"];

export const DEFAULT_SCAN_MARKETS = ["US", "HK", "AU", ...EUROPE_PRIORITY_MARKETS];

const MARKET_ALIASES = {
  EU: EUROPE_CORE_MARKETS,
  EUR: EUROPE_CORE_MARKETS,
  EUROPE: EUROPE_CORE_MARKETS,
  EU1: EUROPE_PRIORITY_MARKETS,
  EUROPE1: EUROPE_PRIORITY_MARKETS,
  EU2: EUROPE_SECONDARY_MARKETS,
  EUROPE2: EUROPE_SECONDARY_MARKETS,
};

function cleanMarket(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function expandMarketAliases(markets = []) {
  const raw = Array.isArray(markets) ? markets : String(markets || "").split(",");
  const out = [];
  for (const item of raw) {
    const market = cleanMarket(item);
    if (!market) continue;
    out.push(...(MARKET_ALIASES[market] || [market]));
  }
  return [...new Set(out)];
}

export function normalizeMarketList(markets = [], fallback = ["US"]) {
  const expanded = expandMarketAliases(markets);
  return expanded.length ? expanded : expandMarketAliases(fallback);
}
