import {
  avg,
  avgDailyRangePct,
  avgVolume,
  firstFinite,
  highDist,
  highValue,
  lowAdv,
  maxDailyMovePct,
  maxDailyRangePct,
  maxDrawdown,
  perf,
  priceRangePct,
  riskAdjustedStats,
  sma,
  udVol,
} from "@/lib/indicators";
import { scoreRelativeStrength } from "@/lib/relativeStrength";

export const OBJECTIVE_METRIC_AUDIT_VERSION = 1;

const PRICE_SOURCE = "chart-bars";
const SCORE_SOURCE = "score-formula";
const UNIVERSE_SOURCE = "universe-percentile";
const PROXY_SOURCE = "proxy-formula";

const LABELS = {
  price: "Precio",
  chartBarsCount: "Barras",
  sma50: "SMA50",
  sma150: "SMA150",
  sma200: "SMA200",
  sma200Slope: "Pendiente SMA200",
  distance20d: "Dist. max 20d",
  distance50d: "Dist. max 50d",
  distance52w: "Dist. max 52w",
  distanceATH: "Dist. max hist.",
  highsSpreadPct: "Spread maximos",
  lowAdvance52w: "Avance min 52w",
  perf3m: "Perf 3M",
  perf6m: "Perf 6M",
  perf12m: "Perf 12M",
  extSma50: "Ext. SMA50",
  avgVolume: "Vol medio 20d",
  avgVolume5: "Vol medio 5d",
  prevAvgVolume20: "Vol medio previo",
  latestVolume: "Vol ultimo",
  avgTurnover: "Importe medio",
  latestTurnover: "Importe ultimo",
  relativeVolume: "Vol relativo",
  volumeSurgePct: "Impulso volumen",
  upDownVolRatio: "Up/Down vol",
  volatility63d: "Volatilidad 63d",
  downsideVolatility63d: "Vol bajista 63d",
  maxDrawdown63d: "Max DD 63d",
  maxDailyMove20dPct: "Max movimiento 20d",
  maxDailyRange20dPct: "Max rango 20d",
  avgDailyRange20dPct: "Rango medio 20d",
  range63dPct: "Rango 63d",
  returnToVol3m: "Ret/vol 3M",
  returnToDownsideVol3m: "Ret/vol bajista",
  returnToDrawdown3m: "Ret/DD 3M",
  rsRating: "RS benchmark",
  rs3m: "RS 3M",
  rs6m: "RS 6M",
  rs12m: "RS 12M",
  benchmarkPerf3m: "Bench 3M",
  benchmarkPerf6m: "Bench 6M",
  benchmarkPerf12m: "Bench 12M",
  totalScore: "Score",
  compositeScore: "Composite",
  objectiveScore: "Score objetivo",
  rsGlobalPct: "RS global",
  rsCountryPct: "RS pais",
  rsSectorPct: "RS sector",
  adProxyScore: "A/D proxy",
  epsGrowthProxyScore: "EPS proxy",
};

const TOLERANCE = {
  price: { abs: 0.02, rel: 0.0005 },
  sma50: { abs: 0.03, rel: 0.0005 },
  sma150: { abs: 0.03, rel: 0.0005 },
  sma200: { abs: 0.03, rel: 0.0005 },
  avgVolume: { abs: 1, rel: 0.001 },
  avgVolume5: { abs: 1, rel: 0.001 },
  prevAvgVolume20: { abs: 1, rel: 0.001 },
  latestVolume: { abs: 1, rel: 0.001 },
  avgTurnover: { abs: 10, rel: 0.001 },
  latestTurnover: { abs: 10, rel: 0.001 },
  rsRating: { abs: 0.6, rel: 0 },
  totalScore: { abs: 0.03, rel: 0.0005 },
  compositeScore: { abs: 0.03, rel: 0.0005 },
  objectiveScore: { abs: 0.03, rel: 0.0005 },
  default: { abs: 0.08, rel: 0.001 },
};

const SCORE_COMPONENTS = [
  ["setupQualityScore", 0.17],
  ["rsAnchor", 0.16],
  ["rsQualityScore", 0.06],
  ["demandScore", 0.10],
  ["adProxyScore", 0.08],
  ["growthScore", 0.08],
  ["epsAnchor", 0.08],
  ["sectorScore", 0.10],
  ["riskRewardScore", 0.08],
  ["riskScore", 0.05],
  ["momentumScore", 0.02],
  ["ipoScore", 0.02],
];

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanText(value = "", limit = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function compactNumber(value, digits = 4) {
  const n = finite(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function rowValue(row = {}, key = "") {
  return row?.[key] ?? row?.metrics?.[key] ?? row?.raw?.[key] ?? row?.snapshot?.[key];
}

function normalizeBars(bars = []) {
  return (Array.isArray(bars) ? bars : [])
    .map((bar) => ({
      ...bar,
      date: String(bar?.date || "").slice(0, 10),
      open: firstFinite(bar?.open, bar?.close),
      high: firstFinite(bar?.high, bar?.close),
      low: firstFinite(bar?.low, bar?.close),
      close: firstFinite(bar?.close),
      volume: firstFinite(bar?.volume),
    }))
    .filter((bar) => bar.date && Number.isFinite(bar.close) && bar.close > 0)
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

function toleranceFor(key = "", expected = null) {
  const spec = TOLERANCE[key] || TOLERANCE.default;
  const base = Number(spec.abs || 0);
  const relative = Math.abs(Number(expected || 0)) * Number(spec.rel || 0);
  return Math.max(base, relative);
}

function statusRank(status = "") {
  return {
    mismatch: 5,
    "unverified-value": 5,
    missing: 4,
    "missing-source": 4,
    "insufficient-input": 3,
    traceable: 2,
    verified: 1,
    unavailable: 0,
  }[status] || 0;
}

function strongestStatus(a = "verified", b = "verified") {
  return statusRank(b) > statusRank(a) ? b : a;
}

function severityFor(status = "", critical = true) {
  if (status === "mismatch" || status === "unverified-value" || status === "missing-source") return critical ? "bad" : "warn";
  if (status === "missing") return critical ? "bad" : "warn";
  if (status === "insufficient-input") return "warn";
  return "neutral";
}

function metricEntry(row = {}, {
  key,
  expected = null,
  source = PRICE_SOURCE,
  formula = "",
  inputCount = null,
  minInputCount = null,
  asOf = "",
  critical = true,
  kind = "objective",
  proxy = false,
  traceable = false,
} = {}) {
  const displayed = finite(rowValue(row, key));
  const calculated = finite(expected);
  const tol = Number.isFinite(calculated) ? toleranceFor(key, calculated) : null;
  let status = "verified";
  let diff = null;

  if (traceable && Number.isFinite(displayed)) {
    status = "traceable";
  } else if (Number.isFinite(calculated)) {
    if (!Number.isFinite(displayed)) {
      status = "missing";
    } else {
      diff = Math.abs(displayed - calculated);
      status = diff <= tol ? "verified" : "mismatch";
    }
  } else if (Number.isFinite(displayed)) {
    status = "unverified-value";
  } else if (Number.isFinite(inputCount) && Number.isFinite(minInputCount) && inputCount < minInputCount) {
    status = "insufficient-input";
  } else {
    status = "unavailable";
  }

  return {
    key,
    label: LABELS[key] || key,
    value: compactNumber(displayed),
    expected: compactNumber(calculated),
    diff: compactNumber(diff),
    tolerance: compactNumber(tol),
    source,
    formula,
    inputCount: Number.isFinite(inputCount) ? Math.round(inputCount) : null,
    minInputCount: Number.isFinite(minInputCount) ? Math.round(minInputCount) : null,
    asOf: cleanText(asOf, 32),
    status,
    severity: severityFor(status, critical),
    critical: critical === true,
    kind,
    proxy: proxy === true,
  };
}

function summarize(items = [], meta = {}) {
  const issues = items
    .filter((item) => ["bad", "warn"].includes(item.severity))
    .sort((a, b) => statusRank(b.status) - statusRank(a.status) || Number(b.critical) - Number(a.critical))
    .slice(0, 8);
  const worst = items.reduce((status, item) => strongestStatus(status, item.status), "verified");
  const bad = issues.some((item) => item.severity === "bad");
  const warn = issues.some((item) => item.severity === "warn");
  const status = bad ? "bad" : warn ? "warn" : "verified";
  const checkedCount = items.filter((item) => item.status !== "unavailable").length;
  const verifiedCount = items.filter((item) => item.status === "verified").length;
  const traceableCount = items.filter((item) => item.status === "traceable").length;
  return {
    schemaVersion: OBJECTIVE_METRIC_AUDIT_VERSION,
    status,
    worstStatus: worst,
    checkedCount,
    verifiedCount,
    traceableCount,
    issueCount: issues.length,
    source: cleanText(meta.source || "", 80),
    asOf: cleanText(meta.asOf || "", 32),
    barsCount: Number.isFinite(meta.barsCount) ? Math.round(meta.barsCount) : null,
    issues: issues.map((item) => ({
      key: item.key,
      label: item.label,
      status: item.status,
      severity: item.severity,
      value: item.value,
      expected: item.expected,
      diff: item.diff,
      source: item.source,
      formula: item.formula,
      inputCount: item.inputCount,
      minInputCount: item.minInputCount,
    })),
    items,
  };
}

function calcBarsWithPrice(bars = [], price = null) {
  const normalized = normalizeBars(bars);
  const currentPrice = finite(price) ?? normalized[0]?.close;
  if (!normalized.length || !Number.isFinite(currentPrice)) return normalized;
  return normalized.map((bar, index) => {
    if (index !== 0) return bar;
    const high = firstFinite(bar.high, bar.close, currentPrice);
    const low = firstFinite(bar.low, bar.close, currentPrice);
    return {
      ...bar,
      close: currentPrice,
      high: Number.isFinite(high) ? Math.max(high, currentPrice) : currentPrice,
      low: Number.isFinite(low) ? Math.min(low, currentPrice) : currentPrice,
    };
  });
}

function priceDerivedMetrics(bars = [], price = null) {
  const rows = calcBarsWithPrice(bars, price);
  const s50 = sma(rows, 50);
  const s150 = sma(rows, 150);
  const s200 = sma(rows, 200);
  const s200p = sma(rows, 200, 30);
  const h20 = highValue(rows, 20);
  const h65 = highValue(rows, 65);
  const avgVol20 = avgVolume(rows.slice(0, 20));
  const avgVol5 = avgVolume(rows.slice(0, 5));
  const prevVol20 = avgVolume(rows.slice(5, 25));
  const latestVolume = firstFinite(rows[0]?.volume);
  const perf3m = perf(rows, 63);
  const risk = riskAdjustedStats(rows, perf3m);
  const close = firstFinite(price, rows[0]?.close);
  return {
    rows,
    values: {
      price: close,
      chartBarsCount: rows.length,
      sma50: s50,
      sma150: s150,
      sma200: s200,
      sma200Slope: s200 && s200p ? ((s200 / s200p) - 1) * 100 : null,
      distance20d: highDist(rows, 20),
      distance50d: highDist(rows, 50),
      distance52w: highDist(rows, 252),
      distanceATH: highDist(rows, rows.length),
      highsSpreadPct: h20 && h65 ? Math.abs((h20 / h65) - 1) * 100 : null,
      lowAdvance52w: lowAdv(rows, 252),
      perf3m,
      perf6m: perf(rows, 126),
      perf12m: perf(rows, 252),
      extSma50: s50 && Number.isFinite(close) ? ((close / s50) - 1) * 100 : null,
      avgVolume: avgVol20,
      avgVolume5: avgVol5,
      prevAvgVolume20: prevVol20,
      latestVolume,
      avgTurnover: Number.isFinite(avgVol20) && Number.isFinite(close) ? avgVol20 * close : null,
      latestTurnover: Number.isFinite(latestVolume) && Number.isFinite(close) ? latestVolume * close : null,
      relativeVolume: Number.isFinite(avgVol20) && avgVol20 > 0 && Number.isFinite(latestVolume) ? latestVolume / avgVol20 : null,
      volumeSurgePct: Number.isFinite(prevVol20) && prevVol20 > 0 && Number.isFinite(avgVol5) ? ((avgVol5 / prevVol20) - 1) * 100 : null,
      upDownVolRatio: udVol(rows, 50),
      volatility63d: risk.volatility63d,
      downsideVolatility63d: risk.downsideVolatility63d,
      maxDrawdown63d: maxDrawdown(rows, 63),
      maxDailyMove20dPct: maxDailyMovePct(rows, 20),
      maxDailyRange20dPct: maxDailyRangePct(rows, 20),
      avgDailyRange20dPct: avgDailyRangePct(rows, 20),
      range63dPct: priceRangePct(rows, 63),
      returnToVol3m: risk.returnToVol3m,
      returnToDownsideVol3m: risk.returnToDownsideVol3m,
      returnToDrawdown3m: risk.returnToDrawdown3m,
    },
  };
}

export function buildObjectiveMetricAudit(row = {}, {
  bars = [],
  benchmarkBars = [],
  source = "",
  asOf = "",
} = {}) {
  const price = finite(rowValue(row, "price"));
  const { rows, values } = priceDerivedMetrics(bars, price);
  const latestDate = asOf || rows[0]?.date || rowValue(row, "lastDate") || "";
  if (!rows.length) {
    return summarize([
      metricEntry(row, {
        key: "chartBarsCount",
        expected: null,
        source: PRICE_SOURCE,
        formula: "daily bars required",
        inputCount: 0,
        minInputCount: 20,
        asOf: latestDate,
        critical: true,
      }),
    ], { source: source || rowValue(row, "chartProvider") || PRICE_SOURCE, asOf: latestDate, barsCount: 0 });
  }

  const metricSpecs = [
    ["price", 1, "latest close or provider price"],
    ["chartBarsCount", 20, "count(valid daily bars)"],
    ["sma50", 50, "avg(close, 50)"],
    ["sma150", 150, "avg(close, 150)"],
    ["sma200", 200, "avg(close, 200)"],
    ["sma200Slope", 230, "(sma200 / sma200[30d ago] - 1) * 100"],
    ["distance20d", 20, "(price / max(high,20) - 1) * 100"],
    ["distance50d", 50, "(price / max(high,50) - 1) * 100"],
    ["distance52w", 252, "(price / max(high,252) - 1) * 100"],
    ["distanceATH", 20, "(price / max(high,all bars) - 1) * 100"],
    ["highsSpreadPct", 65, "abs(max20 / max65 - 1) * 100"],
    ["lowAdvance52w", 252, "(price / min(low,252) - 1) * 100"],
    ["perf3m", 64, "(price / close[63] - 1) * 100"],
    ["perf6m", 127, "(price / close[126] - 1) * 100"],
    ["perf12m", 253, "(price / close[252] - 1) * 100"],
    ["extSma50", 50, "(price / sma50 - 1) * 100"],
    ["avgVolume", 20, "avg(volume,20)"],
    ["avgVolume5", 5, "avg(volume,5)"],
    ["prevAvgVolume20", 25, "avg(volume, days 5-25)"],
    ["latestVolume", 1, "latest volume"],
    ["avgTurnover", 20, "avgVolume20 * price"],
    ["latestTurnover", 1, "latestVolume * price"],
    ["relativeVolume", 20, "latestVolume / avgVolume20"],
    ["volumeSurgePct", 25, "(avgVolume5 / prevAvgVolume20 - 1) * 100"],
    ["upDownVolRatio", 51, "sum(up volume,50) / sum(down volume,50)"],
    ["volatility63d", 64, "stdev(daily returns,63) * sqrt(252)"],
    ["downsideVolatility63d", 64, "downside stdev(daily returns,63) * sqrt(252)"],
    ["maxDrawdown63d", 63, "max peak-to-trough drawdown,63"],
    ["maxDailyMove20dPct", 21, "max(abs(daily return),20)"],
    ["maxDailyRange20dPct", 20, "max((high-low)/close,20)"],
    ["avgDailyRange20dPct", 20, "avg((high-low)/close,20)"],
    ["range63dPct", 63, "(max(high,63) / min(low,63) - 1) * 100"],
    ["returnToVol3m", 64, "perf3m / volatility63d"],
    ["returnToDownsideVol3m", 64, "perf3m / downsideVolatility63d"],
    ["returnToDrawdown3m", 64, "perf3m / maxDrawdown63d"],
  ];

  const items = metricSpecs.map(([key, minInputCount, formula]) => metricEntry(row, {
    key,
    expected: values[key],
    source: source || rowValue(row, "chartProvider") || PRICE_SOURCE,
    formula,
    inputCount: rows.length,
    minInputCount,
    asOf: latestDate,
    critical: ["price", "chartBarsCount", "sma50", "sma200", "distance52w", "perf3m", "extSma50"].includes(key),
  }));

  const benchmark = normalizeBars(benchmarkBars);
  const rs = scoreRelativeStrength({ ...row, ...values }, benchmark);
  for (const [key, minInputCount, formula] of [
    ["rsRating", 253, "benchmark relative-strength model"],
    ["rs3m", 64, "perf3m - benchmarkPerf3m"],
    ["rs6m", 127, "perf6m - benchmarkPerf6m"],
    ["rs12m", 253, "perf12m - benchmarkPerf12m"],
    ["benchmarkPerf3m", 64, "benchmark perf 3M"],
    ["benchmarkPerf6m", 127, "benchmark perf 6M"],
    ["benchmarkPerf12m", 253, "benchmark perf 12M"],
  ]) {
    items.push(metricEntry(row, {
      key,
      expected: rs[key],
      source: rowValue(row, "benchmarkSymbol") || "benchmark",
      formula,
      inputCount: benchmark.length,
      minInputCount,
      asOf: benchmark[0]?.date || latestDate,
      critical: key === "rsRating" && Number.isFinite(rowValue(row, key)),
    }));
  }

  return summarize(items, { source: source || rowValue(row, "chartProvider") || PRICE_SOURCE, asOf: latestDate, barsCount: rows.length });
}

function scoreFormulaValue(row = {}, { setupField = "setupQualityScore" } = {}) {
  const rsAnchor = finite(rowValue(row, "rsGlobalPct")) ?? finite(rowValue(row, "rsRating")) ?? 50;
  const epsAnchor = finite(rowValue(row, "epsGrowthProxyScore")) ?? finite(rowValue(row, "growthScore"));
  const values = {
    setupQualityScore: finite(rowValue(row, setupField)),
    rsAnchor,
    rsQualityScore: finite(rowValue(row, "rsQualityScore")) ?? rsAnchor,
    demandScore: finite(rowValue(row, "demandScore")),
    adProxyScore: finite(rowValue(row, "adProxyScore")),
    growthScore: finite(rowValue(row, "growthScore")),
    epsAnchor,
    sectorScore: finite(rowValue(row, "sectorScore")) ?? finite(rowValue(row, "groupStrengthScore")),
    riskRewardScore: finite(rowValue(row, "riskRewardScore")),
    riskScore: finite(rowValue(row, "riskScore")),
    momentumScore: finite(rowValue(row, "momentumScore")),
    ipoScore: finite(rowValue(row, "ipoScore")) ?? 0,
  };
  const missing = SCORE_COMPONENTS
    .filter(([key]) => !Number.isFinite(values[key]))
    .map(([key]) => key === "setupQualityScore" ? setupField : key);
  if (missing.length) return { value: null, missing };
  const value = SCORE_COMPONENTS.reduce((sum, [key, weight]) => sum + values[key] * weight, 0);
  return { value, missing: [] };
}

function traceableUniverseMetric(row = {}, key = "", sampleKey = "", minSample = 1) {
  const sample = finite(rowValue(row, sampleKey));
  const value = finite(rowValue(row, key));
  const hasEnoughSample = Number.isFinite(sample) && sample >= minSample;
  return metricEntry(row, {
    key,
    expected: null,
    source: UNIVERSE_SOURCE,
    formula: `${key} percentile over scan universe`,
    inputCount: sample,
    minInputCount: minSample,
    critical: Number.isFinite(value),
    traceable: Number.isFinite(value) && hasEnoughSample,
  });
}

export function addScoredObjectiveMetricAudit(row = {}) {
  const prior = objectiveMetricAuditForRow(row);
  const baseItems = Array.isArray(prior?.items) ? prior.items : [];
  const score = scoreFormulaValue(row);
  const objectiveScore = scoreFormulaValue(row, { setupField: "objectiveSetupScore" });
  const hasObjectiveScoreContract = Number.isFinite(finite(rowValue(row, "objectiveScore")))
    || Number.isFinite(finite(rowValue(row, "objectiveSetupScore")));
  const scoreFormula = "setup*.17 + rs*.16 + rsQuality*.06 + demand*.10 + ad*.08 + growth*.08 + eps*.08 + sector*.10 + riskReward*.08 + risk*.05 + momentum*.02 + ipo*.02";
  const items = [
    ...baseItems,
    metricEntry(row, {
      key: "totalScore",
      expected: score.value,
      source: SCORE_SOURCE,
      formula: score.missing.length ? `missing: ${score.missing.join(", ")}` : scoreFormula,
      inputCount: SCORE_COMPONENTS.length - score.missing.length,
      minInputCount: SCORE_COMPONENTS.length,
      critical: true,
    }),
    ...(hasObjectiveScoreContract ? [
      metricEntry(row, {
        key: "objectiveScore",
        expected: objectiveScore.value,
        source: SCORE_SOURCE,
        formula: objectiveScore.missing.length ? `missing: ${objectiveScore.missing.join(", ")}` : scoreFormula.replace("setup*.17", "objectiveSetup*.17"),
        inputCount: SCORE_COMPONENTS.length - objectiveScore.missing.length,
        minInputCount: SCORE_COMPONENTS.length,
        critical: true,
      }),
    ] : []),
    metricEntry(row, {
      key: "compositeScore",
      expected: score.value,
      source: SCORE_SOURCE,
      formula: score.missing.length ? `missing: ${score.missing.join(", ")}` : scoreFormula,
      inputCount: SCORE_COMPONENTS.length - score.missing.length,
      minInputCount: SCORE_COMPONENTS.length,
      critical: true,
    }),
    traceableUniverseMetric(row, "rsGlobalPct", "rsGlobalSample", 20),
    traceableUniverseMetric(row, "rsCountryPct", "rsCountrySample", 5),
    traceableUniverseMetric(row, "rsSectorPct", "rsSectorSample", 5),
    metricEntry(row, {
      key: "adProxyScore",
      expected: null,
      source: PROXY_SOURCE,
      formula: "volume/accumulation proxy; traceable proxy, not raw exchange A/D",
      inputCount: Number.isFinite(finite(rowValue(row, "adProxyScore"))) ? 1 : 0,
      minInputCount: 1,
      critical: false,
      proxy: true,
      traceable: Number.isFinite(finite(rowValue(row, "adProxyScore"))),
    }),
    metricEntry(row, {
      key: "epsGrowthProxyScore",
      expected: null,
      source: PROXY_SOURCE,
      formula: "fundamental growth proxy; not reported EPS itself",
      inputCount: Number.isFinite(finite(rowValue(row, "epsGrowthProxyScore"))) ? 1 : 0,
      minInputCount: 1,
      critical: false,
      proxy: true,
      traceable: Number.isFinite(finite(rowValue(row, "epsGrowthProxyScore"))),
    }),
  ];
  return {
    ...row,
    objectiveMetricAudit: summarize(items, {
      source: prior?.source || rowValue(row, "chartProvider") || PRICE_SOURCE,
      asOf: prior?.asOf || rowValue(row, "lastDate") || "",
      barsCount: prior?.barsCount ?? finite(rowValue(row, "chartBarsCount")),
    }),
  };
}

export function compactObjectiveMetricAudit(audit = null) {
  if (!audit || typeof audit !== "object") return null;
  const items = Array.isArray(audit.items) ? audit.items : [];
  return {
    schemaVersion: audit.schemaVersion || OBJECTIVE_METRIC_AUDIT_VERSION,
    status: audit.status || "missing-source",
    worstStatus: audit.worstStatus || "missing-source",
    checkedCount: finite(audit.checkedCount) ?? items.length,
    verifiedCount: finite(audit.verifiedCount) ?? items.filter((item) => item.status === "verified").length,
    traceableCount: finite(audit.traceableCount) ?? items.filter((item) => item.status === "traceable").length,
    issueCount: finite(audit.issueCount) ?? (Array.isArray(audit.issues) ? audit.issues.length : 0),
    source: cleanText(audit.source, 80),
    asOf: cleanText(audit.asOf, 32),
    barsCount: finite(audit.barsCount),
    issues: Array.isArray(audit.issues) ? audit.issues.slice(0, 8).map((item) => ({
      key: cleanText(item.key, 80),
      label: cleanText(item.label || item.key, 120),
      status: cleanText(item.status, 40),
      severity: cleanText(item.severity, 20),
      value: compactNumber(item.value),
      expected: compactNumber(item.expected),
      diff: compactNumber(item.diff),
      source: cleanText(item.source, 80),
      formula: cleanText(item.formula, 160),
      inputCount: finite(item.inputCount),
      minInputCount: finite(item.minInputCount),
    })) : [],
    items: items.slice(0, 48).map((item) => ({
      key: cleanText(item.key, 80),
      label: cleanText(item.label || item.key, 120),
      value: compactNumber(item.value),
      expected: compactNumber(item.expected),
      diff: compactNumber(item.diff),
      tolerance: compactNumber(item.tolerance),
      source: cleanText(item.source, 80),
      formula: cleanText(item.formula, 160),
      inputCount: finite(item.inputCount),
      minInputCount: finite(item.minInputCount),
      asOf: cleanText(item.asOf, 32),
      status: cleanText(item.status, 40),
      severity: cleanText(item.severity, 20),
      critical: item.critical === true,
      kind: cleanText(item.kind || "objective", 40),
      proxy: item.proxy === true,
    })),
  };
}

export function objectiveMetricAuditForRow(row = {}) {
  return row?.objectiveMetricAudit
    || row?.metrics?.objectiveMetricAudit
    || row?.raw?.objectiveMetricAudit
    || row?.snapshot?.objectiveMetricAudit
    || null;
}

export function objectiveMetricAuditStatusForRow(row = {}) {
  const audit = objectiveMetricAuditForRow(row);
  if (!audit || typeof audit !== "object") {
    return {
      key: "missing",
      label: "Metricas sin auditoria",
      tone: "warn",
      detail: "La fila no trae provenance numerica objetiva.",
      audit: null,
    };
  }
  const issues = Array.isArray(audit.issues) ? audit.issues : [];
  const bad = audit.status === "bad" || issues.some((item) => item.severity === "bad");
  const warn = audit.status === "warn" || issues.some((item) => item.severity === "warn");
  if (bad) {
    return {
      key: "bad",
      label: "Metricas objetivas bloqueadas",
      tone: "bad",
      detail: issues.slice(0, 3).map((item) => `${item.label || item.key}: ${item.status}`).join(" · ") || "mismatch numerico",
      audit,
    };
  }
  if (warn) {
    return {
      key: "warn",
      label: "Metricas a verificar",
      tone: "warn",
      detail: issues.slice(0, 3).map((item) => `${item.label || item.key}: ${item.status}`).join(" · ") || "provenance parcial",
      audit,
    };
  }
  return {
    key: "verified",
    label: "Metricas verificadas",
    tone: "good",
    detail: `${audit.verifiedCount || 0} verificadas · ${audit.traceableCount || 0} trazables`,
    audit,
  };
}
