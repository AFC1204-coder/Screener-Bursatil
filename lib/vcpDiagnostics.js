import { methodologyDisplayForRow } from "@/lib/methodologyDisplay";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const n = Number(normalized);
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

function dataStatusLabel(status = "") {
  switch (String(status || "").trim()) {
    case "ok":
      return "Datos técnicos OK";
    case "partial_volume":
      return "Volumen parcial";
    case "insufficient_history":
      return "Histórico insuficiente";
    case "missing_latest_date":
      return "Fecha no disponible";
    case "stale_price":
      return "Precio no reciente";
    case "sparse_ohlc":
      return "OHLC incompleto";
    case "missing_volume":
      return "Volumen no fiable";
    default:
      return "Datos sin validar";
  }
}

function whole(value) {
  const n = finite(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function coverageFromPattern(pattern = {}) {
  const bars = whole(pattern.patternBarsCount) ?? whole(pattern.chartBarsCount) ?? whole(pattern.barsCount);
  const minBars = whole(pattern.patternMinBars) ?? (String(pattern.patternDataStatus || "") === "insufficient_history" ? 90 : null);
  const coveragePct = Number.isFinite(finite(pattern.patternCoveragePct))
    ? rounded(pattern.patternCoveragePct, 0)
    : Number.isFinite(bars) && Number.isFinite(minBars) && minBars > 0
      ? rounded(Math.min(100, (bars / minBars) * 100), 0)
      : null;
  const status = String(pattern.patternDataStatus || "").trim();
  const blockedStatuses = new Set(["insufficient_history", "missing_latest_date", "stale_price", "sparse_ohlc"]);
  const blocked = pattern.patternEligible === false || blockedStatuses.has(status);
  const value = Number.isFinite(bars) && Number.isFinite(minBars)
    ? `Hist. ${bars}/${minBars} barras`
    : Number.isFinite(bars)
      ? `Hist. ${bars} barras`
      : "";
  const detailParts = [
    dataStatusLabel(status),
    Number.isFinite(coveragePct) ? `cobertura ${coveragePct.toFixed(0)}%` : "",
    Number.isFinite(finite(pattern.patternFreshnessDays)) ? `edad ${Number(pattern.patternFreshnessDays).toFixed(0)}d` : "",
    Number.isFinite(finite(pattern.patternOhlcCoveragePct)) ? `OHLC ${Number(pattern.patternOhlcCoveragePct).toFixed(0)}%` : "",
    Number.isFinite(finite(pattern.patternVolumeCoveragePct)) ? `vol ${Number(pattern.patternVolumeCoveragePct).toFixed(0)}%` : "",
  ].filter(Boolean);
  return {
    bars,
    minBars,
    coveragePct,
    status,
    statusLabel: dataStatusLabel(status),
    blocked,
    state: blocked ? "fail" : status === "partial_volume" || status === "missing_volume" ? "watch" : "pass",
    value,
    detail: detailParts.join(" · "),
  };
}

function gate(key, label, state = "neutral", detail = "") {
  return { key, label, state, detail, mark: gateMark(state) };
}

export function gateMark(state = "") {
  if (state === "watch" || state === "warn") return "!";
  if (state === "fail") return "x";
  return "";
}

function dataGate(pattern = {}) {
  const status = String(pattern.patternDataStatus || "").trim();
  const coverage = coverageFromPattern(pattern);
  if (pattern.patternEligible === false) return gate("data", "Datos", "fail", coverage.detail || coverage.statusLabel || "bloqueado");
  if (status === "partial_volume" || status === "missing_volume") return gate("data", "Datos", "watch", coverage.detail || "volumen parcial");
  if (!status || status === "ok") return gate("data", "Datos", "pass", coverage.value || "OK");
  return gate("data", "Datos", "watch", coverage.detail || coverage.statusLabel);
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
  const rows = contractionRows(pattern);
  const count = rows.length || finite(pattern.contractionCount) || 0;
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

const INVALID_SEQUENCE_STATUSES = new Set(["pivot_noise", "ceiling_break", "lower_low_drift", "depth_reexpansion"]);

function rawContractionRows(pattern = {}) {
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

function inferredRejectedIndex(rows = [], pattern = {}) {
  const depths = rows.map((item) => finite(item.depthPct));
  const status = String(pattern.contractionStructureStatus || "").trim();
  if (!depths.length) return -1;
  if (status === "depth_reexpansion" || pattern.contractionsDecreasing === false) {
    for (let index = 1; index < depths.length; index++) {
      const current = depths[index];
      const previous = depths[index - 1];
      if (!Number.isFinite(current) || !Number.isFinite(previous)) continue;
      const usefulReduction = current <= previous * 0.98 || current <= previous - 0.5;
      if (!usefulReduction) return index;
    }
  }
  if (INVALID_SEQUENCE_STATUSES.has(status) && depths.length > 1) return depths.length - 1;
  return -1;
}

function rejectedContractionRow(pattern = {}, acceptedCount = 0, rawRows = rawContractionRows(pattern)) {
  const swing = pattern.rejectedContractionSwing;
  if (swing && typeof swing === "object") {
    return {
      index: acceptedCount + 1,
      label: `C${acceptedCount + 1} rechazada`,
      fromDate: swing.fromDate || "",
      toDate: swing.toDate || "",
      high: rounded(swing.high, 4),
      low: rounded(swing.low, 4),
      depthPct: rounded(swing.depthPct, 1),
      bars: finite(swing.bars),
    };
  }
  const depth = finite(pattern.rejectedContractionDepthPct);
  if (Number.isFinite(depth)) {
    return {
      index: acceptedCount + 1,
      label: `C${acceptedCount + 1} rechazada`,
      fromDate: "",
      toDate: "",
      high: null,
      low: null,
      depthPct: rounded(depth, 1),
      bars: null,
    };
  }
  const index = inferredRejectedIndex(rawRows, pattern);
  if (index < 0) return null;
  const row = rawRows[index];
  return row ? { ...row, label: `${row.label} rechazada` } : null;
}

function contractionRows(pattern = {}) {
  const rawRows = rawContractionRows(pattern);
  if (pattern.rejectedContractionSwing || Number.isFinite(finite(pattern.rejectedContractionDepthPct))) return rawRows;
  const rejectedIndex = inferredRejectedIndex(rawRows, pattern);
  return rejectedIndex >= 0 ? rawRows.slice(0, rejectedIndex) : rawRows;
}

function auditComponent(key, label, state = "watch", detail = "") {
  return { key, label, state, detail };
}

function componentValue(state = "") {
  if (state === "pass") return 1;
  if (state === "watch") return 0.5;
  return 0;
}

function componentScore(components = [], weights = {}) {
  const total = components.reduce((sum, item) => sum + (weights[item.key] ?? 1), 0);
  if (!total) return 0;
  const value = components.reduce((sum, item) => sum + componentValue(item.state) * (weights[item.key] ?? 1), 0);
  return Math.round((value / total) * 100);
}

function claimLevel(display = {}) {
  const planValid = display.actionable === true && display.tradePlanEligible === true && display.blocksPatternClaim !== true;
  if (planValid) return "plan";
  if (display.watch === true || display.strict === true) return "watch";
  if (display.observable === true) return "observe";
  return "block";
}

function formulaDepthChecks(pattern = {}) {
  return contractionRows(pattern).map((item) => {
    const high = finite(item.high);
    const low = finite(item.low);
    const actual = finite(item.depthPct);
    const expected = Number.isFinite(high) && Number.isFinite(low) && high > 0 ? ((high - low) / high) * 100 : null;
    const error = Number.isFinite(expected) && Number.isFinite(actual) ? Math.abs(expected - actual) : null;
    const formulaReady = Number.isFinite(expected) && Number.isFinite(actual);
    const summaryOnly = Number.isFinite(actual) && !formulaReady;
    return {
      label: item.label || "",
      high: rounded(high, 4),
      low: rounded(low, 4),
      expected: rounded(expected, 4),
      actual: rounded(actual, 4),
      error: rounded(error, 4),
      formulaReady,
      summaryOnly,
      ok: formulaReady ? error <= 0.08 : summaryOnly,
    };
  });
}

function componentSummary(components = []) {
  const failed = components.filter((item) => item.state === "fail").map((item) => item.label);
  const watch = components.filter((item) => item.state === "watch").map((item) => item.label);
  if (failed.length) return `Bloquea: ${failed.join(", ")}`;
  if (watch.length) return `Validar: ${watch.join(", ")}`;
  return "Evidencia VCP auditable";
}

export function vcpReliabilityAudit(pattern = {}, displayArg = null) {
  const display = displayArg || methodologyDisplayForRow(pattern || {});
  const history = coverageFromPattern(pattern);
  const contractions = contractionRows(pattern);
  const depths = contractions.map((item) => finite(item.depthPct)).filter(Number.isFinite);
  const count = depths.length ? depths.length : finite(pattern.contractionCount);
  const structureStatus = String(pattern.contractionStructureStatus || "").trim();
  const dataStatus = String(pattern.patternDataStatus || "").trim();
  const level = claimLevel(display);
  const planValid = level === "plan";
  const blockedByDisplay = display.blocksPatternClaim === true || display.dataLimited === true;
  const depthChecks = formulaDepthChecks(pattern);
  const formulaReadyCount = depthChecks.filter((item) => item.formulaReady).length;
  const formulaMismatch = depthChecks.some((item) => item.formulaReady && item.ok !== true);
  const summaryOnly = depthChecks.length > 0 && formulaReadyCount < depthChecks.length && !formulaMismatch;
  const invalidStructure = INVALID_SEQUENCE_STATUSES.has(structureStatus);
  const hardDataBlocked = history.blocked || structureStatus === "data_blocked";

  const components = [];
  components.push(auditComponent(
    "data",
    "Datos",
    hardDataBlocked ? "fail" : dataStatus === "partial_volume" || dataStatus === "missing_volume" || !dataStatus && !Number.isFinite(history.bars) ? "watch" : "pass",
    hardDataBlocked ? history.detail || history.statusLabel : history.detail || history.value || "Datos técnicos OK"
  ));

  components.push(auditComponent(
    "math",
    "Profundidades",
    !depthChecks.length ? (Number.isFinite(count) && count === 0 ? "pass" : "watch") : formulaMismatch ? "fail" : summaryOnly ? "watch" : "pass",
    !depthChecks.length
      ? "Sin contracciones aceptadas"
      : formulaMismatch
        ? "Profundidad no cuadra con high/low"
        : summaryOnly
          ? "Solo profundidades persistidas, sin high/low para recomputar"
          : "Profundidades recomputables desde high/low"
  ));

  components.push(auditComponent(
    "sequence",
    "Secuencia",
    structureStatus === "ok"
      ? Number.isFinite(count) && count >= 2
        ? pattern.contractionsDecreasing === true ? "pass" : "fail"
        : "watch"
      : invalidStructure || ["not_consolidating", "no_meaningful_contractions", "data_blocked"].includes(structureStatus) ? "fail" : "watch",
    structureStatus === "ok"
      ? Number.isFinite(count) && count >= 2
        ? pattern.contractionsDecreasing === true ? `${count.toFixed(0)} contracciones decrecientes` : "contracciones no decrecientes"
        : `${Number.isFinite(count) ? count.toFixed(0) : 0} contracciones`
      : statusLabel(structureStatus)
  ));

  const pivotDistance = finite(pattern.distanceToPivotPct);
  const volumeDryUp = finite(pattern.volumeDryUpRatio);
  const pivotOk = Number.isFinite(pivotDistance) && pivotDistance >= -5 && pivotDistance <= 3;
  const pivotWatch = Number.isFinite(pivotDistance) && pivotDistance >= -10 && pivotDistance <= 3;
  const volumeOk = Number.isFinite(volumeDryUp) && volumeDryUp <= (planValid ? 0.9 : 1.15);
  components.push(auditComponent(
    "context",
    "Pivot/volumen",
    planValid
      ? pivotOk && volumeOk ? "pass" : "fail"
      : pivotWatch || volumeOk ? "pass" : Number.isFinite(pivotDistance) || Number.isFinite(volumeDryUp) ? "watch" : "fail",
    [`pivot ${signedPct(pivotDistance)}`, `vol ${ratio(volumeDryUp)}`].join(" · ")
  ));

  components.push(auditComponent(
    "claim",
    "Veredicto",
    blockedByDisplay && level !== "block" ? "fail" : "pass",
    blockedByDisplay ? display.reason || "veredicto bloqueado por datos/contexto" : display.label || "veredicto explícito"
  ));

  const contradictions = [];
  if (formulaMismatch) contradictions.push("profundidades no reconciliadas");
  if (level !== "block" && hardDataBlocked) contradictions.push("claim VCP con datos bloqueados");
  if (level !== "block" && invalidStructure) contradictions.push(`claim VCP con secuencia ${statusLabel(structureStatus)}`);
  if (planValid && summaryOnly) contradictions.push("plan VCP sin high/low para recomputar profundidades");
  if (planValid && (dataStatus === "partial_volume" || dataStatus === "missing_volume" || pattern.patternVolumeEligible === false)) contradictions.push("plan VCP con volumen parcial");
  if (planValid && (!pivotOk || !volumeOk)) contradictions.push("plan VCP sin pivot/volumen estrictos");

  let auditabilityPct = componentScore(components, { data: 1.25, math: 1.5, sequence: 1.5, context: 1, claim: 1 });
  if (contradictions.length) auditabilityPct = Math.min(auditabilityPct, 35);
  else if (hardDataBlocked) auditabilityPct = Math.min(auditabilityPct, 50);
  else if (summaryOnly) auditabilityPct = Math.min(auditabilityPct, 78);

  const hasPatternClaim = ["plan", "watch", "observe"].includes(level);
  let key = "blocked";
  let label = "VCP bloqueado";
  let tone = "neutral";
  if (contradictions.length) {
    key = "inconsistent";
    label = "VCP inconsistente";
    tone = "bad";
  } else if (hardDataBlocked) {
    key = "needs-data";
    label = "Validar datos VCP";
    tone = "warn";
  } else if (summaryOnly) {
    key = "summary-only";
    label = "VCP resumen";
    tone = "warn";
  } else if (hasPatternClaim) {
    key = auditabilityPct >= 85 ? "audit-ready" : "needs-validation";
    label = auditabilityPct >= 85 ? "VCP auditable" : "Validar VCP";
    tone = auditabilityPct >= 85 ? "good" : "warn";
  } else if (auditabilityPct < 65) {
    key = "needs-validation";
    label = "Validar VCP";
    tone = "warn";
  }

  return {
    key,
    label,
    tone,
    claimLevel: level,
    patternClaimReliable: hasPatternClaim && key === "audit-ready",
    auditabilityPct,
    confidence: auditabilityPct >= 85 ? "alta" : auditabilityPct >= 65 ? "media" : "baja",
    summary: componentSummary(components),
    contradictions,
    components,
    depthChecks,
    acceptedContractions: Number.isFinite(count) ? count : null,
    sequence: depths.length ? depths.map((value) => pct(value)).join(" -> ") : "",
    note: "Auditabilidad interna del patrón; no es probabilidad de acierto ni recomendación.",
  };
}

export function vcpObjectiveSummary(pattern = {}) {
  const rawRows = rawContractionRows(pattern);
  const contractions = contractionRows(pattern);
  const depths = contractions.map((item) => finite(item.depthPct)).filter(Number.isFinite);
  const rejected = rejectedContractionRow(pattern, depths.length, rawRows);
  const count = depths.length ? depths.length : finite(pattern.contractionCount);
  const countText = Number.isFinite(count) ? `${count.toFixed(0)} comp.` : "comp. s/d";
  const sequence = depths.length ? depths.map((value) => pct(value)).join(" -> ") : "sin compresiones";
  const history = coverageFromPattern(pattern);
  const dataBlocked = history.blocked || String(pattern.contractionStructureStatus || "") === "data_blocked";
  const last = contractions.at(-1) || null;
  const lastDepth = finite(last?.depthPct) ?? finite(pattern.lastContractionDepthPct);
  const lastText = Number.isFinite(lastDepth)
    ? `última ${pct(lastDepth)}${last?.toDate ? ` (${String(last.toDate).slice(0, 10)})` : ""}`
    : "última sin dato";
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
  const rejectedText = rejected && Number.isFinite(finite(rejected.depthPct)) ? `${rejected.label}: ${pct(rejected.depthPct)}` : "";
  const contractionDetail = contractions.map((item) => {
    const prices = Number.isFinite(finite(item.high)) && Number.isFinite(finite(item.low))
      ? `H ${compactNumber(item.high, 2)} / L ${compactNumber(item.low, 2)}`
      : "";
    const bars = Number.isFinite(finite(item.bars)) ? `${Number(item.bars).toFixed(0)} barras` : "";
    return [item.label, dateRange(item), pct(item.depthPct), prices, bars].filter(Boolean).join(" · ");
  });
  const secondary = dataBlocked
    ? [history.statusLabel, history.value].filter(Boolean).join(" · ")
    : [lastText, rejectedText, baseText, pivotText, volumeText].filter(Boolean).join(" · ");
  const primary = dataBlocked
    ? `${history.status === "insufficient_history" && history.value ? history.value : history.statusLabel} · comp. s/d`
    : `${countText} · ${sequence}`;
  const detail = [
    history.detail ? `datos: ${history.detail}` : "",
    `${countText}: ${sequence}`,
    secondary,
    rangeText,
    structureText,
    contractionDetail.length ? `swings: ${contractionDetail.join(" | ")}` : "",
    rejectedText,
  ].filter(Boolean).join(" · ");
  return {
    count,
    countText,
    sequence,
    primary,
    secondary,
    detail,
    history,
    lastDepthPct: rounded(lastDepth, 1),
    baseDepthPct: rounded(baseDepth, 1),
    baseWeeks: rounded(baseWeeks, 1),
    pivotDistancePct: rounded(pattern.distanceToPivotPct, 1),
    volumeDryUpRatio: rounded(pattern.volumeDryUpRatio, 2),
    range10dPct: rounded(pattern.tightness10dPct, 1),
    range20dPct: rounded(pattern.tightness20dPct, 1),
    contractionDetail,
    rejectedContraction: rejected,
    rejectedContractionText: rejectedText,
  };
}

export function vcpDiagnosticSnapshot(pattern = {}) {
  const display = methodologyDisplayForRow(pattern || {});
  const structureStatus = String(pattern.contractionStructureStatus || "");
  const contractions = contractionRows(pattern);
  const objective = vcpObjectiveSummary(pattern);
  const reliability = vcpReliabilityAudit(pattern, display);
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
    contractionCount: finite(objective.count) ?? contractions.length,
    contractionsDecreasing: pattern.contractionsDecreasing === true,
    contractionStructureStatus: structureStatus,
    contractionStructureLabel: statusLabel(structureStatus),
    contractionStructureReason: pattern.contractionStructureReason || "",
    contractions,
    objective,
    reliability,
    history: objective.history,
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
  const depths = contractionRows(pattern).map((item) => finite(item.depthPct))
    .filter(Number.isFinite);
  return depths.length ? depths.map((value) => pct(value)).join(" -> ") : "";
}
