import { fetchAsicShortInterest, mergeAsicShortInterest } from "@/lib/asicShort";
import { businessThemeKey } from "@/lib/businessTheme";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { withProfileCache } from "@/lib/fundamentalsCache";
import { buildLeaderboard, DEFAULT_LEADERBOARD_SPECS, readScanRows, writeMaterializedLeaderboards } from "@/lib/leaderboards";
import { DEFAULT_SCAN_MARKETS, normalizeMarketList } from "@/lib/markets";
import { applyScreenerFilters, scoreWeakness } from "@/lib/screenerFilters";
import { setupPatternForBars } from "@/lib/setupPatterns";
import { countryCode } from "@/lib/symbols";
import { disabledPayload, finiteOrNull, supabaseConfig, supabaseRequest, supabaseRequestAll, textOrNull, toTimestamp } from "@/lib/supabaseServer";
import { isConfirmedStage2 } from "@/lib/trendStructure";
import { getUniverseEngineSnapshot } from "@/lib/universeEngine";
import { benchmarkSymbolForRow, enrichRelativePercentiles, rsPrimaryValue, scoreRelativeStrength, scoreRsQuality } from "@/lib/relativeStrength";
import { weeklyStageFields, weeklyStageForBars } from "@/lib/weeklyStage";
import { fetchYahooChart, fetchYahooProfile } from "@/lib/yahoo";

export const DEFAULT_MATERIALIZED_MARKETS = DEFAULT_SCAN_MARKETS;

const DEFAULT_PRICE_FRESHNESS_DAYS = 5;
const DEFAULT_FUNDAMENTALS_AGE_DAYS = 14;
const DEFAULT_LIMIT = 40;
const DEFAULT_PER_MARKET = 10;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_SKIP_RECENT_SCAN_DAYS = 45;
const DEFAULT_RECENT_SCAN_MAX_ROWS = 20000;
const DEFAULT_MATERIALIZATION_LOOKBACK_DAYS = 365;
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

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function avg(values = []) {
  const xs = values.filter(Number.isFinite);
  return xs.length ? xs.reduce((sum, value) => sum + value, 0) / xs.length : null;
}

function gt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value > threshold; }
function gte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value >= threshold; }
function lt(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value < threshold; }
function lte(value, threshold) { return Number.isFinite(value) && Number.isFinite(threshold) && value <= threshold; }
function between(value, min, max) { return gte(value, min) && lte(value, max); }

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
      volume: firstFinite(bar.volume) ?? 0,
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
  for (let i = 0; i < Math.min(n, bars.length - 1); i += 1) {
    const volume = bars[i].volume || 0;
    if (bars[i].close >= bars[i + 1].close) up += volume;
    else down += volume;
  }
  return down ? up / down : null;
}

function monthsSince(date = "") {
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  return (now.getFullYear() - parsed.getFullYear()) * 12 + now.getMonth() - parsed.getMonth();
}

function theme(sector = "", industry = "", summary = "") { return businessThemeKey(sector, industry, summary); }

function scoreWeinstein(row) {
  let score = 0;
  if (gt(row.price, row.sma150)) score += 18;
  if (gt(row.sma150, row.sma200)) score += 18;
  if (gt(row.sma200Slope, 0)) score += 18;
  if (gt(row.price, row.sma50)) score += 14;
  if (gt(row.sma50, row.sma150)) score += 14;
  if (gte(row.distance52w, -25)) score += 10;
  if (gt(row.perf6m, 0)) score += 8;
  return clamp(score);
}

function scoreMinervini(row) {
  let score = 0;
  if (gt(row.price, row.sma150) && gt(row.price, row.sma200)) score += 14;
  if (gt(row.sma150, row.sma200)) score += 12;
  if (gt(row.sma200Slope, 0)) score += 12;
  if (gt(row.sma50, row.sma150) && gt(row.sma50, row.sma200)) score += 12;
  if (gt(row.price, row.sma50)) score += 10;
  if (gte(row.lowAdvance52w, 30)) score += 12;
  if (gte(row.distance52w, -25)) score += 8;
  if (gte(row.distance20d, -10)) score += 8;
  if (lte(row.highsSpreadPct, 12)) score += 6;
  if (gt(row.perf3m, 10)) score += 6;
  return clamp(score);
}

function scoreMomentum(row) {
  let score = 0;
  if (gte(row.perf3m, 20)) score += 35;
  else if (gte(row.perf3m, 10)) score += 25;
  else if (gte(row.perf3m, 0)) score += 12;
  if (gte(row.perf6m, 40)) score += 35;
  else if (gte(row.perf6m, 20)) score += 25;
  else if (gte(row.perf6m, 5)) score += 12;
  if (gte(row.perf12m, 80)) score += 30;
  else if (gte(row.perf12m, 40)) score += 22;
  else if (gte(row.perf12m, 15)) score += 12;
  return clamp(score);
}

function scoreRisk(row) {
  const ext = row.extSma50;
  let score = 0;
  if (between(ext, -3, 8)) score += 38;
  else if (between(ext, -8, 15)) score += 30;
  else if (lte(ext, 25)) score += 18;
  else if (lte(ext, 35)) score += 8;
  if (gte(row.distance20d, -5)) score += 22;
  else if (gte(row.distance20d, -10)) score += 14;
  if (gte(row.distance50d, -10)) score += 18;
  else if (gte(row.distance50d, -18)) score += 10;
  if (gt(row.price, row.sma50)) score += 22;
  return clamp(score);
}

function scoreRiskReward(row) {
  let score = 0;
  if (gte(row.returnToVol3m, 1.2)) score += 26;
  else if (gte(row.returnToVol3m, .8)) score += 20;
  else if (gte(row.returnToVol3m, .35)) score += 12;
  else if (gte(row.returnToVol3m, 0)) score += 4;
  if (gte(row.returnToDrawdown3m, 2.5)) score += 26;
  else if (gte(row.returnToDrawdown3m, 1.5)) score += 18;
  else if (gte(row.returnToDrawdown3m, .8)) score += 10;
  else if (gte(row.returnToDrawdown3m, 0)) score += 4;
  if (Number.isFinite(row.volatility63d)) {
    if (row.volatility63d <= 25) score += 18;
    else if (row.volatility63d <= 40) score += 12;
    else if (row.volatility63d <= 60) score += 6;
  }
  if (Number.isFinite(row.maxDrawdown63d)) {
    if (row.maxDrawdown63d <= 10) score += 20;
    else if (row.maxDrawdown63d <= 18) score += 14;
    else if (row.maxDrawdown63d <= 32) score += 7;
  }
  if (Number.isFinite(row.maxDailyMove20dPct)) {
    if (row.maxDailyMove20dPct <= 8) score += 8;
    else if (row.maxDailyMove20dPct <= 14) score += 4;
  }
  if (Number.isFinite(row.range63dPct)) {
    if (row.range63dPct <= 55) score += 6;
    else if (row.range63dPct <= 85) score += 3;
  }
  if (gt(row.perf3m, 0)) score += 10;
  return clamp(score);
}

function scoreVolumeEffect(row) {
  let score = 0;
  if (gte(row.latestTurnover, 25000000)) score += 24;
  else if (gte(row.latestTurnover, 10000000)) score += 18;
  else if (gte(row.latestTurnover, 3000000)) score += 10;
  else if (gte(row.latestTurnover, 1000000)) score += 5;
  if (gte(row.latestVolume, 2000000)) score += 15;
  else if (gte(row.latestVolume, 500000)) score += 11;
  else if (gte(row.latestVolume, 150000)) score += 6;
  if (gte(row.relativeVolume, 2.2)) score += 22;
  else if (gte(row.relativeVolume, 1.6)) score += 16;
  else if (gte(row.relativeVolume, 1.2)) score += 9;
  else if (gte(row.relativeVolume, 1)) score += 4;
  if (gte(row.volumeSurgePct, 80)) score += 17;
  else if (gte(row.volumeSurgePct, 35)) score += 12;
  else if (gte(row.volumeSurgePct, 15)) score += 6;
  if (gte(row.upDownVolRatio, 1.8)) score += 16;
  else if (gte(row.upDownVolRatio, 1.25)) score += 11;
  else if (gte(row.upDownVolRatio, 1)) score += 5;
  if (row.upVolume === true && gte(row.relativeVolume, 1.1)) score += 6;
  return clamp(score);
}

function scoreVolume(row) {
  let score = 0;
  if (gte(row.avgTurnover, 25000000)) score += 22;
  else if (gte(row.avgTurnover, 10000000)) score += 16;
  else if (gte(row.avgTurnover, 3000000)) score += 9;
  if (gte(row.avgVolume, 1000000)) score += 22;
  else if (gte(row.avgVolume, 300000)) score += 15;
  else if (gte(row.avgVolume, 100000)) score += 8;
  if (gte(row.upDownVolRatio, 1.5)) score += 20;
  else if (gte(row.upDownVolRatio, 1.1)) score += 14;
  else if (gte(row.upDownVolRatio, .9)) score += 7;
  if (gte(row.relativeVolume, 1.8)) score += 14;
  else if (gte(row.relativeVolume, 1.3)) score += 9;
  else if (gte(row.relativeVolume, 1.05)) score += 4;
  if (gte(row.volumeSurgePct, 50)) score += 12;
  else if (gte(row.volumeSurgePct, 25)) score += 8;
  else if (gte(row.volumeSurgePct, 10)) score += 4;
  score += (row.volumeEffectScore || 0) * .1;
  return clamp(score);
}

function scoreLiquidity(row) {
  let score = 0;
  if (gte(row.marketCap, 1000000000)) score += 35;
  else if (gte(row.marketCap, 300000000)) score += 24;
  else if (gte(row.marketCap, 150000000)) score += 12;
  if (gte(row.avgTurnover, 25000000)) score += 30;
  else if (gte(row.avgTurnover, 10000000)) score += 22;
  else if (gte(row.avgTurnover, 3000000)) score += 12;
  if (gte(row.avgVolume, 1000000)) score += 22;
  else if (gte(row.avgVolume, 300000)) score += 15;
  else if (gte(row.avgVolume, 100000)) score += 7;
  if (gte(row.price, 5)) score += 13;
  else if (gte(row.price, 3)) score += 7;
  return clamp(score);
}

function scoreSetupQuality(row) {
  let score = 0;
  if (isStage2(row)) score += 28;
  else if (gt(row.price, row.sma200) && gte(row.sma200Slope, 0)) score += 18;
  else if (gt(row.price, row.sma200)) score += 10;
  if (gt(row.price, row.sma50)) score += 10;
  if (gt(row.sma50, row.sma150)) score += 8;
  if (gte(row.distance52w, -5)) score += 16;
  else if (gte(row.distance52w, -15)) score += 11;
  else if (gte(row.distance52w, -25)) score += 6;
  if (gte(row.distance20d, -5)) score += 10;
  else if (gte(row.distance20d, -10)) score += 6;
  if (Number.isFinite(row.extSma50)) {
    if (row.extSma50 >= -4 && row.extSma50 <= 9) score += 16;
    else if (row.extSma50 <= 18) score += 11;
    else if (row.extSma50 <= 28) score += 4;
  }
  if (lte(row.highsSpreadPct, 8)) score += 7;
  else if (lte(row.highsSpreadPct, 15)) score += 4;
  if (Number.isFinite(row.patternQualityScore)) score += Math.min(10, row.patternQualityScore * .1);
  if (Number.isFinite(row.contractionScore)) score += Math.min(6, row.contractionScore * .06);
  if (row.vcpCandidate) score += 10;
  if (row.breakoutAttempt) score += 6;
  if (Number.isFinite(row.breakoutQualityScore)) score += Math.min(8, row.breakoutQualityScore * .08);
  if (Number.isFinite(row.distanceToPivotPct) && row.distanceToPivotPct >= -5 && row.distanceToPivotPct <= 3) score += 5;
  if (Number.isFinite(row.volumeDryUpRatio) && row.volumeDryUpRatio <= .85) score += 4;
  if (row.failedBreakout) score -= 12;
  return clamp(score);
}

function scoreGrowthQuality(metrics = {}) {
  const values = ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "roe", "roa", "debtToEquity", "currentRatio"].map((key) => metrics[key]);
  if (!values.some(Number.isFinite)) return 45;
  let score = 28;
  if (gte(metrics.revenueGrowth, 30)) score += 19; else if (gte(metrics.revenueGrowth, 15)) score += 15; else if (gte(metrics.revenueGrowth, 5)) score += 9; else if (gte(metrics.revenueGrowth, 0)) score += 4; else if (Number.isFinite(metrics.revenueGrowth)) score -= 6;
  if (gte(metrics.earningsGrowth, 35)) score += 19; else if (gte(metrics.earningsGrowth, 15)) score += 14; else if (gte(metrics.earningsGrowth, 0)) score += 7; else if (Number.isFinite(metrics.earningsGrowth)) score -= 8;
  if (gte(metrics.grossMargin, 55)) score += 10; else if (gte(metrics.grossMargin, 35)) score += 6; else if (lt(metrics.grossMargin, 20)) score -= 4;
  if (gte(metrics.operatingMargin, 25)) score += 9; else if (gte(metrics.operatingMargin, 12)) score += 6; else if (lt(metrics.operatingMargin, 0)) score -= 5;
  if (gte(metrics.profitMargin, 20)) score += 8; else if (gte(metrics.profitMargin, 8)) score += 5; else if (lt(metrics.profitMargin, 0)) score -= 7;
  if (gte(metrics.roe, 25)) score += 8; else if (gte(metrics.roe, 12)) score += 5;
  if (gte(metrics.roa, 10)) score += 5; else if (gte(metrics.roa, 5)) score += 3;
  if (Number.isFinite(metrics.debtToEquity)) {
    if (metrics.debtToEquity <= 60) score += 5;
    else if (metrics.debtToEquity > 180) score -= 6;
  }
  if (Number.isFinite(metrics.currentRatio)) {
    if (metrics.currentRatio >= 1.4) score += 4;
    else if (metrics.currentRatio < .9) score -= 4;
  }
  return clamp(score);
}

function scoreEpsGrowthProxy(metrics = {}) {
  if (![metrics.revenueGrowth, metrics.earningsGrowth, metrics.operatingMargin, metrics.profitMargin, metrics.roe, metrics.roa].some(Number.isFinite)) return null;
  let score = 35;
  if (gte(metrics.earningsGrowth, 50)) score += 24; else if (gte(metrics.earningsGrowth, 25)) score += 18; else if (gte(metrics.earningsGrowth, 10)) score += 11; else if (gte(metrics.earningsGrowth, 0)) score += 5; else if (Number.isFinite(metrics.earningsGrowth)) score -= 12;
  if (gte(metrics.revenueGrowth, 30)) score += 18; else if (gte(metrics.revenueGrowth, 15)) score += 13; else if (gte(metrics.revenueGrowth, 5)) score += 7; else if (gte(metrics.revenueGrowth, 0)) score += 3; else if (Number.isFinite(metrics.revenueGrowth)) score -= 8;
  if (gte(metrics.operatingMargin, 25)) score += 10; else if (gte(metrics.operatingMargin, 12)) score += 6; else if (lt(metrics.operatingMargin, 0)) score -= 7;
  if (gte(metrics.profitMargin, 18)) score += 8; else if (gte(metrics.profitMargin, 8)) score += 5; else if (lt(metrics.profitMargin, 0)) score -= 8;
  if (gte(metrics.roe, 22)) score += 8; else if (gte(metrics.roe, 12)) score += 5;
  if (gte(metrics.roa, 10)) score += 5; else if (gte(metrics.roa, 5)) score += 3;
  if (Number.isFinite(metrics.debtToEquity)) {
    if (metrics.debtToEquity <= 60) score += 4;
    else if (metrics.debtToEquity > 180) score -= 5;
  }
  if (Number.isFinite(metrics.currentRatio) && metrics.currentRatio < .9) score -= 4;
  return Math.round(clamp(score));
}

function scoreAdProxy(row = {}) {
  let score = 45;
  if (gte(row.upDownVolRatio, 2)) score += 20;
  else if (gte(row.upDownVolRatio, 1.5)) score += 15;
  else if (gte(row.upDownVolRatio, 1.15)) score += 9;
  else if (Number.isFinite(row.upDownVolRatio) && row.upDownVolRatio < .75) score -= 15;
  else if (Number.isFinite(row.upDownVolRatio) && row.upDownVolRatio < .95) score -= 8;
  if (row.upVolume === true && gte(row.relativeVolume, 1.1)) score += 10;
  if (row.upVolume === false && gte(row.relativeVolume, 1.2)) score -= 10;
  if (gte(row.volumeSurgePct, 50) && gte(row.perf3m, 0)) score += 10;
  else if (gte(row.volumeSurgePct, 20) && gte(row.perf3m, 0)) score += 6;
  if (gte(row.relativeVolume, 1.5) && gte(row.distance20d, -8)) score += 8;
  if (gte(row.distance52w, -15)) score += 7;
  else if (Number.isFinite(row.distance52w) && row.distance52w < -35) score -= 7;
  if (gt(row.price, row.sma50)) score += 5;
  else if (Number.isFinite(row.price) && Number.isFinite(row.sma50)) score -= 5;
  if (gt(row.maxDrawdown63d, 32)) score -= 6;
  return Math.round(clamp(score));
}

function scoreDemandQuality(row) {
  let score = 0;
  const rs = rsPrimaryValue(row) ?? 50;
  if (rs >= 90) score += 34;
  else if (rs >= 80) score += 29;
  else if (rs >= 70) score += 22;
  else if (rs >= 55) score += 13;
  score += (row.volumeScore || 0) * .28;
  score += (row.volumeEffectScore || 0) * .12;
  score += (row.liquidityScore || 0) * .14;
  if (gte(row.upDownVolRatio, 1.8)) score += 18;
  else if (gte(row.upDownVolRatio, 1.3)) score += 13;
  else if (gte(row.upDownVolRatio, 1)) score += 7;
  if (gte(row.relativeVolume, 1.5)) score += 8;
  else if (gte(row.relativeVolume, 1.2)) score += 5;
  if (gte(row.volumeSurgePct, 35)) score += 6;
  else if (gte(row.volumeSurgePct, 15)) score += 3;
  if (gte(row.avgVolume, 1000000)) score += 6;
  else if (gte(row.avgVolume, 300000)) score += 3;
  return clamp(score);
}

function isStage2(row = {}) {
  return isConfirmedStage2(row);
}

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
  if (technicalCoverageScore < 70) issues.push("tecnico parcial");
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

function compositeLabel(score) {
  if (score >= 85) return "Elite";
  if (score >= 75) return "Leader";
  if (score >= 65) return "Fuerte";
  if (score >= 55) return "Watchlist";
  return "Revisar";
}

function sectorize(rows = []) {
  const groups = {};
  for (const row of rows) (groups[row.theme] ??= []).push(row);
  const sectorScores = {};
  Object.entries(groups).forEach(([key, group]) => {
    const avg3 = avg(group.map((row) => row.perf3m || 0));
    const avg6 = avg(group.map((row) => row.perf6m || 0));
    const leaders = group.filter((row) => row.weinsteinScore >= 80 || row.minerviniScore >= 80).length;
    sectorScores[key] = clamp(clamp(group.length * 10, 0, 25) + clamp(avg3, 0, 20) + clamp(avg6 / 2, 0, 20) + clamp(leaders * 7, 0, 15) + (/Semis|fotonica|Defensa|Software|Energia|Automatizacion/.test(key) ? 20 : 10));
  });
  return enrichRelativePercentiles(rows).map((row) => {
    const sectorScore = sectorScores[row.theme] || 40;
    const setupQualityScore = scoreSetupQuality(row);
    const demandScore = scoreDemandQuality(row);
    const growthScore = scoreGrowthQuality(row.growthMetrics || {});
    const adProxyScore = Number.isFinite(row.adProxyScore) ? row.adProxyScore : scoreAdProxy(row);
    const epsGrowthProxyScore = Number.isFinite(row.epsGrowthProxyScore) ? row.epsGrowthProxyScore : scoreEpsGrowthProxy(row.growthMetrics || {});
    const riskRewardScore = Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45;
    const rsAnchor = Number.isFinite(row.rsGlobalPct) ? row.rsGlobalPct : (row.rsRating || 50);
    const rsQuality = scoreRsQuality({ ...row, riskRewardScore });
    const rsQualityScore = Number.isFinite(rsQuality?.rsQualityScore) ? rsQuality.rsQualityScore : rsAnchor;
    const epsAnchor = Number.isFinite(epsGrowthProxyScore) ? epsGrowthProxyScore : growthScore;
    const compositeScore = setupQualityScore * .17 + rsAnchor * .16 + rsQualityScore * .06 + demandScore * .1 + adProxyScore * .08 + growthScore * .08 + epsAnchor * .08 + sectorScore * .1 + riskRewardScore * .08 + row.riskScore * .05 + row.momentumScore * .02;
    return {
      ...row,
      ...rsQuality,
      sectorScore,
      groupStrengthScore: sectorScore,
      setupQualityScore,
      demandScore,
      growthScore,
      adProxyScore,
      epsGrowthProxyScore,
      riskRewardScore,
      totalScore: compositeScore,
      compositeScore,
      compositeLabel: compositeLabel(compositeScore),
    };
  });
}

function compactChartPreview(bars = [], limit = 48) {
  return bars.slice(0, Math.min(limit, bars.length)).map((bar) => ({
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
  const bars = normalizeBars(chart.bars || []);
  if (bars.length < 20) throw new Error(`Historico insuficiente: ${bars.length}/20`);
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
  const avgVol20 = avg(bars.slice(0, 20).map((bar) => bar.volume || 0));
  const avgVol5 = avg(bars.slice(0, 5).map((bar) => bar.volume || 0));
  const prevVol20 = avg(bars.slice(5, 25).map((bar) => bar.volume || 0));
  const latestVolume = bars[0]?.volume || 0;
  const perf3m = perf(calcBars, 63);
  const perf6m = perf(calcBars, 126);
  const perf12m = perf(calcBars, 252);
  const weeklyStage = weeklyStageForBars(calcBars, options);
  const setupPattern = setupPatternForBars(calcBars);
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
    website: profile.website || "",
    growthMetrics: profile.growthMetrics || {},
    shortPercentOfFloat: Number.isFinite(profile.shortPercentOfFloat) ? profile.shortPercentOfFloat : profile.growthMetrics?.shortPercentOfFloat,
    sharesPercentSharesOut: Number.isFinite(profile.sharesPercentSharesOut) ? profile.sharesPercentSharesOut : profile.growthMetrics?.sharesPercentSharesOut,
    shortRatio: Number.isFinite(profile.shortRatio) ? profile.shortRatio : profile.growthMetrics?.shortRatio,
    sharesShort: Number.isFinite(profile.sharesShort) ? profile.sharesShort : profile.growthMetrics?.sharesShort,
    floatShares: Number.isFinite(profile.floatShares) ? profile.floatShares : profile.growthMetrics?.floatShares,
    sharesOutstanding: Number.isFinite(profile.sharesOutstanding) ? profile.sharesOutstanding : profile.growthMetrics?.sharesOutstanding,
    price,
    priceSource: Number.isFinite(providerPrice) ? "proveedor" : "ultimo cierre",
    chartProvider: chart.meta?.dataProvider || "Yahoo Finance",
    chartFallbackReason: chart.meta?.fallbackReason || "",
    chartBarsCount: bars.length,
    marketCap: firstFinite(profile.marketCap),
    avgVolume: avgVol20,
    avgVolume5: avgVol5,
    prevAvgVolume20: prevVol20,
    latestVolume,
    avgTurnover: Number.isFinite(avgVol20) && Number.isFinite(price) ? avgVol20 * price : null,
    latestTurnover: Number.isFinite(latestVolume) && Number.isFinite(price) ? latestVolume * price : null,
    relativeVolume: avgVol20 ? latestVolume / avgVol20 : null,
    volumeSurgePct: prevVol20 ? ((avgVol5 / prevVol20) - 1) * 100 : null,
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
  row.weinsteinScore = scoreWeinstein(row);
  row.minerviniScore = scoreMinervini(row);
  row.momentumScore = scoreMomentum(row);
  row.riskScore = scoreRisk(row);
  row.riskRewardScore = scoreRiskReward(row);
  row.volumeEffectScore = scoreVolumeEffect(row);
  row.adProxyScore = scoreAdProxy(row);
  row.epsGrowthProxyScore = scoreEpsGrowthProxy(row.growthMetrics || {});
  row.volumeScore = scoreVolume(row);
  row.liquidityScore = scoreLiquidity(row);
  const benchmarkSymbol = benchmarkSymbolForRow(row);
  Object.assign(row, scoreRelativeStrength(row, benchmarks[benchmarkSymbol]?.bars || []), { benchmarkSymbol });
  const withCoverage = { ...row, ...dataCoverageForRow(row, profile) };
  return { ...withCoverage, ...scoreWeakness(withCoverage) };
}

function baseRejectReason(row = {}, options = {}) {
  const minBars = Number(options.minBars || 180);
  const minPrice = Number(options.minPrice ?? 1);
  const minAvgTurnover = Number(options.minAvgTurnover ?? 250000);
  const minMarketCap = Number(options.minMarketCap ?? 300000000);
  const minCoverageScore = Number(options.minCoverageScore ?? 40);
  if (!Number.isFinite(row.price) || row.price <= 0) return "precio no disponible";
  if (!Number.isFinite(row.chartBarsCount) || row.chartBarsCount < minBars) return `historico insuficiente ${row.chartBarsCount || 0}/${minBars}`;
  if (!row.priceFreshnessOk) return row.priceFreshnessIssue || "precio no fresco";
  if (Number.isFinite(minPrice) && row.price < minPrice) return `precio bajo ${row.price}`;
  if (Number.isFinite(minAvgTurnover) && (row.avgTurnover || 0) < minAvgTurnover) return `importe medio bajo ${Math.round(row.avgTurnover || 0)}`;
  if (Number.isFinite(row.marketCap) && Number.isFinite(minMarketCap) && row.marketCap < minMarketCap) return `market cap bajo ${Math.round(row.marketCap)}`;
  if (Number.isFinite(minCoverageScore) && (row.dataCoverageScore || 0) < minCoverageScore) return `cobertura baja ${row.dataCoverageScore || 0}`;
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

function latestScanStateFromRow(row = {}, recentDays = DEFAULT_SKIP_RECENT_SCAN_DAYS) {
  const metrics = objectValue(row.metrics);
  const createdAt = row.created_at || "";
  const ageDays = scanAgeDays(createdAt);
  const totalScore = firstFinite(row.total_score, metrics.totalScore, metrics.total_score);
  const verdictKey = cleanText(metrics.setupVerdictKey).toLowerCase();
  const verdictState = cleanText(metrics.setupVerdictState).toLowerCase();
  const structureKey = cleanText(metrics.setupStructureKey).toLowerCase();
  const patternFamily = cleanText(metrics.patternFamily).toLowerCase();
  const legacyActionable = metrics.setupActionable === true
    || metrics.setupDisplayActionable === true
    || verdictKey === "actionable_vcp"
    || verdictState === "actionable";
  const planValid = metrics.setupPlanValid === true
    || metrics.setupDisplayPlanValid === true;
  const watch = metrics.setupWatch === true || metrics.setupDisplayWatch === true || verdictState === "watch" || legacyActionable;
  const strict = metrics.setupStrict === true || metrics.setupDisplayStrict === true || structureKey === "vcp_strict";
  const patternCandidate = ["vcp_watch", "pivot_squeeze", "constructive_base", "breakout_observed"].includes(structureKey)
    || patternFamily === "progressive_contraction";
  const qualityScore = firstFinite(metrics.setupQualityScore, metrics.patternQualityScore, metrics.baseQualityScore);
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

function scanSelectionCursor(group = [], start = 0, take = 1, excludedSymbols = new Set()) {
  const selected = [];
  let cursor = Math.max(Number(start || 0), 0);
  let skippedRecent = 0;
  while (cursor < group.length && selected.length < take) {
    const row = group[cursor];
    cursor += 1;
    if (shouldExcludeUniverseRow(row, excludedSymbols)) {
      skippedRecent += 1;
      continue;
    }
    selected.push(row);
  }
  return {
    selected,
    cursor,
    skippedRecent,
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
  const rows = (snapshot.universe || [])
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

  const orderedRows = prioritizeMaterialization
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
    skippedRecentByMarket: {},
    priorityMode: prioritizeMaterialization ? "materialization-priority" : "cursor",
    selectedReasons: {},
    selectedReasonsByMarket: {},
    materialization: summarizeMaterializationCandidates(rows, options),
  };

  if (!perMarket) {
    const key = markets.length === 1 ? markets[0] : "GLOBAL";
    const start = options.marketOffsets ? marketOffsetFor(key, options) : offset;
    const result = scanSelectionCursor(orderedRows, start, limit, excludedSymbols);
    selection.selected = result.selected;
    selection.selectedByMarket[key] = selection.selected.length;
    selection.marketOffsets[key] = start;
    selection.nextMarketOffsets[key] = orderedRows.length && result.cursor < orderedRows.length ? result.cursor : 0;
    selection.skippedRecent = result.skippedRecent;
    selection.skippedRecentByMarket[key] = result.skippedRecent;
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
  const marketStarts = Object.fromEntries(markets.map((market) => [market, options.marketOffsets ? marketOffsetFor(market, options) : offset]));
  const marketCursors = { ...marketStarts };
  const skippedRecentByMarket = Object.fromEntries(markets.map((market) => [market, 0]));
  let added = true;
  while (selected.length < limit && added) {
    added = false;
    for (const market of markets) {
      if (selected.length >= limit) break;
      if (selectedByMarket[market] >= perMarket) continue;
      const group = groups[market] || [];
      const result = scanSelectionCursor(group, marketCursors[market], 1, excludedSymbols);
      marketCursors[market] = result.cursor;
      skippedRecentByMarket[market] += result.skippedRecent;
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
  }
  selection.selected = selected;
  selection.skippedRecent = Object.values(selection.skippedRecentByMarket).reduce((sum, value) => sum + Number(value || 0), 0);
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
  const snapshot = await getUniverseEngineSnapshot({
    markets,
    refresh: options.refreshUniverse,
    maxAgeHours: options.universeMaxAgeHours || 24,
  });
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
  try {
    const [chart, profile] = await Promise.all([
      fetchChartForScan(symbol, options),
      fetchProfileForScan(symbol, options).catch(() => ({})),
    ]);
    const row = buildResearchRow(symbol, chart, profile, benchmarks, options);
    const reject = baseRejectReason(row, options);
    if (reject) return { symbol, ok: false, rejection: reject, row };
    return { symbol, ok: true, row };
  } catch (error) {
    return { symbol, ok: false, rejection: error.message || "scan failed" };
  }
}

function scanResultPayload(row = {}, scanId, ownerId, index) {
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
    metrics: {
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
      patternDataStatus: row.patternDataStatus ?? null,
      patternEligible: row.patternEligible ?? null,
      patternIssues: row.patternIssues ?? null,
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
      lastContractionDepthPct: row.lastContractionDepthPct ?? null,
      contractionReductionPct: row.contractionReductionPct ?? null,
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
    },
    raw: row,
  };
}

export async function writeMaterializedScan(scan = {}) {
  const config = supabaseConfig();
  if (!config.configured) return { configured: false, saved: false, ...disabledPayload() };
  const rows = Array.isArray(scan.rows) ? scan.rows : [];
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
      row_count: rows.length,
      created_at: toTimestamp(scan.createdAt),
      updated_at: new Date().toISOString(),
    }],
  });
  await supabaseRequest("scan_results", {
    method: "DELETE",
    query: `scan_id=eq.${encodeURIComponent(saved.id)}`,
  });
  for (let i = 0; i < rows.length; i += 300) {
    await supabaseRequest("scan_results", {
      method: "POST",
      prefer: "return=minimal",
      body: rows.slice(i, i + 300).map((row, offset) => scanResultPayload(row, saved.id, config.ownerId, i + offset)),
    });
  }
  return { configured: true, saved: true, scanId: saved.id, localId: saved.local_id, rows: rows.length };
}

export async function runMaterializedScan(options = {}) {
  const markets = normalizeMarketList(options.markets?.length ? options.markets : DEFAULT_MATERIALIZED_MARKETS, DEFAULT_MATERIALIZED_MARKETS);
  const maxPriceFreshnessDays = Number(options.maxPriceFreshnessDays || DEFAULT_PRICE_FRESHNESS_DAYS);
  const resolved = await resolveSymbols({ ...options, markets });
  const benchmarks = await hydrateBenchmarks({ ...options, maxPriceFreshnessDays });
  const analyzed = await mapLimit(resolved.symbols, Number(options.concurrency || DEFAULT_CONCURRENCY), (symbol) => analyzeOne(symbol, benchmarks, {
    ...options,
    maxPriceFreshnessDays,
    maxFundamentalsAgeDays: Number(options.maxFundamentalsAgeDays || DEFAULT_FUNDAMENTALS_AGE_DAYS),
  }));
  const passedBase = analyzed.filter((item) => item.ok).map((item) => item.row);
  const sectorized = sectorize(passedBase);
  const filterResult = applyScreenerFilters(sectorized, options.screenerFilters);
  const rows = filterResult.rows
    .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))
    .slice(0, Math.max(Number(options.maxSavedRows || 500), 1));
  const now = new Date();
  const effectiveOffset = firstFinite(options.marketOffsets?.[markets[0]], options.offset, 0) || 0;
  const localId = [
    "materialized",
    markets.join("-"),
    now.toISOString().slice(0, 10),
    `o${effectiveOffset}`,
    `l${resolved.symbols.length}`,
  ].join(":");
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
      screenerFilters: filterResult.summary,
    },
    rows,
  };
  return {
    scan,
    stats: {
      markets,
      universeTotal: resolved.universeTotal,
      selected: resolved.symbols.length,
      passedBase: passedBase.length,
      passedFilters: filterResult.rows.length,
      savedRows: rows.length,
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
