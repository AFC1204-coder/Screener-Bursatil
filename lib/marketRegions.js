// lib/marketRegions.js — mapa ETF + países ISO por región (MH-FILL-5 v1).
//
// Veredictos en paralelo US / EU / JP / HK. La amplitud de cada región sale
// del escaneo nocturno filtrado por país; el ETF no sustituye filas ausentes.

import { aggregateUniverseBreadth } from "@/lib/marketBreadth";

/** Lista del panel GlobalRegionsPanel (2026-09-10); EU v1 = esta lista. */
export const MARKET_REGION_EU_COUNTRIES = [
  "ES", "DE", "FR", "NL", "CH", "SE", "IT", "BE", "PT", "AT", "IE", "GB",
];

export const MARKET_REGION_KEYS = ["US", "EU", "JP", "HK"];

export const MARKET_REGIONS = {
  US: {
    key: "US",
    name: "Estados Unidos",
    flag: "🇺🇸",
    etf: "SPY",
    etfName: "S&P 500",
    benchmarkLabel: "S&P 500 (SPY)",
    countries: ["US"],
  },
  EU: {
    key: "EU",
    name: "Europa",
    flag: "🇪🇺",
    etf: "FEZ",
    etfName: "Euro Stoxx 50",
    benchmarkLabel: "Euro Stoxx 50 (FEZ)",
    countries: MARKET_REGION_EU_COUNTRIES,
  },
  JP: {
    key: "JP",
    name: "Japón",
    flag: "🇯🇵",
    etf: "EWJ",
    etfName: "MSCI Japan",
    benchmarkLabel: "MSCI Japan (EWJ)",
    countries: ["JP"],
  },
  HK: {
    key: "HK",
    name: "Hong Kong",
    flag: "🇭🇰",
    etf: "EWH",
    etfName: "MSCI Hong Kong",
    benchmarkLabel: "MSCI Hong Kong (EWH)",
    countries: ["HK"],
  },
};

export function marketRegionByKey(key = "") {
  return MARKET_REGIONS[String(key || "").trim().toUpperCase()] || null;
}

export function normalizeCountryCode(value = "") {
  return String(value || "").trim().toUpperCase() || "US";
}

/** Filas del escaneo nocturno que pertenecen a la región (por ISO país). */
export function filterScanRowsByRegion(rows = [], regionKey = "") {
  const region = marketRegionByKey(regionKey);
  if (!region) return [];
  const allowed = new Set(region.countries);
  return rows.filter((row) => allowed.has(normalizeCountryCode(row.country)));
}

/** Amplitud regional sobre filas filtradas; reutiliza umbrales de marketBreadth. */
export function regionalBreadthFromRows(rows = [], regionKey = "") {
  const filtered = filterScanRowsByRegion(rows, regionKey);
  const aggregated = aggregateUniverseBreadth(filtered);
  const pick = (key) => aggregated.indicators.find((item) => item.key === key) || null;
  return {
    regionKey: String(regionKey || "").toUpperCase(),
    population: aggregated.population,
    dataAsOf: aggregated.dataAsOf,
    staleRows: aggregated.staleRows,
    above30w: pick("above30w"),
    aboveSma50: pick("aboveSma50"),
    stages: aggregated.stages,
  };
}

/** Agrega amplitud por país dentro de breadth.countries (UI legacy). */
export function regionBreadthFromCountries(breadth, regionKey = "") {
  const region = marketRegionByKey(regionKey);
  if (!region || !breadth || breadth.error) return null;
  let total = 0;
  let measured = 0;
  let above = 0;
  for (const country of region.countries) {
    const bucket = breadth.countries?.[country];
    if (!bucket) continue;
    total += bucket.total || 0;
    measured += bucket.sma50Measured || 0;
    above += bucket.sma50Above || 0;
  }
  return {
    total,
    measured,
    above,
    pct: measured ? (above / measured) * 100 : null,
  };
}

export function buildRegionalRegimePayload({
  regionKey = "",
  etf = null,
  etfFailure = null,
  breadth = null,
  regime = null,
  score = null,
}) {
  const region = marketRegionByKey(regionKey);
  if (!region) return null;
  return {
    key: region.key,
    name: region.name,
    flag: region.flag,
    benchmarkLabel: region.benchmarkLabel,
    etf: region.etf,
    etfName: region.etfName,
    score,
    regime,
    etfSnapshot: etf,
    etfFailure,
    breadth,
  };
}
