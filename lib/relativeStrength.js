import { countryCode } from "@/lib/symbols";

export const RS_ENGINE_VERSION = "statsedge-rs-v2";
export const RS_GLOBAL_MIN_SAMPLE = 20;
export const RS_SCOPED_MIN_SAMPLE = 5;

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function firstFinite(...values) {
  for (const value of values) {
    const n = finiteNumber(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function gt(value, threshold) {
  return Number.isFinite(value) && Number.isFinite(threshold) && value > threshold;
}

function gte(value, threshold) {
  return Number.isFinite(value) && Number.isFinite(threshold) && value >= threshold;
}

function perf(bars = [], n) {
  return bars.length > n && bars[0]?.close && bars[n]?.close ? ((bars[0].close / bars[n].close) - 1) * 100 : null;
}

export function rsUniverseValue(row = {}) {
  return firstFinite(row.rsGlobalPct);
}

export function rsBenchmarkValue(row = {}) {
  return firstFinite(row.rsRating);
}

export function rsPrimaryValue(row = {}) {
  return firstFinite(row.rsGlobalPct, row.rsRating);
}

export function benchmarkSymbolForRow(row = {}) {
  const text = `${row.theme || ""} ${row.sector || ""} ${row.industry || ""}`.toLowerCase();
  if (/\b(software|semis?|semiconductor|semiconductors|fotonica|ia|ai|cloud|cyber|chip|chips|technology)\b/.test(text)) return "QQQ";
  if (row.country && row.country !== "US") return "ACWI";
  return "SPY";
}

export function scoreRelativeStrength(row = {}, benchmarkBars = []) {
  const bench3 = perf(benchmarkBars, 63);
  const bench6 = perf(benchmarkBars, 126);
  const bench12 = perf(benchmarkBars, 252);
  const rs3m = Number.isFinite(row.perf3m) && Number.isFinite(bench3) ? row.perf3m - bench3 : null;
  const rs6m = Number.isFinite(row.perf6m) && Number.isFinite(bench6) ? row.perf6m - bench6 : null;
  const rs12m = Number.isFinite(row.perf12m) && Number.isFinite(bench12) ? row.perf12m - bench12 : null;
  const hasBenchmarkComparison = [rs3m, rs6m, rs12m].some(Number.isFinite);
  const nearHighBonus = gte(row.distance52w, -5) ? 8 : gte(row.distance52w, -15) ? 4 : gte(row.distance52w, -25) ? 1 : -6;
  const trendBonus = (gt(row.price, row.sma50) ? 4 : -4) + (gt(row.sma200Slope, 0) ? 4 : -2);
  const raw = hasBenchmarkComparison ? 50 + (rs3m || 0) * .9 + (rs6m || 0) * .45 + (rs12m || 0) * .22 + nearHighBonus + trendBonus : null;
  return {
    rs3m,
    rs6m,
    rs12m,
    benchmarkPerf3m: bench3,
    benchmarkPerf6m: bench6,
    benchmarkPerf12m: bench12,
    rsBenchmarkSample: benchmarkBars.length,
    rsBenchmarkAvailable: hasBenchmarkComparison,
    rsBenchmarkIssue: hasBenchmarkComparison ? "" : "benchmark insuficiente",
    rsRating: Number.isFinite(raw) ? Math.round(clamp(raw, 1, 99)) : null,
  };
}

export function rsRawComposite(row = {}) {
  const p3 = Number.isFinite(row.perf3m) ? row.perf3m : 0;
  const p6 = Number.isFinite(row.perf6m) ? row.perf6m : 0;
  const p12 = Number.isFinite(row.perf12m) ? row.perf12m : 0;
  const rs3 = Number.isFinite(row.rs3m) ? row.rs3m : 0;
  const rs6 = Number.isFinite(row.rs6m) ? row.rs6m : 0;
  const rs12 = Number.isFinite(row.rs12m) ? row.rs12m : 0;
  const nearHigh = Number.isFinite(row.distance52w) ? row.distance52w : -50;
  const drawdown = Number.isFinite(row.maxDrawdown63d) ? row.maxDrawdown63d : 25;
  return p3 * .38 + p6 * .24 + p12 * .14 + rs3 * .34 + rs6 * .18 + rs12 * .08 + nearHigh * .16 - drawdown * .12;
}

export function percentileFromSorted(value, sorted = [], minSample = 1) {
  if (!Number.isFinite(value) || sorted.length < minSample) return null;
  if (sorted.length === 1) return 50;
  let belowOrEqual = 0;
  for (const item of sorted) {
    if (item <= value) belowOrEqual += 1;
    else break;
  }
  return Math.round(clamp((belowOrEqual / sorted.length) * 99, 1, 99));
}

function addScopedPercentile(rows, scopeFn, valueKey, outKey, sampleKey, minSample = RS_SCOPED_MIN_SAMPLE) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = scopeFn(row) || "Sin grupo";
    if (!groups.has(key)) groups.set(key, []);
    if (Number.isFinite(row[valueKey])) groups.get(key).push(row[valueKey]);
  });
  groups.forEach((values, key) => groups.set(key, values.sort((a, b) => a - b)));
  return rows.map((row) => {
    const key = scopeFn(row) || "Sin grupo";
    const sorted = groups.get(key) || [];
    const sample = sorted.length;
    return {
      ...row,
      [sampleKey]: sample,
      [outKey]: percentileFromSorted(row[valueKey], sorted, minSample),
    };
  });
}

export function enrichRelativePercentiles(rows = [], options = {}) {
  if (!rows.length) return rows;
  const minGlobalSample = Number.isFinite(options.minGlobalSample) ? options.minGlobalSample : RS_GLOBAL_MIN_SAMPLE;
  const minScopedSample = Number.isFinite(options.minScopedSample) ? options.minScopedSample : RS_SCOPED_MIN_SAMPLE;
  const withRaw = rows.map((row) => ({ ...row, rsCompositeRaw: rsRawComposite(row) }));
  const sortedGlobal = withRaw.map((row) => row.rsCompositeRaw).filter(Number.isFinite).sort((a, b) => a - b);
  let out = withRaw.map((row) => ({
    ...row,
    rsGlobalSample: sortedGlobal.length,
    rsGlobalPct: percentileFromSorted(row.rsCompositeRaw, sortedGlobal, minGlobalSample),
  }));
  out = addScopedPercentile(out, (row) => row.country || countryCode(row.symbol), "rsCompositeRaw", "rsCountryPct", "rsCountrySample", minScopedSample);
  out = addScopedPercentile(out, (row) => row.theme || row.sector, "rsCompositeRaw", "rsSectorPct", "rsSectorSample", minScopedSample);
  return out;
}

export function scoreRsQuality(row = {}) {
  const rs = rsPrimaryValue(row);
  if (!Number.isFinite(rs)) return null;
  let stability = 72;
  if (Number.isFinite(row.volatility63d)) {
    if (row.volatility63d <= 28) stability += 14;
    else if (row.volatility63d <= 45) stability += 7;
    else if (row.volatility63d <= 70) stability -= 3;
    else if (row.volatility63d <= 105) stability -= 10;
    else stability -= 17;
  }
  if (Number.isFinite(row.maxDrawdown63d)) {
    if (row.maxDrawdown63d <= 10) stability += 10;
    else if (row.maxDrawdown63d <= 18) stability += 4;
    else if (row.maxDrawdown63d <= 32) stability -= 4;
    else stability -= 12;
  }
  if (Number.isFinite(row.maxDailyMove20dPct)) {
    if (row.maxDailyMove20dPct <= 6) stability += 5;
    else if (row.maxDailyMove20dPct <= 10) stability += 2;
    else if (row.maxDailyMove20dPct > 28) stability -= 12;
    else if (row.maxDailyMove20dPct > 18) stability -= 6;
  }
  if (Number.isFinite(row.range63dPct)) {
    if (row.range63dPct <= 45) stability += 4;
    else if (row.range63dPct > 100) stability -= 8;
  }
  if (Number.isFinite(row.highsSpreadPct)) {
    if (row.highsSpreadPct <= 8) stability += 6;
    else if (row.highsSpreadPct > 22) stability -= 8;
  }
  if (Number.isFinite(row.extSma50) && row.extSma50 > 28) stability -= 8;
  const rsQualityScore = clamp(rs * .62 + clamp(stability) * .28 + (Number.isFinite(row.riskRewardScore) ? row.riskRewardScore : 45) * .1);
  const speculationRiskScore = clamp(
    Math.max(0, (Number.isFinite(row.volatility63d) ? row.volatility63d : 35) - 35) * .62 +
    Math.max(0, Number.isFinite(row.maxDrawdown63d) ? row.maxDrawdown63d : 12) * .85 +
    Math.max(0, (Number.isFinite(row.maxDailyMove20dPct) ? row.maxDailyMove20dPct : 8) - 10) * 1.35 +
    Math.max(0, (Number.isFinite(row.range63dPct) ? row.range63dPct : 45) - 80) * .22 +
    Math.max(0, (Number.isFinite(row.extSma50) ? row.extSma50 : 0) - 18) * .85 -
    (Number.isFinite(row.liquidityScore) ? row.liquidityScore : 45) * .12
  );
  return {
    rsQualityScore,
    rsStabilityScore: clamp(stability),
    speculationRiskScore,
    rsQualityLabel: rs >= 80 && rsQualityScore >= 72 ? "RS limpio" : rs >= 80 && speculationRiskScore >= 55 ? "RS volatil" : rs >= 75 && rsQualityScore >= 62 ? "RS eficiente" : speculationRiskScore >= 70 ? "Momentum especulativo" : rs >= 60 ? "RS constructivo" : "RS debil",
  };
}
