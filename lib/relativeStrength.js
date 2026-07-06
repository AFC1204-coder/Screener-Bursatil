import { countryCode } from "@/lib/symbols";

export const RS_ENGINE_VERSION = "statsedge-rs-v2";
export const RS_GLOBAL_MIN_SAMPLE = 20;
export const RS_SCOPED_MIN_SAMPLE = 5;

export const LOCAL_BENCHMARK_BY_COUNTRY = {
  US: "SPY",
  CA: "^GSPTSE",
  ES: "^IBEX",
  DE: "^GDAXI",
  FR: "^FCHI",
  NL: "^AEX",
  GB: "^FTSE",
  CH: "^SSMI",
  SE: "^OMX",
  DK: "^OMXC25",
  NO: "^OSEAX",
  FI: "^OMXH25",
  IT: "^FTSEMIB.MI",
  BE: "^BFX",
  PT: "PSI20.LS",
  AT: "^ATX",
  JP: "^N225",
  HK: "^HSI",
  SG: "^STI",
  ZA: "^J203.JO",
  AU: "^AXJO",
  TW: "^TWII",
  IL: "^TA125.TA",
  KR: "^KS11",
  IN: "^BSESN",
  CN: "000001.SS",
  BR: "^BVSP",
  MX: "^MXX",
};

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

export function scoreFromEdge(edgePct, sensitivity = 20) {
  if (!Number.isFinite(edgePct)) return null;
  const score = 50 + ((2 / Math.PI) * 49 * Math.atan(edgePct / sensitivity));
  return clamp(score, 1, 99);
}

export function weightedScore(parts = [], fallback = null) {
  let total = 0;
  let weightTotal = 0;
  for (const [score, weight] of parts) {
    if (!Number.isFinite(score) || !Number.isFinite(weight) || weight <= 0) continue;
    total += score * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? total / weightTotal : fallback;
}

function perf(bars = [], n) {
  return bars.length > n && bars[0]?.close && bars[n]?.close ? ((bars[0].close / bars[n].close) - 1) * 100 : null;
}

function pctChangeBetween(now, then) {
  if (!Number.isFinite(now) || !Number.isFinite(then) || then === 0) return null;
  return ((now / then) - 1) * 100;
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
  const code = String(row.country || countryCode(row.symbol) || "").toUpperCase();
  return LOCAL_BENCHMARK_BY_COUNTRY[code] || "ACWI";
}

export function scoreRsBenchmarkModel(input = {}) {
  const relativeMomentumScore = weightedScore([
    [scoreFromEdge(input.rs1m, 14), .10],
    [scoreFromEdge(input.rs3m, 14), .24],
    [scoreFromEdge(input.rs6m, 24), .26],
    [scoreFromEdge(input.rs12m, 42), .40],
  ], null);
  const absoluteMomentumScore = weightedScore([
    [scoreFromEdge(input.perf1m, 16), .10],
    [scoreFromEdge(input.perf3m, 20), .24],
    [scoreFromEdge(input.perf6m, 34), .26],
    [scoreFromEdge(input.perf12m, 65), .40],
  ], null);
  const momentumScore = weightedScore([
    [relativeMomentumScore, .78],
    [absoluteMomentumScore, .22],
  ], 50);
  const priceVs50 = firstFinite(input.priceVs50, pctChangeBetween(input.price, input.sma50));
  const priceVs200 = firstFinite(input.priceVs200, pctChangeBetween(input.price, input.sma200));
  const maStackEdge = firstFinite(input.maStackEdge, pctChangeBetween(input.sma50, input.sma200));
  const technicalPostureScore = weightedScore([
    [scoreFromEdge(priceVs50, 10), .24],
    [scoreFromEdge(priceVs200, 28), .24],
    [scoreFromEdge(maStackEdge, 12), .18],
    [scoreFromEdge(input.sma200Slope, 4), .16],
    [scoreFromEdge(Number.isFinite(input.distance52w) ? input.distance52w + 12 : null, 12), .18],
  ], 50);

  return weightedScore([
    [momentumScore, .70],
    [input.relativeLinePositionScore, .18],
    [technicalPostureScore, .12],
  ], 50);
}

export function scoreRelativeStrength(row = {}, benchmarkBars = []) {
  const bench1 = perf(benchmarkBars, 21);
  const bench3 = perf(benchmarkBars, 63);
  const bench6 = perf(benchmarkBars, 126);
  const bench12 = perf(benchmarkBars, 252);
  const rs1m = Number.isFinite(row.perf1m) && Number.isFinite(bench1) ? row.perf1m - bench1 : null;
  const rs3m = Number.isFinite(row.perf3m) && Number.isFinite(bench3) ? row.perf3m - bench3 : null;
  const rs6m = Number.isFinite(row.perf6m) && Number.isFinite(bench6) ? row.perf6m - bench6 : null;
  const rs12m = Number.isFinite(row.perf12m) && Number.isFinite(bench12) ? row.perf12m - bench12 : null;
  const hasBenchmarkComparison = [rs1m, rs3m, rs6m, rs12m].some(Number.isFinite);
  const raw = hasBenchmarkComparison ? scoreRsBenchmarkModel({
    rs1m,
    rs3m,
    rs6m,
    rs12m,
    perf1m: row.perf1m,
    perf3m: row.perf3m,
    perf6m: row.perf6m,
    perf12m: row.perf12m,
    price: row.price,
    sma50: row.sma50,
    sma200: row.sma200,
    sma200Slope: row.sma200Slope,
    distance52w: row.distance52w,
  }) : null;
  return {
    rs1m,
    rs3m,
    rs6m,
    rs12m,
    benchmarkPerf1m: bench1,
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
    const calculated = percentileFromSorted(row[valueKey], sorted, minSample);
    return {
      ...row,
      [sampleKey]: sample,
      [outKey]: calculated,
    };
  });
}

export function enrichRelativePercentiles(rows = [], options = {}) {
  if (!rows.length) return rows;
  const minGlobalSample = Number.isFinite(options.minGlobalSample) ? options.minGlobalSample : RS_GLOBAL_MIN_SAMPLE;
  const minScopedSample = Number.isFinite(options.minScopedSample) ? options.minScopedSample : RS_SCOPED_MIN_SAMPLE;
  const withRaw = rows.map((row) => ({ ...row, rsCompositeRaw: rsRawComposite(row) }));
  const sortedGlobal = withRaw.map((row) => row.rsCompositeRaw).filter(Number.isFinite).sort((a, b) => a - b);
  let out = withRaw.map((row) => {
    const calculatedPct = percentileFromSorted(row.rsCompositeRaw, sortedGlobal, minGlobalSample);
    return {
      ...row,
      rsGlobalSample: sortedGlobal.length,
      rsGlobalPct: calculatedPct,
    };
  });
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
