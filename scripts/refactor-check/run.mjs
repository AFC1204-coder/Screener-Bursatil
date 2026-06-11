// Snapshot de indicadores + scores para 20 símbolos reales.
// Uso: node --import ./scripts/refactor-check/register.mjs scripts/refactor-check/run.mjs before|after
// Replica el núcleo numérico de buildResearchRow (app/page.jsx) usando solo las
// funciones del módulo bajo prueba, para que before/after sean comparables 1:1.
import { readFileSync, writeFileSync } from "node:fs";

const which = process.argv[2];
if (!["before", "after"].includes(which)) throw new Error("Uso: run.mjs before|after");
const M = await import(which === "before" ? "./before.mjs" : "./after.mjs");
const fixture = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));

// Valores deterministas (hash del símbolo) para campos que el scan obtiene de
// otras fases (RS, sector, etc.). Idénticos en ambas pasadas.
function pseudo(symbol, salt, min = 0, max = 100) {
  let h = 2166136261;
  for (const ch of `${symbol}:${salt}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return min + (h % 1000) / 1000 * (max - min);
}

const snapshot = {};
for (const { symbol, bars: b, profile } of fixture) {
  const price = M.firstFinite(b[0]?.close);
  const calcBars = b.map((bar, index) => {
    if (index !== 0) return bar;
    const high = M.firstFinite(bar.high, bar.close, price);
    const low = M.firstFinite(bar.low, bar.close, price);
    return { ...bar, close: price, high: Number.isFinite(high) ? Math.max(high, price) : price, low: Number.isFinite(low) ? Math.min(low, price) : price };
  });
  const s50 = M.sma(calcBars, 50), s150 = M.sma(calcBars, 150), s200 = M.sma(calcBars, 200), s200p = M.sma(calcBars, 200, 30);
  const h20 = M.highValue(calcBars, 20), h65 = M.highValue(calcBars, 65);
  const avgVol20 = M.avgVolume(b.slice(0, 20));
  const avgVol5 = M.avgVolume(b.slice(0, 5));
  const prevVol20 = M.avgVolume(b.slice(5, 25));
  const latestVolume = M.firstFinite(b[0]?.volume);
  const perf3m = M.perf(calcBars, 63), perf6m = M.perf(calcBars, 126), perf12m = M.perf(calcBars, 252);
  const riskAdjusted = M.riskAdjustedStats(calcBars, perf3m);

  const row = {
    symbol,
    price,
    marketCap: M.firstFinite(profile.marketCap),
    ipoDate: profile.ipoDate || "",
    ipoAgeMonths: M.monthsSince(profile.ipoDate || ""),
    growthMetrics: profile.growthMetrics || {},
    avgVolume: avgVol20,
    avgVolume5: avgVol5,
    prevAvgVolume20: prevVol20,
    latestVolume,
    avgTurnover: Number.isFinite(avgVol20) && Number.isFinite(price) ? avgVol20 * price : null,
    latestTurnover: Number.isFinite(latestVolume) && Number.isFinite(price) ? latestVolume * price : null,
    relativeVolume: Number.isFinite(avgVol20) && avgVol20 > 0 && Number.isFinite(latestVolume) ? latestVolume / avgVol20 : null,
    volumeSurgePct: Number.isFinite(prevVol20) && prevVol20 > 0 && Number.isFinite(avgVol5) ? ((avgVol5 / prevVol20) - 1) * 100 : null,
    upVolume: calcBars[1] ? calcBars[0].close >= calcBars[1].close : null,
    sma50: s50,
    sma150: s150,
    sma200: s200,
    sma200Slope: s200 && s200p ? ((s200 / s200p) - 1) * 100 : null,
    distance20d: M.highDist(calcBars, 20),
    distance50d: M.highDist(calcBars, 50),
    distance52w: M.highDist(calcBars, 252),
    distanceATH: M.highDist(calcBars, calcBars.length),
    highsSpreadPct: h20 && h65 ? Math.abs((h20 / h65) - 1) * 100 : null,
    lowAdvance52w: M.lowAdv(calcBars, 252),
    perf3m,
    perf6m,
    perf12m,
    ...riskAdjusted,
    extSma50: s50 ? ((price / s50) - 1) * 100 : null,
    upDownVolRatio: M.udVol(calcBars, 50),
    // Campos de otras fases del scan, deterministas por símbolo:
    rsGlobalPct: pseudo(symbol, "rsGlobal"),
    rsRating: pseudo(symbol, "rsRating"),
    rsCountryPct: pseudo(symbol, "rsCountry"),
    rsSectorPct: pseudo(symbol, "rsSector"),
    rsQualityScore: pseudo(symbol, "rsQuality"),
    sectorScore: pseudo(symbol, "sector"),
    speculationRiskScore: pseudo(symbol, "spec"),
    growthScore: pseudo(symbol, "growth"),
    demandScore: pseudo(symbol, "demand"),
  };

  row.weinsteinScore = M.scoreWeinstein(row);
  row.minerviniScore = M.scoreMinervini(row);
  row.momentumScore = M.scoreMomentum(row);
  row.riskScore = M.scoreRisk(row);
  row.riskRewardScore = M.scoreRiskReward(row);
  row.volumeEffectScore = M.scoreVolumeEffect(row);
  row.volumeEvidence = M.volumeEvidence(row);
  row.adProxyScore = M.scoreAdProxy(row);
  row.epsGrowthProxyScore = M.scoreEpsGrowthProxy(row.growthMetrics);
  row.volumeScore = M.scoreVolume(row);
  row.liquidityScore = M.scoreLiq(row);
  row.setupQualityScore = M.scoreSetupQuality(row);
  row.demandQualityScore = M.scoreDemandQuality(row);
  row.growthQualityScore = M.scoreGrowthQuality(row.growthMetrics);
  row.ipoScore = M.scoreIpo(row);
  const weakness = M.scoreWeakness(row);
  const totalScore = M.clamp((row.weinsteinScore + row.minerviniScore + row.momentumScore + row.riskScore) / 4);

  snapshot[symbol] = {
    indicators: {
      sma50: s50, sma150: s150, sma200: s200, sma200Offset30: s200p,
      perf3m, perf6m, perf12m,
      hiLo252: M.hiLo(calcBars, 252),
      highDist20: row.distance20d, highDist50: row.distance50d, highDist252: row.distance52w,
      lowAdv252: row.lowAdvance52w,
      stdevReturns63: M.stdev(M.dailyReturns(calcBars, 63)),
      dailyReturns5: M.dailyReturns(calcBars, 5),
      annualizedVolatility: M.annualizedVolatility(calcBars),
      downsideVolatility: M.downsideVolatility(calcBars),
      maxDrawdown: M.maxDrawdown(calcBars),
      maxDailyMovePct: M.maxDailyMovePct(calcBars),
      maxDailyRangePct: M.maxDailyRangePct(calcBars),
      avgDailyRangePct: M.avgDailyRangePct(calcBars),
      priceRangePct: M.priceRangePct(calcBars),
      riskAdjusted,
      udVol: row.upDownVolRatio,
      avgVolume20: avgVol20,
      finiteNumberSamples: [M.finiteNumber("3.5"), M.finiteNumber(""), M.finiteNumber(null), M.finiteNumber(7)],
      avgWithCoverage: M.avgWithCoverage(b.slice(0, 20).map((bar) => bar.volume)),
    },
    scores: {
      weinstein: row.weinsteinScore,
      minervini: row.minerviniScore,
      momentum: row.momentumScore,
      risk: row.riskScore,
      riskReward: row.riskRewardScore,
      volumeEffect: row.volumeEffectScore,
      volumeEvidence: row.volumeEvidence,
      adProxy: row.adProxyScore,
      epsGrowthProxy: row.epsGrowthProxyScore,
      volume: row.volumeScore,
      liquidity: row.liquidityScore,
      setupQuality: row.setupQualityScore,
      demandQuality: row.demandQualityScore,
      growthQuality: row.growthQualityScore,
      ipo: row.ipoScore,
      ipoAgeMonths: M.ipoAgeMonthsForRow(row),
      weakness,
      rsPrimaryScore: M.rsPrimaryScore(row),
      isStage2: M.isStage2(row),
      objectiveStage: M.objectiveStage(row),
      compositeLabel: M.compositeLabel(totalScore),
      compositeNarrative: M.compositeNarrative(row),
      totalScore,
      comparators: [M.gt(1, 0), M.gte(null, 0), M.lt(-1, 0), M.lte(0, 0), M.between(5, 0, 10), M.between(NaN, 0, 10)],
      regime: [85, 60, 45, 30].map((marketScore) => M.regimeRejectReason({ ...row, totalScore }, { marketScore }, true, {})),
      regimeFilteredCount: [85, 60, 45, 30].map((marketScore) => M.regimeFiltered([{ ...row, totalScore }], { marketScore }, true, {}).length),
      rejectReasonSample: M.rejectReason("liquidity", "test", "minPrice"),
    },
  };
}

const outFile = new URL(`../../output/refactor-${which}.json`, import.meta.url);
writeFileSync(outFile, JSON.stringify(snapshot, null, 2));
console.log(`Snapshot ${which}: ${Object.keys(snapshot).length} símbolos -> output/refactor-${which}.json`);
