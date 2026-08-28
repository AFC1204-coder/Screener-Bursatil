import { fetchAsicShortInterest, mergeAsicShortInterest } from "@/lib/asicShort";
import { businessThemeKey } from "@/lib/businessTheme";
import { coveragePct, dataCoverageForRow, priceFreshnessForDate, usefulValue } from "@/lib/dataCoverageShared";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { withProfileCache } from "@/lib/fundamentalsCache";
import { buildLeaderboard, DEFAULT_LEADERBOARD_SPECS, readScanRows, writeMaterializedLeaderboards } from "@/lib/leaderboards";
import { DEFAULT_SCAN_MARKETS, EUROPE_PRIORITY_MARKETS, EUROPE_SECONDARY_MARKETS, normalizeMarketList } from "@/lib/markets";
import { resolveIpoDate } from "@/lib/ipoDate";
import { hydrateProfileIpoDate } from "@/lib/ipoDateSources";
import { micCodeForSymbol, micCodesForScanMarkets } from "@/lib/micCodes";
import { addScoredObjectiveMetricAudit, buildObjectiveMetricAudit } from "@/lib/objectiveMetricTruth";
import { prepareScanDecisionRow, scanDecisionMetrics, scanDecisionRaw } from "@/lib/scanDecisionProjection";
import { scanLightMetrics, screenOutcome } from "@/lib/scanLightProjection";
import { computeTerminalCompleteness } from "@/lib/scanStatus";
import {
  computeCompositeWithCoverage,
  computeSignal,
  scoreAdProxy,
  scoreCompositeValue,
  scoreDemandQuality,
  scoreEpsGrowthProxy,
  scoreGrowthQuality,
  scoreIpo,
  scoreLiquidity,
  scoreMinervini,
  scoreMomentum,
  scoreObjectiveSetupQuality,
  scorePatternContribution,
  scorePatternQuality,
  scoreRisk,
  scoreRiskReward,
  scoreSetupQuality,
  scoreVolume,
  scoreVolumeEffect,
  scoreWeinstein,
  compositeLabel,
  gt,
  gte,
  lt,
  lte,
  between,
} from "@/lib/scoringEngine";
import { DEFAULT_PRICE_FRESHNESS_DAYS } from "@/lib/screenerFilterCatalog";
import { applyScreenerFilters, scoreWeakness } from "@/lib/screenerFilters";
import { clearScansApiCache } from "@/lib/scansApiCache";
import { applySectorScores, computeSectorScoresForRows } from "@/lib/screenerComposite";
import { setupPatternForBars } from "@/lib/setupPatterns";
import { countryCode } from "@/lib/symbols";
import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, supabaseRequestAll, textOrNull, toTimestamp } from "@/lib/supabaseServer";
import { isConfirmedStage2 } from "@/lib/trendStructure";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";
import { marketSymbols } from "@/lib/universes";
import { CRON_UNIVERSE_MARKETS } from "@/lib/cronPlan";
import {
  CURATED_HEAD_BOOST_SCORE,
  intlUniverseGateRejectReason,
  isHkLiquidDeprioritized,
  isPriorPolicyBaseReject,
  marketForIntlGates,
  officialBroadMarketFromList,
  priorPolicyBaseRejectReason,
  resolveBaseRejectThresholds,
} from "@/lib/intlUniverseGates";
import { benchmarkSymbolForRow, enrichRelativePercentiles, scoreRelativeStrength, scoreRsQuality } from "@/lib/relativeStrength";
import { weeklyStageFields, weeklyStageForBars } from "@/lib/weeklyStage";
import { fetchYahooChart, fetchYahooProfile } from "@/lib/yahoo";
import { assertDecisionGrade } from "@/lib/chartDataQuality";

export const DEFAULT_MATERIALIZED_MARKETS = DEFAULT_SCAN_MARKETS;

const DEFAULT_FUNDAMENTALS_AGE_DAYS = 14;
const DEFAULT_LIMIT = 40;
const DEFAULT_PER_MARKET = 10;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_SKIP_RECENT_SCAN_DAYS = 45;
const DEFAULT_RECENT_SCAN_MAX_ROWS = 5000;
// Tope de filas LIGERAS por corrida. Red de seguridad, no política: el
// universo estadounidense son ~5.600 símbolos, así que 20.000 no recorta nada
// real y sí frena un bucle. Cuando recorta se reporta en
// settings.population.droppedByMaxLightRows — a diferencia de maxSavedRows,
// que trunca en silencio (docs/adr-universo-precalculado.md, E.15).
const DEFAULT_MAX_LIGHT_ROWS = 20000;
// 2x DEFAULT_SKIP_RECENT_SCAN_DAYS: suficiente para distinguir "escaneado
// hace 46-90d" (prioridad media) de "nunca escaneado / muy viejo" (prioridad
// alta). Más allá de 90d ambos casos son funcionalmente equivalentes para
// fines de priorización de materialización, así que no se pierde capacidad
// real de discriminación al acotar desde 365d.
const DEFAULT_MATERIALIZATION_LOOKBACK_DAYS = 90;
const SCAN_CURSOR_SETTING_TYPE = "jobs";
const SCAN_CURSOR_SETTING_KEY = "scan-refresh-cursor";

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = numberOrNull(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    if (/^(1|true|yes|y)$/i.test(value)) return true;
    if (/^(0|false|no|n)$/i.test(value)) return false;
  }
  return null;
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function avgWithCoverage(values = [], minCoverage = 0.8) {
  if (!values.length) return null;
  const xs = values.filter(Number.isFinite);
  return xs.length / values.length >= minCoverage ? avg(xs) : null;
}

function avgVolume(rows = [], minCoverage = 0.8) {
  return avgWithCoverage(rows.map((bar) => firstFinite(bar.volume)), minCoverage);
}

function normalizeSymbol(symbol = "") {
  const clean = cleanText(symbol).toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function normalizeBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => ({
      ...bar,
      date: String(bar.date || "").slice(0, 10),
      open: firstFinite(bar.open, bar.close),
      high: firstFinite(bar.high, bar.close),
      low: firstFinite(bar.low, bar.close),
      close: firstFinite(bar.close),
      volume: firstFinite(bar.volume),
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

const sma = (bars, n, offset = 0) => bars.length >= n + offset ? avg(bars.slice(offset, offset + n).map((bar) => bar.close)) : null;
const perf = (bars, n) => bars.length > n && bars[0].close && bars[n].close ? ((bars[0].close / bars[n].close) - 1) * 100 : null;

function hiLo(bars, n) {
  const rows = bars.slice(0, Math.min(n, bars.length));
  const highs = rows.map((row) => firstFinite(row.high, row.close)).filter(Number.isFinite);
  const lows = rows.map((row) => firstFinite(row.low, row.close)).filter(Number.isFinite);
  return {
    hi: highs.length ? Math.max(...highs) : null,
    lo: lows.length ? Math.min(...lows) : null,
  };
}

function highValue(bars, n) {
  return bars.length ? hiLo(bars, n).hi : null;
}

function highDist(bars, n) {
  if (bars.length < 20) return null;
  const high = highValue(bars, n);
  return high && bars[0].close ? ((bars[0].close / high) - 1) * 100 : null;
}

function lowAdv(bars, n) {
  if (bars.length < 20) return null;
  const { lo } = hiLo(bars, n);
  return lo && bars[0].close ? ((bars[0].close / lo) - 1) * 100 : null;
}

function stdev(values = []) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = avg(xs);
  return Math.sqrt(avg(xs.map((value) => (value - mean) ** 2)));
}

function dailyReturns(bars, n = 63) {
  const out = [];
  for (let i = 0; i < Math.min(n, bars.length - 1); i += 1) {
    const now = bars[i]?.close;
    const prev = bars[i + 1]?.close;
    if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) out.push((now / prev) - 1);
  }
  return out;
}

function annualizedVolatility(bars, n = 63) {
  const sd = stdev(dailyReturns(bars, n));
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}

function downsideVolatility(bars, n = 63) {
  const sd = stdev(dailyReturns(bars, n).map((value) => Math.min(0, value)));
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}

function maxDrawdown(bars, n = 63) {
  const rows = bars.slice(0, Math.min(n, bars.length)).filter((row) => Number.isFinite(row.close)).reverse();
  if (rows.length < 2) return null;
  let peak = rows[0].close;
  let drawdown = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.close);
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - row.close) / peak) * 100);
  }
  return drawdown;
}

function maxDailyMovePct(bars, n = 20) {
  const moves = dailyReturns(bars, n).map((value) => Math.abs(value) * 100).filter(Number.isFinite);
  return moves.length ? Math.max(...moves) : null;
}

function dailyRangePcts(bars, n = 20) {
  return bars.slice(0, Math.min(n, bars.length)).map((row) => {
    const high = firstFinite(row.high, row.close);
    const low = firstFinite(row.low, row.close);
    const close = firstFinite(row.close);
    return Number.isFinite(high) && Number.isFinite(low) && Number.isFinite(close) && close > 0 ? ((high - low) / close) * 100 : null;
  }).filter(Number.isFinite);
}

function maxDailyRangePct(bars, n = 20) {
  const ranges = dailyRangePcts(bars, n);
  return ranges.length ? Math.max(...ranges) : null;
}

function avgDailyRangePct(bars, n = 20) {
  const ranges = dailyRangePcts(bars, n);
  return ranges.length ? avg(ranges) : null;
}

function priceRangePct(bars, n = 63) {
  const rows = bars.slice(0, Math.min(n, bars.length)).filter((row) => Number.isFinite(row.high) && Number.isFinite(row.low) && row.low > 0);
  if (rows.length < Math.min(20, n)) return null;
  const high = Math.max(...rows.map((row) => row.high));
  const low = Math.min(...rows.map((row) => row.low));
  return low > 0 ? ((high / low) - 1) * 100 : null;
}

function riskAdjustedStats(bars, perf3m) {
  const volatility63d = annualizedVolatility(bars, 63);
  const downsideVolatility63d = downsideVolatility(bars, 63);
  const maxDrawdown63d = maxDrawdown(bars, 63);
  return {
    volatility63d,
    downsideVolatility63d,
    maxDrawdown63d,
    maxDailyMove20dPct: maxDailyMovePct(bars, 20),
    maxDailyRange20dPct: maxDailyRangePct(bars, 20),
    avgDailyRange20dPct: avgDailyRangePct(bars, 20),
    range63dPct: priceRangePct(bars, 63),
    returnToVol3m: Number.isFinite(perf3m) && volatility63d > 0 ? perf3m / volatility63d : null,
    returnToDownsideVol3m: Number.isFinite(perf3m) && downsideVolatility63d > 0 ? perf3m / downsideVolatility63d : null,
    returnToDrawdown3m: Number.isFinite(perf3m) && maxDrawdown63d > 0 ? perf3m / maxDrawdown63d : null,
  };
}

function udVol(bars, n = 50) {
  let up = 0;
  let down = 0;
  let valid = 0;
  const limit = Math.min(n, bars.length - 1);
  for (let i = 0; i < Math.min(n, bars.length - 1); i += 1) {
    const volume = firstFinite(bars[i].volume);
    if (!Number.isFinite(volume)) continue;
    valid += 1;
    if (bars[i].close >= bars[i + 1].close) up += volume;
    else down += volume;
  }
  if (!limit || valid / limit < 0.8 || down <= 0) return null;
  return up / down;
}

function theme(sector = "", industry = "", summary = "") { return businessThemeKey(sector, industry, summary); }

function isStage2(row = {}) {
  return isConfirmedStage2(row);
}

// coveragePct, priceFreshnessForDate y dataCoverageForRow ahora se importan
// de lib/dataCoverageShared.js — antes eran una copia local byte-a-byte de
// lib/researchRow.js salvo por el campo ebitdaMargin (ausente aquí) y el
// texto sin tilde "tecnico parcial" (aquí) vs "técnico parcial" (allí).
// Unificadas en docs/duplicados-restantes-2026-08-07.md: la lista de
// fundamentalCoverageScore ahora SÍ incluye ebitdaMargin también en el cron
// (siempre estuvo disponible en profile.growthMetrics, ver justificación en
// dataCoverageShared.js), y el texto usa la tilde de la canónica.

function sectorize(rows = []) {
  // sectorScore vive ahora en lib/screenerComposite.js (fase 1 del ADR de
  // consolidación). El bonus temático hardcodeado /Semis|fotonica|...|Automatizacion/
  // (+20 vs +10) duplicado aquí y en lib/screenerPipeline.js está ELIMINADO —
  // la señal es 100% basada en datos reales del grupo. El cron (runMaterializedScan)
  // sigue llamando a sectorize por lote local porque la finalización atómica
  // para estas filas queda fuera de scope (ADR fase 3); cuando fase 3 migre
  // la finalización también al cron, sectorScore pasará a calcularse sobre
  // la población completa igual que en el scan de servidor.
  const sectorScores = computeSectorScoresForRows(Array.isArray(rows) ? rows : []);
  return enrichRelativePercentiles(applySectorScores(Array.isArray(rows) ? rows : [], sectorScores)).map((row) => {
    const sectorScore = row.sectorScore;
    // signalCoverage: extend sidecar from buildRow with composite-level signals.
    const baseSignalCoverage = row.signalCoverage || {};
    const _os = computeSignal(row, "objectiveSetupScore");   const objectiveSetupScore = _os.value; baseSignalCoverage.objectiveSetupScore = { coverage: _os.coverage, partial: _os.partial };
    const _pc = computeSignal(row, "patternContributionScore"); const patternContributionScore = _pc.value; baseSignalCoverage.patternContributionScore = { coverage: _pc.coverage, partial: _pc.partial };
    const _ps = computeSignal(row, "patternScore");           const patternScore = _ps.value; baseSignalCoverage.patternScore = { coverage: _ps.coverage, partial: _ps.partial };
    const _sq = computeSignal(row, "setupQualityScore");      const setupQualityScore = _sq.value; baseSignalCoverage.setupQualityScore = { coverage: _sq.coverage, partial: _sq.partial };
    const _dq = computeSignal(row, "demandScore");            const demandScore = _dq.value; baseSignalCoverage.demandScore = { coverage: _dq.coverage, partial: _dq.partial };
    const _gs = computeSignal(row, "growthScore");            const growthScore = _gs.value; baseSignalCoverage.growthScore = { coverage: _gs.coverage, partial: _gs.partial };
    // adProxyScore/epsGrowthProxyScore: prefer pre-computed value from buildRow;
    // computeSignal still runs to populate coverage metadata (idempotent compute).
    const _ad2 = computeSignal(row, "adProxyScore");        const adProxyScore = Number.isFinite(row.adProxyScore) ? row.adProxyScore : _ad2.value; baseSignalCoverage.adProxyScore = { coverage: _ad2.coverage, partial: _ad2.partial };
    const _eg2 = computeSignal(row, "epsGrowthProxyScore"); const epsGrowthProxyScore = Number.isFinite(row.epsGrowthProxyScore) ? row.epsGrowthProxyScore : _eg2.value; baseSignalCoverage.epsGrowthProxyScore = { coverage: _eg2.coverage, partial: _eg2.partial };
    const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;
    const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (row.rsRating || 50);
    const rsQuality = scoreRsQuality({ ...row, riskRewardScore });
    const rsQualityScore = Number.isFinite(rsQuality?.rsQualityScore) ? rsQuality.rsQualityScore : rsAnchor;
    const epsAnchor = Number.isFinite(epsGrowthProxyScore) ? epsGrowthProxyScore : growthScore;
    const objectiveScore = scoreCompositeValue({ setupQualityScore: objectiveSetupScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
    const composite = computeCompositeWithCoverage({ setupQualityScore, rsAnchor, rsQualityScore, demandScore, adProxyScore, growthScore, epsAnchor, sectorScore, riskRewardScore, riskScore: row.riskScore, momentumScore: row.momentumScore });
    const compositeScore = composite.value;
    return addScoredObjectiveMetricAudit({
      ...row,
      ...rsQuality,
      signalCoverage: baseSignalCoverage,
      sectorScore,
      groupStrengthScore: sectorScore,
      objectiveSetupScore,
      patternContributionScore,
      patternScore,
      setupQualityScore,
      demandScore,
      growthScore,
      adProxyScore,
      epsGrowthProxyScore,
      riskRewardScore,
      objectiveScore,
      totalScore: compositeScore,
      compositeScore,
      compositeCoverage: composite.coverage,
      compositePartial: composite.partial,
      compositeLabel: compositeLabel(compositeScore),
      objectiveLabel: compositeLabel(objectiveScore),
    });
  });
}

// bars llega DESCENDENTE (normalizeBars ordena más reciente primero). El
// contrato (lib/researchRowContract.compactChartPreview) exige ASCENDENTE
// —igual que researchRow.chartPreviewBars, que hace reverse() antes del
// slice—, así que tomamos las `limit` más recientes y las invertimos.
function compactChartPreview(bars = [], limit = 48) {
  return bars.slice(0, Math.min(limit, bars.length)).reverse().map((bar) => ({
    date: bar.date,
    close: bar.close,
    volume: bar.volume,
  }));
}

function dataSourceMeta(chart = {}, profile = {}) {
  return {
    chartCache: chart.meta?.cache || null,
    fundamentalsCache: profile.fundamentalsCache || null,
  };
}

function buildResearchRow(symbol, chart = {}, profile = {}, benchmarks = {}, options = {}) {
  assertDecisionGrade(chart, "materialized scan");
  const bars = normalizeBars(chart.bars || []);
  if (bars.length < 20) throw new Error(`Histórico insuficiente: ${bars.length}/20`);
  const providerPrice = firstFinite(chart.meta?.regularMarketPrice, chart.meta?.regularMarketPreviousClose, chart.meta?.previousClose);
  const latestClose = firstFinite(bars[0]?.close);
  const price = firstFinite(providerPrice, latestClose);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Precio no disponible");
  const calcBars = bars.map((bar, index) => {
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
  const s50 = sma(calcBars, 50);
  const s150 = sma(calcBars, 150);
  const s200 = sma(calcBars, 200);
  const s200p = sma(calcBars, 200, 30);
  const h20 = highValue(calcBars, 20);
  const h65 = highValue(calcBars, 65);
  const avgVol20 = avgVolume(bars.slice(0, 20));
  const avgVol5 = avgVolume(bars.slice(0, 5));
  const prevVol20 = avgVolume(bars.slice(5, 25));
  const latestVolume = firstFinite(bars[0]?.volume);
  const perf3m = perf(calcBars, 63);
  const perf6m = perf(calcBars, 126);
  const perf12m = perf(calcBars, 252);
  const weeklyStage = weeklyStageForBars(calcBars, options);
  const setupPattern = setupPatternForBars(calcBars, { ...options, rawBars: chart.bars || [] });
  const row = {
    symbol,
    micCode: micCodeForSymbol(symbol, {
      micCode: options.universeRow?.micCode,
      exchange: profile.exchange || chart.meta?.exchangeName || chart.meta?.exchange,
    }),
    companyName: profile.name || chart.meta?.shortName || symbol,
    country: countryCode(symbol),
    exchange: profile.exchange || chart.meta?.exchangeName || "-",
    sector: profile.sector || "Sin sector",
    industry: profile.industry || "Sin industria",
    currency: profile.currency || chart.meta?.currency || "",
    // Fecha de salida a bolsa: meta del gráfico (Yahoo en vivo) antes que el
    // perfil, con motivo explícito cuando no hay ninguna. Ver lib/ipoDate.js.
    // La copia local de monthsSince que antes vivía aquí se retiró: la
    // aritmética es la misma y ahora la posee lib/ipoDate.js.
    ...resolveIpoDate({ chartMeta: chart.meta, profile }),
    website: profile.website || "",
    growthMetrics: profile.growthMetrics || {},
    shortPercentOfFloat: Number.isFinite(profile.shortPercentOfFloat) ? profile.shortPercentOfFloat : profile.growthMetrics?.shortPercentOfFloat,
    sharesPercentSharesOut: Number.isFinite(profile.sharesPercentSharesOut) ? profile.sharesPercentSharesOut : profile.growthMetrics?.sharesPercentSharesOut,
    shortRatio: Number.isFinite(profile.shortRatio) ? profile.shortRatio : profile.growthMetrics?.shortRatio,
    sharesShort: Number.isFinite(profile.sharesShort) ? profile.sharesShort : profile.growthMetrics?.sharesShort,
    floatShares: Number.isFinite(profile.floatShares) ? profile.floatShares : profile.growthMetrics?.floatShares,
    sharesOutstanding: Number.isFinite(profile.sharesOutstanding) ? profile.sharesOutstanding : profile.growthMetrics?.sharesOutstanding,
    price,
    priceSource: Number.isFinite(providerPrice) ? "proveedor" : "último cierre",
    chartProvider: chart.meta?.dataProvider || "Yahoo Finance",
    dataProviderOrigin: chart.meta?.sourceProvider || chart.meta?.cache?.provider || chart.meta?.dataProvider || "Yahoo Finance",
    chartFallbackReason: chart.meta?.fallbackReason || "",
    chartBarsCount: bars.length,
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
    ...riskAdjustedStats(calcBars, perf3m),
    extSma50: s50 ? ((price / s50) - 1) * 100 : null,
    upDownVolRatio: udVol(calcBars, 50),
    ...weeklyStageFields(weeklyStage),
    ...setupPattern,
    lastDate: bars[0]?.date,
    chartPreview: compactChartPreview(calcBars),
    providerMeta: dataSourceMeta(chart, profile),
  };
  Object.assign(row, priceFreshnessForDate(row.lastDate, options.maxPriceFreshnessDays));
  row.theme = theme(row.sector, row.industry, profile.businessSummary);
  // signalCoverage sidecar: per-signal coverage metadata alongside numeric scores.
  const signalCoverage = {};
  const _ws = computeSignal(row, "weinsteinScore");          row.weinsteinScore = _ws.value; signalCoverage.weinsteinScore = { coverage: _ws.coverage, partial: _ws.partial };
  const _ms = computeSignal(row, "minerviniScore");          row.minerviniScore = _ms.value; signalCoverage.minerviniScore = { coverage: _ms.coverage, partial: _ms.partial };
  const _mo = computeSignal(row, "momentumScore");           row.momentumScore = _mo.value; signalCoverage.momentumScore = { coverage: _mo.coverage, partial: _mo.partial };
  const _rs = computeSignal(row, "riskScore");               row.riskScore = _rs.value; signalCoverage.riskScore = { coverage: _rs.coverage, partial: _rs.partial };
  const _rr = computeSignal(row, "riskRewardScore");         row.riskRewardScore = _rr.value; signalCoverage.riskRewardScore = { coverage: _rr.coverage, partial: _rr.partial };
  const _ve = computeSignal(row, "volumeEffectScore");       row.volumeEffectScore = _ve.value; signalCoverage.volumeEffectScore = { coverage: _ve.coverage, partial: _ve.partial };
  const _ad = computeSignal(row, "adProxyScore");            row.adProxyScore = _ad.value; signalCoverage.adProxyScore = { coverage: _ad.coverage, partial: _ad.partial };
  const _eg = computeSignal(row, "epsGrowthProxyScore");     row.epsGrowthProxyScore = _eg.value; signalCoverage.epsGrowthProxyScore = { coverage: _eg.coverage, partial: _eg.partial };
  const _vo = computeSignal(row, "volumeScore");             row.volumeScore = _vo.value; signalCoverage.volumeScore = { coverage: _vo.coverage, partial: _vo.partial };
  const _li = computeSignal(row, "liquidityScore");          row.liquidityScore = _li.value; signalCoverage.liquidityScore = { coverage: _li.coverage, partial: _li.partial };
  const benchmarkSymbol = benchmarkSymbolForRow(row);
  Object.assign(row, scoreRelativeStrength(row, benchmarks[benchmarkSymbol]?.bars || []), { benchmarkSymbol });
  row.objectiveMetricAudit = buildObjectiveMetricAudit(row, {
    bars: calcBars,
    benchmarkBars: benchmarks[benchmarkSymbol]?.bars || [],
    source: row.chartProvider,
    asOf: row.lastDate,
  });
  const withCoverage = { ...row, ...dataCoverageForRow(row, profile) };
  // weaknessScore coverage: scoreWeakness(withCoverage) sigue ensamblando los campos
  // planos (weaknessScore/weaknessLabel/weaknessReasons); computeSignal solo aporta
  // metadata de coverage/partial al sidecar. Hay una doble invocación de
  // scoreWeakness (una directa, otra vía computeSignal) — patrón consistente con los
  // guards condicionales existentes (ej. adProxyScore), no se optimiza.
  const _wk = computeSignal(withCoverage, "weaknessScore");
  signalCoverage.weaknessScore = { coverage: _wk.coverage, partial: _wk.partial };
  return { ...withCoverage, chartEstimated: false, signalCoverage, ...scoreWeakness(withCoverage) };
}

function baseRejectReason(row = {}, options = {}) {
  const minBars = Number(options.minBars || 180);
  const market = marketForIntlGates(row, options);
  const { minPrice, minAvgTurnover } = resolveBaseRejectThresholds(market, options);
  const minMarketCap = Number(options.minMarketCap ?? 300000000);
  const minCoverageScore = Number(options.minCoverageScore ?? 40);
  if (!Number.isFinite(row.price) || row.price <= 0) return "precio no disponible";
  if (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount < minBars) return `histórico insuficiente ${row.chartBarsCount || 0}/${minBars}`;
  if (!row.priceFreshnessOk) return row.priceFreshnessIssue || "precio no fresco";
  if (Number.isFinite(minPrice) && row.price < minPrice) return `precio bajo ${row.price}`;
  if (Number.isFinite(minAvgTurnover) && (row.avgTurnover || 0) < minAvgTurnover) return `importe medio bajo ${Math.round(row.avgTurnover || 0)}`;
  if (Number.isFinite(row.marketCap) && Number.isFinite(minMarketCap) && row.marketCap < minMarketCap) return `market cap bajo ${Math.round(row.marketCap)}`;
  if (Number.isFinite(minCoverageScore) && (row.dataCoverageScore || 0) < minCoverageScore) return `cobertura baja ${row.dataCoverageScore || 0}`;
  const intlReject = intlUniverseGateRejectReason(row, market, options);
  if (intlReject) return intlReject;
  return "";
}

async function fetchLiveProfile(symbol) {
  const profile = await fetchYahooProfile(symbol);
  const asicShort = await fetchAsicShortInterest(symbol).catch(() => null);
  return mergeAsicShortInterest(profile, asicShort);
}

async function fetchChartForScan(symbol, options = {}) {
  return withDailyBarsCache(symbol, {
    range: options.chartRange || "2A",
    interval: "D",
    refresh: options.refreshPrices,
    useCache: options.cache !== false,
    maxAgeDays: options.maxPriceFreshnessDays,
  }, fetchYahooChart);
}

async function fetchProfileForScan(symbol, options = {}) {
  return withProfileCache(symbol, {
    refresh: options.refreshProfiles,
    useCache: options.cache !== false,
    maxAgeDays: options.maxFundamentalsAgeDays,
  }, fetchLiveProfile);
}

async function hydrateBenchmarks(options = {}) {
  const symbols = ["SPY", "QQQ", "ACWI"];
  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      const chart = await fetchChartForScan(symbol, options);
      return [symbol, { bars: normalizeBars(chart.bars || []), meta: chart.meta || {} }];
    } catch (error) {
      return [symbol, { bars: [], error: error.message || "benchmark unavailable" }];
    }
  }));
  return Object.fromEntries(entries);
}

async function mapLimit(items = [], limit = DEFAULT_CONCURRENCY, worker) {
  const out = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      out[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length || 1) }, run));
  return out;
}

function marketForUniverseRow(row = {}) {
  return cleanText(row.market || row.country || countryCode(row.symbol)).toUpperCase();
}

function marketOffsetFor(market = "", options = {}) {
  const offsets = options.marketOffsets && typeof options.marketOffsets === "object" ? options.marketOffsets : {};
  const value = offsets[market] ?? offsets[market.toUpperCase?.()] ?? options.offset ?? 0;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function symbolSet(value) {
  if (!value) return new Set();
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value.map(normalizeSymbol).filter(Boolean));
  return new Set();
}

function shouldExcludeUniverseRow(row = {}, excludedSymbols = new Set()) {
  return excludedSymbols.size > 0 && excludedSymbols.has(normalizeSymbol(row.symbol));
}

function scanAgeDays(createdAt = "") {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const RECENT_SCAN_PATTERN_BLOCK_STATUSES = new Set([
  "insufficient_history",
  "missing_latest_date",
  "stale_price",
  "sparse_ohlc",
  "missing_volume",
  "partial_volume",
]);

const RECENT_SCAN_STRUCTURE_BLOCK_STATUSES = new Set([
  "data_blocked",
  "not_consolidating",
  "no_meaningful_contractions",
  "pivot_noise",
  "ceiling_break",
  "lower_low_drift",
  "depth_reexpansion",
]);

export function latestScanStateFromRow(row = {}, recentDays = DEFAULT_SKIP_RECENT_SCAN_DAYS) {
  const metrics = objectValue(row.metrics);
  const createdAt = row.created_at || "";
  const ageDays = scanAgeDays(createdAt);
  const totalScore = firstFinite(metrics.objectiveScore, metrics.objective_score, row.total_score, metrics.totalScore, metrics.total_score);
  const verdictKey = cleanText(metrics.setupVerdictKey).toLowerCase();
  const verdictState = cleanText(metrics.setupVerdictState).toLowerCase();
  const structureKey = cleanText(metrics.setupStructureKey).toLowerCase();
  const patternFamily = cleanText(metrics.patternFamily).toLowerCase();
  const reliabilityState = cleanText(metrics.methodologyReliabilityState).toLowerCase();
  const patternDataStatus = cleanText(metrics.patternDataStatus).toLowerCase();
  const contractionStructureStatus = cleanText(metrics.contractionStructureStatus).toLowerCase();
  const displayBlocks = boolOrNull(metrics.setupDisplayBlocksPatternClaim) === true
    || boolOrNull(metrics.setupDisplayDataLimited) === true
    || boolOrNull(metrics.methodologyBlocksPatternClaim) === true
    || reliabilityState === "data_limited"
    || boolOrNull(metrics.patternEligible) === false
    || RECENT_SCAN_PATTERN_BLOCK_STATUSES.has(patternDataStatus)
    || RECENT_SCAN_STRUCTURE_BLOCK_STATUSES.has(contractionStructureStatus);
  const displayActionable = boolOrNull(metrics.setupDisplayActionable);
  const displayTradePlanEligible = boolOrNull(metrics.setupDisplayTradePlanEligible);
  const displayPlanValid = boolOrNull(metrics.setupDisplayPlanValid);
  const displayWatch = boolOrNull(metrics.setupDisplayWatch);
  const displayStrict = boolOrNull(metrics.setupDisplayStrict);
  const legacyActionable = displayActionable !== null
    ? displayActionable === true
    : metrics.setupActionable === true || verdictKey === "actionable_vcp" || verdictState === "actionable";
  const legacyPlanValid = metrics.setupPlanValid === true;
  const planValid = displayBlocks
    ? false
    : displayPlanValid !== null
      ? displayPlanValid === true
      : displayActionable !== null || displayTradePlanEligible !== null
        ? displayActionable === true && displayTradePlanEligible === true
        : legacyPlanValid;
  const watch = displayBlocks
    ? false
    : displayWatch !== null
      ? displayWatch === true
      : metrics.setupWatch === true || verdictState === "watch" || legacyActionable;
  const strict = displayBlocks
    ? false
    : displayStrict !== null
      ? displayStrict === true
      : metrics.setupStrict === true || structureKey === "vcp_strict";
  const patternCandidate = !displayBlocks && (
    ["vcp_watch", "pivot_squeeze", "constructive_base", "breakout_observed"].includes(structureKey)
    || patternFamily === "progressive_contraction"
  );
  const qualityScore = displayBlocks ? null : firstFinite(metrics.setupQualityScore, metrics.patternQualityScore, metrics.baseQualityScore);
  const screenRejectReason = cleanText(metrics.screenRejectReason || "");
  const policyRejectReason = priorPolicyBaseRejectReason({ screenRejectReason })
    || (["precio bajo", "importe medio bajo", "market cap bajo"].some((prefix) => screenRejectReason.startsWith(prefix))
      ? screenRejectReason
      : "");
  return {
    symbol: normalizeSymbol(row.symbol),
    market: cleanText(row.country || countryCode(row.symbol)).toUpperCase(),
    createdAt,
    ageDays,
    recent: Number.isFinite(ageDays) && ageDays <= recentDays,
    totalScore,
    planValid,
    actionable: planValid,
    watch,
    strict,
    patternCandidate,
    qualityScore,
    screenRejectReason: screenRejectReason || null,
    policyRejectReason: policyRejectReason || null,
  };
}

function universeInvestabilityPriority(row = {}) {
  const source = cleanText(row.source).toLowerCase();
  const name = cleanText(row.name || row.companyName || row.symbol);
  const upperName = name.toUpperCase();
  const instrumentType = cleanText(row.qualityGate?.instrumentType).toLowerCase();
  const flags = [];
  let score = 0;
  if (source.includes("curated")) score += 120;
  else if (source.includes("hkex") || source.includes("twse") || source.includes("j-quants") || source.includes("firds")) score += 70;
  else if (source.includes("nasdaqtrader")) score += 10;

  if (instrumentType === "equity") score += 35;
  else if (instrumentType === "listed-vehicle") score += 12;
  else if (instrumentType) {
    score -= 80;
    flags.push(`instrument_${instrumentType}`);
  }
  if (Number(row.universeCoverageScore) >= 85) score += 15;
  else if (Number(row.universeCoverageScore) < 60) score -= 35;

  if (!name || name === row.symbol) {
    score -= 80;
    flags.push("partial_name");
  }
  if (/\b(ACQUISITION CORP|BLANK CHECK|SPAC)\b/.test(upperName)) {
    score -= 260;
    flags.push("spac_like");
  }
  if (/\b(WARRANTS?|RIGHTS?|UNITS?|PREFERRED|PREFERENCE|NOTES?|BONDS?|DEBENTURES?)\b/.test(upperName)) {
    score -= 220;
    flags.push("non_common_equity_terms");
  }
  if (/\bCLASS [A-Z] ORDINARY SHARES?\b/.test(upperName)) {
    score -= 35;
    flags.push("ordinary_share_class");
  }
  const market = cleanText(row.market || row.country || countryCode(row.symbol)).toUpperCase();
  if (market === "HK" && isHkLiquidDeprioritized(row)) {
    score -= 200;
    flags.push("hk_gem_or_no_shortsell");
  } else if (market === "HK") {
    const sub = cleanText(row.exchangeSubCategory);
    if (/Main Board/i.test(sub) && row.shortSellEligible === true) {
      score += 90;
      flags.push("hk_main_board_shortsell");
    }
  }
  return { score, flags };
}

function materializationPriorityForRow(row = {}, options = {}) {
  const scanStateBySymbol = options.scanStateBySymbol instanceof Map ? options.scanStateBySymbol : new Map();
  const scanStateConfigured = options.scanStateConfigured !== false;
  const state = scanStateBySymbol.get(normalizeSymbol(row.symbol));
  const investability = universeInvestabilityPriority(row);
  if (!scanStateConfigured) {
    return {
      score: investability.score,
      reason: "unknown_scan_state",
      lastScanAgeDays: null,
      priorScanScore: null,
      priorSetupState: "",
      investabilityScore: investability.score,
      investabilityFlags: investability.flags,
    };
  }

  let score = investability.score;
  let reason = "stale_scan";
  if (!state) {
    score += 1000;
    reason = "never_scanned";
  } else if (state.recent) {
    score += 120;
    reason = "recent_scan";
  } else {
    score += 650;
    reason = "stale_scan";
    if (Number.isFinite(state.ageDays) && state.ageDays >= 180) score += 90;
    else if (Number.isFinite(state.ageDays) && state.ageDays >= 90) score += 50;
  }

  const planValid = state?.planValid ?? state?.actionable;
  if (planValid) {
    score += state.recent ? 80 : 260;
    reason = state.recent ? "recent_plan_valid" : "prior_plan_valid";
  } else if (state?.watch || state?.strict || state?.patternCandidate) {
    score += state.recent ? 45 : 160;
    reason = state.recent ? "recent_watch" : "prior_watch";
  }

  if (Number.isFinite(state?.totalScore)) {
    if (state.totalScore >= 75) score += state.recent ? 20 : 80;
    else if (state.totalScore >= 65) score += state.recent ? 10 : 45;
  }
  if (Number.isFinite(state?.qualityScore) && state.qualityScore >= 65) score += state.recent ? 8 : 28;

  return {
    score,
    reason,
    lastScanAgeDays: state?.ageDays ?? null,
    priorScanScore: state?.totalScore ?? null,
    priorSetupState: planValid ? "plan_valid" : state?.watch || state?.strict || state?.patternCandidate ? "watch" : state ? "scanned" : "never",
    priorSetupStateLegacy: planValid ? "actionable" : state?.watch || state?.strict || state?.patternCandidate ? "watch" : state ? "scanned" : "never",
    investabilityScore: investability.score,
    investabilityFlags: investability.flags,
  };
}

function isPlanValidSelectionReason(reason = "") {
  return ["prior_plan_valid", "recent_plan_valid", "prior_actionable", "recent_actionable"].includes(cleanText(reason).toLowerCase());
}

function isRecentSelectionReason(reason = "") {
  return ["recent_scan", "recent_plan_valid", "recent_actionable", "recent_watch"].includes(cleanText(reason).toLowerCase());
}

function summarizeSelectionReasons(rows = []) {
  const out = {};
  for (const row of rows) {
    const key = row.selectionReason || "cursor";
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function summarizeSelectionReasonsByMarket(rows = []) {
  const out = {};
  for (const row of rows) {
    const market = row.market || countryCode(row.symbol);
    const key = row.selectionReason || "cursor";
    out[market] ??= {};
    out[market][key] = (out[market][key] || 0) + 1;
  }
  return out;
}

function summarizeMaterializationCandidates(rows = [], options = {}) {
  const scanStateConfigured = options.scanStateConfigured !== false;
  const summary = {
    stateConfigured: scanStateConfigured,
    total: rows.length,
    neverScanned: 0,
    recent: 0,
    stale: 0,
    priorPlanValid: 0,
    priorActionable: 0,
    priorWatch: 0,
    unknown: 0,
    byMarket: {},
  };
  for (const row of rows) {
    const market = row.market || countryCode(row.symbol);
    summary.byMarket[market] ??= {
      total: 0,
      neverScanned: 0,
      recent: 0,
      stale: 0,
      priorPlanValid: 0,
      priorActionable: 0,
      priorWatch: 0,
      unknown: 0,
    };
    const bucket = summary.byMarket[market];
    bucket.total += 1;
    if (!scanStateConfigured || row.selectionReason === "unknown_scan_state") {
      summary.unknown += 1;
      bucket.unknown += 1;
    } else if (row.selectionReason === "never_scanned") {
      summary.neverScanned += 1;
      bucket.neverScanned += 1;
    } else if (isRecentSelectionReason(row.selectionReason)) {
      summary.recent += 1;
      bucket.recent += 1;
    } else {
      summary.stale += 1;
      bucket.stale += 1;
    }
    if (isPlanValidSelectionReason(row.selectionReason)) {
      summary.priorPlanValid += 1;
      bucket.priorPlanValid += 1;
      summary.priorActionable += 1;
      bucket.priorActionable += 1;
    }
    if (row.selectionReason === "prior_watch" || row.selectionReason === "recent_watch") {
      summary.priorWatch += 1;
      bucket.priorWatch += 1;
    }
  }
  return summary;
}

const CURATED_CORE_SCAN_MARKETS = new Set(["HK", "AU", "KR", "IN", "CA", "JP", ...EUROPE_PRIORITY_MARKETS, ...EUROPE_SECONDARY_MARKETS]);

function curatedCoreMarketFromList(markets = []) {
  if (!Array.isArray(markets) || markets.length !== 1) return "";
  const market = String(markets[0] || "").toUpperCase();
  return CURATED_CORE_SCAN_MARKETS.has(market) ? market : "";
}

function boostCuratedHeadRows(rows = [], market = "") {
  const curatedSymbols = marketSymbols(market).map(normalizeSymbol).filter(Boolean);
  if (!curatedSymbols.length) return { rows, curatedCount: 0 };
  const curatedSet = new Set(curatedSymbols);
  let curatedCount = 0;
  const boosted = rows.map((row) => {
    if (!curatedSet.has(row.symbol)) return row;
    curatedCount += 1;
    return {
      ...row,
      selectionPriorityScore: (row.selectionPriorityScore || 0) + CURATED_HEAD_BOOST_SCORE,
      selectionReason: row.selectionReason || "curated-boost",
    };
  });
  return { rows: boosted, curatedCount };
}

function prependCuratedCoreRows(rows = [], market = "") {
  const curatedSymbols = marketSymbols(market).map(normalizeSymbol).filter(Boolean);
  if (!curatedSymbols.length) return { rows, curatedCount: 0 };
  const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
  const curatedSet = new Set(curatedSymbols);
  const head = curatedSymbols.map((symbol, index) => {
    const existing = bySymbol.get(symbol);
    if (existing) {
      return { ...existing, selectionIndex: index, selectionReason: "curated-core" };
    }
    return {
      symbol,
      market,
      country: market,
      source: "curated-core",
      selectionIndex: index,
      selectionPriorityScore: 0,
      selectionReason: "curated-core",
      lastScanAgeDays: null,
      priorScanScore: null,
      priorSetupState: null,
      selectionInvestabilityScore: 0,
      selectionInvestabilityFlags: [],
    };
  });
  const tail = rows.filter((row) => !curatedSet.has(row.symbol));
  return { rows: [...head, ...tail], curatedCount: head.length };
}

function curatedCoreSelectionStart(start, curatedCount) {
  const n = Math.max(Number(start || 0), 0);
  if (curatedCount > 0 && n >= curatedCount) return 0;
  return n;
}

function isOfficialBroadLiquidDeprioritized(row = {}, market = "", scanStateBySymbol = new Map()) {
  const key = String(market || "").toUpperCase();
  if (key === "HK") {
    const state = scanStateBySymbol.get(normalizeSymbol(row.symbol));
    return isHkLiquidDeprioritized(row) || isPriorPolicyBaseReject(state);
  }
  // INT-3e: CA sin proxy barato en snapshot — sin skip de liquidez por tablero.
  return false;
}

function hasPreferredOfficialBroadAhead(group = [], fromIndex = 0, excludedSymbols = new Set(), market = "", scanStateBySymbol = new Map()) {
  for (let i = fromIndex; i < group.length; i += 1) {
    const candidate = group[i];
    if (shouldExcludeUniverseRow(candidate, excludedSymbols)) continue;
    if (isOfficialBroadLiquidDeprioritized(candidate, market, scanStateBySymbol)) continue;
    return true;
  }
  return false;
}

function createOfficialBroadLiquidSkip(market = "", scanStateBySymbol = new Map()) {
  const key = String(market || "").toUpperCase();
  if (key !== "HK") return null;
  return (row, { group, cursor, excludedSymbols }) => {
    if (!isOfficialBroadLiquidDeprioritized(row, key, scanStateBySymbol)) return false;
    return hasPreferredOfficialBroadAhead(group, cursor, excludedSymbols, key, scanStateBySymbol);
  };
}

function scanSelectionCursor(group = [], start = 0, take = 1, excludedSymbols = new Set(), options = {}) {
  const shouldSkipRow = typeof options.shouldSkipRow === "function" ? options.shouldSkipRow : null;
  const selected = [];
  let cursor = Math.max(Number(start || 0), 0);
  let skippedRecent = 0;
  let skippedLiquid = 0;
  while (cursor < group.length && selected.length < take) {
    const row = group[cursor];
    cursor += 1;
    if (shouldExcludeUniverseRow(row, excludedSymbols)) {
      skippedRecent += 1;
      continue;
    }
    if (shouldSkipRow?.(row, { group, cursor, excludedSymbols })) {
      skippedLiquid += 1;
      continue;
    }
    selected.push(row);
  }
  return {
    selected,
    cursor,
    skippedRecent,
    skippedLiquid,
  };
}

function selectUniverseRows(snapshot = {}, options = {}) {
  const limit = Math.max(Number(options.limit || DEFAULT_LIMIT), 1);
  const offset = Math.max(Number(options.offset || 0), 0);
  const perMarket = Math.max(Number(options.perMarket || 0), 0);
  const markets = normalizeMarketList(options.markets || DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const excludedSymbols = symbolSet(options.excludedSymbols);
  const prioritizeMaterialization = options.prioritizeMaterialization !== false && options.scanStateConfigured !== false;
  const seen = new Set();
  let rows = (snapshot.universe || [])
    .filter((row) => row?.symbol && row.passed !== false)
    .map((row, index) => ({ ...row, symbol: normalizeSymbol(row.symbol), market: marketForUniverseRow(row), selectionIndex: index }))
    .filter((row) => {
      if (!row.symbol || seen.has(row.symbol)) return false;
      seen.add(row.symbol);
      return true;
    })
    .map((row) => {
      const priority = materializationPriorityForRow(row, options);
      return {
        ...row,
        selectionPriorityScore: prioritizeMaterialization ? priority.score : 0,
        selectionReason: prioritizeMaterialization ? priority.reason : "cursor",
        lastScanAgeDays: priority.lastScanAgeDays,
        priorScanScore: priority.priorScanScore,
        priorSetupState: priority.priorSetupState,
        selectionInvestabilityScore: priority.investabilityScore,
        selectionInvestabilityFlags: priority.investabilityFlags,
      };
    });

  const officialBroadMarket = officialBroadMarketFromList(markets);
  const curatedCoreMarket = officialBroadMarket ? "" : curatedCoreMarketFromList(markets);
  let curatedCount = 0;
  if (officialBroadMarket) {
    const boost = boostCuratedHeadRows(rows, officialBroadMarket);
    rows = boost.rows;
    curatedCount = boost.curatedCount;
  } else if (curatedCoreMarket) {
    const core = prependCuratedCoreRows(rows, curatedCoreMarket);
    rows = core.rows;
    curatedCount = core.curatedCount;
  }

  const orderedRows = officialBroadMarket
    ? [...rows].sort((a, b) => (b.selectionPriorityScore || 0) - (a.selectionPriorityScore || 0) || (a.selectionIndex || 0) - (b.selectionIndex || 0))
    : curatedCoreMarket
      ? rows
      : prioritizeMaterialization
        ? [...rows].sort((a, b) => (b.selectionPriorityScore || 0) - (a.selectionPriorityScore || 0) || (a.selectionIndex || 0) - (b.selectionIndex || 0))
        : rows;

  const marketTotals = {};
  for (const row of rows) {
    const key = row.market || countryCode(row.symbol);
    marketTotals[key] = (marketTotals[key] || 0) + 1;
  }

  const selection = {
    selected: [],
    marketTotals,
    selectedByMarket: {},
    marketOffsets: {},
    nextMarketOffsets: {},
    skippedRecent: 0,
    skippedLiquid: 0,
    skippedRecentByMarket: {},
    skippedLiquidByMarket: {},
    priorityMode: officialBroadMarket
      ? "official-broad"
      : curatedCoreMarket
        ? "curated-core"
        : (prioritizeMaterialization ? "materialization-priority" : "cursor"),
    curatedBoostCount: curatedCount,
    selectedReasons: {},
    selectedReasonsByMarket: {},
    materialization: summarizeMaterializationCandidates(rows, options),
  };

  const scanStateBySymbol = options.scanStateBySymbol instanceof Map ? options.scanStateBySymbol : new Map();
  const liquidSkip = officialBroadMarket
    ? createOfficialBroadLiquidSkip(officialBroadMarket, scanStateBySymbol)
    : null;
  const cursorOptions = liquidSkip ? { shouldSkipRow: liquidSkip } : {};

  if (!perMarket) {
    const key = markets.length === 1 ? markets[0] : "GLOBAL";
    const start = officialBroadMarket
      ? (options.marketOffsets ? marketOffsetFor(key, options) : offset)
      : curatedCoreSelectionStart(
        options.marketOffsets ? marketOffsetFor(key, options) : offset,
        curatedCount,
      );
    const result = scanSelectionCursor(orderedRows, start, limit, excludedSymbols, cursorOptions);
    selection.selected = result.selected;
    selection.selectedByMarket[key] = selection.selected.length;
    selection.marketOffsets[key] = start;
    selection.nextMarketOffsets[key] = orderedRows.length && result.cursor < orderedRows.length ? result.cursor : 0;
    selection.skippedRecent = result.skippedRecent;
    selection.skippedLiquid = result.skippedLiquid;
    selection.skippedRecentByMarket[key] = result.skippedRecent;
    selection.skippedLiquidByMarket[key] = result.skippedLiquid;
    selection.selectedReasons = summarizeSelectionReasons(selection.selected);
    selection.selectedReasonsByMarket = summarizeSelectionReasonsByMarket(selection.selected);
    return selection;
  }

  const groups = Object.fromEntries(markets.map((market) => [
    market,
    orderedRows.filter((row) => row.market === market || countryCode(row.symbol) === market),
  ]));
  const selected = [];
  const selectedByMarket = Object.fromEntries(markets.map((market) => [market, 0]));
  const marketStarts = Object.fromEntries(markets.map((market) => [market, officialBroadMarket
    ? (options.marketOffsets ? marketOffsetFor(market, options) : offset)
    : curatedCoreSelectionStart(
      options.marketOffsets ? marketOffsetFor(market, options) : offset,
      curatedCount,
    )]));
  const marketCursors = { ...marketStarts };
  const skippedRecentByMarket = Object.fromEntries(markets.map((market) => [market, 0]));
  const skippedLiquidByMarket = Object.fromEntries(markets.map((market) => [market, 0]));
  let added = true;
  while (selected.length < limit && added) {
    added = false;
    for (const market of markets) {
      if (selected.length >= limit) break;
      if (selectedByMarket[market] >= perMarket) continue;
      const group = groups[market] || [];
      const marketCursorOptions = officialBroadMarket === market
        ? { shouldSkipRow: createOfficialBroadLiquidSkip(market, scanStateBySymbol) }
        : {};
      const result = scanSelectionCursor(group, marketCursors[market], 1, excludedSymbols, marketCursorOptions);
      marketCursors[market] = result.cursor;
      skippedRecentByMarket[market] += result.skippedRecent;
      skippedLiquidByMarket[market] += result.skippedLiquid;
      const row = result.selected[0];
      if (!row) continue;
      selected.push(row);
      selectedByMarket[market] += 1;
      added = true;
    }
  }
  for (const market of markets) {
    const group = groups[market] || [];
    const start = marketStarts[market] || 0;
    const cursor = marketCursors[market] || start;
    const count = selectedByMarket[market] || 0;
    selection.selectedByMarket[market] = count;
    selection.marketOffsets[market] = start;
    selection.nextMarketOffsets[market] = group.length && cursor < group.length ? cursor : 0;
    selection.skippedRecentByMarket[market] = skippedRecentByMarket[market] || 0;
    selection.skippedLiquidByMarket[market] = skippedLiquidByMarket[market] || 0;
  }
  selection.selected = selected;
  selection.skippedRecent = Object.values(selection.skippedRecentByMarket).reduce((sum, value) => sum + Number(value || 0), 0);
  selection.skippedLiquid = Object.values(selection.skippedLiquidByMarket).reduce((sum, value) => sum + Number(value || 0), 0);
  selection.selectedReasons = summarizeSelectionReasons(selection.selected);
  selection.selectedReasonsByMarket = summarizeSelectionReasonsByMarket(selection.selected);
  return selection;
}

async function readRecentlyScannedSymbols(options = {}) {
  const config = supabaseConfig();
  const days = Math.max(Number(options.recentScanDays || DEFAULT_SKIP_RECENT_SCAN_DAYS), 1);
  const lookbackDays = Math.max(
    days,
    Math.min(Math.max(Number(options.materializationLookbackDays || DEFAULT_MATERIALIZATION_LOOKBACK_DAYS), 1), 1095),
  );
  const maxRows = Math.min(Math.max(Number(options.materializationMaxRows || options.recentScanMaxRows || DEFAULT_RECENT_SCAN_MAX_ROWS), 1), 50000);
  const markets = normalizeMarketList(options.markets || DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const marketSet = new Set(markets);
  if (!config.configured) {
    return {
      enabled: true,
      configured: false,
      skipped: true,
      days,
      lookbackDays,
      symbols: new Set(),
      latestBySymbol: new Map(),
      count: 0,
      materialization: { stateConfigured: false, lookbackDays, latestScanned: 0, recent: 0, stale: 0, byMarket: {} },
      ...disabledPayload(),
    };
  }
  const since = new Date(Date.now() - lookbackDays * 86400000).toISOString();
  const rows = await supabaseRequestAll("scan_results", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&created_at=gte.${encodeURIComponent(since)}&select=symbol,country,created_at,total_score,metrics&order=created_at.desc`,
  }, {
    maxRows,
  });
  const symbols = new Set();
  const byMarketSets = {};
  const latestBySymbol = new Map();
  const materializationByMarket = {};
  const materialization = {
    stateConfigured: true,
    lookbackDays,
    latestScanned: 0,
    recent: 0,
    stale: 0,
    priorPlanValid: 0,
    priorActionable: 0,
    priorWatch: 0,
    highScore: 0,
    byMarket: materializationByMarket,
  };
  for (const row of rows || []) {
    const symbol = normalizeSymbol(row.symbol);
    if (!symbol) continue;
    const market = cleanText(row.country || countryCode(symbol)).toUpperCase();
    if (marketSet.size && !marketSet.has(market) && !marketSet.has(countryCode(symbol))) continue;
    const key = marketSet.has(market) ? market : countryCode(symbol);
    if (latestBySymbol.has(symbol)) continue;
    const state = latestScanStateFromRow(row, days);
    latestBySymbol.set(symbol, { ...state, market: key });
    materialization.latestScanned += 1;
    materializationByMarket[key] ??= { latestScanned: 0, recent: 0, stale: 0, priorPlanValid: 0, priorActionable: 0, priorWatch: 0, highScore: 0 };
    materializationByMarket[key].latestScanned += 1;
    if (state.recent) {
      symbols.add(symbol);
      byMarketSets[key] ??= new Set();
      byMarketSets[key].add(symbol);
      materialization.recent += 1;
      materializationByMarket[key].recent += 1;
    } else {
      materialization.stale += 1;
      materializationByMarket[key].stale += 1;
    }
    if (state.planValid ?? state.actionable) {
      materialization.priorPlanValid += 1;
      materializationByMarket[key].priorPlanValid += 1;
      materialization.priorActionable += 1;
      materializationByMarket[key].priorActionable += 1;
    } else if (state.watch || state.strict || state.patternCandidate) {
      materialization.priorWatch += 1;
      materializationByMarket[key].priorWatch += 1;
    }
    if (Number.isFinite(state.totalScore) && state.totalScore >= 70) {
      materialization.highScore += 1;
      materializationByMarket[key].highScore += 1;
    }
  }
  const byMarket = Object.fromEntries(Object.entries(byMarketSets).map(([key, items]) => [key, items.size]));
  return {
    enabled: true,
    configured: true,
    skipped: false,
    days,
    lookbackDays,
    maxRows,
    rowsRead: rows?.length || 0,
    count: symbols.size,
    byMarket,
    symbols,
    latestBySymbol,
    materialization,
  };
}

// El cron de escaneo pide grupos de mercados (SCAN_CRON_GROUPS) cuyas claves
// de caché individuales nunca se escriben: solo el cron de universo persiste
// la instantánea combinada bajo CRON_UNIVERSE_MARKETS. Sin este filtro, un
// grupo no europeo (p.ej. ["US","HK","AU"]) fallaba el lookup por igualdad
// exacta de cache_key y forzaba una reconstruccion completa del universo en
// cada corrida (~34s de los 60s disponibles). Cuando el grupo es subconjunto
// de CRON_UNIVERSE_MARKETS, se pide la instantánea combinada (que sí existe)
// y se recorta aquí a los mercados del grupo.
function filterSnapshotToMarkets(snapshot = {}, markets = []) {
  // coverageReadiness.byMarket ya viene calculada por mercado individual en
  // la instantánea combinada (universeEngine.coverageReadinessForSnapshot),
  // así que sigue siendo válida sin recomputar: no se toca. `coverage` (los
  // agregados byMarket/bySource) no se consume en este módulo más allá de
  // ese campo, así que se deja igual para no duplicar snapshotSummary.
  const marketSet = new Set(markets);
  const universe = (snapshot.universe || []).filter((row) => marketSet.has(marketForUniverseRow(row)));
  const excluded = (snapshot.excluded || []).filter((row) => marketSet.has(marketForUniverseRow(row)));
  return {
    ...snapshot,
    markets,
    universe,
    excluded,
    count: universe.length,
    totalBeforeGate: universe.length + excluded.length,
    excludedCount: excluded.length,
  };
}

async function resolveSymbols(options = {}) {
  const explicit = (options.symbols || []).map(normalizeSymbol).filter(Boolean);
  if (explicit.length) {
    return {
      symbols: [...new Set(explicit)].slice(0, options.limit || explicit.length),
      universeTotal: explicit.length,
      selectedRows: explicit.map((symbol) => ({ symbol, market: countryCode(symbol), source: "explicit" })),
      selection: {
        selectedByMarket: explicit.reduce((map, symbol) => {
          const market = countryCode(symbol);
          map[market] = (map[market] || 0) + 1;
          return map;
        }, {}),
        marketTotals: {},
        marketOffsets: {},
        nextMarketOffsets: {},
        priorityMode: "explicit",
      },
      snapshot: null,
    };
  }
  const markets = normalizeMarketList(options.markets?.length ? options.markets : DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const useCronUniverseSnapshot = Boolean(options.cronUniverseSnapshot)
    && markets.every((market) => CRON_UNIVERSE_MARKETS.includes(market));
  const snapshotMarkets = useCronUniverseSnapshot ? CRON_UNIVERSE_MARKETS : markets;
  let snapshot = await getUniverseEngineSnapshot({
    markets: snapshotMarkets,
    refresh: options.refreshUniverse,
    maxAgeHours: options.universeMaxAgeHours || 24,
  });
  if (useCronUniverseSnapshot) {
    snapshot = filterSnapshotToMarkets(snapshot, markets);
  }
  let recentScanExclusion = null;
  const needsScanState = options.skipRecentlyScanned || options.prioritizeMaterialization !== false;
  if (needsScanState) {
    try {
      recentScanExclusion = await readRecentlyScannedSymbols({ ...options, markets });
    } catch (error) {
      recentScanExclusion = {
        enabled: true,
        configured: supabaseConfig().configured,
        skipped: true,
        error: error.message || "recent scan lookup failed",
        days: Number(options.recentScanDays || DEFAULT_SKIP_RECENT_SCAN_DAYS),
        symbols: new Set(),
        latestBySymbol: new Map(),
        count: 0,
      };
    }
  }
  const selection = selectUniverseRows(snapshot, {
    ...options,
    markets,
    excludedSymbols: options.skipRecentlyScanned ? recentScanExclusion?.symbols : new Set(),
    scanStateBySymbol: recentScanExclusion?.latestBySymbol,
    scanStateConfigured: Boolean(recentScanExclusion?.configured && !recentScanExclusion?.skipped),
  });
  const selectedRows = selection.selected;
  return {
    symbols: selectedRows.map((row) => row.symbol),
    universeTotal: snapshot.count || snapshot.universe?.length || 0,
    selectedRows,
    selection,
    snapshot,
    recentScanExclusion: recentScanExclusion ? {
      enabled: Boolean(options.skipRecentlyScanned),
      materializationStateEnabled: Boolean(needsScanState),
      configured: Boolean(recentScanExclusion.configured),
      skipped: Boolean(recentScanExclusion.skipped),
      error: recentScanExclusion.error || "",
      days: Number(recentScanExclusion.days || DEFAULT_SKIP_RECENT_SCAN_DAYS),
      lookbackDays: Number(recentScanExclusion.lookbackDays || 0),
      maxRows: Number(recentScanExclusion.maxRows || 0),
      rowsRead: Number(recentScanExclusion.rowsRead || 0),
      count: Number(recentScanExclusion.count || 0),
      byMarket: recentScanExclusion.byMarket || {},
      materialization: recentScanExclusion.materialization || {},
    } : {
      enabled: false,
    },
  };
}

export async function planMaterializedScan(options = {}) {
  const markets = normalizeMarketList(options.markets?.length ? options.markets : DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const resolved = await resolveSymbols({ ...options, markets });
  const effectiveOffset = firstFinite(options.marketOffsets?.[markets[0]], options.offset, 0) || 0;
  return {
    markets,
    symbols: resolved.symbols,
    selectedRows: resolved.selectedRows,
    universeTotal: resolved.universeTotal,
    settings: {
      source: "jobs/scan-refresh",
      dryRun: true,
      markets,
      limit: Number(options.limit || DEFAULT_LIMIT),
      perMarket: Number(options.perMarket || 0),
      offset: effectiveOffset,
      marketOffsets: resolved.selection?.marketOffsets || {},
      nextMarketOffsets: resolved.selection?.nextMarketOffsets || {},
      skipRecentlyScanned: Boolean(options.skipRecentlyScanned),
      recentScanDays: Number(options.recentScanDays || DEFAULT_SKIP_RECENT_SCAN_DAYS),
      materializationLookbackDays: Number(options.materializationLookbackDays || DEFAULT_MATERIALIZATION_LOOKBACK_DAYS),
      prioritizeMaterialization: options.prioritizeMaterialization !== false,
      priorityMode: resolved.selection?.priorityMode || "cursor",
      universeTotal: resolved.universeTotal,
      shadowSource: options.shadowSource || null,
    },
    stats: {
      markets,
      universeTotal: resolved.universeTotal,
      selected: resolved.symbols.length,
      selection: resolved.selection || {},
      recentScanExclusion: resolved.recentScanExclusion || { enabled: false },
      shadowSource: options.shadowSource || null,
      cache: resolved.snapshot?.cache || null,
    },
  };
}

async function analyzeOne(symbol, benchmarks, options = {}) {
  let profile = {};
  try {
    const [chartResult, profileResult] = await Promise.allSettled([
      fetchChartForScan(symbol, options),
      fetchProfileForScan(symbol, options),
    ]);
    profile = profileResult.status === "fulfilled" ? profileResult.value : {};
    if (chartResult.status === "rejected") throw chartResult.reason;
    const chart = chartResult.value;
    // Con las dos cachés acertando, ni el meta del gráfico ni el perfil traen
    // la primera cotización — era el motivo de que `ipoDate` saliera vacío en
    // el 100% de las filas del nocturno. hydrateProfileIpoDate la pide una
    // sola vez y la devuelve a fundamental_snapshots. Ver lib/ipoDateSources.js.
    profile = await hydrateProfileIpoDate(symbol, profile, { ...options, chartMeta: chart.meta });
    const row = buildResearchRow(symbol, chart, profile, benchmarks, options);
    const reject = baseRejectReason(row, {
      ...options,
      market: options.universeRow?.market || countryCode(symbol),
    });
    if (reject) return { symbol, ok: false, rejection: reject, row };
    return { symbol, ok: true, row };
  } catch (error) {
    return {
      symbol,
      micCode: micCodeForSymbol(symbol, {
        micCode: options.universeRow?.micCode,
        exchange: profile.exchange || options.universeRow?.exchange,
      }),
      ok: false,
      rejection: error.message || "scan failed",
    };
  }
}

function insufficientDataRejection(reason = "") {
  return /precio no disponible|hist[oó]rico insuficiente|precio (?:no fresco|viejo)|cobertura baja/i.test(String(reason || ""));
}

function historyProvider(row = {}) {
  const provider = cleanText(row.dataProviderOrigin || row.chartProvider || "yahoo").toLowerCase();
  if (provider.includes("twelve")) return "twelve_data";
  if (provider.includes("yahoo")) return "yahoo";
  if (provider.includes("stooq")) return "stooq";
  if (provider.includes("alpha")) return "alpha_vantage";
  return provider.replace(/\s+/g, "_") || "yahoo";
}

function cloneForHistoryScoring(row = {}) {
  return {
    ...row,
    signalCoverage: { ...(row.signalCoverage || {}) },
  };
}

function authoritativeUniverseSnapshot(snapshot = null, markets = []) {
  if (!snapshot || snapshot.cache?.status === "curated-fallback") return false;
  const readiness = snapshot.coverageReadiness?.byMarket || {};
  return markets.every((market) => readiness[market]?.blocksCoverageClaim === false);
}

export function materializedScanHistoryObservations({
  analyzed = [],
  scoredRows = [],
  passedRows = [],
  filterRejections = [],
  observedAt = new Date().toISOString(),
} = {}) {
  const scoredBySymbol = new Map(scoredRows.map((row) => [row.symbol, row]));
  const passedSymbols = new Set(passedRows.map((row) => row.symbol));
  const filterBySymbol = new Map(filterRejections.map((item) => [item.symbol, item]));
  return analyzed.map((item) => {
    const scored = scoredBySymbol.get(item.symbol) || item.row || {};
    const baseInsufficient = item.ok !== true && (!item.row || insufficientDataRejection(item.rejection));
    const filterRejection = filterBySymbol.get(item.symbol);
    const passedScreen = item.ok === true && passedSymbols.has(item.symbol);
    const absenceReason = passedScreen
      ? null
      : baseInsufficient
        ? "insufficient_data"
        : "filtered_out";
    const absenceDetail = baseInsufficient
      ? item.rejection
      : filterRejection?.reason || item.rejection || "no pasó el cribado";
    return {
      symbol: item.symbol,
      mic_code: scored.micCode || item.micCode || "",
      observed_at: observedAt,
      data_as_of: scored.lastDate || null,
      stage: baseInsufficient ? null : scored.weeklyStageState || null,
      stage_week: baseInsufficient ? null : scored.weeklyStageWeek ?? null,
      rs_global: baseInsufficient ? null : scored.rsGlobalPct ?? null,
      rs_benchmark: baseInsufficient ? null : scored.rsRating ?? null,
      rs_country: baseInsufficient ? null : scored.rsCountryPct ?? null,
      rs_sector: baseInsufficient ? null : scored.rsSectorPct ?? null,
      composite_score: baseInsufficient ? null : scored.compositeScore ?? scored.totalScore ?? null,
      distance_52w: baseInsufficient ? null : scored.distance52w ?? null,
      composite_coverage: baseInsufficient ? 0 : scored.compositeCoverage ?? 0,
      composite_partial: baseInsufficient ? true : scored.compositePartial !== false,
      data_provider: historyProvider(scored),
      passed_screen: passedScreen,
      absence_reason: absenceReason,
      absence_detail: absenceReason ? absenceDetail || null : null,
    };
  });
}

export function scanResultPayload(row = {}, scanId, ownerId, index, settingsOrExplanation = {}) {
  const preparedRow = prepareScanDecisionRow(row, settingsOrExplanation);
  return {
    owner_id: ownerId,
    scan_id: scanId,
    symbol: textOrNull(preparedRow.symbol) || "-",
    company_name: textOrNull(preparedRow.companyName || preparedRow.name || preparedRow.symbol),
    country: textOrNull(preparedRow.country),
    sector: textOrNull(preparedRow.sector),
    industry: textOrNull(preparedRow.industry),
    theme: textOrNull(preparedRow.theme),
    rank_index: index + 1,
    total_score: finiteOrNull(preparedRow.totalScore),
    weinstein_score: finiteOrNull(preparedRow.weinsteinScore),
    minervini_score: finiteOrNull(preparedRow.minerviniScore),
    risk_score: finiteOrNull(preparedRow.riskScore),
    rs_rating: finiteOrNull(preparedRow.rsGlobalPct ?? preparedRow.rsRating),
    metrics: {
      ...scanDecisionMetrics(preparedRow),
      rsGlobalPct: row.rsGlobalPct ?? null,
      rsRating: row.rsRating ?? null,
      rsCountryPct: row.rsCountryPct ?? null,
      rsSectorPct: row.rsSectorPct ?? null,
      rsQualityScore: row.rsQualityScore ?? null,
      rsStabilityScore: row.rsStabilityScore ?? null,
      speculationRiskScore: row.speculationRiskScore ?? null,
      rsQualityLabel: row.rsQualityLabel ?? null,
      rsGlobalSample: row.rsGlobalSample ?? null,
      rsCountrySample: row.rsCountrySample ?? null,
      rsSectorSample: row.rsSectorSample ?? null,
      rs3m: row.rs3m ?? null,
      rs6m: row.rs6m ?? null,
      rs12m: row.rs12m ?? null,
      benchmarkSymbol: row.benchmarkSymbol ?? null,
      benchmarkPerf3m: row.benchmarkPerf3m ?? null,
      benchmarkPerf6m: row.benchmarkPerf6m ?? null,
      benchmarkPerf12m: row.benchmarkPerf12m ?? null,
      rsBenchmarkSample: row.rsBenchmarkSample ?? null,
      rsBenchmarkAvailable: row.rsBenchmarkAvailable ?? null,
      rsBenchmarkIssue: row.rsBenchmarkIssue ?? null,
      perf3m: row.perf3m ?? null,
      perf6m: row.perf6m ?? null,
      perf12m: row.perf12m ?? null,
      distance20d: row.distance20d ?? null,
      distance50d: row.distance50d ?? null,
      distance52w: row.distance52w ?? null,
      extSma50: row.extSma50 ?? null,
      avgVolume: row.avgVolume ?? null,
      latestVolume: row.latestVolume ?? null,
      avgTurnover: row.avgTurnover ?? null,
      latestTurnover: row.latestTurnover ?? null,
      relativeVolume: row.relativeVolume ?? null,
      volumeSurgePct: row.volumeSurgePct ?? null,
      upDownVolRatio: row.upDownVolRatio ?? null,
      upVolume: row.upVolume ?? null,
      shortPercentOfFloat: row.shortPercentOfFloat ?? null,
      sharesPercentSharesOut: row.sharesPercentSharesOut ?? null,
      shortRatio: row.shortRatio ?? null,
      sharesShort: row.sharesShort ?? null,
      floatShares: row.floatShares ?? null,
      volumeScore: row.volumeScore ?? null,
      volumeEffectScore: row.volumeEffectScore ?? null,
      liquidityScore: row.liquidityScore ?? null,
      sectorScore: row.sectorScore ?? null,
      growthScore: row.growthScore ?? null,
      epsGrowthProxyScore: row.epsGrowthProxyScore ?? null,
      setupQualityScore: row.setupQualityScore ?? null,
      riskRewardScore: row.riskRewardScore ?? null,
      returnToVol3m: row.returnToVol3m ?? null,
      returnToDrawdown3m: row.returnToDrawdown3m ?? null,
      maxDailyMove20dPct: row.maxDailyMove20dPct ?? null,
      maxDailyRange20dPct: row.maxDailyRange20dPct ?? null,
      range63dPct: row.range63dPct ?? null,
      volatility63d: row.volatility63d ?? null,
      maxDrawdown63d: row.maxDrawdown63d ?? null,
      distanceATH: row.distanceATH ?? null,
      highsSpreadPct: row.highsSpreadPct ?? null,
      weaknessScore: row.weaknessScore ?? null,
      dataCoverageScore: row.dataCoverageScore ?? null,
      technicalCoverageScore: row.technicalCoverageScore ?? null,
      fundamentalCoverageScore: row.fundamentalCoverageScore ?? null,
      priceFreshnessDays: row.priceFreshnessDays ?? null,
      priceFreshnessLabel: row.priceFreshnessLabel ?? null,
      priceFreshnessOk: row.priceFreshnessOk ?? null,
      lastDate: row.lastDate ?? null,
      patternFamily: row.patternFamily ?? null,
      patternMaturity: row.patternMaturity ?? null,
      patternQualityScore: row.patternQualityScore ?? null,
      setupStructureKey: row.setupStructureKey ?? null,
      setupStructureLabel: row.setupStructureLabel ?? null,
      setupStructureReason: row.setupStructureReason ?? null,
      setupStructureEvidence: row.setupStructureEvidence ?? null,
      setupStructureTone: row.setupStructureTone ?? null,
      setupStructureStrict: row.setupStructureStrict ?? null,
      setupStructureDataLabel: row.setupStructureDataLabel ?? null,
      setupVerdictKey: row.setupVerdictKey ?? null,
      setupVerdictState: row.setupVerdictState ?? null,
      setupVerdictLabel: row.setupVerdictLabel ?? null,
      setupVerdictShortLabel: row.setupVerdictShortLabel ?? null,
      setupVerdictReason: row.setupVerdictReason ?? null,
      setupVerdictEvidence: row.setupVerdictEvidence ?? null,
      setupVerdictTone: row.setupVerdictTone ?? null,
      setupDataConfidenceKey: row.setupDataConfidenceKey ?? null,
      setupDataConfidenceLabel: row.setupDataConfidenceLabel ?? null,
      setupPlanValid: row.setupPlanValid ?? null,
      setupActionable: row.setupActionable ?? null,
      setupObservable: row.setupObservable ?? null,
      setupWatch: row.setupWatch ?? null,
      setupStrict: row.setupStrict ?? null,
      setupDisplayKey: row.setupDisplayKey ?? null,
      setupDisplayState: row.setupDisplayState ?? null,
      setupDisplayLabel: row.setupDisplayLabel ?? null,
      setupDisplayShortLabel: row.setupDisplayShortLabel ?? null,
      setupDisplayReason: row.setupDisplayReason ?? null,
      setupDisplayEvidence: row.setupDisplayEvidence ?? null,
      setupDisplayLine: row.setupDisplayLine ?? null,
      setupDisplayTone: row.setupDisplayTone ?? null,
      setupDisplayDataLimited: row.setupDisplayDataLimited ?? null,
      setupDisplayBlocksPatternClaim: row.setupDisplayBlocksPatternClaim ?? null,
      setupDisplayPlanValid: row.setupDisplayPlanValid ?? null,
      setupDisplayActionable: row.setupDisplayActionable ?? null,
      setupDisplayObservable: row.setupDisplayObservable ?? null,
      setupDisplayWatch: row.setupDisplayWatch ?? null,
      setupDisplayStrict: row.setupDisplayStrict ?? null,
      setupDisplayTradePlanEligible: row.setupDisplayTradePlanEligible ?? null,
      setupDisplayConfidenceKey: row.setupDisplayConfidenceKey ?? null,
      setupDisplayConfidenceLabel: row.setupDisplayConfidenceLabel ?? null,
      methodologyReliabilityState: row.methodologyReliabilityState ?? null,
      methodologyReliabilityLabel: row.methodologyReliabilityLabel ?? null,
      methodologyReliabilityReason: row.methodologyReliabilityReason ?? null,
      methodologyBlocksPatternClaim: row.methodologyBlocksPatternClaim ?? null,
      patternDataStatus: row.patternDataStatus ?? null,
      patternEligible: row.patternEligible ?? null,
      patternIssues: row.patternIssues ?? null,
      patternVolumeEligible: row.patternVolumeEligible ?? null,
      patternFreshnessDays: row.patternFreshnessDays ?? null,
      patternBarsCount: row.patternBarsCount ?? null,
      patternMinBars: row.patternMinBars ?? null,
      patternCoveragePct: row.patternCoveragePct ?? null,
      patternOhlcCoveragePct: row.patternOhlcCoveragePct ?? null,
      patternVolumeCoveragePct: row.patternVolumeCoveragePct ?? null,
      consolidationCandidate: row.consolidationCandidate ?? null,
      baseContextStatus: row.baseContextStatus ?? null,
      pivotSqueeze: row.pivotSqueeze ?? null,
      baseContextScore: row.baseContextScore ?? null,
      baseReturnPct: row.baseReturnPct ?? null,
      priorUptrendPct: row.priorUptrendPct ?? null,
      basePivotAgeBars: row.basePivotAgeBars ?? null,
      baseNearPivotDays: row.baseNearPivotDays ?? null,
      baseNewHighCount: row.baseNewHighCount ?? null,
      marginalHighBreaks: row.marginalHighBreaks ?? null,
      earlyBaseDepthPct: row.earlyBaseDepthPct ?? null,
      middleBaseDepthPct: row.middleBaseDepthPct ?? null,
      lateBaseDepthPct: row.lateBaseDepthPct ?? null,
      rangeCompressionRatio: row.rangeCompressionRatio ?? null,
      atr20Pct: row.atr20Pct ?? null,
      atr50Pct: row.atr50Pct ?? null,
      meaningfulContractionMinPct: row.meaningfulContractionMinPct ?? null,
      contractionsDecreasing: row.contractionsDecreasing ?? null,
      contractionDepths: row.contractionDepths ?? null,
      contractionCount: row.contractionCount ?? null,
      contraction1DepthPct: row.contraction1DepthPct ?? null,
      contraction2DepthPct: row.contraction2DepthPct ?? null,
      contraction3DepthPct: row.contraction3DepthPct ?? null,
      contraction4DepthPct: row.contraction4DepthPct ?? null,
      lastContractionDepthPct: row.lastContractionDepthPct ?? null,
      rejectedContractionDepthPct: row.rejectedContractionDepthPct ?? null,
      contractionReductionPct: row.contractionReductionPct ?? null,
      contractionStructureStatus: row.contractionStructureStatus ?? null,
      contractionStructureReason: row.contractionStructureReason ?? null,
      measuredContractionDepths: row.measuredContractionDepths ?? null,
      contractionSwings: row.contractionSwings ?? null,
      measuredContractionSwings: row.measuredContractionSwings ?? null,
      rejectedContractionSwing: row.rejectedContractionSwing ?? null,
      baseDepthPct: row.baseDepthPct ?? null,
      baseWeeks: row.baseWeeks ?? null,
      distanceToPivotPct: row.distanceToPivotPct ?? null,
      absDistanceToPivotPct: row.absDistanceToPivotPct ?? null,
      volumeDryUpRatio: row.volumeDryUpRatio ?? null,
      tightness5dPct: row.tightness5dPct ?? null,
      tightness10dPct: row.tightness10dPct ?? null,
      tightness20dPct: row.tightness20dPct ?? null,
      pivotClarityScore: row.pivotClarityScore ?? null,
      volumeDryUpScore: row.volumeDryUpScore ?? null,
      baseQualityScore: row.baseQualityScore ?? null,
      // scanResultPayload solo se usa para filas que YA pasaron el preset
      // (runMaterializedScan lo llama con scan.rows). La marca va igualmente
      // explícita: desde que el nocturno guarda también la población que no
      // pasa, una consulta sobre scan_results tiene que poder distinguirlas
      // sin inferirlo de la forma de la fila.
      ...screenOutcome(true),
    },
    // Misma poda de escritura que los otros dos escritores de scan_results
    // (lib/serverScanRunner.js y app/api/scans/route.js): sin las copias de
    // objectiveMetricAudit/decisionTrace, que ya viajan en metrics. El
    // chartPreview del cron ya venía compactado por su propia proyección local.
    raw: scanDecisionRaw(preparedRow),
  };
}

// Fila LIGERA: la de un símbolo que se analizó y NO pasó el preset. Se guarda
// para que exista población sobre la que filtrar — sin ella, cualquier
// criterio distinto del preset obliga a reescanear desde el navegador, que es
// lo que muere por timeout. Ver docs/adr-universo-precalculado.md.
//
// Diferencias con scanResultPayload, las dos deliberadas:
//   - `metrics` lleva la proyección de lib/scanLightProjection.js (126 campos
//     medidos como suficientes, 7.233 B frente a 46.481 B) en vez de los ~200
//     campos con `?? null` campo a campo.
//   - `raw` va vacío. La columna es `not null default '{}'`, así que se
//     escribe el objeto vacío, no null. Quien necesite la fila entera de un
//     símbolo que no pasó tiene que reconstruirla; por eso los que SÍ pasan
//     conservan scanResultPayload intacto.
export function scanLightResultPayload(row = {}, scanId, ownerId, index, rejection = null) {
  return {
    owner_id: ownerId,
    scan_id: scanId,
    symbol: textOrNull(row.symbol) || "-",
    company_name: textOrNull(row.companyName || row.name || row.symbol),
    country: textOrNull(row.country),
    sector: textOrNull(row.sector),
    industry: textOrNull(row.industry),
    theme: textOrNull(row.theme),
    rank_index: index + 1,
    total_score: finiteOrNull(row.totalScore),
    weinstein_score: finiteOrNull(row.weinsteinScore),
    minervini_score: finiteOrNull(row.minerviniScore),
    risk_score: finiteOrNull(row.riskScore),
    rs_rating: finiteOrNull(row.rsGlobalPct ?? row.rsRating),
    metrics: scanLightMetrics(row, { rejection }),
    raw: {},
  };
}

// Tamaño de tanda de escritura, en filas.
//
// El muro es el statement_timeout de 8s del rol `authenticator` de Supabase,
// no el número de filas: lo que cuenta es cuántos MB de JSON viajan por
// petición. Medido en docs/adr-universo-precalculado.md (B.5, B.7):
//   - fila completa 46.481 B → 300 filas = 13,3 MB por tanda;
//   - fila ligera    7.233 B → 300 filas =  2,1 MB por tanda.
// Las completas siguen a 300 porque es el valor que ya corría en producción y
// esta tarea no cambia su comportamiento. Las ligeras caben de sobra a 300:
// pesan 6,4 veces menos por fila. writeMaterializedScan devuelve el tiempo
// real de cada tanda en `batches` para poder comprobarlo contra los 8s en vez
// de suponerlo.
const WRITE_BATCH_ROWS = 300;

export async function writeMaterializedScan(scan = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: false, ...disabledPayload() };
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
  const lightRows = Array.isArray(scan.lightRows) ? scan.lightRows : [];
  const [saved] = await supabaseRequest("scans", {
    method: "POST",
    query: "on_conflict=owner_id,local_id",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{
      owner_id: config.ownerId,
      local_id: textOrNull(scan.id) || crypto.randomUUID(),
      name: textOrNull(scan.name) || `Materialized scan ${new Date().toISOString()}`,
      preset: textOrNull(scan.preset || "materialized-cache"),
      settings: scan.settings || {},
      market_score: null,
      market_regime: "batch-cache",
      // Total de filas de scan_results de este escaneo, completas y ligeras.
      // app/api/scans/route.js compara row_count contra las filas devueltas
      // para avisar de truncado, y la retención de scan-universe.mjs suma esta
      // columna para reportar cuántas filas borra: si contara solo las
      // completas, ambas mentirían desde este cambio.
      row_count: rows.length + lightRows.length,
      created_at: toTimestamp(scan.createdAt),
      updated_at: new Date().toISOString(),
    }],
  });
  await supabaseRequest("scan_results", {
    method: "DELETE",
    query: `scan_id=eq.${encodeURIComponent(saved.id)}`,
  });

  // `batches` deja constancia de cuánto tardó y cuánto pesó cada petición.
  // Sin esto, "cabe en el statement_timeout de 8s" es una suposición: el
  // escaneo del universo ya murió una vez por escrituras demasiado grandes
  // (commit eb74eff), y el modo de fallo es un timeout a medias, no un error
  // limpio.
  const batches = [];
  const writeBatch = async (kind, payload) => {
    const body = JSON.stringify(payload);
    const startedAt = Date.now();
    await supabaseRequest("scan_results", {
      method: "POST",
      prefer: "return=minimal",
      body: payload,
    });
    batches.push({ kind, rows: payload.length, bytes: body.length, ms: Date.now() - startedAt });
  };

  for (let i = 0; i < rows.length; i += WRITE_BATCH_ROWS) {
    await writeBatch("full", rows.slice(i, i + WRITE_BATCH_ROWS).map((row, offset) => scanResultPayload(row, saved.id, config.ownerId, i + offset, scan.settings || {})));
  }
  // Las ligeras van DESPUÉS y su rank_index continúa donde acaban las
  // completas: quien lea `order=rank_index.asc` (app/api/scans/route.js) sigue
  // recibiendo primero las que pasan el preset, ordenadas por score, igual que
  // antes de este cambio.
  for (let i = 0; i < lightRows.length; i += WRITE_BATCH_ROWS) {
    await writeBatch("light", lightRows.slice(i, i + WRITE_BATCH_ROWS).map((item, offset) => scanLightResultPayload(item.row, saved.id, config.ownerId, rows.length + i + offset, item.rejection)));
  }
  clearScansApiCache();
  return {
    configured: true,
    saved: true,
    scanId: saved.id,
    localId: saved.local_id,
    rows: rows.length,
    lightRows: lightRows.length,
    totalRows: rows.length + lightRows.length,
    batches,
  };
}

// F-A1 del ADR "Descubrimiento global curado" (docs/adr-discovery-global-curated.md §9):
// progreso terminal del scan materializado, para que la RPC
// leaderboard_publishable_rows deje de excluir estas filas por parent_status
// nulo. Reutiliza el contrato de completitud del runner de servidor
// (computeTerminalCompleteness, lib/scanStatus.js):
//   - saved  = filas realmente persistidas en scan_results;
//   - errors = fallos duros de fetch/ensamblado (item de analyzeOne sin `row`:
//     provider caído, histórico insuficiente, assertDecisionGrade, etc.).
// Los rechazos de política (baseRejectReason: turnover, market cap, cobertura —
// items con `row`) y el filtrado del screener son exclusiones deliberadas del
// run: cuentan como trabajo completado, no como error, igual que en el scan de
// servidor el filtrado ocurre aguas abajo sin degradar la completitud.
// percentilesFinalized es SIEMPRE false: los percentiles del cron siguen siendo
// por lote (la finalización pertenece a la fase 3 del ADR de consolidación).
export function materializedScanProgress({ analyzed = [], savedRows = 0, total = 0, finishedAt = "" } = {}) {
  const items = Array.isArray(analyzed) ? analyzed : [];
  const hardErrors = items.filter((item) => item && item.ok !== true && !item.row).length;
  const completeness = computeTerminalCompleteness({ saved: savedRows, errors: hardErrors });
  return {
    status: completeness.status,
    completed: items.length,
    total: Math.max(Number(total) || 0, 0),
    saved: completeness.saved,
    errors: completeness.errors,
    finishedAt: finishedAt || new Date().toISOString(),
    percentilesFinalized: false,
  };
}

// El local_id de un escaneo materializado, en un solo sitio y testeable.
//
// - localIdPrefix saca una corrida del espacio de nombres del nocturno. Sin
//   él, una prueba acotada produce un local_id indistinguible del bueno y
//   readNightlyUsScan la toma como fuente de las Listas — pasó el 14 de
//   agosto de 2026 con una corrida --limit=300. El vocabulario de prefijos
//   vive en lib/scanLocalId.js, no aquí.
// - runStamp añade la hora de la corrida (t<HHMMSS>, UTC) tras la fecha:
//   convierte cada corrida en un escaneo DISTINTO. Sin ella, dos corridas del
//   mismo día con la misma población colisionan en el upsert de
//   writeMaterializedScan (on_conflict owner_id,local_id + DELETE de
//   scan_results antes de reinsertar): la segunda corrida destruye la primera
//   y, si muere a medias, la noche se queda sin datos. Lo usa el nocturno
//   (scripts/scan-universe.mjs); el cron rotatorio de Vercel conserva su
//   local_id diario a propósito — su contrato de "una corrida por grupo y
//   día que se corrige a sí misma reintentando" depende de ese upsert.
//   El sufijo va ANTES de o<offset>/l<count>: app/lists/page.jsx extrae el
//   número de analizados con /:l(\d+)$/ y debe seguir siendo el final.
export function materializedScanLocalId({ prefix = "", markets = [], now = new Date(), runStamp = false, offset = 0, symbolCount = 0 } = {}) {
  return [
    ...(cleanText(prefix) ? [cleanText(prefix).replace(/:+$/, "")] : []),
    "materialized",
    markets.join("-"),
    now.toISOString().slice(0, 10),
    ...(runStamp ? [`t${now.toISOString().slice(11, 19).replace(/:/g, "")}`] : []),
    `o${offset}`,
    `l${symbolCount}`,
  ].join(":");
}

export async function runMaterializedScan(options = {}) {
  const markets = normalizeMarketList(options.markets?.length ? options.markets : DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const maxPriceFreshnessDays = Number(options.maxPriceFreshnessDays || DEFAULT_PRICE_FRESHNESS_DAYS);
  options.onPhase?.("universe_select");
  const resolved = await resolveSymbols({ ...options, markets });
  options.onPhase?.("materialized_scan");
  const benchmarks = await hydrateBenchmarks({ ...options, maxPriceFreshnessDays });
  const selectedBySymbol = new Map((resolved.selectedRows || []).map((row) => [row.symbol, row]));
  const analyzed = await mapLimit(resolved.symbols, Number(options.concurrency || DEFAULT_CONCURRENCY), (symbol) => analyzeOne(symbol, benchmarks, {
    ...options,
    universeRow: selectedBySymbol.get(symbol),
    maxPriceFreshnessDays,
    maxFundamentalsAgeDays: Number(options.maxFundamentalsAgeDays || DEFAULT_FUNDAMENTALS_AGE_DAYS),
  }));
  const passedBase = analyzed.filter((item) => item.ok).map((item) => item.row);
  const sectorized = sectorize(passedBase);
  const filterResult = applyScreenerFilters(sectorized, options.screenerFilters);
  const byScore = (a, b) => (b.objectiveScore ?? b.totalScore ?? 0) - (a.objectiveScore ?? a.totalScore ?? 0);
  const rows = filterResult.rows
    .sort(byScore)
    .slice(0, Math.max(Number(options.maxSavedRows || 500), 1));

  // ── La población que NO pasa el preset ──────────────────────────────────
  // Hasta ahora se descartaba aquí, y con ella el 98,9% del trabajo de la
  // noche: 62 filas guardadas de 5.608 analizadas el 14 de agosto de 2026.
  // Sin población no hay sobre qué filtrar — el preset de deterioro
  // selecciona 165 valores sobre el universo y CERO sobre lo que se guardaba,
  // y las Listas pasan de 11 filas a entre 241 y 490 según la sección
  // (docs/adr-universo-precalculado.md, D.11).
  //
  // Salen de `sectorized`, el MISMO array que ya alimentaba el filtro. Eso no
  // es un detalle: `sectorize()` calcula rsGlobalPct y sectorScore sobre la
  // población que recibe, así que reutilizar esa llamada garantiza que ni una
  // sola señal cambia de valor por este cambio — ni para las que pasan ni
  // para las que no.
  //
  // Los símbolos que fallaron `baseRejectReason` (sin precio, menos de 180
  // barras, precio viejo, turnover/capitalización/cobertura por debajo del
  // mínimo) NO entran: el sistema declara que sus señales no son fiables, y
  // guardarlas contradiría el principio 3 de docs/principios-producto.md.
  // Cuántos son se persiste ahora en settings.population para poder decidirlo
  // con datos en una fase posterior.
  const passedScreenSymbols = new Set(filterResult.rows.map((row) => row.symbol));
  const rejectionBySymbol = new Map((filterResult.rejections || []).map((item) => [item.symbol, item]));
  const maxLightRows = Math.max(Number(options.maxLightRows || DEFAULT_MAX_LIGHT_ROWS), 0);
  const lightCandidates = sectorized.filter((row) => !passedScreenSymbols.has(row.symbol)).sort(byScore);
  const lightRows = lightCandidates
    .slice(0, maxLightRows)
    .map((row) => ({ row, rejection: rejectionBySymbol.get(row.symbol) || null }));
  const now = new Date();
  const historyScoringPool = sectorize(
    analyzed
      .filter((item) => item.row && (item.ok === true || !insufficientDataRejection(item.rejection)))
      .map((item) => cloneForHistoryScoring(item.row)),
  );
  const historyObservations = materializedScanHistoryObservations({
    analyzed,
    scoredRows: historyScoringPool,
    passedRows: filterResult.rows,
    filterRejections: filterResult.rejections,
    observedAt: now.toISOString(),
  });
  const effectiveOffset = firstFinite(options.marketOffsets?.[markets[0]], options.offset, 0) || 0;
  const localId = materializedScanLocalId({
    prefix: options.localIdPrefix,
    markets,
    now,
    runStamp: Boolean(options.localIdRunStamp),
    offset: effectiveOffset,
    symbolCount: resolved.symbols.length,
  });
  const scan = {
    id: localId,
    name: `Materialized scan ${markets.join(",")} ${now.toISOString().slice(0, 10)}`,
    preset: "materialized-cache",
    createdAt: now.toISOString(),
    settings: {
      source: "jobs/scan-refresh",
      legalMode: "derived-signals-only",
      markets,
      limit: Number(options.limit || DEFAULT_LIMIT),
      perMarket: Number(options.perMarket || 0),
      offset: effectiveOffset,
      marketOffsets: resolved.selection?.marketOffsets || {},
      nextMarketOffsets: resolved.selection?.nextMarketOffsets || {},
      shadowSource: options.shadowSource || null,
      maxPriceFreshnessDays,
      maxFundamentalsAgeDays: Number(options.maxFundamentalsAgeDays || DEFAULT_FUNDAMENTALS_AGE_DAYS),
      minBars: Number(options.minBars || 180),
      minPrice: Number(options.minPrice ?? 1),
      minAvgTurnover: Number(options.minAvgTurnover ?? 250000),
      minMarketCap: Number(options.minMarketCap ?? 300000000),
      minCoverageScore: Number(options.minCoverageScore ?? 40),
      skipRecentlyScanned: Boolean(options.skipRecentlyScanned),
      recentScanDays: Number(options.recentScanDays || DEFAULT_SKIP_RECENT_SCAN_DAYS),
      materializationLookbackDays: Number(options.materializationLookbackDays || DEFAULT_MATERIALIZATION_LOOKBACK_DAYS),
      prioritizeMaterialization: options.prioritizeMaterialization !== false,
      priorityMode: resolved.selection?.priorityMode || "cursor",
      universeTotal: resolved.universeTotal,
      publishedRowCount: rows.length + lightRows.length,
      screenerFilters: filterResult.summary,
      // Recuento de la corrida, persistido. Antes solo vivía en `stats`, que
      // se devuelve y se tira: docs/adr-universo-precalculado.md tuvo que
      // marcar `passedBase` como no verificable precisamente por esto. Es el
      // dato que convierte "62 filas" en "62 de 5.608, de las que 2.9xx
      // llegaron al filtro".
      population: {
        analyzed: analyzed.length,
        passedBase: passedBase.length,
        passedScreen: filterResult.rows.length,
        storedFull: rows.length,
        storedLight: lightRows.length,
        stored: rows.length + lightRows.length,
        // Truncados a propósito, para que un tope no se lea como "no había más".
        droppedByMaxSavedRows: Math.max(filterResult.rows.length - rows.length, 0),
        droppedByMaxLightRows: Math.max(lightCandidates.length - lightRows.length, 0),
      },
      progress: materializedScanProgress({
        analyzed,
        // Filas realmente persistidas, que desde este cambio son las completas
        // MÁS las ligeras. La alternativa —seguir contando solo las completas—
        // dejaría `saved: 62` con 3.000 filas escritas, que es sencillamente
        // falso. El estado no cambia de clase por esto: computeTerminalCompleteness
        // solo devuelve "complete" cuando errors === 0, y los errores duros no
        // se tocan aquí.
        savedRows: rows.length + lightRows.length,
        total: resolved.symbols.length,
        finishedAt: now.toISOString(),
      }),
    },
    rows,
    lightRows,
  };
  return {
    scan,
    history: {
      observedAt: now.toISOString(),
      observations: historyObservations,
      scopeMicCodes: micCodesForScanMarkets(markets),
      authoritativeUniverse: authoritativeUniverseSnapshot(resolved.snapshot, markets),
      universeSymbols: resolved.snapshot?.universe?.map((row) => row.symbol).filter(Boolean) || [],
      dataProvider: "yahoo",
    },
    stats: {
      markets,
      universeTotal: resolved.universeTotal,
      selected: resolved.symbols.length,
      passedBase: passedBase.length,
      passedFilters: filterResult.rows.length,
      savedRows: rows.length,
      savedLightRows: lightRows.length,
      droppedByMaxLightRows: Math.max(lightCandidates.length - lightRows.length, 0),
      rejected: analyzed.filter((item) => !item.ok).length,
      rejections: analyzed.filter((item) => !item.ok).slice(0, 30).map((item) => ({ symbol: item.symbol, reason: item.rejection })),
      filterRejections: filterResult.rejections.slice(0, 30),
      screenerFilters: filterResult.summary,
      selection: resolved.selection || {},
      recentScanExclusion: resolved.recentScanExclusion || { enabled: false },
      shadowSource: options.shadowSource || null,
      cache: resolved.snapshot?.cache || null,
      benchmarks: Object.fromEntries(Object.entries(benchmarks).map(([symbol, chart]) => [symbol, { bars: chart.bars?.length || 0, error: chart.error || "" }])),
    },
  };
}

export async function readScanBatchCursor() {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, value: {}, ...disabledPayload() };
  const rows = await supabaseRequest("app_settings", {
    query: `owner_id=eq.${encodeURIComponent(config.ownerId)}&setting_type=eq.${SCAN_CURSOR_SETTING_TYPE}&setting_key=eq.${SCAN_CURSOR_SETTING_KEY}&select=*&limit=1`,
  });
  const row = rows?.[0] || null;
  return {
    configured: true,
    value: row?.value && typeof row.value === "object" ? row.value : {},
    updatedAt: row?.updated_at || "",
  };
}

export async function writeScanBatchCursor(value = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: false, ...disabledPayload() };
  const saved = await supabaseRequest("app_settings", {
    method: "POST",
    query: "on_conflict=owner_id,setting_type,setting_key",
    prefer: "resolution=merge-duplicates,return=representation",
    body: [{
      owner_id: config.ownerId,
      setting_type: SCAN_CURSOR_SETTING_TYPE,
      setting_key: SCAN_CURSOR_SETTING_KEY,
      value,
      updated_at: new Date().toISOString(),
    }],
  });
  return { configured: true, saved: true, updatedAt: saved?.[0]?.updated_at || new Date().toISOString(), value };
}

export async function refreshDefaultLeaderboards({ sinceDays = 45, maxRows = 10000 } = {}) {
  const scanData = await readScanRows({ sinceDays, maxRows });
  if (!scanData.configured) return { skipped: true, saved: 0, message: scanData.message };
  const leaderboards = DEFAULT_LEADERBOARD_SPECS.map((spec) => buildLeaderboard(scanData.rows, spec));
  return writeMaterializedLeaderboards(leaderboards);
}

// ---------------------------------------------------------------------------
// SEAM DE TEST — Camino A
// ---------------------------------------------------------------------------
// Estas exportaciones existen ÚNICAMENTE para que la auditoría de Camino A
// pueda ejecutar buildResearchRow y sectorize privados con una fixture
// determinista, sin tener que ejercitar runMaterializedScan (que requiere
// Supabase + red). El prefijo _forTest es deliberado y ruidoso para que
// cualquier consumer no-auditoría sea visible en code review.
//
// NO modifican la lógica: son los mismos bindings internos. Si alguien las
// usa desde código de producto, queda fuera del scope de Camino A.
// ---------------------------------------------------------------------------
export const _forTest = Object.freeze({
  buildResearchRow,
  sectorize,
  baseRejectReason,
  dataCoverageForRow,
});
