import { fetchYahooProfile, fetchYahooChart, fetchYahooCompanyExtras } from "@/lib/marketData";
import { fetchSecFundamentals, mergeSecGrowthMetrics } from "@/lib/sec";
import { fetchFmpCompanyData } from "@/lib/fmp";
import { fetchAsicShortInterest, mergeAsicShortInterest } from "@/lib/asicShort";
import { inferBusinessTheme } from "@/lib/businessTheme";
import { externalLinks, inferTradingViewSymbol, isTradingViewWidgetBlocked } from "@/lib/symbols";
import { withProfileCache } from "@/lib/fundamentalsCache";
import { withDailyBarsCache } from "@/lib/dailyBarsCache";
import { scoreRsBenchmarkModel } from "@/lib/relativeStrength";
import { readGlobalRsSeriesForSymbol } from "@/lib/globalRs";
import { setupPatternForBars } from "@/lib/setupPatterns";
import { supabaseConfig, supabaseRequest, supabaseRpc } from "@/lib/supabaseServer";
import { weeklyStageForBars } from "@/lib/weeklyStage";

const BRIEF_CACHE_TYPE = "company_brief_cache";
const BRIEF_CACHE_VERSION = 2;
const DEFAULT_BRIEF_MAX_AGE_DAYS = 1;

function clean(s = "") { return String(s).replace(/\s+/g, " ").replace(/\([^)]*\)/g, "").trim(); }
function cleanBenchmarkSymbol(value = "") {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 24);
}
function firstSentences(s = "", max = 2) {
  const cleaned = clean(s);
  if (!cleaned) return "";
  const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  return parts.slice(0, max).join(" ");
}
function countryFromSymbol(symbol, profileCountry = "") {
  if (profileCountry) return profileCountry;
  const s = symbol.toUpperCase();
  const map = [[".TO", "Canada"], [".MC", "España"], [".DE", "Alemania"], [".F", "Alemania"], [".PA", "Francia"], [".AS", "Paises Bajos"], [".L", "Reino Unido"], [".SW", "Suiza"], [".ST", "Suecia"], [".CO", "Dinamarca"], [".OL", "Noruega"], [".HE", "Finlandia"], [".MI", "Italia"], [".BR", "Belgica"], [".LS", "Portugal"], [".VI", "Austria"], [".IR", "Irlanda"], [".T", "Japon"], [".HK", "Hong Kong"], [".SI", "Singapur"], [".JO", "Sudafrica"], [".AX", "Australia"], [".TW", "Taiwan"], [".TA", "Israel"], [".KS", "Corea del Sur"], [".KQ", "Corea del Sur"], [".NS", "India"], [".BO", "India"], [".SS", "China"], [".SZ", "China"], [".SA", "Brasil"], [".MX", "Mexico"]];
  return map.find(([x]) => s.endsWith(x))?.[1] || "Estados Unidos";
}
function normalizeWebsite(url = "") {
  if (!url) return "";
  let u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  try { return new URL(u).toString(); } catch { return ""; }
}
function domainFromUrl(url = "") { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } }
const COMPANY_ASSET_DOMAINS = {
  "0700.HK": "tencent.com",
  "3690.HK": "meituan.com",
  "9988.HK": "alibabagroup.com",
  "9618.HK": "jd.com",
  "1024.HK": "kuaishou.com",
  "9888.HK": "baidu.com",
  "9999.HK": "neteasegames.com",
  "1810.HK": "mi.com",
  "BILI": "bilibili.com",
  "PDD": "pinduoduo.com",
  "SE": "sea.com",
  "META": "meta.com",
  "GOOGL": "google.com",
  "NVDA": "nvidia.com",
  "AVGO": "broadcom.com",
  "AMD": "amd.com",
  "TSM": "tsmc.com",
  "2330.TW": "tsmc.com",
  "ASML.AS": "asml.com",
  "ARM": "arm.com",
  "ITX.MC": "inditex.com",
};
function assetDomainForSymbol(symbol = "", website = "") {
  return domainFromUrl(website) || COMPANY_ASSET_DOMAINS[String(symbol).toUpperCase()] || "";
}
function initials(name = "") { return clean(name).split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]?.toUpperCase()).join("") || "SE"; }
function sizeLabel(marketCap) {
  if (!Number.isFinite(marketCap) || marketCap <= 0) return "capitalizacion no disponible";
  if (marketCap >= 200e9) return "mega capitalizacion";
  if (marketCap >= 10e9) return "gran capitalizacion";
  if (marketCap >= 2e9) return "mediana capitalizacion";
  if (marketCap >= 300e6) return "pequeña/mediana capitalizacion";
  return "micro/small cap";
}
function fmtCap(n) {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} M`;
  return String(Math.round(n));
}
function oldestBarDate(bars = []) {
  const dates = (bars || [])
    .map((bar) => String(bar.date || "").slice(0, 10))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  return dates[0] || "";
}
function normalizeCurrency(currency = "") {
  const code = String(currency || "").trim().toUpperCase();
  if (code === "GBP" || code === "GBX" || code === "GBP=X" || code === "GBp".toUpperCase()) return "GBP";
  return code;
}
function fxSymbolsToUsd(currency = "") {
  const code = normalizeCurrency(currency);
  if (!code || code === "USD") return [];
  return [`${code}USD=X`, `USD${code}=X`];
}
async function marketCapUsdInfo(marketCap, currency = "", options = {}) {
  const code = normalizeCurrency(currency);
  if (!Number.isFinite(marketCap) || marketCap <= 0 || !code || code === "USD") return null;
  const [direct, inverse] = fxSymbolsToUsd(code);
  const fxOptions = { ...options, chartCache: options.chartCache !== false, maxPriceFreshnessDays: options.maxPriceFreshnessDays ?? 5 };
  const directChart = await fetchChartForBrief(direct, { range: "1M" }, fxOptions).catch(() => ({ bars: [] }));
  const directRate = directChart.bars?.[0]?.close;
  if (Number.isFinite(directRate) && directRate > 0) {
    const value = marketCap * directRate;
    return { value, label: `${fmtCap(value)} USD`, rate: directRate, pair: direct, source: "Yahoo Finance FX" };
  }
  const inverseChart = await fetchChartForBrief(inverse, { range: "1M" }, fxOptions).catch(() => ({ bars: [] }));
  const inverseRate = inverseChart.bars?.[0]?.close;
  if (Number.isFinite(inverseRate) && inverseRate > 0) {
    const rate = 1 / inverseRate;
    const value = marketCap * rate;
    return { value, label: `${fmtCap(value)} USD`, rate, pair: inverse, source: "Yahoo Finance FX" };
  }
  return { value: null, label: "", rate: null, pair: direct || inverse || "", source: "Proveedor no disponible" };
}
function stageFromBars(bars = []) {
  const weekly = weeklyStageForBars(bars);
  return {
    label: weekly.label,
    detail: weekly.detail,
    weekly,
  };
}
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }
function sma(bars, n, offset = 0) { return bars.length >= n + offset ? avg(bars.slice(offset, offset + n).map((x) => x.close)) : null; }
function perf(bars, n) { return bars.length > n && bars[0].close && bars[n].close ? ((bars[0].close / bars[n].close) - 1) * 100 : null; }
function clamp(n, a = 0, b = 100) { return Math.max(a, Math.min(b, n)); }
function stdev(values = []) {
  const xs = values.filter(Number.isFinite);
  if (xs.length < 2) return null;
  const mean = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - mean) ** 2)));
}
function dailyReturns(bars = [], n = 63) {
  const out = [];
  for (let i = 0; i < Math.min(n, bars.length - 1); i++) {
    const now = bars[i]?.close;
    const prev = bars[i + 1]?.close;
    if (Number.isFinite(now) && Number.isFinite(prev) && prev > 0) out.push((now / prev) - 1);
  }
  return out;
}
function annualizedVolatility(bars = [], n = 63) {
  const sd = stdev(dailyReturns(bars, n));
  return Number.isFinite(sd) ? sd * Math.sqrt(252) * 100 : null;
}
function maxDrawdown(bars = [], n = 63) {
  const rows = bars.slice(0, Math.min(n, bars.length)).filter((x) => Number.isFinite(x.close)).reverse();
  if (rows.length < 2) return null;
  let peak = rows[0].close;
  let drawdown = 0;
  for (const row of rows) {
    peak = Math.max(peak, row.close);
    if (peak > 0) drawdown = Math.max(drawdown, ((peak - row.close) / peak) * 100);
  }
  return drawdown;
}
function hiLo(bars, n) {
  const slice = bars.slice(0, Math.min(n, bars.length));
  return {
    hi: Math.max(...slice.map((x) => x.high || x.close).filter(Number.isFinite)),
    lo: Math.min(...slice.map((x) => x.low || x.close).filter(Number.isFinite)),
  };
}
function highDist(bars, n) {
  if (bars.length < 20) return null;
  const hi = hiLo(bars, n).hi;
  return hi && bars[0]?.close ? ((bars[0].close / hi) - 1) * 100 : null;
}
const LOCAL_BENCHMARK_BY_COUNTRY = {
  "Estados Unidos": "SPY",
  "United States": "SPY",
  Canada: "^GSPTSE",
  España: "^IBEX",
  Spain: "^IBEX",
  Alemania: "^GDAXI",
  Germany: "^GDAXI",
  Francia: "^FCHI",
  France: "^FCHI",
  "Paises Bajos": "^AEX",
  Netherlands: "^AEX",
  "Reino Unido": "^FTSE",
  "United Kingdom": "^FTSE",
  Suiza: "^SSMI",
  Switzerland: "^SSMI",
  Suecia: "^OMX",
  Sweden: "^OMX",
  Dinamarca: "^OMXC25",
  Denmark: "^OMXC25",
  Noruega: "^OSEAX",
  Norway: "^OSEAX",
  Finlandia: "^OMXH25",
  Finland: "^OMXH25",
  Italia: "^FTSEMIB.MI",
  Italy: "^FTSEMIB.MI",
  Belgica: "^BFX",
  Belgium: "^BFX",
  Portugal: "PSI20.LS",
  Austria: "^ATX",
  Japon: "^N225",
  Japan: "^N225",
  "Hong Kong": "^HSI",
  Singapur: "^STI",
  Singapore: "^STI",
  Sudafrica: "^J203.JO",
  "South Africa": "^J203.JO",
  Australia: "^AXJO",
  Taiwan: "^TWII",
  Israel: "^TA125.TA",
  "Corea del Sur": "^KS11",
  "South Korea": "^KS11",
  India: "^BSESN",
  China: "000001.SS",
  Brasil: "^BVSP",
  Brazil: "^BVSP",
  Mexico: "^MXX",
};

function benchmarkForProfile(symbol, profile, themeKey) {
  return LOCAL_BENCHMARK_BY_COUNTRY[countryFromSymbol(symbol, profile.country)] || "ACWI";
}

function rsQualityLabelFor(rating, rsQualityScore, speculationRiskScore) {
  return rating >= 80 && rsQualityScore >= 72 ? "RS limpio"
    : rating >= 80 && speculationRiskScore >= 55 ? "RS volatil"
      : rating >= 75 && rsQualityScore >= 62 ? "RS eficiente"
        : speculationRiskScore >= 70 ? "Momentum especulativo"
          : rating >= 60 ? "RS constructivo"
            : "RS debil";
}

function relativeStrengthFromBars(bars = [], benchmarkBars = []) {
  const aligned = alignDailyWithBenchmark(bars, benchmarkBars);
  const latestIndex = aligned.length - 1;
  const price = aligned[latestIndex]?.close ?? bars[0]?.close;
  const s50 = latestIndex >= 0 ? avgAt(aligned, latestIndex, 50, "close") : sma(bars, 50);
  const s200 = latestIndex >= 0 ? avgAt(aligned, latestIndex, 200, "close") : sma(bars, 200);
  const s200p = latestIndex >= 30 ? avgAt(aligned, latestIndex - 30, 200, "close") : sma(bars, 200, 30);
  const slope = s200 && s200p ? ((s200 / s200p) - 1) * 100 : null;
  const p3 = latestIndex >= 0 ? pctAt(aligned, latestIndex, 63, "close") : perf(bars, 63);
  const p6 = latestIndex >= 0 ? pctAt(aligned, latestIndex, 126, "close") : perf(bars, 126);
  const p12 = latestIndex >= 0 ? pctAt(aligned, latestIndex, 252, "close") : perf(bars, 252);
  const b3 = latestIndex >= 0 ? pctAt(aligned, latestIndex, 63, "benchmarkClose") : perf(benchmarkBars, 63);
  const b6 = latestIndex >= 0 ? pctAt(aligned, latestIndex, 126, "benchmarkClose") : perf(benchmarkBars, 126);
  const b12 = latestIndex >= 0 ? pctAt(aligned, latestIndex, 252, "benchmarkClose") : perf(benchmarkBars, 252);
  const rs3m = Number.isFinite(p3) && Number.isFinite(b3) ? p3 - b3 : null;
  const rs6m = Number.isFinite(p6) && Number.isFinite(b6) ? p6 - b6 : null;
  const rs12m = Number.isFinite(p12) && Number.isFinite(b12) ? p12 - b12 : null;
  const hasBenchmarkComparison = [rs3m, rs6m, rs12m].some(Number.isFinite);
  const distance52w = latestIndex >= 0 ? rollingHighDistance(aligned, latestIndex, 252) : highDist(bars, 252);
  const raw = hasBenchmarkComparison ? scoreRsBenchmarkModel({
    rs3m,
    rs6m,
    rs12m,
    perf3m: p3,
    perf6m: p6,
    perf12m: p12,
    price,
    sma50: s50,
    sma200: s200,
    sma200Slope: slope,
    distance52w,
  }) : null;
  const compositeRating = hasBenchmarkComparison && latestIndex >= 0 ? rollingRsRating(aligned, latestIndex) : null;
  const rating = Number.isFinite(compositeRating) ? compositeRating : Number.isFinite(raw) ? Math.round(clamp(raw, 1, 99)) : null;
  const volatility63d = annualizedVolatility(bars, 63);
  const maxDrawdown63d = maxDrawdown(bars, 63);
  let stability = 72;
  if (Number.isFinite(volatility63d)) {
    if (volatility63d <= 28) stability += 14;
    else if (volatility63d <= 45) stability += 7;
    else if (volatility63d <= 70) stability -= 3;
    else if (volatility63d <= 105) stability -= 10;
    else stability -= 17;
  }
  if (Number.isFinite(maxDrawdown63d)) {
    if (maxDrawdown63d <= 10) stability += 10;
    else if (maxDrawdown63d <= 18) stability += 4;
    else if (maxDrawdown63d <= 32) stability -= 4;
    else stability -= 12;
  }
  const rsQualityScore = Number.isFinite(rating) ? clamp(rating * .68 + clamp(stability) * .32) : null;
  const speculationRiskScore = clamp(Math.max(0, (Number.isFinite(volatility63d) ? volatility63d : 35) - 35) * .62 + Math.max(0, Number.isFinite(maxDrawdown63d) ? maxDrawdown63d : 12) * .85);
  return {
    rating,
    rsQualityScore,
    rsStabilityScore: clamp(stability),
    speculationRiskScore,
    rsQualityLabel: Number.isFinite(rating) ? rsQualityLabelFor(rating, rsQualityScore, speculationRiskScore) : "",
    volatility63d,
    maxDrawdown63d,
    rs3m,
    rs6m,
    rs12m,
    perf3m: p3,
    perf6m: p6,
    perf12m: p12,
    benchmarkPerf3m: b3,
    benchmarkPerf6m: b6,
    benchmarkPerf12m: b12,
    distance52w,
    note: hasBenchmarkComparison ? "RS Benchmark StageRadar: score 0-99 basado en fuerza relativa frente al benchmark, momentum y postura tecnica." : "RS Benchmark sin dato: no hay comparacion suficiente frente al benchmark asignado.",
  };
}

function pctAt(rows = [], index = 0, lookback = 1, key = "close") {
  const now = rows[index]?.[key];
  const then = rows[index - lookback]?.[key];
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  return ((now / then) - 1) * 100;
}

function pctChangeBetween(now, then) {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  return ((now / then) - 1) * 100;
}

function avgAt(rows = [], index = 0, period = 50, key = "close") {
  if (index + 1 < period) return null;
  const values = rows.slice(index + 1 - period, index + 1).map((row) => row[key]).filter(Number.isFinite);
  return values.length === period ? values.reduce((sum, value) => sum + value, 0) / period : null;
}

function rollingHighDistance(rows = [], index = 0, lookback = 252) {
  const current = rows[index]?.close;
  if (!Number.isFinite(current)) return null;
  const slice = rows.slice(Math.max(0, index + 1 - lookback), index + 1);
  const high = Math.max(...slice.map((row) => row.high || row.close).filter(Number.isFinite));
  return Number.isFinite(high) && high > 0 ? ((current / high) - 1) * 100 : null;
}

function rollingRelativeLinePositionScore(rows = [], index = 0, lookback = 252) {
  const current = rows[index];
  if (!current || !Number.isFinite(current.close) || !Number.isFinite(current.benchmarkClose) || current.benchmarkClose <= 0) return null;
  const currentRatio = current.close / current.benchmarkClose;
  const slice = rows.slice(Math.max(0, index + 1 - lookback), index + 1)
    .map((row) => Number.isFinite(row.close) && Number.isFinite(row.benchmarkClose) && row.benchmarkClose > 0 ? row.close / row.benchmarkClose : null)
    .filter(Number.isFinite);
  if (slice.length < 20) return null;
  const low = Math.min(...slice);
  const high = Math.max(...slice);
  if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) return null;
  return clamp(1 + ((currentRatio - low) / (high - low)) * 98, 1, 99);
}

function rollingRsRawScore(rows = [], index = 0) {
  const price = rows[index]?.close;
  const p1 = pctAt(rows, index, 21, "close");
  const p3 = pctAt(rows, index, 63, "close");
  const p6 = pctAt(rows, index, 126, "close");
  const p12 = pctAt(rows, index, 252, "close");
  const b1 = pctAt(rows, index, 21, "benchmarkClose");
  const b3 = pctAt(rows, index, 63, "benchmarkClose");
  const b6 = pctAt(rows, index, 126, "benchmarkClose");
  const b12 = pctAt(rows, index, 252, "benchmarkClose");
  const rs1m = Number.isFinite(p1) && Number.isFinite(b1) ? p1 - b1 : null;
  const rs3m = Number.isFinite(p3) && Number.isFinite(b3) ? p3 - b3 : null;
  const rs6m = Number.isFinite(p6) && Number.isFinite(b6) ? p6 - b6 : null;
  const rs12m = Number.isFinite(p12) && Number.isFinite(b12) ? p12 - b12 : null;
  const s50 = avgAt(rows, index, 50, "close");
  const s200 = avgAt(rows, index, 200, "close");
  const s200Prev = index >= 30 ? avgAt(rows, index - 30, 200, "close") : null;
  const slope = Number.isFinite(s200) && Number.isFinite(s200Prev) && s200Prev !== 0 ? ((s200 / s200Prev) - 1) * 100 : null;
  const distance52w = rollingHighDistance(rows, index, 252);
  const priceVs50 = pctChangeBetween(price, s50);
  const priceVs200 = pctChangeBetween(price, s200);
  const maStackEdge = Number.isFinite(s50) && Number.isFinite(s200) ? pctChangeBetween(s50, s200) : null;

  const relativeLinePositionScore = rollingRelativeLinePositionScore(rows, index, 252);

  return scoreRsBenchmarkModel({
    rs1m,
    rs3m,
    rs6m,
    rs12m,
    perf1m: p1,
    perf3m: p3,
    perf6m: p6,
    perf12m: p12,
    priceVs50,
    priceVs200,
    maStackEdge,
    sma200Slope: slope,
    distance52w,
    relativeLinePositionScore,
  });
}

function rollingRsRating(rows = [], index = 0) {
  const raw = rollingRsRawScore(rows, index);
  return Number.isFinite(raw) ? Math.round(clamp(raw, 1, 99)) : null;
}

function rsChartScoreFromRaw(raw) {
  if (!Number.isFinite(raw)) return null;
  return Number(clamp(raw, 1, 99).toFixed(2));
}

function dailyBarsAscending(bars = []) {
  return (bars || [])
    .map((bar) => ({
      date: String(bar.date || "").slice(0, 10),
      time: dateTime(String(bar.date || "").slice(0, 10)),
      close: Number(bar.close),
      high: Number.isFinite(bar.high) ? bar.high : Number(bar.close),
    }))
    .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && bar.time > 0 && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => a.time - b.time);
}

function alignDailyWithBenchmark(bars = [], benchmarkBars = []) {
  const stockRows = dailyBarsAscending(bars);
  const benchmarkRows = dailyBarsAscending(benchmarkBars);
  const output = [];
  let benchmarkIndex = 0;
  let lastBenchmark = null;

  for (const row of stockRows) {
    while (benchmarkIndex < benchmarkRows.length && benchmarkRows[benchmarkIndex].time <= row.time) {
      lastBenchmark = benchmarkRows[benchmarkIndex];
      benchmarkIndex += 1;
    }
    if (lastBenchmark && daysApart(row.date, lastBenchmark.date) <= 10) {
      output.push({
        ...row,
        benchmarkClose: lastBenchmark.close,
        benchmarkDate: lastBenchmark.date,
      });
    }
  }
  return output;
}

function relativeStrengthSeriesFromBars(bars = [], benchmarkBars = []) {
  const aligned = alignDailyWithBenchmark(bars, benchmarkBars);

  if (aligned.length < 20) {
    return {
      points: [],
      alignedDays: aligned.length,
      note: "Historico insuficiente para graficar la comparativa relativa vs benchmark.",
    };
  }

  const firstRatio = aligned[0].close / aligned[0].benchmarkClose;
  const full = aligned.map((bar, index) => {
    const ratio = bar.close / bar.benchmarkClose;
    const rsLine = firstRatio > 0 ? (ratio / firstRatio) * 100 : null;
    return {
      ...bar,
      rsLine,
      rsLineSma50: null,
      rsRawScore: rollingRsRawScore(aligned, index),
      rsRating: rollingRsRating(aligned, index),
    };
  });
  const withSma = full.map((bar, index) => ({
    date: bar.date,
    rsLine: Number.isFinite(bar.rsLine) ? Number(bar.rsLine.toFixed(2)) : null,
    rsLineSma50: Number.isFinite(avgAt(full, index, 50, "rsLine")) ? Number(avgAt(full, index, 50, "rsLine").toFixed(2)) : null,
    rsChartScore: rsChartScoreFromRaw(bar.rsRawScore),
    rsChartScoreSma50: rsChartScoreFromRaw(avgAt(full, index, 50, "rsRawScore")),
    rsRating: bar.rsRating,
  })).filter((bar) => Number.isFinite(bar.rsLine));
  const points = withSma;
  const latest = points.at(-1) || {};
  const previous21 = points.at(-22) || {};
  const recentHigh = Math.max(...points.slice(-252).map((bar) => bar.rsLine).filter(Number.isFinite));
  const trend21d = Number.isFinite(latest.rsLine) && Number.isFinite(previous21.rsLine) && previous21.rsLine !== 0
    ? ((latest.rsLine / previous21.rsLine) - 1) * 100
    : null;

  return {
    points,
    alignedDays: aligned.length,
    startDate: points[0]?.date || "",
    endDate: latest.date || "",
    latestLine: latest.rsLine ?? null,
    latestRating: latest.rsRating ?? null,
    trend21d,
    newHigh52w: Number.isFinite(latest.rsLine) && Number.isFinite(recentHigh) ? latest.rsLine >= recentHigh * .995 : false,
    note: "Linea relativa vs benchmark rebased a 100. No es el RS StageRadar 0-99; ese score sale del universo de la web.",
  };
}

function scoreCoverage(values = []) {
  if (!values.length) return 0;
  return Math.round((values.filter(usefulValue).length / values.length) * 100);
}

function companyCoverage({ profile = {}, chartBars = [], relativeStrength = {}, financialResults = null, growthMetrics = {}, news = [] }) {
  const latest = financialResults?.latest || {};
  const valuation = profile.valuationMetrics || {};
  const technical = scoreCoverage([
    chartBars?.[0]?.close,
    chartBars?.length >= 50 ? chartBars.length : null,
    chartBars?.length >= 200 ? chartBars.length : null,
    relativeStrength.rating,
    relativeStrength.rs3m,
    relativeStrength.rs6m,
    relativeStrength.rs12m,
    relativeStrength.distance52w,
    relativeStrength.volatility63d,
    relativeStrength.maxDrawdown63d,
    relativeStrength.series?.points?.length >= 20 ? relativeStrength.series.points.length : null,
  ]);
  const profileScore = scoreCoverage([
    profile.name,
    profile.sector && profile.sector !== "Sin sector" ? profile.sector : "",
    profile.industry && profile.industry !== "Sin industria" ? profile.industry : "",
    profile.marketCap,
    profile.currency,
    profile.country,
    profile.website,
    profile.businessSummary,
    valuation.trailingPe,
    valuation.priceToBook,
    valuation.averageVolume3m,
  ]);
  const fundamentals = scoreCoverage([
    growthMetrics.revenueGrowth,
    growthMetrics.earningsGrowth,
    growthMetrics.grossMargin,
    growthMetrics.operatingMargin,
    growthMetrics.profitMargin,
    growthMetrics.roe,
    growthMetrics.roa,
    growthMetrics.debtToEquity,
    growthMetrics.currentRatio,
    growthMetrics.shortPercentOfFloat,
    valuation.trailingPe,
    valuation.priceToSales,
    valuation.enterpriseToEbitda,
    latest.revenue,
    latest.netIncome,
    latest.freeCashFlow,
  ]);
  const newsCoverage = Array.isArray(news) && news.length ? 100 : 0;
  const total = Math.round(technical * .5 + profileScore * .22 + fundamentals * .23 + newsCoverage * .05);
  const issues = [];
  if (technical < 70) issues.push("historico tecnico parcial");
  if (profileScore < 60) issues.push("perfil incompleto");
  if (fundamentals < 40) issues.push("fundamentales limitados");
  if (!newsCoverage) issues.push("sin noticias recientes");
  return {
    total,
    technical,
    profile: profileScore,
    fundamentals,
    news: newsCoverage,
    label: total >= 80 ? "Cobertura alta" : total >= 60 ? "Cobertura util" : total >= 40 ? "Cobertura parcial" : "Cobertura baja",
    issues,
  };
}

function ageDaysFromDate(value = "") {
  const time = dateTime(value);
  if (!time) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function publicFreshness({ chart = {}, profile = {}, financialResults = null, relativeStrength = {}, weeklyGlobalRs = {}, coverage = {} } = {}) {
  const latestBar = (chart.bars || []).find((bar) => bar?.date && Number.isFinite(bar.close)) || {};
  const fundamentalsAsOf = profile.growthMetrics?.fundamentalsAsOf || financialResults?.latest?.date || "";
  const fundamentalsCache = profile.fundamentalsCache || {};
  const weeklyLatest = weeklyGlobalRs?.latest || null;
  const rsGlobalAsOf = weeklyLatest?.date || relativeStrength.universe?.asOf || "";
  const priceAgeDays = ageDaysFromDate(latestBar.date);
  return {
    priceDate: latestBar.date || "",
    priceAgeDays,
    chartBars: chart.bars?.length || 0,
    chartStale: !Number.isFinite(priceAgeDays) || priceAgeDays > 5,
    fundamentalsAsOf,
    fundamentalsUpdatedAt: fundamentalsCache.updatedAt || fundamentalsCache.read?.updatedAt || "",
    fundamentalsAgeDays: fundamentalsCache.freshnessDays ?? fundamentalsCache.read?.freshnessDays ?? ageDaysFromDate(fundamentalsAsOf),
    rsGlobalAsOf,
    rsGlobalBaseCurrency: weeklyLatest?.baseCurrency || "USD",
    rsGlobalSample: weeklyLatest?.sampleSize ?? relativeStrength.rsGlobalSample ?? null,
    coverageLabel: coverage.label || "",
  };
}
function investorAngleFor({ stage = {}, rs = {}, theme = {} }) {
  const rating = Number.isFinite(rs.rating) ? rs.rating : null;
  const dist = Number.isFinite(rs.distance52w) ? rs.distance52w : null;
  const stageLabel = stage.label || "estructura no confirmada";
  const themeLabel = theme.key || "tematica general";
  if (/Etapa 2/i.test(stageLabel) && rating >= 75 && dist !== null && dist >= -15) {
    return `Etapa 2 probable · RS ${rating} · ${themeLabel} · precio cerca de maximos.`;
  }
  if (/Etapa 2/i.test(stageLabel)) {
    return `Etapa 2 probable · ${themeLabel} · confirmar fuerza relativa y volumen.`;
  }
  if (/Etapa 4/i.test(stageLabel)) {
    return `Etapa 4 probable · precio bajo medias clave · RS pendiente de recuperacion.`;
  }
  if (rating !== null && rating >= 80) {
    return `RS alto (${rating}) · etapa todavia no limpia.`;
  }
  if (rating !== null && rating < 45) {
    return `RS bajo (${rating}) · liderazgo tecnico no confirmado.`;
  }
  return `Estructura mixta · ${themeLabel} · tendencia y demanda pendientes de confirmacion.`;
}
function compactChartBars(bars = []) {
  return (bars || []).slice(0, 520).reverse().map((bar) => ({
    date: bar.date,
    open: Number.isFinite(bar.open) ? bar.open : null,
    close: Number.isFinite(bar.close) ? bar.close : null,
    high: Number.isFinite(bar.high) ? bar.high : null,
    low: Number.isFinite(bar.low) ? bar.low : null,
    volume: Number.isFinite(bar.volume) ? bar.volume : null,
  }));
}
function mergeLongAndRecentBars(longBars = [], recentBars = []) {
  const cleanBars = (bars = []) => (bars || [])
    .map((bar) => ({
      ...bar,
      date: String(bar.date || "").slice(0, 10),
    }))
    .filter((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date) && dateTime(bar.date) > 0 && Number.isFinite(bar.close) && bar.close > 0);
  const long = cleanBars(longBars);
  const recent = cleanBars(recentBars);
  if (!recent.length) return long.sort((a, b) => dateTime(b.date) - dateTime(a.date));
  if (!long.length) return recent.sort((a, b) => dateTime(b.date) - dateTime(a.date));

  const recentStart = Math.min(...recent.map((bar) => dateTime(bar.date)).filter(Number.isFinite));
  const byDate = new Map();
  for (const bar of long) {
    if (dateTime(bar.date) < recentStart) byDate.set(bar.date, bar);
  }
  for (const bar of recent) byDate.set(bar.date, bar);
  return [...byDate.values()].sort((a, b) => dateTime(b.date) - dateTime(a.date));
}
function mergeChartHistory(longChart = {}, recentChart = {}) {
  const bars = mergeLongAndRecentBars(longChart.bars || [], recentChart.bars || []);
  return {
    ...longChart,
    bars,
    meta: {
      ...(longChart.meta || {}),
      dataProvider: longChart.meta?.dataProvider || recentChart.meta?.dataProvider,
      recentRange: recentChart.meta?.requestedRange || "",
      recentInterval: recentChart.meta?.requestedInterval || "",
    },
  };
}

function symbolKey(symbol = "") {
  const clean = String(symbol || "").trim().toUpperCase();
  const hk = clean.match(/^(\d{1,4})\.HK$/);
  if (hk) return `${hk[1].padStart(4, "0")}.HK`;
  return clean;
}

function briefCacheKey(symbol = "", benchmarkSymbol = "") {
  const benchmark = cleanBenchmarkSymbol(benchmarkSymbol) || "AUTO";
  return `${symbolKey(symbol)}:${benchmark}`;
}

function ageDaysFromTimestamp(value = "") {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86400000));
}

function annotateBriefCache(brief = {}, cache = {}) {
  const cachedAt = cache.cachedAt || brief.updatedAt || "";
  const ageDays = ageDaysFromTimestamp(cachedAt);
  return {
    ...brief,
    servedAt: new Date().toISOString(),
    dataQuality: {
      ...(brief.dataQuality || {}),
      partial: cache.stale ? true : brief.dataQuality?.partial,
      freshness: {
        ...(brief.dataQuality?.freshness || {}),
        briefCacheHit: Boolean(cache.hit),
        briefCacheStale: Boolean(cache.stale),
        briefCachedAt: cachedAt,
        briefCacheAgeDays: ageDays,
        briefCacheMaxAgeDays: cache.maxAgeDays ?? DEFAULT_BRIEF_MAX_AGE_DAYS,
        briefFallbackError: cache.fallbackError || "",
      },
    },
  };
}

async function readBriefCache(symbol = "", options = {}) {
  const config = supabaseConfig();
  const key = briefCacheKey(symbol, options.benchmarkSymbol);
  const maxAgeDays = Math.max(Number(options.briefMaxAgeDays ?? DEFAULT_BRIEF_MAX_AGE_DAYS), 0);
  if (!config.configured || !key) return { hit: false, row: null, maxAgeDays };
  try {
    const rows = await supabaseRequest("app_settings", {
      query: {
        owner_id: `eq.${config.ownerId}`,
        setting_type: `eq.${BRIEF_CACHE_TYPE}`,
        setting_key: `eq.${key}`,
        select: "value,updated_at",
        limit: "1",
      },
    });
    const row = rows?.[0] || null;
    const brief = row?.value?.brief || null;
    const cacheVersion = Number(row?.value?.version || 0);
    const cachedAt = row?.value?.cachedAt || row?.updated_at || brief?.updatedAt || "";
    const ageDays = ageDaysFromTimestamp(cachedAt);
    const fresh = Boolean(brief && cacheVersion === BRIEF_CACHE_VERSION && ageDays !== null && ageDays <= maxAgeDays);
    return {
      hit: fresh,
      stale: Boolean(brief && !fresh),
      brief,
      cachedAt,
      maxAgeDays,
    };
  } catch (error) {
    return { hit: false, row: null, maxAgeDays, error: error.message || "brief cache read failed" };
  }
}

async function writeBriefCache(symbol = "", options = {}, brief = {}) {
  const config = supabaseConfig();
  const key = briefCacheKey(symbol, options.benchmarkSymbol);
  if (!config.configured || !key || !brief?.symbol) return { written: false };
  const cachedAt = new Date().toISOString();
  try {
    await supabaseRpc("upsert_app_setting_newer_wins", {
      p_owner_id: config.ownerId,
      p_setting_type: BRIEF_CACHE_TYPE,
      p_setting_key: key,
      p_value: {
        version: BRIEF_CACHE_VERSION,
        symbol: symbolKey(symbol),
        benchmarkSymbol: cleanBenchmarkSymbol(options.benchmarkSymbol) || "AUTO",
        cachedAt,
        brief,
      },
      p_updated_at: cachedAt,
    });
    return { written: true, cachedAt };
  } catch (error) {
    return { written: false, error: error.message || "brief cache write failed" };
  }
}

function scanMetric(row = {}, key = "") {
  return firstFinite(row.raw?.[key], row.metrics?.[key], row[key]);
}

async function readUniverseRsSnapshot(symbol = "") {
  const config = supabaseConfig();
  const cleanSymbol = String(symbol || "").trim().toUpperCase();
  if (!config.configured || !cleanSymbol) return null;
  const rows = await supabaseRequest("scan_results", {
    query: [
      `owner_id=eq.${encodeURIComponent(config.ownerId)}`,
      `symbol=eq.${encodeURIComponent(cleanSymbol)}`,
      "select=created_at,scan_id,symbol,company_name,country,sector,industry,theme,total_score,weinstein_score,minervini_score,risk_score,rs_rating,metrics,raw",
      "order=created_at.desc",
      "limit=1",
    ].join("&"),
  });
  const row = rows?.[0];
  if (!row) return null;
  const rsGlobalPct = firstFinite(row.raw?.rsGlobalPct, row.metrics?.rsGlobalPct);
  if (!Number.isFinite(rsGlobalPct)) return null;
  return {
    source: "scan_results",
    asOf: row.created_at || "",
    scanId: row.scan_id || "",
    symbol: row.symbol || cleanSymbol,
    companyName: row.company_name || row.raw?.companyName || row.raw?.name || "",
    country: row.country || row.raw?.country || "",
    sector: row.sector || row.raw?.sector || "",
    industry: row.industry || row.raw?.industry || "",
    theme: row.theme || row.raw?.theme || "",
    rsGlobalPct,
    rsRating: firstFinite(row.raw?.rsRating, row.metrics?.rsRating, row.rs_rating),
    rsCountryPct: firstFinite(row.raw?.rsCountryPct, row.metrics?.rsCountryPct),
    rsSectorPct: firstFinite(row.raw?.rsSectorPct, row.metrics?.rsSectorPct),
    rsGlobalSample: scanMetric(row, "rsGlobalSample"),
    rsCountrySample: scanMetric(row, "rsCountrySample"),
    rsSectorSample: scanMetric(row, "rsSectorSample"),
    totalScore: firstFinite(row.raw?.totalScore, row.total_score),
    weinsteinScore: firstFinite(row.raw?.weinsteinScore, row.weinstein_score),
    minerviniScore: firstFinite(row.raw?.minerviniScore, row.minervini_score),
    riskScore: firstFinite(row.raw?.riskScore, row.risk_score),
  };
}

function mergeUniverseRelativeStrength(benchmarkStrength = {}, universe = null, weeklyGlobal = null) {
  const benchmarkRating = benchmarkStrength.rating;
  if (!universe || !Number.isFinite(universe.rsGlobalPct)) {
    return {
      ...benchmarkStrength,
      rating: null,
      benchmarkRating,
      rsRating: benchmarkRating,
      rsUniverseAvailable: false,
      rsBenchmarkAvailable: Number.isFinite(benchmarkRating),
      ratingSource: "universe-missing",
      rsGlobalPct: null,
      rsCountryPct: null,
      rsSectorPct: null,
      universe: null,
      globalRsSeries: weeklyGlobal?.series || [],
      note: "RS StageRadar sin snapshot reciente para este simbolo. RS Benchmark se mantiene como comparativa secundaria; no sustituye al RS.",
    };
  }
  const rating = universe.rsGlobalPct;
  const rsQualityScore = clamp(rating * .68 + clamp(benchmarkStrength.rsStabilityScore ?? 72) * .32);
  return {
    ...benchmarkStrength,
    rating,
    benchmarkRating,
    rsRating: benchmarkRating,
    rsUniverseAvailable: true,
    rsBenchmarkAvailable: Number.isFinite(benchmarkRating),
    ratingSource: "universe",
    rsGlobalPct: universe.rsGlobalPct,
    rsCountryPct: universe.rsCountryPct,
    rsSectorPct: universe.rsSectorPct,
    rsGlobalSample: universe.rsGlobalSample,
    rsCountrySample: universe.rsCountrySample,
    rsSectorSample: universe.rsSectorSample,
    rsQualityScore,
    rsQualityLabel: rsQualityLabelFor(rating, rsQualityScore, benchmarkStrength.speculationRiskScore),
    universe,
    globalRsSeries: weeklyGlobal?.series || [],
    note: "RS StageRadar = percentil 0-99 calculado desde el universo de la web. RS Benchmark solo mide comparativa frente al benchmark asignado.",
  };
}

function tradingViewEmbedInfo(symbol = "", tradingViewSymbol = "") {
  if (isTradingViewWidgetBlocked(symbol, tradingViewSymbol)) {
    return {
      supported: false,
      reason: "TradingView permite consultar este simbolo en su web, pero bloquea el widget embebido para este mercado/simbolo. Se muestra grafico interno con datos de Yahoo.",
    };
  }
  return { supported: true, reason: "" };
}
function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value)) ?? null;
}
function ratioPct(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return (numerator / denominator) * 100;
}
function ratio(numerator, denominator) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}
function dateTime(value) {
  const date = new Date(value || "");
  const time = date.getTime();
  return Number.isFinite(time) ? time : 0;
}
function daysApart(a, b) {
  const left = dateTime(a);
  const right = dateTime(b);
  if (!left || !right) return Infinity;
  return Math.abs(left - right) / 86400000;
}
function usefulValue(value) {
  if (Number.isFinite(value)) return value !== 0;
  return value !== undefined && value !== null && value !== "";
}
function richerRow(row = {}) {
  return [
    "revenue",
    "revenueGrowthYoY",
    "grossProfit",
    "operatingIncome",
    "ebitda",
    "netIncome",
    "netIncomeGrowthYoY",
    "eps",
    "cash",
    "totalDebt",
    "totalAssets",
    "equity",
    "operatingCashFlow",
    "freeCashFlow",
  ].reduce((score, key) => score + (usefulValue(row[key]) ? 1 : 0), 0);
}
function bestFieldValue(current, incoming) {
  if (usefulValue(incoming)) return incoming;
  if (usefulValue(current)) return current;
  if (Number.isFinite(incoming)) return incoming;
  if (Number.isFinite(current)) return current;
  return incoming ?? current ?? null;
}
function mergeNearRows(current = {}, incoming = {}) {
  const merged = { ...current, ...incoming };
  const newestDate = dateTime(incoming.date) >= dateTime(current.date) ? incoming.date : current.date;
  const keys = new Set([...Object.keys(current), ...Object.keys(incoming)]);
  for (const key of keys) {
    if (key === "date") {
      merged.date = newestDate || incoming.date || current.date || "";
    } else if (key === "period") {
      merged.period = incoming.period || current.period || "";
    } else {
      merged[key] = bestFieldValue(current[key], incoming[key]);
    }
  }
  return merged;
}
function mergeRows(primary = [], fallback = []) {
  const rows = [];
  for (const row of [...(fallback || []), ...(primary || [])]) {
    if (!row?.date) continue;
    const index = rows.findIndex((existing) => daysApart(existing.date, row.date) <= 10);
    if (index === -1) {
      rows.push(row);
    } else {
      rows[index] = mergeNearRows(rows[index], row);
    }
  }
  return rows
    .sort((a, b) => (dateTime(b.date) - dateTime(a.date)) || (richerRow(b) - richerRow(a)))
    .slice(0, 8);
}
function mergeFinancialResults(yahooResults = null, secResults = null) {
  if (!yahooResults && !secResults) return null;
  if (!yahooResults) return secResults;
  if (!secResults) return yahooResults;
  const incomeQuarterly = mergeRows(yahooResults.incomeQuarterly, secResults.incomeQuarterly);
  const incomeAnnual = mergeRows(yahooResults.incomeAnnual, secResults.incomeAnnual);
  const balanceQuarterly = mergeRows(yahooResults.balanceQuarterly, secResults.balanceQuarterly);
  const balanceAnnual = mergeRows(yahooResults.balanceAnnual, secResults.balanceAnnual);
  const cashflowQuarterly = mergeRows(yahooResults.cashflowQuarterly, secResults.cashflowQuarterly);
  const cashflowAnnual = mergeRows(yahooResults.cashflowAnnual, secResults.cashflowAnnual);
  const latestIncome = incomeQuarterly[0] || incomeAnnual[0] || {};
  const latestBalance = balanceQuarterly[0] || balanceAnnual[0] || {};
  const latestCashflow = cashflowQuarterly[0] || cashflowAnnual[0] || {};
  return {
    ...yahooResults,
    currency: yahooResults.currency || secResults.currency || "",
    source: [yahooResults.source, secResults.source].filter(Boolean).join(" + "),
    incomeQuarterly,
    incomeAnnual,
    balanceQuarterly,
    balanceAnnual,
    cashflowQuarterly,
    cashflowAnnual,
    latest: {
      ...(yahooResults.latest || {}),
      date: latestIncome.date || latestBalance.date || latestCashflow.date || yahooResults.latest?.date || "",
      revenue: firstFinite(latestIncome.revenue, yahooResults.latest?.revenue),
      revenueGrowthYoY: firstFinite(latestIncome.revenueGrowthYoY, yahooResults.latest?.revenueGrowthYoY),
      grossProfit: firstFinite(latestIncome.grossProfit, yahooResults.latest?.grossProfit),
      operatingIncome: firstFinite(latestIncome.operatingIncome, yahooResults.latest?.operatingIncome),
      ebitda: firstFinite(latestIncome.ebitda, yahooResults.latest?.ebitda),
      netIncome: firstFinite(latestIncome.netIncome, yahooResults.latest?.netIncome),
      netIncomeGrowthYoY: firstFinite(latestIncome.netIncomeGrowthYoY, yahooResults.latest?.netIncomeGrowthYoY),
      eps: firstFinite(latestIncome.eps, yahooResults.latest?.eps),
      cash: firstFinite(latestBalance.cash, yahooResults.latest?.cash),
      totalDebt: firstFinite(latestBalance.totalDebt, yahooResults.latest?.totalDebt),
      totalAssets: firstFinite(latestBalance.totalAssets, yahooResults.latest?.totalAssets),
      equity: firstFinite(latestBalance.equity, yahooResults.latest?.equity),
      operatingCashFlow: firstFinite(latestCashflow.operatingCashFlow, yahooResults.latest?.operatingCashFlow),
      freeCashFlow: firstFinite(latestCashflow.freeCashFlow, yahooResults.latest?.freeCashFlow),
    },
  };
}

function deriveGrowthFromFinancialResults(results = null) {
  if (!results) return {};
  const income = results.incomeQuarterly?.[0] || results.incomeAnnual?.[0] || results.latest || {};
  const annualIncome = results.incomeAnnual?.[0] || income;
  const balance = results.balanceQuarterly?.[0] || results.balanceAnnual?.[0] || {};
  const latest = results.latest || {};
  const revenue = firstFinite(income.revenue, annualIncome.revenue, latest.revenue);
  const netIncome = firstFinite(income.netIncome, annualIncome.netIncome, latest.netIncome);
  const grossProfit = firstFinite(income.grossProfit, annualIncome.grossProfit, latest.grossProfit);
  const operatingIncome = firstFinite(income.operatingIncome, annualIncome.operatingIncome, latest.operatingIncome);
  const ebitda = firstFinite(income.ebitda, annualIncome.ebitda, latest.ebitda);
  const equity = firstFinite(balance.equity, latest.equity);
  const assets = firstFinite(balance.totalAssets, latest.totalAssets);
  const debt = firstFinite(balance.totalDebt, latest.totalDebt);
  return {
    revenueGrowth: income.revenueGrowthYoY,
    earningsGrowth: income.netIncomeGrowthYoY,
    grossMargin: ratioPct(grossProfit, revenue),
    operatingMargin: ratioPct(operatingIncome, revenue),
    profitMargin: ratioPct(netIncome, revenue),
    ebitdaMargin: ratioPct(ebitda, revenue),
    roe: ratioPct(firstFinite(annualIncome.netIncome, netIncome), equity),
    roa: ratioPct(firstFinite(annualIncome.netIncome, netIncome), assets),
    debtToEquity: ratioPct(debt, equity),
    currentRatio: ratio(balance.currentAssets, balance.currentLiabilities),
    financialCurrency: results.currency || "",
    fundamentalsAsOf: income.date || balance.date || latest.date || "",
    source: results.source ? `${results.source} derivado` : "Estados financieros derivados",
  };
}

function mergeDerivedGrowthMetrics(base = {}, derived = {}) {
  const out = { ...base };
  for (const key of ["revenueGrowth", "earningsGrowth", "grossMargin", "operatingMargin", "profitMargin", "ebitdaMargin", "roe", "roa", "debtToEquity", "currentRatio"]) {
    out[key] = firstFinite(out[key], derived[key]);
  }
  out.financialCurrency = out.financialCurrency || derived.financialCurrency || "";
  out.fundamentalsAsOf = out.fundamentalsAsOf || derived.fundamentalsAsOf || "";
  out.source = [base.source, derived.source].filter(Boolean).join(" + ") || base.source || derived.source || "";
  return out;
}

function splitFactorAfterDate(date = "", splitEvents = []) {
  const rowTime = dateTime(date);
  if (!rowTime) return 1;
  return (splitEvents || []).reduce((factor, event) => {
    const splitTime = dateTime(event.date);
    const ratioValue = Number(event.ratio);
    return splitTime > rowTime && Number.isFinite(ratioValue) && ratioValue > 0 ? factor * ratioValue : factor;
  }, 1);
}

function normalizeEpsRowForSplits(row = {}, splitEvents = [], sharesOutstanding = null) {
  const eps = Number(row.eps);
  const netIncome = Number(row.netIncome);
  const shares = Number(sharesOutstanding);
  const splitFactor = splitFactorAfterDate(row.date, splitEvents);
  if (!Number.isFinite(eps) || eps === 0 || !Number.isFinite(netIncome) || !Number.isFinite(shares) || shares <= 0 || splitFactor <= 1.01) return row;

  const impliedShares = Math.abs(netIncome / eps);
  const adjustedEps = eps / splitFactor;
  const adjustedImpliedShares = Math.abs(netIncome / adjustedEps);
  if (!Number.isFinite(impliedShares) || !Number.isFinite(adjustedImpliedShares) || impliedShares <= 0 || adjustedImpliedShares <= 0) return row;

  const currentGap = Math.abs(Math.log(shares / impliedShares));
  const adjustedGap = Math.abs(Math.log(shares / adjustedImpliedShares));
  if (currentGap > Math.log(Math.sqrt(splitFactor)) && adjustedGap + 0.25 < currentGap) {
    return {
      ...row,
      eps: Number(adjustedEps.toFixed(4)),
      epsSplitAdjusted: true,
    };
  }
  return row;
}

function normalizeFinancialResultsForSplits(results = null, splitEvents = [], sharesOutstanding = null) {
  if (!results || !Array.isArray(splitEvents) || !splitEvents.length) return results;
  const adjustRows = (rows = []) => rows.map((row) => normalizeEpsRowForSplits(row, splitEvents, sharesOutstanding));
  const incomeQuarterly = adjustRows(results.incomeQuarterly || []);
  const incomeAnnual = adjustRows(results.incomeAnnual || []);
  const latest = normalizeEpsRowForSplits(results.latest || {}, splitEvents, sharesOutstanding);
  return {
    ...results,
    source: results.source ? `${results.source} + split-adjusted EPS` : "split-adjusted EPS",
    incomeQuarterly,
    incomeAnnual,
    latest,
  };
}

function genericText(value = "") {
  return ["", "-", "sin sector", "sin industria", "sin dato"].includes(String(value || "").trim().toLowerCase());
}

function mergeProfileFallback(profile = {}, fallback = {}) {
  const out = { ...profile };
  for (const key of ["name", "sector", "industry", "exchange", "currency", "ipoDate", "website", "country", "city", "businessSummary"]) {
    if (genericText(out[key]) && !genericText(fallback[key])) out[key] = fallback[key];
  }
  for (const key of ["marketCap", "fullTimeEmployees"]) {
    if (!Number.isFinite(out[key]) && Number.isFinite(fallback[key])) out[key] = fallback[key];
    if (key === "marketCap" && (!out[key] || out[key] <= 0) && Number.isFinite(fallback[key])) out[key] = fallback[key];
  }
  return out;
}

function mergeObjectFallback(base = {}, fallback = {}) {
  const out = { ...base };
  for (const [key, value] of Object.entries(fallback || {})) {
    if (key === "source") continue;
    if (Array.isArray(value)) {
      if (!Array.isArray(out[key]) || !out[key].length) out[key] = value;
    } else if (Number.isFinite(value)) {
      if (!Number.isFinite(out[key])) out[key] = value;
    } else if ((out[key] === undefined || out[key] === null || out[key] === "") && value !== undefined && value !== null && value !== "") {
      out[key] = value;
    }
  }
  out.source = [base.source, fallback?.source].filter(Boolean).join(" + ") || base.source || fallback?.source || "";
  return out;
}

async function fetchProfileForCache(symbol) {
  const profile = await fetchYahooProfile(symbol);
  const asicShort = await fetchAsicShortInterest(symbol).catch(() => null);
  return mergeAsicShortInterest(profile, asicShort);
}

function fetchChartForBrief(symbol, chartOptions = {}, options = {}) {
  return withDailyBarsCache(symbol, {
    range: chartOptions.range || "5A",
    interval: "D",
    refresh: options.refreshChart === true,
    useCache: options.chartCache !== false,
    maxAgeDays: options.maxPriceFreshnessDays ?? 5,
  }, fetchYahooChart);
}

export async function getCompanyBrief(symbol, options = {}) {
  if (!symbol) throw new Error("Falta symbol");
  let cachedBrief = null;
  try {
    if (options.briefCache !== false && options.refresh !== true && options.debug !== true) {
      cachedBrief = await readBriefCache(symbol, options);
      if (cachedBrief.hit && cachedBrief.brief) {
        return annotateBriefCache(cachedBrief.brief, cachedBrief);
      }
    }

    const [profileResult, longChart, recentChart] = await Promise.all([
      withProfileCache(symbol, {
        refresh: options.refreshProfile,
        useCache: options.profileCache !== false,
        maxAgeDays: options.profileMaxAgeDays,
      }, fetchProfileForCache).catch((error) => ({ profileProviderError: error.message || "Proveedor no disponible" })),
      fetchChartForBrief(symbol, { range: "MAX" }, options).catch(() => ({ bars: [] })),
      fetchChartForBrief(symbol, { range: "5A" }, options).catch(() => ({ bars: [] })),
    ]);
    const chart = mergeChartHistory(longChart, recentChart);
    let profile = {
      name: chart.meta?.longName || chart.meta?.shortName || symbol,
      marketCap: 0,
      sector: "Sin sector",
      industry: "Sin industria",
      exchange: chart.meta?.fullExchangeName || chart.meta?.exchangeName || "-",
      currency: chart.meta?.currency || "",
      ipoDate: "",
      website: "",
      city: "",
      country: "",
      fullTimeEmployees: null,
      businessSummary: "",
      growthMetrics: {
        revenueGrowth: null,
        earningsGrowth: null,
        grossMargin: null,
        operatingMargin: null,
        profitMargin: null,
        ebitdaMargin: null,
        roe: null,
        roa: null,
        debtToEquity: null,
        currentRatio: null,
        institutionalOwnership: null,
        insiderOwnership: null,
        shortPercentOfFloat: null,
        sharesPercentSharesOut: null,
        shortRatio: null,
        sharesShort: null,
        sharesShortPriorMonth: null,
        floatShares: null,
        sharesOutstanding: null,
        fundsCountApprox: null,
        institutionsCountApprox: null,
        topFunds: [],
        topInstitutions: [],
        providerNote: "Datos aproximados segun proveedor disponible; no equivalen a ratings propietarios de MarketSurge.",
      },
      valuationMetrics: {},
      quoteSnapshot: {},
      ...profileResult,
    };
    const [extrasResult, secResult, fmpResult] = await Promise.all([
      fetchYahooCompanyExtras(symbol, profile).catch((error) => ({ extrasProviderError: error.message || "Proveedor no disponible" })),
      fetchSecFundamentals(symbol).catch((error) => ({ error: error.message || "SEC no disponible" })),
      fetchFmpCompanyData(symbol).catch((error) => ({ fmpProviderError: error.message || "FMP no disponible" })),
    ]);
    if (fmpResult.profile) {
      Object.assign(profile, mergeProfileFallback(profile, fmpResult.profile));
      if (fmpResult.profile.image) profile.fmpImage = fmpResult.profile.image;
    }
    if (fmpResult.growthMetrics) profile.growthMetrics = mergeObjectFallback(profile.growthMetrics, fmpResult.growthMetrics);
    if (fmpResult.valuationMetrics) profile.valuationMetrics = mergeObjectFallback(profile.valuationMetrics, fmpResult.valuationMetrics);
    if (fmpResult.quoteSnapshot) profile.quoteSnapshot = mergeObjectFallback(profile.quoteSnapshot, fmpResult.quoteSnapshot);
    if (!secResult.error) profile.growthMetrics = mergeSecGrowthMetrics(profile.growthMetrics, secResult);
    if (!profile.shortInterest) {
      const asicShort = await fetchAsicShortInterest(symbol).catch(() => null);
      profile = mergeAsicShortInterest(profile, asicShort);
    }
    const yahooFinancialResults = mergeFinancialResults(profile.fundamentalsFinancialResults || profile.growthMetrics?.financialResults, extrasResult.financialResults);
    const secFinancialResults = secResult.error
      ? yahooFinancialResults
      : mergeFinancialResults(secResult.financialResults, yahooFinancialResults);
    const mergedFinancialResults = mergeFinancialResults(secFinancialResults, fmpResult.financialResults);
    const financialResults = normalizeFinancialResultsForSplits(
      mergedFinancialResults,
      chart.meta?.splitEvents || [],
      firstFinite(profile.valuationMetrics?.sharesOutstanding, profile.growthMetrics?.sharesOutstanding)
    );
    profile.growthMetrics = mergeDerivedGrowthMetrics(profile.growthMetrics, deriveGrowthFromFinancialResults(financialResults));
    const theme = inferBusinessTheme(profile.sector, profile.industry, profile.businessSummary);
    const country = countryFromSymbol(symbol, profile.country);
    const summary = firstSentences(profile.businessSummary, 2);
    const marketCapCurrency = normalizeCurrency(profile.currency);
    const marketCapUsd = await marketCapUsdInfo(profile.marketCap, marketCapCurrency, options).catch(() => null);
    const listingDate = profile.ipoDate || oldestBarDate(chart.bars || []);
    const listingDateSource = profile.ipoDate ? "Proveedor perfil" : listingDate ? "Primera cotizacion historica disponible" : "";
    const stage = stageFromBars(chart.bars || []);
    const requestedBenchmark = cleanBenchmarkSymbol(options.benchmarkSymbol);
    const benchmarkSymbol = requestedBenchmark || benchmarkForProfile(symbol, profile, theme.key);
    const [benchmarkLongChart, benchmarkRecentChart] = await Promise.all([
      fetchChartForBrief(benchmarkSymbol, { range: "MAX" }, options).catch(() => ({ bars: [] })),
      fetchChartForBrief(benchmarkSymbol, { range: "5A" }, options).catch(() => ({ bars: [] })),
    ]);
    const benchmarkChart = mergeChartHistory(benchmarkLongChart, benchmarkRecentChart);
    const benchmarkStrength = {
      benchmarkSymbol,
      ...relativeStrengthFromBars(chart.bars || [], benchmarkChart.bars || []),
    };
    const [universeSnapshot, weeklyGlobalRs] = await Promise.all([
      readUniverseRsSnapshot(symbol).catch(() => null),
      readGlobalRsSeriesForSymbol(symbol).catch(() => ({ series: [], latest: null })),
    ]);
    const relativeStrength = mergeUniverseRelativeStrength(benchmarkStrength, universeSnapshot, weeklyGlobalRs);
    relativeStrength.series = relativeStrengthSeriesFromBars(chart.bars || [], benchmarkChart.bars || []);
    const website = normalizeWebsite(profile.website);
    const domain = assetDomainForSymbol(symbol, website);
    const links = {
      official: website || null,
      ...externalLinks(symbol, profile.exchange),
    };
    const tradingViewSymbol = inferTradingViewSymbol(symbol, profile.exchange);
    const chartEmbed = tradingViewEmbedInfo(symbol, tradingViewSymbol);
    const visual = {
      initials: initials(profile.name),
      domain,
      logoUrl: domain ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128` : null,
      clearbitLogoUrl: domain ? `https://logo.clearbit.com/${domain}` : null,
    };
    const short = `${profile.name} es una compañía de ${country} del sector ${profile.sector || "sin clasificar"}, en la industria ${profile.industry || "no especificada"}. ${theme.text}`;
    const investorAngle = investorAngleFor({ stage, rs: relativeStrength, theme });
    const setupPattern = setupPatternForBars(chart.bars || []);
    const coverage = companyCoverage({
      profile,
      chartBars: chart.bars || [],
      relativeStrength,
      financialResults,
      growthMetrics: profile.growthMetrics || {},
      news: extrasResult.news || [],
    });
    const freshness = publicFreshness({ chart, profile, financialResults, relativeStrength, weeklyGlobalRs, coverage });
    const debug = options.debug === true;
    const dataQuality = {
      coverage,
      freshness,
      partial: coverage.total < 60 || freshness.chartStale === true || relativeStrength.rsUniverseAvailable === false,
    };
    if (debug) {
      dataQuality.providerErrors = {
        profile: profile.profileProviderError || null,
        extras: extrasResult.extrasProviderError || null,
        sec: secResult.error || null,
        fmp: fmpResult.fmpProviderError || null,
      };
      dataQuality.providers = {
        profile: profile.fundamentalsCache?.hit ? "StageRadar fundamental_snapshots cache" : "Yahoo Finance",
        chart: chart.meta?.fallbackReason ? `${chart.meta?.dataProvider || "Yahoo Finance"} · fallback: ${chart.meta.fallbackReason}` : chart.meta?.dataProvider || "Yahoo Finance",
        news: "Yahoo Finance search/news + Google News RSS fallback",
        statements: fmpResult.financialResults ? "Yahoo quoteSummary statements + FMP fallback" : "Yahoo quoteSummary statements",
        fundamentalsFallback: secResult.error ? "SEC EDGAR no aplicado" : "SEC EDGAR companyfacts",
        fundamentalsApi: fmpResult.configured === false ? "FMP no configurado" : (fmpResult.fmpProviderError ? "FMP no disponible" : "FMP opcional"),
        shortInterest: profile.shortInterest ? "ASIC short position reports" : "Yahoo quoteSummary / proveedor base",
      };
    }
    const brief = {
      symbol,
      name: profile.name,
      sector: profile.sector,
      industry: profile.industry,
      exchange: profile.exchange,
      currency: profile.currency,
      marketCap: profile.marketCap,
      marketCapCurrency,
      marketCapLabel: Number.isFinite(profile.marketCap) ? `${fmtCap(profile.marketCap)}${marketCapCurrency ? ` ${marketCapCurrency}` : ""}` : "Sin dato",
      marketCapUsd: marketCapUsd?.value ?? null,
      marketCapUsdLabel: marketCapUsd?.label || "",
      marketCapFx: marketCapUsd ? {
        rate: marketCapUsd.rate,
        pair: marketCapUsd.pair,
        source: marketCapUsd.source,
      } : null,
      ipoDate: profile.ipoDate,
      listingDate,
      listingDateSource,
      country,
      city: profile.city,
      employees: profile.fullTimeEmployees,
      theme: theme.key,
      short,
      summary: summary || "Yahoo no ofrece un resumen de negocio suficientemente claro para esta empresa.",
      investorAngle,
      stage,
      relativeStrength: {
        ...relativeStrength,
        rsGlobalAsOf: freshness.rsGlobalAsOf,
        rsGlobalBaseCurrency: freshness.rsGlobalBaseCurrency,
        rsGlobalEngineVersion: weeklyGlobalRs?.latest?.engineVersion || "",
      },
      links,
      tradingViewSymbol,
      chartEmbed,
      chartBars: compactChartBars(chart.bars || []),
      setupPattern,
      chartProvider: chart.meta?.dataProvider || "Yahoo Finance",
      visual,
      valuationMetrics: profile.valuationMetrics || {},
      quoteSnapshot: profile.quoteSnapshot || {},
      growthMetrics: profile.growthMetrics,
      shortInterest: profile.shortInterest || null,
      earningsCalendar: extrasResult.earningsCalendar || null,
      financialResults,
      news: extrasResult.news || [],
      dataQuality,
      updatedAt: new Date().toISOString(),
    };
    if (options.briefCache !== false && options.debug !== true) {
      const cacheWrite = await writeBriefCache(symbol, options, brief);
      if (cacheWrite.written) return annotateBriefCache(brief, { hit: false, stale: false, cachedAt: cacheWrite.cachedAt, maxAgeDays: options.briefMaxAgeDays ?? DEFAULT_BRIEF_MAX_AGE_DAYS });
    }
    return brief;
  } catch (e) {
    if (cachedBrief?.brief) {
      return annotateBriefCache(cachedBrief.brief, {
        ...cachedBrief,
        hit: false,
        stale: true,
        fallbackError: e.message || "live company brief failed",
      });
    }
    throw e;
  }
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const symbol = searchParams.get("symbol");
  const benchmarkSymbol = searchParams.get("benchmark");
  const profileMaxAgeDays = Number(searchParams.get("maxFundamentalsAgeDays") || searchParams.get("profileMaxAgeDays"));
  const maxPriceFreshnessDays = Number(searchParams.get("maxPriceFreshnessDays") || searchParams.get("maxAgeDays"));
  const briefMaxAgeParam = searchParams.get("maxBriefAgeDays");
  const briefMaxAgeDays = briefMaxAgeParam === null ? NaN : Number(briefMaxAgeParam);
  const refresh = searchParams.get("refresh") === "1";
  if (!symbol) return Response.json({ error: "Falta symbol" }, { status: 400 });
  try {
    return Response.json(await getCompanyBrief(symbol, {
      benchmarkSymbol,
      refreshProfile: refresh || searchParams.get("refreshProfile") === "1",
      refreshChart: refresh || searchParams.get("refreshChart") === "1" || searchParams.get("refreshPrices") === "1",
      refresh,
      briefCache: searchParams.get("briefCache") !== "0" && searchParams.get("cache") !== "0",
      profileCache: searchParams.get("cache") !== "0",
      chartCache: searchParams.get("cache") !== "0",
      briefMaxAgeDays: Number.isFinite(briefMaxAgeDays) ? briefMaxAgeDays : undefined,
      profileMaxAgeDays: Number.isFinite(profileMaxAgeDays) ? profileMaxAgeDays : undefined,
      maxPriceFreshnessDays: Number.isFinite(maxPriceFreshnessDays) ? maxPriceFreshnessDays : undefined,
      debug: searchParams.get("debug") === "1",
    }));
  } catch (e) {
    return Response.json({ error: e.message || String(e) }, { status: 500 });
  }
}
