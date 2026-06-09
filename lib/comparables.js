import { businessThemeKey } from "@/lib/businessTheme";
import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";

export function cleanComparableText(value = "") {
  return String(value || "").trim();
}

function firstFinite(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function rowValue(row = {}, key = "") {
  return row.raw?.[key] ?? row.metrics?.[key] ?? row[key] ?? null;
}

function normalizedTheme(row = {}, raw = {}) {
  const sector = row.sector || raw.sector || "";
  const industry = row.industry || raw.industry || "";
  if (sector || industry) return businessThemeKey(sector, industry, raw.businessSummary || raw.summary || raw.businessEs || row.theme || raw.theme || "");
  return row.theme || raw.theme || "";
}

function storedDisplayFields(row = {}) {
  return {
    setupVerdictKey: cleanComparableText(rowValue(row, "setupVerdictKey")),
    setupVerdictState: cleanComparableText(rowValue(row, "setupVerdictState")),
    setupVerdictLabel: cleanComparableText(rowValue(row, "setupVerdictLabel")),
    setupVerdictShortLabel: cleanComparableText(rowValue(row, "setupVerdictShortLabel")),
    setupPlanValid: rowValue(row, "setupPlanValid"),
    setupActionable: rowValue(row, "setupActionable"),
    setupObservable: rowValue(row, "setupObservable"),
    setupWatch: rowValue(row, "setupWatch"),
    setupStrict: rowValue(row, "setupStrict"),
    setupDisplayKey: cleanComparableText(rowValue(row, "setupDisplayKey")),
    setupDisplayState: cleanComparableText(rowValue(row, "setupDisplayState")),
    setupDisplayLabel: cleanComparableText(rowValue(row, "setupDisplayLabel")),
    setupDisplayShortLabel: cleanComparableText(rowValue(row, "setupDisplayShortLabel")),
    setupDisplayReason: cleanComparableText(rowValue(row, "setupDisplayReason")),
    setupDisplayEvidence: cleanComparableText(rowValue(row, "setupDisplayEvidence")),
    setupDisplayLine: cleanComparableText(rowValue(row, "setupDisplayLine")),
    setupDisplayTone: cleanComparableText(rowValue(row, "setupDisplayTone")),
    setupDisplayDataLimited: rowValue(row, "setupDisplayDataLimited"),
    setupDisplayBlocksPatternClaim: rowValue(row, "setupDisplayBlocksPatternClaim"),
    setupDisplayPlanValid: rowValue(row, "setupDisplayPlanValid"),
    setupDisplayActionable: rowValue(row, "setupDisplayActionable"),
    setupDisplayObservable: rowValue(row, "setupDisplayObservable"),
    setupDisplayWatch: rowValue(row, "setupDisplayWatch"),
    setupDisplayStrict: rowValue(row, "setupDisplayStrict"),
    setupDisplayTradePlanEligible: rowValue(row, "setupDisplayTradePlanEligible"),
    setupDisplayConfidenceKey: cleanComparableText(rowValue(row, "setupDisplayConfidenceKey")),
    setupDisplayConfidenceLabel: cleanComparableText(rowValue(row, "setupDisplayConfidenceLabel")),
    methodologyReliabilityState: cleanComparableText(rowValue(row, "methodologyReliabilityState")),
    methodologyReliabilityLabel: cleanComparableText(rowValue(row, "methodologyReliabilityLabel")),
    methodologyReliabilityReason: cleanComparableText(rowValue(row, "methodologyReliabilityReason")),
    methodologyBlocksPatternClaim: rowValue(row, "methodologyBlocksPatternClaim"),
  };
}

export function comparablePatternUsable(item = {}) {
  const display = methodologyDisplayForRow(item);
  const status = cleanComparableText(item.patternDataStatus).toLowerCase();
  return display.blocksPatternClaim !== true
    && display.dataLimited !== true
    && item.patternEligible !== false
    && !["insufficient_history", "sparse_ohlc", "stale_price", "error"].includes(status);
}

export function normalizeComparableResult(row = {}) {
  const raw = row.raw || {};
  const metrics = row.metrics || {};
  const normalized = {
    symbol: row.symbol || raw.symbol || "",
    companyName: row.company_name || raw.companyName || raw.name || row.symbol || "",
    country: row.country || raw.country || "",
    sector: row.sector || raw.sector || "",
    industry: row.industry || raw.industry || "",
    theme: normalizedTheme(row, raw),
    asOf: row.created_at || "",
    totalScore: firstFinite(raw.totalScore, row.total_score),
    rsGlobalPct: firstFinite(raw.rsGlobalPct, metrics.rsGlobalPct, row.rs_rating),
    rsSectorPct: firstFinite(raw.rsSectorPct, metrics.rsSectorPct),
    setupQualityScore: firstFinite(raw.setupQualityScore, metrics.setupQualityScore),
    patternFamily: cleanComparableText(rowValue(row, "patternFamily")),
    patternMaturity: cleanComparableText(rowValue(row, "patternMaturity")),
    patternQualityScore: firstFinite(rowValue(row, "patternQualityScore")),
    setupStructureKey: cleanComparableText(rowValue(row, "setupStructureKey")),
    setupStructureLabel: cleanComparableText(rowValue(row, "setupStructureLabel")),
    setupStructureReason: cleanComparableText(rowValue(row, "setupStructureReason")),
    setupStructureEvidence: cleanComparableText(rowValue(row, "setupStructureEvidence")),
    setupStructureTone: cleanComparableText(rowValue(row, "setupStructureTone")),
    setupStructureStrict: rowValue(row, "setupStructureStrict"),
    setupStructureDataLabel: cleanComparableText(rowValue(row, "setupStructureDataLabel")),
    patternDataStatus: cleanComparableText(rowValue(row, "patternDataStatus")) || "sin dato",
    patternEligible: rowValue(row, "patternEligible"),
    consolidationCandidate: rowValue(row, "consolidationCandidate"),
    baseContextStatus: cleanComparableText(rowValue(row, "baseContextStatus")),
    pivotSqueeze: rowValue(row, "pivotSqueeze"),
    contractionDepths: Array.isArray(rowValue(row, "contractionDepths")) ? rowValue(row, "contractionDepths") : [],
    measuredContractionDepths: Array.isArray(rowValue(row, "measuredContractionDepths")) ? rowValue(row, "measuredContractionDepths") : [],
    rejectedContractionDepthPct: firstFinite(rowValue(row, "rejectedContractionDepthPct")),
    contractionCount: firstFinite(rowValue(row, "contractionCount")),
    contractionsDecreasing: rowValue(row, "contractionsDecreasing"),
    contractionStructureStatus: cleanComparableText(rowValue(row, "contractionStructureStatus")),
    contractionStructureReason: cleanComparableText(rowValue(row, "contractionStructureReason")),
    lastContractionDepthPct: firstFinite(rowValue(row, "lastContractionDepthPct")),
    baseDepthPct: firstFinite(rowValue(row, "baseDepthPct")),
    baseWeeks: firstFinite(rowValue(row, "baseWeeks")),
    distanceToPivotPct: firstFinite(rowValue(row, "distanceToPivotPct")),
    absDistanceToPivotPct: firstFinite(rowValue(row, "absDistanceToPivotPct")),
    volumeDryUpRatio: firstFinite(rowValue(row, "volumeDryUpRatio")),
    tightness10dPct: firstFinite(rowValue(row, "tightness10dPct")),
    extSma50: firstFinite(rowValue(row, "extSma50")),
    avgTurnover: firstFinite(rowValue(row, "avgTurnover")),
    ...storedDisplayFields(row),
  };
  return {
    ...normalized,
    comparablePatternUsable: comparablePatternUsable(normalized),
  };
}

export function comparableRelationFor(item = {}, target = {}) {
  if (cleanComparableText(item.symbol).toUpperCase() === cleanComparableText(target.symbol).toUpperCase()) return { key: "current", label: "Activo actual", rank: 0 };
  if (cleanComparableText(item.industry) && cleanComparableText(item.industry) === cleanComparableText(target.industry)) return { key: "industry", label: "Misma industria", rank: 1 };
  if (cleanComparableText(item.theme) && cleanComparableText(item.theme) === cleanComparableText(target.theme)) return { key: "theme", label: "Mismo tema", rank: 2 };
  if (cleanComparableText(item.sector) && cleanComparableText(item.sector) === cleanComparableText(target.sector)) return { key: "sector", label: "Mismo sector", rank: 3 };
  if (cleanComparableText(item.country) && cleanComparableText(item.country) === cleanComparableText(target.country)) return { key: "country", label: "Mismo mercado", rank: 4 };
  return { key: "context", label: "Contexto relacionado", rank: 5 };
}

export function comparableScore(item = {}, target = {}) {
  const relation = comparableRelationFor(item, target);
  const patternUsable = comparablePatternUsable(item);
  const rsCredit = Number.isFinite(item.rsSectorPct) ? item.rsSectorPct : 0;
  const patternCredit = patternUsable && Number.isFinite(item.patternQualityScore) ? item.patternQualityScore * .5 : 0;
  const pivotPenalty = patternUsable && Number.isFinite(item.absDistanceToPivotPct) ? item.absDistanceToPivotPct * .7 : 8;
  const blockedPenalty = patternUsable ? 0 : 12;
  return relation.rank * 1000 - rsCredit - patternCredit + pivotPenalty + blockedPenalty;
}
