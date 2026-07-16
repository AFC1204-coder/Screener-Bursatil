// Snapshot verbatim de las fórmulas de scoring.js previas a la consolidación
// en lib/scoringEngine.js. NO es un test (prefijo `_` lo excluye del include
// de vitest). Sirve como referencia bit-a-bit contra la que se compara el
// motor: si el motor cambia una fórmula sin documentar, el test golden
// rompe ruidosamente.
//
// Este archivo contiene SOLO las 19 funciones puras que migran al engine,
// más los helpers gt/gte/lt/lte/between. NO incluye funciones no-registry
// (scoreWeakness, compositeNarrative, regimeRejectReason, etc.).

import { firstFinite } from "@/lib/indicators";
import { methodologyPatternEvidenceBonus } from "@/lib/methodologyDisplay";
import { isConfirmedStage2 } from "@/lib/trendStructure";

function clamp(n, a = 0, b = 100) {
  const x = Number(n);
  if (!Number.isFinite(x)) return a;
  return Math.max(a, Math.min(b, x));
}

export function gt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value > threshold; }
export function gte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value >= threshold; }
export function lt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value < threshold; }
export function lte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value <= threshold; }
export function between(value, min, max) { return gte(value, min) && lte(value, max); }

export function scoreWeinstein(r) { let s = 0; if (gt(r.price, r.sma150)) s += 18; if (gt(r.sma150, r.sma200)) s += 18; if (gt(r.sma200Slope, 0)) s += 18; if (gt(r.price, r.sma50)) s += 14; if (gt(r.sma50, r.sma150)) s += 14; if (gte(r.distance52w, -25)) s += 10; if (gt(r.perf6m, 0)) s += 8; return clamp(s); }
export function scoreMinervini(r) { let s = 0; if (gt(r.price, r.sma150) && gt(r.price, r.sma200)) s += 14; if (gt(r.sma150, r.sma200)) s += 12; if (gt(r.sma200Slope, 0)) s += 12; if (gt(r.sma50, r.sma150) && gt(r.sma50, r.sma200)) s += 12; if (gt(r.price, r.sma50)) s += 10; if (gte(r.lowAdvance52w, 30)) s += 12; if (gte(r.distance52w, -25)) s += 8; if (gte(r.distance20d, -10)) s += 8; if (lte(r.highsSpreadPct, 12)) s += 6; if (gt(r.perf3m, 10)) s += 6; return clamp(s); }
export function scoreMomentum(r) { let s = 0; if (gte(r.perf3m, 20)) s += 35; else if (gte(r.perf3m, 10)) s += 25; else if (gte(r.perf3m, 0)) s += 12; if (gte(r.perf6m, 40)) s += 35; else if (gte(r.perf6m, 20)) s += 25; else if (gte(r.perf6m, 5)) s += 12; if (gte(r.perf12m, 80)) s += 30; else if (gte(r.perf12m, 40)) s += 22; else if (gte(r.perf12m, 15)) s += 12; return clamp(s); }
export function scoreRisk(r) { const e = r.extSma50; let s = 0; if (between(e, -3, 8)) s += 38; else if (between(e, -8, 15)) s += 30; else if (lte(e, 25)) s += 18; else if (lte(e, 35)) s += 8; if (gte(r.distance20d, -5)) s += 22; else if (gte(r.distance20d, -10)) s += 14; if (gte(r.distance50d, -10)) s += 18; else if (gte(r.distance50d, -18)) s += 10; if (gt(r.price, r.sma50)) s += 22; return clamp(s); }
export function scoreRiskReward(r) {
  let s = 0;
  if (gte(r.returnToVol3m, 1.2)) s += 26;
  else if (gte(r.returnToVol3m, .8)) s += 20;
  else if (gte(r.returnToVol3m, .35)) s += 12;
  else if (gte(r.returnToVol3m, 0)) s += 4;
  if (gte(r.returnToDrawdown3m, 2.5)) s += 26;
  else if (gte(r.returnToDrawdown3m, 1.5)) s += 18;
  else if (gte(r.returnToDrawdown3m, .8)) s += 10;
  else if (gte(r.returnToDrawdown3m, 0)) s += 4;
  if (Number.isFinite(r.volatility63d)) {
    if (r.volatility63d <= 25) s += 18;
    else if (r.volatility63d <= 40) s += 12;
    else if (r.volatility63d <= 60) s += 6;
  }
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d <= 10) s += 20;
    else if (r.maxDrawdown63d <= 18) s += 14;
    else if (r.maxDrawdown63d <= 32) s += 7;
  }
  if (Number.isFinite(r.maxDailyMove20dPct)) {
    if (r.maxDailyMove20dPct <= 8) s += 8;
    else if (r.maxDailyMove20dPct <= 14) s += 4;
  }
  if (Number.isFinite(r.range63dPct)) {
    if (r.range63dPct <= 55) s += 6;
    else if (r.range63dPct <= 85) s += 3;
  }
  if (gt(r.perf3m, 0)) s += 10;
  return clamp(s);
}
export function scoreVolumeEffect(r) {
  let s = 0;
  if (gte(r.latestTurnover, 25000000)) s += 24;
  else if (gte(r.latestTurnover, 10000000)) s += 18;
  else if (gte(r.latestTurnover, 3000000)) s += 10;
  else if (gte(r.latestTurnover, 1000000)) s += 5;
  if (gte(r.latestVolume, 2000000)) s += 15;
  else if (gte(r.latestVolume, 500000)) s += 11;
  else if (gte(r.latestVolume, 150000)) s += 6;
  if (gte(r.relativeVolume, 2.2)) s += 22;
  else if (gte(r.relativeVolume, 1.6)) s += 16;
  else if (gte(r.relativeVolume, 1.2)) s += 9;
  else if (gte(r.relativeVolume, 1)) s += 4;
  if (gte(r.volumeSurgePct, 80)) s += 17;
  else if (gte(r.volumeSurgePct, 35)) s += 12;
  else if (gte(r.volumeSurgePct, 15)) s += 6;
  if (gte(r.upDownVolRatio, 1.8)) s += 16;
  else if (gte(r.upDownVolRatio, 1.25)) s += 11;
  else if (gte(r.upDownVolRatio, 1)) s += 5;
  if (r.upVolume === true && gte(r.relativeVolume, 1.1)) s += 6;
  return clamp(s);
}
export function scoreVolume(r) {
  let s = 0;
  if (gte(r.avgTurnover, 25000000)) s += 22;
  else if (gte(r.avgTurnover, 10000000)) s += 16;
  else if (gte(r.avgTurnover, 3000000)) s += 9;
  if (gte(r.avgVolume, 1000000)) s += 22;
  else if (gte(r.avgVolume, 300000)) s += 15;
  else if (gte(r.avgVolume, 100000)) s += 8;
  if (gte(r.upDownVolRatio, 1.5)) s += 20;
  else if (gte(r.upDownVolRatio, 1.1)) s += 14;
  else if (gte(r.upDownVolRatio, .9)) s += 7;
  if (gte(r.relativeVolume, 1.8)) s += 14;
  else if (gte(r.relativeVolume, 1.3)) s += 9;
  else if (gte(r.relativeVolume, 1.05)) s += 4;
  if (gte(r.volumeSurgePct, 50)) s += 12;
  else if (gte(r.volumeSurgePct, 25)) s += 8;
  else if (gte(r.volumeSurgePct, 10)) s += 4;
  s += (r.volumeEffectScore || 0) * .1;
  return clamp(s);
}
export function scoreLiquidity(r) {
  let s = 0;
  if (gte(r.marketCap, 1000000000)) s += 35;
  else if (gte(r.marketCap, 300000000)) s += 24;
  else if (gte(r.marketCap, 150000000)) s += 12;
  if (gte(r.avgTurnover, 25000000)) s += 30;
  else if (gte(r.avgTurnover, 10000000)) s += 22;
  else if (gte(r.avgTurnover, 3000000)) s += 12;
  if (gte(r.avgVolume, 1000000)) s += 22;
  else if (gte(r.avgVolume, 300000)) s += 15;
  else if (gte(r.avgVolume, 100000)) s += 7;
  if (gte(r.price, 5)) s += 13;
  else if (gte(r.price, 3)) s += 7;
  return clamp(s);
}
// scoreIpo depende de ipoAgeMonthsForRow; el snapshot incluye un shim minimalista
// para que pueda invocarse en aislamiento.
function _ipoAgeMonthsForRowShim(row = {}) {
  const direct = firstFinite(row?.ipoAgeMonths, row?.snapshot?.ipoAgeMonths);
  if (Number.isFinite(direct)) return direct;
  const d = row?.ipoDate || row?.snapshot?.ipoDate || "";
  if (!d) return null;
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return null;
  const n = new Date();
  return (n.getFullYear() - x.getFullYear()) * 12 + n.getMonth() - x.getMonth();
}
export function scoreIpo(r) {
  const m = _ipoAgeMonthsForRowShim(r);
  if (!Number.isFinite(m) || m < 0 || m > 60) return 0;
  const age = m < 6 ? 25 : m < 18 ? 30 : m < 36 ? 24 : 16;
  const high = gte(r.distanceATH, -15) || gte(r.distance52w, -15) ? 25 : gte(r.distance52w, -25) ? 15 : 5;
  const liq = gte(r.avgVolume, 1000000) ? 15 : gte(r.avgVolume, 300000) ? 8 : 0;
  const st = gt(r.price, r.sma50) && gt(r.perf3m, 10) ? 20 : 8;
  return clamp(age + high + liq + st + (r.sectorScore ? r.sectorScore * .15 : 5));
}
export function scoreObjectiveSetupQuality(r) {
  let s = 0;
  if (isConfirmedStage2(r)) s += 28;
  else if (gt(r.price, r.sma200) && gte(r.sma200Slope, 0)) s += 18;
  else if (gt(r.price, r.sma200)) s += 10;
  if (gt(r.price, r.sma50)) s += 10;
  if (gt(r.sma50, r.sma150)) s += 8;
  if (gte(r.distance52w, -5)) s += 16;
  else if (gte(r.distance52w, -15)) s += 11;
  else if (gte(r.distance52w, -25)) s += 6;
  if (gte(r.distance20d, -5)) s += 10;
  else if (gte(r.distance20d, -10)) s += 6;
  if (Number.isFinite(r.extSma50)) {
    if (r.extSma50 >= -4 && r.extSma50 <= 9) s += 16;
    else if (r.extSma50 <= 18) s += 11;
    else if (r.extSma50 <= 28) s += 4;
  }
  if (lte(r.highsSpreadPct, 8)) s += 7;
  else if (lte(r.highsSpreadPct, 15)) s += 4;
  return clamp(s);
}
export function scorePatternContribution(r) {
  // Override endurecido: solo un número FINITO es un override válido. Esto
  // respeta `0` y rechaza null/undefined/NaN/Infinity/strings/booleans, cayendo
  // al fallback metodológico en cualquier otro caso. Debe coincidir con
  // lib/scoringEngine.js#resolvePatternContribution (paridad engine↔golden).
  return Number.isFinite(r.patternContribution)
    ? r.patternContribution
    : methodologyPatternEvidenceBonus(r);
}
export function scorePatternQuality(r) {
  const contribution = scorePatternContribution(r);
  if (!contribution) return 0;
  const q = firstFinite(r.patternQualityScore, r.baseQualityScore, r.contractionScore);
  return Number.isFinite(q) ? clamp(q) : clamp(contribution * 4);
}
export function scoreSetupQuality(r) {
  // El motor acepta override de objectiveSetupScore en la fila (compute lo respeta
  // si viene pre-calculado). Para que el snapshot reproduzca el mismo camino en los
  // tests, replicamos esa semántica aquí.
  let s = Number.isFinite(r.objectiveSetupScore)
    ? r.objectiveSetupScore
    : scoreObjectiveSetupQuality(r);
  s += scorePatternContribution(r);
  if (r.failedBreakout) s -= 12;
  return clamp(s);
}
export function scoreCompositeValue({
  setupQualityScore,
  rsAnchor,
  rsQualityScore,
  demandScore,
  adProxyScore,
  growthScore,
  epsAnchor,
  sectorScore,
  riskRewardScore,
  riskScore,
  momentumScore,
  ipoScore = 0,
} = {}) {
  return setupQualityScore * .17 + rsAnchor * .16 + rsQualityScore * .06 + demandScore * .1 + adProxyScore * .08 + growthScore * .08 + epsAnchor * .08 + sectorScore * .1 + riskRewardScore * .08 + riskScore * .05 + momentumScore * .02 + ipoScore * .02;
}
export function scoreDemandQuality(r) {
  let s = 0;
  const rs = firstFinite(r.rsGlobalPct, r.rsRating) ?? 50;
  if (rs >= 90) s += 34;
  else if (rs >= 80) s += 29;
  else if (rs >= 70) s += 22;
  else if (rs >= 55) s += 13;
  s += (r.volumeScore || 0) * .28;
  s += (r.volumeEffectScore || 0) * .12;
  s += (r.liquidityScore || 0) * .14;
  if (gte(r.upDownVolRatio, 1.8)) s += 18;
  else if (gte(r.upDownVolRatio, 1.3)) s += 13;
  else if (gte(r.upDownVolRatio, 1)) s += 7;
  if (gte(r.relativeVolume, 1.5)) s += 8;
  else if (gte(r.relativeVolume, 1.2)) s += 5;
  if (gte(r.volumeSurgePct, 35)) s += 6;
  else if (gte(r.volumeSurgePct, 15)) s += 3;
  if (gte(r.avgVolume, 1000000)) s += 6;
  else if (gte(r.avgVolume, 300000)) s += 3;
  return clamp(s);
}
export function scoreGrowthQuality(metrics = {}) {
  const values = ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "roe", "roa", "debtToEquity", "currentRatio"].map((k) => metrics[k]);
  if (!values.some(Number.isFinite)) return 45;
  let s = 28;
  const revenue = metrics.revenueGrowth;
  const earnings = metrics.earningsGrowth;
  const gross = metrics.grossMargin;
  const operating = metrics.operatingMargin;
  const profit = metrics.profitMargin;
  const roe = metrics.roe;
  const roa = metrics.roa;
  const debt = metrics.debtToEquity;
  const current = metrics.currentRatio;
  if (gte(revenue, 30)) s += 19; else if (gte(revenue, 15)) s += 15; else if (gte(revenue, 5)) s += 9; else if (gte(revenue, 0)) s += 4; else if (Number.isFinite(revenue)) s -= 6;
  if (gte(earnings, 35)) s += 19; else if (gte(earnings, 15)) s += 14; else if (gte(earnings, 0)) s += 7; else if (Number.isFinite(earnings)) s -= 8;
  if (gte(gross, 55)) s += 10; else if (gte(gross, 35)) s += 6; else if (lt(gross, 20)) s -= 4;
  if (gte(operating, 25)) s += 9; else if (gte(operating, 12)) s += 6; else if (lt(operating, 0)) s -= 5;
  if (gte(profit, 20)) s += 8; else if (gte(profit, 8)) s += 5; else if (lt(profit, 0)) s -= 7;
  if (gte(roe, 25)) s += 8; else if (gte(roe, 12)) s += 5;
  if (gte(roa, 10)) s += 5; else if (gte(roa, 5)) s += 3;
  if (Number.isFinite(debt)) {
    if (debt <= 60) s += 5;
    else if (debt > 180) s -= 6;
  }
  if (Number.isFinite(current)) {
    if (current >= 1.4) s += 4;
    else if (current < .9) s -= 4;
  }
  return clamp(s);
}
export function scoreEpsGrowthProxy(metrics = {}) {
  const revenue = metrics.revenueGrowth;
  const earnings = metrics.earningsGrowth;
  const operating = metrics.operatingMargin;
  const profit = metrics.profitMargin;
  const roe = metrics.roe;
  const roa = metrics.roa;
  const debt = metrics.debtToEquity;
  const current = metrics.currentRatio;
  if (![revenue, earnings, operating, profit, roe, roa].some(Number.isFinite)) return null;
  let s = 35;
  if (gte(earnings, 50)) s += 24; else if (gte(earnings, 25)) s += 18; else if (gte(earnings, 10)) s += 11; else if (gte(earnings, 0)) s += 5; else if (Number.isFinite(earnings)) s -= 12;
  if (gte(revenue, 30)) s += 18; else if (gte(revenue, 15)) s += 13; else if (gte(revenue, 5)) s += 7; else if (gte(revenue, 0)) s += 3; else if (Number.isFinite(revenue)) s -= 8;
  if (gte(operating, 25)) s += 10; else if (gte(operating, 12)) s += 6; else if (lt(operating, 0)) s -= 7;
  if (gte(profit, 18)) s += 8; else if (gte(profit, 8)) s += 5; else if (lt(profit, 0)) s -= 8;
  if (gte(roe, 22)) s += 8; else if (gte(roe, 12)) s += 5;
  if (gte(roa, 10)) s += 5; else if (gte(roa, 5)) s += 3;
  if (Number.isFinite(debt)) {
    if (debt <= 60) s += 4;
    else if (debt > 180) s -= 5;
  }
  if (Number.isFinite(current) && current < .9) s -= 4;
  return Math.round(clamp(s));
}
export function scoreAdProxy(r = {}) {
  let s = 45;
  if (gte(r.upDownVolRatio, 2)) s += 20;
  else if (gte(r.upDownVolRatio, 1.5)) s += 15;
  else if (gte(r.upDownVolRatio, 1.15)) s += 9;
  else if (Number.isFinite(r.upDownVolRatio) && r.upDownVolRatio < .75) s -= 15;
  else if (Number.isFinite(r.upDownVolRatio) && r.upDownVolRatio < .95) s -= 8;
  if (r.upVolume === true && gte(r.relativeVolume, 1.1)) s += 10;
  if (r.upVolume === false && gte(r.relativeVolume, 1.2)) s -= 10;
  if (gte(r.volumeSurgePct, 50) && gte(r.perf3m, 0)) s += 10;
  else if (gte(r.volumeSurgePct, 20) && gte(r.perf3m, 0)) s += 6;
  if (gte(r.relativeVolume, 1.5) && gte(r.distance20d, -8)) s += 8;
  if (gte(r.distance52w, -15)) s += 7;
  else if (Number.isFinite(r.distance52w) && r.distance52w < -35) s -= 7;
  if (gt(r.price, r.sma50)) s += 5;
  else if (Number.isFinite(r.price) && Number.isFinite(r.sma50)) s -= 5;
  if (gt(r.maxDrawdown63d, 32)) s -= 6;
  return Math.round(clamp(s));
}
export function compositeLabel(score) {
  if (score >= 85) return "Elite";
  if (score >= 75) return "Leader";
  if (score >= 65) return "Fuerte";
  if (score >= 55) return "Watchlist";
  return "Revisar";
}