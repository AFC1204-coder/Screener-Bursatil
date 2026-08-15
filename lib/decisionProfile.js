import { auditDecisionRowIssues, decisionConfidenceSummary, decisionPriorityBreakdown } from "@/lib/decisionAudit";
import { explainScreenerRank } from "@/lib/screenerExplainability";

export const DECISION_PROFILE_META = {
  "operable-clean": "Operable limpio",
  "operable-fragile": "Operable frágil",
  other: "Resto",
};

export const DECISION_PROFILE_ORDER = ["operable-clean", "operable-fragile"];

const REVIEW_PROFILE_META = [
  { key: "operable-clean", label: "Limpios", tone: "good", rank: 0 },
  { key: "operable-fragile", label: "Frágiles", tone: "warn", rank: 1 },
  { key: "other", label: "Resto", tone: "neutral", rank: 2 },
];

const REVIEW_PRIORITY_META = [
  { key: "focus-now", label: "Alta prioridad", shortLabel: "Alta", tone: "good", rank: 0 },
  { key: "validate-first", label: "Validar primero", shortLabel: "Validar", tone: "warn", rank: 1 },
  { key: "blocked", label: "Bloqueadas", shortLabel: "Auditar", tone: "bad", rank: 2 },
  { key: "watch-next", label: "Vigilancia", shortLabel: "Vigilar", tone: "neutral", rank: 3 },
];

function resolveExplanation(row = {}, settingsOrExplanation = {}) {
  return settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
}

function rowSymbol(rowOrItem = {}) {
  return String(rowOrItem.symbol || rowOrItem.row?.symbol || "").toUpperCase();
}

function priorityReason(key, explanation = {}, confidence = {}, issues = [], priority = {}) {
  const primaryIssue = issues[0];
  if (key === "focus-now") return `Decidir primero · ${confidence.label || "confianza alta"} · prioridad ${Math.round(priority.score || 0)}`;
  if (key === "validate-first") return primaryIssue
    ? `Validar antes: ${primaryIssue.label}`
    : `Operable con ${String(confidence.label || "confianza").toLowerCase()}`;
  if (key === "blocked") return primaryIssue
    ? `Auditar antes: ${primaryIssue.label}`
    : (explanation.readiness?.detail || explanation.action?.detail || "Bloqueada para decisión");
  return explanation.readiness?.detail || explanation.action?.detail || "Esperar confirmación";
}

export function decisionProfileLabel(key, fallback = key) {
  return DECISION_PROFILE_META[key] || fallback;
}

export function decisionProfileForRow(row = {}, settingsOrExplanation = {}) {
  if (row?.__screenerAnnotation?.profile && (!settingsOrExplanation || (settingsOrExplanation?.action && settingsOrExplanation?.readiness))) {
    return row.__screenerAnnotation.profile;
  }
  const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
  if (explanation.readiness?.key !== "operable") return "other";
  const issues = auditDecisionRowIssues(row, explanation);
  const confidence = decisionConfidenceSummary(row, explanation, issues);
  return confidence.key !== "high" || issues.some((issue) => issue.key === "minimum-confluence")
    ? "operable-fragile"
    : "operable-clean";
}

export function reviewProfileMeta(key = "other") {
  return REVIEW_PROFILE_META.find((item) => item.key === key) || REVIEW_PROFILE_META[REVIEW_PROFILE_META.length - 1];
}

export function reviewPriorityMeta(key = "watch-next") {
  return REVIEW_PRIORITY_META.find((item) => item.key === key) || REVIEW_PRIORITY_META[REVIEW_PRIORITY_META.length - 1];
}

export function reviewPriorityForRow(row = {}, settingsOrExplanation = {}) {
  if (!row) return null;
  const explanation = resolveExplanation(row, settingsOrExplanation);
  const issues = auditDecisionRowIssues(row, explanation);
  const confidence = decisionConfidenceSummary(row, explanation, issues);
  const priority = decisionPriorityBreakdown(row, explanation);
  const readinessKey = explanation.readiness?.key || "";
  const actionKey = explanation.action?.key || "";
  const severeIssue = issues.some((issue) => issue.severity === "bad");
  const issuePenalty = Number(priority.issuePenalty || 0);
  let key = "watch-next";

  if (["audit", "reject", "bearish"].includes(readinessKey) || actionKey === "check-data" || (severeIssue && readinessKey !== "operable")) {
    key = "blocked";
  } else if (readinessKey === "operable" && confidence.key === "high" && issuePenalty <= 75) {
    key = "focus-now";
  } else if (readinessKey === "operable") {
    key = "validate-first";
  }

  const meta = reviewPriorityMeta(key);
  return {
    schemaVersion: 1,
    key,
    label: meta.label,
    shortLabel: meta.shortLabel,
    tone: meta.tone,
    rank: meta.rank,
    score: Number.isFinite(priority.score) ? priority.score : 0,
    confidence,
    priority,
    issueCount: issues.length,
    primaryIssue: issues[0] || null,
    readinessKey,
    actionKey,
    reason: priorityReason(key, explanation, confidence, issues, priority),
    detail: [
      explanation.readiness?.label || "",
      explanation.action?.label || "",
      confidence.label ? `confianza ${confidence.label.toLowerCase()}` : "",
    ].filter(Boolean).join(" · "),
  };
}

export function decisionProfileStateForStock(row = null, settingsOrExplanation = {}) {
  if (!row) return null;
  const key = decisionProfileForRow(row, settingsOrExplanation);
  if (!key || key === "other") return null;
  const profile = reviewProfileMeta(key);
  return {
    key,
    label: decisionProfileLabel(key),
    tone: profile.tone || "",
    detail: key === "operable-fragile"
      ? "Operable, pero con confianza limitada o confluencia mínima."
      : "Operable con confianza alta y confluencia suficiente.",
  };
}

// La cola de revisión conserva el ORDEN DE LLEGADA: la lista visible que el
// usuario tenía delante (con SU ordenación) o, para colas sin tabla de origen
// (snapshot, favoritos), el orden propio de esa fuente. Antes esta función
// reordenaba por la prioridad interna del sistema (REVIEW_PRIORITY_RANK) y la
// cola abría por el valor que el sistema priorizaba, no por el que el usuario
// miraba — "si se ordena por él y se destaca el primero, el producto está
// señalando" (principio 1, docs/principios-producto.md). reviewPriorityForRow
// sigue calculándose para resúmenes y facetas; ya no manda sobre el orden.
export function prepareReviewQueueRows(rows = []) {
  return (Array.isArray(rows) ? rows : []).filter(Boolean);
}

export function buildReviewProfileSummary(rowsOrItems = [], settingsOrExplanation = {}) {
  const groups = REVIEW_PROFILE_META.map((meta) => ({ ...meta, count: 0, firstIndex: -1, sampleSymbols: [] }));
  const groupMap = new Map(groups.map((group) => [group.key, group]));
  (Array.isArray(rowsOrItems) ? rowsOrItems : []).filter(Boolean).forEach((item, index) => {
    const key = item.profileKey || decisionProfileForRow(item, settingsOrExplanation);
    const group = groupMap.get(key) || groupMap.get("other");
    group.count += 1;
    if (group.firstIndex < 0) group.firstIndex = index;
    const symbol = item.symbol || item.row?.symbol;
    if (symbol && group.sampleSymbols.length < 3) group.sampleSymbols.push(symbol);
  });
  return groups.filter((group) => group.count > 0);
}

export function buildReviewPrioritySummary(rowsOrItems = [], settingsOrExplanation = {}) {
  const groups = REVIEW_PRIORITY_META.map((meta) => ({
    ...meta,
    count: 0,
    firstIndex: -1,
    sampleSymbols: [],
    topScore: null,
    topSymbol: "",
  }));
  const groupMap = new Map(groups.map((group) => [group.key, group]));
  (Array.isArray(rowsOrItems) ? rowsOrItems : []).filter(Boolean).forEach((item, index) => {
    const row = item.row || item;
    const priority = item.reviewPriority || reviewPriorityForRow(row, settingsOrExplanation);
    const group = groupMap.get(priority?.key) || groupMap.get("watch-next");
    group.count += 1;
    if (group.firstIndex < 0) group.firstIndex = index;
    const symbol = rowSymbol(item) || rowSymbol(row);
    if (symbol && group.sampleSymbols.length < 3) group.sampleSymbols.push(symbol);
    if (priority && (group.topScore == null || priority.score > group.topScore)) {
      group.topScore = priority.score;
      group.topSymbol = symbol;
    }
  });
  return groups.filter((group) => group.count > 0);
}
