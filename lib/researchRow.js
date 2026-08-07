// lib/researchRow.js — construcción de la fila de research (buildResearchRow) y helpers,
// extraído verbatim de app/page.jsx para compartirlo entre el cliente y /api/scan.
import { businessThemeKey } from "@/lib/businessTheme";
import { assertDecisionGrade } from "@/lib/chartDataQuality";
import { coveragePct, dataCoverageForRow, priceFreshnessForDate, usefulValue } from "@/lib/dataCoverageShared";
import { avg, avgVolume, firstFinite, highDist, highValue, lowAdv, perf, riskAdjustedStats, sma, udVol } from "@/lib/indicators";
import { benchmarkSymbolForRow, scoreRelativeStrength, scoreRsQuality } from "@/lib/relativeStrength";
import { buildObjectiveMetricAudit } from "@/lib/objectiveMetricTruth";
import { computeSignal, ipoAgeMonthsForRow, monthsSince, scoreAdProxy, scoreEpsGrowthProxy, scoreLiq, scoreMinervini, scoreMomentum, scoreRisk, scoreRiskReward, scoreVolume, scoreVolumeEffect, scoreWeakness, scoreWeinstein, volumeEvidence } from "@/lib/scoring";
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
// coveragePct, priceFreshnessForDate y dataCoverageForRow ahora se importan
// de lib/dataCoverageShared.js — antes eran una copia local byte-a-byte de
// lib/materializedScanner.js salvo por el campo ebitdaMargin, unificadas en
// docs/duplicados-restantes-2026-08-07.md.
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
  // Guard decision-grade: si la serie es estimada/sintética, buildResearchRow no
  // debe ensamblar una fila de scoring/decision sobre barras sintéticas. Va
  // PRIMERO porque la longitud de un chart estimado es irrelevante — un chart
  // estimado nunca es decision-grade, sin importar cuántas barras tenga.
  assertDecisionGrade(chart, "research row");
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
    // Marca si el chart que sostiene esta fila es estimado/sintético. Por la
    // guarda assertDecisionGrade al inicio, buildResearchRow solo retorna
    // filas decision-grade, así que aquí siempre es false — pero el campo
    // existe para que los consumers (scoring, brief, UI) puedan razonar
    // sobre el chart subyacente sin re-leer dataQuality.
    chartEstimated: false,
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
  // signalCoverage sidecar: per-signal coverage metadata alongside numeric scores.
  const signalCoverage = {};
  const _ws = computeSignal(row, "weinsteinScore");          row.weinsteinScore = _ws.value; signalCoverage.weinsteinScore = { coverage: _ws.coverage, partial: _ws.partial };
  const _ms = computeSignal(row, "minerviniScore");          row.minerviniScore = _ms.value; signalCoverage.minerviniScore = { coverage: _ms.coverage, partial: _ms.partial };
  const _mo = computeSignal(row, "momentumScore");           row.momentumScore = _mo.value; signalCoverage.momentumScore = { coverage: _mo.coverage, partial: _mo.partial };
  const _rs = computeSignal(row, "riskScore");               row.riskScore = _rs.value; signalCoverage.riskScore = { coverage: _rs.coverage, partial: _rs.partial };
  const _rr = computeSignal(row, "riskRewardScore");         row.riskRewardScore = _rr.value; signalCoverage.riskRewardScore = { coverage: _rr.coverage, partial: _rr.partial };
  const _ve = computeSignal(row, "volumeEffectScore");       row.volumeEffectScore = _ve.value; signalCoverage.volumeEffectScore = { coverage: _ve.coverage, partial: _ve.partial };
  row.volumeEvidence = volumeEvidence(row);
  const _ad = computeSignal(row, "adProxyScore");            row.adProxyScore = _ad.value; signalCoverage.adProxyScore = { coverage: _ad.coverage, partial: _ad.partial };
  const _eg = computeSignal(row, "epsGrowthProxyScore");     row.epsGrowthProxyScore = _eg.value; signalCoverage.epsGrowthProxyScore = { coverage: _eg.coverage, partial: _eg.partial };
  const _vo = computeSignal(row, "volumeScore");             row.volumeScore = _vo.value; signalCoverage.volumeScore = { coverage: _vo.coverage, partial: _vo.partial };
  const _li = computeSignal(row, "liquidityScore");          row.liquidityScore = _li.value; signalCoverage.liquidityScore = { coverage: _li.coverage, partial: _li.partial };
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
  // weaknessScore coverage: scoreWeakness(withCoverage) sigue ensamblando los campos
  // planos; computeSignal solo aporta metadata de coverage/partial. Doble invocación
  // consistente con los guards condicionales existentes (ej. adProxyScore).
  const _wk = computeSignal(withCoverage, "weaknessScore");
  signalCoverage.weaknessScore = { coverage: _wk.coverage, partial: _wk.partial };
  return { ...withCoverage, signalCoverage, ...scoreWeakness(withCoverage) };
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
