import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rounded(value, digits = 1) {
  const n = finite(value);
  return Number.isFinite(n) ? Number(n.toFixed(digits)) : null;
}

function pct(value) {
  const n = finite(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : "sin dato";
}

function ratio(value) {
  const n = finite(value);
  return Number.isFinite(n) ? `${n.toFixed(2)}x` : "sin dato";
}

function signedPct(value) {
  const n = finite(value);
  if (!Number.isFinite(n)) return "sin dato";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function compactNumber(value, digits = 1) {
  const n = finite(value);
  return Number.isFinite(n) ? n.toFixed(digits) : "sin dato";
}

function dateRange(item = {}) {
  const from = String(item.fromDate || "").slice(0, 10);
  const to = String(item.toDate || "").slice(0, 10);
  if (from && to) return `${from} -> ${to}`;
  return from || to || "sin fechas";
}

function statusLabel(status = "") {
  switch (String(status || "")) {
    case "ok":
      return "secuencia válida";
    case "lower_low_drift":
      return "mínimos no sostienen";
    case "ceiling_break":
      return "techo inestable";
    case "pivot_noise":
      return "pivots cercanos";
    case "depth_reexpansion":
      return "re-expansión";
    case "not_consolidating":
      return "sin base";
    case "no_meaningful_contractions":
      return "sin contracciones";
    case "data_blocked":
      return "datos bloqueados";
    default:
      return status || "sin dato";
  }
}

function gate(key, label, state = "neutral", detail = "") {
  return { key, label, state, detail };
}

function dataGate(pattern = {}) {
  const status = String(pattern.patternDataStatus || "").trim();
  if (pattern.patternEligible === false) return gate("data", "Datos", "fail", status || "bloqueado");
  if (status === "partial_volume" || status === "missing_volume") return gate("data", "Datos", "watch", "volumen parcial");
  if (!status || status === "ok") return gate("data", "Datos", "pass", "OK");
  return gate("data", "Datos", "watch", status);
}

function baseGate(pattern = {}) {
  if (pattern.consolidationCandidate === true) return gate("base", "Base", "pass", pattern.baseContextStatus || "confirmada");
  if (pattern.baseContextStatus === "persistent_advance") return gate("base", "Base", "fail", "subida sin base");
  return gate("base", "Base", "fail", "no confirmada");
}

function sequenceGate(pattern = {}) {
  const status = String(pattern.contractionStructureStatus || "");
  if (status === "ok") return gate("structure", "Secuencia", "pass", "suelo/techo OK");
  return gate("structure", "Secuencia", "fail", statusLabel(status));
}

function countGate(pattern = {}) {
  const count = finite(pattern.contractionCount) ?? 0;
  if (count >= 3) return gate("count", "Contr.", "pass", `${count.toFixed(0)} swings`);
  if (count >= 2) return gate("count", "Contr.", "watch", `${count.toFixed(0)} swings`);
  return gate("count", "Contr.", "fail", `${count.toFixed(0)} swing`);
}

function volumeGate(pattern = {}) {
  const dry = finite(pattern.volumeDryUpRatio);
  if (!Number.isFinite(dry)) return gate("volume", "Vol.", "fail", "sin dato");
  if (dry <= 0.9) return gate("volume", "Vol.", "pass", ratio(dry));
  if (dry <= 1.15) return gate("volume", "Vol.", "watch", ratio(dry));
  return gate("volume", "Vol.", "fail", ratio(dry));
}

function pivotGate(pattern = {}) {
  const distance = finite(pattern.distanceToPivotPct);
  if (!Number.isFinite(distance)) return gate("pivot", "Pivot", "fail", "sin dato");
  if (distance >= -5 && distance <= 3) return gate("pivot", "Pivot", "pass", signedPct(distance));
  if (distance >= -10 && distance <= 3) return gate("pivot", "Pivot", "watch", signedPct(distance));
  return gate("pivot", "Pivot", "fail", signedPct(distance));
}

function contractionRows(pattern = {}) {
  const swings = Array.isArray(pattern.contractionSwings) ? pattern.contractionSwings : [];
  if (swings.length) return swings.slice(0, 4).map((swing, index) => ({
    index: index + 1,
    label: `C${index + 1}`,
    fromDate: swing.fromDate || "",
    toDate: swing.toDate || "",
    high: rounded(swing.high, 4),
    low: rounded(swing.low, 4),
    depthPct: rounded(swing.depthPct, 1),
    bars: finite(swing.bars),
  }));
  const depths = (Array.isArray(pattern.contractionDepths) && pattern.contractionDepths.length
    ? pattern.contractionDepths
    : [pattern.contraction1DepthPct, pattern.contraction2DepthPct, pattern.contraction3DepthPct, pattern.contraction4DepthPct])
    .map(finite)
    .filter(Number.isFinite)
    .slice(0, 4);
  return depths.map((depthPct, index) => ({
    index: index + 1,
    label: `C${index + 1}`,
    fromDate: "",
    toDate: "",
    high: null,
    low: null,
    depthPct: rounded(depthPct, 1),
    bars: null,
  }));
}

export function vcpObjectiveSummary(pattern = {}) {
  const contractions = contractionRows(pattern);
  const depths = contractions.map((item) => finite(item.depthPct)).filter(Number.isFinite);
  const count = finite(pattern.contractionCount) ?? depths.length;
  const countText = Number.isFinite(count) ? `${count.toFixed(0)} comp.` : "comp. s/d";
  const sequence = depths.length ? depths.map((value) => pct(value)).join(" -> ") : "sin compresiones";
  const last = contractions.at(-1) || null;
  const lastDepth = finite(last?.depthPct) ?? finite(pattern.lastContractionDepthPct);
  const lastText = Number.isFinite(lastDepth)
    ? `ultima ${pct(lastDepth)}${last?.toDate ? ` (${String(last.toDate).slice(0, 10)})` : ""}`
    : "ultima sin dato";
  const baseDepth = finite(pattern.baseDepthPct);
  const baseWeeks = finite(pattern.baseWeeks);
  const baseText = [
    Number.isFinite(baseDepth) ? `base ${pct(baseDepth)}` : "",
    Number.isFinite(baseWeeks) ? `${baseWeeks.toFixed(1)} sem` : "",
  ].filter(Boolean).join(" / ");
  const pivotText = `pivot ${signedPct(pattern.distanceToPivotPct)}`;
  const volumeText = `vol ${ratio(pattern.volumeDryUpRatio)}`;
  const rangeText = [
    Number.isFinite(finite(pattern.tightness10dPct)) ? `rango 10d ${pct(pattern.tightness10dPct)}` : "",
    Number.isFinite(finite(pattern.tightness20dPct)) ? `20d ${pct(pattern.tightness20dPct)}` : "",
  ].filter(Boolean).join(" / ");
  const structureStatus = String(pattern.contractionStructureStatus || "").trim();
  const structureText = structureStatus ? `secuencia ${statusLabel(structureStatus)}` : "";
  const contractionDetail = contractions.map((item) => {
    const prices = Number.isFinite(finite(item.high)) && Number.isFinite(finite(item.low))
      ? `H ${compactNumber(item.high, 2)} / L ${compactNumber(item.low, 2)}`
      : "";
    const bars = Number.isFinite(finite(item.bars)) ? `${Number(item.bars).toFixed(0)} barras` : "";
    return [item.label, dateRange(item), pct(item.depthPct), prices, bars].filter(Boolean).join(" · ");
  });
  const secondary = [lastText, baseText, pivotText, volumeText].filter(Boolean).join(" · ");
  const detail = [
    `${countText}: ${sequence}`,
    secondary,
    rangeText,
    structureText,
    contractionDetail.length ? `swings: ${contractionDetail.join(" | ")}` : "",
  ].filter(Boolean).join(" · ");
  return {
    count,
    countText,
    sequence,
    primary: `${countText} · ${sequence}`,
    secondary,
    detail,
    lastDepthPct: rounded(lastDepth, 1),
    baseDepthPct: rounded(baseDepth, 1),
    baseWeeks: rounded(baseWeeks, 1),
    pivotDistancePct: rounded(pattern.distanceToPivotPct, 1),
    volumeDryUpRatio: rounded(pattern.volumeDryUpRatio, 2),
    range10dPct: rounded(pattern.tightness10dPct, 1),
    range20dPct: rounded(pattern.tightness20dPct, 1),
    contractionDetail,
  };
}

export function vcpDiagnosticSnapshot(pattern = {}) {
  const display = methodologyDisplayForRow(pattern || {});
  const structureStatus = String(pattern.contractionStructureStatus || "");
  const contractions = contractionRows(pattern);
  const objective = vcpObjectiveSummary(pattern);
  return {
    key: display.key || "",
    state: display.state || "",
    label: display.label || "Sin diagnóstico",
    shortLabel: display.shortLabel || display.label || "Setup",
    tone: display.tone || "",
    reason: display.reason || "",
    evidence: display.evidence || "",
    line: display.line || "",
    planValid: display.actionable === true && display.tradePlanEligible === true && display.blocksPatternClaim !== true,
    watch: display.watch === true,
    strict: display.strict === true,
    pivot: {
      price: rounded(pattern.pivotPrice, 4),
      distancePct: rounded(pattern.distanceToPivotPct, 1),
      clarityScore: rounded(pattern.pivotClarityScore, 0),
      touchCount: finite(pattern.pivotTouchCount),
    },
    base: {
      depthPct: rounded(pattern.baseDepthPct, 1),
      weeks: rounded(pattern.baseWeeks, 1),
      contextScore: rounded(pattern.baseContextScore, 0),
      contextStatus: pattern.baseContextStatus || "",
    },
    volumeDryUpRatio: rounded(pattern.volumeDryUpRatio, 2),
    contractionCount: finite(pattern.contractionCount) ?? contractions.length,
    contractionsDecreasing: pattern.contractionsDecreasing === true,
    contractionStructureStatus: structureStatus,
    contractionStructureLabel: statusLabel(structureStatus),
    contractionStructureReason: pattern.contractionStructureReason || "",
    contractions,
    objective,
    gates: [
      dataGate(pattern),
      baseGate(pattern),
      sequenceGate(pattern),
      countGate(pattern),
      volumeGate(pattern),
      pivotGate(pattern),
    ],
  };
}

export function vcpContractionSummary(pattern = {}) {
  const depths = (Array.isArray(pattern.contractionDepths) ? pattern.contractionDepths : [])
    .map(finite)
    .filter(Number.isFinite);
  return depths.length ? depths.map((value) => pct(value)).join(" -> ") : "";
}
