// lib/marketRegionalRegimes.js — régimen paralelo por región (MH-FILL-5 v1).
//
// Etapa + estructura del ETF (mismos módulos que FILL-1 / market-health) y
// amplitud del escaneo nocturno filtrada por país. Sin score mundial.

import {
  MARKET_REGION_KEYS,
  MARKET_REGIONS,
  buildRegionalRegimePayload,
  regionalBreadthFromRows,
} from "@/lib/marketRegions";

export function stageScoreForRegime(stageState, stageConfirmation, stageScoreFn) {
  if (typeof stageScoreFn !== "function") return null;
  return stageScoreFn(stageState, stageConfirmation);
}

export function buildRegionalRegimes({
  scanRows = [],
  etfByRegion = {},
  etfFailures = {},
  stageScoreFn,
  regimeFn,
}) {
  const regimes = {};
  for (const key of MARKET_REGION_KEYS) {
    const region = MARKET_REGIONS[key];
    const etf = etfByRegion[key] || null;
    const failure = etfFailures[key] || null;
    const score = etf && !failure
      ? stageScoreForRegime(etf.stageState, etf.stageConfirmation, stageScoreFn)
      : null;
    regimes[key] = buildRegionalRegimePayload({
      regionKey: key,
      etf: etf ? {
        symbol: region.etf,
        name: region.etfName,
        lastDate: etf.lastDate || "",
        price: etf.price ?? null,
        stageState: etf.stageState ?? null,
        stageConfirmation: etf.stageConfirmation ?? null,
        stage30w: etf.stage30w ?? null,
        weeklyStageStructure: etf.weeklyStageStructure ?? null,
        weeklyStageStructureLabel: etf.weeklyStageStructureLabel ?? null,
        distanceSma30w: etf.distanceSma30w ?? null,
        priceAboveSlowMa: etf.priceAboveSlowMa ?? null,
        distributionDays20: etf.distributionDays20 ?? null,
        accumulationDays20: etf.accumulationDays20 ?? null,
      } : null,
      etfFailure: failure,
      score,
      regime: Number.isFinite(score) && typeof regimeFn === "function" ? regimeFn(score) : null,
      breadth: regionalBreadthFromRows(scanRows, key),
    });
  }
  return regimes;
}
