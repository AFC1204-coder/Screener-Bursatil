import { auditDecisionRowIssues, decisionConfidenceSummary, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { decisionProfileForRow } from "@/lib/decisionProfile";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { explainScreenerRank } from "@/lib/screenerExplainability";

// Campos de fila que alimentan explain/audit/health/profile. Si añades una
// dependencia nueva en annotateRow, amplía esta lista — el test de igualdad
// canónica y la clave de invalidación dependen de ella.
export const ANNOTATION_ROW_SCALAR_FIELDS = [
  "price",
  "chartBarsCount",
  "rowProjection",
  "objectiveSetupScore",
  "setupQualityScore",
  "setupDisplayPlanValid",
  "setupDisplayStrict",
  "setupDisplayWatch",
  "setupDisplayDataLimited",
  "setupDisplayBlocksPatternClaim",
  "methodologyBlocksPatternClaim",
  "rsGlobalPct",
  "rsRating",
  "weinsteinScore",
  "minerviniScore",
  "rsSectorPct",
  "rsQualityScore",
  "volumeEffectScore",
  "adProxyScore",
  "growthScore",
  "epsGrowthProxyScore",
  "riskRewardScore",
  "groupStrengthScore",
  "sectorScore",
  "relativeVolume",
  "distance52w",
  "extSma50",
  "perf3m",
  "maxDrawdown63d",
  "shortPercentOfFloat",
  "objectiveScore",
  "totalScore",
  "compositeScore",
  "weaknessScore",
  "decisionProjectionPartial",
  "priceFreshnessOk",
  "dataCoverageScore",
  "technicalCoverageScore",
  "fundamentalCoverageScore",
  "profileCoverageScore",
  "priceFreshnessDays",
  "priceFreshnessMaxDays",
];

export const ANNOTATION_ROW_TEXT_FIELDS = [
  "setupDisplayReason",
  "methodologyReliabilityReason",
  "setupDisplayLabel",
  "setupVerdictLabel",
  "weaknessLabel",
  "priceFreshnessIssue",
  "priceFreshnessLabel",
  "dataCoverageLabel",
  "chartProvider",
  "priceSource",
  "provider",
  "dataProvider",
  "chartFallbackReason",
  "methodologyReliabilityState",
  "methodologyReliabilityLabel",
];

export const ANNOTATION_ROW_ARRAY_FIELDS = [
  "compositeReasons",
  "weaknessReasons",
  "compositeRisks",
  "decisionProjectionMissing",
  "dataCoverageIssues",
];

export const ANNOTATION_ROW_OBJECT_FIELDS = [
  "qualityGate",
  "objectiveMetricAudit",
  "providerMeta",
];

const DEFAULT_MAX_ENTRIES = 8192;
const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

let store = new Map();
let maxEntries = DEFAULT_MAX_ENTRIES;
let stats = {
  rowHits: 0,
  cacheHits: 0,
  misses: 0,
};

function rowFieldValue(row = {}, field = "") {
  return row[field] ?? row.metrics?.[field] ?? row.raw?.[field] ?? row.snapshot?.[field];
}

function serializeScalar(value) {
  if (value === true) return "1";
  if (value === false) return "0";
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return String(value);
}

function serializeArray(value) {
  if (!Array.isArray(value)) return "";
  return value.map((item) => serializeScalar(item)).join(RECORD_SEP);
}

function stableObjectJson(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const keys = Object.keys(value).sort();
  const normalized = {};
  for (const key of keys) normalized[key] = value[key];
  return JSON.stringify(normalized);
}

function hashString(input = "") {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

export function annotationSetupMode(settings = {}) {
  const set = settings?.values || settings || {};
  return String(set.setupMode || "").trim().toLowerCase();
}

export function buildAnnotationInputPayload(row = {}, settings = {}) {
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  const parts = [symbol, annotationSetupMode(settings)];
  for (const field of ANNOTATION_ROW_SCALAR_FIELDS) {
    parts.push(serializeScalar(rowFieldValue(row, field)));
  }
  for (const field of ANNOTATION_ROW_TEXT_FIELDS) {
    parts.push(serializeScalar(rowFieldValue(row, field)));
  }
  for (const field of ANNOTATION_ROW_ARRAY_FIELDS) {
    parts.push(serializeArray(rowFieldValue(row, field)));
  }
  for (const field of ANNOTATION_ROW_OBJECT_FIELDS) {
    parts.push(stableObjectJson(rowFieldValue(row, field)));
  }
  return { symbol, setupMode: parts[1], fingerprint: parts.slice(2).join(FIELD_SEP) };
}

export function buildAnnotationInputKey(row = {}, settings = {}) {
  const payload = buildAnnotationInputPayload(row, settings);
  if (!payload.symbol) return `|${payload.setupMode}|${hashString(payload.fingerprint)}`;
  return `${payload.symbol}|${payload.setupMode}|${hashString(payload.fingerprint)}`;
}

export function buildScreenerAnnotation(row = {}, settings = {}) {
  const explanation = explainScreenerRank(row, settings);
  const issues = auditDecisionRowIssues(row, explanation);
  return {
    explanation,
    confidence: decisionConfidenceSummary(row, explanation, issues),
    dataHealth: buildScreenerDataHealth(row, settings),
    priority: decisionPriorityBreakdown(row, explanation),
    profile: decisionProfileForRow(row, settings),
    issues,
  };
}

function touchCacheEntry(key, entry) {
  if (store.has(key)) store.delete(key);
  store.set(key, entry);
  while (store.size > maxEntries) {
    store.delete(store.keys().next().value);
  }
}

function readCacheEntry(key) {
  const entry = store.get(key);
  if (!entry) return null;
  store.delete(key);
  store.set(key, entry);
  return entry;
}

export function getScreenerAnnotationCacheStats() {
  return { ...stats, size: store.size, maxEntries };
}

export function resetScreenerAnnotationCacheStats() {
  stats = { rowHits: 0, cacheHits: 0, misses: 0 };
}

export function clearScreenerAnnotationCache(options = {}) {
  store = new Map();
  maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  resetScreenerAnnotationCacheStats();
}

export function annotateScreenerRow(row = {}, settings = {}, options = {}) {
  const inputKey = buildAnnotationInputKey(row, settings);
  const trackStats = options.stats !== false;

  if (row?.__screenerAnnotation && row.__screenerAnnotationInputKey === inputKey) {
    if (trackStats) stats.rowHits += 1;
    return row;
  }

  const cached = readCacheEntry(inputKey);
  if (cached?.annotation) {
    if (trackStats) stats.cacheHits += 1;
    return {
      ...row,
      __screenerAnnotation: cached.annotation,
      __screenerAnnotationInputKey: inputKey,
    };
  }

  if (trackStats) stats.misses += 1;
  const annotation = buildScreenerAnnotation(row, settings);
  touchCacheEntry(inputKey, {
    symbol: String(row?.symbol || "").trim().toUpperCase(),
    annotation,
  });

  return {
    ...row,
    __screenerAnnotation: annotation,
    __screenerAnnotationInputKey: inputKey,
  };
}

export function annotateScreenerRows(rows = [], settings = {}, options = {}) {
  return rows.map((row) => annotateScreenerRow(row, settings, options));
}
