// lib/scoring.js — scoring Weinstein/Minervini, riesgo, volumen, composite y régimen,
// extraído verbatim de app/page.jsx (y objectiveStage de app/review/page.jsx).
import { clamp, firstFinite } from "@/lib/indicators";
import { metricShortLabel } from "@/lib/metricCatalog";
import { methodologyPatternEvidenceBonus } from "@/lib/methodologyDisplay";
import { rsPrimaryValue, rsUniverseValue, rsBenchmarkValue } from "@/lib/relativeStrength";
import { isConfirmedStage2 } from "@/lib/trendStructure";

function monthsSince(d) { if (!d) return null; const x = new Date(d); if (Number.isNaN(x.getTime())) return null; const n = new Date(); return (n.getFullYear() - x.getFullYear()) * 12 + n.getMonth() - x.getMonth(); }
function ipoAgeMonthsForRow(row = {}) {
  const direct = firstFinite(row.ipoAgeMonths, row.snapshot?.ipoAgeMonths);
  return Number.isFinite(direct) ? direct : monthsSince(row.ipoDate || row.snapshot?.ipoDate || "");
}
function rsPrimaryScore(row = {}) {
  return rsPrimaryValue(row);
}
function gt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value > threshold; }
function gte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value >= threshold; }
function lt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value < threshold; }
function lte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value <= threshold; }
function between(value, min, max) { return gte(value, min) && lte(value, max); }
function scoreWeinstein(r) { let s = 0; if (gt(r.price, r.sma150)) s += 18; if (gt(r.sma150, r.sma200)) s += 18; if (gt(r.sma200Slope, 0)) s += 18; if (gt(r.price, r.sma50)) s += 14; if (gt(r.sma50, r.sma150)) s += 14; if (gte(r.distance52w, -25)) s += 10; if (gt(r.perf6m, 0)) s += 8; return clamp(s); }
function scoreMinervini(r) { let s = 0; if (gt(r.price, r.sma150) && gt(r.price, r.sma200)) s += 14; if (gt(r.sma150, r.sma200)) s += 12; if (gt(r.sma200Slope, 0)) s += 12; if (gt(r.sma50, r.sma150) && gt(r.sma50, r.sma200)) s += 12; if (gt(r.price, r.sma50)) s += 10; if (gte(r.lowAdvance52w, 30)) s += 12; if (gte(r.distance52w, -25)) s += 8; if (gte(r.distance20d, -10)) s += 8; if (lte(r.highsSpreadPct, 12)) s += 6; if (gt(r.perf3m, 10)) s += 6; return clamp(s); }
function scoreMomentum(r) { let s = 0; if (gte(r.perf3m, 20)) s += 35; else if (gte(r.perf3m, 10)) s += 25; else if (gte(r.perf3m, 0)) s += 12; if (gte(r.perf6m, 40)) s += 35; else if (gte(r.perf6m, 20)) s += 25; else if (gte(r.perf6m, 5)) s += 12; if (gte(r.perf12m, 80)) s += 30; else if (gte(r.perf12m, 40)) s += 22; else if (gte(r.perf12m, 15)) s += 12; return clamp(s); }
function scoreRisk(r) { const e = r.extSma50; let s = 0; if (between(e, -3, 8)) s += 38; else if (between(e, -8, 15)) s += 30; else if (lte(e, 25)) s += 18; else if (lte(e, 35)) s += 8; if (gte(r.distance20d, -5)) s += 22; else if (gte(r.distance20d, -10)) s += 14; if (gte(r.distance50d, -10)) s += 18; else if (gte(r.distance50d, -18)) s += 10; if (gt(r.price, r.sma50)) s += 22; return clamp(s); }
function scoreRiskReward(r) {
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
function scoreWeakness(r = {}) {
  let s = 0;
  const reasons = [];
  const rs = rsPrimaryScore(r) ?? 50;
  if (rs < 30) { s += 18; reasons.push("RS muy bajo"); }
  else if (rs < 45) { s += 13; reasons.push("RS bajo"); }
  else if (rs < 55) s += 6;
  if (Number.isFinite(r.price) && Number.isFinite(r.sma50) && r.price < r.sma50) { s += 12; reasons.push("bajo SMA50"); }
  if (Number.isFinite(r.price) && Number.isFinite(r.sma200) && r.price < r.sma200) { s += 18; reasons.push("bajo SMA200"); }
  if (Number.isFinite(r.sma200Slope) && r.sma200Slope < 0) { s += 12; reasons.push("SMA200 cae"); }
  if (Number.isFinite(r.sma50) && Number.isFinite(r.sma200) && r.sma50 < r.sma200) s += 7;
  if (Number.isFinite(r.perf3m) && r.perf3m < 0) { s += 8; reasons.push("3M negativo"); }
  if (Number.isFinite(r.perf6m) && r.perf6m < 0) s += 8;
  if (Number.isFinite(r.perf12m) && r.perf12m < 0) s += 8;
  if (Number.isFinite(r.distance52w)) {
    if (r.distance52w < -45) { s += 12; reasons.push("muy lejos de máximos"); }
    else if (r.distance52w < -30) { s += 8; reasons.push("lejos de máximos"); }
    else if (r.distance52w < -20) s += 4;
  }
  if (Number.isFinite(r.distance20d) && r.distance20d < -12) s += 5;
  if (Number.isFinite(r.maxDrawdown63d)) {
    if (r.maxDrawdown63d > 40) { s += 10; reasons.push("drawdown alto"); }
    else if (r.maxDrawdown63d > 28) s += 7;
  }
  if (Number.isFinite(r.upDownVolRatio)) {
    if (r.upDownVolRatio < .7) { s += 9; reasons.push("volumen vendedor"); }
    else if (r.upDownVolRatio < .9) s += 5;
  }
  if (r.upVolume === false && Number.isFinite(r.relativeVolume) && r.relativeVolume >= 1.15) { s += 7; reasons.push("caída con volumen"); }
  if (Number.isFinite(r.riskScore) && r.riskScore < 35) s += 7;
  if (Number.isFinite(r.extSma50) && r.extSma50 < -12) s += 5;
  if (Number.isFinite(r.speculationRiskScore) && r.speculationRiskScore >= 70) s += 4;
  const weaknessScore = clamp(s);
  return {
    weaknessScore,
    weaknessLabel: weaknessScore >= 78 ? "Deterioro severo" : weaknessScore >= 65 ? "Deterioro alto" : weaknessScore >= 50 ? "Deterioro visible" : weaknessScore >= 35 ? "Debilidad mixta" : "Sin deterioro claro",
    weaknessReasons: reasons.length ? reasons.slice(0, 4) : ["Sin evidencia fuerte"],
  };
}
function scoreVolumeEffect(r) {
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
function volumeEvidence(r = {}) {
  const parts = [];
  if (gte(r.latestTurnover, 10000000)) parts.push("importe sesion >=10M");
  else if (gte(r.latestTurnover, 3000000)) parts.push("importe sesion >=3M");
  if (gte(r.relativeVolume, 1.6)) parts.push("relVol >=1.6x");
  else if (gte(r.relativeVolume, 1.2)) parts.push("relVol >=1.2x");
  if (gte(r.volumeSurgePct, 35)) parts.push("5d +35%");
  else if (gte(r.volumeSurgePct, 15)) parts.push("5d +15%");
  if (gte(r.upDownVolRatio, 1.25)) parts.push("up/down >=1.25x");
  return parts.length ? parts.slice(0, 4).join(" · ") : "sin efecto objetivo";
}
function scoreVolume(r) {
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
function scoreLiq(r) {
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
function scoreIpo(r) {
  const m = ipoAgeMonthsForRow(r);
  if (!Number.isFinite(m) || m < 0 || m > 60) return 0;
  const age = m < 6 ? 25 : m < 18 ? 30 : m < 36 ? 24 : 16;
  const high = gte(r.distanceATH, -15) || gte(r.distance52w, -15) ? 25 : gte(r.distance52w, -25) ? 15 : 5;
  const liq = gte(r.avgVolume, 1000000) ? 15 : gte(r.avgVolume, 300000) ? 8 : 0;
  const st = gt(r.price, r.sma50) && gt(r.perf3m, 10) ? 20 : 8;
  return clamp(age + high + liq + st + (r.sectorScore ? r.sectorScore * .15 : 5));
}
function scoreObjectiveSetupQuality(r) {
  let s = 0;
  if (isStage2(r)) s += 28;
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
function scorePatternContribution(r) {
  return methodologyPatternEvidenceBonus(r);
}
function scorePatternQuality(r) {
  const contribution = scorePatternContribution(r);
  if (!contribution) return 0;
  const quality = firstFinite(r.patternQualityScore, r.baseQualityScore, r.contractionScore);
  return Number.isFinite(quality) ? clamp(quality) : clamp(contribution * 4);
}
function scoreSetupQuality(r) {
  let s = scoreObjectiveSetupQuality(r);
  s += scorePatternContribution(r);
  if (r.failedBreakout) s -= 12;
  return clamp(s);
}
function scoreCompositeValue({
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
function scoreDemandQuality(r) {
  let s = 0;
  const rs = rsPrimaryValue(r) ?? 50;
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
function scoreGrowthQuality(metrics = {}) {
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
function scoreEpsGrowthProxy(metrics = {}) {
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
function scoreAdProxy(r = {}) {
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
function compositeLabel(score) {
  if (score >= 85) return "Elite";
  if (score >= 75) return "Leader";
  if (score >= 65) return "Fuerte";
  if (score >= 55) return "Watchlist";
  return "Revisar";
}
function compositeNarrative(r) {
  const reasons = [];
  const risks = [];
  const rsUniverse = rsUniverseValue(r);
  const rsBenchmark = rsBenchmarkValue(r);
  const rsPrimary = Number.isFinite(rsUniverse) ? rsUniverse : (rsBenchmark ?? 0);
  if (isStage2(r)) reasons.push("Stage 2 confirmado");
  if (Number.isFinite(rsUniverse) && rsUniverse >= 85) reasons.push("RS líder");
  else if (Number.isFinite(rsUniverse) && rsUniverse >= 80) reasons.push("RS alto");
  else if (Number.isFinite(rsUniverse) && rsUniverse >= 65) reasons.push("RS positivo");
  else if (!Number.isFinite(rsUniverse) && Number.isFinite(rsBenchmark) && rsBenchmark >= 75) reasons.push("RS Benchmark fuerte sin RS");
  if ((r.rsQualityScore || 0) >= 72) reasons.push("RS calidad alta");
  if ((r.rsCountryPct || 0) >= 80) reasons.push("RS país fuerte");
  if ((r.rsSectorPct || 0) >= 80) reasons.push("RS Grupo fuerte");
  if ((r.sectorScore || 0) >= 70) reasons.push("Grupo fuerte");
  if ((r.growthScore || 0) >= 70) reasons.push("Crecimiento/calidad superior");
  if ((r.riskRewardScore || 0) >= 70) reasons.push("Rentabilidad/riesgo eficiente");
  if (gte(r.distance52w, -10)) reasons.push("Cerca de máximos");
  if ((r.demandScore || 0) >= 70) reasons.push("Demanda y liquidez sanas");
  if (gt(r.extSma50, 22)) risks.push("Extendida sobre SMA50");
  if ((r.riskScore || 0) < 45) risks.push("Riesgo técnico alto");
  if (rsPrimary < 40) risks.push(Number.isFinite(rsUniverse) ? "RS débil" : "RS Benchmark débil sin RS");
  if ((r.speculationRiskScore || 0) >= 70) risks.push("Volatilidad especulativa");
  else if ((r.speculationRiskScore || 0) >= 55) risks.push("RS volátil");
  if (gt(r.maxDrawdown63d, 30)) risks.push("Drawdown reciente elevado");
  if (gt(r.volatility63d, 70)) risks.push("Volatilidad elevada");
  if ((r.volumeScore || 0) < 35) risks.push("Volumen limitado");
  if ((r.growthScore || 0) < 45) risks.push("Fundamentales insuficientes/débiles");
  if (lt(r.distance52w, -25)) risks.push("Lejos de máximos");
  if (!reasons.length) reasons.push("Candidato exploratorio");
  if (!risks.length) risks.push("Sin alerta principal");
  return { reasons: reasons.slice(0, 4), risks: risks.slice(0, 3) };
}
function regimeRejectReason(row, marketHealth, enabled, set = {}) {
  if (set.setupMode === "weakness" || !enabled || !marketHealth?.marketScore) return null;
  const s = marketHealth.marketScore;
  const objectiveScore = firstFinite(row.objectiveScore, row.totalScore, row.compositeScore) ?? 0;
  if (s >= 75) return null;
  if (s >= 55) return objectiveScore >= 60 && row.riskScore >= 45 && row.weinsteinScore >= 55 ? null : rejectReason("regime", "Régimen exige calidad objetiva >= 60, risk >= 45 y Weinstein >= 55");
  if (s >= 40) return objectiveScore >= 72 && row.riskScore >= 55 && row.weinsteinScore >= 65 && row.minerviniScore >= 55 ? null : rejectReason("regime", "Régimen exige calidad objetiva >= 72, risk >= 55, Weinstein >= 65 y Minervini >= 55");
  return objectiveScore >= 82 && row.riskScore >= 65 && row.weinsteinScore >= 75 && row.minerviniScore >= 65 ? null : rejectReason("regime", "Régimen exige calidad objetiva >= 82, risk >= 65, Weinstein >= 75 y Minervini >= 65");
}
function regimeFiltered(list, marketHealth, enabled, set = {}) { return list.filter((r) => !regimeRejectReason(r, marketHealth, enabled, set)); }
function isStage2(row) {
  return isConfirmedStage2(row);
}
const REJECTION_META = {
  provider: { label: "Datos proveedor", stage: "Datos" },
  liquidity: { label: "Liquidez", stage: "Puerta" },
  coverage: { label: "Cobertura", stage: "Puerta" },
  relativeStrength: { label: "Fuerza relativa", stage: "Score" },
  volumeSurge: { label: "Volumen objetivo", stage: "Opcional" },
  shortInterest: { label: metricShortLabel("shortPercentOfFloat"), stage: "Opcional" },
  riskReward: { label: "Rentabilidad/riesgo", stage: "Opcional" },
  volatility: { label: "Volatilidad/rango", stage: "Puerta" },
  pattern: { label: "Estructura", stage: "Patrones" },
  trend: { label: "Tendencia", stage: "Puerta" },
  proximity: { label: "Cercanía a máximos", stage: "Puerta" },
  momentum: { label: "Momentum", stage: "Puerta" },
  score: { label: "Calidad minima", stage: "Score" },
  ipo: { label: "IPO real", stage: "Opcional" },
  mode: { label: "Setup", stage: "Modo" },
  weakness: { label: "Deterioro", stage: "Modo" },
  regime: { label: "Regimen de mercado", stage: "Contexto" },
  post: { label: "Post filtro", stage: "Score" },
};

function rejectReason(key, detail, field = "") {
  const meta = REJECTION_META[key] || { label: key || "Filtro", stage: "Filtro" };
  return { key, label: meta.label, stage: meta.stage, detail, field };
}
function value(row = {}, key) {
  return row[key] ?? row.snapshot?.[key] ?? null;
}
function objectiveStage(row = {}) {
  const price = value(row, "price");
  const sma50 = value(row, "sma50");
  const sma150 = value(row, "sma150");
  const sma200 = value(row, "sma200");
  const slope = value(row, "sma200Slope");
  if ([price, sma50, sma150, sma200].every(Number.isFinite) && price > sma50 && sma50 > sma150 && sma150 > sma200 && slope > 0) return "Precio > SMA50 > SMA150 > SMA200";
  if (Number.isFinite(price) && Number.isFinite(sma200) && price < sma200) return "Precio < SMA200";
  if (Number.isFinite(price) && Number.isFinite(sma50) && price < sma50) return "Precio < SMA50";
  if (Number.isFinite(price) && Number.isFinite(sma200) && price > sma200) return "Precio > SMA200";
  return "Historico insuficiente";
}

export {
  monthsSince,
  ipoAgeMonthsForRow,
  rsPrimaryScore,
  gt,
  gte,
  lt,
  lte,
  between,
  scoreWeinstein,
  scoreMinervini,
  scoreMomentum,
  scoreRisk,
  scoreRiskReward,
  scoreWeakness,
  scoreVolumeEffect,
  volumeEvidence,
  scoreVolume,
  scoreLiq,
  scoreIpo,
  scoreObjectiveSetupQuality,
  scorePatternContribution,
  scorePatternQuality,
  scoreSetupQuality,
  scoreCompositeValue,
  scoreDemandQuality,
  scoreGrowthQuality,
  scoreEpsGrowthProxy,
  scoreAdProxy,
  compositeLabel,
  compositeNarrative,
  regimeRejectReason,
  regimeFiltered,
  isStage2,
  REJECTION_META,
  rejectReason,
  objectiveStage,
};
