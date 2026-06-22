import { auditDecisionRowIssues, decisionConfidenceSummary } from "@/lib/decisionAudit";
import { buildScreenerDataHealth } from "@/lib/screenerDataHealth";
import { buildDecisionEvidenceChecklist, explainScreenerRank } from "@/lib/screenerExplainability";
import { scoreAuditStatusForRow } from "@/lib/screenerScoreAudit";

const RELIABILITY_FILTERS = [
  { key: "reliable", label: "Alta fiabilidad", shortLabel: "Fiable", tone: "good" },
  { key: "reviewable", label: "Revisables sin bloqueo", shortLabel: "Revisables", tone: "neutral" },
  { key: "needs-validation", label: "Validar primero", shortLabel: "Validar", tone: "warn" },
  { key: "blocked", label: "Bloqueadas", shortLabel: "Bloq.", tone: "bad" },
];

export const RELIABILITY_FILTER_ALL = "all";
export const RELIABILITY_FILTER_ORDER = RELIABILITY_FILTERS.map((item) => item.key);

const RELIABILITY_LABELS = new Map(RELIABILITY_FILTERS.map((item) => [item.key, item]));

function reason(key, label, detail = "", tone = "neutral") {
  return { key, label, detail, tone };
}

function hasIssueSeverity(issues = [], severity = "bad") {
  return issues.some((item) => item?.severity === severity);
}

function methodologyWarnings(evidence = {}) {
  return (evidence.items || [])
    .filter((item) => item?.status === "confirmed" && item?.critical !== false && item?.tone === "warn")
    .map((item) => reason(`methodology-${item.methodologyKey || item.key}`, item.label, item.detail, "warn"));
}

function scoreAuditKey(status = {}) {
  if (status.missing) return "missing";
  if (status.mismatch) return "mismatch";
  if (status.clean) return "clean";
  return "attention";
}

function pctLabel(count = 0, total = 0) {
  if (!total) return "0%";
  const value = (count / total) * 100;
  return `${value >= 10 || count === total ? value.toFixed(0) : value.toFixed(1)}%`;
}

const TONE_RANK = { bad: 4, warn: 3, neutral: 2, good: 1, muted: 0 };

function strongestTone(a = "neutral", b = "neutral") {
  return (TONE_RANK[b] || 0) > (TONE_RANK[a] || 0) ? b : a;
}

function toneSummary(toneCounts = {}) {
  return ["bad", "warn", "neutral", "good", "muted"]
    .map((tone) => [tone, Number(toneCounts[tone] || 0)])
    .filter(([, count]) => count > 0)
    .map(([tone, count]) => `${count} ${tone}`)
    .join(" · ");
}

function incrementBucket(map, item = {}, extra = {}) {
  const key = item.methodologyKey || item.key || item.label;
  if (!key) return;
  const itemTone = item.tone || extra.tone || "neutral";
  const bucket = map.get(key) || {
    key,
    label: item.label || key,
    count: 0,
    tone: itemTone,
    toneCounts: {},
    ...extra,
  };
  bucket.count += 1;
  bucket.tone = strongestTone(bucket.tone, itemTone);
  bucket.toneCounts[itemTone] = (bucket.toneCounts[itemTone] || 0) + 1;
  map.set(key, bucket);
}

function summaryRows(map = new Map(), total = 0) {
  return [...map.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .map((item) => ({ ...item, toneSummary: toneSummary(item.toneCounts), share: pctLabel(item.count, total) }));
}

function scoreAuditMissingLabels(status = {}) {
  const audit = status.audit || {};
  const missing = Array.isArray(audit.missing) ? audit.missing : [];
  const labels = missing.map((item) => item.label || item.key).filter(Boolean);
  const displayed = audit.displayedScore;
  if (displayed === null || displayed === undefined || displayed === "" || !Number.isFinite(Number(displayed))) labels.unshift("Score mostrado");
  return [...new Set(labels)];
}

export function screenerReliabilityFilterLabel(key = RELIABILITY_FILTER_ALL, { compact = false } = {}) {
  if (!key || key === RELIABILITY_FILTER_ALL) return "Todas";
  const item = RELIABILITY_LABELS.get(key);
  if (!item) return key;
  return compact ? item.shortLabel : item.label;
}

export function auditRestoredScanRow(row = {}, settingsOrExplanation = {}) {
  const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
  const dataHealth = buildScreenerDataHealth(row, settingsOrExplanation || {});
  const evidence = buildDecisionEvidenceChecklist(row, explanation);
  const scoreAudit = scoreAuditStatusForRow(row);
  const scoreMissing = scoreAuditMissingLabels(scoreAudit);
  const blockers = [];
  const limitations = [];

  if (row.decisionProjectionPartial === true) {
    blockers.push(reason("projection-partial", "Snapshot parcial", Array.isArray(row.decisionProjectionMissing) ? row.decisionProjectionMissing.join(", ") : "faltan campos críticos", "bad"));
  }
  if (scoreMissing.length) {
    limitations.push(reason("score-missing", "Score incompleto", `faltan ${scoreMissing.slice(0, 5).join(", ")}`, "warn"));
  }
  if (scoreAudit.mismatch) {
    limitations.push(reason("score-mismatch", "Score descuadrado", Number.isFinite(scoreAudit.audit?.residual) ? `Δ ${scoreAudit.audit.residual}` : "residual relevante", "warn"));
  }
  if (dataHealth.status?.key === "blocked") {
    limitations.push(reason("data-blocked", "Datos bloqueados", dataHealth.status?.detail || dataHealth.topLine, "bad"));
  }
  if (evidence.status === "blocked") {
    limitations.push(reason("evidence-blocked", "Pruebas bloqueadas", evidence.summary, "bad"));
  }
  if (dataHealth.status?.key === "unknown") {
    limitations.push(reason("data-unknown", "Salud de datos sin auditoría", dataHealth.status?.detail || "", "warn"));
  }

  const scoreTraceable = scoreAudit.clean && !scoreAudit.missing && !scoreAudit.mismatch && scoreMissing.length === 0;
  const snapshotReady = row.decisionProjectionPartial !== true && scoreTraceable;
  const key = blockers.length ? "blocked" : limitations.length ? "data-limited" : "audit-ready";
  const tone = key === "audit-ready" ? "good" : key === "blocked" ? "bad" : "warn";
  return {
    schemaVersion: 1,
    key,
    label: key === "audit-ready" ? "Auditable" : key === "blocked" ? "Bloqueada" : "Datos limitados",
    tone,
    snapshotReady,
    scoreTraceable,
    scoreMissing,
    dataHealthKey: dataHealth.status?.key || "unknown",
    evidenceKey: evidence.status || "needs-work",
    blockers,
    limitations,
    reasons: blockers.length ? blockers : limitations,
  };
}

export function buildScreenerReliability(row = {}, settingsOrExplanation = {}) {
  const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
    ? settingsOrExplanation
    : explainScreenerRank(row, settingsOrExplanation || {});
  const dataHealth = buildScreenerDataHealth(row, settingsOrExplanation || {});
  const evidence = buildDecisionEvidenceChecklist(row, explanation);
  const scoreAudit = scoreAuditStatusForRow(row);
  const restoredAudit = auditRestoredScanRow(row, explanation);
  const issues = auditDecisionRowIssues(row, explanation);
  const confidence = decisionConfidenceSummary(row, explanation, issues);
  const methodWarnings = methodologyWarnings(evidence);

  const dataKey = dataHealth.status?.key || "unknown";
  const evidenceKey = evidence.status || "needs-work";
  const scoreKey = scoreAuditKey(scoreAudit);
  const blocked = dataKey === "blocked" || evidenceKey === "blocked";
  const scoreTraceable = restoredAudit.scoreTraceable;
  const observationReady = ["ready", "partial"].includes(dataKey)
    && ["ready", "needs-work"].includes(evidenceKey)
    && scoreTraceable
    && confidence.key !== "very-low"
    && !blocked
    && restoredAudit.key === "audit-ready";
  const reliable = observationReady
    && dataKey === "ready"
    && evidenceKey === "ready"
    && ["high", "medium"].includes(confidence.key)
    && !hasIssueSeverity(issues, "bad")
    && methodWarnings.length === 0;
  const needsValidation = !blocked && !reliable && (
    dataKey !== "ready"
    || evidenceKey !== "ready"
    || scoreKey !== "clean"
    || restoredAudit.key !== "audit-ready"
    || confidence.key === "low"
    || confidence.key === "very-low"
    || hasIssueSeverity(issues, "warn")
    || hasIssueSeverity(issues, "bad")
    || methodWarnings.length > 0
  );
  const key = blocked ? "blocked" : reliable ? "reliable" : needsValidation ? "needs-validation" : "reviewable";
  const meta = RELIABILITY_LABELS.get(key) || RELIABILITY_LABELS.get("needs-validation");
  const reasons = [];

  if (blocked) {
    if (dataKey === "blocked") reasons.push(reason("data-blocked", "Datos bloqueados", dataHealth.status?.detail || dataHealth.topLine, "bad"));
    if (evidenceKey === "blocked") reasons.push(reason("evidence-blocked", "Pruebas bloqueadas", evidence.summary, "bad"));
  } else {
    if (restoredAudit.key !== "audit-ready") {
      reasons.push(reason("auditability", restoredAudit.label, restoredAudit.reasons.map((item) => item.detail || item.label).filter(Boolean).slice(0, 2).join(" · "), restoredAudit.tone));
    }
    if (dataKey !== "ready") reasons.push(reason("data-health", dataHealth.status?.label || "Datos", dataHealth.status?.detail || dataHealth.topLine, dataHealth.status?.tone || "warn"));
    if (evidenceKey !== "ready") reasons.push(reason("evidence", "Pruebas pendientes", evidence.summary, evidence.tone || "warn"));
    if (scoreKey !== "clean") reasons.push(reason("score", "Score a validar", restoredAudit.scoreMissing.length ? `faltan ${restoredAudit.scoreMissing.slice(0, 4).join(", ")}` : scoreKey, "warn"));
    if (confidence.key === "low" || confidence.key === "very-low") reasons.push(reason("confidence", `Confianza ${confidence.label}`, confidence.detail, confidence.tone || "warn"));
    for (const warning of methodWarnings.slice(0, 3)) {
      reasons.push(warning);
    }
    for (const issue of issues.slice(0, 3)) {
      reasons.push(reason(`issue-${issue.key}`, issue.label, issue.detail, issue.severity === "bad" ? "bad" : "warn"));
    }
  }

  if (!reasons.length) {
    reasons.push(reason("clear", reliable ? "Observación limpia" : "Sin bloqueos", reliable
      ? "Datos, score y pruebas alineados; sigue siendo una observación, no una decisión automática."
      : "La fila es legible para revisión manual.", reliable ? "good" : "neutral"));
  }

  return {
    schemaVersion: 1,
    key,
    label: meta.label,
    shortLabel: meta.shortLabel,
    tone: meta.tone,
    reliable,
    reviewable: observationReady || reliable,
    needsValidation,
    blocked,
    confidenceKey: confidence.key,
    dataHealthKey: dataKey,
    evidenceKey,
    scoreAuditKey: scoreKey,
    auditabilityKey: restoredAudit.key,
    methodologyWarningKeys: methodWarnings.map((item) => item.key),
    reasons,
  };
}

export function screenerReliabilityMatchesFilter(row = {}, filter = RELIABILITY_FILTER_ALL, settingsOrExplanation = {}) {
  if (!filter || filter === RELIABILITY_FILTER_ALL) return true;
  const state = buildScreenerReliability(row, settingsOrExplanation);
  if (filter === "reliable") return state.reliable;
  if (filter === "reviewable") return state.reviewable;
  if (filter === "needs-validation") return state.needsValidation;
  if (filter === "blocked") return state.blocked;
  return true;
}

export function buildScreenerReliabilitySummary(rows = [], settingsOrExplanation = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const counts = new Map(RELIABILITY_FILTER_ORDER.map((key) => [key, 0]));
  for (const row of list) {
    const state = buildScreenerReliability(row, settingsOrExplanation);
    if (state.reliable) counts.set("reliable", (counts.get("reliable") || 0) + 1);
    if (state.reviewable) counts.set("reviewable", (counts.get("reviewable") || 0) + 1);
    if (state.needsValidation) counts.set("needs-validation", (counts.get("needs-validation") || 0) + 1);
    if (state.blocked) counts.set("blocked", (counts.get("blocked") || 0) + 1);
  }
  return {
    schemaVersion: 1,
    rows: list.length,
    counts: Object.fromEntries(counts.entries()),
    items: RELIABILITY_FILTER_ORDER.map((key) => ({
      key,
      label: screenerReliabilityFilterLabel(key),
      shortLabel: screenerReliabilityFilterLabel(key, { compact: true }),
      count: counts.get(key) || 0,
      tone: RELIABILITY_LABELS.get(key)?.tone || "neutral",
    })).filter((item) => item.count > 0),
  };
}

export function buildScreenerAuditabilitySummary(rows = [], settingsOrExplanation = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const counts = {
    snapshotReady: 0,
    scoreTraceable: 0,
    evidenceReady: 0,
    dataReady: 0,
    confidenceReady: 0,
    fullyAuditable: 0,
    dataLimited: 0,
    blocked: 0,
    manualReviewRequired: 0,
  };
  const topIssues = new Map();
  const methodologyPending = new Map();
  const methodologyLimitations = new Map();
  const methodologyReviewFocus = new Map();

  for (const row of list) {
    const explanation = settingsOrExplanation?.action && settingsOrExplanation?.readiness
      ? settingsOrExplanation
      : explainScreenerRank(row, settingsOrExplanation || {});
    const evidence = buildDecisionEvidenceChecklist(row, explanation);
    const auditability = auditRestoredScanRow(row, explanation);
    const reliability = buildScreenerReliability(row, explanation);
    const confidenceReady = ["high", "medium"].includes(reliability.confidenceKey);
    const dataReady = reliability.dataHealthKey === "ready";
    const evidenceReady = reliability.evidenceKey === "ready";

    if (auditability.snapshotReady) counts.snapshotReady += 1;
    if (auditability.key === "data-limited") counts.dataLimited += 1;
    if (auditability.key === "blocked") counts.blocked += 1;
    if (auditability.scoreTraceable) counts.scoreTraceable += 1;
    if (evidenceReady) counts.evidenceReady += 1;
    if (dataReady) counts.dataReady += 1;
    if (confidenceReady) counts.confidenceReady += 1;
    if (auditability.snapshotReady && auditability.scoreTraceable && evidenceReady && dataReady && confidenceReady) counts.fullyAuditable += 1;
    if (evidence.manualReviewRequired) counts.manualReviewRequired += 1;

    for (const item of evidence.pending || []) {
      incrementBucket(methodologyPending, item, { status: item.status || "needed", tone: item.tone || "warn" });
    }
    for (const item of evidence.reviewFocus || []) {
      if (!item.requiresReview) continue;
      incrementBucket(methodologyReviewFocus, item, {
        status: item.status || "needed",
        tone: item.tone || "warn",
        action: item.action || "",
      });
    }
    for (const item of evidence.items || []) {
      if (item.status !== "confirmed" || !["warn", "neutral"].includes(item.tone)) continue;
      incrementBucket(methodologyLimitations, item, { tone: item.tone || "neutral" });
    }

    for (const item of [...(auditability.reasons || []), ...(reliability.reasons || [])].slice(0, 4)) {
      const key = item.key || item.label;
      if (!key) continue;
      const bucket = topIssues.get(key) || { key, label: item.label || key, tone: item.tone || "warn", count: 0 };
      bucket.count += 1;
      topIssues.set(key, bucket);
    }
  }

  const auditabilityShare = pctLabel(counts.fullyAuditable, total);
  const snapshotIntegrity = pctLabel(counts.snapshotReady, total);
  const verdict = !total
    ? { key: "empty", label: "Sin resultados", tone: "muted", detail: "Ejecuta un scan para medir auditabilidad." }
    : counts.fullyAuditable === total
      ? { key: "complete", label: "Auditabilidad 100%", tone: "good", detail: "Todas las filas visibles son trazables; no es probabilidad de acierto." }
      : counts.snapshotReady < total
        ? { key: "contract", label: "Contrato incompleto", tone: "warn", detail: `${total - counts.snapshotReady} filas no tienen snapshot auditable completo.` }
        : { key: "method", label: "Validar método", tone: "warn", detail: `${total - counts.fullyAuditable} filas requieren criterio antes de confiar.` };

  return {
    schemaVersion: 1,
    rows: total,
    counts,
    auditabilityShare,
    snapshotIntegrity,
    verdict,
    items: [
      { key: "snapshot", label: "Snapshot íntegro", count: counts.snapshotReady, share: snapshotIntegrity, tone: counts.snapshotReady === total ? "good" : "warn" },
      { key: "score", label: "Score trazable", count: counts.scoreTraceable, share: pctLabel(counts.scoreTraceable, total), tone: counts.scoreTraceable === total ? "good" : "warn" },
      { key: "evidence", label: "Pruebas listas", count: counts.evidenceReady, share: pctLabel(counts.evidenceReady, total), tone: counts.evidenceReady === total ? "good" : "warn" },
      { key: "confidence", label: "Confianza suficiente", count: counts.confidenceReady, share: pctLabel(counts.confidenceReady, total), tone: counts.confidenceReady === total ? "good" : "warn" },
    ],
    topIssues: [...topIssues.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, 5)
      .map((item) => ({ ...item, share: pctLabel(item.count, total) })),
    methodologyPending: summaryRows(methodologyPending, total),
    methodologyReviewFocus: summaryRows(methodologyReviewFocus, total),
    methodologyLimitations: summaryRows(methodologyLimitations, total),
  };
}
