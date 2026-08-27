// lib/screenerResultView.js — helpers puros de la vista de resultados del screener.
// Sin JSX, sin hooks, sin React. Extraídos de app/screenerPanels.jsx para corregir
// la inversión de capas (useResultViewModel es un hook y no debe importar de un
// archivo de presentación). Comportamiento idéntico al original.

import { rowPassesListContract } from "@/lib/listRationale";
import { sortMetric } from "@/lib/screenerPipeline";
import { gt, gte, lte, isStage2 } from "@/lib/scoring";
import { canonicalRsValue } from "@/lib/rsCanonical";
import { decisionConfidenceSummary } from "@/lib/decisionAudit";
import { countryCode } from "@/lib/symbols";
import { compactIssueLabel } from "@/lib/screenerFormat";
import { scoreAuditCompactFilterKey } from "@/lib/screenerDomains/audit";

export const decisionConfidenceForRow = (row = {}, settingsOrExplanation = {}) => decisionConfidenceSummary(row, settingsOrExplanation);

export function decisionResolutionForRow(row = {}, decisionResolutions = {}) {
  const symbol = String(row?.symbol || "").trim().toUpperCase();
  return symbol ? decisionResolutions?.[symbol] || null : null;
}

export function verifiedIpoCategory(row = {}) {
  if (!rowPassesListContract(row, "ipo")) return "";
  return String(row.ipoCategory || row.snapshot?.ipoCategory || "IPO verificable").trim() || "IPO verificable";
}

export function opportunityBuckets(rows = []) {
  const sorted = (check, key = "objectiveScore") => rows.filter(check).sort((a, b) => sortMetric(b, key) - sortMetric(a, key));
  const defs = [
    { key: "pivot", title: "Vigilancia pivot", note: "Setup observable", check: (r) => rowPassesListContract(r, "nearPivot") },
    { key: "stage2", title: "Etapa 2 temprana", note: "Transición saludable", check: (r) => gt(r.price, r.sma200) && gte(r.sma200Slope, 0) && gte(r.distance52w, -35) && lte(r.extSma50, 18) && !isStage2(r) },
    { key: "pullback", title: "Pullback SMA50", note: "Descanso en tendencia", check: (r) => rowPassesListContract(r, "pullback") },
    { key: "rs", title: "RS", note: "Ranking semanal del universo", check: (r) => (canonicalRsValue(r) ?? 0) >= 75 && gte(r.distance52w, -25) },
    { key: "growth", title: "Growth Quality", note: "Crecimiento + margen", check: (r) => (r.growthScore || 0) >= 70 && (r.objectiveScore ?? r.totalScore ?? 0) >= 64 },
    { key: "ipo", title: "IPO reales", note: "Últimos 5 años", check: (r) => rowPassesListContract(r, "ipo") },
    { key: "extended", title: "Extendidas fuertes", note: "Extensión alta", check: (r) => rowPassesListContract(r, "extended") },
    { key: "risk", title: "Riesgo a revisar", note: "Volatilidad/extensión", check: (r) => (r.riskScore || 0) < 45 || gt(r.extSma50, 28) || (r.speculationRiskScore || 0) >= 70 },
    { key: "weakness", title: "Deterioro técnico", note: "Evitar largos / estudiar debilidad", sortKey: "weaknessScore", check: (r) => rowPassesListContract(r, "weakness") },
  ];
  return defs.map((def) => {
    const hits = sorted(def.check, def.sortKey);
    return { ...def, count: hits.length, leaders: hits.slice(0, 5) };
  });
}

export function passesSectorStrength(row = {}, mode = "Todos") {
  const score = row.sectorScore ?? row.groupStrengthScore;
  if (mode === "Todos") return true;
  if (!Number.isFinite(score)) return false;
  if (mode === "Fuertes") return score >= 70;
  if (mode === "Constructivos") return score >= 55 && score < 70;
  if (mode === "Débiles" || mode === "Débiles") return score < 55;
  if (mode === "Muy débiles" || mode === "Muy débiles") return score < 40;
  return true;
}

export function applyResultViewFilters(baseRows = [], filters = {}) {
  let list = [...baseRows];
  if (filters.decisionResolutionFilter && filters.decisionResolutionFilter !== "all") {
    list = list.filter((row) => {
      const resolution = decisionResolutionForRow(row, filters.decisionResolutions || {});
      const key = resolution?.key || "pending";
      return key === filters.decisionResolutionFilter;
    });
  }
  if (filters.viewLayers?.country && filters.countryFilter !== "Todos") list = list.filter((row) => (row.country || countryCode(row.symbol)) === filters.countryFilter);
  if (filters.viewLayers?.theme && filters.themeFilter !== "Todos") list = list.filter((row) => row.theme === filters.themeFilter);
  if (filters.viewLayers?.sector && filters.sectorFilter !== "Todos") list = list.filter((row) => row.sector === filters.sectorFilter);
  if (filters.viewLayers?.industry && filters.industryFilter !== "Todos") list = list.filter((row) => row.industry === filters.industryFilter);
  if (filters.viewLayers?.sectorStrength) list = list.filter((row) => passesSectorStrength(row, filters.sectorStrength));
  if (filters.viewLayers?.ipo && filters.ipo !== "Todos") list = list.filter((row) => verifiedIpoCategory(row) === filters.ipo);
  return list;
}

export function buildRowReviewFocus({ dataHealth = null, metricTruth = null, scoreAudit = null, vcpReliability = null, evidence = null, rowIssues = [] } = {}) {
  const candidates = [];
  const add = ({ priority = 0, key = "", label = "", tone = "warn", detail = "" } = {}) => {
    if (!key || !label) return;
    candidates.push({ priority, key, label, tone, detail });
  };
  const dataKey = dataHealth?.status?.key || "";
  if (dataKey === "blocked") {
    add({ priority: 100, key: "data", label: "Datos", tone: "bad", detail: dataHealth.status?.detail || dataHealth.topLine || "Datos bloqueados." });
  } else if (["stale", "thin", "limited", "unknown"].includes(dataKey)) {
    add({ priority: 72, key: "data", label: "Datos", tone: dataHealth?.status?.tone || "warn", detail: dataHealth.status?.detail || dataHealth.topLine || "Datos a revisar." });
  }

  const metricKey = metricTruth?.key || "";
  if (metricKey === "blocked") {
    add({ priority: 95, key: "metrics", label: "Metr.", tone: "bad", detail: metricTruth.title || metricTruth.detail || "Métricas bloqueadas." });
  } else if (["review", "missing"].includes(metricKey)) {
    add({ priority: 82, key: "metrics", label: "Metr.", tone: "warn", detail: metricTruth.title || metricTruth.detail || "Métricas a validar." });
  }

  const scoreKey = scoreAuditCompactFilterKey(scoreAudit);
  if (scoreKey === "mismatch") {
    add({ priority: 86, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Score descuadrado." });
  } else if (scoreKey === "missing") {
    add({ priority: 76, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Componentes de score incompletos." });
  } else if (scoreKey === "attention") {
    add({ priority: 58, key: "score", label: "Score", tone: "warn", detail: scoreAudit?.topLine || "Score a revisar." });
  }

  const vcpKey = vcpReliability?.key || "";
  if (vcpKey === "blocked") {
    add({ priority: 80, key: "vcp", label: "VCP", tone: "bad", detail: vcpReliability.summary || vcpReliability.note || "VCP bloqueado." });
  } else if (["inconsistent", "needs-data"].includes(vcpKey)) {
    add({ priority: 70, key: "vcp", label: "VCP", tone: "warn", detail: vcpReliability.summary || vcpReliability.note || "VCP a validar." });
  } else if (["needs-validation", "summary-only"].includes(vcpKey)) {
    add({ priority: 45, key: "vcp", label: "VCP", tone: vcpReliability.tone || "warn", detail: vcpReliability.summary || vcpReliability.note || "Validar patrón." });
  }

  if (evidence?.status === "blocked") {
    add({ priority: 74, key: "evidence", label: "Pruebas", tone: "bad", detail: evidence.summary || "Pruebas bloqueadas." });
  } else if (evidence?.status === "needs-work") {
    const pending = Array.isArray(evidence.pending) ? evidence.pending[0] : null;
    add({ priority: 62, key: "evidence", label: "Pruebas", tone: evidence.tone || "warn", detail: pending?.detail || pending?.label || evidence.summary || "Pruebas pendientes." });
  }

  const issue = Array.isArray(rowIssues) ? rowIssues[0] : null;
  if (issue?.key || issue?.label) {
    add({
      priority: issue.severity === "bad" ? 66 : 52,
      key: "issue",
      label: compactIssueLabel(issue.label, issue.key),
      tone: issue.severity || "warn",
      detail: issue.detail || issue.label || "Revisar incidencia.",
    });
  }

  return candidates.sort((a, b) => b.priority - a.priority)[0] || null;
}
