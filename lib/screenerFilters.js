import { dailyLongBiasIssue, isConfirmedStage2, stage2RejectDetail } from "@/lib/trendStructure";
import { rowPassesListContract } from "@/lib/listRationale";
import { methodologyPivotWatchEligible } from "@/lib/methodologyDisplay";
import { scoreWeakness } from "@/lib/scoring";
import {
  BOOLEAN_FILTER_KEYS as BOOLEAN_KEYS,
  DEFAULT_PRICE_FRESHNESS_DAYS,
  DISTANCE_RULES,
  FIELD_RULES,
  SCREENER_FILTER_QUERY_KEYS,
  SETUP_MODES,
  SCREENER_WEB_FILTER_PRESETS as WEB_FILTER_PRESETS,
  STRING_FILTER_KEYS as STRING_KEYS,
  effectiveScreenerFilterValues,
  normalizeFilterStrictness,
} from "@/lib/screenerFilterCatalog";

export { SCREENER_FILTER_QUERY_KEYS, effectiveScreenerFilterValues, normalizeFilterStrictness };
// Re-export de scoreWeakness: su implementación canónica vive en
// lib/scoringEngine.js (re-exportada por lib/scoring.js). Antes este módulo
// tenía su propia copia; la consolidación garantiza que todos los consumers
// (researchRow.js, screenerPipeline.js, materializedScanner.js) usen la misma
// fórmula. Los call sites que ya importaban scoreWeakness desde aquí siguen
// funcionando sin cambios (re-export transparente).
export { scoreWeakness };

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
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

function firstFinite(...values) {
  for (const value of values) {
    const n = finite(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function hasOwn(object = {}, key = "") {
  return Boolean(object && typeof object === "object" && Object.prototype.hasOwnProperty.call(object, key));
}

function metric(row = {}, key = "") {
  if (key === "rsPrimary") return firstFinite(row.rsGlobalPct, row.rsRating, row.rsCountryPct, row.rsSectorPct);
  if (key === "weaknessScore") return firstFinite(row.weaknessScore, scoreWeakness(row).weaknessScore);
  if (key === "objectiveScore") {
    const objective = firstFinite(row.objectiveScore, row.metrics?.objectiveScore, row.raw?.objectiveScore, row.snapshot?.objectiveScore);
    if (Number.isFinite(objective)) return objective;
    const explicitObjective = [row, row.metrics, row.raw, row.snapshot].some((source) => hasOwn(source, "objectiveScore"));
    return explicitObjective ? null : firstFinite(row.totalScore, row.metrics?.totalScore, row.raw?.totalScore, row.snapshot?.totalScore);
  }
  return firstFinite(row[key], row.metrics?.[key], row.growthMetrics?.[key], row.raw?.[key], row.snapshot?.[key]);
}

function weaknessFilterValue(row = {}) {
  return firstFinite(row.weaknessScore, row.metrics?.weaknessScore, row.raw?.weaknessScore, row.snapshot?.weaknessScore);
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

// scoreWeakness se importa desde lib/scoring.js (re-export más arriba). Antes
// este módulo tenía su propia implementación local; se eliminó para consolidar
// en una sola fuente de verdad. metric(row, "weaknessScore") sigue funcionando
// porque scoreWeakness es un binding del módulo (resuelto por hoisting).

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

const PATTERN_FILTER_FIELDS = new Set([
  "minContractionCount",
  "maxContraction1DepthPct",
  "maxContraction2DepthPct",
  "maxContraction3DepthPct",
  "maxLastContractionDepthPct",
  "maxBaseDepthPct",
  "minBaseWeeks",
  "maxBaseWeeks",
  "maxAbsDistanceToPivotPct",
  "maxVolumeDryUpRatio",
  "maxTightness10dPct",
  "minPatternQualityScore",
]);

const PATTERN_VOLUME_FILTER_FIELDS = new Set(["maxVolumeDryUpRatio"]);
const PATTERN_FULL_CLAIM_FILTER_FIELDS = new Set(["maxVolumeDryUpRatio", "minPatternQualityScore"]);

const HARD_PATTERN_DATA_STATUSES = new Set([
  "insufficient_history",
  "missing_latest_date",
  "stale_price",
  "sparse_ohlc",
]);

const INVALID_CONTRACTION_STRUCTURE_STATUSES = new Set([
  "data_blocked",
  "not_consolidating",
  "no_meaningful_contractions",
  "pivot_noise",
  "ceiling_break",
  "lower_low_drift",
  "depth_reexpansion",
]);

function reject(field, detail) {
  return { field, reason: detail };
}

function patternDataStatusLabel(status = "") {
  switch (String(status || "").trim()) {
    case "ok":
      return "datos técnicos OK";
    case "partial_volume":
      return "volumen parcial";
    case "insufficient_history":
      return "histórico insuficiente";
    case "missing_latest_date":
      return "fecha no disponible";
    case "stale_price":
      return "precio no reciente";
    case "sparse_ohlc":
      return "OHLC incompleto";
    case "missing_volume":
      return "volumen no fiable";
    default:
      return "datos sin validar";
  }
}

function contractionStructureStatusLabel(status = "") {
  switch (String(status || "").trim()) {
    case "data_blocked":
      return "datos técnicos bloqueados";
    case "not_consolidating":
      return "base no confirmada";
    case "no_meaningful_contractions":
      return "sin contracciones útiles";
    case "pivot_noise":
      return "pivots demasiado cercanos";
    case "ceiling_break":
      return "techo de base inestable";
    case "lower_low_drift":
      return "mínimos no sostienen la base";
    case "depth_reexpansion":
      return "contracciones se re-expanden";
    default:
      return "estructura sin validar";
  }
}

function activePatternFilterKeys(set = {}) {
  const active = [];
  if (set.requireContractionsDecreasing === true) active.push("requireContractionsDecreasing");
  for (const field of PATTERN_FILTER_FIELDS) {
    const rule = FIELD_RULES[field];
    if (!rule) continue;
    const direction = rule.op === "max" ? "max" : "min";
    if (thresholdActive(set[field], neutralForField(field, direction), direction)) active.push(field);
  }
  return active;
}

function patternValidityGate(row = {}, set = {}) {
  const activeKeys = activePatternFilterKeys(set);
  if (!activeKeys.length) return null;

  const dataStatus = cleanText(row.patternDataStatus);
  const reliabilityState = cleanText(row.methodologyReliabilityState).toLowerCase();
  const dataLimited = row.setupDisplayDataLimited === true || reliabilityState === "data_limited";
  if (dataLimited) {
    return {
      field: "patternDataStatus",
      label: "datos estructura",
      status: "fail",
      detail: "estructura no fiable: claim bloqueado por datos parciales",
    };
  }

  if (row.patternEligible === false || HARD_PATTERN_DATA_STATUSES.has(dataStatus)) {
    return {
      field: "patternDataStatus",
      label: "datos estructura",
      status: "fail",
      detail: `estructura no fiable: ${patternDataStatusLabel(dataStatus)}`,
    };
  }

  const needsVolumeEvidence = activeKeys.some((key) => PATTERN_VOLUME_FILTER_FIELDS.has(key));
  const needsFullPatternClaim = activeKeys.some((key) => PATTERN_FULL_CLAIM_FILTER_FIELDS.has(key));
  if (needsFullPatternClaim && (row.setupDisplayBlocksPatternClaim === true || row.methodologyBlocksPatternClaim === true)) {
    return {
      field: "patternDataStatus",
      label: "datos estructura",
      status: "fail",
      detail: "claim de patrón bloqueado por fiabilidad",
    };
  }

  if (needsVolumeEvidence && (row.patternVolumeEligible === false || dataStatus === "partial_volume" || dataStatus === "missing_volume")) {
    return {
      field: "patternDataStatus",
      label: "volumen estructura",
      status: "fail",
      detail: "volumen no fiable para validar volumen seco",
    };
  }

  const structureStatus = cleanText(row.contractionStructureStatus);
  if (INVALID_CONTRACTION_STRUCTURE_STATUSES.has(structureStatus)) {
    return {
      field: "contractionStructureStatus",
      label: "estructura VCP",
      status: "fail",
      detail: contractionStructureStatusLabel(structureStatus) || row.contractionStructureReason || "estructura sin validar",
    };
  }

  return null;
}

function compactNumber(value) {
  const n = finite(value);
  if (!Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${Math.round(n).toLocaleString("en-US")}`;
  if (abs >= 100) return n.toFixed(0);
  if (abs >= 10) return n.toFixed(1);
  return n.toFixed(2).replace(/\.00$/, "");
}

function sma50ExtensionEvidence(row = {}, extValue = metric(row, "extSma50"), tolerancePct = 2) {
  const price = metric(row, "price");
  const sma50 = metric(row, "sma50");
  const ext = finite(extValue);
  const missing = [
    ["precio", price],
    ["SMA50", sma50],
    ["extension SMA50", ext],
  ].filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
  if (missing.length) return { price, sma50, ext, calculated: null, diff: null, ok: false, missing };
  if (sma50 <= 0) return { price, sma50, ext, calculated: null, diff: null, ok: false, missing: [] };
  const calculated = ((price / sma50) - 1) * 100;
  const diff = Math.abs(calculated - ext);
  return {
    price,
    sma50,
    ext,
    calculated,
    diff,
    ok: diff <= tolerancePct,
    missing: [],
  };
}

function setupModeName(mode = "") {
  return SETUP_MODES.find(([key]) => key === mode)?.[1] || mode || "Exploratorio";
}

const SETUP_MODE_LIST_CONTRACTS = {
  nearPivot: "nearPivot",
  pullback: "pullback",
  ipoRecent: "ipo",
  extended: "extended",
};

function setupModeListContractPasses(row = {}, set = {}, mode = "") {
  const listKey = SETUP_MODE_LIST_CONTRACTS[mode];
  if (!listKey) return true;
  const options = listKey === "ipo"
    ? { maxIpoAgeMonths: Number.isFinite(finite(set.maxIpoAgeMonths)) ? finite(set.maxIpoAgeMonths) : 60 }
    : {};
  return rowPassesListContract(row, listKey, options);
}

function setupModeListContractLabel(contractOk) {
  return contractOk ? "contrato compartido OK" : "contrato compartido no validado";
}

function explainLine(item = {}) {
  const op = item.direction === "max" ? "<=" : ">=";
  return `${item.label} ${compactNumber(item.value)} ${op} ${compactNumber(item.threshold)}`;
}

function thresholdNearLimit(threshold, direction = "min") {
  const n = Math.abs(Number(threshold));
  if (!Number.isFinite(n) || n <= 0) return direction === "max" ? 2 : 1;
  if (n >= 1_000_000) return n * 0.12;
  if (n >= 1000) return n * 0.1;
  if (n >= 100) return n * 0.08;
  return Math.max(1, n * 0.12);
}

function explainThresholdRule({ field, label, value, threshold, direction = "min" }) {
  const v = finite(value);
  const t = finite(threshold);
  const item = { field, label, value: v, threshold: t, direction };
  if (!Number.isFinite(t)) return null;
  if (!Number.isFinite(v)) return { ...item, status: "missing", detail: `${label} sin dato` };
  const margin = direction === "max" ? t - v : v - t;
  if (margin < 0) return { ...item, status: "fail", margin, detail: explainLine(item) };
  return {
    ...item,
    status: margin <= thresholdNearLimit(t, direction) ? "near" : "pass",
    margin,
    detail: explainLine(item),
  };
}

function addRule(bucket, item) {
  if (!item) return;
  bucket.active += 1;
  if (item.status === "fail") bucket.failed.push(item);
  else if (item.status === "missing") bucket.missing.push(item);
  else if (item.status === "near") bucket.near.push(item);
  else bucket.passed.push(item);
}

function isNearBoundary(value, threshold, direction = "min") {
  const v = finite(value);
  const t = finite(threshold);
  if (!Number.isFinite(v) || !Number.isFinite(t)) return false;
  const margin = direction === "max" ? t - v : v - t;
  return margin >= 0 && margin <= thresholdNearLimit(t, direction);
}

function setupGateItem({ label, detail, ok, missing = [], near = false }) {
  return {
    field: "setupMode",
    label,
    status: missing.length ? "missing" : ok ? (near ? "near" : "pass") : "fail",
    detail: missing.length ? `${detail} · sin dato: ${missing.join(", ")}` : detail,
  };
}

function setupModeGate(row = {}, set = {}, mode = cleanText(set.setupMode || "")) {
  if (mode === "nearPivot") {
    const dist20 = metric(row, "distance20d");
    const spread = metric(row, "highsSpreadPct");
    const ext = metric(row, "extSma50");
    const maxDist = finite(set.maxDistance20dHigh) ?? 8;
    const maxSpread = finite(set.maxHighsSpreadPct) ?? 12;
    const maxExt = Math.min(finite(set.maxExtensionSma50) ?? 18, 18);
    const pivotEligible = methodologyPivotWatchEligible(row);
    const contractOk = setupModeListContractPasses(row, set, mode);
    const missing = [
      ["Composite", metric(row, "totalScore")],
      ["RS universo", metric(row, "rsGlobalPct")],
      ["distancia 20d", dist20],
      ["highs spread", spread],
      ["extension SMA50", ext],
    ].filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
    return setupGateItem({
      label: "Vigilancia pivot",
      detail: `Vigilancia pivot: ${setupModeListContractLabel(contractOk)}, pivot metodológico ${pivotEligible ? "validado" : "no validado"}, dist20 ${compactNumber(dist20)} >= -${compactNumber(maxDist)}, spread ${compactNumber(spread)} <= ${compactNumber(maxSpread)}, ext ${compactNumber(ext)} <= ${compactNumber(maxExt)}`,
      missing,
      ok: missing.length === 0 && contractOk && pivotEligible && dist20 >= -maxDist && spread <= maxSpread && ext <= maxExt,
      near: isNearBoundary(dist20, -maxDist, "min") || isNearBoundary(spread, maxSpread, "max") || isNearBoundary(ext, maxExt, "max"),
    });
  }
  if (mode === "pullback") {
    const price = metric(row, "price");
    const sma50 = metric(row, "sma50");
    const sma200 = metric(row, "sma200");
    const ext = metric(row, "extSma50");
    const distance52w = metric(row, "distance52w");
    const perf6m = metric(row, "perf6m");
    const minPerf6m = Math.max(8, (finite(set.minPerf6m) ?? 0) * 0.7);
    const extEvidence = sma50ExtensionEvidence(row, ext);
    const contractOk = setupModeListContractPasses(row, set, mode);
    const missing = [
      ["Composite", metric(row, "totalScore")],
      ["precio", price],
      ["SMA50", sma50],
      ["SMA200", sma200],
      ["extension SMA50", ext],
      ["distancia 52w", distance52w],
      ["perf 6M", perf6m],
    ].filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
    const extensionCoherent = extEvidence.ok && sma50 > 0;
    return setupGateItem({
      label: "Pullback SMA50",
      detail: `Pullback SMA50: ${setupModeListContractLabel(contractOk)}, precio ${compactNumber(price)} > SMA200 ${compactNumber(sma200)}, precio/SMA50 ${compactNumber(sma50)} => ext calc ${compactNumber(extEvidence.calculated)}, ext ${compactNumber(ext)} entre -3 y 8, 52w ${compactNumber(distance52w)} >= -30, 6M ${compactNumber(perf6m)} >= ${compactNumber(minPerf6m)}`,
      missing,
      ok: missing.length === 0 && contractOk && extensionCoherent && price > sma200 && ext >= -3 && ext <= 8 && distance52w >= -30 && perf6m >= minPerf6m,
      near: isNearBoundary(ext, -3, "min") || isNearBoundary(ext, 8, "max") || isNearBoundary(distance52w, -30, "min") || isNearBoundary(perf6m, minPerf6m, "min"),
    });
  }
  if (mode === "early") {
    const price = metric(row, "price");
    const sma200 = metric(row, "sma200");
    const distance52w = metric(row, "distance52w");
    const perf3m = metric(row, "perf3m");
    const ext = metric(row, "extSma50");
    const minPerf3m = finite(set.minPerf3m) ?? 0;
    const maxExt = finite(set.maxExtensionSma50) ?? 35;
    const missing = [
      ["precio", price],
      ["SMA200", sma200],
      ["distancia 52w", distance52w],
      ["perf 3M", perf3m],
      ["extension SMA50", ext],
    ].filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
    return setupGateItem({
      label: "Etapa 2 temprana",
      detail: `Etapa 2 temprana: precio ${compactNumber(price)} > SMA200 ${compactNumber(sma200)}, 52w ${compactNumber(distance52w)} >= -35, 3M ${compactNumber(perf3m)} >= ${compactNumber(minPerf3m)}, ext ${compactNumber(ext)} <= ${compactNumber(maxExt)}`,
      missing,
      ok: missing.length === 0 && price > sma200 && distance52w >= -35 && perf3m >= minPerf3m && ext <= maxExt,
      near: isNearBoundary(distance52w, -35, "min") || isNearBoundary(perf3m, minPerf3m, "min") || isNearBoundary(ext, maxExt, "max"),
    });
  }
  if (mode === "ipoRecent") {
    const maxIpoAgeMonths = Number.isFinite(finite(set.maxIpoAgeMonths)) ? finite(set.maxIpoAgeMonths) : 60;
    const age = firstFinite(row.ipoAgeMonths, monthsSince(metricText(row, "ipoDate")));
    const distance52w = metric(row, "distance52w");
    const ext = metric(row, "extSma50");
    const momentumScore = metric(row, "momentumScore");
    const maxExt = finite(set.maxExtensionSma50) ?? 35;
    const minMomentum = finite(set.minMomentumScore) ?? 0;
    const contractOk = setupModeListContractPasses(row, set, mode);
    const missing = [
      ["edad IPO", age],
      ["fuerza IPO/composite/RS", firstFinite(metric(row, "ipoScore"), metric(row, "totalScore"), metric(row, "rsGlobalPct"))],
      ["distancia 52w", distance52w],
      ["extension SMA50", ext],
      ["momentum score", momentumScore],
    ].filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
    return setupGateItem({
      label: "IPO reciente",
      detail: `IPO reciente: ${setupModeListContractLabel(contractOk)}, edad ${compactNumber(age)}m <= ${compactNumber(maxIpoAgeMonths)}m, 52w ${compactNumber(distance52w)} >= -35, ext ${compactNumber(ext)} <= ${compactNumber(maxExt)}, momentum ${compactNumber(momentumScore)} >= ${compactNumber(minMomentum)}`,
      missing,
      ok: missing.length === 0 && contractOk && age >= 0 && age <= maxIpoAgeMonths && distance52w >= -35 && ext <= maxExt && momentumScore >= minMomentum,
      near: isNearBoundary(age, maxIpoAgeMonths, "max") || isNearBoundary(distance52w, -35, "min") || isNearBoundary(ext, maxExt, "max") || isNearBoundary(momentumScore, minMomentum, "min"),
    });
  }
  if (mode === "extended") {
    const price = metric(row, "price");
    const sma50 = metric(row, "sma50");
    const ext = metric(row, "extSma50");
    const momentumScore = metric(row, "momentumScore");
    const maxExt = finite(set.maxExtensionSma50) ?? 999;
    const minMomentum = Math.max(65, finite(set.minMomentumScore) ?? 0);
    const extEvidence = sma50ExtensionEvidence(row, ext);
    const contractOk = setupModeListContractPasses(row, set, mode);
    const minExt = 15;
    const missing = [
      ["Composite", metric(row, "totalScore")],
      ["precio", price],
      ["SMA50", sma50],
      ["extension SMA50", ext],
      ["momentum score", momentumScore],
    ].filter(([, value]) => !Number.isFinite(value)).map(([label]) => label);
    const extensionCoherent = extEvidence.ok && sma50 > 0;
    return setupGateItem({
      label: "Extendida fuerte",
      detail: `Extendida fuerte: ${setupModeListContractLabel(contractOk)}, precio/SMA50 ${compactNumber(sma50)} => ext calc ${compactNumber(extEvidence.calculated)}, ext ${compactNumber(ext)} entre ${compactNumber(minExt)} y ${compactNumber(maxExt)}, momentum ${compactNumber(momentumScore)} >= ${compactNumber(minMomentum)}`,
      missing,
      ok: missing.length === 0 && contractOk && extensionCoherent && ext >= minExt && ext <= maxExt && momentumScore >= minMomentum,
      near: isNearBoundary(ext, minExt, "min") || isNearBoundary(ext, maxExt, "max") || isNearBoundary(momentumScore, minMomentum, "min"),
    });
  }
  return null;
}

export function buildScreenerFilterExplainPlan(row = {}, filters = {}) {
  const set = effectiveScreenerFilterValues(filters.values || filters || {});
  const bucket = { active: 0, passed: [], near: [], missing: [], failed: [] };
  const mode = cleanText(set.setupMode || "");
  const maxFreshness = finite(set.maxPriceFreshnessDays);
  if (Number.isFinite(maxFreshness) && maxFreshness < 999) {
    const freshness = priceFreshness(row, maxFreshness);
    addRule(bucket, {
      field: "maxPriceFreshnessDays",
      label: "precio fresco",
      value: freshness.days,
      threshold: maxFreshness,
      direction: "max",
      status: freshness.ok ? (Number.isFinite(freshness.days) && maxFreshness - freshness.days <= 1 ? "near" : "pass") : (Number.isFinite(freshness.days) ? "fail" : "missing"),
      detail: `precio ${Number.isFinite(freshness.days) ? `${freshness.days}d` : "sin fecha"} <= ${maxFreshness}d`,
    });
  }
  if (set.requireStage2 === true) {
    const issue = stage2RejectDetail(row, set);
    addRule(bucket, { field: "requireStage2", label: "Stage 2", status: issue ? "fail" : "pass", detail: issue || "Stage 2 confirmado" });
  }
  if (set.requireSma200Up === true) {
    const slope = metric(row, "sma200Slope");
    addRule(bucket, { field: "requireSma200Up", label: "SMA200 sube", value: slope, threshold: 0, direction: "min", status: Number.isFinite(slope) ? (slope > 0 ? "pass" : "fail") : "missing", detail: `SMA200 slope ${compactNumber(slope)} > 0` });
  }
  if (set.requirePriceAboveSma50 === true) {
    const price = metric(row, "price");
    const sma50 = metric(row, "sma50");
    addRule(bucket, { field: "requirePriceAboveSma50", label: "sobre SMA50", value: price, threshold: sma50, direction: "min", status: Number.isFinite(price) && Number.isFinite(sma50) ? (price > sma50 ? "pass" : "fail") : "missing", detail: `precio ${compactNumber(price)} > SMA50 ${compactNumber(sma50)}` });
  }
  if (set.requireUpVolume === true) {
    addRule(bucket, { field: "requireUpVolume", label: "volumen alcista", status: row.upVolume === true ? "pass" : "fail", detail: row.upVolume === true ? "última vela alcista con volumen" : "última vela no confirma volumen alcista" });
  }
  if (mode !== "weakness" && mode !== "ipoRecent" && set.requireStage2 !== true) {
    const longBiasIssue = dailyLongBiasIssue(row);
    addRule(bucket, { field: "longBiasFloor", label: "sesgo largo diario", status: longBiasIssue ? "fail" : "pass", detail: longBiasIssue || "sesgo largo diario válido" });
  }
  addRule(bucket, patternValidityGate(row, set));
  if (set.requireContractionsDecreasing === true) {
    addRule(bucket, { field: "requireContractionsDecreasing", label: "contracciones", status: row.contractionsDecreasing === true ? "pass" : "fail", detail: row.contractionsDecreasing === true ? "compresión progresiva" : "sin compresión progresiva" });
  }

  for (const [field, rule] of Object.entries(FIELD_RULES)) {
    const direction = rule.op === "max" ? "max" : "min";
    const neutral = neutralForField(field, direction);
    if (!thresholdActive(set[field], neutral, direction)) continue;
    addRule(bucket, explainThresholdRule({
      field,
      label: rule.label,
      value: rule.metric === "rsPrimary" ? metric(row, "rsPrimary") : metric(row, rule.metric),
      threshold: set[field],
      direction,
    }));
  }

  const minRsRating = finite(set.minRsRating);
  if (Number.isFinite(minRsRating) && minRsRating > 0) {
    addRule(bucket, explainThresholdRule({
      field: "minRsRating",
      label: "RS universo",
      value: metric(row, "rsGlobalPct"),
      threshold: minRsRating,
      direction: "min",
    }));
  }

  for (const [field, rule] of Object.entries(DISTANCE_RULES)) {
    const threshold = finite(set[field]);
    if (!Number.isFinite(threshold) || threshold >= 999) continue;
    const value = metric(row, rule.metric);
    const item = explainThresholdRule({
      field,
      label: rule.label,
      value: Number.isFinite(value) ? value + threshold : value,
      threshold: 0,
      direction: "min",
    });
    if (item) {
      item.value = value;
      item.threshold = -threshold;
      item.direction = "min";
      item.detail = `${rule.label} ${compactNumber(value)} >= -${compactNumber(threshold)}`;
    }
    addRule(bucket, item);
  }

  const maxIpoAgeMonths = Number.isFinite(finite(set.maxIpoAgeMonths)) ? finite(set.maxIpoAgeMonths) : 60;
  if (set.requireRecentIpo === true) {
    const age = firstFinite(row.ipoAgeMonths, monthsSince(metricText(row, "ipoDate")));
    addRule(bucket, { field: "requireRecentIpo", label: "IPO reciente", value: age, threshold: maxIpoAgeMonths, direction: "max", status: Number.isFinite(age) ? (age >= 0 && age <= maxIpoAgeMonths ? "pass" : "fail") : "missing", detail: `IPO ${compactNumber(age)}m <= ${compactNumber(maxIpoAgeMonths)}m` });
  }

  const minWeakness = finite(set.minWeaknessScore) ?? 0;
  if (mode === "weakness") {
    const weak = weaknessFilterValue(row);
    addRule(bucket, Number.isFinite(weak)
      ? explainThresholdRule({ field: "minWeaknessScore", label: "deterioro", value: weak, threshold: minWeakness, direction: "min" })
      : { field: "minWeaknessScore", label: "deterioro", threshold: minWeakness, direction: "min", status: "skipped", detail: "deterioro omitido: sin dato" });
  } else {
    if (Number.isFinite(finite(set.minWeaknessScore))) {
      addRule(bucket, { field: "minWeaknessScore", label: "deterioro", threshold: minWeakness, direction: "min", status: "skipped", detail: `deterioro omitido: setup ${setupModeName(mode) || mode || "sin modo"} no es weakness` });
    }
    addRule(bucket, setupModeGate(row, set, mode));
  }

  const status = bucket.failed.length ? "fail" : bucket.missing.length ? "missing" : bucket.near.length ? "watch" : "pass";
  const tone = status === "pass" ? "" : "warn";
  const lead = bucket.failed.length
    ? `Falla ${bucket.failed.length}/${bucket.active} reglas activas`
    : `Pasa ${bucket.active} reglas activas`;
  const details = [];
  if (mode && mode !== "any") details.push(`Setup: ${setupModeName(mode)}`);
  if (bucket.failed.length) details.push(`falla: ${bucket.failed.slice(0, 3).map((item) => item.detail || explainLine(item)).join("; ")}`);
  if (bucket.missing.length) details.push(`sin dato: ${bucket.missing.slice(0, 3).map((item) => item.label).join(", ")}`);
  if (bucket.near.length) details.push(`cerca del corte: ${bucket.near.slice(0, 3).map((item) => item.detail || explainLine(item)).join("; ")}`);
  if (!bucket.failed.length && !bucket.missing.length && !bucket.near.length) {
    const support = bucket.passed.slice(0, 3).map((item) => item.detail || explainLine(item));
    details.push(support.length ? `apoyos: ${support.join("; ")}` : "sin umbrales duros activos");
  }
  return {
    status,
    tone,
    activeCount: bucket.active,
    passed: bucket.passed,
    near: bucket.near,
    missing: bucket.missing,
    failed: bucket.failed,
    summary: lead,
    text: [lead, ...details].join(" · "),
  };
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
  if (set.requireUpVolume === true && row.upVolume !== true) return reject("requireUpVolume", "última vela no es alcista con volumen");
  if (mode !== "weakness" && mode !== "ipoRecent" && set.requireStage2 !== true) {
    const longBiasIssue = dailyLongBiasIssue(row);
    if (longBiasIssue) return reject("longBiasFloor", longBiasIssue);
  }
  const patternGate = patternValidityGate(row, set);
  if (patternGate) return reject(patternGate.field, patternGate.detail);

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
  if (set.requireContractionsDecreasing === true && row.contractionsDecreasing !== true) return reject("requireContractionsDecreasing", "sin compresión progresiva");

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
    const weak = weaknessFilterValue(row);
    const minWeakness = finite(set.minWeaknessScore) ?? 0;
    if (Number.isFinite(weak) && weak < minWeakness) return reject("minWeaknessScore", `deterioro ${weak.toFixed(0)} < ${minWeakness}`);
    return "";
  }
  const setupGate = setupModeGate(row, set, mode);
  if (setupGate && setupGate.status !== "pass" && setupGate.status !== "near") return reject("setupMode", setupGate.detail);
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
