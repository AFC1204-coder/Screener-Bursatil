// Trade plan derivation: pivot buy point, suggested stop, risk and R-targets.
// Pure functions over data already produced by setupPatternForBars (pivotPrice,
// baseDepthPct, contractionSwings). This is objective structure math, NOT advice:
// the UI must frame it as reference levels, never as a recommendation.

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Minervini-style defaults: a leader breakout rarely justifies risking more than
// ~8% below the pivot; tighter structural stops are preferred when the last
// contraction sits closer than that.
const DEFAULT_MAX_STOP_PCT = 8;
const DEFAULT_ACCOUNT_RISK_PCT = 1;
const DEFAULT_MIN_PATTERN_QUALITY = 65;
const DEFAULT_MIN_PIVOT_CLARITY = 55;
const DEFAULT_MIN_ENTRY_DISTANCE_PCT = -5;
const DEFAULT_MAX_ENTRY_EXTENSION_PCT = 3;
const DEFAULT_MIN_CLOSE_LOCATION_PCT = 45;
const DEFAULT_MIN_BASE_CONTEXT_SCORE = 45;

const BLOCKED_PATTERN_DATA_STATUSES = new Set([
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

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boolTrue(value) {
  if (value === true) return true;
  if (typeof value === "string") return /^(1|true|yes|y|on|si|sí)$/i.test(value.trim());
  return false;
}

function planReliabilityBlockReason(input = {}, { requireDefinitiveData = false } = {}) {
  const dataStatus = cleanText(input.patternDataStatus).toLowerCase();
  const reliabilityState = cleanText(input.methodologyReliabilityState).toLowerCase();
  const contractionStructureStatus = cleanText(input.contractionStructureStatus).toLowerCase();
  if (boolTrue(input.setupDisplayDataLimited) || reliabilityState === "data_limited") {
    return input.methodologyReliabilityReason || input.setupDisplayReason || "Datos parciales: no derivar plan automático.";
  }
  if (boolTrue(input.setupDisplayBlocksPatternClaim) || boolTrue(input.methodologyBlocksPatternClaim)) {
    return input.methodologyReliabilityReason || input.setupDisplayReason || "Claim de patrón bloqueado por fiabilidad.";
  }
  if (input.patternEligible === false || BLOCKED_PATTERN_DATA_STATUSES.has(dataStatus)) {
    return dataStatus ? `Datos técnicos no usables: ${dataStatus}.` : "Datos técnicos sin validar.";
  }
  if (INVALID_CONTRACTION_STRUCTURE_STATUSES.has(contractionStructureStatus)) {
    return input.contractionStructureReason || `Estructura de contracciones rechazada: ${contractionStructureStatus}.`;
  }
  if (input.patternVolumeEligible === false) {
    return "Volumen no fiable para validar plan automático.";
  }
  if (requireDefinitiveData && dataStatus !== "ok") {
    return dataStatus ? `Datos técnicos no definitivos: ${dataStatus}.` : "Datos técnicos sin validar.";
  }
  if (!requireDefinitiveData && dataStatus && dataStatus !== "ok") {
    return `Datos técnicos no definitivos: ${dataStatus}.`;
  }
  return "";
}

function lastContractionLow(swings = []) {
  if (!Array.isArray(swings) || !swings.length) return null;
  // contractionSwings are ordered oldest-deepest first; the last entry is the
  // most recent (rightmost, shallowest) swing — the relevant stop reference.
  for (let i = swings.length - 1; i >= 0; i--) {
    const low = finite(swings[i]?.low);
    if (low != null && low > 0) return low;
  }
  return null;
}

/**
 * @param {object} input  row/pattern fields: pivotPrice, price, baseDepthPct, contractionSwings
 * @param {object} options  { maxStopPct, accountSize, accountRiskPct }
 */
export function computeTradePlan(input = {}, options = {}) {
  const reliabilityBlock = planReliabilityBlockReason(input);
  if (reliabilityBlock) {
    return { available: false, reason: reliabilityBlock };
  }
  const pivot = finite(input.pivotPrice);
  const price = finite(input.price ?? input.close);
  const baseDepthPct = finite(input.baseDepthPct);
  const maxStopPct = finite(options.maxStopPct) ?? DEFAULT_MAX_STOP_PCT;

  if (pivot == null || pivot <= 0) {
    return { available: false, reason: "Sin pivot medible en la base actual." };
  }

  // Structural low: prefer the most recent contraction low; fall back to a base
  // low derived from pivot (base high) and base depth.
  const swingLow = lastContractionLow(input.contractionSwings);
  const baseLow = baseDepthPct != null ? pivot * (1 - baseDepthPct / 100) : null;
  const structuralLow = swingLow ?? baseLow;

  // Monetary cap: never let the stop sit further than maxStopPct below pivot.
  const cappedStop = pivot * (1 - maxStopPct / 100);

  let stop;
  let stopType;
  if (structuralLow != null && structuralLow < pivot && structuralLow >= cappedStop) {
    stop = structuralLow;
    stopType = "estructural";
  } else {
    stop = cappedStop;
    stopType = structuralLow != null && structuralLow < cappedStop ? "acotado" : "monetario";
  }

  const riskPerShare = pivot - stop;
  const riskPct = (riskPerShare / pivot) * 100;
  const distanceToPivotPct = finite(input.distanceToPivotPct)
    ?? (price != null ? ((price / pivot) - 1) * 100 : null);

  const target2R = pivot + 2 * riskPerShare;
  const target3R = pivot + 3 * riskPerShare;

  const plan = {
    available: true,
    pivot,
    stop,
    stopType,
    riskPerShare,
    riskPct,
    structuralLow,
    cappedStopPct: maxStopPct,
    price,
    distanceToPivotPct,
    abovePivot: price != null ? price > pivot : null,
    target2R,
    target3R,
    deepBase: stopType !== "estructural" && structuralLow != null && structuralLow < cappedStop,
  };

  // Optional position sizing when the user supplies account context.
  const accountSize = finite(options.accountSize);
  const accountRiskPct = finite(options.accountRiskPct) ?? DEFAULT_ACCOUNT_RISK_PCT;
  if (accountSize != null && accountSize > 0 && riskPerShare > 0) {
    const riskBudget = accountSize * (accountRiskPct / 100);
    const shares = Math.floor(riskBudget / riskPerShare);
    const positionValue = shares * pivot;
    plan.sizing = {
      accountSize,
      accountRiskPct,
      riskBudget,
      shares,
      positionValue,
      positionPctOfAccount: (positionValue / accountSize) * 100,
      leveraged: positionValue > accountSize,
    };
  }

  return plan;
}

export function tradePlanEligibility(input = {}, options = {}) {
  const minPatternQuality = finite(options.minPatternQualityScore) ?? DEFAULT_MIN_PATTERN_QUALITY;
  const minPivotClarity = finite(options.minPivotClarityScore) ?? DEFAULT_MIN_PIVOT_CLARITY;
  const minEntryDistancePct = finite(options.minEntryDistancePct) ?? DEFAULT_MIN_ENTRY_DISTANCE_PCT;
  const maxEntryExtensionPct = finite(options.maxEntryExtensionPct) ?? DEFAULT_MAX_ENTRY_EXTENSION_PCT;
  const minCloseLocationPct = finite(options.minCloseLocationPct) ?? DEFAULT_MIN_CLOSE_LOCATION_PCT;
  const minBaseContextScore = finite(options.minBaseContextScore) ?? DEFAULT_MIN_BASE_CONTEXT_SCORE;
  const pivot = finite(input.pivotPrice);
  const quality = finite(input.patternQualityScore);
  const pivotClarity = finite(input.pivotClarityScore);
  const distanceToPivotPct = finite(input.distanceToPivotPct);
  const latestCloseLocationPct = finite(input.latestCloseLocationPct);
  const baseContextScore = finite(input.baseContextScore);
  const contractionCount = finite(input.contractionCount);
  const strictStructure = input.setupStructureStrict === true || input.setupStructureKey === "vcp_strict";

  if (!strictStructure) {
    return { actionable: false, reason: input.setupStructureReason || "Patrón no validado como VCP estricto." };
  }
  const reliabilityBlock = planReliabilityBlockReason(input, { requireDefinitiveData: true });
  if (reliabilityBlock) {
    return { actionable: false, reason: reliabilityBlock };
  }
  if (!Number.isFinite(quality) || quality < minPatternQuality) {
    return {
      actionable: false,
      reason: Number.isFinite(quality)
        ? `Calidad de patrón ${quality.toFixed(0)} < ${minPatternQuality}.`
        : "Calidad de patrón sin dato.",
    };
  }
  if (Number.isFinite(pivotClarity) && pivotClarity < minPivotClarity) {
    return { actionable: false, reason: `Claridad de pivot ${pivotClarity.toFixed(0)} < ${minPivotClarity}.` };
  }
  if (Number.isFinite(baseContextScore) && baseContextScore < minBaseContextScore) {
    return { actionable: false, reason: `Contexto de base ${baseContextScore.toFixed(0)} < ${minBaseContextScore}.` };
  }
  if (Number.isFinite(distanceToPivotPct) && distanceToPivotPct < minEntryDistancePct) {
    return { actionable: false, reason: `Precio demasiado lejos del pivot: ${distanceToPivotPct.toFixed(1)}%.` };
  }
  if (Number.isFinite(distanceToPivotPct) && distanceToPivotPct > maxEntryExtensionPct) {
    return { actionable: false, reason: `Precio extendido sobre pivot: +${distanceToPivotPct.toFixed(1)}%.` };
  }
  if (Number.isFinite(latestCloseLocationPct) && latestCloseLocationPct < minCloseLocationPct) {
    return { actionable: false, reason: `Cierre débil dentro del rango diario: ${latestCloseLocationPct.toFixed(0)}%.` };
  }
  if (!Number.isFinite(pivot) || pivot <= 0) {
    return { actionable: false, reason: "Pivot técnico no disponible." };
  }
  if (!Number.isFinite(contractionCount) || contractionCount < 3 || input.contractionsDecreasing !== true) {
    return { actionable: false, reason: "Contracciones VCP insuficientes o no decrecientes." };
  }

  return { actionable: true, reason: "VCP estricto validado." };
}
