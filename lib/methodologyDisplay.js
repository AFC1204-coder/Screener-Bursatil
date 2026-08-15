import { methodologyVerdictForRow } from "@/lib/methodologyVerdict";
import { patternEvidenceLine, setupStructureForRow, technicalConfidenceForPattern } from "@/lib/patternNarrative";

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function methodologyCopy(value = "") {
  const text = cleanText(value);
  if (text === "VCP accionable") return "VCP plan válido";
  if (text === "VCP plan válido") return "VCP plan válido";
  if (text === "Accionable") return "Plan válido";
  if (text === "Plan válido") return "Plan válido";
  if (text === "VCP estricto no accionable") return "VCP estricto sin plan";
  if (text === "Compresion de pivot") return "Compresión de pivot";
  if (text === "Compresion no confirmada") return "Compresión no confirmada";
  if (text === "Estructura observable, no accionable.") return "Estructura observable, sin plan válido.";
  if (text === "Estructura observable, sin plan válido.") return "Estructura observable, sin plan válido.";
  if (text === "Estructura observable sin plan válido.") return "Estructura observable, sin plan válido.";
  if (text === "Patron no validado como VCP estricto.") return "Patrón no validado como VCP estricto.";
  if (text === "Pivot técnico no disponible.") return "Pivot técnico no disponible.";
  return text
    .replace(/\bplan valido\b/gi, "plan válido")
    .replace(/\bplan automatico\b/gi, "plan automático")
    .replace(/\btecnico\b/gi, "técnico")
    .replace(/\btecnica\b/gi, "técnica")
    .replace(/\bpatron\b/gi, "patrón");
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
    if (value === null || value === undefined || value === "") continue;
    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized === "") continue;
    const n = Number(normalized);
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
    || label.includes("plan válido")
    || label.includes("plan válido");
}

function canonicalStoredDisplay(display = {}) {
  switch (cleanText(display.key)) {
    case "actionable_vcp":
      return { ...display, label: "VCP plan válido", shortLabel: "Plan válido" };
    case "strict_not_actionable":
      return { ...display, label: "VCP estricto sin plan", shortLabel: "VCP estricto" };
    case "pivot_squeeze":
      return { ...display, label: "Compresión de pivot", shortLabel: "Compresión de pivot" };
    case "constructive_base":
      return { ...display, label: "Base constructiva", shortLabel: "Base constructiva" };
    case "base_measurable":
      return { ...display, label: "Base medible", shortLabel: "Base medible" };
    case "no_base":
      return { ...display, label: "Sin base validada", shortLabel: "Sin base" };
    default:
      return display;
  }
}

function safeStoredDisplay(display = null, verdict = {}) {
  if (!display) return null;
  if (!claimsPlan(display) || verdictPlanValid(verdict)) return canonicalStoredDisplay(display);
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

export function methodologyCompactReasonLine(rowOrReason = {}) {
  const reason = typeof rowOrReason === "string" ? rowOrReason : methodologyReasonLine(rowOrReason);
  const text = methodologyCopy(reason);
  if (!text) return "-";
  if (/VCP estricto validado/i.test(text) || /3\+\s+contracciones decrecientes/i.test(text)) return "compresión válida";
  if (/última contracción se re-expande/i.test(text)) return "re-expansión final";
  if (/contracciones no decrecientes|Contracciones VCP insuficientes/i.test(text)) return "sin compresión progresiva";
  if (/\b\d+\s+contracciones?\s+útiles?/i.test(text)) return "compresión insuficiente";
  if (/volumen seco/i.test(text)) return "volumen no acompaña";
  if (/calidad\s+(de patrón\s+)?\d+/i.test(text)) return "calidad insuficiente";
  if (/claridad de pivot|pivot con pocos toques/i.test(text)) return "pivot débil";
  if (/rango estrecho cerca de pivot/i.test(text)) return "cerca de pivot";
  if (/pivot a|precio demasiado lejos del pivot|precio extendido/i.test(text)) return "fuera de pivot";
  if (/base reciente no confirmada/i.test(text)) return "base sin confirmar";
  if (/subida persistente sin base clara/i.test(text)) return "sin base clara";
  if (/no hay consolidaci[oó]n reciente validada/i.test(text)) return "base sin confirmar";
  if (/cierre d[eé]bil/i.test(text)) return "cierre débil";
  return text;
}

function pct(value) {
  const n = finiteOrNull(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "";
}

export function methodologyCompactDetailLine(row = {}) {
  const merged = mergedRow(row);
  const display = methodologyDisplayForRow(merged);
  const patternUsable = methodologyPatternEvidenceUsable(merged);
  const distanceToPivotPct = finiteOrNull(merged.distanceToPivotPct, merged.snapshot?.distanceToPivotPct);
  const volumeDryUpRatio = finiteOrNull(merged.volumeDryUpRatio, merged.snapshot?.volumeDryUpRatio);
  const patternQualityScore = finiteOrNull(merged.patternQualityScore, merged.snapshot?.patternQualityScore);
  const parts = [
    display.evidence ? `Evidencia: ${display.evidence}` : "",
    display.confidence?.label ? `Datos: ${display.confidence.label}` : "",
    display.blocksPatternClaim === true && display.reason ? `Motivo: ${display.reason}` : "",
    Number.isFinite(distanceToPivotPct) ? `Pivot: ${pct(distanceToPivotPct)}` : "",
    patternUsable && Number.isFinite(volumeDryUpRatio) ? `Volumen seco: ${volumeDryUpRatio.toFixed(2)}x` : "",
    patternUsable && Number.isFinite(patternQualityScore) ? `Calidad: ${patternQualityScore.toFixed(0)}` : "",
  ].filter(Boolean);
  return [...new Set(parts)].join(" · ");
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

export function methodologyPatternEvidenceUsable(row = {}) {
  const merged = mergedRow(row);
  const display = methodologyDisplayForRow(merged);
  const status = cleanText(merged.patternDataStatus || merged.snapshot?.patternDataStatus).toLowerCase();
  return display.dataLimited !== true
    && display.blocksPatternClaim !== true
    && merged.patternEligible !== false
    && (!status || status === "ok" || status === "partial_volume");
}

export function methodologyPatternEvidenceBonus(row = {}) {
  if (!methodologyPatternEvidenceUsable(row)) return 0;
  let bonus = 0;
  const patternQualityScore = finiteOrNull(row.patternQualityScore, row.snapshot?.patternQualityScore);
  const contractionScore = finiteOrNull(row.contractionScore, row.snapshot?.contractionScore);
  const breakoutQualityScore = finiteOrNull(row.breakoutQualityScore, row.snapshot?.breakoutQualityScore);
  const distanceToPivotPct = finiteOrNull(row.distanceToPivotPct, row.snapshot?.distanceToPivotPct);
  const volumeDryUpRatio = finiteOrNull(row.volumeDryUpRatio, row.snapshot?.volumeDryUpRatio);
  if (Number.isFinite(patternQualityScore)) bonus += Math.min(10, patternQualityScore * .1);
  if (Number.isFinite(contractionScore)) bonus += Math.min(6, contractionScore * .06);
  if (row.vcpCandidate === true || row.snapshot?.vcpCandidate === true) bonus += 10;
  if (row.breakoutAttempt === true || row.snapshot?.breakoutAttempt === true) bonus += 6;
  if (Number.isFinite(breakoutQualityScore)) bonus += Math.min(8, breakoutQualityScore * .08);
  if (Number.isFinite(distanceToPivotPct) && distanceToPivotPct >= -5 && distanceToPivotPct <= 3) bonus += 5;
  if (Number.isFinite(volumeDryUpRatio) && volumeDryUpRatio <= .85) bonus += 4;
  return bonus;
}

export function methodologyPivotWatchEligible(row = {}, { min = -10, max = 3 } = {}) {
  const merged = mergedRow(row);
  const display = methodologyDisplayForRow(merged);
  const distanceToPivotPct = finiteOrNull(merged.distanceToPivotPct, merged.snapshot?.distanceToPivotPct);
  return display.dataLimited !== true
    && display.blocksPatternClaim !== true
    && (display.actionable === true || display.watch === true)
    && Number.isFinite(distanceToPivotPct)
    && distanceToPivotPct >= min
    && distanceToPivotPct <= max;
}
