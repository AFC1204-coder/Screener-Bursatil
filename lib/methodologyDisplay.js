import { methodologyVerdictForRow } from "@/lib/methodologyVerdict";
import { patternEvidenceLine, setupStructureForRow, technicalConfidenceForPattern } from "@/lib/patternNarrative";

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function methodologyCopy(value = "") {
  const text = cleanText(value);
  if (text === "VCP accionable") return "VCP plan valido";
  if (text === "Accionable") return "Plan valido";
  if (text === "VCP estricto no accionable") return "VCP estricto sin plan";
  if (text === "Estructura observable, no accionable.") return "Estructura observable, sin plan valido.";
  return text;
}

function mergedRow(row = {}) {
  return { ...(row.snapshot || {}), ...row };
}

function storedDataLimited(row = {}) {
  return cleanText(row.methodologyReliabilityState) === "data_limited"
    || row.methodologyBlocksPatternClaim === true
    || row.setupDisplayDataLimited === true;
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  if (typeof value === "string") {
    if (/^(1|true|yes|y)$/i.test(value)) return true;
    if (/^(0|false|no|n)$/i.test(value)) return false;
  }
  return null;
}

function finiteOrNull(...values) {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function storedDisplay(row = {}) {
  if (!cleanText(row.setupDisplayKey) && !cleanText(row.setupDisplayLabel) && !cleanText(row.setupDisplayState)) return null;
  return {
    key: cleanText(row.setupDisplayKey),
    state: cleanText(row.setupDisplayState),
    label: methodologyCopy(row.setupDisplayLabel),
    shortLabel: methodologyCopy(row.setupDisplayShortLabel),
    reason: methodologyCopy(row.setupDisplayReason),
    evidence: cleanText(row.setupDisplayEvidence),
    line: cleanText(row.setupDisplayLine),
    tone: cleanText(row.setupDisplayTone),
    dataLimited: boolOrNull(row.setupDisplayDataLimited),
    blocksPatternClaim: boolOrNull(row.setupDisplayBlocksPatternClaim),
    actionable: boolOrNull(row.setupDisplayActionable),
    observable: boolOrNull(row.setupDisplayObservable),
    watch: boolOrNull(row.setupDisplayWatch),
    strict: boolOrNull(row.setupDisplayStrict),
    tradePlanEligible: boolOrNull(row.setupDisplayTradePlanEligible),
    confidenceKey: cleanText(row.setupDisplayConfidenceKey),
    confidenceLabel: cleanText(row.setupDisplayConfidenceLabel),
  };
}

function verdictPlanValid(verdict = {}) {
  return verdict.actionable === true && verdict.tradePlanEligible === true && verdict.state !== "data";
}

function claimsPlan(display = {}) {
  const key = cleanText(display.key).toLowerCase();
  const state = cleanText(display.state).toLowerCase();
  const label = cleanText(`${display.label || ""} ${display.shortLabel || ""}`).toLowerCase();
  return display.actionable === true
    || display.tradePlanEligible === true
    || key === "actionable_vcp"
    || state === "actionable"
    || label.includes("plan valido");
}

function safeStoredDisplay(display = null, verdict = {}) {
  if (!display) return null;
  if (!claimsPlan(display) || verdictPlanValid(verdict)) return display;
  return {
    ...display,
    key: "",
    state: "",
    label: "",
    shortLabel: "",
    reason: "",
    line: "",
    tone: "",
    actionable: false,
    tradePlanEligible: false,
  };
}

export function methodologyDisplayForRow(input = {}) {
  const row = mergedRow(input);
  const verdict = methodologyVerdictForRow(row);
  const structure = verdict.structure || setupStructureForRow(row);
  const stored = safeStoredDisplay(storedDisplay(row), verdict);
  const baseConfidence = verdict.dataConfidence || technicalConfidenceForPattern(row);
  const confidence = stored?.confidenceKey || stored?.confidenceLabel
    ? {
      ...baseConfidence,
      key: stored.confidenceKey || baseConfidence.key,
      label: stored.confidenceLabel || baseConfidence.label,
      shortLabel: stored.confidenceLabel || baseConfidence.shortLabel,
      blocksAction: stored.blocksPatternClaim ?? baseConfidence.blocksAction,
    }
    : baseConfidence;
  const dataLimited = storedDataLimited(row);
  const state = dataLimited ? "data_limited" : stored?.state || verdict.state || "unknown";
  const label = dataLimited
    ? methodologyCopy(row.methodologyReliabilityLabel || stored?.label || row.setupVerdictLabel || "Datos parciales")
    : methodologyCopy(stored?.label || verdict.label || structure.label || "Sin validar");
  const shortLabel = dataLimited
    ? methodologyCopy(stored?.shortLabel || row.setupVerdictShortLabel || row.methodologyReliabilityLabel || "Datos")
    : methodologyCopy(stored?.shortLabel || verdict.shortLabel || structure.shortLabel || label);
  const reason = dataLimited
    ? methodologyCopy(row.methodologyReliabilityReason || stored?.reason || row.setupVerdictReason || verdict.reason || structure.reason || confidence.detail)
    : methodologyCopy(stored?.reason || verdict.reason || structure.reason || confidence.detail);
  const evidence = cleanText(stored?.evidence || verdict.evidence || structure.evidence || patternEvidenceLine(row));
  const confidencePrefix = confidence.key === "partial" ? `${confidence.shortLabel} · ` : "";
  const line = dataLimited
    ? reason || label
    : stored?.line || (evidence
      ? `${confidencePrefix}${evidence}`
      : confidence.label || label);

  return {
    verdict,
    structure,
    confidence,
    key: dataLimited ? "data_limited" : stored?.key || verdict.key || structure.key || "unknown",
    state,
    tone: dataLimited ? "muted" : stored?.tone || verdict.tone || structure.tone || confidence.tone || "neutral",
    label,
    shortLabel,
    reason,
    evidence,
    line,
    dataLimited,
    blocksPatternClaim: dataLimited || stored?.blocksPatternClaim === true || confidence.blocksAction === true || verdict.state === "data",
    actionable: !dataLimited && verdict.actionable === true && stored?.actionable !== false,
    observable: !dataLimited && (stored?.observable ?? Boolean(verdict.observable)),
    watch: !dataLimited && (stored?.watch ?? Boolean(verdict.watch)),
    strict: !dataLimited && (stored?.strict ?? Boolean(verdict.strict)),
    tradePlanEligible: !dataLimited && verdict.tradePlanEligible === true && stored?.tradePlanEligible !== false,
    tradePlanReason: verdict.tradePlanReason || "",
  };
}

export function methodologySetupLabel(row = {}) {
  return methodologyDisplayForRow(row).shortLabel || "Sin validar";
}

export function methodologyEvidenceLine(row = {}) {
  return methodologyDisplayForRow(row).line || "Estructura sin dato";
}

export function methodologyReasonLine(row = {}) {
  const display = methodologyDisplayForRow(row);
  return display.reason || display.line || display.label || "-";
}

export function methodologyWatchEligible(row = {}) {
  const display = methodologyDisplayForRow(row);
  return display.actionable || display.watch;
}

export function methodologyTradePlanEligible(row = {}) {
  const display = methodologyDisplayForRow(row);
  return display.actionable === true
    && display.tradePlanEligible === true
    && display.dataLimited !== true
    && display.blocksPatternClaim !== true;
}

export function methodologyPivotWatchEligible(row = {}, { min = -10, max = 3 } = {}) {
  const merged = mergedRow(row);
  const display = methodologyDisplayForRow(merged);
  const distanceToPivotPct = finiteOrNull(merged.distanceToPivotPct, merged.snapshot?.distanceToPivotPct);
  return display.dataLimited !== true
    && (display.actionable === true || display.watch === true)
    && Number.isFinite(distanceToPivotPct)
    && distanceToPivotPct >= min
    && distanceToPivotPct <= max;
}
