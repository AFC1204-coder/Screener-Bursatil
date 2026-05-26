import { dailyLongBiasIssue, isConfirmedStage2, stage2RejectDetail } from "@/lib/trendStructure";

const DEFAULT_PRICE_FRESHNESS_DAYS = 5;

export const SCREENER_FILTER_QUERY_KEYS = [
  "filterPreset",
  "filterStrictness",
  "setupMode",
  "requireStage2",
  "requireSma200Up",
  "requirePriceAboveSma50",
  "requireRecentIpo",
  "requireUpVolume",
  "stageFastWeeks",
  "stageSlowWeeks",
  "stageSlopeWeeks",
  "minPrice",
  "minMarketCap",
  "minAvgVolume",
  "minAvgTurnover",
  "minLatestVolume",
  "minLatestTurnover",
  "minRelativeVolume",
  "minVolumeSurgePct",
  "minUpDownVolRatio",
  "minVolumeEffectScore",
  "minShortFloatPct",
  "maxShortFloatPct",
  "minPerf3m",
  "minPerf6m",
  "minPerf12m",
  "maxDistance20dHigh",
  "maxDistance50dHigh",
  "maxDistance52w",
  "maxDistanceATH",
  "maxHighsSpreadPct",
  "maxExtensionSma50",
  "maxDailyMove20dPct",
  "maxDailyRange20dPct",
  "maxRange63dPct",
  "maxVolatility63d",
  "maxDrawdown63d",
  "minRiskRewardScore",
  "minReturnToVol3m",
  "minReturnToDrawdown3m",
  "minAdProxyScore",
  "minEpsGrowthProxyScore",
  "maxPriceFreshnessDays",
  "minDataCoverageScore",
  "minTechnicalCoverageScore",
  "minFundamentalCoverageScore",
  "minRsRating",
  "minRsBenchmarkRating",
  "minRsCountryPct",
  "minRsSectorPct",
  "minRsQualityScore",
  "minSectorScore",
  "minWeinsteinScore",
  "minMinerviniScore",
  "minMomentumScore",
  "minRiskScore",
  "minVolumeScore",
  "minLiquidityScore",
  "minTotalScore",
  "minWeaknessScore",
  "maxIpoAgeMonths",
];

const BOOLEAN_KEYS = new Set([
  "requireStage2",
  "requireSma200Up",
  "requirePriceAboveSma50",
  "requireRecentIpo",
  "requireUpVolume",
]);

const STRING_KEYS = new Set(["filterStrictness", "setupMode"]);
const DEFAULT_FILTER_STRICTNESS = "balanced";
const FILTER_STRICTNESS_KEYS = new Set(["strict", "balanced", "discovery"]);

const WEB_FILTER_PRESETS = {
  balanced: {
    filterStrictness: "balanced",
    setupMode: "leader",
    requireStage2: true,
    requireSma200Up: false,
    requirePriceAboveSma50: false,
    requireRecentIpo: false,
    requireUpVolume: false,
    maxIpoAgeMonths: 60,
    maxPriceFreshnessDays: DEFAULT_PRICE_FRESHNESS_DAYS,
    minWeinsteinScore: 50,
    minMinerviniScore: 38,
    minMomentumScore: 15,
    minRiskScore: 15,
    minVolumeScore: 0,
    minLiquidityScore: 0,
    minRsRating: 50,
    minDataCoverageScore: 35,
    minTechnicalCoverageScore: 45,
    minFundamentalCoverageScore: 0,
    minAvgTurnover: 1500000,
    minMarketCap: 200000000,
    minPrice: 2,
    minAvgVolume: 150000,
    maxDistance20dHigh: 20,
    maxDistance50dHigh: 30,
    maxDistance52w: 40,
    maxDistanceATH: 70,
    maxHighsSpreadPct: 25,
    minPerf3m: 3,
    minPerf6m: 8,
    minPerf12m: 12,
    maxExtensionSma50: 45,
    maxDailyMove20dPct: 25,
    maxDailyRange20dPct: 32,
    maxRange63dPct: 120,
    maxVolatility63d: 120,
    maxDrawdown63d: 40,
  },
  strict: {
    filterStrictness: "strict",
    setupMode: "leader",
    requireStage2: true,
    minMarketCap: 500000000,
    minPrice: 5,
    minAvgVolume: 500000,
    minAvgTurnover: 10000000,
    minLatestVolume: 250000,
    minLatestTurnover: 5000000,
    minUpDownVolRatio: 1,
    minVolumeEffectScore: 35,
    maxDistance20dHigh: 5,
    maxDistance50dHigh: 10,
    maxDistance52w: 15,
    maxDistanceATH: 25,
    maxHighsSpreadPct: 8,
    minPerf3m: 15,
    minPerf6m: 30,
    minPerf12m: 50,
    maxExtensionSma50: 25,
    maxDailyMove20dPct: 12,
    maxDailyRange20dPct: 16,
    maxRange63dPct: 55,
    maxVolatility63d: 60,
    maxDrawdown63d: 22,
    minWeinsteinScore: 75,
    minMinerviniScore: 65,
    minMomentumScore: 45,
    minRiskScore: 50,
    minVolumeScore: 30,
    minLiquidityScore: 35,
    minRsRating: 75,
    minDataCoverageScore: 50,
    minTechnicalCoverageScore: 70,
    minSectorScore: 55,
    minTotalScore: 68,
  },
  broad: {
    filterStrictness: "discovery",
    setupMode: "any",
    requireStage2: false,
    minDataCoverageScore: 20,
    minTechnicalCoverageScore: 35,
    minMarketCap: 150000000,
    minPrice: 2,
    minAvgVolume: 100000,
    minAvgTurnover: 1000000,
    minPerf3m: 0,
    minPerf6m: 5,
    minPerf12m: 10,
    maxDistance20dHigh: 25,
    maxDistance50dHigh: 35,
    maxDistance52w: 40,
    maxDistanceATH: 60,
    maxHighsSpreadPct: 35,
    maxExtensionSma50: 45,
    minWeinsteinScore: 25,
    minMinerviniScore: 20,
    minMomentumScore: 0,
    minRiskScore: 0,
    minVolumeScore: 0,
    minLiquidityScore: 0,
    minRsRating: 0,
    maxDailyMove20dPct: 999,
    maxDailyRange20dPct: 999,
    maxRange63dPct: 999,
    maxVolatility63d: 999,
    maxDrawdown63d: 999,
  },
  nearPivot: {
    filterStrictness: "balanced",
    setupMode: "nearPivot",
    requireStage2: true,
    minMarketCap: 250000000,
    minPrice: 3,
    minAvgVolume: 200000,
    minAvgTurnover: 2000000,
    maxDistance20dHigh: 6,
    maxDistance50dHigh: 12,
    maxDistance52w: 20,
    maxDistanceATH: 35,
    maxHighsSpreadPct: 10,
    minPerf3m: 6,
    minPerf6m: 12,
    minPerf12m: 18,
    maxExtensionSma50: 18,
    maxDailyMove20dPct: 14,
    maxDailyRange20dPct: 18,
    maxRange63dPct: 60,
    maxVolatility63d: 70,
    maxDrawdown63d: 22,
    minRiskScore: 45,
    minWeinsteinScore: 60,
    minMinerviniScore: 50,
    minRsRating: 58,
    minDataCoverageScore: 35,
    minTechnicalCoverageScore: 50,
    minTotalScore: 55,
  },
  ipo: {
    filterStrictness: "balanced",
    setupMode: "ipoRecent",
    requireStage2: false,
    requireRecentIpo: true,
    maxIpoAgeMonths: 60,
    minDataCoverageScore: 35,
    minTechnicalCoverageScore: 45,
    minMarketCap: 300000000,
    minPrice: 5,
    minAvgVolume: 200000,
    maxDistance20dHigh: 15,
    maxDistance50dHigh: 25,
    maxDistance52w: 30,
    maxDistanceATH: 40,
    maxHighsSpreadPct: 20,
    minPerf3m: 10,
    minPerf6m: 0,
    minPerf12m: -100,
    maxExtensionSma50: 35,
    maxDailyMove20dPct: 28,
    maxDailyRange20dPct: 34,
    maxRange63dPct: 120,
    maxVolatility63d: 140,
    minWeinsteinScore: 30,
    minMinerviniScore: 30,
    minMomentumScore: 35,
  },
  weakness: {
    filterStrictness: "strict",
    setupMode: "weakness",
    requireStage2: false,
    requireSma200Up: false,
    requirePriceAboveSma50: false,
    requireRecentIpo: false,
    requireUpVolume: false,
    minMarketCap: 150000000,
    minPrice: 2,
    minAvgVolume: 100000,
    minWeaknessScore: 55,
    minWeinsteinScore: 0,
    minMinerviniScore: 0,
    minMomentumScore: 0,
    minRiskScore: 0,
    minVolumeScore: 0,
    minLiquidityScore: 0,
    minRsRating: 0,
    minTotalScore: 0,
    minRelativeVolume: 0,
    minVolumeSurgePct: -999,
    minRiskRewardScore: 0,
    maxDistance20dHigh: 999,
    maxDistance50dHigh: 999,
    maxDistance52w: 999,
    maxDistanceATH: 999,
    maxHighsSpreadPct: 999,
    maxExtensionSma50: 999,
    maxDailyMove20dPct: 999,
    maxDailyRange20dPct: 999,
    maxRange63dPct: 999,
    maxVolatility63d: 999,
    maxDrawdown63d: 999,
  },
};

const FIELD_RULES = {
  minPrice: { op: "min", metric: "price", label: "precio" },
  minMarketCap: { op: "min", metric: "marketCap", label: "market cap" },
  minAvgVolume: { op: "min", metric: "avgVolume", label: "volumen medio" },
  minAvgTurnover: { op: "min", metric: "avgTurnover", label: "importe medio" },
  minLatestVolume: { op: "min", metric: "latestVolume", label: "volumen sesion" },
  minLatestTurnover: { op: "min", metric: "latestTurnover", label: "importe sesion" },
  minRelativeVolume: { op: "min", metric: "relativeVolume", label: "volumen relativo" },
  minVolumeSurgePct: { op: "min", metric: "volumeSurgePct", label: "volumen 5d" },
  minUpDownVolRatio: { op: "min", metric: "upDownVolRatio", label: "up/down volume" },
  minVolumeEffectScore: { op: "min", metric: "volumeEffectScore", label: "volume effect" },
  minShortFloatPct: { op: "min", metric: "shortPercentOfFloat", label: "short float" },
  maxShortFloatPct: { op: "max", metric: "shortPercentOfFloat", label: "short float" },
  minPerf3m: { op: "min", metric: "perf3m", label: "perf 3M" },
  minPerf6m: { op: "min", metric: "perf6m", label: "perf 6M" },
  minPerf12m: { op: "min", metric: "perf12m", label: "perf 12M" },
  maxHighsSpreadPct: { op: "max", metric: "highsSpreadPct", label: "highs spread" },
  maxExtensionSma50: { op: "max", metric: "extSma50", label: "extension SMA50" },
  maxDailyMove20dPct: { op: "max", metric: "maxDailyMove20dPct", label: "movimiento diario 20d" },
  maxDailyRange20dPct: { op: "max", metric: "maxDailyRange20dPct", label: "rango intradia 20d" },
  maxRange63dPct: { op: "max", metric: "range63dPct", label: "rango 63d" },
  maxVolatility63d: { op: "max", metric: "volatility63d", label: "volatilidad 63d" },
  maxDrawdown63d: { op: "max", metric: "maxDrawdown63d", label: "drawdown 63d" },
  minRiskRewardScore: { op: "min", metric: "riskRewardScore", label: "rentabilidad/riesgo" },
  minReturnToVol3m: { op: "min", metric: "returnToVol3m", label: "retorno/volatilidad" },
  minReturnToDrawdown3m: { op: "min", metric: "returnToDrawdown3m", label: "retorno/drawdown" },
  minAdProxyScore: { op: "min", metric: "adProxyScore", label: "A/D proxy" },
  minEpsGrowthProxyScore: { op: "min", metric: "epsGrowthProxyScore", label: "EPS/growth proxy" },
  minDataCoverageScore: { op: "min", metric: "dataCoverageScore", label: "cobertura total" },
  minTechnicalCoverageScore: { op: "min", metric: "technicalCoverageScore", label: "cobertura tecnica" },
  minFundamentalCoverageScore: { op: "min", metric: "fundamentalCoverageScore", label: "cobertura fundamental" },
  minRsBenchmarkRating: { op: "min", metric: "rsRating", label: "RS benchmark" },
  minRsCountryPct: { op: "min", metric: "rsCountryPct", label: "RS pais" },
  minRsSectorPct: { op: "min", metric: "rsSectorPct", label: "RS grupo" },
  minRsQualityScore: { op: "min", metric: "rsQualityScore", label: "RS quality" },
  minSectorScore: { op: "min", metric: "sectorScore", label: "fuerza grupo" },
  minWeinsteinScore: { op: "min", metric: "weinsteinScore", label: "Weinstein" },
  minMinerviniScore: { op: "min", metric: "minerviniScore", label: "Minervini" },
  minMomentumScore: { op: "min", metric: "momentumScore", label: "momentum score" },
  minRiskScore: { op: "min", metric: "riskScore", label: "risk score" },
  minVolumeScore: { op: "min", metric: "volumeScore", label: "volume score" },
  minLiquidityScore: { op: "min", metric: "liquidityScore", label: "liquidity score" },
  minTotalScore: { op: "min", metric: "totalScore", label: "composite" },
};

const DISTANCE_RULES = {
  maxDistance20dHigh: { metric: "distance20d", label: "distancia 20d" },
  maxDistance50dHigh: { metric: "distance50d", label: "distancia 50d" },
  maxDistance52w: { metric: "distance52w", label: "distancia 52w" },
  maxDistanceATH: { metric: "distanceATH", label: "distancia ATH" },
};

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolValue(value) {
  if (typeof value === "boolean") return value;
  const text = cleanText(value).toLowerCase();
  return ["1", "true", "yes", "y", "on", "si", "sí"].includes(text);
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export function normalizeFilterStrictness(value = "") {
  const key = cleanText(value || DEFAULT_FILTER_STRICTNESS).toLowerCase();
  return FILTER_STRICTNESS_KEYS.has(key) ? key : DEFAULT_FILTER_STRICTNESS;
}

export function effectiveScreenerFilterValues(values = {}) {
  const strictness = normalizeFilterStrictness(values.filterStrictness);
  const next = { ...values, filterStrictness: strictness };
  // Query/API filters share the UI contract: thresholds are hard limits.
  // Any broader behavior belongs in preset defaults, never in hidden slack.
  return next;
}

function firstFinite(...values) {
  for (const value of values) {
    const n = finite(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function metric(row = {}, key = "") {
  if (key === "rsPrimary") return firstFinite(row.rsGlobalPct, row.rsRating, row.rsCountryPct, row.rsSectorPct);
  if (key === "weaknessScore") return firstFinite(row.weaknessScore, scoreWeakness(row).weaknessScore);
  return firstFinite(row[key], row.metrics?.[key], row.growthMetrics?.[key], row.raw?.[key], row.snapshot?.[key]);
}

function metricText(row = {}, key = "") {
  return cleanText(row[key] ?? row.metrics?.[key] ?? row.raw?.[key] ?? row.snapshot?.[key] ?? "");
}

function monthsSince(date = "") {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return null;
  const d = new Date(parsed);
  const now = new Date();
  return (now.getFullYear() - d.getFullYear()) * 12 + now.getMonth() - d.getMonth();
}

function isRecentIpo(row = {}, maxMonths = 60) {
  const age = firstFinite(row.ipoAgeMonths, monthsSince(metricText(row, "ipoDate")));
  return Number.isFinite(age) && age >= 0 && age <= maxMonths;
}

function isStage2(row = {}) {
  return isConfirmedStage2(row);
}

function priceFreshness(row = {}, maxDays = DEFAULT_PRICE_FRESHNESS_DAYS) {
  const stored = metric(row, "priceFreshnessDays");
  const limit = Number.isFinite(maxDays) && maxDays > 0 ? maxDays : DEFAULT_PRICE_FRESHNESS_DAYS;
  if (Number.isFinite(stored)) return { days: stored, ok: stored <= limit };
  const parsed = Date.parse(metricText(row, "lastDate"));
  if (!Number.isFinite(parsed)) return { days: null, ok: false };
  const days = Math.max(0, Math.floor((Date.now() - parsed) / 86400000));
  return { days, ok: days <= limit };
}

export function scoreWeakness(row = {}) {
  let s = 0;
  const reasons = [];
  const rs = metric(row, "rsPrimary") ?? 50;
  const price = metric(row, "price");
  const sma50 = metric(row, "sma50");
  const sma200 = metric(row, "sma200");
  const slope = metric(row, "sma200Slope");
  const perf3m = metric(row, "perf3m");
  const perf6m = metric(row, "perf6m");
  const perf12m = metric(row, "perf12m");
  const distance52w = metric(row, "distance52w");
  const distance20d = metric(row, "distance20d");
  const maxDrawdown63d = metric(row, "maxDrawdown63d");
  const upDownVolRatio = metric(row, "upDownVolRatio");
  const relativeVolume = metric(row, "relativeVolume");
  const riskScore = metric(row, "riskScore");
  const extSma50 = metric(row, "extSma50");
  const speculationRiskScore = metric(row, "speculationRiskScore");
  if (rs < 30) { s += 18; reasons.push("RS muy bajo"); }
  else if (rs < 45) { s += 13; reasons.push("RS bajo"); }
  else if (rs < 55) s += 6;
  if (Number.isFinite(price) && Number.isFinite(sma50) && price < sma50) { s += 12; reasons.push("bajo SMA50"); }
  if (Number.isFinite(price) && Number.isFinite(sma200) && price < sma200) { s += 18; reasons.push("bajo SMA200"); }
  if (Number.isFinite(slope) && slope < 0) { s += 12; reasons.push("SMA200 cae"); }
  if (Number.isFinite(sma50) && Number.isFinite(sma200) && sma50 < sma200) s += 7;
  if (Number.isFinite(perf3m) && perf3m < 0) { s += 8; reasons.push("3M negativo"); }
  if (Number.isFinite(perf6m) && perf6m < 0) s += 8;
  if (Number.isFinite(perf12m) && perf12m < 0) s += 8;
  if (Number.isFinite(distance52w)) {
    if (distance52w < -45) { s += 12; reasons.push("muy lejos de maximos"); }
    else if (distance52w < -30) { s += 8; reasons.push("lejos de maximos"); }
    else if (distance52w < -20) s += 4;
  }
  if (Number.isFinite(distance20d) && distance20d < -12) s += 5;
  if (Number.isFinite(maxDrawdown63d)) {
    if (maxDrawdown63d > 40) { s += 10; reasons.push("drawdown alto"); }
    else if (maxDrawdown63d > 28) s += 7;
  }
  if (Number.isFinite(upDownVolRatio)) {
    if (upDownVolRatio < .7) { s += 9; reasons.push("volumen vendedor"); }
    else if (upDownVolRatio < .9) s += 5;
  }
  if (row.upVolume === false && Number.isFinite(relativeVolume) && relativeVolume >= 1.15) { s += 7; reasons.push("caida con volumen"); }
  if (Number.isFinite(riskScore) && riskScore < 35) s += 7;
  if (Number.isFinite(extSma50) && extSma50 < -12) s += 5;
  if (Number.isFinite(speculationRiskScore) && speculationRiskScore >= 70) s += 4;
  const weaknessScore = clamp(s);
  return {
    weaknessScore,
    weaknessLabel: weaknessScore >= 78 ? "Deterioro severo" : weaknessScore >= 65 ? "Deterioro alto" : weaknessScore >= 50 ? "Deterioro visible" : weaknessScore >= 35 ? "Debilidad mixta" : "Sin deterioro claro",
    weaknessReasons: reasons.length ? reasons.slice(0, 4) : ["Sin evidencia fuerte"],
  };
}

function normalizePreset(value = "") {
  const key = cleanText(value);
  if (!key) return "";
  if (WEB_FILTER_PRESETS[key]) return key;
  const lower = key.toLowerCase();
  return WEB_FILTER_PRESETS[lower] ? lower : "";
}

export function screenerFiltersFromParams(params = {}) {
  const preset = normalizePreset(params.filterPreset || params.preset);
  const values = preset ? { ...WEB_FILTER_PRESETS[preset] } : {};
  const explicit = [];
  for (const key of SCREENER_FILTER_QUERY_KEYS) {
    if (key === "filterPreset") continue;
    if (!Object.hasOwn(params, key)) continue;
    const raw = params[key];
    if (raw === undefined || raw === null || raw === "") continue;
    values[key] = BOOLEAN_KEYS.has(key)
      ? boolValue(raw)
      : STRING_KEYS.has(key)
        ? (key === "filterStrictness" ? normalizeFilterStrictness(raw) : cleanText(raw))
        : finite(raw);
    explicit.push(key);
  }
  const active = Object.keys(values).filter((key) => key !== "filterPreset" && values[key] !== undefined && values[key] !== null && values[key] !== "");
  return {
    enabled: active.length > 0,
    preset,
    values,
    active,
    explicit,
  };
}

export function screenerFiltersFromSearchParams(searchParams) {
  const params = {};
  for (const key of SCREENER_FILTER_QUERY_KEYS) {
    if (searchParams.has(key)) params[key] = searchParams.get(key);
  }
  if (searchParams.has("preset") && !params.filterPreset) params.filterPreset = searchParams.get("preset");
  return screenerFiltersFromParams(params);
}

function thresholdActive(value, neutral, direction = "min") {
  const n = finite(value);
  if (!Number.isFinite(n)) return false;
  if (direction === "max") return n < neutral;
  return n > neutral;
}

function neutralForField(field, direction = "min") {
  if (direction === "max") return 999;
  if (["minPerf3m", "minPerf6m", "minPerf12m"].includes(field)) return -100;
  if (["minVolumeSurgePct", "minReturnToVol3m", "minReturnToDrawdown3m"].includes(field)) return -999;
  return 0;
}

function reject(field, detail) {
  return { field, reason: detail };
}

export function screenerFilterRejectReason(row = {}, filters = {}) {
  const set = effectiveScreenerFilterValues(filters.values || filters || {});
  const mode = cleanText(set.setupMode || "");
  const maxFreshness = finite(set.maxPriceFreshnessDays);
  if (Number.isFinite(maxFreshness) && maxFreshness < 999 && !priceFreshness(row, maxFreshness).ok) {
    return reject("maxPriceFreshnessDays", `precio viejo o sin fecha > ${maxFreshness}d`);
  }
  if (set.requireStage2 === true) {
    const stage2Issue = stage2RejectDetail(row, set);
    if (stage2Issue) return reject("requireStage2", stage2Issue);
  }
  const price = metric(row, "price");
  const sma50 = metric(row, "sma50");
  const sma200 = metric(row, "sma200");
  if (set.requireSma200Up === true && !(metric(row, "sma200Slope") > 0)) return reject("requireSma200Up", "SMA200 no sube");
  if (set.requirePriceAboveSma50 === true && !(Number.isFinite(price) && Number.isFinite(sma50) && price > sma50)) return reject("requirePriceAboveSma50", "precio bajo SMA50");
  if (set.requireUpVolume === true && row.upVolume !== true) return reject("requireUpVolume", "ultima vela no es alcista con volumen");
  if (mode !== "weakness" && mode !== "ipoRecent" && set.requireStage2 !== true) {
    const longBiasIssue = dailyLongBiasIssue(row);
    if (longBiasIssue) return reject("longBiasFloor", longBiasIssue);
  }

  for (const [field, rule] of Object.entries(FIELD_RULES)) {
    const rawThreshold = set[field];
    const direction = rule.op === "max" ? "max" : "min";
    const neutral = neutralForField(field, direction);
    if (!thresholdActive(rawThreshold, neutral, direction)) continue;
    const threshold = finite(rawThreshold);
    const value = rule.metric === "rsPrimary" ? metric(row, "rsPrimary") : metric(row, rule.metric);
    if (!Number.isFinite(value)) return reject(field, `${rule.label} sin dato`);
    if (rule.op === "max" && value > threshold) return reject(field, `${rule.label} ${value.toFixed(2)} > ${threshold}`);
    if (rule.op === "min" && value < threshold) return reject(field, `${rule.label} ${value.toFixed(2)} < ${threshold}`);
  }

  const minRsRating = finite(set.minRsRating);
  if (Number.isFinite(minRsRating) && minRsRating > 0) {
    const rs = metric(row, "rsGlobalPct");
    if (!Number.isFinite(rs) || rs < minRsRating) return reject("minRsRating", `RS universo ${Number.isFinite(rs) ? rs.toFixed(0) : "sin dato"} < ${minRsRating}`);
  }

  for (const [field, rule] of Object.entries(DISTANCE_RULES)) {
    const threshold = finite(set[field]);
    if (!Number.isFinite(threshold) || threshold >= 999) continue;
    const value = metric(row, rule.metric);
    if (!Number.isFinite(value)) return reject(field, `${rule.label} sin dato`);
    if (value < -threshold) return reject(field, `${rule.label} ${value.toFixed(2)} < -${threshold}`);
  }

  const maxIpoAgeMonths = Number.isFinite(finite(set.maxIpoAgeMonths)) ? finite(set.maxIpoAgeMonths) : 60;
  if (set.requireRecentIpo === true && !isRecentIpo(row, maxIpoAgeMonths)) return reject("requireRecentIpo", `IPO no reciente <= ${maxIpoAgeMonths}m`);

  if (mode === "weakness") {
    const weak = metric(row, "weaknessScore");
    const minWeakness = Math.max(35, finite(set.minWeaknessScore) ?? 0);
    if (!Number.isFinite(weak) || weak < minWeakness) return reject("minWeaknessScore", `deterioro ${Number.isFinite(weak) ? weak.toFixed(0) : "sin dato"} < ${minWeakness}`);
    return "";
  }
  if (mode === "nearPivot") {
    const dist20 = metric(row, "distance20d");
    const spread = metric(row, "highsSpreadPct");
    const ext = metric(row, "extSma50");
    const maxDist = finite(set.maxDistance20dHigh) ?? 8;
    const maxSpread = finite(set.maxHighsSpreadPct) ?? 12;
    const maxExt = Math.min(finite(set.maxExtensionSma50) ?? 18, 18);
    if (!([dist20, spread, ext].every(Number.isFinite) && dist20 >= -maxDist && spread <= maxSpread && ext <= maxExt)) return reject("setupMode", "no encaja en Near Pivot");
  }
  if (mode === "pullback") {
    const ext = metric(row, "extSma50");
    const distance52w = metric(row, "distance52w");
    const perf6m = metric(row, "perf6m");
    const minPerf6m = Math.max(8, (finite(set.minPerf6m) ?? 0) * 0.7);
    if (!([price, sma200, ext, distance52w, perf6m].every(Number.isFinite) && price > sma200 && ext >= -4 && ext <= 9 && distance52w >= -30 && perf6m >= minPerf6m)) return reject("setupMode", "no encaja en Pullback SMA50");
  }
  if (mode === "early") {
    const minPerf3m = finite(set.minPerf3m) ?? 0;
    const maxExt = finite(set.maxExtensionSma50) ?? 35;
    const distance52w = metric(row, "distance52w");
    const perf3m = metric(row, "perf3m");
    const ext = metric(row, "extSma50");
    if (!([price, sma200, distance52w, perf3m, ext].every(Number.isFinite) && price > sma200 && distance52w >= -35 && perf3m >= minPerf3m && ext <= maxExt)) return reject("setupMode", "no encaja en Etapa 2 temprana");
  }
  if (mode === "ipoRecent") {
    const maxExt = finite(set.maxExtensionSma50) ?? 35;
    const minMomentum = finite(set.minMomentumScore) ?? 0;
    const distance52w = metric(row, "distance52w");
    const ext = metric(row, "extSma50");
    const momentumScore = metric(row, "momentumScore");
    if (!(isRecentIpo(row, maxIpoAgeMonths) && [distance52w, ext, momentumScore].every(Number.isFinite) && distance52w >= -35 && ext <= maxExt && momentumScore >= minMomentum)) return reject("setupMode", "no encaja en IPO reciente");
  }
  if (mode === "extended") {
    const maxExt = finite(set.maxExtensionSma50) ?? 999;
    const minMomentum = Math.max(65, finite(set.minMomentumScore) ?? 0);
    const ext = metric(row, "extSma50");
    if (!(ext >= 12 && ext <= maxExt && metric(row, "momentumScore") >= minMomentum)) return reject("setupMode", "no encaja en Extendida fuerte");
  }
  return "";
}

export function applyScreenerFilters(rows = [], filters = {}) {
  if (!filters?.enabled) return { rows, rejections: [], summary: screenerFilterSummary(filters) };
  const passed = [];
  const rejections = [];
  for (const row of rows) {
    const rejectReason = screenerFilterRejectReason(row, filters);
    if (rejectReason) rejections.push({ symbol: row.symbol, ...rejectReason });
    else passed.push(row);
  }
  return { rows: passed, rejections, summary: screenerFilterSummary(filters) };
}

export function screenerFilterSummary(filters = {}) {
  const values = filters.values || {};
  return {
    enabled: Boolean(filters.enabled),
    preset: filters.preset || "",
    active: filters.active || [],
    explicit: filters.explicit || [],
    values,
    effectiveValues: effectiveScreenerFilterValues(values),
  };
}
