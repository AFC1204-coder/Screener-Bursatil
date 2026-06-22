// lib/researchRow.js — construcción de la fila de research (buildResearchRow) y helpers,
// extraído verbatim de app/page.jsx para compartirlo entre el cliente y /api/scan.
import { businessThemeKey } from "@/lib/businessTheme";
import { avg, avgVolume, firstFinite, highDist, highValue, lowAdv, perf, riskAdjustedStats, sma, udVol } from "@/lib/indicators";
import { benchmarkSymbolForRow, scoreRelativeStrength, scoreRsQuality } from "@/lib/relativeStrength";
import { buildObjectiveMetricAudit } from "@/lib/objectiveMetricTruth";
import { ipoAgeMonthsForRow, monthsSince, scoreAdProxy, scoreEpsGrowthProxy, scoreLiq, scoreMinervini, scoreMomentum, scoreRisk, scoreRiskReward, scoreVolume, scoreVolumeEffect, scoreWeakness, scoreWeinstein, volumeEvidence } from "@/lib/scoring";
import { DEFAULT_PRICE_FRESHNESS_DAYS } from "@/lib/screenerFilterCatalog";
import { setupPatternForBars } from "@/lib/setupPatterns";
import { countryCode } from "@/lib/symbols";
import { weeklyStageFields, weeklyStageForBars } from "@/lib/weeklyStage";

const BENCHMARK_SYMBOLS = ["SPY", "QQQ", "ACWI"];
function ipoCat(d) {
  const m = monthsSince(d);
  if (m === null || m < 0) return "Sin fecha IPO";
  if (m < 6) return "IPO reciente 0-6m";
  if (m < 18) return "IPO reciente 6-18m";
  if (m < 36) return "IPO reciente 18-36m";
  if (m <= 60) return "IPO reciente 3-5a";
  if (m < 120) return "Madura 5-10a";
  return "Madura +10a";
}
function ipoCatForRow(row = {}) {
  const m = ipoAgeMonthsForRow(row);
  if (m === null || m < 0) return ipoCat(row.ipoDate || row.snapshot?.ipoDate || "");
  if (m < 6) return "IPO reciente 0-6m";
  if (m < 18) return "IPO reciente 6-18m";
  if (m < 36) return "IPO reciente 18-36m";
  if (m <= 60) return "IPO reciente 3-5a";
  if (m < 120) return "Madura 5-10a";
  return "Madura +10a";
}
function normalizeWebsite(url = "") { if (!url) return ""; const value = /^https?:\/\//i.test(url) ? url : `https://${url}`; try { return new URL(value).toString(); } catch { return ""; } }
function domainFromUrl(url = "") { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
function theme(sector = "", industry = "", summary = "") { return businessThemeKey(sector, industry, summary); }
function compactBusinessSummary(value = "", maxLength = 360) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
  return `${clipped || text.slice(0, maxLength).trim()}...`;
}
function actividadEs(name, sector, industry, themeName, summary) { const map = { "Semis / fotonica": "semiconductores / computacion", "Defensa / aeroespacial": "defensa / aeroespacial", "Software / IA": "software / IA", "Energia / red": "energia / red", Automatizacion: "automatizacion industrial", "Medtech / biotech": "salud / biotech", "Consumo / marca": "consumo / marca" }; const focus = map[themeName] || themeName || sector || "General"; const s = summary ? summary.split(".").slice(0, 1).join(".") : ""; return [name, sector || "sin sector", industry || "sin industria", focus, s].filter(Boolean).join(" · "); }
function usefulValue(value) {
  if (Number.isFinite(value)) return value !== 0;
  return value !== undefined && value !== null && value !== "";
}

function coveragePct(values = []) {
  if (!values.length) return 0;
  return Math.round((values.filter(usefulValue).length / values.length) * 100);
}

function priceFreshnessForDate(lastDate = "", maxDays = DEFAULT_PRICE_FRESHNESS_DAYS) {
  const limit = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : DEFAULT_PRICE_FRESHNESS_DAYS;
  const timestamp = Date.parse(lastDate);
  if (!Number.isFinite(timestamp)) {
    return {
      priceFreshnessDays: null,
      priceFreshnessMaxDays: limit,
      priceFreshnessOk: false,
      priceFreshnessLabel: "sin fecha",
      priceFreshnessIssue: "precio sin fecha de cierre",
    };
  }
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  const ok = days <= limit;
  return {
    priceFreshnessDays: days,
    priceFreshnessMaxDays: limit,
    priceFreshnessOk: ok,
    priceFreshnessLabel: days <= 2 ? "fresco" : ok ? "util" : "viejo",
    priceFreshnessIssue: ok ? "" : `precio viejo: ${days}d > ${limit}d`,
  };
}
function dataCoverageForRow(row = {}, profile = {}) {
  const gm = profile.growthMetrics || row.growthMetrics || {};
  const freshness = row.priceFreshnessOk === undefined ? priceFreshnessForDate(row.lastDate) : {
    priceFreshnessDays: row.priceFreshnessDays ?? null,
    priceFreshnessMaxDays: row.priceFreshnessMaxDays ?? DEFAULT_PRICE_FRESHNESS_DAYS,
    priceFreshnessOk: row.priceFreshnessOk === true,
    priceFreshnessLabel: row.priceFreshnessLabel || (row.priceFreshnessOk ? "fresco" : "viejo"),
    priceFreshnessIssue: row.priceFreshnessIssue || "",
  };
  const technicalCoverageScore = coveragePct([
    freshness.priceFreshnessOk ? 100 : null,
    Number.isFinite(row.chartBarsCount) && row.chartBarsCount >= 180 ? row.chartBarsCount : null,
    row.price,
    row.sma50,
    row.sma150,
    row.sma200,
    row.sma200Slope,
    row.distance20d,
    row.distance50d,
    row.distance52w,
    row.distanceATH,
    row.highsSpreadPct,
    row.perf3m,
    row.perf6m,
    row.perf12m,
    row.extSma50,
    row.avgVolume,
    row.avgTurnover,
    row.latestVolume,
    row.latestTurnover,
    row.relativeVolume,
    row.volumeSurgePct,
    row.upDownVolRatio,
    row.volumeEffectScore,
    row.shortPercentOfFloat,
    row.maxDailyMove20dPct,
    row.maxDailyRange20dPct,
    row.range63dPct,
    row.volatility63d,
    row.maxDrawdown63d,
    row.rsRating,
    row.rs3m,
    row.rs6m,
    row.rs12m,
  ]);
  const profileCoverageScore = coveragePct([
    row.companyName && row.companyName !== row.symbol ? row.companyName : "",
    row.exchange && row.exchange !== "-" ? row.exchange : "",
    row.country,
    row.currency,
    row.marketCap,
    row.sector && row.sector !== "Sin sector" ? row.sector : "",
    row.industry && row.industry !== "Sin industria" ? row.industry : "",
    row.website,
    profile.businessSummary,
    row.ipoDate,
  ]);
  const fundamentalCoverageScore = coveragePct([
    gm.revenueGrowth,
    gm.earningsGrowth,
    gm.grossMargin,
    gm.operatingMargin,
    gm.profitMargin,
    gm.ebitdaMargin,
    gm.roe,
    gm.roa,
    gm.debtToEquity,
    gm.currentRatio,
    gm.institutionalOwnership,
    gm.insiderOwnership,
    gm.shortPercentOfFloat,
  ]);
  const stalePenalty = freshness.priceFreshnessOk ? 0 : 18;
  const dataCoverageScore = Math.max(0, Math.round(technicalCoverageScore * .68 + profileCoverageScore * .22 + fundamentalCoverageScore * .1 - stalePenalty));
  const issues = [];
  if (!freshness.priceFreshnessOk) issues.push(freshness.priceFreshnessIssue || "precio no fresco");
  if (technicalCoverageScore < 70) issues.push("técnico parcial");
  if (profileCoverageScore < 55) issues.push("perfil parcial");
  if (fundamentalCoverageScore < 35) issues.push("fundamental parcial");
  return {
    ...freshness,
    dataCoverageScore,
    technicalCoverageScore,
    profileCoverageScore,
    fundamentalCoverageScore,
    dataCoverageLabel: dataCoverageScore >= 80 ? "alta" : dataCoverageScore >= 60 ? "util" : dataCoverageScore >= 40 ? "parcial" : "baja",
    dataCoverageIssues: issues,
  };
}
function chartPreviewBars(b, limit = 96) {
  const asc = [...b].filter((x) => Number.isFinite(x.close)).reverse();
  const enriched = asc.map((bar, i) => {
    const windowAvg = (n) => i >= n - 1 ? avg(asc.slice(i - n + 1, i + 1).map((x) => x.close)) : null;
    return {
      date: bar.date,
      open: Number.isFinite(bar.open) ? bar.open : bar.close,
      high: Number.isFinite(bar.high) ? bar.high : bar.close,
      low: Number.isFinite(bar.low) ? bar.low : bar.close,
      close: bar.close,
      volume: firstFinite(bar.volume),
      sma50: windowAvg(50),
      sma200: windowAvg(200),
    };
  });
  return enriched.slice(-limit);
}
function applyRelativeStrength(row, benchmarks = {}) {
  const benchmarkSymbol = benchmarkSymbolForRow(row);
  const rs = scoreRelativeStrength(row, benchmarks[benchmarkSymbol]?.bars || []);
  return { ...row, ...rs, benchmarkSymbol };
}
function buildResearchRow(symbol, chart, profile = {}, requireLongHistoryOrOptions = false, benchmarks = {}) {
  const options = typeof requireLongHistoryOrOptions === "object" && requireLongHistoryOrOptions !== null ? requireLongHistoryOrOptions : { requireLongHistory: requireLongHistoryOrOptions };
  const requireLongHistory = Boolean(options.requireLongHistory);
  const b = chart.bars || [];
  if (b.length < (requireLongHistory ? 180 : 20)) throw new Error("Historico insuficiente");
  const providerPrice = firstFinite(chart.meta?.regularMarketPrice, chart.meta?.regularMarketPreviousClose, chart.meta?.previousClose);
  const latestClose = firstFinite(b[0]?.close);
  const price = firstFinite(providerPrice, latestClose);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Precio no disponible");
  const calcBars = b.map((bar, index) => {
    if (index !== 0) return bar;
    const high = firstFinite(bar.high, bar.close, price);
    const low = firstFinite(bar.low, bar.close, price);
    return {
      ...bar,
      close: price,
      high: Number.isFinite(high) ? Math.max(high, price) : price,
      low: Number.isFinite(low) ? Math.min(low, price) : price,
    };
  });
  const s50 = sma(calcBars, 50), s150 = sma(calcBars, 150), s200 = sma(calcBars, 200), s200p = sma(calcBars, 200, 30);
  const h20 = highValue(calcBars, 20), h65 = highValue(calcBars, 65);
  const avgVol20 = avgVolume(b.slice(0, 20));
  const avgVol5 = avgVolume(b.slice(0, 5));
  const prevVol20 = avgVolume(b.slice(5, 25));
  const latestVolume = firstFinite(b[0]?.volume);
  const perf3m = perf(calcBars, 63);
  const perf6m = perf(calcBars, 126);
  const perf12m = perf(calcBars, 252);
  const riskAdjusted = riskAdjustedStats(calcBars, perf3m);
  const weeklyStage = weeklyStageForBars(calcBars, options);
  const setupPattern = setupPatternForBars(calcBars, { ...options, rawBars: chart.bars || b });
  const row = {
    symbol,
    companyName: profile.name || chart.meta?.shortName || symbol,
    country: countryCode(symbol),
    exchange: profile.exchange || chart.meta?.exchangeName || "-",
    sector: profile.sector || "Sin sector",
    industry: profile.industry || "Sin industria",
    currency: profile.currency || chart.meta?.currency || "",
    ipoDate: profile.ipoDate || "",
    ipoAgeMonths: monthsSince(profile.ipoDate || ""),
    website: normalizeWebsite(profile.website || ""),
    businessSummary: compactBusinessSummary(profile.businessSummary, 520),
    growthMetrics: profile.growthMetrics || {},
    shortPercentOfFloat: Number.isFinite(profile.shortPercentOfFloat) ? profile.shortPercentOfFloat : profile.growthMetrics?.shortPercentOfFloat,
    sharesPercentSharesOut: Number.isFinite(profile.sharesPercentSharesOut) ? profile.sharesPercentSharesOut : profile.growthMetrics?.sharesPercentSharesOut,
    shortRatio: Number.isFinite(profile.shortRatio) ? profile.shortRatio : profile.growthMetrics?.shortRatio,
    sharesShort: Number.isFinite(profile.sharesShort) ? profile.sharesShort : profile.growthMetrics?.sharesShort,
    floatShares: Number.isFinite(profile.floatShares) ? profile.floatShares : profile.growthMetrics?.floatShares,
    price,
    priceSource: Number.isFinite(providerPrice) ? "proveedor" : "ultimo cierre",
    chartProvider: chart.meta?.dataProvider || "Yahoo Finance",
    chartFallbackReason: chart.meta?.fallbackReason || "",
    chartBarsCount: b.length,
    marketCap: firstFinite(profile.marketCap),
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
    distance20d: highDist(calcBars, 20),
    distance50d: highDist(calcBars, 50),
    distance52w: highDist(calcBars, 252),
    distanceATH: highDist(calcBars, calcBars.length),
    highsSpreadPct: h20 && h65 ? Math.abs((h20 / h65) - 1) * 100 : null,
    lowAdvance52w: lowAdv(calcBars, 252),
    perf3m,
    perf6m,
    perf12m,
    ...riskAdjusted,
    extSma50: s50 ? ((price / s50) - 1) * 100 : null,
    upDownVolRatio: udVol(calcBars, 50),
    ...weeklyStageFields(weeklyStage),
    ...setupPattern,
    lastDate: b[0]?.date,
    chartPreview: chartPreviewBars(calcBars),
  };
  Object.assign(row, priceFreshnessForDate(row.lastDate));
  row.theme = theme(row.sector, row.industry, profile.businessSummary);
  row.logoDomain = domainFromUrl(row.website);
  row.businessEs = actividadEs(row.companyName, row.sector, row.industry, row.theme, profile.businessSummary);
  row.weinsteinScore = scoreWeinstein(row);
  row.minerviniScore = scoreMinervini(row);
  row.momentumScore = scoreMomentum(row);
  row.riskScore = scoreRisk(row);
  row.riskRewardScore = scoreRiskReward(row);
  row.volumeEffectScore = scoreVolumeEffect(row);
  row.volumeEvidence = volumeEvidence(row);
  row.adProxyScore = scoreAdProxy(row);
  row.epsGrowthProxyScore = scoreEpsGrowthProxy(row.growthMetrics || {});
  row.volumeScore = scoreVolume(row);
  row.liquidityScore = scoreLiq(row);
  row.ipoCategory = ipoCatForRow(row);
  const withRs = applyRelativeStrength(row, benchmarks);
  const benchmarkBars = benchmarks[withRs.benchmarkSymbol]?.bars || [];
  const objectiveMetricAudit = buildObjectiveMetricAudit(withRs, {
    bars: calcBars,
    benchmarkBars,
    source: withRs.chartProvider,
    asOf: withRs.lastDate,
  });
  const withQuality = { ...withRs, objectiveMetricAudit, ...scoreRsQuality(withRs) };
  const withCoverage = { ...withQuality, ...dataCoverageForRow(withQuality, profile) };
  return { ...withCoverage, ...scoreWeakness(withCoverage) };
}

export {
  BENCHMARK_SYMBOLS,
  ipoCat,
  ipoCatForRow,
  normalizeWebsite,
  domainFromUrl,
  theme,
  compactBusinessSummary,
  actividadEs,
  usefulValue,
  coveragePct,
  priceFreshnessForDate,
  dataCoverageForRow,
  chartPreviewBars,
  applyRelativeStrength,
  buildResearchRow,
};
