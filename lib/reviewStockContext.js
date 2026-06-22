import { auditDecisionRowIssues, decisionTraceForRow } from "@/lib/decisionAudit";
import { decisionProfileStateForStock } from "@/lib/decisionProfile";
import { objectiveMetricAuditStatusForRow } from "@/lib/objectiveMetricTruth";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildScreenerScoreAudit } from "@/lib/screenerScoreAudit";
import { buildDecisionBrief, buildDecisionQueueDigest, DECISION_QUEUE_DIGEST_FILTERS, explainScreenerRank } from "@/lib/screenerExplainability";
import { buildScreenerContract, buildScreenerStockContext } from "@/lib/screenerContracts";
import { stockDecisionResolutionFilter } from "@/lib/stockDecisionResolution";
import { vcpReliabilityAudit } from "@/lib/vcpDiagnostics";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function setupName(settings = {}) {
  const mode = String(settings?.setupMode || settings?.mode || "").trim();
  return mode || "Review";
}

function contractPresetKey(source = "", settings = {}) {
  if (source === "favorites") return "broad";
  if (settings?.setupMode === "weakness") return "weakness";
  return "";
}

function digestFilterMeta(key = "all") {
  return DECISION_QUEUE_DIGEST_FILTERS.find((item) => item.key === key) || DECISION_QUEUE_DIGEST_FILTERS[0];
}

function resolutionFilterMeta(key = "all") {
  return stockDecisionResolutionFilter(key || "all");
}

function focusInstruction(state = "") {
  if (state === "ready") return "Confirmar entrada, pivot, stop y volumen antes de resolver.";
  if (state === "blocked") return "Resolver bloqueo antes de marcarla como candidata.";
  return "Validar las pruebas pendientes que impiden una entrada limpia.";
}

function metricTruthKey(row = {}) {
  const status = objectiveMetricAuditStatusForRow(row);
  const audit = status.audit || null;
  const items = Array.isArray(audit?.items) ? audit.items : [];
  const proxyCount = items.filter((item) => ["verified", "traceable"].includes(item?.status) && item?.proxy === true).length;
  if (status.key === "bad") return { key: "blocked", label: "Metr.", tone: "bad", detail: status.detail || "Métricas bloqueadas." };
  if (status.key === "warn") return { key: "review", label: "Metr.", tone: "warn", detail: status.detail || "Métricas a validar." };
  if (status.key === "missing") return { key: "missing", label: "Metr.", tone: "warn", detail: status.detail || "Métricas sin auditoría." };
  if (proxyCount > 0) return { key: "mixed", label: "Metr.", tone: "neutral", detail: `${proxyCount} proxy/estimadas` };
  return { key: "measured", label: "Metr.", tone: "good", detail: status.detail || "Métricas medidas." };
}

function scoreAuditKey(audit = null) {
  const residualWarn = Number.isFinite(audit?.residual) && Math.abs(audit.residual) >= 4;
  const missing = Array.isArray(audit?.missing) && audit.missing.length;
  if (residualWarn) return "mismatch";
  if (missing) return "missing";
  if (audit?.integrityTone === "good") return "clean";
  return "attention";
}

function buildRowReviewFocus(row = {}, { dataHealth = null, metricTruth = null, scoreAudit = null, evidence = null, methodologyFocus = null, issues = [] } = {}) {
  const candidates = [];
  const add = (item) => { if (item?.key && item?.label) candidates.push(item); };
  const dataKey = dataHealth?.status?.key || "";
  if (dataKey === "blocked") add({ priority: 100, key: "data", label: "Datos", tone: "bad", detail: dataHealth.status?.detail || dataHealth.topLine || "Datos bloqueados." });
  if (metricTruth?.key === "blocked") add({ priority: 95, key: "metrics", label: "Metr.", tone: "bad", detail: metricTruth.detail });
  const scoreKey = scoreAuditKey(scoreAudit);
  if (scoreKey === "mismatch") add({ priority: 86, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Score descuadrado." });
  if (["review", "missing"].includes(metricTruth?.key)) add({ priority: 82, key: "metrics", label: "Metr.", tone: "warn", detail: metricTruth.detail });
  const vcp = vcpReliabilityAudit(row);
  if (["blocked", "inconsistent", "needs-data"].includes(vcp?.key)) add({ priority: vcp.key === "blocked" ? 80 : 70, key: "vcp", label: "VCP", tone: vcp.tone || "warn", detail: vcp.summary || vcp.note || "VCP a validar." });
  if (dataKey && dataKey !== "ready") add({ priority: 72, key: "data", label: "Datos", tone: dataHealth?.status?.tone || "warn", detail: dataHealth?.status?.detail || dataHealth?.topLine || "Datos a revisar." });
  if (scoreKey === "missing") add({ priority: 70, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Componentes incompletos." });
  if (evidence?.status === "blocked") add({ priority: 68, key: "evidence", label: "Pruebas", tone: "bad", detail: evidence.summary || "Pruebas bloqueadas." });
  if (methodologyFocus?.tone === "bad" || methodologyFocus?.tone === "warn") add({ priority: methodologyFocus.tone === "bad" ? 66 : 54, key: "method", label: "Método", tone: methodologyFocus.tone, detail: methodologyFocus.detail || methodologyFocus.label });
  if (evidence?.status === "needs-work") add({ priority: 62, key: "evidence", label: "Pruebas", tone: evidence.tone || "warn", detail: evidence.pending?.[0]?.detail || evidence.pending?.[0]?.label || evidence.summary || "Pruebas pendientes." });
  const issue = Array.isArray(issues) ? issues[0] : null;
  if (issue?.key || issue?.label) add({ priority: issue.severity === "bad" ? 60 : 46, key: "issue", label: issue.label || issue.key, tone: issue.severity || "warn", detail: issue.detail || issue.label || "Revisar incidencia." });
  if (scoreKey === "attention") add({ priority: 50, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Score a revisar." });
  const focus = candidates.sort((a, b) => b.priority - a.priority)[0] || null;
  return focus ? { schemaVersion: 1, ...focus, source: "review-row" } : null;
}

function buildReviewDecisionFocus(row = {}, explanation = {}, digestFilter = "all", resolutionFilter = "all") {
  const digest = buildDecisionQueueDigest(row, explanation);
  const filter = digestFilterMeta(digestFilter);
  const resolution = resolutionFilterMeta(resolutionFilter);
  const queueFilterLabel = [
    resolution.key !== "all" ? resolution.label : "",
    filter.key !== "all" ? filter.label : "",
  ].filter(Boolean).join(" · ");
  const check = digest.checks?.[0] || null;
  return {
    schemaVersion: 1,
    key: check?.key || digest.state || "decision-focus",
    label: check?.label || digest.headline || digest.stateLabel,
    state: digest.state,
    stateLabel: digest.stateLabel,
    filterKey: filter.key,
    filterLabel: filter.label,
    resolutionFilterKey: resolution.key,
    resolutionFilterLabel: resolution.label,
    queueFilterLabel,
    tone: check?.tone || digest.tone,
    ratio: digest.ratio,
    headline: digest.headline,
    thesis: digest.thesis,
    risk: digest.risk,
    actionDetail: digest.actionDetail,
    checkLine: digest.checkLine,
    instruction: focusInstruction(digest.state),
    methodologyFocus: digest.methodologyFocus || null,
    check,
  };
}

export function buildReviewStockOpenContext(row = null, {
  settings = {},
  source = "current",
  sourceLabel = "Revision",
  sourceDetail = "",
  queueMode = "",
  digestFilter = "all",
  resolutionFilter = "all",
  rank = null,
  queueSize = null,
  rowsCount = 0,
  visibleCount = null,
  hiddenCount = 0,
  openedAt = "",
} = {}) {
  if (!row?.symbol) return null;
  const explanation = explainScreenerRank(row, settings);
  const decisionIssues = auditDecisionRowIssues(row, explanation);
  const decisionTrace = decisionTraceForRow(row, explanation);
  const decisionBrief = decisionTrace?.brief || buildDecisionBrief(row, explanation);
  const decisionFocus = buildReviewDecisionFocus(row, explanation, digestFilter, resolutionFilter);
  const dataHealth = buildScreenerDataHealth(row, settings);
  const scoreAudit = buildScreenerScoreAudit(row);
  const reviewFocus = buildRowReviewFocus(row, {
    dataHealth,
    metricTruth: metricTruthKey(row),
    scoreAudit,
    evidence: decisionTrace?.evidence,
    methodologyFocus: decisionFocus?.methodologyFocus,
    issues: decisionIssues,
  });
  const filteredCount = finite(visibleCount) ?? finite(queueSize) ?? finite(rowsCount) ?? 0;
  const contract = buildScreenerContract({
    settings,
    presetKey: contractPresetKey(source, settings),
    presetName: sourceLabel,
    setupName: setupName(settings),
    rowsCount: finite(rowsCount) ?? filteredCount,
    filteredCount,
    analyzedCount: finite(rowsCount) ?? filteredCount,
    hiddenByView: finite(hiddenCount) ?? 0,
    viewFiltersActive: finite(hiddenCount) ? 1 : 0,
  });
  return buildScreenerStockContext(contract, {
    symbol: row.symbol,
    row,
    rank,
    queueSize,
    sourceLabel: `Review · ${sourceLabel}`,
    sourceDetail,
    queueMode,
    openedAt,
    action: explanation.action,
    readiness: explanation.readiness,
    decisionProfile: decisionProfileStateForStock(row, explanation),
    decisionIssues,
    decisionTrace,
    decisionBrief,
    decisionFocus,
    reviewFocus,
    methodologyFocus: decisionFocus?.methodologyFocus,
    dataHealth,
    scoreAudit,
  });
}
