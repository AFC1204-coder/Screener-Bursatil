import { isDecisionTraceVersionCurrent } from "@/lib/decisionTraceVersion";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { compactScreenerScoreAudit } from "@/lib/screenerScoreAudit";

const CONTRACTS = {
  long: {
    tone: "bullish",
    label: "Contrato largo",
    title: "Líderes con sesgo largo",
    text: "Resultados orientados a oportunidad larga: tendencia, momentum, fuerza relativa y cobertura deben sostener el filtro activo.",
    okText: "Coherencia larga activa: el modo actual no mezcla deterioro con listas de oportunidad.",
  },
  watch: {
    tone: "watch",
    label: "Vigilancia",
    title: "Candidato fuerte, timing pendiente",
    text: "Resultados para seguimiento: la acción puede ser fuerte, cercana a pivot, pullback, IPO o extendida; no implica plan automático.",
    okText: "Coherencia de vigilancia activa: el resultado queda separado de una lista de largos ejecutables.",
  },
  bearish: {
    tone: "bearish",
    label: "Deterioro",
    title: "Debilidad técnica",
    text: "Resultados defensivos o bajistas: este contrato no es una lista de largos y debe quedar separado de líderes.",
    okText: "Coherencia de deterioro activa: la salida queda etiquetada como debilidad, no como oportunidad larga.",
  },
  exploratory: {
    tone: "exploratory",
    label: "Exploratorio",
    title: "Diagnóstico amplio",
    text: "Resultados para exploración y auditoría: pueden aparecer estructuras mixtas; no deben leerse como estructura de ruptura confirmada, líderes o largos limpios.",
    okText: "Coherencia exploratoria activa: la salida queda marcada como diagnóstico, no como lista operativa.",
  },
};

const WATCH_MODES = new Set(["nearPivot", "pullback", "early", "ipoRecent", "extended"]);
const LAYER_LABELS = {
  trend: "Trend",
  momentum: "Momentum",
  relativeStrength: "RS",
  proximity: "Proximidad",
  coverage: "Cobertura",
  regime: "Régimen",
};

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function ratioLabel(active, total) {
  const activeNumber = finiteNumber(active);
  const totalNumber = finiteNumber(total);
  if (!Number.isFinite(activeNumber) || !Number.isFinite(totalNumber) || totalNumber <= 0) return "-";
  return `${Math.round(activeNumber)}/${Math.round(totalNumber)}`;
}

function countLabel(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) ? Math.round(number).toLocaleString("es-ES") : "-";
}

function cleanSymbol(value = "") {
  return String(value || "").trim().toUpperCase();
}

function contractStatValue(contract = {}, key = "") {
  return (contract.stats || []).find((stat) => stat.key === key)?.value || "";
}

function compactScore(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) ? String(Math.round(number)) : "-";
}

function compactText(value = "", limit = 120) {
  return String(value ?? "").trim().slice(0, limit);
}

function compactDecisionState(item = null) {
  if (!item || typeof item !== "object") return null;
  const key = compactText(item.key, 80);
  const label = compactText(item.label || item.key, 120);
  if (!key && !label) return null;
  return {
    key,
    label,
    tone: compactText(item.tone, 24),
    detail: compactText(item.detail, 180),
  };
}

function compactDecisionItem(item = null) {
  if (!item || typeof item !== "object") return null;
  const key = compactText(item.key || item.label, 80);
  const label = compactText(item.label || item.key, 120);
  if (!key && !label) return null;
  return {
    key: key || label,
    label: label || key,
    ...(item.value !== undefined && item.value !== null && item.value !== "" ? { value: compactText(item.value, 80) } : {}),
    ...(item.tone ? { tone: compactText(item.tone, 24) } : {}),
    ...(item.text ? { text: compactText(item.text, 180) } : {}),
    ...(item.detail ? { detail: compactText(item.detail, 180) } : {}),
    ...(item.severity ? { severity: compactText(item.severity, 24) } : {}),
  };
}

function compactDecisionList(items = [], limit = 5) {
  return Array.isArray(items) ? items.map(compactDecisionItem).filter(Boolean).slice(0, limit) : [];
}

function compactDecisionConfidence(confidence = null) {
  if (!confidence || typeof confidence !== "object") return null;
  const score = finiteNumber(confidence.score);
  const label = compactText(confidence.label, 80);
  if (!Number.isFinite(score) && !label) return null;
  return {
    key: compactText(confidence.key, 40),
    score: Number.isFinite(score) ? Math.round(score) : null,
    label,
    tone: compactText(confidence.tone, 24),
    detail: compactText(confidence.detail, 180),
    issueCount: finiteNumber(confidence.issueCount) ?? 0,
  };
}

function compactDecisionPriority(priority = null) {
  if (!priority || typeof priority !== "object") return null;
  const score = finiteNumber(priority.score);
  const components = Array.isArray(priority.components) ? priority.components.slice(0, 5).map((item) => {
    const value = finiteNumber(item?.value);
    const raw = finiteNumber(item?.raw);
    return {
      key: compactText(item?.key || item?.label, 80),
      label: compactText(item?.label || item?.key, 80),
      value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
      ...(Number.isFinite(raw) ? { raw: Number(raw.toFixed(2)) } : {}),
      ...(item?.detail ? { detail: compactText(item.detail, 120) } : {}),
      ...(item?.tone ? { tone: compactText(item.tone, 24) } : {}),
    };
  }).filter((item) => item.key || item.label) : [];
  const penalties = Array.isArray(priority.penalties) ? priority.penalties.slice(0, 6).map((item) => {
    const value = finiteNumber(item?.value);
    return {
      key: compactText(item?.key || item?.label, 80),
      label: compactText(item?.label || item?.key, 120),
      severity: compactText(item?.severity || "warn", 24),
      value: Number.isFinite(value) ? Number(value.toFixed(2)) : 0,
    };
  }).filter((item) => item.key || item.label) : [];
  if (!Number.isFinite(score) && !components.length && !penalties.length) return null;
  return {
    schemaVersion: finiteNumber(priority.schemaVersion) || 1,
    score: Number.isFinite(score) ? Number(score.toFixed(2)) : null,
    formula: compactText(priority.formula, 160),
    components,
    issuePenalty: Number(finiteNumber(priority.issuePenalty)?.toFixed(2) || 0),
    penalties,
  };
}

function compactDecisionProfile(profile = null) {
  if (!profile || typeof profile !== "object") return null;
  const key = compactText(profile.key, 80);
  const label = compactText(profile.label || profile.key, 120);
  if (!key && !label) return null;
  return {
    key,
    label,
    tone: compactText(profile.tone, 24),
    detail: compactText(profile.detail, 180),
  };
}

function compactDecisionBriefItem(item = null, fallbackLabel = "") {
  if (!item || typeof item !== "object") return null;
  const value = compactText(item.value || item.label || fallbackLabel, 120);
  if (!value) return null;
  return {
    label: compactText(item.label || fallbackLabel, 40),
    value,
    detail: compactText(item.detail, 220),
    tone: compactText(item.tone, 24),
  };
}

function compactDecisionBrief(brief = null) {
  if (!brief || typeof brief !== "object") return null;
  const thesis = compactDecisionBriefItem(brief.thesis, "Tesis");
  const risk = compactDecisionBriefItem(brief.risk, "Riesgo");
  const nextAction = compactDecisionBriefItem(brief.nextAction, "Siguiente");
  if (!thesis && !risk && !nextAction) return null;
  return {
    schemaVersion: finiteNumber(brief.schemaVersion) || 1,
    tone: compactText(brief.tone, 24),
    thesis,
    risk,
    nextAction,
  };
}

function compactDecisionEvidence(evidence = null) {
  if (!evidence || typeof evidence !== "object") return null;
  const compactEvidenceItem = (item = {}) => {
    const key = compactText(item.key || item.label, 80);
    const label = compactText(item.label || item.key, 120);
    if (!key && !label) return null;
    return {
      key: key || label,
      label: label || key,
      status: compactText(item.status, 40),
      statusLabel: compactText(item.statusLabel, 80),
      tone: compactText(item.tone, 24),
      detail: compactText(item.detail, 180),
    };
  };
  const items = Array.isArray(evidence.items) ? evidence.items.map(compactEvidenceItem).filter(Boolean).slice(0, 6) : [];
  const pending = Array.isArray(evidence.pending) ? evidence.pending.map(compactEvidenceItem).filter(Boolean).slice(0, 4) : [];
  if (!items.length && !pending.length && !evidence.summary) return null;
  return {
    schemaVersion: finiteNumber(evidence.schemaVersion) || 1,
    status: compactText(evidence.status, 40),
    tone: compactText(evidence.tone, 24),
    passedCount: finiteNumber(evidence.passedCount) ?? 0,
    totalCount: finiteNumber(evidence.totalCount) ?? items.length,
    summary: compactText(evidence.summary, 180),
    items,
    pending,
  };
}

function compactDecisionFocus(focus = null) {
  if (!focus || typeof focus !== "object") return null;
  const key = compactText(focus.key || focus.state || focus.label, 80);
  const label = compactText(focus.label || focus.stateLabel || focus.headline, 120);
  if (!key && !label) return null;
  const check = compactDecisionItem(focus.check);
  return {
    schemaVersion: finiteNumber(focus.schemaVersion) || 1,
    key: key || label,
    label: label || key,
    state: compactText(focus.state, 40),
    stateLabel: compactText(focus.stateLabel || label, 80),
    filterKey: compactText(focus.filterKey, 40),
    filterLabel: compactText(focus.filterLabel, 80),
    resolutionFilterKey: compactText(focus.resolutionFilterKey, 40),
    resolutionFilterLabel: compactText(focus.resolutionFilterLabel, 80),
    queueFilterLabel: compactText(focus.queueFilterLabel, 120),
    tone: compactText(focus.tone, 24),
    ratio: compactText(focus.ratio, 20),
    headline: compactText(focus.headline, 140),
    thesis: compactText(focus.thesis, 160),
    risk: compactText(focus.risk, 160),
    actionDetail: compactText(focus.actionDetail, 180),
    checkLine: compactText(focus.checkLine, 180),
    instruction: compactText(focus.instruction, 180),
    check,
  };
}

function compactReviewFocus(focus = null) {
  if (!focus || typeof focus !== "object") return null;
  const key = compactText(focus.key || focus.label, 80);
  const label = compactText(focus.label || focus.key, 120);
  if (!key && !label) return null;
  const detail = compactText(focus.detail || focus.summary || focus.note, 220);
  return {
    schemaVersion: finiteNumber(focus.schemaVersion) || 1,
    key: key || label,
    label: label || key,
    tone: compactText(focus.tone || "warn", 24),
    detail,
    source: compactText(focus.source, 80),
  };
}

function compactMethodologyFocus(focus = null) {
  if (!focus || typeof focus !== "object") return null;
  const key = compactText(focus.key || focus.label, 80);
  const label = compactText(focus.label || focus.key, 120);
  if (!key && !label) return null;
  return {
    key: key || label,
    label: label || key,
    shortLabel: compactText(focus.shortLabel || label || key, 120),
    status: compactText(focus.status, 40),
    tone: compactText(focus.tone, 24),
    detail: compactText(focus.detail, 180),
    requiresReview: focus.requiresReview === true,
  };
}

function compactDataHealth(health = null) {
  if (!health || typeof health !== "object") return null;
  const coverageScore = finiteNumber(health.coverageScore);
  const status = health.status && typeof health.status === "object"
    ? {
      key: compactText(health.status.key, 40),
      label: compactText(health.status.label || health.status.key, 80),
      tone: compactText(health.status.tone, 24),
      detail: compactText(health.status.detail, 180),
    }
    : null;
  const freshness = health.freshness && typeof health.freshness === "object"
    ? {
      label: compactText(health.freshness.label, 100),
      detail: compactText(health.freshness.detail, 100),
      days: finiteNumber(health.freshness.days),
      maxDays: finiteNumber(health.freshness.maxDays),
      ok: health.freshness.ok === true,
      stale: health.freshness.stale === true,
      tone: compactText(health.freshness.tone, 24),
    }
    : null;
  const provider = health.provider && typeof health.provider === "object"
    ? {
      label: compactText(health.provider.label, 100),
      tone: compactText(health.provider.tone, 24),
      detail: compactText(health.provider.detail, 160),
    }
    : null;
  const issues = Array.isArray(health.issues)
    ? health.issues
      .map(compactDecisionItem)
      .filter((item) => item?.key && item?.label)
      .slice(0, 5)
    : [];
  const topLine = compactText(health.topLine, 220);
  if (!status && !Number.isFinite(coverageScore) && !freshness && !provider && !issues.length && !topLine) return null;
  return {
    schemaVersion: finiteNumber(health.schemaVersion) || 1,
    status,
    coverageScore: Number.isFinite(coverageScore) ? Math.round(coverageScore) : null,
    freshness,
    provider,
    issues,
    topLine,
  };
}

function compactScoreAudit(audit = null) {
  return compactScreenerScoreAudit(audit);
}

function compactMetricTruth(source = null) {
  const status = source?.audit !== undefined && source?.key && source?.label
    ? source
    : objectiveMetricAuditStatusForRow(source || {});
  if (!status || typeof status !== "object") return null;
  const audit = status.audit || null;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const usable = items.filter((item) => item?.status === "verified" || item?.status === "traceable");
  const proxyCount = usable.filter((item) => item?.proxy === true).length;
  const measuredCount = usable.filter((item) => item?.proxy !== true).length;
  const issues = Array.isArray(audit?.issues)
    ? audit.issues
      .map(compactDecisionItem)
      .filter((item) => item?.key && item?.label)
      .slice(0, 5)
    : [];
  const baseKey = compactText(status.key || "missing", 40);
  const blocked = baseKey === "bad";
  const review = baseKey === "warn";
  const missing = baseKey === "missing";
  const mixed = !blocked && !review && !missing && proxyCount > 0;
  const label = blocked
    ? "Métricas bloqueadas"
    : review
      ? "Métricas a revisar"
      : missing
        ? "Métricas sin auditoría"
        : mixed
          ? "Métricas mixtas"
          : "Métricas medidas";
  const shortLabel = blocked ? "Bloq." : review ? "Rev." : missing ? "Sin audit" : mixed ? "Mixto" : "Med.";
  const detail = [
    status.detail,
    measuredCount ? `${measuredCount} medidas` : "",
    proxyCount ? `${proxyCount} proxy/estimadas` : "",
    issues.length ? issues.map((item) => item.label).slice(0, 3).join(" · ") : "",
  ].filter(Boolean).join(" · ");
  return {
    schemaVersion: 1,
    key: blocked ? "blocked" : review ? "review" : missing ? "missing" : mixed ? "mixed" : "measured",
    sourceKey: baseKey,
    label,
    shortLabel,
    tone: blocked ? "bad" : review || missing ? "warn" : mixed ? "neutral" : compactText(status.tone || "good", 24),
    detail: compactText(detail, 260),
    measuredCount,
    proxyCount,
    checkedCount: finiteNumber(audit?.checkedCount) ?? items.length,
    verifiedCount: finiteNumber(audit?.verifiedCount) ?? 0,
    traceableCount: finiteNumber(audit?.traceableCount) ?? 0,
    issueCount: issues.length,
    issues,
  };
}

const METRIC_AUDIT_CONTEXT_KEYS = new Set([
  "totalScore",
  "objectiveScore",
  "compositeScore",
  "rsGlobalPct",
  "rsRating",
  "rsCountryPct",
  "rsSectorPct",
  "rsQualityScore",
  "adProxyScore",
  "epsGrowthProxyScore",
  "perf3m",
  "perf6m",
  "perf12m",
  "extSma50",
  "relativeVolume",
  "volumeSurgePct",
  "volatility63d",
  "maxDrawdown63d",
  "shortPercentOfFloat",
  "distance52w",
]);

function compactMetricAuditItems(source = null) {
  const audit = objectiveMetricAuditStatusForRow(source || {})?.audit;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  return items
    .filter((item) => item?.key && METRIC_AUDIT_CONTEXT_KEYS.has(item.key))
    .slice(0, 32)
    .map((item) => {
      const value = finiteNumber(item.value);
      const expected = finiteNumber(item.expected);
      return {
        key: compactText(item.key, 80),
        label: compactText(item.label || item.key, 120),
        ...(Number.isFinite(value) ? { value: Number(value.toFixed(4)) } : {}),
        ...(Number.isFinite(expected) ? { expected: Number(expected.toFixed(4)) } : {}),
        status: compactText(item.status, 40),
        severity: compactText(item.severity, 20),
        proxy: item.proxy === true,
        source: compactText(item.source, 80),
        formula: compactText(item.formula, 160),
      };
    });
}

function compactDecisionTrace(trace = null) {
  if (!trace || typeof trace !== "object") return null;
  if (!isDecisionTraceVersionCurrent(trace)) return null;
  const priorityScore = finiteNumber(trace.priorityScore);
  const priority = compactDecisionPriority(trace.priority);
  const confidence = compactDecisionConfidence(trace.confidence);
  const action = compactDecisionState(trace.action);
  const readiness = compactDecisionState(trace.readiness);
  const brief = compactDecisionBrief(trace.brief);
  const evidence = compactDecisionEvidence(trace.evidence);
  const issues = compactDecisionList(trace.issues, 8);
  const drivers = compactDecisionList(trace.drivers, 5);
  const watch = compactDecisionList(trace.watch, 5);
  const line = compactText(trace.line, 360);
  if (!Number.isFinite(priorityScore) && !priority && !confidence && !action && !readiness && !brief && !evidence && !issues.length && !drivers.length && !watch.length && !line) return null;
  return {
    schemaVersion: finiteNumber(trace.schemaVersion) || 1,
    engineVersion: compactText(trace.engineVersion, 80),
    priorityScore: Number.isFinite(priorityScore) ? Number(priorityScore.toFixed(2)) : null,
    priority,
    confidence,
    action,
    readiness,
    brief,
    evidence,
    issues,
    drivers,
    watch,
    line,
  };
}

function layerWarnings(filterLayers = {}, required = []) {
  const hasLayerShape = filterLayers && Object.keys(filterLayers).length > 0;
  if (!hasLayerShape) return [];
  return required
    .filter((key) => filterLayers[key] === false)
    .map((key) => LAYER_LABELS[key] || key);
}

function sampleStats(diagnostics = null, analyzedCount = 0) {
  const analyzed = finiteNumber(diagnostics?.analyzed) ?? finiteNumber(analyzedCount) ?? 0;
  const universe = finiteNumber(diagnostics?.universeTotal) ?? analyzed;
  const sampleRate = universe > 0 ? (analyzed / universe) * 100 : null;
  return { analyzed, universe, sampleRate };
}

export function screenerContractKeyForSettings(settings = {}, presetKey = "") {
  const mode = String(settings?.setupMode || "").trim();
  const preset = String(presetKey || "").trim();
  if (mode === "weakness" || preset === "weakness") return "bearish";
  if (mode === "any" || preset === "broad") return "exploratory";
  if (WATCH_MODES.has(mode)) return "watch";
  return "long";
}

export function isScreenerLongContract(settings = {}, presetKey = "") {
  return screenerContractKeyForSettings(settings, presetKey) === "long";
}

export function buildScreenerContract({
  settings = {},
  presetKey = "balanced",
  presetName = "Filtro",
  setupName = "Exploratorio",
  filterLayers = {},
  useRegimeFilter = true,
  executionRuleActive = null,
  executionRuleTotal = null,
  fineRuleActive = null,
  fineRuleTotal = null,
  rowsCount = 0,
  filteredCount = 0,
  analyzedCount = 0,
  diagnostics = null,
  pendingCount = 0,
  hiddenByView = 0,
  viewFiltersActive = 0,
} = {}) {
  const key = screenerContractKeyForSettings(settings, presetKey);
  const base = CONTRACTS[key] || CONTRACTS.exploratory;
  const warnings = [];
  const requiredLayers = key === "long"
    ? ["trend", "momentum", "relativeStrength", "coverage"]
    : key === "watch"
      ? ["momentum", "proximity", "coverage"]
      : [];
  const missingLayers = layerWarnings(filterLayers, requiredLayers);
  if (missingLayers.length) {
    warnings.push({
      key: "layers",
      text: `${base.label} degradado: ${missingLayers.join(", ")} off.`,
    });
  }
  if ((key === "long" || key === "watch") && useRegimeFilter === false) {
    warnings.push({ key: "regime", text: "Régimen off: los resultados no se adaptan a salud de mercado." });
  }
  if (finiteNumber(pendingCount) > 0) {
    warnings.push({ key: "pending", text: `${countLabel(pendingCount)} resultados pendientes sin mostrar.` });
  }
  if (finiteNumber(hiddenByView) > 0) {
    warnings.push({ key: "view", text: `${countLabel(hiddenByView)} acciones ocultas por filtros de vista.` });
  }
  const { analyzed, universe, sampleRate } = sampleStats(diagnostics, analyzedCount);
  if (Number.isFinite(sampleRate) && universe > analyzed && sampleRate < 25) {
    warnings.push({ key: "sample", text: `Muestra parcial: ${countLabel(analyzed)} de ${countLabel(universe)} acciones analizadas.` });
  }

  const stats = [
    { key: "preset", label: "base", value: presetName },
    { key: "setup", label: "modo", value: setupName },
    { key: "rules", label: "reglas", value: ratioLabel(executionRuleActive, executionRuleTotal) },
    { key: "fine", label: "finas", value: ratioLabel(fineRuleActive, fineRuleTotal) },
    { key: "results", label: "visibles", value: hiddenByView > 0 ? `${countLabel(filteredCount)}/${countLabel(rowsCount)}` : countLabel(filteredCount) },
    { key: "scope", label: "muestra", value: universe > analyzed ? `${countLabel(analyzed)}/${countLabel(universe)}` : countLabel(analyzed) },
    { key: "view", label: "vista", value: viewFiltersActive > 0 ? `${countLabel(viewFiltersActive)} activo` : "limpia" },
    { key: "regime", label: "régimen", value: useRegimeFilter ? "on" : "off" },
  ];

  return {
    ...base,
    key,
    presetKey,
    mode: settings?.setupMode || "leader",
    presetName,
    setupName,
    warnings,
    stats,
    sampleRate,
  };
}

export function buildScreenerStockContext(contract = null, {
  symbol = "",
  row = null,
  rank = null,
  queueSize = null,
  sourceLabel = "Screener",
  sourceDetail = "",
  queueMode = "",
  openedAt = "",
  action = null,
  readiness = null,
  decisionIssues = [],
  decisionEvidence = null,
  decisionTrace = null,
  decisionBrief = null,
  decisionProfile = null,
  decisionFocus = null,
  reviewFocus = null,
  methodologyFocus = null,
  dataHealth = null,
  metricTruth = null,
  scoreAudit = null,
} = {}) {
  if (!contract) return null;
  const warnings = Array.isArray(contract.warnings) ? contract.warnings.slice(0, 3) : [];
  const trace = compactDecisionTrace(decisionTrace || row?.decisionTrace);
  const brief = compactDecisionBrief(decisionBrief || trace?.brief || row?.decisionBrief);
  const sourceIssues = Array.isArray(decisionIssues) && decisionIssues.length ? decisionIssues : (trace?.issues || []);
  const issues = sourceIssues
    .map(compactDecisionItem)
    .filter((issue) => issue?.key && issue?.label)
    .slice(0, 6)
    .map((issue) => ({
      key: issue.key,
      label: issue.label,
      severity: issue.severity || "warn",
      detail: issue.detail || "",
    }));
  const resolvedAction = compactDecisionState(action || trace?.action);
  const resolvedReadiness = compactDecisionState(readiness || trace?.readiness);
  const resolvedProfile = compactDecisionProfile(decisionProfile || row?.decisionProfile);
  const resolvedFocus = compactDecisionFocus(decisionFocus || row?.decisionFocus);
  const resolvedReviewFocus = compactReviewFocus(reviewFocus || row?.reviewFocus);
  const resolvedMethodologyFocus = compactMethodologyFocus(methodologyFocus || row?.methodologyFocus);
  const resolvedEvidence = compactDecisionEvidence(decisionEvidence || trace?.evidence || row?.decisionEvidence);
  const resolvedDataHealth = compactDataHealth(dataHealth || row?.dataHealth);
  const resolvedMetricTruth = compactMetricTruth(metricTruth || row?.metricTruth || row);
  const resolvedMetricAuditItems = compactMetricAuditItems(row);
  const resolvedScoreAudit = compactScoreAudit(scoreAudit || row?.scoreAudit || row);
  const severeIssue = issues.some((issue) => issue.severity === "bad");
  const blockedData = resolvedDataHealth?.status?.tone === "bad";
  const statusText = warnings.length
    ? warnings.map((warning) => warning.text).join(" ")
    : resolvedReadiness?.detail
      ? `${resolvedReadiness.label}: ${resolvedReadiness.detail}`
      : (contract.okText || contract.text || "");
  const resolvedSymbol = cleanSymbol(symbol || row?.symbol);
  const score = finiteNumber(row?.objectiveScore ?? row?.totalScore ?? row?.compositeScore);
  const rs = finiteNumber(row?.rsGlobalPct);
  const weakness = finiteNumber(row?.weaknessScore);
  return {
    source: "screener",
    sourceLabel,
    sourceDetail: String(sourceDetail || "").trim(),
    queueMode: String(queueMode || "").trim(),
    symbol: resolvedSymbol,
    openedAt: openedAt || new Date().toISOString(),
    key: contract.key || "exploratory",
    tone: contract.tone || "exploratory",
    label: contract.label || "Screener",
    title: contract.title || "Contexto Screener",
    text: contract.text || "",
    okText: contract.okText || "",
    statusText,
    statusTone: warnings.length ? "warn" : (severeIssue || blockedData) ? "bad" : (resolvedReadiness?.tone || "ok"),
    presetName: contract.presetName || contractStatValue(contract, "preset") || "Filtro",
    setupName: contract.setupName || contractStatValue(contract, "setup") || "Modo",
    mode: contract.mode || "",
    rank: finiteNumber(rank),
    queueSize: finiteNumber(queueSize),
    row: {
      score: compactScore(score),
      rs: compactScore(rs),
      weakness: compactScore(weakness),
    },
    action: resolvedAction,
    readiness: resolvedReadiness,
    decisionProfile: resolvedProfile,
    decisionIssues: issues,
    decisionTrace: trace,
    decisionBrief: brief,
    decisionFocus: resolvedFocus,
    reviewFocus: resolvedReviewFocus,
    methodologyFocus: resolvedMethodologyFocus,
    decisionEvidence: resolvedEvidence,
    dataHealth: resolvedDataHealth,
    metricTruth: resolvedMetricTruth,
    metricAuditItems: resolvedMetricAuditItems,
    scoreAudit: resolvedScoreAudit,
    warnings,
  };
}

export function screenerStockContextFromSession(session = {}, symbol = "", { now = Date.now(), maxAgeMs = 12 * 60 * 60 * 1000 } = {}) {
  const context = session?.lastOpenedStockContext;
  if (!context) return null;
  const targetSymbol = cleanSymbol(symbol);
  const contextSymbol = cleanSymbol(context.symbol || session.lastOpenedStockSymbol);
  if (!targetSymbol || !contextSymbol || targetSymbol !== contextSymbol) return null;
  const openedAt = context.openedAt || session.lastOpenedStockAt || "";
  const openedTs = Date.parse(openedAt);
  if (Number.isFinite(maxAgeMs) && maxAgeMs > 0 && Number.isFinite(openedTs) && Number.isFinite(now) && now - openedTs > maxAgeMs) return null;
  return { ...context, openedAt };
}
