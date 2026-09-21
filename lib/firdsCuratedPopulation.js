// lib/firdsCuratedPopulation.js — detección estable de población curada (FIRDS off / curated-fallback).
import { envValue } from "@/lib/env";
import { normalizeMarketList } from "@/lib/markets";

export const ESMA_FIRDS_MARKETS = new Set([
  "AT", "BE", "DE", "DK", "ES", "FI", "FR", "IE", "IT", "NL", "NO", "PT", "SE",
]);
export const FCA_FIRDS_MARKETS = new Set(["GB"]);

export const CURATED_POPULATION_NOTICE_SOURCE = "curated-population-firds-off";

function envFlag(name) {
  return /^(1|true|yes|on)$/i.test(envValue(name));
}

export function isFirdsDependentMarket(code = "") {
  const upper = String(code || "").toUpperCase();
  return ESMA_FIRDS_MARKETS.has(upper) || FCA_FIRDS_MARKETS.has(upper);
}

export function firdsDependentMarketsInList(markets = []) {
  return normalizeMarketList(markets, []).filter(isFirdsDependentMarket);
}

export function readFirdsEnableFlags({ esmaFirdsEnabled = null, fcaFirdsEnabled = null } = {}) {
  return {
    esma: esmaFirdsEnabled === null ? envFlag("ESMA_FIRDS_ENABLED") : Boolean(esmaFirdsEnabled),
    fca: fcaFirdsEnabled === null ? envFlag("FCA_FIRDS_ENABLED") : Boolean(fcaFirdsEnabled),
  };
}

function providerNotConfigured(providerDiagnostics = null, market = "") {
  const status = providerDiagnostics?.byMarket?.[String(market || "").toUpperCase()]?.status;
  return status === "not_configured";
}

export function isCuratedFallbackUniverseCache(universeCache = null) {
  return universeCache?.status === "curated-fallback";
}

export function marketUsesCuratedPopulation(
  market = "",
  {
    esmaFirdsEnabled = null,
    fcaFirdsEnabled = null,
    providerDiagnostics = null,
    universeCache = null,
  } = {},
) {
  const upper = String(market || "").toUpperCase();
  if (!isFirdsDependentMarket(upper)) return false;
  if (isCuratedFallbackUniverseCache(universeCache)) return true;
  const flags = readFirdsEnableFlags({ esmaFirdsEnabled, fcaFirdsEnabled });
  if (FCA_FIRDS_MARKETS.has(upper)) {
    if (!flags.fca) return true;
    return providerNotConfigured(providerDiagnostics, upper);
  }
  if (!flags.esma) return true;
  return providerNotConfigured(providerDiagnostics, upper);
}

/**
 * Mercados FIRDS en scope que operan con población curada según señales disponibles.
 */
export function curatedFirdsMarketsInScope({
  scannedMarkets = [],
  selectedMarkets = [],
  universeCache = null,
  providerDiagnostics = null,
  esmaFirdsEnabled = null,
  fcaFirdsEnabled = null,
} = {}) {
  const scanned = normalizeMarketList(scannedMarkets, []);
  const selected = normalizeMarketList(selectedMarkets, []);
  const scopeMarkets = selected.length ? selected : scanned;
  const firdsMarkets = firdsDependentMarketsInList(scopeMarkets);
  if (!firdsMarkets.length) return [];
  return firdsMarkets.filter((market) => marketUsesCuratedPopulation(market, {
    esmaFirdsEnabled,
    fcaFirdsEnabled,
    providerDiagnostics,
    universeCache,
  }));
}
