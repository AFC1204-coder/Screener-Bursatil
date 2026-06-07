import { setupStructureForRow, technicalConfidenceForPattern } from "@/lib/patternNarrative";
import { tradePlanEligibility } from "@/lib/tradePlan";

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function signedPct(value) {
  const n = finite(value);
  if (!Number.isFinite(n)) return "sin dato";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

const NEAR_PIVOT_MIN_PCT = -5;
const WATCH_PIVOT_MIN_PCT = -10;
const WATCH_PIVOT_MAX_PCT = 3;

function mergedRow(row = {}) {
  return { ...(row.snapshot || {}), ...row };
}

function gateFor(row = {}, structure = {}) {
  return tradePlanEligibility({
    ...row,
    setupStructureKey: structure.key,
    setupStructureStrict: structure.strict,
    setupStructureReason: structure.reason,
  });
}

function dataWatchable(row = {}) {
  const status = String(row.patternDataStatus || "").trim();
  return row.patternEligible !== false && (!status || status === "ok" || status === "partial_volume");
}

function watchBaseEligible(row = {}) {
  const family = String(row.patternFamily || "").trim();
  return dataWatchable(row)
    && row.consolidationCandidate === true
    && family !== "trend_no_base"
    && family !== "failed_breakout"
    && row.failedBreakout !== true;
}

function inNearPivotZone(row = {}) {
  const pivot = finite(row.distanceToPivotPct);
  return Number.isFinite(pivot) && pivot >= NEAR_PIVOT_MIN_PCT && pivot <= WATCH_PIVOT_MAX_PCT;
}

function inUsefulWatchZone(row = {}) {
  const pivot = finite(row.distanceToPivotPct);
  return Number.isFinite(pivot) && pivot >= WATCH_PIVOT_MIN_PCT && pivot <= WATCH_PIVOT_MAX_PCT;
}

function measuredBaseEligible(row = {}) {
  const quality = finite(row.patternQualityScore);
  const baseDepth = finite(row.baseDepthPct);
  const count = finite(row.contractionCount);
  const volumeDry = finite(row.volumeDryUpRatio);
  return watchBaseEligible(row)
    && Number.isFinite(quality)
    && quality >= 50
    && (!Number.isFinite(baseDepth) || baseDepth <= 35)
    && Number.isFinite(volumeDry)
    && volumeDry <= 1.15
    && count >= 2
    && row.contractionsDecreasing !== false;
}

function constructiveWatchEligible(row = {}) {
  return measuredBaseEligible(row) && inUsefulWatchZone(row);
}

function pivotSqueezeWatchEligible(row = {}) {
  const quality = finite(row.patternQualityScore);
  const baseDepth = finite(row.baseDepthPct);
  const count = finite(row.contractionCount);
  const tight10 = finite(row.tightness10dPct);
  const pivotClarity = finite(row.pivotClarityScore);
  const volumeDry = finite(row.volumeDryUpRatio);
  const nearPivot = inNearPivotZone(row);
  const tight = row.rightSideTight === true || Number.isFinite(tight10) && tight10 <= 12;
  return watchBaseEligible(row)
    && nearPivot
    && tight
    && count >= 2
    && row.contractionsDecreasing !== false
    && Number.isFinite(quality)
    && quality >= 60
    && (!Number.isFinite(baseDepth) || baseDepth <= 32)
    && (!Number.isFinite(pivotClarity) || pivotClarity >= 55)
    && Number.isFinite(volumeDry)
    && volumeDry <= 1.15;
}

function pivotProximityWatchEligible(row = {}, structure = {}) {
  const quality = finite(row.patternQualityScore);
  const baseDepth = finite(row.baseDepthPct);
  const count = finite(row.contractionCount);
  const pivotClarity = finite(row.pivotClarityScore);
  const volumeDry = finite(row.volumeDryUpRatio);
  return watchBaseEligible(row)
    && !["not_vcp", "failed_breakout", "trend_no_base"].includes(structure.key)
    && count >= 2
    && row.contractionsDecreasing !== false
    && Number.isFinite(quality)
    && quality >= 60
    && Number.isFinite(volumeDry)
    && volumeDry <= 1.15
    && (!Number.isFinite(baseDepth) || baseDepth <= 32)
    && (!Number.isFinite(pivotClarity) || pivotClarity >= 55);
}

function vcpWatchEligible(row = {}) {
  const quality = finite(row.patternQualityScore);
  const baseDepth = finite(row.baseDepthPct);
  const count = finite(row.contractionCount);
  const volumeDry = finite(row.volumeDryUpRatio);
  return watchBaseEligible(row)
    && inUsefulWatchZone(row)
    && count >= 3
    && row.contractionsDecreasing === true
    && Number.isFinite(quality)
    && quality >= 50
    && (!Number.isFinite(baseDepth) || baseDepth <= 35)
    && Number.isFinite(volumeDry)
    && volumeDry <= 1.15;
}

function baseMeasuredReason(row = {}) {
  const pivot = finite(row.distanceToPivotPct);
  if (Number.isFinite(pivot)) return `Base medible, pero pivot a ${signedPct(pivot)}; fuera de zona de vigilancia.`;
  return "Base medible, pero sin pivot estimado suficiente para vigilancia.";
}

function blockedLabelFor(row = {}, structure = {}) {
  if (["vcp_watch", "constructive_base"].includes(structure.key) && measuredBaseEligible(row) && !inUsefulWatchZone(row)) {
    return {
      key: "base_measurable",
      label: "Base medible",
      shortLabel: "Base medible",
      reason: baseMeasuredReason(row),
      tone: "neutral",
      observable: true,
    };
  }
  if (structure.key === "trend_no_base") return { key: "no_base", label: "Sin base validada", shortLabel: "Sin base" };
  if (structure.key === "vcp_watch") return { key: "not_actionable", label: "Base no confirmada", shortLabel: "Base no confirmada" };
  if (structure.key === "pivot_squeeze") return { key: "not_actionable", label: "Compresión no confirmada", shortLabel: "Compresión no confirmada" };
  if (structure.key === "constructive_base") return { key: "not_actionable", label: "Base no confirmada", shortLabel: "Base no confirmada" };
  return { key: "not_actionable", label: structure.label, shortLabel: structure.shortLabel };
}

export function methodologyVerdictForRow(input = {}) {
  const row = mergedRow(input);
  const structure = setupStructureForRow(row);
  const dataConfidence = technicalConfidenceForPattern(row);
  const gate = gateFor(row, structure);
  const quality = finite(row.patternQualityScore);
  const nearPivot = inNearPivotZone(row);

  if (row.patternEligible === false || structure.key === "data") {
    return {
      key: "data_issue",
      state: "data",
      label: "Datos no fiables",
      shortLabel: "Datos",
      tone: "muted",
      reason: structure.reason || structure.dataLabel || "Cobertura técnica insuficiente.",
      evidence: structure.evidence,
      dataLabel: structure.dataLabel,
      dataConfidence,
      structure,
      tradePlanEligible: false,
      tradePlanReason: gate.reason,
      actionable: false,
      observable: false,
      watch: false,
      strict: false,
    };
  }

  if (gate.actionable) {
    return {
      key: "actionable_vcp",
      state: "actionable",
      label: "VCP plan válido",
      shortLabel: "Plan válido",
      tone: "good",
      reason: gate.reason || structure.reason || "VCP estricto validado.",
      evidence: structure.evidence,
      dataLabel: structure.dataLabel,
      dataConfidence,
      structure,
      tradePlanEligible: true,
      tradePlanReason: gate.reason,
      actionable: true,
      observable: true,
      watch: false,
      strict: true,
    };
  }

  if (structure.key === "vcp_strict") {
    return {
      key: "strict_not_actionable",
      state: "validated",
      label: "VCP estricto sin plan",
      shortLabel: "VCP estricto",
      tone: "watch",
      reason: gate.reason || structure.reason || "La estructura es estricta, pero falta una condición para plan válido.",
      evidence: structure.evidence,
      dataLabel: structure.dataLabel,
      dataConfidence,
      structure,
      tradePlanEligible: false,
      tradePlanReason: gate.reason,
      actionable: false,
      observable: true,
      watch: true,
      strict: true,
    };
  }

  const structureWatchEligible = structure.key === "vcp_watch" && vcpWatchEligible(row)
    || structure.key === "breakout_observed"
    || structure.key === "pivot_squeeze" && pivotSqueezeWatchEligible(row)
    || structure.key === "constructive_base" && constructiveWatchEligible(row);
  if (structureWatchEligible) {
    const watchLabel = structure.key === "vcp_watch" ? "Base en vigilancia" : structure.label;
    const watchShortLabel = structure.key === "vcp_watch" ? "Base en vigilancia" : structure.shortLabel;
    return {
      key: structure.key,
      state: "watch",
      label: watchLabel,
      shortLabel: watchShortLabel,
      tone: structure.tone || "watch",
      reason: structure.reason || gate.reason || "Estructura observable, sin plan válido.",
      evidence: structure.evidence,
      dataLabel: structure.dataLabel,
      dataConfidence,
      structure,
      tradePlanEligible: false,
      tradePlanReason: gate.reason,
      actionable: false,
      observable: true,
      watch: true,
      strict: false,
    };
  }

  if (nearPivot && pivotProximityWatchEligible(row, structure)) {
    return {
      key: "pivot_proximity",
      state: "watch",
      label: "Pivot cercano",
      shortLabel: "Pivot estimado",
      tone: "watch",
      reason: structure.reason || "Precio cerca de un pivot calculado; no hay VCP estricto validado.",
      evidence: structure.evidence || (Number.isFinite(quality) ? `Calidad ${quality.toFixed(0)}` : ""),
      dataLabel: structure.dataLabel,
      dataConfidence,
      structure,
      tradePlanEligible: false,
      tradePlanReason: gate.reason,
      actionable: false,
      observable: true,
      watch: true,
      strict: false,
    };
  }

  const blocked = blockedLabelFor(row, structure);
  return {
    key: blocked.key,
    state: "blocked",
    label: blocked.label,
    shortLabel: blocked.shortLabel,
    tone: blocked.tone || structure.tone || "muted",
    reason: blocked.reason || structure.reason || gate.reason || "No hay estructura validada para plan.",
    evidence: structure.evidence,
    dataLabel: structure.dataLabel,
    dataConfidence,
    structure,
    tradePlanEligible: false,
    tradePlanReason: gate.reason,
    actionable: false,
    observable: blocked.observable === true,
    watch: false,
    strict: false,
  };
}

export function applyMethodologyVerdict(row = {}) {
  const verdict = methodologyVerdictForRow(row);
  return {
    ...row,
    setupVerdict: verdict,
    setupVerdictKey: verdict.key,
    setupVerdictState: verdict.state,
    setupVerdictLabel: verdict.label,
    setupVerdictShortLabel: verdict.shortLabel,
    setupVerdictReason: verdict.reason,
    setupVerdictEvidence: verdict.evidence,
    setupVerdictTone: verdict.tone,
    setupDataConfidenceKey: verdict.dataConfidence?.key,
    setupDataConfidenceLabel: verdict.dataConfidence?.label,
    setupPlanValid: verdict.actionable === true && verdict.tradePlanEligible === true,
    setupActionable: verdict.actionable,
    setupObservable: verdict.observable,
    setupWatch: verdict.watch,
    setupStrict: verdict.strict,
  };
}
